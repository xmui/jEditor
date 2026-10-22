// jEditor's 32-bit TWAIN helper: one scan from a TWAIN scanner's feeder,
// with no scanner window, using settings NAPS2 can't ask for: above all the
// scanner's own auto-size (it finds each photo's edges itself and sends just
// the photo, as the FastFoto does in its own software).
//
//   jEditor.Twain32.exe --device <name> --dpi 300 [--gray] [--duplex]
//                       [--autosize] [--deskew] [--settings <file>] --out <folder>
//   jEditor.Twain32.exe --device <name> --setup --settings-out <file>
//   jEditor.Twain32.exe --device <name> --caps [--old-dsm]
//
// --setup shows the scanner's own window only to choose its settings (Epson
// Scan 2's color restoration, enhancements and the like, which TWAIN has no
// names for); the driver's whole settings are saved to the file, and
// --settings gives them back to it before a scan.
//
// --caps only asks what the scanner can do, which NAPS2 doesn't: its
// optical resolution (a driver offers more, made up by stretching) and
// whether it crops each photo itself. --old-dsm: Windows' old TWAIN
// manager, for a driver that only opens with it (Older TWAIN mode).
//
// It writes one line per event to stdout:
//   LOG <text>      what the scanner said yes or no to (for Details)
//   PAGE <path>     a scanned side, as a BMP file in --out
//   CAPS <k>=<v> …  --caps: optical=<dpi> dpis=<a,b,…> autosize=yes|no
//   DONE <count>    the scanner has finished
//   ERROR <text>    it couldn't scan (nothing more follows)
// "stop" on stdin ends the scan after the photo in progress.
//
// TWAIN runs on a window's message loop, so this is a WinForms program
// with a window that's never shown.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using NTwain;
using NTwain.Data;

namespace JEditor.Twain32;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        Options o;
        try { o = Options.Parse(args); }
        catch (Exception e)
        {
            Out.Line("ERROR " + e.Message);
            return 2;
        }
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Out.Line("ERROR " + e.Exception.Message);
        var run = new Run(o);
        Application.Run(run);
        return run.Failed ? 1 : 0;
    }
}

sealed class Options
{
    public string Device = "";
    public int Dpi = 300;
    public bool Gray, Duplex, AutoSize, Deskew, Setup, Caps, OldDsm;
    // Epson photo scans: FastFoto's Curled photo correction (unevenness
    // correction) and Reduce lines and streaks (vertical noise reduction)
    public bool Even = true, Streaks = true;
    public string Out = "";
    public string? SettingsIn, SettingsOut;

    public static Options Parse(string[] args)
    {
        var o = new Options();
        for (int i = 0; i < args.Length; i++)
        {
            string Next() => i + 1 < args.Length ? args[++i] : throw new ArgumentException("No value after " + args[i]);
            switch (args[i])
            {
                case "--device": o.Device = Next(); break;
                case "--dpi": o.Dpi = int.Parse(Next()); break;
                case "--gray": o.Gray = true; break;
                case "--duplex": o.Duplex = true; break;
                case "--autosize": o.AutoSize = true; break;
                case "--deskew": o.Deskew = true; break;
                case "--no-even": o.Even = false; break;
                case "--no-streaks": o.Streaks = false; break;
                case "--out": o.Out = Next(); break;
                case "--setup": o.Setup = true; break;
                case "--caps": o.Caps = true; break;
                case "--old-dsm": o.OldDsm = true; break;
                case "--settings": o.SettingsIn = Next(); break;
                case "--settings-out": o.SettingsOut = Next(); break;
                default: throw new ArgumentException("Unknown option " + args[i]);
            }
        }
        if (o.Device.Length == 0) throw new ArgumentException("No --device");
        if (o.Caps) { }
        else if (o.Setup) { if (o.SettingsOut is null) throw new ArgumentException("No --settings-out"); }
        else if (!Directory.Exists(o.Out)) throw new ArgumentException("No folder to write to");
        return o;
    }
}

// Lines to jEditor, one at a time (TWAIN events and the stdin thread both write)
static class Out
{
    static readonly object gate = new();
    // UTF-8, as jEditor reads it (a WinExe's Console.Out is in the code page)
    static readonly StreamWriter stdout = new(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false));
    public static void Line(string s)
    {
        lock (gate)
        {
            stdout.WriteLine(s.Replace("\r", " ").Replace("\n", " "));
            stdout.Flush();
        }
    }
    public static void Log(string s) => Line("LOG " + s);
}

sealed class Run : ApplicationContext
{
    readonly Options o;
    readonly Form window = new() { ShowInTaskbar = false, FormBorderStyle = FormBorderStyle.None, StartPosition = FormStartPosition.Manual, Location = new System.Drawing.Point(-32000, -32000), Size = new System.Drawing.Size(1, 1) };
    TwainSession? session;
    DataSource? source;
    volatile bool stop;
    int pages;
    bool finished;
    bool ownSettings; // settings from its own window were given back to it
    bool fileXfer;    // sides come as files the driver writes, not in memory
    bool epsonPhoto;  // set up as the FastFoto software sets it up
    public bool Failed { get; private set; }

    public Run(Options o)
    {
        this.o = o;
        _ = window.Handle; // the window TWAIN talks through (never shown)
        window.BeginInvoke(new Action(Start));
        // "stop" from jEditor, or jEditor gone (stdin closed)
        var reader = new Thread(() =>
        {
            try
            {
                string? line;
                while ((line = Console.In.ReadLine()) != null)
                    if (line.Trim() == "stop") break;
            }
            catch (Exception) { }
            stop = true;
        }) { IsBackground = true };
        reader.Start();
    }

    void Start()
    {
        try
        {
            PlatformInfo.Current.PreferNewDSM = !o.OldDsm;
            Out.Log($"TWAIN manager: {PlatformInfo.Current.ExpectedDsmPath}");
            var appId = TWIdentity.CreateFromAssembly(DataGroups.Image, Assembly.GetExecutingAssembly());
            session = new TwainSession(appId);
            session.TransferReady += TransferReady;
            session.DataTransferred += DataTransferred;
            // Ended after the callback returns, not inside the driver's call
            session.TransferError += (_, e) => { var why = "The scanner stopped: " + (e.Exception?.Message ?? Status(e.SourceStatus)); window.BeginInvoke(new Action(() => Fail(why))); };
            session.SourceDisabled += (_, _) => window.BeginInvoke(new Action(() => Finish(null)));
            var rc = session.Open(new WindowsFormsMessageLoopHook(window.Handle));
            if (rc != ReturnCode.Success) { Fail("TWAIN wouldn't start: " + rc); return; }
            source = session.FirstOrDefault(s => s.Name == o.Device);
            if (source is null) { Fail("The scanner isn't there: " + o.Device); return; }
            Out.Log($"Scanner: {source.Name} ({source.Manufacturer}, {source.ProductFamily}, driver {source.Version.Info})");
            rc = source.Open();
            if (rc != ReturnCode.Success) { Fail("The scanner's driver wouldn't open: " + Status(session.GetStatus())); return; }
            if (o.Caps)
            {
                ReportCaps(source.Capabilities);
                Finish(null);
                return;
            }
            if (o.Setup)
            {
                // Its window, just for its settings (saved when it closes)
                Out.Log("Showing the scanner's own settings window");
                rc = source.Enable(SourceEnableMode.ShowUIOnly, true, window.Handle);
                if (rc != ReturnCode.Success) Fail("The scanner's settings window didn't open: " + Status(source.GetStatus()));
                return;
            }
            // An Epson Scan 2 feeder that crops photos itself (the FastFoto)
            // is set up exactly as the FastFoto software does it, which never
            // gives it settings from its window
            try
            {
                var supported = source.Capabilities.CapSupportedCaps.GetValues().ToList();
                epsonPhoto = o.AutoSize && supported.Contains(EpsonDeskewType) && supported.Contains(EpsonAutoSizeType);
            }
            catch (Exception) { epsonPhoto = false; }
            if (epsonPhoto && o.SettingsIn is not null && File.Exists(o.SettingsIn))
                Out.Log("Its own settings, as chosen in its window: set aside (Epson photo scan)");
            // Settings chosen in its own window (Scanner's own settings…)
            else if (o.SettingsIn is not null && File.Exists(o.SettingsIn))
            {
                try
                {
                    source.Settings = File.ReadAllBytes(o.SettingsIn);
                    ownSettings = true;
                    Out.Log("Its own settings, as chosen in its window: yes");
                }
                catch (Exception e) { Out.Log("Its own settings, as chosen in its window: no (" + e.Message + ")"); }
            }
            Configure(source);
            rc = source.Enable(SourceEnableMode.NoUI, false, window.Handle);
            if (rc != ReturnCode.Success) { Fail("The scanner wouldn't start: " + Status(source.GetStatus())); return; }
            Out.Log("Scanning…");
        }
        catch (Exception e)
        {
            Fail(e.Message);
        }
    }

    static string Status(TWStatus s) => s.ConditionCode.ToString();

    // --caps: its optical resolution, the resolutions it offers, and
    // whether it can crop each photo itself (each asked on its own: a
    // driver that doesn't answer one still answers the rest)
    static void ReportCaps(ICapabilities caps)
    {
        var said = new List<string>();
        try
        {
            if (caps.ICapXNativeResolution.IsSupported)
            {
                var optical = (int)Math.Round((float)caps.ICapXNativeResolution.GetCurrent());
                if (optical > 0) said.Add("optical=" + optical);
            }
        }
        catch (Exception e) { Out.Log("Optical resolution: couldn't ask (" + e.Message + ")"); }
        try
        {
            var values = caps.ICapXResolution.GetValues().Select(v => (int)Math.Round((float)v)).Where(v => v > 0).Distinct().OrderBy(v => v).ToList();
            if (values.Count > 0) said.Add("dpis=" + string.Join(",", values));
        }
        catch (Exception e) { Out.Log("Resolutions: couldn't ask (" + e.Message + ")"); }
        try
        {
            var supported = caps.CapSupportedCaps.GetValues().ToList();
            bool crops = supported.Contains(CapabilityId.ICapAutoSize) || supported.Contains(CapabilityId.ICapAutomaticBorderDetection) || supported.Contains(EpsonAutoSizeType);
            said.Add("autosize=" + (crops ? "yes" : "no"));
        }
        catch (Exception e) { Out.Log("Auto size: couldn't ask (" + e.Message + ")"); }
        Out.Line("CAPS " + string.Join(" ", said));
    }

    // Each setting on its own: one the driver refuses is logged and skipped
    void Configure(DataSource ds)
    {
        var caps = ds.Capabilities;
        var supported = new List<CapabilityId>();
        try
        {
            supported = caps.CapSupportedCaps.GetValues().ToList();
            Out.Log("Supports: " + string.Join(", ", supported));
            LogCustom(caps);
            LogChoices(caps);
        }
        catch (Exception e) { Out.Log("Supports: (couldn't ask: " + e.Message + ")"); }

        void Set(string what, Func<ReturnCode> set)
        {
            try
            {
                var rc = set();
                Out.Log($"{what}: {(rc == ReturnCode.Success ? "yes" : "no (" + rc + ")")}");
            }
            catch (Exception e) { Out.Log($"{what}: no ({e.Message})"); }
        }

        // An Epson Scan 2 feeder that crops photos itself (the FastFoto):
        // asked exactly as the FastFoto software asks, nothing more
        bool epson = supported.Contains(EpsonDeskewType) && supported.Contains(EpsonAutoSizeType);
        if (epsonPhoto)
        {
            ConfigureEpsonPhoto(ds, caps, Set);
            return;
        }

        // Epson Scan 2 keeps the last settings from its own window (color
        // adjustments among them) for scans with no window: start from its
        // defaults, unless settings chosen in its window are wanted
        if (epson && !ownSettings)
            Set("Epson defaults", () =>
            {
                using var all = new TWCapability(CapabilityId.CapSupportedCaps);
                return ds.DGControl.Capability.ResetAll(all);
            });

        Set("Native transfer", () => caps.ICapXferMech.SetValue(XferMech.Native));
        Set("No progress window", () => caps.CapIndicators.SetValue(BoolType.False));
        Set("Feeder", () => caps.CapFeederEnabled.SetValue(BoolType.True));
        Set(o.Duplex ? "Both sides" : "One side", () => caps.CapDuplexEnabled.SetValue(o.Duplex ? BoolType.True : BoolType.False));
        Set(o.Gray ? "Grayscale" : "Color", () => caps.ICapPixelType.SetValue(o.Gray ? PixelType.Gray : PixelType.RGB));
        Set("Inches", () => caps.ICapUnits.SetValue(Unit.Inches));
        // 8 bits a channel, after the pixel type (which can reset it): a
        // deeper picture would be read as linear light when it's saved
        try { Out.Log($"Driver had: {caps.ICapBitDepth.GetCurrent()} bits, pixel flavor {caps.ICapPixelFlavor.GetCurrent()}, automatic color {caps.ICapAutomaticColorEnabled.GetCurrent()}"); }
        catch (Exception) { /* not all of them answer */ }
        Set("8 bits", () => caps.ICapBitDepth.SetValue(8));
        // The driver's own tone settings, as it had them (Epson Scan 2 keeps
        // its last ones, and a scan with no window uses them), then neutral:
        // jEditor's brightness and contrast are applied after, on its side
        try { Out.Log($"Driver had: brightness {Fix(caps.ICapBrightness.GetCurrent())}, contrast {Fix(caps.ICapContrast.GetCurrent())}, gamma {Fix(caps.ICapGamma.GetCurrent())}"); }
        catch (Exception) { /* not all of them answer */ }
        Set("Brightness 0", () => caps.ICapBrightness.SetValue(0));
        Set("Contrast 0", () => caps.ICapContrast.SetValue(0));
        Set($"{o.Dpi} dpi across", () => caps.ICapXResolution.SetValue(o.Dpi));
        Set($"{o.Dpi} dpi down", () => caps.ICapYResolution.SetValue(o.Dpi));
        if (o.AutoSize)
        {
            // Every way TWAIN has of saying "find the photo's size yourself":
            // drivers support one or another
            Set("Auto size", () => caps.ICapAutoSize.SetValue(AutoSize.Auto));
            Set("Undefined length", () => caps.ICapUndefinedImageSize.SetValue(BoolType.True));
            Set("Border detection", () => caps.ICapAutomaticBorderDetection.SetValue(BoolType.True));
            Set("Length detection", () => caps.ICapAutomaticLengthDetection.SetValue(BoolType.True));
        }
        if (o.Deskew) Set("Straighten", () => caps.ICapAutomaticDeskew.SetValue(BoolType.True));
        LogNow(caps);
    }

    // The FastFoto software's capabilities, in its order, as its own log
    // shows them (%APPDATA%\Epson\FastFoto\Logs\current.log): the driver's
    // defaults, then these and nothing else. Anything more (the feeder,
    // units, bit depth, brightness) is left as the driver has it there too.
    void ConfigureEpsonPhoto(DataSource ds, ICapabilities caps, Action<string, Func<ReturnCode>> Set)
    {
        Set("Epson defaults", () =>
        {
            using var all = new TWCapability(CapabilityId.CapSupportedCaps);
            return ds.DGControl.Capability.ResetAll(all);
        });
        Set("Epson photo straighten", () => SetCustom(ds, EpsonDeskewType, 1));
        Set($"{o.Dpi} dpi across", () => caps.ICapXResolution.SetValue(o.Dpi));
        Set($"{o.Dpi} dpi down", () => caps.ICapYResolution.SetValue(o.Dpi));
        Set(o.Gray ? "Grayscale" : "Color", () => caps.ICapPixelType.SetValue(o.Gray ? PixelType.Gray : PixelType.RGB));
        // Each side written to a TIFF file, handed on as a BMP
        try
        {
            fileXfer = caps.ICapImageFileFormat.SetValue(FileFormat.Tiff) == ReturnCode.Success
                && caps.ICapXferMech.SetValue(XferMech.File) == ReturnCode.Success;
        }
        catch (Exception) { fileXfer = false; }
        Out.Log($"Epson photo file transfer (TIFF): {(fileXfer ? "yes" : "no")}");
        if (!fileXfer) Set("Native transfer", () => caps.ICapXferMech.SetValue(XferMech.Native));
        Set("Epson suppress device errors", () => SetCustom(ds, EpsonSuppressDeviceError, 1, ItemType.Bool));
        Set("No progress window", () => caps.CapIndicators.SetValue(BoolType.False));
        Set("Epson blank page skip off", () => SetCustom(ds, EpsonBlankPageSkip, 0));
        Set(o.Duplex ? "Both sides" : "One side", () => caps.CapDuplexEnabled.SetValue(o.Duplex ? BoolType.True : BoolType.False));
        Set($"Epson streak reduction {(o.Streaks ? "on" : "off")}", () => SetCustom(ds, EpsonVerticalNoiseReduction, (ushort)(o.Streaks ? 1 : 0), ItemType.Bool));
        Set("Epson photo auto size", () => SetCustom(ds, EpsonAutoSizeType, 0)); // 1: a panorama
        Set("Epson double-feed detection off", () => SetCustom(ds, EpsonDoubleFeedDetection, 0)); // as for instant photos
        Set($"Epson unevenness correction {(o.Even ? "on" : "off")}", () => SetCustom(ds, EpsonUnevennessCorrection, (ushort)(o.Even ? 1 : 0), ItemType.Bool));
        Set("Epson photo gamma 1.8", () => caps.ICapGamma.SetValue(1.8f));
        LogNow(caps);
    }

    // What it ended up as
    static void LogNow(ICapabilities caps)
    {
        try { Out.Log($"Now: auto size {caps.ICapAutoSize.GetCurrent()}, border detection {caps.ICapAutomaticBorderDetection.GetCurrent()}, deskew {caps.ICapAutomaticDeskew.GetCurrent()}, {caps.ICapXResolution.GetCurrent().Whole} dpi"); }
        catch (Exception) { /* not all of them answer */ }
        try { Out.Log($"Now: {caps.ICapBitDepth.GetCurrent()} bits, brightness {Fix(caps.ICapBrightness.GetCurrent())}, contrast {Fix(caps.ICapContrast.GetCurrent())}, gamma {Fix(caps.ICapGamma.GetCurrent())}"); }
        catch (Exception) { /* not all of them answer */ }
        try { LogCustom(caps); } catch (Exception) { }
    }

    // Epson Scan 2's own capabilities (names from its es2twain.dll)
    const CapabilityId EpsonDeskewType = (CapabilityId)0x8075;            // CAP_EP_DESKEWTYPE
    const CapabilityId EpsonAutoSizeType = (CapabilityId)0x8081;          // ICAP_EP_AUTOSIZETYPE
    const CapabilityId EpsonSuppressDeviceError = (CapabilityId)0x8057;   // CAP_EP_SUPPRESSDEVICEERROR
    const CapabilityId EpsonBlankPageSkip = (CapabilityId)0x8053;         // ICAP_EP_BLANKPAGESKIP
    const CapabilityId EpsonVerticalNoiseReduction = (CapabilityId)0x8080; // ICAP_EP_VERTICALNOISEREDUCTION
    const CapabilityId EpsonDoubleFeedDetection = (CapabilityId)0x804E;   // ICAP_EP_DOUBLEFEEDDETECTION
    const CapabilityId EpsonUnevennessCorrection = (CapabilityId)0x8083;  // ICAP_EP_UNEVENNESSCORRECTION

    static ReturnCode SetCustom(DataSource ds, CapabilityId id, ushort value, ItemType type = ItemType.UInt16)
    {
        using var cap = new TWCapability(id, new TWOneValue { Item = value, ItemType = type });
        return ds.DGControl.Capability.Set(cap);
    }

    // The driver's own capabilities (no TWAIN names), with their values now:
    // what changes when its settings do
    static void LogCustom(ICapabilities caps)
    {
        var mine = caps.CapSupportedCaps.GetValues().Where(c => (int)c >= 0x8000).ToList();
        if (mine.Count == 0) return;
        Out.Log("Its own: " + string.Join(", ", mine.Select(c =>
        {
            try { return $"{(int)c}={Show(caps.GetCurrent(c))}"; }
            catch (Exception) { return $"{(int)c}=?"; }
        })));
    }

    // What each of the driver's own capabilities can be set to: with the
    // values above, it shows what a choice in its window sends
    static void LogChoices(ICapabilities caps)
    {
        var mine = caps.CapSupportedCaps.GetValues().Where(c => (int)c >= 0x8000).ToList();
        if (mine.Count == 0) return;
        Out.Log("Its own choices: " + string.Join("; ", mine.Select(c =>
        {
            try
            {
                var r = caps.GetValuesRaw(c);
                return r.ContainerType switch
                {
                    ContainerType.Range => $"{(int)c} {Show(r.RangeMinValue)}..{Show(r.RangeMaxValue)} by {Show(r.RangeStepSize)}",
                    ContainerType.OneValue => $"{(int)c} only {Show(r.OneValue)}",
                    _ => $"{(int)c} {string.Join("|", r.EnumerateCapValues().Select(Show))}",
                };
            }
            catch (Exception) { return $"{(int)c} ?"; }
        })));
    }

    static string Show(object? v) => v switch
    {
        null => "-",
        TWFix32 f => Fix(f),
        string s => '"' + s + '"',
        _ => v.ToString() ?? "-",
    };

    static string Fix(TWFix32 v) => ((float)v).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);

    void TransferReady(object? sender, TransferReadyEventArgs e)
    {
        if (stop)
        {
            Out.Log("Stopping after this photo");
            e.CancelAll = true;
            return;
        }
        // A file transfer: the driver writes the side to this TIFF
        if (fileXfer)
        {
            var tif = Path.Combine(o.Out, $"side-{pages + 1:0000}.tif");
            var rc = e.DataSource.DGControl.SetupFileXfer.Set(new TWSetupFileXfer { FileName = tif, Format = FileFormat.Tiff });
            if (rc != ReturnCode.Success) Out.Log("The scanner wouldn't take a file to write: " + rc);
        }
    }

    void DataTransferred(object? sender, DataTransferredEventArgs e)
    {
        try
        {
            if (e.FileDataPath is { } tif)
            {
                // Handed on as a BMP, as a memory transfer is
                var bmp = Path.Combine(o.Out, $"side-{++pages:0000}.bmp");
                using (var img = System.Drawing.Image.FromFile(tif)) img.Save(bmp, System.Drawing.Imaging.ImageFormat.Bmp);
                File.Delete(tif);
                Out.Line("PAGE " + bmp);
                return;
            }
            using var stream = e.GetNativeImageStream();
            if (stream is null) { Out.Log("A side came with no picture"); return; }
            var path = Path.Combine(o.Out, $"side-{++pages:0000}.bmp");
            using (var file = File.Create(path)) stream.CopyTo(file);
            Out.Line("PAGE " + path);
        }
        catch (Exception ex)
        {
            Out.Log("Couldn't save a side: " + ex.Message);
        }
    }

    void Fail(string why)
    {
        Failed = true;
        Finish(why);
    }

    void Finish(string? error)
    {
        if (finished) return;
        finished = true;
        // Settings window closed: the driver's settings, kept for its scans
        if (o.Setup && error is null && source is not null && source.IsOpen)
        {
            try
            {
                var data = source.Settings;
                if (data is null || data.Length == 0) error = "The scanner didn't give its settings";
                else
                {
                    File.WriteAllBytes(o.SettingsOut!, data);
                    Out.Log($"Its settings were saved ({data.Length} bytes)");
                    try { LogCustom(source.Capabilities); } catch (Exception) { }
                }
            }
            catch (Exception e) { error = "The scanner's settings couldn't be read: " + e.Message; }
            if (error is not null) Failed = true;
        }
        try
        {
            if (session is not null)
            {
                if (session.State > 4) session.ForceStepDown(2);
                else
                {
                    if (session.State == 4) source?.Close();
                    if (session.State >= 3) session.Close();
                }
            }
        }
        catch (Exception e) { Out.Log("Closing: " + e.Message); }
        Out.Line(error is null ? "DONE " + pages : "ERROR " + error);
        ExitThread();
    }
}
