using Microsoft.Web.WebView2.Core;

namespace JEditor;

static class Program
{
    // Held while jEditor runs, so the installer can ask to close it first
    // (AppMutex in installer/jEditor.iss)
    const string MutexName = "jEditor.Windows.App";

    // Microsoft's Evergreen bootstrapper: installs the WebView2 runtime for
    // the current user when run without admin
    const string WebView2Download = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    [STAThread]
    static int Main(string[] args)
    {
        Options options;
        try
        {
            options = Options.Parse(args);
        }
        catch (ArgumentException e)
        {
            Log.Init(null);
            Fail(null, e.Message);
            return 64;
        }
        Log.Init(options.LogFile);
        // The smoke test keeps its order data out of the real one
        if (options.SmokeDir is not null)
            Shell.DataDir = Path.Combine(Path.GetTempPath(), "jEditor-smoke-data-" + Guid.NewGuid().ToString("N"));
        Log.Write($"jEditor {Application.ProductVersion} starting: {string.Join(' ', args)}");

        ApplicationConfiguration.Initialize();

        if (options.UiDir is null)
        {
            Fail(options, "jEditor's app folder is missing next to jEditor.exe. Reinstalling jEditor should fix this.");
            return 65;
        }
        if (!RuntimeAvailable(options)) return 66;

        using var mutex = new Mutex(false, MutexName);
        using var form = new MainForm(options);
        Application.Run(form);
        Log.Write($"Exiting with code {form.ExitCode}");
        return form.ExitCode;
    }

    static bool RuntimeAvailable(Options options)
    {
        try
        {
            var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            Log.Write($"WebView2 runtime {version}");
            return true;
        }
        catch (WebView2RuntimeNotFoundException)
        {
            Log.Write("WebView2 runtime not found");
            if (options.SmokeDir is not null) return false;
            var answer = MessageBox.Show(
                "jEditor needs the Microsoft Edge WebView2 Runtime. It comes with Windows 11 and up-to-date " +
                "Windows 10, but it's missing on this PC.\n\nDownload it from Microsoft now? It installs " +
                "without admin rights. Start jEditor again once it's installed.",
                "jEditor", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (answer == DialogResult.Yes) Shell.OpenExternal(WebView2Download);
            return false;
        }
    }

    // An error before the window is up: a message box, or just the log in
    // the smoke test, where nobody is there to click OK
    public static void Fail(Options? options, string message)
    {
        Log.Write("Error: " + message);
        if (options?.SmokeDir is null) MessageBox.Show(message, "jEditor", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
