//! Recopie la page et ce qu'elle charge (index.html, js/, css/) dans dist/, le frontendDist de tauri.conf.json,
//! puis laisse tauri-build faire le reste. Un fichier identique n'est pas réécrit : dist/ ne change que si la source change.
//! Sous Windows, WebView2 ne connaît pas les schémas sablier: et sablier-piece: : Tauri les sert en
//! http://<schéma>.localhost, et l'index.html de dist/ (adresse de demarrage.js, CSP) est réécrit en conséquence.

use std::fs;
use std::path::Path;

/// Les remplacements de index.html pour Windows ; chacun doit trouver son texte, sinon la page ne démarrerait pas.
const POUR_WINDOWS: [(&str, &str); 3] = [
    ("\"sablier://localhost/demarrage.js\"", "\"http://sablier.localhost/demarrage.js\""),
    ("script-src 'self' sablier:;", "script-src 'self' http://sablier.localhost;"),
    ("img-src 'self' data: sablier-piece:;", "img-src 'self' data: http://sablier-piece.localhost;"),
];

fn adapter(de: &Path, octets: Vec<u8>) -> Vec<u8> {
    if de.file_name().is_none_or(|n| n != "index.html") || std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return octets;
    }
    let mut page = String::from_utf8(octets).expect("index.html en UTF-8");
    for (avant, apres) in POUR_WINDOWS {
        assert!(page.contains(avant), "index.html : {avant} introuvable");
        page = page.replace(avant, apres);
    }
    page.into_bytes()
}

fn copier(de: &Path, vers: &Path) {
    if de.is_dir() {
        fs::create_dir_all(vers).expect("création de dist/");
        let noms: Vec<_> = fs::read_dir(de).expect("lecture de la source").map(|e| e.expect("entrée").file_name()).collect();
        // Un fichier retiré de la source disparaît aussi de dist/.
        for e in fs::read_dir(vers).expect("lecture de dist/").flatten() {
            if !noms.contains(&e.file_name()) {
                let p = e.path();
                let _ = if p.is_dir() { fs::remove_dir_all(&p) } else { fs::remove_file(&p) };
            }
        }
        for nom in noms {
            copier(&de.join(&nom), &vers.join(&nom));
        }
    } else {
        let contenu = adapter(de, fs::read(de).expect("lecture de la source"));
        if fs::read(vers).ok().as_ref() != Some(&contenu) {
            fs::write(vers, contenu).expect("copie vers dist/");
        }
    }
}

fn main() {
    let racine = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    fs::create_dir_all(racine.join("dist")).expect("création de dist/");
    for nom in ["index.html", "js", "css"] {
        copier(&racine.join(nom), &racine.join("dist").join(nom));
        println!("cargo:rerun-if-changed=../{nom}");
    }
    tauri_build::build()
}
