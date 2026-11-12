// Times the engine's thumbnails on a folder of JPEGs, against a full
// decode (what the page's createImageBitmap does before it shrinks):
//
//   cargo run --release --bin engine-bench -- <folder> [width] [threads]
//
// Prints ms per photo on one thread, and the whole folder on `threads`
// (default: every core), for docs/plans/fast-engine.md's before-and-after.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use jeditor_engine::thumb;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = args.get(1).expect("usage: engine-bench <folder> [width] [threads]");
    let width: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(320);
    let threads: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or_else(|| std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4));
    let mut files: Vec<_> = std::fs::read_dir(dir).expect("folder").filter_map(|e| e.ok()).map(|e| e.path())
        .filter(|p| p.extension().map(|x| { let x = x.to_string_lossy().to_lowercase(); x == "jpg" || x == "jpeg" }).unwrap_or(false))
        .collect();
    files.sort();
    if files.is_empty() { eprintln!("no JPEGs in {dir}"); std::process::exit(1); }
    let first = std::fs::read(&files[0]).unwrap();
    let full = thumb::decode_full(&first).unwrap();
    println!("{} JPEGs in {dir}, the first {} × {}, {:.1} MB; {width} px wide; {threads} threads", files.len(), full.w, full.h, first.len() as f64 / 1e6);

    // One thread, a few photos: a full decode against the engine's way
    let n = files.len().min(12);
    let photos: Vec<Vec<u8>> = files[..n].iter().map(|p| std::fs::read(p).unwrap()).collect();
    let t = Instant::now();
    for b in &photos { let d = thumb::decode_full(b).unwrap(); std::hint::black_box(d.px.len()); }
    let full_ms = t.elapsed().as_secs_f64() * 1000.0 / n as f64;
    let t = Instant::now();
    for b in &photos { std::hint::black_box(thumb::jpeg_thumbnail(b, width, 80.0).unwrap().len()); }
    let eng_ms = t.elapsed().as_secs_f64() * 1000.0 / n as f64;
    println!("  one thread: full decode only {full_ms:.1} ms/photo; engine thumbnail (read in memory) {eng_ms:.1} ms/photo");

    // The whole folder from disk, on every thread
    let next = AtomicUsize::new(0);
    let t = Instant::now();
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(p) = files.get(i) else { break };
                let b = std::fs::read(p).unwrap();
                std::hint::black_box(thumb::jpeg_thumbnail(&b, width, 80.0).map(|v| v.len()).unwrap_or(0));
            });
        }
    });
    let all = t.elapsed().as_secs_f64() * 1000.0;
    println!("  whole folder, from disk: {:.0} ms ({:.1} ms/photo)", all, all / files.len() as f64);
}
