// The file requests (src/fs_host.rs): what Chromium's handles do, errors
// included. test/handles.test.js runs the page's whole set of them
// (test/handles-conformance.js) on this core as well.
mod common;
use common::Tmp;
use jeditor_core::fs_host::{is_swap, FsHost};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

fn err(v: &Value) -> &str {
    v["error"]["name"].as_str().unwrap_or("")
}

fn write(host: &FsHost, path: &Path, keep: bool, chunks: &[(Option<u64>, &[u8])]) -> Value {
    let id = host.request("open", &json!({ "path": path, "keep": keep }))["id"].as_str().unwrap().to_string();
    for (at, b) in chunks {
        host.write_bytes(&id, *at, b).unwrap();
    }
    host.request("close", &json!({ "id": id }))
}

#[test]
fn files_and_folders_are_made_found_and_listed() {
    let t = Tmp::new("fs");
    let h = FsHost::new();
    assert_eq!(err(&h.request("child", &json!({ "path": t.s(), "name": "a.txt", "kind": "file" }))), "NotFoundError");
    let a = h.request("child", &json!({ "path": t.s(), "name": "a.txt", "kind": "file", "create": true }));
    assert_eq!(a["kind"], "file");
    assert_eq!(a["size"], 0);
    assert_eq!(a["path"], t.join("a.txt").to_string_lossy().as_ref());
    let d = h.request("child", &json!({ "path": t.s(), "name": "Ceremony", "kind": "directory", "create": true }));
    assert_eq!(d["kind"], "directory");
    // Asked for as the other kind
    assert_eq!(err(&h.request("child", &json!({ "path": t.s(), "name": "a.txt", "kind": "directory" }))), "TypeMismatchError");
    assert_eq!(err(&h.request("child", &json!({ "path": t.s(), "name": "Ceremony", "kind": "file", "create": true }))), "TypeMismatchError");
    // Names that aren't one
    for bad in ["", ".", "..", "a/b", "a\\b"] {
        assert_eq!(err(&h.request("child", &json!({ "path": t.s(), "name": bad, "kind": "file", "create": true }))), "TypeError", "{bad:?}");
    }
    assert_eq!(err(&h.request("list", &json!({ "path": "relative/path" }))), "TypeError");
    assert_eq!(err(&h.request("list", &json!({ "path": t.join("a.txt") }))), "TypeMismatchError");
    assert_eq!(err(&h.request("list", &json!({ "path": t.join("gone") }))), "NotFoundError");
    assert_eq!(err(&h.request("stat", &json!({ "path": t.join("gone/deeper") }))), "NotFoundError");
    assert_eq!(err(&h.request("nonsense", &json!({}))), "TypeError");

    let mut names: Vec<String> = h.request("list", &json!({ "path": t.s() }))["entries"].as_array().unwrap().iter().map(|e| format!("{}:{}", e["name"].as_str().unwrap(), e["kind"].as_str().unwrap())).collect();
    names.sort();
    assert_eq!(names, ["Ceremony:directory", "a.txt:file"]);
    let st = h.request("stat", &json!({ "path": t.join("a.txt") }));
    assert!(st["mtime"].as_f64().unwrap() > 1.6e12, "{st}");
}

#[test]
fn links_are_followed_and_broken_ones_left_out() {
    let t = Tmp::new("links");
    let h = FsHost::new();
    t.file("real.jpg", b"12345");
    std::os::unix::fs::symlink(t.join("real.jpg"), t.join("link.jpg")).unwrap();
    std::os::unix::fs::symlink(t.join("nothing"), t.join("broken.jpg")).unwrap();
    let list = h.request("list", &json!({ "path": t.s() }));
    let mut got: Vec<String> = list["entries"].as_array().unwrap().iter().map(|e| format!("{}={}", e["name"].as_str().unwrap(), e["size"])).collect();
    got.sort();
    assert_eq!(got, ["link.jpg=5", "real.jpg=5"]);
}

#[test]
fn a_write_lands_only_on_close() {
    let t = Tmp::new("write");
    let h = FsHost::new();
    let f = t.file("photo.jpg", b"original");
    let id = h.request("open", &json!({ "path": f }))["id"].as_str().unwrap().to_string();
    h.write_bytes(&id, None, b"new bytes").unwrap();
    // Not yet: the photo is as it was, and the half write isn't listed
    assert_eq!(fs::read(&f).unwrap(), b"original");
    assert_eq!(t.names("").len(), 2);
    assert_eq!(h.request("list", &json!({ "path": t.s() }))["entries"].as_array().unwrap().len(), 1);
    assert_eq!(h.request("close", &json!({ "id": id })), json!({}));
    assert_eq!(fs::read(&f).unwrap(), b"new bytes");
    assert_eq!(t.names(""), ["photo.jpg"]);
    // A closed write can't be used again
    assert_eq!(err(&h.request("close", &json!({ "id": id }))), "InvalidStateError");
    assert_eq!(err(&h.request("write", &json!({ "id": id, "data": "x" }))), "InvalidStateError");
}

#[test]
fn keep_seek_truncate_and_abort() {
    let t = Tmp::new("keep");
    let h = FsHost::new();
    let f = t.file("a.txt", b"hello world");
    // keepExistingData: starts with the file's bytes, written over at a place
    assert_eq!(write(&h, &f, true, &[(Some(6), b"WORLD")]), json!({}));
    assert_eq!(fs::read_to_string(&f).unwrap(), "hello WORLD");
    // Without: starts empty
    assert_eq!(write(&h, &f, false, &[(None, b"ab"), (None, b"cd")]), json!({}));
    assert_eq!(fs::read_to_string(&f).unwrap(), "abcd");
    // seek and truncate
    let id = h.request("open", &json!({ "path": f, "keep": true }))["id"].as_str().unwrap().to_string();
    h.request("seek", &json!({ "id": id, "at": 1 }));
    h.request("write", &json!({ "id": id, "data": "Zg==", "b64": true }));
    h.request("truncate", &json!({ "id": id, "size": 3 }));
    // (where it had got to: 2, within the new size)
    h.request("write", &json!({ "id": id, "data": [33] }));
    h.request("close", &json!({ "id": id }));
    assert_eq!(fs::read_to_string(&f).unwrap(), "af!");
    // abort: nothing changes, nothing is left
    let id = h.request("open", &json!({ "path": f }))["id"].as_str().unwrap().to_string();
    h.write_bytes(&id, None, b"never").unwrap();
    assert_eq!(h.request("abort", &json!({ "id": id })), json!({}));
    assert_eq!(fs::read_to_string(&f).unwrap(), "af!");
    assert_eq!(t.names(""), ["a.txt"]);
    // A folder can't be written
    assert_eq!(err(&h.request("open", &json!({ "path": t.s() }))), "TypeMismatchError");
}

#[test]
fn a_file_removed_while_written_says_not_found() {
    let t = Tmp::new("gone");
    let h = FsHost::new();
    let f = t.file("a.txt", b"x");
    let id = h.request("open", &json!({ "path": f }))["id"].as_str().unwrap().to_string();
    // (Its folder goes: the swap file with it)
    fs::remove_dir_all(t.path()).unwrap();
    assert_eq!(err(&h.request("close", &json!({ "id": id }))), "NotFoundError");
}

#[test]
fn remove_files_and_folders() {
    let t = Tmp::new("remove");
    let h = FsHost::new();
    t.file("full/a.jpg", b"x");
    fs::create_dir(t.join("empty")).unwrap();
    t.file("b.jpg", b"x");
    assert_eq!(err(&h.request("remove", &json!({ "path": t.s(), "name": "full" }))), "InvalidModificationError");
    assert_eq!(h.request("remove", &json!({ "path": t.s(), "name": "full", "recursive": true })), json!({}));
    assert_eq!(h.request("remove", &json!({ "path": t.s(), "name": "empty" })), json!({}));
    assert_eq!(h.request("remove", &json!({ "path": t.s(), "name": "b.jpg" })), json!({}));
    assert_eq!(err(&h.request("remove", &json!({ "path": t.s(), "name": "b.jpg" }))), "NotFoundError");
    assert!(t.names("").is_empty());
}

#[test]
fn move_renames_and_moves_over_a_file_never_a_folder() {
    let t = Tmp::new("move");
    let h = FsHost::new();
    let a = t.file("a.jpg", b"A");
    t.file("other/b.jpg", b"B");
    let r = h.request("move", &json!({ "path": a, "kind": "file", "to": t.s(), "name": "renamed.jpg" }));
    assert_eq!(r["path"], t.join("renamed.jpg").to_string_lossy().as_ref());
    // Over a file there, as Chromium's does
    let r = h.request("move", &json!({ "path": t.join("renamed.jpg"), "kind": "file", "to": t.join("other"), "name": "b.jpg" }));
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(fs::read(t.join("other/b.jpg")).unwrap(), b"A");
    assert_eq!(t.names(""), ["other"]);
    // Not over a folder, not a folder, not into a file
    t.file("c.jpg", b"C");
    assert_eq!(err(&h.request("move", &json!({ "path": t.join("c.jpg"), "kind": "file", "to": t.s(), "name": "other" }))), "InvalidModificationError");
    assert_eq!(err(&h.request("move", &json!({ "path": t.join("other"), "kind": "directory", "to": t.s(), "name": "x" }))), "TypeError");
    assert_eq!(err(&h.request("move", &json!({ "path": t.join("c.jpg"), "kind": "file", "to": t.join("c.jpg"), "name": "x" }))), "TypeMismatchError");
    assert_eq!(err(&h.request("move", &json!({ "path": t.join("nope.jpg"), "kind": "file", "to": t.s(), "name": "x" }))), "NotFoundError");
    // Onto itself: nothing happens
    let r = h.request("move", &json!({ "path": t.join("c.jpg"), "kind": "file", "to": t.s(), "name": "c.jpg" }));
    assert_eq!(r["path"], t.join("c.jpg").to_string_lossy().as_ref());
    assert_eq!(fs::read(t.join("c.jpg")).unwrap(), b"C");
}

#[test]
fn get_file_gives_the_bytes_or_a_range() {
    let t = Tmp::new("respond");
    let h = FsHost::new();
    let f = t.file("a.bin", b"0123456789");
    let r = h.respond(&f, None);
    assert_eq!((r.status, r.body.as_slice()), (200, b"0123456789".as_slice()));
    assert!(r.header("x-mtime").unwrap().parse::<f64>().unwrap() > 1.6e12);
    assert_eq!(r.header("accept-ranges"), Some("bytes"));
    let r = h.respond(&f, Some("bytes=2-4"));
    assert_eq!((r.status, r.body.as_slice(), r.header("content-range")), (206, b"234".as_slice(), Some("bytes 2-4/10")));
    let r = h.respond(&f, Some("bytes=7-"));
    assert_eq!((r.status, r.body.as_slice()), (206, b"789".as_slice()));
    let r = h.respond(&f, Some("bytes=-3"));
    assert_eq!((r.status, r.body.as_slice()), (206, b"789".as_slice()));
    let r = h.respond(&f, Some("bytes=5-100"));
    assert_eq!((r.status, r.body.as_slice(), r.header("content-range")), (206, b"56789".as_slice(), Some("bytes 5-9/10")));
    assert_eq!(h.respond(&f, Some("bytes=10-")).status, 416);
    // Not a range at all: the whole file
    assert_eq!(h.respond(&f, Some("pages=1")).status, 200);
    // Not there, or a folder: said in a header, not a 404
    let r = h.respond(&t.join("gone"), None);
    assert_eq!((r.status, r.header("x-fs-error")), (200, Some("NotFoundError")));
    assert_eq!(h.respond(t.path(), None).header("x-fs-error"), Some("TypeMismatchError"));
}

#[test]
fn swap_names() {
    assert!(is_swap(".photo.jpg.0123456789abcdef.jeditor-swap"));
    assert!(!is_swap("photo.jpg.0123456789abcdef.jeditor-swap"));
    assert!(!is_swap(".photo.jpg.0123456789ABCDEF.jeditor-swap"));
    assert!(!is_swap(".photo.jpg.0123.jeditor-swap"));
    assert!(!is_swap(".0123456789abcdef.jeditor-swap"));
    assert!(!is_swap("photo.jpg"));
}
