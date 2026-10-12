using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace JEditor;

// The window: jEditor's UI in a WebView2, served from the app folder at
// https://jeditor.example/. That origin must never change: jEditor's
// settings, recent orders and caches are stored under it.
sealed class MainForm : Form
{
    const string HostName = "jeditor.example";
    const string StartUrl = "https://" + HostName + "/index.html";

    readonly Options options;
    readonly Settings settings;
    readonly WebView2 web = new() { Dock = DockStyle.Fill };
    readonly Smoke? smoke;
    CoreWebView2 Core => web.CoreWebView2;

    // Opened once the page says it's ready (command line, smoke test)
    string? pendingFolder;

    bool fullScreen;
    FormWindowState stateBeforeFullScreen;

    FileSystemWatcher? watcher;
    System.Windows.Forms.Timer? reloadTimer;
    bool reloadPage;

    public int ExitCode { get; private set; }

    public MainForm(Options options)
    {
        this.options = options;
        settings = options.SmokeDir is null ? Settings.Load() : new Settings();
        pendingFolder = options.Folder;
        if (options.SmokeDir is not null) smoke = new Smoke(this, options.SmokeDir);

        Text = "jEditor";
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch (Exception) { }
        MinimumSize = new Size(480, 360);
        SetBackground(settings.Dark, null);
        Controls.Add(web);
        RestorePlacement();

        HandleCreated += (_, _) => Shell.SetDarkTitleBar(Handle, settings.Dark);
        Load += async (_, _) => await StartAsync();
        FormClosing += (_, _) => SavePlacement();
    }

    async Task StartAsync()
    {
        try
        {
            var userData = options.UserDataDir
                ?? (smoke is not null ? Path.Combine(Path.GetTempPath(), "jEditor-smoke-" + Guid.NewGuid().ToString("N"))
                : Path.Combine(Shell.DataDir, "WebView2"));
            Log.Write($"Profile: {userData}; UI: {options.UiDir}{(options.Dev ? " (dev mode)" : "")}");
            var env = await CoreWebView2Environment.CreateAsync(null, userData);
            await web.EnsureCoreWebView2Async(env);

            Configure();
            await PrepareCacheAsync();
            if (options.Dev) await Core.AddScriptToExecuteOnDocumentCreatedAsync("window.__jeditorDev = true;");
            await Core.AddScriptToExecuteOnDocumentCreatedAsync(ReadBridge());
            Core.SetVirtualHostNameToFolderMapping(HostName, options.UiDir!, CoreWebView2HostResourceAccessKind.Allow);
            if (options.Dev) WatchUi();
            smoke?.Start();
            Core.Navigate(StartUrl);
        }
        catch (Exception e)
        {
            Log.Write(e.ToString());
            Program.Fail(options, "jEditor couldn't start: " + e.Message);
            Finish(70);
        }
    }

    public void Finish(int code)
    {
        ExitCode = code;
        if (IsHandleCreated) BeginInvoke(Close); else Close();
    }

    // ---- WebView2 settings and events ----

    void Configure()
    {
        var s = Core.Settings;
        // Keys go to jEditor, not the browser: it uses Ctrl+F, Ctrl+Z, Ctrl+A,
        // Ctrl+, and more. Ctrl+wheel resizes grid tiles, so no page zoom.
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPinchZoomEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.AreDevToolsEnabled = options.Dev;
        s.AreHostObjectsAllowed = false;

        Core.WebMessageReceived += OnMessage;
        Core.NavigationStarting += OnNavigationStarting;
        Core.NewWindowRequested += OnNewWindowRequested;
        Core.PermissionRequested += OnPermissionRequested;
        Core.ContextMenuRequested += OnContextMenuRequested;
        Core.ContainsFullScreenElementChanged += (_, _) => SetFullScreen(Core.ContainsFullScreenElement);
        Core.DocumentTitleChanged += (_, _) =>
        {
            if (!string.IsNullOrWhiteSpace(Core.DocumentTitle)) Text = Core.DocumentTitle;
        };
        Core.NavigationCompleted += (_, e) =>
        {
            if (e.IsSuccess) return;
            Log.Write($"Page failed to load: {e.WebErrorStatus}");
            smoke?.Fail($"page failed to load ({e.WebErrorStatus})");
        };
        Core.ProcessFailed += (_, e) =>
        {
            Log.Write($"WebView2 process failed: {e.ProcessFailedKind} {e.Reason}");
            smoke?.Fail($"WebView2 process failed ({e.ProcessFailedKind})");
        };
    }

    static bool IsOurs(string? uri) =>
        Uri.TryCreate(uri, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps &&
        string.Equals(u.Host, HostName, StringComparison.OrdinalIgnoreCase);

    // Links leave the app: web and mail links open in the default browser or
    // mail app, and nothing else replaces jEditor in the window
    void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (IsOurs(e.Uri)) return;
        e.Cancel = true;
        OpenOutside(e.Uri);
    }

    void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (!IsOurs(e.Uri)) OpenOutside(e.Uri);
    }

    static void OpenOutside(string uri)
    {
        if (Uri.TryCreate(uri, UriKind.Absolute, out var u) && u.Scheme is "http" or "https" or "mailto")
            Shell.OpenExternal(u.AbsoluteUri);
        else
            Log.Write($"Blocked navigation to {uri}");
    }

    // Editing folders: allowed without asking. A recent order reopened after
    // a restart, or a folder dragged in, asks for this.
    void OnPermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        if (!IsOurs(e.Uri)) return;
        if (e.PermissionKind is CoreWebView2PermissionKind.FileReadWrite
            or CoreWebView2PermissionKind.ClipboardRead
            or CoreWebView2PermissionKind.MultipleAutomaticDownloads)
        {
            e.State = CoreWebView2PermissionState.Allow;
        }
        Log.Write($"Permission {e.PermissionKind}: {e.State}");
    }

    // jEditor has its own right-click menu. Where it doesn't, only text
    // boxes get one (cut, copy, paste); dev mode keeps the full menu.
    static readonly HashSet<string> TextMenuItems =
        new(StringComparer.OrdinalIgnoreCase) { "undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll" };

    void OnContextMenuRequested(object? sender, CoreWebView2ContextMenuRequestedEventArgs e)
    {
        if (options.Dev) return;
        if (!e.ContextMenuTarget.IsEditable) { e.Handled = true; return; }
        var items = e.MenuItems;
        for (int i = items.Count - 1; i >= 0; i--)
        {
            if (items[i].Kind != CoreWebView2ContextMenuItemKind.Separator && !TextMenuItems.Contains(items[i].Name))
                items.RemoveAt(i);
        }
        // No separators at the ends or next to each other
        for (int i = items.Count - 1; i >= 0; i--)
        {
            bool sep = items[i].Kind == CoreWebView2ContextMenuItemKind.Separator;
            if (sep && (i == 0 || i == items.Count - 1 || items[i - 1].Kind == CoreWebView2ContextMenuItemKind.Separator))
                items.RemoveAt(i);
        }
        if (items.Count == 0) e.Handled = true;
    }

    // ---- Messages from the page (src/bridge.js) ----

    void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsOurs(e.Source)) return;
        JsonNode? msg;
        try { msg = JsonNode.Parse(e.WebMessageAsJson); }
        catch (JsonException) { return; }
        if (msg is null) return;

        switch (Str(msg, "type"))
        {
            case "pickFolder":
                // After this handler returns: the picker is modal
                var id = msg["id"]?.GetValue<long>() ?? 0;
                BeginInvoke(() => PickFolder(id));
                break;
            case "ready":
                Log.Write($"jEditor {Str(msg, "version")} ready");
                if (pendingFolder is string folder)
                {
                    pendingFolder = null;
                    OpenFolder(folder);
                }
                break;
            case "opened":
                Log.Write($"Opened {Str(msg, "name")}: {msg["count"]} photos");
                break;
            case "theme":
                SetBackground(msg["dark"]?.GetValue<bool>() ?? true, Str(msg, "background"));
                break;
            case "dev" when options.Dev:
                if (Str(msg, "action") == "reload") Core.Reload();
                else if (Str(msg, "action") == "devtools") Core.OpenDevToolsWindow();
                break;
            case "smoke":
                smoke?.Report(msg);
                break;
            case "dataDir":
            case "pathOf":
            case "recycle":
            case "restore":
            case "openPath":
            case "exists":
            case "checkUpdate":
            case "installUpdate":
            case "smokeCheck":
                var files = FilesOf(e);
                BeginInvoke(async () => await HandleRequestAsync(msg, files));
                break;
            case "log":
                Log.Write($"page {Str(msg, "level")}: {Str(msg, "text")}");
                break;
        }
    }

    // Files the page sent along (chrome.webview.postMessageWithAdditionalObjects):
    // the paths on disk behind them
    static List<string?> FilesOf(CoreWebView2WebMessageReceivedEventArgs e)
    {
        var paths = new List<string?>();
        try
        {
            foreach (var o in e.AdditionalObjects) paths.Add((o as CoreWebView2File)?.Path);
        }
        catch (Exception x)
        {
            Log.Write("Couldn't read the files sent: " + x.Message);
        }
        return paths;
    }

    // ---- Requests from the page, answered with { replyTo: id, ... } ----

    // Photos sent to the Recycle Bin this session: what Ctrl+Z can put back
    readonly Dictionary<string, (string bin, string original)> recycled = new();

    async Task HandleRequestAsync(JsonNode msg, List<string?> files)
    {
        var id = msg["id"]?.GetValue<long>() ?? 0;
        try
        {
            switch (Str(msg, "type"))
            {
                case "dataDir":
                {
                    Directory.CreateDirectory(Shell.OrdersDir);
                    var handle = FolderHandle(Shell.OrdersDir);
                    Reply(id, handle is null ? new { error = "no storage" } : new { path = Shell.OrdersDir }, handle);
                    break;
                }
                case "pathOf":
                    Reply(id, new { path = files.FirstOrDefault() });
                    break;
                case "recycle":
                {
                    var paths = files.Select(p => p ?? "").ToList();
                    var results = await RecycleBin.RecycleAsync(paths.Where(p => p != "").ToList(), Handle);
                    var byPath = results.ToDictionary(r => r.Path, StringComparer.OrdinalIgnoreCase);
                    int sent = 0;
                    var answer = paths.Select(p =>
                    {
                        if (p == "" || !byPath.TryGetValue(p, out var r)) return (object)new { error = "no path for this file" };
                        if (r.NoBin) return new { noBin = true };
                        if (r.BinPath is null) return new { error = r.Error ?? "not deleted" };
                        var token = Guid.NewGuid().ToString("N");
                        recycled[token] = (r.BinPath, r.Path);
                        sent++;
                        return new { token };
                    }).ToList();
                    Log.Write($"Recycled {sent} of {paths.Count}");
                    Reply(id, new { results = answer });
                    break;
                }
                case "restore":
                {
                    var tokens = (msg["tokens"] as JsonArray ?? []).Select(t => (string?)t ?? "").ToList();
                    var answer = tokens.Select(t =>
                    {
                        if (!recycled.TryGetValue(t, out var r)) return (object)new { error = "not deleted in this session" };
                        var error = RecycleBin.Restore(r.bin, r.original);
                        if (error is not null) return new { error };
                        recycled.Remove(t);
                        return new { ok = true };
                    }).ToList();
                    Reply(id, new { results = answer });
                    break;
                }
                case "openPath":
                {
                    var path = Str(msg, "path");
                    if (path is not null && Directory.Exists(path)) OpenFolder(path);
                    Reply(id, new { ok = path is not null && Directory.Exists(path) });
                    break;
                }
                case "exists":
                {
                    var paths = (msg["paths"] as JsonArray ?? []).Select(p => (string?)p ?? "").ToList();
                    Reply(id, new { exists = paths.Select(p => p != "" && Directory.Exists(p)).ToList() });
                    break;
                }
                case "checkUpdate":
                {
                    var latest = await Updater.LatestAsync();
                    pendingUpdate = latest;
                    Reply(id, new
                    {
                        current = Updater.CurrentTag,
                        tag = latest.Tag,
                        version = latest.Version,
                        notes = latest.Notes,
                        size = latest.Size,
                        newer = Updater.IsNewer(latest.Tag, Updater.CurrentTag)
                    });
                    break;
                }
                case "smokeCheck":
                {
                    var (ok, detail) = smoke?.Check(Str(msg, "step") ?? "", Str(msg, "name")) ?? (false, "not a smoke test");
                    Reply(id, new { ok, detail });
                    break;
                }
                case "installUpdate":
                {
                    var release = pendingUpdate ?? await Updater.LatestAsync();
                    if (!Updater.IsNewer(release.Tag, Updater.CurrentTag)) { Reply(id, new { error = "This is already the newest version" }); break; }
                    var setup = await Updater.DownloadAsync(release, (got, total) =>
                        BeginInvoke(() => Post(new { type = "updateProgress", received = got, total })));
                    Reply(id, new { ok = true });
                    Updater.Install(setup);
                    Finish(0);
                    break;
                }
            }
        }
        catch (Exception e)
        {
            Log.Write($"{Str(msg, "type")} failed: {e}");
            Reply(id, new { error = e.Message });
        }
    }

    Updater.Release? pendingUpdate;

    void Reply(long id, object payload, CoreWebView2FileSystemHandle? handle = null)
    {
        var node = JsonSerializer.SerializeToNode(payload)!.AsObject();
        node["replyTo"] = id;
        Post(node, handle);
    }

    static string? Str(JsonNode msg, string key) =>
        msg[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    void Post(object message, CoreWebView2FileSystemHandle? handle = null)
    {
        // Folder handles only ever go to jEditor's own page
        if (!IsOurs(Core.Source))
        {
            Log.Write($"Not posting to {Core.Source}");
            return;
        }
        var json = JsonSerializer.Serialize(message);
        if (handle is null) Core.PostWebMessageAsJson(json);
        else Core.PostWebMessageAsJson(json, new List<object> { handle });
    }

    // A folder handle the page can read and write, with permission already
    // granted: no "Let site edit files?" prompt
    CoreWebView2FileSystemHandle? FolderHandle(string path)
    {
        try
        {
            return Core.Environment.CreateWebFileSystemDirectoryHandle(path, CoreWebView2FileSystemHandlePermission.ReadWrite);
        }
        catch (Exception e)
        {
            Log.Write($"No handle for {path}: {e}");
            Program.Fail(options, $"jEditor couldn't open {path}.\n\n{e.Message}");
            smoke?.Fail("couldn't create a folder handle: " + e.Message);
            return null;
        }
    }

    // Windows' folder picker, opening where the last folder was picked so
    // the next order is a click away
    void PickFolder(long id)
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "Open a folder",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = true,
        };
        if (settings.LastFolder is string last)
        {
            var parent = Path.GetDirectoryName(last);
            dialog.InitialDirectory = Directory.Exists(parent) ? parent : Directory.Exists(last) ? last : "";
        }
        if (dialog.ShowDialog(this) != DialogResult.OK || string.IsNullOrEmpty(dialog.SelectedPath))
        {
            Post(new { replyTo = id, cancelled = true });
            return;
        }
        var path = dialog.SelectedPath;
        var handle = FolderHandle(path);
        if (handle is null)
        {
            Post(new { replyTo = id, cancelled = true });
            return;
        }
        settings.LastFolder = path;
        Log.Write($"Picked {path}");
        Post(new { replyTo = id, path }, handle);
    }

    void OpenFolder(string path)
    {
        if (!Directory.Exists(path))
        {
            Program.Fail(options, $"jEditor couldn't find the folder {path}");
            smoke?.Fail("folder not found: " + path);
            return;
        }
        var handle = FolderHandle(path);
        if (handle is null) return;
        Log.Write($"Opening {path}");
        Post(new { type = "openFolder", path, smoke = smoke is not null }, handle);
    }

    // ---- Theme, full screen, window placement ----

    void SetBackground(bool dark, string? cssColor)
    {
        var color = ParseCssColor(cssColor) ?? (dark ? Color.FromArgb(0x0b, 0x0b, 0x0b) : Color.FromArgb(0xe8, 0xe8, 0xe8));
        BackColor = color;
        web.DefaultBackgroundColor = color;
        if (settings.Dark != dark && IsHandleCreated) Shell.SetDarkTitleBar(Handle, dark);
        settings.Dark = dark;
    }

    static Color? ParseCssColor(string? css)
    {
        if (css is null) return null;
        var m = Regex.Match(css, @"rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)");
        if (!m.Success) return null;
        int C(int g) => Math.Clamp(int.Parse(m.Groups[g].Value), 0, 255);
        return Color.FromArgb(C(1), C(2), C(3));
    }

    // The page's Fullscreen button and slideshow fill the screen
    void SetFullScreen(bool on)
    {
        if (on == fullScreen) return;
        fullScreen = on;
        if (on)
        {
            stateBeforeFullScreen = WindowState;
            FormBorderStyle = FormBorderStyle.None;
            if (WindowState == FormWindowState.Maximized) WindowState = FormWindowState.Normal;
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = stateBeforeFullScreen == FormWindowState.Maximized ? FormWindowState.Maximized : FormWindowState.Normal;
        }
    }

    void RestorePlacement()
    {
        StartPosition = FormStartPosition.Manual;
        var saved = new Rectangle(settings.X, settings.Y, settings.Width, settings.Height);
        bool visible = Screen.AllScreens.Any(s =>
        {
            var overlap = Rectangle.Intersect(s.WorkingArea, saved);
            return overlap.Width >= 200 && overlap.Height >= 100;
        });
        if (saved.Width >= MinimumSize.Width && saved.Height >= MinimumSize.Height && visible)
        {
            Bounds = saved;
        }
        else
        {
            var area = Screen.PrimaryScreen!.WorkingArea;
            int w = Math.Min(1440, area.Width * 9 / 10), h = Math.Min(920, area.Height * 9 / 10);
            Bounds = new Rectangle(area.X + (area.Width - w) / 2, area.Y + (area.Height - h) / 2, w, h);
        }
        if (settings.Maximized) WindowState = FormWindowState.Maximized;
    }

    void SavePlacement()
    {
        watcher?.Dispose();
        if (smoke is not null) return;
        var normal = WindowState == FormWindowState.Normal && !fullScreen ? Bounds : RestoreBounds;
        settings.X = normal.X;
        settings.Y = normal.Y;
        settings.Width = normal.Width;
        settings.Height = normal.Height;
        settings.Maximized = fullScreen ? stateBeforeFullScreen == FormWindowState.Maximized : WindowState == FormWindowState.Maximized;
        settings.Save();
    }

    // ---- The UI files ----

    static string ReadBridge()
    {
        using var stream = typeof(MainForm).Assembly.GetManifestResourceStream("bridge.js")
            ?? throw new InvalidOperationException("bridge.js is missing from the build");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    // A changed UI must never be served from WebView2's cache: in dev mode
    // the cache is off; otherwise it's cleared whenever the UI files change
    // (an update, or files replaced by hand). Only caches: jEditor's
    // settings, recents and stored data stay.
    async Task PrepareCacheAsync()
    {
        if (options.Dev)
        {
            await Core.CallDevToolsProtocolMethodAsync("Network.enable", "{}");
            await Core.CallDevToolsProtocolMethodAsync("Network.setCacheDisabled", "{\"cacheDisabled\":true}");
            return;
        }
        var stamp = UiStamp(options.UiDir!);
        if (settings.UiStamp == stamp) return;
        Log.Write($"UI changed ({settings.UiStamp ?? "first run"} → {stamp}): clearing caches");
        await Core.Profile.ClearBrowsingDataAsync(
            CoreWebView2BrowsingDataKinds.DiskCache | CoreWebView2BrowsingDataKinds.CacheStorage | CoreWebView2BrowsingDataKinds.ServiceWorkers);
        settings.UiStamp = stamp;
    }

    static string UiStamp(string dir)
    {
        long newest = 0, bytes = 0;
        int count = 0;
        foreach (var f in new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories))
        {
            newest = Math.Max(newest, f.LastWriteTimeUtc.Ticks);
            bytes += f.Length;
            count++;
        }
        return $"{count}-{bytes}-{newest}";
    }

    // Dev mode: a saved stylesheet swaps in place (the open folder stays);
    // any other change reloads the page
    void WatchUi()
    {
        reloadTimer = new System.Windows.Forms.Timer { Interval = 200 };
        reloadTimer.Tick += (_, _) =>
        {
            reloadTimer.Stop();
            if (reloadPage) Core.Reload();
            else Post(new { type = "reloadCss" });
            reloadPage = false;
        };
        watcher = new FileSystemWatcher(options.UiDir!)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.Size,
        };
        void Changed(string path)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try { BeginInvoke(() => UiChanged(path)); } catch (InvalidOperationException) { }
        }
        watcher.Changed += (_, e) => Changed(e.FullPath);
        watcher.Created += (_, e) => Changed(e.FullPath);
        watcher.Deleted += (_, e) => Changed(e.FullPath);
        watcher.Renamed += (_, e) => Changed(e.FullPath);
        watcher.EnableRaisingEvents = true;
    }

    void UiChanged(string path)
    {
        if (!path.EndsWith(".css", StringComparison.OrdinalIgnoreCase)) reloadPage = true;
        reloadTimer!.Stop();
        reloadTimer.Start();
    }
}
