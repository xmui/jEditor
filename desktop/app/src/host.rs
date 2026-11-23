//! What the page asks for (mac/bridge.js), answered as mac/main.js does,
//! with the Rust core doing the work: the page's file handles (fs_host),
//! the sidebar (places), moving the projects folder (moves) and updates.

use crate::{updates, windows, Opts};
use jeditor_core::fs_host::FsHost;
use jeditor_core::{moves, places, places::Places};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// A window: one project each
#[derive(Default)]
pub struct Rec {
    pub ready: bool,
    /// Folders to open once it's ready: (path, smoke)
    pub queue: Vec<(PathBuf, bool)>,
    /// What it shows: { name, path, folders }
    pub state: Option<Value>,
    pub focused_at: u64,
    pub hold_close: bool,
    pub close_heard: bool,
    pub close_asked: Option<Instant>,
    pub close_ok: bool,
    /// A theme's menus for the menu bar
    pub menus: Option<Value>,
    /// Linux, with a theme on: no frame
    pub frameless: bool,
    /// Linux: the window taking this one's place (reframe)
    pub replacement: Option<String>,
    pub lights: Option<Value>,
}

impl Rec {
    pub fn path(&self) -> Option<String> {
        self.state.as_ref()?.get("path")?.as_str().filter(|p| !p.is_empty()).map(String::from)
    }
}

/// This app's own files that Reset jEditor forgets, in its userData
/// folder (as mac/main.js and src/AppReset.cs: test/parity.test.js checks)
pub const RESET_FILES: &[&str] = &["mac.json"];

pub struct Host {
    pub app: AppHandle,
    pub opts: Opts,
    /// The UI's folder (app/)
    pub ui: PathBuf,
    /// host.js, bridge.js and handles.js
    pub host_dir: PathBuf,
    /// The app's own storage: its settings, and jEditor's data (data/)
    pub user_data: PathBuf,
    pub linux: bool,
    pub dev: bool,
    pub fs: FsHost,
    pub places: Places,
    pub windows: Mutex<HashMap<String, Rec>>,
    settings: Mutex<Value>,
    copies: Mutex<HashMap<u64, Arc<AtomicBool>>>,
    smoke_steps: Mutex<Map<String, Value>>,
    started: AtomicBool,
    early: Mutex<Vec<PathBuf>>,
    quitting: AtomicBool,
    /// Quitting for an update: never held
    pub leaving: AtomicBool,
    next_window: AtomicU64,
    focus_seq: AtomicU64,
    pub latest: Mutex<Option<jeditor_core::update::Latest>>,
    pub menu_for: Mutex<String>,
}

fn s<'a>(d: &'a Value, k: &str) -> &'a str {
    d.get(k).and_then(Value::as_str).unwrap_or("")
}
fn b(d: &Value, k: &str) -> bool {
    d.get(k).and_then(Value::as_bool).unwrap_or(false)
}
fn strs(d: &Value, k: &str) -> Vec<String> {
    d.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
}
fn is_dir(p: &str) -> bool {
    Path::new(p).is_absolute() && Path::new(p).is_dir()
}
fn p2s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}
/// Paths on a Mac's disk compare ignoring case, as its file system does
pub fn same(a: &str, b: &str) -> bool {
    !a.is_empty() && !b.is_empty() && p2s(&moves::resolve(Path::new(a))).to_lowercase() == p2s(&moves::resolve(Path::new(b))).to_lowercase()
}

fn first_existing(list: &[Option<PathBuf>]) -> Option<PathBuf> {
    list.iter().flatten().find(|p| p.exists()).cloned()
}

impl Host {
    pub fn new(app: AppHandle, opts: Opts) -> Result<Arc<Host>, Box<dyn std::error::Error>> {
        let linux = std::env::var("JEDITOR_PLATFORM").map(|p| p == "linux").unwrap_or(cfg!(target_os = "linux"));
        let resources = app.path().resource_dir().ok();
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let ui = opts.ui.clone()
            .or_else(|| first_existing(&[resources.as_ref().map(|r| r.join("app").join("index.html"))]).map(|p| p.parent().unwrap().to_path_buf()))
            .unwrap_or_else(|| manifest.join("../../app"));
        let ui = moves::resolve(&ui);
        // Built: Resources/host; from a checkout: this folder and mac/
        let host_dir = match resources.as_ref().map(|r| r.join("host")).filter(|h| h.join("host.js").exists()) {
            Some(h) => h,
            None => {
                let dev = std::env::temp_dir().join(format!("jeditor-tauri-host-{}", std::process::id()));
                std::fs::create_dir_all(&dev)?;
                std::fs::copy(manifest.join("host.js"), dev.join("host.js"))?;
                for f in ["bridge.js", "handles.js"] {
                    std::fs::copy(manifest.join("../../mac").join(f), dev.join(f))?;
                }
                dev
            }
        };
        let dev = opts.ui.is_some() || !resources.as_ref().is_some_and(|r| r.join("app").exists());
        let user_data = match &opts.user_data {
            Some(p) => p.clone(),
            None => app.path().app_data_dir()?,
        };
        std::fs::create_dir_all(user_data.join("data"))?;
        let settings = std::fs::read_to_string(user_data.join("mac.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!({}));
        Ok(Arc::new(Host {
            app,
            opts,
            ui,
            host_dir,
            user_data,
            linux,
            dev,
            fs: FsHost::new(),
            places: Places::from_env(),
            windows: Mutex::new(HashMap::new()),
            settings: Mutex::new(settings),
            copies: Mutex::new(HashMap::new()),
            smoke_steps: Mutex::new(Map::new()),
            started: AtomicBool::new(false),
            early: Mutex::new(Vec::new()),
            quitting: AtomicBool::new(false),
            leaving: AtomicBool::new(false),
            next_window: AtomicU64::new(1),
            focus_seq: AtomicU64::new(1),
            latest: Mutex::new(None),
            menu_for: Mutex::new(String::new()),
        }))
    }

    pub fn log(&self, level: &str, text: &str) {
        let line = format!("{} {level} {text}", updates::now_iso());
        if level == "error" { eprintln!("{line}") } else { println!("{line}") }
    }

    // ---- Settings this app keeps (window place, last folder picked) ----
    pub fn setting(&self, k: &str) -> Value {
        self.settings.lock().unwrap().get(k).cloned().unwrap_or(Value::Null)
    }
    pub fn set_setting(&self, k: &str, v: Value) {
        let text = {
            let mut st = self.settings.lock().unwrap();
            st[k] = v;
            serde_json::to_string_pretty(&*st).unwrap_or_default()
        };
        if let Err(e) = std::fs::write(self.user_data.join("mac.json"), text) {
            self.log("warn", &format!("Settings not saved: {e}"));
        }
    }

    /// What host.js is told: which app this is and what it can do
    pub fn page_flags(&self) -> Value {
        json!({
            "platform": if self.linux { "linux" } else { "mac" },
            "updates": !self.linux && updates::bundle().is_some() || std::env::var_os("JEDITOR_RELEASES").is_some(),
            "photos": false,
            "nativeToolbar": false,
            "dataPath": p2s(&self.user_data.join("data")),
        })
    }

    pub fn quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }
    pub fn set_quitting(&self, on: bool) {
        self.quitting.store(on, Ordering::SeqCst);
    }
    pub fn window_count(&self) -> usize {
        self.windows.lock().unwrap().len()
    }
    pub fn new_label(&self) -> String {
        format!("w{}", self.next_window.fetch_add(1, Ordering::SeqCst))
    }
    pub fn touch(&self, label: &str) {
        let n = self.focus_seq.fetch_add(1, Ordering::SeqCst);
        if let Some(r) = self.windows.lock().unwrap().get_mut(label) {
            r.focused_at = n;
        }
    }
    pub fn last_focused(&self) -> Option<String> {
        self.windows.lock().unwrap().iter().max_by_key(|(_, r)| r.focused_at).map(|(l, _)| l.clone())
    }

    /// A message to the page (bridge.js: mac.onMessage)
    pub fn send(&self, label: &str, msg: Value) {
        if let Some(w) = self.app.get_webview_window(label) {
            let _ = w.eval(format!("window.__jeHost && window.__jeHost.message({msg})"));
        }
    }
    fn send_ready(&self, msg: Value) {
        let labels: Vec<String> = self.windows.lock().unwrap().iter().filter(|(_, r)| r.ready).map(|(l, _)| l.clone()).collect();
        for l in labels {
            self.send(&l, msg.clone());
        }
    }
    /// A drive came or went, or its free space changed: every sidebar again
    pub fn drives_changed(&self) {
        self.send_ready(json!({ "type": "drivesChanged" }));
    }
    /// Every window looks again (photos moved in or out of its project)
    fn files_changed(&self) {
        self.send_ready(json!({ "type": "filesChanged" }));
    }

    pub fn flush(&self, label: &str) {
        let todo: Vec<(PathBuf, bool)> = {
            let mut w = self.windows.lock().unwrap();
            match w.get_mut(label) {
                Some(r) if r.ready => r.queue.drain(..).collect(),
                _ => return,
            }
        };
        for (p, smoke) in todo {
            self.send(label, json!({ "type": "openFolder", "path": p2s(&p), "smoke": smoke }));
        }
    }

    /// Folders to open: from the command line, Finder, the Dock, Open in a
    /// new window. Already open in a window: that one comes forward. Else a
    /// window with nothing open takes it, or a new one opens.
    pub fn open_folder(self: &Arc<Self>, p: &Path, smoke: bool, fresh: bool) -> Option<String> {
        let mut dir = moves::resolve(p);
        match std::fs::metadata(&dir) {
            Ok(m) if !m.is_dir() => dir = dir.parent().map(Path::to_path_buf).unwrap_or(dir), // a photo: its folder
            Ok(_) => {}
            Err(e) => {
                self.log("warn", &format!("Not opened ({e}): {}", dir.display()));
                return None;
            }
        }
        if !self.started.load(Ordering::SeqCst) {
            self.early.lock().unwrap().push(dir);
            return None;
        }
        let d = p2s(&dir);
        let (there, empty) = {
            let w = self.windows.lock().unwrap();
            let there = w.iter().find(|(_, r)| r.path().is_some_and(|x| same(&x, &d)) || r.queue.iter().any(|(q, _)| same(&p2s(q), &d))).map(|(l, _)| l.clone());
            let empty = (!fresh).then(|| w.iter().find(|(_, r)| r.path().is_none() && r.queue.is_empty()).map(|(l, _)| l.clone())).flatten();
            (there, empty)
        };
        if let (Some(l), false) = (&there, smoke) {
            windows::show(self, l);
            return there;
        }
        let label = empty.unwrap_or_else(|| windows::create(self, None));
        if let Some(r) = self.windows.lock().unwrap().get_mut(&label) {
            r.queue.push((dir, smoke));
        }
        self.flush(&label);
        if !smoke {
            windows::show(self, &label);
        }
        Some(label)
    }

    pub fn start(self: &Arc<Self>) {
        self.started.store(true, Ordering::SeqCst);
        // Drives coming and going: their folders looked at every 2 s
        let host = self.clone();
        std::thread::spawn(move || {
            let look = |h: &Host| -> Vec<String> {
                let mut v: Vec<String> = h.places.drive_dirs().iter().flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten().map(|e| p2s(&e.path()))).collect();
                v.sort();
                v
            };
            let mut last = look(&host);
            loop {
                std::thread::sleep(Duration::from_secs(2));
                let now = look(&host);
                if now != last {
                    last = now;
                    std::thread::sleep(Duration::from_millis(500));
                    host.drives_changed();
                }
            }
        });
        let first = windows::create(self, None);
        if let Some(smoke) = self.opts.smoke.clone() {
            if let Some(r) = self.windows.lock().unwrap().get_mut(&first) {
                r.queue.push((smoke, true));
            }
            std::thread::spawn(|| {
                std::thread::sleep(Duration::from_secs(120));
                println!("smoke test FAILED: timed out");
                std::process::exit(1);
            });
        } else {
            let early: Vec<PathBuf> = self.opts.folder.iter().cloned().chain(self.early.lock().unwrap().drain(..)).collect();
            for d in early {
                self.open_folder(&d, false, false);
            }
        }
    }

    // ---- The system's dialogs ----
    fn pictures(&self) -> PathBuf {
        self.app.path().picture_dir().or_else(|_| self.app.path().home_dir()).unwrap_or_else(|_| PathBuf::from("/"))
    }
    fn last_picked(&self) -> PathBuf {
        self.setting("lastPicked").as_str().filter(|p| is_dir(p)).map(PathBuf::from).unwrap_or_else(|| self.pictures())
    }
    fn dialog(&self, label: &str) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
        let d = self.app.dialog().file();
        match self.app.get_webview_window(label) {
            Some(w) => d.set_parent(&w),
            None => d,
        }
    }
    /// The pickers' types ([{ description, accept: { mime: ['.ext'] } }]) as the dialog's filters
    fn filters(mut d: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>, types: Option<&Value>) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
        for t in types.and_then(Value::as_array).into_iter().flatten() {
            let exts: Vec<String> = t.get("accept").and_then(Value::as_object).into_iter().flat_map(|m| m.values())
                .flat_map(|v| v.as_array().cloned().unwrap_or_default())
                .filter_map(|e| e.as_str().map(|e| e.trim_start_matches('.').to_string()))
                .filter(|e| !e.is_empty())
                .collect();
            if !exts.is_empty() {
                let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
                d = d.add_filter(t.get("description").and_then(Value::as_str).unwrap_or("Files"), &refs);
            }
        }
        d
    }

    // ---- The Mac's privacy settings (app/permissions.js) ----
    fn home_folders(&self) -> Vec<PathBuf> {
        let p = self.app.path();
        [p.desktop_dir(), p.document_dir(), p.download_dir()].into_iter().flatten().filter(|d| d.exists()).collect()
    }
    fn removable_drives(&self) -> Vec<PathBuf> {
        self.places.drives().into_iter().filter(|d| d.path != Path::new("/") && d.kind != "network").map(|d| d.path).collect()
    }
    fn full_disk_access(&self) -> bool {
        cfg!(target_os = "macos")
            && self.app.path().home_dir().is_ok_and(|h| std::fs::File::open(h.join("Library/Application Support/com.apple.TCC/TCC.db")).is_ok())
    }
    fn permission_rows(&self) -> Value {
        let asked = self.setting("asked");
        let full = self.full_disk_access();
        let readable = |p: &PathBuf| std::fs::read_dir(p).is_ok();
        let check = |id: &str, paths: &[PathBuf]| {
            if full { "granted" } else if !asked.get(id).and_then(Value::as_bool).unwrap_or(false) { "ask" } else if paths.iter().all(readable) { "granted" } else { "denied" }
        };
        let drives = self.removable_drives();
        json!([
            { "id": "folders", "state": check("folders", &self.home_folders()) },
            { "id": "volumes", "state": if drives.is_empty() && !full { "later" } else { check("volumes", &drives) } },
            { "id": "full", "state": if full { "granted" } else { "off" } },
        ])
    }

    // ---- Photos between projects (windows), by path ----
    fn transfer(&self, paths: &[String], dest: &str, copy: bool) -> Result<Value, String> {
        if !is_dir(dest) {
            return Err("The folder to put them in isn't there".into());
        }
        let mut out = Vec::new();
        for from in paths {
            let f = Path::new(from);
            if !f.is_absolute() || !f.exists() {
                out.push(json!({ "from": from, "error": "not there any more" }));
                continue;
            }
            if f.parent().is_some_and(|p| same(&p2s(p), dest)) {
                out.push(json!({ "from": from, "error": "already in that folder" }));
                continue;
            }
            let to = free_name(Path::new(dest), &f.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
            let r = if copy { copy_new(f, &to) } else { move_file(f, &to) };
            out.push(match r {
                Ok(()) => json!({ "from": from, "to": p2s(&to) }),
                Err(e) => json!({ "from": from, "error": e.to_string() }),
            });
        }
        Ok(Value::Array(out))
    }

    fn undo_transfer(&self, items: &[Value], copy: bool) -> Value {
        let out: Vec<Value> = items.iter().map(|it| {
            let (from, to) = (Path::new(s(it, "from")), Path::new(s(it, "to")));
            let r = if copy {
                std::fs::remove_file(to).map_err(|e| e.to_string())
            } else if from.exists() {
                Err("another file with that name is in its place".into())
            } else {
                move_file(to, from).map_err(|e| e.to_string())
            };
            r.err().map(Value::String).unwrap_or(Value::Null)
        }).collect();
        Value::Array(out)
    }

    // ---- The requests ----
    pub fn request(self: &Arc<Self>, label: &str, kind: &str, d: &Value) -> Result<Value, String> {
        if !self.windows.lock().unwrap().contains_key(label) {
            return Err("Not a jEditor window".into());
        }
        let ok = || Ok(json!({ "ok": true }));
        match kind {
            "fs" => Ok(self.fs.request(s(d, "op"), d.get("data").unwrap_or(&Value::Null))),
            // Where the Files dragged in from Finder are (host.js)
            "dragPaths" => Ok(json!({ "paths": windows::drag_paths() })),
            "pickFolder" | "pickPath" => {
                let title = s(d, "title");
                let start = if kind == "pickPath" {
                    Some(s(d, "start")).filter(|p| is_dir(p)).map(PathBuf::from).unwrap_or_else(|| self.pictures())
                } else {
                    Some(s(d, "defaultPath")).filter(|p| is_dir(p)).map(PathBuf::from).unwrap_or_else(|| self.last_picked())
                };
                let title = if !title.is_empty() { title } else if kind == "pickPath" { "Choose a folder" } else { "Open a folder of photos" };
                let got = self.dialog(label).set_title(title).set_directory(start).set_can_create_directories(true).blocking_pick_folder();
                let Some(p) = got.and_then(|f| f.into_path().ok()) else { return Ok(json!({ "cancelled": true })) };
                if kind == "pickFolder" {
                    if let Some(parent) = p.parent() {
                        self.set_setting("lastPicked", json!(p2s(parent)));
                    }
                }
                Ok(json!({ "path": p2s(&p) }))
            }
            "pickFiles" => {
                let dlg = Self::filters(self.dialog(label).set_directory(self.last_picked()), d.get("types"));
                let paths: Vec<PathBuf> = if b(d, "multiple") {
                    dlg.blocking_pick_files().unwrap_or_default().into_iter().filter_map(|f| f.into_path().ok()).collect()
                } else {
                    dlg.blocking_pick_file().and_then(|f| f.into_path().ok()).into_iter().collect()
                };
                if paths.is_empty() {
                    return Ok(json!({ "cancelled": true }));
                }
                if let Some(parent) = paths[0].parent() {
                    self.set_setting("lastPicked", json!(p2s(parent)));
                }
                Ok(json!({ "paths": paths.iter().map(|p| p2s(p)).collect::<Vec<_>>() }))
            }
            "pickSave" => {
                let dlg = Self::filters(self.dialog(label).set_directory(self.last_picked()).set_file_name(s(d, "suggestedName")), d.get("types"));
                match dlg.blocking_save_file().and_then(|f| f.into_path().ok()) {
                    Some(p) => Ok(json!({ "path": p2s(&p) })),
                    None => Ok(json!({ "cancelled": true })),
                }
            }
            "exists" => Ok(json!({ "exists": strs(d, "paths").iter().map(|p| Path::new(p).is_dir()).collect::<Vec<_>>() })),
            "reveal" => {
                windows::reveal(Path::new(s(d, "path")));
                ok()
            }
            "permissions" => Ok(json!({
                "rows": self.permission_rows(),
                "firstRun": !self.setting("permissionsSeen").as_bool().unwrap_or(false) && std::env::var_os("JEDITOR_SKIP_PERMISSIONS").is_none(),
            })),
            "askPermission" => {
                // The system's own question comes up as each is first read
                let id = s(d, "id");
                let paths = match id { "folders" => self.home_folders(), "volumes" => self.removable_drives(), _ => Vec::new() };
                for p in &paths {
                    let _ = std::fs::read_dir(p);
                }
                let mut asked = self.setting("asked");
                if !asked.is_object() {
                    asked = json!({});
                }
                asked[id] = json!(true);
                self.set_setting("asked", asked);
                ok()
            }
            "openPermissionSettings" => {
                let pane = match s(d, "id") { "full" => "Privacy_AllFiles", "photos" => "Privacy_Photos", _ => "Privacy_FilesAndFolders" };
                windows::open_url(&format!("x-apple.systempreferences:com.apple.preference.security?{pane}"));
                ok()
            }
            "permissionsSeen" => {
                self.set_setting("permissionsSeen", json!(true));
                ok()
            }
            "photosAccess" => Ok(json!({ "status": "denied" })),
            "photosLibrary" | "photosAssets" | "photosSave" | "photosAdd" => Err("No Photos library here".into()),
            "checkUpdate" => updates::check(self, b(d, "beta")),
            // Settings → Troubleshooting (app/reset.js, mac/main.js resetApp):
            // the page has removed what it keeps; for Reset jEditor this
            // app's own files too (RESET_FILES), then jEditor again. The
            // web view's storage isn't wiped: the page has removed what goes
            "resetApp" => {
                let full = b(d, "full");
                if full {
                    *self.settings.lock().unwrap() = json!({});
                    for name in RESET_FILES {
                        if let Err(e) = std::fs::remove_file(self.user_data.join(name)) {
                            if e.kind() != std::io::ErrorKind::NotFound { self.log("warn", &format!("Reset: couldn't remove {name}: {e}")); }
                        }
                    }
                }
                self.log("info", if full { "Reset jEditor: starting again" } else { "Cleared the cache: starting again" });
                if self.opts.smoke.is_some() { return Ok(json!({ "ok": false })); }
                self.leaving.store(true, Ordering::SeqCst);
                let app = self.app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(200));
                    app.restart();
                });
                Ok(json!({ "ok": true }))
            }
            "installUpdate" => updates::install(self, label),
            "ready" => {
                if let Some(r) = self.windows.lock().unwrap().get_mut(label) {
                    r.ready = true;
                    r.hold_close = false;
                    r.close_heard = false;
                    r.close_asked = None;
                }
                self.flush(label);
                ok()
            }
            "theme" => {
                windows::theme(self, label, b(d, "dark"), s(d, "background"));
                ok()
            }
            "holdClose" => {
                if let Some(r) = self.windows.lock().unwrap().get_mut(label) {
                    r.hold_close = b(d, "on");
                }
                ok()
            }
            "closeHeard" => {
                if let Some(r) = self.windows.lock().unwrap().get_mut(label) {
                    r.close_heard = true;
                }
                ok()
            }
            "closeWindow" => {
                let replacement = {
                    let mut w = self.windows.lock().unwrap();
                    let Some(r) = w.get_mut(label) else { return ok() };
                    r.close_asked = None;
                    r.close_heard = false;
                    if b(d, "ok") {
                        r.close_ok = true;
                        None
                    } else {
                        Some(r.replacement.take())
                    }
                };
                match replacement {
                    // Kept open after all: no window takes its place (reframe)
                    Some(rep) => {
                        self.set_quitting(false);
                        if let Some(rep) = rep.and_then(|l| self.app.get_webview_window(&l)) {
                            let _ = rep.destroy();
                        }
                    }
                    // (Quitting goes on: the other windows may ask too)
                    None => {
                        if let Some(w) = self.app.get_webview_window(label) {
                            let _ = w.close();
                        }
                    }
                }
                ok()
            }
            "toolbar" | "toolbarSearch" => Ok(json!({ "ok": false })),
            "titleBar" => {
                windows::title_bar(self, label, b(d, "on"), Some(s(d, "path")).filter(|p| !p.is_empty()));
                ok()
            }
            "menus" => {
                let menus = d.get("menus").filter(|m| m.is_array()).cloned();
                if let Some(r) = self.windows.lock().unwrap().get_mut(label) {
                    r.menus = menus;
                }
                if self.last_focused().as_deref() == Some(label) {
                    crate::menus::build(self);
                }
                ok()
            }
            "windowAction" => {
                if let Some(w) = self.app.get_webview_window(label) {
                    match s(d, "action") {
                        "minimize" => { let _ = w.minimize(); }
                        "maximize" => { if w.is_maximized().unwrap_or(false) { let _ = w.unmaximize(); } else { let _ = w.maximize(); } }
                        "close" => { let _ = w.close(); }
                        _ => {}
                    }
                }
                ok()
            }
            "lights" => {
                // The traffic lights, centred on the page's top row of pills
                let (x, y) = (d.get("x").and_then(Value::as_f64), d.get("y").and_then(Value::as_f64));
                if let Some(r) = self.windows.lock().unwrap().get_mut(label) {
                    r.lights = Some(json!({ "x": x, "y": y }));
                }
                let win = self.app.get_webview_window(label);
                if let (Some(w), Some(x), Some(y)) = (&win, x, y) {
                    windows::place_lights(w, x.round(), y.round());
                }
                let full = win.and_then(|w| w.is_fullscreen().ok()).unwrap_or(false);
                Ok(json!({ "ok": true, "fullscreen": full }))
            }
            // ---- The sidebar (places) ----
            "places" => {
                let home = self.app.path().home_dir().map(|h| places::home(&h)).unwrap_or_default();
                Ok(json!({ "drives": self.places.drives().iter().map(drive_json).collect::<Vec<_>>(), "home": home.iter().map(folder_json).collect::<Vec<_>>() }))
            }
            "listDir" => {
                let p = s(d, "path");
                if !is_dir(p) {
                    return Ok(json!({ "error": "Not a folder" }));
                }
                let drive = self.places.drives().into_iter().find(|x| p2s(&x.path) == p);
                let l = self.places.list_dir(Path::new(p), drive.as_ref().map(|x| x.name.as_str()), b(d, "libraries"))?;
                Ok(json!({
                    "path": p2s(&l.path), "name": l.name, "parent": l.parent.map(|p| p2s(&p)),
                    "folders": l.folders.iter().map(folder_json).collect::<Vec<_>>(), "photos": l.photos, "more": l.more,
                }))
            }
            "listProjects" => {
                let list = places::list_projects(Path::new(s(d, "path")))?;
                Ok(json!({ "projects": list.iter().map(|p| json!({ "name": p.name, "path": p2s(&p.path), "modified": p.modified })).collect::<Vec<_>>() }))
            }
            "makeFolder" => Ok(json!({ "path": p2s(&places::make_folder(Path::new(s(d, "parent")), s(d, "name"))?) })),
            "renameFolder" => Ok(json!({ "path": p2s(&places::rename_folder(Path::new(s(d, "path")), s(d, "name"))?) })),
            "countPhotos" => {
                let lib = b(d, "libraries");
                let counts: Vec<i64> = strs(d, "paths").iter().map(|p| {
                    if Path::new(p).is_absolute() { self.places.count(Path::new(p), lib).map(|n| n as i64).unwrap_or(-1) } else { -1 }
                }).collect();
                Ok(json!({ "counts": counts, "limit": places::LIMIT }))
            }
            "eject" => {
                let p = s(d, "path");
                let why = self.places.eject(Path::new(p));
                self.log("info", &format!("Eject {p}: {}", why.as_deref().unwrap_or("done")));
                self.drives_changed();
                Ok(match why { Some(w) => json!({ "ok": false, "error": w }), None => json!({ "ok": true }) })
            }
            // ---- Folders copied and moved ----
            "copyFolder" => {
                let id = d.get("copy").and_then(Value::as_u64).unwrap_or(0);
                let stop = Arc::new(AtomicBool::new(false));
                self.copies.lock().unwrap().insert(id, stop.clone());
                let mut last: Option<(u64, u64)> = None;
                let mut told = Instant::now() - Duration::from_secs(1);
                let r = places::copy_folder(Path::new(s(d, "path")), Path::new(s(d, "dest")), |done, total| {
                    last = Some((done, total));
                    if told.elapsed() >= Duration::from_millis(200) || done == total {
                        told = Instant::now();
                        self.send(label, json!({ "type": "copyProgress", "copy": id, "done": done, "total": total }));
                    }
                }, &stop);
                self.copies.lock().unwrap().remove(&id);
                match r {
                    Ok(to) => {
                        self.log("info", &format!("Copied {} to {}", s(d, "path"), to.display()));
                        self.drives_changed();
                        let mut out = json!({ "to": p2s(&to) });
                        if let Some((done, total)) = last {
                            out["done"] = json!(done);
                            out["total"] = json!(total);
                        }
                        Ok(out)
                    }
                    Err(_) if stop.load(Ordering::SeqCst) => Ok(json!({ "cancelled": true })),
                    Err(e) => Err(e),
                }
            }
            "folderSize" => {
                let from = Path::new(s(d, "path"));
                let sz = moves::size(from).map_err(|e| e.to_string())?;
                let mut out = json!({ "folders": sz.folders, "files": sz.files, "bytes": sz.bytes });
                let dest = s(d, "dest");
                if !dest.is_empty() {
                    let sp = moves::space(Path::new(dest), Some(from));
                    out["free"] = json!(sp.free.map(|f| f as i64).unwrap_or(-1));
                    out["drive"] = json!(sp.drive);
                    out["sameDrive"] = json!(sp.same_drive);
                    out["refused"] = json!(moves::refuse(from, Path::new(dest)));
                }
                Ok(out)
            }
            "moveFolder" => {
                let id = d.get("copy").and_then(Value::as_u64).unwrap_or(0);
                let stop = Arc::new(AtomicBool::new(false));
                self.copies.lock().unwrap().insert(id, stop.clone());
                let (from, dest) = (s(d, "path"), s(d, "dest"));
                let r = moves::run(Path::new(from), Path::new(dest), |done, total, moved| {
                    self.send(label, json!({ "type": "copyProgress", "copy": id, "done": done, "total": total, "moved": moved }));
                }, &stop);
                self.copies.lock().unwrap().remove(&id);
                self.log("info", &format!("Moved {} from {from} to {dest}{}", r.moved, r.error.as_ref().map(|e| format!(": {e}")).unwrap_or_default()));
                self.drives_changed();
                let mut out = json!({ "moved": r.moved, "left": r.left.iter().map(|l| json!({ "name": l.name, "why": l.why })).collect::<Vec<_>>() });
                if let Some(e) = r.error {
                    out["error"] = json!(e);
                }
                if r.stopped {
                    out["stopped"] = json!(true);
                }
                Ok(out)
            }
            "cancelCopy" => {
                if let Some(stop) = self.copies.lock().unwrap().get(&d.get("copy").and_then(Value::as_u64).unwrap_or(0)) {
                    stop.store(true, Ordering::SeqCst);
                }
                ok()
            }
            // ---- Windows ----
            "newWindow" => {
                let p = s(d, "path");
                if !p.is_empty() {
                    if !is_dir(p) {
                        return Err("That folder isn't there".into());
                    }
                    self.open_folder(Path::new(p), false, true);
                } else {
                    let l = windows::create(self, None);
                    windows::show(self, &l);
                }
                ok()
            }
            "split" => {
                windows::split(self, label);
                ok()
            }
            "state" => {
                let folders = d.get("folders").filter(|f| f.is_array()).cloned().unwrap_or(json!([]));
                if let Some(r) = self.windows.lock().unwrap().get_mut(label) {
                    r.state = Some(json!({ "name": d.get("name").cloned().unwrap_or(Value::Null), "path": d.get("path").cloned().unwrap_or(Value::Null), "folders": folders }));
                }
                ok()
            }
            "windows" => {
                let w = self.windows.lock().unwrap();
                let list: Vec<Value> = w.iter().filter(|(l, r)| l.as_str() != label && r.path().is_some()).map(|(l, r)| {
                    let st = r.state.clone().unwrap_or(json!({}));
                    json!({ "id": l, "name": st.get("name"), "path": st.get("path"), "folders": st.get("folders") })
                }).collect();
                Ok(json!({ "windows": list }))
            }
            "transfer" => {
                let copy = b(d, "copy");
                let items = self.transfer(&strs(d, "paths"), s(d, "dest"), copy)?;
                let n = items.as_array().map(|a| a.iter().filter(|i| i.get("to").is_some()).count()).unwrap_or(0);
                self.log("info", &format!("{} {n} of {} into {}", if copy { "Copied" } else { "Moved" }, items.as_array().map_or(0, Vec::len), s(d, "dest")));
                self.files_changed();
                Ok(json!({ "items": items }))
            }
            "undoTransfer" => {
                let items = d.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
                let errors = self.undo_transfer(&items, b(d, "copy"));
                self.files_changed();
                Ok(json!({ "errors": errors }))
            }
            "log" => {
                let level = Some(s(d, "level")).filter(|l| !l.is_empty()).unwrap_or("info");
                self.log(level, s(d, "text"));
                ok()
            }
            "smokeCheck" => {
                // Looked at on disk, not taken from the page
                let Some(root) = &self.opts.smoke else { return Err("Not a smoke test".into()) };
                let file = s(d, "name").split('/').fold(root.clone(), |p, c| p.join(c));
                let there = file.exists();
                let step = s(d, "step");
                let good = match step { "deleted" => !there, "restored" => there, _ => false };
                let v = if good { json!(true) } else { json!(format!("{} is {}there", s(d, "name"), if there { "" } else { "not " })) };
                self.smoke_steps.lock().unwrap().insert(step.into(), v);
                Ok(json!({ "ok": good }))
            }
            "smoke" => {
                let mut steps = d.get("steps").and_then(Value::as_object).cloned().unwrap_or_default();
                steps.extend(self.smoke_steps.lock().unwrap().clone());
                let errors = d.get("errors").cloned().unwrap_or(json!([]));
                let failed = steps.values().any(|v| v != &json!(true));
                let good = b(d, "ok") && !failed && errors.as_array().is_none_or(Vec::is_empty);
                let report = json!({ "steps": steps, "errors": errors, "error": d.get("error").cloned().unwrap_or(Value::Null) });
                println!("smoke test {}\n{}", if good { "passed" } else { "FAILED" }, serde_json::to_string_pretty(&report).unwrap_or_default());
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(100));
                    std::process::exit(if good { 0 } else { 1 });
                });
                ok()
            }
            _ => Err(format!("Unknown request: {kind}")),
        }
    }
}

fn drive_json(d: &places::Drive) -> Value {
    json!({ "path": p2s(&d.path), "name": d.name, "kind": d.kind, "label": d.label, "total": d.total, "free": d.free })
}
fn folder_json(f: &places::Folder) -> Value {
    json!({ "name": f.name, "path": p2s(&f.path) })
}

/// "Smith.jpg" → "Smith (2).jpg" while the name is taken
fn free_name(dir: &Path, name: &str) -> PathBuf {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut to = dir.join(name);
    let mut n = 2;
    while to.exists() {
        to = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    to
}

/// A copy that never overwrites
fn copy_new(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut src = std::fs::File::open(from)?;
    let mut dst = std::fs::OpenOptions::new().write(true).create_new(true).open(to)?;
    std::io::copy(&mut src, &mut dst)?;
    Ok(())
}

fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    match std::fs::rename(from, to) {
        Ok(()) => Ok(()),
        // Another disk: copied, then the original removed
        Err(e) if e.raw_os_error() == Some(libc_exdev()) => {
            copy_new(from, to)?;
            std::fs::remove_file(from)
        }
        Err(e) => Err(e),
    }
}

const fn libc_exdev() -> i32 {
    18 // EXDEV, the same on macOS and Linux
}
