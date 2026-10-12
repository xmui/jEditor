using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace JEditor;

// jEditor.exe --smoke-test <folder> [--log <file>]
//
// Proves on a real Windows machine (CI) that the whole path works: the UI
// loads from the app folder, the bridge hands it a folder handle made by
// WebView2, jEditor lists the photos, and a rotation is saved to disk.
// Exits 0 on success, 1 on failure, 2 if it takes longer than 90 seconds.
// The details are in the log.
sealed class Smoke
{
    static readonly string[] PhotoTypes = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

    readonly MainForm form;
    readonly Dictionary<string, string> before;
    readonly System.Windows.Forms.Timer timeout = new() { Interval = 90_000 };
    bool done;

    public Smoke(MainForm form, string dir)
    {
        this.form = form;
        before = Photos(dir).ToDictionary(p => p, Hash);
        Log.Write($"Smoke test: {before.Count} photos in {dir}");
    }

    public void Start()
    {
        timeout.Tick += (_, _) => Done(2, "timed out after 90 s");
        timeout.Start();
    }

    public void Fail(string why) => Done(1, why);

    public async void Report(JsonNode msg)
    {
        var problems = new List<string>();
        if (msg["ok"]?.GetValue<bool>() != true) problems.Add("opening failed: " + msg["error"]);
        int count = msg["count"]?.GetValue<int>() ?? -1;
        if (count != before.Count) problems.Add($"jEditor listed {count} photos, the folder has {before.Count}");
        if (msg["rotated"]?.GetValue<bool>() != true) problems.Add("the rotation reported failure");
        if (msg["errors"] is JsonArray errors && errors.Count > 0) problems.Add("JS errors: " + errors.ToJsonString());

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
