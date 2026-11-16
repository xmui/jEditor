// Step 0 spike: a Tauri v2 window that loads jEditor's page (app/) unchanged.
// No host calls yet: the page runs as it does on the web.
// For measuring, it prints "LOADED <unix ms>" when the page has loaded.
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::webview::PageLoadEvent;

fn main() {
    tauri::Builder::default()
        .on_page_load(|_w, p| {
            if p.event() == PageLoadEvent::Finished {
                let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
                println!("LOADED {ms}");
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running jEditor spike");
}
