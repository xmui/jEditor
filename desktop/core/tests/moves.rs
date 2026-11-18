// Moving the projects folder (src/moves.rs), item by item. Across disks
// can't be made in a test here, so the copy-and-check path is reached by
// moving between two folders the test says are on different disks: it's
// the same code a real EXDEV takes after its rename fails.
mod common;
use common::Tmp;
use jeditor_core::moves::{self, Left};
use std::fs;
use std::path::Path;
use std::sync::atomic::AtomicBool;

#[test]
fn whats_refused() {
    let t = Tmp::new("refuse");
    let (a, b) = (t.join("a"), t.join("b"));
    assert_eq!(moves::refuse(&a, &a), Some("It's the same folder"));
    assert_eq!(moves::refuse(&a, &a.join("x")), Some("The new folder is inside the old one"));
    assert_eq!(moves::refuse(&a.join("x"), &a), Some("The old folder is inside the new one"));
    assert_eq!(moves::refuse(&t.join("ab"), &a), None, "a name that starts the same isn't inside");
    assert_eq!(moves::refuse(&a, &b), None);
    for whole in ["/", "/Volumes/CARD", "/media/jo/CARD", "/run/media/jo/CARD"] {
        assert_eq!(moves::refuse(Path::new(whole), &b), Some("jEditor doesn't move everything on a disk or in your home folder"), "{whole}");
    }
    assert_eq!(moves::refuse(Path::new("/Volumes/CARD/Projects"), &b), None);
    if let Some(home) = std::env::var_os("HOME") {
        assert!(moves::refuse(Path::new(&home), &b).is_some());
    }
    assert_eq!(moves::resolve(Path::new("/a/b/../c/./d")), Path::new("/a/c/d"));
}

#[test]
fn size_and_space() {
    let t = Tmp::new("size");
    t.file("P/Smith/a.jpg", &[0; 100]);
    t.file("P/Smith/Day/b.jpg", &[0; 50]);
    t.file("P/loose.jpg", &[0; 7]);
    t.file("P/.DS_Store", &[0; 1000]);
    let s = moves::size(&t.join("P")).unwrap();
    assert_eq!((s.folders, s.files, s.bytes), (1, 3, 157));
    assert_eq!(moves::size(&t.join("gone")).unwrap(), moves::Size::default());
    // A folder not made yet: the disk it would be on
    let sp = moves::space(&t.join("New/Deeper"), Some(&t.join("P")));
    assert!(sp.same_drive && sp.free.unwrap() > 0, "{sp:?}");
    assert_eq!(moves::space(Path::new("/media/jo/CARD/x"), None).drive, if Path::new("/media/jo/CARD").exists() { "CARD" } else { if cfg!(target_os = "macos") { "this Mac" } else { "this computer" } });
}

#[test]
fn same_compares_every_byte() {
    let t = Tmp::new("same");
    let big: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect();
    let a = t.file("a", &big);
    let b = t.file("b", &big);
    assert!(moves::same(&a, &b).unwrap());
    let mut other = big.clone();
    other[2_500_000] ^= 1;
    let c = t.file("c", &other);
    assert!(!moves::same(&a, &c).unwrap());
    let d = t.file("d", &big[..100]);
    assert!(!moves::same(&a, &d).unwrap());
    let (e, f) = (t.file("e", b""), t.file("f", b""));
    assert!(moves::same(&e, &f).unwrap());
}

#[test]
fn on_one_disk_each_item_is_renamed_into_place() {
    let t = Tmp::new("move-same");
    t.file("Old/Smith/a.jpg", b"a");
    t.file("Old/Jones/b.jpg", b"b");
    t.file("Old/loose.jpg", b"c");
    t.file("Old/.DS_Store", b"x");
    t.file("New/Jones/already.jpg", b"there");
    let mut told = Vec::new();
    let r = moves::run(&t.join("Old"), &t.join("New"), |d, n, m| told.push((d, n, m)), &AtomicBool::new(false));
    assert_eq!(r.error, None);
    assert_eq!(r.moved, 2);
    // The name taken there stays where it is, never merged
    assert_eq!(r.left, [Left { name: "Jones".into(), why: "taken" }]);
    assert_eq!(t.names("Old"), [".DS_Store", "Jones"]);
    assert_eq!(t.names("New"), ["Jones", "Smith", "loose.jpg"]);
    assert_eq!(t.names("New/Jones"), ["already.jpg"]);
    // Counted in items: 3 at the top
    assert_eq!(told.first(), Some(&(0, 3, 0)));
    assert_eq!(told.last(), Some(&(3, 3, 2)));
}

#[test]
fn refused_and_missing() {
    let t = Tmp::new("move-refused");
    fs::create_dir(t.join("A")).unwrap();
    let go = AtomicBool::new(false);
    assert_eq!(moves::run(&t.join("A"), &t.join("A/in"), |_, _, _| {}, &go).error.as_deref(), Some("The new folder is inside the old one"));
    assert_eq!(moves::run(&t.join("gone"), &t.join("B"), |_, _, _| {}, &go).error.as_deref(), Some("The folder isn't there any more"));
    let stopped = moves::run(&t.join("A"), &t.join("B"), |_, _, _| {}, &AtomicBool::new(true));
    assert!(stopped.error.is_none());
}

#[test]
fn a_stopped_move_leaves_everything_whole() {
    let t = Tmp::new("move-stop");
    t.file("Old/A/a.jpg", b"a");
    t.file("Old/B/b.jpg", b"b");
    let stop = AtomicBool::new(true);
    let r = moves::run(&t.join("Old"), &t.join("New"), |_, _, _| {}, &stop);
    assert!(r.stopped && r.moved == 0, "{r:?}");
    assert_eq!(t.names("Old"), ["A", "B"]);
    assert!(t.names("New").is_empty());
}

#[cfg(target_os = "linux")]
#[test]
fn across_disks_each_is_copied_checked_then_removed() {
    // /dev/shm is another disk (tmpfs) on most Linux machines; skipped
    // where it's the same as the temp folder's, or not there
    use std::os::unix::fs::MetadataExt;
    let t = Tmp::new("move-across");
    let Ok(shm) = fs::metadata("/dev/shm") else { return };
    if shm.dev() == fs::metadata(t.path()).unwrap().dev() || fs::create_dir_all("/dev/shm/jeditor-core-test").is_err() {
        return;
    }
    let other = Path::new("/dev/shm/jeditor-core-test").join(format!("{}", std::process::id()));
    let _ = fs::remove_dir_all(&other);
    let big: Vec<u8> = (0..2_500_000u32).map(|i| (i % 253) as u8).collect();
    t.file("Old/Smith/a.jpg", &big);
    t.file("Old/Smith/Day/b.jpg", b"bb");
    t.file("Old/loose.jpg", b"c");
    fs::create_dir_all(other.join("Taken")).unwrap();
    t.file("Old/Taken/x.jpg", b"x");
    let when = fs::metadata(t.join("Old/Smith/a.jpg")).unwrap().modified().unwrap();
    let mut told = Vec::new();
    let r = moves::run(&t.join("Old"), &other, |d, n, m| told.push((d, n, m)), &AtomicBool::new(false));
    assert_eq!(r.error, None);
    assert_eq!(r.moved, 2);
    assert_eq!(r.left, [Left { name: "Taken".into(), why: "taken" }]);
    assert_eq!(fs::read(other.join("Smith/a.jpg")).unwrap(), big);
    assert_eq!(fs::read(other.join("Smith/Day/b.jpg")).unwrap(), b"bb");
    assert_eq!(fs::metadata(other.join("Smith/a.jpg")).unwrap().modified().unwrap(), when);
    assert_eq!(t.names("Old"), ["Taken"]);
    // Counted in bytes
    let total = big.len() as u64 + 2 + 1 + 1;
    assert_eq!(told.last(), Some(&(total, total, 2)));
    let _ = fs::remove_dir_all(&other);
}
