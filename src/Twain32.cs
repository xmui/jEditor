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

    public static async IAsyncEnumerable<Bitmap> ScanAsync(string device, int dpi, bool gray, bool duplex, bool autoSize, [EnumeratorCancellation] CancellationToken cancel)
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
        Log.Write($"Scanning the feeder through jEditor's 32-bit helper: {dpi} dpi, {(gray ? "greys" : "colour")}, {(duplex ? "both sides" : "one side")}{(autoSize ? ", the scanner's own auto-size" : "")}");
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
                    if (text is "Auto size: yes" or "Border detection: yes") AutoSized = true;
                }
                else if (line.StartsWith("PAGE "))
                {
                    var path = line[5..];
                    // From memory, so the file can go at once (GDI+ keeps the stream)
                    var bmp = new Bitmap(new MemoryStream(await File.ReadAllBytesAsync(path, CancellationToken.None)));
                    try { File.Delete(path); } catch (Exception) { }
                    count++;
                    Log.Write($"Side {count}: {bmp.Width} × {bmp.Height} at {started.Elapsed.TotalSeconds:0.0} s");
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
            try { if (!proc.HasExited && !proc.WaitForExit(3000)) proc.Kill(); } catch (Exception) { }
            try { Directory.Delete(dir, true); } catch (Exception) { }
        }
    }
}
