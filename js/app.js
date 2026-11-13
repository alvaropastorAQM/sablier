/* ============================================================
   DÉMARRAGE : charge les données, branche les pages, écoute les
   commandes du menu de l'application, lance la veille des rappels.
   ============================================================ */
'use strict';

document.addEventListener('DOMContentLoaded', function () {
  var premier = chargerEtat();

  initTableauDeBord();
  initJournal();
  initReleve();
  initFactures();
  initTaches();
  initNotes();
  initEcheances();
  initReglages();
  initRappels();
  PAGES.guide = function () {};

  document.querySelectorAll('.tab-btn[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { afficherPage(b.dataset.tab); });
  });
  document.querySelectorAll('.tab-btn[data-icone]').forEach(function (b) {
    b.insertAdjacentHTML('afterbegin', '<span class="tab-ic" aria-hidden="true">' + icone(b.dataset.icone, 16) + '</span>');
  });
  /* Fenêtre en verre du système (src-tauri/src/main.rs) : le fond de la page s'efface. */
  if (/[?&]vibrance=1/.test(location.search)) document.documentElement.classList.add('vibrance');
  window.addEventListener('resize', poserBulles);

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && modaleOuverte()) { fermerModale(); return; }
    if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey && !ev.defaultPrevented && ev.key >= '1' && ev.key <= '9') {
      var ordre = ['tableau', 'releve', 'factures', 'taches', 'notes', 'echeances', 'reglages', 'guide'];
      var nom = ordre[Number(ev.key) - 1];
      if (nom) { ev.preventDefault(); afficherPage(nom); }
    }
  });

  if (estApp()) {
    window.sablier.surCommande(function (nom) {
      if (nom === 'nouvelle-saisie') { afficherPage('journal'); ouvrirEditionEntree(null); }
      else if (nom === 'chrono') basculerChrono();
      else if (nom === 'pause-chrono') basculerPauseChrono();
      else if (nom === 'exporter') exporterSauvegarde();
      else if (nom === 'importer') importerSauvegarde();
      else if (nom === 'nouvelle-tache' || nom === 'nouveau-chantier') { afficherPage('taches'); ouvrirEditionTache(null, 'a-faire'); }
      else if (nom === 'nouvelle-page') { afficherPage('notes'); creerPageNotes(null); }
      else if (nom === 'rappels') ouvrirRappels();
      else if (nom === 'annuler' || nom === 'retablir') {
        var dansNotes = document.activeElement && document.activeElement.id === 'ntDoc';
        if (!dansNotes) document.execCommand(nom === 'annuler' ? 'undo' : 'redo');
        else if (Date.now() - HISTO_CLAVIER > 150) { if (nom === 'annuler') annulerNotes(); else retablirNotes(); }
      }
      else if (nom.indexOf('erreur-ecriture:') === 0) notifier('Enregistrement impossible (' + nom.slice(16) + '). Vérifiez le disque et le dossier de données, puis exportez une sauvegarde.', { type: 'erreur', duree: 30000 });
      else if (nom.indexOf('page:') === 0) afficherPage(nom.slice(5));
    });
  }

  /* Un fichier ou un lien déposé hors d'une zone prévue ne doit pas
     remplacer l'interface ; les zones de dépôt (fiche, blocs) gardent la
     main puisqu'elles traitent l'événement avant. */
  ['dragover', 'drop'].forEach(function (type) {
    document.addEventListener(type, function (ev) { if (!ev.defaultPrevented) ev.preventDefault(); });
  });
  /* Les écritures différées (notes) partent avant la fermeture de la fenêtre. */
  window.addEventListener('pagehide', function () { if (typeof notesSauverDiffere === 'function' && notesSauverDiffere.flush) notesSauverDiffere.flush(); });

  afficherPage('tableau');
  lancerTicChrono();
  lancerVeilleRappels();

  if (premier) {
    notifier('Bienvenue dans Sablier. Les axes du contrat, les échéances administratives et quelques tâches de départ sont prêts : tout se modifie.', { duree: 9000 });
  } else if (chronoEnCours()) {
    notifier('Un chrono tourne depuis ' + texteChrono(chronoEnCours()) + ' : ' + chronoEnCours().intervention, { action: { libelle: 'Arrêter', fn: function () { arreterChrono(); } } });
  }
  window.SABLIER_PRET = true;
});
