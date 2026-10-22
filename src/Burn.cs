using System.Collections;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace JEditor;

// Burning a project onto a CD or DVD (Blu-ray too), with Windows' own
// IMAPI2: no admin, nothing installed. The disc burners and what's in them
// (Burners), and a folder written onto a blank disc as a data disc that
// any computer reads (ISO 9660, Joliet and UDF), its name the project's,
// how far it's got as it goes, and the disc ejected after (Write).
//
// IMAPI2 is used through late binding (dynamic): its COM objects by their
// ProgIDs, no interop assembly. Progress comes from the write's Update
// events (DDiscFormat2DataEvents), taken by a small sink; if they can't be
// had, the burn still goes, without a percentage.
static class Burn
{
    const int FsIso9660 = 1, FsJoliet = 2, FsUdf = 4;
    const int SectorSize = 2048;

    static dynamic Create(string progId)
    {
        var type = Type.GetTypeFromProgID(progId) ?? throw new InvalidOperationException("Burning discs isn't available on this PC");
        return Activator.CreateInstance(type) ?? throw new InvalidOperationException("Burning discs isn't available on this PC");
    }

    // IMAPI_MEDIA_PHYSICAL_TYPE → a name
    static string MediaName(int type) => type switch
    {
        1 => "CD-ROM", 2 => "CD-R", 3 => "CD-RW",
        4 => "DVD-ROM", 5 => "DVD-RAM", 6 => "DVD+R", 7 => "DVD+RW", 8 => "DVD+R DL",
        9 => "DVD-R", 10 => "DVD-RW", 11 => "DVD-R DL", 12 => "Disc",
        13 => "DVD+RW DL", 14 => "HD DVD-ROM", 15 => "HD DVD-R", 16 => "HD DVD-RAM",
        17 => "BD-ROM", 18 => "BD-R", 19 => "BD-RE",
        _ => "Disc"
    };

    // IMAPI2 on a thread of its own (a single-threaded apartment, as its
    // COM objects like best), so the window keeps going while it burns
    public static Task<T> RunAsync<T>(Func<T> work)
    {
        var done = new TaskCompletionSource<T>();
        var thread = new Thread(() =>
        {
            try { done.SetResult(work()); }
            catch (Exception ex) { done.SetException(ex); }
        }) { IsBackground = true, Name = "jEditor burn" };
        if (OperatingSystem.IsWindows()) thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return done.Task;
    }

    // Every burner: { id, name, drive, media, blank, free (bytes), canWrite }
    public static List<object> Burners()
    {
        var list = new List<object>();
        dynamic master;
        try { master = Create("IMAPI2.MsftDiscMaster2"); } catch { return list; }
        if (!(bool)master.IsSupportedEnvironment) return list;
        foreach (object o in (IEnumerable)master)
        {
            var id = o as string;
            if (string.IsNullOrEmpty(id)) continue;
            try
            {
                dynamic rec = Create("IMAPI2.MsftDiscRecorder2");
                rec.InitializeDiscRecorder(id);
                string name = $"{((string)rec.VendorId ?? "").Trim()} {((string)rec.ProductId ?? "").Trim()}".Trim();
                string drive = "";
                if (rec.VolumePathNames is object[] paths && paths.Length > 0) drive = paths[0] as string ?? "";
                dynamic fmt = Create("IMAPI2.MsftDiscFormat2Data");
                bool supported = (bool)fmt.IsRecorderSupported(rec);
                string media = "none";
                bool blank = false, inside = false;
                long free = 0;
                if (supported)
                {
                    try
                    {
                        if ((bool)fmt.IsCurrentMediaSupported(rec))
                        {
                            fmt.Recorder = rec;
                            inside = true;
                            media = MediaName((int)fmt.CurrentPhysicalMediaType);
                            blank = (bool)fmt.MediaHeuristicallyBlank;
                            free = (long)(int)fmt.FreeSectorsOnMedia * SectorSize;
                        }
                    }
                    catch { /* no disc, or one it can't write */ }
                }
                list.Add(new { id, name = name.Length > 0 ? name : "Disc drive", drive, media, blank, free, canWrite = supported && inside && blank && free > 0 });
            }
            catch (Exception ex)
            {
                Log.Write($"Burn: couldn't look at {id}: {ex.Message}");
            }
        }
        return list;
    }

    // The folder's contents onto the blank disc in burner `id`, named
    // `label`; progress(done, total) in bytes. Returns the bytes written.
    public static long Write(string id, string folder, string label, bool eject, Action<long, long> progress)
    {
        if (!Directory.Exists(folder)) throw new InvalidOperationException("The folder isn't there any more");
        dynamic rec = Create("IMAPI2.MsftDiscRecorder2");
        rec.InitializeDiscRecorder(id);
        dynamic fmt = Create("IMAPI2.MsftDiscFormat2Data");
        if (!(bool)fmt.IsRecorderSupported(rec)) throw new InvalidOperationException("This drive can't burn discs");
        if (!(bool)fmt.IsCurrentMediaSupported(rec)) throw new InvalidOperationException("There's no disc in the drive that it can write: put in a blank CD or DVD");
        fmt.Recorder = rec;
        fmt.ClientName = "jEditor";
        if (!(bool)fmt.MediaHeuristicallyBlank) throw new InvalidOperationException("The disc isn't blank: put in a blank CD or DVD");
        long room = (long)(int)fmt.FreeSectorsOnMedia * SectorSize;

        // The disc's file system: the folder's contents at its top
        dynamic fsi = Create("IMAPI2FS.MsftFileSystemImage");
        fsi.ChooseImageDefaults(rec);
        fsi.FileSystemsToCreate = FsIso9660 | FsJoliet | FsUdf;
        fsi.VolumeName = VolumeName(label);
        fsi.FreeMediaBlocks = (int)fmt.FreeSectorsOnMedia;
        long size = FolderSize(folder);
        if (size > room) throw new InvalidOperationException($"It doesn't fit: it needs {Size(size)}, and the disc holds {Size(room)}");
        fsi.Root.AddTree(folder, false);
        dynamic image = fsi.CreateResultImage();
        dynamic stream = image.ImageStream;
        long total = (long)(int)image.TotalBlocks * (int)image.BlockSize;

        // How far it's got, from the write's events
        var sink = new UpdateSink((done) => progress(Math.Min(done, total), total));
        IConnectionPoint? point = null;
        int cookie = 0;
        try
        {
            if ((object)fmt is IConnectionPointContainer cpc)
            {
                var iid = new Guid("2735413C-7F64-5B0F-8F00-5D77AFBE261E"); // DDiscFormat2DataEvents
                cpc.FindConnectionPoint(ref iid, out point);
                point?.Advise(sink, out cookie);
            }
        }
        catch (Exception ex)
        {
            Log.Write($"Burn: no progress events ({ex.Message})");
            point = null;
        }
        progress(0, total);
        try
        {
            fmt.Write(stream);
        }
        finally
        {
            try { if (point is not null) point.Unadvise(cookie); } catch { /* gone */ }
        }
        progress(total, total);
        if (eject)
        {
            try { rec.EjectMedia(); } catch (Exception ex) { Log.Write($"Burn: couldn't eject: {ex.Message}"); }
        }
        return total;
    }

    // Joliet keeps 16 characters of a disc's name; ISO 9660 wants plain ones
    public static string VolumeName(string label)
    {
        var chars = (label ?? "").Where(c => char.IsLetterOrDigit(c) || c == ' ' || c == '_' || c == '-').ToArray();
        var name = new string(chars).Trim();
        if (name.Length == 0) name = "Photos";
        return name.Length > 16 ? name[..16].Trim() : name;
    }

    static long FolderSize(string folder)
    {
        long n = 0;
        foreach (var f in Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories))
        {
            try { n += new FileInfo(f).Length; } catch { /* gone */ }
        }
        return n;
    }

    static string Size(long bytes) => bytes >= 1L << 30 ? $"{bytes / (double)(1L << 30):0.0} GB" : $"{bytes / (double)(1L << 20):0} MB";

    // DDiscFormat2DataEvents: Update(sender, progress) as the disc is written
    [ComVisible(true)]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    [Guid("2735413C-7F64-5B0F-8F00-5D77AFBE261E")]
    public interface IDiscFormat2DataEvents
    {
        [DispId(0x200)]
        void Update([In, MarshalAs(UnmanagedType.IDispatch)] object sender, [In, MarshalAs(UnmanagedType.IDispatch)] object progress);
    }

    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.None)]
    public sealed class UpdateSink : IDiscFormat2DataEvents
    {
        readonly Action<long> report;
        public UpdateSink(Action<long> report) { this.report = report; }

        public void Update(object sender, object progress)
        {
            try
            {
                dynamic p = progress;
                long start = (int)p.StartLba, last = (int)p.LastWrittenLba;
                if (last >= start) report((last - start) * SectorSize);
            }
            catch { /* a stage without sectors (calibrating, finishing) */ }
        }
    }
}
