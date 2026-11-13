//! Sablier : application macOS (Tauri). Fenêtre, menus, données en fichiers, PDF, pièces jointes des tâches,
//! notifications et pastille du Dock. L'interface (index.html, js/, css/) est celle de la version Electron ;
//! elle parle au fond par window.sablier (js/pont.js), servi avec les données par sablier://localhost/demarrage.js.
//!
//! Variables d'environnement utiles :
//!   SABLIER_DONNEES=<dossier>  emplacement des données (tests) ; préférences dans <dossier>.preferences.json,
//!                              pas d'instance unique : l'auto-test tourne même quand Sablier est ouvert
//!   SABLIER_SMOKE=1            auto-test (autotest.rs) : fenêtre invisible, captures dans SABLIER_CAPTURES (ou /tmp), quitte ;
//!                              refusé sans SABLIER_DONNEES jetable
//!   SABLIER_THEME=light|dark   apparence forcée pendant l'auto-test

mod autotest;
mod donnees;
mod fichiers;
mod mac;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::http::{Request, Response};
use tauri::ipc::InvokeBody;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::window::{Color, Effect, EffectState, EffectsBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, RunEvent, TitleBarStyle, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry};

use donnees::{texte_json, Donnees};
use mac::Choix;

const PONT: &str = include_str!("../../js/pont.js");

pub struct Config {
    pub dossier: PathBuf,
    preferences: PathBuf,
    pub smoke: bool,
    theme: Option<tauri::Theme>,
}

static CONFIG: OnceLock<Config> = OnceLock::new();
static DONNEES: OnceLock<Donnees> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();
/// Les chemins que l'interface peut demander à ouvrir ou révéler : ceux que l'application a elle-même produits (PDF, exports).
static OUVRABLES: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
/// Niveau de zoom de la page, par demi-crans comme Electron (facteur 1,2 par cran).
static ZOOM: Mutex<f64> = Mutex::new(0.0);

pub fn conf() -> &'static Config {
    CONFIG.get().expect("configuration lue au démarrage")
}

pub fn donnees() -> &'static Donnees {
    DONNEES.get().expect("données ouvertes au démarrage")
}

pub fn dans_bundle() -> bool {
    std::env::current_exe().is_ok_and(|e| e.to_string_lossy().contains(".app/Contents/MacOS/"))
}

fn accueil() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
}

fn documents() -> PathBuf {
    accueil().join("Documents")
}

/// `open` du Finder : un fichier, un dossier, une URL, ou `-R` pour le montrer dans le Finder.
fn ouvrir(cible: &Path, reveler: bool) {
    let mut cmd = Command::new("/usr/bin/open");
    if reveler {
        cmd.arg("-R");
    }
    cmd.arg(cible);
    thread::spawn(move || {
        let _ = cmd.status();
    });
}

fn ouvrable(chemin: &Path) {
    OUVRABLES.lock().unwrap_or_else(|e| e.into_inner()).push(chemin.to_path_buf());
}

fn est_ouvrable(chemin: &Path) -> bool {
    OUVRABLES.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|c| c == chemin)
}

fn non_vide(s: Option<String>) -> Option<String> {
    s.filter(|s| !s.is_empty())
}

/* -------------------------------- Préférences (dossier des PDF) -------------------------------- */

fn lire_preferences() -> Value {
    fs::read_to_string(&conf().preferences).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}))
}

fn dossier_pdf() -> PathBuf {
    lire_preferences()["dossierPdf"].as_str().map(PathBuf::from).filter(|d| d.exists()).unwrap_or_else(documents)
}

fn retenir_dossier_pdf(dossier: &Path) {
    let mut p = lire_preferences();
    p["dossierPdf"] = json!(dossier);
    let _ = fs::write(&conf().preferences, texte_json(&p));
}

/* -------------------------------- Fenêtre et menus -------------------------------- */

fn creer_fenetre(app: &AppHandle) {
    let smoke = conf().smoke;
    let url = if smoke { "index.html" } else { "index.html?vibrance=1" };
    let mut b = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
        .title("Sablier")
        .inner_size(1440.0, 940.0)
        .min_inner_size(1024.0, 700.0)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(LogicalPosition::new(18.0, 18.0))
        .visible(!smoke)
        .theme(conf().theme)
        // Le glisser-déposer reste à la page : les fichiers déposés sur une fiche, le texte dans les notes.
        .disable_drag_drop_handler()
        // Un fichier déposé hors d'une zone prévue, ou un lien, ne doit jamais remplacer l'interface par une navigation.
        .on_navigation(|url| url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost"));
    b = if smoke {
        b.background_color(Color(0x0B, 0x0C, 0x0E, 255)).initialization_script(autotest::ESPION)
    } else {
        // Verre du système derrière la barre latérale et autour de la scène.
        b.transparent(true).effects(EffectsBuilder::new().effect(Effect::Sidebar).state(EffectState::FollowsWindowActiveState).build())
    };
    match b.build() {
        Ok(w) if smoke => {
            let w2 = w.clone();
            let _ = w.run_on_main_thread(move || mac::fantome(&w2));
        }
        Ok(_) => {}
        Err(e) => eprintln!("Fenêtre : {e}"),
    }
}

pub fn montrer_fenetre(app: &AppHandle) {
    match app.get_webview_window("main") {
        Some(w) => {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        None => creer_fenetre(app),
    }
}

pub fn commande(app: &AppHandle, nom: &str) {
    let _ = app.emit_to("main", "commande", nom);
}

/// Les écritures différées de la page (notes) partent avant un rechargement ou la fin de l'app.
fn vider_page(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = mac::executer(&w, "window.dispatchEvent(new PageTransitionEvent('pagehide')); return true");
        thread::sleep(Duration::from_millis(200));
    }
}

fn quitter(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        vider_page(&app);
        donnees().purger();
        let refuses = donnees().en_attente();
        if !refuses.is_empty() {
            montrer_fenetre(&app);
            if let Some(w) = app.get_webview_window("main") {
                let liste = refuses.iter().map(|n| format!("{n}.json")).collect::<Vec<_>>().join(", ");
                let detail = format!("{liste} : le disque refuse l'écriture. En quittant maintenant, les dernières modifications seront perdues. Libérez de la place ou exportez une sauvegarde, puis réessayez.");
                if mac::alerte(&w, "Des données ne sont pas enregistrées", &detail, &["Rester dans Sablier", "Quitter quand même"], 0) != Some(1) {
                    return;
                }
            }
        }
        app.exit(0);
    });
}

fn zoomer(app: &AppHandle, id: &str) {
    let mut niveau = ZOOM.lock().unwrap_or_else(|e| e.into_inner());
    *niveau = match id {
        "zoom-plus" => (*niveau + 0.5).min(4.5),
        "zoom-moins" => (*niveau - 0.5).max(-4.0),
        _ => 0.0,
    };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_zoom(1.2f64.powf(*niveau));
    }
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, texte: &str, raccourci: Option<&str>| MenuItem::with_id(app, id, texte, true, raccourci);
    let a_propos = AboutMetadata { name: Some("Sablier".into()), version: Some(app.package_info().version.to_string()), ..Default::default() };
    let sablier = Submenu::with_items(app, "Sablier", true, &[
        &PredefinedMenuItem::about(app, Some("À propos de Sablier"), Some(a_propos))?,
        &PredefinedMenuItem::separator(app)?,
        &item("page:reglages", "Réglages…", Some("CmdOrCtrl+,"))?,
        &item("dossier", "Ouvrir le dossier de données", None)?,
        &item("exporter", "Exporter une sauvegarde…", None)?,
        &item("importer", "Importer une sauvegarde…", None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::hide(app, Some("Masquer Sablier"))?,
        &PredefinedMenuItem::hide_others(app, Some("Masquer les autres"))?,
        &PredefinedMenuItem::show_all(app, Some("Tout afficher"))?,
        &PredefinedMenuItem::separator(app)?,
        &item("quitter", "Quitter Sablier", Some("CmdOrCtrl+Q"))?,
    ])?;
    let fichier = Submenu::with_items(app, "Fichier", true, &[
        &item("nouvelle-saisie", "Nouvelle ligne de journal", Some("CmdOrCtrl+N"))?,
        &item("chrono", "Démarrer ou arrêter le chrono", Some("CmdOrCtrl+Shift+T"))?,
        &item("pause-chrono", "Mettre en pause ou reprendre le chrono", Some("CmdOrCtrl+Alt+T"))?,
        &PredefinedMenuItem::separator(app)?,
        &item("nouvelle-tache", "Nouvelle tâche", Some("CmdOrCtrl+Shift+N"))?,
        &item("nouvelle-page", "Nouvelle page de notes", Some("CmdOrCtrl+Shift+P"))?,
        &item("rappels", "Rappels…", Some("CmdOrCtrl+Shift+R"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::close_window(app, Some("Fermer"))?,
    ])?;
    let edition = Submenu::with_items(app, "Édition", true, &[
        // L'éditeur de notes tient son propre historique : la page décide.
        &item("annuler", "Annuler", Some("CmdOrCtrl+Z"))?,
        &item("retablir", "Rétablir", Some("CmdOrCtrl+Shift+Z"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::cut(app, Some("Couper"))?,
        &PredefinedMenuItem::copy(app, Some("Copier"))?,
        &PredefinedMenuItem::paste(app, Some("Coller"))?,
        &PredefinedMenuItem::select_all(app, Some("Tout sélectionner"))?,
    ])?;
    let pages = [
        ("Tableau de bord", "tableau"), ("Journal et relevé", "releve"), ("Factures et recettes", "factures"), ("Tâches", "taches"),
        ("Notes", "notes"), ("Échéances", "echeances"), ("Réglages", "reglages"), ("Mode d'emploi", "guide"),
    ];
    let affichage = Submenu::with_items(app, "Affichage", true, &[])?;
    for (i, (texte, page)) in pages.iter().enumerate() {
        affichage.append(&item(&format!("page:{page}"), texte, Some(&format!("CmdOrCtrl+{}", i + 1)))?)?;
    }
    affichage.append_items(&[
        &PredefinedMenuItem::separator(app)?,
        &item("recharger", "Recharger", Some("CmdOrCtrl+R"))?,
        &item("zoom-reel", "Taille réelle", Some("CmdOrCtrl+0"))?,
        &item("zoom-plus", "Agrandir", Some("CmdOrCtrl+="))?,
        &item("zoom-moins", "Réduire", Some("CmdOrCtrl+-"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::fullscreen(app, Some("Plein écran"))?,
        &item("devtools", "Outils de développement", Some("CmdOrCtrl+Alt+I"))?,
    ])?;
    let fenetre = Submenu::with_items(app, "Fenêtre", true, &[
        &PredefinedMenuItem::minimize(app, Some("Réduire"))?,
        &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::bring_all_to_front(app, Some("Tout ramener au premier plan"))?,
    ])?;
    let _ = fenetre.set_as_windows_menu_for_nsapp();
    Menu::with_items(app, &[&sablier, &fichier, &edition, &affichage, &fenetre])
}

fn sur_menu(app: &AppHandle, id: &str) {
    match id {
        "dossier" => ouvrir(&conf().dossier, false),
        "quitter" => quitter(app),
        "recharger" => {
            let app = app.clone();
            thread::spawn(move || {
                vider_page(&app);
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.eval("location.reload()");
                }
            });
        }
        "zoom-reel" | "zoom-plus" | "zoom-moins" => zoomer(app, id),
        "devtools" => {
            if let Some(w) = app.get_webview_window("main") {
                if w.is_devtools_open() { w.close_devtools() } else { w.open_devtools() }
            }
        }
        "annuler" | "retablir" => commande(app, id),
        autre => {
            montrer_fenetre(app);
            commande(app, autre);
        }
    }
}

/* -------------------------------- Protocoles : démarrage de la page, pièces jointes -------------------------------- */

fn reponse(statut: u16, type_contenu: &str, corps: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder().status(statut).header("Content-Type", type_contenu).header("Cache-Control", "no-store").body(corps).expect("réponse")
}

fn signaler_problemes(app: &AppHandle, illisibles: Vec<(String, PathBuf)>, absents: Vec<String>) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(800));
        let Some(w) = app.get_webview_window("main") else { return };
        let liste = illisibles
            .iter()
            .map(|(nom, copie)| format!("{nom}.json (conservé sous {})", copie.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()))
            .chain(absents.iter().map(|nom| format!("{nom}.json (absent)")))
            .collect::<Vec<_>>()
            .join("\n");
        let detail = format!("{liste}\n\nUn fichier abîmé est mis de côté et l'application repart avec des valeurs de départ pour cette partie : sans factures.json, la numérotation repartirait à 01. Une copie datée de chaque jour se trouve dans le sous-dossier Sauvegardes : vous pouvez y reprendre la dernière version saine.");
        if mac::alerte(&w, "Un fichier de données manque ou n'a pas pu être lu", &detail, &["Ouvrir le dossier de données", "Continuer"], 1) == Some(0) {
            ouvrir(&conf().dossier, false);
        }
    });
}

/// Chargé par index.html avant les scripts de la page : les données (relues à chaque chargement) puis window.sablier.
fn demarrage(app: &AppHandle, requete: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if requete.uri().path() != "/demarrage.js" {
        return reponse(404, "text/plain", Vec::new());
    }
    let lu = donnees().lire_tout();
    let (illisibles, absents) = donnees().problemes();
    if (!illisibles.is_empty() || !absents.is_empty()) && !conf().smoke {
        signaler_problemes(app, illisibles, absents);
    }
    let d = json!({ "version": app.package_info().version.to_string(), "smoke": conf().smoke, "dossier": conf().dossier, "donnees": lu });
    reponse(200, "text/javascript; charset=utf-8", format!("window.__SABLIER_DEMARRAGE = {d};\n{PONT}").into_bytes())
}

fn dossier_pieces() -> PathBuf {
    conf().dossier.join("Pieces")
}

/// sablier-piece://pieces/<tâche>/<fichier> : les images jointes, limitées au dossier Pieces des données.
fn servir_piece(requete: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let relatif = fichiers::decoder_url(requete.uri().path());
    let racine = dossier_pieces();
    match fichiers::chemin_dans(&racine, relatif.trim_start_matches('/')) {
        Some(c) if c != racine && c.is_file() => match fs::read(&c) {
            Ok(octets) => reponse(200, fichiers::type_mime(&c.to_string_lossy()), octets),
            Err(_) => reponse(404, "text/plain", Vec::new()),
        },
        _ => reponse(404, "text/plain", Vec::new()),
    }
}

/* -------------------------------- Commandes (window.sablier) -------------------------------- */

#[tauri::command]
fn donnees_ecrire(nom: String, objet: Value) {
    donnees().ecrire(&nom, objet);
}

#[tauri::command]
fn donnees_ouvrir_dossier() {
    ouvrir(&conf().dossier, false);
}

#[tauri::command]
fn donnees_sauvegarder() -> Value {
    donnees().purger();
    donnees().sauvegarde_quotidienne(true);
    json!({ "ok": true })
}

#[tauri::command]
async fn donnees_exporter(window: WebviewWindow, paquet: Value, nom_fichier: Option<String>) -> Value {
    let defaut = documents().join(non_vide(nom_fichier).unwrap_or_else(|| "Sablier-sauvegarde.json".into()));
    let Some(chemin) = mac::enregistrer_sous(&window, "Exporter une sauvegarde", &defaut, &["json"]) else {
        return json!({ "ok": false, "annule": true });
    };
    match fs::write(&chemin, texte_json(&paquet)) {
        Ok(()) => {
            ouvrable(&chemin);
            json!({ "ok": true, "chemin": chemin })
        }
        Err(e) => json!({ "ok": false, "message": e.to_string() }),
    }
}

#[tauri::command]
async fn donnees_importer(window: WebviewWindow) -> Value {
    let choix = Choix { fichiers: true, dossiers: false, plusieurs: false };
    let Some(chemin) = mac::ouvrir_panneau(&window, "Importer une sauvegarde", None, choix, &["json"]).into_iter().next() else {
        return json!({ "ok": false, "annule": true });
    };
    match fs::read_to_string(&chemin).map_err(|e| e.to_string()).and_then(|t| serde_json::from_str::<Value>(&t).map_err(|e| e.to_string())) {
        Ok(paquet) => json!({ "ok": true, "paquet": paquet }),
        Err(message) => json!({ "ok": false, "message": message }),
    }
}

fn resultat_pdf(r: Result<(), String>, chemin: &Path) -> Value {
    match r {
        Ok(()) => {
            ouvrable(chemin);
            json!({ "ok": true, "chemin": chemin })
        }
        Err(message) => json!({ "ok": false, "message": message }),
    }
}

#[tauri::command]
async fn pdf_generer(window: WebviewWindow, html: String, nom_fichier: Option<String>) -> Value {
    let defaut = fichiers::chemin_libre(&dossier_pdf().join(non_vide(nom_fichier).unwrap_or_else(|| "document.pdf".into())));
    let Some(chemin) = mac::enregistrer_sous(&window, "Enregistrer le PDF", &defaut, &["pdf"]) else {
        return json!({ "ok": false, "annule": true });
    };
    let r = mac::imprimer_pdf(window.app_handle(), &html, &chemin);
    if r.is_ok() {
        if let Some(d) = chemin.parent() {
            retenir_dossier_pdf(d);
        }
    }
    resultat_pdf(r, &chemin)
}

/// Facture et relevé rangés d'office dans le dossier des factures (Réglages), sous-dossier du mois :
/// le premier qui commence par « AAAA-MM », sinon créé.
#[tauri::command]
async fn pdf_classer(
    window: WebviewWindow,
    html: String,
    base: Option<String>,
    mois: Option<String>,
    nom_dossier: Option<String>,
    nom_fichier: Option<String>,
) -> Value {
    let base = PathBuf::from(base.unwrap_or_default());
    let mois = mois.unwrap_or_default();
    let mois_valide = mois.len() == 7 && mois.bytes().enumerate().all(|(i, c)| if i == 4 { c == b'-' } else { c.is_ascii_digit() });
    if !base.is_absolute() || !base.exists() || !mois_valide {
        return json!({ "ok": false, "message": "dossier des factures introuvable, à choisir dans les Réglages" });
    }
    let r = (|| -> Result<PathBuf, String> {
        let mut existants: Vec<String> = fs::read_dir(&base)
            .map_err(|e| e.to_string())?
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(&mois))
            .collect();
        existants.sort();
        let sous = existants.into_iter().next().unwrap_or_else(|| fichiers::nettoyer_nom_fichier(&non_vide(nom_dossier).unwrap_or_else(|| mois.clone())));
        let dossier = base.join(sous);
        fs::create_dir_all(&dossier).map_err(|e| e.to_string())?;
        Ok(fichiers::chemin_libre(&dossier.join(fichiers::nettoyer_nom_fichier(&nom_fichier.unwrap_or_default()))))
    })();
    match r {
        Ok(chemin) => resultat_pdf(mac::imprimer_pdf(window.app_handle(), &html, &chemin), &chemin),
        Err(message) => json!({ "ok": false, "message": message }),
    }
}

#[tauri::command]
async fn dossier_choisir(window: WebviewWindow, depart: Option<String>) -> Option<PathBuf> {
    let depart = depart.map(PathBuf::from).filter(|d| d.exists()).unwrap_or_else(documents);
    let choix = Choix { fichiers: false, dossiers: true, plusieurs: false };
    mac::ouvrir_panneau(&window, "Dossier des factures", Some(&depart), choix, &[]).into_iter().next()
}

#[tauri::command]
fn fichier_ouvrir(chemin: String) {
    if est_ouvrable(Path::new(&chemin)) {
        ouvrir(Path::new(&chemin), false);
    }
}

#[tauri::command]
fn fichier_reveler(chemin: String) {
    if est_ouvrable(Path::new(&chemin)) {
        ouvrir(Path::new(&chemin), true);
    }
}

#[tauri::command]
fn fichier_ouvrir_url(url: String) {
    let u = url.to_ascii_lowercase();
    if u.starts_with("http://") || u.starts_with("https://") {
        ouvrir(Path::new(&url), false);
    }
}

#[tauri::command]
async fn fichier_exporter_texte(window: WebviewWindow, nom_fichier: Option<String>, contenu: String) -> Value {
    let defaut = documents().join(non_vide(nom_fichier).unwrap_or_else(|| "export.txt".into()));
    let Some(chemin) = mac::enregistrer_sous(&window, "Enregistrer", &defaut, &[]) else {
        return json!({ "ok": false, "annule": true });
    };
    match fs::write(&chemin, contenu) {
        Ok(()) => {
            ouvrable(&chemin);
            json!({ "ok": true, "chemin": chemin })
        }
        Err(e) => json!({ "ok": false, "message": e.to_string() }),
    }
}

/// Pièces jointes : des chemins (auto-test), sinon un sélecteur de fichiers.
#[tauri::command]
async fn pieces_ajouter(window: WebviewWindow, tache_id: String, chemins: Option<Vec<String>>) -> Value {
    let mut liste: Vec<PathBuf> = chemins.unwrap_or_default().into_iter().filter(|c| !c.is_empty()).map(PathBuf::from).collect();
    if liste.is_empty() {
        let choix = Choix { fichiers: true, dossiers: false, plusieurs: true };
        liste = mac::ouvrir_panneau(&window, "Joindre des fichiers à la tâche", None, choix, &[]);
        if liste.is_empty() {
            return json!({ "ok": false, "annule": true });
        }
    }
    fichiers::copier_pieces(&dossier_pieces(), &tache_id, &liste)
}

/// Un fichier déposé depuis le Finder : son contenu en corps brut, la tâche et le nom en en-têtes (encodés pour l'URL).
#[tauri::command]
fn pieces_deposer(requete: tauri::ipc::Request<'_>) -> Value {
    let entete = |n: &str| requete.headers().get(n).and_then(|v| v.to_str().ok()).map(fichiers::decoder_url).unwrap_or_default();
    let (tache, nom) = (entete("x-tache"), entete("x-nom"));
    match requete.body() {
        InvokeBody::Raw(octets) if !tache.is_empty() => fichiers::deposer_piece(&dossier_pieces(), &tache, &nom, octets),
        _ => json!({ "ok": false, "message": "fichier déposé illisible" }),
    }
}

fn piece_existante(relatif: &str) -> Option<PathBuf> {
    let racine = dossier_pieces();
    fichiers::chemin_dans(&racine, relatif).filter(|c| c != &racine && c.exists())
}

#[tauri::command]
fn pieces_ouvrir(relatif: String) {
    if let Some(c) = piece_existante(&relatif) {
        ouvrir(&c, false);
    }
}

#[tauri::command]
fn pieces_reveler(relatif: String) {
    if let Some(c) = piece_existante(&relatif) {
        ouvrir(&c, true);
    }
}

#[tauri::command]
fn pieces_supprimer(relatif: String) -> Value {
    match piece_existante(&relatif) {
        Some(c) => match mac::corbeille(&c) {
            Ok(()) => json!({ "ok": true }),
            Err(message) => json!({ "ok": false, "message": message }),
        },
        None => json!({ "ok": false }),
    }
}

#[tauri::command]
fn rappels_notifier(o: Value) -> bool {
    if conf().smoke {
        return false;
    }
    mac::notifier(o["titre"].as_str().filter(|s| !s.is_empty()).unwrap_or("Sablier"), o["corps"].as_str().unwrap_or(""))
}

#[tauri::command]
fn rappels_badge(app: AppHandle, n: Value) {
    mac::pastille(&app, n.as_f64().filter(|n| *n > 0.0).map_or(0, |n| n as u64));
}

/* -------------------------------- Démarrage -------------------------------- */

fn demarrer(app: &AppHandle) {
    let _ = APP.set(app.clone());
    donnees().sauvegarde_quotidienne(false);
    // Les écritures différées partent à leur échéance ; l'app reste ouverte des semaines,
    // la copie du jour ne dépend donc pas d'un lancement (vérifiée chaque heure).
    thread::spawn(|| {
        for n in 1u64.. {
            thread::sleep(Duration::from_millis(100));
            donnees().ecrire_echues();
            if n % 36_000 == 0 {
                donnees().purger();
                donnees().sauvegarde_quotidienne(false);
            }
        }
    });
    if !conf().smoke {
        mac::preparer_notifications(app);
    }
    creer_fenetre(app);
    if conf().smoke {
        autotest::lancer(app.clone());
    }
}

fn main() {
    let test = std::env::var_os("SABLIER_DONNEES").map(|d| std::path::absolute(PathBuf::from(&d)).unwrap_or_else(|_| PathBuf::from(d)));
    let smoke = std::env::var("SABLIER_SMOKE").is_ok_and(|v| v == "1");
    let racine = accueil().join("Library/Application Support/Sablier");
    // L'auto-test écrit des données d'essai : jamais dans les vraies.
    if smoke && test.as_ref().is_none_or(|d| d == &racine.join("Donnees")) {
        eprintln!("Auto-test refusé : SABLIER_SMOKE exige SABLIER_DONNEES=<dossier jetable>.");
        std::process::exit(1);
    }
    let theme = match std::env::var("SABLIER_THEME").as_deref() {
        Ok("dark") if smoke => Some(tauri::Theme::Dark),
        Ok("light") if smoke => Some(tauri::Theme::Light),
        _ => None,
    };
    let (dossier, preferences) = match &test {
        Some(d) => (d.clone(), PathBuf::from(format!("{}.preferences.json", d.display()))),
        None => (racine.join("Donnees"), racine.join("preferences.json")),
    };
    let _ = CONFIG.set(Config { dossier: dossier.clone(), preferences, smoke, theme });
    let _ = DONNEES.set(Donnees::new(dossier, |nom, message| {
        if let Some(app) = APP.get() {
            commande(app, &format!("erreur-ecriture:{nom} : {message}"));
        }
    }));

    let mut constructeur = tauri::Builder::default();
    if test.is_none() {
        constructeur = constructeur.plugin(tauri_plugin_single_instance::init(|app, _, _| montrer_fenetre(app)));
    }
    let app = constructeur
        .invoke_handler(tauri::generate_handler![
            donnees_ecrire,
            donnees_ouvrir_dossier,
            donnees_sauvegarder,
            donnees_exporter,
            donnees_importer,
            pdf_generer,
            pdf_classer,
            dossier_choisir,
            fichier_ouvrir,
            fichier_reveler,
            fichier_ouvrir_url,
            fichier_exporter_texte,
            pieces_ajouter,
            pieces_deposer,
            pieces_ouvrir,
            pieces_reveler,
            pieces_supprimer,
            rappels_notifier,
            rappels_badge,
        ])
        .register_uri_scheme_protocol("sablier", |ctx, requete| demarrage(ctx.app_handle(), requete))
        .register_uri_scheme_protocol("sablier-piece", |_, requete| servir_piece(requete))
        .menu(menu)
        .on_menu_event(|app, e| sur_menu(app, e.id().as_ref()))
        .on_window_event(|w, e| {
            // Fermer la fenêtre la cache : la page et ses écritures en cours restent, le Dock la ramène.
            if let (WindowEvent::CloseRequested { api, .. }, "main") = (e, w.label()) {
                if !conf().smoke {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .setup(|app| {
            demarrer(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("construction de l'app");

    app.run(|app, evenement| match evenement {
        RunEvent::Reopen { .. } if !conf().smoke => montrer_fenetre(app),
        RunEvent::ExitRequested { code: None, api, .. } if !conf().smoke => api.prevent_exit(),
        // Les écritures en attente passent sur le disque avant la fin, quelle que soit la façon de quitter.
        RunEvent::Exit => donnees().purger(),
        _ => {}
    });
}
