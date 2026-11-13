/* ============================================================
   Sablier : application macOS (Electron)
   Process principal : fenêtre, menus, données en fichiers, PDF,
   pièces jointes des tâches, notifications et pastille du Dock.

   Variables d'environnement utiles :
     SABLIER_DONNEES=<dossier>  emplacement des données (tests), profil
                                Electron dans <dossier>-electron
     SABLIER_SMOKE=1            auto-test : fenêtre cachée, captures des
                                pages dans SABLIER_CAPTURES (ou /tmp), quitte ;
                                refusé sans SABLIER_DONNEES jetable
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

/* L'auto-test écrit des données d'essai : jamais dans les vraies. */
if (MODE_SMOKE && (!process.env.SABLIER_DONNEES || path.resolve(process.env.SABLIER_DONNEES) === path.join(app.getPath('appData'), 'Sablier', 'Donnees'))) {
  process.stderr.write('Auto-test refusé : SABLIER_SMOKE exige SABLIER_DONNEES=<dossier jetable>.\n');
  process.exit(1);
}

app.setName('Sablier');
/* Avec SABLIER_DONNEES (tests), le profil Electron va à côté du dossier de
   données : l'auto-test tourne même quand Sablier est ouvert. */
app.setPath('userData', process.env.SABLIER_DONNEES ? path.resolve(process.env.SABLIER_DONNEES) + '-electron' : path.join(app.getPath('appData'), 'Sablier'));

/* Les images jointes aux tâches sont servies par un protocole interne,
   limité au dossier Pieces des données. */
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
    /* Verre du système derrière la barre latérale et autour de la scène ;
       les captures de l'auto-test (fenêtre cachée) ne le voient pas, elles
       gardent le fond de la page. */
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
  /* Un fichier déposé hors d'une zone prévue, ou un lien, ne doit jamais
     remplacer l'interface par une navigation. */
  fenetre.webContents.on('will-navigate', (ev) => { ev.preventDefault(); });
  fenetre.on('closed', () => { fenetre = null; });
}

/* Montre la fenêtre (la recrée au besoin) puis exécute « apres » quand
   l'interface est prête à recevoir une commande. */
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
    ['Tableau de bord', 'tableau', '1'], ['Journal et relevé', 'releve', '2'], ['Factures et recettes', 'factures', '3'],
    ['Tâches', 'taches', '4'], ['Notes', 'notes', '5'], ['Échéances', 'echeances', '6'], ['Réglages', 'reglages', '7'], ['Mode d\'emploi', 'guide', '8'],
  ];
  const modele = [
    {
      label: 'Sablier',
      submenu: [
        { label: 'À propos de Sablier', role: 'about' },
        { type: 'separator' },
        { label: 'Réglages…', accelerator: 'CommandOrControl+,', click: () => envoyerCommande('page:reglages') },
        { label: 'Ouvrir le dossier de données', click: () => { shell.openPath(donnees.dossier); } },
        { label: 'Exporter une sauvegarde…', click: () => envoyerCommande('exporter') },
        { label: 'Importer une sauvegarde…', click: () => envoyerCommande('importer') },
        { type: 'separator' },
        { label: 'Masquer Sablier', role: 'hide' },
        { label: 'Masquer les autres', role: 'hideOthers' },
        { label: 'Tout afficher', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quitter Sablier', role: 'quit' },
      ],
    },
    {
      label: 'Fichier',
      submenu: [
        { label: 'Nouvelle ligne de journal', accelerator: 'CommandOrControl+N', click: () => envoyerCommande('nouvelle-saisie') },
        { label: 'Démarrer ou arrêter le chrono', accelerator: 'CommandOrControl+Shift+T', click: () => envoyerCommande('chrono') },
        { label: 'Mettre en pause ou reprendre le chrono', accelerator: 'CommandOrControl+Alt+T', click: () => envoyerCommande('pause-chrono') },
        { type: 'separator' },
        { label: 'Nouvelle tâche', accelerator: 'CommandOrControl+Shift+N', click: () => envoyerCommande('nouvelle-tache') },
        { label: 'Nouvelle page de notes', accelerator: 'CommandOrControl+Shift+P', click: () => envoyerCommande('nouvelle-page') },
        { label: 'Rappels…', accelerator: 'CommandOrControl+Shift+R', click: () => envoyerCommande('rappels') },
        { type: 'separator' },
        { label: 'Fermer', role: 'close' },
      ],
    },
    {
      label: 'Édition',
      submenu: [
        /* L'éditeur de notes tient son propre historique : la page décide. */
        { label: 'Annuler', accelerator: 'CommandOrControl+Z', click: () => envoyerCommande('annuler') },
        { label: 'Rétablir', accelerator: 'Shift+CommandOrControl+Z', click: () => envoyerCommande('retablir') },
        { type: 'separator' },
        { label: 'Couper', role: 'cut' },
        { label: 'Copier', role: 'copy' },
        { label: 'Coller', role: 'paste' },
        { label: 'Tout sélectionner', role: 'selectAll' },
      ],
    },
    {
      label: 'Affichage',
      submenu: pages.map(p => ({ label: p[0], accelerator: 'CommandOrControl+' + p[2], click: () => envoyerCommande('page:' + p[1]) })).concat([
        { type: 'separator' },
        { label: 'Recharger', role: 'reload' },
        { label: 'Taille réelle', role: 'resetZoom' },
        { label: 'Agrandir', role: 'zoomIn' },
        { label: 'Réduire', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Plein écran', role: 'togglefullscreen' },
        { label: 'Outils de développement', role: 'toggleDevTools' },
      ]),
    },
    {
      label: 'Fenêtre',
      submenu: [
        { label: 'Réduire', role: 'minimize' },
        { label: 'Zoom', role: 'zoom' },
        { type: 'separator' },
        { label: 'Tout ramener au premier plan', role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(modele));
}

/* ============================================================
   PIÈCES JOINTES : Donnees/Pieces/<tâche>/<fichier>
   ============================================================ */
function nettoyerSegment(s) { return String(s || '').replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '_').slice(0, 80) || 'piece'; }
/* Nom de fichier sûr : pas de séparateur, l'extension conservée, au plus
   200 octets (limite du système de fichiers à 255). */
function nettoyerNomFichier(s) {
  const nom = String(s || 'fichier').replace(/[\/\\:\x00-\x1f]/g, '_').replace(/^\.+/, '_');
  const ext = path.extname(nom).slice(0, 16);
  let base = path.basename(nom, ext) || 'fichier';
  while (Buffer.byteLength(base + ext, 'utf8') > 200 && base.length > 1) base = base.slice(0, -1);
  return (base + ext) || 'fichier';
}
function dossierPieces() { return path.join(donnees.dossier, 'Pieces'); }
/* Chemin absolu d'une pièce, refusé s'il sort du dossier Pieces. */
function cheminPiece(relatif) {
  const racine = dossierPieces();
  const cible = path.resolve(racine, String(relatif || ''));
  if (cible !== racine && !cible.startsWith(racine + path.sep)) return null;
  return cible;
}
/* Formats que Chromium sait afficher en vignette (HEIC, TIFF : non). */
const EXT_IMAGES = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

async function copierPieces(tacheId, chemins) {
  const dossier = path.join(dossierPieces(), nettoyerSegment(tacheId));
  await fs.promises.mkdir(dossier, { recursive: true });
  const pieces = [], erreurs = [];
  for (const src of chemins) {
    try {
      const st = await fs.promises.stat(src);
      if (!st.isFile()) { erreurs.push(path.basename(src) + ' : pas un fichier'); continue; }
      const nom = nettoyerNomFichier(path.basename(src));
      const ext = path.extname(nom);
      const base = path.basename(nom, ext);
      let cible = path.join(dossier, nom);
      let i = 1;
      while (fs.existsSync(cible)) cible = path.join(dossier, base + '-' + (++i) + ext);
      await fs.promises.copyFile(src, cible);
      pieces.push({ nom: path.basename(cible), fichier: nettoyerSegment(tacheId) + '/' + path.basename(cible), taille: st.size, image: EXT_IMAGES.test(cible) });
    } catch (e) { erreurs.push(path.basename(src) + ' : ' + e.message); }
  }
  return { ok: true, pieces, erreurs };
}

/* Les chemins que l'interface peut demander à ouvrir ou révéler : ceux
   que l'application a elle-même produits (PDF, exports). */
const cheminsOuvrables = new Set();

/* ============================================================
   PONT NATIF
   ============================================================ */
function installerPont() {
  const dossier = process.env.SABLIER_DONNEES || path.join(app.getPath('userData'), 'Donnees');
  donnees = new Donnees(dossier);
  donnees.sauvegardeQuotidienne();
  /* L'application reste ouverte des semaines : la copie du jour ne dépend pas d'un lancement. */
  setInterval(() => { donnees.purger(); donnees.sauvegardeQuotidienne(); }, 3600000);

  ipcMain.on('donnees:charger', (ev) => {
    ev.returnValue = donnees.lireTout();
    if ((donnees.illisibles.length || donnees.absents.length) && !MODE_SMOKE) {
      const liste = donnees.illisibles.map(x => x.nom + '.json (conservé sous ' + path.basename(x.copie) + ')').concat(donnees.absents.map(nom => nom + '.json (absent)')).join('\n');
      setTimeout(() => {
        dialog.showMessageBox(fenetre, {
          type: 'warning', buttons: ['Ouvrir le dossier de données', 'Continuer'], defaultId: 1,
          message: 'Un fichier de données manque ou n\'a pas pu être lu',
          detail: liste + '\n\nUn fichier abîmé est mis de côté et l\'application repart avec des valeurs de départ pour cette partie : sans factures.json, la numérotation repartirait à 01. Une copie datée de chaque jour se trouve dans le sous-dossier Sauvegardes : vous pouvez y reprendre la dernière version saine.',
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
      title: 'Exporter une sauvegarde',
      defaultPath: path.join(app.getPath('documents'), nomFichier || 'Sablier-sauvegarde.json'),
      filters: [{ name: 'Sauvegarde Sablier', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, annule: true };
    try { fs.writeFileSync(filePath, JSON.stringify(paquet, null, 2) + '\n', 'utf8'); cheminsOuvrables.add(filePath); return { ok: true, chemin: filePath }; }
    catch (e) { return { ok: false, message: e.message }; }
  });
  ipcMain.handle('donnees:importer', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(fenetre, {
      title: 'Importer une sauvegarde',
      properties: ['openFile'],
      filters: [{ name: 'Sauvegarde Sablier', extensions: ['json'] }],
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

  /* Facture et relevé rangés d'office dans le dossier des factures (Réglages),
     sous-dossier du mois : le premier qui commence par « AAAA-MM », sinon créé. */
  ipcMain.handle('pdf:classer', async (ev, html, base, mois, nomDossier, nomFichier) => {
    base = String(base || '');
    if (!path.isAbsolute(base) || !fs.existsSync(base) || !/^\d{4}-\d{2}$/.test(String(mois))) return { ok: false, message: 'dossier des factures introuvable, à choisir dans les Réglages' };
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
      title: 'Dossier des factures',
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
      title: 'Enregistrer',
      defaultPath: path.join(app.getPath('documents'), nomFichier || 'export.txt'),
    });
    if (canceled || !filePath) return { ok: false, annule: true };
    try { fs.writeFileSync(filePath, String(contenu), 'utf8'); cheminsOuvrables.add(filePath); return { ok: true, chemin: filePath }; }
    catch (e) { return { ok: false, message: e.message }; }
  });

  /* Pièces jointes */
  ipcMain.handle('pieces:ajouter', async (ev, tacheId, chemins) => {
    let liste = Array.isArray(chemins) ? chemins.filter(Boolean) : [];
    if (!liste.length) {
      const { canceled, filePaths } = await dialog.showOpenDialog(fenetre, { title: 'Joindre des fichiers à la tâche', properties: ['openFile', 'multiSelections'] });
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

  /* Rappels : notification du Mac et pastille du Dock */
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
   AUTO-TEST (SABLIER_SMOKE=1)
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
      /* Un fichier texte et une image d'un pixel, à joindre à une tâche. */
      const fichierTest = path.join(os.tmpdir(), 'sablier-piece-test.txt');
      fs.writeFileSync(fichierTest, 'pièce jointe de test\n', 'utf8');
      const imageTest = path.join(os.tmpdir(), 'sablier-pixel.png');
      fs.writeFileSync(imageTest, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
      const scenario = await fenetre.webContents.executeJavaScript(`(async function () {
        var res = {};
        function ev(el, type, opts) { el.dispatchEvent(type === 'input' ? new Event('input', { bubbles: true }) : new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, opts))); }
        try {
          /* --- Chrono : arrêt puis redémarrage --- */
          if (!chronoEnCours()) demarrerChrono({ axe: 'projeta', intervention: 'Chrono de départ', detail: '' });
          var avant = entreesJournal().length;
          var e = arreterChrono(true);
          res.chronoArret = !!e && entreesJournal().length === avant + 1 && e.minutes >= 1;
          demarrerChrono({ axe: 'suivi', intervention: 'Test du chrono', detail: '' });
          res.chronoDemarre = !!chronoEnCours() && chronoEnCours().intervention === 'Test du chrono';
          arreterChrono(true);
          res.chronoCourtEnregistre = !chronoEnCours() && entreesJournal().length === avant + 2 && entreesJournal()[avant + 1].minutes === 1;
          /* --- Journal et relevé : la journée du chrono se déplie sur ses lignes --- */
          RELEVE_JOURS = {};
          afficherPage('journal');
          var jourChrono = document.querySelector('#releveContenu .rl-jour[data-jour="' + e.date + '"]');
          if (jourChrono) jourChrono.click();
          res.journeeDepliee = !!jourChrono && !!document.querySelector('#releveContenu .rl-detail .jr-ligne[data-id="' + e.id + '"]');
          res.sansBoutonExport = !document.querySelector('#releveContenu [data-action="pdf-releve"]');
          /* --- Boutons des cartes et des échéances (identifiants) --- */
          afficherPage('taches');
          var boutons = Array.prototype.slice.call(document.querySelectorAll('.kb-carte .btn-icone[data-action]'));
          res.cartesAvecId = boutons.length > 0 && boutons.every(function (b) { return !!b.dataset.id; });
          res.troisColonnes = document.querySelectorAll('.kb-colonne').length === 3 && !document.querySelector('.kb-colonne[data-statut="idee"]');
          afficherPage('echeances');
          var be = Array.prototype.slice.call(document.querySelectorAll('.ec-actions .btn-icone[data-action]'));
          res.echeancesAvecId = be.length > 0 && be.every(function (b) { return !!b.dataset.id; });
          /* --- Chrono depuis une carte, bandeau, pause, reprise, arrêt --- */
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
          /* --- Priorités, tri automatique des cartes --- */
          var refJ = aujourdhui();
          var creerTest = function (titre, prio, jours) {
            var tt = normaliserTache({ id: uid('tt'), statut: 'a-faire', axe: 'projeta', titre: titre, description: '', priorite: prio, echeance: jours == null ? null : ajouterJours(refJ, jours), ordre: 999, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), faitLe: null });
            taches().push(tt); return tt;
          };
          var tUrgent = creerTest('Test urgent (basse, 2 jours)', 'basse', 2);
          var tHaute = creerTest('Test haute manuelle (40 jours)', 'haute', 40);
          var tMoyen = creerTest('Test auto (10 jours)', 'auto', 10);
          var tLoin = creerTest('Test auto (30 jours)', 'auto', 30);
          sauver('chantiers');
          afficherPage('taches');
          var ordreDom = Array.prototype.map.call(document.querySelectorAll('.kb-colonne[data-statut="a-faire"] .kb-carte'), function (c) { return c.dataset.id; });
          var posDe = function (tt) { return ordreDom.indexOf(tt.id); };
          res.triPriorites = posDe(tUrgent) === 0 && posDe(tHaute) === 1 && posDe(tMoyen) === 2 && posDe(tLoin) === 3 && ordreDom.length > 4;
          res.prioriteRelevee = prioriteEffective(tUrgent, refJ).niveau === 'haute' && prioriteEffective(tUrgent, refJ).origine === 'echeance' && prioriteEffective(tHaute, refJ).niveau === 'haute' && prioriteEffective(tMoyen, refJ).niveau === 'moyenne' && prioriteEffective(tLoin, refJ).niveau === 'basse';
          res.pastilleHaute = !!document.querySelector('.kb-carte[data-id="' + tUrgent.id + '"] .kb-priorite.haute') && !!document.querySelector('.kb-carte[data-id="' + tMoyen.id + '"] .kb-priorite.moyenne');
          res.puceCouleur = !!document.querySelector('.kb-carte .puce-axe .axe-point') && !document.querySelector('.puce-axe .code');
          /* --- Glisser-déposer au pointeur vers « En cours » --- */
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
          /* clic simple sur une carte : la fiche s'ouvre */
          var carteClic = document.querySelector('.kb-carte[data-id="' + tHaute.id + '"]');
          var rc = carteClic.getBoundingClientRect();
          pe('pointerdown', rc.left + 20, rc.top + 12, carteClic);
          pe('pointerup', rc.left + 21, rc.top + 12, carteClic);
          res.clicOuvreFiche = modaleOuverte() && document.querySelector('#tcTitre').value === tHaute.titre;
          fermerModale();
          ETAT.chantiers.taches = taches().filter(function (tt) { return [tUrgent.id, tHaute.id, tMoyen.id, tLoin.id].indexOf(tt.id) < 0; });
          sauver('chantiers');
          afficherPage('taches');
          /* --- Modifier une carte depuis son bouton --- */
          document.querySelector('.kb-carte .btn-icone[data-action=modifier]').click();
          res.modaleCarte = modaleOuverte() && !!document.querySelector('#tcTitre');
          fermerModale();
          /* --- Migration des idées vers les notes --- */
          taches().push({ id: 'idee_test', statut: 'idee', axe: 'gouvernance', titre: 'Idée de test', description: 'Un détail', interet: 'fort', effort: 'petit', prerequis: 'rien', priorite: 'auto', echeance: null, ordre: 999, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), faitLe: null });
          var nbAvant = pageIdees().blocs.length;
          var nbMigre = migrerIdeesVersNotes();
          sauver('chantiers'); sauver('notes');
          var blocMigre = pageIdees().blocs[nbAvant];
          res.migrationIdees = nbMigre === 1 && pageIdees().blocs.length === nbAvant + 1 && !taches().some(function (x) { return x.statut === 'idee'; }) && blocMigre.type === 'idee' && blocMigre.html.indexOf('<b>Idée de test</b>') === 0 && blocMigre.html.indexOf('Intérêt : fort') > 0;
          res.ideesDefautDansNotes = pageIdees().blocs.filter(function (b) { return b.type === 'idee'; }).length >= 4;
          /* --- Idée → tâche --- */
          afficherPage('notes');
          ouvrirPageNotes('page_idees');
          var lignesIdee = document.querySelectorAll('#ntDoc .ligne-idee');
          var ligneIdee = lignesIdee[lignesIdee.length - 1];
          res.blocIdeeRendu = !!ligneIdee && !!ligneIdee.querySelector('[data-bloc-action=tache]');
          var nbT = taches().length;
          var nouvelle = creerTacheDepuisLigne(ligneIdee);
          res.conversionIdee = !!nouvelle && taches().length === nbT + 1 && nouvelle.titre === 'Idée de test' && nouvelle.statut === 'a-faire' && nouvelle.description.indexOf('Un détail') === 0 && nouvelle.notes.indexOf('page_idees') >= 0
            && !!document.querySelector('#ntDoc .ligne[data-tache="' + nouvelle.id + '"] [data-bloc-action=ouvrir-tache]') && pageParId('page_idees').blocs.some(function (b) { return b.tache === nouvelle.id; });
          res.tachesLieesStrip = !!document.querySelector('#ntTaches .chip-tache[data-id="' + nouvelle.id + '"]');
          /* --- Fiche complète : étapes, pièces, notes, avancement, temps --- */
          afficherPage('taches');
          ouvrirEditionTache(nouvelle.id);
          res.ficheSections = ['etapes', 'pieces', 'notes', 'avancement', 'temps'].every(function (s) { return !!document.querySelector('.fiche-section[data-section="' + s + '"]'); });
          ajouterEtapeTache(nouvelle, 'Première étape');
          ajouterEtapeTache(nouvelle, 'Seconde étape');
          basculerEtapeTache(nouvelle, nouvelle.etapes[0].id, true);
          res.etapes = nouvelle.etapes.length === 2 && nouvelle.etapes[0].fait === true && document.querySelector('.fiche-section[data-section="etapes"] .nb').textContent === '1/2' && document.querySelectorAll('.fiche-section[data-section="etapes"] .etape').length === 2;
          ajouterPieceCode(nouvelle, { nom: 'exemple.js', langage: 'javascript', contenu: 'console.log(1)' });
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
          ajouterAvancementTache(nouvelle, 'Premier point d\\'avancement');
          res.avancement = nouvelle.avancement.length === 1 && !!document.querySelector('.fiche-section[data-section="avancement"] .avancement-entree');
          demarrerChrono({ axe: nouvelle.axe, intervention: nouvelle.titre, tache: nouvelle.id });
          arreterChrono(true);
          fermerModale();
          ouvrirEditionTache(nouvelle.id);
          res.tempsTache = minutesTache(entreesJournal(), nouvelle.id).minutes === 1 && document.querySelector('.fiche-section[data-section="temps"] .temps-resume b').textContent === '1 min';
          fermerModale();
          res.carteCompteurs = !!document.querySelector('.kb-carte[data-id="' + nouvelle.id + '"] .kb-compteurs') && !!document.querySelector('.kb-carte[data-id="' + nouvelle.id + '"] .kb-progres');
          /* --- Rappels --- */
          echeances().push({ id: 'ech_test', date: ajouterJours(aujourdhui(), -2), titre: 'Échéance de test dépassée', detail: '', type: 'perso', fait: false, faitLe: null, creeLe: new Date().toISOString() });
          echeances().push({ id: 'ech_test2', date: ajouterJours(aujourdhui(), 5), titre: 'Échéance de test à 5 jours', detail: '', type: 'perso', rappelJours: 3, fait: false, faitLe: null, creeLe: new Date().toISOString() });
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
          res.echeancesTableau = !!document.querySelector('#tbEcheances .dash-ech .dash-cal b') && !!document.querySelector('#tbEcheances .dash-jours') && !/dans \\d+ jour/.test(document.getElementById('tbEcheances').textContent);
          res.tachesTableau = !!document.querySelector('#tbTaches .dash-tache[data-id="' + nouvelle.id + '"] .dash-jours');
          /* --- Factures et recettes : un onglet à part, sans bascule dans le relevé --- */
          document.querySelector('.tab-btn[data-tab="factures"]').click();
          res.vueFactures = PAGE_COURANTE === 'factures' && !!document.querySelector('#facturesContenu #facturesTableau') && !document.querySelector('#rlVues');
          document.querySelector('.tab-btn[data-tab="releve"]').click();
          res.vueReleve = PAGE_COURANTE === 'releve' && !!document.querySelector('#rlMois') && !document.querySelector('#releveContenu .segment');
          /* --- Gabarit de facture : en-tête épuré, bloc Règlement, mentions --- */
          var sauveP = JSON.stringify(ETAT.reglages.prestataire);
          ETAT.reglages.prestataire.iban = 'FR7612345678901234567890123'; ETAT.reglages.prestataire.bic = 'BANKFRPPXXX'; ETAT.reglages.prestataire.email = 'test@example.org'; ETAT.reglages.prestataire.telephone = '0612345678'; ETAT.reglages.prestataire.adresse = '12 rue des Essais, 75000 Paris';
          var rel = releveDuMois(entreesJournal(), moisCourant(), ETAT.reglages, 0);
          var fx = construireFacture(rel, ETAT.reglages, { numero: '2099-01', dateEmission: aujourdhui(), travaux: [], factures: [] });
          var hf = htmlFacture(fx);
          res.factureEpuree = hf.indexOf('APE') < 0 && hf.indexOf('SIRET 123 456 789 00015') > 0 && hf.indexOf('L. 441-10 du Code de commerce') > 0 && hf.indexOf('06 12 34 56 78') > 0 && hf.indexOf('<div>12 rue des Essais</div><div>75000 Paris</div>') > 0;
          res.factureReglement = hf.indexOf('class="rib"') > 0 && hf.indexOf('FR76 1234 5678 9012 3456 7890 123') > 0 && hf.indexOf('EI Nom Prénom') > 0 && hf.indexOf('Banque Exemple') > 0 && hf.indexOf('Escompte pour paiement anticipé : néant') > 0 && hf.indexOf('indemnité forfaitaire de 40') > 0 && hf.indexOf('Total TTC à payer') > 0 && hf.indexOf(ETAT.reglages.prestataire.nom + ' EI</div>') > 0;
          /* La facture ne dit pas quand le travail a été réalisé : ni colonne
             Date, ni mention « Réalisé en », ni date du jour dans l'annexe. */
          res.factureSansDate = hf.indexOf('<th class="num">Date</th>') < 0 && hf.indexOf('Réalisé en') < 0 && !/\\d{2}\\/\\d{2}\\/\\d{4}<\\/td>/.test(hf.split('class="annexe"')[1] || '') && hf.indexOf('Annexe à la facture n° 2099-01') > 0;
          ETAT.reglages.prestataire = JSON.parse(sauveP);
          res.releveEpure = htmlReleve(rel, {}).indexOf('APE') < 0;
          /* --- Éditeur de notes : une seule zone, une ligne par retour à la ligne --- */
          afficherPage('notes');
          creerPageNotes(null);
          var idTest = NOTES_PAGE;
          var titre = document.getElementById('ntTitre');
          titre.textContent = 'Page de test';
          ev(titre, 'input');
          res.titre = pageParId(NOTES_PAGE).titre === 'Page de test';
          var doc = docNotes();
          var nl = function () { return doc.querySelectorAll(':scope > .ligne').length; };
          var li = function (i) { return doc.querySelectorAll(':scope > .ligne')[i]; };
          var taper = function (t) { document.execCommand('insertText', false, t); };
          res.zoneUnique = doc.isContentEditable && !doc.querySelector('[contenteditable="true"]') && !document.querySelector('.bloc-poignee');
          placerCaret(li(0), false);
          taper('Premier bloc');
          ev(doc, 'keydown', { key: 'Enter' });
          res.enterCreeBloc = nl() === 2 && li(0).textContent === 'Premier bloc' && ligneCourante() === li(1) && document.activeElement === doc;
          taper('- ');
          res.raccourciPuce = li(1).dataset.type === 'puce' && li(1).textContent === '';
          taper('Élément');
          ev(doc, 'keydown', { key: 'Enter' });
          res.enterPuceSuivante = nl() === 3 && li(2).dataset.type === 'puce';
          ev(doc, 'keydown', { key: 'Enter' });
          res.puceVideDevientP = nl() === 3 && li(2).dataset.type === 'p';
          taper('/');
          res.menuSlashOuvert = !!document.getElementById('menuSlash');
          taper('idée');
          res.menuSlashIdee = document.querySelectorAll('#menuSlash button').length === 1;
          ev(doc, 'keydown', { key: 'Enter' });
          res.slashIdee = li(2).dataset.type === 'idee' && !document.getElementById('menuSlash') && !!li(2).querySelector('[data-bloc-action=tache]') && li(2).textContent === '';
          taper('Une idée tapée');
          ev(doc, 'keydown', { key: 'Enter' });
          taper('le détail');
          res.ideeSurDeuxLignes = nl() === 3 && texteBrutDe(nettoyerHtml(li(2).innerHTML)) === 'Une idée tapée\\nle détail';
          ev(doc, 'keydown', { key: 'Enter' });
          ev(doc, 'keydown', { key: 'Enter' });
          res.ideeDoubleEntreeSort = nl() === 4 && li(3).dataset.type === 'p' && nettoyerHtml(li(2).innerHTML) === 'Une idée tapée<br>le détail';
          ev(doc, 'keydown', { key: 'Backspace' });
          res.backspaceLigneVide = nl() === 3;
          li(2).innerHTML = 'Une idée tapée';
          decorerLigne(li(2));
          placerCaret(li(2), true);
          ev(doc, 'keydown', { key: 'Backspace' });
          res.backspaceIdeeDevientP = li(2).dataset.type === 'p' && li(2).textContent === 'Une idée tapée';
          placerCaret(li(2), true);
          ev(doc, 'keydown', { key: 'Backspace' });
          res.backspaceFusionne = nl() === 2 && li(1).textContent === 'ÉlémentUne idée tapée';
          placerCaret(li(1), false);
          ev(doc, 'keydown', { key: 'Enter' });
          taper('[] ');
          res.raccourciCase = li(2).dataset.type === 'case';
          taper('À cocher');
          var rc = li(2).getBoundingClientRect();
          li(2).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: rc.left + 9, clientY: rc.top + 12 }));
          res.caseCochee = li(2).classList.contains('coche');
          ev(doc, 'keydown', { key: 'Tab' });
          res.tabRetrait = li(2).dataset.retrait === '1';
          serialiserDoc();
          var p = pageParId(idTest);
          res.serialise = p.blocs.length === 3 && p.blocs[0].html === 'Premier bloc' && p.blocs[1].type === 'puce' && p.blocs[2].type === 'case' && p.blocs[2].coche === true && p.blocs[2].retrait === 1;
          /* Coller : toujours du texte normal, même depuis une page web ou du Markdown */
          var coller = function (texte, html) {
            var dt = new DataTransfer();
            dt.setData('text/plain', texte);
            if (html) dt.setData('text/html', html);
            doc.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
          };
          placerCaret(li(0), false);
          coller('Ligne A\\n- pas une puce\\n# pas un titre', '<h1 style="color:red">Ligne A</h1><ul><li>pas une puce</li></ul><h1>pas un titre</h1>');
          res.collageBrut = nl() === 5 && li(0).textContent === 'Premier blocLigne A' && li(1).dataset.type === 'p' && li(1).textContent === '- pas une puce' && li(2).dataset.type === 'p' && li(2).textContent === '# pas un titre'
            && !doc.querySelector('h1, ul, li, span, font, [style]') && ligneCourante() === li(2);
          coller('mot', '<b style="font-size:30px">mot</b>');
          res.collageUneLigne = li(2).innerHTML === '# pas un titremot';
          annulerNotes();
          annulerNotes();
          res.annuler = nl() === 3 && li(0).textContent === 'Premier bloc';
          retablirNotes();
          res.retablir = nl() === 5 && li(1).textContent === '- pas une puce';
          /* Remise en ordre après une modification faite par le navigateur */
          li(1).insertAdjacentHTML('beforeend', '<span style="font-size:24px">x</span>');
          doc.appendChild(document.createTextNode('orphelin'));
          doc.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
          res.normalisation = !doc.querySelector('span:not(.ligne-outils), [style]') && Array.prototype.every.call(doc.childNodes, function (n) { return n.nodeType === 1 && n.classList.contains('ligne'); }) && li(1).textContent === '- pas une pucex' && doc.lastChild.textContent === 'orphelin';
          /* Monter une ligne, séparateur */
          placerCaret(li(1), true);
          ev(doc, 'keydown', { key: 'ArrowUp', altKey: true, shiftKey: true });
          res.monterLigne = li(0).textContent === '- pas une pucex' && li(1).textContent === 'Premier blocLigne A';
          var avantSep = nl();
          placerCaret(li(0), false);
          insererSeparateur();
          res.separateur = nl() === avantSep + 1 && li(1).dataset.type === 'separateur' && li(1).getAttribute('contenteditable') === 'false';
          serialiserDoc();
          var html = '<div>a<b>b</b><span style="color:red">c</span><script>x</script></div>';
          res.nettoyage = nettoyerHtml(html) === 'a<b>b</b>c';
          var pt = new DataTransfer();
          pt.setData('text/plain', 'Titre\\ncollé');
          pt.setData('text/html', '<h1 style="color:red">Titre</h1>');
          placerCaret(titre, false);
          titre.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: pt }));
          res.titreCollageBrut = titre.innerHTML === 'Page de testTitre collé';
          NOTES_RECHERCHE = 'pas une puce';
          rendreRailNotes();
          res.rechercheContenu = !!document.querySelector('#ntArbre .nt-item[data-id="' + idTest + '"] .nt-extrait');
          NOTES_RECHERCHE = '';
          rendreRailNotes();
          /* --- Bulle Liquid Glass : posée sur la page affichée --- */
          afficherPage('journal');
          poserBulles();
          var bulle = document.querySelector('.tabs > .bulle'), bJournal = document.querySelector('.tab-btn[data-tab="releve"]');
          res.bulleNavigation = !!bulle && bulle.style.transform.replace(/\\s/g, '') === 'translate(' + bJournal.offsetLeft + 'px,' + bJournal.offsetTop + 'px)' && bulle.style.width === bJournal.offsetWidth + 'px';
          /* --- Tâches : avancer et terminer --- */
          afficherPage('taches');
          var t = taches().filter(function (x) { return x.statut === 'en-cours'; })[0];
          if (t) { avancerTache(t.id); res.tacheFaite = t.statut === 'fait' && t.faitLe === aujourdhui(); }
          /* --- Relevé : travaux du mois --- */
          afficherPage('releve');
          res.travauxReleve = travauxDuMois(moisCourant()).length >= 1;
          /* --- Échéances --- */
          var ech = echeances()[0];
          marquerEcheanceFaite(ech.id, true);
          res.echeanceFaite = ech.fait === true;
          marquerEcheanceFaite(ech.id, false);
          /* --- Nettoyage --- */
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
    /* Scénario d'audit (tests/scenario-audit.js), cas limites. */
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
    process.stdout.write('SABLIER_SMOKE_OK captures dans ' + dossierCaptures + '\n');
  } catch (e) {
    process.stdout.write('SABLIER_SMOKE_ERREUR ' + (e && e.message) + '\n');
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}

/* Rien ne démarre dans une seconde instance : elle a demandé à quitter. */
if (verrou) {
  app.whenReady().then(() => {
    /* Apparence forcée pour les captures de l'auto-test (clair ou sombre). */
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

  /* Les écritures en attente passent sur le disque avant de quitter ; si le
     disque les refuse encore, on ne les perd pas sans le dire. */
  app.on('before-quit', (ev) => {
    if (!donnees) return;
    donnees.purger();
    const refuses = Object.keys(donnees.minuteries);
    if (!refuses.length) return;
    const choix = dialog.showMessageBoxSync({
      type: 'warning', buttons: ['Rester dans Sablier', 'Quitter quand même'], defaultId: 0, cancelId: 0,
      message: 'Des données ne sont pas enregistrées',
      detail: refuses.map(nom => nom + '.json').join(', ') + ' : le disque refuse l\'écriture. En quittant maintenant, les dernières modifications seront perdues. Libérez de la place ou exportez une sauvegarde, puis réessayez.',
    });
    if (choix === 0) ev.preventDefault();
  });
  app.on('will-quit', () => { if (donnees) donnees.purger(); });
}
