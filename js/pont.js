/* ============================================================
   Sablier : pont entre l'interface et l'application macOS (Tauri).

   Expose window.sablier, comme le preload de l'ancienne version Electron.
   Servi par le fond Rust (sablier://localhost/demarrage.js, chargé
   par index.html avant les modules js/) juste après
   window.__SABLIER_DEMARRAGE : version, mode auto-test, dossier et
   contenu des fichiers de données, relus à chaque chargement.
   Chaque écriture est répercutée au fond qui la range dans le dossier
   de données (écritures atomiques, différées).
   window.__TAURI__ est lu à l'appel : il est posé avant la page.
   ============================================================ */
'use strict';

(function () {
  var demarrage = window.__SABLIER_DEMARRAGE || {};
  var cache = demarrage.donnees || {};
  function invoke(commande, args, options) { return window.__TAURI__.core.invoke(commande, args || {}, options); }

  /* Un fichier déposé depuis le Finder : WebKit en donne le contenu, pas le
     chemin. Envoyé brut, fichier par fichier ; la réponse a la même forme
     que pour des chemins. */
  function deposer(tacheId, fichiers) {
    var res = { ok: true, pieces: [], erreurs: [] };
    return fichiers.reduce(function (suite, f) {
      return suite.then(function () { return f.arrayBuffer(); }).then(function (octets) {
        return invoke('pieces_deposer', new Uint8Array(octets), { headers: { 'x-tache': encodeURIComponent(tacheId), 'x-nom': encodeURIComponent(f.name) } });
      }).then(function (r) {
        res.pieces = res.pieces.concat(r.pieces || []);
        res.erreurs = res.erreurs.concat(r.erreurs || (r.message ? [f.name + ' : ' + r.message] : []));
      }, function (e) { res.erreurs.push(f.name + ' : ' + ((e && e.message) || e)); });
    }, Promise.resolve()).then(function () { return res; });
  }

  window.sablier = {
    version: demarrage.version || '',
    plateforme: 'darwin',
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

    /* Pièces jointes des tâches : copiées dans Donnees/Pieces/<tâche>/.
       « chemins » : des chemins de fichiers, ou des fichiers déposés (File). */
    pieces: {
      ajouter: function (tacheId, chemins) {
        var liste = Array.isArray(chemins) ? chemins.filter(Boolean) : [];
        if (liste.length && liste.every(function (c) { return c instanceof File; })) return deposer(String(tacheId), liste);
        return invoke('pieces_ajouter', { tacheId: String(tacheId), chemins: liste.length ? liste.map(String) : null });
      },
      ouvrir: function (relatif) { return invoke('pieces_ouvrir', { relatif: String(relatif || '') }); },
      reveler: function (relatif) { return invoke('pieces_reveler', { relatif: String(relatif || '') }); },
      supprimer: function (relatif) { return invoke('pieces_supprimer', { relatif: String(relatif || '') }); },
      url: function (relatif) { return 'sablier-piece://pieces/' + String(relatif || '').split('/').map(encodeURIComponent).join('/'); },
    },

    /* Rappels : notification du Mac et pastille du Dock. */
    rappels: {
      notifier: function (o) { return invoke('rappels_notifier', { o: o || {} }); },
      badge: function (n) { return invoke('rappels_badge', { n: Number(n) || 0 }); },
    },

    /* Commandes envoyées par le menu de l'application. */
    surCommande: function (cb) { return window.__TAURI__.event.listen('commande', function (e) { cb(e.payload); }); },
  };
})();
