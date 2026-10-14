// jEditor's 32-bit TWAIN helper: one scan from a TWAIN scanner's feeder,
// with no scanner window, using settings NAPS2 can't ask for: above all the
// scanner's own auto-size (it finds each photo's edges itself and sends just
// the photo, as the FastFoto does in its own software).
//
//   jEditor.Twain32.exe --device <name> --dpi 300 [--gray] [--duplex]
//                       [--autosize] [--deskew] --out <folder>
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
    public bool Gray, Duplex, AutoSize, Deskew;
    public string Out = "";

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
                default: throw new ArgumentException("Unknown option " + args[i]);
            }
        }
        if (o.Device.Length == 0) throw new ArgumentException("No --device");
        if (!Directory.Exists(o.Out)) throw new ArgumentException("No folder to write to");
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
            session.TransferError += (_, e) => Fail("The scanner stopped: " + (e.Exception?.Message ?? Status(e.SourceStatus)));
            session.SourceDisabled += (_, _) => window.BeginInvoke(new Action(() => Finish(null)));
            var rc = session.Open(new WindowsFormsMessageLoopHook(window.Handle));
            if (rc != ReturnCode.Success) { Fail("TWAIN wouldn't start: " + rc); return; }
            source = session.FirstOrDefault(s => s.Name == o.Device);
            if (source is null) { Fail("The scanner isn't there: " + o.Device); return; }
            Out.Log($"Scanner: {source.Name} ({source.Manufacturer}, {source.ProductFamily}, driver {source.Version.Info})");
            rc = source.Open();
            if (rc != ReturnCode.Success) { Fail("The scanner's driver wouldn't open: " + Status(session.GetStatus())); return; }
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
        try
        {
            var supported = caps.CapSupportedCaps.GetValues().ToList();
            Out.Log("Supports: " + string.Join(", ", supported));
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

        Set("Native transfer", () => caps.ICapXferMech.SetValue(XferMech.Native));
        Set("No progress window", () => caps.CapIndicators.SetValue(BoolType.False));
        Set("Feeder", () => caps.CapFeederEnabled.SetValue(BoolType.True));
        Set(o.Duplex ? "Both sides" : "One side", () => caps.CapDuplexEnabled.SetValue(o.Duplex ? BoolType.True : BoolType.False));
        Set(o.Gray ? "Greys" : "Colour", () => caps.ICapPixelType.SetValue(o.Gray ? PixelType.Gray : PixelType.RGB));
        Set("Inches", () => caps.ICapUnits.SetValue(Unit.Inches));
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
        // What it ended up as
        try { Out.Log($"Now: auto size {caps.ICapAutoSize.GetCurrent()}, border detection {caps.ICapAutomaticBorderDetection.GetCurrent()}, deskew {caps.ICapAutomaticDeskew.GetCurrent()}, {caps.ICapXResolution.GetCurrent().Whole} dpi"); }
        catch (Exception) { /* not all of them answer */ }
    }

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
