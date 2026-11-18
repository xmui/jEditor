//! The core's file requests over stdin and stdout, one JSON object a line,
//! so the page's handles can be run on the Rust core without the app
//! (test/handles.test.js, with JEDITOR_CORE set to this binary):
//!
//!   → {"id": 1, "op": "list", "data": {"path": "/x"}}
//!   ← {"id": 1, "answer": {"entries": [...]}}
//!
//! "read" gives a file's bytes as getFile() has them:
//!   → {"id": 2, "op": "read", "data": {"path": "/x/a.jpg", "range": "bytes=0-99"}}
//!   ← {"id": 2, "answer": {"status": 206, "headers": {...}, "body": "<base64>"}}

use base64::Engine;
use jeditor_core::fs_host::FsHost;
use serde_json::{json, Map, Value};
use std::io::{self, BufRead, Write};
use std::path::Path;

fn main() {
    let host = FsHost::new();
    let stdout = io::stdout();
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let op = req.get("op").and_then(Value::as_str).unwrap_or("");
        let data = req.get("data").cloned().unwrap_or(json!({}));
        let answer = if op == "read" {
            let p = data.get("path").and_then(Value::as_str).unwrap_or("");
            let r = host.respond(Path::new(p), data.get("range").and_then(Value::as_str));
            let headers: Map<String, Value> = r.headers.into_iter().map(|(k, v)| (k, Value::String(v))).collect();
            json!({ "status": r.status, "headers": headers, "body": base64::engine::general_purpose::STANDARD.encode(&r.body) })
        } else {
            host.request(op, &data)
        };
        let mut out = stdout.lock();
        let _ = writeln!(out, "{}", json!({ "id": id, "answer": answer }));
        let _ = out.flush();
    }
}
