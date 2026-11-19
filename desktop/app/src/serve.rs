//! The page, at app://jeditor/ (the bridge checks it's this origin), and
//! the app's side of host.js:
//!
//!   /__host/host.js, bridge.js, handles.js   the app's scripts, before jEditor's
//!   POST /__host/request?type=…             a request, JSON in and out
//!   POST /__host/write?id=…&at=…            a handle's bytes, written as they come
//!   /__fs?p=…                               a file's bytes for getFile() (Range too)

use crate::host::Host;
use http::{Request, Response, StatusCode};
use serde_json::{json, Value};
use std::borrow::Cow;
use std::path::Path;

pub const SCHEME: &str = "app";
pub const HOST: &str = "jeditor";

const TYPES: &[(&str, &str)] = &[
    ("html", "text/html; charset=utf-8"),
    ("js", "text/javascript; charset=utf-8"),
    ("mjs", "text/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("json", "application/json"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("svg", "image/svg+xml"),
    ("ico", "image/x-icon"),
    ("woff2", "font/woff2"),
    ("wasm", "application/wasm"),
    ("webmanifest", "application/manifest+json"),
];

fn type_of(p: &Path) -> &'static str {
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    TYPES.iter().find(|(e, _)| *e == ext).map(|(_, t)| *t).unwrap_or("application/octet-stream")
}

fn reply(status: u16, ctype: &str, body: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header("content-type", ctype)
        .header("cache-control", "no-store")
        .body(Cow::Owned(body))
        .unwrap()
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    reply(404, "text/plain", b"Not found".to_vec())
}

fn json_reply(v: &Value) -> Response<Cow<'static, [u8]>> {
    reply(200, "application/json", v.to_string().into_bytes())
}

fn query(uri: &http::Uri, key: &str) -> Option<String> {
    uri.query()?.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        (k == key).then(|| percent_encoding::percent_decode_str(&v.replace('+', " ")).decode_utf8_lossy().into_owned())
    })
}

fn file(host: &Host, p: &Path, body: Option<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    match body.map(Ok).unwrap_or_else(|| std::fs::read(p)) {
        Ok(b) => reply(200, type_of(p), b),
        Err(e) => {
            host.log("error", &format!("Couldn't serve {}: {e}", p.display()));
            not_found()
        }
    }
}

pub fn respond(host: &std::sync::Arc<Host>, label: &str, req: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let uri = req.uri().clone();
    if uri.host().is_some_and(|h| h != HOST) {
        return not_found();
    }
    let rel = percent_encoding::percent_decode_str(uri.path()).decode_utf8_lossy().into_owned();
    match rel.as_str() {
        "/__host/request" => {
            let kind = query(&uri, "type").unwrap_or_default();
            let data: Value = serde_json::from_slice(req.body()).unwrap_or(json!({}));
            let answer = host.request(label, &kind, &data).unwrap_or_else(|e| json!({ "error": e }));
            return json_reply(&answer);
        }
        "/__host/write" => {
            let id = query(&uri, "id").unwrap_or_default();
            let at = query(&uri, "at").and_then(|a| a.parse::<u64>().ok());
            let answer = match host.fs.write_bytes(&id, at, req.body()) {
                Ok(v) => v,
                Err(e) => json!({ "error": { "name": e.name, "message": e.message } }),
            };
            return json_reply(&answer);
        }
        "/__fs" => {
            let p = query(&uri, "p").unwrap_or_default();
            let range = req.headers().get("range").and_then(|v| v.to_str().ok());
            let r = host.fs.respond(Path::new(&p), range);
            let mut b = Response::builder().status(StatusCode::from_u16(r.status).unwrap_or(StatusCode::OK));
            for (k, v) in &r.headers {
                b = b.header(k.as_str(), v.as_str());
            }
            return b.body(Cow::Owned(r.body)).unwrap();
        }
        "/__host/host.js" => {
            // What this app is, in front of host.js
            let flags = host.page_flags();
            let js = std::fs::read_to_string(host.host_dir.join("host.js")).unwrap_or_default();
            return reply(200, "text/javascript; charset=utf-8", format!("window.__jeFlags = {flags};\n{js}").into_bytes());
        }
        "/__host/bridge.js" | "/__host/handles.js" => {
            return file(host, &host.host_dir.join(&rel["/__host/".len()..]), None);
        }
        _ => {}
    }
    let rel = if rel == "/" { "/index.html".to_string() } else { rel };
    // Inside the UI's folder only
    if rel.split('/').any(|c| c == "..") {
        return not_found();
    }
    let path = host.ui.join(rel.trim_start_matches('/'));
    if rel == "/index.html" {
        // host.js, handles.js and bridge.js run before jEditor's own scripts
        let Ok(html) = std::fs::read_to_string(&path) else { return file(host, &path, None) };
        let ours = "<script src=\"/__host/host.js\"></script>\n    <script src=\"/__host/handles.js\"></script>\n    <script src=\"/__host/bridge.js\"></script>\n    <script";
        let html = html.replacen("<script", ours, 1);
        return file(host, &path, Some(html.into_bytes()));
    }
    file(host, &path, None)
}
