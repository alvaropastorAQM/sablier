//! The data as readable files (ported from app/donnees.js of the Electron version, same behavior).
//!
//! Folder: ~/Library/Application Support/Sablier/Donnees/ (on Windows: %APPDATA%\Sablier\Donnees)
//!   reglages.json    rate, identities, areas, social contributions, preferences
//!   journal.json     the time entries
//!   chantiers.json   the tasks (historical name)
//!   notes.json       pages and blocks
//!   factures.json    issued invoices and payments
//!   echeances.json   administrative calendar and reminders
//!   chrono.json      the running timer (survives closing)
//!   Sauvegardes/     one dated copy per day, the latest 30
//!
//! Atomic writes (temporary file forced to disk, then rename), deferred by 300 ms to group bursts;
//! flushed on close. A refused write is retried every 30 seconds.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

pub const FICHIERS: [&str; 7] = ["reglages", "journal", "chantiers", "notes", "factures", "echeances", "chrono"];
const SAUVEGARDES_CONSERVEES: usize = 30;
const DIFFERE: Duration = Duration::from_millis(300);
const RAPPEL_ALERTE: Duration = Duration::from_secs(5 * 60);
/// Created at the first launch: their absence afterwards is never normal.
const ESSENTIELS: [&str; 2] = ["journal", "factures"];

pub struct Illisible {
    pub nom: String,
    pub copie: PathBuf,
}

struct Etat {
    cache: HashMap<String, Value>,
    /// Pending writes and their due time (the timers of the Electron version).
    attente: HashMap<String, Instant>,
    /// Files set aside at the last load.
    illisibles: Vec<Illisible>,
    /// Essential files missing at the last load.
    absents: Vec<String>,
    derniere_alerte: Option<Instant>,
}

pub struct Donnees {
    pub dossier: PathBuf,
    pub retente: Duration,
    etat: Mutex<Etat>,
    /// Called with (name, message) when a write fails, at most once every 5 minutes.
    sur_erreur: Box<dyn Fn(&str, &str) + Send + Sync>,
}

pub fn maintenant_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// JSON indented by two spaces with a final newline, like `JSON.stringify(objet, null, 2) + '\n'`.
pub fn texte_json(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default() + "\n"
}

/// fsync before the rename: a power cut cannot replace the good file with an empty or truncated one.
fn ecrire_atomique(cible: &Path, contenu: &[u8]) -> std::io::Result<()> {
    let tmp = PathBuf::from(format!("{}.tmp", cible.display()));
    let mut f = File::create(&tmp)?;
    f.write_all(contenu)?;
    f.sync_all()?;
    drop(f);
    fs::rename(&tmp, cible)
}

/// The folders in Sauvegardes start with a YYYY-MM-DD date.
fn date_en_tete(nom: &str) -> bool {
    let b = nom.as_bytes();
    b.len() >= 10 && b[..10].iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

impl Donnees {
    pub fn new(dossier: PathBuf, sur_erreur: impl Fn(&str, &str) + Send + Sync + 'static) -> Self {
        let _ = fs::create_dir_all(dossier.join("Sauvegardes"));
        Donnees {
            dossier,
            retente: Duration::from_secs(30),
            etat: Mutex::new(Etat { cache: HashMap::new(), attente: HashMap::new(), illisibles: Vec::new(), absents: Vec::new(), derniere_alerte: None }),
            sur_erreur: Box::new(sur_erreur),
        }
    }

    fn etat(&self) -> MutexGuard<'_, Etat> {
        self.etat.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn chemin(&self, nom: &str) -> PathBuf {
        self.dossier.join(format!("{nom}.json"))
    }

    /// Reads the seven files. Pending writes reach the disk first, otherwise a re-read
    /// (window reload) would return the old content and then write it over the new one.
    pub fn lire_tout(&self) -> Map<String, Value> {
        self.purger();
        let mut e = self.etat();
        let mut out = Map::new();
        e.illisibles.clear();
        for nom in FICHIERS {
            // Write still refused: memory is more recent than the disk.
            if e.attente.contains_key(nom) {
                if let Some(v) = e.cache.get(nom) {
                    out.insert(nom.into(), v.clone());
                }
                continue;
            }
            let lu = fs::read_to_string(self.chemin(nom))
                .map_err(|err| (err.kind(), err.to_string()))
                .and_then(|t| serde_json::from_str::<Value>(&t).map_err(|err| (ErrorKind::InvalidData, err.to_string())));
            match lu {
                Ok(v) => {
                    e.cache.insert(nom.into(), v.clone());
                    out.insert(nom.into(), v);
                }
                Err((ErrorKind::NotFound, _)) => {}
                Err((_, message)) => {
                    // Damaged file: set it aside rather than overwrite it.
                    let copie = PathBuf::from(format!("{}.illisible-{}", self.chemin(nom).display(), maintenant_ms()));
                    let _ = fs::rename(self.chemin(nom), &copie);
                    eprintln!("[donnees] {nom}.json unreadable: {message}");
                    e.illisibles.push(Illisible { nom: nom.into(), copie });
                }
            }
        }
        let absents = if out.is_empty() {
            Vec::new()
        } else {
            ESSENTIELS.iter().filter(|n| !out.contains_key(**n) && !e.illisibles.iter().any(|x| x.nom == **n)).map(|n| n.to_string()).collect()
        };
        e.absents = absents;
        out
    }

    /// Files set aside and essential files missing at the last load.
    pub fn problemes(&self) -> (Vec<(String, PathBuf)>, Vec<String>) {
        let e = self.etat();
        (e.illisibles.iter().map(|x| (x.nom.clone(), x.copie.clone())).collect(), e.absents.clone())
    }

    pub fn ecrire(&self, nom: &str, objet: Value) {
        if !FICHIERS.contains(&nom) || !objet.is_object() {
            return;
        }
        let mut e = self.etat();
        e.cache.insert(nom.into(), objet);
        e.attente.insert(nom.into(), Instant::now() + DIFFERE);
    }

    pub fn ecrire_maintenant(&self, nom: &str) {
        let mut e = self.etat();
        self.ecrire_tenu(&mut e, nom);
    }

    fn ecrire_tenu(&self, e: &mut Etat, nom: &str) {
        e.attente.remove(nom);
        let Some(v) = e.cache.get(nom) else { return };
        let contenu = texte_json(v);
        let cible = self.chemin(nom);
        // Folder gone or moved: recreate it and try once more.
        let essai = ecrire_atomique(&cible, contenu.as_bytes()).or_else(|_| {
            fs::create_dir_all(&self.dossier)?;
            ecrire_atomique(&cible, contenu.as_bytes())
        });
        if let Err(err) = essai {
            eprintln!("[donnees] write {nom}: {err}");
            // The data stays in memory: retry as long as the disk refuses.
            e.attente.insert(nom.into(), Instant::now() + self.retente);
            if e.derniere_alerte.is_none_or(|t| t.elapsed() >= RAPPEL_ALERTE) {
                e.derniere_alerte = Some(Instant::now());
                (self.sur_erreur)(nom, &err.to_string());
            }
        }
    }

    /// Writes what has fallen due; called every 100 ms by the writer thread.
    pub fn ecrire_echues(&self) {
        let mut e = self.etat();
        let maintenant = Instant::now();
        let echues: Vec<String> = e.attente.iter().filter(|(_, t)| **t <= maintenant).map(|(n, _)| n.clone()).collect();
        for nom in echues {
            self.ecrire_tenu(&mut e, &nom);
        }
    }

    pub fn purger(&self) {
        let mut e = self.etat();
        let noms: Vec<String> = e.attente.keys().cloned().collect();
        for nom in noms {
            self.ecrire_tenu(&mut e, &nom);
        }
    }

    /// What is still waiting to be written (after a flush: what the disk refuses).
    pub fn en_attente(&self) -> Vec<String> {
        let mut noms: Vec<String> = self.etat().attente.keys().cloned().collect();
        noms.sort();
        noms
    }

    /// A dated copy of the files, once a day (or forced).
    pub fn sauvegarde_quotidienne(&self, forcer: bool) {
        self.sauvegarde_du_jour(&chrono::Local::now().format("%Y-%m-%d").to_string(), forcer);
    }

    fn sauvegarde_du_jour(&self, jour: &str, forcer: bool) {
        let r = (|| -> std::io::Result<()> {
            let racine = self.dossier.join("Sauvegardes");
            let mut cible = racine.join(jour);
            if cible.exists() {
                if !forcer {
                    return Ok(());
                }
                cible = racine.join(format!("{jour}-{}", maintenant_ms()));
            }
            let presents: Vec<&str> = FICHIERS.iter().copied().filter(|n| self.chemin(n).exists()).collect();
            if presents.is_empty() {
                return Ok(());
            }
            fs::create_dir_all(&cible)?;
            for nom in presents {
                fs::copy(self.chemin(nom), cible.join(format!("{nom}.json")))?;
            }
            let mut anciennes: Vec<String> =
                fs::read_dir(&racine)?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| date_en_tete(n)).collect();
            anciennes.sort();
            while anciennes.len() > SAUVEGARDES_CONSERVEES {
                let vieille = anciennes.remove(0);
                let _ = fs::remove_dir_all(racine.join(vieille));
            }
            Ok(())
        })();
        if let Err(e) = r {
            eprintln!("[donnees] backup: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;

    struct Essai {
        d: Donnees,
        alertes: Arc<Mutex<Vec<String>>>,
    }

    impl Drop for Essai {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.d.dossier);
        }
    }

    fn nouvelles(nom: &str) -> Essai {
        let dossier = std::env::temp_dir().join(format!("sablier-test-donnees-{nom}-{}-{}", std::process::id(), maintenant_ms()));
        let alertes = Arc::new(Mutex::new(Vec::new()));
        let a = alertes.clone();
        let d = Donnees::new(dossier, move |nom, message| a.lock().unwrap().push(format!("{nom}: {message}")));
        Essai { d, alertes }
    }

    fn relire(d: &Donnees, nom: &str) -> Value {
        serde_json::from_str(&fs::read_to_string(d.chemin(nom)).unwrap()).unwrap()
    }

    /// The disk refuses writes until `retablir`: a folder takes the place of each `<name>.json.tmp`, and
    /// `File::create` fails on every system (a read-only folder does not prevent writing on Windows).
    fn temporaires(d: &Donnees) -> impl Iterator<Item = PathBuf> + '_ {
        FICHIERS.iter().map(|nom| PathBuf::from(format!("{}.tmp", d.chemin(nom).display())))
    }
    fn disque_plein(d: &Donnees) {
        temporaires(d).for_each(|t| fs::create_dir(t).unwrap());
    }
    fn retablir(d: &Donnees) {
        temporaires(d).for_each(|t| fs::remove_dir(t).unwrap());
    }

    fn copies(d: &Donnees) -> Vec<String> {
        let mut l: Vec<String> = fs::read_dir(d.dossier.join("Sauvegardes")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        l.sort();
        l
    }

    #[test]
    fn format_identique_a_json_stringify() {
        let v: Value = serde_json::from_str(r#"{"b":1,"a":[1.5,0.1,{"x":"é\"\n\u0001/"}],"c":{},"d":[],"e":null,"f":true,"g":-3,"h":1e-7,"i":85.71428571428571,"j":1234567.125}"#).unwrap();
        // Output of JSON.stringify(v, null, 2) + '\n' under Node.
        let attendu = "{\n  \"b\": 1,\n  \"a\": [\n    1.5,\n    0.1,\n    {\n      \"x\": \"é\\\"\\n\\u0001/\"\n    }\n  ],\n  \"c\": {},\n  \"d\": [],\n  \"e\": null,\n  \"f\": true,\n  \"g\": -3,\n  \"h\": 1e-7,\n  \"i\": 85.71428571428571,\n  \"j\": 1234567.125\n}\n";
        assert_eq!(texte_json(&v), attendu);
    }

    /// Read then rewritten, real files come out byte for byte (key order, numbers, escapes):
    /// SABLIER_VERIF=<copy of the Donnees folder> cargo test -- --ignored
    #[test]
    #[ignore]
    fn aller_retour_octet_pres() {
        let dossier = PathBuf::from(std::env::var("SABLIER_VERIF").expect("SABLIER_VERIF=<folder>"));
        let mut n = 0;
        for nom in FICHIERS {
            let Ok(texte) = fs::read_to_string(dossier.join(format!("{nom}.json"))) else { continue };
            // A file edited outside Sablier may have lost the final newline that Sablier always writes.
            let texte = texte.trim_end().to_string() + "\n";
            let v: Value = serde_json::from_str(&texte).unwrap();
            let refait = texte_json(&v);
            let ecart = texte.lines().zip(refait.lines()).find(|(a, b)| a != b);
            assert!(refait == texte, "{nom}.json does not come out identical: {ecart:?}");
            n += 1;
        }
        assert!(n > 0, "no file read");
    }

    #[test]
    fn ecriture_sans_fichier_temporaire_restant() {
        let t = nouvelles("ordre");
        t.d.ecrire("journal", json!({ "entrees": [1] }));
        t.d.ecrire_maintenant("journal");
        assert_eq!(relire(&t.d, "journal"), json!({ "entrees": [1] }));
        assert!(!PathBuf::from(format!("{}.tmp", t.d.chemin("journal").display())).exists());
        assert!(t.d.en_attente().is_empty());
    }

    #[test]
    fn nom_ou_contenu_invalide_ignore() {
        let t = nouvelles("invalide");
        t.d.ecrire("inconnu", json!({}));
        t.d.ecrire("journal", json!([1, 2]));
        assert!(t.d.en_attente().is_empty());
    }

    #[test]
    fn ecriture_refusee_retentee_avec_le_dernier_contenu() {
        let t = nouvelles("retente");
        t.d.ecrire("factures", json!({ "factures": ["2031-01"] }));
        t.d.ecrire_maintenant("factures");
        disque_plein(&t.d);
        t.d.ecrire("factures", json!({ "factures": ["2031-01", "2031-02"] }));
        t.d.ecrire_maintenant("factures");
        assert_eq!(relire(&t.d, "factures")["factures"], json!(["2031-01"]));
        assert_eq!(t.d.en_attente(), ["factures"], "a retry is scheduled");
        t.d.ecrire_echues();
        assert_eq!(relire(&t.d, "factures")["factures"], json!(["2031-01"]), "not before 30 seconds, and still refused");
        t.d.ecrire("factures", json!({ "factures": ["2031-01", "2031-02", "2031-03"] }));
        retablir(&t.d);
        t.d.purger();
        assert_eq!(relire(&t.d, "factures")["factures"], json!(["2031-01", "2031-02", "2031-03"]));
        assert!(t.d.en_attente().is_empty());
    }

    #[test]
    fn nouvelle_tentative_apres_30_secondes_par_defaut() {
        assert_eq!(nouvelles("delai").d.retente, Duration::from_secs(30));
    }

    #[test]
    fn alerte_espacee_de_5_minutes() {
        let t = nouvelles("alerte");
        disque_plein(&t.d);
        t.d.ecrire("journal", json!({ "a": 1 }));
        t.d.ecrire_maintenant("journal");
        t.d.ecrire("notes", json!({ "a": 1 }));
        t.d.ecrire_maintenant("notes");
        assert_eq!(t.alertes.lock().unwrap().len(), 1);
        assert!(t.alertes.lock().unwrap()[0].starts_with("journal: "));
        {
            let mut e = t.d.etat();
            e.derniere_alerte = Instant::now().checked_sub(RAPPEL_ALERTE);
        }
        t.d.ecrire_maintenant("journal");
        assert_eq!(t.alertes.lock().unwrap().len(), 2);
        retablir(&t.d);
        t.d.purger();
        assert!(t.d.en_attente().is_empty());
    }

    #[test]
    fn relecture_pendant_la_panne_rend_la_memoire() {
        let t = nouvelles("relecture");
        t.d.ecrire("factures", json!({ "factures": ["2031-01"] }));
        t.d.ecrire_maintenant("factures");
        t.d.ecrire("journal", json!({ "entrees": [] }));
        t.d.ecrire_maintenant("journal");
        disque_plein(&t.d);
        t.d.ecrire("factures", json!({ "factures": ["2031-01", "2031-02"] }));
        let relu = t.d.lire_tout();
        assert_eq!(relu["factures"]["factures"], json!(["2031-01", "2031-02"]));
        assert!(t.d.problemes().1.is_empty());
        retablir(&t.d);
        t.d.purger();
        assert_eq!(relire(&t.d, "factures")["factures"], json!(["2031-01", "2031-02"]));
    }

    #[test]
    fn purger_apres_la_panne_ecrit_ce_qui_attendait() {
        let t = nouvelles("purge");
        disque_plein(&t.d);
        t.d.ecrire("chrono", json!({ "enCours": null }));
        t.d.purger();
        assert_eq!(t.d.en_attente(), ["chrono"], "after the flush, only what is refused stays pending");
        retablir(&t.d);
        t.d.purger();
        assert_eq!(relire(&t.d, "chrono"), json!({ "enCours": null }));
        assert!(t.d.en_attente().is_empty());
    }

    #[test]
    fn copie_du_jour_une_par_jour_une_de_plus_si_forcee_30_gardees() {
        let t = nouvelles("copies");
        t.d.sauvegarde_quotidienne(false);
        assert!(copies(&t.d).is_empty(), "nothing to copy while no file exists");
        t.d.ecrire("journal", json!({ "n": 1 }));
        t.d.ecrire_maintenant("journal");
        t.d.sauvegarde_quotidienne(false);
        assert_eq!(copies(&t.d).len(), 1);
        t.d.ecrire("journal", json!({ "n": 2 }));
        t.d.ecrire_maintenant("journal");
        t.d.sauvegarde_quotidienne(false);
        assert_eq!(copies(&t.d).len(), 1, "the hourly call does not redo the day's copy");
        let copie = t.d.dossier.join("Sauvegardes").join(&copies(&t.d)[0]).join("journal.json");
        assert_eq!(serde_json::from_str::<Value>(&fs::read_to_string(copie).unwrap()).unwrap(), json!({ "n": 1 }));
        t.d.sauvegarde_quotidienne(true);
        assert_eq!(copies(&t.d).len(), 2);
        for i in 10..50 {
            fs::create_dir(t.d.dossier.join("Sauvegardes").join(format!("2020-01-{i}"))).unwrap();
        }
        t.d.sauvegarde_quotidienne(true);
        assert_eq!(copies(&t.d).len(), 30);
    }

    #[test]
    fn un_changement_de_jour_declenche_une_nouvelle_copie() {
        let t = nouvelles("jour");
        t.d.ecrire("journal", json!({ "n": 1 }));
        t.d.ecrire_maintenant("journal");
        t.d.sauvegarde_du_jour("2031-03-05", false);
        t.d.sauvegarde_du_jour("2031-03-05", false);
        t.d.sauvegarde_du_jour("2031-03-06", false);
        assert_eq!(copies(&t.d), ["2031-03-05", "2031-03-06"]);
    }

    #[test]
    fn factures_absent_signale_mais_pas_au_premier_lancement() {
        let t = nouvelles("absent");
        t.d.lire_tout();
        assert!(t.d.problemes().1.is_empty(), "first launch: no file, no alert");
        for nom in FICHIERS {
            t.d.ecrire(nom, json!({ "schemaVersion": 1 }));
        }
        t.d.purger();
        t.d.lire_tout();
        assert!(t.d.problemes().1.is_empty());
        fs::remove_file(t.d.chemin("factures")).unwrap();
        t.d.lire_tout();
        assert_eq!(t.d.problemes().1, ["factures"]);
        assert!(t.d.problemes().0.is_empty());
    }

    #[test]
    fn factures_abime_signale_illisible_pas_absent() {
        let t = nouvelles("abime");
        t.d.ecrire("journal", json!({ "n": 1 }));
        t.d.ecrire_maintenant("journal");
        fs::write(t.d.chemin("factures"), "{ damaged").unwrap();
        t.d.lire_tout();
        let (illisibles, absents) = t.d.problemes();
        assert_eq!(illisibles[0].0, "factures");
        assert!(illisibles[0].1.exists(), "the damaged file is kept alongside");
        assert!(absents.is_empty());
    }
}
