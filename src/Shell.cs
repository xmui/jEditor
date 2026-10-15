using System.Diagnostics;
using System.Runtime.InteropServices;

namespace JEditor;

static class Shell
{
    // %LOCALAPPDATA%\jEditor: settings and the WebView2 profile. Not where
    // the app is installed (%LOCALAPPDATA%\Programs\jEditor), so
    // uninstalling or updating doesn't touch them.
    // The smoke test uses a temporary one.
    public static string DataDir { get; set; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "jEditor");

    // Each order's flags, cache and Auto crop originals: orders\<name>-<id>,
    // made and read by the page (app/folder-cache.js)
    public static string OrdersDir => Path.Combine(DataDir, "orders");

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

    // Windows 11's Mica or Acrylic behind the window (22H2, build 22621, and
    // later): DWM draws it wherever the window is transparent. GDI's black
    // is transparent once the frame covers the whole window, so the form
    // paints black and the WebView2 draws its page with a clear background.
    public static bool BackdropSupported => Environment.OSVersion.Version.Build >= 22621;

    // Settings → Personalization → Colors → Transparency effects. Off, DWM
    // draws a solid color instead, so jEditor stays opaque too.
    public static bool TransparencyEffects()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("EnableTransparency") is not int on || on != 0;
        }
        catch (Exception)
        {
            return true;
        }
    }

    // kind: "mica", "acrylic", or anything else for none. False if it
    // wasn't set (an older Windows), so the window stays as it was.
    public static bool SetBackdrop(IntPtr hwnd, string kind)
    {
        const int DWMWA_SYSTEMBACKDROP_TYPE = 38;
        const int DWMSBT_NONE = 1, DWMSBT_MAINWINDOW = 2, DWMSBT_TRANSIENTWINDOW = 3;
        if (!BackdropSupported) return false;
        int type = kind switch { "mica" => DWMSBT_MAINWINDOW, "acrylic" => DWMSBT_TRANSIENTWINDOW, _ => DWMSBT_NONE };
        var margins = type == DWMSBT_NONE ? new Margins() : new Margins { Left = -1, Right = -1, Top = -1, Bottom = -1 };
        try
        {
            if (DwmExtendFrameIntoClientArea(hwnd, ref margins) != 0) return false;
            return DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, ref type, sizeof(int)) == 0;
        }
        catch (Exception)
        {
            return false;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Margins { public int Left, Right, Top, Bottom; }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("dwmapi.dll")]
    static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref Margins margins);
}
