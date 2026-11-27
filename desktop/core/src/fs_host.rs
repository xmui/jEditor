//! The host's side of the page's file handles (mac/handles.js): the file
//! operations, on paths. The twin of mac/fs-host.js, answer for answer.
//!
//! Each behaves as Chromium's own handles do on a folder on disk, errors
//! included: they come with the same names (`NotFoundError`,
//! `TypeMismatchError`, `InvalidModificationError`, `TypeError`), and a
//! write goes to a file of its own beside the photo, put in its place only
//! on `close()`, so a photo is never left half written.
//!
//! [`FsHost::request`] takes the page's requests as JSON (as the bridge
//! sends them) and [`FsHost::respond`] gives a file's bytes for `getFile()`,
//! a range of them if asked.

use serde_json::{json, Map, Value};
use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::hash::{BuildHasher, Hasher};
use std::io;
use std::os::unix::fs::FileExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// An error as the page's handles throw it: a DOMException's name and message
#[derive(Debug, Clone, PartialEq)]
pub struct Fail {
    pub name: String,
    pub message: String,
}

impl Fail {
    pub fn new(name: &str, message: impl Into<String>) -> Self {
        Fail { name: name.into(), message: message.into() }
    }
}

impl From<io::Error> for Fail {
    fn from(e: io::Error) -> Self {
        let name = match e.kind() {
            io::ErrorKind::NotFound => "NotFoundError",
            io::ErrorKind::PermissionDenied => "NotAllowedError",
            _ => "InvalidStateError",
        };
        Fail::new(name, e.to_string())
    }
}

type Answer = Result<Value, Fail>;

fn not_found(what: &Path) -> Fail {
    Fail::new("NotFoundError", format!("A requested file or directory could not be found: {}", what.display()))
}

/// A write in progress is kept as ".<name>.<id>.jeditor-swap" in the same
/// folder; listings leave those out
pub fn is_swap(name: &str) -> bool {
    let Some(rest) = name.strip_prefix('.') else { return false };
    let Some(rest) = rest.strip_suffix(".jeditor-swap") else { return false };
    match rest.rfind('.') {
        Some(i) if i > 0 => {
            let id = &rest[i + 1..];
            id.len() == 16 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }
        _ => false,
    }
}

fn check_name(name: &str) -> Result<(), Fail> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
        return Err(Fail::new("TypeError", format!("Name is not allowed: {name:?}")));
    }
    Ok(())
}

fn check_path(p: &str) -> Result<PathBuf, Fail> {
    let path = PathBuf::from(p);
    if p.is_empty() || !path.is_absolute() {
        return Err(Fail::new("TypeError", "Not a path on disk"));
    }
    Ok(path)
}

fn stat_of(p: &Path) -> Result<fs::Metadata, Fail> {
    fs::metadata(p).map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound || e.raw_os_error() == Some(libc::ENOTDIR) {
            not_found(p)
        } else {
            e.into()
        }
    })
}

fn kind_of(st: &fs::Metadata) -> &'static str {
    if st.is_dir() { "directory" } else { "file" }
}

fn info(st: &fs::Metadata) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("kind".into(), json!(kind_of(st)));
    m.insert("size".into(), json!(if st.is_dir() { 0 } else { st.len() }));
    m.insert("mtime".into(), json!(crate::millis(st.modified())));
    m
}

fn str_of<'a>(data: &'a Value, key: &str) -> &'a str {
    data.get(key).and_then(Value::as_str).unwrap_or("")
}

fn bool_of(data: &Value, key: &str) -> bool {
    data.get(key).and_then(Value::as_bool).unwrap_or(false)
}

struct Writer {
    target: PathBuf,
    temp: PathBuf,
    file: File,
    pos: u64,
}

/// The file operations, with the writes in progress
pub struct FsHost {
    writers: Mutex<HashMap<String, Writer>>,
    ids: RandomState,
    next: AtomicU64,
}

impl Default for FsHost {
    fn default() -> Self {
        Self::new()
    }
}

/// A file's bytes for `getFile()`: what the custom scheme (`jfs://`) answers
#[derive(Debug)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

impl FsHost {
    pub fn new() -> Self {
        FsHost { writers: Mutex::new(HashMap::new()), ids: RandomState::new(), next: AtomicU64::new(0) }
    }

    /// 16 hex digits, not to be guessed
    fn id(&self) -> String {
        let mut h = self.ids.build_hasher();
        h.write_u64(self.next.fetch_add(1, Ordering::Relaxed));
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        format!("{:016x}", h.finish())
    }

    fn swap_name(&self, p: &Path) -> PathBuf {
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        p.with_file_name(format!(".{name}.{}.jeditor-swap", self.id()))
    }

    /// A request from the page → its answer, or `{ error: { name, message } }`
    pub fn request(&self, op: &str, data: &Value) -> Value {
        let answer = match op {
            "stat" => self.stat(data),
            "list" => self.list(data),
            "child" => self.child(data),
            "remove" => self.remove(data),
            "move" => self.move_to(data),
            "open" => self.open(data),
            "write" => match bytes_of(data) {
                Ok(bytes) => self.write_bytes(str_of(data, "id"), data.get("at").and_then(Value::as_u64), &bytes),
                Err(e) => Err(e),
            },
            "seek" => self.seek(data),
            "truncate" => self.truncate(data),
            "close" => self.close(data),
            "abort" => self.abort(data),
            _ => Err(Fail::new("TypeError", format!("Unknown file operation: {op}"))),
        };
        match answer {
            Ok(v) => v,
            Err(e) => json!({ "error": { "name": e.name, "message": e.message } }),
        }
    }

    /// → { kind, size, mtime }
    pub fn stat(&self, data: &Value) -> Answer {
        let p = check_path(str_of(data, "path"))?;
        Ok(Value::Object(info(&stat_of(&p)?)))
    }

    /// A folder's entries → { entries: [{ name, kind, size, mtime }] }
    pub fn list(&self, data: &Value) -> Answer {
        let p = check_path(str_of(data, "path"))?;
        if !stat_of(&p)?.is_dir() {
            return Err(Fail::new("TypeMismatchError", format!("Not a folder: {}", p.display())));
        }
        let mut entries = Vec::new();
        for d in fs::read_dir(&p)? {
            let Ok(d) = d else { continue };
            let name = d.file_name().to_string_lossy().into_owned();
            if is_swap(&name) {
                continue;
            }
            // Links are followed, as Chromium does; a broken one is left out
            let Ok(st) = fs::metadata(d.path()) else { continue };
            if !st.is_file() && !st.is_dir() {
                continue;
            }
            let mut e = Map::new();
            e.insert("name".into(), json!(name));
            e.extend(info(&st));
            entries.push(Value::Object(e));
        }
        Ok(json!({ "entries": entries }))
    }

    /// getFileHandle / getDirectoryHandle → { path, kind, size, mtime }
    pub fn child(&self, data: &Value) -> Answer {
        let p = check_path(str_of(data, "path"))?;
        let name = str_of(data, "name");
        check_name(name)?;
        let kind = str_of(data, "kind");
        if !stat_of(&p)?.is_dir() {
            return Err(Fail::new("TypeMismatchError", format!("Not a folder: {}", p.display())));
        }
        let to = p.join(name);
        let answer = |st: &fs::Metadata| {
            let mut m = Map::new();
            m.insert("path".into(), json!(to.to_string_lossy()));
            m.extend(info(st));
            Value::Object(m)
        };
        match fs::metadata(&to) {
            Ok(st) => {
                if kind_of(&st) != kind {
                    return Err(Fail::new("TypeMismatchError", format!("{name} is not a {kind}")));
                }
                return Ok(answer(&st));
            }
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e.into()),
            Err(_) => {}
        }
        if !bool_of(data, "create") {
            return Err(not_found(&to));
        }
        if kind == "directory" {
            fs::create_dir(&to)?;
        } else {
            OpenOptions::new().write(true).create_new(true).open(&to)?;
        }
        Ok(answer(&fs::metadata(&to)?))
    }

    pub fn remove(&self, data: &Value) -> Answer {
        let p = check_path(str_of(data, "path"))?;
        let name = str_of(data, "name");
        check_name(name)?;
        let to = p.join(name);
        let st = stat_of(&to)?;
        if st.is_dir() {
            if !bool_of(data, "recursive") {
                let full = fs::read_dir(&to)?.flatten().any(|e| !is_swap(&e.file_name().to_string_lossy()));
                if full {
                    return Err(Fail::new("InvalidModificationError", format!("The folder is not empty: {}", to.display())));
                }
            }
            fs::remove_dir_all(&to)?;
        } else {
            fs::remove_file(&to)?;
        }
        Ok(json!({}))
    }

    /// A file to another folder and/or name, over a file there (as
    /// Chromium's move does) → { path }. Chromium won't move a folder; nor
    /// does this
    pub fn move_to(&self, data: &Value) -> Answer {
        let from = check_path(str_of(data, "path"))?;
        let dir = check_path(str_of(data, "to"))?;
        let name = str_of(data, "name");
        check_name(name)?;
        if str_of(data, "kind") == "directory" {
            return Err(Fail::new("TypeError", "A folder can't be moved"));
        }
        if stat_of(&from)?.is_dir() {
            return Err(Fail::new("TypeMismatchError", format!("Not a file: {}", from.display())));
        }
        if !stat_of(&dir)?.is_dir() {
            return Err(Fail::new("TypeMismatchError", format!("Not a folder: {}", dir.display())));
        }
        let to = dir.join(name);
        if to == from {
            return Ok(json!({ "path": to.to_string_lossy() }));
        }
        if fs::metadata(&to).map(|m| m.is_dir()).unwrap_or(false) {
            return Err(Fail::new("InvalidModificationError", format!("A folder has that name: {}", to.display())));
        }
        if let Err(e) = fs::rename(&from, &to) {
            if e.raw_os_error() != Some(libc::EXDEV) {
                return Err(e.into());
            }
            // Another disk: copied (under a swap name, then put in place), then the original removed
            let temp = self.swap_name(&to);
            if let Err(e) = fs::copy(&from, &temp).and_then(|_| fs::rename(&temp, &to)) {
                let _ = fs::remove_file(&temp);
                return Err(e.into());
            }
            fs::remove_file(&from)?;
        }
        Ok(json!({ "path": to.to_string_lossy() }))
    }

    /// createWritable → { id }. keep: starts with the file's bytes
    pub fn open(&self, data: &Value) -> Answer {
        let p = check_path(str_of(data, "path"))?;
        if stat_of(&p)?.is_dir() {
            return Err(Fail::new("TypeMismatchError", format!("Not a file: {}", p.display())));
        }
        let temp = self.swap_name(&p);
        let keep = bool_of(data, "keep");
        let file = (|| {
            if keep {
                fs::copy(&p, &temp)?;
                OpenOptions::new().read(true).write(true).open(&temp)
            } else {
                OpenOptions::new().write(true).create(true).truncate(true).open(&temp)
            }
        })();
        let file = match file {
            Ok(f) => f,
            Err(e) => {
                let _ = fs::remove_file(&temp);
                return Err(e.into());
            }
        };
        let id = self.id();
        self.writers.lock().unwrap().insert(id.clone(), Writer { target: p, temp, file, pos: 0 });
        Ok(json!({ "id": id }))
    }

    fn with_writer<T>(&self, id: &str, f: impl FnOnce(&mut Writer) -> Result<T, Fail>) -> Result<T, Fail> {
        let mut writers = self.writers.lock().unwrap();
        let w = writers.get_mut(id).ok_or_else(|| Fail::new("InvalidStateError", "That write is closed"))?;
        f(w)
    }

    /// bytes at `at` (None: where it's got to)
    pub fn write_bytes(&self, id: &str, at: Option<u64>, bytes: &[u8]) -> Answer {
        self.with_writer(id, |w| {
            let pos = at.unwrap_or(w.pos);
            w.file.write_all_at(bytes, pos)?;
            w.pos = pos + bytes.len() as u64;
            Ok(json!({}))
        })
    }

    pub fn seek(&self, data: &Value) -> Answer {
        let at = data.get("at").and_then(Value::as_u64).unwrap_or(0);
        self.with_writer(str_of(data, "id"), |w| {
            w.pos = at;
            Ok(json!({}))
        })
    }

    pub fn truncate(&self, data: &Value) -> Answer {
        let size = data.get("size").and_then(Value::as_u64).unwrap_or(0);
        self.with_writer(str_of(data, "id"), |w| {
            w.file.set_len(size)?;
            w.pos = w.pos.min(size);
            Ok(json!({}))
        })
    }

    /// The new bytes go in place of the file's
    pub fn close(&self, data: &Value) -> Answer {
        let w = self
            .writers
            .lock()
            .unwrap()
            .remove(str_of(data, "id"))
            .ok_or_else(|| Fail::new("InvalidStateError", "That write is closed"))?;
        let Writer { target, temp, file, .. } = w;
        drop(file);
        if let Err(e) = fs::rename(&temp, &target) {
            let _ = fs::remove_file(&temp);
            return Err(if e.kind() == io::ErrorKind::NotFound { not_found(&target) } else { e.into() });
        }
        Ok(json!({}))
    }

    pub fn abort(&self, data: &Value) -> Answer {
        if let Some(w) = self.writers.lock().unwrap().remove(str_of(data, "id")) {
            drop(w.file);
            let _ = fs::remove_file(&w.temp);
        }
        Ok(json!({}))
    }

    /// A file's bytes for the page's getFile() (a Range, if asked);
    /// `x-fs-error: NotFoundError` when it isn't there. A file that isn't
    /// there is said in a header, not with a 404, which the web view would
    /// log as an error
    pub fn respond(&self, file: &Path, range: Option<&str>) -> Response {
        let gone = |name: &str| Response {
            status: 200,
            headers: vec![("x-fs-error".into(), name.into()), ("cache-control".into(), "no-store".into())],
            body: Vec::new(),
        };
        let Ok(st) = fs::metadata(file) else { return gone("NotFoundError") };
        if !st.is_file() {
            return gone("TypeMismatchError");
        }
        let size = st.len();
        let mut headers: Vec<(String, String)> = vec![
            ("content-type".into(), "application/octet-stream".into()),
            ("cache-control".into(), "no-store".into()),
            ("accept-ranges".into(), "bytes".into()),
            ("x-mtime".into(), crate::millis(st.modified()).to_string()),
        ];
        if let Some((start, end)) = range.and_then(parse_range) {
            let (start, end) = match (start, end) {
                (Some(s), Some(e)) => (s, e.min(size.saturating_sub(1))),
                (Some(s), None) => (s, size.saturating_sub(1)),
                (None, Some(n)) => (size.saturating_sub(n), size.saturating_sub(1)),
                (None, None) => unreachable!(),
            };
            if size == 0 || start >= size || end < start {
                return Response { status: 416, headers: vec![("content-range".into(), format!("bytes */{size}"))], body: Vec::new() };
            }
            let mut body = vec![0u8; (end - start + 1) as usize];
            let read = File::open(file).and_then(|f| f.read_exact_at(&mut body, start));
            if read.is_err() {
                return gone("NotFoundError");
            }
            headers.push(("content-range".into(), format!("bytes {start}-{end}/{size}")));
            return Response { status: 206, headers, body };
        }
        match fs::read(file) {
            Ok(body) => Response { status: 200, headers, body },
            Err(_) => gone("NotFoundError"),
        }
    }
}

/// "bytes=10-20", "bytes=10-", "bytes=-5" → (start, end) or (None, last n)
fn parse_range(r: &str) -> Option<(Option<u64>, Option<u64>)> {
    let (a, b) = r.strip_prefix("bytes=")?.split_once('-')?;
    let num = |s: &str| -> Option<Option<u64>> {
        if s.is_empty() {
            Some(None)
        } else if s.bytes().all(|c| c.is_ascii_digit()) {
            s.parse().ok().map(Some)
        } else {
            None
        }
    };
    let (a, b) = (num(a)?, num(b)?);
    if a.is_none() && b.is_none() {
        return None;
    }
    Some((a, b))
}

/// A write's bytes: base64 (`b64: true`, as the test's bridge sends them)
/// or an array of numbers
fn bytes_of(data: &Value) -> Result<Vec<u8>, Fail> {
    use base64::Engine;
    match data.get("data") {
        Some(Value::String(s)) if bool_of(data, "b64") => base64::engine::general_purpose::STANDARD
            .decode(s)
            .map_err(|e| Fail::new("TypeError", format!("Bad bytes: {e}"))),
        Some(Value::String(s)) => Ok(s.as_bytes().to_vec()),
        Some(Value::Array(a)) => Ok(a.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect()),
        _ => Ok(Vec::new()),
    }
}
