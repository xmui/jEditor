namespace JEditor;

// What the sidebar's Browse shows: the drives on this PC (USB sticks as
// they're plugged in), the usual folders, and the folders inside any of
// them, with how many photos each folder has directly in it.
static class Places
{
    static readonly HashSet<string> PhotoTypes = new(StringComparer.OrdinalIgnoreCase)
        { ".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".bmp", ".heic" };

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
