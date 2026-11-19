//! jEditor on Tauri: the jEditor UI (../../app, or Resources/app in the
//! built app) in the system's own web view, WKWebView on a Mac (WebKitGTK on
//! Linux), as Windows runs it in WebView2. Step 3 of
//! docs/plans/lighter-desktop.md: built on betas next to the Electron app
//! (mac/), as "jEditor Tauri", until it can take its place.
//!
//! The page, mac/bridge.js and mac/handles.js are the same files as in the
//! Electron app. WebKit has no File System Access for folders on disk, so
//! the page's folder handles are always the app's own (handles.js), backed
//! by the Rust core (../core). desktop/app/host.js gives the bridge what
//! Electron's preload.js does, over this app's scheme.
//!
//!   jeditor [folder]             open that folder
//!   --ui <folder>                run the UI from that folder (or JEDITOR_UI)
//!   --user-data <folder>         a different profile
//!   --smoke-test <folder>        open it, edit, check on disk, exit 0 or 1

mod host;
mod menus;
mod serve;
mod updates;
mod windows;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Manager, RunEvent};

/// The command line
#[derive(Default, Clone)]
pub struct Opts {
    pub folder: Option<PathBuf>,
    pub ui: Option<PathBuf>,
    pub smoke: Option<PathBuf>,
    pub user_data: Option<PathBuf>,
}

pub fn parse_args(args: impl Iterator<Item = String>) -> Opts {
    let mut out = Opts { ui: std::env::var_os("JEDITOR_UI").filter(|v| !v.is_empty()).map(PathBuf::from), ..Default::default() };
    let args: Vec<String> = args.collect();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        let next = || args.get(i + 1).map(|s| moves_resolve(s));
        match a.as_str() {
            "--ui" => { out.ui = next(); i += 1; }
            "--smoke-test" => { out.smoke = next(); i += 1; }
            "--user-data" => { out.user_data = next(); i += 1; }
            _ if !a.starts_with('-') && out.folder.is_none() && !a.starts_with("-psn_") => out.folder = Some(moves_resolve(a)),
            _ => {}
        }
        i += 1;
    }
    out
}

fn moves_resolve(s: &str) -> PathBuf {
    jeditor_core::moves::resolve(std::path::Path::new(s))
}

fn main() {
    let opts = parse_args(std::env::args().skip(1));
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol(serve::SCHEME, |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            let label = ctx.webview_label().to_string();
            // Off the main thread: files, folders and dialogs take their time
            std::thread::spawn(move || {
                let host = app.state::<Arc<host::Host>>().inner().clone();
                responder.respond(serve::respond(&host, &label, req));
            });
        })
        .setup(move |app| {
            let host = host::Host::new(app.handle().clone(), opts.clone())?;
            app.manage(host.clone());
            menus::build(&host);
            host.start();
            Ok(())
        })
        .on_menu_event(|app, event| {
            let host = app.state::<Arc<host::Host>>().inner().clone();
            menus::clicked(&host, event.id().as_ref());
        })
        .build(tauri::generate_context!())
        .expect("jEditor couldn't start");

    app.run(|app, event| {
        let Some(host) = app.try_state::<Arc<host::Host>>().map(|s| s.inner().clone()) else { return };
        match event {
            // Finder's Open With and the Dock icon
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            RunEvent::Opened { urls } => {
                for u in urls {
                    if let Ok(p) = u.to_file_path() {
                        host.open_folder(&p, false, false);
                    }
                }
            }
            // The Dock icon clicked with no window open
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { has_visible_windows, .. } => {
                if !has_visible_windows && host.window_count() == 0 {
                    windows::create(&host, None);
                }
            }
            // A Mac app stays open with no windows (the Dock brings one
            // back); not so elsewhere, or when quitting
            RunEvent::ExitRequested { api, code, .. } => {
                if code.is_none() && cfg!(target_os = "macos") && !host.quitting() && host.opts.smoke.is_none() {
                    api.prevent_exit();
                }
            }
            _ => {}
        }
    });
}
