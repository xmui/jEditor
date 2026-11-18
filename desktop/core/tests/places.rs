// The sidebar's places (src/places.rs): drives, folders, projects, counts,
// names, renames, ejecting (the tests' drives) and folder copies
mod common;
use common::Tmp;
use jeditor_core::places::{self, Places, LIMIT};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

#[test]
fn photos_by_their_names() {
    for p in ["a.jpg", "B.JPEG", "scan.tif", "x.heic", "raw.CR3", "r.dng", "f.raf"] {
        assert!(places::is_photo(p), "{p}");
    }
    for p in ["notes.txt", ".hidden.jpg", "jpg", ".jpg", "a.jpg.xmp", "movie.mov"] {
        assert!(!places::is_photo(p), "{p}");
    }
}

#[test]
fn the_tests_drives_are_listed_and_ejected() {
    let t = Tmp::new("drives");
    fs::create_dir_all(t.join("CARD/DCIM")).unwrap();
    fs::create_dir_all(t.join("Backup")).unwrap();
    fs::create_dir_all(t.join(".hidden")).unwrap();
    t.file("not-a-drive.txt", b"x");
    let p = Places::new(Some(t.0.clone()), true, "someone");
    assert!(!p.linux, "the tests' drives are listed the Mac's way, on any system");
    let d = p.drives();
    let got: Vec<(String, &str)> = d.iter().map(|d| (d.name.clone(), d.kind)).collect();
    assert_eq!(got, [("Backup".to_string(), "usb"), ("CARD".to_string(), "usb")]);
    assert!(d[0].total > 0 && d[0].free > 0);
    assert_eq!(d[1].path, t.join("CARD"));
    assert_eq!(p.drive_dirs(), [t.0.clone()]);
    // Ejected: only hidden, what's on it untouched
    assert_eq!(p.eject(&t.join("CARD")), None);
    assert!(t.join(".ejected-CARD/DCIM").is_dir());
    assert_eq!(p.drives().len(), 1);
    assert_eq!(p.eject(&t.join("Backup/inside")).as_deref(), Some("Only drives can be ejected"));
}

#[test]
fn linux_lists_its_own_disk_first() {
    let p = Places::new(None, true, "nobody-here");
    assert!(p.linux);
    let d = p.drives();
    assert_eq!((d[0].name.as_str(), d[0].kind, d[0].path.as_path()), ("Computer", "disk", Path::new("/")));
    assert_eq!(p.eject(Path::new("/")).as_deref(), Some("Only drives can be ejected"));
    assert_eq!(p.drive_dirs(), [PathBuf::from("/media/nobody-here"), PathBuf::from("/run/media/nobody-here"), PathBuf::from("/media")]);
}

#[test]
fn mounts_are_read_as_each_system_writes_them() {
    let linux = places::parse_proc_mounts(
        "/dev/sda1 / ext4 rw 0 0\n/dev/sdb1 /media/jo/MY\\040CARD vfat rw 0 0\n//nas/photos /media/jo/nas cifs rw 0 0\nbad\n",
    );
    let card = &linux[Path::new("/media/jo/MY CARD")];
    assert_eq!((card.fs_type.as_str(), card.dev.as_str()), ("vfat", "/dev/sdb1"));
    assert_eq!(linux[Path::new("/media/jo/nas")].fs_type, "cifs");
    let mac = places::parse_mac_mount(
        "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)\n/dev/disk4s1 on /Volumes/EOS (DIGITAL) (msdos, local, nodev, nosuid, noowners)\n//jo@nas/Photos on /Volumes/Photos (smbfs, nodev, nosuid, mounted by jo)\n",
    );
    assert_eq!(mac[Path::new("/")].fs_type, "apfs");
    assert_eq!(mac[Path::new("/Volumes/EOS (DIGITAL)")].fs_type, "msdos");
    assert_eq!(mac[Path::new("/Volumes/Photos")].fs_type, "smbfs");
}

#[test]
fn a_folders_folders_and_photos() {
    let t = Tmp::new("list");
    for f in ["Ceremony", "Reception", ".jeditor", "$RECYCLE.BIN", "Old.lrlibrary"] {
        fs::create_dir_all(t.join(f)).unwrap();
    }
    for f in ["a.jpg", "b.CR3", "notes.txt", ".c.jpg"] {
        t.file(f, b"x");
    }
    let p = Places::new(Some(t.0.clone()), false, "x");
    let l = p.list_dir(t.path(), None, false).unwrap();
    let names: Vec<&str> = l.folders.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, ["Ceremony", "Reception"]);
    assert_eq!((l.photos, l.more), (2, false));
    assert_eq!(l.parent.as_deref(), t.path().parent());
    assert_eq!(l.name, t.path().file_name().unwrap().to_string_lossy());
    // Libraries as folders, when Settings says so
    assert_eq!(p.list_dir(t.path(), None, true).unwrap().folders.len(), 3);
    assert_eq!(p.list_dir(&t.join("gone"), None, false).unwrap_err(), "That folder isn't there any more");
    // The top of a disk is named for it
    let root = p.list_dir(Path::new("/"), Some("EOS"), false).unwrap();
    assert_eq!((root.name.as_str(), root.parent), ("EOS", None));
}

#[test]
fn counts_stop_at_the_limit_and_are_kept_a_while() {
    let t = Tmp::new("count");
    for i in 0..5 {
        t.file(&format!("Day 1/p{i}.jpg"), b"x");
    }
    t.file("Day 2/Deeper/q.nef", b"x");
    t.file(".jeditor/thumb.jpg", b"x");
    t.file("Lib.photoslibrary/inside.jpg", b"x");
    let p = Places::new(Some(t.0.clone()), false, "x");
    assert_eq!(p.count(t.path(), false), Some(6));
    assert_eq!(p.count(t.path(), true), Some(7));
    assert_eq!(p.count(&t.join("gone"), false), None);
    // Kept while the folder is unchanged (a photo deep inside doesn't change it)
    t.file("Day 2/r.jpg", b"x");
    assert_eq!(p.count(t.path(), false), Some(6));
    // Counting stops at the limit
    let big = Tmp::new("count-big");
    for i in 0..LIMIT + 5 {
        big.file(&format!("p{i}.jpg"), b"");
    }
    assert_eq!(p.count(big.path(), false), Some(LIMIT));
    let l = p.list_dir(big.path(), None, false).unwrap();
    assert_eq!((l.photos, l.more), (LIMIT, true));
}

#[test]
fn projects_newest_first() {
    let t = Tmp::new("projects");
    for (name, secs) in [("Old", 1_000_000_000u64), ("New", 1_700_000_000), ("Mid", 1_500_000_000)] {
        fs::create_dir(t.join(name)).unwrap();
        let when = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs);
        fs::File::open(t.join(name)).unwrap().set_modified(when).unwrap();
    }
    fs::create_dir(t.join(".jeditor-trash")).unwrap();
    t.file("loose.jpg", b"x");
    let names: Vec<String> = places::list_projects(t.path()).unwrap().into_iter().map(|p| p.name).collect();
    assert_eq!(names, ["New", "Mid", "Old"]);
    assert_eq!(places::list_projects(&t.join("gone")).unwrap_err(), "The projects folder isn't there");
}

#[test]
fn new_folders_and_renames() {
    let t = Tmp::new("names");
    assert_eq!(places::name_problem(""), Some("A folder needs a name"));
    assert_eq!(places::name_problem("a/b"), Some("A folder's name can't have / or : in it"));
    assert_eq!(places::name_problem("a:b"), Some("A folder's name can't have / or : in it"));
    assert_eq!(places::name_problem(".x"), Some("A name starting with a dot would hide the folder"));
    assert_eq!(places::name_problem(&"é".repeat(121)), Some("That name is too long"));
    assert_eq!(places::name_problem(&"é".repeat(120)), None);
    let made = places::make_folder(t.path(), "  Smith Wedding ").unwrap();
    assert_eq!(made, t.join("Smith Wedding"));
    assert_eq!(places::make_folder(t.path(), "Smith Wedding").unwrap_err(), "There's already a Smith Wedding there");
    assert_eq!(places::make_folder(&t.join("gone"), "X").unwrap_err(), "The projects folder isn't there");
    fs::create_dir(t.join("Jones")).unwrap();
    assert_eq!(places::rename_folder(&made, "Jones").unwrap_err(), "There's already a Jones there");
    // A change of case only, through another name (the Mac's disk ignores case)
    let to = places::rename_folder(&t.join("Smith Wedding/"), "smith wedding").unwrap();
    assert_eq!(to, t.join("smith wedding"));
    assert_eq!(t.names(""), ["Jones", "smith wedding"]);
    assert_eq!(places::rename_folder(&to, "smith wedding").unwrap(), to);
    assert_eq!(places::rename_folder(&t.join("gone"), "X").unwrap_err(), "That folder isn't there");
}

#[test]
fn a_folder_is_copied_whole_or_not_at_all() {
    let t = Tmp::new("copy");
    t.file("Smith/a.jpg", &[1u8; 3000]);
    t.file("Smith/Ceremony/b.jpg", b"bb");
    t.file("Smith/.jeditor/edits.json", b"{}");
    fs::create_dir(t.join("USB")).unwrap();
    fs::create_dir(t.join("USB/Smith")).unwrap();
    let stop = AtomicBool::new(false);
    let mut told = Vec::new();
    let to = places::copy_folder(&t.join("Smith"), &t.join("USB"), |d, n| told.push((d, n)), &stop).unwrap();
    // A free name beside one already there; jEditor's own folder left out
    assert_eq!(to, t.join("USB/Smith (2)"));
    assert_eq!(fs::read(to.join("Ceremony/b.jpg")).unwrap(), b"bb");
    assert_eq!(fs::read(to.join("a.jpg")).unwrap().len(), 3000);
    assert!(!to.join(".jeditor").exists());
    assert_eq!(told.first(), Some(&(0, 3002)));
    assert_eq!(told.last(), Some(&(3002, 3002)));
    // Its dates kept
    let (a, b) = (fs::metadata(t.join("Smith/a.jpg")).unwrap(), fs::metadata(to.join("a.jpg")).unwrap());
    assert_eq!(a.modified().unwrap(), b.modified().unwrap());
    // Stopped: nothing half copied is left
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    assert_eq!(places::copy_folder(&t.join("Smith"), &t.join("USB"), |_, _| {}, &stop).unwrap_err(), "Stopped");
    assert_eq!(t.names("USB"), ["Smith", "Smith (2)"]);
    // Not into itself
    let go = AtomicBool::new(false);
    assert_eq!(places::copy_folder(&t.join("Smith"), &t.join("Smith/Ceremony"), |_, _| {}, &go).unwrap_err(), "A folder can't be copied into itself");
    assert_eq!(places::copy_folder(&t.join("gone"), &t.join("USB"), |_, _| {}, &go).unwrap_err(), "The folder isn't there any more");
}

#[test]
fn the_usual_folders() {
    let t = Tmp::new("home");
    fs::create_dir(t.join("Desktop")).unwrap();
    fs::create_dir(t.join("Bilder")).unwrap();
    fs::create_dir_all(t.join(".config")).unwrap();
    t.file(".config/user-dirs.dirs", b"# comment\nXDG_PICTURES_DIR=\"$HOME/Bilder\"\nXDG_DOWNLOAD_DIR=\"$HOME/Nope\"\n");
    let got: Vec<(String, PathBuf)> = places::home(t.path()).into_iter().map(|f| (f.name, f.path)).collect();
    assert_eq!(got, [("Desktop".to_string(), t.join("Desktop")), ("Pictures".to_string(), t.join("Bilder"))]);
}
