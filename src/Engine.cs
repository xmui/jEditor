using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Web.WebView2.Core;

namespace JEditor;

// jEditor's engine (engine/, Rust; docs/plans/fast-engine.md):
// jeditor_engine.dll beside jEditor.exe, the heavy image work done here
// rather than in the page. The page asks for a result by URL:
//
//   https://engine.jeditor.example/thumb?w=320&path=<the photo on disk>
//     → a JPEG thumbnail, w wide as shown (after its EXIF orientation), of
//       a JPEG, or of a HEIC when the engine was built with libheif
//       (Formats; its DLLs beside it, scripts/engine-heif.ps1)
//
// so a full-size photo is never read into the page, and the page shows
// the answer as it would any picture. Without the DLL (a build with no
// Rust) the app doesn't list the `engine` feature and the page makes its
// thumbnails itself, as before. A request the engine can't answer (not a
// JPEG, a CMYK JPEG, a bad file) is a 204, no content (not an error the
// page's console reports), and the page does that one itself too.
static class Engine
{
    const string Dll = "jeditor_engine";

    [StructLayout(LayoutKind.Sequential)]
    struct JeBuf
    {
        public IntPtr Ptr;
        public nuint Len;
        public nuint Cap;
    }

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr je_version();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr je_formats();

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern int je_thumbnail_file(byte[] path, nuint pathLen, uint width, out JeBuf buf);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern void je_free(JeBuf buf);

    // What a page can ask for: photos the engine reads, by name (je_formats).
    // Before Version: static fields start in order, and Load sets this
    static string[] Reads = [".jpg", ".jpeg"];

    // The engine's version, or null when the DLL isn't there or won't load
    public static readonly string? Version = Load();

    public static bool Available => Version is not null;

    static string? Load()
    {
        // Timing without it (test/grid-speed.perf.js, before and after)
        if (Environment.GetEnvironmentVariable("JEDITOR_NO_ENGINE") == "1")
        {
            Log.Write("Engine: off (JEDITOR_NO_ENGINE)");
            return null;
        }
        try
        {
            var v = Marshal.PtrToStringUTF8(je_version());
            Reads = (Marshal.PtrToStringUTF8(je_formats()) ?? "jpg jpeg").Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(x => "." + x).ToArray();
            Log.Write($"Engine: {v} ({string.Join(' ', Reads)})");
            return v;
        }
        catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException)
        {
            Log.Write($"Engine: none ({e.GetType().Name}); thumbnails are made by the page");
            return null;
        }
    }

    // It reads HEICs (built with libheif): the page asks it for them too
    public static bool Heic => Available && Reads.Contains(".heic");

    // A JPEG thumbnail of the photo at path, width wide; null if the engine
    // can't make it (code says why: 1 not supported, 2 unreadable, 3 bad)
    public static byte[]? Thumbnail(string path, int width, out int code)
    {
        var p = Encoding.UTF8.GetBytes(path);
        code = je_thumbnail_file(p, (nuint)p.Length, (uint)width, out var buf);
        if (code != 0) return null;
        try
        {
            var bytes = new byte[(int)buf.Len];
            Marshal.Copy(buf.Ptr, bytes, 0, bytes.Length);
            return bytes;
        }
        finally
        {
            je_free(buf);
        }
    }

    // Where the page asks: a host of its own, not the UI's (whose files
    // WebView2 serves from the app folder itself), answered here only
    public const string Host = "engine.jeditor.example";
    static bool loggedFirst;

    // Answers the page's requests to Host (MainForm hooks this up when the
    // engine's there). The work runs off the UI thread, many at once.
    // pageOrigin: the UI's origin, allowed to read the answers (CORS)
    public static void Serve(CoreWebView2 core, string pageOrigin)
    {
        core.AddWebResourceRequestedFilter($"https://{Host}/*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
        core.WebResourceRequested += async (_, e) =>
        {
            if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri) || uri.Host != Host) return;
            var deferral = e.GetDeferral();
            var cors = $"Access-Control-Allow-Origin: {pageOrigin}\r\nCache-Control: no-store";
            try
            {
                var (status, body) = await Gated(uri);
                if (!loggedFirst) { loggedFirst = true; Log.Write($"Engine: first request answered {status} ({body?.Length ?? 0} bytes)"); }
                e.Response = core.Environment.CreateWebResourceResponse(
                    body is null ? null : new MemoryStream(body), status, status == 200 ? "OK" : status == 204 ? "No Content" : "Not Found",
                    body is null ? cors : "Content-Type: image/jpeg\r\n" + cors);
            }
            catch (Exception ex)
            {
                Log.Write("Engine request failed: " + ex);
                e.Response = core.Environment.CreateWebResourceResponse(null, 500, "Error", cors);
            }
            finally
            {
                deferral.Complete();
            }
        };
    }

    // At most one decode per core: the page asks for a dozen at once, and
    // more decodes than cores only slow each other down. HEICs (a second or
    // so each) get every core but one, so a JPEG never waits behind them
    static readonly SemaphoreSlim cores = new(Math.Max(1, Environment.ProcessorCount));
    static readonly SemaphoreSlim heavy = new(Math.Max(1, Environment.ProcessorCount - 1));

    static async Task<(int, byte[]?)> Gated(Uri uri)
    {
        var q = System.Web.HttpUtility.ParseQueryString(uri.Query)["path"] ?? "";
        var slow = Path.GetExtension(q).ToLowerInvariant() is ".heic" or ".heif";
        if (slow) await heavy.WaitAsync();
        try
        {
            await cores.WaitAsync();
            try { return await Task.Run(() => Answer(uri)); }
            finally { cores.Release(); }
        }
        finally
        {
            if (slow) heavy.Release();
        }
    }

    // How the answers went, for the log every 50 (test/grid-speed.perf.js
    // shows it): how many, how long, by kind
    static readonly object statsLock = new();
    static readonly Dictionary<string, (int n, int made, double ms, double most)> stats = [];
    static int answered;

    static void Count(string ext, bool made, double ms)
    {
        lock (statsLock)
        {
            stats.TryGetValue(ext, out var s);
            stats[ext] = (s.n + 1, s.made + (made ? 1 : 0), s.ms + ms, Math.Max(s.most, ms));
            if (++answered % 50 != 0) return;
            Log.Write($"Engine: {answered} answered; " + string.Join("; ", stats.Select(kv =>
                $"{kv.Key} {kv.Value.made}/{kv.Value.n} made, {kv.Value.ms / kv.Value.n:F0} ms each (longest {kv.Value.most:F0})")));
        }
    }

    static (int, byte[]?) Answer(Uri uri)
    {
        var q = System.Web.HttpUtility.ParseQueryString(uri.Query);
        if (uri.AbsolutePath != "/thumb") return (404, null);
        var path = q["path"];
        if (string.IsNullOrEmpty(path) || !int.TryParse(q["w"], out var w) || w < 1 || w > 4096) return (404, null);
        if (!Path.IsPathFullyQualified(path) || !Reads.Contains(Path.GetExtension(path).ToLowerInvariant())) return (204, null);
        var t = System.Diagnostics.Stopwatch.StartNew();
        var bytes = Thumbnail(path, w, out var code);
        Count(Path.GetExtension(path).ToLowerInvariant(), bytes is not null, t.Elapsed.TotalMilliseconds);
        if (bytes is null && code != 1) Log.Write($"Engine: no thumbnail for {path} (code {code})");
        return bytes is null ? (204, null) : (200, bytes);
    }
}
