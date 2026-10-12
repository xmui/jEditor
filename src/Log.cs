namespace JEditor;

// A plain text log, only when asked for with --log
static class Log
{
    static string? file;
    static readonly object gate = new();

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
        if (file is null) return;
        lock (gate)
        {
            try { File.AppendAllText(file, $"{DateTime.Now:HH:mm:ss.fff} {line}{Environment.NewLine}"); }
            catch (IOException) { }
        }
    }
}
