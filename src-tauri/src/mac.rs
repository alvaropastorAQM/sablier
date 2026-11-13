//! AppKit, WebKit and UserNotifications through objc2: what Tauri does not do (PDF, save and open panels,
//! alerts, notifications, Dock badge, trash), and the self-test tools.
//! Anything touching a window or a WKWebView runs on the main thread; the functions that wait for an answer
//! (panels, alerts, PDF, JavaScript execution) must be called off the main thread.

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

/// The NSWindow (TaoWindow) behind a Tauri window. Main thread only.
fn ns_window(w: &WebviewWindow) -> Option<Retained<NSWindow>> {
    let ptr = w.ns_window().ok()?.cast::<NSWindow>();
    // SAFETY: tao keeps this NSWindow alive as long as the window exists; we take our own reference.
    unsafe { Retained::retain(ptr) }
}

fn webview(ptr: *mut c_void) -> &'static WKWebView {
    // SAFETY: Tauri passes the window's live WKWebView, on the main thread, for the duration of the callback.
    unsafe { &*ptr.cast::<WKWebView>() }
}

fn chaines(l: &[String]) -> Retained<NSArray<NSString>> {
    NSArray::from_retained_slice(&l.iter().map(|s| NSString::from_str(s)).collect::<Vec<_>>())
}

/* -------------------------------- Sheets: panels and alerts -------------------------------- */

/// Opens a sheet on the window and waits for the answer that `ouvrir` will send. Off the main thread.
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

/// "Save" panel; `defaut` gives the suggested folder and name.
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

/// "Open" panel; returns the chosen paths (none if cancelled).
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

/// Alert attached to the window; returns the index of the chosen button. `defaut` answers Enter.
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
    // SAFETY: NSObject imposes nothing on its subclasses; FinImpression does not implement Drop.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "SablierFinImpression"]
    #[ivars = Mutex<Option<mpsc::Sender<bool>>>]
    struct FinImpression;

    impl FinImpression {
        /// didRunSelector of NSPrintOperation: (operation, success, context).
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
    /// NSPrintOperation does not retain its delegate: we keep it until printing ends.
    static IMPRESSIONS: RefCell<Vec<Retained<FinImpression>>> = const { RefCell::new(Vec::new()) };
}

/// Prints the window's page to an A4 PDF at `chemin`, without a panel. WebKit paginates according to the CSS (@page, page breaks).
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
        // A4 in points; the margins are those of the templates' @page.
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
        // Without a frame, WebKit's print view renders blank pages.
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
        Ok(false) => Err("printing failed".into()),
        Err(_) => Err("printing is not responding".into()),
    }
}

/// Chromium-style page breaks (whole table rows, repeated header), applied before printing.
const PAGINER: &str = include_str!("paginer.js");

/// Renders the HTML (statement, invoice) in a hidden window then prints it to PDF: same fonts as the interface
/// (Charter, Avenir Next), no library.
pub fn imprimer_pdf(app: &AppHandle, html: &str, chemin: &Path) -> Result<(), String> {
    static N: AtomicU64 = AtomicU64::new(0);
    let etiquette = format!("pdf-{}", N.fetch_add(1, Ordering::SeqCst));
    let vierge = WebviewUrl::External("about:blank".parse().map_err(|_| "blank URL")?);
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
            return Err("the document does not load".to_string());
        }
        // WebKit prints 1 CSS px as 0.8 pt, Chromium (Electron version) as 0.75 pt. The zoom gives the same layout
        // as the earlier PDFs; the @page margins, outside the document, do not depend on it.
        executer(&w, "document.documentElement.style.zoom = String(0.75 / 0.8); if (document.fonts && document.fonts.ready) await document.fonts.ready; return true")?;
        executer(&w, PAGINER)?;
        imprimer(&w, chemin)
    })();
    let _ = w.destroy();
    r
}

/* -------------------------------- Notifications, Dock, trash -------------------------------- */

define_class!(
    // SAFETY: NSObject imposes nothing on its subclasses; the delegate does not implement Drop.
    #[unsafe(super(NSObject))]
    #[name = "SablierNotifications"]
    #[ivars = AppHandle]
    struct DelegueNotifications;

    unsafe impl NSObjectProtocol for DelegueNotifications {}

    unsafe impl UNUserNotificationCenterDelegate for DelegueNotifications {
        /// As with Electron, the notification is shown even when Sablier is in the foreground.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn presenter(&self, _centre: &UNUserNotificationCenter, _n: &UNNotification, fin: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>) {
            fin.call((UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List | UNNotificationPresentationOptions::Sound,));
        }

        /// Clicking the notification opens the reminders center.
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

/// Outside a .app bundle (cargo run), UNUserNotificationCenter aborts the program: no notifications.
pub fn preparer_notifications(app: &AppHandle) {
    if !crate::dans_bundle() {
        return;
    }
    let centre = UNUserNotificationCenter::currentNotificationCenter();
    let d = DelegueNotifications::alloc().set_ivars(app.clone());
    let d: Retained<DelegueNotifications> = unsafe { msg_send![super(d), init] };
    centre.setDelegate(Some(ProtocolObject::from_ref(&*d)));
    // The center does not retain its delegate; this one serves for the whole life of the app.
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

/// Dock badge: a number, or nothing.
pub fn pastille(app: &AppHandle, n: u64) {
    let _ = app.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let texte = (n > 0).then(|| NSString::from_str(&n.to_string()));
        NSApplication::sharedApplication(mtm).dockTile().setBadgeLabel(texte.as_deref());
    });
}

pub fn corbeille(chemin: &Path) -> Result<(), String> {
    let url = NSURL::from_file_path(chemin).ok_or("invalid path")?;
    NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&url, None).map_err(|e| e.localizedDescription().to_string())
}

/* -------------------------------- Self-test -------------------------------- */

/// Runs an async function body in the page (`return` gives the value, passed through JSON). Off the main thread.
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
    rx.recv_timeout(Duration::from_secs(120)).map_err(|_| "execution not responding".to_string())?
}

/// PNG of the webview (WKWebView takeSnapshot). Off the main thread.
pub fn capturer(w: &WebviewWindow, chemin: PathBuf) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    w.with_webview(move |pw| {
        let bloc = RcBlock::new(move |image: *mut NSImage, _erreur: *mut NSError| {
            let r = (|| {
                let image = unsafe { image.as_ref() }.ok_or("empty capture")?;
                let tiff = image.TIFFRepresentation().ok_or("unreadable capture")?;
                let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("unreadable capture")?;
                let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }.ok_or("PNG failed")?;
                fs::write(&chemin, png.to_vec()).map_err(|_| "could not write the capture")
            })();
            let _ = tx.send(r.map_err(String::from));
        });
        unsafe { webview(pw.inner()).takeSnapshotWithConfiguration_completionHandler(None, &bloc) };
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(10)).map_err(|_| "capture not responding".to_string())?
}

/// Self-test: the window is shown, otherwise WebKit thinks it is hidden and freezes timers and requestAnimationFrame,
/// but it is transparent and click-through, so it gets in the way of nothing on screen.
pub fn fantome(w: &WebviewWindow) {
    if let Some(f) = ns_window(w) {
        f.setAlphaValue(0.0);
        f.setIgnoresMouseEvents(true);
        f.orderFrontRegardless();
    }
}
