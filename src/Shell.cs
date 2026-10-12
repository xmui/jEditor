using System.Diagnostics;
using System.Runtime.InteropServices;

namespace JEditor;

static class Shell
{
    // %LOCALAPPDATA%\jEditor: settings and the WebView2 profile. Not where
    // the app is installed (%LOCALAPPDATA%\Programs\jEditor), so
    // uninstalling or updating doesn't touch them.
    public static string DataDir { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "jEditor");

    // A link, in the default browser (or mail app)
    public static void OpenExternal(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception e)
        {
            Log.Write($"Couldn't open {url}: {e.Message}");
        }
    }

    // Dark or light title bar (Windows 10 20H1 and later; ignored elsewhere)
    public static void SetDarkTitleBar(IntPtr hwnd, bool dark)
    {
        const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        int value = dark ? 1 : 0;
        try { DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref value, sizeof(int)); }
        catch (Exception) { }
    }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
