//! The sidebar's places on a Mac or Linux (app/places.js asks, through the
//! bridge): the drives (each volume in /Volumes on a Mac: the startup disk,
//! USB drives and cards, network shares; on Linux, the computer's own disk
//! and what's mounted in /media/<user> or /run/media/<user>), the usual
//! folders, the folders and photos in a folder, the projects in the projects
//! folder, photo counts, new folders, renames, ejecting, and a whole folder
//! copied (onto a USB drive, say). The twin of mac/places.js.
//!
//! `JEDITOR_VOLUMES`: another folder to list as the drives, each folder in
//! it a USB drive (the tests). Eject then only hides it (renamed to
//! .ejected-…), never touching what's in it.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// RAW files too (app/raw.js shows them from their own JPEG)
const PHOTO: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "bmp", "heic", "heif", "hif", "dng", "cr2", "cr3", "nef", "nrw", "arw", "sr2",
    "srf", "orf", "rw2", "rwl", "pef", "srw", "3fr", "iiq", "erf", "kdc", "dcr", "mos", "mef", "raf",
];

/// Counting stops here: "1,000+" is enough to tell
pub const LIMIT: usize = 1000;

pub fn is_photo(name: &str) -> bool {
    if name.starts_with('.') {
        return false;
    }
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => PHOTO.contains(&ext.to_ascii_lowercase().as_str()),
        _ => false,
    }
}

/// Folders that aren't shown: hidden ones, and jEditor's own
fn hidden(name: &str) -> bool {
    name.starts_with('.') || name.starts_with('$')
}

/// A photo app's library (a package: one item in Finder), unless Settings →
/// Projects opens them as folders (the page's Watch.isLibrary, the same list)
fn is_library(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    ["photoslibrary", "photolibrary", "aplibrary", "lrdata", "lrlibrary"]
        .iter()
        .any(|ext| lower.len() > ext.len() + 1 && lower.ends_with(ext) && lower.as_bytes()[lower.len() - ext.len() - 1] == b'.')
}

fn skipped(name: &str, libraries: bool) -> bool {
    hidden(name) || (!libraries && is_library(name))
}

fn name_of(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

#[derive(Debug, Clone, PartialEq)]
pub struct Drive {
    pub path: PathBuf,
    pub name: String,
    /// usb, disk, network or cd
    pub kind: &'static str,
    pub label: String,
    pub total: u64,
    pub free: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Folder {
    pub name: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Listing {
    pub path: PathBuf,
    pub name: String,
    pub parent: Option<PathBuf>,
    pub folders: Vec<Folder>,
    pub photos: usize,
    /// LIMIT photos or more
    pub more: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Project {
    pub name: String,
    pub path: PathBuf,
    pub modified: f64,
}

const NETWORK: &[&str] = &["smbfs", "afpfs", "nfs", "webdav", "ftp", "cifs", "smb3", "nfs4", "fuse.sshfs", "davfs"];
const CD: &[&str] = &["cd9660", "udf", "cddafs", "iso9660"];

fn kind_for(fs_type: Option<&str>) -> &'static str {
    match fs_type {
        Some(t) if NETWORK.contains(&t) => "network",
        Some(t) if CD.contains(&t) => "cd",
        _ => "usb",
    }
}

/// A mount: its file system's type, and (Linux) its device, for ejecting
#[derive(Debug, Clone, PartialEq)]
pub struct Mount {
    pub fs_type: String,
    pub dev: String,
}

/// /proc/mounts → mount point → mount. Spaces and such in a mount point are
/// written \040 etc.
pub fn parse_proc_mounts(text: &str) -> HashMap<PathBuf, Mount> {
    let unescape = |s: &str| {
        let b = s.as_bytes();
        let mut out = Vec::with_capacity(b.len());
        let mut i = 0;
        while i < b.len() {
            if b[i] == b'\\' && i + 3 < b.len() && b[i + 1..i + 4].iter().all(|c| (b'0'..=b'7').contains(c)) {
                out.push(((b[i + 1] - b'0') << 6) | ((b[i + 2] - b'0') << 3) | (b[i + 3] - b'0'));
                i += 4;
            } else {
                out.push(b[i]);
                i += 1;
            }
        }
        String::from_utf8_lossy(&out).into_owned()
    };
    let mut out = HashMap::new();
    for line in text.lines() {
        let mut f = line.split(' ');
        let (Some(dev), Some(at), Some(t)) = (f.next(), f.next(), f.next()) else { continue };
        out.insert(PathBuf::from(unescape(at)), Mount { fs_type: t.into(), dev: dev.into() });
    }
    out
}

/// macOS `mount`'s lines ("/dev/disk4s1 on /Volumes/CARD (msdos, local, …)")
/// → mount point → type
pub fn parse_mac_mount(text: &str) -> HashMap<PathBuf, Mount> {
    let mut out = HashMap::new();
    for line in text.lines() {
        let Some((dev, rest)) = line.split_once(" on ") else { continue };
        let Some(i) = rest.rfind(" (") else { continue };
        let t: String = rest[i + 2..].chars().take_while(|c| *c != ',' && *c != ')').collect();
        out.insert(PathBuf::from(&rest[..i]), Mount { fs_type: t, dev: dev.into() });
    }
    out
}

fn run(file: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(file).args(args).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(err.trim().lines().last().unwrap_or("").to_string())
    }
}

/// Where the drives are, and how this computer lists them
pub struct Places {
    /// The test's folder of drives (JEDITOR_VOLUMES)
    pub test_volumes: Option<PathBuf>,
    pub linux: bool,
    /// /Volumes on a Mac
    pub volumes: Option<PathBuf>,
    /// Where Linux mounts USB drives and cards: /media/<user> (Debian,
    /// Ubuntu), /run/media/<user> (Fedora, Arch)
    pub media: Vec<PathBuf>,
    counted: Mutex<HashMap<(PathBuf, bool), (f64, usize, Instant)>>,
}

impl Places {
    /// As this computer has them (JEDITOR_VOLUMES: the tests' drives)
    pub fn from_env() -> Self {
        let test = std::env::var_os("JEDITOR_VOLUMES").filter(|v| !v.is_empty()).map(PathBuf::from);
        let user = std::env::var("USER").unwrap_or_default();
        Places::new(test, cfg!(target_os = "linux"), &user)
    }

    pub fn new(test_volumes: Option<PathBuf>, linux: bool, user: &str) -> Self {
        let linux = test_volumes.is_none() && linux;
        let volumes = test_volumes.clone().or_else(|| (!linux && cfg!(target_os = "macos")).then(|| PathBuf::from("/Volumes")));
        let media = if linux {
            vec![PathBuf::from(format!("/media/{user}")), PathBuf::from(format!("/run/media/{user}")), PathBuf::from("/media")]
        } else {
            Vec::new()
        };
        Places { test_volumes, linux, volumes, media, counted: Mutex::new(HashMap::new()) }
    }

    fn mounts(&self) -> HashMap<PathBuf, Mount> {
        if self.linux {
            return fs::read_to_string("/proc/mounts").map(|t| parse_proc_mounts(&t)).unwrap_or_default();
        }
        if self.test_volumes.is_some() || !cfg!(target_os = "macos") {
            return HashMap::new();
        }
        run("/sbin/mount", &[]).map(|t| parse_mac_mount(&t)).unwrap_or_default()
    }

    /// The folders to watch for drives coming and going (the shell watches
    /// them, and lists the drives again a moment after one changes)
    pub fn drive_dirs(&self) -> Vec<PathBuf> {
        if self.linux {
            self.media.clone()
        } else {
            self.volumes.iter().cloned().collect()
        }
    }

    pub fn drives(&self) -> Vec<Drive> {
        if self.linux {
            return self.linux_drives();
        }
        let Some(volumes) = &self.volumes else { return Vec::new() };
        let Ok(names) = fs::read_dir(volumes) else { return Vec::new() };
        let mounts = self.mounts();
        let mut out = Vec::new();
        let mut names: Vec<String> = names.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        for name in names {
            if name.starts_with('.') {
                continue;
            }
            let p = volumes.join(&name);
            let Ok(real) = fs::canonicalize(&p) else { continue };
            if !real.is_dir() {
                continue;
            }
            // The startup disk is a link to / in /Volumes
            let boot = self.test_volumes.is_none() && real == Path::new("/");
            let at = if boot { PathBuf::from("/") } else { p.clone() };
            let kind = if boot { "disk" } else { kind_for(mounts.get(&at).map(|m| m.fs_type.as_str())) };
            let (total, free) = crate::disk_space(&real);
            out.push(Drive { path: at, name: name.clone(), kind, label: name, total, free });
        }
        out
    }

    /// Linux: the computer's own disk, then each drive mounted for this user
    fn linux_drives(&self) -> Vec<Drive> {
        let mounts = self.mounts();
        let (total, free) = crate::disk_space(Path::new("/"));
        let mut out = vec![Drive { path: "/".into(), name: "Computer".into(), kind: "disk", label: "Computer".into(), total, free }];
        let mut seen = HashSet::new();
        for dir in &self.media {
            let Ok(names) = fs::read_dir(dir) else { continue };
            let mut names: Vec<String> = names.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
            names.sort();
            for name in names {
                let p = dir.join(&name);
                // Only what's mounted there (/media also holds the users' folders)
                let Some(m) = mounts.get(&p) else { continue };
                if name.starts_with('.') || !seen.insert(p.clone()) {
                    continue;
                }
                let (total, free) = crate::disk_space(&p);
                out.push(Drive { path: p, name: name.clone(), kind: kind_for(Some(&m.fs_type)), label: name, total, free });
            }
        }
        out
    }

    /// The name of the disk at "/"
    fn root_name(&self) -> &'static str {
        if self.linux || !cfg!(target_os = "macos") { "Computer" } else { "Macintosh HD" }
    }

    /// A folder's folders (not hidden ones), and how many photos are directly in it
    pub fn list_dir(&self, p: &Path, drive_name: Option<&str>, libraries: bool) -> Result<Listing, String> {
        let entries = fs::read_dir(p).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound { "That folder isn't there any more".to_string() } else { e.to_string() }
        })?;
        let mut folders = Vec::new();
        let (mut photos, mut more) = (0, false);
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(t) = e.file_type() else { continue };
            if t.is_dir() && !skipped(&name, libraries) {
                folders.push(Folder { path: p.join(&name), name });
            } else if t.is_file() && is_photo(&name) && !more {
                photos += 1;
                more = photos >= LIMIT;
            }
        }
        folders.sort_by(|a, b| a.name.cmp(&b.name));
        let root = p.parent().is_none();
        Ok(Listing {
            path: p.to_path_buf(),
            name: if root { drive_name.unwrap_or(self.root_name()).to_string() } else { name_of(p) },
            parent: p.parent().map(Path::to_path_buf),
            folders,
            photos,
            more,
        })
    }

    /// Photos in a folder and its subfolders, up to LIMIT (None: it isn't
    /// there). Kept per folder while it's unchanged, for a minute at most
    /// (photos added in a subfolder don't change the top folder's time)
    pub fn count(&self, p: &Path, libraries: bool) -> Option<usize> {
        let mtime = crate::millis(fs::metadata(p).ok()?.modified());
        let key = (p.to_path_buf(), libraries);
        if let Some((m, n, at)) = self.counted.lock().unwrap().get(&key) {
            if *m == mtime && at.elapsed() < Duration::from_secs(60) {
                return Some(*n);
            }
        }
        fn walk(dir: &Path, libraries: bool, n: &mut usize) {
            let Ok(entries) = fs::read_dir(dir) else { return };
            for e in entries.flatten() {
                if *n >= LIMIT {
                    return;
                }
                let name = e.file_name().to_string_lossy().into_owned();
                let Ok(t) = e.file_type() else { continue };
                if t.is_file() && is_photo(&name) {
                    *n += 1;
                } else if t.is_dir() && !skipped(&name, libraries) {
                    walk(&e.path(), libraries, n);
                }
            }
        }
        let mut n = 0;
        walk(p, libraries, &mut n);
        self.counted.lock().unwrap().insert(key, (mtime, n, Instant::now()));
        Some(n)
    }

    /// → None when it's gone, else why not
    pub fn eject(&self, p: &Path) -> Option<String> {
        if self.linux {
            return self.linux_eject(p);
        }
        let Some(volumes) = &self.volumes else { return Some("Only drives can be ejected".into()) };
        if p.parent() != Some(volumes.as_path()) {
            return Some("Only drives can be ejected".into());
        }
        if self.test_volumes.is_some() {
            return fs::rename(p, volumes.join(format!(".ejected-{}", name_of(p)))).err().map(|e| e.to_string());
        }
        match run("/usr/sbin/diskutil", &["eject", &p.to_string_lossy()]) {
            Ok(_) => None,
            Err(why) => Some(busy_or(why, "The Mac couldn't eject it")),
        }
    }

    /// Unmounted the desktop's way (gio, as the file manager does), else with
    /// udisksctl, which then powers a USB drive off so it can be pulled out
    fn linux_eject(&self, p: &Path) -> Option<String> {
        let mounts = self.mounts();
        let Some(m) = mounts.get(p) else { return Some("Only drives can be ejected".into()) };
        if !p.parent().is_some_and(|d| self.media.iter().any(|x| x == d)) {
            return Some("Only drives can be ejected".into());
        }
        if run("gio", &["mount", "-e", &p.to_string_lossy()]).is_ok() {
            return None;
        }
        match run("udisksctl", &["unmount", "-b", &m.dev]) {
            Ok(_) => {
                let _ = run("udisksctl", &["power-off", "-b", &m.dev]);
                None
            }
            Err(why) => Some(busy_or(why, "Linux couldn't eject it")),
        }
    }
}

fn busy_or(why: String, otherwise: &str) -> String {
    let lower = why.to_ascii_lowercase();
    if lower.contains("in use") || lower.contains("busy") || lower.contains("dissent") {
        "Something still has a file on it open".into()
    } else if why.is_empty() {
        otherwise.into()
    } else {
        why
    }
}

/// Desktop, Pictures, Documents, Downloads (those that are there). On Linux
/// their names come from ~/.config/user-dirs.dirs, as the desktop has them
pub fn home(home: &Path) -> Vec<Folder> {
    let xdg = fs::read_to_string(home.join(".config/user-dirs.dirs")).unwrap_or_default();
    let from_xdg = |key: &str| -> Option<PathBuf> {
        let line = xdg.lines().find(|l| l.trim_start().starts_with(&format!("XDG_{key}_DIR=")))?;
        let v = line.split_once('=')?.1.trim().trim_matches('"');
        Some(match v.strip_prefix("$HOME") {
            Some(rest) => home.join(rest.trim_start_matches('/')),
            None => PathBuf::from(v),
        })
    };
    [("Desktop", "DESKTOP"), ("Pictures", "PICTURES"), ("Documents", "DOCUMENTS"), ("Downloads", "DOWNLOAD")]
        .iter()
        .map(|(name, key)| Folder { name: (*name).into(), path: from_xdg(key).unwrap_or_else(|| home.join(name)) })
        .filter(|f| f.path.is_dir())
        .collect()
}

/// The folders in the projects folder, newest first (by when each changed)
pub fn list_projects(p: &Path) -> Result<Vec<Project>, String> {
    let entries = fs::read_dir(p).map_err(|_| "The projects folder isn't there".to_string())?;
    let mut out = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if hidden(&name) || !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        if let Ok(st) = fs::metadata(e.path()) {
            out.push(Project { path: e.path(), name, modified: crate::millis(st.modified()) });
        }
    }
    out.sort_by(|a, b| b.modified.partial_cmp(&a.modified).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

/// Why a name won't do as a folder's, or None. (Linux allows :, but USB
/// drives' FAT and exFAT don't)
pub fn name_problem(name: &str) -> Option<&'static str> {
    if name.is_empty() {
        Some("A folder needs a name")
    } else if name.chars().count() > 120 {
        Some("That name is too long")
    } else if name.contains(['/', ':']) {
        Some("A folder's name can't have / or : in it")
    } else if name.starts_with('.') {
        Some("A name starting with a dot would hide the folder")
    } else {
        None
    }
}

pub fn make_folder(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let name = name.trim();
    if let Some(problem) = name_problem(name) {
        return Err(problem.into());
    }
    if !parent.exists() {
        return Err("The projects folder isn't there".into());
    }
    let p = parent.join(name);
    if p.exists() {
        return Err(format!("There's already a {name} there"));
    }
    fs::create_dir(&p).map_err(|e| e.to_string())?;
    Ok(p)
}

/// → the folder's new path. The project data kept for it moves in the page
/// (bridge.js), where it's kept
pub fn rename_folder(p: &Path, name: &str) -> Result<PathBuf, String> {
    let name = name.trim();
    if let Some(problem) = name_problem(name) {
        return Err(problem.into());
    }
    let p = PathBuf::from(p.to_string_lossy().trim_end_matches('/'));
    if !p.exists() {
        return Err("That folder isn't there".into());
    }
    let to = p.with_file_name(name);
    if to == p {
        return Ok(p);
    }
    let case_only = to.to_string_lossy().to_lowercase() == p.to_string_lossy().to_lowercase();
    if !case_only && to.exists() {
        return Err(format!("There's already a {name} there"));
    }
    if case_only {
        // Through another name: the Mac's disk ignores case
        let step = PathBuf::from(format!("{}.jeditor-rename", to.display()));
        fs::rename(&p, &step).and_then(|_| fs::rename(&step, &to)).map_err(|e| e.to_string())?;
    } else {
        fs::rename(&p, &to).map_err(|e| e.to_string())?;
    }
    Ok(to)
}

/// jEditor's own folders, not copied
const SKIP: &[&str] = &[".jeditor", ".jeditor-trash"];

fn size_text(n: u64) -> String {
    if n >= 1 << 30 {
        format!("{:.1} GB", n as f64 / (1u64 << 30) as f64)
    } else {
        format!("{} MB", (n as f64 / (1u64 << 20) as f64).round() as u64)
    }
}

/// A whole folder copied into another. progress(done, total) in bytes as it
/// goes; `stop` ends it. A copy that fails or is stopped is removed, so no
/// half folder is left. → its path
pub fn copy_folder(from: &Path, dest_parent: &Path, mut progress: impl FnMut(u64, u64), stop: &AtomicBool) -> Result<PathBuf, String> {
    if !from.exists() {
        return Err("The folder isn't there any more".into());
    }
    if !dest_parent.exists() {
        return Err("The folder to copy it into isn't there".into());
    }
    if dest_parent.starts_with(from) {
        return Err("A folder can't be copied into itself".into());
    }
    let (mut dirs, mut files) = (Vec::new(), Vec::new());
    fn walk(dir: &Path, dirs: &mut Vec<PathBuf>, files: &mut Vec<(PathBuf, u64)>) -> std::io::Result<()> {
        let mut entries: Vec<_> = fs::read_dir(dir)?.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let t = e.file_type()?;
            if t.is_dir() {
                if SKIP.contains(&e.file_name().to_string_lossy().as_ref()) {
                    continue;
                }
                dirs.push(e.path());
                walk(&e.path(), dirs, files)?;
            } else if t.is_file() {
                files.push((e.path(), e.metadata()?.len()));
            }
        }
        Ok(())
    }
    walk(from, &mut dirs, &mut files).map_err(|e| e.to_string())?;
    let total: u64 = files.iter().map(|f| f.1).sum();
    let (disk, free) = crate::disk_space(dest_parent);
    if disk > 0 && free < total {
        return Err(format!("Not enough room: it needs {}, and {} is free", size_text(total), size_text(free)));
    }
    let to = crate::free_dir(dest_parent, &name_of(from));
    let mut copy = || -> Result<(), String> {
        fs::create_dir(&to).map_err(|e| e.to_string())?;
        for d in &dirs {
            fs::create_dir_all(to.join(d.strip_prefix(from).unwrap())).map_err(|e| e.to_string())?;
        }
        progress(0, total);
        let (mut done, mut last) = (0u64, Instant::now());
        let mut buf = vec![0u8; 1 << 20];
        for (f, _) in &files {
            let target = to.join(f.strip_prefix(from).unwrap());
            let mut src = fs::File::open(f).map_err(|e| e.to_string())?;
            let mut dst = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| e.to_string())?;
            loop {
                if stop.load(Ordering::Relaxed) {
                    return Err("Stopped".into());
                }
                let n = src.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                dst.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                done += n as u64;
                if last.elapsed() > Duration::from_millis(250) {
                    last = Instant::now();
                    progress(done, total);
                }
            }
            let st = fs::metadata(f).map_err(|e| e.to_string())?;
            crate::moves::keep_times(&dst, &st);
        }
        progress(total, total);
        Ok(())
    };
    match copy() {
        Ok(()) => Ok(to),
        Err(e) => {
            let _ = fs::remove_dir_all(&to);
            Err(e)
        }
    }
}
