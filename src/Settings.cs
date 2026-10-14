using System.Text.Json;

namespace JEditor;

// %LOCALAPPDATA%\jEditor\window.json: where the window was, the last
// theme (for the title bar before the page loads), the last folder picked
// and which version of the UI ran last
sealed class Settings
{
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool Maximized { get; set; }
    public bool Dark { get; set; } = true;
    public string? LastFolder { get; set; }
    public string? UiStamp { get; set; }

    static string FilePath => Path.Combine(Shell.DataDir, "window.json");
    static readonly JsonSerializerOptions json = new() { WriteIndented = true };

    public static Settings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath)) ?? new Settings();
        }
        catch (Exception e)
        {
            Log.Write($"Ignoring unreadable {FilePath}: {e.Message}");
        }
        return new Settings();
    }

    // One change written now, onto what's in the file: several windows
    // share it, and each writing its whole copy when it closes lost the
    // others' changes (the last folder, the UI stamp)
    static readonly object gate = new();
    public static void Update(Action<Settings> change)
    {
        lock (gate)
        {
            var s = Load();
            change(s);
            s.Save();
        }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Shell.DataDir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, json));
        }
        catch (Exception e)
        {
            Log.Write($"Couldn't save {FilePath}: {e.Message}");
        }
    }
}
