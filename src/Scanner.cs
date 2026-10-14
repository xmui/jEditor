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
        // jEditor's own settings (no scanner window): Source "glass"
        // (preview and crop: the flatbed at Dpi, cut into a photo per box,
        // fractions of the bed, BedW × BedH inches) or "feeder" (BedW ×
        // BedH is the longest page). "driver": the scanner's own window
        public string Source { get; init; } = "driver";
        public Box[]? Crops { get; init; }
        public int Dpi { get; init; } = 300;
        public bool Gray { get; init; }
        public double BedW { get; init; }
        public double BedH { get; init; }
        // Feeder: "front", "back" or "both" sides of each photo. Swap: this
        // scanner calls the photo's back its front (the FastFoto does)
        public string Sides { get; init; } = "front";
        public bool Swap { get; init; }
        // Feeder, TWAIN: the scanner crops each photo itself (its own
        // auto-size, through the 32-bit helper; see Twain32)
        public bool AutoSize { get; init; }
        // -100…100, applied by jEditor so every scanner does the same
        public int Brightness { get; init; }
        public int Contrast { get; init; }
        // "jpeg" (with Quality), "png" or "tiff" (lossless)
        public string Format { get; init; } = "jpeg";
        public int Quality { get; init; } = JpegQuality;
        public string Ext => Format == "tiff" ? ".tif" : Format == "png" ? ".png" : ".jpg";
    }

    // A photo's place on the bed: fractions of its width and height, turned
    // Angle degrees (clockwise) about its middle to match a crooked print;
    // Turn (0, 90, 180, 270) turns the photo clockwise when it's saved
    public sealed record Box(double X, double Y, double W, double H, double Angle = 0, int Turn = 0);

    // What a scanner can do: its glass (inches; guessed: the driver didn't
    // say, so A4), resolutions, and its feeder (the longest page) and sides.
    // Compat: it only answered in compatibility mode (see Request)
    public sealed record Caps(double BedW, double BedH, List<int> Dpis, bool Gray, bool Guessed,
        bool Flatbed = true, bool Feeder = false, bool Duplex = false, double FeedW = 0, double FeedH = 0, bool Compat = false);

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

    // The last caps, preview or scan only worked in compatibility mode,
    // though it wasn't asked for: the page turns it on for that scanner
    public bool FellBackToCompat { get; private set; }

    // A TWAIN driver that won't open with the newer TWAIN manager (the
    // OpticBook's): NAPS2 says the driver has already shown its error, or
    // that it couldn't open it at all
    static bool WontOpen(Exception e) =>
        e is NAPS2.Scan.Exceptions.AlreadyHandledDriverException or NAPS2.Scan.Exceptions.ScanDriverUnknownException
        || e.GetType() == typeof(NAPS2.Scan.Exceptions.DeviceException);

    // Scans with options made by make(compat). A TWAIN scanner that fails
    // to open before anything came is tried once more in compatibility
    // mode (Windows' old TWAIN manager, native transfer)
    async IAsyncEnumerable<ProcessedImage> Run(Func<bool, ScanOptions> make, bool compat, [EnumeratorCancellation] CancellationToken cancel)
    {
        var options = make(compat);
        bool any = false;
        int n = 0;
        var started = System.Diagnostics.Stopwatch.StartNew();
        Exception? failed = null;
        await using (var e = controller.Scan(options, cancel).GetAsyncEnumerator(cancel))
        {
            while (true)
            {
                try
                {
                    if (!await e.MoveNextAsync()) break;
                }
                catch (Exception ex) when (!any && !compat && options.Driver == Driver.Twain && WontOpen(ex) && !cancel.IsCancellationRequested)
                {
                    failed = ex;
                    break;
                }
                any = true;
                Log.Write($"Image {++n} came in at {started.Elapsed.TotalSeconds:0.0} s");
                yield return e.Current;
            }
        }
        if (failed is null) Log.Write($"The scanner is done: {n} image{(n == 1 ? "" : "s")} in {started.Elapsed.TotalSeconds:0.0} s");
        if (failed is null) yield break;
        Log.Write($"The scanner didn't open ({failed.GetType().Name}: {failed.Message}); trying again in compatibility mode (Older TWAIN mode)");
        await foreach (var image in controller.Scan(make(true), cancel))
        {
            if (!FellBackToCompat) Log.Write("It works in compatibility mode: jEditor keeps that on for this scanner");
            FellBackToCompat = true;
            yield return image;
        }
    }

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

    // A scanned page: what writes it to a file, and whether it's the back
    // of the photo before it (saved beside it as Smith-014-b.jpg)
    sealed record Page(Action<string> Write, bool Back = false);

    // Scans until the scanner is done (a whole feeder of photos) or `cancel`.
    // saved(name) after each photo is in the folder. → how many were saved
    public async Task<int> ScanAsync(Request r, IntPtr owner, Action<string> saved, CancellationToken cancel)
    {
        if (!Directory.Exists(r.Folder)) throw new DirectoryNotFoundException("The folder to scan into isn't there");
        FellBackToCompat = false;
        int count = 0, next = Math.Max(0, r.Next);
        string? lastStem = null;
        string Stem(int n) => r.Prefix + n.ToString().PadLeft(Math.Clamp(r.Digits, 1, 9), '0');
        bool Taken(string stem) => File.Exists(Path.Combine(r.Folder, stem + r.Ext)) || File.Exists(Path.Combine(r.Folder, stem + "-b" + r.Ext));
        await foreach (var page in Pages(r, owner, cancel))
        {
            // The next free name (a back: its front's, with -b); written
            // under a temporary name first, so the folder never shows half
            // a photo
            string name, path;
            if (page.Back && lastStem is not null && !File.Exists(Path.Combine(r.Folder, lastStem + "-b" + r.Ext)))
            {
                name = lastStem + "-b" + r.Ext;
            }
            else
            {
                while (Taken(Stem(next))) next++;
                lastStem = Stem(next++);
                name = lastStem + (page.Back ? "-b" : "") + r.Ext;
            }
            path = Path.Combine(r.Folder, name);
            var write = page.Write;
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
    async IAsyncEnumerable<Page> Pages(Request r, IntPtr owner, [EnumeratorCancellation] CancellationToken cancel)
    {
        // Preview and crop (the test scanner too: its glass)
        if (r.Crops is { Length: > 0 })
        {
            await foreach (var page in CroppedPages(r, owner, cancel)) yield return page;
            yield break;
        }
        if (r.Source == "feeder")
        {
            await foreach (var page in FeederPages(r, owner, cancel)) yield return page;
            yield break;
        }

        if (r.DeviceId == FakeId && fake)
        {
            for (int i = 1; i <= FakePages; i++)
            {
                await Task.Delay(150, cancel);
                var n = i;
                yield return new Page(path => WriteFakePhoto(path, n));
            }
            yield break;
        }

        var driver = r.Driver == "wia" ? Driver.Wia : Driver.Twain;
        ScanOptions Make(bool compat)
        {
            var options = For(r.DeviceId, r.Driver, compat);
            options.UseNativeUI = true; // the scanner's own window: size detection, resolution, feeder…
            options.DialogParent = owner;
            // The whole image at once: NAPS2's default with a scanner window
            // (memory transfer, in small pieces through the 32-bit helper)
            // kept the FastFoto's window busy long after each photo
            if (driver == Driver.Twain) options.TwainOptions.TransferMode = TwainTransferMode.Native;
            options.MaxQuality = true;  // kept lossless until saved
            options.Dpi = 300;          // (the scanner's window decides)
            Log.Write(driver == Driver.Twain
                ? $"TWAIN: manager {options.TwainOptions.Dsm}, transfer {options.TwainOptions.TransferMode}, {(worker ? "through the 32-bit helper" : "64-bit, in jEditor")}; opening the scanner's window"
                : "WIA: opening the scanner's window");
            return options;
        }
        await foreach (var image in Run(Make, r.Compat, cancel))
        {
            var img = image;
            yield return new Page(path =>
            {
                using (img)
                {
                    if (r.Format == "jpeg" && r.Quality == JpegQuality) img.Save(path, ImageFileFormat.Jpeg, new ImageSaveOptions { Quality = JpegQuality });
                    else
                    {
                        using var bmp = images.RenderToBitmap(img);
                        Save(bmp, path, r);
                    }
                }
            });
        }
    }

    // ---- The feeder (FastFoto): jEditor's settings, no scanner window ----

    // Each photo through the feeder; both sides scanned when a back is
    // wanted (or when this scanner calls the photo's side its back)
    async IAsyncEnumerable<Page> FeederPages(Request r, IntPtr owner, [EnumeratorCancellation] CancellationToken cancel)
    {
        bool front = r.Sides != "back", back = r.Sides != "front";
        // The scanner's own "front" is the photo unless swapped
        bool duplex = back && front || (front ? r.Swap : !r.Swap);
        Log.Write($"Feeder: {r.Sides} side{(r.Sides == "both" ? "s" : "")}{(r.Swap ? " (this scanner's sides swapped)" : "")}, {(duplex ? "both sides scanned" : "one side")}, {r.Dpi} dpi, {(r.Gray ? "greys" : "colour")}, brightness {r.Brightness}, contrast {r.Contrast}, {r.Format}");
        Bitmap? first = null; // duplex: the scanner's front, until its back comes
        try
        {
            await foreach (var bmp in FeederImages(r, duplex, owner, cancel))
            {
                if (!duplex)
                {
                    // One side: the one asked for
                    var one = bmp;
                    yield return new Page(path => Save(Adjust(one, r), path, r));
                    continue;
                }
                if (first is null) { first = bmp; continue; }
                // A pair: the scanner's front, then its back; the photo is
                // the front unless this scanner has them the other way round
                var (photo, other) = r.Swap ? (bmp, first) : (first, bmp);
                first = null;
                if (front) yield return new Page(path => Save(Adjust(photo, r), path, r));
                else photo.Dispose();
                if (back) yield return new Page(path => Save(Adjust(other, r), path, r), Back: front);
                else other.Dispose();
            }
        }
        finally
        {
            first?.Dispose();
        }
    }

    async IAsyncEnumerable<Bitmap> FeederImages(Request r, bool duplex, IntPtr owner, [EnumeratorCancellation] CancellationToken cancel)
    {
        if (r.DeviceId == FakeId && fake)
        {
            // The test feeder: three photos, each with a plain back (its
            // front first, as most scanners send them; swapped if asked)
            for (int n = 1; n <= FakePages; n++)
            {
                await Task.Delay(100, cancel);
                var sides = new[] { FakeSide(n, true), FakeSide(n, false) };
                if (r.Swap) Array.Reverse(sides);
                yield return sides[0];
                if (duplex) yield return sides[1];
                else sides[1].Dispose();
            }
            yield break;
        }
        // The scanner's own auto-size, if it has it; else the usual way
        if (r.AutoSize && r.Driver == "twain" && Twain32.Exe is not null)
        {
            Exception? failed = null;
            bool any = false;
            await using (var e = Twain32.ScanAsync(r.DeviceId, r.Dpi, r.Gray, duplex, true, cancel).GetAsyncEnumerator(cancel))
            {
                while (true)
                {
                    try
                    {
                        if (!await e.MoveNextAsync()) break;
                    }
                    catch (Twain32.Failed ex) when (!any)
                    {
                        failed = ex;
                        break;
                    }
                    any = true;
                    yield return e.Current;
                }
            }
            if (failed is null) yield break;
            Log.Write($"The scanner's own auto-size didn't work ({failed.Message}); scanning the usual way, jEditor crops each photo");
        }
        ScanOptions Make(bool compat)
        {
            var options = For(r.DeviceId, r.Driver, compat);
            options.UseNativeUI = false;
            options.DialogParent = owner;
            options.PaperSource = duplex ? PaperSource.Duplex : PaperSource.Feeder;
            options.Dpi = r.Dpi;
            options.BitDepth = r.Gray ? NAPS2.Images.BitDepth.Grayscale : NAPS2.Images.BitDepth.Color;
            if (r.BedW > 1 && r.BedH > 1) options.PageSize = new PageSize(Math.Round((decimal)r.BedW, 2), Math.Round((decimal)r.BedH, 2), PageSizeUnit.Inch);
            options.MaxQuality = true;
            Log.Write($"Scanning the feeder: {options.PaperSource}, page up to {r.BedW:0.##} × {r.BedH:0.##} in, no scanner window ({options.Driver}, manager {options.TwainOptions.Dsm}, transfer {options.TwainOptions.TransferMode})");
            return options;
        }
        await foreach (var image in Run(Make, r.Compat, cancel))
        {
            using (image) yield return images.RenderToBitmap(image);
        }
    }

    // A test feeder side: the photo, or its plain back with a little writing
    static Bitmap FakeSide(int n, bool photo)
    {
        var bmp = new Bitmap(1200, 800);
        bmp.SetResolution(300, 300);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        if (photo)
        {
            using var fill = new LinearGradientBrush(new Rectangle(0, 0, 1200, 800), Color.FromArgb(60 + n * 40 % 160, 110, 170), Color.FromArgb(220, 170 - n * 20, 90), 35f);
            g.FillRectangle(fill, 0, 0, 1200, 800);
        }
        else g.Clear(Color.FromArgb(250, 249, 245));
        using var font = new Font(FontFamily.GenericSansSerif, 80, FontStyle.Bold, GraphicsUnit.Pixel);
        g.DrawString(photo ? $"Photo {n}" : $"Back {n}", font, photo ? Brushes.White : Brushes.Gray, 120, 340);
        return bmp;
    }

    // ---- Saving ----

    // Brightness and contrast (-100…100): contrast about the middle grey,
    // then brightness added, the same as the preview shows
    static Bitmap Adjust(Bitmap bmp, Request r) => Adjust(bmp, r.Brightness, r.Contrast);

    public static Bitmap Adjust(Bitmap bmp, int brightness, int contrast)
    {
        if (brightness == 0 && contrast == 0) return bmp;
        float f = (100 + Math.Clamp(contrast, -100, 100)) / 100f;
        float t = (1 - f) / 2 + Math.Clamp(brightness, -100, 100) / 200f;
        var m = new System.Drawing.Imaging.ColorMatrix(
        [
            [f, 0, 0, 0, 0],
            [0, f, 0, 0, 0],
            [0, 0, f, 0, 0],
            [0, 0, 0, 1, 0],
            [t, t, t, 0, 1],
        ]);
        using var attrs = new ImageAttributes();
        attrs.SetColorMatrix(m);
        var res = (bmp.HorizontalResolution, bmp.VerticalResolution);
        var copy = new Bitmap(bmp.Width, bmp.Height, PixelFormat.Format24bppRgb);
        copy.SetResolution(res.HorizontalResolution, res.VerticalResolution);
        using (var g = Graphics.FromImage(copy))
            g.DrawImage(bmp, new Rectangle(0, 0, bmp.Width, bmp.Height), 0, 0, bmp.Width, bmp.Height, GraphicsUnit.Pixel, attrs);
        bmp.Dispose();
        return copy;
    }

    // As JPEG (at the quality asked) or TIFF (lossless, LZW)
    static void Save(Bitmap bmp, string path, Request r)
    {
        try
        {
            using var f = File.Create(path);
            if (r.Format == "png") bmp.Save(f, ImageFormat.Png);
            else if (r.Format == "tiff")
            {
                var tiff = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Tiff.Guid);
                using var p = new EncoderParameters(1);
                p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Compression, (long)EncoderValue.CompressionLZW);
                bmp.Save(f, tiff, p);
            }
            else SaveJpeg(bmp, f, Math.Clamp(r.Quality, 40, 100));
        }
        finally
        {
            bmp.Dispose();
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
        // The test scanner has both: a glass with three prints, and a feeder
        if (deviceId == FakeId && fake) return new Caps(FakeBed.W, FakeBed.H, [75, 150, 300, 600, 1200], true, false, true, true, true, 8.5, 14);
        FellBackToCompat = false;
        try
        {
            var options = For(deviceId, driver, compat);
            var caps = await controller.GetCaps(options, cancel);
            // NAPS2 answers nothing when the driver wouldn't open
            static bool Empty(ScanCaps c) => c.PaperSourceCaps is null && c.FlatbedCaps is null && c.FeederCaps is null;
            if (Empty(caps) && !compat && options.Driver == Driver.Twain)
            {
                Log.Write("Scanner caps: the scanner didn't open; asking again in compatibility mode (Older TWAIN mode)");
                var again = await controller.GetCaps(For(deviceId, driver, true), cancel);
                if (!Empty(again))
                {
                    caps = again;
                    compat = FellBackToCompat = true;
                }
            }
            if (Empty(caps))
            {
                // Glass and feeder both offered, the bed taken to be A4
                Log.Write("Scanner caps: the scanner didn't open to say what it has (is another program using it, or is it asleep?)");
                return new Caps((double)PageSize.A4.WidthInInches, (double)PageSize.A4.HeightInInches, CommonDpis.Where(d => d <= 1200).ToList(), true, true, true, true);
            }
            var sources = caps.PaperSourceCaps;
            var feed = (caps.FeederCaps ?? caps.DuplexCaps)?.PageSizeCaps?.ScanArea;
            bool hasFlatbed = sources?.SupportsFlatbed ?? caps.FlatbedCaps is not null;
            bool hasFeeder = sources?.SupportsFeeder ?? caps.FeederCaps is not null;
            bool hasDuplex = sources?.SupportsDuplex ?? caps.DuplexCaps is not null;
            double feedW = feed is not null && feed.WidthInInches > 1 ? (double)feed.WidthInInches : 8.5;
            double feedH = feed is not null && feed.HeightInInches > 1 ? (double)Math.Min(feed.HeightInInches, 36) : 14;
            Log.Write($"Scanner sources: {(hasFlatbed ? "glass " : "")}{(hasFeeder ? "feeder " : "")}{(hasDuplex ? "duplex " : "")}{(hasFeeder ? $"(feeder pages up to {feedW:0.##} × {feedH:0.##} in)" : "")}");
            var flatbed = caps.FlatbedCaps ?? caps.FeederCaps;
            var area = caps.FlatbedCaps?.PageSizeCaps?.ScanArea;
            var values = flatbed?.DpiCaps?.Values ?? [];
            var dpis = values.Count > 12 ? CommonDpis.Where(d => d >= values.Min() && d <= values.Max()).ToList()
                : values.Count > 0 ? values.Distinct().OrderBy(d => d).ToList()
                : CommonDpis.Where(d => d <= 1200).ToList();
            var gray = flatbed?.BitDepthCaps?.SupportsGrayscale ?? true;
            Log.Write($"Scanner caps: bed {(area is null ? "not said" : $"{area.WidthInInches:0.##} × {area.HeightInInches:0.##} in")}; resolutions {string.Join(", ", values)}; {caps.MetadataCaps?.Manufacturer} {caps.MetadataCaps?.Model}");
            if (area is not null && area.WidthInInches > 1 && area.HeightInInches > 1)
                return new Caps((double)area.WidthInInches, (double)area.HeightInInches, dpis, gray, false, hasFlatbed, hasFeeder, hasDuplex, feedW, feedH, compat);
            return new Caps((double)PageSize.A4.WidthInInches, (double)PageSize.A4.HeightInInches, dpis, gray, hasFlatbed, hasFlatbed, hasFeeder, hasDuplex, feedW, feedH, compat);
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
        FellBackToCompat = false;
        using var bmp = deviceId == FakeId && fake
            ? await Task.Run(() => FakeBed.Draw(dpi, bedH), cancel)
            : await ScanBed(c => For(deviceId, driver, c), compat, bedW, bedH, dpi, false, owner, cancel, "Previewing the glass (small, only to find the prints; the scan itself is at the resolution chosen)");
        using var ms = new MemoryStream();
        SaveJpeg(bmp, ms, 85);
        Log.Write($"Preview: {bmp.Width} × {bmp.Height} at {dpi} dpi");
        return new Preview(ms.ToArray(), bmp.Width, bmp.Height, bedW, bedH);
    }

    // The flatbed, from its top edge down to `height` inches, as one image
    async Task<Bitmap> ScanBed(Func<bool, ScanOptions> scanner, bool compat, double width, double height, int dpi, bool gray, IntPtr owner, CancellationToken cancel, string what)
    {
        Bitmap? result = null;
        await foreach (var image in Run(c => BedOptions(scanner(c), width, height, dpi, gray, owner, what), compat, cancel))
        {
            using (image)
            {
                if (result is null) result = images.RenderToBitmap(image);
            }
        }
        return result ?? throw new InvalidOperationException("The scanner sent nothing back");
    }

    static ScanOptions BedOptions(ScanOptions options, double width, double height, int dpi, bool gray, IntPtr owner, string what)
    {
        options.UseNativeUI = false;
        options.DialogParent = owner;
        options.PaperSource = PaperSource.Flatbed;
        options.Dpi = dpi;
        options.BitDepth = gray ? NAPS2.Images.BitDepth.Grayscale : NAPS2.Images.BitDepth.Color;
        options.PageSize = new PageSize(Math.Round((decimal)width, 2), Math.Round((decimal)height, 2), PageSizeUnit.Inch);
        options.PageAlign = HorizontalAlign.Left;
        options.MaxQuality = true;
        Log.Write($"{what}: {width:0.##} × {height:0.##} in at {dpi} dpi, {(gray ? "greys" : "colour")}, no scanner window ({options.Driver}, manager {options.TwainOptions.Dsm}, transfer {options.TwainOptions.TransferMode})");
        return options;
    }

    // Preview and crop: one scan of the bed (only as far down as the
    // lowest box), cut into a photo per box
    async IAsyncEnumerable<Page> CroppedPages(Request r, IntPtr owner, [EnumeratorCancellation] CancellationToken cancel)
    {
        var boxes = r.Crops!;
        var bottom = Math.Min(1, boxes.Max(b => Bottom(b, r.BedW, r.BedH) / r.BedH));
        var height = Math.Min(r.BedH, bottom * r.BedH + 0.1); // a little past it: scanners round
        var fakeScan = r.DeviceId == FakeId && fake;
        var dpi = fakeScan ? Math.Min(r.Dpi, 300) : r.Dpi;
        var bmp = fakeScan
            ? await Task.Run(() => FakeBed.Draw(dpi, height), cancel)
            : await ScanBed(c => For(r.DeviceId, r.Driver, c), r.Compat, r.BedW, height, dpi, r.Gray, owner, cancel, "Scanning the glass");
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
                yield return new Page(path =>
                {
                    var part = Cut(src, b, r.BedW * ppiX, r.BedH * ppiY, rect);
                    part.SetResolution((float)ppiX, (float)ppiY);
                    Save(Adjust(part, r), path, r);
                });
            }
        }
        finally
        {
            bmp.Dispose();
        }
    }

    // The lowest point of a box (inches from the top), turned or not
    static double Bottom(Box b, double bedW, double bedH)
    {
        double cx = (b.X + b.W / 2) * bedW, cy = (b.Y + b.H / 2) * bedH, w = b.W * bedW, h = b.H * bedH;
        double a = Math.Abs(b.Angle) * Math.PI / 180;
        return cy + (Math.Abs(Math.Sin(a)) * w + Math.Abs(Math.Cos(a)) * h) / 2;
    }

    // A box's photo from the scan (sw × sh: the bed's size in pixels):
    // straightened if the box is tilted, then turned so its top is up
    static Bitmap Cut(Bitmap src, Box b, double sw, double sh, Rectangle rect)
    {
        Bitmap part;
        if (Math.Abs(b.Angle) < 0.05)
        {
            part = src.Clone(rect, src.PixelFormat);
        }
        else
        {
            double cx = (b.X + b.W / 2) * sw, cy = (b.Y + b.H / 2) * sh;
            int w = Math.Max(8, (int)Math.Round(b.W * sw)), h = Math.Max(8, (int)Math.Round(b.H * sh));
            part = new Bitmap(w, h, PixelFormat.Format24bppRgb);
            using var g = Graphics.FromImage(part);
            g.Clear(Color.White);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            // The box's middle to the photo's middle, unturned
            g.TranslateTransform(w / 2f, h / 2f);
            g.RotateTransform((float)-b.Angle);
            g.TranslateTransform((float)-cx, (float)-cy);
            g.DrawImage(src, new Rectangle(0, 0, src.Width, src.Height));
        }
        var turn = ((b.Turn % 360) + 360) % 360;
        if (turn == 90) part.RotateFlip(RotateFlipType.Rotate90FlipNone);
        else if (turn == 180) part.RotateFlip(RotateFlipType.Rotate180FlipNone);
        else if (turn == 270) part.RotateFlip(RotateFlipType.Rotate270FlipNone);
        return part;
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
