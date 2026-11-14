/* ============================================================
   Sablier: bridge between the interface and the macOS application (Tauri).

   Exposes window.sablier, like the preload of the old Electron version.
   Served by the Rust backend (sablier://localhost/demarrage.js, loaded
   by index.html before the js/ modules) right after
   window.__SABLIER_DEMARRAGE: version, self-test mode, folder and
   content of the data files, re-read at every load.
   Each write is passed on to the backend, which files it in the data
   folder (atomic, deferred writes).
   window.__TAURI__ is read at call time: it is set before the page.
   ============================================================ */
'use strict';

(function () {
  var demarrage = window.__SABLIER_DEMARRAGE || {};
  var cache = demarrage.donnees || {};
  function invoke(commande, args, options) { return window.__TAURI__.core.invoke(commande, args || {}, options); }

  /* A file dropped from the Finder: WebKit gives its content, not its
     path. Sent raw, one file at a time; the response has the same shape
     as for paths. */
  function deposer(tacheId, fichiers) {
    var res = { ok: true, pieces: [], erreurs: [] };
    return fichiers.reduce(function (suite, f) {
      return suite.then(function () { return f.arrayBuffer(); }).then(function (octets) {
        return invoke('pieces_deposer', new Uint8Array(octets), { headers: { 'x-tache': encodeURIComponent(tacheId), 'x-nom': encodeURIComponent(f.name) } });
      }).then(function (r) {
        res.pieces = res.pieces.concat(r.pieces || []);
        res.erreurs = res.erreurs.concat(r.erreurs || (r.message ? [f.name + ': ' + r.message] : []));
      }, function (e) { res.erreurs.push(f.name + ': ' + ((e && e.message) || e)); });
    }, Promise.resolve()).then(function () { return res; });
  }

  /* On Windows, WebView2 serves the internal schemes as http://<scheme>.localhost. */
  var windows = demarrage.plateforme === 'win32';

  window.sablier = {
    version: demarrage.version || '',
    plateforme: demarrage.plateforme || 'darwin',
    smoke: !!demarrage.smoke,

    donnees: {
      lire: function (nom) { return Object.prototype.hasOwnProperty.call(cache, nom) ? cache[nom] : null; },
      ecrire: function (nom, objet) {
        var copie = JSON.parse(JSON.stringify(objet));
        cache[nom] = copie;
        invoke('donnees_ecrire', { nom: nom, objet: copie });
      },
      dossier: function () { return Promise.resolve(demarrage.dossier); },
      ouvrirDossier: function () { return invoke('donnees_ouvrir_dossier'); },
      sauvegarderMaintenant: function () { return invoke('donnees_sauvegarder'); },
      exporter: function (paquet, nomFichier) { return invoke('donnees_exporter', { paquet: paquet, nomFichier: nomFichier }); },
      importer: function () { return invoke('donnees_importer'); },
    },

    pdf: {
      generer: function (html, nomFichier) { return invoke('pdf_generer', { html: html, nomFichier: nomFichier }); },
      classer: function (html, base, mois, nomDossier, nomFichier) { return invoke('pdf_classer', { html: html, base: base, mois: mois, nomDossier: nomDossier, nomFichier: nomFichier }); },
      choisirDossier: function (depart) { return invoke('dossier_choisir', { depart: depart || null }); },
    },

    fichiers: {
      ouvrir: function (chemin) { return invoke('fichier_ouvrir', { chemin: String(chemin) }); },
      reveler: function (chemin) { return invoke('fichier_reveler', { chemin: String(chemin) }); },
      ouvrirUrl: function (url) { return invoke('fichier_ouvrir_url', { url: String(url) }); },
      exporterTexte: function (nomFichier, contenu) { return invoke('fichier_exporter_texte', { nomFichier: nomFichier, contenu: String(contenu) }); },
    },

    /* Task attachments: copied into Donnees/Pieces/<task>/.
       "chemins": file paths, or dropped files (File). */
    pieces: {
      ajouter: function (tacheId, chemins) {
        var liste = Array.isArray(chemins) ? chemins.filter(Boolean) : [];
        if (liste.length && liste.every(function (c) { return c instanceof File; })) return deposer(String(tacheId), liste);
        return invoke('pieces_ajouter', { tacheId: String(tacheId), chemins: liste.length ? liste.map(String) : null });
      },
      ouvrir: function (relatif) { return invoke('pieces_ouvrir', { relatif: String(relatif || '') }); },
      reveler: function (relatif) { return invoke('pieces_reveler', { relatif: String(relatif || '') }); },
      supprimer: function (relatif) { return invoke('pieces_supprimer', { relatif: String(relatif || '') }); },
      url: function (relatif) { return (windows ? 'http://sablier-piece.localhost/pieces/' : 'sablier-piece://pieces/') + String(relatif || '').split('/').map(encodeURIComponent).join('/'); },
    },

    /* Reminders: Mac notification and Dock badge. */
    rappels: {
      notifier: function (o) { return invoke('rappels_notifier', { o: o || {} }); },
      badge: function (n) { return invoke('rappels_badge', { n: Number(n) || 0 }); },
    },

    /* Commands sent by the application menu. */
    surCommande: function (cb) { return window.__TAURI__.event.listen('commande', function (e) { cb(e.payload); }); },
  };
})();
