using System.Diagnostics;

namespace JEditor;

// Settings → Projects → Troubleshooting (app/reset.js, the `appReset`
// feature). The page has already removed what it keeps (its caches, and for
// Reset jEditor its settings, recents and pins); this is the app's part,
// then a fresh start.
//
// Never removed: the orders folder (Shell.OrdersDir), which holds each
// project's flags, edits, Auto crop originals and deleted photos (the page
// clears only their cache/ folders), the cache folder chosen in Settings →
// Projects (CacheDir, which says where those are), and the log.
static class AppReset
{
    // This app's own files that Reset jEditor forgets, in Shell.DataDir.
    // window.json: where the window was, its theme and background, the last
    // folder picked. A file of the app's own that holds what a fresh install
    // wouldn't have (the projects list kept for Photos, say) goes here too,
    // and test/parity.test.js checks the Mac and Linux list matches.
    public static readonly string[] Forgotten = ["window.json"];

    public static void Forget()
    {
        // Kept across it: where the projects' data is (CacheDir)
        var cache = Settings.Load().CacheDir;
        foreach (var name in Forgotten)
        {
            var file = Path.Combine(Shell.DataDir, name);
            try { if (File.Exists(file)) File.Delete(file); }
            catch (Exception e) { Log.Write($"Reset: couldn't remove {file}: {e.Message}"); }
        }
        if (cache is not null) Settings.Update(s => s.CacheDir = cache);
    }

    // jEditor again, then every window of this one closed. (Several
    // processes can share the WebView2 profile, so the new one needn't wait.)
    public static void Restart()
    {
        try
        {
            Process.Start(new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = true });
        }
        catch (Exception e)
        {
            Log.Write($"Reset: couldn't start jEditor again: {e.Message}");
        }
        AppWindows.CloseAll(0);
    }
}
