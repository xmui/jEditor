using System.Runtime.InteropServices;
using System.Text;

namespace JEditor.Camera;

// A Sony Alpha in PC Remote mode (A7 III, A7 IV and the like), over USB.
//
// The camera speaks PTP with Sony's extension: a handshake (SDIO connect),
// then all of its settings in one read (0x9209), the shutter as two
// "buttons" (half and full press, 0x9207), and photos waiting in its memory
// (ObjectInMemory, 0xD215 = 0x8000 + how many), each read from the same
// handle, 0xFFFFC001, until none are left. Live view is a JPEG at
// 0xFFFFC002. Shots taken with the camera's own shutter button turn up the
// same way, so they're imported too. This follows libgphoto2's Sony code
// (the protocol, not its code); nothing here needs Sony's SDK.
sealed class SonyCamera : ICamera
{
    static class Op
    {
        public const ushort GetDeviceInfo = 0x1001, GetObjectInfo = 0x1008, GetObject = 0x1009;
        public const ushort Connect = 0x9201, GetExtDeviceInfo = 0x9202, SetProp = 0x9205, Control = 0x9207, GetAllProps = 0x9209;
    }

    static class Prop
    {
        public const ushort FocusMode = 0x500A, FocusFound = 0xD213, ObjectInMemory = 0xD215,
            SaveTo = 0xD222, PriorityMode = 0xD25A, HalfPress = 0xD2C1, FullPress = 0xD2C2;
    }

    const uint CapturedImage = 0xFFFFC001, LiveViewImage = 0xFFFFC002;
    const ushort Ok = 0x2001, InvalidObjectHandle = 0x2009, AccessDenied = 0x200F;

    readonly string pnpId;
    IPortableDevice? device;
    MtpTransport? t;
    DateTime connectedAt;
    bool parseFailed;

    public SonyCamera(string pnpId, string name)
    {
        this.pnpId = pnpId;
        Name = name;
    }

    public string Name { get; private set; }
    public int Protocol { get; private set; }

    MtpTransport T => t ?? throw new InvalidOperationException("Not connected");

    static void Check(MtpResponse r, string what)
    {
        if (!r.Ok) throw new CameraException($"The camera said no to {what} (PTP 0x{r.ResponseCode:X4})");
    }

    public void Connect()
    {
        device = WpdDevices.Open(pnpId, "jEditor");
        t = new MtpTransport(device);
        var info = T.ExecuteRead(Op.GetDeviceInfo);
        Check(info, "its device info");
        var di = DeviceInfo.Parse(info.Data);
        if (!string.IsNullOrEmpty(di.Model)) Name = di.Model == "ILCE-7M3" ? "Sony A7 III (ILCE-7M3)" : di.Model == "ILCE-7M4" ? "Sony A7 IV (ILCE-7M4)" : $"{di.Manufacturer} {di.Model}".Trim();
        Log.Write($"Camera: {di.Manufacturer} {di.Model} {di.Version}, vendor extension 0x{di.VendorExtension:X}, {di.Operations.Count} operations");
        if (!di.Operations.Contains(Op.GetExtDeviceInfo))
            throw new CameraException("The camera isn't in PC Remote mode. On the camera: Menu → Network (or Setup) → USB Connection → PC Remote, then plug it in again.");

        // Sony's handshake. The data each step sends back isn't needed
        Check(T.ExecuteRead(Op.Connect, 1, 0, 0), "connecting (1)");
        Check(T.ExecuteRead(Op.Connect, 2, 0, 0), "connecting (2)");
        byte[] ext = [];
        for (int i = 0; i < 20 && ext.Length == 0; i++)
        {
            var r = T.ExecuteRead(Op.GetExtDeviceInfo, 0x12C, 1); // protocol 3.00, or the camera's best
            Check(r, "its settings list");
            ext = r.Data;
            if (ext.Length == 0) Thread.Sleep(50);
        }
        Protocol = ext.Length >= 2 ? BitConverter.ToUInt16(ext, 0) : 200;
        Check(T.ExecuteRead(Op.Connect, 3, 0, 0), "connecting (3)");
        var priority = T.ExecuteWrite(Op.SetProp, [1], Prop.PriorityMode); // jEditor, not the camera's dials
        if (!priority.Ok) Log.Write($"Camera: PC priority not taken (0x{priority.ResponseCode:X4})");
        connectedAt = DateTime.UtcNow;
        Log.Write($"Camera connected: {Name}, Sony protocol {Protocol / 100.0:0.00}");
    }

    public void KeepOnCard(bool keep)
    {
        // Still image save destination: PC only (1), or PC and the card (0x11)
        var r = T.ExecuteWrite(Op.SetProp, BitConverter.GetBytes((ushort)(keep ? 0x11 : 0x01)), Prop.SaveTo);
        Log.Write(r.Ok ? $"Camera: saving to {(keep ? "the PC and its card" : "the PC only")}" : $"Camera: couldn't set where it saves (0x{r.ResponseCode:X4}); its own menu decides");
    }

    Dictionary<ushort, long> Props()
    {
        var r = T.ExecuteRead(Op.GetAllProps);
        Check(r, "reading its settings");
        return ParseProps(r.Data, ref parseFailed);
    }

    // 0x9209: 8 bytes of header, then each setting: code, type, get/set,
    // enabled, default and current value, then a range or a list (Sony's
    // newer bodies send two lists). Only current values are kept
    public static Dictionary<ushort, long> ParseProps(byte[] data, ref bool failedBefore)
    {
        var props = new Dictionary<ushort, long>();
        var r = new Reader(data);
        try
        {
            if (data.Length <= 8) return props;
            r.Skip(8);
            while (r.Left >= 6)
            {
                ushort code = r.U16(), type = r.U16();
                r.U8(); // get/set
                r.U8(); // enabled
                r.Value(type);
                var current = r.Value(type);
                props[code] = current;
                if (r.Left < 1) break;
                var form = r.U8();
                if (form == 1)
                {
                    r.Value(type); r.Value(type); r.Value(type);
                }
                else if (form == 2)
                {
                    int n = r.U16();
                    for (int i = 0; i < n; i++) r.Value(type);
                    if (r.Left >= 2 && r.Peek16() < 0x200)
                    {
                        n = r.U16();
                        for (int i = 0; i < n; i++) r.Value(type);
                    }
                }
            }
        }
        catch (FormatException e)
        {
            // What was read so far still counts
            if (!failedBefore) Log.Write($"Camera: couldn't read all its settings ({e.Message}); {props.Count} read");
            failedBefore = true;
        }
        return props;
    }

    public int Waiting()
    {
        var p = Props();
        return p.TryGetValue(Prop.ObjectInMemory, out var v) && v > 0x8000 ? (int)(v - 0x8000) : 0;
    }

    public (string Name, byte[] Data) Download()
    {
        var oi = T.ExecuteRead(Op.GetObjectInfo, CapturedImage);
        Check(oi, "describing the photo");
        var name = ObjectName(oi.Data);
        var obj = T.ExecuteRead(Op.GetObject, CapturedImage);
        Check(obj, "sending the photo");
        Log.Write($"Camera: {name}, {obj.Data.Length / 1024} KB");
        return (name, obj.Data);
    }

    // ObjectInfo: the file name (after 52 bytes of fixed fields), and its
    // format if the name has no extension
    static string ObjectName(byte[] d)
    {
        var r = new Reader(d);
        r.Skip(4);
        var format = r.U16();
        r.Skip(46);
        var name = r.Str();
        if (string.IsNullOrWhiteSpace(name)) name = "capture";
        if (!Path.HasExtension(name)) name += format switch { 0xB101 => ".ARW", 0xB110 => ".HIF", _ => ".JPG" };
        return name;
    }

    public void Shutter()
    {
        // These bodies want a few seconds after connecting before a shot
        var wait = connectedAt.AddSeconds(3) - DateTime.UtcNow;
        if (wait > TimeSpan.Zero) Thread.Sleep(wait);
        Check(Press(Prop.HalfPress, 2), "half-pressing the shutter");
        Check(Press(Prop.FullPress, 2), "pressing the shutter");
        try
        {
            // Autofocus: up to a second to find focus
            var props = Props();
            if (!(props.TryGetValue(Prop.FocusMode, out var mode) && mode == 1))
            {
                var until = DateTime.UtcNow.AddSeconds(1);
                while (DateTime.UtcNow < until)
                {
                    if (Props().TryGetValue(Prop.FocusFound, out var f) && (f == 2 || f == 3)) break;
                    Thread.Sleep(30);
                }
            }
        }
        finally
        {
            Press(Prop.FullPress, 1);
            Press(Prop.HalfPress, 1);
        }
    }

    MtpResponse Press(ushort button, ushort value) => T.ExecuteWrite(Op.Control, BitConverter.GetBytes(value), button);

    public byte[]? LiveView()
    {
        for (int tries = 0; tries < 5; tries++)
        {
            MtpResponse oi;
            try { oi = T.ExecuteRead(Op.GetObjectInfo, LiveViewImage); }
            catch (COMException) { Thread.Sleep(30); continue; } // not ready (some drivers fail the call)
            if (oi.ResponseCode == InvalidObjectHandle) { Thread.Sleep(50); continue; }
            MtpResponse r;
            try { r = T.ExecuteRead(Op.GetObject, LiveViewImage); }
            catch (COMException) { Thread.Sleep(20); continue; }
            if (r.Ok) return LiveViewJpeg(r.Data);
            if (r.ResponseCode != AccessDenied) throw new CameraException($"Live view: PTP 0x{r.ResponseCode:X4}");
            Thread.Sleep(20);
        }
        return null;
    }

    // The frame's JPEG: from the offset in its first 4 bytes (if a JPEG
    // starts there), else the first one in it; to its end marker
    public static byte[]? LiveViewJpeg(byte[] d)
    {
        int start = -1;
        if (d.Length > 4)
        {
            long off = BitConverter.ToUInt32(d, 0);
            if (off + 1 < d.Length && d[off] == 0xFF && d[off + 1] == 0xD8) start = (int)off;
        }
        if (start < 0) for (int i = 0; i + 1 < d.Length; i++) if (d[i] == 0xFF && d[i + 1] == 0xD8) { start = i; break; }
        if (start < 0) return null;
        int end = d.Length;
        for (int i = start + 2; i + 1 < d.Length; i++) if (d[i] == 0xFF && d[i + 1] == 0xD9) { end = i + 2; break; }
        return d[start..end];
    }

    public void Dispose()
    {
        try { device?.Close(); } catch (Exception) { }
        if (device is not null) Marshal.ReleaseComObject(device);
        device = null;
        t = null;
    }

    // PTP's device info: who made it, which model, what it can do
    sealed record DeviceInfo(uint VendorExtension, HashSet<ushort> Operations, string Manufacturer, string Model, string Version)
    {
        public static DeviceInfo Parse(byte[] d)
        {
            var r = new Reader(d);
            r.U16();             // standard version
            var vendor = r.U32();
            r.U16();             // vendor extension version
            r.Str();             // vendor extension description
            r.U16();             // functional mode
            var ops = r.U16s();
            r.U16s();            // events
            r.U16s();            // properties
            r.U16s();            // capture formats
            r.U16s();            // image formats
            var maker = r.Str();
            var model = r.Str();
            var version = r.Str();
            return new DeviceInfo(vendor, [.. ops], maker, model, version);
        }
    }

    // Little-endian PTP data
    sealed class Reader(byte[] d)
    {
        int pos;
        public int Left => d.Length - pos;

        void Need(int n)
        {
            if (Left < n) throw new FormatException($"PTP data ends at {d.Length}, wanted {n} more at {pos}");
        }

        public void Skip(int n) { Need(n); pos += n; }
        public byte U8() { Need(1); return d[pos++]; }
        public ushort U16() { Need(2); var v = BitConverter.ToUInt16(d, pos); pos += 2; return v; }
        public ushort Peek16() { Need(2); return BitConverter.ToUInt16(d, pos); }
        public uint U32() { Need(4); var v = BitConverter.ToUInt32(d, pos); pos += 4; return v; }
        public ulong U64() { Need(8); var v = BitConverter.ToUInt64(d, pos); pos += 8; return v; }

        public List<ushort> U16s()
        {
            var n = U32();
            if (n > 10000) throw new FormatException($"a list of {n}");
            var list = new List<ushort>((int)n);
            for (int i = 0; i < n; i++) list.Add(U16());
            return list;
        }

        // PTP string: a count of UTF-16 units (with the closing 0), then them
        public string Str()
        {
            int n = U8();
            if (n == 0) return "";
            Need(n * 2);
            var s = Encoding.Unicode.GetString(d, pos, n * 2);
            pos += n * 2;
            var z = s.IndexOf('\0');
            return z >= 0 ? s[..z] : s;
        }

        // A value of a PTP data type, as a number (strings and arrays: 0)
        public long Value(ushort type)
        {
            switch (type)
            {
                case 1: return (sbyte)U8();
                case 2: return U8();
                case 3: return (short)U16();
                case 4: return U16();
                case 5: return (int)U32();
                case 6: return U32();
                case 7: return (long)U64();
                case 8: return (long)U64();
                case 9: case 10: Skip(16); return 0;
                case 0xFFFF: Str(); return 0;
            }
            if ((type & 0x4000) != 0)
            {
                var n = U32();
                if (n > 100000) throw new FormatException($"an array of {n}");
                for (int i = 0; i < n; i++) Value((ushort)(type & ~0x4000));
                return 0;
            }
            throw new FormatException($"PTP data type 0x{type:X4}");
        }
    }
}

sealed class CameraException(string message) : Exception(message);
