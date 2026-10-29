using System.Runtime.InteropServices;

namespace JEditor;

// Deleting to the Windows Recycle Bin, and putting a photo back (Ctrl+Z).
//
// Recycling goes through the shell's IFileOperation, which says where each
// file landed in the bin ($Recycle.Bin\<user>\$Rxxxxxx.jpg). Putting it back
// is moving that file to where it was and removing its $I record, so it
// leaves the Recycle Bin too. Only fixed drives have a Recycle Bin: on a
// network or USB drive, Windows would delete for good, so those files are
// never sent there (the page keeps them in jEditor's own trash instead).
static class RecycleBin
{
    public sealed record Result(string Path, string? BinPath, string? Error, bool NoBin);

    public static bool HasBin(string path)
    {
        if (path.StartsWith(@"\\")) return false;
        try
        {
            var root = System.IO.Path.GetPathRoot(path);
            return root is not null && new DriveInfo(root).DriveType == DriveType.Fixed;
        }
        catch (Exception)
        {
            return false;
        }
    }

    // On a thread of its own (the shell wants STA), so the window stays
    // responsive while hundreds of photos go
    public static Task<List<Result>> RecycleAsync(IReadOnlyList<string> paths, IntPtr owner)
    {
        var done = new TaskCompletionSource<List<Result>>();
        var thread = new Thread(() =>
        {
            try { done.SetResult(Recycle(paths, owner)); }
            catch (Exception e) { done.SetException(e); }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        return done.Task;
    }

    // A photo something has open can't go for a moment: jEditor reading it
    // (its thumbnail, or the photo just opened), or antivirus and the search
    // indexer after it was saved. Those are tried again, a little later each
    // time, rather than left for the page to say they couldn't be deleted.
    static readonly int[] RetryDelaysMs = [250, 500, 1000, 2000];

    static List<Result> Recycle(IReadOnlyList<string> paths, IntPtr owner)
    {
        var results = new Dictionary<string, Result>(StringComparer.OrdinalIgnoreCase);
        var pending = new List<string>();
        foreach (var path in paths)
        {
            if (!HasBin(path)) results[path] = new Result(path, null, null, true);
            else if (!File.Exists(path)) results[path] = new Result(path, null, "not found", false);
            else pending.Add(path);
        }
        for (int attempt = 0; pending.Count > 0; attempt++)
        {
            var failed = RecycleOnce(pending, owner, results);
            if (failed.Count == 0 || attempt >= RetryDelaysMs.Length) break;
            Log.Write($"Recycling: {failed.Count} in use, trying again");
            Thread.Sleep(RetryDelaysMs[attempt]);
            pending = failed;
        }
        return paths.Select(p => results[p]).ToList();
    }

    // One go at the shell. Fills in each photo's result; → the ones that
    // failed but are still there
    static List<string> RecycleOnce(List<string> paths, IntPtr owner, Dictionary<string, Result> results)
    {
        var failed = new List<string>();
        var queued = new List<string>();
        var op = (IFileOperation)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_FileOperation)!)!;
        var sink = new Sink();
        try
        {
            op.SetOperationFlags(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_WANTNUKEWARNING | FOFX_RECYCLEONDELETE);
            if (owner != IntPtr.Zero) op.SetOwnerWindow(owner);
            foreach (var path in paths)
            {
                try
                {
                    var item = ItemFor(path);
                    op.DeleteItem(item, null);
                    queued.Add(path);
                }
                catch (Exception e)
                {
                    results[path] = new Result(path, null, e.Message, false);
                    if (File.Exists(path)) failed.Add(path);
                }
            }
            if (queued.Count > 0)
            {
                op.Advise(sink);
                try { op.PerformOperations(); }
                catch (COMException e) { Log.Write($"Recycling stopped: {e.Message}"); } // canceled, say
            }
        }
        finally
        {
            Marshal.ReleaseComObject(op);
        }

        foreach (var path in queued)
        {
            if (sink.Deleted.TryGetValue(path, out var bin) && bin is not null && File.Exists(bin))
                results[path] = new Result(path, bin, null, false);
            else if (!File.Exists(path))
                // Gone, but not into the bin: Windows deleted it for good (only
                // after its own warning was accepted)
                results[path] = new Result(path, null, "deleted permanently (it didn't fit in the Recycle Bin)", false);
            else
            {
                results[path] = new Result(path, null, sink.Errors.TryGetValue(path, out var err) ? err : "not deleted", false);
                failed.Add(path);
            }
        }
        return failed;
    }

    // A photo back from the bin to where it was. → null, or why it couldn't
    public static string? Restore(string binPath, string originalPath)
    {
        if (File.Exists(originalPath)) return "another file with that name is in its place";
        if (!File.Exists(binPath)) return "it's no longer in the Recycle Bin";
        try
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(originalPath)!);
            File.Move(binPath, originalPath);
        }
        catch (Exception e)
        {
            return e.Message;
        }
        // Its record in the bin ($I + the same name): without it the bin
        // would list a file that isn't there
        var name = System.IO.Path.GetFileName(binPath);
        if (name.StartsWith("$R", StringComparison.OrdinalIgnoreCase))
        {
            try { File.Delete(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(binPath)!, "$I" + name[2..])); }
            catch (Exception) { }
        }
        return null;
    }

    static IShellItem ItemFor(string path)
    {
        var iid = typeof(IShellItem).GUID;
        SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out var item);
        return item;
    }

    static string? PathOf(IShellItem? item)
    {
        if (item is null) return null;
        try
        {
            item.GetDisplayName(SIGDN_FILESYSPATH, out var p);
            try { return Marshal.PtrToStringUni(p); }
            finally { Marshal.FreeCoTaskMem(p); }
        }
        catch (Exception)
        {
            return null;
        }
    }

    // Hears where each deleted file went
    [ComVisible(true)]
    sealed class Sink : IFileOperationProgressSink
    {
        public readonly Dictionary<string, string?> Deleted = new(StringComparer.OrdinalIgnoreCase);
        public readonly Dictionary<string, string> Errors = new(StringComparer.OrdinalIgnoreCase);

        public void PostDeleteItem(uint dwFlags, IShellItem psiItem, int hrDelete, IShellItem? psiNewlyCreated)
        {
            var path = PathOf(psiItem);
            if (path is null) return;
            if (hrDelete < 0) Errors[path] = Marshal.GetExceptionForHR(hrDelete)?.Message ?? $"error 0x{hrDelete:X8}";
            else Deleted[path] = PathOf(psiNewlyCreated);
        }

        public void StartOperations() { }
        public void FinishOperations(int hrResult) { }
        public void PreRenameItem(uint dwFlags, IShellItem psiItem, string? pszNewName) { }
        public void PostRenameItem(uint dwFlags, IShellItem psiItem, string? pszNewName, int hrRename, IShellItem? psiNewlyCreated) { }
        public void PreMoveItem(uint dwFlags, IShellItem psiItem, IShellItem psiDestinationFolder, string? pszNewName) { }
        public void PostMoveItem(uint dwFlags, IShellItem psiItem, IShellItem psiDestinationFolder, string? pszNewName, int hrMove, IShellItem? psiNewlyCreated) { }
        public void PreCopyItem(uint dwFlags, IShellItem psiItem, IShellItem psiDestinationFolder, string? pszNewName) { }
        public void PostCopyItem(uint dwFlags, IShellItem psiItem, IShellItem psiDestinationFolder, string? pszNewName, int hrCopy, IShellItem? psiNewlyCreated) { }
        public void PreDeleteItem(uint dwFlags, IShellItem psiItem) { }
        public void PreNewItem(uint dwFlags, IShellItem psiDestinationFolder, string? pszNewName) { }
        public void PostNewItem(uint dwFlags, IShellItem psiDestinationFolder, string? pszNewName, string? pszTemplateName, uint dwFileAttributes, int hrNew, IShellItem? psiNewItem) { }
        public void UpdateProgress(uint iWorkTotal, uint iWorkSoFar) { }
        public void ResetTimer() { }
        public void PauseTimer() { }
        public void ResumeTimer() { }
    }

    // ---- Shell interop ----

    static readonly Guid CLSID_FileOperation = new("3ad05575-8857-4850-9277-11b85bdb8e09");
    const uint FOF_SILENT = 0x0004, FOF_NOCONFIRMATION = 0x0010, FOF_ALLOWUNDO = 0x0040, FOF_NOERRORUI = 0x0400,
        FOF_WANTNUKEWARNING = 0x4000, FOFX_RECYCLEONDELETE = 0x00080000;
    const uint SIGDN_FILESYSPATH = 0x80058000;

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, out IShellItem ppv);

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellItem
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, out IntPtr ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport, Guid("947aab5f-0a5c-4c13-b4d6-4bf7836fc9f8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IFileOperation
    {
        uint Advise(IFileOperationProgressSink pfops);
        void Unadvise(uint dwCookie);
        void SetOperationFlags(uint dwOperationFlags);
        void SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)] string pszMessage);
        void SetProgressDialog(IntPtr popd);
        void SetProperties(IntPtr pproparray);
        void SetOwnerWindow(IntPtr hwndOwner);
        void ApplyPropertiesToItem(IShellItem psiItem);
        void ApplyPropertiesToItems(IntPtr punkItems);
        void RenameItem(IShellItem psiItem, [MarshalAs(UnmanagedType.LPWStr)] string pszNewName, IFileOperationProgressSink? pfopsItem);
        void RenameItems(IntPtr pUnkItems, [MarshalAs(UnmanagedType.LPWStr)] string pszNewName);
        void MoveItem(IShellItem psiItem, IShellItem psiDestinationFolder, [MarshalAs(UnmanagedType.LPWStr)] string? pszNewName, IFileOperationProgressSink? pfopsItem);
        void MoveItems(IntPtr punkItems, IShellItem psiDestinationFolder);
        void CopyItem(IShellItem psiItem, IShellItem psiDestinationFolder, [MarshalAs(UnmanagedType.LPWStr)] string? pszCopyName, IFileOperationProgressSink? pfopsItem);
        void CopyItems(IntPtr punkItems, IShellItem psiDestinationFolder);
        void DeleteItem(IShellItem psiItem, IFileOperationProgressSink? pfopsItem);
        void DeleteItems(IntPtr punkItems);
        void NewItem(IShellItem psiDestinationFolder, uint dwFileAttributes, [MarshalAs(UnmanagedType.LPWStr)] string pszName, [MarshalAs(UnmanagedType.LPWStr)] string? pszTemplateName, IFileOperationProgressSink? pfopsItem);
        void PerformOperations();
        [return: MarshalAs(UnmanagedType.Bool)] bool GetAnyOperationsAborted();
    }

    [ComImport, Guid("04b0f1a7-9490-44bc-96e1-4296a31252e2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IFileOperationProgressSink
    {
        void StartOperations();
        void FinishOperations(int hrResult);
        void PreRenameItem(uint dwFlags, IShellItem psiItem, [MarshalAs(UnmanagedType.LPWStr)] string? pszNewName);
        void PostRenameItem(uint dwFlags, IShellItem psiItem, [MarshalAs(UnmanagedType.LPWStr)] string? pszNewName, int hrRename, IShellItem? psiNewlyCreated);
        void PreMoveItem(uint dwFlags, IShellItem psiItem, IShellItem psiDestinationFolder, [MarshalAs(UnmanagedType.LPWStr)] string? pszNewName);
        void PostMoveItem(uint dwFlags, IShellItem psiItem, IShellItem psiDestinationFolder, [MarshalAs(UnmanagedType.LPWStr)] string? pszNewName, int hrMove, IShellItem? psiNewlyCreated);
        void PreCopyItem(uint dwFlags, IShellItem psiItem, IShellItem psiDestinationFolder, [MarshalAs(UnmanagedType.LPWStr)] string? pszNewName);
        void PostCopyItem(uint dwFlags, IShellItem psiItem, IShellItem psiDestinationFolder, [MarshalAs(UnmanagedType.LPWStr)] string? pszNewName, int hrCopy, IShellItem? psiNewlyCreated);
        void PreDeleteItem(uint dwFlags, IShellItem psiItem);
        void PostDeleteItem(uint dwFlags, IShellItem psiItem, int hrDelete, IShellItem? psiNewlyCreated);
        void PreNewItem(uint dwFlags, IShellItem psiDestinationFolder, [MarshalAs(UnmanagedType.LPWStr)] string? pszNewName);
        void PostNewItem(uint dwFlags, IShellItem psiDestinationFolder, [MarshalAs(UnmanagedType.LPWStr)] string? pszNewName, [MarshalAs(UnmanagedType.LPWStr)] string? pszTemplateName, uint dwFileAttributes, int hrNew, IShellItem? psiNewItem);
        void UpdateProgress(uint iWorkTotal, uint iWorkSoFar);
        void ResetTimer();
        void PauseTimer();
        void ResumeTimer();
    }
}
