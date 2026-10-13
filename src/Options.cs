namespace JEditor;

// Command line:
//   jEditor.exe [folder]            open that folder (a photo: its folder)
//     --ui <dir>                    run the UI from <dir> in dev mode (also: JEDITOR_UI)
//     --log <file>                  write a log
//     --smoke-test <dir>            open <dir>, rotate a photo, check it saved, exit 0 or 1
//     --user-data <dir>             WebView2 profile (default %LOCALAPPDATA%\jEditor\WebView2)
//     --fake-scanner                adds a test scanner that makes photos (also: the smoke test)
//     --update-failed <log>         an update didn't install (the setup opens jEditor again with this)
sealed class Options
{
    public string? Folder { get; private set; }
    public string? UiDir { get; private set; }
    public bool Dev { get; private set; }
    public string? LogFile { get; private set; }
    public string? SmokeDir { get; private set; }
    public string? UserDataDir { get; private set; }
    public bool FakeScanner { get; private set; }
    public string? UpdateFailedLog { get; private set; }

    // For another window: the same, opening `folder` (or nothing), never
    // a smoke test or an update notice
    public Options ForWindow(string? folder)
    {
        var o = (Options)MemberwiseClone();
        o.Folder = folder;
        o.SmokeDir = null;
        o.UpdateFailedLog = null;
        return o;
    }

    public static Options Parse(string[] args)
    {
        var o = new Options();
        string? ui = null;
        for (int i = 0; i < args.Length; i++)
        {
            string Value() => i + 1 < args.Length ? args[++i] : throw new ArgumentException($"{args[i]} needs a value");
            switch (args[i].ToLowerInvariant())
            {
                case "--ui": ui = Value(); break;
                case "--log": o.LogFile = Path.GetFullPath(Value()); break;
                case "--smoke-test": o.SmokeDir = Path.GetFullPath(Value()); break;
                case "--user-data": o.UserDataDir = Path.GetFullPath(Value()); break;
                case "--fake-scanner": o.FakeScanner = true; break;
                case "--update-failed": o.UpdateFailedLog = Value(); break;
                default:
                    if (args[i].StartsWith("--")) throw new ArgumentException($"Unknown option {args[i]}");
                    o.Folder = FolderOf(args[i]);
                    break;
            }
        }
        if (o.SmokeDir is not null)
        {
            o.Folder = o.SmokeDir;
            o.FakeScanner = true;
        }

        ui ??= Environment.GetEnvironmentVariable("JEDITOR_UI");
        if (string.IsNullOrWhiteSpace(ui)) ui = null;
#if DEV_DEFAULT
        // A Debug build runs the repo's own app folder (not the copy beside
        // the exe), so edits show straight away
        ui ??= FindRepoUi();
#endif
        if (ui is not null)
        {
            o.UiDir = Path.GetFullPath(ui);
            o.Dev = true;
            if (!File.Exists(Path.Combine(o.UiDir, "index.html")))
                throw new ArgumentException($"No index.html in the UI folder {o.UiDir}");
        }
        else
        {
            var shipped = Path.Combine(AppContext.BaseDirectory, "app");
            o.UiDir = File.Exists(Path.Combine(shipped, "index.html")) ? shipped : null;
        }
        return o;
    }

    // A folder, or the folder a photo is in
    static string FolderOf(string arg)
    {
        var full = Path.GetFullPath(arg.Trim('"'));
        if (File.Exists(full)) return Path.GetDirectoryName(full)!;
        return full;
    }

#if DEV_DEFAULT
    // The folder above the exe that has both src\jEditor.csproj and app\
    static string? FindRepoUi()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var ui = Path.Combine(dir.FullName, "app");
            if (File.Exists(Path.Combine(dir.FullName, "src", "jEditor.csproj")) && File.Exists(Path.Combine(ui, "index.html")))
                return ui;
        }
        return null;
    }
#endif
}
