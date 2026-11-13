/* ============================================================
   Sablier: bridge between the interface and the desktop application.

   Exposes window.sablier. The data files are loaded once, synchronously,
   before the js/ modules run; each write is passed on to the main process,
   which stores it in the data folder (atomic, delayed writes).
   ============================================================ */
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const cache = ipcRenderer.sendSync('donnees:charger') || {};
let version = '0.1.0';
try { version = require('../package.json').version; } catch (e) {}

contextBridge.exposeInMainWorld('sablier', {
  version: version,
  plateforme: process.platform,
  smoke: process.env.SABLIER_SMOKE === '1',

  donnees: {
    lire(nom) { return Object.prototype.hasOwnProperty.call(cache, nom) ? cache[nom] : null; },
    ecrire(nom, objet) {
      const copie = JSON.parse(JSON.stringify(objet));
      cache[nom] = copie;
      ipcRenderer.send('donnees:ecrire', nom, copie);
    },
    dossier() { return ipcRenderer.invoke('donnees:dossier'); },
    ouvrirDossier() { return ipcRenderer.invoke('donnees:ouvrir-dossier'); },
    sauvegarderMaintenant() { return ipcRenderer.invoke('donnees:sauvegarder'); },
    exporter(paquet, nomFichier) { return ipcRenderer.invoke('donnees:exporter', paquet, nomFichier); },
    importer() { return ipcRenderer.invoke('donnees:importer'); },
  },

  pdf: {
    generer(html, nomFichier) { return ipcRenderer.invoke('pdf:generer', html, nomFichier); },
    classer(html, base, mois, nomDossier, nomFichier) { return ipcRenderer.invoke('pdf:classer', html, base, mois, nomDossier, nomFichier); },
    choisirDossier(depart) { return ipcRenderer.invoke('dossier:choisir', depart); },
  },

  fichiers: {
    ouvrir(chemin) { return ipcRenderer.invoke('fichier:ouvrir', chemin); },
    reveler(chemin) { return ipcRenderer.invoke('fichier:reveler', chemin); },
    ouvrirUrl(url) { return ipcRenderer.invoke('fichier:ouvrir-url', url); },
    exporterTexte(nomFichier, contenu) { return ipcRenderer.invoke('fichier:exporter-texte', nomFichier, contenu); },
    /* Path of a file dragged from the file manager. */
    cheminDe(fichier) { try { return webUtils.getPathForFile(fichier); } catch (e) { return ''; } },
  },

  /* Task attachments: copied into Donnees/Pieces/<task>/. */
  pieces: {
    ajouter(tacheId, chemins) { return ipcRenderer.invoke('pieces:ajouter', tacheId, chemins || null); },
    ouvrir(relatif) { return ipcRenderer.invoke('pieces:ouvrir', relatif); },
    reveler(relatif) { return ipcRenderer.invoke('pieces:reveler', relatif); },
    supprimer(relatif) { return ipcRenderer.invoke('pieces:supprimer', relatif); },
    url(relatif) { return 'sablier-piece://pieces/' + String(relatif || '').split('/').map(encodeURIComponent).join('/'); },
  },

  /* Reminders: desktop notification and Dock badge. */
  rappels: {
    notifier(o) { return ipcRenderer.invoke('rappels:notifier', o); },
    badge(n) { return ipcRenderer.invoke('rappels:badge', n); },
  },

  /* Commands sent by the application menu. */
  surCommande(cb) { ipcRenderer.on('commande', (ev, nom) => cb(nom)); },
});
