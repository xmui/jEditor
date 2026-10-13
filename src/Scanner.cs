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
    public sealed record Request(string DeviceId, string Driver, string Folder, string Prefix, int Next, int Digits, bool Compat = false)
    {
        // Preview and crop: no scanner window; the flatbed at Dpi, cut into
        // one photo per box (fractions of the bed, BedW × BedH inches)
        public Box[]? Crops { get; init; }
        public int Dpi { get; init; } = 300;
        public bool Gray { get; init; }
        public double BedW { get; init; }
        public double BedH { get; init; }
    }

    // A photo's place on the bed: fractions of its width and height
    public sealed record Box(double X, double Y, double W, double H);

    // What a flatbed can do: its bed (inches) and resolutions. Guessed: the
    // driver didn't say, so the bed is taken to be A4
    public sealed record Caps(double BedW, double BedH, List<int> Dpis, bool Gray, bool Guessed);

    // The whole bed, small: a JPEG, its size in pixels and the bed's in inches
    public sealed record Preview(byte[] Jpeg, int Width, int Height, double BedW, double BedH);

    public const string FakeId = "jeditor-test-scanner";
    const int JpegQuality = 95;
    const int FakePages = 3;

    static readonly GdiImageContext images = new();
    readonly ScanningContext context = new(images) { Logger = new NapsLog() };
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

        if (r.Crops is { Length: > 0 })
        {
            await foreach (var write in CroppedPages(r, owner, cancel)) yield return write;
            yield break;
        }

        var driver = r.Driver == "wia" ? Driver.Wia : Driver.Twain;
        var options = For(r.DeviceId, r.Driver, r.Compat);
        options.UseNativeUI = true; // the scanner's own window: size detection, resolution, feeder…
        options.DialogParent = owner;
        options.MaxQuality = true;  // kept lossless until saved
        options.Dpi = 300;          // (the scanner's window decides)
        Log.Write(driver == Driver.Twain
            ? $"TWAIN: manager {options.TwainOptions.Dsm}, transfer {options.TwainOptions.TransferMode}, {(worker ? "through the 32-bit helper" : "64-bit, in jEditor")}; opening the scanner's window"
            : "WIA: opening the scanner's window");
        await foreach (var image in controller.Scan(options, cancel))
        {
            var img = image;
            yield return path =>
            {
                using (img) img.Save(path, ImageFileFormat.Jpeg, new ImageSaveOptions { Quality = JpegQuality });
            };
        }
    }

    // Options for one scanner (compatibility mode: see Request)
    ScanOptions For(string deviceId, string driverName, bool compat)
    {
        var driver = driverName == "wia" ? Driver.Wia : Driver.Twain;
        var options = Options(driver);
        if (compat && driver == Driver.Twain)
        {
            if (worker) options.TwainOptions.Dsm = TwainDsm.Old;
            options.TwainOptions.TransferMode = TwainTransferMode.Native;
            Log.Write("Compatibility mode: old TWAIN manager" + (worker ? "" : " (not without the helper)") + ", native transfer");
        }
        options.Device = new ScanDevice(driver, deviceId, deviceId);
        return options;
    }

    // ---- Preview and crop: jEditor runs the scanner, no scanner window ----

    static readonly int[] CommonDpis = [75, 100, 150, 200, 300, 400, 600, 800, 1200, 1600, 2400];

    public async Task<Caps> CapsAsync(string deviceId, string driver, bool compat, CancellationToken cancel)
    {
        if (deviceId == FakeId && fake) return new Caps(FakeBed.W, FakeBed.H, [75, 150, 300, 600, 1200], true, false);
        try
        {
            var options = For(deviceId, driver, compat);
            options.PaperSource = PaperSource.Flatbed;
            var caps = await controller.GetCaps(options, cancel);
            var flatbed = caps.FlatbedCaps ?? caps.FeederCaps;
            var area = flatbed?.PageSizeCaps?.ScanArea;
            var values = flatbed?.DpiCaps?.Values ?? [];
            var dpis = values.Count > 12 ? CommonDpis.Where(d => d >= values.Min() && d <= values.Max()).ToList()
                : values.Count > 0 ? values.Distinct().OrderBy(d => d).ToList()
                : CommonDpis.Where(d => d <= 1200).ToList();
            var gray = flatbed?.BitDepthCaps?.SupportsGrayscale ?? true;
            Log.Write($"Scanner caps: bed {(area is null ? "not said" : $"{area.WidthInInches:0.##} × {area.HeightInInches:0.##} in")}; resolutions {string.Join(", ", values)}; {caps.MetadataCaps?.Manufacturer} {caps.MetadataCaps?.Model}");
            if (area is not null && area.WidthInInches > 1 && area.HeightInInches > 1)
                return new Caps((double)area.WidthInInches, (double)area.HeightInInches, dpis, gray, false);
            return new Caps((double)PageSize.A4.WidthInInches, (double)PageSize.A4.HeightInInches, dpis, gray, true);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            Log.Write($"Scanner caps: couldn't ask ({e.Message}); taking the bed to be A4");
            return new Caps((double)PageSize.A4.WidthInInches, (double)PageSize.A4.HeightInInches, CommonDpis.Where(d => d <= 1200).ToList(), true, true);
        }
    }

    // The whole bed at a low resolution, to draw boxes on
    public async Task<Preview> PreviewAsync(string deviceId, string driver, bool compat, double bedW, double bedH, int dpi, IntPtr owner, CancellationToken cancel)
    {
        using var bmp = deviceId == FakeId && fake
            ? await Task.Run(() => FakeBed.Draw(dpi, bedH), cancel)
            : await ScanBed(For(deviceId, driver, compat), bedW, bedH, dpi, false, owner, cancel);
        using var ms = new MemoryStream();
        SaveJpeg(bmp, ms, 85);
        Log.Write($"Preview: {bmp.Width} × {bmp.Height} at {dpi} dpi");
        return new Preview(ms.ToArray(), bmp.Width, bmp.Height, bedW, bedH);
    }

    // The flatbed, from its top edge down to `height` inches, as one image
    async Task<Bitmap> ScanBed(ScanOptions options, double width, double height, int dpi, bool gray, IntPtr owner, CancellationToken cancel)
    {
        options.UseNativeUI = false;
        options.DialogParent = owner;
        options.PaperSource = PaperSource.Flatbed;
        options.Dpi = dpi;
        options.BitDepth = gray ? NAPS2.Images.BitDepth.Grayscale : NAPS2.Images.BitDepth.Color;
        options.PageSize = new PageSize(Math.Round((decimal)width, 2), Math.Round((decimal)height, 2), PageSizeUnit.Inch);
        options.PageAlign = HorizontalAlign.Left;
        options.MaxQuality = true;
        Log.Write($"Scanning the bed: {width:0.##} × {height:0.##} in at {dpi} dpi, {(gray ? "greys" : "colour")}, no scanner window ({options.Driver}, manager {options.TwainOptions.Dsm}, transfer {options.TwainOptions.TransferMode})");
        Bitmap? result = null;
        await foreach (var image in controller.Scan(options, cancel))
        {
            using (image)
            {
                if (result is null) result = images.RenderToBitmap(image);
            }
        }
        return result ?? throw new InvalidOperationException("The scanner sent nothing back");
    }

    // Preview and crop: one scan of the bed (only as far down as the
    // lowest box), cut into a photo per box
    async IAsyncEnumerable<Action<string>> CroppedPages(Request r, IntPtr owner, [EnumeratorCancellation] CancellationToken cancel)
    {
        var boxes = r.Crops!;
        var bottom = Math.Min(1, boxes.Max(b => b.Y + b.H));
        var height = Math.Min(r.BedH, bottom * r.BedH + 0.1); // a little past it: scanners round
        var fakeScan = r.DeviceId == FakeId && fake;
        var dpi = fakeScan ? Math.Min(r.Dpi, 300) : r.Dpi;
        var bmp = fakeScan
            ? await Task.Run(() => FakeBed.Draw(dpi, height), cancel)
            : await ScanBed(For(r.DeviceId, r.Driver, r.Compat), r.BedW, height, dpi, r.Gray, owner, cancel);
        try
        {
            // Pixels per inch: the image's own resolution if it's believable
            // (some drivers send the whole bed whatever was asked), else
            // from its size
            double Ppi(float said, int px, double inches) => said >= 50 && Math.Abs(said - dpi) <= dpi * 0.1 ? said : px / inches;
            var ppiX = Ppi(bmp.HorizontalResolution, bmp.Width, r.BedW);
            var ppiY = Ppi(bmp.VerticalResolution, bmp.Height, height);
            Log.Write($"Bed scanned: {bmp.Width} × {bmp.Height} px ({ppiX:0} × {ppiY:0} ppi); cutting {boxes.Length} photo{(boxes.Length == 1 ? "" : "s")}");
            foreach (var b in boxes)
            {
                var rect = Rectangle.Intersect(new Rectangle(0, 0, bmp.Width, bmp.Height), Rectangle.FromLTRB(
                    (int)Math.Floor(b.X * r.BedW * ppiX), (int)Math.Floor(b.Y * r.BedH * ppiY),
                    (int)Math.Ceiling((b.X + b.W) * r.BedW * ppiX), (int)Math.Ceiling((b.Y + b.H) * r.BedH * ppiY)));
                if (rect.Width < 8 || rect.Height < 8)
                {
                    Log.Write($"A box is off the scan ({b}), skipped");
                    continue;
                }
                var src = bmp;
                yield return path =>
                {
                    using var part = src.Clone(rect, src.PixelFormat);
                    part.SetResolution((float)ppiX, (float)ppiY);
                    using var f = File.Create(path);
                    SaveJpeg(part, f, JpegQuality);
                };
            }
        }
        finally
        {
            bmp.Dispose();
        }
    }

    static void SaveJpeg(Bitmap bmp, Stream to, int quality)
    {
        var jpeg = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
        using var p = new EncoderParameters(1);
        p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
        bmp.Save(to, jpeg, p);
    }

    // The test scanner's flatbed: three prints on a pale lid
    static class FakeBed
    {
        public const double W = 8.5, H = 11.7;
        static readonly (double x, double y, double w, double h, Color a, Color b)[] Prints =
        [
            (0.5, 0.5, 4.0, 3.0, Color.FromArgb(70, 110, 170), Color.FromArgb(220, 160, 90)),
            (5.0, 0.7, 3.0, 4.0, Color.FromArgb(150, 60, 90), Color.FromArgb(240, 210, 120)),
            (1.0, 5.0, 6.0, 4.0, Color.FromArgb(40, 120, 80), Color.FromArgb(180, 220, 240)),
        ];

        // The bed down to `height` inches at `dpi`
        public static Bitmap Draw(int dpi, double height)
        {
            var bmp = new Bitmap((int)Math.Round(W * dpi), (int)Math.Round(Math.Min(H, height) * dpi));
            bmp.SetResolution(dpi, dpi);
            using var g = Graphics.FromImage(bmp);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.FromArgb(242, 242, 240));
            int n = 0;
            foreach (var (x, y, w, h, a, b) in Prints)
            {
                n++;
                var rect = new RectangleF((float)(x * dpi), (float)(y * dpi), (float)(w * dpi), (float)(h * dpi));
                using var fill = new LinearGradientBrush(rect, a, b, 35f);
                g.FillRectangle(fill, rect);
                using var font = new Font(FontFamily.GenericSansSerif, (float)(0.4 * dpi), FontStyle.Bold, GraphicsUnit.Pixel);
                g.DrawString($"Print {n}", font, Brushes.White, rect.X + 0.3f * dpi, rect.Y + 0.3f * dpi);
            }
            return bmp;
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
