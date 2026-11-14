/* ============================================================
   SETTINGS PAGE: billing, taxes, identities, bank details, areas,
   reminders, data.
   ============================================================ */
'use strict';

var CHAMPS_REGLAGES = {
  reglTarif: ['tarifHoraire', 'nombre'], reglArrondi: ['arrondi', 'nombre'], reglHeuresJournee: ['heuresJournee', 'nombre'],
  reglRepereAnnuel: ['repereAnnuel', 'nombre'], reglDelaiPaiement: ['delaiPaiement', 'nombre'], reglDossierFactures: ['dossierFactures', 'texte'],
  reglContratDebut: ['contrat.debut', 'texte'], reglContratFin: ['contrat.fin', 'texte'],
  reglPrestNom: ['prestataire.nom', 'texte'], reglPrestNif: ['prestataire.nif', 'texte'],
  reglPrestAdresse: ['prestataire.adresse', 'texte'], reglPrestEmail: ['prestataire.email', 'texte'],
  reglPrestTel: ['prestataire.telephone', 'texte'], reglPrestIban: ['prestataire.iban', 'texte'], reglPrestBic: ['prestataire.bic', 'texte'],
  reglPrestTitulaire: ['prestataire.titulaireCompte', 'texte'], reglPrestBanque: ['prestataire.banque', 'texte'],
  reglRappelNatifs: ['rappels.natives', 'bool'], reglRappelDemarrage: ['rappels.auDemarrage', 'bool'],
  reglRappelEcheances: ['rappels.horizonEcheances', 'nombre'], reglRappelTaches: ['rappels.horizonTaches', 'nombre'], reglRappelFactures: ['rappels.horizonFactures', 'nombre'],
  reglRappelChrono: ['rappels.chronoOublieHeures', 'nombre'], reglRappelJournal: ['rappels.journalJours', 'nombre'],
  reglClientSociete: ['client.societe', 'texte'], reglClientContact: ['client.contact', 'texte'], reglClientAdresse: ['client.adresse', 'texte'],
  reglClientNif: ['client.nif', 'texte'], reglClientEmail: ['client.email', 'texte'],
  reglDebutActivite: ['impots.debutActivite', 'texte'], reglTauxTva: ['impots.tauxTva', 'nombre'], reglTauxIrpf: ['impots.tauxIrpf', 'nombre'], reglCotisationMensuelle: ['impots.cotisationMensuelle', 'nombre'],
};

function lireChemin(obj, chemin) { return chemin.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj); }
function ecrireChemin(obj, chemin, valeur) {
  var parts = chemin.split('.');
  var o = obj;
  for (var i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = valeur;
}

function initReglages() {
  PAGES.reglages = rendreReglages;
  Object.keys(CHAMPS_REGLAGES).forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      var def = CHAMPS_REGLAGES[id];
      var v;
      if (def[1] === 'nombre') {
        var txt = String(el.value).trim();
        v = txt === '' ? null : lireMontant(txt);
        if (v == null || (el.min !== '' && v < Number(el.min))) { rendreReglages(); notifier('Value kept: ' + (txt === '' ? 'the field cannot be left empty.' : 'number not understood.'), { type: 'erreur' }); return; }
      } else v = def[1] === 'bool' ? !!el.checked : el.value.trim();
      ecrireChemin(ETAT.reglages, def[0], v);
      sauver('reglages');
      rafraichir();
      notifier('Setting saved.', { duree: 1500 });
    });
  });
  document.getElementById('reglAjouterAxe').addEventListener('click', function () {
    var n = axes().length;
    axes().push({ id: uid('axe'), code: String(n + 1), nom: 'New area', couleur: PALETTE_AXES[n % PALETTE_AXES.length] });
    sauver('reglages');
    rendreAxesReglages();
    var dernier = document.querySelector('#reglAxes .axe-ligne:last-child input[data-champ=nom]');
    if (dernier) { dernier.focus(); dernier.select(); }
  });
  /* Custom colour: the native picker, tied to the area being edited. */
  var libre = document.getElementById('reglCouleurLibre');
  libre.addEventListener('input', function () {
    var a = axeParId(libre.dataset.axe);
    if (!a || !/^#[0-9a-fA-F]{6}$/.test(libre.value)) return;
    a.couleur = libre.value;
    sauver('reglages');
    rendreAxesReglages();
  });
  document.getElementById('reglAxes').addEventListener('change', function (ev) {
    var inp = ev.target.closest('input[data-champ]');
    if (!inp) return;
    var a = axeParId(inp.closest('.axe-ligne').dataset.id);
    if (!a) return;
    a[inp.dataset.champ] = inp.value.trim();
    sauver('reglages');
    rafraichir();
  });
  document.getElementById('reglAxes').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-action]');
    if (!b) return;
    var ligne = b.closest('.axe-ligne');
    var id = ligne.dataset.id;
    var liste = axes();
    var idx = liste.findIndex(function (a) { return a.id === id; });
    if (idx < 0) return;
    if (b.dataset.action === 'couleur') { ouvrirNuancier(b, liste[idx]); return; }
    if (b.dataset.action === 'monter' && idx > 0) { var t = liste[idx - 1]; liste[idx - 1] = liste[idx]; liste[idx] = t; }
    else if (b.dataset.action === 'descendre' && idx < liste.length - 1) { var u = liste[idx + 1]; liste[idx + 1] = liste[idx]; liste[idx] = u; }
    else if (b.dataset.action === 'supprimer') {
      if (axeUtilise(id)) { notifier('This area is used by log entries or tasks: it cannot be deleted.', { type: 'erreur' }); return; }
      liste.splice(idx, 1);
      if (ETAT.reglages.ui.dernierAxe === id) ETAT.reglages.ui.dernierAxe = liste[0] ? liste[0].id : '';
    }
    sauver('reglages');
    rafraichir();
  });
  document.getElementById('reglOuvrirDossier').addEventListener('click', function () {
    if (estApp()) window.sablier.donnees.ouvrirDossier(); else notifier('Only available in the desktop app.');
  });
  document.getElementById('reglExporter').addEventListener('click', exporterSauvegarde);
  document.getElementById('reglImporter').addEventListener('click', importerSauvegarde);
  document.getElementById('reglChoisirDossierFactures').addEventListener('click', function () {
    if (!estApp()) return;
    window.sablier.pdf.choisirDossier(ETAT.reglages.dossierFactures).then(function (d) {
      if (!d) return;
      ETAT.reglages.dossierFactures = d;
      sauver('reglages');
      rendreReglages();
      notifier('Invoices folder saved.', { duree: 2500 });
    });
  });
  document.getElementById('reglExportCsv').addEventListener('click', exporterJournalCsv);
  document.getElementById('reglTesterNotif').addEventListener('click', testerNotificationNative);
  document.getElementById('reglOuvrirRappels').addEventListener('click', ouvrirRappels);
}

function axeUtilise(id) {
  return entreesJournal().some(function (e) { return e.axe === id; }) || taches().some(function (t) { return t.axe === id; })
    || factures().some(function (f) { return (f.lignes || []).some(function (l) { return l.axe === id; }); })
    || (chronoEnCours() && chronoEnCours().axe === id);
}

function rendreReglages() {
  Object.keys(CHAMPS_REGLAGES).forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var v = lireChemin(ETAT.reglages, CHAMPS_REGLAGES[id][0]);
    if (CHAMPS_REGLAGES[id][1] === 'bool') el.checked = v !== false;
    else el.value = v == null ? '' : v;
  });
  rendreAxesReglages();
  var info = document.getElementById('reglDossier');
  if (estApp()) {
    window.sablier.donnees.dossier().then(function (d) { info.textContent = 'Readable JSON files in: ' + d + '. A dated copy is made every day in the Sauvegardes subfolder.'; });
    document.getElementById('reglAPropos').textContent = 'Sablier ' + window.sablier.version + ', assignment tracking for freelancers. No client data is stored here.';
  } else {
    info.textContent = 'Browser mode: data is kept in this page\'s local storage.';
  }
}

function rendreAxesReglages() {
  var liste = axes();
  document.getElementById('reglAxes').innerHTML = liste.map(function (a) {
    var utilise = axeUtilise(a.id);
    return '<div class="axe-ligne" data-id="' + echapper(a.id) + '">'
      + '<button type="button" class="axe-couleur" data-action="couleur" style="--axe:' + echapper(a.couleur) + '" title="Change the colour"><i class="axe-point"></i></button>'
      + '<input type="text" data-champ="nom" value="' + echapper(a.nom) + '" placeholder="Area name">'
      + '<div class="ordre">' + boutonIcone('monter', 'haut', 'Move up') + boutonIcone('descendre', 'bas', 'Move down') + '</div>'
      + boutonIcone('supprimer', 'corbeille', utilise ? 'Area in use: cannot be deleted' : 'Delete', 'danger')
      + '</div>';
  }).join('');
}

/* Swatches: ten muted shades, or a custom colour through the native picker. */
function ouvrirNuancier(ancre, a) {
  fermerMenu();
  var menu = document.createElement('div');
  menu.className = 'menu-blocs';
  menu.id = 'menuFlottant';
  menu.innerHTML = '<div class="menu-blocs-titre">Colour of "' + echapper(a.nom) + '"</div>'
    + '<div class="nuancier">' + PALETTE_AXES.map(function (c) {
      return '<button type="button" class="nuance' + (c.toLowerCase() === String(a.couleur).toLowerCase() ? ' active' : '') + '" data-couleur="' + c + '" title="' + c + '"><i style="background:' + c + '"></i></button>';
    }).join('') + '</div>'
    + '<div class="sep"></div><button type="button" data-libre="1"><span class="ic" style="background:' + echapper(a.couleur) + '; color:#fff;">…</span><span>Other colour<span class="sous">System colour picker</span></span></button>';
  document.body.appendChild(menu);
  var r = ancre.getBoundingClientRect();
  var top = r.bottom + 4, left = r.left;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
  if (left + menu.offsetWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menu.offsetWidth - 8);
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
  menu.addEventListener('click', function (ev) {
    var n = ev.target.closest('.nuance');
    if (n) { a.couleur = n.dataset.couleur; sauver('reglages'); fermerMenu(); rafraichir(); return; }
    if (ev.target.closest('[data-libre]')) {
      fermerMenu();
      var libre = document.getElementById('reglCouleurLibre');
      libre.dataset.axe = a.id;
      libre.value = a.couleur;
      libre.click();
    }
  });
  setTimeout(function () {
    document.addEventListener('mousedown', fermerMenuSiDehors);
    document.addEventListener('keydown', fermerMenuEchap);
  }, 0);
}

function exporterSauvegarde() {
  var paquet = paquetSauvegarde();
  var nom = 'Sablier-backup-' + aujourdhui() + '.json';
  if (estApp()) {
    window.sablier.donnees.exporter(paquet, nom).then(function (res) {
      if (res && res.ok) notifier('Backup saved: ' + partiesChemin(res.chemin).pop(), { type: 'succes', action: { libelle: 'Show in file manager', fn: function () { window.sablier.fichiers.reveler(res.chemin); } } });
    });
  } else exporterTexte(nom, JSON.stringify(paquet, null, 2));
}

function importerSauvegarde() {
  if (!estApp()) { notifier('Only available in the desktop app.'); return; }
  window.sablier.donnees.importer().then(function (res) {
    if (!res || res.annule) return;
    if (!res.ok) { notifier('Unreadable file: ' + (res.message || ''), { type: 'erreur' }); return; }
    var p = res.paquet;
    if (!p || p.application !== 'Sablier') { notifier('This file is not a Sablier backup.', { type: 'erreur' }); return; }
    var nb = (p.journal && p.journal.entrees ? p.journal.entrees.length : 0);
    confirmer('Replace all current data with the backup from ' + (p.exporteLe ? dateFr(p.exporteLe.slice(0, 10)) : '?') + ' (' + nb + ' log entries)? The current data will first be copied to the Sauvegardes folder.', { ok: 'Replace', danger: true, titre: 'Import a backup' }).then(function (ok) {
      if (!ok) return;
      window.sablier.donnees.sauvegarderMaintenant().then(function () {
        var res = remplacerEtat(p);
        if (!res.ok) { notifier('Incomplete backup (missing: ' + res.manquants.join(', ') + '): nothing was replaced.', { type: 'erreur', duree: 8000 }); return; }
        NOTES_PAGE = null; RELEVE_MOIS = null; RELEVE_JOURS = {}; TABLEAU_PERIODE = null;
        afficherPage('tableau');
        notifier('Backup imported.', { type: 'succes' });
      });
    });
  });
}

function exporterJournalCsv() {
  var lignes = [['Date', 'Area', 'Work item', 'Details', 'Start', 'End', 'Duration (min)', 'Duration (h)']];
  trierPar(entreesJournal(), function (e) { return e.date + (e.debut || ''); }).forEach(function (e) {
    var m = dureeEntree(e);
    lignes.push([dateFr(e.date), libelleAxe(e.axe), e.intervention, e.detail || '', e.debut || '', e.fin || '', String(m), fmtHeuresDec(m, true)]);
  });
  var csv = lignes.map(function (l) { return l.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\n');
  exporterTexte('journal-sablier.csv', '﻿' + csv);
}
