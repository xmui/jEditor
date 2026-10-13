// PTP operations sent through WPD's MTP vendor-extension commands: the
// camera's own (Sony's) operations, which Windows passes on as they are.
using System.Runtime.InteropServices;
using static JEditor.Camera.Com;

namespace JEditor.Camera
{
    public sealed class MtpResponse
    {
        public ushort ResponseCode;            // 0x2001 = OK
        public uint[] ResponseParams = Array.Empty<uint>();
        public byte[] Data = Array.Empty<byte>();
        public bool Ok => ResponseCode == 0x2001;
    }

    /// <summary>Raw PTP/MTP operations through WPD_CATEGORY_MTP_EXT_VENDOR_OPERATIONS.
    /// Use from ONE thread (all COM objects created on it).</summary>
    public sealed class MtpTransport
    {
        readonly IPortableDevice _dev;
        public MtpTransport(IPortableDevice openedDevice) { _dev = openedDevice; }

        // ---------- small helpers (keys are copied into locals because COM methods take them by ref) ----------
        static IPortableDeviceValues NewValues() => Create<IPortableDeviceValues>(Clsid.PortableDeviceValues);

        static void SetU32(IPortableDeviceValues v, PropertyKey k, uint x) => Check(v.SetUnsignedIntegerValue(ref k, x), "SetUnsignedIntegerValue");
        static void SetU64(IPortableDeviceValues v, PropertyKey k, ulong x) => Check(v.SetUnsignedLargeIntegerValue(ref k, x), "SetUnsignedLargeIntegerValue");
        static void SetStr(IPortableDeviceValues v, PropertyKey k, string s) => Check(v.SetStringValue(ref k, s), "SetStringValue");
        static void SetBuf(IPortableDeviceValues v, PropertyKey k, byte[] b, uint n)
        {
            if (n > b.Length) throw new ArgumentOutOfRangeException(nameof(n));
            var h = GCHandle.Alloc(b, GCHandleType.Pinned);
            try { Check(v.SetBufferValue(ref k, h.AddrOfPinnedObject(), n), "SetBufferValue"); }
            finally { h.Free(); }
        }
        static uint GetU32(IPortableDeviceValues v, PropertyKey k) { Check(v.GetUnsignedIntegerValue(ref k, out uint x), "GetUnsignedIntegerValue"); return x; }
        static bool TryGetU32(IPortableDeviceValues v, PropertyKey k, out uint x) => v.GetUnsignedIntegerValue(ref k, out x) >= 0;
        static ulong GetU64(IPortableDeviceValues v, PropertyKey k) { Check(v.GetUnsignedLargeIntegerValue(ref k, out ulong x), "GetUnsignedLargeIntegerValue"); return x; }
        static string GetStr(IPortableDeviceValues v, PropertyKey k) { Check(v.GetStringValue(ref k, out string s), "GetStringValue"); return s; }

        static IPortableDeviceValues NewCommand(PropertyKey command)
        {
            var v = NewValues();
            var catKey = WpdKeys.COMMON_COMMAND_CATEGORY;
            var cat = command.fmtid;
            Check(v.SetGuidValue(ref catKey, ref cat), "SetGuidValue(category)");
            SetU32(v, WpdKeys.COMMON_COMMAND_ID, command.pid);
            return v;
        }

        static void SetOperation(IPortableDeviceValues v, ushort opcode, uint[] parameters)
        {
            SetU32(v, WpdKeys.MTP_EXT_OPERATION_CODE, opcode);
            var col = Create<IPortableDevicePropVariantCollection>(Clsid.PortableDevicePropVariantCollection);
            foreach (uint p in parameters)
            {
                var pv = PropVariant.FromUInt32(p);
                Check(col.Add(ref pv), "PropVariantCollection.Add");   // VT_UI4 owns nothing: no clear needed
            }
            var k = WpdKeys.MTP_EXT_OPERATION_PARAMS;                    // always set, even when empty
            Check(v.SetIPortableDevicePropVariantCollectionValue(ref k, col), "Set OPERATION_PARAMS");
            Marshal.ReleaseComObject(col);
        }

        IPortableDeviceValues Send(IPortableDeviceValues cmd)
        {
            Check(_dev.SendCommand(0, cmd, out var results), "SendCommand");
            var k = WpdKeys.COMMON_HRESULT;
            Check(results.GetErrorValue(ref k, out int hr), "Get WPD_PROPERTY_COMMON_HRESULT");
            Check(hr, "driver (WPD_PROPERTY_COMMON_HRESULT)");
            return results;
        }

        static void ReadResponse(IPortableDeviceValues r, MtpResponse resp)
        {
            resp.ResponseCode = (ushort)GetU32(r, WpdKeys.MTP_EXT_RESPONSE_CODE);
            var k = WpdKeys.MTP_EXT_RESPONSE_PARAMS;
            if (r.GetIPortableDevicePropVariantCollectionValue(ref k, out var col) >= 0 && col != null)
            {
                Check(col.GetCount(out uint n), "GetCount");
                var list = new List<uint>((int)n);
                for (uint i = 0; i < n; i++)
                {
                    var pv = new PropVariant();
                    Check(col.GetAt(i, ref pv), "GetAt");
                    list.Add(pv.AsUInt32());
                    NativeMethods.PropVariantClear(ref pv);
                }
                resp.ResponseParams = list.ToArray();
                Marshal.ReleaseComObject(col);
            }
        }

        // ---------- the three transaction shapes ----------

        public MtpResponse ExecuteNoData(ushort opcode, params uint[] parameters)
        {
            var cmd = NewCommand(WpdKeys.CMD_EXECUTE_COMMAND_WITHOUT_DATA_PHASE);
            SetOperation(cmd, opcode, parameters);
            var r = Send(cmd);
            var resp = new MtpResponse();
            ReadResponse(r, resp);
            return resp;
        }

        public MtpResponse ExecuteRead(ushort opcode, params uint[] parameters)
        {
            var cmd = NewCommand(WpdKeys.CMD_EXECUTE_COMMAND_WITH_DATA_TO_READ);
            SetOperation(cmd, opcode, parameters);
            var r = Send(cmd);
            ulong total = GetU64(r, WpdKeys.MTP_EXT_TRANSFER_TOTAL_DATA_SIZE);
            uint chunk = TryGetU32(r, WpdKeys.MTP_EXT_OPTIMAL_TRANSFER_BUFFER_SIZE, out uint opt) && opt > 0 ? opt : 256 * 1024;
            string context = GetStr(r, WpdKeys.MTP_EXT_TRANSFER_CONTEXT);
            bool unknownSize = total == 0xFFFFFFFF;

            var resp = new MtpResponse();
            var ms = new MemoryStream(unknownSize ? 0 : (int)Math.Min(total, int.MaxValue));
            var buf = new byte[chunk];
            try
            {
                ulong done = 0;
                while (unknownSize || done < total)
                {
                    uint want = unknownSize ? chunk : (uint)Math.Min(chunk, total - done);
                    var rd = NewCommand(WpdKeys.CMD_READ_DATA);
                    SetStr(rd, WpdKeys.MTP_EXT_TRANSFER_CONTEXT, context);
                    SetU32(rd, WpdKeys.MTP_EXT_TRANSFER_NUM_BYTES_TO_READ, want);
                    SetBuf(rd, WpdKeys.MTP_EXT_TRANSFER_DATA, buf, want);       // required input buffer
                    var rr = Send(rd);
                    uint got = GetU32(rr, WpdKeys.MTP_EXT_TRANSFER_NUM_BYTES_READ);
                    var dk = WpdKeys.MTP_EXT_TRANSFER_DATA;
                    Check(rr.GetBufferValue(ref dk, out IntPtr p, out uint cb), "GetBufferValue");
                    try
                    {
                        int n = (int)Math.Min(got, cb);
                        if (n > 0) { var tmp = new byte[n]; Marshal.Copy(p, tmp, 0, n); ms.Write(tmp, 0, n); }
                    }
                    finally { Marshal.FreeCoTaskMem(p); }
                    Marshal.ReleaseComObject(rr);
                    Marshal.ReleaseComObject(rd);
                    done += got;
                    if (got < want || got == 0) break;                            // short chunk = end of data
                }
            }
            finally
            {
                // ALWAYS end the transfer, also after an exception, or the driver keeps the transaction open.
                var end = NewCommand(WpdKeys.CMD_END_DATA_TRANSFER);
                SetStr(end, WpdKeys.MTP_EXT_TRANSFER_CONTEXT, context);
                var er = Send(end);
                ReadResponse(er, resp);
            }
            resp.Data = ms.ToArray();
            return resp;
        }

        public MtpResponse ExecuteWrite(ushort opcode, byte[] data, params uint[] parameters)
        {
            var cmd = NewCommand(WpdKeys.CMD_EXECUTE_COMMAND_WITH_DATA_TO_WRITE);
            SetOperation(cmd, opcode, parameters);
            SetU64(cmd, WpdKeys.MTP_EXT_TRANSFER_TOTAL_DATA_SIZE, (ulong)data.Length);   // required
            var r = Send(cmd);
            uint chunk = TryGetU32(r, WpdKeys.MTP_EXT_OPTIMAL_TRANSFER_BUFFER_SIZE, out uint opt) && opt > 0 ? opt : 256 * 1024;
            string context = GetStr(r, WpdKeys.MTP_EXT_TRANSFER_CONTEXT);
            var resp = new MtpResponse();
            try
            {
                int off = 0;
                while (off < data.Length)
                {
                    int n = Math.Min((int)chunk, data.Length - off);
                    byte[] piece = (off == 0 && n == data.Length) ? data : data.AsSpan(off, n).ToArray();
                    var wr = NewCommand(WpdKeys.CMD_WRITE_DATA);
                    SetStr(wr, WpdKeys.MTP_EXT_TRANSFER_CONTEXT, context);
                    SetU32(wr, WpdKeys.MTP_EXT_TRANSFER_NUM_BYTES_TO_WRITE, (uint)n);
                    SetBuf(wr, WpdKeys.MTP_EXT_TRANSFER_DATA, piece, (uint)n);
                    var wres = Send(wr);
                    uint written = GetU32(wres, WpdKeys.MTP_EXT_TRANSFER_NUM_BYTES_WRITTEN);
                    if (written == 0) throw new IOException("WRITE_DATA wrote 0 bytes");
                    off += (int)written;
                }
            }
            finally
            {
                var end = NewCommand(WpdKeys.CMD_END_DATA_TRANSFER);
                SetStr(end, WpdKeys.MTP_EXT_TRANSFER_CONTEXT, context);
                ReadResponse(Send(end), resp);
            }
            return resp;
        }
    }

    public static class WpdDevices
    {
        public static string[] GetDeviceIds(IPortableDeviceManager mgr)
        {
            mgr.RefreshDeviceList();
            uint count = 0;
            Check(mgr.GetDevices(IntPtr.Zero, ref count), "GetDevices(count)");
            if (count == 0) return Array.Empty<string>();
            var list = Marshal.AllocHGlobal(IntPtr.Size * (int)count);
            try
            {
                for (int i = 0; i < count; i++) Marshal.WriteIntPtr(list, i * IntPtr.Size, IntPtr.Zero);
                Check(mgr.GetDevices(list, ref count), "GetDevices");
                var ids = new List<string>((int)count);
                for (int i = 0; i < count; i++)
                {
                    var p = Marshal.ReadIntPtr(list, i * IntPtr.Size);
                    if (p == IntPtr.Zero) continue;
                    ids.Add(Marshal.PtrToStringUni(p)!);
                    Marshal.FreeCoTaskMem(p);
                }
                return ids.ToArray();
            }
            finally
            {
                Marshal.FreeHGlobal(list);
            }
        }

        public delegate int StringGetter(string id, IntPtr buffer, ref uint chars);

        /// <summary>Two-call pattern: first call with NULL buffer returns required size in WCHARs (incl. NUL).</summary>
        public static string GetString(StringGetter getter, string id)
        {
            uint chars = 0;
            if (getter(id, IntPtr.Zero, ref chars) < 0 || chars == 0) return "";
            IntPtr buf = Marshal.AllocCoTaskMem((int)chars * 2);
            try { Check(getter(id, buf, ref chars), "GetDeviceXxx"); return Marshal.PtrToStringUni(buf) ?? ""; }
            finally { Marshal.FreeCoTaskMem(buf); }
        }

        public static IPortableDevice Open(string pnpId, string appName)
        {
            var info = Create<IPortableDeviceValues>(Clsid.PortableDeviceValues);
            var k = WpdKeys.CLIENT_NAME; info.SetStringValue(ref k, appName);
            k = WpdKeys.CLIENT_MAJOR_VERSION; info.SetUnsignedIntegerValue(ref k, 1);
            k = WpdKeys.CLIENT_MINOR_VERSION; info.SetUnsignedIntegerValue(ref k, 0);
            k = WpdKeys.CLIENT_REVISION; info.SetUnsignedIntegerValue(ref k, 0);
            k = WpdKeys.CLIENT_SECURITY_QUALITY_OF_SERVICE; info.SetUnsignedIntegerValue(ref k, WpdKeys.SECURITY_IMPERSONATION);
            // WPD_CLIENT_DESIRED_ACCESS left at default (GENERIC_READ|GENERIC_WRITE): vendor ops need write access.
            var dev = Create<IPortableDevice>(Clsid.PortableDeviceFTM);
            Check(dev.Open(pnpId, info), "IPortableDevice.Open");
            return dev;
        }

        /// <summary>Parses "...usb#vid_054c&amp;pid_0c34#..." from a WPD PnP device id.</summary>
        public static (ushort vid, ushort pid)? ParseVidPid(string pnpId)
        {
            string s = pnpId.ToLowerInvariant();
            int v = s.IndexOf("vid_", StringComparison.Ordinal), p = s.IndexOf("pid_", StringComparison.Ordinal);
            if (v < 0 || p < 0 || v + 8 > s.Length || p + 8 > s.Length) return null;
            if (ushort.TryParse(s.AsSpan(v + 4, 4), System.Globalization.NumberStyles.HexNumber, null, out ushort vid) &&
                ushort.TryParse(s.AsSpan(p + 4, 4), System.Globalization.NumberStyles.HexNumber, null, out ushort pid))
                return (vid, pid);
            return null;
        }
    }

    /// <summary>Event sink. OnEvent arrives on a WPD worker thread: marshal to the UI with BeginInvoke.</summary>
    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public sealed class WpdEventSink : IPortableDeviceEventCallback
    {
        public event Action<ushort, uint[]>? VendorEvent;   // (PTP event code, params)

        public int OnEvent(IPortableDeviceValues e)
        {
            try
            {
                var k = WpdKeys.EVENT_PARAMETER_EVENT_ID;
                if (e.GetGuidValue(ref k, out Guid id) < 0) return 0;
                byte[] b = id.ToByteArray(), t = WpdKeys.EVENT_MTP_VENDOR_EXTENDED_EVENTS.ToByteArray();
                for (int i = 4; i < 16; i++) if (b[i] != t[i]) return 0;          // not a vendor-extended MTP event
                ushort code = (ushort)(b[2] | (b[3] << 8));
                var pk = WpdKeys.MTP_EXT_EVENT_PARAMS;
                var ps = new List<uint>();
                if (e.GetIPortableDevicePropVariantCollectionValue(ref pk, out var col) >= 0 && col != null)
                {
                    col.GetCount(out uint n);
                    for (uint i = 0; i < n; i++)
                    {
                        var pv = new PropVariant();
                        if (col.GetAt(i, ref pv) >= 0 && pv.vt == PropVariant.VT_UI4) ps.Add(pv.AsUInt32());
                        NativeMethods.PropVariantClear(ref pv);
                    }
                    Marshal.ReleaseComObject(col);
                }
                VendorEvent?.Invoke(code, ps.ToArray());
            }
            catch { /* never throw across COM */ }
            return 0; // S_OK
        }
    }
}
