//! AppKit, WebKit et UserNotifications par objc2 : ce que Tauri ne fait pas (PDF, panneaux d'enregistrement et
//! d'ouverture, alertes, notifications, pastille du Dock, corbeille), et les outils de l'auto-test.
//! Ce qui touche une fenêtre ou une WKWebView tourne sur le thread principal ; les fonctions qui attendent une réponse
//! (panneaux, alertes, PDF, exécution de JavaScript) sont à appeler hors du thread principal.

use std::cell::RefCell;
use std::ffi::c_void;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use block2::{DynBlock, RcBlock};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, NSObject, ProtocolObject};
use objc2::{define_class, msg_send, sel, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAlert, NSAlertFirstButtonReturn, NSAlertStyle, NSApplication, NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSModalResponse,
    NSModalResponseOK, NSOpenPanel, NSPrintHeaderAndFooter, NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob, NSSavePanel,
    NSWindow,
};
use objc2_foundation::{ns_string, NSArray, NSDictionary, NSError, NSFileManager, NSNumber, NSObjectProtocol, NSSize, NSString, NSURL};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions, UNNotificationRequest,
    UNNotificationResponse, UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use objc2_web_kit::{WKContentWorld, WKWebView};
use serde_json::Value;
use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Le NSWindow (TaoWindow) derrière une fenêtre Tauri. Thread principal uniquement.
fn ns_window(w: &WebviewWindow) -> Option<Retained<NSWindow>> {
    let ptr = w.ns_window().ok()?.cast::<NSWindow>();
    // SAFETY: tao garde ce NSWindow vivant tant que la fenêtre existe ; on prend notre propre référence.
    unsafe { Retained::retain(ptr) }
}

fn webview(ptr: *mut c_void) -> &'static WKWebView {
    // SAFETY: Tauri passe la WKWebView vivante de la fenêtre, sur le thread principal, le temps du rappel.
    unsafe { &*ptr.cast::<WKWebView>() }
}

fn chaines(l: &[String]) -> Retained<NSArray<NSString>> {
    NSArray::from_retained_slice(&l.iter().map(|s| NSString::from_str(s)).collect::<Vec<_>>())
}

/* -------------------------------- Feuilles : panneaux et alertes -------------------------------- */

/// Ouvre une feuille sur la fenêtre et attend la réponse que `ouvrir` enverra. Hors du thread principal.
fn feuille<T: Send + 'static>(w: &WebviewWindow, ouvrir: impl FnOnce(MainThreadMarker, &NSWindow, mpsc::Sender<T>) + Send + 'static) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    let w2 = w.clone();
    w.run_on_main_thread(move || {
        let (Some(mtm), Some(f)) = (MainThreadMarker::new(), ns_window(&w2)) else { return };
        ouvrir(mtm, &f, tx);
    })
    .ok()?;
    rx.recv().ok()
}

/// Panneau « Enregistrer » ; `defaut` donne le dossier et le nom proposés.
pub fn enregistrer_sous(w: &WebviewWindow, titre: &str, defaut: &Path, extensions: &[&str]) -> Option<PathBuf> {
    let titre = titre.to_string();
    let dossier = defaut.parent().map(Path::to_path_buf);
    let nom = defaut.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let ext: Vec<String> = extensions.iter().map(|e| e.to_string()).collect();
    feuille(w, move |mtm, f, tx| {
        let p = NSSavePanel::savePanel(mtm);
        p.setTitle(Some(&NSString::from_str(&titre)));
        if let Some(d) = dossier.as_deref().and_then(NSURL::from_file_path) {
            p.setDirectoryURL(Some(&d));
        }
        p.setNameFieldStringValue(&NSString::from_str(&nom));
        p.setCanCreateDirectories(true);
        if !ext.is_empty() {
            #[allow(deprecated)]
            p.setAllowedFileTypes(Some(&chaines(&ext)));
        }
        let garde = p.clone();
        let bloc = RcBlock::new(move |r: NSModalResponse| {
            let chemin = if r == NSModalResponseOK { garde.URL().and_then(|u| u.to_file_path()) } else { None };
            let _ = tx.send(chemin);
        });
        p.beginSheetModalForWindow_completionHandler(f, &bloc);
    })
    .flatten()
}

pub struct Choix {
    pub fichiers: bool,
    pub dossiers: bool,
    pub plusieurs: bool,
}

/// Panneau « Ouvrir » ; rend les chemins choisis (aucun si annulé).
pub fn ouvrir_panneau(w: &WebviewWindow, titre: &str, depart: Option<&Path>, choix: Choix, extensions: &[&str]) -> Vec<PathBuf> {
    let titre = titre.to_string();
    let depart = depart.map(Path::to_path_buf);
    let ext: Vec<String> = extensions.iter().map(|e| e.to_string()).collect();
    feuille(w, move |mtm, f, tx| {
        let p = NSOpenPanel::openPanel(mtm);
        p.setTitle(Some(&NSString::from_str(&titre)));
        if let Some(d) = depart.as_deref().and_then(NSURL::from_file_path) {
            p.setDirectoryURL(Some(&d));
        }
        p.setCanChooseFiles(choix.fichiers);
        p.setCanChooseDirectories(choix.dossiers);
        p.setAllowsMultipleSelection(choix.plusieurs);
        p.setCanCreateDirectories(choix.dossiers);
        if !ext.is_empty() {
            #[allow(deprecated)]
            p.setAllowedFileTypes(Some(&chaines(&ext)));
        }
        let garde = p.clone();
        let bloc = RcBlock::new(move |r: NSModalResponse| {
            let chemins = if r == NSModalResponseOK { garde.URLs().iter().filter_map(|u| u.to_file_path()).collect() } else { Vec::new() };
            let _ = tx.send(chemins);
        });
        p.beginSheetModalForWindow_completionHandler(f, &bloc);
    })
    .unwrap_or_default()
}

/// Alerte rattachée à la fenêtre ; rend l'indice du bouton choisi. `defaut` répond à Entrée.
pub fn alerte(w: &WebviewWindow, message: &str, detail: &str, boutons: &[&str], defaut: usize) -> Option<usize> {
    let (message, detail) = (message.to_string(), detail.to_string());
    let boutons: Vec<String> = boutons.iter().map(|b| b.to_string()).collect();
    feuille(w, move |mtm, f, tx| {
        let a = NSAlert::new(mtm);
        a.setAlertStyle(NSAlertStyle::Warning);
        a.setMessageText(&NSString::from_str(&message));
        a.setInformativeText(&NSString::from_str(&detail));
        for (i, b) in boutons.iter().enumerate() {
            a.addButtonWithTitle(&NSString::from_str(b)).setKeyEquivalent(if i == defaut { ns_string!("\r") } else { ns_string!("") });
        }
        let garde = a.clone();
        let bloc = RcBlock::new(move |r: NSModalResponse| {
            let _ = &garde;
            let _ = tx.send((r - NSAlertFirstButtonReturn) as usize);
        });
        a.beginSheetModalForWindow_completionHandler(f, Some(&bloc));
    })
}

/* -------------------------------- PDF -------------------------------- */

define_class!(
    // SAFETY: NSObject n'impose rien à ses sous-classes ; FinImpression n'implémente pas Drop.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "SablierFinImpression"]
    #[ivars = Mutex<Option<mpsc::Sender<bool>>>]
    struct FinImpression;

    impl FinImpression {
        /// didRunSelector de NSPrintOperation : (opération, réussite, contexte).
        #[unsafe(method(operation:fini:contexte:))]
        fn fini(&self, _operation: *mut AnyObject, succes: Bool, _contexte: *mut c_void) {
            if let Some(tx) = self.ivars().lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = tx.send(succes.as_bool());
            }
        }
    }
);

impl FinImpression {
    fn new(mtm: MainThreadMarker, tx: mpsc::Sender<bool>) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(Mutex::new(Some(tx)));
        unsafe { msg_send![super(this), init] }
    }
}

thread_local! {
    /// NSPrintOperation ne retient pas son délégué : on le garde jusqu'à la fin de l'impression.
    static IMPRESSIONS: RefCell<Vec<Retained<FinImpression>>> = const { RefCell::new(Vec::new()) };
}

/// Imprime la page de la fenêtre en PDF A4 dans `chemin`, sans panneau. WebKit pagine selon le CSS (@page, sauts de page).
fn imprimer(w: &WebviewWindow, chemin: &Path) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let (w2, chemin) = (w.clone(), chemin.to_path_buf());
    w.with_webview(move |pw| {
        let (Some(mtm), Some(f), Some(url)) = (MainThreadMarker::new(), ns_window(&w2), NSURL::from_file_path(&chemin)) else { return };
        let wk = webview(pw.inner());
        let info = NSPrintInfo::new();
        unsafe {
            info.setJobDisposition(NSPrintSaveJob);
            let d = info.dictionary();
            d.insert(NSPrintJobSavingURL, &*url);
            d.insert(NSPrintHeaderAndFooter, &*NSNumber::new_bool(false));
        }
        // A4 en points ; les marges sont celles du @page des gabarits.
        info.setPaperSize(NSSize::new(595.2756, 841.8898));
        info.setTopMargin(0.0);
        info.setBottomMargin(0.0);
        info.setLeftMargin(0.0);
        info.setRightMargin(0.0);
        info.setHorizontallyCentered(false);
        info.setVerticallyCentered(false);
        let op: Retained<NSPrintOperation> = unsafe { wk.printOperationWithPrintInfo(&info) };
        op.setShowsPrintPanel(false);
        op.setShowsProgressPanel(false);
        // Sans cadre, la vue d'impression de WebKit rend des pages blanches.
        if let Some(v) = op.view() {
            v.setFrame(wk.frame());
        }
        let fin = FinImpression::new(mtm, tx);
        IMPRESSIONS.with(|l| {
            let mut l = l.borrow_mut();
            l.retain(|x| x.ivars().lock().is_ok_and(|t| t.is_some()));
            l.push(fin.clone());
        });
        unsafe { op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(&f, Some(&fin), Some(sel!(operation:fini:contexte:)), std::ptr::null_mut()) };
    })
    .map_err(|e| e.to_string())?;
    match rx.recv_timeout(Duration::from_secs(60)) {
        Ok(true) => Ok(()),
        Ok(false) => Err("l'impression a échoué".into()),
        Err(_) => Err("l'impression ne répond pas".into()),
    }
}

/// Les sauts de page de Chromium (lignes de tableau entières, en-tête répété), posés avant l'impression.
const PAGINER: &str = include_str!("paginer.js");

/// Rend le HTML (relevé, facture) dans une fenêtre cachée puis l'imprime en PDF : mêmes polices que l'interface
/// (Charter, Avenir Next), aucune bibliothèque.
pub fn imprimer_pdf(app: &AppHandle, html: &str, chemin: &Path) -> Result<(), String> {
    static N: AtomicU64 = AtomicU64::new(0);
    let etiquette = format!("pdf-{}", N.fetch_add(1, Ordering::SeqCst));
    let vierge = WebviewUrl::External("about:blank".parse().map_err(|_| "URL vierge")?);
    let w = WebviewWindowBuilder::new(app, &etiquette, vierge).visible(false).inner_size(794.0, 1123.0).build().map_err(|e| e.to_string())?;
    let r = (|| {
        let html = html.to_string();
        w.with_webview(move |pw| {
            let _ = unsafe { webview(pw.inner()).loadHTMLString_baseURL(&NSString::from_str(&html), None) };
        })
        .map_err(|e| e.to_string())?;
        let mut pret = false;
        for _ in 0..200 {
            if executer(&w, "return document.readyState === 'complete' && !!document.body && document.body.childElementCount > 0")? == Value::Bool(true) {
                pret = true;
                break;
            }
            thread::sleep(Duration::from_millis(25));
        }
        if !pret {
            return Err("le document ne se charge pas".to_string());
        }
        // WebKit imprime 1 px CSS pour 0,8 pt, Chromium (version Electron) pour 0,75 pt. Le zoom rend la même mise en page
        // que les PDF d'avant ; les marges du @page, hors du document, n'en dépendent pas.
        executer(&w, "document.documentElement.style.zoom = String(0.75 / 0.8); if (document.fonts && document.fonts.ready) await document.fonts.ready; return true")?;
        executer(&w, PAGINER)?;
        imprimer(&w, chemin)
    })();
    let _ = w.destroy();
    r
}

/* -------------------------------- Notifications, Dock, corbeille -------------------------------- */

define_class!(
    // SAFETY: NSObject n'impose rien à ses sous-classes ; le délégué n'implémente pas Drop.
    #[unsafe(super(NSObject))]
    #[name = "SablierNotifications"]
    #[ivars = AppHandle]
    struct DelegueNotifications;

    unsafe impl NSObjectProtocol for DelegueNotifications {}

    unsafe impl UNUserNotificationCenterDelegate for DelegueNotifications {
        /// Comme sous Electron, la notification s'affiche même quand Sablier est au premier plan.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn presenter(&self, _centre: &UNUserNotificationCenter, _n: &UNNotification, fin: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>) {
            fin.call((UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List | UNNotificationPresentationOptions::Sound,));
        }

        /// Un clic sur la notification ouvre le centre des rappels.
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn reponse(&self, _centre: &UNUserNotificationCenter, _r: &UNNotificationResponse, fin: &DynBlock<dyn Fn()>) {
            let app = self.ivars().clone();
            let a = app.clone();
            let _ = app.run_on_main_thread(move || {
                crate::montrer_fenetre(&a);
                crate::commande(&a, "rappels");
            });
            fin.call(());
        }
    }
);

/// Hors d'un bundle .app (cargo run), UNUserNotificationCenter arrête le programme : pas de notifications.
pub fn preparer_notifications(app: &AppHandle) {
    if !crate::dans_bundle() {
        return;
    }
    let centre = UNUserNotificationCenter::currentNotificationCenter();
    let d = DelegueNotifications::alloc().set_ivars(app.clone());
    let d: Retained<DelegueNotifications> = unsafe { msg_send![super(d), init] };
    centre.setDelegate(Some(ProtocolObject::from_ref(&*d)));
    // Le centre ne retient pas son délégué ; celui-ci sert toute la vie de l'app.
    std::mem::forget(d);
    let options = UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge;
    centre.requestAuthorizationWithOptions_completionHandler(options, &RcBlock::new(|_: Bool, _: *mut NSError| {}));
}

pub fn notifier(titre: &str, corps: &str) -> bool {
    if !crate::dans_bundle() {
        return false;
    }
    let contenu = UNMutableNotificationContent::new();
    contenu.setTitle(&NSString::from_str(titre));
    contenu.setBody(&NSString::from_str(corps));
    contenu.setSound(Some(&UNNotificationSound::defaultSound()));
    let id = NSString::from_str(&format!("sablier-{}", crate::donnees::maintenant_ms()));
    let requete = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &contenu, None);
    UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&requete, None);
    true
}

/// Pastille du Dock : un nombre, ou rien.
pub fn pastille(app: &AppHandle, n: u64) {
    let _ = app.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let texte = (n > 0).then(|| NSString::from_str(&n.to_string()));
        NSApplication::sharedApplication(mtm).dockTile().setBadgeLabel(texte.as_deref());
    });
}

pub fn corbeille(chemin: &Path) -> Result<(), String> {
    let url = NSURL::from_file_path(chemin).ok_or("chemin invalide")?;
    NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&url, None).map_err(|e| e.localizedDescription().to_string())
}

/* -------------------------------- Auto-test -------------------------------- */

/// Exécute un corps de fonction async dans la page (`return` rend la valeur, passée par JSON). Hors du thread principal.
pub fn executer(w: &WebviewWindow, corps: &str) -> Result<Value, String> {
    let script = format!("var __r = await (async function () {{\n{corps}\n}})();\nreturn JSON.stringify(__r === undefined ? null : __r);");
    let (tx, rx) = mpsc::channel();
    w.with_webview(move |pw| {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let bloc = RcBlock::new(move |res: *mut AnyObject, erreur: *mut NSError| {
            let r = match unsafe { erreur.as_ref() } {
                Some(e) => Err(e
                    .userInfo()
                    .objectForKey(ns_string!("WKJavaScriptExceptionMessage"))
                    .and_then(|m| m.downcast::<NSString>().ok())
                    .unwrap_or_else(|| e.localizedDescription())
                    .to_string()),
                None => match unsafe { res.as_ref() }.and_then(|o| o.downcast_ref::<NSString>()) {
                    Some(s) => serde_json::from_str(&s.to_string()).map_err(|e| e.to_string()),
                    None => Ok(Value::Null),
                },
            };
            let _ = tx.send(r);
        });
        unsafe {
            webview(pw.inner()).callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                &NSString::from_str(&script),
                None,
                None,
                &WKContentWorld::pageWorld(mtm),
                Some(&bloc),
            )
        };
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(120)).map_err(|_| "exécution sans réponse".to_string())?
}

/// PNG de la webview (WKWebView takeSnapshot). Hors du thread principal.
pub fn capturer(w: &WebviewWindow, chemin: PathBuf) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    w.with_webview(move |pw| {
        let bloc = RcBlock::new(move |image: *mut NSImage, _erreur: *mut NSError| {
            let r = (|| {
                let image = unsafe { image.as_ref() }.ok_or("capture vide")?;
                let tiff = image.TIFFRepresentation().ok_or("capture illisible")?;
                let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("capture illisible")?;
                let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }.ok_or("PNG impossible")?;
                fs::write(&chemin, png.to_vec()).map_err(|_| "écriture de la capture impossible")
            })();
            let _ = tx.send(r.map_err(String::from));
        });
        unsafe { webview(pw.inner()).takeSnapshotWithConfiguration_completionHandler(None, &bloc) };
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(10)).map_err(|_| "capture sans réponse".to_string())?
}

/// Auto-test : la fenêtre est montrée, sinon WebKit la croit cachée et gèle minuteries et requestAnimationFrame,
/// mais transparente et traversée par la souris, pour ne rien gêner à l'écran.
pub fn fantome(w: &WebviewWindow) {
    if let Some(f) = ns_window(w) {
        f.setAlphaValue(0.0);
        f.setIgnoresMouseEvents(true);
        f.orderFrontRegardless();
    }
}
