// Windows Portable Devices (WPD): how jEditor talks to a camera on USB,
// through Windows' own camera driver. The COM interfaces are declared by
// hand (vtable order as in PortableDeviceApi.h / PortableDeviceTypes.h), so
// nothing needs generating at build time.
using System.Runtime.InteropServices;

namespace JEditor.Camera
{
    [StructLayout(LayoutKind.Sequential)]
    public struct PropertyKey
    {
        public Guid fmtid;
        public uint pid;
        public PropertyKey(Guid fmtid, uint pid) { this.fmtid = fmtid; this.pid = pid; }
    }

    // PROPVARIANT: vt(2) + 3 reserved WORDs(6) + 16-byte (x64) / 8-byte (x86) union.
    // Two pointer-sized fields give exactly 24 bytes on x64 and 16 bytes on x86.
    [StructLayout(LayoutKind.Sequential)]
    public struct PropVariant
    {
        public ushort vt;
        public ushort wReserved1, wReserved2, wReserved3;
        public IntPtr p1;   // union bytes 8..15 (x64) / 8..11 (x86): ulVal lives in the low 4 bytes
        public IntPtr p2;   // union bytes 16..23 (x64) / 12..15 (x86)

        public const ushort VT_EMPTY = 0, VT_ERROR = 10, VT_UNKNOWN = 13, VT_UI1 = 17,
                            VT_UI4 = 19, VT_UI8 = 21, VT_LPWSTR = 31, VT_CLSID = 72, VT_VECTOR = 0x1000;

        public static PropVariant FromUInt32(uint value)
            => new PropVariant { vt = VT_UI4, p1 = unchecked((nint)value) };   // zero-extended on x64

        public uint AsUInt32()
        {
            if (vt != VT_UI4) throw new InvalidCastException($"PROPVARIANT vt={vt}, expected VT_UI4");
            return unchecked((uint)(nuint)p1);                                 // low 32 bits = ulVal
        }
    }

    internal static class NativeMethods
    {
        [DllImport("ole32.dll")] internal static extern int PropVariantClear(ref PropVariant pvar);
    }

    [ComImport, Guid("a1567595-4c2f-4574-a6fa-ecef917b9a40"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPortableDeviceManager
    {
        // Arrays are raw pointers here: in COM interop .NET would pass an
        // array as a SAFEARRAY, and Windows writes a plain C array into it
        [PreserveSig] int GetDevices(IntPtr deviceIds, ref uint count);           // LPWSTR[count]; each: CoTaskMemFree
        [PreserveSig] int RefreshDeviceList();
        [PreserveSig] int GetDeviceFriendlyName([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr buffer, ref uint chars);
        [PreserveSig] int GetDeviceDescription([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr buffer, ref uint chars);
        [PreserveSig] int GetDeviceManufacturer([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr buffer, ref uint chars);
        [PreserveSig] int GetDeviceProperty([MarshalAs(UnmanagedType.LPWStr)] string deviceId,
                                            [MarshalAs(UnmanagedType.LPWStr)] string propertyName,
                                            IntPtr data, ref uint dataSize, ref uint regType);
        [PreserveSig] int GetPrivateDevices(IntPtr deviceIds, ref uint count);
    }

    [ComImport, Guid("625e2df8-6392-4cf0-9ad1-3cfa5f17775c"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPortableDevice
    {
        [PreserveSig] int Open([MarshalAs(UnmanagedType.LPWStr)] string pnpDeviceId, IPortableDeviceValues clientInfo);
        [PreserveSig] int SendCommand(uint flags, IPortableDeviceValues parameters, out IPortableDeviceValues results);
        [PreserveSig] int Content(out IntPtr content);              // IPortableDeviceContent** (unused here; Release if called)
        [PreserveSig] int Capabilities(out IntPtr capabilities);    // IPortableDeviceCapabilities** (unused here)
        [PreserveSig] int Cancel();
        [PreserveSig] int Close();
        [PreserveSig] int Advise(uint flags, IPortableDeviceEventCallback callback, IPortableDeviceValues? parameters,
                                 [MarshalAs(UnmanagedType.LPWStr)] out string cookie);
        [PreserveSig] int Unadvise([MarshalAs(UnmanagedType.LPWStr)] string cookie);
        [PreserveSig] int GetPnPDeviceID([MarshalAs(UnmanagedType.LPWStr)] out string pnpDeviceId);
    }

    [ComImport, Guid("a8792a31-f385-493c-a893-40f64eb45f6e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPortableDeviceEventCallback
    {
        [PreserveSig] int OnEvent(IPortableDeviceValues eventParameters);
    }

    [ComImport, Guid("6848f6f2-3155-4f86-b6f5-263eeeab3143"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPortableDeviceValues
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);                // PropVariantClear afterwards
        [PreserveSig] int SetStringValue(ref PropertyKey key, [MarshalAs(UnmanagedType.LPWStr)] string value);
        [PreserveSig] int GetStringValue(ref PropertyKey key, [MarshalAs(UnmanagedType.LPWStr)] out string value);
        [PreserveSig] int SetUnsignedIntegerValue(ref PropertyKey key, uint value);
        [PreserveSig] int GetUnsignedIntegerValue(ref PropertyKey key, out uint value);
        [PreserveSig] int SetSignedIntegerValue(ref PropertyKey key, int value);
        [PreserveSig] int GetSignedIntegerValue(ref PropertyKey key, out int value);
        [PreserveSig] int SetUnsignedLargeIntegerValue(ref PropertyKey key, ulong value);
        [PreserveSig] int GetUnsignedLargeIntegerValue(ref PropertyKey key, out ulong value);
        [PreserveSig] int SetSignedLargeIntegerValue(ref PropertyKey key, long value);
        [PreserveSig] int GetSignedLargeIntegerValue(ref PropertyKey key, out long value);
        [PreserveSig] int SetFloatValue(ref PropertyKey key, float value);
        [PreserveSig] int GetFloatValue(ref PropertyKey key, out float value);
        [PreserveSig] int SetErrorValue(ref PropertyKey key, int value);
        [PreserveSig] int GetErrorValue(ref PropertyKey key, out int value);
        [PreserveSig] int SetKeyValue(ref PropertyKey key, ref PropertyKey value);
        [PreserveSig] int GetKeyValue(ref PropertyKey key, out PropertyKey value);
        [PreserveSig] int SetBoolValue(ref PropertyKey key, int value);                         // BOOL
        [PreserveSig] int GetBoolValue(ref PropertyKey key, out int value);
        [PreserveSig] int SetIUnknownValue(ref PropertyKey key, [MarshalAs(UnmanagedType.IUnknown)] object value);
        [PreserveSig] int GetIUnknownValue(ref PropertyKey key, [MarshalAs(UnmanagedType.IUnknown)] out object value);
        [PreserveSig] int SetGuidValue(ref PropertyKey key, ref Guid value);
        [PreserveSig] int GetGuidValue(ref PropertyKey key, out Guid value);
        [PreserveSig] int SetBufferValue(ref PropertyKey key, IntPtr value, uint byteCount);  // BYTE*: the values copy it
        [PreserveSig] int GetBufferValue(ref PropertyKey key, out IntPtr value, out uint byteCount); // CoTaskMemFree
        [PreserveSig] int SetIPortableDeviceValuesValue(ref PropertyKey key, IPortableDeviceValues value);
        [PreserveSig] int GetIPortableDeviceValuesValue(ref PropertyKey key, out IPortableDeviceValues value);
        [PreserveSig] int SetIPortableDevicePropVariantCollectionValue(ref PropertyKey key, IPortableDevicePropVariantCollection value);
        [PreserveSig] int GetIPortableDevicePropVariantCollectionValue(ref PropertyKey key, out IPortableDevicePropVariantCollection value);
        [PreserveSig] int SetIPortableDeviceKeyCollectionValue(ref PropertyKey key, IntPtr value);        // unused
        [PreserveSig] int GetIPortableDeviceKeyCollectionValue(ref PropertyKey key, out IntPtr value);    // unused
        [PreserveSig] int SetIPortableDeviceValuesCollectionValue(ref PropertyKey key, IntPtr value);     // unused
        [PreserveSig] int GetIPortableDeviceValuesCollectionValue(ref PropertyKey key, out IntPtr value); // unused
        [PreserveSig] int RemoveValue(ref PropertyKey key);
        [PreserveSig] int CopyValuesFromPropertyStore(IntPtr propertyStore);                               // unused
        [PreserveSig] int CopyValuesToPropertyStore(IntPtr propertyStore);                                 // unused
        [PreserveSig] int Clear();
    }

    [ComImport, Guid("89b2e422-4f1b-4316-bcef-a44afea83eb3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPortableDevicePropVariantCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, ref PropVariant value);   // fills a copy: PropVariantClear afterwards
        [PreserveSig] int Add(ref PropVariant value);                 // collection copies the value
        [PreserveSig] int GetVarType(out ushort vt);                  // "GetType" in the IDL; renamed (name is irrelevant to the vtable)
        [PreserveSig] int ChangeType(ushort vt);
        [PreserveSig] int Clear();
        [PreserveSig] int RemoveAt(uint index);
    }

    public static class Clsid
    {
        public static readonly Guid PortableDeviceManager = new("0af10cec-2ecd-4b92-9581-34f6ae0637f3");
        public static readonly Guid PortableDevice = new("728a21c5-3d9e-48d7-9810-864848f0f404");
        public static readonly Guid PortableDeviceFTM = new("f7c0039a-4762-488a-b4b3-760ef9a1ba9b");
        public static readonly Guid PortableDeviceValues = new("0c15d503-d017-47ce-9016-7b3f978721cc");
        public static readonly Guid PortableDevicePropVariantCollection = new("08a99e2f-6d6d-4b80-af5a-baf2bcbe4cb9");
    }

    public static class WpdKeys
    {
        static readonly Guid Common = new("f0422a9c-5dc8-4440-b5bd-5df28835658a");          // WPD_CATEGORY_COMMON
        public static readonly PropertyKey COMMON_COMMAND_CATEGORY = new(Common, 1001);
        public static readonly PropertyKey COMMON_COMMAND_ID = new(Common, 1002);
        public static readonly PropertyKey COMMON_HRESULT = new(Common, 1003);
        public static readonly PropertyKey COMMON_DRIVER_ERROR_CODE = new(Common, 1004);

        static readonly Guid Client = new("204d9f0c-2292-4080-9f42-40664e70f859");          // WPD_CLIENT_INFORMATION_PROPERTIES_V1
        public static readonly PropertyKey CLIENT_NAME = new(Client, 2);
        public static readonly PropertyKey CLIENT_MAJOR_VERSION = new(Client, 3);
        public static readonly PropertyKey CLIENT_MINOR_VERSION = new(Client, 4);
        public static readonly PropertyKey CLIENT_REVISION = new(Client, 5);
        public static readonly PropertyKey CLIENT_SECURITY_QUALITY_OF_SERVICE = new(Client, 8);
        public static readonly PropertyKey CLIENT_DESIRED_ACCESS = new(Client, 9);
        public static readonly PropertyKey CLIENT_SHARE_MODE = new(Client, 10);
        public const uint SECURITY_IMPERSONATION = 2u << 16;                                 // SecurityImpersonation << 16 = 0x20000

        static readonly Guid Event = new("15ab1953-f817-4fef-a921-5676e838f6e0");           // WPD_EVENT_PROPERTIES_V1
        public static readonly PropertyKey EVENT_PARAMETER_PNP_DEVICE_ID = new(Event, 2);
        public static readonly PropertyKey EVENT_PARAMETER_EVENT_ID = new(Event, 3);

        // WpdMtpExtensions.h
        public static readonly Guid CATEGORY_MTP_EXT_VENDOR_OPERATIONS = new("4d545058-1a2e-4106-a357-771e0819fc56");
        static readonly Guid X = CATEGORY_MTP_EXT_VENDOR_OPERATIONS;
        public static readonly PropertyKey CMD_GET_SUPPORTED_VENDOR_OPCODES = new(X, 11);
        public static readonly PropertyKey CMD_EXECUTE_COMMAND_WITHOUT_DATA_PHASE = new(X, 12);
        public static readonly PropertyKey CMD_EXECUTE_COMMAND_WITH_DATA_TO_READ = new(X, 13);
        public static readonly PropertyKey CMD_EXECUTE_COMMAND_WITH_DATA_TO_WRITE = new(X, 14);
        public static readonly PropertyKey CMD_READ_DATA = new(X, 15);
        public static readonly PropertyKey CMD_WRITE_DATA = new(X, 16);
        public static readonly PropertyKey CMD_END_DATA_TRANSFER = new(X, 17);
        public static readonly PropertyKey CMD_GET_VENDOR_EXTENSION_DESCRIPTION = new(X, 18);
        public static readonly PropertyKey MTP_EXT_OPERATION_CODE = new(X, 1001);              // VT_UI4
        public static readonly PropertyKey MTP_EXT_OPERATION_PARAMS = new(X, 1002);            // VT_UNKNOWN (PropVariantCollection of VT_UI4)
        public static readonly PropertyKey MTP_EXT_RESPONSE_CODE = new(X, 1003);               // VT_UI4
        public static readonly PropertyKey MTP_EXT_RESPONSE_PARAMS = new(X, 1004);             // VT_UNKNOWN
        public static readonly PropertyKey MTP_EXT_VENDOR_OPERATION_CODES = new(X, 1005);      // VT_UNKNOWN
        public static readonly PropertyKey MTP_EXT_TRANSFER_CONTEXT = new(X, 1006);            // VT_LPWSTR
        public static readonly PropertyKey MTP_EXT_TRANSFER_TOTAL_DATA_SIZE = new(X, 1007);    // VT_UI8
        public static readonly PropertyKey MTP_EXT_TRANSFER_NUM_BYTES_TO_READ = new(X, 1008);  // VT_UI4
        public static readonly PropertyKey MTP_EXT_TRANSFER_NUM_BYTES_READ = new(X, 1009);     // VT_UI4
        public static readonly PropertyKey MTP_EXT_TRANSFER_NUM_BYTES_TO_WRITE = new(X, 1010); // VT_UI4
        public static readonly PropertyKey MTP_EXT_TRANSFER_NUM_BYTES_WRITTEN = new(X, 1011);  // VT_UI4
        public static readonly PropertyKey MTP_EXT_TRANSFER_DATA = new(X, 1012);               // VT_VECTOR|VT_UI1
        public static readonly PropertyKey MTP_EXT_OPTIMAL_TRANSFER_BUFFER_SIZE = new(X, 1013);// VT_UI4
        public static readonly PropertyKey MTP_EXT_VENDOR_EXTENSION_DESCRIPTION = new(X, 1014);// VT_LPWSTR

        // Vendor events: driver puts the 16-bit event code into the top 16 bits of Data1.
        public static readonly Guid EVENT_MTP_VENDOR_EXTENDED_EVENTS = new("00000000-5738-4ff2-8445-be3126691059");
        public static readonly PropertyKey MTP_EXT_EVENT_PARAMS =
            new(new Guid("4d545058-ef88-4e4d-95c3-4f327f728a96"), 1011);                      // VT_UNKNOWN (PropVariantCollection of VT_UI4)

        public static Guid VendorEventGuid(ushort eventCode)
        {
            byte[] b = EVENT_MTP_VENDOR_EXTENDED_EVENTS.ToByteArray();    // Data1 is little-endian in bytes 0..3
            b[2] = (byte)(eventCode & 0xFF);
            b[3] = (byte)(eventCode >> 8);
            return new Guid(b);
        }
    }

    public static class Com
    {
        public static T Create<T>(Guid clsid) where T : class
            => (T)Activator.CreateInstance(Type.GetTypeFromCLSID(clsid, throwOnError: true)!)!;

        public static void Check(int hr, string what)
        {
            if (hr < 0) throw new COMException($"{what} failed: 0x{hr:X8}", hr);
        }
    }
}
