//! Moving what's in a folder (the projects folder) to another, one item at
//! a time, so nothing is ever lost (app/folder-move.js asks). The twin of
//! mac/move.js and the Windows app's src/FolderMove.cs:
//!
//! - On the same disk, each item is renamed into place: instant, and whole
//!   or not at all.
//! - Across disks, each is copied, then every file is read back and
//!   compared with its original, byte for byte; only then is the original
//!   removed. A copy that fails or doesn't match is removed and its
//!   original stays, and the move stops there.
//!
//! An item whose name is already taken in the new folder is left where it
//! is (and said so), never merged into the other. Hidden items at the top
//! (.DS_Store, .something) stay behind too.

use std::fs::{self, File};
use std::io::{self, Read};
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

fn skipped(name: &str) -> bool {
    name.starts_with('.') || name == "Thumbs.db" || name == "desktop.ini"
}

struct Item {
    name: String,
    path: PathBuf,
    dir: bool,
}

fn items(dir: &Path) -> io::Result<Vec<Item>> {
    let mut out = Vec::new();
    for e in fs::read_dir(dir)?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let t = e.file_type()?;
        if skipped(&name) || t.is_symlink() {
            continue;
        }
        if t.is_dir() || t.is_file() {
            out.push(Item { path: e.path(), name, dir: t.is_dir() });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Every folder and file under a folder (links aren't followed)
fn tree(dir: &Path) -> io::Result<(Vec<PathBuf>, Vec<(PathBuf, u64)>)> {
    let (mut dirs, mut files) = (Vec::new(), Vec::new());
    fn walk(d: &Path, dirs: &mut Vec<PathBuf>, files: &mut Vec<(PathBuf, u64)>) -> io::Result<()> {
        for e in fs::read_dir(d)?.flatten() {
            let t = e.file_type()?;
            if t.is_dir() {
                dirs.push(e.path());
                walk(&e.path(), dirs, files)?;
            } else if t.is_file() {
                files.push((e.path(), e.metadata()?.len()));
            }
        }
        Ok(())
    }
    walk(dir, &mut dirs, &mut files)?;
    Ok((dirs, files))
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Size {
    pub folders: u64,
    pub files: u64,
    pub bytes: u64,
}

/// What would move: the folders and files at the top, and everything's bytes
pub fn size(dir: &Path) -> io::Result<Size> {
    let mut s = Size::default();
    if !dir.exists() {
        return Ok(s);
    }
    for it in items(dir)? {
        if it.dir {
            s.folders += 1;
            for (_, n) in tree(&it.path)?.1 {
                s.files += 1;
                s.bytes += n;
            }
        } else {
            s.files += 1;
            s.bytes += fs::metadata(&it.path)?.len();
        }
    }
    Ok(s)
}

/// A path made absolute, with . and .. taken out (as Node's path.resolve)
pub fn resolve(p: &Path) -> PathBuf {
    let p = if p.is_absolute() { p.to_path_buf() } else { std::env::current_dir().unwrap_or_default().join(p) };
    let mut out = PathBuf::from("/");
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(n) => out.push(n),
            _ => {}
        }
    }
    out
}

/// The nearest folder at or above p that's there
fn existing(p: &Path) -> PathBuf {
    let mut d = resolve(p);
    while !d.exists() && d.pop() {}
    d
}

/// The drive's name from a path: /Volumes/<name>, /media/<user>/<name>,
/// /run/media/<user>/<name>
fn volume_of(p: &Path) -> Option<String> {
    let parts: Vec<String> = p.components().filter_map(|c| match c {
        Component::Normal(n) => Some(n.to_string_lossy().into_owned()),
        _ => None,
    }).collect();
    let s: Vec<&str> = parts.iter().map(String::as_str).collect();
    match s.as_slice() {
        ["Volumes", name, ..] => Some(name.to_string()),
        ["media", _, name, ..] => Some(name.to_string()),
        ["run", "media", _, name, ..] => Some(name.to_string()),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Space {
    /// None: unknown
    pub free: Option<u64>,
    pub drive: String,
    pub same_drive: bool,
}

/// The disk a folder is (or would be) on: its free space, its name, and
/// whether `from` is on it too
pub fn space(to: &Path, from: Option<&Path>) -> Space {
    let at = existing(to);
    let (total, free) = crate::disk_space(&at);
    let same_drive = match (from.and_then(|f| fs::metadata(f).ok()), fs::metadata(&at).ok()) {
        (Some(a), Some(b)) => a.dev() == b.dev(),
        _ => false,
    };
    let drive = volume_of(&at).unwrap_or_else(|| if cfg!(target_os = "macos") { "this Mac".into() } else { "this computer".into() });
    Space { free: (total > 0).then_some(free), drive, same_drive }
}

/// A folder that can't be moved out of, or into: why, or None
pub fn refuse(from: &Path, to: &Path) -> Option<&'static str> {
    let (from, to) = (resolve(from), resolve(to));
    if from == to {
        return Some("It's the same folder");
    }
    // (Everything is inside "/", but that's said below, as mac/move.js does)
    if from.parent().is_some() && to.starts_with(&from) {
        return Some("The new folder is inside the old one");
    }
    if to.parent().is_some() && from.starts_with(&to) {
        return Some("The old folder is inside the new one");
    }
    let depth = from.components().count();
    let whole_drive = from.parent().is_none()
        || crate::home_dir().is_some_and(|h| resolve(&h) == from)
        || (from.starts_with("/Volumes") && depth == 3)
        || (from.starts_with("/media") && depth == 4)
        || (from.starts_with("/run/media") && depth == 5);
    whole_drive.then_some("jEditor doesn't move everything on a disk or in your home folder")
}

/// The two files' bytes are the same
pub fn same(a: &Path, b: &Path) -> io::Result<bool> {
    let (mut x, mut y) = (File::open(a)?, File::open(b)?);
    if x.metadata()?.len() != y.metadata()?.len() {
        return Ok(false);
    }
    let (mut bx, mut by) = (vec![0u8; 1 << 20], vec![0u8; 1 << 20]);
    loop {
        let n = read_full(&mut x, &mut bx)?;
        let m = read_full(&mut y, &mut by)?;
        if n != m || bx[..n] != by[..m] {
            return Ok(false);
        }
        if n == 0 {
            return Ok(true);
        }
    }
}

fn read_full(f: &mut File, buf: &mut [u8]) -> io::Result<usize> {
    let mut got = 0;
    while got < buf.len() {
        let n = f.read(&mut buf[got..])?;
        if n == 0 {
            break;
        }
        got += n;
    }
    Ok(got)
}

/// A copy keeps its original's dates
pub(crate) fn keep_times(copy: &File, of: &fs::Metadata) {
    let mut t = fs::FileTimes::new();
    if let Ok(m) = of.modified() {
        t = t.set_modified(m);
    }
    if let Ok(a) = of.accessed() {
        t = t.set_accessed(a);
    }
    let _ = copy.set_times(t);
}

/// A file copied, never over another (as COPYFILE_EXCL)
fn copy_new(from: &Path, to: &Path) -> io::Result<()> {
    let mut src = File::open(from)?;
    let mut dst = fs::OpenOptions::new().write(true).create_new(true).open(to)?;
    io::copy(&mut src, &mut dst)?;
    keep_times(&dst, &src.metadata()?);
    Ok(())
}

/// Why an item stayed behind: its name was taken there, or it was copied
/// and checked but the original couldn't be removed
#[derive(Debug, Clone, PartialEq)]
pub struct Left {
    pub name: String,
    pub why: &'static str,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Outcome {
    pub moved: u64,
    pub left: Vec<Left>,
    pub stopped: bool,
    pub error: Option<String>,
}

/// progress(done, total, moved): bytes across disks, items on one; `stop`
/// ends it after the item it's on (whose copy is removed)
pub fn run(from: &Path, to: &Path, mut progress: impl FnMut(u64, u64, u64), stop: &AtomicBool) -> Outcome {
    let (from, to) = (resolve(from), resolve(to));
    let fail = |moved, left, e: String| Outcome { moved, left, stopped: false, error: Some(e) };
    if let Some(why) = refuse(&from, &to) {
        return fail(0, vec![], why.into());
    }
    if !from.exists() {
        return fail(0, vec![], "The folder isn't there any more".into());
    }
    if let Err(e) = fs::create_dir_all(&to) {
        return fail(0, vec![], e.to_string());
    }
    let list = match items(&from) {
        Ok(l) => l,
        Err(e) => return fail(0, vec![], e.to_string()),
    };
    let room = space(&to, Some(&from));
    let total = if room.same_drive {
        list.len() as u64
    } else {
        match size(&from) {
            Ok(s) => s.bytes,
            Err(e) => return fail(0, vec![], e.to_string()),
        }
    };
    if !room.same_drive && room.free.is_some_and(|f| f < total) {
        return fail(0, vec![], format!("Not enough room on {}", room.drive));
    }
    let (mut moved, mut done) = (0u64, 0u64);
    let mut left = Vec::new();
    let mut last: Option<Instant> = None;
    let mut tell = |done: u64, moved: u64, now: bool| {
        if !now && last.is_some_and(|l| l.elapsed() < Duration::from_millis(250)) {
            return;
        }
        last = Some(Instant::now());
        progress(done, total, moved);
    };
    tell(done, moved, true);
    for it in list {
        if stop.load(Ordering::Relaxed) {
            return Outcome { moved, left, stopped: true, error: None };
        }
        let target = to.join(&it.name);
        if target.exists() {
            left.push(Left { name: it.name, why: "taken" });
            continue;
        }
        if room.same_drive {
            match fs::rename(&it.path, &target) {
                Ok(()) => {
                    moved += 1;
                    done += 1;
                    tell(done, moved, false);
                    continue;
                }
                // Another disk after all (a mount inside): copied below
                Err(e) if e.raw_os_error() == Some(libc::EXDEV) => {}
                Err(e) => return fail(moved, left, format!("{}: {e}", it.name)),
            }
        }
        let copied = (|| -> Result<(), (bool, String)> {
            let io = |e: io::Error| (false, e.to_string());
            let (dirs, files) = if it.dir { tree(&it.path).map_err(io)? } else { (vec![], vec![(it.path.clone(), 0)]) };
            if it.dir {
                fs::create_dir(&target).map_err(io)?;
                for d in &dirs {
                    fs::create_dir_all(target.join(d.strip_prefix(&it.path).unwrap())).map_err(io)?;
                }
            }
            for (f, _) in &files {
                if stop.load(Ordering::Relaxed) {
                    return Err((true, "Stopped".into()));
                }
                let copy = if it.dir { target.join(f.strip_prefix(&it.path).unwrap()) } else { target.clone() };
                copy_new(f, &copy).map_err(io)?;
                if !same(f, &copy).map_err(io)? {
                    let name = f.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    return Err((false, format!("The copy of {name} doesn't match the original")));
                }
                done += fs::metadata(f).map_err(io)?.len();
                tell(done, moved, false);
            }
            Ok(())
        })();
        if let Err((stopped, e)) = copied {
            // The half copy goes; the original was never touched
            let _ = if it.dir { fs::remove_dir_all(&target) } else { fs::remove_file(&target) };
            if stopped {
                return Outcome { moved, left, stopped: true, error: None };
            }
            return fail(moved, left, format!("{}: {e}", it.name));
        }
        // Copied and checked: now the original goes
        moved += 1;
        let gone = if it.dir { fs::remove_dir_all(&it.path) } else { fs::remove_file(&it.path) };
        if gone.is_err() {
            left.push(Left { name: it.name, why: "copied" });
        }
        tell(done, moved, true);
    }
    progress(total, total, moved);
    Outcome { moved, left, stopped: false, error: None }
}
