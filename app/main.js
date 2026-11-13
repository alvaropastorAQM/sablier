/* ============================================================
   Sablier: desktop application (Electron)
   Main process: window, menus, file-based data, PDF,
   task attachments, notifications and badge count.

   Useful environment variables:
     SABLIER_DONNEES=<folder>   data location (tests), Electron profile
                                in <folder>-electron
     SABLIER_SMOKE=1            self-test: hidden window, page screenshots
                                in SABLIER_CAPTURES (or /tmp), then quits;
                                refused without a disposable SABLIER_DONNEES
   ============================================================ */
'use strict';

const { app, BrowserWindow, Menu, shell, dialog, ipcMain, protocol, net, Notification, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const { Donnees } = require('./donnees.js');
const { genererPdf, rendrePdf, cheminLibre } = require('./pdf.js');

const MODE_SMOKE = process.env.SABLIER_SMOKE === '1';
const VERSION = require('../package.json').version;

/* The self-test writes test data: never into the real data. */
if (MODE_SMOKE && (!process.env.SABLIER_DONNEES || path.resolve(process.env.SABLIER_DONNEES) === path.join(app.getPath('appData'), 'Sablier', 'Donnees'))) {
  process.stderr.write('Self-test refused: SABLIER_SMOKE requires SABLIER_DONNEES=<disposable folder>.\n');
  process.exit(1);
}

app.setName('Sablier');
/* With SABLIER_DONNEES (tests), the Electron profile goes next to the data
   folder: the self-test runs even while Sablier is open. */
app.setPath('userData', process.env.SABLIER_DONNEES ? path.resolve(process.env.SABLIER_DONNEES) + '-electron' : path.join(app.getPath('appData'), 'Sablier'));

/* Images attached to tasks are served through an internal protocol,
   limited to the Pieces folder of the data. */
protocol.registerSchemesAsPrivileged([{ scheme: 'sablier-piece', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let fenetre = null;
let donnees = null;
let preferences = { dossierPdf: null };

const verrou = app.requestSingleInstanceLock();
if (!verrou) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); }
  });
}

function cheminPreferences() { return path.join(app.getPath('userData'), 'preferences.json'); }
function chargerPreferences() {
  try { preferences = Object.assign(preferences, JSON.parse(fs.readFileSync(cheminPreferences(), 'utf8'))); } catch (e) {}
}
function enregistrerPreferences() {
  try { fs.writeFileSync(cheminPreferences(), JSON.stringify(preferences, null, 2) + '\n', 'utf8'); } catch (e) {}
}

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    /* System glass behind the sidebar and around the stage; the self-test
       screenshots (hidden window) do not see it and keep the page
       background. */
    backgroundColor: MODE_SMOKE ? '#0B0C0E' : '#00000000',
    vibrancy: MODE_SMOKE ? undefined : 'sidebar',
    visualEffectState: 'followWindow',
    show: !MODE_SMOKE,
    title: 'Sablier',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });
  fenetre.loadFile(path.join(__dirname, '..', 'index.html'), MODE_SMOKE ? {} : { query: { vibrance: '1' } });
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  /* A file dropped outside a drop zone, or a link, must never replace the
     interface with a navigation. */
  fenetre.webContents.on('will-navigate', (ev) => { ev.preventDefault(); });
  fenetre.on('closed', () => { fenetre = null; });
}

/* Shows the window (recreating it if needed), then runs "apres" once the
   interface is ready to receive a command. */
function montrerFenetre(apres) {
  if (!fenetre || fenetre.isDestroyed()) {
    creerFenetre();
    if (apres) fenetre.webContents.once('did-finish-load', () => setTimeout(apres, 300));
    return;
  }
  if (fenetre.isMinimized()) fenetre.restore();
  fenetre.show();
  fenetre.focus();
  if (apres) apres();
}

function envoyerCommande(nom) {
  if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send('commande', nom);
}

function creerMenu() {
  const pages = [
    ['Dashboard', 'tableau', '1'], ['Log and statement', 'releve', '2'], ['Invoices and income', 'factures', '3'],
    ['Tasks', 'taches', '4'], ['Notes', 'notes', '5'], ['Deadlines', 'echeances', '6'], ['Settings', 'reglages', '7'], ['User guide', 'guide', '8'],
  ];
  const modele = [
    {
      label: 'Sablier',
      submenu: [
        { label: 'About Sablier', role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => envoyerCommande('page:reglages') },
        { label: 'Open data folder', click: () => { shell.openPath(donnees.dossier); } },
        { label: 'Export a backup…', click: () => envoyerCommande('exporter') },
        { label: 'Import a backup…', click: () => envoyerCommande('importer') },
        { type: 'separator' },
        { label: 'Hide Sablier', role: 'hide' },
        { label: 'Hide others', role: 'hideOthers' },
        { label: 'Show all', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit Sablier', role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New log entry', accelerator: 'CommandOrControl+N', click: () => envoyerCommande('nouvelle-saisie') },
        { label: 'Start or stop the timer', accelerator: 'CommandOrControl+Shift+T', click: () => envoyerCommande('chrono') },
        { label: 'Pause or resume the timer', accelerator: 'CommandOrControl+Alt+T', click: () => envoyerCommande('pause-chrono') },
        { type: 'separator' },
        { label: 'New task', accelerator: 'CommandOrControl+Shift+N', click: () => envoyerCommande('nouvelle-tache') },
        { label: 'New notes page', accelerator: 'CommandOrControl+Shift+P', click: () => envoyerCommande('nouvelle-page') },
        { label: 'Reminders…', accelerator: 'CommandOrControl+Shift+R', click: () => envoyerCommande('rappels') },
        { type: 'separator' },
        { label: 'Close', role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        /* The notes editor keeps its own history: the page decides. */
        { label: 'Undo', accelerator: 'CommandOrControl+Z', click: () => envoyerCommande('annuler') },
        { label: 'Redo', accelerator: 'Shift+CommandOrControl+Z', click: () => envoyerCommande('retablir') },
        { type: 'separator' },
        { label: 'Cut', role: 'cut' },
        { label: 'Copy', role: 'copy' },
        { label: 'Paste', role: 'paste' },
        { label: 'Select all', role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: pages.map(p => ({ label: p[0], accelerator: 'CommandOrControl+' + p[2], click: () => envoyerCommande('page:' + p[1]) })).concat([
        { type: 'separator' },
        { label: 'Reload', role: 'reload' },
        { label: 'Actual size', role: 'resetZoom' },
        { label: 'Zoom in', role: 'zoomIn' },
        { label: 'Zoom out', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Full screen', role: 'togglefullscreen' },
        { label: 'Developer tools', role: 'toggleDevTools' },
      ]),
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', role: 'minimize' },
        { label: 'Zoom', role: 'zoom' },
        { type: 'separator' },
        { label: 'Bring all to front', role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(modele));
}

/* ============================================================
   ATTACHMENTS: Donnees/Pieces/<task>/<file>
   ============================================================ */
function nettoyerSegment(s) { return String(s || '').replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '_').slice(0, 80) || 'piece'; }
/* Safe file name: no separator, extension kept, at most 200 bytes (the
   file system limit is 255). */
function nettoyerNomFichier(s) {
  const nom = String(s || 'fichier').replace(/[\/\\:\x00-\x1f]/g, '_').replace(/^\.+/, '_');
  const ext = path.extname(nom).slice(0, 16);
  let base = path.basename(nom, ext) || 'fichier';
  while (Buffer.byteLength(base + ext, 'utf8') > 200 && base.length > 1) base = base.slice(0, -1);
  return (base + ext) || 'fichier';
}
function dossierPieces() { return path.join(donnees.dossier, 'Pieces'); }
/* Absolute path of an attachment, refused if it leaves the Pieces folder. */
function cheminPiece(relatif) {
  const racine = dossierPieces();
  const cible = path.resolve(racine, String(relatif || ''));
  if (cible !== racine && !cible.startsWith(racine + path.sep)) return null;
  return cible;
}
/* Formats Chromium can show as a thumbnail (not HEIC, TIFF). */
const EXT_IMAGES = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

async function copierPieces(tacheId, chemins) {
  const dossier = path.join(dossierPieces(), nettoyerSegment(tacheId));
  await fs.promises.mkdir(dossier, { recursive: true });
  const pieces = [], erreurs = [];
  for (const src of chemins) {
    try {
      const st = await fs.promises.stat(src);
      if (!st.isFile()) { erreurs.push(path.basename(src) + ': not a file'); continue; }
      const nom = nettoyerNomFichier(path.basename(src));
      const ext = path.extname(nom);
      const base = path.basename(nom, ext);
      let cible = path.join(dossier, nom);
      let i = 1;
      while (fs.existsSync(cible)) cible = path.join(dossier, base + '-' + (++i) + ext);
      await fs.promises.copyFile(src, cible);
      pieces.push({ nom: path.basename(cible), fichier: nettoyerSegment(tacheId) + '/' + path.basename(cible), taille: st.size, image: EXT_IMAGES.test(cible) });
    } catch (e) { erreurs.push(path.basename(src) + ': ' + e.message); }
  }
  return { ok: true, pieces, erreurs };
}

/* Paths the interface may ask to open or reveal: only those the
   application produced itself (PDFs, exports). */
const cheminsOuvrables = new Set();

/* ============================================================
   NATIVE BRIDGE
   ============================================================ */
function installerPont() {
  const dossier = process.env.SABLIER_DONNEES || path.join(app.getPath('userData'), 'Donnees');
  donnees = new Donnees(dossier);
  donnees.sauvegardeQuotidienne();
  /* The app stays open for weeks: the daily copy does not depend on a launch. */
  setInterval(() => { donnees.purger(); donnees.sauvegardeQuotidienne(); }, 3600000);

  ipcMain.on('donnees:charger', (ev) => {
    ev.returnValue = donnees.lireTout();
    if ((donnees.illisibles.length || donnees.absents.length) && !MODE_SMOKE) {
      const liste = donnees.illisibles.map(x => x.nom + '.json (kept as ' + path.basename(x.copie) + ')').concat(donnees.absents.map(nom => nom + '.json (missing)')).join('\n');
      setTimeout(() => {
        dialog.showMessageBox(fenetre, {
          type: 'warning', buttons: ['Open data folder', 'Continue'], defaultId: 1,
          message: 'A data file is missing or could not be read',
          detail: liste + '\n\nA damaged file is set aside and the app starts with default values for that part: without factures.json, invoice numbering would restart at 01. A dated copy of each day is in the Sauvegardes subfolder: you can recover the last healthy version from there.',
        }).then(r => { if (r && r.response === 0) shell.openPath(donnees.dossier); });
      }, 800);
    }
  });
  donnees.surErreur = (nom, message) => envoyerCommande('erreur-ecriture:' + nom + ' : ' + message);
  ipcMain.on('donnees:ecrire', (ev, nom, objet) => { donnees.ecrire(nom, objet); });
  ipcMain.handle('donnees:dossier', async () => donnees.dossier);
  ipcMain.handle('donnees:ouvrir-dossier', async () => { await shell.openPath(donnees.dossier); });
  ipcMain.handle('donnees:sauvegarder', async () => { donnees.purger(); donnees.sauvegardeQuotidienne(true); return { ok: true }; });
  ipcMain.handle('app:version', async () => VERSION);

  ipcMain.handle('donnees:exporter', async (ev, paquet, nomFichier) => {
    const { canceled, filePath } = await dialog.showSaveDialog(fenetre, {
      title: 'Export a backup',
      defaultPath: path.join(app.getPath('documents'), nomFichier || 'Sablier-backup.json'),
      filters: [{ name: 'Sablier backup', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, annule: true };
    try { fs.writeFileSync(filePath, JSON.stringify(paquet, null, 2) + '\n', 'utf8'); cheminsOuvrables.add(filePath); return { ok: true, chemin: filePath }; }
    catch (e) { return { ok: false, message: e.message }; }
  });
  ipcMain.handle('donnees:importer', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(fenetre, {
      title: 'Import a backup',
      properties: ['openFile'],
      filters: [{ name: 'Sablier backup', extensions: ['json'] }],
    });
    if (canceled || !filePaths.length) return { ok: false, annule: true };
    try { return { ok: true, paquet: JSON.parse(fs.readFileSync(filePaths[0], 'utf8')) }; }
    catch (e) { return { ok: false, message: e.message }; }
  });

  ipcMain.handle('pdf:generer', async (ev, html, nomFichier) => {
    const dossierDefaut = preferences.dossierPdf && fs.existsSync(preferences.dossierPdf) ? preferences.dossierPdf : app.getPath('documents');
    const res = await genererPdf(fenetre, html, nomFichier, dossierDefaut);
    if (res && res.ok) { preferences.dossierPdf = path.dirname(res.chemin); enregistrerPreferences(); cheminsOuvrables.add(res.chemin); }
    return res;
  });

  /* Invoice and statement are filed automatically in the invoices folder
     (Settings), in the month subfolder: the first one starting with "YYYY-MM", otherwise created. */
  ipcMain.handle('pdf:classer', async (ev, html, base, mois, nomDossier, nomFichier) => {
    base = String(base || '');
    if (!path.isAbsolute(base) || !fs.existsSync(base) || !/^\d{4}-\d{2}$/.test(String(mois))) return { ok: false, message: 'invoices folder not found, choose it in Settings' };
    try {
      const existant = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory() && d.name.startsWith(mois)).map(d => d.name).sort()[0];
      const dossier = path.join(base, existant || nettoyerNomFichier(nomDossier || mois));
      fs.mkdirSync(dossier, { recursive: true });
      const res = await rendrePdf(html, cheminLibre(path.join(dossier, nettoyerNomFichier(nomFichier))));
      if (res.ok) cheminsOuvrables.add(res.chemin);
      return res;
    } catch (e) { return { ok: false, message: e.message }; }
  });
  ipcMain.handle('dossier:choisir', async (ev, depart) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(fenetre, {
      title: 'Invoices folder',
      defaultPath: depart && fs.existsSync(String(depart)) ? String(depart) : app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    return canceled || !filePaths.length ? null : filePaths[0];
  });

  ipcMain.handle('fichier:ouvrir', async (ev, chemin) => { if (cheminsOuvrables.has(String(chemin))) await shell.openPath(String(chemin)); });
  ipcMain.handle('fichier:reveler', async (ev, chemin) => { if (cheminsOuvrables.has(String(chemin))) shell.showItemInFolder(String(chemin)); });
  ipcMain.handle('fichier:ouvrir-url', async (ev, url) => { if (/^https?:\/\//i.test(String(url))) await shell.openExternal(String(url)); });
  ipcMain.handle('fichier:exporter-texte', async (ev, nomFichier, contenu) => {
    const { canceled, filePath } = await dialog.showSaveDialog(fenetre, {
      title: 'Save',
      defaultPath: path.join(app.getPath('documents'), nomFichier || 'export.txt'),
    });
    if (canceled || !filePath) return { ok: false, annule: true };
    try { fs.writeFileSync(filePath, String(contenu), 'utf8'); cheminsOuvrables.add(filePath); return { ok: true, chemin: filePath }; }
    catch (e) { return { ok: false, message: e.message }; }
  });

  /* Attachments */
  ipcMain.handle('pieces:ajouter', async (ev, tacheId, chemins) => {
    let liste = Array.isArray(chemins) ? chemins.filter(Boolean) : [];
    if (!liste.length) {
      const { canceled, filePaths } = await dialog.showOpenDialog(fenetre, { title: 'Attach files to the task', properties: ['openFile', 'multiSelections'] });
      if (canceled || !filePaths.length) return { ok: false, annule: true };
      liste = filePaths;
    }
    try { return await copierPieces(tacheId, liste); } catch (e) { return { ok: false, message: e.message }; }
  });
  ipcMain.handle('pieces:ouvrir', async (ev, relatif) => { const c = cheminPiece(relatif); if (c && fs.existsSync(c)) await shell.openPath(c); });
  ipcMain.handle('pieces:reveler', async (ev, relatif) => { const c = cheminPiece(relatif); if (c && fs.existsSync(c)) shell.showItemInFolder(c); });
  ipcMain.handle('pieces:supprimer', async (ev, relatif) => {
    const c = cheminPiece(relatif);
    if (!c || c === dossierPieces() || !fs.existsSync(c)) return { ok: false };
    try { await shell.trashItem(c); return { ok: true }; } catch (e) { return { ok: false, message: e.message }; }
  });

  /* Reminders: desktop notification and Dock badge */
  ipcMain.handle('rappels:notifier', async (ev, o) => {
    if (MODE_SMOKE || !Notification.isSupported()) return false;
    const n = new Notification({ title: String((o && o.titre) || 'Sablier'), body: String((o && o.corps) || ''), silent: false });
    n.on('click', () => { montrerFenetre(() => envoyerCommande('rappels')); });
    n.show();
    return true;
  });
  ipcMain.handle('rappels:badge', async (ev, n) => {
    if (app.dock) app.dock.setBadge(Number(n) > 0 ? String(Number(n)) : '');
  });
}

function installerProtocolePieces() {
  protocol.handle('sablier-piece', (requete) => {
    try {
      const u = new URL(requete.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const cible = cheminPiece(rel);
      if (!cible || cible === dossierPieces() || !fs.existsSync(cible)) return new Response('', { status: 404 });
      return net.fetch(pathToFileURL(cible).toString());
    } catch (e) { return new Response('', { status: 400 }); }
  });
}

/* ============================================================
   SELF-TEST (SABLIER_SMOKE=1)
   ============================================================ */
async function autoTest() {
  const dossierCaptures = process.env.SABLIER_CAPTURES || os.tmpdir();
  const attendre = (ms) => new Promise(r => setTimeout(r, ms));
  try {
    await attendre(600);
    const etat = await fenetre.webContents.executeJavaScript(`(function () {
      return JSON.stringify({
        pret: !!window.SABLIER_PRET,
        pont: typeof window.sablier,
        pages: Array.from(document.querySelectorAll('.tab-btn[data-tab]')).map(function (b) { return b.dataset.tab; }),
        axes: (ETAT.reglages.axes || []).length,
        entrees: ETAT.journal.entrees.length,
        taches: ETAT.chantiers.taches.length,
        pagesNotes: ETAT.notes.pages.length,
        echeances: ETAT.echeances.echeances.length,
        tirets: (document.body.innerText.match(/\\u2014/g) || []).length,
      });
    })()`);
    process.stdout.write('SABLIER_SMOKE_ETAT ' + etat + '\n');
    if (process.env.SABLIER_SMOKE_DEMO === '1') {
      await fenetre.webContents.executeJavaScript(`(function () {
        if (typeof window.SABLIER_DEMO === 'function') window.SABLIER_DEMO();
        return true;
      })()`);
    }
    if (process.env.SABLIER_SMOKE_MOIS) {
      await fenetre.webContents.executeJavaScript("RELEVE_MOIS = TABLEAU_PERIODE = '" + process.env.SABLIER_SMOKE_MOIS + "'; true");
    }
    const pages = ['tableau', 'releve', 'factures', 'taches', 'notes', 'echeances', 'reglages', 'guide'];
    for (const page of pages) {
      await fenetre.webContents.executeJavaScript(`afficherPage('${page}')`);
      await attendre(450);
      const img = await fenetre.webContents.capturePage();
      fs.writeFileSync(path.join(dossierCaptures, 'sablier-capture-' + page + '.png'), img.toPNG());
    }
    await fenetre.webContents.executeJavaScript("document.querySelector('.tab-btn[data-tab=releve]').click(); var jr = document.querySelector('#releveContenu .rl-jour'); if (jr) jr.click(); true");
    await attendre(400);
    fs.writeFileSync(path.join(dossierCaptures, 'sablier-capture-releve-deplie.png'), (await fenetre.webContents.capturePage()).toPNG());
    await fenetre.webContents.executeJavaScript("afficherPage('reglages'); document.getElementById('reglRappels').scrollIntoView({ block: 'start' })");
    await attendre(400);
    fs.writeFileSync(path.join(dossierCaptures, 'sablier-capture-reglages-rappels.png'), (await fenetre.webContents.capturePage()).toPNG());
    await fenetre.webContents.executeJavaScript("afficherPage('notes'); ouvrirPageNotes('page_idees')");
    await attendre(400);
    fs.writeFileSync(path.join(dossierCaptures, 'sablier-capture-notes-idees.png'), (await fenetre.webContents.capturePage()).toPNG());
    const modales = [
      { nom: 'modale-saisie', ouvrir: "afficherPage('journal'); ouvrirEditionEntree(null)" },
      { nom: 'modale-tache', ouvrir: "afficherPage('taches'); ouvrirEditionTache(ETAT.chantiers.taches[0] && ETAT.chantiers.taches[0].id)" },
      { nom: 'rappels', ouvrir: "afficherPage('tableau'); ouvrirRappels()" },
    ];
    for (const m of modales) {
      await fenetre.webContents.executeJavaScript(m.ouvrir);
      await attendre(500);
      const img = await fenetre.webContents.capturePage();
      fs.writeFileSync(path.join(dossierCaptures, 'sablier-capture-' + m.nom + '.png'), img.toPNG());
      await fenetre.webContents.executeJavaScript('fermerModale()');
    }
    const tirets = await fenetre.webContents.executeJavaScript(`(function () {
      var n = 0; var pages = ['tableau','journal','releve','factures','taches','notes','echeances','reglages','guide'];
      pages.forEach(function (p) { afficherPage(p); n += (document.getElementById('principal').innerText.match(/\\u2014/g) || []).length; });
      return n;
    })()`);
    process.stdout.write('SABLIER_SMOKE_TIRETS ' + tirets + '\n');
    if (process.env.SABLIER_SMOKE_SCENARIO === '1') {
      /* A text file and a one-pixel image, to attach to a task. */
      const fichierTest = path.join(os.tmpdir(), 'sablier-piece-test.txt');
      fs.writeFileSync(fichierTest, 'test attachment\n', 'utf8');
      const imageTest = path.join(os.tmpdir(), 'sablier-pixel.png');
      fs.writeFileSync(imageTest, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
      const scenario = await fenetre.webContents.executeJavaScript(`(async function () {
        var res = {};
        function ev(el, type, opts) { el.dispatchEvent(type === 'input' ? new Event('input', { bubbles: true }) : new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, opts))); }
        try {
          /* --- Timer: stop then restart --- */
          if (!chronoEnCours()) demarrerChrono({ axe: 'projeta', intervention: 'Starting timer', detail: '' });
          var avant = entreesJournal().length;
          var e = arreterChrono(true);
          res.chronoArret = !!e && entreesJournal().length === avant + 1 && e.minutes >= 1;
          demarrerChrono({ axe: 'suivi', intervention: 'Timer test', detail: '' });
          res.chronoDemarre = !!chronoEnCours() && chronoEnCours().intervention === 'Timer test';
          arreterChrono(true);
          res.chronoCourtEnregistre = !chronoEnCours() && entreesJournal().length === avant + 2 && entreesJournal()[avant + 1].minutes === 1;
          /* --- Log and statement: the timer's day unfolds into its entries --- */
          RELEVE_JOURS = {};
          afficherPage('journal');
          var jourChrono = document.querySelector('#releveContenu .rl-jour[data-jour="' + e.date + '"]');
          if (jourChrono) jourChrono.click();
          res.journeeDepliee = !!jourChrono && !!document.querySelector('#releveContenu .rl-detail .jr-ligne[data-id="' + e.id + '"]');
          res.sansBoutonExport = !document.querySelector('#releveContenu [data-action="pdf-releve"]');
          /* --- Card and deadline buttons (ids) --- */
          afficherPage('taches');
          var boutons = Array.prototype.slice.call(document.querySelectorAll('.kb-carte .btn-icone[data-action]'));
          res.cartesAvecId = boutons.length > 0 && boutons.every(function (b) { return !!b.dataset.id; });
          res.troisColonnes = document.querySelectorAll('.kb-colonne').length === 3 && !document.querySelector('.kb-colonne[data-statut="idee"]');
          afficherPage('echeances');
          var be = Array.prototype.slice.call(document.querySelectorAll('.ec-actions .btn-icone[data-action]'));
          res.echeancesAvecId = be.length > 0 && be.every(function (b) { return !!b.dataset.id; });
          /* --- Timer from a card, banner, pause, resume, stop --- */
          afficherPage('taches');
          var carteChrono = document.querySelector('.kb-carte .btn-icone[data-action=chrono]');
          carteChrono.click();
          var cc = chronoEnCours();
          res.chronoDepuisCarte = !!cc && cc.tache === carteChrono.dataset.id && cc.intervention === tacheParId(carteChrono.dataset.id).titre;
          var bandeau = document.getElementById('chronoBandeau');
          res.bandeauVisible = bandeau.classList.contains('visible') && bandeau.textContent.indexOf(cc.intervention) >= 0;
          afficherPage('notes');
          res.bandeauPartout = document.getElementById('chronoBandeau').classList.contains('visible');
          document.querySelector('#chronoBandeau [data-action=pause]').click();
          res.pause = chronoEnPause() && document.getElementById('chronoBandeau').classList.contains('en-pause');
          var tPause = dureeChronoMs(chronoEnCours());
          await new Promise(function (r) { setTimeout(r, 1200); });
          res.pauseFige = dureeChronoMs(chronoEnCours()) === tPause;
          document.querySelector('#chronoBandeau [data-action=pause]').click();
          res.reprise = !chronoEnPause() && dureeChronoMs(chronoEnCours()) < 1000;
          var avantStop = entreesJournal().length;
          document.querySelector('#chronoBandeau [data-action=arreter]').click();
          var ligneStop = entreesJournal()[entreesJournal().length - 1];
          res.arretDepuisBandeau = entreesJournal().length === avantStop + 1 && ligneStop.minutes === 1 && ligneStop.tache === carteChrono.dataset.id && !chronoEnCours() && !document.getElementById('chronoBandeau').classList.contains('visible');
          fermerModale();
          /* --- Priorities, automatic card sorting --- */
          var refJ = aujourdhui();
          var creerTest = function (titre, prio, jours) {
            var tt = normaliserTache({ id: uid('tt'), statut: 'a-faire', axe: 'projeta', titre: titre, description: '', priorite: prio, echeance: jours == null ? null : ajouterJours(refJ, jours), ordre: 999, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), faitLe: null });
            taches().push(tt); return tt;
          };
          var tUrgent = creerTest('Urgent test (low, 2 days)', 'basse', 2);
          var tHaute = creerTest('Manual high test (40 days)', 'haute', 40);
          var tMoyen = creerTest('Auto test (10 days)', 'auto', 10);
          var tLoin = creerTest('Auto test (30 days)', 'auto', 30);
          sauver('chantiers');
          afficherPage('taches');
          var ordreDom = Array.prototype.map.call(document.querySelectorAll('.kb-colonne[data-statut="a-faire"] .kb-carte'), function (c) { return c.dataset.id; });
          var posDe = function (tt) { return ordreDom.indexOf(tt.id); };
          res.triPriorites = posDe(tUrgent) === 0 && posDe(tHaute) === 1 && posDe(tMoyen) === 2 && posDe(tLoin) === 3 && ordreDom.length > 4;
          res.prioriteRelevee = prioriteEffective(tUrgent, refJ).niveau === 'haute' && prioriteEffective(tUrgent, refJ).origine === 'echeance' && prioriteEffective(tHaute, refJ).niveau === 'haute' && prioriteEffective(tMoyen, refJ).niveau === 'moyenne' && prioriteEffective(tLoin, refJ).niveau === 'basse';
          res.pastilleHaute = !!document.querySelector('.kb-carte[data-id="' + tUrgent.id + '"] .kb-priorite.haute') && !!document.querySelector('.kb-carte[data-id="' + tMoyen.id + '"] .kb-priorite.moyenne');
          res.puceCouleur = !!document.querySelector('.kb-carte .puce-axe .axe-point') && !document.querySelector('.puce-axe .code');
          /* --- Pointer drag and drop to "In progress" --- */
          var carteEl = document.querySelector('.kb-carte[data-id="' + tLoin.id + '"]');
          var colCible = document.querySelector('.kb-colonne[data-statut="en-cours"]');
          var r1 = carteEl.getBoundingClientRect(), r2 = colCible.getBoundingClientRect();
          var pe = function (type, x, y, cible) { (cible || document).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, isPrimary: true, pointerType: 'mouse' })); };
          pe('pointerdown', r1.left + 20, r1.top + 12, carteEl);
          pe('pointermove', r1.left + 40, r1.top + 30);
          res.glisserDemarre = !!document.querySelector('.kb-placeholder') && carteEl.classList.contains('kb-flottante');
          pe('pointermove', r2.left + r2.width / 2, r2.top + 70);
          res.emplacementDansCible = !!colCible.querySelector('.kb-placeholder');
          pe('pointerup', r2.left + r2.width / 2, r2.top + 70);
          await new Promise(function (r) { setTimeout(r, 300); });
          res.deposeEnCours = tacheParId(tLoin.id).statut === 'en-cours' && !document.querySelector('.kb-placeholder') && !document.querySelector('.kb-flottante');
          /* a single click on a card opens its sheet */
          var carteClic = document.querySelector('.kb-carte[data-id="' + tHaute.id + '"]');
          var rc = carteClic.getBoundingClientRect();
          pe('pointerdown', rc.left + 20, rc.top + 12, carteClic);
          pe('pointerup', rc.left + 21, rc.top + 12, carteClic);
          res.clicOuvreFiche = modaleOuverte() && document.querySelector('#tcTitre').value === tHaute.titre;
          fermerModale();
          ETAT.chantiers.taches = taches().filter(function (tt) { return [tUrgent.id, tHaute.id, tMoyen.id, tLoin.id].indexOf(tt.id) < 0; });
          sauver('chantiers');
          afficherPage('taches');
          /* --- Edit a card from its button --- */
          document.querySelector('.kb-carte .btn-icone[data-action=modifier]').click();
          res.modaleCarte = modaleOuverte() && !!document.querySelector('#tcTitre');
          fermerModale();
          /* --- Migration of ideas to notes --- */
          taches().push({ id: 'idee_test', statut: 'idee', axe: 'gouvernance', titre: 'Test idea', description: 'A detail', interet: 'fort', effort: 'petit', prerequis: 'rien', priorite: 'auto', echeance: null, ordre: 999, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), faitLe: null });
          var nbAvant = pageIdees().blocs.length;
          var nbMigre = migrerIdeesVersNotes();
          sauver('chantiers'); sauver('notes');
          var blocMigre = pageIdees().blocs[nbAvant];
          res.migrationIdees = nbMigre === 1 && pageIdees().blocs.length === nbAvant + 1 && !taches().some(function (x) { return x.statut === 'idee'; }) && blocMigre.type === 'idee' && blocMigre.html.indexOf('<b>Test idea</b>') === 0 && blocMigre.html.indexOf('Interest: ') > 0;
          res.ideesDefautDansNotes = pageIdees().blocs.filter(function (b) { return b.type === 'idee'; }).length >= 4;
          /* --- Idea to task --- */
          afficherPage('notes');
          ouvrirPageNotes('page_idees');
          var lignesIdee = document.querySelectorAll('#ntDoc .ligne-idee');
          var ligneIdee = lignesIdee[lignesIdee.length - 1];
          res.blocIdeeRendu = !!ligneIdee && !!ligneIdee.querySelector('[data-bloc-action=tache]');
          var nbT = taches().length;
          var nouvelle = creerTacheDepuisLigne(ligneIdee);
          res.conversionIdee = !!nouvelle && taches().length === nbT + 1 && nouvelle.titre === 'Test idea' && nouvelle.statut === 'a-faire' && nouvelle.description.indexOf('A detail') === 0 && nouvelle.notes.indexOf('page_idees') >= 0
            && !!document.querySelector('#ntDoc .ligne[data-tache="' + nouvelle.id + '"] [data-bloc-action=ouvrir-tache]') && pageParId('page_idees').blocs.some(function (b) { return b.tache === nouvelle.id; });
          res.tachesLieesStrip = !!document.querySelector('#ntTaches .chip-tache[data-id="' + nouvelle.id + '"]');
          /* --- Full sheet: steps, attachments, notes, progress, time --- */
          afficherPage('taches');
          ouvrirEditionTache(nouvelle.id);
          res.ficheSections = ['etapes', 'pieces', 'notes', 'avancement', 'temps'].every(function (s) { return !!document.querySelector('.fiche-section[data-section="' + s + '"]'); });
          ajouterEtapeTache(nouvelle, 'First step');
          ajouterEtapeTache(nouvelle, 'Second step');
          basculerEtapeTache(nouvelle, nouvelle.etapes[0].id, true);
          res.etapes = nouvelle.etapes.length === 2 && nouvelle.etapes[0].fait === true && document.querySelector('.fiche-section[data-section="etapes"] .nb').textContent === '1/2' && document.querySelectorAll('.fiche-section[data-section="etapes"] .etape').length === 2;
          ajouterPieceCode(nouvelle, { nom: 'example.js', langage: 'javascript', contenu: 'console.log(1)' });
          res.pieceCode = nouvelle.pieces.length === 1 && !!document.querySelector('.fiche-section[data-section="pieces"] .piece-code pre') && document.querySelector('.piece-code pre').textContent === 'console.log(1)';
          ajouterPieceLien(nouvelle, { nom: 'Documentation', url: 'example.org/doc' });
          res.pieceLien = nouvelle.pieces.length === 2 && nouvelle.pieces[1].url === 'https://example.org/doc' && !!document.querySelector('.piece-ligne .piece-nom');
          var okFichier = await ajouterPiecesFichiers(nouvelle, ['${fichierTest.replace(/\\/g, '\\\\')}', '${imageTest.replace(/\\/g, '\\\\')}']);
          var pf = nouvelle.pieces.filter(function (p) { return p.type === 'fichier' && !p.image; })[0];
          var pi = nouvelle.pieces.filter(function (p) { return p.type === 'fichier' && p.image; })[0];
          res.pieceFichier = okFichier === true && !!pf && pf.nom === 'sablier-piece-test.txt' && pf.taille > 0 && !!pi && pi.nom === 'sablier-pixel.png';
          res.pieceFichierChemin = pf ? pf.fichier : '';
          var img = document.querySelector('.fiche-section[data-section="pieces"] .piece-image img');
          res.imageUrl = !!img && img.getAttribute('src').indexOf('sablier-piece://pieces/') === 0;
          await new Promise(function (r) { if (!img || img.complete) return r(); img.addEventListener('load', r); img.addEventListener('error', r); setTimeout(r, 2500); });
          res.imageChargee = !!img && img.complete && img.naturalWidth === 1;
          lierTacheANote(nouvelle.id, 'page_projeta');
          apresMutationTache(nouvelle, 'notes');
          res.lienNote = nouvelle.notes.indexOf('page_projeta') >= 0 && tachesLieesAPage('page_projeta').length === 1 && document.querySelectorAll('.fiche-section[data-section="notes"] .chip-note').length === 2;
          ajouterAvancementTache(nouvelle, 'First progress update');
          res.avancement = nouvelle.avancement.length === 1 && !!document.querySelector('.fiche-section[data-section="avancement"] .avancement-entree');
          demarrerChrono({ axe: nouvelle.axe, intervention: nouvelle.titre, tache: nouvelle.id });
          arreterChrono(true);
          fermerModale();
          ouvrirEditionTache(nouvelle.id);
          res.tempsTache = minutesTache(entreesJournal(), nouvelle.id).minutes === 1 && document.querySelector('.fiche-section[data-section="temps"] .temps-resume b').textContent === '1 min';
          fermerModale();
          res.carteCompteurs = !!document.querySelector('.kb-carte[data-id="' + nouvelle.id + '"] .kb-compteurs') && !!document.querySelector('.kb-carte[data-id="' + nouvelle.id + '"] .kb-progres');
          /* --- Reminders --- */
          echeances().push({ id: 'ech_test', date: ajouterJours(aujourdhui(), -2), titre: 'Overdue test deadline', detail: '', type: 'perso', fait: false, faitLe: null, creeLe: new Date().toISOString() });
          echeances().push({ id: 'ech_test2', date: ajouterJours(aujourdhui(), 5), titre: 'Test deadline, 5 days out', detail: '', type: 'perso', rappelJours: 3, fait: false, faitLe: null, creeLe: new Date().toISOString() });
          sauver('echeances');
          nouvelle.echeance = aujourdhui(); sauver('chantiers');
          var rr = rappelsActifs();
          res.rappelsEcheance = rr.some(function (r) { return r.cle === 'echeance:ech_test' && r.niveau === 'retard'; }) && !rr.some(function (r) { return r.cle === 'echeance:ech_test2'; });
          res.rappelTache = rr.some(function (r) { return r.cle === 'tache:' + nouvelle.id && r.niveau === 'urgent'; });
          rafraichir();
          res.pastilleRappels = Number(document.getElementById('pastilleRappels').textContent) === rr.length && document.getElementById('btnRappels').classList.contains('urgent');
          ouvrirRappels();
          res.panneauRappels = modaleOuverte() && !!document.querySelector('.modal-rappels .rappel[data-cle="echeance:ech_test"]') && !!document.querySelector('.modal-rappels .rappels-groupe h4.niveau-retard');
          reporterRappel('echeance:ech_test', 1);
          res.report = !rappelsActifs().some(function (r) { return r.cle === 'echeance:ech_test'; }) && !!document.querySelector('.modal-rappels .rappel.reporte[data-cle="echeance:ech_test"]');
          reporterRappel('echeance:ech_test', 0);
          res.reactive = rappelsActifs().some(function (r) { return r.cle === 'echeance:ech_test'; });
          fermerModale();
          afficherPage('tableau');
          res.tableauRappels = !!document.querySelector('#tbRappels .rappel.cliquable[data-cle="echeance:ech_test"]');
          res.echeancesTableau = !!document.querySelector('#tbEcheances .dash-ech .dash-cal b') && !!document.querySelector('#tbEcheances .dash-jours') && !/in \\d+ day/.test(document.getElementById('tbEcheances').textContent);
          res.tachesTableau = !!document.querySelector('#tbTaches .dash-tache[data-id="' + nouvelle.id + '"] .dash-jours');
          /* --- Invoices and income: a tab of its own, no switch inside the statement --- */
          document.querySelector('.tab-btn[data-tab="factures"]').click();
          res.vueFactures = PAGE_COURANTE === 'factures' && !!document.querySelector('#facturesContenu #facturesTableau') && !document.querySelector('#rlVues');
          document.querySelector('.tab-btn[data-tab="releve"]').click();
          res.vueReleve = PAGE_COURANTE === 'releve' && !!document.querySelector('#rlMois') && !document.querySelector('#releveContenu .segment');
          /* --- Invoice template: clean header, Payment block, legal notices --- */
          var sauveP = JSON.stringify(ETAT.reglages.prestataire);
          ETAT.reglages.prestataire.iban = 'FR7612345678901234567890123'; ETAT.reglages.prestataire.bic = 'BANKFRPPXXX'; ETAT.reglages.prestataire.email = 'test@example.org'; ETAT.reglages.prestataire.telephone = '0612345678'; ETAT.reglages.prestataire.adresse = '12 rue des Essais, 75000 Paris';
          var titulaireSeed = ETAT.reglages.prestataire.titulaireCompte, banqueSeed = ETAT.reglages.prestataire.banque;
          var rel = releveDuMois(entreesJournal(), moisCourant(), ETAT.reglages, 0);
          var fx = construireFacture(rel, ETAT.reglages, { numero: '2099-01', dateEmission: aujourdhui(), travaux: [], factures: [] });
          var hf = htmlFacture(fx);
          res.factureEpuree = hf.indexOf('APE') < 0 && hf.indexOf('SIRET 123 456 789 00015') > 0 && hf.indexOf('L. 441-10 of the French Commercial Code') > 0 && hf.indexOf('06 12 34 56 78') > 0 && hf.indexOf('<div>12 rue des Essais</div><div>75000 Paris</div>') > 0;
          res.factureReglement = hf.indexOf('class="rib"') > 0 && hf.indexOf('FR76 1234 5678 9012 3456 7890 123') > 0 && hf.indexOf(titulaireSeed) > 0 && hf.indexOf(banqueSeed) > 0 && hf.indexOf('Early payment discount: none') > 0 && hf.indexOf('fixed recovery fee of €40') > 0 && hf.indexOf('Total due') > 0 && hf.indexOf(ETAT.reglages.prestataire.nom + ' EI</div>') > 0;
          /* The invoice does not say when the work was done: no Date column,
             no "Done in" mention, no day date in the annex. */
          res.factureSansDate = hf.indexOf('<th class="num">Date</th>') < 0 && hf.indexOf('Done in') < 0 && !/\\d{2}\\/\\d{2}\\/\\d{4}<\\/td>/.test(hf.split('class="annexe"')[1] || '') && hf.indexOf('Annex to invoice no. 2099-01') > 0;
          ETAT.reglages.prestataire = JSON.parse(sauveP);
          res.releveEpure = htmlReleve(rel, {}).indexOf('APE') < 0;
          /* --- Notes editor: a single area, one line per line break --- */
          afficherPage('notes');
          creerPageNotes(null);
          var idTest = NOTES_PAGE;
          var titre = document.getElementById('ntTitre');
          titre.textContent = 'Test page';
          ev(titre, 'input');
          res.titre = pageParId(NOTES_PAGE).titre === 'Test page';
          var doc = docNotes();
          var nl = function () { return doc.querySelectorAll(':scope > .ligne').length; };
          var li = function (i) { return doc.querySelectorAll(':scope > .ligne')[i]; };
          var taper = function (t) { document.execCommand('insertText', false, t); };
          res.zoneUnique = doc.isContentEditable && !doc.querySelector('[contenteditable="true"]') && !document.querySelector('.bloc-poignee');
          placerCaret(li(0), false);
          taper('First block');
          ev(doc, 'keydown', { key: 'Enter' });
          res.enterCreeBloc = nl() === 2 && li(0).textContent === 'First block' && ligneCourante() === li(1) && document.activeElement === doc;
          taper('- ');
          res.raccourciPuce = li(1).dataset.type === 'puce' && li(1).textContent === '';
          taper('Item');
          ev(doc, 'keydown', { key: 'Enter' });
          res.enterPuceSuivante = nl() === 3 && li(2).dataset.type === 'puce';
          ev(doc, 'keydown', { key: 'Enter' });
          res.puceVideDevientP = nl() === 3 && li(2).dataset.type === 'p';
          taper('/');
          res.menuSlashOuvert = !!document.getElementById('menuSlash');
          taper('idea');
          res.menuSlashIdee = document.querySelectorAll('#menuSlash button').length === 1;
          ev(doc, 'keydown', { key: 'Enter' });
          res.slashIdee = li(2).dataset.type === 'idee' && !document.getElementById('menuSlash') && !!li(2).querySelector('[data-bloc-action=tache]') && li(2).textContent === '';
          taper('A typed idea');
          ev(doc, 'keydown', { key: 'Enter' });
          taper('the detail');
          res.ideeSurDeuxLignes = nl() === 3 && texteBrutDe(nettoyerHtml(li(2).innerHTML)) === 'A typed idea\\nthe detail';
          ev(doc, 'keydown', { key: 'Enter' });
          ev(doc, 'keydown', { key: 'Enter' });
          res.ideeDoubleEntreeSort = nl() === 4 && li(3).dataset.type === 'p' && nettoyerHtml(li(2).innerHTML) === 'A typed idea<br>the detail';
          ev(doc, 'keydown', { key: 'Backspace' });
          res.backspaceLigneVide = nl() === 3;
          li(2).innerHTML = 'A typed idea';
          decorerLigne(li(2));
          placerCaret(li(2), true);
          ev(doc, 'keydown', { key: 'Backspace' });
          res.backspaceIdeeDevientP = li(2).dataset.type === 'p' && li(2).textContent === 'A typed idea';
          placerCaret(li(2), true);
          ev(doc, 'keydown', { key: 'Backspace' });
          res.backspaceFusionne = nl() === 2 && li(1).textContent === 'ItemA typed idea';
          placerCaret(li(1), false);
          ev(doc, 'keydown', { key: 'Enter' });
          taper('[] ');
          res.raccourciCase = li(2).dataset.type === 'case';
          taper('To check');
          var rc = li(2).getBoundingClientRect();
          li(2).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: rc.left + 9, clientY: rc.top + 12 }));
          res.caseCochee = li(2).classList.contains('coche');
          ev(doc, 'keydown', { key: 'Tab' });
          res.tabRetrait = li(2).dataset.retrait === '1';
          serialiserDoc();
          var p = pageParId(idTest);
          res.serialise = p.blocs.length === 3 && p.blocs[0].html === 'First block' && p.blocs[1].type === 'puce' && p.blocs[2].type === 'case' && p.blocs[2].coche === true && p.blocs[2].retrait === 1;
          /* Paste: always plain text, even from a web page or Markdown */
          var coller = function (texte, html) {
            var dt = new DataTransfer();
            dt.setData('text/plain', texte);
            if (html) dt.setData('text/html', html);
            doc.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
          };
          placerCaret(li(0), false);
          coller('Line A\\n- not a bullet\\n# not a heading', '<h1 style="color:red">Line A</h1><ul><li>not a bullet</li></ul><h1>not a heading</h1>');
          res.collageBrut = nl() === 5 && li(0).textContent === 'First blockLine A' && li(1).dataset.type === 'p' && li(1).textContent === '- not a bullet' && li(2).dataset.type === 'p' && li(2).textContent === '# not a heading'
            && !doc.querySelector('h1, ul, li, span, font, [style]') && ligneCourante() === li(2);
          coller('word', '<b style="font-size:30px">word</b>');
          res.collageUneLigne = li(2).innerHTML === '# not a headingword';
          annulerNotes();
          annulerNotes();
          res.annuler = nl() === 3 && li(0).textContent === 'First block';
          retablirNotes();
          res.retablir = nl() === 5 && li(1).textContent === '- not a bullet';
          /* Tidying up after a change made by the browser */
          li(1).insertAdjacentHTML('beforeend', '<span style="font-size:24px">x</span>');
          doc.appendChild(document.createTextNode('orphan'));
          doc.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
          res.normalisation = !doc.querySelector('span:not(.ligne-outils), [style]') && Array.prototype.every.call(doc.childNodes, function (n) { return n.nodeType === 1 && n.classList.contains('ligne'); }) && li(1).textContent === '- not a bulletx' && doc.lastChild.textContent === 'orphan';
          /* Move a line up, separator */
          placerCaret(li(1), true);
          ev(doc, 'keydown', { key: 'ArrowUp', altKey: true, shiftKey: true });
          res.monterLigne = li(0).textContent === '- not a bulletx' && li(1).textContent === 'First blockLine A';
          var avantSep = nl();
          placerCaret(li(0), false);
          insererSeparateur();
          res.separateur = nl() === avantSep + 1 && li(1).dataset.type === 'separateur' && li(1).getAttribute('contenteditable') === 'false';
          serialiserDoc();
          var html = '<div>a<b>b</b><span style="color:red">c</span><script>x</script></div>';
          res.nettoyage = nettoyerHtml(html) === 'a<b>b</b>c';
          var pt = new DataTransfer();
          pt.setData('text/plain', 'Title\\npasted');
          pt.setData('text/html', '<h1 style="color:red">Title</h1>');
          placerCaret(titre, false);
          titre.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: pt }));
          res.titreCollageBrut = titre.innerHTML === 'Test pageTitle pasted';
          NOTES_RECHERCHE = 'not a bullet';
          rendreRailNotes();
          res.rechercheContenu = !!document.querySelector('#ntArbre .nt-item[data-id="' + idTest + '"] .nt-extrait');
          NOTES_RECHERCHE = '';
          rendreRailNotes();
          /* --- Liquid Glass bubble: placed on the displayed page --- */
          afficherPage('journal');
          poserBulles();
          var bulle = document.querySelector('.tabs > .bulle'), bJournal = document.querySelector('.tab-btn[data-tab="releve"]');
          res.bulleNavigation = !!bulle && bulle.style.transform.replace(/\\s/g, '') === 'translate(' + bJournal.offsetLeft + 'px,' + bJournal.offsetTop + 'px)' && bulle.style.width === bJournal.offsetWidth + 'px';
          /* --- Tasks: advance and finish --- */
          afficherPage('taches');
          var t = taches().filter(function (x) { return x.statut === 'en-cours'; })[0];
          if (t) { avancerTache(t.id); res.tacheFaite = t.statut === 'fait' && t.faitLe === aujourdhui(); }
          /* --- Statement: work items of the month --- */
          afficherPage('releve');
          res.travauxReleve = travauxDuMois(moisCourant()).length >= 1;
          /* --- Deadlines --- */
          var ech = echeances()[0];
          marquerEcheanceFaite(ech.id, true);
          res.echeanceFaite = ech.fait === true;
          marquerEcheanceFaite(ech.id, false);
          /* --- Cleanup --- */
          ETAT.notes.pages = pagesNotes().filter(function (x) { return x.id !== idTest; });
          sauver('notes');
          ETAT.echeances.echeances = echeances().filter(function (x) { return x.id !== 'ech_test' && x.id !== 'ech_test2'; });
          sauver('echeances');
          afficherPage('tableau');
        } catch (err) { res.erreur = String(err && err.stack || err); }
        return JSON.stringify(res);
      })()`);
      process.stdout.write('SABLIER_SMOKE_SCENARIO ' + scenario + '\n');
      try {
        const res = JSON.parse(scenario);
        const existe = res.pieceFichierChemin ? fs.existsSync(path.join(dossierPieces(), res.pieceFichierChemin)) : false;
        process.stdout.write('SABLIER_SMOKE_PIECE_FICHIER ' + existe + '\n');
      } catch (e) {}
    }
    /* Audit scenario (tests/scenario-audit.js), edge cases. */
    if (process.env.SABLIER_SMOKE_AUDIT === '1') {
      const corps = fs.readFileSync(path.join(__dirname, '..', 'tests', 'scenario-audit.js'), 'utf8');
      const audit = await fenetre.webContents.executeJavaScript('(async function () { var res = {}; try {\n' + corps + '\n} catch (err) { res.erreur = String(err && err.stack || err); } return JSON.stringify(res); })()');
      process.stdout.write('SABLIER_SMOKE_AUDIT ' + audit + '\n');
    }
    if (process.env.SABLIER_SMOKE_PDF === '1') {
      const htmlReleve = await fenetre.webContents.executeJavaScript(`(function () {
        var mois = '${process.env.SABLIER_SMOKE_MOIS || ''}' || entreesJournal().map(function (e) { return moisFacturationDe(e); }).sort().pop() || moisCourant();
        var meta = moisMeta(mois);
        var r = releveDuMois(entreesJournal(), mois, ETAT.reglages, meta.frais);
        var f = factureDuMois(mois);
        return htmlReleve(r, { travaux: travauxDuMois(mois), numeroFacture: f ? f.numero : null });
      })()`);
      const r1 = await rendrePdf(htmlReleve, path.join(dossierCaptures, 'sablier-releve.pdf'));
      process.stdout.write('SABLIER_SMOKE_PDF releve ' + JSON.stringify(r1) + '\n');
      const htmlFacture = await fenetre.webContents.executeJavaScript(`(function () {
        var liste = factures();
        return liste.length ? htmlFacture(liste[liste.length - 1]) : '';
      })()`);
      if (htmlFacture) {
        const r2 = await rendrePdf(htmlFacture, path.join(dossierCaptures, 'sablier-facture.pdf'));
        const r3 = await rendrePdf(htmlFacture, path.join(dossierCaptures, 'sablier-facture-p2.pdf'), { pageRanges: '2' });
        process.stdout.write('SABLIER_SMOKE_PDF facture ' + JSON.stringify(r2) + ' ' + JSON.stringify(r3) + '\n');
      }
    }
    process.stdout.write('SABLIER_SMOKE_OK captures in ' + dossierCaptures + '\n');
  } catch (e) {
    process.stdout.write('SABLIER_SMOKE_ERREUR ' + (e && e.message) + '\n');
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}

/* Nothing starts in a second instance: it asked to quit. */
if (verrou) {
  app.whenReady().then(() => {
    /* Forced appearance for the self-test screenshots (light or dark). */
    if (MODE_SMOKE && /^(light|dark)$/.test(process.env.SABLIER_THEME || '')) nativeTheme.themeSource = process.env.SABLIER_THEME;
    chargerPreferences();
    installerPont();
    installerProtocolePieces();
    creerMenu();
    creerFenetre();
    if (MODE_SMOKE) {
      fenetre.webContents.once('did-finish-load', () => { autoTest(); });
      fenetre.webContents.on('console-message', (ev, niveau, message) => {
        const lvl = ev && ev.level !== undefined ? ev.level : niveau;
        const msg = ev && ev.message !== undefined ? ev.message : message;
        if (lvl === 'error' || lvl === 'warning' || lvl >= 2) process.stdout.write('SABLIER_CONSOLE ' + String(msg).split('\n')[0] + '\n');
      });
    }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) creerFenetre(); });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || MODE_SMOKE) app.quit();
  });

  /* Pending writes go to disk before quitting; if the disk still refuses
     them, they are not lost silently. */
  app.on('before-quit', (ev) => {
    if (!donnees) return;
    donnees.purger();
    const refuses = Object.keys(donnees.minuteries);
    if (!refuses.length) return;
    const choix = dialog.showMessageBoxSync({
      type: 'warning', buttons: ['Stay in Sablier', 'Quit anyway'], defaultId: 0, cancelId: 0,
      message: 'Some data is not saved',
      detail: refuses.map(nom => nom + '.json').join(', ') + ': the disk refuses the write. If you quit now, the latest changes will be lost. Free up some space or export a backup, then try again.',
    });
    if (choix === 0) ev.preventDefault();
  });
  app.on('will-quit', () => { if (donnees) donnees.purger(); });
}
