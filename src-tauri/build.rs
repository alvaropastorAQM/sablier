//! Copies the page and what it loads (index.html, js/, css/) into dist/, the frontendDist of tauri.conf.json,
//! then lets tauri-build do the rest. An identical file is not rewritten: dist/ changes only if the source changes.
//! On Windows, WebView2 does not know the sablier: and sablier-piece: schemes: Tauri serves them as
//! http://<scheme>.localhost, and dist/'s index.html (address of demarrage.js, CSP) is rewritten accordingly.

use std::fs;
use std::path::Path;

/// The index.html replacements for Windows; each must find its text, otherwise the page would not start.
const POUR_WINDOWS: [(&str, &str); 3] = [
    ("\"sablier://localhost/demarrage.js\"", "\"http://sablier.localhost/demarrage.js\""),
    ("script-src 'self' sablier:;", "script-src 'self' http://sablier.localhost;"),
    ("img-src 'self' data: sablier-piece:;", "img-src 'self' data: http://sablier-piece.localhost;"),
];

fn adapter(de: &Path, octets: Vec<u8>) -> Vec<u8> {
    if de.file_name().is_none_or(|n| n != "index.html") || std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return octets;
    }
    let mut page = String::from_utf8(octets).expect("index.html in UTF-8");
    for (avant, apres) in POUR_WINDOWS {
        assert!(page.contains(avant), "index.html: {avant} not found");
        page = page.replace(avant, apres);
    }
    page.into_bytes()
}

fn copier(de: &Path, vers: &Path) {
    if de.is_dir() {
        fs::create_dir_all(vers).expect("creating dist/");
        let noms: Vec<_> = fs::read_dir(de).expect("reading the source").map(|e| e.expect("entry").file_name()).collect();
        // A file removed from the source also disappears from dist/.
        for e in fs::read_dir(vers).expect("reading dist/").flatten() {
            if !noms.contains(&e.file_name()) {
                let p = e.path();
                let _ = if p.is_dir() { fs::remove_dir_all(&p) } else { fs::remove_file(&p) };
            }
        }
        for nom in noms {
            copier(&de.join(&nom), &vers.join(&nom));
        }
    } else {
        let contenu = adapter(de, fs::read(de).expect("reading the source"));
        if fs::read(vers).ok().as_ref() != Some(&contenu) {
            fs::write(vers, contenu).expect("copying to dist/");
        }
    }
}

fn main() {
    let racine = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    fs::create_dir_all(racine.join("dist")).expect("creating dist/");
    for nom in ["index.html", "js", "css"] {
        copier(&racine.join(nom), &racine.join("dist").join(nom));
        println!("cargo:rerun-if-changed=../{nom}");
    }
    tauri_build::build()
}
