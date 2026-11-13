/* ============================================================
   REMINDERS: the reminders centre (panel, sidebar badge, dashboard
   section), desktop notifications and the app badge. The computation
   itself is in js/calculs.js (calculerRappels): deadlines, dated tasks,
   months to invoice, invoices to collect, forgotten timer, neglected log.

   Native notification policy:
   - overdue and today's reminders: one notification per day per reminder;
   - "soon": one notification on entering the horizon, then one per week;
   - several new reminders at once are grouped into a single
     notification. Nothing is sent during the self-test.
   ============================================================ */
'use strict';

var RAPPELS_TIMER = null;
var CATEGORIES_RAPPEL = { echeance: 'Deadline', tache: 'Task', facture: 'Invoicing', chrono: 'Timer', journal: 'Log' };
var LIBELLES_NIVEAU_RAPPEL = { retard: 'Overdue', urgent: 'Today', bientot: 'Soon' };

function initRappels() {
  var b = document.getElementById('btnRappels');
  if (b) b.addEventListener('click', ouvrirRappels);
}

function tousLesRappels() { return calculerRappels(donneesRappels(), ETAT.reglages, {}); }
function rappelsActifs() { return tousLesRappels().filter(function (r) { return !r.reporte; }); }
function rappelsReportes() { return tousLesRappels().filter(function (r) { return !!r.reporte; }); }

/* Sidebar badge and app badge (overdue and today's reminders). */
function rendreBadgeRappels() {
  var actifs = rappelsActifs();
  var p = document.getElementById('pastilleRappels');
  if (p) p.textContent = actifs.length ? String(actifs.length) : '';
  var urgents = actifs.filter(function (r) { return r.niveau !== 'bientot'; }).length;
  var b = document.getElementById('btnRappels');
  if (b) b.classList.toggle('urgent', urgents > 0);
  if (estApp() && window.sablier.rappels) window.sablier.rappels.badge(urgents);
}

/* ---------- Rendering a list of reminders ---------- */

function rappelHtml(r, o) {
  var quand = r.jours == null ? '' : libelleJours(r.jours);
  var niveauClasse = r.niveau === 'retard' ? 'neg' : (r.niveau === 'urgent' ? 'warn' : '');
  var actions = '<button type="button" class="btn btn-petit" data-rappel="ouvrir" data-cle="' + echapper(r.cle) + '">Open</button>';
  if (r.categorie === 'echeance' || r.categorie === 'tache') actions += '<button type="button" class="btn btn-ghost btn-petit" data-rappel="fait" data-cle="' + echapper(r.cle) + '">Done</button>';
  if (r.reporte) actions += '<button type="button" class="btn btn-ghost btn-petit" data-rappel="reveiller" data-cle="' + echapper(r.cle) + '">Restore</button>';
  else actions += '<button type="button" class="btn btn-ghost btn-petit" data-rappel="demain" data-cle="' + echapper(r.cle) + '" title="Hide until tomorrow">Tomorrow</button>'
    + '<button type="button" class="btn btn-ghost btn-petit" data-rappel="semaine" data-cle="' + echapper(r.cle) + '" title="Hide for a week">In 7 days</button>';
  return '<div class="rappel niveau-' + r.niveau + (r.reporte ? ' reporte' : '') + (o && o.cliquable ? ' cliquable' : '') + '" data-cle="' + echapper(r.cle) + '">'
    + '<div class="rappel-quand ' + niveauClasse + '">' + (quand ? '<b>' + echapper(quand) + '</b>' : '<b>' + echapper(r.niveau === 'urgent' ? 'To do' : 'Note') + '</b>') + (r.date ? '<span>' + echapper(libelleDate(r.date, 'jour')) + '</span>' : '') + '</div>'
    + '<div class="rappel-corps"><div class="rappel-titre">' + echapper(r.titre) + ' <span class="puce neutre">' + echapper(CATEGORIES_RAPPEL[r.categorie] || r.categorie) + '</span>' + (r.reporte ? ' <span class="puce or">snoozed until ' + dateFr(r.reporte) + '</span>' : '') + '</div>'
    + (r.detail ? '<div class="rappel-detail">' + echapper(r.detail) + '</div>' : '') + '</div>'
    + (o && o.sansActions ? '' : '<div class="rappel-actions">' + actions + '</div>')
    + '</div>';
}
function listeRappelsHtml(liste, o) {
  if (!liste.length) return '<div class="vide">Nothing to report.</div>';
  return '<div class="rappels-liste">' + liste.map(function (r) { return rappelHtml(r, o); }).join('') + '</div>';
}

/* ---------- Panel ---------- */

function ouvrirRappels() {
  var nbActifs = rappelsActifs().length;
  var m = ouvrirModale({ titre: 'Reminders', classe: 'modal-wide modal-rappels', sousTitre: nbActifs + (nbActifs > 1 ? ' active reminders' : ' active reminder'), corps: '', pied: '<span class="petit" id="rpReglage"></span><div class="a-droite"><button class="btn btn-ghost" data-role="reglages">Reminder settings</button><button class="btn" data-role="fermer">Close</button></div>', sansFocus: true });
  m.querySelector('[data-role=fermer]').addEventListener('click', fermerModale);
  m.querySelector('[data-role=reglages]').addEventListener('click', function () { fermerModale(); afficherPage('reglages'); var bloc = document.getElementById('reglRappels'); if (bloc) bloc.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  m.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-rappel]');
    if (!b) return;
    var cle = b.dataset.cle;
    var r = tousLesRappels().filter(function (x) { return x.cle === cle; })[0];
    var a = b.dataset.rappel;
    if (a === 'ouvrir' && r) { fermerModale(); actionRappel(r); }
    else if (a === 'fait' && r) marquerRappelFait(r);
    else if (a === 'demain') reporterRappel(cle, 1);
    else if (a === 'semaine') reporterRappel(cle, 7);
    else if (a === 'reveiller') reporterRappel(cle, 0);
  });
  rendrePanneauRappels();
}

function rendrePanneauRappels() {
  var m = document.querySelector('.modal-rappels');
  if (!m) return;
  var tous = tousLesRappels();
  var actifs = tous.filter(function (r) { return !r.reporte; });
  var reportes = tous.filter(function (r) { return !!r.reporte; });
  var pr = ETAT.reglages.rappels || {};
  var html = '';
  ['retard', 'urgent', 'bientot'].forEach(function (niveau) {
    var l = actifs.filter(function (r) { return r.niveau === niveau; });
    if (!l.length) return;
    html += '<div class="rappels-groupe"><h4 class="libelle niveau-' + niveau + '">' + LIBELLES_NIVEAU_RAPPEL[niveau] + ' <span class="nb">' + l.length + '</span></h4>' + listeRappelsHtml(l) + '</div>';
  });
  if (!actifs.length) html += '<div class="vide" style="padding:28px 8px;">Nothing to catch up on, nothing urgent: you are all up to date.</div>';
  if (reportes.length) html += '<details class="guide-fold" style="margin-top:14px;"><summary>' + reportes.length + (reportes.length > 1 ? ' snoozed reminders' : ' snoozed reminder') + '</summary><div class="details-body" style="padding-top:10px;">' + listeRappelsHtml(reportes) + '</div></details>';
  m.querySelector('.modal-body').innerHTML = html;
  var sousTitre = m.querySelector('.modal-subtitle');
  if (sousTitre) sousTitre.textContent = actifs.length + (actifs.length > 1 ? ' active reminders' : ' active reminder');
  var reg = m.querySelector('#rpReglage');
  if (reg) reg.textContent = 'Deadlines flagged ' + (pr.horizonEcheances != null ? pr.horizonEcheances : 7) + ' days ahead, tasks ' + (pr.horizonTaches != null ? pr.horizonTaches : 3) + ' days ahead · desktop notifications ' + (pr.natives === false ? 'off' : 'on');
}

/* Opens the screen a reminder refers to. */
function actionRappel(r) {
  if (r.categorie === 'echeance') { afficherPage('echeances'); if (r.cibleId) setTimeout(function () { var el = document.querySelector('.ec-ligne input[data-id="' + r.cibleId + '"]'); if (el) el.closest('.ec-ligne').scrollIntoView({ block: 'center' }); }, 50); }
  else if (r.categorie === 'tache') { afficherPage('taches'); if (r.cibleId) ouvrirEditionTache(r.cibleId); }
  else if (r.categorie === 'facture') {
    if (r.cle.indexOf('facturer:') === 0) { RELEVE_MOIS = r.cibleId; afficherPage('releve'); }
    else afficherPage('factures');
  }
  else afficherPage('journal');
}

function marquerRappelFait(r) {
  if (r.categorie === 'echeance') marquerEcheanceFaite(r.cibleId, true);
  else if (r.categorie === 'tache') {
    var t = tacheParId(r.cibleId);
    if (t) { appliquerStatut(t, 'fait'); t.ordre = ordreSuivant('fait'); sauver('chantiers'); rafraichir(); notifier('"' + t.titre + '" marked done.', { type: 'succes' }); }
  }
  rendrePanneauRappels();
}

/* Snoozes a reminder for n days (0: restores it). */
function reporterRappel(cle, jours) {
  var ui = ETAT.reglages.ui;
  if (!ui.rappelsReportes) ui.rappelsReportes = {};
  if (jours > 0) ui.rappelsReportes[cle] = ajouterJours(aujourdhui(), jours);
  else delete ui.rappelsReportes[cle];
  sauver('reglages');
  rafraichir();
  rendrePanneauRappels();
}

/* ---------- Desktop notifications ---------- */

function notificationsNativesActives() {
  var pr = ETAT.reglages.rappels || {};
  return estApp() && !!window.sablier.rappels && !window.sablier.smoke && pr.natives !== false;
}

function notifierNativement(rappels) {
  if (!notificationsNativesActives() || !rappels.length) return;
  if (rappels.length === 1) {
    var r = rappels[0];
    window.sablier.rappels.notifier({ titre: r.titre, corps: [r.jours != null ? libelleJours(r.jours) + (r.date ? ' · ' + libelleDate(r.date, 'jour') : '') : '', r.detail].filter(Boolean).join(' · ').slice(0, 220) });
  } else {
    window.sablier.rappels.notifier({ titre: 'Sablier: ' + rappels.length + ' reminders', corps: rappels.map(function (x) { return x.titre; }).join(' · ').slice(0, 220) });
  }
}

/* Checks the reminders and notifies what is new since the last time;
   called at startup, then every minute. */
function verifierRappels(auDemarrage) {
  var ref = aujourdhui();
  var ui = ETAT.reglages.ui;
  var pr = ETAT.reglages.rappels || {};
  if (!ui.rappelsNotifies) ui.rappelsNotifies = {};
  var actifs = rappelsActifs();
  var aNotifier = actifs.filter(function (r) {
    var dernier = ui.rappelsNotifies[r.cle + '|' + r.niveau];
    if (r.niveau === 'bientot') return !dernier || joursEntre(dernier, ref) >= 7;
    return dernier !== ref;
  });
  var silencieux = auDemarrage && pr.auDemarrage === false;
  if (aNotifier.length) {
    if (!silencieux) notifierNativement(aNotifier);
    aNotifier.forEach(function (r) { ui.rappelsNotifies[r.cle + '|' + r.niveau] = ref; });
    /* Traces older than three months are forgotten. */
    Object.keys(ui.rappelsNotifies).forEach(function (k) { if (joursEntre(ui.rappelsNotifies[k], ref) > 90) delete ui.rappelsNotifies[k]; });
    if (ui.rappelsReportes) Object.keys(ui.rappelsReportes).forEach(function (k) { if (ui.rappelsReportes[k] <= ref) delete ui.rappelsReportes[k]; });
    sauver('reglages');
  }
  rendreBadgeRappels();
}

function lancerVeilleRappels() {
  clearInterval(RAPPELS_TIMER);
  verifierRappels(true);
  RAPPELS_TIMER = setInterval(function () { verifierRappels(false); }, 60000);
}

/* Settings button: a test notification. */
function testerNotificationNative() {
  if (!estApp() || !window.sablier.rappels) { notifier('Only available in the desktop app.'); return; }
  window.sablier.rappels.notifier({ titre: 'Sablier: test notification', corps: 'Reminders will arrive like this, in your desktop notification centre.' }).then(function (ok) {
    notifier(ok ? 'Notification sent. If nothing shows up, allow Sablier in your system notification settings.' : 'Notifications are not available on this computer.', { duree: 7000 });
  });
}
