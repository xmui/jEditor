//! Updates (Settings → Updates): which release is newer, which of its
//! downloads is this app's, and the download written beside where it goes,
//! checked against GitHub's SHA-256 before it's used. The twin of the
//! Updates part of mac/main.js.
//!
//! The shell does the fetching (GitHub's release JSON, then the download's
//! bytes, chunk by chunk) and the relaunch; everything it decides on is
//! here, so it's tested without the network.

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// jEditor's newest release, and every release and beta, newest first
/// (Settings → Updates → Beta builds). JEDITOR_RELEASES and
/// JEDITOR_RELEASES_ALL: others, for the tests
pub const RELEASES: &str = "https://api.github.com/repos/xmui/jEditor/releases/latest";
pub const ALL_RELEASES: &str = "https://api.github.com/repos/xmui/jEditor/releases?per_page=30";

/// "v1.18.1" < "v1.18.1-2" < "v1.19.0-beta.1" < "v1.19.0-beta.2" < "v1.19.0":
/// [major, minor, patch, which beta (u64::MAX: not a beta), -N (1 without)]
pub fn parse_tag(tag: &str) -> [u64; 5] {
    let b = tag.as_bytes();
    for start in 0..b.len() {
        if !b[start].is_ascii_digit() {
            continue;
        }
        if let Some(t) = parse_at(&tag[start..]) {
            return t;
        }
    }
    [0, 0, 0, u64::MAX, 0]
}

// (A release without "-N" counts as "-1", as in mac/main.js)

fn parse_at(s: &str) -> Option<[u64; 5]> {
    let digits = |s: &str| -> Option<(u64, usize)> {
        let n = s.bytes().take_while(u8::is_ascii_digit).count();
        (n > 0).then(|| (s[..n].parse().unwrap_or(u64::MAX), n))
    };
    let (major, a) = digits(s)?;
    let s = s[a..].strip_prefix('.')?;
    let (minor, a) = digits(s)?;
    let s = s[a..].strip_prefix('.')?;
    let (patch, a) = digits(s)?;
    let rest = &s[a..];
    if let Some(after) = rest.strip_prefix('-') {
        let (beta, after) = match after.strip_prefix("beta.") {
            Some(x) => (true, x),
            None => (false, after),
        };
        if let Some((n, _)) = digits(after) {
            return Some(if beta { [major, minor, patch, n, 0] } else { [major, minor, patch, u64::MAX, n] });
        }
    }
    Some([major, minor, patch, u64::MAX, 1])
}

pub fn is_newer(tag: &str, than: &str) -> bool {
    parse_tag(tag) > parse_tag(than)
}

/// This build's version, from app/version.js
pub fn current_version(version_js: &str) -> String {
    quoted_after(version_js, "APP_VERSION = '").filter(|v| v.bytes().all(|c| c.is_ascii_digit() || c == b'.')).unwrap_or_else(|| "0.0.0".into())
}

/// What this build is: the release it was built for (scripts/set-build.js),
/// else v<version>
pub fn current_tag(version_js: &str) -> String {
    quoted_after(version_js, "APP_BUILD = '").unwrap_or_else(|| format!("v{}", current_version(version_js)))
}

fn quoted_after(text: &str, key: &str) -> Option<String> {
    let i = text.find(key)? + key.len();
    let end = text[i..].find('\'')?;
    let v = &text[i..i + end];
    (!v.is_empty()).then(|| v.to_string())
}

/// Which app this is, so which download is its own
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum App {
    /// The .dmg
    Mac,
    /// The AppImage, replaced in place
    AppImage,
    /// Installed from the .deb, updated with the system's installer
    Deb,
    /// Installed from the Arch package
    Pacman,
}

impl App {
    /// The suffix of this app's download in a release
    fn suffix(self) -> &'static str {
        match self {
            App::Mac => "-mac.dmg",
            App::AppImage => "-linux.appimage",
            App::Deb => "-linux.deb",
            App::Pacman => "-linux.pacman",
        }
    }

    pub fn is_asset(self, name: &str) -> bool {
        let lower = name.to_ascii_lowercase();
        lower.starts_with("jeditor-") && lower.len() > "jeditor-".len() + self.suffix().len() - 1 && lower.ends_with(self.suffix())
    }

    pub fn platform(self) -> &'static str {
        if self == App::Mac { "Mac" } else { "Linux" }
    }
}

fn asset(release: &Value, app: App) -> Option<&Value> {
    release.get("assets")?.as_array()?.iter().find(|a| a.get("name").and_then(Value::as_str).is_some_and(|n| app.is_asset(n)))
}

/// The download to update to
#[derive(Debug, Clone, PartialEq)]
pub struct Latest {
    pub tag: String,
    pub name: String,
    pub url: String,
    pub size: u64,
    /// From GitHub's digest ("sha256:…"), when it gives one
    pub sha256: Option<String>,
}

/// What Settings → Updates shows
#[derive(Debug, Clone, PartialEq)]
pub struct Check {
    pub current: String,
    pub tag: String,
    /// "1.19.0"
    pub version: String,
    pub notes: String,
    pub size: u64,
    pub newer: bool,
    pub latest: Latest,
}

/// GitHub's answer → the release to offer. `json` is the latest release, or
/// with `beta` the list of every release; the newest with this app in it is
/// taken from that
pub fn check(json: &Value, beta: bool, app: App, current: &str) -> Result<Check, String> {
    let release = if beta {
        let all = json.as_array().ok_or("No releases yet")?;
        all.iter()
            .filter(|r| !r.get("draft").and_then(Value::as_bool).unwrap_or(false))
            .filter(|r| r.get("tag_name").and_then(Value::as_str).is_some_and(|t| !t.is_empty()) && asset(r, app).is_some())
            .fold(None::<&Value>, |best, r| match best {
                Some(b) if !is_newer(tag_of(r), tag_of(b)) => Some(b),
                _ => Some(r),
            })
            .ok_or("No releases yet")?
    } else {
        json
    };
    let tag = tag_of(release);
    let Some(a) = asset(release, app).filter(|_| !tag.is_empty()) else {
        return Err(format!("Release {} has no {} app to download", if tag.is_empty() { "?" } else { tag }, app.platform()));
    };
    let s = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let latest = Latest {
        tag: tag.into(),
        name: s("name"),
        url: s("browser_download_url"),
        size: a.get("size").and_then(Value::as_u64).unwrap_or(0),
        sha256: a.get("digest").and_then(Value::as_str).and_then(|d| d.strip_prefix("sha256:")).map(str::to_ascii_lowercase),
    };
    let v = parse_tag(tag);
    Ok(Check {
        current: current.into(),
        tag: tag.into(),
        version: format!("{}.{}.{}", v[0], v[1], v[2]),
        notes: release.get("body").and_then(Value::as_str).unwrap_or("").into(),
        size: latest.size,
        newer: is_newer(tag, current),
        latest,
    })
}

fn tag_of(r: &Value) -> &str {
    r.get("tag_name").and_then(Value::as_str).unwrap_or("")
}

/// A download in progress: written to "<file>.part" and hashed as it
/// comes, then put in place only when it's whole and its SHA-256 matches
pub struct Download {
    file: PathBuf,
    part: PathBuf,
    out: Option<File>,
    hash: Sha256,
    pub received: u64,
}

impl Download {
    pub fn start(file: &Path) -> io::Result<Self> {
        let part = PathBuf::from(format!("{}.part", file.display()));
        let out = File::create(&part)?;
        Ok(Download { file: file.into(), part, out: Some(out), hash: Sha256::new(), received: 0 })
    }

    pub fn write(&mut self, chunk: &[u8]) -> io::Result<()> {
        self.hash.update(chunk);
        self.received += chunk.len() as u64;
        self.out.as_mut().expect("download finished").write_all(chunk)
    }

    /// The download stopped: what came of it goes
    pub fn abandon(mut self) {
        self.out.take();
        let _ = fs::remove_file(&self.part);
    }

    /// Checked and put in place (executable: the AppImage) → its path
    pub fn finish(mut self, sha256: Option<&str>, executable: bool) -> Result<PathBuf, String> {
        let out = self.out.take().expect("download finished");
        let synced = out.sync_all();
        drop(out);
        let digest: String = self.hash.clone().finalize().iter().map(|b| format!("{b:02x}")).collect();
        if let Err(e) = synced {
            let _ = fs::remove_file(&self.part);
            return Err(format!("The download stopped: {e}"));
        }
        if sha256.is_some_and(|want| !want.eq_ignore_ascii_case(&digest)) {
            let _ = fs::remove_file(&self.part);
            return Err("The download was damaged (its checksum doesn't match). Try again.".into());
        }
        if executable {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.part, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        }
        fs::rename(&self.part, &self.file).map_err(|e| e.to_string())?;
        Ok(self.file.clone())
    }
}

/// The Mac app can be replaced where it is: not run from a quarantined copy
/// (macOS runs those from a hidden read-only place, App Translocation) or a
/// .dmg, and its folder is writable
pub fn can_replace(bundle: &Path) -> bool {
    let s = bundle.to_string_lossy();
    if s.contains("/AppTranslocation/") || s.starts_with("/Volumes/") {
        return false;
    }
    let writable = |p: &Path| {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        CString::new(p.as_os_str().as_bytes()).is_ok_and(|c| unsafe { libc::access(c.as_ptr(), libc::W_OK) } == 0)
    };
    bundle.parent().is_some_and(writable) && writable(bundle)
}

/// Where the new app is put beside the old before they're swapped
pub fn staged_bundle(bundle: &Path) -> PathBuf {
    let stem = bundle.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    bundle.with_file_name(format!(".{stem}-update.app"))
}

/// The new app (checked whole, staged beside the old) put in the old one's
/// place; the old one back if that fails
pub fn swap_bundle(staged: &Path, bundle: &Path) -> io::Result<()> {
    let old = PathBuf::from(format!("{}.old", bundle.display()));
    let _ = fs::remove_dir_all(&old);
    fs::rename(bundle, &old)?;
    if let Err(e) = fs::rename(staged, bundle) {
        fs::rename(&old, bundle)?;
        return Err(e);
    }
    let _ = fs::remove_dir_all(&old);
    Ok(())
}

/// The package installed with the system's installer, as root: pkexec asks
/// for the password. → the command line
pub fn install_command(app: App, pkexec: &str, file: &Path, has_apt: bool) -> Vec<String> {
    let f = file.to_string_lossy().into_owned();
    let tool: Vec<&str> = match app {
        App::Pacman => vec!["/usr/bin/pacman", "-U", "--noconfirm", &f],
        _ if has_apt => vec!["/usr/bin/apt-get", "install", "-y", "--allow-downgrades", &f],
        _ => vec!["/usr/bin/dpkg", "-i", &f],
    };
    std::iter::once(pkexec).chain(tool).map(String::from).collect()
}
