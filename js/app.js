/* ============================================================
   STARTUP: loads the data, wires up the pages, listens to the
   application menu commands, starts the reminders watch.
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
  /* System glass window (src-tauri/src/main.rs): the page background fades out. */
  if (/[?&]vibrance=1/.test(location.search)) document.documentElement.classList.add('vibrance');
  /* Windows draws its own title bar above the page: no room to leave for the Mac window buttons. */
  if (estApp() && window.sablier.plateforme === 'win32') document.documentElement.classList.add('windows');
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
      else if (nom.indexOf('erreur-ecriture:') === 0) notifier('Could not save (' + nom.slice(16) + '). Check the disk and the data folder, then export a backup.', { type: 'erreur', duree: 30000 });
      else if (nom.indexOf('page:') === 0) afficherPage(nom.slice(5));
    });
  }

  /* A file or link dropped outside a drop zone must not replace the
     interface; the drop zones (task sheet, blocks) keep control since
     they handle the event first. */
  ['dragover', 'drop'].forEach(function (type) {
    document.addEventListener(type, function (ev) { if (!ev.defaultPrevented) ev.preventDefault(); });
  });
  /* Deferred writes (notes) are flushed before the window closes. */
  window.addEventListener('pagehide', function () { if (typeof notesSauverDiffere === 'function' && notesSauverDiffere.flush) notesSauverDiffere.flush(); });

  afficherPage('tableau');
  lancerTicChrono();
  lancerVeilleRappels();

  if (premier) {
    notifier('Welcome to Sablier. The contract areas, the admin deadlines and a few starter tasks are ready: everything can be edited.', { duree: 9000 });
  } else if (chronoEnCours()) {
    notifier('A timer has been running for ' + texteChrono(chronoEnCours()) + ': ' + chronoEnCours().intervention, { action: { libelle: 'Stop', fn: function () { arreterChrono(); } } });
  }
  window.SABLIER_PRET = true;
});
