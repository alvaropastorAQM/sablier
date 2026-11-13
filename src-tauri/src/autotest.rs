//! Self-test (SABLIER_SMOKE=1, with a disposable SABLIER_DONNEES): the real app in an invisible window.
//! It captures every page into SABLIER_CAPTURES (or /tmp), then, depending on the variables:
//!   SABLIER_SMOKE_DEMO=1       loads the page's demo data set (window.SABLIER_DEMO)
//!   SABLIER_SMOKE_MOIS=YYYY-MM month shown by the statement and the dashboard
//!   SABLIER_SMOKE_SCENARIO=1   plays tests/scenario-smoke.js (timer, tasks, notes, attachments, reminders, templates)
//!   SABLIER_SMOKE_AUDIT=1      plays tests/scenario-audit.js (edge cases)
//!   SABLIER_SMOKE_PDF=1        prints the statement and the latest invoice to PDF
//! Each result goes out on a SABLIER_SMOKE_* line; the app exits with 0 if everything is true, 1 otherwise.

use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::mac::{self, executer};

/// Injected before the page scripts: keeps console errors and uncaught exceptions.
pub const ESPION: &str = r#"(function () {
  window.__erreursAutotest = [];
  var noter = function (m) { window.__erreursAutotest.push(String(m).split('\n')[0]); };
  var erreur = console.error, alerte = console.warn;
  console.error = function () { noter(Array.prototype.join.call(arguments, ' ')); return erreur.apply(console, arguments); };
  console.warn = function () { noter(Array.prototype.join.call(arguments, ' ')); return alerte.apply(console, arguments); };
  window.addEventListener('error', function (e) { noter(e.message); });
  window.addEventListener('unhandledrejection', function (e) { noter('unhandled rejection: ' +(e.reason && e.reason.message || e.reason)); });
})();"#;

const TESTS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../tests");

fn variable(nom: &str) -> String {
    std::env::var(nom).unwrap_or_default()
}

fn pause(ms: u64) {
    thread::sleep(Duration::from_millis(ms));
}

/// All the values of a scenario result are true (an `erreur` key makes it fail).
fn faux(res: &Value) -> Vec<String> {
    match res.as_object() {
        Some(o) => o.iter().filter(|(k, v)| k.as_str() != "pieceFichierChemin" && (k.as_str() == "erreur" || **v == Value::Bool(false))).map(|(k, v)| format!("{k}={v}")).collect(),
        None => vec![format!("unreadable result: {res}")],
    }
}

pub fn lancer(app: AppHandle) {
    thread::spawn(move || {
        let code = match derouler(&app) {
            Ok(echecs) if echecs.is_empty() => {
                println!("SABLIER_SMOKE_OK captures in {}", captures().display());
                0
            }
            Ok(echecs) => {
                println!("SABLIER_SMOKE_ECHEC {}", echecs.join(" ; "));
                1
            }
            Err(e) => {
                println!("SABLIER_SMOKE_ERREUR {e}");
                1
            }
        };
        app.exit(code);
    });
}

fn captures() -> PathBuf {
    let c = variable("SABLIER_CAPTURES");
    if c.is_empty() { std::env::temp_dir() } else { PathBuf::from(c) }
}

/// A capture is for the eye, not for the verdict: with a locked or sleeping screen, WebKit renders none.
fn capturer(w: &WebviewWindow, nom: &str, _echecs: &mut Vec<String>) {
    if let Err(e) = mac::capturer(w, captures().join(format!("sablier-capture-{nom}.png"))) {
        println!("SABLIER_SMOKE_CAPTURE {nom} failed: {e} (screen locked or asleep?)");
    }
}

/// A scenario (async function body that fills `res`), played in the page; returns `res`.
fn scenario(w: &WebviewWindow, fichier: &str, prelude: &str) -> Result<Value, String> {
    let corps = fs::read_to_string(Path::new(TESTS).join(fichier)).map_err(|e| format!("{fichier}: {e}"))?;
    let v = executer(w, &format!("{prelude}\nvar res = {{}};\ntry {{\n{corps}\n}} catch (err) {{ res.erreur = String(err && err.stack || err); }}\nreturn res;"))?;
    // scenario-smoke.js returns JSON.stringify(res) itself.
    Ok(match v {
        Value::String(s) => serde_json::from_str(&s).unwrap_or(Value::String(s)),
        v => v,
    })
}

fn derouler(app: &AppHandle) -> Result<Vec<String>, String> {
    let dossier = captures();
    fs::create_dir_all(&dossier).map_err(|e| e.to_string())?;
    let w = app.get_webview_window("main").ok_or("no window")?;
    let mut echecs = Vec::new();
    let mut pret = false;
    for _ in 0..150 {
        if executer(&w, "return !!window.SABLIER_PRET").is_ok_and(|v| v == Value::Bool(true)) {
            pret = true;
            break;
        }
        pause(200);
    }
    if !pret {
        return Err("the page does not start".into());
    }
    pause(400);
    let etat = executer(
        &w,
        r"return {
          pret: !!window.SABLIER_PRET,
          pont: typeof window.sablier,
          pages: Array.from(document.querySelectorAll('.tab-btn[data-tab]')).map(function (b) { return b.dataset.tab; }),
          axes: (ETAT.reglages.axes || []).length,
          entrees: ETAT.journal.entrees.length,
          taches: ETAT.chantiers.taches.length,
          pagesNotes: ETAT.notes.pages.length,
          echeances: ETAT.echeances.echeances.length,
          tirets: (document.body.innerText.match(/\u2014/g) || []).length,
        };",
    )?;
    println!("SABLIER_SMOKE_ETAT {etat}");
    if etat["pont"] != "object" {
        echecs.push("window.sablier absent".into());
    }
    if variable("SABLIER_SMOKE_DEMO") == "1" {
        executer(&w, "if (typeof window.SABLIER_DEMO === 'function') window.SABLIER_DEMO(); return true")?;
    }
    let mois = variable("SABLIER_SMOKE_MOIS");
    if !mois.is_empty() {
        executer(&w, &format!("RELEVE_MOIS = TABLEAU_PERIODE = {}; return true", json!(mois)))?;
    }
    for page in ["tableau", "releve", "factures", "taches", "notes", "echeances", "reglages", "guide"] {
        executer(&w, &format!("afficherPage('{page}')"))?;
        pause(450);
        capturer(&w, page, &mut echecs);
    }
    executer(&w, "document.querySelector('.tab-btn[data-tab=releve]').click(); var jr = document.querySelector('#releveContenu .rl-jour'); if (jr) jr.click();")?;
    pause(400);
    capturer(&w, "releve-deplie", &mut echecs);
    executer(&w, "afficherPage('reglages'); document.getElementById('reglRappels').scrollIntoView({ block: 'start' });")?;
    pause(400);
    capturer(&w, "reglages-rappels", &mut echecs);
    executer(&w, "afficherPage('notes'); ouvrirPageNotes('page_idees');")?;
    pause(400);
    capturer(&w, "notes-idees", &mut echecs);
    for (nom, ouvrir) in [
        ("modale-saisie", "afficherPage('journal'); ouvrirEditionEntree(null);"),
        ("modale-tache", "afficherPage('taches'); ouvrirEditionTache(ETAT.chantiers.taches[0] && ETAT.chantiers.taches[0].id);"),
        ("rappels", "afficherPage('tableau'); ouvrirRappels();"),
    ] {
        executer(&w, ouvrir)?;
        pause(500);
        capturer(&w, nom, &mut echecs);
        executer(&w, "fermerModale();")?;
    }
    let tirets = executer(
        &w,
        r"var n = 0;
          ['tableau','journal','releve','factures','taches','notes','echeances','reglages','guide'].forEach(function (p) { afficherPage(p); n += (document.getElementById('principal').innerText.match(/\u2014/g) || []).length; });
          return n;",
    )?;
    println!("SABLIER_SMOKE_TIRETS {tirets}");
    if tirets != json!(0) {
        echecs.push(format!("{tirets} em dashes"));
    }

    if variable("SABLIER_SMOKE_SCENARIO") == "1" {
        // A text file and a one-pixel image, to attach to a task.
        let fichier = std::env::temp_dir().join("sablier-piece-test.txt");
        let image = std::env::temp_dir().join("sablier-pixel.png");
        fs::write(&fichier, "test attachment\n").map_err(|e| e.to_string())?;
        fs::write(&image, PIXEL).map_err(|e| e.to_string())?;
        let prelude = format!("var FICHIER_TEST = {}, IMAGE_TEST = {};", json!(fichier), json!(image));
        let res = scenario(&w, "scenario-smoke.js", &prelude)?;
        println!("SABLIER_SMOKE_SCENARIO {res}");
        echecs.extend(faux(&res).into_iter().map(|f| format!("scenario {f}")));
        let existe = res["pieceFichierChemin"].as_str().is_some_and(|c| !c.is_empty() && crate::conf().dossier.join("Pieces").join(c).exists());
        println!("SABLIER_SMOKE_PIECE_FICHIER {existe}");
        if !existe {
            echecs.push("attachment missing from the folder".into());
        }
        // Drop from the Finder: WebKit gives the file content, not its path.
        let depot = executer(
            &w,
            r"var t = ETAT.chantiers.taches[0];
              var avant = t.pieces.length;
              var ok = await ajouterPiecesFichiers(t, [new File(['dropped!'], 'depose.txt', { type: 'text/plain' })]);
              var p = t.pieces[t.pieces.length - 1];
              return ok === true && t.pieces.length === avant + 1 && p.nom === 'depose.txt' && p.taille === 8 ? p.fichier : '';",
        )?;
        let depose = depot.as_str().is_some_and(|c| !c.is_empty() && crate::conf().dossier.join("Pieces").join(c).exists());
        println!("SABLIER_SMOKE_DEPOT {depose}");
        if !depose {
            echecs.push(format!("file drop: {depot}"));
        }
        fermer_modales(&w);
    }

    if variable("SABLIER_SMOKE_AUDIT") == "1" {
        let res = scenario(&w, "scenario-audit.js", "")?;
        println!("SABLIER_SMOKE_AUDIT {res}");
        echecs.extend(faux(&res).into_iter().map(|f| format!("audit {f}")));
        fermer_modales(&w);
    }

    if variable("SABLIER_SMOKE_PDF") == "1" {
        let html_releve = executer(
            &w,
            &format!(
                "var mois = {} || entreesJournal().map(function (e) {{ return moisFacturationDe(e); }}).sort().pop() || moisCourant();
                 var meta = moisMeta(mois);
                 var r = releveDuMois(entreesJournal(), mois, ETAT.reglages, meta.frais);
                 var f = factureDuMois(mois);
                 return htmlReleve(r, {{ travaux: travauxDuMois(mois), numeroFacture: f ? f.numero : null }});",
                json!(mois)
            ),
        )?;
        let html_facture = executer(&w, "var liste = factures(); return liste.length ? htmlFacture(liste[liste.length - 1]) : '';")?;
        for (nom, html) in [("releve", html_releve), ("facture", html_facture)] {
            let Some(html) = html.as_str().filter(|h| !h.is_empty()) else { continue };
            let chemin = dossier.join(format!("sablier-{nom}.pdf"));
            let r = mac::imprimer_pdf(app, html, &chemin);
            println!("SABLIER_SMOKE_PDF {nom} {}", json!({ "ok": r.is_ok(), "chemin": chemin, "message": r.as_ref().err() }));
            if let Err(e) = r {
                echecs.push(format!("PDF {nom}: {e}"));
            }
        }
    }

    let erreurs = executer(&w, "return window.__erreursAutotest || [];")?;
    for e in erreurs.as_array().into_iter().flatten() {
        println!("SABLIER_CONSOLE {}", e.as_str().unwrap_or_default());
        echecs.push(format!("console: {}",e.as_str().unwrap_or_default()));
    }
    Ok(echecs)
}

fn fermer_modales(w: &WebviewWindow) {
    let _ = executer(w, "while (typeof modaleOuverte === 'function' && modaleOuverte()) fermerModale(); afficherPage('tableau'); return true");
}

/// One-pixel PNG (the same as in the Electron version).
const PIXEL: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0xDA, 0x63, 0x64, 0x60,
    0xF8, 0x5F, 0x0F, 0x00, 0x02, 0x87, 0x01, 0x80, 0xEB, 0x47, 0xBA, 0x92, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60,
    0x82,
];
