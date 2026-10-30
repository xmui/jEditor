namespace JEditor;

// What the sidebar's Browse shows: the drives on this PC (USB sticks as
// they're plugged in), the usual folders, and the folders inside any of
// them, with how many photos each folder has directly in it.
static class Places
{
    static readonly HashSet<string> PhotoTypes = new(StringComparer.OrdinalIgnoreCase)
        { ".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".bmp", ".heic", ".heif", ".hif",
          ".dng", ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".sr2", ".srf", ".orf", ".rw2", ".rwl", ".pef", ".srw", ".3fr", ".iiq", ".erf", ".kdc", ".dcr", ".mos", ".mef", ".raf" };

    // Counting stops here: "1,000+ photos" is enough to tell
    const int CountLimit = 1000;

    public sealed record Drive(string Path, string Name, string Kind, string? Label, long Total, long Free);

    public static List<Drive> Drives()
    {
        var list = new List<Drive>();
        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                var kind = d.DriveType switch
                {
                    DriveType.Removable => "usb",
                    DriveType.Fixed => "disk",
                    DriveType.Network => "network",
                    DriveType.CDRom => "cd",
                    _ => null
                };
                if (kind is null || !d.IsReady) continue;
                var letter = d.Name.TrimEnd('\\');
                var label = string.IsNullOrWhiteSpace(d.VolumeLabel) ? null : d.VolumeLabel;
                var name = (label ?? kind switch
                {
                    "usb" => "USB drive",
                    "network" => "Network drive",
                    "cd" => "CD drive",
                    _ => "Local disk"
                }) + $" ({letter})";
                list.Add(new Drive(d.Name, name, kind, label, d.TotalSize, d.AvailableFreeSpace));
            }
            catch (IOException) { /* went away while looking */ }
            catch (UnauthorizedAccessException) { }
        }
        return list;
    }

    // Desktop, Pictures, Documents, Downloads (those that are there)
    public static List<(string Name, string Path)> Home()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var list = new List<(string, string)>
        {
            ("Desktop", Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)),
            ("Pictures", Environment.GetFolderPath(Environment.SpecialFolder.MyPictures)),
            ("Documents", Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)),
            ("Downloads", Path.Combine(home, "Downloads")),
        };
        return list.Where(p => !string.IsNullOrEmpty(p.Item2) && Directory.Exists(p.Item2)).ToList();
    }

    public sealed record Listing(string Path, string Name, string? Parent, List<(string Name, string Path)> Folders, int Photos, bool More);

    // The folders in a folder (not hidden or system ones), and how many
    // photos are directly in it
    public static Listing List(string path)
    {
        var dir = new DirectoryInfo(path);
        if (!dir.Exists) throw new DirectoryNotFoundException("That folder isn't there any more");
        var folders = new List<(string, string)>();
        foreach (var d in dir.EnumerateDirectories())
        {
            try
            {
                if ((d.Attributes & (FileAttributes.Hidden | FileAttributes.System)) != 0) continue;
                if (d.Name.StartsWith('.') || d.Name.StartsWith('$')) continue;
                folders.Add((d.Name, d.FullName));
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        int photos = 0;
        bool more = false;
        try
        {
            foreach (var f in dir.EnumerateFiles())
            {
                if (!PhotoTypes.Contains(f.Extension) || f.Name.StartsWith('.')) continue;
                if (++photos >= CountLimit) { more = true; break; }
            }
        }
        catch (UnauthorizedAccessException) { }
        var name = dir.Parent is null ? dir.FullName : dir.Name;
        return new Listing(dir.FullName, name, dir.Parent?.FullName, folders, photos, more);
    }
}

// The sidebar's other needs: the projects in a folder, photo counts,
// Explorer's pinned folders, ejecting a USB drive, showing a folder in
// Explorer
static class Projects
{
    static readonly HashSet<string> PhotoTypes = new(StringComparer.OrdinalIgnoreCase)
        { ".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".bmp", ".heic", ".heif", ".hif",
          ".dng", ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".sr2", ".srf", ".orf", ".rw2", ".rwl", ".pef", ".srw", ".3fr", ".iiq", ".erf", ".kdc", ".dcr", ".mos", ".mef", ".raf" };

    public sealed record Project(string Name, string Path, DateTime Modified);

    // The folders in `path`, newest first (by when each was last changed)
    public static List<Project> List(string path)
    {
        var dir = new DirectoryInfo(path);
        if (!dir.Exists) throw new DirectoryNotFoundException("The projects folder isn't there");
        var list = new List<Project>();
        foreach (var d in dir.EnumerateDirectories())
        {
            try
            {
                if ((d.Attributes & (FileAttributes.Hidden | FileAttributes.System)) != 0 || d.Name.StartsWith('.') || d.Name.StartsWith('$')) continue;
                list.Add(new Project(d.Name, d.FullName, d.LastWriteTime));
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        return list.OrderByDescending(p => p.Modified).ToList();
    }

    // Photos in a folder and its subfolders, counted up to `Limit`. Kept per
    // folder until it changes, as network shares are slow to walk, and for
    // a minute at most: photos added in a subfolder don't change the top
    // folder's time
    public const int Limit = 1000;
    static readonly Dictionary<string, (DateTime when, int count, DateTime at)> counts = new(StringComparer.OrdinalIgnoreCase);

    public static int Count(string path)
    {
        var dir = new DirectoryInfo(path);
        if (!dir.Exists) return -1;
        var stamp = dir.LastWriteTimeUtc;
        lock (counts)
        {
            if (counts.TryGetValue(path, out var c) && c.when == stamp && DateTime.UtcNow - c.at < TimeSpan.FromMinutes(1)) return c.count;
        }
        int n = 0;
        var options = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.Hidden | FileAttributes.System };
        try
        {
            foreach (var f in dir.EnumerateFiles("*", options))
                if (PhotoTypes.Contains(f.Extension) && ++n >= Limit) break;
        }
        catch (IOException) { }
        lock (counts) counts[path] = (stamp, n, DateTime.UtcNow);
        return n;
    }

    // Explorer's Quick Access folders that are pinned (Shell.Application on
    // an STA thread)
    public static Task<List<(string Name, string Path)>> QuickAccessAsync() => Sta(() =>
    {
        var list = new List<(string, string)>();
        var type = Type.GetTypeFromProgID("Shell.Application");
        if (type is null) return list;
        dynamic shell = Activator.CreateInstance(type)!;
        dynamic? folder = shell.NameSpace("shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}");
        if (folder is null) return list;
        foreach (dynamic item in folder.Items())
        {
            try
            {
                if (!(bool)item.IsFolder) continue;
                string path = item.Path;
                if (string.IsNullOrEmpty(path) || !System.IO.Path.IsPathFullyQualified(path) || !Directory.Exists(path)) continue;
                // Pinned ones only, not Explorer's "frequent" folders
                object? pinned = null;
                try { pinned = item.ExtendedProperty("System.Home.IsPinned"); } catch { }
                if (pinned is bool b && !b) continue;
                list.Add(((string)item.Name, path));
            }
            catch { /* skip it */ }
        }
        return list;
    });

    static Task<T> Sta<T>(Func<T> work)
    {
        var done = new TaskCompletionSource<T>();
        var t = new Thread(() =>
        {
            try { done.SetResult(work()); }
            catch (Exception e) { done.SetException(e); }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.IsBackground = true;
        t.Start();
        return done.Task;
    }

    // A USB drive out safely: Windows' own Eject (Explorer's), else the
    // drive is locked, taken offline and ejected. → null, or why it can't
    public static async Task<string?> EjectAsync(string root)
    {
        var drive = new DriveInfo(root);
        if (drive.DriveType != DriveType.Removable) return "Only USB drives can be ejected";
        var letter = drive.Name.TrimEnd('\\');
        var viaShell = await Sta(() =>
        {
            try
            {
                var type = Type.GetTypeFromProgID("Shell.Application");
                if (type is null) return false;
                dynamic shell = Activator.CreateInstance(type)!;
                dynamic? item = shell.NameSpace(17).ParseName(letter + "\\"); // 17: This PC
                if (item is null) return false;
                item.InvokeVerb("Eject");
                return true;
            }
            catch { return false; }
        });
        // Done once the drive is gone (Explorer's Eject reports nothing back)
        for (int i = 0; i < 30; i++)
        {
            await Task.Delay(200);
            if (!DriveInfo.GetDrives().Any(d => d.Name.Equals(drive.Name, StringComparison.OrdinalIgnoreCase) && d.IsReady)) return null;
        }
        return viaShell ? "Windows couldn't eject it: is a file on it still open?" : "Windows couldn't eject it";
    }

    public static void Reveal(string path) =>
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
}
