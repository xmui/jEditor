// A folder of the test's own, removed when it's done
#![allow(dead_code)]
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

pub struct Tmp(pub PathBuf);

impl Tmp {
    pub fn new(name: &str) -> Tmp {
        static N: AtomicU32 = AtomicU32::new(0);
        let p = std::env::temp_dir().join(format!("jeditor-core-{name}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        Tmp(std::fs::canonicalize(p).unwrap())
    }
    pub fn path(&self) -> &Path {
        &self.0
    }
    pub fn join(&self, p: &str) -> PathBuf {
        self.0.join(p)
    }
    pub fn s(&self) -> String {
        self.0.to_string_lossy().into_owned()
    }
    /// A file with these bytes, its folders made
    pub fn file(&self, p: &str, bytes: &[u8]) -> PathBuf {
        let f = self.0.join(p);
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(&f, bytes).unwrap();
        f
    }
    /// The names in a folder, sorted
    pub fn names(&self, p: &str) -> Vec<String> {
        let mut n: Vec<String> = std::fs::read_dir(self.0.join(p)).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        n.sort();
        n
    }
}

impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
