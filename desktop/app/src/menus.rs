//! The menu bar: the app's own, or while a theme is on, the theme's menus
//! with jEditor's commands (themes.js: systemMenus), from the window in
//! front, as in mac/main.js. A theme's menus show no keys here: on a Mac a
//! menu's key is taken before the page sees it, and the page answers them
//! itself, so a letter still types in a text field.

use crate::host::Host;
use crate::windows;
use serde_json::json;
use std::sync::Arc;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{Manager, Wry};

type R<T> = tauri::Result<T>;

pub fn build(host: &Arc<Host>) {
    match make(host) {
        Ok(m) => {
            let _ = host.app.set_menu(m);
        }
        Err(e) => host.log("warn", &format!("The menu bar wasn't made: {e}")),
    }
}

fn item(host: &Host, id: &str, label: &str, key: Option<&str>) -> R<MenuItem<Wry>> {
    MenuItem::with_id(&host.app, id, label, true, key)
}

fn make(host: &Arc<Host>) -> R<Menu<Wry>> {
    let app = &host.app;
    let front = host.last_focused();
    let themed = if host.linux { None } else { front.as_ref().and_then(|l| host.windows.lock().unwrap().get(l).and_then(|r| r.menus.clone())) };
    *host.menu_for.lock().unwrap() = themed.as_ref().map(|m| m.to_string()).unwrap_or_default();
    let menu = Menu::new(app)?;
    menu.append(&app_menu(host)?)?;
    let mut help: Option<Submenu<Wry>> = None;
    if let Some(menus) = themed.as_ref().and_then(|m| m.as_array()) {
        for m in menus {
            let label = m.get("label").and_then(|l| l.as_str()).unwrap_or("");
            let mut sub = SubmenuBuilder::new(app, label);
            if label == "File" {
                sub = sub.item(&item(host, "newWindow", "New Window", Some("CmdOrCtrl+Shift+N"))?).separator();
            }
            for it in m.get("items").and_then(|i| i.as_array()).into_iter().flatten() {
                if it.as_str() == Some("—") {
                    sub = sub.separator();
                    continue;
                }
                let id = format!("theme:{}", it.get("id").and_then(|i| i.as_str()).unwrap_or(""));
                let enabled = it.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true);
                let text = it.get("label").and_then(|l| l.as_str()).unwrap_or("");
                sub = sub.item(&MenuItem::with_id(app, id, text, enabled, None::<&str>)?);
            }
            // Cut, copy and paste in text fields go by these on a Mac
            if label == "Edit" {
                sub = sub.separator().cut().copy().paste();
            }
            let built = sub.build()?;
            if label == "Help" { help = Some(built) } else { menu.append(&built)? }
        }
    } else {
        menu.append(
            &SubmenuBuilder::new(app, "File")
                .item(&item(host, "newWindow", "New Window", Some("CmdOrCtrl+Shift+N"))?)
                .item(&item(host, "open", "Open Folder…", Some("CmdOrCtrl+O"))?)
                .separator()
                .item(&PredefinedMenuItem::close_window(app, None)?)
                .build()?,
        )?;
        // Cut, copy, paste and undo in text fields; the page handles ⌘Z
        // and ⌘A on photos itself, before the menu sees them
        menu.append(&SubmenuBuilder::new(app, "Edit").undo().redo().separator().cut().copy().paste().select_all().build()?)?;
        let mut view = SubmenuBuilder::new(app, "View")
            // Reload asks first if something isn't kept (the page's Modes.reload)
            .item(&item(host, "reload", "Reload", Some("CmdOrCtrl+R"))?);
        if host.dev {
            view = view.item(&item(host, "devtools", "Toggle Developer Tools", Some("Alt+CmdOrCtrl+I"))?);
        }
        menu.append(&view.separator().fullscreen().build()?)?;
    }
    menu.append(&SubmenuBuilder::new(app, "Window").minimize().maximize().separator().close_window().build()?)?;
    if let Some(h) = help {
        menu.append(&h)?;
    }
    Ok(menu)
}

fn app_menu(host: &Host) -> R<Submenu<Wry>> {
    let app = &host.app;
    let quit = item(host, "quit", if host.linux { "Quit" } else { "Quit jEditor" }, Some("CmdOrCtrl+Q"))?;
    if host.linux {
        return SubmenuBuilder::new(app, "jEditor")
            .item(&item(host, "settings", "Settings…", Some("Ctrl+,"))?)
            .separator()
            .item(&quit)
            .build();
    }
    let about = AboutMetadata { name: Some("jEditor".into()), version: Some(version(host)), ..Default::default() };
    SubmenuBuilder::new(app, "jEditor")
        .about(Some(about))
        .separator()
        .item(&item(host, "settings", "Settings…", Some("Cmd+,"))?)
        .item(&item(host, "permissions", "Permissions…", None)?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()
}

fn version(host: &Host) -> String {
    let js = std::fs::read_to_string(host.ui.join("version.js")).unwrap_or_default();
    jeditor_core::update::current_version(&js)
}

pub fn clicked(host: &Arc<Host>, id: &str) {
    match id {
        "newWindow" => {
            let l = windows::create(host, None);
            windows::show(host, &l);
        }
        "quit" => windows::quit(host),
        "devtools" => {
            #[cfg(debug_assertions)]
            if let Some(w) = host.last_focused().and_then(|l| host.app.get_webview_window(&l)) {
                if w.is_devtools_open() { w.close_devtools() } else { w.open_devtools() }
            }
        }
        _ => match host.last_focused() {
            Some(l) => host.send(&l, json!({ "type": "menu", "action": id })),
            None if id == "open" => {
                windows::create(host, None);
            }
            None => {}
        },
    }
}
