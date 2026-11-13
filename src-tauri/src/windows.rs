//! Windows: the same functions as mac.rs. Panels, alerts and notifications through Tauri plugins, trash through
//! `trash`, PDF and self-test tools through WebView2 (Chromium).
//! The functions that wait for an answer (panels, alerts, PDF, JavaScript execution) must be called off the main
//! thread.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};
use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};
use tauri_plugin_notification::NotificationExt;
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7};
use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, PrintToPdfCompletedHandler};
use windows::core::{Interface, HSTRING};

/* -------------------------------- Panels and alerts -------------------------------- */

fn chemin_choisi(p: tauri_plugin_dialog::FilePath) -> Option<PathBuf> {
    p.into_path().ok()
}

/// "Save" panel; `defaut` gives the suggested folder and name.
pub fn enregistrer_sous(w: &WebviewWindow, titre: &str, defaut: &Path, extensions: &[&str]) -> Option<PathBuf> {
    let mut d = w.dialog().file().set_title(titre).set_parent(w).set_can_create_directories(true);
    if let Some(dossier) = defaut.parent().filter(|p| p.is_dir()) {
        d = d.set_directory(dossier);
    }
    if let Some(nom) = defaut.file_name() {
        d = d.set_file_name(nom.to_string_lossy());
    }
    if !extensions.is_empty() {
        d = d.add_filter(extensions.join(", ").to_uppercase(), extensions);
    }
    d.blocking_save_file().and_then(chemin_choisi)
}

pub struct Choix {
    pub fichiers: bool,
    pub dossiers: bool,
    pub plusieurs: bool,
}

/// "Open" panel; returns the chosen paths (none if cancelled).
pub fn ouvrir_panneau(w: &WebviewWindow, titre: &str, depart: Option<&Path>, choix: Choix, extensions: &[&str]) -> Vec<PathBuf> {
    let mut d = w.dialog().file().set_title(titre).set_parent(w);
    if let Some(dossier) = depart {
        d = d.set_directory(dossier);
    }
    if !extensions.is_empty() {
        d = d.add_filter(extensions.join(", ").to_uppercase(), extensions);
    }
    let choisis = if choix.dossiers {
        d.blocking_pick_folder().into_iter().collect()
    } else if choix.fichiers && choix.plusieurs {
        d.blocking_pick_files().unwrap_or_default()
    } else if choix.fichiers {
        d.blocking_pick_file().into_iter().collect()
    } else {
        Vec::new()
    };
    choisis.into_iter().filter_map(chemin_choisi).collect()
}

/// Alert attached to the window; returns the index of the chosen button, none if it is closed without a choice (Esc).
/// Enter answers the first button: the Windows dialog does not allow designating another one.
pub fn alerte(w: &WebviewWindow, message: &str, detail: &str, boutons: &[&str], _defaut: usize) -> Option<usize> {
    let texte = |i: usize| boutons[i].to_string();
    let choix = match boutons.len() {
        1 => MessageDialogButtons::OkCustom(texte(0)),
        2 => MessageDialogButtons::OkCancelCustom(texte(0), texte(1)),
        3 => MessageDialogButtons::YesNoCancelCustom(texte(0), texte(1), texte(2)),
        _ => MessageDialogButtons::Ok,
    };
    let r = w.dialog().message(format!("{message}\n\n{detail}")).title("Sablier").kind(MessageDialogKind::Warning).buttons(choix).parent(w).blocking_show_with_result();
    match r {
        MessageDialogResult::Custom(b) => boutons.iter().position(|x| *x == b),
        _ => None,
    }
}

/* -------------------------------- WebView2 DevTools -------------------------------- */

/// A DevTools (Chrome) protocol method on the window's webview; returns its JSON answer. Off the main thread.
fn devtools(w: &WebviewWindow, methode: &'static str, parametres: Value, delai: Duration) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel::<Result<Value, String>>();
    w.with_webview(move |pw| {
        let tx2 = tx.clone();
        let fin = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |r: windows::core::Result<()>, json: String| {
            let _ = tx2.send(r.map_err(|e| e.message()).and_then(|()| serde_json::from_str(&json).map_err(|e| e.to_string())));
            Ok(())
        }));
        // SAFETY: Tauri passes the webview's live controller, on the main thread, for the duration of the callback.
        let r = unsafe { pw.controller().CoreWebView2().and_then(|wv| wv.CallDevToolsProtocolMethod(&HSTRING::from(methode), &HSTRING::from(parametres.to_string()), &fin)) };
        if let Err(e) = r {
            let _ = tx.send(Err(e.message()));
        }
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(delai).map_err(|_| format!("{methode} not responding"))?
}

/* -------------------------------- PDF -------------------------------- */

/// Prints the window's page to an A4 PDF at `chemin`, without a panel. Chromium paginates according to the templates' CSS
/// (@page and its margins, whole table rows, repeated header).
fn imprimer(w: &WebviewWindow, chemin: &Path) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let chemin = HSTRING::from(chemin.as_os_str());
    w.with_webview(move |pw| {
        let tx2 = tx.clone();
        let fin = PrintToPdfCompletedHandler::create(Box::new(move |r: windows::core::Result<()>, reussi: bool| {
            let _ = tx2.send(match r {
                Ok(()) if reussi => Ok(()),
                Ok(()) => Err("printing failed".into()),
                Err(e) => Err(e.message()),
            });
            Ok(())
        }));
        // SAFETY: controller and environment alive, on the main thread, for the duration of the callback.
        let r = unsafe {
            (|| -> windows::core::Result<()> {
                let reglages = pw.environment().cast::<ICoreWebView2Environment6>()?.CreatePrintSettings()?;
                // A4 in inches; the margins are those of the templates' @page.
                reglages.SetPageWidth(8.2677)?;
                reglages.SetPageHeight(11.6929)?;
                reglages.SetMarginTop(0.0)?;
                reglages.SetMarginBottom(0.0)?;
                reglages.SetMarginLeft(0.0)?;
                reglages.SetMarginRight(0.0)?;
                reglages.SetShouldPrintBackgrounds(true)?;
                reglages.SetShouldPrintHeaderAndFooter(false)?;
                pw.controller().CoreWebView2()?.cast::<ICoreWebView2_7>()?.PrintToPdf(&chemin, &reglages, &fin)
            })()
        };
        if let Err(e) = r {
            let _ = tx.send(Err(e.message()));
        }
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(60)).map_err(|_| "printing is not responding".to_string())?
}

/// The totals block moves whole to the next page when it no longer fits, as on Mac (paginer.js):
/// Chromium would otherwise split its table between two rows.
const GARDER_ENTIERS: &str = "var s = document.createElement('style'); s.textContent = '.total-bloc { break-inside: avoid; }'; document.head.appendChild(s);";

/// Renders the HTML (statement, invoice) in a hidden window then prints it to PDF. The HTML goes through a
/// temporary file: NavigateToString is limited to 2 MB, which a long statement can exceed.
pub fn imprimer_pdf(app: &AppHandle, html: &str, chemin: &Path) -> Result<(), String> {
    static N: AtomicU64 = AtomicU64::new(0);
    let etiquette = format!("pdf-{}", N.fetch_add(1, Ordering::SeqCst));
    let source = std::env::temp_dir().join(format!("sablier-{etiquette}-{}.html", std::process::id()));
    fs::write(&source, html).map_err(|e| e.to_string())?;
    let r = (|| {
        let url = tauri::Url::from_file_path(&source).map_err(|_| "invalid document path")?;
        let w = WebviewWindowBuilder::new(app, &etiquette, WebviewUrl::External(url)).visible(false).inner_size(794.0, 1123.0).build().map_err(|e| e.to_string())?;
        let r = (|| {
            let mut pret = false;
            for _ in 0..200 {
                if executer(&w, "return location.protocol === 'file:' && document.readyState === 'complete' && !!document.body && document.body.childElementCount > 0")? == Value::Bool(true) {
                    pret = true;
                    break;
                }
                thread::sleep(Duration::from_millis(25));
            }
            if !pret {
                return Err("the document does not load".to_string());
            }
            executer(&w, &format!("{GARDER_ENTIERS}\nif (document.fonts && document.fonts.ready) await document.fonts.ready; return true"))?;
            imprimer(&w, chemin)
        })();
        let _ = w.destroy();
        r
    })();
    let _ = fs::remove_file(&source);
    r
}

/* -------------------------------- Notifications, taskbar, trash -------------------------------- */

/// The notification plugin has nothing to prepare on Windows; a click on the notification is not forwarded.
pub fn preparer_notifications(_app: &AppHandle) {}

pub fn notifier(titre: &str, corps: &str) -> bool {
    crate::APP.get().is_some_and(|app| app.notification().builder().title(titre).body(corps).show().is_ok())
}

/// No Dock on Windows: no badge.
pub fn pastille(_app: &AppHandle, _n: u64) {}

pub fn corbeille(chemin: &Path) -> Result<(), String> {
    trash::delete(chemin).map_err(|e| e.to_string())
}

/* -------------------------------- Self-test -------------------------------- */

/// Runs an async function body in the page (`return` gives the value, passed through JSON). Off the main thread.
/// ExecuteScript does not wait for promises: Runtime.evaluate of the DevTools protocol is used, with awaitPromise.
pub fn executer(w: &WebviewWindow, corps: &str) -> Result<Value, String> {
    let script = format!("(async function () {{ var __r = await (async function () {{\n{corps}\n}})();\nreturn JSON.stringify(__r === undefined ? null : __r); }})()");
    let reponse = devtools(w, "Runtime.evaluate", json!({ "expression": script, "awaitPromise": true, "returnByValue": true }), Duration::from_secs(120))
        .map_err(|e| if e.ends_with("not responding") { "execution not responding".to_string() } else { e })?;
    if let Some(d) = reponse.get("exceptionDetails") {
        let message = d["exception"]["description"].as_str().or(d["text"].as_str()).unwrap_or("exception");
        return Err(message.lines().next().unwrap_or_default().to_string());
    }
    match reponse["result"]["value"].as_str() {
        Some(s) => serde_json::from_str(s).map_err(|e| e.to_string()),
        None => Ok(Value::Null),
    }
}

/// PNG of the webview (Page.captureScreenshot of the DevTools protocol). Off the main thread.
pub fn capturer(w: &WebviewWindow, chemin: PathBuf) -> Result<(), String> {
    let reponse = devtools(w, "Page.captureScreenshot", json!({ "format": "png" }), Duration::from_secs(10))?;
    let donnees = reponse["data"].as_str().ok_or("empty capture")?;
    let png = base64::engine::general_purpose::STANDARD.decode(donnees).map_err(|_| "unreadable capture")?;
    fs::write(&chemin, png).map_err(|_| "could not write the capture".to_string())
}

/// Self-test: the window stays hidden, but the webview believes it is visible, otherwise WebView2 slows down timers and
/// requestAnimationFrame. Nothing appears on screen or in the taskbar.
pub fn fantome(w: &WebviewWindow) {
    let _ = w.with_webview(|pw| {
        // SAFETY: controller alive, on the main thread, for the duration of the callback.
        let _ = unsafe { pw.controller().SetIsVisible(true) };
    });
}
