/* ============================================================
   LOG: work entries (shown day by day in the "Log and statement"
   page), entry sheet and timer.
   ============================================================ */
'use strict';

var CHRONO_TIMER = null;

function initJournal() {
  document.getElementById('chronoBandeau').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'pause') basculerPauseChrono();
    else if (b.dataset.action === 'arreter') arreterChrono();
  });
}

/* The "Log and statement" page moves to the month that bills the entry,
   with its day expanded. */
function montrerLigne(e) {
  RELEVE_MOIS = moisFacturationDe(e);
  RELEVE_JOURS[e.date] = true;
}

/* The typed duration wins; start and end only serve to prefill it. */
function dureeSaisie(dureeTxt, debut, fin) {
  var minutes = parseDuree(dureeTxt);
  if (minutes != null) return { minutes: minutes, depuisHoraires: false };
  if (debut && fin) return { minutes: minutesEntre(debut, fin), depuisHoraires: true };
  return { minutes: null, depuisHoraires: false };
}
var MAX_MINUTES_HORAIRES = 16 * 60;   // beyond this, an end before the start is more likely than a night of work

function ligneJournalHtml(e) {
  var heure = e.debut && e.fin ? e.debut + ' to ' + e.fin : (e.debut ? 'from ' + e.debut : 'duration entered');
  var moisF = moisFacturationDe(e);
  var reportee = estReporte(e);
  var chips = (e.facturable === false ? '<span class="puce neutre" title="' + echapper(e.motif || '') + '">non-billable</span>' : '')
    + (forfaitEntree(e) != null && e.facturable !== false ? '<span class="puce or">flat fee ' + fmtEuros(forfaitEntree(e)) + '</span>' : '')
    + (reportee ? '<span class="puce" title="Work done on ' + dateFr(e.date) + ', carried on the ' + echapper(libelleMois(moisF)) + ' statement">'
        + 'moved to ' + echapper(libelleMoisSeul(moisF)) + '</span>' : '');
  var tacheLiee = e.tache ? tacheParId(e.tache) : null;
  if (tacheLiee) chips += '<button type="button" class="puce tache" data-action="tache" title="Open the task &quot;' + echapper(tacheLiee.titre) + '&quot;">' + icone('coche', 11) + echapper(tacheLiee.titre) + '</button>';
  var detail = [e.detail, e.facturable === false && e.motif ? e.motif : ''].filter(Boolean).join(' · ');
  return '<div class="jr-ligne' + (e.facturable === false ? ' non-facturable' : '') + '" data-id="' + echapper(e.id) + '">'
    + '<div class="jr-heure">' + echapper(heure) + '</div>'
    + '<div class="jr-contenu"><div class="jr-intervention">' + puceAxeHtml(e.axe) + '<span>' + echapper(e.intervention) + '</span>' + chips + '</div>'
    + (detail ? '<div class="jr-detail">' + echapper(detail) + '</div>' : '') + '</div>'
    + '<div class="jr-duree">' + fmtDuree(dureeEntree(e)) + '</div>'
    + '<div class="jr-actions">'
    + boutonIcone('reprendre', 'play', 'Resume with the timer')
    + boutonIcone('modifier', 'crayon', 'Edit')
    + boutonIcone('dupliquer', 'copie', 'Duplicate to today')
    + boutonIcone('supprimer', 'corbeille', 'Delete', 'danger')
    + '</div></div>';
}

function clicListeJournal(ev) {
  var b = ev.target.closest('button[data-action]');
  if (!b) return;
  var action = b.dataset.action;
  if (action === 'arreter-chrono') { arreterChrono(); return; }
  if (action === 'pause-chrono') { basculerPauseChrono(); return; }
  var ligne = b.closest('.jr-ligne');
  var e = entreeParId(ligne && ligne.dataset.id);
  if (!e) return;
  if (action === 'modifier') ouvrirEditionEntree(e.id);
  else if (action === 'tache') { if (e.tache && tacheParId(e.tache)) ouvrirEditionTache(e.tache); }
  else if (action === 'reprendre') demarrerChrono({ axe: e.axe, intervention: e.intervention, detail: e.detail, tache: e.tache });
  else if (action === 'dupliquer') {
    /* The copy keeps neither the flat fee nor the billing month: a fixed
       amount and a move to another month must not be duplicated by accident. */
    var copie = Object.assign({}, e, { id: uid('ent'), date: aujourdhui(), debut: '', fin: '', forfait: null, moisFacturation: null, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString() });
    entreesJournal().push(copie);
    heriterMoisFacturation(copie);
    sauver('journal');
    montrerLigne(copie);
    rafraichir();
    notifier('Entry duplicated to today.', { action: { libelle: 'Edit', fn: function () { ouvrirEditionEntree(copie.id); } } });
  }
  else if (action === 'supprimer') {
    var fac = factureDeEntree(factures(), e.id);
    if (fac) { notifier('This entry is locked on invoice no. ' + fac.numero + ': delete the invoice first (latest invoice only).', { type: 'erreur', duree: 7000 }); return; }
    confirmer('Delete this entry (' + fmtDuree(dureeEntree(e)) + ', ' + e.intervention + ')?', { ok: 'Delete', danger: true, titre: 'Delete an entry' }).then(function (ok) {
      if (!ok) return;
      ETAT.journal.entrees = entreesJournal().filter(function (x) { return x.id !== e.id; });
      sauver('journal');
      rafraichir();
      notifier('Entry deleted.');
    });
  }
}

function entreeParId(id) {
  return entreesJournal().filter(function (e) { return e.id === id; })[0] || null;
}

/* ---------- Edit modal ---------- */

function ouvrirEditionEntree(id, prefill) {
  var e = id ? entreeParId(id) : null;
  if (id && !e) return;
  var v = Object.assign({ date: aujourdhui(), axe: ETAT.reglages.ui.dernierAxe, intervention: '', detail: '', debut: '', fin: '', minutes: null, moisFacturation: null, tache: null }, prefill || {}, e || {});
  /* An entry locked on an invoice no longer changes date, area, duration
     or billing: only the label and details remain editable. */
  var fac = e ? factureDeEntree(factures(), e.id) : null;
  /* The billing month belongs to the whole work item: it is locked as soon
     as a single one of its entries is carried by an invoice. */
  var moisTravail = moisDe(v.date) || moisCourant();
  var moisFact = moisFacturationDe(v) || moisTravail;
  var interFigee = !fac && e && interventionFigee(e);
  var verrouMois = fac ? 'Entry locked on invoice no. ' + fac.numero + ': the billing month can no longer change.'
    : (interFigee ? 'Another entry of this work item is already carried by an invoice: the billing month can no longer change.' : '');
  var m = ouvrirModale({
    titre: e ? 'Edit an entry' : 'New log entry',
    sousTitre: e ? 'Entry of ' + libelleDate(e.date, 'moyen') : '',
    corps: (fac ? '<div class="alert alert-info" style="margin-bottom:14px;"><span>Entry locked on invoice no. <b>' + echapper(fac.numero) + '</b>: the date, area, duration, billing month and billing can no longer be edited. To change them, delete the invoice first (latest invoice only).</span></div>' : '')
      + '<div class="grid-2">'
      + champHtml('edDate', 'Date', 'date', v.date)
      + '<div class="field"><label for="edAxe">Area</label><select id="edAxe">' + optionsAxesHtml(v.axe) + '</select></div>'
      + champHtml('edIntervention', 'Work item', 'text', v.intervention, { classe: 'span-2', attrs: 'list="jrInterventionsListe"' })
      + champHtml('edDetail', 'Details (optional)', 'text', v.detail, { classe: 'span-2' })
      + champHtml('edDebut', 'Start', 'time', v.debut)
      + champHtml('edFin', 'End', 'time', v.fin)
      + champHtml('edDuree', 'Duration', 'text', v.minutes != null ? fmtDuree(v.minutes) : '', { attrs: 'placeholder="e.g. 1h30, 45 min, 2.5"' })
      + '<div class="field"><label>Billing</label><label class="field-ligne" style="padding:6px 0;"><input type="checkbox" id="edNonFacturable"' + (v.facturable === false ? ' checked' : '') + '> <span>Non-billable (€0, the time is still counted)</span></label></div>'
      + champHtml('edMotif', 'Reason (if non-billable)', 'text', v.motif || '', { attrs: 'placeholder="e.g. internship, goodwill gesture"' })
      + champHtml('edForfait', 'Flat fee excl. VAT in € (optional, replaces hours × rate)', 'text', v.forfait != null ? fmtNombreSaisie(v.forfait, 2) : '', { attrs: 'inputmode="decimal" placeholder="e.g. 600 or 600.50"' })
      + '<div class="field span-2"><label for="edTache">Linked task</label><select id="edTache">' + optionsTachesHtml(v.tache) + '</select>'
      + '<p class="hint">The time of this entry is added to the task\'s time spent, in its sheet.</p></div>'
      + '<div class="field span-2"><label for="edMoisFacturation">Billing month</label>'
      + selectMoisHtml('edMoisFacturation', moisFact, { liste: moisFacturationPossibles(moisTravail, moisFact), pleineLargeur: true })
      + '<p class="hint" id="edAideMois">' + echapper(verrouMois || aideMoisFacturation(moisTravail, moisFact)) + '</p></div>'
      + '</div><p class="hint" id="edAide"></p>',
    pied: (e && !fac ? '<button class="btn btn-danger-ligne btn-petit" data-role="supprimer">Delete</button>' : '')
      + '<div class="a-droite"><button class="btn btn-ghost" data-role="annuler">Cancel</button><button class="btn" data-role="ok">Save</button></div>',
  });
  var sup = m.querySelector('[data-role=supprimer]');
  if (sup) sup.addEventListener('click', function () {
    fermerModale();
    confirmer('Delete this entry (' + fmtDuree(dureeEntree(e)) + ', ' + e.intervention + ')?', { ok: 'Delete', danger: true, titre: 'Delete an entry' }).then(function (ok) {
      if (!ok) return;
      ETAT.journal.entrees = entreesJournal().filter(function (x) { return x.id !== e.id; });
      sauver('journal');
      rafraichir();
      notifier('Entry deleted.');
    });
  });
  if (fac) ['edDate', 'edAxe', 'edDebut', 'edFin', 'edDuree', 'edNonFacturable', 'edMotif', 'edForfait', 'edMoisFacturation'].forEach(function (idc) { var el = m.querySelector('#' + idc); if (el) el.disabled = true; });
  var champMois = m.querySelector('#edMoisFacturation');
  /* A work item that is already partly invoiced keeps its date and month. */
  if (interFigee) { champMois.disabled = true; m.querySelector('#edDate').disabled = true; }
  var majDuree = function () {
    var d = m.querySelector('#edDebut').value, f = m.querySelector('#edFin').value;
    if (d && f) m.querySelector('#edDuree').value = fmtDuree(minutesEntre(d, f));
  };
  m.querySelector('#edDebut').addEventListener('change', majDuree);
  m.querySelector('#edFin').addEventListener('change', majDuree);
  /* The month follows the date until it has been chosen by hand. */
  var moisLibre = !moisValide(v.moisFacturation);
  m.querySelector('#edDate').addEventListener('change', function () {
    var mt = moisDe(this.value);
    if (!mt || champMois.disabled) return;
    var garde = moisLibre || champMois.value < mt ? mt : champMois.value;
    champMois.innerHTML = optionsMoisHtml(moisFacturationPossibles(mt, garde), garde);
    champMois.value = garde;
    m.querySelector('#edAideMois').textContent = aideMoisFacturation(mt, champMois.value);
  });
  champMois.addEventListener('change', function () {
    moisLibre = false;
    m.querySelector('#edAideMois').textContent = aideMoisFacturation(moisDe(m.querySelector('#edDate').value), this.value);
  });
  m.querySelector('#edTache').addEventListener('change', function () {
    var t = this.value ? tacheParId(this.value) : null;
    if (!t) return;
    var selAxe = m.querySelector('#edAxe');
    if (t.axe && !selAxe.disabled) selAxe.value = t.axe;
    var inter = m.querySelector('#edIntervention');
    if (!inter.value.trim()) inter.value = t.titre;
  });
  m.querySelector('[data-role=annuler]').addEventListener('click', fermerModale);
  m.querySelector('[data-role=ok]').addEventListener('click', function () {
    var intervention = m.querySelector('#edIntervention').value.trim();
    var tacheChoisie = m.querySelector('#edTache').value || null;
    if (!intervention) { m.querySelector('#edIntervention').classList.add('invalide'); m.querySelector('#edIntervention').focus(); return; }
    if (fac) {
      /* Invoiced entry: only label, details and linked task. */
      e.intervention = intervention;
      e.detail = m.querySelector('#edDetail').value.trim();
      e.tache = tacheChoisie;
      e.modifieLe = new Date().toISOString();
      sauver('journal');
      fermerModale();
      rafraichir();
      notifier('Label updated (invoiced entry: the rest is locked).', { type: 'succes' });
      return;
    }
    var debut = m.querySelector('#edDebut').value, fin = m.querySelector('#edFin').value;
    var d = dureeSaisie(m.querySelector('#edDuree').value, debut, fin);
    var minutes = d.minutes;
    var date = m.querySelector('#edDate').value;
    if (!date) { m.querySelector('#edDate').classList.add('invalide'); return; }
    if (!(minutes > 0)) { m.querySelector('#edDuree').classList.add('invalide'); m.querySelector('#edAide').textContent = 'Enter a duration, or a start and an end.'; return; }
    if (d.depuisHoraires && minutes > MAX_MINUTES_HORAIRES) { m.querySelector('#edFin').classList.add('invalide'); m.querySelector('#edAide').textContent = 'The times give ' + fmtDuree(minutes) + ': end before the start? Check them, or type the duration.'; return; }
    var forfaitTxt = m.querySelector('#edForfait').value.trim();
    var forfait = forfaitTxt ? lireMontant(forfaitTxt) : null;
    if (forfaitTxt && forfait == null) { m.querySelector('#edForfait').classList.add('invalide'); m.querySelector('#edAide').textContent = 'Flat fee not understood (e.g. 600 or 600.50).'; return; }
    var cible = e || { id: uid('ent'), creeLe: new Date().toISOString(), tache: (prefill && prefill.tache) || null };
    cible.date = date;
    cible.axe = m.querySelector('#edAxe').value;
    cible.intervention = intervention;
    cible.detail = m.querySelector('#edDetail').value.trim();
    cible.tache = tacheChoisie;
    cible.debut = debut || '';
    cible.fin = fin || '';
    cible.minutes = minutes;
    cible.facturable = !m.querySelector('#edNonFacturable').checked;
    cible.motif = cible.facturable ? '' : m.querySelector('#edMotif').value.trim();
    cible.forfait = forfait != null && forfait > 0 ? arrondir2(forfait) : null;
    var moisT = moisDe(date);
    if (!champMois.disabled) {
      var choix = champMois.value;
      cible.moisFacturation = choix && choix !== moisT ? choix : null;
    }
    /* A billing month before the work makes no sense: the date may have
       moved after the month was chosen. */
    if (cible.moisFacturation && cible.moisFacturation < moisT) cible.moisFacturation = null;
    cible.modifieLe = new Date().toISOString();
    if (!e) entreesJournal().push(cible);
    /* The billing month belongs to the whole work item, not to the entry.
       If a sibling is already carried by an invoice, the entry joins it so
       that the work item does not straddle two months. */
    var soeurs = lignesMemeIntervention(cible).filter(function (x) { return x.id !== cible.id; });
    var figee = soeurs.filter(function (x) { return !peutReporter(x, factures()); })[0];
    var adopte = '';
    if (figee) {
      var mf = moisFacturationDe(figee);
      var voulu = mf && mf !== moisT ? mf : null;
      if ((cible.moisFacturation || null) !== voulu) { cible.moisFacturation = voulu; adopte = mf; }
    }
    sauver('journal');
    var divergentes = soeurs.filter(function (x) { return moisFacturationDe(x) !== moisFacturationDe(cible); });
    var suivies = divergentes.length ? appliquerMoisFacturation(divergentes, cible.moisFacturation) : 0;
    fermerModale();
    montrerLigne(cible);
    rafraichir();
    var suite = adopte ? ' This work item is already carried by an invoice for ' + libelleMois(adopte) + ': the entry is attached to it.'
      : (suivies ? ' The ' + (suivies + 1) + ' entries of this work item are billed in ' + libelleMois(moisFacturationDe(cible)) + '.' : '');
    notifier((e ? 'Entry updated.' : 'Entry saved.') + suite, { type: 'succes', duree: suite ? 9000 : undefined });
  });
  m.querySelectorAll('input').forEach(function (i) {
    i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); m.querySelector('[data-role=ok]').click(); } });
  });
}

/* ---------- Timer ----------
   State (chrono.json): { debut, axe, intervention, detail, tache,
   pauseDepuis (ISO or null), pauseCumuleeMs }. The measured time excludes
   pauses; the timer survives closing the application. */

function chronoEnCours() { return ETAT.chrono && ETAT.chrono.enCours ? ETAT.chrono.enCours : null; }
function chronoEnPause() { var c = chronoEnCours(); return !!(c && c.pauseDepuis); }

function dureeChronoMs(c) {
  if (!c) return 0;
  var fin = c.pauseDepuis ? new Date(c.pauseDepuis).getTime() : Date.now();
  return Math.max(0, fin - new Date(c.debut).getTime() - (c.pauseCumuleeMs || 0));
}
function texteChrono(c) {
  var s = Math.floor(dureeChronoMs(c) / 1000);
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return deuxChiffres(h) + ':' + deuxChiffres(m) + ':' + deuxChiffres(r);
}
function heureDebutChrono(c) {
  var d = new Date(c.debut);
  return deuxChiffres(d.getHours()) + ':' + deuxChiffres(d.getMinutes());
}
function libelleChrono(c) { return String(c.intervention || '').trim() || 'No label'; }

/* Starts a timer; a timer already running is stopped and saved first.
   The label can stay empty: it will be asked for on stop. */
function demarrerChrono(o) {
  var precedent = null;
  if (chronoEnCours()) {
    var sansLibelle = !String(chronoEnCours().intervention || '').trim();
    var ligne = arreterChrono(true);
    if (ligne && sansLibelle) precedent = ligne;
  }
  ETAT.chrono.enCours = {
    debut: new Date().toISOString(),
    axe: (typeof axeParDefaut === 'function') ? axeParDefaut(o.axe) : (o.axe || ETAT.reglages.ui.dernierAxe || (axes()[0] && axes()[0].id) || ''),
    intervention: String(o.intervention || '').trim(),
    detail: String(o.detail || '').trim(),
    tache: o.tache || null,
    pauseDepuis: null,
    pauseCumuleeMs: 0,
  };
  sauver('chrono');
  lancerTicChrono();
  rafraichir();
  var c = ETAT.chrono.enCours;
  if (precedent) {
    notifier('Timer started. The previous one, with no label (' + fmtDuree(precedent.minutes) + '), was saved as "Work item".', { duree: 9000, action: { libelle: 'Name the entry', fn: function () { ouvrirEditionEntree(precedent.id); } } });
  } else {
    notifier(c.intervention ? 'Timer started: ' + c.intervention : 'Timer started. You will name the work item when you stop.');
  }
}

function mettreEnPauseChrono() {
  var c = chronoEnCours();
  if (!c || c.pauseDepuis) return;
  c.pauseDepuis = new Date().toISOString();
  sauver('chrono');
  rafraichir();
}
function reprendreChrono() {
  var c = chronoEnCours();
  if (!c || !c.pauseDepuis) return;
  c.pauseCumuleeMs = (c.pauseCumuleeMs || 0) + Math.max(0, Date.now() - new Date(c.pauseDepuis).getTime());
  c.pauseDepuis = null;
  sauver('chrono');
  lancerTicChrono();
  rafraichir();
}
function basculerPauseChrono() {
  if (!chronoEnCours()) return;
  if (chronoEnPause()) reprendreChrono(); else mettreEnPauseChrono();
}

/* Stops the timer and saves the entry: one minute at least, so that
   nothing is lost (the entry can be edited or deleted afterwards). */
function arreterChrono(silencieux) {
  var c = chronoEnCours();
  if (!c) return null;
  /* A timer stopped during a pause ends when the pause began. */
  var debut = new Date(c.debut), fin = c.pauseDepuis ? new Date(c.pauseDepuis) : new Date();
  if (isNaN(debut.getTime())) debut = new Date();
  if (isNaN(fin.getTime()) || fin < debut) fin = new Date();
  var minutes = Math.max(1, Math.round(dureeChronoMs(c) / 60000));
  var libelle = String(c.intervention || '').trim();
  ETAT.chrono.enCours = null;
  sauver('chrono');
  lancerTicChrono();
  var e = {
    id: uid('ent'), date: dateVersIso(debut), axe: c.axe, intervention: libelle || 'Work item', detail: c.detail || '',
    debut: deuxChiffres(debut.getHours()) + ':' + deuxChiffres(debut.getMinutes()),
    fin: deuxChiffres(fin.getHours()) + ':' + deuxChiffres(fin.getMinutes()),
    minutes: minutes, tache: c.tache || null,
    creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(),
  };
  entreesJournal().push(e);
  heriterMoisFacturation(e);
  sauver('journal');
  montrerLigne(e);
  rafraichir();
  if (!silencieux) {
    if (!libelle && modaleOuverte()) {
      /* A modal is open (invoice, task sheet...): do not close it. */
      notifier('Timer stopped: ' + fmtDuree(minutes) + ' saved as "Work item".', { type: 'succes', duree: 9000, action: { libelle: 'Name the entry', fn: function () { ouvrirEditionEntree(e.id); } } });
    } else if (!libelle) {
      notifier('Timer stopped: ' + fmtDuree(minutes) + ' saved. Give the entry a label.', { type: 'succes' });
      ouvrirEditionEntree(e.id);
    } else {
      notifier('Timer stopped: ' + fmtDuree(minutes) + ' saved on "' + libelle + '".', {
        type: 'succes', action: { libelle: 'Edit the entry', fn: function () { ouvrirEditionEntree(e.id); } },
      });
    }
  }
  return e;
}

/* Shortcut Ctrl+Shift+T: stops the running timer, otherwise starts one
   right away (the label is given on stop). */
function basculerChrono() {
  if (chronoEnCours()) { arreterChrono(); return; }
  demarrerChrono({});
}

/* Banner at the top of the work area, visible on every page. */
function rendreChronoBandeau() {
  var b = document.getElementById('chronoBandeau');
  if (!b) return;
  var c = chronoEnCours();
  if (!c) { b.className = 'chrono-bandeau'; b.innerHTML = ''; return; }
  var pause = !!c.pauseDepuis;
  b.className = 'chrono-bandeau visible' + (pause ? ' en-pause' : '');
  b.innerHTML = '<div class="chrono-bandeau-temps" data-chrono-temps>' + texteChrono(c) + '</div>'
    + '<div class="chrono-bandeau-texte"><div class="chrono-bandeau-titre"><span>' + echapper(libelleChrono(c)) + '</span><span class="puce' + (pause ? '' : ' or') + '">' + (pause ? 'paused' : 'running') + '</span></div>'
    + '<div class="chrono-bandeau-sous">' + echapper(libelleAxe(c.axe)) + (c.detail ? ' · ' + echapper(c.detail) : '') + ' · started at ' + heureDebutChrono(c) + '</div></div>'
    + '<div class="chrono-bandeau-actions"><button type="button" class="btn btn-ghost" data-action="pause">' + (pause ? 'Resume' : 'Pause') + '</button>'
    + '<button type="button" class="btn" data-action="arreter">Stop and save</button></div>';
}

/* Sidebar footer: the timer state, mirroring the banner. */
function rendreChronoPied() {
  var pied = document.getElementById('chronoPied');
  if (!pied) return;
  var c = chronoEnCours();
  /* Status module: dot, two short lines, icon buttons (nothing truncated). */
  if (!c) {
    pied.innerHTML = '<div class="chrono-pied"><span class="voyant"></span><div class="chrono-pied-textes"><div class="chrono-pied-titre">Timer stopped</div><div class="chrono-pied-sous">Ctrl+Shift+T to start</div></div>'
      + '<div class="chrono-pied-boutons"><button class="btn-lateral" id="chronoPiedDemarrer" title="Start a timer" aria-label="Start a timer">' + icone('play', 14) + '</button></div></div>';
    pied.querySelector('#chronoPiedDemarrer').addEventListener('click', basculerChrono);
    return;
  }
  var pause = !!c.pauseDepuis;
  pied.innerHTML = '<div class="chrono-pied"><span class="voyant ' + (pause ? 'pause' : 'actif') + '"></span><div class="chrono-pied-textes">'
    + '<div class="chrono-pied-titre"><span data-chrono-temps>' + texteChrono(c) + '</span>' + (pause ? ' · paused' : '') + '</div>'
    + '<div class="chrono-pied-sous" title="' + echapper(libelleAxe(c.axe)) + ' · ' + echapper(libelleChrono(c)) + '">' + echapper(libelleChrono(c)) + '</div></div>'
    + '<div class="chrono-pied-boutons"><button class="btn-lateral" id="chronoPiedPause" title="' + (pause ? 'Resume' : 'Pause') + '" aria-label="' + (pause ? 'Resume' : 'Pause') + '">' + icone(pause ? 'play' : 'pause', 14) + '</button>'
    + '<button class="btn-lateral" id="chronoPiedArreter" title="Stop and save" aria-label="Stop and save">' + icone('stop', 14) + '</button></div></div>';
  pied.querySelector('#chronoPiedPause').addEventListener('click', basculerPauseChrono);
  pied.querySelector('#chronoPiedArreter').addEventListener('click', function () { arreterChrono(); });
  lancerTicChrono();
}

function lancerTicChrono() {
  clearInterval(CHRONO_TIMER);
  CHRONO_TIMER = null;
  if (!chronoEnCours()) { document.title = 'Sablier'; return; }
  var tic = function () {
    var c = chronoEnCours();
    if (!c) { clearInterval(CHRONO_TIMER); CHRONO_TIMER = null; document.title = 'Sablier'; return; }
    var txt = texteChrono(c);
    document.querySelectorAll('[data-chrono-temps]').forEach(function (el) { el.textContent = txt; });
    document.title = txt + (c.pauseDepuis ? ' (paused)' : '') + ' · Sablier';
  };
  tic();
  CHRONO_TIMER = setInterval(tic, 1000);
}
