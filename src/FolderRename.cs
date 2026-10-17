using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace JEditor;

// Renaming a project (or any folder) from the sidebar. jEditor keeps each
// project's flags, kept edits and thumbnails in a folder of its storage
// named after the project's path (folder-cache.js storeName), so those move
// with it: every project in the folder renamed, or under it.
static class FolderRename
{
    // Why a name won't do as a folder's, or null
    public static string? NameProblem(string name)
    {
        if (name.Length == 0) return "A folder needs a name";
        if (name.Length > 120) return "That name is too long";
        if (name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return "A folder's name can't have any of these in it: \\ / : * ? \" < > |";
        if (name.EndsWith('.') || name.EndsWith(' ')) return "A folder's name can't end with a dot or a space";
        if (Regex.IsMatch(name, @"^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\..*)?$", RegexOptions.IgnoreCase)) return "Windows keeps that name for itself";
        return null;
    }

    // → the folder's new path
    public static string Rename(string path, string name)
    {
        path = path.TrimEnd('\\', '/');
        var parent = Path.GetDirectoryName(path);
        if (string.IsNullOrEmpty(parent) || !Directory.Exists(path)) throw new IOException("That folder isn't there");
        var newPath = Path.Combine(parent, name);
        if (string.Equals(path, newPath, StringComparison.Ordinal)) return path;
        bool caseOnly = string.Equals(path, newPath, StringComparison.OrdinalIgnoreCase);
        if (!caseOnly && (Directory.Exists(newPath) || File.Exists(newPath))) throw new IOException($"There's already a {name} there");
        if (caseOnly)
        {
            // Windows won't move a folder onto itself: through another name
            var step = newPath + ".jeditor-rename";
            Directory.Move(path, step);
            Directory.Move(step, newPath);
        }
        else Directory.Move(path, newPath);
        Log.Write($"Renamed {path} to {newPath}");
        MoveStores(path, newPath);
        return newPath;
    }

    // The data of every project at or under `from`, renamed for `to`
    static void MoveStores(string from, string to)
    {
        if (!Directory.Exists(Shell.OrdersDir)) return;
        foreach (var store in Directory.EnumerateDirectories(Shell.OrdersDir))
        {
            try
            {
                var file = Path.Combine(store, "order.json");
                if (!File.Exists(file)) continue;
                var json = JsonNode.Parse(File.ReadAllText(file))?.AsObject();
                var p = (string?)json?["path"];
                if (json is null || p is null) continue;
                bool same = string.Equals(p.TrimEnd('\\'), from, StringComparison.OrdinalIgnoreCase);
                bool under = p.StartsWith(from + "\\", StringComparison.OrdinalIgnoreCase);
                if (!same && !under) continue;
                var np = to + p.TrimEnd('\\')[from.Length..];
                json["path"] = np;
                json["name"] = Path.GetFileName(np);
                var target = Path.Combine(Shell.OrdersDir, StoreName(np));
                if (!string.Equals(target, store, StringComparison.OrdinalIgnoreCase))
                {
                    // Data left by an earlier project of that name is set aside,
                    // so this project's own goes in its place
                    if (Directory.Exists(target))
                    {
                        var aside = target + "-old-" + DateTime.Now.ToString("yyyyMMddHHmmss");
                        Directory.Move(target, aside);
                        Log.Write($"Rename: {Path.GetFileName(target)} was there already; set aside as {Path.GetFileName(aside)}");
                    }
                    Directory.Move(store, target);
                    file = Path.Combine(target, "order.json");
                    Log.Write($"Rename: its data moved to {Path.GetFileName(target)}");
                }
                // Its path written once the data is where that path finds it
                File.WriteAllText(file, json.ToJsonString());
            }
            catch (Exception e)
            {
                Log.Write($"Rename: couldn't move {store}: {e.Message}");
            }
        }
    }

    // As folder-cache.js storeName: "Smith Order-1a2b3c4d5e6f7a8b"
    public static string StoreName(string path)
    {
        var name = path.Split('\\', '/').LastOrDefault(s => s.Length > 0) ?? "Order";
        var safe = Regex.Replace(name, "[<>:\"/\\\\|?*\\x00-\\x1f]", "_");
        if (safe.Length > 60) safe = safe[..60];
        safe = safe.Trim();
        if (safe.Length == 0) safe = "Order";
        return $"{safe}-{Hash(JsLower(path))}";
    }

    // JavaScript's toLowerCase, which the page's store names use: as
    // ToLowerInvariant but for İ (i + combining dot) and a word-final Σ (ς)
    static string JsLower(string s)
    {
        var sb = new System.Text.StringBuilder(s.Length);
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            if (c == '\u0130') { sb.Append("i\u0307"); continue; }
            if (c == '\u03A3')
            {
                bool before = i > 0 && char.IsLetter(s[i - 1]);
                bool after = i + 1 < s.Length && char.IsLetter(s[i + 1]);
                sb.Append(before && !after ? '\u03C2' : '\u03C3');
                continue;
            }
            sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }

    static string Hash(string key)
    {
        unchecked
        {
            uint a = 0x811c9dc5, b = 0x01000193 ^ (uint)key.Length;
            foreach (char c in key)
            {
                a = (a ^ c) * 0x01000193;
                b = (b ^ c) * 0x5bd1e995;
            }
            return a.ToString("x8") + b.ToString("x8");
        }
    }
}
