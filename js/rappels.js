/* ============================================================
   RAPPELS : le centre des rappels (panneau, pastille de la barre
   latérale, section du tableau de bord), les notifications macOS et la
   pastille du Dock. Le calcul lui-même est dans js/calculs.js
   (calculerRappels) : échéances, tâches datées, mois à facturer,
   factures à encaisser, chrono oublié, journal délaissé.

   Politique des notifications natives (macOS) :
   - retards et rappels du jour : une notification par jour et par rappel ;
   - « bientôt » : une notification à l'entrée dans l'horizon, puis une
     par semaine ;
   - plusieurs rappels nouveaux à la fois sont regroupés en une seule
     notification. Rien n'est envoyé pendant l'auto-test.
   ============================================================ */
'use strict';

var RAPPELS_TIMER = null;
var CATEGORIES_RAPPEL = { echeance: 'Échéance', tache: 'Tâche', facture: 'Facturation', chrono: 'Chrono', journal: 'Journal' };
var LIBELLES_NIVEAU_RAPPEL = { retard: 'En retard', urgent: 'Aujourd\'hui', bientot: 'Bientôt' };

function initRappels() {
  var b = document.getElementById('btnRappels');
  if (b) b.addEventListener('click', ouvrirRappels);
}

function tousLesRappels() { return calculerRappels(donneesRappels(), ETAT.reglages, {}); }
function rappelsActifs() { return tousLesRappels().filter(function (r) { return !r.reporte; }); }
function rappelsReportes() { return tousLesRappels().filter(function (r) { return !!r.reporte; }); }

/* Pastille de la barre latérale et badge du Dock (retards et rappels du jour). */
function rendreBadgeRappels() {
  var actifs = rappelsActifs();
  var p = document.getElementById('pastilleRappels');
  if (p) p.textContent = actifs.length ? String(actifs.length) : '';
  var urgents = actifs.filter(function (r) { return r.niveau !== 'bientot'; }).length;
  var b = document.getElementById('btnRappels');
  if (b) b.classList.toggle('urgent', urgents > 0);
  if (estApp() && window.sablier.rappels) window.sablier.rappels.badge(urgents);
}

/* ---------- Rendu d'une liste de rappels ---------- */

function rappelHtml(r, o) {
  var quand = r.jours == null ? '' : libelleJours(r.jours);
  var niveauClasse = r.niveau === 'retard' ? 'neg' : (r.niveau === 'urgent' ? 'warn' : '');
  var actions = '<button type="button" class="btn btn-petit" data-rappel="ouvrir" data-cle="' + echapper(r.cle) + '">Ouvrir</button>';
  if (r.categorie === 'echeance' || r.categorie === 'tache') actions += '<button type="button" class="btn btn-ghost btn-petit" data-rappel="fait" data-cle="' + echapper(r.cle) + '">Fait</button>';
  if (r.reporte) actions += '<button type="button" class="btn btn-ghost btn-petit" data-rappel="reveiller" data-cle="' + echapper(r.cle) + '">Réactiver</button>';
  else actions += '<button type="button" class="btn btn-ghost btn-petit" data-rappel="demain" data-cle="' + echapper(r.cle) + '" title="Ne plus le montrer avant demain">Demain</button>'
    + '<button type="button" class="btn btn-ghost btn-petit" data-rappel="semaine" data-cle="' + echapper(r.cle) + '" title="Ne plus le montrer avant une semaine">Dans 7 jours</button>';
  return '<div class="rappel niveau-' + r.niveau + (r.reporte ? ' reporte' : '') + (o && o.cliquable ? ' cliquable' : '') + '" data-cle="' + echapper(r.cle) + '">'
    + '<div class="rappel-quand ' + niveauClasse + '">' + (quand ? '<b>' + echapper(quand) + '</b>' : '<b>' + echapper(r.niveau === 'urgent' ? 'À faire' : 'À noter') + '</b>') + (r.date ? '<span>' + echapper(libelleDate(r.date, 'jour')) + '</span>' : '') + '</div>'
    + '<div class="rappel-corps"><div class="rappel-titre">' + echapper(r.titre) + ' <span class="puce neutre">' + echapper(CATEGORIES_RAPPEL[r.categorie] || r.categorie) + '</span>' + (r.reporte ? ' <span class="puce or">reporté au ' + dateFr(r.reporte) + '</span>' : '') + '</div>'
    + (r.detail ? '<div class="rappel-detail">' + echapper(r.detail) + '</div>' : '') + '</div>'
    + (o && o.sansActions ? '' : '<div class="rappel-actions">' + actions + '</div>')
    + '</div>';
}
function listeRappelsHtml(liste, o) {
  if (!liste.length) return '<div class="vide">Rien à signaler.</div>';
  return '<div class="rappels-liste">' + liste.map(function (r) { return rappelHtml(r, o); }).join('') + '</div>';
}

/* ---------- Panneau ---------- */

function ouvrirRappels() {
  var nbActifs = rappelsActifs().length;
  var m = ouvrirModale({ titre: 'Rappels', classe: 'modal-wide modal-rappels', sousTitre: nbActifs + (nbActifs > 1 ? ' rappels actifs' : ' rappel actif'), corps: '', pied: '<span class="petit" id="rpReglage"></span><div class="a-droite"><button class="btn btn-ghost" data-role="reglages">Réglages des rappels</button><button class="btn" data-role="fermer">Fermer</button></div>', sansFocus: true });
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
  if (!actifs.length) html += '<div class="vide" style="padding:28px 8px;">Rien à rattraper, rien d\'urgent : tout est à jour.</div>';
  if (reportes.length) html += '<details class="guide-fold" style="margin-top:14px;"><summary>' + reportes.length + (reportes.length > 1 ? ' rappels reportés' : ' rappel reporté') + '</summary><div class="details-body" style="padding-top:10px;">' + listeRappelsHtml(reportes) + '</div></details>';
  m.querySelector('.modal-body').innerHTML = html;
  var sousTitre = m.querySelector('.modal-subtitle');
  if (sousTitre) sousTitre.textContent = actifs.length + (actifs.length > 1 ? ' rappels actifs' : ' rappel actif');
  var reg = m.querySelector('#rpReglage');
  if (reg) reg.textContent = 'Échéances rappelées ' + (pr.horizonEcheances != null ? pr.horizonEcheances : 7) + ' jours avant, tâches ' + (pr.horizonTaches != null ? pr.horizonTaches : 3) + ' jours avant · notifications macOS ' + (pr.natives === false ? 'désactivées' : 'actives');
}

/* Ouvre l'écran concerné par un rappel. */
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
    if (t) { appliquerStatut(t, 'fait'); t.ordre = ordreSuivant('fait'); sauver('chantiers'); rafraichir(); notifier('« ' + t.titre +' » marquée faite.', { type: 'succes' }); }
  }
  rendrePanneauRappels();
}

/* Reporte un rappel de n jours (0 : le réactive). */
function reporterRappel(cle, jours) {
  var ui = ETAT.reglages.ui;
  if (!ui.rappelsReportes) ui.rappelsReportes = {};
  if (jours > 0) ui.rappelsReportes[cle] = ajouterJours(aujourdhui(), jours);
  else delete ui.rappelsReportes[cle];
  sauver('reglages');
  rafraichir();
  rendrePanneauRappels();
}

/* ---------- Notifications macOS ---------- */

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
    window.sablier.rappels.notifier({ titre: 'Sablier : ' + rappels.length + ' rappels', corps: rappels.map(function (x) { return x.titre; }).join(' · ').slice(0, 220) });
  }
}

/* Vérifie les rappels et notifie ce qui est nouveau depuis la dernière
   fois ; appelé au démarrage puis toutes les minutes. */
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
    /* On oublie les traces de plus de trois mois. */
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

/* Bouton des réglages : une notification d'essai. */
function testerNotificationNative() {
  if (!estApp() || !window.sablier.rappels) { notifier('Disponible dans l\'application macOS.'); return; }
  window.sablier.rappels.notifier({ titre: 'Sablier : notification d\'essai', corps: 'Les rappels arriveront ainsi, dans le centre de notifications du Mac.' }).then(function (ok) {
    notifier(ok ? 'Notification envoyée. Si rien n\'apparaît, autorisez Sablier dans Réglages Système › Notifications.' : 'Les notifications ne sont pas disponibles sur ce Mac.', { duree: 7000 });
  });
}
