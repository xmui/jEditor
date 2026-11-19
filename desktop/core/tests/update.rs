// Updates (src/update.rs): which release is newer, which download is this
// app's, and a download checked before it's used
mod common;
use common::Tmp;
use jeditor_core::update::{self, App, Download};
use serde_json::json;
use std::fs;

#[test]
fn tags_in_order() {
    // As mac/main.js has them
    let order = ["v1.18.0", "v1.18.1", "v1.18.1-2", "v1.19.0-beta.1", "v1.19.0-beta.2", "v1.19.0-beta.10", "v1.19.0", "v1.19.1", "v2.0.0-beta.1", "v2.0.0"];
    for w in order.windows(2) {
        assert!(update::is_newer(w[1], w[0]), "{} > {}", w[1], w[0]);
        assert!(!update::is_newer(w[0], w[1]), "{} < {}", w[0], w[1]);
    }
    assert!(!update::is_newer("v1.19.0", "v1.19.0"));
    assert!(!update::is_newer("v1.19.0-1", "v1.19.0"), "-1 is the release itself");
    assert_eq!(update::parse_tag("nonsense"), [0, 0, 0, u64::MAX, 0]);
    assert_eq!(update::parse_tag("jEditor 1.2.3-beta.4"), [1, 2, 3, 4, 0]);
    assert_eq!(update::parse_tag("v1.2.3-beta"), [1, 2, 3, u64::MAX, 1]);
}

#[test]
fn this_builds_version() {
    let js = "const APP_VERSION = '1.52.0';\nconst APP_BUILD = 'v1.52.0-beta.3';\n";
    assert_eq!(update::current_version(js), "1.52.0");
    assert_eq!(update::current_tag(js), "v1.52.0-beta.3");
    assert_eq!(update::current_tag("const APP_VERSION = '1.52.0';"), "v1.52.0");
    assert_eq!(update::current_version("nothing"), "0.0.0");
}

#[test]
fn each_app_knows_its_download() {
    assert!(App::Mac.is_asset("jEditor-1.52.0-mac.dmg"));
    assert!(App::Mac.is_asset("JEDITOR-1.52.0-MAC.DMG"));
    assert!(!App::Mac.is_asset("jEditor-1.52.0-linux.AppImage"));
    assert!(!App::Mac.is_asset("jEditor-mac.dmg"));
    assert!(App::AppImage.is_asset("jEditor-1.52.0-linux.AppImage"));
    assert!(App::Deb.is_asset("jEditor-1.52.0-linux.deb"));
    assert!(!App::Deb.is_asset("jEditor-1.52.0-linux.deb.sig"));
    assert!(App::Pacman.is_asset("jEditor-1.52.0-linux.pacman"));
    assert!(!App::Pacman.is_asset("Setup-jEditor-1.52.0.exe"));
}

fn release(tag: &str, draft: bool, assets: &[&str]) -> serde_json::Value {
    json!({
        "tag_name": tag, "draft": draft, "body": format!("Notes for {tag}"),
        "assets": assets.iter().map(|n| json!({ "name": n, "browser_download_url": format!("https://x/{n}"), "size": 1234, "digest": "sha256:ABCDEF" })).collect::<Vec<_>>()
    })
}

#[test]
fn the_latest_release() {
    let r = release("v1.53.0", false, &["jEditor-1.53.0-mac.dmg", "jEditor-1.53.0-linux.AppImage"]);
    let c = update::check(&r, false, App::Mac, "v1.52.0").unwrap();
    assert!(c.newer);
    assert_eq!((c.version.as_str(), c.notes.as_str(), c.size), ("1.53.0", "Notes for v1.53.0", 1234));
    assert_eq!(c.latest.name, "jEditor-1.53.0-mac.dmg");
    assert_eq!(c.latest.url, "https://x/jEditor-1.53.0-mac.dmg");
    assert_eq!(c.latest.sha256.as_deref(), Some("abcdef"));
    assert!(!update::check(&r, false, App::AppImage, "v1.53.0").unwrap().newer);
    assert_eq!(update::check(&r, false, App::Deb, "v1.52.0").unwrap_err(), "Release v1.53.0 has no Linux app to download");
    assert_eq!(update::check(&json!({}), false, App::Mac, "v1").unwrap_err(), "Release ? has no Mac app to download");
}

#[test]
fn betas_the_newest_with_this_app_in_it() {
    let all = json!([
        release("v1.53.0-beta.3", true, &["jEditor-1.53.0-mac.dmg"]),
        release("v1.53.0-beta.2", false, &["Setup-jEditor.exe"]),
        release("v1.53.0-beta.1", false, &["jEditor-1.53.0-mac.dmg"]),
        release("v1.52.0", false, &["jEditor-1.52.0-mac.dmg", "jEditor-1.52.0-linux.deb"]),
    ]);
    // The draft and the Windows-only beta are passed over
    assert_eq!(update::check(&all, true, App::Mac, "v1.52.0").unwrap().tag, "v1.53.0-beta.1");
    assert_eq!(update::check(&all, true, App::Deb, "v1.52.0").unwrap().tag, "v1.52.0");
    assert_eq!(update::check(&json!([]), true, App::Mac, "v1").unwrap_err(), "No releases yet");
    assert_eq!(update::check(&json!({}), true, App::Mac, "v1").unwrap_err(), "No releases yet");
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn a_download_is_used_only_when_whole() {
    let t = Tmp::new("download");
    let data: Vec<u8> = (0..200_000u32).map(|i| i as u8).collect();
    let file = t.join("jEditor-1.53.0-linux.AppImage");
    let mut d = Download::start(&file).unwrap();
    for c in data.chunks(65536) {
        d.write(c).unwrap();
    }
    assert_eq!(d.received, data.len() as u64);
    assert!(!file.exists(), "not there till it's checked");
    let done = d.finish(Some(&sha256_hex(&data).to_uppercase()), true).unwrap();
    assert_eq!(fs::read(&done).unwrap(), data);
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(fs::metadata(&done).unwrap().permissions().mode() & 0o111, 0o111);
    assert_eq!(t.names(""), ["jEditor-1.53.0-linux.AppImage"]);

    // Damaged: nothing used, nothing left
    let other = t.join("jEditor-1.53.0-mac.dmg");
    let mut d = Download::start(&other).unwrap();
    d.write(b"not what was promised").unwrap();
    assert_eq!(d.finish(Some(&sha256_hex(b"something else")), false).unwrap_err(), "The download was damaged (its checksum doesn't match). Try again.");
    assert_eq!(t.names(""), ["jEditor-1.53.0-linux.AppImage"]);
    // Stopped part way
    let mut d = Download::start(&other).unwrap();
    d.write(b"half").unwrap();
    d.abandon();
    assert_eq!(t.names(""), ["jEditor-1.53.0-linux.AppImage"]);
    // No checksum from GitHub: used as it came
    let mut d = Download::start(&other).unwrap();
    d.write(b"dmg").unwrap();
    assert_eq!(fs::read(d.finish(None, false).unwrap()).unwrap(), b"dmg");
}

#[test]
fn the_mac_app_swapped_in_place() {
    let t = Tmp::new("bundle");
    let bundle = t.join("Applications/jEditor.app");
    t.file("Applications/jEditor.app/Contents/old", b"1");
    assert!(update::can_replace(&bundle));
    assert!(!update::can_replace(std::path::Path::new("/Volumes/jEditor/jEditor.app")));
    assert!(!update::can_replace(std::path::Path::new("/private/var/folders/x/AppTranslocation/y/d/jEditor.app")));
    let staged = update::staged_bundle(&bundle);
    assert_eq!(staged, t.join("Applications/.jEditor-update.app"));
    t.file("Applications/.jEditor-update.app/Contents/new", b"2");
    update::swap_bundle(&staged, &bundle).unwrap();
    assert!(bundle.join("Contents/new").exists() && !bundle.join("Contents/old").exists());
    assert_eq!(t.names("Applications"), ["jEditor.app"]);
    // The staged app gone missing: the old one stays
    assert!(update::swap_bundle(&staged, &bundle).is_err());
    assert!(bundle.join("Contents/new").exists());
}

#[test]
fn packages_installed_with_the_systems_installer() {
    let f = std::path::Path::new("/tmp/u/jEditor-1.53.0-linux.deb");
    assert_eq!(update::install_command(App::Deb, "/usr/bin/pkexec", f, true), ["/usr/bin/pkexec", "/usr/bin/apt-get", "install", "-y", "--allow-downgrades", "/tmp/u/jEditor-1.53.0-linux.deb"]);
    assert_eq!(update::install_command(App::Deb, "/usr/bin/pkexec", f, false), ["/usr/bin/pkexec", "/usr/bin/dpkg", "-i", "/tmp/u/jEditor-1.53.0-linux.deb"]);
    assert_eq!(update::install_command(App::Pacman, "pk", f, true)[1..3], ["/usr/bin/pacman", "-U"]);
}
