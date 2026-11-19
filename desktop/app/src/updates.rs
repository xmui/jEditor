//! Updates (Settings → Updates): the newest beta with this app in it, its
//! own .dmg (jEditor-<version>-mac-tauri.dmg, beside the Electron app's),
//! downloaded and checked against GitHub's SHA-256, then the app in it put
//! in place of this one, checked whole (codesign --verify) first. Where it
//! can't be (run from the .dmg or Downloads, or Applications isn't
//! writable) the .dmg opens in Finder and jEditor quits, to be dragged in.
//! What's decided is in the core (jeditor_core::update), tested there.

use crate::host::Host;
use jeditor_core::update::{self, App};
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::Manager;

pub fn now_iso() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let (secs, ms) = (t.as_secs(), t.subsec_millis());
    let (days, rem) = (secs / 86400, secs % 86400);
    // Days since 1970 → the date (Howard Hinnant's civil_from_days)
    let z = days as i64 + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{ms:03}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// The jEditor Tauri.app this is running as, or None (not a built app);
/// JEDITOR_APP_BUNDLE: another, for the tests
pub fn bundle() -> Option<PathBuf> {
    if let Some(b) = std::env::var_os("JEDITOR_APP_BUNDLE") {
        return Some(PathBuf::from(b));
    }
    if !cfg!(target_os = "macos") {
        return None;
    }
    let exe = std::env::current_exe().ok()?;
    let b = exe.parent()?.parent()?.parent()?.to_path_buf();
    b.extension().is_some_and(|e| e == "app").then_some(b)
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(20)).build()
}

fn fetch_json(url: &str) -> Result<Value, String> {
    match agent().get(url).set("accept", "application/vnd.github+json").set("user-agent", "jEditor").call() {
        Ok(r) => r.into_string().map_err(|e| e.to_string()).and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string())),
        Err(ureq::Error::Status(404, _)) => Err("No releases yet".into()),
        Err(ureq::Error::Status(n, _)) => Err(format!("GitHub said {n}")),
        Err(e) => Err(e.to_string()),
    }
}

fn version_js(host: &Host) -> String {
    std::fs::read_to_string(host.ui.join("version.js")).unwrap_or_default()
}

/// beta: the newest release or beta with this app in it. The Tauri app is
/// only on betas so far, so it always looks among them
pub fn check(host: &Host, _beta: bool) -> Result<Value, String> {
    let all = std::env::var("JEDITOR_RELEASES_ALL").unwrap_or_else(|_| update::ALL_RELEASES.into());
    let json = fetch_json(&all)?;
    let c = update::check(&json, true, App::MacTauri, &update::current_tag(&version_js(host)))?;
    *host.latest.lock().unwrap() = Some(c.latest.clone());
    Ok(json!({ "current": c.current, "tag": c.tag, "version": c.version, "notes": c.notes, "size": c.size, "newer": c.newer }))
}

fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(cmd).args(args).output().map_err(|e| format!("{cmd}: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let name = Path::new(cmd).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        Err(format!("{name}: {}", String::from_utf8_lossy(&out.stderr).trim().lines().last().unwrap_or("")))
    }
}

/// The app in the .dmg, copied in beside this one, checked, then swapped in
fn replace_bundle(dmg: &Path, bundle: &Path) -> Result<(), String> {
    let mnt = std::env::temp_dir().join(format!("jeditor-update-mnt-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&mnt);
    let staged = update::staged_bundle(bundle);
    let _ = std::fs::remove_dir_all(&staged);
    let (m, d, st) = (mnt.to_string_lossy().into_owned(), dmg.to_string_lossy().into_owned(), staged.to_string_lossy().into_owned());
    run("/usr/bin/hdiutil", &["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", &m, &d])?;
    let copied = (|| {
        let name = std::fs::read_dir(&mnt).map_err(|e| e.to_string())?.flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .find(|n| n.ends_with(".app"))
            .ok_or("there's no app in the update")?;
        run("/usr/bin/ditto", &[&mnt.join(name).to_string_lossy(), &st]).map(|_| ())
    })();
    let _ = run("/usr/bin/hdiutil", &["detach", &m, "-force"]);
    let _ = std::fs::remove_dir_all(&mnt);
    copied?;
    // Whole, as it was built and signed
    if let Err(e) = run("/usr/bin/codesign", &["--verify", "--deep", "--strict", &st]) {
        let _ = std::fs::remove_dir_all(&staged);
        return Err(format!("the new app didn't check out ({e})"));
    }
    update::swap_bundle(&staged, bundle).map_err(|e| e.to_string())
}

pub fn install(host: &Host, label: &str) -> Result<Value, String> {
    if host.latest.lock().unwrap().is_none() {
        check(host, true)?;
    }
    let latest = host.latest.lock().unwrap().clone().ok_or("No update")?;
    if !update::is_newer(&latest.tag, &update::current_tag(&version_js(host))) {
        return Err("This is already the newest version".into());
    }
    let res = agent().get(&latest.url).call().map_err(|e| format!("The download failed ({e})"))?;
    let total: u64 = res.header("content-length").and_then(|v| v.parse().ok()).unwrap_or(latest.size);
    let bundle = bundle();
    let in_place = bundle.as_deref().is_some_and(update::can_replace) && cfg!(target_os = "macos");
    // To a temporary folder when it's put in place here, else Downloads
    let dir = if in_place {
        std::env::temp_dir().join(format!("jeditor-update-{}", std::process::id()))
    } else {
        host.app.path().download_dir().map_err(|e| e.to_string())?
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut dl = update::Download::start(&dir.join(&latest.name)).map_err(|e| e.to_string())?;
    let mut body = res.into_reader();
    let mut buf = vec![0u8; 1 << 16];
    let mut told = Instant::now();
    loop {
        let n = match body.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                dl.abandon();
                return Err(format!("The download stopped: {e}"));
            }
        };
        if let Err(e) = dl.write(&buf[..n]) {
            dl.abandon();
            return Err(format!("The download stopped: {e}"));
        }
        if told.elapsed() > Duration::from_millis(250) {
            told = Instant::now();
            host.send(label, json!({ "type": "updateProgress", "received": dl.received, "total": total }));
        }
    }
    let got = dl.received;
    let file = dl.finish(latest.sha256.as_deref(), false)?;
    if in_place {
        let b = bundle.clone().unwrap();
        match replace_bundle(&file, &b) {
            Ok(()) => {
                let _ = std::fs::remove_dir_all(&dir);
                host.log("info", &format!("Updated to {}", latest.tag));
                host.leaving.store(true, Ordering::SeqCst);
                let app = host.app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1200));
                    let _ = Command::new("/usr/bin/open").arg("-n").arg(&b).spawn();
                    app.exit(0);
                });
                return Ok(json!({ "ok": true, "inPlace": true, "file": file.to_string_lossy(), "received": got, "total": total }));
            }
            Err(e) => host.log("warn", &format!("Not updated in place: {e}")),
        }
    }
    // The .dmg opened in Finder, and jEditor quits so it can be replaced
    let why = if bundle.is_some() { Some("move jEditor Tauri into Applications to have it update itself") } else { None };
    run("/usr/bin/open", &[&file.to_string_lossy()]).map_err(|e| format!("Downloaded to {}, but it didn't open: {e}", file.display()))?;
    host.log("info", &format!("Update opened: {}", file.display()));
    host.leaving.store(true, Ordering::SeqCst);
    let app = host.app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        app.exit(0);
    });
    Ok(json!({ "ok": true, "inPlace": false, "why": why, "file": file.to_string_lossy(), "received": got, "total": total }))
}
