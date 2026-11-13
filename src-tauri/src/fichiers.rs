//! Safe file names, task attachments (Donnees/Pieces/<task>/<file>) and free names for PDFs.
//! Same rules as the Electron version (app/main.js and app/pdf.js).

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde_json::{json, Value};

/// Node's `path.extname`: from the last dot, except at the start of the name.
fn extension(nom: &str) -> &str {
    match nom.rfind('.') {
        Some(i) if i > 0 => &nom[i..],
        _ => "",
    }
}

/// Node's `path.basename(nom, ext)`: removes the extension if the name ends with it.
fn sans_extension<'a>(nom: &'a str, ext: &str) -> &'a str {
    if !ext.is_empty() && nom.len() > ext.len() && nom.ends_with(ext) { &nom[..nom.len() - ext.len()] } else { nom }
}

/// Leading dots replaced by a single "_", like `.replace(/^\.+/, '_')`.
fn sans_points_de_tete(s: String) -> String {
    let reste = s.trim_start_matches('.');
    if reste.len() == s.len() { s } else { format!("_{reste}") }
}

/// A path segment (task id): ASCII letters, digits, "_ . -", at most 80 characters.
pub fn nettoyer_segment(s: &str) -> String {
    let s: String = s.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') { c } else { '_' }).collect();
    let s: String = sans_points_de_tete(s).chars().take(80).collect();
    if s.is_empty() { "piece".into() } else { s }
}

/// Names that Windows reserves for devices, with or without an extension.
const RESERVES_WINDOWS: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5",
    "LPT6", "LPT7", "LPT8", "LPT9",
];

/// What Windows additionally refuses: `< > " | ? *`, a dot or space at the end of the name, reserved names (prefixed with "_").
fn pour_windows(nom: String) -> String {
    let nom: String = nom.chars().map(|c| if matches!(c, '<' | '>' | '"' | '|' | '?' | '*') { '_' } else { c }).collect();
    let nom = nom.trim_end_matches(['.', ' ']).to_string();
    let racine = nom.split('.').next().unwrap_or_default().trim_end();
    if RESERVES_WINDOWS.iter().any(|r| r.eq_ignore_ascii_case(racine)) { format!("_{nom}") } else { nom }
}

/// Safe file name: no separator, extension kept, at most 200 bytes (the file system limit is 255).
/// On Windows, also without the characters and names it refuses.
pub fn nettoyer_nom_fichier(s: &str) -> String {
    let s = if s.is_empty() { "file" } else { s };
    let nom: String = s.chars().map(|c| if matches!(c, '/' | '\\' | ':') || (c as u32) < 0x20 { '_' } else { c }).collect();
    let nom = if cfg!(windows) { pour_windows(nom) } else { nom };
    let nom = sans_points_de_tete(nom);
    let ext: String = extension(&nom).chars().take(16).collect();
    let mut base = sans_extension(&nom, &ext).to_string();
    if base.is_empty() {
        base = "file".into();
    }
    while base.len() + ext.len() > 200 && base.chars().count() > 1 {
        base.pop();
    }
    let r = base + &ext;
    if r.is_empty() { "file".into() } else { r }
}

/// A PDF already saved may have been signed or sent: the next one takes the first free name ("Invoice-2026-01 (2).pdf").
pub fn chemin_libre(cible: &Path) -> PathBuf {
    let texte = cible.to_string_lossy();
    let nom = cible.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = extension(&nom);
    let base = &texte[..texte.len() - ext.len()];
    let mut chemin = cible.to_path_buf();
    let mut i = 2;
    while chemin.exists() {
        chemin = PathBuf::from(format!("{base} ({i}){ext}"));
        i += 1;
    }
    chemin
}

/// `path.resolve(racine, relatif)`, refused if it leaves racine.
pub fn chemin_dans(racine: &Path, relatif: &str) -> Option<PathBuf> {
    let mut c = racine.to_path_buf();
    for morceau in Path::new(relatif).components() {
        match morceau {
            Component::Normal(m) => c.push(m),
            Component::ParentDir => {
                c.pop();
            }
            Component::RootDir | Component::Prefix(_) => c = PathBuf::from("/"),
            Component::CurDir => {}
        }
    }
    (c == racine || c.starts_with(racine)).then_some(c)
}

/// Formats the webview can show as a thumbnail.
pub fn est_image(nom: &str) -> bool {
    let e = extension(nom).to_ascii_lowercase();
    matches!(e.as_str(), ".png" | ".jpg" | ".jpeg" | ".gif" | ".webp" | ".bmp" | ".svg" | ".avif")
}

pub fn type_mime(nom: &str) -> &'static str {
    match extension(nom).to_ascii_lowercase().as_str() {
        ".png" => "image/png",
        ".jpg" | ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".svg" => "image/svg+xml",
        ".avif" => "image/avif",
        ".pdf" => "application/pdf",
        ".txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// `decodeURIComponent` of a URL path (%XX as UTF-8 bytes).
pub fn decoder_url(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| (c as char).to_digit(16);
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A free name in the task's folder: "photo.png", then "photo-2.png"...
fn cible_libre(dossier: &Path, nom: &str) -> PathBuf {
    let ext = extension(nom);
    let base = sans_extension(nom, ext);
    let mut cible = dossier.join(nom);
    let mut i = 1;
    while cible.exists() {
        i += 1;
        cible = dossier.join(format!("{base}-{i}{ext}"));
    }
    cible
}

fn piece(segment: &str, cible: &Path, taille: u64) -> Value {
    let nom = cible.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    json!({ "nom": nom, "fichier": format!("{segment}/{nom}"), "taille": taille, "image": est_image(&nom) })
}

fn nom_de(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.display().to_string())
}

/// Copies files (paths) into Pieces/<task>/; returns { ok, pieces, erreurs } like the Electron version.
pub fn copier_pieces(racine: &Path, tache: &str, chemins: &[PathBuf]) -> Value {
    let segment = nettoyer_segment(tache);
    let dossier = racine.join(&segment);
    if let Err(e) = fs::create_dir_all(&dossier) {
        return json!({ "ok": false, "message": e.to_string() });
    }
    let (mut pieces, mut erreurs) = (Vec::new(), Vec::new());
    for src in chemins {
        let r = (|| -> Result<Value, String> {
            let st = fs::metadata(src).map_err(|e| e.to_string())?;
            if !st.is_file() {
                return Err("not a file".into());
            }
            let cible = cible_libre(&dossier, &nettoyer_nom_fichier(&nom_de(src)));
            fs::copy(src, &cible).map_err(|e| e.to_string())?;
            Ok(piece(&segment, &cible, st.len()))
        })();
        match r {
            Ok(p) => pieces.push(p),
            Err(e) => erreurs.push(format!("{}: {e}", nom_de(src))),
        }
    }
    json!({ "ok": true, "pieces": pieces, "erreurs": erreurs })
}

/// A file dropped from the Finder: the webview gives its content, not its path.
pub fn deposer_piece(racine: &Path, tache: &str, nom: &str, octets: &[u8]) -> Value {
    let segment = nettoyer_segment(tache);
    let dossier = racine.join(&segment);
    let r = (|| -> Result<Value, String> {
        fs::create_dir_all(&dossier).map_err(|e| e.to_string())?;
        let cible = cible_libre(&dossier, &nettoyer_nom_fichier(nom));
        fs::write(&cible, octets).map_err(|e| e.to_string())?;
        Ok(piece(&segment, &cible, octets.len() as u64))
    })();
    match r {
        Ok(p) => json!({ "ok": true, "pieces": [p], "erreurs": [] }),
        Err(e) => json!({ "ok": true, "pieces": [], "erreurs": [format!("{nom}: {e}")] }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dossier(nom: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sablier-test-fichiers-{nom}-{}-{}", std::process::id(), crate::donnees::maintenant_ms()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn un_pdf_existant_n_est_jamais_ecrase() {
        let d = dossier("pdf");
        let cible = d.join("Invoice-2031-01.pdf");
        assert_eq!(chemin_libre(&cible), cible);
        fs::write(&cible, "signed").unwrap();
        assert_eq!(chemin_libre(&cible), d.join("Invoice-2031-01 (2).pdf"));
        fs::write(d.join("Invoice-2031-01 (2).pdf"), "copy").unwrap();
        assert_eq!(chemin_libre(&cible), d.join("Invoice-2031-01 (3).pdf"));
        assert_eq!(fs::read_to_string(&cible).unwrap(), "signed");
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn noms_nettoyes_comme_sous_electron() {
        assert_eq!(nettoyer_segment("tache_abc-1.2"), "tache_abc-1.2");
        assert_eq!(nettoyer_segment("../x y/é"), "__x_y__");
        assert_eq!(nettoyer_segment(""), "piece");
        assert_eq!(nettoyer_segment(&"a".repeat(100)).len(), 80);
        assert_eq!(nettoyer_nom_fichier("rapport/final:v2.pdf"), "rapport_final_v2.pdf");
        assert_eq!(nettoyer_nom_fichier("..cache"), "_cache");
        assert_eq!(nettoyer_nom_fichier(""), "file");
        assert_eq!(nettoyer_nom_fichier("2026-10 October"), "2026-10 October");
        let long = nettoyer_nom_fichier(&format!("{}.pdf", "é".repeat(150)));
        assert!(long.len() <= 200 && long.ends_with(".pdf"));
    }

    #[test]
    fn noms_acceptes_par_windows() {
        assert_eq!(pour_windows("a<b>c\"d|e?f*.pdf".into()), "a_b_c_d_e_f_.pdf");
        assert_eq!(pour_windows("rapport. . ".into()), "rapport");
        assert_eq!(pour_windows("CON".into()), "_CON");
        assert_eq!(pour_windows("nul.txt".into()), "_nul.txt");
        assert_eq!(pour_windows("Com9.tar.gz".into()), "_Com9.tar.gz");
        assert_eq!(pour_windows("LPT1 .txt".into()), "_LPT1 .txt");
        assert_eq!(pour_windows("CONSOLE.txt".into()), "CONSOLE.txt");
        assert_eq!(pour_windows("COM10".into()), "COM10");
        assert_eq!(pour_windows("2026-10 October".into()), "2026-10 October");
    }

    #[cfg(windows)]
    #[test]
    fn noms_nettoyes_pour_windows() {
        assert_eq!(nettoyer_nom_fichier("Facture?.pdf"), "Facture_.pdf");
        assert_eq!(nettoyer_nom_fichier("aux.pdf"), "_aux.pdf");
        assert_eq!(nettoyer_nom_fichier("..."), "file");
        assert_eq!(nettoyer_nom_fichier("note ."), "note");
    }

    #[test]
    fn chemin_hors_du_dossier_refuse() {
        let r = Path::new("/donnees/Pieces");
        assert_eq!(chemin_dans(r, "t1/a.png"), Some(PathBuf::from("/donnees/Pieces/t1/a.png")));
        assert_eq!(chemin_dans(r, "../reglages.json"), None);
        assert_eq!(chemin_dans(r, "t1/../../x"), None);
        assert_eq!(chemin_dans(r, "/etc/passwd"), None);
        assert_eq!(chemin_dans(r, ""), Some(r.to_path_buf()));
    }

    #[test]
    fn url_decodee() {
        assert_eq!(decoder_url("/t1/photo%20d%C3%A9but.png"), "/t1/photo début.png");
        assert_eq!(decoder_url("/a%2"), "/a%2");
    }

    #[test]
    fn pieces_copiees_sans_ecraser() {
        let d = dossier("pieces");
        let src = d.join("note.txt");
        fs::write(&src, "attach").unwrap();
        let racine = d.join("Pieces");
        let r1 = copier_pieces(&racine, "tache 1", &[src.clone(), d.join("absent.txt"), d.clone()]);
        assert_eq!(r1["pieces"][0], json!({ "nom": "note.txt", "fichier": "tache_1/note.txt", "taille": 6, "image": false }));
        assert_eq!(r1["erreurs"].as_array().unwrap().len(), 2);
        let r2 = copier_pieces(&racine, "tache 1", &[src]);
        assert_eq!(r2["pieces"][0]["nom"], "note-2.txt");
        let r3 = deposer_piece(&racine, "tache 1", "Image.PNG", &[1, 2, 3]);
        assert_eq!(r3["pieces"][0], json!({ "nom": "Image.PNG", "fichier": "tache_1/Image.PNG", "taille": 3, "image": true }));
        fs::remove_dir_all(d).unwrap();
    }
}
