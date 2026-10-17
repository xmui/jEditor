namespace JEditor;

// jEditor's log: a plain text file (%LOCALAPPDATA%\jEditor\logs), and the
// last lines kept in memory for the scan dock's Details, which also hears
// each new line as it's written (Line, on any thread)
static class Log
{
    static string? file;
    static readonly object gate = new();
    static readonly Queue<string> recent = new();
    const int RecentLines = 400;

    public static event Action<string>? Line;

    const long Keep = 2 << 20; // past 2 MB, the log starts again (the last one is kept as .old)

    public static string Default() => Path.Combine(Shell.DataDir, "logs", "jEditor.log");

    public static void Init(string? path)
    {
        try
        {
            if (path is not null && File.Exists(path) && new FileInfo(path).Length > Keep)
                File.Move(path, Path.ChangeExtension(path, ".old.log"), overwrite: true);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        file = path;
        if (file is not null) Directory.CreateDirectory(Path.GetDirectoryName(file)!);
    }

    public static void Write(string line)
    {
        var stamped = $"{DateTime.Now:HH:mm:ss.fff} {line}";
        lock (gate)
        {
            recent.Enqueue(stamped);
            while (recent.Count > RecentLines) recent.Dequeue();
            if (file is not null)
            {
                try { File.AppendAllText(file, stamped + Environment.NewLine); }
                catch (IOException) { }
            }
        }
        try { Line?.Invoke(stamped); }
        catch (Exception) { /* a listener's problem isn't the log's */ }
    }

    // The last lines written, oldest first
    public static List<string> Recent()
    {
        lock (gate) return recent.ToList();
    }
}
