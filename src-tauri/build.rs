//! Recopie la page et ce qu'elle charge (index.html, js/, css/) dans dist/, le frontendDist de tauri.conf.json,
//! puis laisse tauri-build faire le reste. Un fichier identique n'est pas réécrit : dist/ ne change que si la source change.

use std::fs;
use std::path::Path;

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
    } else if fs::read(de).ok() != fs::read(vers).ok() {
        fs::copy(de, vers).expect("copie vers dist/");
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
