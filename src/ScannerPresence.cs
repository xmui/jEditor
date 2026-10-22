using System.Runtime.InteropServices;

namespace JEditor;

// Which of the scanners Windows lists are plugged in and switched on.
//
// A TWAIN driver stays listed after its scanner is unplugged (it's only a
// driver), so the list alone has scanners that aren't there. Windows knows
// the devices that are: each scanner's name is matched against theirs (the
// scanner itself, its USB device, a printer it's part of) by its model:
// "EPSON FF-680W" is there if a device says FF-680W, "Plustek OpticBook
// A300" if one says OpticBook A300. A name with no model in it can't be
// told, so it's taken to be there.
//
// A scanner on the network (Wi-Fi) has no device here, so it isn't found:
// the page still offers it, under the ones not found.
static class ScannerPresence
{
    // The present devices' names, each made plain: lower case, letters and
    // digits only ("EPSON FF-680W" → "epsonff680w")
    public static List<string> Devices()
    {
        var names = new List<string>();
        var set = SetupDiGetClassDevsW(IntPtr.Zero, null, IntPtr.Zero, DIGCF_PRESENT | DIGCF_ALLCLASSES);
        if (set == new IntPtr(-1)) return names;
        try
        {
            var data = new SP_DEVINFO_DATA { cbSize = (uint)Marshal.SizeOf<SP_DEVINFO_DATA>() };
            for (uint i = 0; SetupDiEnumDeviceInfo(set, i, ref data); i++)
            {
                var cls = Property(set, ref data, SPDRP_CLASS) ?? "";
                var bus = Property(set, ref data, SPDRP_ENUMERATOR_NAME) ?? "";
                // Scanners, printers (all-in-ones) and anything on USB
                if (!cls.Equals("Image", StringComparison.OrdinalIgnoreCase) && !cls.Equals("Printer", StringComparison.OrdinalIgnoreCase)
                    && !bus.StartsWith("USB", StringComparison.OrdinalIgnoreCase))
                    continue;
                var text = string.Join(" ", new[]
                {
                    Property(set, ref data, SPDRP_FRIENDLYNAME), Property(set, ref data, SPDRP_DEVICEDESC),
                    Property(set, ref data, SPDRP_MFG), BusName(set, ref data)
                }.Where(s => !string.IsNullOrWhiteSpace(s)));
                if (text.Length > 0) names.Add(Plain(text));
            }
        }
        finally
        {
            SetupDiDestroyDeviceInfoList(set);
        }
        return names;
    }

    // true: a device has its model; false: none has; null: its name has no
    // model to look for
    public static bool? Found(string name, IReadOnlyList<string> devices)
    {
        var models = Models(name);
        if (models.Count == 0) return null;
        return models.Any(m => devices.Any(d => d.Contains(m)));
    }

    // What in a name says which scanner it is: words with a digit in them
    // ("ff680w", "a300", "v600"; joined across a hyphen), else its unusual
    // words ("opticbook", "fastfoto"); never the maker's or "scanner"
    static List<string> Models(string name)
    {
        var words = System.Text.RegularExpressions.Regex.Split(name.ToLowerInvariant(), "[^a-z0-9-]+")
            .Where(w => w.Length > 0).ToList();
        var models = new List<string>();
        foreach (var w in words)
        {
            var joined = Plain(w);
            if (joined.Length >= 3 && joined.Any(char.IsDigit)) models.Add(joined);
            foreach (var part in w.Split('-'))
                if (part.Length >= 3 && part.Any(char.IsDigit) && part != joined) models.Add(part);
        }
        // A driver's own word that isn't a model ("twain2", "wia2") isn't one
        models.RemoveAll(m => m.StartsWith("twain") || m.StartsWith("wia") || m is "x64" or "x86" or "win32" or "win64");
        if (models.Count > 0) return models;
        return words.Select(Plain).Where(w => w.Length >= 4 && !Generic.Contains(w) && !Makers.Contains(w)).ToList();
    }

    static readonly string[] Generic = ["twain", "wia", "scanner", "scan", "series", "driver", "device", "usb", "network", "document", "photo", "image", "flatbed", "color", "colour", "software"];
    static readonly string[] Makers = ["epson", "canon", "plustek", "brother", "fujitsu", "ricoh", "kodak", "xerox", "visioneer", "avision", "panasonic", "lexmark", "samsung", "kyocera", "sharp", "konica", "minolta", "dell", "mustek", "microtek", "umax", "agfa", "nikon", "pfu", "imaging", "hewlett", "packard"];

    static string Plain(string s) => new(s.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());

    // ---- SetupAPI ----

    const uint DIGCF_PRESENT = 0x2, DIGCF_ALLCLASSES = 0x4;
    const uint SPDRP_DEVICEDESC = 0x0, SPDRP_CLASS = 0x7, SPDRP_MFG = 0xB, SPDRP_FRIENDLYNAME = 0xC, SPDRP_ENUMERATOR_NAME = 0x16;
    // DEVPKEY_Device_BusReportedDeviceDesc: the name the device gives itself
    // over USB, often the model when Windows' name for it is generic
    static readonly DEVPROPKEY BusReportedDesc = new() { fmtid = new Guid("540b947e-8b40-45bc-a8a2-6a0b894cbda2"), pid = 4 };

    static string? Property(IntPtr set, ref SP_DEVINFO_DATA data, uint property)
    {
        var buffer = new byte[1024];
        if (!SetupDiGetDeviceRegistryPropertyW(set, ref data, property, out _, buffer, (uint)buffer.Length, out var size)) return null;
        return Text(buffer, size);
    }

    static string? BusName(IntPtr set, ref SP_DEVINFO_DATA data)
    {
        var buffer = new byte[1024];
        var key = BusReportedDesc;
        if (!SetupDiGetDevicePropertyW(set, ref data, ref key, out _, buffer, (uint)buffer.Length, out var size, 0)) return null;
        return Text(buffer, size);
    }

    static string? Text(byte[] buffer, uint size)
    {
        var s = System.Text.Encoding.Unicode.GetString(buffer, 0, (int)Math.Min(size, (uint)buffer.Length)).TrimEnd('\0');
        return s.Length > 0 ? s.Replace('\0', ' ') : null;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SP_DEVINFO_DATA
    {
        public uint cbSize;
        public Guid ClassGuid;
        public uint DevInst;
        public IntPtr Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct DEVPROPKEY
    {
        public Guid fmtid;
        public uint pid;
    }

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr SetupDiGetClassDevsW(IntPtr classGuid, string? enumerator, IntPtr parent, uint flags);

    [DllImport("setupapi.dll", SetLastError = true)]
    static extern bool SetupDiEnumDeviceInfo(IntPtr set, uint index, ref SP_DEVINFO_DATA data);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetupDiGetDeviceRegistryPropertyW(IntPtr set, ref SP_DEVINFO_DATA data, uint property, out uint type, byte[] buffer, uint size, out uint required);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetupDiGetDevicePropertyW(IntPtr set, ref SP_DEVINFO_DATA data, ref DEVPROPKEY key, out uint type, byte[] buffer, uint size, out uint required, uint flags);

    [DllImport("setupapi.dll", SetLastError = true)]
    static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
}
