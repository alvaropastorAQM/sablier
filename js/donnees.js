/* ============================================================
   DATA: the application state and its persistence.

   In the desktop app, window.sablier (js/pont.js) reads and writes
   JSON files in the data folder. In a bare browser (development), it
   falls back to localStorage.

   Files: reglages, journal, chantiers (the tasks, historical file name),
   notes, factures, echeances, chrono. The first launch seeds default data
   drawn from the contract (areas, admin deadlines, pages and tasks).
   ============================================================ */
'use strict';

var FICHIERS = ['reglages', 'journal', 'chantiers', 'notes', 'factures', 'echeances', 'chrono'];
var ETAT = {};

function estApp() { return typeof window !== 'undefined' && !!window.sablier; }

/* ---------- Default values ---------- */

/* Muted palette offered for areas (never garish). */
var PALETTE_AXES = ['#1F497D', '#2E6F9E', '#2F7F8A', '#4E8B6D', '#7A8A3A', '#A5813C', '#B3652F', '#9E3A45', '#7A4F8C', '#5F7186'];
var COULEURS_AXES_DEFAUT = { rapports: '#2E6F9E', projeta: '#1F497D', integration: '#2F7F8A', suivi: '#7A4F8C', gouvernance: '#4E8B6D', annexe: '#A5813C' };

function axesDefaut() {
  return [
    { id: 'rapports', code: '1', nom: 'Client reports', couleur: '#2E6F9E' },
    { id: 'projeta', code: '2', nom: 'Project A development', couleur: '#1F497D' },
    { id: 'integration', code: '3', nom: 'Project B integration', couleur: '#2F7F8A' },
    { id: 'suivi', code: '4', nom: 'Project B / Partner follow-up', couleur: '#7A4F8C' },
    { id: 'gouvernance', code: '5', nom: 'Governance, monitoring and ideas', couleur: '#4E8B6D' },
    { id: 'annexe', code: 'A', nom: 'Side assignment', couleur: '#A5813C' },
  ];
}

/* The contract runs for a year from the first day of the current month,
   until the real dates are typed in Settings. */
function contratDefaut() {
  return { debut: moisCourant() + '-01', fin: ajouterJours(ajouterMois(moisCourant(), 12) + '-01', -1) };
}

function reglagesDefaut() {
  var contrat = contratDefaut();
  return {
    schemaVersion: 3,
    tarifHoraire: 42.86,
    arrondi: 0.25,
    heuresJournee: 7,
    repereAnnuel: 192,
    delaiPaiement: 30,
    contrat: contrat,
    prestataire: {
      nom: '', nif: '', adresse: '', email: '', telephone: '',
      titulaireCompte: '', banque: '', iban: '', bic: '',
    },
    client: { societe: '', contact: '', adresse: '', nif: '', email: '' },
    axes: axesDefaut(),
    /* Spanish autónomo invoicing a Spanish company: 21% VAT, 15% IRPF
       withheld (7% in the first three years), monthly autónomo fee. */
    impots: { tauxTva: 21, tauxIrpf: 15, cotisationMensuelle: 0, debutActivite: contrat.debut },
    /* Reminders: horizons in days, forgotten timer in hours, neglected
       log in days (0 to disable), desktop notifications. */
    rappels: { natives: true, auDemarrage: true, horizonEcheances: 7, horizonTaches: 3, horizonFactures: 5, chronoOublieHeures: 3, journalJours: 7 },
    ui: { dernierAxe: 'projeta', periodeTableau: 'mois', moisMeta: {}, rappelsNotifies: {}, rappelsReportes: {}, rappelsDigestLe: '' },
  };
}

/* The Spanish tax calendar of the next fifteen months: the quarterly VAT
   return, the yearly VAT summary and income tax return, the contract end,
   and the VeriFactu decision. */
function echeancesDefaut() {
  var maintenant = new Date().toISOString();
  var aujourd = aujourdhui();
  var horizon = ajouterJours(aujourd, 460);
  var liste = [];
  for (var m = moisDe(aujourd); premierJour(m) <= horizon; m = ajouterMois(m, 3)) {
    var t = trimestreDe(premierJour(m));
    liste.push([echeanceTrimestre(t), 'Model 303 (VAT) for ' + t.libelle, 'Filed from the 1st to the 20th (the fourth quarter until 30 January), even with no invoice. The amount is on the Invoices and income page. Model 130 is due on the same date only if less than 70% of your income had IRPF withheld.', 'admin']);
  }
  var annee = Number(aujourd.slice(0, 4));
  [annee, annee + 1].forEach(function (a) {
    liste.push([(a + 1) + '-01-30', 'Model 390 (yearly VAT summary) for ' + a, 'Filed together with the model 303 of the fourth quarter.', 'admin']);
    liste.push([(a + 1) + '-06-30', 'Income tax return (model 100) for ' + a, 'The campaign opens in early April. The IRPF withheld by the client and the autónomo fees are deducted.', 'admin']);
  });
  liste.push(['2027-05-31', 'Decide how to invoice under VeriFactu', 'From 1 July 2027, invoices issued with software must comply with VeriFactu (Royal Decree-law 15/2025). Sablier does not: from that date, issue invoices with a compliant program. Check first whether the date has moved again.', 'admin']);
  liste.push([contratDefaut().fin, 'Contract end', 'Agree on the renewal with the client in writing before this date.', 'contrat']);
  return liste.filter(function (x) { return x[0] >= aujourd && x[0] <= horizon; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }).map(function (x, i) {
    return { id: 'ech_defaut_' + i, date: x[0], titre: x[1], detail: x[2], type: x[3], rappelJours: null, fait: false, faitLe: null, creeLe: maintenant };
  });
}

/* A complete task: the tracking fields (steps, attachments, linked notes,
   progress log) are always present. */
var STATUTS_TACHE_VALIDES = ['a-faire', 'en-cours', 'fait', 'idee'];
function normaliserTache(t) {
  if (!t || typeof t !== 'object') return t;
  if (!t.id) t.id = uid('tache');
  if (STATUTS_TACHE_VALIDES.indexOf(t.statut) < 0) t.statut = 'a-faire';
  if (typeof t.titre !== 'string') t.titre = String(t.titre == null ? '' : t.titre);
  if (!t.creeLe) t.creeLe = new Date().toISOString();
  if (!t.modifieLe) t.modifieLe = t.creeLe;
  t.priorite = normaliserPriorite(t.priorite === 'normale' ? 'auto' : t.priorite);
  if (!Array.isArray(t.etapes)) t.etapes = [];
  if (!Array.isArray(t.pieces)) t.pieces = [];
  if (!Array.isArray(t.notes)) t.notes = [];
  if (!Array.isArray(t.avancement)) t.avancement = [];
  if (t.description == null) t.description = '';
  return t;
}

function chantiersDefaut() {
  var maintenant = new Date().toISOString();
  return [
    ['a-faire', 'rapports', 'Prepare the first client report', 'Gather the data, proofread, send.'],
    ['en-cours', 'projeta', 'Make Project A reliable', 'Fix the known bugs before adding features.'],
    ['a-faire', 'integration', 'Deliver a first version of Project A to the partner', 'Numbered and dated version, with short documentation.'],
    ['a-faire', 'suivi', 'First progress review with the partner', 'What was delivered, what is live, what is left to do.'],
    ['a-faire', 'gouvernance', 'Document backup and restore', 'Regular backups and a tested restore procedure.'],
  ].map(function (t, i) {
    return normaliserTache({ id: 'tache_defaut_' + i, statut: t[0], axe: t[1], titre: t[2], description: t[3], priorite: 'auto', echeance: null, ordre: i, creeLe: maintenant, modifieLe: maintenant, faitLe: null });
  });
}

function bloc(type, html, extra) {
  var b = { id: uid('bloc'), type: type, html: html || '' };
  if (type === 'case') b.coche = !!(extra && extra.coche);
  if (extra && extra.tache) b.tache = extra.tache;
  return b;
}

/* The text of an "idea" block: the title in bold, then the description and
   the markers (interest, effort, prerequisites) on the following lines. */
function ideeBlocHtml(titre, description, interet, effort, prerequis) {
  var lignes = ['<b>' + echapper(titre) + '</b>'];
  if (description) lignes.push(echapper(description));
  var reperes = [interet ? 'Interest: ' + interet : '', effort ? 'Effort: ' + effort : '', prerequis ? 'Prerequisites: ' + prerequis : ''].filter(Boolean);
  if (reperes.length) lignes.push(echapper(reperes.join(' · ')));
  return lignes.join('<br>');
}

function ideesDefaut() {
  return [
    bloc('idee', ideeBlocHtml('Proactive alerts', 'Upcoming deadlines surfaced on the dashboard.', 'high, prevents oversights', 'small', 'none')),
    bloc('idee', ideeBlocHtml('CSV export of the log', 'To rework the hours in a spreadsheet.', 'medium', 'small', 'none')),
    bloc('idee', ideeBlocHtml('Task templates', 'Ready-made step lists for recurring work.', 'medium', 'medium', 'none')),
  ];
}

function notesDefaut() {
  var maintenant = new Date().toISOString();
  function page(id, titre, parent, blocs, ordre) {
    return { id: id, titre: titre, parent: parent || null, blocs: blocs, ordre: ordre || 0, creeLe: maintenant, modifieLe: maintenant };
  }
  return [
    page('page_projeta', 'Project A', null, [
      bloc('encadre', 'Sample page: correctness before features.'),
      bloc('h2', 'Deliverables'),
      bloc('case', 'Complete, verified configuration'),
      bloc('case', 'Documentation and user guide kept up to date'),
      bloc('h2', 'Decision log'),
      bloc('p', ''),
    ], 0),
    page('page_admin', 'Admin', null, [
      bloc('p', 'The autónomo routine, on top of the dated deadlines on the Deadlines page.'),
      bloc('h2', 'Every month'),
      bloc('puce', 'Activity statement and invoice from Sablier, sent to the client at the end of the month'),
      bloc('puce', 'When payment arrives: mark the invoice as paid (income ledger)'),
      bloc('h2', 'Every quarter'),
      bloc('puce', 'File model 303 with the VAT of the quarter\'s invoices (Invoices and income page)'),
    ], 1),
    page('page_idees', 'Loose ideas', null, [
      bloc('p', 'A place to jot things down quickly. Each idea has the "Idea" style: lightbulb button in the toolbar, or type / then "Idea". When it is ripe, "Turn into a task" sends it to the To do column.'),
    ].concat(ideesDefaut()), 2),
  ];
}

/* ---------- Reading and writing ---------- */

function lireFichier(nom) {
  if (estApp()) return window.sablier.donnees.lire(nom);
  try { return JSON.parse(localStorage.getItem('sablier_' + nom) || 'null'); }
  catch (e) { return null; }
}

function sauver(nom) {
  if (FICHIERS.indexOf(nom) < 0) throw new Error('unknown file: ' + nom);
  if (estApp()) window.sablier.donnees.ecrire(nom, ETAT[nom]);
  else localStorage.setItem('sablier_' + nom, JSON.stringify(ETAT[nom]));
}

/* An object (neither an array nor a scalar), otherwise null. */
function objetOu(x) { return x && typeof x === 'object' && !Array.isArray(x) ? x : null; }
/* An array of objects (null or scalar elements are dropped), otherwise
   null. A list that became an indexed object ({"0":…, "1":…}, through a
   manual edit or a third-party tool) is recovered rather than lost: we
   never throw away data we can read. */
function tableauObjets(x) {
  if (Array.isArray(x)) return x.filter(function (e) { return e && typeof e === 'object'; });
  if (x && typeof x === 'object') {
    var liste = Object.keys(x).map(function (k) { return x[k]; }).filter(function (e) { return e && typeof e === 'object'; });
    return liste.length ? liste : null;
  }
  return null;
}
/* Coerces a number written as a string ("42,86"); otherwise the default value. */
function nombreDe(v, defaut) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) { var n = Number(v.replace(',', '.')); if (isFinite(n)) return n; }
  return defaut;
}

function completer(cible, defaut) {
  Object.keys(defaut).forEach(function (k) {
    if (cible[k] === undefined || cible[k] === null) cible[k] = defaut[k];
    else if (typeof defaut[k] === 'object' && !Array.isArray(defaut[k]) && defaut[k] !== null && typeof cible[k] === 'object') completer(cible[k], defaut[k]);
  });
  return cible;
}

function chargerEtat() {
  /* First launch: none of the files exist. An unreadable settings file
     alone does not reset everything. */
  var premierLancement = FICHIERS.every(function (nom) { return lireFichier(nom) == null; });
  var aReparer = {};

  var defauts = reglagesDefaut();
  var brutReglages = objetOu(lireFichier('reglages')) || {};
  ETAT.reglages = completer(brutReglages, defauts);
  ['prestataire', 'client', 'contrat', 'impots', 'rappels', 'ui'].forEach(function (k) {
    if (!objetOu(ETAT.reglages[k])) { ETAT.reglages[k] = defauts[k]; aReparer.reglages = true; }
  });
  ['tarifHoraire', 'arrondi', 'heuresJournee', 'repereAnnuel', 'delaiPaiement'].forEach(function (k) {
    var v = nombreDe(ETAT.reglages[k], defauts[k]);
    if (v !== ETAT.reglages[k]) { ETAT.reglages[k] = v; aReparer.reglages = true; }
  });
  if (!objetOu(ETAT.reglages.ui.moisMeta)) ETAT.reglages.ui.moisMeta = {};
  var axesLus = tableauObjets(ETAT.reglages.axes);
  ETAT.reglages.axes = axesLus && axesLus.length ? axesLus : axesDefaut();
  /* Every area has a colour (migration of earlier data). */
  ETAT.reglages.axes.forEach(function (a, i) {
    if (!a.id) a.id = uid('axe');
    if (typeof a.nom !== 'string') a.nom = String(a.nom == null ? '' : a.nom);
    if (!/^#[0-9a-fA-F]{6}$/.test(String(a.couleur || ''))) a.couleur = COULEURS_AXES_DEFAUT[a.id] || PALETTE_AXES[i % PALETTE_AXES.length];
  });

  var j = objetOu(lireFichier('journal')) || {};
  var entrees = tableauObjets(j.entrees) || [];
  if (j.entrees != null && (!Array.isArray(j.entrees) || entrees.length !== j.entrees.length)) aReparer.journal = true;
  entrees.forEach(function (e) {
    if (!e.id) { e.id = uid('ent'); aReparer.journal = true; }
    if (typeof e.minutes === 'string') { var m = nombreDe(e.minutes, null); if (m != null) { e.minutes = m; aReparer.journal = true; } }
    if (typeof e.forfait === 'string') { var fo = nombreDe(e.forfait, null); e.forfait = fo != null && fo > 0 ? fo : null; aReparer.journal = true; }
    /* Billing month: a badly written month would pull the entry out of its
       own month without putting it in any other, and it would never be
       invoiced. The month of the work itself is not stored. */
    if (e.moisFacturation != null && (!moisValide(e.moisFacturation) || e.moisFacturation <= moisDe(e.date))) {
      e.moisFacturation = null;
      aReparer.journal = true;
    }
  });
  ETAT.journal = { schemaVersion: 1, entrees: entrees };

  /* Tasks, notes and deadlines get their default values as long as their
     file does not exist (a file that exists but is empty stays empty). */
  var c = lireFichier('chantiers');
  var tachesLues = c != null ? (tableauObjets(objetOu(c) && c.taches) || []) : chantiersDefaut();
  if (c != null && objetOu(c) && Array.isArray(c.taches) && tachesLues.length !== c.taches.length) aReparer.chantiers = true;
  ETAT.chantiers = { schemaVersion: 2, taches: tachesLues };
  ETAT.chantiers.taches.forEach(normaliserTache);

  var n = lireFichier('notes');
  var pagesLues = n != null ? (tableauObjets(objetOu(n) && n.pages) || []) : notesDefaut();
  if (n != null && objetOu(n) && Array.isArray(n.pages) && pagesLues.length !== n.pages.length) aReparer.notes = true;
  pagesLues.forEach(function (p) {
    if (!p.id) { p.id = uid('page'); aReparer.notes = true; }
    if (!Array.isArray(p.blocs)) { p.blocs = []; aReparer.notes = true; }
    else { var avant = p.blocs.length; p.blocs = p.blocs.filter(function (b) { return b && typeof b === 'object'; }); if (p.blocs.length !== avant) aReparer.notes = true; }
    if (!p.creeLe) p.creeLe = new Date().toISOString();
    if (!p.modifieLe) p.modifieLe = p.creeLe;
  });
  ETAT.notes = { schemaVersion: 1, pages: pagesLues };

  var f = objetOu(lireFichier('factures')) || {};
  var facturesLues = tableauObjets(f.factures) || [];
  if (Array.isArray(f.factures) && facturesLues.length !== f.factures.length) aReparer.factures = true;
  ETAT.factures = { schemaVersion: 1, factures: facturesLues };

  var e = lireFichier('echeances');
  var echeancesLues = e != null ? (tableauObjets(objetOu(e) && e.echeances) || []) : echeancesDefaut();
  if (e != null && objetOu(e) && Array.isArray(e.echeances) && echeancesLues.length !== e.echeances.length) aReparer.echeances = true;
  echeancesLues.forEach(function (x) { if (!x.id) { x.id = uid('ech'); aReparer.echeances = true; } });
  ETAT.echeances = { schemaVersion: 1, echeances: echeancesLues };

  var ch = objetOu(lireFichier('chrono')) || {};
  ETAT.chrono = { schemaVersion: 1, enCours: objetOu(ch.enCours) && ch.enCours.debut ? ch.enCours : null };

  /* Ideas are no longer a board column: those that were there join the
     "Loose ideas" notes page. */
  if (migrerIdeesVersNotes()) { aReparer.chantiers = true; aReparer.notes = true; }

  /* A work item is never split across two billing months (the quarter-hour
     rounding would be counted twice). The interface respects that; a
     hand-edited file or an import might not. */
  if (alignerMoisFacturation()) aReparer.journal = true;

  if (premierLancement) FICHIERS.forEach(function (nom) { sauver(nom); });
  else Object.keys(aReparer).forEach(function (nom) { sauver(nom); });
  return premierLancement;
}

/* Puts back on a single billing month the entries of the same work item
   (same day, same area, same label) that have diverged: the month of an
   entry already frozen on an invoice prevails, otherwise the latest one,
   which can never bill twice. Returns the number of entries fixed. */
function alignerMoisFacturation() {
  var lesFactures = factures();
  var groupes = {};
  entreesJournal().forEach(function (e) {
    if (!e || !e.date) return;
    (groupes[cleTravail(e)] = groupes[cleTravail(e)] || []).push(e);
  });
  var corrigees = 0;
  Object.keys(groupes).forEach(function (cle) {
    var lignes = groupes[cle];
    if (lignes.length < 2) return;
    var mois = lignes.map(moisFacturationDe);
    if (mois.every(function (m) { return m === mois[0]; })) return;
    var figee = lignes.filter(function (e) { return !!factureFigeant(lesFactures, e); })[0];
    var cible = figee ? moisFacturationDe(figee) : mois.slice().sort()[mois.length - 1];
    lignes.forEach(function (e) {
      /* An entry carried by an invoice never moves. */
      if (moisFacturationDe(e) === cible || factureFigeant(lesFactures, e)) return;
      e.moisFacturation = cible === moisDe(e.date) ? null : cible;
      e.modifieLe = new Date().toISOString();
      corrigees++;
    });
  });
  return corrigees;
}

/* Moves the tasks with status "idee" to the Loose ideas page, as "idea"
   blocks that can be turned into a task. Returns the number of ideas
   moved. */
function migrerIdeesVersNotes() {
  var idees = taches().filter(function (t) { return t.statut === 'idee'; });
  if (!idees.length) return 0;
  var page = pageIdees();
  trierPar(idees, function (t) { return Number(t.ordre) || 0; }).forEach(function (t) {
    page.blocs.push(bloc('idee', ideeBlocHtml(t.titre, t.description, t.interet, t.effort, t.prerequis)));
  });
  page.modifieLe = new Date().toISOString();
  ETAT.chantiers.taches = taches().filter(function (t) { return t.statut !== 'idee'; });
  return idees.length;
}

/* The "Loose ideas" page, created if needed. */
function pageIdees() {
  var p = pagesNotes().filter(function (x) { return x.id === 'page_idees'; })[0];
  if (p) { if (!Array.isArray(p.blocs)) p.blocs = []; return p; }
  var maintenant = new Date().toISOString();
  var racines = pagesNotes().filter(function (x) { return !x.parent; });
  p = { id: 'page_idees', titre: 'Loose ideas', parent: null, blocs: [bloc('p', 'A place to jot things down quickly. When an idea is ripe, "Turn into a task" sends it to the To do column.')], ordre: (racines.length ? Math.max.apply(null, racines.map(function (x) { return x.ordre || 0; })) : 0) + 1, creeLe: maintenant, modifieLe: maintenant };
  pagesNotes().push(p);
  return p;
}

/* Replaces the whole state with the content of an imported backup. The
   bundle must carry all seven files (chrono optional); otherwise nothing
   is written and the list of missing files is returned. */
function remplacerEtat(paquet) {
  var manquants = FICHIERS.filter(function (nom) { return nom !== 'chrono' && !objetOu(paquet && paquet[nom]); });
  if (manquants.length) return { ok: false, manquants: manquants };
  FICHIERS.forEach(function (nom) {
    var contenu = objetOu(paquet[nom]) || { schemaVersion: 1, enCours: null };
    if (estApp()) window.sablier.donnees.ecrire(nom, contenu);
    else localStorage.setItem('sablier_' + nom, JSON.stringify(contenu));
  });
  chargerEtat();
  return { ok: true };
}

function paquetSauvegarde() {
  var p = { application: 'Sablier', version: 1, exporteLe: new Date().toISOString() };
  FICHIERS.forEach(function (nom) { p[nom] = ETAT[nom]; });
  return p;
}

/* ---------- Convenience accessors ---------- */

function axes() { return ETAT.reglages.axes || []; }
function axeParId(id) {
  var a = axes().filter(function (x) { return x.id === id; })[0];
  return a || null;
}
function libelleAxe(id) { var a = axeParId(id); return a ? a.nom : (id || 'No area'); }
function codeAxe(id) { var a = axeParId(id); return a ? a.code : ''; }
function couleurAxe(id) { var a = axeParId(id); return a && a.couleur ? a.couleur : '#5F7186'; }
/* Area chip: a dot in the area's colour and its name. */
function puceAxeHtml(id) {
  var a = axeParId(id);
  var nom = a ? a.nom : (id || 'No area');
  return '<span class="puce-axe" style="--axe:' + echapper(couleurAxe(id)) + '" title="' + echapper(nom) + '"><i class="axe-point"></i>' + echapper(nom) + '</span>';
}
function entreesJournal() { return ETAT.journal.entrees; }
function taches() { return ETAT.chantiers.taches; }
function pagesNotes() { return ETAT.notes.pages; }
function factures() { return ETAT.factures.factures; }
function echeances() { return ETAT.echeances.echeances; }
/* The tasks that link to a notes page. */
function tachesLieesAPage(pageId) {
  return taches().filter(function (t) { return Array.isArray(t.notes) && t.notes.indexOf(pageId) >= 0; });
}
function moisMeta(mois) {
  var ui = ETAT.reglages.ui;
  if (!ui.moisMeta) ui.moisMeta = {};
  if (!ui.moisMeta[mois]) ui.moisMeta[mois] = { frais: 0, joindreTravaux: true, note: '' };
  return ui.moisMeta[mois];
}
/* The data the reminders engine reads. */
function donneesRappels() {
  return { entrees: entreesJournal(), taches: taches(), echeances: echeances(), factures: factures(), chrono: ETAT.chrono ? ETAT.chrono.enCours : null };
}
