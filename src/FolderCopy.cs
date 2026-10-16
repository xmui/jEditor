namespace JEditor;

// A whole folder copied into another (a project onto a USB drive, say),
// under a free name there, with how far it's got as it goes. jEditor's own
// folders inside it stay behind. A copy that fails or is stopped is removed,
// so no half folder is left.
static class FolderCopy
{
    static readonly string[] Skip = [".jeditor", ".jeditor-trash"];

    public static string Run(string from, string destParent, Action<long, long> progress, CancellationToken cancel)
    {
        from = Path.GetFullPath(from).TrimEnd('\\');
        destParent = Path.GetFullPath(destParent).TrimEnd('\\');
        if (!Directory.Exists(from)) throw new DirectoryNotFoundException("The folder isn't there any more");
        if (!Directory.Exists(destParent)) throw new DirectoryNotFoundException("The folder to copy it into isn't there");
        if (destParent.Equals(from, StringComparison.OrdinalIgnoreCase) ||
            destParent.StartsWith(from + "\\", StringComparison.OrdinalIgnoreCase))
            throw new IOException("A folder can't be copied into itself");

        // What there is to copy, and room for it
        var files = new List<(string Path, long Size)>();
        var dirs = new List<string>();
        void Walk(string dir)
        {
            foreach (var d in Directory.EnumerateDirectories(dir))
            {
                if (Skip.Contains(Path.GetFileName(d), StringComparer.OrdinalIgnoreCase)) continue;
                if (new DirectoryInfo(d).Attributes.HasFlag(FileAttributes.ReparsePoint)) continue;
                dirs.Add(d);
                Walk(d);
            }
            foreach (var f in Directory.EnumerateFiles(dir)) files.Add((f, new FileInfo(f).Length));
        }
        Walk(from);
        long total = files.Sum(f => f.Size);
        try
        {
            var drive = new DriveInfo(Path.GetPathRoot(destParent)!);
            if (drive.IsReady && drive.AvailableFreeSpace < total)
                throw new IOException($"Not enough room on {drive.Name.TrimEnd('\\')}: it needs {Size(total)}, and {Size(drive.AvailableFreeSpace)} is free");
        }
        catch (ArgumentException) { /* a network path: no drive to ask */ }

        var to = FreeName(destParent, Path.GetFileName(from));
        long done = 0;
        var last = Environment.TickCount64;
        try
        {
            Directory.CreateDirectory(to);
            foreach (var d in dirs) Directory.CreateDirectory(Path.Combine(to, Path.GetRelativePath(from, d)));
            var buffer = new byte[1 << 20];
            progress(0, total);
            foreach (var (path, _) in files)
            {
                cancel.ThrowIfCancellationRequested();
                var target = Path.Combine(to, Path.GetRelativePath(from, path));
                using (var src = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16))
                using (var dst = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16))
                {
                    int n;
                    while ((n = src.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        cancel.ThrowIfCancellationRequested();
                        dst.Write(buffer, 0, n);
                        done += n;
                        if (Environment.TickCount64 - last > 250) { last = Environment.TickCount64; progress(done, total); }
                    }
                }
                File.SetLastWriteTimeUtc(target, File.GetLastWriteTimeUtc(path));
            }
            progress(total, total);
            return to;
        }
        catch
        {
            try { if (Directory.Exists(to)) Directory.Delete(to, true); } catch (Exception) { /* left for the user */ }
            throw;
        }
    }

    static string FreeName(string dir, string name)
    {
        var path = Path.Combine(dir, name);
        for (int n = 2; Directory.Exists(path) || File.Exists(path); n++) path = Path.Combine(dir, $"{name} ({n})");
        return path;
    }

    static string Size(long n) => n >= 1L << 30 ? $"{n / (double)(1L << 30):0.0} GB" : $"{n / (double)(1L << 20):0} MB";
}
