using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace JEditor.Camera;

// A camera on USB, as jEditor sees it
interface ICamera : IDisposable
{
    string Name { get; }
    void Connect();
    void KeepOnCard(bool keep);
    byte[]? LiveView();                    // a JPEG, or null if none came
    void Shutter();                        // a shot; it turns up in Waiting
    int Waiting();                         // photos ready to come over
    (string Name, byte[] Data) Download(); // the next one (its name on the camera)
}

// Tethered shooting: a camera's photos straight into a folder of the
// project, as they're taken (with jEditor's shutter button or the camera's
// own), under the project's names; and its live view.
//
// Everything the camera does happens on one thread of its own (WPD wants
// its objects used where they were made, and one PTP transaction at a
// time): commands from the page queue up for it. It tells the page what
// happened through `report` (on that thread):
//   { kind: 'connected', name }   { kind: 'frame', image }
//   { kind: 'saved', name }       { kind: 'status', text, error? }
sealed class Tether : IDisposable
{
    public sealed record Target(string Folder, string Prefix, int Next, int Digits);
    public sealed record Found(string Id, string Name, bool Ready, string? Note);

    public const string FakeId = "jeditor-test-camera";
    const int Sony = 0x054C;
    // In PC Remote mode: A7 III, A7 IV. Their MTP (file transfer) mode
    // can't shoot
    static readonly HashSet<int> PcRemote = [0x0C34, 0x0DA7];
    static readonly HashSet<int> MtpMode = [0x0C03, 0x0DA6];

    readonly ICamera camera;
    readonly Action<object> report;
    readonly ConcurrentQueue<Action> commands = new();
    readonly AutoResetEvent wake = new(false);
    readonly Thread thread;
    readonly object gate = new();
    Target target;
    bool keepOnCard;
    volatile bool stop, live, frameWanted = true;
    string? lastStem;
    int lastNumber = -1;

    public List<string> Saved { get; } = [];
    public Task<string?> Done => done.Task; // the session's end: null, or why it ended
    readonly TaskCompletionSource<string?> done = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public Tether(ICamera camera, Target target, bool keepOnCard, bool live, Action<object> report)
    {
        this.camera = camera;
        this.target = target;
        this.keepOnCard = keepOnCard;
        this.live = live;
        this.report = report;
        thread = new Thread(Run) { IsBackground = true, Name = "camera" };
        thread.SetApartmentState(ApartmentState.MTA);
    }

    public void Start() => thread.Start();

    // ---- From the page ----

    public void Shoot() => Do(() =>
    {
        report(new { kind = "status", text = "Taking a photo…" });
        camera.Shutter();
    });

    public void Live(bool on)
    {
        live = on;
        frameWanted = true;
        wake.Set();
    }

    // The page has shown the last frame: the next one can come
    public void FrameShown()
    {
        frameWanted = true;
        wake.Set();
    }

    public void SetKeepOnCard(bool keep) => Do(() =>
    {
        keepOnCard = keep;
        camera.KeepOnCard(keep);
    });

    public void SetTarget(Target t)
    {
        lock (gate)
        {
            target = t;
            lastStem = null;
        }
    }

    public void Stop()
    {
        stop = true;
        wake.Set();
    }

    void Do(Action a)
    {
        commands.Enqueue(a);
        wake.Set();
    }

    // ---- The camera's thread ----

    void Run()
    {
        string? why = null;
        try
        {
            report(new { kind = "status", text = $"Connecting to {camera.Name}…" });
            camera.Connect();
            report(new { kind = "connected", name = camera.Name });
            try { camera.KeepOnCard(keepOnCard); }
            catch (Exception e) { Log.Write("Camera: where it saves wasn't set: " + e.Message); }
            report(new { kind = "status", text = "Ready: take a photo here or on the camera" });
            int failures = 0;
            long lastLook = 0;
            while (!stop)
            {
                try
                {
                    while (!stop && commands.TryDequeue(out var command)) command();
                    if (live && frameWanted && !stop)
                    {
                        var frame = camera.LiveView();
                        if (frame is not null)
                        {
                            frameWanted = false;
                            report(new { kind = "frame", image = "data:image/jpeg;base64," + Convert.ToBase64String(frame) });
                        }
                    }
                    // Photos waiting: taken here or with the camera's button
                    var now = Environment.TickCount64;
                    if (!stop && now - lastLook >= (live ? 400 : 200))
                    {
                        lastLook = now;
                        for (int n = camera.Waiting(); n > 0 && !stop; n--) SaveNext();
                    }
                    failures = 0;
                }
                catch (Exception e) when (e is not ThreadInterruptedException)
                {
                    if (Gone(e)) throw;
                    Log.Write($"Camera: {e.Message}");
                    report(new { kind = "status", text = e is CameraException ? e.Message : "The camera didn't answer: " + e.Message, error = true });
                    if (++failures >= 8) throw new CameraException("The camera stopped answering");
                    Thread.Sleep(300);
                }
                wake.WaitOne(live ? (frameWanted ? 10 : 40) : 150);
            }
        }
        catch (Exception e)
        {
            why = Gone(e) ? "The camera was unplugged or turned off" : e is CameraException ? e.Message : "The camera couldn't be used: " + e.Message;
            Log.Write($"Camera: ended: {e}");
        }
        finally
        {
            try { camera.Dispose(); } catch (Exception) { }
            done.TrySetResult(why);
        }
    }

    // The device went away (unplugged, turned off, asleep)
    static bool Gone(Exception e) => e is COMException c && (uint)c.HResult is 0x8007048F or 0x800701B1 or 0x80070015 or 0x8007001F or 0x80070079;

    // The next photo from the camera, saved under the project's next name.
    // RAW + JPEG come over one after the other with the same name on the
    // camera (DSC01234.ARW, DSC01234.JPG): they keep one number
    void SaveNext()
    {
        Target t;
        lock (gate) t = target;
        // Checked before the photo leaves the camera's buffer
        if (!Directory.Exists(t.Folder)) throw new CameraException("The folder to save into isn't there any more");
        var (cameraName, data) = camera.Download();
        try { Write(t, cameraName, data); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Not lost: kept where it can be found, and the session says why
            var keep = Path.Combine(Path.GetTempPath(), "jEditor-unsaved");
            Directory.CreateDirectory(keep);
            var safe = Path.Combine(keep, $"{DateTime.Now:yyyyMMdd-HHmmss}-{Path.GetFileName(cameraName)}");
            File.WriteAllBytes(safe, data);
            Log.Write($"Camera: couldn't save {cameraName} ({e.Message}); kept it as {safe}");
            throw new CameraException($"The photo couldn't be saved ({e.Message}). It was kept in {keep}.");
        }
    }

    void Write(Target t, string cameraName, byte[] data)
    {
        var ext = Path.GetExtension(cameraName).ToLowerInvariant();
        if (ext is "" or ".jpeg") ext = ".jpg";
        var stem = Path.GetFileNameWithoutExtension(cameraName);
        string Name(int n) => t.Prefix + n.ToString().PadLeft(Math.Clamp(t.Digits, 1, 9), '0');
        int number;
        if (stem == lastStem && lastNumber >= 0 && !File.Exists(Path.Combine(t.Folder, Name(lastNumber) + ext)))
        {
            number = lastNumber;
        }
        else
        {
            number = Math.Max(Math.Max(0, t.Next), lastNumber + 1);
            while (Directory.EnumerateFiles(t.Folder, Name(number) + ".*").Any()) number++;
        }
        var name = Name(number) + ext;
        var path = Path.Combine(t.Folder, name);
        var part = path + ".part";
        File.WriteAllBytes(part, data);
        File.Move(part, path);
        lastStem = stem;
        lastNumber = number;
        lock (gate) target = t with { Next = number + 1 };
        Saved.Add(name);
        Log.Write($"Camera: saved {cameraName} as {name}");
        report(new { kind = "saved", name, from = cameraName });
    }

    public void Dispose()
    {
        Stop();
        if (thread.IsAlive && !thread.Join(3000)) Log.Write("Camera: its thread didn't end");
        wake.Dispose();
    }

    // ---- Which cameras are plugged in ----

    // Sony cameras Windows sees (WPD), and the test camera if asked for.
    // Ready: in PC Remote mode (else Note says what to do)
    public static Task<List<Found>> FindAsync(bool fake) => Task.Run(() =>
    {
        var list = new List<Found>();
        if (fake) list.Add(new Found(FakeId, "jEditor test camera", true, null));
        IPortableDeviceManager manager;
        try { manager = Com.Create<IPortableDeviceManager>(Clsid.PortableDeviceManager); }
        catch (Exception e)
        {
            Log.Write("Cameras: Windows Portable Devices isn't available: " + e.Message);
            return list;
        }
        try
        {
            foreach (var id in WpdDevices.GetDeviceIds(manager))
            {
                try { Add(id); }
                catch (Exception e) { Log.Write($"Cameras: skipped {id}: {e.Message}"); }
            }
        }
        catch (Exception e)
        {
            Log.Write("Cameras: couldn't list Windows' devices: " + e.Message);
        }
        finally
        {
            Marshal.ReleaseComObject(manager);
        }
        return list;

        void Add(string id)
        {
            var maker = WpdDevices.GetString(manager.GetDeviceManufacturer, id);
            var name = WpdDevices.GetString(manager.GetDeviceFriendlyName, id);
            var ids = WpdDevices.ParseVidPid(id);
            bool sony = ids?.vid == Sony || maker.Contains("Sony", StringComparison.OrdinalIgnoreCase);
            Log.Write($"Cameras: {maker} {name} {(ids is { } v ? $"{v.vid:X4}:{v.pid:X4}" : "")}{(sony ? "" : " (not a Sony, skipped)")}");
            if (!sony) return;
            var label = string.IsNullOrWhiteSpace(name) ? "Sony camera" : name.StartsWith("Sony", StringComparison.OrdinalIgnoreCase) ? name : "Sony " + name;
            if (ids is { } p && MtpMode.Contains(p.pid))
                list.Add(new Found(id, label, false, "It's connected for file transfer. On the camera: Menu → Network (or Setup) → USB Connection → PC Remote, then plug it in again."));
            else
                list.Add(new Found(id, label, true, ids is { } q && PcRemote.Contains(q.pid) ? null : "Not a model jEditor knows: it may work in PC Remote mode."));
        }
    });
}

// The test camera (--fake-camera, and the smoke test): live view that
// counts frames, and RAW + JPEG for each shot, so everything but the USB
// can be checked anywhere
sealed class FakeCamera : ICamera
{
    readonly Queue<(string, byte[])> waiting = new();
    int frames, shots;

    public string Name => "jEditor test camera";
    public void Connect() => Log.Write("Camera: the test camera connected");
    public void KeepOnCard(bool keep) => Log.Write($"Camera: test camera saving to {(keep ? "the PC and its card" : "the PC only")}");

    public byte[]? LiveView()
    {
        Thread.Sleep(30);
        return Jpeg(640, 427, $"Live {++frames}", 70);
    }

    public void Shutter()
    {
        shots++;
        var name = $"DSC{shots:00000}";
        lock (waiting)
        {
            waiting.Enqueue((name + ".ARW", [0x49, 0x49, 0x2A, 0x00, (byte)shots]));
            waiting.Enqueue((name + ".JPG", Jpeg(1200, 800, $"Shot {shots}", 92)));
        }
    }

    public int Waiting()
    {
        lock (waiting) return waiting.Count;
    }

    public (string Name, byte[] Data) Download()
    {
        lock (waiting) return waiting.Dequeue();
    }

    public void Dispose() { }

    static byte[] Jpeg(int w, int h, string text, int quality)
    {
        using var bmp = new Bitmap(w, h);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using var fill = new LinearGradientBrush(new Rectangle(0, 0, w, h), Color.FromArgb(40, 70, 110), Color.FromArgb(200, 150, 90), 30f);
            g.FillRectangle(fill, 0, 0, w, h);
            using var font = new Font(FontFamily.GenericSansSerif, h / 8f, FontStyle.Bold, GraphicsUnit.Pixel);
            g.DrawString(text, font, Brushes.White, w / 10f, h / 2.5f);
        }
        var jpeg = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
        using var p = new EncoderParameters(1);
        p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
        using var ms = new MemoryStream();
        bmp.Save(ms, jpeg, p);
        return ms.ToArray();
    }
}
