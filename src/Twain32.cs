using System.Diagnostics;
using System.Drawing;
using System.Runtime.CompilerServices;

namespace JEditor;

// jEditor's 32-bit TWAIN helper (twain32/, its Program.cs says how it talks):
// a feeder scan with settings NAPS2 can't ask for, above all the scanner's
// own auto-size, so a FastFoto sends each photo already cropped, as it does
// in Epson's software. Each side comes back as it's scanned.
static class Twain32
{
    public sealed class Failed(string message) : Exception(message);

    public static string? Exe
    {
        get
        {
            var path = Path.Combine(AppContext.BaseDirectory, "twain32", "jEditor.Twain32.exe");
            return File.Exists(path) ? path : null;
        }
    }

    // The scanner said yes to auto-size (it crops each photo itself)
    public static bool AutoSized { get; private set; }

    // The settings chosen in a scanner's own window (Scanner's own
    // settings…), kept per scanner and given back to its driver each scan
    public static string SettingsFile(string device) =>
        Path.Combine(Shell.DataDir, "scanners", string.Concat(device.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c)) + ".twain");

    public static bool HasSettings(string device) => File.Exists(SettingsFile(device));

    // The scanner's own window, only to choose its settings; → true when
    // they were saved
    public static async Task<bool> SetupAsync(string device)
    {
        var exe = Exe ?? throw new Failed("the 32-bit helper isn't installed");
        var file = SettingsFile(device);
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var temp = file + ".new";
        var info = new ProcessStartInfo(exe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
        };
        info.ArgumentList.Add("--device"); info.ArgumentList.Add(device);
        info.ArgumentList.Add("--setup");
        info.ArgumentList.Add("--settings-out"); info.ArgumentList.Add(temp);
        Log.Write($"Opening {device}'s own settings window");
        using var proc = Process.Start(info) ?? throw new Failed("the 32-bit helper didn't start");
        try
        {
            while (true)
            {
                var line = await proc.StandardOutput.ReadLineAsync();
                if (line is null) throw new Failed("the 32-bit helper stopped unexpectedly");
                if (line.StartsWith("LOG ")) Log.Write("Scanner: " + line[4..]);
                else if (line.StartsWith("ERROR ")) throw new Failed(line[6..]);
                else if (line.StartsWith("DONE")) break;
            }
            if (!File.Exists(temp)) return false;
            File.Move(temp, file, true);
            Log.Write($"{device}: its own settings saved; jEditor's scans use them from now on");
            return true;
        }
        finally
        {
            try { if (!proc.HasExited && !proc.WaitForExit(3000)) proc.Kill(); } catch (Exception) { }
            try { File.Delete(temp); } catch (Exception) { }
        }
    }

    // What NAPS2 can't ask: the scanner's optical resolution (0: it didn't
    // say), the resolutions its driver offers, and whether it crops each
    // photo itself (null: it didn't say). Old: Windows' old TWAIN manager
    public sealed record Said(int Optical, List<int> Dpis, bool? AutoSize);

    public static async Task<Said?> CapsAsync(string device, bool old, CancellationToken cancel)
    {
        var exe = Exe;
        if (exe is null) return null;
        var info = new ProcessStartInfo(exe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
        };
        info.ArgumentList.Add("--device"); info.ArgumentList.Add(device);
        info.ArgumentList.Add("--caps");
        if (old) info.ArgumentList.Add("--old-dsm");
        using var proc = Process.Start(info) ?? throw new Failed("the 32-bit helper didn't start");
        // A driver that hangs doesn't hold the scan dock up for long
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        limit.CancelAfter(TimeSpan.FromSeconds(30));
        Said? said = null;
        try
        {
            while (true)
            {
                var line = await proc.StandardOutput.ReadLineAsync(limit.Token);
                if (line is null || line.StartsWith("DONE")) break;
                if (line.StartsWith("LOG ")) Log.Write("Scanner: " + line[4..]);
                else if (line.StartsWith("ERROR ")) { Log.Write($"Its optical resolution: couldn't ask ({line[6..]})"); break; }
                else if (line.StartsWith("CAPS"))
                {
                    var kv = line[4..].Split(' ', StringSplitOptions.RemoveEmptyEntries)
                        .Select(p => p.Split('=', 2)).Where(p => p.Length == 2).ToDictionary(p => p[0], p => p[1]);
                    int.TryParse(kv.GetValueOrDefault("optical"), out var optical);
                    var dpis = (kv.GetValueOrDefault("dpis") ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
                        .Select(v => int.TryParse(v, out var n) ? n : 0).Where(n => n > 0).ToList();
                    var auto = kv.GetValueOrDefault("autosize");
                    said = new Said(optical, dpis, auto is null ? null : auto == "yes");
                    Log.Write($"Scanner caps (TWAIN): optical {(optical > 0 ? optical + " dpi" : "not said")}; its driver offers {(dpis.Count > 0 ? $"{dpis.Min()}–{dpis.Max()} dpi" : "not said")}; crops photos itself: {auto ?? "not said"}");
                }
            }
        }
        catch (OperationCanceledException) when (!cancel.IsCancellationRequested)
        {
            Log.Write("Its optical resolution: the scanner didn't answer in time");
        }
        finally
        {
            try { if (!proc.HasExited && !proc.WaitForExit(3000)) proc.Kill(); } catch (Exception) { }
        }
        return said;
    }

    public static void ForgetSettings(string device)
    {
        try { File.Delete(SettingsFile(device)); } catch (Exception) { }
        Log.Write($"{device}: its own settings forgotten; scans use its driver's defaults");
    }

    public static async IAsyncEnumerable<Bitmap> ScanAsync(string device, int dpi, bool gray, bool duplex, bool autoSize, bool even, bool streaks, [EnumeratorCancellation] CancellationToken cancel)
    {
        var exe = Exe ?? throw new Failed("the 32-bit helper isn't installed");
        AutoSized = false;
        var dir = Path.Combine(Path.GetTempPath(), "jEditor-scan-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(dir);
        var info = new ProcessStartInfo(exe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
        };
        info.ArgumentList.Add("--device"); info.ArgumentList.Add(device);
        info.ArgumentList.Add("--dpi"); info.ArgumentList.Add(dpi.ToString());
        info.ArgumentList.Add("--out"); info.ArgumentList.Add(dir);
        if (gray) info.ArgumentList.Add("--gray");
        if (duplex) info.ArgumentList.Add("--duplex");
        if (autoSize) { info.ArgumentList.Add("--autosize"); info.ArgumentList.Add("--deskew"); }
        if (!even) info.ArgumentList.Add("--no-even");
        if (!streaks) info.ArgumentList.Add("--no-streaks");
        if (HasSettings(device)) { info.ArgumentList.Add("--settings"); info.ArgumentList.Add(SettingsFile(device)); }
        Log.Write($"Scanning the feeder through jEditor's 32-bit helper: {dpi} dpi, {(gray ? "grayscale" : "color")}, {(duplex ? "both sides" : "one side")}{(autoSize ? ", the scanner's own auto-size" : "")}");
        var started = Stopwatch.StartNew();
        using var proc = Process.Start(info) ?? throw new Failed("the 32-bit helper didn't start");
        // Stop: the photo going through finishes, then it ends; one stuck is ended
        using var stopping = cancel.Register(() =>
        {
            try { proc.StandardInput.WriteLine("stop"); proc.StandardInput.Flush(); } catch (Exception) { }
            _ = Task.Delay(8000).ContinueWith(_ => { try { if (!proc.HasExited) proc.Kill(); } catch (Exception) { } });
        });
        int count = 0;
        try
        {
            while (true)
            {
                var line = await proc.StandardOutput.ReadLineAsync();
                if (line is null)
                {
                    cancel.ThrowIfCancellationRequested();
                    throw new Failed("the 32-bit helper stopped unexpectedly");
                }
                if (line.StartsWith("LOG "))
                {
                    var text = line[4..];
                    Log.Write("Scanner: " + text);
                    if (text is "Auto size: yes" or "Border detection: yes" or "Epson photo auto size: yes") AutoSized = true;
                }
                else if (line.StartsWith("PAGE "))
                {
                    // Only the file's name is taken: the folder is ours, and the
                    // name is plain ASCII whatever the code page did to the rest
                    var path = Path.Combine(dir, Path.GetFileName(line[5..]));
                    // From memory, so the file can go at once (GDI+ keeps the stream)
                    var bytes = await File.ReadAllBytesAsync(path, CancellationToken.None);
                    var bmp = new Bitmap(new MemoryStream(bytes));
                    try { File.Delete(path); } catch (Exception) { }
                    count++;
                    Log.Write($"Side {count}: {bmp.Width} × {bmp.Height} at {started.Elapsed.TotalSeconds:0.0} s");
                    // What the driver sent, once: for a scan whose colors are off
                    if (count == 1 && bytes.Length >= 54)
                        Log.Write($"Its pictures: {BitConverter.ToUInt16(bytes, 28)}-bit, header {BitConverter.ToUInt32(bytes, 14)} bytes, compression {BitConverter.ToUInt32(bytes, 30)}, read as {bmp.PixelFormat}");
                    yield return bmp;
                }
                else if (line.StartsWith("DONE"))
                {
                    Log.Write($"The feeder is done: {count} side{(count == 1 ? "" : "s")} in {started.Elapsed.TotalSeconds:0.0} s");
                    break;
                }
                else if (line.StartsWith("ERROR "))
                {
                    throw new Failed(line[6..]);
                }
            }
            cancel.ThrowIfCancellationRequested();
        }
        finally
        {
            // Left early (a save failed, say): the helper is asked to stop, so
            // the scanner is closed properly, and waited for without holding
            // up the window; one that doesn't end is ended
            try
            {
                if (!proc.HasExited)
                {
                    try { proc.StandardInput.WriteLine("stop"); proc.StandardInput.Flush(); } catch (Exception) { }
                    await Task.WhenAny(proc.WaitForExitAsync(), Task.Delay(8000));
                    if (!proc.HasExited) proc.Kill();
                }
            }
            catch (Exception) { }
            try { Directory.Delete(dir, true); } catch (Exception) { }
        }
    }
}
