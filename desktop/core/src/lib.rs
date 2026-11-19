//! jEditor's Mac and Linux host, without its window: step 2 of
//! docs/plans/lighter-desktop.md. Each module is the Rust twin of a part of
//! the Electron host (mac/), and behaves the same, so the Tauri shell
//! (step 3) only has to wire them to the window:
//!
//! - [`fs_host`]: the page's file handles (mac/fs-host.js), the same
//!   operations and errors as Chromium's own;
//! - [`places`]: the sidebar's drives, folders, projects, counts, renames,
//!   ejecting and folder copies (mac/places.js);
//! - [`moves`]: moving the projects folder, item by item, checked
//!   (mac/move.js, src/FolderMove.cs);
//! - [`update`]: which release is newer, which download is this app's, and
//!   a download checked against its SHA-256 (mac/main.js, Updates).
//!
//! None of it opens a window or the network: the shell fetches, and hands
//! the bytes over. So all of it is tested on its own (`cargo test`), and
//! the `jeditor-core` binary serves [`fs_host`] to test/handles.test.js,
//! which runs the page's handles on it in Chromium and WebKit.

pub mod fs_host;
pub mod moves;
pub mod places;
pub mod update;

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// A file's time as JavaScript has it: milliseconds since 1970
pub(crate) fn millis(t: std::io::Result<std::time::SystemTime>) -> f64 {
    t.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// A disk's size and free space, in bytes ((0, 0) when it can't be told)
pub fn disk_space(p: &Path) -> (u64, u64) {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let Ok(c) = CString::new(p.as_os_str().as_bytes()) else { return (0, 0) };
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut s) } != 0 {
        return (0, 0);
    }
    let unit = if s.f_frsize > 0 { s.f_frsize as u64 } else { s.f_bsize as u64 };
    (s.f_blocks as u64 * unit, s.f_bavail as u64 * unit)
}

/// A free name for a file or folder in `dir`: `name`, else "name (2)", …
pub(crate) fn free_dir(dir: &Path, name: &str) -> PathBuf {
    let mut to = dir.join(name);
    let mut n = 2;
    while to.exists() {
        to = dir.join(format!("{name} ({n})"));
        n += 1;
    }
    to
}

/// The user's home folder
pub(crate) fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").filter(|h| !h.is_empty()).map(PathBuf::from)
}
