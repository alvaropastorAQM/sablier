/* ============================================================
   Sablier : génération de PDF à partir d'un document HTML.

   Le HTML (relevé, facture) est rendu dans une fenêtre cachée puis
   imprimé en PDF par Chromium : aucune bibliothèque, mêmes polices
   polices livrées avec l'application (Charter, Nunito Sans).
   ============================================================ */
'use strict';

const { BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* Un PDF déjà enregistré peut être signé ou envoyé : le suivant prend le
   premier nom libre (« Facture-2026-01 (2).pdf »). */
function cheminLibre(cible) {
  const ext = path.extname(cible);
  const base = cible.slice(0, cible.length - ext.length);
  let chemin = cible;
  for (let i = 2; fs.existsSync(chemin); i++) chemin = base + ' (' + i + ')' + ext;
  return chemin;
}

async function genererPdf(parent, html, nomFichier, dossierDefaut) {
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: 'Enregistrer le PDF',
    defaultPath: cheminLibre(path.join(dossierDefaut, nomFichier || 'document.pdf')),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false, annule: true };
  return rendrePdf(html, filePath);
}

/* The HTML is printed from a temporary file, where relative font URLs do
   not resolve: the bundled fonts go inline, as data URLs. */
const POLICES_PDF = [
  ['Nunito Sans', 'NunitoSans-Variable.ttf', 'truetype', '200 1000', 'normal'],
  ['Nunito Sans', 'NunitoSans-Italic-Variable.ttf', 'truetype', '200 1000', 'italic'],
  ['Charter', 'charter_regular.woff2', 'woff2', '400', 'normal'],
  ['Charter', 'charter_italic.woff2', 'woff2', '400', 'italic'],
  ['Charter', 'charter_bold.woff2', 'woff2', '600 700', 'normal'],
  ['Charter', 'charter_bold_italic.woff2', 'woff2', '600 700', 'italic'],
];
let stylePolices = null;
function policesEnLigne() {
  if (stylePolices === null) {
    const dossier = path.join(__dirname, '..', 'css', 'fonts');
    stylePolices = '<style>' + POLICES_PDF.map(([famille, fichier, format, graisse, style]) => {
      const donnees = fs.readFileSync(path.join(dossier, fichier)).toString('base64');
      return '@font-face { font-family: "' + famille + '"; src: url(data:font/' + (format === 'woff2' ? 'woff2' : 'ttf') + ';base64,' + donnees + ') format("' + format + '"); font-weight: ' + graisse + '; font-style: ' + style + '; }';
    }).join('') + '</style>';
  }
  return stylePolices;
}

async function rendrePdf(html, filePath, options) {
  const tmp = path.join(os.tmpdir(), 'sablier-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.html');
  let w = null;
  try {
    fs.writeFileSync(tmp, String(html).replace('<head>', '<head>' + policesEnLigne()), 'utf8');
    w = new BrowserWindow({
      show: false, width: 900, height: 1200,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await w.loadFile(tmp);
    await w.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(function () { return true; }) : true', true);
    const data = await w.webContents.printToPDF(Object.assign({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true }, options || {}));
    fs.writeFileSync(filePath, data);
    return { ok: true, chemin: filePath };
  } catch (e) {
    return { ok: false, message: String((e && e.message) || e) };
  } finally {
    if (w && !w.isDestroyed()) w.destroy();
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

module.exports = { genererPdf, rendrePdf, cheminLibre };
