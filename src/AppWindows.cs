using Microsoft.Web.WebView2.Core;

namespace JEditor;

// jEditor's windows. Each shows one project; New window opens another, and
// Split puts two side by side. They share one WebView2 environment (one
// browser, one profile), and jEditor runs until the last one closes.
static class AppWindows
{
    public static readonly List<MainForm> All = [];
    public static int ExitCode;
    static Task<CoreWebView2Environment>? environment;
    static ApplicationContext? context;

    public static Task<CoreWebView2Environment> Environment(string userData) =>
        environment ??= CoreWebView2Environment.CreateAsync(null, userData);

    // The first window, and the message loop that ends with the last one
    public static void Run(MainForm first)
    {
        context = new ApplicationContext();
        first.Show();
        Application.Run(context);
    }

    public static void Added(MainForm form) => All.Add(form);

    public static void Closed(MainForm form)
    {
        All.Remove(form);
        if (All.Count == 0) context?.ExitThread();
    }

    // Another window, a little below and right of `from`
    public static MainForm Open(Options options, MainForm? from)
    {
        var form = new MainForm(options);
        if (from is not null)
        {
            var b = from.WindowState == FormWindowState.Normal ? from.Bounds : from.RestoreBounds;
            form.StartAt(new Rectangle(b.X + 40, b.Y + 40, b.Width, b.Height));
        }
        form.Show();
        form.Activate();
        return form;
    }

    // `form` on the left half of its screen, another window on the right
    // (a new one if it's the only one)
    public static void Split(MainForm form)
    {
        var other = All.FirstOrDefault(f => f != form && f.Visible && !f.IsDisposed)
            ?? Open(form.WindowOptions(null), form);
        var area = Screen.FromControl(form).WorkingArea;
        int half = area.Width / 2;
        foreach (var (f, x, w) in new[] { (form, area.X, half), (other, area.X + half, area.Width - half) })
        {
            f.LeaveFullScreen();
            f.WindowState = FormWindowState.Normal;
            f.Bounds = new Rectangle(x, area.Y, w, area.Height);
        }
        other.Activate();
        form.Activate();
    }

    public static void CloseAll(int code)
    {
        ExitCode = code;
        foreach (var f in All.ToList()) f.CloseNow();
    }

    public static void PostAll(object message)
    {
        foreach (var f in All.ToList()) f.PostIfReady(message);
    }
}

// Photos moved or copied between projects (between windows), by path. Each
// gets a free name in the folder it goes to. → what went where
static class Transfer
{
    public sealed record Item(string From, string? To, string? Error);

    public static List<Item> Run(IEnumerable<string> paths, string dest, bool copy)
    {
        var done = new List<Item>();
        if (!Directory.Exists(dest)) throw new DirectoryNotFoundException("The folder to put them in isn't there");
        foreach (var from in paths)
        {
            try
            {
                if (!File.Exists(from)) { done.Add(new Item(from, null, "not there any more")); continue; }
                if (string.Equals(Path.GetDirectoryName(from), dest.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                {
                    done.Add(new Item(from, null, "already in that folder"));
                    continue;
                }
                var to = FreeName(dest, Path.GetFileName(from));
                if (copy) File.Copy(from, to);
                else File.Move(from, to);
                done.Add(new Item(from, to, null));
            }
            catch (Exception e)
            {
                done.Add(new Item(from, null, e.Message));
            }
        }
        return done;
    }

    // Undo: the moved ones go back; the copies go to the Recycle Bin (or are
    // deleted where there's no bin: they're copies)
    public static async Task<List<string?>> UndoAsync(List<(string From, string To)> items, bool copy, IntPtr owner)
    {
        if (copy)
        {
            var results = await RecycleBin.RecycleAsync(items.Select(i => i.To).ToList(), owner);
            return results.Select(r =>
            {
                if (r.BinPath is not null) return null;
                if (r.NoBin)
                {
                    try { File.Delete(r.Path); return null; } catch (Exception e) { return e.Message; }
                }
                return r.Error ?? "not removed";
            }).ToList();
        }
        return items.Select(i =>
        {
            try
            {
                if (File.Exists(i.From)) return "another file with that name is in its place";
                File.Move(i.To, i.From);
                return (string?)null;
            }
            catch (Exception e) { return e.Message; }
        }).ToList();
    }

    static string FreeName(string dir, string name)
    {
        var path = Path.Combine(dir, name);
        var stem = Path.GetFileNameWithoutExtension(name);
        var ext = Path.GetExtension(name);
        for (int n = 2; File.Exists(path); n++) path = Path.Combine(dir, $"{stem} ({n}){ext}");
        return path;
    }
}
