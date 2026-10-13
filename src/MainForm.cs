using System.Diagnostics;
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

    // Scanning (Scanner.cs): made when first used; one scan at a time
    Scanner? scanner;
    CancellationTokenSource? scanning;
    Scanner Scanners => scanner ??= new Scanner(options.FakeScanner);

    // Tethered shooting (Camera/Tether.cs): one camera at a time
    Camera.Tether? tether;

    FileSystemWatcher? watcher;
    System.Windows.Forms.Timer? reloadTimer;
    bool reloadPage;

    public int ExitCode { get; private set; }

    public MainForm(Options options)
    {
        this.options = options;
        AppWindows.Added(this);
        FormClosed += (_, _) => AppWindows.Closed(this);
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
        FormClosing += (_, _) =>
        {
            SavePlacement();
            scanning?.Cancel();
            tether?.Stop();
        };
        FormClosed += (_, _) => scanner?.Dispose();
        Log.Line += LogLine;
        FormClosed += (_, _) => Log.Line -= LogLine;
    }

    // The scan dock's Details: new log lines, sent on in small batches while
    // it shows ({ type: 'logLines', lines })
    bool followLog;
    readonly System.Collections.Concurrent.ConcurrentQueue<string> logLines = new();
    int logSending; // 1 while a batch is on its way

    void LogLine(string line)
    {
        if (!followLog) return;
        logLines.Enqueue(line);
        if (Interlocked.Exchange(ref logSending, 1) == 1) return;
        _ = Task.Delay(150).ContinueWith(_ =>
        {
            try
            {
                if (!IsDisposed && IsHandleCreated) { BeginInvoke(SendLogLines); return; }
            }
            catch (InvalidOperationException) { }
            logSending = 0;
        });
    }

    void SendLogLines()
    {
        Interlocked.Exchange(ref logSending, 0);
        var lines = new List<string>();
        while (logLines.TryDequeue(out var line)) lines.Add(line);
        // (Not to another page: Post would log that, and round it goes)
        if (lines.Count > 0 && followLog && web.CoreWebView2 is not null && IsOurs(Core.Source))
            Post(new { type = "logLines", lines });
    }

    async Task StartAsync()
    {
        try
        {
            var userData = options.UserDataDir
                ?? (smoke is not null ? Path.Combine(Path.GetTempPath(), "jEditor-smoke-" + Guid.NewGuid().ToString("N"))
                : Path.Combine(Shell.DataDir, "WebView2"));
            Log.Write($"Profile: {userData}; UI: {options.UiDir}{(options.Dev ? " (dev mode)" : "")}");
            var env = await AppWindows.Environment(userData);
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

    // ---- Drives plugged in or taken out (USB orders) ----
    // Windows tells every window; the page is told once things settle

    const int WM_DEVICECHANGE = 0x0219, DBT_DEVICEARRIVAL = 0x8000, DBT_DEVICEREMOVECOMPLETE = 0x8004;
    System.Windows.Forms.Timer? drivesTimer;

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_DEVICECHANGE && (m.WParam == DBT_DEVICEARRIVAL || m.WParam == DBT_DEVICEREMOVECOMPLETE))
        {
            if (drivesTimer is null)
            {
                drivesTimer = new System.Windows.Forms.Timer { Interval = 700 };
                drivesTimer.Tick += (_, _) =>
                {
                    drivesTimer.Stop();
                    if (web.CoreWebView2 is not null) Post(new { type = "drivesChanged" });
                };
            }
            drivesTimer.Stop();
            drivesTimer.Start();
        }
        base.WndProc(ref m);
    }

    // jEditor closes: every window (the smoke test, an update)
    public void Finish(int code)
    {
        ExitCode = code;
        AppWindows.CloseAll(code);
    }

    // ---- For AppWindows ----

    public void CloseNow()
    {
        if (IsHandleCreated) BeginInvoke(Close); else Close();
    }

    public void StartAt(Rectangle bounds)
    {
        StartPosition = FormStartPosition.Manual;
        WindowState = FormWindowState.Normal;
        Bounds = bounds;
    }

    public Options WindowOptions(string? folder) => options.ForWindow(folder);

    public void LeaveFullScreen()
    {
        if (fullScreen && web.CoreWebView2 is not null) _ = Core.ExecuteScriptAsync("document.fullscreenElement && document.exitFullscreen()");
        if (fullScreen) SetFullScreen(false);
    }

    public void PostIfReady(object message)
    {
        if (!IsDisposed && web.CoreWebView2 is not null) Post(message);
    }

    // What the page says it shows (its project and folders), for the other
    // windows' Move to
    public JsonNode? PageState { get; private set; }
    static int nextId = 1;
    public int Id { get; } = nextId++;

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
                if (options.UpdateFailedLog is string setupLog)
                {
                    Log.Write($"The update didn't install; its log: {setupLog}");
                    Post(new
                    {
                        type = "notice",
                        title = "The update didn't install",
                        text = $"jEditor is still on {Application.ProductVersion}; nothing was changed. Try again from Settings → Updates, or download the setup from the Releases page and run it with jEditor closed. What happened is in {setupLog}"
                    });
                }
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
            case "pathsOf":
            case "recycle":
            case "restore":
            case "openPath":
            case "exists":
            case "checkUpdate":
            case "installUpdate":
            case "smokeCheck":
            case "scanners":
            case "scan":
            case "scanCaps":
            case "scanPreview":
            case "cameras":
            case "tether":
            case "places":
            case "listDir":
            case "listProjects":
            case "countPhotos":
            case "quickAccess":
            case "eject":
            case "reveal":
            case "pickPath":
            case "showLog":
            case "logTail":
            case "newWindow":
            case "split":
            case "windows":
            case "transfer":
            case "undoTransfer":
                var files = FilesOf(e);
                BeginInvoke(async () => await HandleRequestAsync(msg, files));
                break;
            case "state":
                PageState = msg;
                break;
            case "cancelScan":
                scanning?.Cancel();
                break;
            case "tetherShoot":
                tether?.Shoot();
                break;
            case "tetherLive":
                tether?.Live(msg["on"]?.GetValue<bool>() ?? false);
                break;
            case "tetherAck":
                tether?.FrameShown();
                break;
            case "tetherStop":
                tether?.Stop();
                break;
            case "tetherSet":
                if (tether is not null)
                {
                    if (msg["keepOnCard"] is JsonValue keep) tether.SetKeepOnCard(keep.GetValue<bool>());
                    if (TetherTarget(msg) is { } target) tether.SetTarget(target);
                }
                break;
            case "logWatch":
                followLog = msg["on"]?.GetValue<bool>() ?? false;
                if (!followLog) logLines.Clear();
                break;
            case "log":
                Log.Write($"page {Str(msg, "level")}: {Str(msg, "text")}");
                break;
        }
    }

    // Files the page sent along (chrome.webview.postMessageWithAdditionalObjects,
    // only for Files dropped from Explorer): the paths on disk behind them
    static List<string?> FilesOf(CoreWebView2WebMessageReceivedEventArgs e)
    {
        var paths = new List<string?>();
        try
        {
            if (e.AdditionalObjects is null) return paths;
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
                case "pathsOf":
                    Reply(id, new { paths = files });
                    break;
                case "recycle":
                {
                    // Photos in the order folders the page has, by path
                    var paths = (msg["paths"] as JsonArray ?? []).Select(p => (string?)p ?? "").ToList();
                    var ok = paths.Where(p => Path.IsPathFullyQualified(p) && File.Exists(p)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                    var results = await RecycleBin.RecycleAsync(ok, Handle);
                    var byPath = results.ToDictionary(r => r.Path, StringComparer.OrdinalIgnoreCase);
                    int sent = 0;
                    var answer = paths.Select(p =>
                    {
                        if (!byPath.TryGetValue(p, out var r)) return (object)new { gone = true };
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
                case "places":
                {
                    var drives = await Task.Run(Places.Drives);
                    Reply(id, new
                    {
                        drives = drives.Select(d => new { path = d.Path, name = d.Name, kind = d.Kind, label = d.Label, total = d.Total, free = d.Free }),
                        home = Places.Home().Select(h => new { name = h.Name, path = h.Path })
                    });
                    break;
                }
                case "listDir":
                {
                    var path = Str(msg, "path") ?? "";
                    if (!Path.IsPathFullyQualified(path)) { Reply(id, new { error = "Not a folder" }); break; }
                    var l = await Task.Run(() => Places.List(path));
                    Reply(id, new
                    {
                        path = l.Path,
                        name = l.Name,
                        parent = l.Parent,
                        folders = l.Folders.Select(f => new { name = f.Name, path = f.Path }),
                        photos = l.Photos,
                        more = l.More
                    });
                    break;
                }
                case "listProjects":
                {
                    var path = Str(msg, "path") ?? "";
                    if (!Path.IsPathFullyQualified(path)) { Reply(id, new { error = "Not a folder" }); break; }
                    var list = await Task.Run(() => Projects.List(path));
                    Reply(id, new { projects = list.Select(p => new { name = p.Name, path = p.Path, modified = new DateTimeOffset(p.Modified).ToUnixTimeMilliseconds() }) });
                    break;
                }
                case "countPhotos":
                {
                    var paths = (msg["paths"] as JsonArray ?? []).Select(p => (string?)p ?? "").ToList();
                    var counts = await Task.Run(() => paths.AsParallel().AsOrdered().WithDegreeOfParallelism(4)
                        .Select(p => Path.IsPathFullyQualified(p) ? Projects.Count(p) : -1).ToList());
                    Reply(id, new { counts, limit = Projects.Limit });
                    break;
                }
                case "quickAccess":
                {
                    List<(string Name, string Path)> pins;
                    try { pins = await Projects.QuickAccessAsync(); }
                    catch (Exception e) { Log.Write("Quick Access: " + e.Message); pins = []; }
                    Reply(id, new { folders = pins.Select(p => new { name = p.Name, path = p.Path }) });
                    break;
                }
                case "eject":
                {
                    var path = Str(msg, "path") ?? "";
                    var why = Path.IsPathFullyQualified(path) ? await Projects.EjectAsync(path) : "Not a drive";
                    Log.Write($"Eject {path}: {why ?? "done"}");
                    Reply(id, why is null ? new { ok = true } : new { ok = false, error = why });
                    break;
                }
                case "reveal":
                {
                    var path = Str(msg, "path") ?? "";
                    var ok = Path.IsPathFullyQualified(path) && Directory.Exists(path);
                    if (ok) Projects.Reveal(path);
                    Reply(id, new { ok });
                    break;
                }
                case "newWindow":
                {
                    var path = Str(msg, "path");
                    if (path is not null && !(Path.IsPathFullyQualified(path) && Directory.Exists(path))) { Reply(id, new { error = "That folder isn't there" }); break; }
                    AppWindows.Open(options.ForWindow(path), this);
                    Reply(id, new { ok = true });
                    break;
                }
                case "split":
                    AppWindows.Split(this);
                    Reply(id, new { ok = true });
                    break;
                case "windows":
                {
                    var others = AppWindows.All.Where(f => f != this && f.PageState is not null && Str(f.PageState, "path") is not null)
                        .Select(f => new { id = f.Id, name = Str(f.PageState!, "name"), path = Str(f.PageState!, "path"), folders = f.PageState!["folders"]?.DeepClone() })
                        .ToList();
                    Reply(id, new { windows = others });
                    break;
                }
                case "transfer":
                {
                    var paths = (msg["paths"] as JsonArray ?? []).Select(p => (string?)p ?? "").Where(Path.IsPathFullyQualified).ToList();
                    var dest = Str(msg, "dest") ?? "";
                    if (!Path.IsPathFullyQualified(dest)) { Reply(id, new { error = "Not a folder" }); break; }
                    var copy = msg["copy"]?.GetValue<bool>() ?? false;
                    var items = await Task.Run(() => Transfer.Run(paths, dest, copy));
                    Log.Write($"{(copy ? "Copied" : "Moved")} {items.Count(i => i.To is not null)} of {items.Count} into {dest}");
                    Reply(id, new { items = items.Select(i => new { from = i.From, to = i.To, error = i.Error }) });
                    AppWindows.PostAll(new { type = "filesChanged" });
                    break;
                }
                case "undoTransfer":
                {
                    var pairs = (msg["items"] as JsonArray ?? []).Select(i => ((string?)i?["from"] ?? "", (string?)i?["to"] ?? ""))
                        .Where(p => Path.IsPathFullyQualified(p.Item1) && Path.IsPathFullyQualified(p.Item2)).ToList();
                    var errors = await Transfer.UndoAsync(pairs, msg["copy"]?.GetValue<bool>() ?? false, Handle);
                    Reply(id, new { errors });
                    AppWindows.PostAll(new { type = "filesChanged" });
                    break;
                }
                case "showLog":
                {
                    var log = Log.Default();
                    var ok = File.Exists(log);
                    if (ok) Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{log}\"") { UseShellExecute = true });
                    Reply(id, new { ok });
                    break;
                }
                case "logTail":
                    Reply(id, new { lines = Log.Recent(), file = Log.Default() });
                    break;
                case "pickPath":
                {
                    using var dialog = new FolderBrowserDialog
                    {
                        Description = Str(msg, "title") ?? "Choose a folder",
                        UseDescriptionForTitle = true,
                        ShowNewFolderButton = true,
                    };
                    var start = Str(msg, "start");
                    if (start is not null && Directory.Exists(start)) dialog.InitialDirectory = start;
                    Reply(id, dialog.ShowDialog(this) == DialogResult.OK && !string.IsNullOrEmpty(dialog.SelectedPath)
                        ? new { path = dialog.SelectedPath } : new { cancelled = true });
                    break;
                }
                case "scanners":
                {
                    var (devices, problems) = await Scanners.ListAsync();
                    Reply(id, new { devices = devices.Select(d => new { id = d.Id, name = d.Name, driver = d.Driver }), problems });
                    break;
                }
                case "scan":
                    await ScanAsync(id, msg);
                    break;
                case "scanCaps":
                    await ScanCapsAsync(id, msg);
                    break;
                case "cameras":
                {
                    var found = await Camera.Tether.FindAsync(options.FakeCamera);
                    Reply(id, new { cameras = found.Select(c => new { id = c.Id, name = c.Name, ready = c.Ready, note = c.Note }) });
                    break;
                }
                case "tether":
                    await TetherAsync(id, msg);
                    break;
                case "scanPreview":
                    await ScanPreviewAsync(id, msg);
                    break;
                case "smokeCheck":
                {
                    var (ok, detail) = smoke?.Check(Str(msg, "step") ?? "", msg) ?? (false, "not a smoke test");
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

    // A scan into the order: { device, driver, folder, prefix, next, digits }.
    // Each photo saved is posted ({ type: 'scanned', scan: id, name }) as it
    // lands; the reply says how many, once the scanner is done. Preview and
    // crop adds { crops: [{ x, y, w, h }], dpi, gray, bedW, bedH }: no
    // scanner window, a photo per box
    async Task ScanAsync(long id, JsonNode msg)
    {
        if (scanning is not null) { Reply(id, new { error = "A scan is already running" }); return; }
        var folder = Str(msg, "folder") ?? "";
        if (!Path.IsPathFullyQualified(folder) || !Directory.Exists(folder)) { Reply(id, new { error = "The folder to scan into isn't there" }); return; }
        var request = new Scanner.Request(
            Str(msg, "device") ?? "",
            Str(msg, "driver") ?? "twain",
            folder,
            CleanPrefix(Str(msg, "prefix")),
            msg["next"]?.GetValue<int>() ?? 1,
            msg["digits"]?.GetValue<int>() ?? 3,
            msg["compat"]?.GetValue<bool>() ?? false)
        {
            Source = Str(msg, "source") is "glass" or "feeder" ? Str(msg, "source")! : "driver",
            Crops = Boxes(msg["crops"]),
            Dpi = Math.Clamp(msg["dpi"]?.GetValue<int>() ?? 300, 50, 4800),
            Gray = msg["gray"]?.GetValue<bool>() ?? false,
            BedW = msg["bedW"]?.GetValue<double>() ?? 0,
            BedH = msg["bedH"]?.GetValue<double>() ?? 0,
            Sides = Str(msg, "sides") is "back" or "both" ? Str(msg, "sides")! : "front",
            Swap = msg["swap"]?.GetValue<bool>() ?? false,
            Brightness = Math.Clamp(msg["brightness"]?.GetValue<int>() ?? 0, -100, 100),
            Contrast = Math.Clamp(msg["contrast"]?.GetValue<int>() ?? 0, -100, 100),
            Format = Str(msg, "format") is "tiff" or "png" ? Str(msg, "format")! : "jpeg",
            Quality = Math.Clamp(msg["quality"]?.GetValue<int>() ?? 95, 40, 100),
        };
        if (request.Crops is not null && (request.BedW <= 0 || request.BedH <= 0)) { Reply(id, new { error = "Preview first: the boxes need the bed's size" }); return; }
        int count = 0;
        var names = new List<string>();
        try
        {
            Log.Write($"Scanning from {request.DeviceId} ({request.Driver}) into {folder}" +
                (request.Crops is null ? "" : $": preview and crop, {request.Crops.Length} box{(request.Crops.Length == 1 ? "" : "es")} at {request.Dpi} dpi"));
            // Sent before the reply, in order: the page stops listening once
            // the reply comes, so the last photo's message mustn't trail it
            count = await Stoppable(cancel => Scanners.ScanAsync(request, Handle, name =>
            {
                count++;
                names.Add(name);
                if (InvokeRequired) Invoke(() => Post(new { type = "scanned", scan = id, name }));
                else Post(new { type = "scanned", scan = id, name });
            }, cancel));
            Reply(id, new { count, names, compat = scanner?.FellBackToCompat ?? false });
        }
        catch (OperationCanceledException)
        {
            Reply(id, new { count, names, cancelled = true, compat = scanner?.FellBackToCompat ?? false });
        }
        catch (Exception e)
        {
            Log.Write($"Scan failed: {e}");
            Reply(id, new { count, names, error = ScanError(e), compat = scanner?.FellBackToCompat ?? false });
        }
    }

    static Scanner.Box[]? Boxes(JsonNode? node)
    {
        if (node is not JsonArray list || list.Count == 0) return null;
        var boxes = new List<Scanner.Box>();
        foreach (var b in list)
        {
            if (b is null) continue;
            double V(string k) => Math.Clamp(b[k]?.GetValue<double>() ?? 0, 0, 1);
            var angle = Math.Clamp(b["angle"]?.GetValue<double>() ?? 0, -45, 45);
            var turn = (((b["turn"]?.GetValue<int>() ?? 0) / 90 * 90) % 360 + 360) % 360;
            var box = new Scanner.Box(V("x"), V("y"), V("w"), V("h"), angle, turn);
            if (box.W > 0.005 && box.H > 0.005) boxes.Add(box);
        }
        return boxes.Count > 0 ? boxes.ToArray() : null;
    }

    // Preview and crop, first: what the flatbed can do ({ device, driver,
    // compat } → { bedW, bedH, dpis, gray, guessed })
    async Task ScanCapsAsync(long id, JsonNode msg)
    {
        if (scanning is not null) { Reply(id, new { error = "The scanner is busy with a scan" }); return; }
        try
        {
            var caps = await Stoppable(cancel => Scanners.CapsAsync(Str(msg, "device") ?? "", Str(msg, "driver") ?? "twain", msg["compat"]?.GetValue<bool>() ?? false, cancel));
            Reply(id, new { bedW = caps.BedW, bedH = caps.BedH, dpis = caps.Dpis, gray = caps.Gray, guessed = caps.Guessed, flatbed = caps.Flatbed, feeder = caps.Feeder, duplex = caps.Duplex, feedW = caps.FeedW, feedH = caps.FeedH, compat = caps.Compat });
        }
        catch (OperationCanceledException) { Reply(id, new { cancelled = true }); }
        catch (Exception e)
        {
            Log.Write($"Scanner caps failed: {e}");
            Reply(id, new { error = ScanError(e) });
        }
    }

    // Then the whole bed, small ({ device, driver, compat, bedW, bedH, dpi }
    // → { image: data URL, width, height, bedW, bedH })
    async Task ScanPreviewAsync(long id, JsonNode msg)
    {
        if (scanning is not null) { Reply(id, new { error = "The scanner is busy with a scan" }); return; }
        try
        {
            var bedW = msg["bedW"]?.GetValue<double>() ?? 0;
            var bedH = msg["bedH"]?.GetValue<double>() ?? 0;
            if (bedW <= 0 || bedH <= 0) { Reply(id, new { error = "The scanner's bed size isn't known" }); return; }
            var dpi = Math.Clamp(msg["dpi"]?.GetValue<int>() ?? 75, 50, 300);
            Log.Write($"Preview from {Str(msg, "device")} ({Str(msg, "driver")})");
            var p = await Stoppable(cancel => Scanners.PreviewAsync(Str(msg, "device") ?? "", Str(msg, "driver") ?? "twain", msg["compat"]?.GetValue<bool>() ?? false, bedW, bedH, dpi, Handle, cancel));
            Reply(id, new { image = "data:image/jpeg;base64," + Convert.ToBase64String(p.Jpeg), width = p.Width, height = p.Height, bedW = p.BedW, bedH = p.BedH, compat = scanner?.FellBackToCompat ?? false });
        }
        catch (OperationCanceledException) { Reply(id, new { cancelled = true }); }
        catch (Exception e)
        {
            Log.Write($"Preview failed: {e}");
            Reply(id, new { error = ScanError(e) });
        }
    }

    // Runs scanner work that Stop (cancelScan) can end. A driver stuck on its
    // own doesn't hear Stop, so 5 s after it the work is given up on, and the
    // scanning helper with it (a fresh one next time)
    async Task<T> Stoppable<T>(Func<CancellationToken, Task<T>> work)
    {
        using var cancel = scanning = new CancellationTokenSource();
        try
        {
            var task = work(cancel.Token);
            var stopped = new TaskCompletionSource();
            using (cancel.Token.Register(() => stopped.TrySetResult()))
            {
                var giveUp = stopped.Task.ContinueWith(_ => Task.Delay(5000)).Unwrap();
                if (await Task.WhenAny(task, giveUp) != task)
                {
                    Log.Write("The scanner didn't stop when asked: giving up on it, and on the scanning helper");
                    var stuck = scanner;
                    scanner = null;
                    _ = task.ContinueWith(_ => stuck?.Dispose());
                    try { stuck?.Dispose(); } catch (Exception e) { Log.Write("Closing the scanning helper: " + e.Message); }
                    throw new OperationCanceledException();
                }
            }
            return await task;
        }
        finally
        {
            scanning = null;
        }
    }

    // Tethered shooting: { camera, name, folder, prefix, next, digits,
    // keepOnCard, live }. What happens is posted ({ type: 'tether', session:
    // id, kind, … }: connected, frame, saved, status); the reply comes when
    // it ends: { count, names, error? }
    async Task TetherAsync(long id, JsonNode msg)
    {
        if (tether is not null) { Reply(id, new { error = "A camera is already connected in this window" }); return; }
        if (TetherTarget(msg) is not { } target) { Reply(id, new { error = "The folder to save into isn't there" }); return; }
        var cameraId = Str(msg, "camera") ?? "";
        Camera.ICamera camera = cameraId == Camera.Tether.FakeId && options.FakeCamera
            ? new Camera.FakeCamera()
            : new Camera.SonyCamera(cameraId, Str(msg, "name") ?? "the camera");
        var session = tether = new Camera.Tether(camera, target, msg["keepOnCard"]?.GetValue<bool>() ?? true, msg["live"]?.GetValue<bool>() ?? true, e =>
        {
            var node = JsonSerializer.SerializeToNode(e)!.AsObject();
            node["type"] = "tether";
            node["session"] = id;
            try
            {
                // In order, before the reply (as scanned photos are)
                if (!IsDisposed && IsHandleCreated) Invoke(() => PostIfReady(node));
            }
            catch (InvalidOperationException) { } // (closing)
        });
        try
        {
            Log.Write($"Tethering {cameraId} into {target.Folder}");
            session.Start();
            var why = await session.Done;
            if (IsDisposed || web.CoreWebView2 is null) return; // the window closed
            Reply(id, why is null ? new { count = session.Saved.Count, names = session.Saved } : (object)new { count = session.Saved.Count, names = session.Saved, error = why });
        }
        finally
        {
            tether = null;
            session.Dispose();
        }
    }

    static Camera.Tether.Target? TetherTarget(JsonNode msg)
    {
        var folder = Str(msg, "folder");
        if (folder is null || !Path.IsPathFullyQualified(folder) || !Directory.Exists(folder)) return null;
        return new Camera.Tether.Target(folder, CleanPrefix(Str(msg, "prefix")), msg["next"]?.GetValue<int>() ?? 1, msg["digits"]?.GetValue<int>() ?? 3);
    }

    // Only characters a file name can have
    static string CleanPrefix(string? prefix)
    {
        var bad = Path.GetInvalidFileNameChars();
        return new string((prefix ?? "").Where(c => !bad.Contains(c)).ToArray()).TrimStart();
    }

    static string ScanError(Exception e) => e switch
    {
        NAPS2.Scan.Exceptions.DeviceNotFoundException => "The scanner isn't connected or is turned off",
        NAPS2.Scan.Exceptions.DeviceBusyException => "The scanner is busy (is another program using it?)",
        NAPS2.Scan.Exceptions.AlreadyHandledDriverException => "The scanner's driver stopped with an error. Check the scanner is on and that no other program (its own scan utility, say) is using it. If it keeps happening, use the scanner's own window (Advanced).",
        NAPS2.Scan.Exceptions.DeviceException d => d.Message,
        DllNotFoundException => "TWAIN isn't set up on this PC (no TWAINDSM.dll)",
        _ => e.Message
    };

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
