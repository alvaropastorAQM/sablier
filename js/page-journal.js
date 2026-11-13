/* ============================================================
   JOURNAL : lignes de travail (affichées, jour par jour, dans la page
   « Journal et relevé »), fiche d'une ligne et chronomètre.
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

/* La page « Journal et relevé » se place sur le mois qui facture la ligne,
   journée dépliée. */
function montrerLigne(e) {
  RELEVE_MOIS = moisFacturationDe(e);
  RELEVE_JOURS[e.date] = true;
}

/* La durée tapée prime ; début et fin ne servent qu'à la pré-remplir. */
function dureeSaisie(dureeTxt, debut, fin) {
  var minutes = parseDuree(dureeTxt);
  if (minutes != null) return { minutes: minutes, depuisHoraires: false };
  if (debut && fin) return { minutes: minutesEntre(debut, fin), depuisHoraires: true };
  return { minutes: null, depuisHoraires: false };
}
var MAX_MINUTES_HORAIRES = 16 * 60;   // au-delà, une fin avant le début est plus probable qu'une nuit de travail

function ligneJournalHtml(e) {
  var heure = e.debut && e.fin ? e.debut + ' à ' + e.fin : (e.debut ? 'dès ' + e.debut : 'durée saisie');
  var moisF = moisFacturationDe(e);
  var reportee = estReporte(e);
  var chips = (e.facturable === false ? '<span class="puce neutre" title="' + echapper(e.motif || '') + '">non facturable</span>' : '')
    + (forfaitEntree(e) != null && e.facturable !== false ? '<span class="puce or">forfait ' + fmtEuros(forfaitEntree(e)) + '</span>' : '')
    + (reportee ? '<span class="puce" title="Travail du ' + dateFr(e.date) + ', porté sur le relevé ' + echapper(deLibelleMois(moisF)) + '">'
        + 'reporté sur ' + echapper(libelleMoisSeul(moisF)) + '</span>' : '');
  var tacheLiee = e.tache ? tacheParId(e.tache) : null;
  if (tacheLiee) chips += '<button type="button" class="puce tache" data-action="tache" title="Ouvrir la tâche « ' + echapper(tacheLiee.titre) + ' »">' + icone('coche', 11) + echapper(tacheLiee.titre) + '</button>';
  var detail = [e.detail, e.facturable === false && e.motif ? e.motif : ''].filter(Boolean).join(' · ');
  return '<div class="jr-ligne' + (e.facturable === false ? ' non-facturable' : '') + '" data-id="' + echapper(e.id) + '">'
    + '<div class="jr-heure">' + echapper(heure) + '</div>'
    + '<div class="jr-contenu"><div class="jr-intervention">' + puceAxeHtml(e.axe) + '<span>' + echapper(e.intervention) + '</span>' + chips + '</div>'
    + (detail ? '<div class="jr-detail">' + echapper(detail) + '</div>' : '') + '</div>'
    + '<div class="jr-duree">' + fmtDuree(dureeEntree(e)) + '</div>'
    + '<div class="jr-actions">'
    + boutonIcone('reprendre', 'play', 'Reprendre au chrono')
    + boutonIcone('modifier', 'crayon', 'Modifier')
    + boutonIcone('dupliquer', 'copie', 'Dupliquer sur aujourd\'hui')
    + boutonIcone('supprimer', 'corbeille', 'Supprimer', 'danger')
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
    /* La copie ne reprend ni le forfait ni le mois de facturation : un
       montant fixe et un report ne se dupliquent pas par mégarde. */
    var copie = Object.assign({}, e, { id: uid('ent'), date: aujourdhui(), debut: '', fin: '', forfait: null, moisFacturation: null, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString() });
    entreesJournal().push(copie);
    heriterMoisFacturation(copie);
    sauver('journal');
    montrerLigne(copie);
    rafraichir();
    notifier('Ligne dupliquée sur aujourd\'hui.', { action: { libelle: 'Modifier', fn: function () { ouvrirEditionEntree(copie.id); } } });
  }
  else if (action === 'supprimer') {
    var fac = factureDeEntree(factures(), e.id);
    if (fac) { notifier('Cette ligne est figée sur la facture n° ' + fac.numero + ' : supprimez d\'abord la facture (dernière facture seulement).', { type: 'erreur', duree: 7000 }); return; }
    confirmer('Supprimer cette ligne (' + fmtDuree(dureeEntree(e)) + ', ' + e.intervention + ') ?', { ok: 'Supprimer', danger: true, titre: 'Supprimer une ligne' }).then(function (ok) {
      if (!ok) return;
      ETAT.journal.entrees = entreesJournal().filter(function (x) { return x.id !== e.id; });
      sauver('journal');
      rafraichir();
      notifier('Ligne supprimée.');
    });
  }
}

function entreeParId(id) {
  return entreesJournal().filter(function (e) { return e.id === id; })[0] || null;
}

/* ---------- Modale d'édition ---------- */

function ouvrirEditionEntree(id, prefill) {
  var e = id ? entreeParId(id) : null;
  if (id && !e) return;
  var v = Object.assign({ date: aujourdhui(), axe: ETAT.reglages.ui.dernierAxe, intervention: '', detail: '', debut: '', fin: '', minutes: null, moisFacturation: null, tache: null }, prefill || {}, e || {});
  /* Une ligne figée sur une facture ne change plus de date, d'axe, de durée
     ni de facturation : seuls le libellé et le détail restent modifiables. */
  var fac = e ? factureDeEntree(factures(), e.id) : null;
  /* Le mois de facturation appartient à l'intervention entière : il se fige
     dès qu'une seule de ses lignes est portée par une facture. */
  var moisTravail = moisDe(v.date) || moisCourant();
  var moisFact = moisFacturationDe(v) || moisTravail;
  var interFigee = !fac && e && interventionFigee(e);
  var verrouMois = fac ? 'Ligne figée sur la facture n° ' + fac.numero + ' : le mois de facturation ne change plus.'
    : (interFigee ? 'Une autre ligne de cette intervention est déjà portée par une facture : le mois de facturation ne change plus.' : '');
  var m = ouvrirModale({
    titre: e ? 'Modifier une ligne' : 'Nouvelle ligne',
    sousTitre: e ? 'Saisie du ' + libelleDate(e.date, 'moyen') : '',
    corps: (fac ? '<div class="alert alert-info" style="margin-bottom:14px;"><span>Ligne figée sur la facture n° <b>' + echapper(fac.numero) + '</b> : la date, l\'axe, la durée, le mois de facturation et la facturation ne se modifient plus. Pour les changer, supprimez d\'abord la facture (dernière facture seulement).</span></div>' : '')
      + '<div class="grid-2">'
      + champHtml('edDate', 'Date', 'date', v.date)
      + '<div class="field"><label for="edAxe">Axe</label><select id="edAxe">' + optionsAxesHtml(v.axe) + '</select></div>'
      + champHtml('edIntervention', 'Intervention', 'text', v.intervention, { classe: 'span-2', attrs: 'list="jrInterventionsListe"' })
      + champHtml('edDetail', 'Détail (facultatif)', 'text', v.detail, { classe: 'span-2' })
      + champHtml('edDebut', 'Début', 'time', v.debut)
      + champHtml('edFin', 'Fin', 'time', v.fin)
      + champHtml('edDuree', 'Durée', 'text', v.minutes != null ? fmtDuree(v.minutes) : '', { attrs: 'placeholder="ex. 1h30, 45 min, 2,5"' })
      + '<div class="field"><label>Facturation</label><label class="field-ligne" style="padding:6px 0;"><input type="checkbox" id="edNonFacturable"' + (v.facturable === false ? ' checked' : '') + '> <span>Non facturable (0 €, le temps reste compté)</span></label></div>'
      + champHtml('edMotif', 'Motif (si non facturable)', 'text', v.motif || '', { attrs: 'placeholder="ex. stage, geste commercial"' })
      + champHtml('edForfait', 'Forfait HT en € (facultatif, remplace heures × tarif)', 'text', v.forfait != null ? fmtNombreSaisie(v.forfait, 2) : '', { attrs: 'inputmode="decimal" placeholder="ex. 600 ou 600,50"' })
      + '<div class="field span-2"><label for="edTache">Tâche liée</label><select id="edTache">' + optionsTachesHtml(v.tache) + '</select>'
      + '<p class="hint">Le temps de cette ligne s\'ajoute au temps passé de la tâche, dans sa fiche.</p></div>'
      + '<div class="field span-2"><label for="edMoisFacturation">Mois de facturation</label>'
      + selectMoisHtml('edMoisFacturation', moisFact, { liste: moisFacturationPossibles(moisTravail, moisFact), pleineLargeur: true })
      + '<p class="hint" id="edAideMois">' + echapper(verrouMois || aideMoisFacturation(moisTravail, moisFact)) + '</p></div>'
      + '</div><p class="hint" id="edAide"></p>',
    pied: (e && !fac ? '<button class="btn btn-danger-ligne btn-petit" data-role="supprimer">Supprimer</button>' : '')
      + '<div class="a-droite"><button class="btn btn-ghost" data-role="annuler">Annuler</button><button class="btn" data-role="ok">Enregistrer</button></div>',
  });
  var sup = m.querySelector('[data-role=supprimer]');
  if (sup) sup.addEventListener('click', function () {
    fermerModale();
    confirmer('Supprimer cette ligne (' + fmtDuree(dureeEntree(e)) + ', ' + e.intervention + ') ?', { ok: 'Supprimer', danger: true, titre: 'Supprimer une ligne' }).then(function (ok) {
      if (!ok) return;
      ETAT.journal.entrees = entreesJournal().filter(function (x) { return x.id !== e.id; });
      sauver('journal');
      rafraichir();
      notifier('Ligne supprimée.');
    });
  });
  if (fac) ['edDate', 'edAxe', 'edDebut', 'edFin', 'edDuree', 'edNonFacturable', 'edMotif', 'edForfait', 'edMoisFacturation'].forEach(function (idc) { var el = m.querySelector('#' + idc); if (el) el.disabled = true; });
  var champMois = m.querySelector('#edMoisFacturation');
  /* Une intervention déjà facturée en partie garde sa date et son mois. */
  if (interFigee) { champMois.disabled = true; m.querySelector('#edDate').disabled = true; }
  var majDuree = function () {
    var d = m.querySelector('#edDebut').value, f = m.querySelector('#edFin').value;
    if (d && f) m.querySelector('#edDuree').value = fmtDuree(minutesEntre(d, f));
  };
  m.querySelector('#edDebut').addEventListener('change', majDuree);
  m.querySelector('#edFin').addEventListener('change', majDuree);
  /* Le mois suit la date tant qu'il n'a pas été choisi à la main. */
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
      /* Ligne facturée : libellé, détail et tâche liée seulement. */
      e.intervention = intervention;
      e.detail = m.querySelector('#edDetail').value.trim();
      e.tache = tacheChoisie;
      e.modifieLe = new Date().toISOString();
      sauver('journal');
      fermerModale();
      rafraichir();
      notifier('Libellé modifié (ligne facturée : le reste est figé).', { type: 'succes' });
      return;
    }
    var debut = m.querySelector('#edDebut').value, fin = m.querySelector('#edFin').value;
    var d = dureeSaisie(m.querySelector('#edDuree').value, debut, fin);
    var minutes = d.minutes;
    var date = m.querySelector('#edDate').value;
    if (!date) { m.querySelector('#edDate').classList.add('invalide'); return; }
    if (!(minutes > 0)) { m.querySelector('#edDuree').classList.add('invalide'); m.querySelector('#edAide').textContent = 'Indiquez une durée, ou un début et une fin.'; return; }
    if (d.depuisHoraires && minutes > MAX_MINUTES_HORAIRES) { m.querySelector('#edFin').classList.add('invalide'); m.querySelector('#edAide').textContent = 'Les heures donnent ' + fmtDuree(minutes) + ' : fin antérieure au début ? Vérifiez, ou tapez la durée.'; return; }
    var forfaitTxt = m.querySelector('#edForfait').value.trim();
    var forfait = forfaitTxt ? lireMontant(forfaitTxt) : null;
    if (forfaitTxt && forfait == null) { m.querySelector('#edForfait').classList.add('invalide'); m.querySelector('#edAide').textContent = 'Forfait non compris (ex. 600 ou 600,50).'; return; }
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
    /* Un mois de facturation antérieur au travail n'a pas de sens : la
       date a pu bouger après le choix du mois. */
    if (cible.moisFacturation && cible.moisFacturation < moisT) cible.moisFacturation = null;
    cible.modifieLe = new Date().toISOString();
    if (!e) entreesJournal().push(cible);
    /* Le mois de facturation appartient au travail entier, pas à la ligne.
       Si une sœur est déjà portée par une facture, la ligne la rejoint pour
       que l'intervention ne soit pas à cheval sur deux mois. */
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
    var suite = adopte ? ' Cette intervention est déjà portée par une facture ' + deLibelleMois(adopte) + ' : la ligne y est rattachée.'
      : (suivies ? ' Les ' + (suivies + 1) + ' lignes de cette intervention sont facturées en ' + libelleMois(moisFacturationDe(cible)) + '.' : '');
    notifier((e ? 'Ligne modifiée.' : 'Ligne enregistrée.') + suite, { type: 'succes', duree: suite ? 9000 : undefined });
  });
  m.querySelectorAll('input').forEach(function (i) {
    i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); m.querySelector('[data-role=ok]').click(); } });
  });
}

/* ---------- Chronomètre ----------
   État (chrono.json) : { debut, axe, intervention, detail, tache,
   pauseDepuis (ISO ou null), pauseCumuleeMs }. Le temps mesuré exclut
   les pauses ; le chrono survit à la fermeture de l'application. */

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
function libelleChrono(c) { return String(c.intervention || '').trim() || 'Sans libellé'; }

/* Démarre un chrono ; un chrono déjà en cours est d'abord arrêté et
   enregistré. Le libellé peut rester vide : il sera demandé à l'arrêt. */
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
    notifier('Chrono démarré. Le précédent, sans libellé (' + fmtDuree(precedent.minutes) + '), est enregistré sous « Intervention ».', { duree: 9000, action: { libelle: 'Nommer la ligne', fn: function () { ouvrirEditionEntree(precedent.id); } } });
  } else {
    notifier(c.intervention ? 'Chrono démarré : ' + c.intervention : 'Chrono démarré. Vous nommerez l\'intervention à l\'arrêt.');
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

/* Arrête le chrono et enregistre la ligne : une minute au minimum, pour
   que rien ne se perde (la ligne se modifie ou se supprime ensuite). */
function arreterChrono(silencieux) {
  var c = chronoEnCours();
  if (!c) return null;
  /* Un chrono arrêté pendant une pause se termine au début de la pause. */
  var debut = new Date(c.debut), fin = c.pauseDepuis ? new Date(c.pauseDepuis) : new Date();
  if (isNaN(debut.getTime())) debut = new Date();
  if (isNaN(fin.getTime()) || fin < debut) fin = new Date();
  var minutes = Math.max(1, Math.round(dureeChronoMs(c) / 60000));
  var libelle = String(c.intervention || '').trim();
  ETAT.chrono.enCours = null;
  sauver('chrono');
  lancerTicChrono();
  var e = {
    id: uid('ent'), date: dateVersIso(debut), axe: c.axe, intervention: libelle || 'Intervention', detail: c.detail || '',
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
      /* Une modale est ouverte (facture, fiche…) : on ne la ferme pas. */
      notifier('Chrono arrêté : ' + fmtDuree(minutes) + ' enregistrées sous « Intervention ».', { type: 'succes', duree: 9000, action: { libelle: 'Nommer la ligne', fn: function () { ouvrirEditionEntree(e.id); } } });
    } else if (!libelle) {
      notifier('Chrono arrêté : ' + fmtDuree(minutes) + ' enregistrées. Donnez un libellé à la ligne.', { type: 'succes' });
      ouvrirEditionEntree(e.id);
    } else {
      notifier('Chrono arrêté : ' + fmtDuree(minutes) + ' enregistrées sur « ' + libelle + ' ».', {
        type: 'succes', action: { libelle: 'Modifier la ligne', fn: function () { ouvrirEditionEntree(e.id); } },
      });
    }
  }
  return e;
}

/* Raccourci ⌘⇧T : arrête le chrono en cours, sinon en démarre un tout de
   suite (le libellé se donne à l'arrêt). */
function basculerChrono() {
  if (chronoEnCours()) { arreterChrono(); return; }
  demarrerChrono({});
}

/* Bandeau en haut de la zone de travail, visible sur toutes les pages. */
function rendreChronoBandeau() {
  var b = document.getElementById('chronoBandeau');
  if (!b) return;
  var c = chronoEnCours();
  if (!c) { b.className = 'chrono-bandeau'; b.innerHTML = ''; return; }
  var pause = !!c.pauseDepuis;
  b.className = 'chrono-bandeau visible' + (pause ? ' en-pause' : '');
  b.innerHTML = '<div class="chrono-bandeau-temps" data-chrono-temps>' + texteChrono(c) + '</div>'
    + '<div class="chrono-bandeau-texte"><div class="chrono-bandeau-titre"><span>' + echapper(libelleChrono(c)) + '</span><span class="puce' + (pause ? '' : ' or') + '">' + (pause ? 'en pause' : 'en cours') + '</span></div>'
    + '<div class="chrono-bandeau-sous">' + echapper(libelleAxe(c.axe)) + (c.detail ? ' · ' + echapper(c.detail) : '') + ' · démarré à ' + heureDebutChrono(c) + '</div></div>'
    + '<div class="chrono-bandeau-actions"><button type="button" class="btn btn-ghost" data-action="pause">' + (pause ? 'Reprendre' : 'Pause') + '</button>'
    + '<button type="button" class="btn" data-action="arreter">Arrêter et enregistrer</button></div>';
}

/* Pied de la barre latérale : l'état du chrono, en miroir du bandeau. */
function rendreChronoPied() {
  var pied = document.getElementById('chronoPied');
  if (!pied) return;
  var c = chronoEnCours();
  /* Module d'état : point, deux lignes courtes, boutons d'icône (rien de tronqué). */
  if (!c) {
    pied.innerHTML = '<div class="chrono-pied"><span class="voyant"></span><div class="chrono-pied-textes"><div class="chrono-pied-titre">Chrono à l\'arrêt</div><div class="chrono-pied-sous">⌘⇧T pour démarrer</div></div>'
      + '<div class="chrono-pied-boutons"><button class="btn-lateral" id="chronoPiedDemarrer" title="Démarrer un chrono" aria-label="Démarrer un chrono">' + icone('play', 14) + '</button></div></div>';
    pied.querySelector('#chronoPiedDemarrer').addEventListener('click', basculerChrono);
    return;
  }
  var pause = !!c.pauseDepuis;
  pied.innerHTML = '<div class="chrono-pied"><span class="voyant ' + (pause ? 'pause' : 'actif') + '"></span><div class="chrono-pied-textes">'
    + '<div class="chrono-pied-titre"><span data-chrono-temps>' + texteChrono(c) + '</span>' + (pause ? ' · en pause' : '') + '</div>'
    + '<div class="chrono-pied-sous" title="' + echapper(libelleAxe(c.axe)) + ' · ' + echapper(libelleChrono(c)) + '">' + echapper(libelleChrono(c)) + '</div></div>'
    + '<div class="chrono-pied-boutons"><button class="btn-lateral" id="chronoPiedPause" title="' + (pause ? 'Reprendre' : 'Pause') + '" aria-label="' + (pause ? 'Reprendre' : 'Pause') + '">' + icone(pause ? 'play' : 'pause', 14) + '</button>'
    + '<button class="btn-lateral" id="chronoPiedArreter" title="Arrêter et enregistrer" aria-label="Arrêter et enregistrer">' + icone('stop', 14) + '</button></div></div>';
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
    document.title = txt + (c.pauseDepuis ? ' (pause)' : '') + ' · Sablier';
  };
  tic();
  CHRONO_TIMER = setInterval(tic, 1000);
}
