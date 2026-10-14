using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace JEditor;

// jEditor.exe --smoke-test <folder> [--log <file>]
//
// Proves on a real Windows machine (CI) that the whole path works: the UI
// loads from the app folder, the bridge hands it a folder handle made by
// WebView2, jEditor lists the photos, and a rotation is saved to disk. Then
// the page asks the app to check each further step on disk (Check): a flag
// is stored in jEditor's storage and nothing is added to the order; a
// deleted photo is in the Recycle Bin; Ctrl+Z brings it back unchanged;
// the test scanner's photos land in the order, named next in its sequence;
// Browse lists the drives and counts the folder's photos as jEditor does.
// Exits 0 on success, 1 on failure, 2 if it takes longer than 90 seconds.
// The details are in the log.
sealed class Smoke
{
    static readonly string[] PhotoTypes = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

    readonly MainForm form;
    readonly string dir;
    readonly Dictionary<string, string> before;
    readonly System.Windows.Forms.Timer timeout = new() { Interval = 90_000 };
    bool done;

    public Smoke(MainForm form, string dir)
    {
        this.form = form;
        this.dir = dir;
        before = Photos(dir).ToDictionary(p => p, Hash);
        Log.Write($"Smoke test: {before.Count} photos in {dir}");
    }

    public void Start()
    {
        timeout.Tick += (_, _) => Done(2, "timed out after 90 s");
        timeout.Start();
    }

    public void Fail(string why) => Done(1, why);

    // A step the page took, checked on disk → (ok, what's wrong)
    public (bool, string?) Check(string step, JsonNode msg)
    {
        var name = (string?)msg["name"];
        var path = name is null ? null : Path.Combine(dir, name.Replace('/', Path.DirectorySeparatorChar));
        (bool, string?) result = step switch
        {
            "stored" => Stored(),
            "scanned" => Scanned(msg),
            "cropped" => Cropped(msg),
            "fed" => Fed(msg),
            "tethered" => Tethered(msg),
            "windows" => AppWindows.All.Count >= 2 ? (true, null) : (false, $"{AppWindows.All.Count} window(s) open"),
            "moved" when path is not null => File.Exists(path) ? (true, null) : (false, $"{name} isn't there"),
            "back" when path is not null => File.Exists(path) && !File.Exists(Path.Combine(dir, "Moved", Path.GetFileName(path))) ? (true, null) : (false, $"{name} didn't come back"),
            "deleted" when path is not null => File.Exists(path) ? (false, $"{name} is still in the folder")
                : !RecycleBin.HasBin(path) ? (false, "the test folder's drive has no Recycle Bin") : (true, null),
            "restored" when path is not null => !File.Exists(path) ? (false, $"{name} didn't come back")
                : before.TryGetValue(path, out var h) && h != Hash(path) ? (false, $"{name} came back changed") : (true, null),
            _ => (false, "unknown step " + step),
        };
        Log.Write($"Smoke check {step}{(name is null ? "" : " " + name)}: {(result.Item1 ? "ok" : result.Item2)}");
        return result;
    }

    // The flag went to jEditor's storage, in a folder whose order.json
    // names this order; the order itself got no .jeditor
    (bool, string?) Stored()
    {
        if (Directory.Exists(Path.Combine(dir, ".jeditor"))) return (false, "a .jeditor folder was made in the order");
        if (!Directory.Exists(Shell.OrdersDir)) return (false, "nothing in jEditor's storage");
        foreach (var store in Directory.EnumerateDirectories(Shell.OrdersDir))
        {
            var info = Path.Combine(store, "order.json");
            if (!File.Exists(info)) continue;
            var json = JsonNode.Parse(File.ReadAllText(info));
            if (!string.Equals((string?)json?["path"], dir, StringComparison.OrdinalIgnoreCase)) continue;
            return File.Exists(Path.Combine(store, "flags.json")) ? (true, null) : (false, "no flags.json beside order.json");
        }
        return (false, $"no stored folder names {dir} (the path worked out from a photo was wrong?)");
    }

    // Three test scans after scan_0001…0003: scan_0004…0006, whole JPEGs,
    // nothing half-written left, and all three shown in jEditor
    (bool, string?) Scanned(JsonNode msg)
    {
        var names = (msg["names"] as JsonArray ?? []).Select(n => (string?)n ?? "").ToList();
        var expected = new[] { "scan_0004.jpg", "scan_0005.jpg", "scan_0006.jpg" };
        if (!names.SequenceEqual(expected)) return (false, $"scanned as {string.Join(", ", names)}; expected {string.Join(", ", expected)}");
        foreach (var n in names)
        {
            try
            {
                using var img = System.Drawing.Image.FromFile(Path.Combine(dir, n));
                if (img.Width != 1500) return (false, $"{n} is {img.Width} wide");
            }
            catch (Exception e)
            {
                return (false, $"{n} isn't a readable photo: {e.Message}");
            }
        }
        if (Directory.EnumerateFiles(dir, "*.part").Any()) return (false, "a half-written scan was left in the folder");
        var shown = msg["shown"]?.GetValue<int>() ?? 0;
        return shown == names.Count ? (true, null) : (false, $"jEditor shows {shown} of the {names.Count} scans");
    }

    // Preview and crop with the test scanner: its glass previewed at 75 dpi
    // (8.5 × 11.7 in), three prints found, and a photo per box at 150 dpi,
    // each the box's size
    (bool, string?) Cropped(JsonNode msg)
    {
        var names = (msg["names"] as JsonArray ?? []).Select(n => (string?)n ?? "").ToList();
        var sizes = (msg["sizes"] as JsonArray ?? []).Select(s => (s![0]!.GetValue<int>(), s[1]!.GetValue<int>())).ToList();
        var preview = msg["preview"] as JsonArray;
        if (preview is null || preview[0]!.GetValue<int>() != 638 || preview[1]!.GetValue<int>() != 878) return (false, $"the preview is {preview?.ToJsonString()}, not 638 × 878");
        if (names.Count != 3 || sizes.Count != 3) return (false, $"{names.Count} photos saved: {string.Join(", ", names)}");
        for (int i = 0; i < names.Count; i++)
        {
            try
            {
                using var img = System.Drawing.Image.FromFile(Path.Combine(dir, names[i]));
                var (w, h) = sizes[i];
                if (Math.Abs(img.Width - w) > 3 || Math.Abs(img.Height - h) > 3) return (false, $"{names[i]} is {img.Width} × {img.Height}, its box {w} × {h}");
            }
            catch (Exception e)
            {
                return (false, $"{names[i]} isn't a readable photo: {e.Message}");
            }
        }
        return (true, null);
    }

    // The feeder with jEditor's settings: three photos, both sides, the
    // test scanner's sides swapped: scan_0007…0009, each with its -b back,
    // and the photo (not the plain back) under the plain name
    (bool, string?) Fed(JsonNode msg)
    {
        var names = (msg["names"] as JsonArray ?? []).Select(n => (string?)n ?? "").ToList();
        var expected = new[] { "scan_0007.jpg", "scan_0007-b.jpg", "scan_0008.jpg", "scan_0008-b.jpg", "scan_0009.jpg", "scan_0009-b.jpg" };
        if (!names.SequenceEqual(expected)) return (false, $"saved as {string.Join(", ", names)}; expected {string.Join(", ", expected)}");
        try
        {
            // The photo is colourful; the back is plain paper
            using var front = new System.Drawing.Bitmap(Path.Combine(dir, "scan_0007.jpg"));
            using var backSide = new System.Drawing.Bitmap(Path.Combine(dir, "scan_0007-b.jpg"));
            var f = front.GetPixel(front.Width / 10, front.Height / 10);
            var b = backSide.GetPixel(backSide.Width / 10, backSide.Height / 10);
            if (b.GetSaturation() > 0.1 || f.GetSaturation() < 0.15) return (false, $"the sides are the wrong way round (front {f}, back {b})");
        }
        catch (Exception e)
        {
            return (false, "the fed photos aren't readable: " + e.Message);
        }
        return (true, null);
    }

    // Tethered shooting with the test camera: connected, live view frames,
    // and one shot as RAW + JPEG under one number, the JPEG whole
    (bool, string?) Tethered(JsonNode msg)
    {
        var names = (msg["names"] as JsonArray ?? []).Select(n => (string?)n ?? "").ToList();
        if (msg["connected"]?.GetValue<bool>() != true) return (false, "the test camera never said it connected");
        if ((msg["frames"]?.GetValue<int>() ?? 0) < 3) return (false, $"{msg["frames"]} live view frames");
        if (!names.SequenceEqual(["shot_001.arw", "shot_001.jpg"])) return (false, $"saved as {string.Join(", ", names)}; expected shot_001.arw, shot_001.jpg");
        if (!File.Exists(Path.Combine(dir, "shot_001.arw"))) return (false, "shot_001.arw isn't there");
        try
        {
            using var img = System.Drawing.Image.FromFile(Path.Combine(dir, "shot_001.jpg"));
            if (img.Width != 1200) return (false, $"shot_001.jpg is {img.Width} wide");
        }
        catch (Exception e)
        {
            return (false, $"shot_001.jpg isn't a readable photo: {e.Message}");
        }
        return Directory.EnumerateFiles(dir, "*.part").Any() ? (false, "a half-written photo was left in the folder") : (true, null);
    }

    public async void Report(JsonNode msg)
    {
        var problems = new List<string>();
        if (msg["ok"]?.GetValue<bool>() != true) problems.Add("opening failed: " + msg["error"]);
        int count = msg["count"]?.GetValue<int>() ?? -1;
        if (count != before.Count) problems.Add($"jEditor listed {count} photos, the folder has {before.Count}");
        if (msg["rotated"]?.GetValue<bool>() != true) problems.Add("the rotation reported failure");
        if (msg["errors"] is JsonArray errors && errors.Count > 0) problems.Add("JS errors: " + errors.ToJsonString());
        if (msg["steps"] is JsonObject steps)
        {
            Log.Write("Smoke steps: " + steps.ToJsonString());
            foreach (var step in new[] { "stored", "recycled", "deleted", "restored", "scanned", "fed", "cropped", "tethered", "logged", "places", "browsed", "projects", "counted", "pins", "renamed", "windows", "moved", "unmoved", "back" })
                if (steps[step] is not JsonValue v || !v.TryGetValue<bool>(out var ok) || !ok) problems.Add($"{step}: {steps[step]?.ToJsonString() ?? "not reached"}");
            if (steps["error"] is not null) problems.Add("error: " + steps["error"]);
        }
        else problems.Add("no steps reported");

        // The rotation was written to disk (allowing a moment for it to land)
        int changed = 0;
        for (int i = 0; i < 30 && changed == 0; i++)
        {
            changed = before.Count(kv => File.Exists(kv.Key) && Hash(kv.Key) != kv.Value);
            if (changed == 0) await Task.Delay(100);
        }
        if (changed != 1) problems.Add($"{changed} files changed on disk; expected 1 (the rotated photo, {msg["file"]})");

        Done(problems.Count == 0 ? 0 : 1, problems.Count == 0
            ? $"{count} photos listed, {msg["file"]} rotated and saved"
            : string.Join("; ", problems));
    }

    void Done(int code, string summary)
    {
        if (done) return;
        done = true;
        timeout.Stop();
        Log.Write($"SMOKE {(code == 0 ? "PASS" : "FAIL")}: {summary}");
        form.Finish(code);
    }

    static IEnumerable<string> Photos(string dir) =>
        Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories)
            .Where(p => !p.Contains(Path.DirectorySeparatorChar + ".jeditor" + Path.DirectorySeparatorChar))
            .Where(p => PhotoTypes.Contains(Path.GetExtension(p).ToLowerInvariant()));

    static string Hash(string path)
    {
        try { return Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))); }
        catch (IOException) { return ""; }
    }
}
