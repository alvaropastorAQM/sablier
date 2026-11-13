/* ============================================================
   Sablier : pont entre l'interface et l'application macOS.

   Expose window.sablier. Les fichiers de données sont chargés une fois,
   de façon synchrone, avant l'exécution des modules js/ ; chaque
   écriture est répercutée au process principal qui la range dans le
   dossier de données (écritures atomiques, différées).
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
    /* Chemin d'un fichier glissé depuis le Finder. */
    cheminDe(fichier) { try { return webUtils.getPathForFile(fichier); } catch (e) { return ''; } },
  },

  /* Pièces jointes des tâches : copiées dans Donnees/Pieces/<tâche>/. */
  pieces: {
    ajouter(tacheId, chemins) { return ipcRenderer.invoke('pieces:ajouter', tacheId, chemins || null); },
    ouvrir(relatif) { return ipcRenderer.invoke('pieces:ouvrir', relatif); },
    reveler(relatif) { return ipcRenderer.invoke('pieces:reveler', relatif); },
    supprimer(relatif) { return ipcRenderer.invoke('pieces:supprimer', relatif); },
    url(relatif) { return 'sablier-piece://pieces/' + String(relatif || '').split('/').map(encodeURIComponent).join('/'); },
  },

  /* Rappels : notification du Mac et pastille du Dock. */
  rappels: {
    notifier(o) { return ipcRenderer.invoke('rappels:notifier', o); },
    badge(n) { return ipcRenderer.invoke('rappels:badge', n); },
  },

  /* Commandes envoyées par le menu de l'application. */
  surCommande(cb) { ipcRenderer.on('commande', (ev, nom) => cb(nom)); },
});
