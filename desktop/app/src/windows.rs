//! The windows: one project each, as in mac/main.js (createWindow, split,
//! reframe, closing while the page holds it), and the bits of the system
//! they need (Show in Finder, links, the drag pasteboard).

use crate::host::{Host, Rec};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::webview::PageLoadEvent;
use tauri::{LogicalSize, Manager, PhysicalPosition, PhysicalSize, Theme, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Where a window opens: { bounds: (x, y, w, h) logical, maximized }
pub struct At {
    pub bounds: (f64, f64, f64, f64),
    pub maximized: bool,
}

fn bounds_of(w: &tauri::WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let scale = w.scale_factor().ok()?;
    let p = w.outer_position().ok()?.to_logical::<f64>(scale);
    let s = w.inner_size().ok()?.to_logical::<f64>(scale);
    Some((p.x, p.y, s.width, s.height))
}

pub fn show(host: &Host, label: &str) {
    if let Some(w) = host.app.get_webview_window(label) {
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// A new window, hidden until its page has loaded → its label
pub fn create(host: &Arc<Host>, at: Option<At>) -> String {
    let label = host.new_label();
    let last = host.last_focused().and_then(|l| host.app.get_webview_window(&l));
    let base = host.setting("bounds");
    let num = |k: &str, d: f64| base.get(k).and_then(|v| v.as_f64()).unwrap_or(d);
    // A new window beside the others: a step down and right of the last
    let bounds = match (&at, last.as_ref().and_then(bounds_of)) {
        (Some(a), _) => Some(a.bounds),
        (None, Some((x, y, w, h))) => Some((x + 28.0, y + 28.0, w, h)),
        (None, None) if base.is_object() => Some((num("x", 80.0), num("y", 60.0), num("width", 1280.0), num("height", 860.0))),
        _ => None,
    };
    let frameless = host.linux && host.setting("themed").as_bool().unwrap_or(false);
    let url = format!("{}://{}/index.html", crate::serve::SCHEME, crate::serve::HOST).parse().unwrap();
    let mut b = WebviewWindowBuilder::new(&host.app, &label, WebviewUrl::CustomProtocol(url))
        .title("jEditor")
        .min_inner_size(640.0, 480.0)
        .visible(false)
        // The page takes drops itself (thumbnails onto the sidebar, layers
        // in Paint): Tauri's own handler would take every drag
        .disable_drag_drop_handler()
        .data_directory(host.user_data.join("webview"))
        .on_navigation(|url| {
            // Nothing but jEditor in the window; links open in the browser
            if url.scheme() == crate::serve::SCHEME {
                return true;
            }
            if matches!(url.scheme(), "http" | "https") {
                open_url(url.as_str());
            }
            false
        })
        .on_new_window(|url, _| {
            if matches!(url.scheme(), "http" | "https") {
                open_url(url.as_str());
            }
            tauri::webview::NewWindowResponse::Deny
        });
    b = match bounds {
        Some((x, y, w, h)) => b.position(x, y).inner_size(w, h),
        None => b.inner_size(1280.0, 860.0).center(),
    };
    if frameless {
        b = b.decorations(false);
    }
    #[cfg(target_os = "macos")]
    {
        // No title bar: the traffic lights sit in the page's top row, which
        // moves the window (style.css), and the Mac's own window material
        // shows through the start screen (the rest of the page is solid)
        use tauri::utils::config::WindowEffectsConfig;
        use tauri::window::{Effect, EffectState};
        b = b
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .transparent(true)
            .effects(WindowEffectsConfig { effects: vec![Effect::UnderWindowBackground], state: Some(EffectState::FollowsWindowActiveState), ..Default::default() });
    }
    #[cfg(not(target_os = "macos"))]
    {
        b = b.background_color(tauri::window::Color(0x11, 0x11, 0x11, 0xff));
    }
    let h = host.clone();
    let l = label.clone();
    b = b.on_page_load(move |w, p| match p.event() {
        PageLoadEvent::Started => {
            if let Some(r) = h.windows.lock().unwrap().get_mut(&l) {
                r.ready = false;
            }
        }
        PageLoadEvent::Finished => {
            // (the smoke test's window too: WebKit slows a hidden page's timers)
            let _ = w.show();
        }
    });
    host.windows.lock().unwrap().insert(label.clone(), Rec { frameless, ..Default::default() });
    host.touch(&label);
    let win = match b.build() {
        Ok(w) => w,
        Err(e) => {
            host.log("error", &format!("Couldn't open a window: {e}"));
            host.windows.lock().unwrap().remove(&label);
            return label;
        }
    };
    let maximized = at.as_ref().map(|a| a.maximized).unwrap_or(last.is_none() && host.setting("maximized").as_bool().unwrap_or(false));
    if maximized {
        let _ = win.maximize();
    }
    let h = host.clone();
    let l = label.clone();
    let w2 = win.clone();
    win.on_window_event(move |e| match e {
        WindowEvent::Focused(true) => {
            h.touch(&l);
            // The menu bar is the window in front's
            let menus = h.windows.lock().unwrap().get(&l).and_then(|r| r.menus.clone()).map(|m| m.to_string()).unwrap_or_default();
            if menus != *h.menu_for.lock().unwrap() {
                crate::menus::build(&h);
            }
        }
        WindowEvent::Resized(_) | WindowEvent::Focused(false) => {
            // AppKit puts the traffic lights back on a resize: where the page had them again
            let lights = h.windows.lock().unwrap().get(&l).and_then(|r| r.lights.clone());
            if let Some(at) = lights {
                place_lights(&w2, at.get("x").and_then(|v| v.as_f64()).unwrap_or(20.0), at.get("y").and_then(|v| v.as_f64()).unwrap_or(26.0));
            }
            if matches!(e, WindowEvent::Focused(false)) {
                return;
            }
            // Zoomed or not, for a theme's maximise button; full screen or not
            let ready = h.windows.lock().unwrap().get(&l).is_some_and(|r| r.ready);
            if ready {
                h.send(&l, json!({ "type": "windowState", "maximized": w2.is_maximized().unwrap_or(false) }));
                h.send(&l, json!({ "type": "fullscreen", "on": w2.is_fullscreen().unwrap_or(false) }));
            }
        }
        WindowEvent::CloseRequested { api, .. } => {
            if hold_close(&h, &l) {
                api.prevent_close();
                return;
            }
            // The last window closed is where the next first one opens
            let maximized = w2.is_maximized().unwrap_or(false);
            h.set_setting("maximized", json!(maximized));
            if !maximized && !w2.is_fullscreen().unwrap_or(false) {
                if let Some((x, y, w, hh)) = bounds_of(&w2) {
                    h.set_setting("bounds", json!({ "x": x, "y": y, "width": w, "height": hh }));
                }
            }
        }
        WindowEvent::Destroyed => {
            let had_menus = h.windows.lock().unwrap().remove(&l).is_some_and(|r| r.menus.is_some());
            if had_menus {
                crate::menus::build(&h);
            }
            if h.quitting() && h.window_count() == 0 {
                h.app.exit(0);
            }
        }
        _ => {}
    });
    label
}

/// Closing while the page holds it (in Adjust or Paint: app/modes.js): the
/// page asks "Keep your changes?" and answers closeWindow. A page that
/// doesn't hear it (closeHeard) in a few seconds doesn't hold the window:
/// closing again closes. Quitting for an update is never held.
fn hold_close(host: &Host, label: &str) -> bool {
    let ask = {
        let mut w = host.windows.lock().unwrap();
        let Some(r) = w.get_mut(label) else { return false };
        if !r.hold_close || r.close_ok || host.leaving.load(std::sync::atomic::Ordering::SeqCst) || host.opts.smoke.is_some() || !r.ready {
            return false;
        }
        if let Some(t) = r.close_asked {
            if !r.close_heard && t.elapsed() > Duration::from_secs(5) {
                return false;
            }
            false
        } else {
            r.close_asked = Some(Instant::now());
            true
        }
    };
    if ask {
        host.send(label, json!({ "type": "closing" }));
    }
    true
}

/// Quit: each window closes as if its close button was pressed (Keep your
/// changes? first), and the app goes when the last one has
pub fn quit(host: &Host) {
    host.set_quitting(true);
    let labels: Vec<String> = host.windows.lock().unwrap().keys().cloned().collect();
    if labels.is_empty() {
        host.app.exit(0);
    }
    for l in labels {
        if let Some(w) = host.app.get_webview_window(&l) {
            let _ = w.close();
        }
    }
}

/// The theme, for the title bar, and the page's background behind it (not
/// on a Mac, where the window stays clear for its material)
pub fn theme(host: &Host, label: &str, dark: bool, background: &str) {
    let Some(w) = host.app.get_webview_window(label) else { return };
    let _ = w.set_theme(Some(if dark { Theme::Dark } else { Theme::Light }));
    if !cfg!(target_os = "macos") {
        if let Some(c) = css_color(background) {
            let _ = w.set_background_color(Some(c));
        }
    }
}

fn css_color(s: &str) -> Option<tauri::window::Color> {
    let inner = s.trim().strip_prefix("rgb")?.trim_start_matches('a').trim_start_matches('(').trim_end_matches(')');
    let n: Vec<f64> = inner.split(|c| c == ',' || c == ' ' || c == '/').filter(|x| !x.is_empty()).filter_map(|x| x.parse().ok()).collect();
    if n.len() < 3 {
        return None;
    }
    let a = n.get(3).map(|a| (a * 255.0) as u8).unwrap_or(255);
    Some(tauri::window::Color(n[0] as u8, n[1] as u8, n[2] as u8, a))
}

/// A theme draws the title bar: its own buttons work the window. On a Mac
/// the traffic lights stay (Tauri can't hide them on their own yet); on
/// Linux, where a window's frame can't come off once it's open, new windows
/// open to match, and this one is swapped for one
pub fn title_bar(host: &Arc<Host>, label: &str, on: bool, project: Option<&str>) {
    if !host.linux {
        return;
    }
    host.set_setting("themed", json!(on));
    let (frameless, path) = match host.windows.lock().unwrap().get(label) {
        Some(r) => (r.frameless, r.path()),
        None => return,
    };
    if on == frameless {
        return;
    }
    let Some(w) = host.app.get_webview_window(label) else { return };
    let at = At { bounds: bounds_of(&w).unwrap_or((80.0, 60.0, 1280.0, 860.0)), maximized: w.is_maximized().unwrap_or(false) };
    let next = create(host, Some(at));
    if let Some(p) = project.map(String::from).or(path) {
        if let Some(r) = host.windows.lock().unwrap().get_mut(&next) {
            r.queue.push((PathBuf::from(p), false));
        }
    }
    if let Some(r) = host.windows.lock().unwrap().get_mut(label) {
        r.replacement = Some(next);
    }
    let _ = w.close();
}

/// This window on the left half of its screen, another on the right (the
/// last one used, or a new one)
pub fn split(host: &Arc<Host>, label: &str) {
    let Some(me) = host.app.get_webview_window(label) else { return };
    let Some(mon) = me.current_monitor().ok().flatten() else { return };
    let area = *mon.work_area();
    let other = {
        let w = host.windows.lock().unwrap();
        w.iter().filter(|(l, _)| l.as_str() != label).max_by_key(|(_, r)| r.focused_at).map(|(l, _)| l.clone())
    };
    let other = other.unwrap_or_else(|| create(host, None));
    let half = area.size.width / 2;
    for (l, x) in [(label.to_string(), area.position.x), (other, area.position.x + half as i32)] {
        let Some(w) = host.app.get_webview_window(&l) else { continue };
        if w.is_fullscreen().unwrap_or(false) {
            let _ = w.set_fullscreen(false);
        }
        if w.is_maximized().unwrap_or(false) {
            let _ = w.unmaximize();
        }
        // A small screen's half can be under the usual minimum width
        let scale = w.scale_factor().unwrap_or(1.0);
        if (half as f64) / scale < 640.0 {
            let _ = w.set_min_size(Some(LogicalSize::new(half as f64 / scale, 480.0)));
        }
        let _ = w.set_position(PhysicalPosition::new(x, area.position.y));
        let _ = w.set_size(PhysicalSize::new(half, area.size.height));
        let _ = w.show();
    }
    let _ = me.set_focus();
}

/// The traffic lights with their top left at (x, y) in the page, as
/// Electron's setWindowButtonPosition (bridge.js: reportLights). A light is
/// 14px; its button may be a little taller, so it's centred on y + 7
#[cfg(target_os = "macos")]
pub fn place_lights(w: &tauri::WebviewWindow, x: f64, y: f64) {
    let w2 = w.clone();
    let _ = w.run_on_main_thread(move || unsafe {
        use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
        let Ok(ptr) = w2.ns_window() else { return };
        let win: &NSWindow = &*(ptr as *const NSWindow);
        let buttons: Vec<_> = [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton]
            .into_iter()
            .filter_map(|b| win.standardWindowButton(b))
            .collect();
        let Some(close) = buttons.first() else { return };
        let Some(container) = close.superview().and_then(|v| v.superview()) else { return };
        let h = NSView::frame(close).size.height;
        let top = (y + 7.0 - h / 2.0).max(0.0);
        let mut bar = NSView::frame(&container);
        bar.size.height = top + h;
        bar.origin.y = win.frame().size.height - bar.size.height;
        container.setFrame(bar);
        for (i, b) in buttons.iter().enumerate() {
            let mut r = NSView::frame(b);
            r.origin.x = x + i as f64 * 20.0;
            r.origin.y = 0.0;
            b.setFrameOrigin(r.origin);
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn place_lights(_w: &tauri::WebviewWindow, _x: f64, _y: f64) {}

/// Show in Finder (the file manager on Linux)
pub fn reveal(p: &Path) {
    use std::process::Command;
    if cfg!(target_os = "macos") {
        let _ = Command::new("/usr/bin/open").arg("-R").arg(p).spawn();
    } else {
        let uri = format!("file://{}", p.display());
        let shown = Command::new("dbus-send")
            .args(["--session", "--dest=org.freedesktop.FileManager1", "--type=method_call", "/org/freedesktop/FileManager1", "org.freedesktop.FileManager1.ShowItems"])
            .arg(format!("array:string:{uri}"))
            .arg("string:")
            .status()
            .is_ok_and(|s| s.success());
        if !shown {
            let _ = Command::new("xdg-open").arg(p.parent().unwrap_or(p)).spawn();
        }
    }
}

/// A link or a system settings pane, in its own app
pub fn open_url(url: &str) {
    let opener = if cfg!(target_os = "macos") { "/usr/bin/open" } else { "xdg-open" };
    let _ = std::process::Command::new(opener).arg(url).spawn();
}

/// What's being dragged in from Finder: the Mac's drag pasteboard has the
/// files' paths, which WebKit doesn't give the page
#[cfg(target_os = "macos")]
pub fn drag_paths() -> Vec<String> {
    use objc2::ClassType;
    use objc2_app_kit::{NSPasteboard, NSPasteboardNameDrag};
    use objc2_foundation::{NSArray, NSURL};
    unsafe {
        let pb = NSPasteboard::pasteboardWithName(NSPasteboardNameDrag);
        let classes = NSArray::from_slice(&[NSURL::class()]);
        let Some(items) = pb.readObjectsForClasses_options(&classes, None) else { return Vec::new() };
        items
            .iter()
            .filter_map(|o| o.downcast::<NSURL>().ok())
            .filter_map(|u| u.path().map(|p| p.to_string()))
            .collect()
    }
}

#[cfg(not(target_os = "macos"))]
pub fn drag_paths() -> Vec<String> {
    Vec::new()
}
