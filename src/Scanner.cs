using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.CompilerServices;
using NAPS2.Images;
using NAPS2.Images.Gdi;
using NAPS2.Scan;

namespace JEditor;

// Scanning into the open order, with NAPS2.Sdk.
//
// TWAIN scanners scan through NAPS2.Worker.exe, a 32-bit helper process
// with its own TWAIN manager, using their 32-bit drivers (Epson Scan 2,
// Plustek), as NAPS2 itself does. Without the helper, 64-bit TWAIN drivers
// are used in this process. WIA scanners scan in this process. The scanner's own window sets everything (document
// size, resolution, feeder, backs of photos) and a batch from a feeder comes
// in one photo at a time: each is saved into the order as it arrives, under
// the next name in the order's sequence (Smith-014.jpg, Smith-015.jpg…).
//
// In-process (64-bit) TWAIN needs Windows' TWAIN manager, TWAINDSM.dll:
// scanner drivers install it (System32), or it can sit in _win64\.
// NAPS2's own log goes to jEditor's (Log.cs), so a scan that goes wrong
// can be followed.
//
// A test scanner (--fake-scanner, and the smoke test) makes photos without
// hardware, so everything but the driver can be checked anywhere.
sealed class Scanner : IDisposable
{
    public sealed record Device(string Id, string Name, string Driver);

    // Where and how to save: Folder is a folder in the order; names are
    // Prefix + Next (Digits wide, counting up, skipping names taken) + .jpg
    // Compat: for TWAIN drivers that don't work with the newer TWAIN manager
    // (some Plustek ones): Windows' old one, and the whole image at once
    public sealed record Request(string DeviceId, string Driver, string Folder, string Prefix, int Next, int Digits, bool Compat = false);

    public const string FakeId = "jeditor-test-scanner";
    const int JpegQuality = 95;
    const int FakePages = 3;

    readonly ScanningContext context = new(new GdiImageContext()) { Logger = new NapsLog() };
    readonly ScanController controller;
    readonly bool fake;
    readonly bool worker; // TWAIN through the 32-bit helper

    public Scanner(bool fake)
    {
        this.fake = fake;
        try
        {
            context.SetUpWin32Worker();
            worker = true;
        }
        catch (Exception e)
        {
            Log.Write("No 32-bit scanning helper, TWAIN is 64-bit only: " + e.Message);
        }
        controller = new ScanController(context);
    }

    public void Dispose() => context.Dispose();

    // Is the TWAIN manager there? (Without it there are no TWAIN scanners)
    public static bool HasTwain()
    {
        var beside = Path.Combine(AppContext.BaseDirectory, "_win64", "twaindsm.dll");
        foreach (var dll in new[] { beside, "twaindsm.dll" })
        {
            if (System.Runtime.InteropServices.NativeLibrary.TryLoad(dll, out var h))
            {
                System.Runtime.InteropServices.NativeLibrary.Free(h);
                return true;
            }
        }
        return false;
    }

    public async Task<(List<Device> devices, List<string> problems)> ListAsync()
    {
        var list = new List<Device>();
        var problems = new List<string>();
        if (fake) list.Add(new Device(FakeId, "jEditor test scanner", "test"));
        if (worker || HasTwain())
        {
            try
            {
                foreach (var d in await controller.GetDeviceList(Options(Driver.Twain)))
                    list.Add(new Device(d.ID, d.Name, "twain"));
            }
            catch (Exception e)
            {
                Log.Write($"TWAIN scanners: {e}");
                problems.Add("Couldn't list TWAIN scanners: " + e.Message);
            }
        }
        else
        {
            problems.Add("TWAIN isn't set up on this PC (no TWAINDSM.dll), so only WIA scanners are listed");
        }
        try
        {
            foreach (var d in await controller.GetDeviceList(Options(Driver.Wia)))
                list.Add(new Device(d.ID, d.Name, "wia"));
        }
        catch (Exception e)
        {
            Log.Write($"WIA scanners: {e}");
            problems.Add("Couldn't list WIA scanners: " + e.Message);
        }
        Log.Write($"Scanners: {string.Join(", ", list.Select(d => $"{d.Name} ({d.Driver})"))}{(problems.Count > 0 ? "; " + string.Join("; ", problems) : "")}");
        return (list, problems);
    }

    ScanOptions Options(Driver driver) => new()
    {
        Driver = driver,
        TwainOptions = { Dsm = worker ? TwainDsm.New : TwainDsm.NewX64 },
    };

    // Scans until the scanner is done (a whole feeder of photos) or `cancel`.
    // saved(name) after each photo is in the folder. → how many were saved
    public async Task<int> ScanAsync(Request r, IntPtr owner, Action<string> saved, CancellationToken cancel)
    {
        if (!Directory.Exists(r.Folder)) throw new DirectoryNotFoundException("The folder to scan into isn't there");
        int count = 0, next = Math.Max(0, r.Next);
        await foreach (var write in Pages(r, owner, cancel))
        {
            // The next free name; written under a temporary name first, so
            // the folder never shows half a photo
            string name, path;
            do
            {
                name = r.Prefix + next.ToString().PadLeft(Math.Clamp(r.Digits, 1, 9), '0') + ".jpg";
                path = Path.Combine(r.Folder, name);
                next++;
            } while (File.Exists(path));
            var part = path + ".part";
            try
            {
                await Task.Run(() => write(part));
                File.Move(part, path);
            }
            catch
            {
                try { File.Delete(part); } catch { /* best-effort */ }
                throw;
            }
            count++;
            Log.Write($"Scanned {name}");
            saved(name);
        }
        return count;
    }

    // Each page as something that writes it to a file
    async IAsyncEnumerable<Action<string>> Pages(Request r, IntPtr owner, [EnumeratorCancellation] CancellationToken cancel)
    {
        if (r.DeviceId == FakeId && fake)
        {
            for (int i = 1; i <= FakePages; i++)
            {
                await Task.Delay(150, cancel);
                var n = i;
                yield return path => WriteFakePhoto(path, n);
            }
            yield break;
        }

        var driver = r.Driver == "wia" ? Driver.Wia : Driver.Twain;
        var options = Options(driver);
        if (r.Compat && driver == Driver.Twain)
        {
            if (worker) options.TwainOptions.Dsm = TwainDsm.Old;
            options.TwainOptions.TransferMode = TwainTransferMode.Native;
            Log.Write("Compatibility mode: old TWAIN manager" + (worker ? "" : " (not without the helper)") + ", native transfer");
        }
        options.Device = new ScanDevice(driver, r.DeviceId, r.DeviceId);
        options.UseNativeUI = true; // the scanner's own window: size detection, resolution, feeder…
        options.DialogParent = owner;
        options.MaxQuality = true;  // kept lossless until saved
        options.Dpi = 300;          // (the scanner's window decides)
        await foreach (var image in controller.Scan(options, cancel))
        {
            var img = image;
            yield return path =>
            {
                using (img) img.Save(path, ImageFileFormat.Jpeg, new ImageSaveOptions { Quality = JpegQuality });
            };
        }
    }

    // A test photo: a print on a scanner bed, numbered
    static void WriteFakePhoto(string path, int n)
    {
        using var bmp = new Bitmap(1500, 1050);
        bmp.SetResolution(300, 300);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.FromArgb(240, 240, 238));
            using var fill = new LinearGradientBrush(new Rectangle(150, 120, 1200, 810),
                Color.FromArgb(60 + n * 40 % 160, 110, 170), Color.FromArgb(220, 170 - n * 20, 90), 35f);
            g.FillRectangle(fill, 150, 120, 1200, 810);
            using var font = new Font(FontFamily.GenericSansSerif, 120, FontStyle.Bold, GraphicsUnit.Pixel);
            g.DrawString($"Test scan {n}", font, Brushes.White, 260, 440);
        }
        var jpeg = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
        using var p = new EncoderParameters(1);
        p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)JpegQuality);
        bmp.Save(path, jpeg, p);
    }
}

// NAPS2's log, into jEditor's
sealed class NapsLog : Microsoft.Extensions.Logging.ILogger
{
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel level) => level >= Microsoft.Extensions.Logging.LogLevel.Debug;

    public void Log<TState>(Microsoft.Extensions.Logging.LogLevel level, Microsoft.Extensions.Logging.EventId id, TState state,
        Exception? e, Func<TState, Exception?, string> format) =>
        JEditor.Log.Write($"naps2 {level}: {format(state, e)}{(e is null ? "" : " — " + e)}");
}
