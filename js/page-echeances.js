/* ============================================================
   DEADLINES PAGE: the admin calendar and dated reminders. Each deadline
   can have its own reminder lead time (otherwise the one from Settings);
   reminders surface in the reminders centre, the dashboard and the
   desktop notifications.
   ============================================================ */
'use strict';

var TYPES_ECHEANCE = { admin: 'Admin', contrat: 'Contract', perso: 'Reminder' };
var DELAIS_RAPPEL = [['', 'General setting'], ['0', 'On the day'], ['1', 'The day before'], ['3', '3 days before'], ['7', '7 days before'], ['14', '14 days before'], ['30', '30 days before'], ['60', '60 days before']];

function initEcheances() {
  PAGES.echeances = rendreEcheances;
  var zone = document.getElementById('echeancesContenu');
  zone.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-action]');
    if (!b) return;
    var a = b.dataset.action, id = b.dataset.id;
    if (a === 'nouvelle') ouvrirEditionEcheance(null);
    else if (a === 'modifier') ouvrirEditionEcheance(id);
    else if (a === 'supprimer') supprimerEcheance(id);
    else if (a === 'rappels') ouvrirRappels();
  });
  zone.addEventListener('change', function (ev) {
    if (ev.target.matches('input[type=checkbox][data-id]')) marquerEcheanceFaite(ev.target.dataset.id, ev.target.checked);
  });
}

function echeanceParId(id) { return echeances().filter(function (e) { return e.id === id; })[0] || null; }

function marquerEcheanceFaite(id, fait) {
  var e = echeanceParId(id);
  if (!e) return;
  e.fait = !!fait;
  e.faitLe = fait ? aujourdhui() : null;
  sauver('echeances');
  rafraichir();
  if (fait) notifier('"' + e.titre + '": done.', { type: 'succes' });
}

function rendreEcheances() {
  var ref = aujourdhui();
  var liste = trierPar(echeances(), 'date');
  var retard = liste.filter(function (e) { return !e.fait && e.date < ref; });
  var aVenir = liste.filter(function (e) { return !e.fait && e.date >= ref; });
  var faites = trierPar(liste.filter(function (e) { return e.fait; }), function (e) { return e.faitLe || e.date; }, true);
  var pr = ETAT.reglages.rappels || {};

  var html = '<div class="page-entete"><div><h2 class="page-titre">Deadlines</h2>'
    + '<p class="page-sous">The tax calendar of your autónomo activity and the contract, plus your own reminders. Tick what is done. Each deadline is flagged ' + (pr.horizonEcheances != null ? pr.horizonEcheances : 7) + ' days before (or on its own lead time): on the dashboard, in the reminders centre and by notification.</p></div>'
    + '<div class="actions"><button class="btn btn-ghost" data-action="rappels">' + icone('cloche', 14) + ' Reminders</button><button class="btn" data-action="nouvelle">New deadline</button></div></div>';

  html += '<section class="card">';
  if (retard.length) html += '<div class="ec-groupe"><h3 class="ec-groupe-titre libelle neg" style="color:var(--neg);">Overdue</h3>' + retard.map(function (e) { return ligneEcheanceHtml(e, ref); }).join('') + '</div>';
  html += '<div class="ec-groupe"><h3 class="ec-groupe-titre libelle">Upcoming</h3>' + (aVenir.length ? aVenir.map(function (e) { return ligneEcheanceHtml(e, ref); }).join('') : '<div class="vide">No upcoming deadlines.</div>') + '</div>';
  if (faites.length) html += '<details class="guide-fold"><summary>' + faites.length + (faites.length > 1 ? ' deadlines done' : ' deadline done') + '</summary><div class="details-body" style="padding-top:10px;">' + faites.map(function (e) { return ligneEcheanceHtml(e, ref); }).join('') + '</div></details>';
  html += '</section>';
  document.getElementById('echeancesContenu').innerHTML = html;
}

function ligneEcheanceHtml(e, ref) {
  var j = joursEntre(ref, e.date);
  var classe = e.fait ? ' fait' : (j < 0 ? ' retard' : (j <= 14 ? ' proche' : ''));
  var quand = e.fait ? 'done on ' + dateFr(e.faitLe || e.date) : libelleDelai(j);
  var rappel = e.rappelJours != null && e.rappelJours !== '' ? '<span class="puce neutre" title="Reminder lead time specific to this deadline">' + icone('cloche', 11) + ' ' + (Number(e.rappelJours) === 0 ? 'on the day' : 'D-' + e.rappelJours) + '</span>' : '';
  return '<div class="ec-ligne' + classe + '"><input type="checkbox" data-id="' + echapper(e.id) + '"' + (e.fait ? ' checked' : '') + ' title="Mark done">'
    + '<div class="ec-date">' + libelleDate(e.date, 'moyen') + '<div class="petit" style="font-size:11.5px;">' + echapper(quand) + '</div></div>'
    + '<div><div class="ec-titre">' + echapper(e.titre) + ' <span class="puce neutre" style="margin-left:4px;">' + echapper(TYPES_ECHEANCE[e.type] || 'Reminder') + '</span>' + rappel + '</div>' + (e.detail ? '<div class="ec-detail">' + echapper(e.detail) + '</div>' : '') + '</div>'
    + '<div class="ec-actions">' + boutonIcone('modifier', 'crayon', 'Edit', '', e.id) + boutonIcone('supprimer', 'corbeille', 'Delete', 'danger', e.id) + '</div></div>';
}

function ouvrirEditionEcheance(id) {
  var e = id ? echeanceParId(id) : null;
  var v = Object.assign({ date: aujourdhui(), titre: '', detail: '', type: 'perso', rappelJours: null }, e || {});
  var rappelActuel = v.rappelJours == null || v.rappelJours === '' ? '' : String(v.rappelJours);
  var pr = ETAT.reglages.rappels || {};
  var m = ouvrirModale({
    titre: e ? 'Edit deadline' : 'New deadline',
    corps: '<div class="grid-2">' + champHtml('ecDate', 'Date', 'date', v.date)
      + '<div class="field"><label for="ecType">Type</label><select id="ecType">' + Object.keys(TYPES_ECHEANCE).map(function (k) { return '<option value="' + k + '"' + (k === v.type ? ' selected' : '') + '>' + echapper(TYPES_ECHEANCE[k]) + '</option>'; }).join('') + '</select></div>'
      + champHtml('ecTitre', 'Title', 'text', v.titre, { classe: 'span-2' })
      + champHtml('ecDetail', 'Details', 'textarea', v.detail, { classe: 'span-2', attrs: 'rows="3"' })
      + '<div class="field span-2"><label for="ecRappel">Remind me</label><select id="ecRappel">' + DELAIS_RAPPEL.map(function (d) { return '<option value="' + d[0] + '"' + (d[0] === rappelActuel ? ' selected' : '') + '>' + echapper(d[1] + (d[0] === '' ? ' (' + (pr.horizonEcheances != null ? pr.horizonEcheances : 7) + ' days before)' : '')) + '</option>'; }).join('') + '</select></div>'
      + '</div><p class="hint">The reminder appears on the dashboard and in the reminders centre, with a desktop notification, then every day from the date.</p>',
    pied: '<div class="a-droite"><button class="btn btn-ghost" data-role="annuler">Cancel</button><button class="btn" data-role="ok">Save</button></div>',
  });
  m.querySelector('[data-role=annuler]').addEventListener('click', fermerModale);
  m.querySelector('[data-role=ok]').addEventListener('click', function () {
    var titre = m.querySelector('#ecTitre').value.trim();
    var date = m.querySelector('#ecDate').value;
    if (!titre) { m.querySelector('#ecTitre').classList.add('invalide'); m.querySelector('#ecTitre').focus(); return; }
    if (!date) { m.querySelector('#ecDate').classList.add('invalide'); return; }
    var cible = e || { id: uid('ech'), fait: false, faitLe: null, creeLe: new Date().toISOString() };
    cible.date = date;
    cible.titre = titre;
    cible.detail = m.querySelector('#ecDetail').value.trim();
    cible.type = m.querySelector('#ecType').value;
    var r = m.querySelector('#ecRappel').value;
    cible.rappelJours = r === '' ? null : Number(r);
    if (!e) echeances().push(cible);
    sauver('echeances');
    fermerModale();
    rafraichir();
  });
  m.querySelector('#ecTitre').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); m.querySelector('[data-role=ok]').click(); } });
}

function supprimerEcheance(id) {
  var e = echeanceParId(id);
  if (!e) return;
  confirmer('Delete the deadline "' + e.titre + '"?', { ok: 'Delete', danger: true }).then(function (ok) {
    if (!ok) return;
    ETAT.echeances.echeances = echeances().filter(function (x) { return x.id !== id; });
    sauver('echeances');
    rafraichir();
  });
}
