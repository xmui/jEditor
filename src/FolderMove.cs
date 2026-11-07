namespace JEditor;

// Moving what's in a folder (the projects folder, or the cache) to another,
// one item at a time, so nothing is ever lost (app/folder-move.js asks):
//
//   - On the same drive, each item is renamed into place: instant, and
//     Windows does it whole or not at all.
//   - Across drives, each is copied, then every file is read back and
//     compared with its original, byte for byte; only then is the original
//     removed. A copy that fails or doesn't match is removed and its
//     original stays, and the move stops there.
//
// An item whose name is already taken in the new folder is left where it
// is (and said so), never merged into the other. Hidden and system items
// at the top (desktop.ini, Thumbs.db, .something) stay behind too.
static class FolderMove
{
    public sealed record Measure(int Folders, int Files, long Bytes);
    public sealed record Room(long Free, long Total, string Drive, bool SameDrive);
    public sealed record Result(int Moved, List<object> Left, string? Error, bool Stopped);

    static bool Skipped(string path)
    {
        var name = Path.GetFileName(path);
        if (name.StartsWith('.') || name.Equals("desktop.ini", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("Thumbs.db", StringComparison.OrdinalIgnoreCase)) return true;
        try
        {
            var a = File.GetAttributes(path);
            return a.HasFlag(FileAttributes.System) || a.HasFlag(FileAttributes.ReparsePoint);
        }
        catch (Exception) { return true; }
    }

    // What would move: the top-level items, and everything in them
    public static IEnumerable<string> Items(string dir) =>
        Directory.EnumerateFileSystemEntries(dir).Where(p => !Skipped(p)).OrderBy(p => p, StringComparer.OrdinalIgnoreCase);

    public static Measure Size(string dir)
    {
        int folders = 0, files = 0;
        long bytes = 0;
        if (!Directory.Exists(dir)) return new Measure(0, 0, 0);
        foreach (var item in Items(dir))
        {
            if (Directory.Exists(item))
            {
                folders++;
                foreach (var f in Tree(item).Files) { files++; bytes += f.Size; }
            }
            else { files++; bytes += new FileInfo(item).Length; }
        }
        return new Measure(folders, files, bytes);
    }

    // The drive a folder is on (or would be: the nearest folder above it
    // that's there), its free space, and whether `from` is on it too
    public static Room Space(string to, string? from)
    {
        var root = Path.GetPathRoot(Path.GetFullPath(to)) ?? to;
        bool same = from is not null && string.Equals(Path.GetPathRoot(Path.GetFullPath(from)), root, StringComparison.OrdinalIgnoreCase);
        try
        {
            var d = new DriveInfo(root);
            if (d.IsReady) return new Room(d.AvailableFreeSpace, d.TotalSize, root.TrimEnd('\\'), same);
        }
        catch (ArgumentException) { /* a network path: no drive to ask */ }
        return new Room(-1, -1, root.TrimEnd('\\'), same);
    }

    // A folder that can't be moved out of: a whole drive, the user's own
    // folder, or Windows'
    public static string? Refuse(string from, string to)
    {
        from = Path.GetFullPath(from).TrimEnd('\\');
        to = Path.GetFullPath(to).TrimEnd('\\');
        if (from.Equals(to, StringComparison.OrdinalIgnoreCase)) return "It's the same folder";
        if (to.StartsWith(from + "\\", StringComparison.OrdinalIgnoreCase)) return "The new folder is inside the old one";
        if (from.StartsWith(to + "\\", StringComparison.OrdinalIgnoreCase)) return "The old folder is inside the new one";
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).TrimEnd('\\');
        if (Path.GetPathRoot(from + "\\")!.TrimEnd('\\').Equals(from, StringComparison.OrdinalIgnoreCase) ||
            from.Equals(home, StringComparison.OrdinalIgnoreCase) ||
            from.Equals(Environment.GetFolderPath(Environment.SpecialFolder.Windows).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            return "jEditor doesn't move everything on a drive or in your user folder";
        return null;
    }

    sealed record TreeList(List<string> Dirs, List<(string Path, long Size)> Files);

    static TreeList Tree(string dir)
    {
        var dirs = new List<string>();
        var files = new List<(string, long)>();
        void Walk(string d)
        {
            foreach (var sub in Directory.EnumerateDirectories(d))
            {
                if (new DirectoryInfo(sub).Attributes.HasFlag(FileAttributes.ReparsePoint)) continue;
                dirs.Add(sub);
                Walk(sub);
            }
            foreach (var f in Directory.EnumerateFiles(d)) files.Add((f, new FileInfo(f).Length));
        }
        Walk(dir);
        return new TreeList(dirs, files);
    }

    public static Result Run(string from, string to, Action<long, long, int> progress, CancellationToken cancel)
    {
        from = Path.GetFullPath(from).TrimEnd('\\');
        to = Path.GetFullPath(to).TrimEnd('\\');
        var refused = Refuse(from, to);
        if (refused is not null) return new Result(0, [], refused, false);
        if (!Directory.Exists(from)) return new Result(0, [], "The folder isn't there any more", false);
        Directory.CreateDirectory(to);

        var items = Items(from).ToList();
        var room = Space(to, from);
        long total = room.SameDrive ? items.Count : Size(from).Bytes;
        if (!room.SameDrive && room.Free >= 0 && room.Free < total)
            return new Result(0, [], $"Not enough room on {room.Drive}", false);

        int moved = 0;
        long done = 0;
        var left = new List<object>();
        var buffer = new byte[1 << 20];
        var check = new byte[1 << 20];
        var last = Environment.TickCount64;
        void Tell(bool now = false)
        {
            if (!now && Environment.TickCount64 - last < 250) return;
            last = Environment.TickCount64;
            progress(done, total, moved);
        }
        Tell(true);
        foreach (var item in items)
        {
            if (cancel.IsCancellationRequested) return new Result(moved, left, null, true);
            var name = Path.GetFileName(item);
            var target = Path.Combine(to, name);
            if (Directory.Exists(target) || File.Exists(target))
            {
                left.Add(new { name, why = "taken" });
                continue;
            }
            if (room.SameDrive)
            {
                try
                {
                    if (Directory.Exists(item)) Directory.Move(item, target); else File.Move(item, target);
                    moved++;
                    done++;
                    Tell();
                    Log.Write($"Moved {item} to {target}");
                    continue;
                }
                catch (Exception e)
                {
                    // Nothing moved: a rename is whole or nothing
                    Log.Write($"Couldn't move {item}: {e.Message}");
                    return new Result(moved, left, $"{name}: {e.Message}", false);
                }
            }
            try
            {
                bool isDir = Directory.Exists(item);
                var tree = isDir ? Tree(item) : new TreeList([], [(item, new FileInfo(item).Length)]);
                if (isDir)
                {
                    Directory.CreateDirectory(target);
                    foreach (var d in tree.Dirs) Directory.CreateDirectory(Path.Combine(target, Path.GetRelativePath(item, d)));
                }
                foreach (var (path, size) in tree.Files)
                {
                    var copy = isDir ? Path.Combine(target, Path.GetRelativePath(item, path)) : target;
                    using (var src = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16))
                    using (var dst = new FileStream(copy, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16))
                    {
                        int n;
                        while ((n = src.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            cancel.ThrowIfCancellationRequested();
                            dst.Write(buffer, 0, n);
                            done += n;
                            Tell();
                        }
                        dst.Flush(true);
                    }
                    File.SetLastWriteTimeUtc(copy, File.GetLastWriteTimeUtc(path));
                    if (!Same(path, copy, buffer, check)) throw new IOException($"The copy of {Path.GetFileName(path)} doesn't match the original");
                }
            }
            catch (Exception e)
            {
                // The half copy goes; the original was never touched
                try
                {
                    if (Directory.Exists(target)) Directory.Delete(target, true);
                    else if (File.Exists(target)) File.Delete(target);
                }
                catch (Exception) { Log.Write($"Couldn't remove the half copy {target}"); }
                Log.Write($"Couldn't move {item}: {e.Message}");
                return e is OperationCanceledException ? new Result(moved, left, null, true) : new Result(moved, left, $"{name}: {e.Message}", false);
            }
            // Copied and checked: now the original goes
            moved++;
            try
            {
                if (Directory.Exists(item)) Directory.Delete(item, true); else File.Delete(item);
            }
            catch (Exception e)
            {
                left.Add(new { name, why = "copied" });
                Log.Write($"Copied {item}, but couldn't remove it: {e.Message}");
            }
            Log.Write($"Moved {item} to {target}");
            Tell(true);
        }
        progress(total, total, moved);
        return new Result(moved, left, null, false);
    }

    // Read back and compared, byte for byte
    static bool Same(string a, string b, byte[] x, byte[] y)
    {
        using var fa = new FileStream(a, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16);
        using var fb = new FileStream(b, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16);
        if (fa.Length != fb.Length) return false;
        while (true)
        {
            int n = fa.ReadAtLeast(x, x.Length, false);
            int m = fb.ReadAtLeast(y, y.Length, false);
            if (n != m) return false;
            if (n == 0) return true;
            if (!x.AsSpan(0, n).SequenceEqual(y.AsSpan(0, m))) return false;
        }
    }
}
