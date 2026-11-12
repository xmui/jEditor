using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Web.WebView2.Core;

namespace JEditor;

// jEditor's engine (engine/, Rust; docs/plans/fast-engine.md):
// jeditor_engine.dll beside jEditor.exe, the heavy image work done here
// rather than in the page. The page asks for a result by URL:
//
//   https://jeditor.example/engine/thumb?w=320&path=<the photo on disk>
//     → a JPEG thumbnail, w wide as shown (after its EXIF orientation)
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
    static extern int je_thumbnail_file(byte[] path, nuint pathLen, uint width, out JeBuf buf);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
    static extern void je_free(JeBuf buf);

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
            Log.Write($"Engine: {v}");
            return v;
        }
        catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException)
        {
            Log.Write($"Engine: none ({e.GetType().Name}); thumbnails are made by the page");
            return null;
        }
    }

    // What a page can ask for: photos the engine reads, by name
    static readonly string[] Reads = [".jpg", ".jpeg"];

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

    // Answers the page's /engine/ requests (MainForm hooks this up when
    // the engine's there). The work runs off the UI thread, many at once.
    public static void Serve(CoreWebView2 core, string host)
    {
        core.AddWebResourceRequestedFilter($"https://{host}/engine/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += async (_, e) =>
        {
            var uri = new Uri(e.Request.Uri);
            if (!uri.AbsolutePath.StartsWith("/engine/", StringComparison.Ordinal)) return;
            var deferral = e.GetDeferral();
            try
            {
                var (status, body) = await Task.Run(() => Answer(uri));
                e.Response = core.Environment.CreateWebResourceResponse(
                    body is null ? null : new MemoryStream(body), status, status == 200 ? "OK" : status == 204 ? "No Content" : "Not Found",
                    body is null ? "Cache-Control: no-store" : "Content-Type: image/jpeg\r\nCache-Control: no-store");
            }
            catch (Exception ex)
            {
                Log.Write("Engine request failed: " + ex.Message);
                e.Response = core.Environment.CreateWebResourceResponse(null, 500, "Error", "Cache-Control: no-store");
            }
            finally
            {
                deferral.Complete();
            }
        };
    }

    static (int, byte[]?) Answer(Uri uri)
    {
        var q = System.Web.HttpUtility.ParseQueryString(uri.Query);
        if (uri.AbsolutePath != "/engine/thumb") return (404, null);
        var path = q["path"];
        if (string.IsNullOrEmpty(path) || !int.TryParse(q["w"], out var w) || w < 1 || w > 4096) return (404, null);
        if (!Path.IsPathFullyQualified(path) || !Reads.Contains(Path.GetExtension(path).ToLowerInvariant())) return (204, null);
        var bytes = Thumbnail(path, w, out var code);
        if (bytes is null && code != 1) Log.Write($"Engine: no thumbnail for {path} (code {code})");
        return bytes is null ? (204, null) : (200, bytes);
    }
}
