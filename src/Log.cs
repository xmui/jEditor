namespace JEditor;

// A plain text log, only when asked for with --log
static class Log
{
    static string? file;
    static readonly object gate = new();

    public static void Init(string? path)
    {
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
