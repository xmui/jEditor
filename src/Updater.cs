using System.Diagnostics;
using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace JEditor;

// Updates from GitHub releases: is there a newer one, download
// its setup (checked against the SHA-256 GitHub publishes for it), and run
// it. The setup installs for this user, so no admin; it waits for jEditor
// to close and opens it again afterwards (/RELAUNCH=1, see jEditor.iss).
static class Updater
{
    // jEditor's repo, and the Windows app's own repo, where releases were
    // published until 1.35.1 (the app moved back into xmui/jEditor). The
    // newest of the two wins, so an update is found whichever one has it:
    // jEditor's latest release is a web one (no setup) until its first
    // Windows release lands.
    static readonly string[] Repos = ["xmui/jEditor", "xmui/jeditor-windows"];

    static readonly HttpClient http = MakeClient();

    public sealed record Release(string Tag, string Version, string Notes, string SetupUrl, long Size, string? Sha256);

    // What this build is: the release tag it was built for (release.yml
    // passes it), else v<version> for a build made any other way
    public static string CurrentTag { get; } =
        typeof(Updater).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == "ReleaseTag" && !string.IsNullOrEmpty(a.Value))?.Value
        ?? "v" + Application.ProductVersion;

    // beta: betas count too (Settings → Updates → Beta builds)
    public static async Task<Release> LatestAsync(bool beta = false)
    {
        Release? newest = null;
        Exception? failed = null;
        foreach (var repo in Repos)
        {
            try
            {
                var release = beta ? await NewestAsync(repo) : await LatestAsync(repo);
                if (newest is null || IsNewer(release.Tag, newest.Tag)) newest = release;
            }
            catch (Exception e) { failed ??= e; }
        }
        return newest ?? throw failed!;
    }

    static async Task<Release> LatestAsync(string repo)
    {
        using var res = await http.GetAsync($"https://api.github.com/repos/{repo}/releases/latest");
        if ((int)res.StatusCode == 404) throw new InvalidOperationException("No releases yet");
        res.EnsureSuccessStatusCode();
        return FromJson(JsonNode.Parse(await res.Content.ReadAsStringAsync())!);
    }

    // The newest release or beta with a setup to download
    static async Task<Release> NewestAsync(string repo)
    {
        using var res = await http.GetAsync($"https://api.github.com/repos/{repo}/releases?per_page=30");
        res.EnsureSuccessStatusCode();
        Release? newest = null;
        foreach (var json in JsonNode.Parse(await res.Content.ReadAsStringAsync()) as JsonArray ?? [])
        {
            if (json is null || (bool?)json["draft"] == true) continue;
            Release release;
            try { release = FromJson(json); } catch (InvalidOperationException) { continue; }
            if (newest is null || IsNewer(release.Tag, newest.Tag)) newest = release;
        }
        return newest ?? throw new InvalidOperationException("No releases yet");
    }

    static Release FromJson(JsonNode json)
    {
        var tag = (string?)json["tag_name"] ?? throw new InvalidOperationException("The release has no tag");
        var setup = (json["assets"] as JsonArray ?? [])
            .FirstOrDefault(a => Regex.IsMatch((string?)a?["name"] ?? "", @"^jEditor-Setup-.*\.exe$", RegexOptions.IgnoreCase))
            ?? throw new InvalidOperationException($"Release {tag} has no setup to download");
        var digest = (string?)setup["digest"];
        return new Release(
            tag,
            Parse(tag).version.ToString(),
            (string?)json["body"] ?? "",
            (string?)setup["browser_download_url"] ?? throw new InvalidOperationException("No download link"),
            (long?)setup["size"] ?? 0,
            digest is not null && digest.StartsWith("sha256:") ? digest[7..].ToLowerInvariant() : null);
    }

    // v1.18.1 < v1.18.1-2 < v1.19.0-beta.1 < v1.19.0-beta.2 < v1.19.0
    public static bool IsNewer(string tag, string than)
    {
        var (a, ap, an) = Parse(tag);
        var (b, bp, bn) = Parse(than);
        return a != b ? a > b : ap != bp ? ap > bp : an > bn;
    }

    // → the version, which beta (int.MaxValue: not a beta), and the -N
    static (Version version, int beta, int build) Parse(string tag)
    {
        var m = Regex.Match(tag, @"(\d+)\.(\d+)\.(\d+)(?:-(beta\.)?(\d+))?");
        if (!m.Success) return (new Version(0, 0, 0), int.MaxValue, 0);
        var v = new Version(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value));
        if (m.Groups[4].Success) return (v, int.Parse(m.Groups[5].Value), 0);
        return (v, int.MaxValue, m.Groups[5].Success ? int.Parse(m.Groups[5].Value) : 1);
    }

    // → the downloaded setup's path
    public static async Task<string> DownloadAsync(Release release, Action<long, long> progress)
    {
        var dir = Path.Combine(Path.GetTempPath(), "jEditor-update");
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, $"jEditor-Setup-{release.Tag.TrimStart('v')}.exe");
        // Setups from earlier updates aren't needed any more
        foreach (var old in Directory.EnumerateFiles(dir, "jEditor-Setup-*.exe"))
            if (!string.Equals(old, file, StringComparison.OrdinalIgnoreCase)) try { File.Delete(old); } catch (Exception) { }
        // A download that stops moving for a minute fails, instead of
        // sitting at the same percentage for ever
        using var stalled = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        using var res = await http.GetAsync(release.SetupUrl, HttpCompletionOption.ResponseHeadersRead, stalled.Token);
        res.EnsureSuccessStatusCode();
        long total = res.Content.Headers.ContentLength ?? release.Size, received = 0, reported = 0;
        using (var src = await res.Content.ReadAsStreamAsync(stalled.Token))
        using (var dst = File.Create(file))
        {
            var buffer = new byte[1 << 16];
            int n;
            while (true)
            {
                stalled.CancelAfter(TimeSpan.FromSeconds(60));
                try { n = await src.ReadAsync(buffer, stalled.Token); }
                catch (OperationCanceledException) { throw new IOException("The download stopped (no data for a minute). Check the internet connection and try again."); }
                if (n <= 0) break;
                await dst.WriteAsync(buffer.AsMemory(0, n));
                received += n;
                if (received - reported >= 1 << 20 || received == total)
                {
                    reported = received;
                    progress(received, total);
                }
            }
        }
        if (release.Sha256 is not null)
        {
            await using var check = File.OpenRead(file);
            var hash = Convert.ToHexString(await SHA256.HashDataAsync(check)).ToLowerInvariant();
            if (hash != release.Sha256)
            {
                File.Delete(file);
                throw new InvalidOperationException("The download was damaged (its checksum doesn't match). Try again.");
            }
        }
        return file;
    }

    // Runs the setup quietly; it waits for jEditor to close, then opens it
    public static void Install(string setup)
    {
        // Its log beside jEditor's; if it fails, it opens jEditor again
        // (--update-failed) to say so
        var log = Path.Combine(Path.GetDirectoryName(Log.Default())!, "setup.log");
        Log.Write($"Running {setup} (log: {log})");
        Process.Start(new ProcessStartInfo(setup, $"/SILENT /SUPPRESSMSGBOXES /NORESTART /RELAUNCH=1 \"/LOG={log}\"") { UseShellExecute = true });
    }

    static HttpClient MakeClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        c.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("jEditor", Application.ProductVersion));
        c.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        return c;
    }
}
