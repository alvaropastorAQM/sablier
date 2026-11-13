//! Noms de fichiers sûrs, pièces jointes des tâches (Donnees/Pieces/<tâche>/<fichier>) et noms libres pour les PDF.
//! Mêmes règles que la version Electron (app/main.js et app/pdf.js).

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde_json::{json, Value};

/// `path.extname` de Node : depuis le dernier point, sauf en tête du nom.
fn extension(nom: &str) -> &str {
    match nom.rfind('.') {
        Some(i) if i > 0 => &nom[i..],
        _ => "",
    }
}

/// `path.basename(nom, ext)` de Node : retire l'extension si le nom se termine par elle.
fn sans_extension<'a>(nom: &'a str, ext: &str) -> &'a str {
    if !ext.is_empty() && nom.len() > ext.len() && nom.ends_with(ext) { &nom[..nom.len() - ext.len()] } else { nom }
}

/// Points de tête remplacés par un seul « _ », comme `.replace(/^\.+/, '_')`.
fn sans_points_de_tete(s: String) -> String {
    let reste = s.trim_start_matches('.');
    if reste.len() == s.len() { s } else { format!("_{reste}") }
}

/// Un segment de chemin (identifiant de tâche) : lettres ASCII, chiffres, « _ . - », au plus 80 caractères.
pub fn nettoyer_segment(s: &str) -> String {
    let s: String = s.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') { c } else { '_' }).collect();
    let s: String = sans_points_de_tete(s).chars().take(80).collect();
    if s.is_empty() { "piece".into() } else { s }
}

/// Nom de fichier sûr : pas de séparateur, l'extension conservée, au plus 200 octets (limite du système de fichiers à 255).
pub fn nettoyer_nom_fichier(s: &str) -> String {
    let s = if s.is_empty() { "fichier" } else { s };
    let nom: String = s.chars().map(|c| if matches!(c, '/' | '\\' | ':') || (c as u32) < 0x20 { '_' } else { c }).collect();
    let nom = sans_points_de_tete(nom);
    let ext: String = extension(&nom).chars().take(16).collect();
    let mut base = sans_extension(&nom, &ext).to_string();
    if base.is_empty() {
        base = "fichier".into();
    }
    while base.len() + ext.len() > 200 && base.chars().count() > 1 {
        base.pop();
    }
    let r = base + &ext;
    if r.is_empty() { "fichier".into() } else { r }
}

/// Un PDF déjà enregistré peut être signé ou envoyé : le suivant prend le premier nom libre (« Facture-2026-01 (2).pdf »).
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

/// `path.resolve(racine, relatif)`, refusé s'il sort de racine.
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

/// Formats que WebKit sait afficher en vignette.
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

/// `decodeURIComponent` d'un chemin d'URL (%XX en octets UTF-8).
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

/// Un nom libre dans le dossier de la tâche : « photo.png », puis « photo-2.png »…
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

/// Copie des fichiers (chemins) dans Pieces/<tâche>/ ; rend { ok, pieces, erreurs } comme la version Electron.
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
                return Err("pas un fichier".into());
            }
            let cible = cible_libre(&dossier, &nettoyer_nom_fichier(&nom_de(src)));
            fs::copy(src, &cible).map_err(|e| e.to_string())?;
            Ok(piece(&segment, &cible, st.len()))
        })();
        match r {
            Ok(p) => pieces.push(p),
            Err(e) => erreurs.push(format!("{} : {e}", nom_de(src))),
        }
    }
    json!({ "ok": true, "pieces": pieces, "erreurs": erreurs })
}

/// Un fichier déposé depuis le Finder : WebKit en donne le contenu, pas le chemin.
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
        Err(e) => json!({ "ok": true, "pieces": [], "erreurs": [format!("{nom} : {e}")] }),
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
        let cible = d.join("Facture-2031-01.pdf");
        assert_eq!(chemin_libre(&cible), cible);
        fs::write(&cible, "signée").unwrap();
        assert_eq!(chemin_libre(&cible), d.join("Facture-2031-01 (2).pdf"));
        fs::write(d.join("Facture-2031-01 (2).pdf"), "copie").unwrap();
        assert_eq!(chemin_libre(&cible), d.join("Facture-2031-01 (3).pdf"));
        assert_eq!(fs::read_to_string(&cible).unwrap(), "signée");
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
        assert_eq!(nettoyer_nom_fichier(""), "fichier");
        assert_eq!(nettoyer_nom_fichier("2026-10 octobre"), "2026-10 octobre");
        let long = nettoyer_nom_fichier(&format!("{}.pdf", "é".repeat(150)));
        assert!(long.len() <= 200 && long.ends_with(".pdf"));
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
        fs::write(&src, "pièce").unwrap();
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
