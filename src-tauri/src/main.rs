//! Sablier: a Tauri application for macOS and Windows. Window, menus, data in files, PDF, task attachments,
//! notifications and the Dock badge. The interface (index.html, js/, css/) is the one from the Electron version;
//! it talks to the backend through window.sablier (js/pont.js), served with the data by sablier://localhost/demarrage.js.
//!
//! Useful environment variables:
//!   SABLIER_DONNEES=<folder>   data location (tests); preferences in <folder>.preferences.json,
//!                              no single instance: the self-test runs even while Sablier is open
//!   SABLIER_SMOKE=1            self-test (autotest.rs): invisible window, screenshots in SABLIER_CAPTURES (or /tmp), then quits;
//!                              refused without a disposable SABLIER_DONNEES
//!   SABLIER_THEME=light|dark   appearance forced during the self-test
//!
//! On Windows, mac.rs is replaced by windows.rs (same functions); data in %APPDATA%\Sablier\Donnees.

// Windows build: no console behind the window.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod autotest;
mod donnees;
mod fichiers;
#[cfg_attr(target_os = "macos", path = "mac.rs")]
#[cfg_attr(windows, path = "windows.rs")]
mod mac;

use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::http::{Request, Response};
use tauri::ipc::InvokeBody;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::window::Color;
#[cfg(target_os = "macos")]
use tauri::window::{Effect, EffectState, EffectsBuilder};
#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, TitleBarStyle};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry};

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
/// The paths the interface may ask to open or reveal: only those the application produced itself (PDFs, exports).
static OUVRABLES: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
/// Page zoom level, in half steps like Electron (factor 1.2 per step).
static ZOOM: Mutex<f64> = Mutex::new(0.0);

pub fn conf() -> &'static Config {
    CONFIG.get().expect("configuration read at startup")
}

pub fn donnees() -> &'static Donnees {
    DONNEES.get().expect("data opened at startup")
}

#[cfg(target_os = "macos")]
pub fn dans_bundle() -> bool {
    std::env::current_exe().is_ok_and(|e| e.to_string_lossy().contains(".app/Contents/MacOS/"))
}

#[cfg(target_os = "macos")]
fn accueil() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
}

/// Sablier's folder: Donnees/ and preferences.json.
#[cfg(target_os = "macos")]
fn racine_app() -> PathBuf {
    accueil().join("Library/Application Support/Sablier")
}

#[cfg(windows)]
fn racine_app() -> PathBuf {
    PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default()).join("Sablier")
}

#[cfg(target_os = "macos")]
fn documents() -> PathBuf {
    accueil().join("Documents")
}

#[cfg(windows)]
fn documents() -> PathBuf {
    APP.get().and_then(|a| a.path().document_dir().ok()).unwrap_or_default()
}

/// Finder's `open`: a file, a folder, a URL, or `-R` to show it in the Finder.
#[cfg(target_os = "macos")]
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

/// File Explorer: a file, a folder, a URL (browser), or the file shown in its folder.
#[cfg(windows)]
fn ouvrir(cible: &Path, reveler: bool) {
    let cible = cible.to_path_buf();
    thread::spawn(move || {
        let texte = cible.to_string_lossy();
        let url = texte.to_ascii_lowercase().starts_with("http://") || texte.to_ascii_lowercase().starts_with("https://");
        let r = if reveler {
            tauri_plugin_opener::reveal_item_in_dir(&cible)
        } else if url {
            tauri_plugin_opener::open_url(&*texte, None::<&str>)
        } else {
            tauri_plugin_opener::open_path(&cible, None::<&str>)
        };
        if let Err(e) = r {
            eprintln!("Open {texte}: {e}");
        }
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

/* -------------------------------- Preferences (PDF folder) -------------------------------- */

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

/* -------------------------------- Window and menus -------------------------------- */

fn creer_fenetre(app: &AppHandle) {
    let smoke = conf().smoke;
    // On Windows, a normal title bar and an opaque window: the page keeps its background.
    let url = if smoke || cfg!(windows) { "index.html" } else { "index.html?vibrance=1" };
    let b = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
        .title("Sablier")
        .inner_size(1440.0, 940.0)
        .min_inner_size(1024.0, 700.0);
    #[cfg(target_os = "macos")]
    let b = b.title_bar_style(TitleBarStyle::Overlay).hidden_title(true).traffic_light_position(LogicalPosition::new(18.0, 18.0));
    let mut b = b
        .visible(!smoke)
        .theme(conf().theme)
        // Drag and drop stays with the page: files dropped on a card, text in the notes.
        .disable_drag_drop_handler()
        // A file dropped outside an intended zone, or a link, must never replace the interface with a navigation.
        .on_navigation(|url| url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost"));
    if smoke {
        b = b.background_color(Color(0x0B, 0x0C, 0x0E, 255)).initialization_script(autotest::ESPION);
    } else {
        // System glass behind the sidebar and around the stage.
        #[cfg(target_os = "macos")]
        {
            b = b.transparent(true).effects(EffectsBuilder::new().effect(Effect::Sidebar).state(EffectState::FollowsWindowActiveState).build());
        }
    }
    match b.build() {
        Ok(w) if smoke => {
            let w2 = w.clone();
            let _ = w.run_on_main_thread(move || mac::fantome(&w2));
        }
        Ok(_) => {}
        Err(e) => eprintln!("Window: {e}"),
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

/// The page's deferred writes (notes) are sent before a reload or the end of the app.
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
                let detail = format!("{liste}: the disk refuses the write. If you quit now, the latest changes will be lost. Free up some space or export a backup, then try again.");
                if mac::alerte(&w, "Some data is not saved", &detail, &["Stay in Sablier", "Quit anyway"], 0) != Some(1) {
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
    let fichier = Submenu::with_items(app, "File", true, &[
        &item("nouvelle-saisie", "New log entry", Some("CmdOrCtrl+N"))?,
        &item("chrono", "Start or stop the timer", Some("CmdOrCtrl+Shift+T"))?,
        &item("pause-chrono", "Pause or resume the timer", Some("CmdOrCtrl+Alt+T"))?,
        &PredefinedMenuItem::separator(app)?,
        &item("nouvelle-tache", "New task", Some("CmdOrCtrl+Shift+N"))?,
        &item("nouvelle-page", "New notes page", Some("CmdOrCtrl+Shift+P"))?,
        &item("rappels", "Reminders…", Some("CmdOrCtrl+Shift+R"))?,
        &PredefinedMenuItem::separator(app)?,
    ])?;
    let edition = Submenu::with_items(app, "Edit", true, &[
        // The notes editor keeps its own history: the page decides.
        &item("annuler", "Undo", Some("CmdOrCtrl+Z"))?,
        &item("retablir", "Redo", Some("CmdOrCtrl+Shift+Z"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::cut(app, Some("Cut"))?,
        &PredefinedMenuItem::copy(app, Some("Copy"))?,
        &PredefinedMenuItem::paste(app, Some("Paste"))?,
        &PredefinedMenuItem::select_all(app, Some("Select all"))?,
    ])?;
    let pages = [
        ("Dashboard", "tableau"), ("Log and statement", "releve"), ("Invoices and income", "factures"), ("Tasks", "taches"),
        ("Notes", "notes"), ("Deadlines", "echeances"), ("Settings", "reglages"), ("User guide", "guide"),
    ];
    let affichage = Submenu::with_items(app, "View", true, &[])?;
    for (i, (texte, page)) in pages.iter().enumerate() {
        // On Windows the user guide lives in the Help menu (F1); Ctrl+8 still opens it from the page.
        if cfg!(windows) && *page == "guide" {
            continue;
        }
        affichage.append(&item(&format!("page:{page}"), texte, Some(&format!("CmdOrCtrl+{}", i + 1)))?)?;
    }
    affichage.append_items(&[
        &PredefinedMenuItem::separator(app)?,
        &item("recharger", "Reload", Some("CmdOrCtrl+R"))?,
        &item("zoom-reel", "Actual size", Some("CmdOrCtrl+0"))?,
        &item("zoom-plus", "Zoom in", Some("CmdOrCtrl+="))?,
        &item("zoom-moins", "Zoom out", Some("CmdOrCtrl+-"))?,
        &PredefinedMenuItem::separator(app)?,
    ])?;

    // macOS: application menu, Close in File, full screen, Window menu.
    #[cfg(target_os = "macos")]
    {
        let sablier = Submenu::with_items(app, "Sablier", true, &[
            &PredefinedMenuItem::about(app, Some("About Sablier"), Some(a_propos))?,
            &PredefinedMenuItem::separator(app)?,
            &item("page:reglages", "Settings…", Some("CmdOrCtrl+,"))?,
            &item("dossier", "Open the data folder", None)?,
            &item("exporter", "Export a backup…", None)?,
            &item("importer", "Import a backup…", None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Hide Sablier"))?,
            &PredefinedMenuItem::hide_others(app, Some("Hide others"))?,
            &PredefinedMenuItem::show_all(app, Some("Show all"))?,
            &PredefinedMenuItem::separator(app)?,
            &item("quitter", "Quit Sablier", Some("CmdOrCtrl+Q"))?,
        ])?;
        fichier.append(&PredefinedMenuItem::close_window(app, Some("Close"))?)?;
        affichage.append_items(&[&PredefinedMenuItem::fullscreen(app, Some("Full screen"))?, &item("devtools", "Developer tools", Some("CmdOrCtrl+Alt+I"))?])?;
        let fenetre = Submenu::with_items(app, "Window", true, &[
            &PredefinedMenuItem::minimize(app, Some("Minimize"))?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::bring_all_to_front(app, Some("Bring all to front"))?,
        ])?;
        let _ = fenetre.set_as_windows_menu_for_nsapp();
        Menu::with_items(app, &[&sablier, &fichier, &edition, &affichage, &fenetre])
    }
    // Windows: the usual File, Edit, View, Help; settings and data in File, the window buttons do the rest.
    #[cfg(windows)]
    {
        fichier.append_items(&[
            &item("page:reglages", "Settings…", Some("CmdOrCtrl+,"))?,
            &item("dossier", "Open the data folder", None)?,
            &item("exporter", "Export a backup…", None)?,
            &item("importer", "Import a backup…", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item("quitter", "Exit", Some("CmdOrCtrl+Q"))?,
        ])?;
        affichage.append(&item("devtools", "Developer tools", Some("CmdOrCtrl+Alt+I"))?)?;
        let aide = Submenu::with_items(app, "Help", true, &[
            &item("page:guide", "User guide", Some("F1"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::about(app, Some("About Sablier"), Some(a_propos))?,
        ])?;
        Menu::with_items(app, &[&fichier, &edition, &affichage, &aide])
    }
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

/* -------------------------------- Protocols: page startup, attachments -------------------------------- */

fn reponse(statut: u16, type_contenu: &str, corps: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder().status(statut).header("Content-Type", type_contenu).header("Cache-Control", "no-store").body(corps).expect("response")
}

fn signaler_problemes(app: &AppHandle, illisibles: Vec<(String, PathBuf)>, absents: Vec<String>) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(800));
        let Some(w) = app.get_webview_window("main") else { return };
        let liste = illisibles
            .iter()
            .map(|(nom, copie)| format!("{nom}.json (kept as {})",copie.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()))
            .chain(absents.iter().map(|nom| format!("{nom}.json (missing)")))
            .collect::<Vec<_>>()
            .join("\n");
        let detail = format!("{liste}\n\nA damaged file is set aside and the application starts with default values for that part: without factures.json, numbering would restart at 01. A dated copy of each day is in the Sauvegardes subfolder: you can recover the latest healthy version from there.");
        if mac::alerte(&w, "A data file is missing or could not be read", &detail, &["Open the data folder", "Continue"], 1) == Some(0) {
            ouvrir(&conf().dossier, false);
        }
    });
}

/// Loaded by index.html before the page scripts: the data (re-read on every load) then window.sablier.
fn demarrage(app: &AppHandle, requete: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if requete.uri().path() != "/demarrage.js" {
        return reponse(404, "text/plain", Vec::new());
    }
    let lu = donnees().lire_tout();
    let (illisibles, absents) = donnees().problemes();
    if (!illisibles.is_empty() || !absents.is_empty()) && !conf().smoke {
        signaler_problemes(app, illisibles, absents);
    }
    let plateforme = if cfg!(windows) { "win32" } else { "darwin" };
    let d = json!({ "version": app.package_info().version.to_string(), "plateforme": plateforme, "smoke": conf().smoke, "dossier": conf().dossier, "donnees": lu });
    reponse(200, "text/javascript; charset=utf-8", format!("window.__SABLIER_DEMARRAGE = {d};\n{PONT}").into_bytes())
}

fn dossier_pieces() -> PathBuf {
    conf().dossier.join("Pieces")
}

/// sablier-piece://pieces/<task>/<file>: the attached images, limited to the Pieces folder of the data.
/// On Windows, http://sablier-piece.localhost/pieces/<task>/<file>: the host is the scheme.
fn servir_piece(requete: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let chemin = requete.uri().path();
    #[cfg(windows)]
    let Some(chemin) = chemin.strip_prefix("/pieces/") else {
        return reponse(404, "text/plain", Vec::new());
    };
    let relatif = fichiers::decoder_url(chemin);
    let racine = dossier_pieces();
    match fichiers::chemin_dans(&racine, relatif.trim_start_matches('/')) {
        Some(c) if c != racine && c.is_file() => match fs::read(&c) {
            Ok(octets) => reponse(200, fichiers::type_mime(&c.to_string_lossy()), octets),
            Err(_) => reponse(404, "text/plain", Vec::new()),
        },
        _ => reponse(404, "text/plain", Vec::new()),
    }
}

/* -------------------------------- Commands (window.sablier) -------------------------------- */

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
    let defaut = documents().join(non_vide(nom_fichier).unwrap_or_else(|| "Sablier-backup.json".into()));
    let Some(chemin) = mac::enregistrer_sous(&window, "Export a backup", &defaut, &["json"]) else {
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
    let Some(chemin) = mac::ouvrir_panneau(&window, "Import a backup", None, choix, &["json"]).into_iter().next() else {
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
    let Some(chemin) = mac::enregistrer_sous(&window, "Save the PDF", &defaut, &["pdf"]) else {
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

/// Invoice and statement filed automatically in the invoices folder (Settings), in the month's subfolder:
/// the first one starting with "YYYY-MM", otherwise created.
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
        return json!({ "ok": false, "message": "invoices folder not found, choose one in Settings" });
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
    mac::ouvrir_panneau(&window, "Invoices folder", Some(&depart), choix, &[]).into_iter().next()
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
    let Some(chemin) = mac::enregistrer_sous(&window, "Save", &defaut, &[]) else {
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

/// Attachments: paths (self-test), otherwise a file picker.
#[tauri::command]
async fn pieces_ajouter(window: WebviewWindow, tache_id: String, chemins: Option<Vec<String>>) -> Value {
    let mut liste: Vec<PathBuf> = chemins.unwrap_or_default().into_iter().filter(|c| !c.is_empty()).map(PathBuf::from).collect();
    if liste.is_empty() {
        let choix = Choix { fichiers: true, dossiers: false, plusieurs: true };
        liste = mac::ouvrir_panneau(&window, "Attach files to the task", None, choix, &[]);
        if liste.is_empty() {
            return json!({ "ok": false, "annule": true });
        }
    }
    fichiers::copier_pieces(&dossier_pieces(), &tache_id, &liste)
}

/// A file dropped from the Finder: its content as the raw body, the task and the name in headers (URL-encoded).
#[tauri::command]
fn pieces_deposer(requete: tauri::ipc::Request<'_>) -> Value {
    let entete = |n: &str| requete.headers().get(n).and_then(|v| v.to_str().ok()).map(fichiers::decoder_url).unwrap_or_default();
    let (tache, nom) = (entete("x-tache"), entete("x-nom"));
    match requete.body() {
        InvokeBody::Raw(octets) if !tache.is_empty() => fichiers::deposer_piece(&dossier_pieces(), &tache, &nom, octets),
        _ => json!({ "ok": false, "message": "dropped file unreadable" }),
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

/* -------------------------------- Startup -------------------------------- */

fn demarrer(app: &AppHandle) {
    let _ = APP.set(app.clone());
    donnees().sauvegarde_quotidienne(false);
    // Deferred writes go out when they fall due; the app stays open for weeks,
    // so the day's copy does not depend on a launch (checked every hour).
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
    let racine = racine_app();
    // The self-test writes test data: never into the real data.
    if smoke && test.as_ref().is_none_or(|d| d == &racine.join("Donnees")) {
        eprintln!("Self-test refused: SABLIER_SMOKE requires SABLIER_DONNEES=<disposable folder>.");
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
            commande(app, &format!("erreur-ecriture:{nom}: {message}"));
        }
    }));

    let mut constructeur = tauri::Builder::default();
    if test.is_none() {
        constructeur = constructeur.plugin(tauri_plugin_single_instance::init(|app, _, _| montrer_fenetre(app)));
    }
    #[cfg(windows)]
    {
        constructeur = constructeur.plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_notification::init());
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
            // Closing the window hides it: the page and its pending writes stay, the Dock brings it back.
            // Without a Dock (Windows), a hidden window would leave an invisible process: closing quits.
            if let (WindowEvent::CloseRequested { api, .. }, "main") = (e, w.label()) {
                if !conf().smoke {
                    api.prevent_close();
                    #[cfg(target_os = "macos")]
                    let _ = w.hide();
                    #[cfg(windows)]
                    quitter(w.app_handle());
                }
            }
        })
        .setup(|app| {
            demarrer(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("building the app");

    app.run(|_app, evenement| match evenement {
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } if !conf().smoke => montrer_fenetre(_app),
        RunEvent::ExitRequested { code: None, api, .. } if !conf().smoke => api.prevent_exit(),
        // Pending writes reach the disk before the end, however the app is quit.
        RunEvent::Exit => donnees().purger(),
        _ => {}
    });
}
