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
// deleted photo is in the Recycle Bin; Ctrl+Z brings it back unchanged.
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
    public (bool, string?) Check(string step, string? name)
    {
        var path = name is null ? null : Path.Combine(dir, name.Replace('/', Path.DirectorySeparatorChar));
        (bool, string?) result = step switch
        {
            "stored" => Stored(),
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
            foreach (var step in new[] { "stored", "recycled", "deleted", "restored" })
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
