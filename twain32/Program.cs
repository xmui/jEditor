// jEditor's 32-bit TWAIN helper: one scan from a TWAIN scanner's feeder,
// with no scanner window, using settings NAPS2 can't ask for: above all the
// scanner's own auto-size (it finds each photo's edges itself and sends just
// the photo, as the FastFoto does in its own software).
//
//   jEditor.Twain32.exe --device <name> --dpi 300 [--gray] [--duplex]
//                       [--autosize] [--deskew] [--settings <file>] --out <folder>
//   jEditor.Twain32.exe --device <name> --setup --settings-out <file>
//
// --setup shows the scanner's own window only to choose its settings (Epson
// Scan 2's color restoration, enhancements and the like, which TWAIN has no
// names for); the driver's whole settings are saved to the file, and
// --settings gives them back to it before a scan.
//
// It writes one line per event to stdout:
//   LOG <text>      what the scanner said yes or no to (for Details)
//   PAGE <path>     a scanned side, as a BMP file in --out
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
    public bool Gray, Duplex, AutoSize, Deskew, Setup;
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
                case "--out": o.Out = Next(); break;
                case "--setup": o.Setup = true; break;
                case "--settings": o.SettingsIn = Next(); break;
                case "--settings-out": o.SettingsOut = Next(); break;
                default: throw new ArgumentException("Unknown option " + args[i]);
            }
        }
        if (o.Device.Length == 0) throw new ArgumentException("No --device");
        if (o.Setup) { if (o.SettingsOut is null) throw new ArgumentException("No --settings-out"); }
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
            PlatformInfo.Current.PreferNewDSM = true;
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
            if (o.Setup)
            {
                // Its window, just for its settings (saved when it closes)
                Out.Log("Showing the scanner's own settings window");
                rc = source.Enable(SourceEnableMode.ShowUIOnly, true, window.Handle);
                if (rc != ReturnCode.Success) Fail("The scanner's settings window didn't open: " + Status(source.GetStatus()));
                return;
            }
            // Settings chosen in its own window (Scanner's own settings…)
            if (o.SettingsIn is not null && File.Exists(o.SettingsIn))
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

        // Epson Scan 2 keeps the last settings from its own window (color
        // adjustments among them) for scans with no window, so the FastFoto
        // software starts each scan from its defaults, then asks for its
        // photo straightening straight away. Its photo crop is the driver's
        // defaults plus these, so a photo scan starts there even when
        // settings from its window were given; other scans keep those.
        bool epson = supported.Contains(EpsonDeskewType) && supported.Contains(EpsonAutoSizeType);
        bool epsonPhoto = epson && o.AutoSize;
        if (epson && (!ownSettings || epsonPhoto))
        {
            Set(ownSettings ? "Epson defaults (its window's settings set aside)" : "Epson defaults", () =>
            {
                using var all = new TWCapability(CapabilityId.CapSupportedCaps);
                return ds.DGControl.Capability.ResetAll(all);
            });
            if (epsonPhoto) Set("Epson photo straighten", () => SetCustom(ds, EpsonDeskewType, 1));
        }

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
        // Its photo tone: the gamma the FastFoto software asks for, in place
        // of the driver's 2.2 (settings from its own window keep 2.2 too)
        if (epson) Set("Epson photo gamma 1.8", () => caps.ICapGamma.SetValue(1.8f));
        // TWAIN's standard auto-size stays as the driver's defaults have it,
        // as in the FastFoto software (with it turned off, the FF-680W read
        // its straightening back as 0); 0 is a photo, 1 a panorama
        if (epsonPhoto) Set("Epson photo auto size", () => SetCustom(ds, EpsonAutoSizeType, 0));
        else if (o.AutoSize)
        {
            // Every way TWAIN has of saying "find the photo's size yourself":
            // drivers support one or another
            Set("Auto size", () => caps.ICapAutoSize.SetValue(AutoSize.Auto));
            Set("Undefined length", () => caps.ICapUndefinedImageSize.SetValue(BoolType.True));
            Set("Border detection", () => caps.ICapAutomaticBorderDetection.SetValue(BoolType.True));
            Set("Length detection", () => caps.ICapAutomaticLengthDetection.SetValue(BoolType.True));
        }
        if (o.Deskew && !epsonPhoto) Set("Straighten", () => caps.ICapAutomaticDeskew.SetValue(BoolType.True));
        // What it ended up as
        try { Out.Log($"Now: auto size {caps.ICapAutoSize.GetCurrent()}, border detection {caps.ICapAutomaticBorderDetection.GetCurrent()}, deskew {caps.ICapAutomaticDeskew.GetCurrent()}, {caps.ICapXResolution.GetCurrent().Whole} dpi"); }
        catch (Exception) { /* not all of them answer */ }
        try { Out.Log($"Now: {caps.ICapBitDepth.GetCurrent()} bits, brightness {Fix(caps.ICapBrightness.GetCurrent())}, contrast {Fix(caps.ICapContrast.GetCurrent())}, gamma {Fix(caps.ICapGamma.GetCurrent())}"); }
        catch (Exception) { /* not all of them answer */ }
        // Epson's own, as they ended up (32885 straighten, 32897 auto size)
        if (epson) try { LogCustom(caps); } catch (Exception) { }
    }

    // Epson Scan 2's own capabilities for its photo crop (CAP_EP_DESKEWTYPE
    // and ICAP_EP_AUTOSIZETYPE), both one 16-bit value
    const CapabilityId EpsonDeskewType = (CapabilityId)0x8075;
    const CapabilityId EpsonAutoSizeType = (CapabilityId)0x8081;

    static ReturnCode SetCustom(DataSource ds, CapabilityId id, ushort value)
    {
        using var cap = new TWCapability(id, new TWOneValue { Item = value, ItemType = ItemType.UInt16 });
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
        }
    }

    void DataTransferred(object? sender, DataTransferredEventArgs e)
    {
        try
        {
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
