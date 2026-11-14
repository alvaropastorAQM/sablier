/* ============================================================
   DASHBOARD PAGE: a snapshot of the assignment, with what must not be
   missed (the reminders centre) at the top.
   ============================================================ */
'use strict';

var TABLEAU_PERIODE = null;   // 'YYYY-MM', 'contrat' or 'tout'

function initTableauDeBord() {
  PAGES.tableau = rendreTableauDeBord;
  document.getElementById('tableauContenu').addEventListener('click', function (ev) {
    var rp = ev.target.closest('.rappel.cliquable');
    if (rp) {
      var r = tousLesRappels().filter(function (x) { return x.cle === rp.dataset.cle; })[0];
      if (r) actionRappel(r);
      return;
    }
    var b = ev.target.closest('[data-action]');
    if (!b) return;
    var a = b.dataset.action;
    if (a === 'page') afficherPage(b.dataset.page);
    else if (a === 'rappels') ouvrirRappels();
    else if (a === 'releve') { RELEVE_MOIS = b.dataset.mois; afficherPage('releve'); }
    else if (a === 'tache') { afficherPage('taches'); ouvrirEditionTache(b.dataset.id); }
    else if (a === 'echeance-fait') { marquerEcheanceFaite(b.dataset.id, true); }
  });
  document.getElementById('tableauContenu').addEventListener('change', function (ev) {
    if (ev.target.id === 'tbPeriode') { TABLEAU_PERIODE = ev.target.value; rendreTableauDeBord(); }
  });
}

function entreesPeriodeTableau() {
  var r = ETAT.reglages;
  var toutes = entreesJournal();
  if (TABLEAU_PERIODE === 'tout') return toutes;
  /* The contract, carry-over included: work done in September and billed in
     October belongs to the contract, as the progress tile counts it. */
  if (TABLEAU_PERIODE === 'contrat') return entreesDuContrat(toutes, r.contrat);
  return entreesDuMois(toutes, TABLEAU_PERIODE);
}

function libellePeriodeTableau() {
  if (TABLEAU_PERIODE === 'tout') return 'the whole period';
  if (TABLEAU_PERIODE === 'contrat') return 'since the contract start';
  return 'in ' + libelleMois(TABLEAU_PERIODE);
}

/* A dashboard deadline: calendar tile, title readable over two lines,
   short countdown. */
function ligneEcheanceTableauHtml(e, ref) {
  var j = joursEntre(ref, e.date);
  var d = isoVersDate(e.date);
  var jour = String(d.getDate());
  var annee = d.getFullYear() !== isoVersDate(ref).getFullYear() ? ' ' + d.getFullYear() : '';
  return '<li class="dash-ech"><div class="dash-cal"><b>' + jour + '</b><span>' + MOIS_COURTS[d.getMonth()] + '</span></div>'
    + '<div class="dash-corps"><div class="titre" title="' + echapper(e.detail || '') + '">' + echapper(e.titre) + '</div>'
    + '<div class="sous">' + JOURS_LONGS[d.getDay()] + ' ' + jour + ' ' + MOIS_LONGS[d.getMonth()] + annee + ' · ' + echapper(TYPES_ECHEANCE[e.type] || 'Reminder') + '</div></div>'
    + '<span class="dash-jours' + (j < 0 ? ' neg' : (j <= 7 ? ' warn' : '')) + '" title="' + echapper(libelleDelai(j)) + '">' + echapper(libelleJours(j)) + '</span></li>';
}

function ligneTacheTableauHtml(x, ref) {
  var pe = prioriteEffective(x, ref);
  var j = x.echeance ? joursEntre(ref, x.echeance) : null;
  var etapes = x.etapes || [];
  var faites = etapes.filter(function (e) { return e.fait; }).length;
  return '<li class="dash-tache" data-action="tache" data-id="' + echapper(x.id) + '" title="Open the task"><span class="kb-priorite ' + pe.niveau + '" title="' + LIBELLES_PRIORITE[pe.niveau] + ' priority"></span>'
    + '<div class="dash-corps"><div class="titre">' + echapper(x.titre) + '</div>'
    + '<div class="sous">' + (x.statut === 'en-cours' ? 'In progress' : 'To do') + ' · ' + echapper(libelleAxe(x.axe)) + (etapes.length ? ' · ' + faites + '/' + etapes.length + ' steps' : '') + (x.echeance ? ' · ' + libelleDate(x.echeance, 'jour') : '') + '</div></div>'
    + (j != null ? '<span class="dash-jours' + (j < 0 ? ' neg' : (j <= 7 ? ' warn' : '')) + '">' + echapper(libelleJours(j)) + '</span>' : '') + '</li>';
}

function rendreTableauDeBord() {
  if (!TABLEAU_PERIODE) TABLEAU_PERIODE = moisCourant();
  var r = ETAT.reglages;
  var ref = aujourdhui();
  var sel = entreesPeriodeTableau();
  var t = totauxEntrees(sel, r);
  var av = avancementContrat(entreesJournal(), r, ref);
  var hj = Number(r.heuresJournee) || 7;
  var c = chronoEnCours();

  var html = '<div class="page-entete"><div><h2 class="page-titre">Dashboard</h2>'
    + '<p class="page-sous">Contract from ' + echapper(libelleDate(r.contrat.debut, 'moyen')) + ' to ' + echapper(libelleDate(r.contrat.fin, 'moyen')) + ' · today ' + echapper(libelleDate(ref, 'long')) + '</p></div>'
    + '<div class="mois-nav">' + selectMoisHtml('tbPeriode', TABLEAU_PERIODE, { liste: moisDuContrat().slice().reverse(), tout: null })
    + '</div></div>';
  // extra options of the selector (contrat, tout)
  html = html.replace('<select id="tbPeriode" class="champ" style="width:auto;">',
    '<select id="tbPeriode" class="champ" style="width:auto;"><option value="contrat"' + (TABLEAU_PERIODE === 'contrat' ? ' selected' : '') + '>Since the contract start</option><option value="tout"' + (TABLEAU_PERIODE === 'tout' ? ' selected' : '') + '>Whole period</option>');

  /* --- Reminders: what must not be missed --- */
  var rappels = rappelsActifs();
  if (rappels.length) {
    html += '<section class="card card-rappels" id="tbRappels"><div class="card-entete"><h2>' + icone('cloche', 16) + ' Don\'t miss <span class="nb">' + rappels.length + '</span></h2><button class="lien" data-action="rappels">See all, snooze, mark done</button></div>'
      + listeRappelsHtml(rappels.slice(0, 5), { sansActions: true, cliquable: true })
      + (rappels.length > 5 ? '<div style="margin-top:8px;"><button class="lien" data-action="rappels">' + (rappels.length - 5) + (rappels.length - 5 > 1 ? ' more reminders' : ' more reminder') + '</button></div>' : '')
      + '</section>';
  }

  /* --- Tiles --- */
  /* What has been earned (all issued invoices, excluding VAT) and what must
     be set aside for the next quarterly returns. */
  var lesFactures = factures();
  var emis = arrondir2(lesFactures.reduce(function (s, f) { return s + baseFacture(f); }, 0));
  var encaisse = arrondir2(lesFactures.filter(function (f) { return f.statut === 'payee'; }).reduce(function (s, f) { return s + (Number(f.total) || 0); }, 0));
  var aVenir = impotsAVenir(ref);
  html += '<div class="dash-tuiles">'
    + '<div class="dash-tuile"><div class="dash-lib">Billable hours</div><div class="dash-val">' + fmtHeuresDec(t.minutesFacturables, true) + ' <small>h</small></div><div class="dash-sous">' + echapper(libellePeriodeTableau()) + ' · that is ' + fmtNombre(t.minutesFacturables / 60 / hj, 2) + ' days of ' + fmtNombre(hj, 0) + ' h</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">Billable amount</div><div class="dash-val">' + fmtEuros(t.montant) + '</div><div class="dash-sous">excl. VAT, at ' + fmtEuros(r.tarifHoraire) + ' per hour</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">Earned since the start</div><div class="dash-val">' + fmtEuros(emis) + '</div><div class="dash-sous">' + (lesFactures.length ? lesFactures.length + (lesFactures.length > 1 ? ' invoices issued' : ' invoice issued') + ', excl. VAT · ' + fmtEuros(encaisse) + ' transferred' : 'no invoice issued yet') + '</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">To set aside for taxes</div><div class="dash-val">' + fmtEuros(aVenir.length ? aVenir[0].aMettreDeCote : 0) + '</div><div class="dash-sous">' + texteImpotsAVenir(aVenir) + '</div></div>'
    + '</div>';

  /* --- Charts --- */
  html += '<div class="dash-graph">'
    + '<section class="card"><h2>Billable hours per month</h2><div class="gr-conteneur" id="tbGraphique"></div></section>'
    + '<section class="card"><h2>Breakdown by area</h2><p class="desc">' + echapper(capitaliser(libellePeriodeTableau())) + ', time spent.</p><div id="tbRepartition"></div></section>'
    + '</div>';

  /* --- Lists --- */
  var enCours = taches().filter(function (x) { return x.statut === 'en-cours' || x.statut === 'a-faire'; }).sort(function (a, b) {
    if (a.statut !== b.statut) return a.statut === 'en-cours' ? -1 : 1;
    return comparerTaches(a, b, ref);
  }).slice(0, 6);
  var prochaines = trierPar(echeances().filter(function (e) { return !e.fait && e.date >= ref; }), 'date').slice(0, 5);
  var dernieres = trierPar(entreesJournal(), function (e) { return e.date + (e.debut || '') + (e.creeLe || ''); }, true).slice(0, 5);

  html += '<div class="dash-colonnes">'
    + '<section class="card" id="tbTaches"><div class="card-entete"><h2>Tasks in progress</h2><button class="lien" data-action="page" data-page="taches">Open the board</button></div>'
    + (enCours.length ? '<ul class="dash-liste">' + enCours.map(function (x) { return ligneTacheTableauHtml(x, ref); }).join('') + '</ul>' : '<div class="vide">No open tasks.</div>')
    + '</section>'
    + '<section class="card" id="tbEcheances"><div class="card-entete"><h2>Upcoming deadlines</h2><button class="lien" data-action="page" data-page="echeances">See all</button></div>'
    + (prochaines.length ? '<ul class="dash-liste">' + prochaines.map(function (e) { return ligneEcheanceTableauHtml(e, ref); }).join('') + '</ul>' : '<div class="vide">No upcoming deadlines.</div>')
    + '</section>'
    + '<section class="card"><div class="card-entete"><h2>Latest entries</h2><button class="lien" data-action="page" data-page="journal">Open the log</button></div>'
    + (dernieres.length ? '<ul class="dash-liste">' + dernieres.map(function (e) {
      return '<li><span class="date" style="min-width:86px;">' + libelleDate(e.date, 'jour') + '</span><span class="titre">' + echapper(e.intervention) + '</span><span class="num" style="color:var(--text-primary); font-weight:500;">' + fmtDuree(dureeEntree(e)) + '</span></li>';
    }).join('') + '</ul>' : '<div class="vide">No entries yet. The log is waiting for you.</div>')
    + '</section>'
    + '</div>';

  document.getElementById('tableauContenu').innerHTML = html;

  /* Chart of the contract months (12 rolling months around the chosen month) */
  var moisListe = moisDuContrat();
  if (moisListe.length > 13) {
    var centre = moisValide(TABLEAU_PERIODE) ? TABLEAU_PERIODE : moisCourant();
    var idx = Math.max(0, moisListe.indexOf(centre));
    var debut = Math.max(0, Math.min(idx - 8, moisListe.length - 13));
    moisListe = moisListe.slice(debut, debut + 13);
  }
  var parMois = heuresParMois(entreesJournal(), moisListe, r);
  var courant = moisCourant();
  dessinerBarres(document.getElementById('tbGraphique'), parMois.map(function (m, i) {
    return {
      libelle: MOIS_COURTS[Number(m.mois.slice(5, 7)) - 1], sous: (i === 0 || m.mois.slice(5, 7) === '01') ? m.mois.slice(0, 4) : '',
      valeur: arrondir2(m.minutesFacturables / 60),
      actif: m.mois === (moisValide(TABLEAU_PERIODE) ? TABLEAU_PERIODE : courant), futur: m.mois > courant,
      titre: capitaliser(libelleMois(m.mois)) + ' : ' + fmtHeuresDec(m.minutesFacturables) + ' billable, ' + fmtEuros(m.montant),
    };
  }), { repere: av.repereMensuelMinutes ? arrondir2(av.repereMensuelMinutes / 60) : 0, hauteur: 230 });

  dessinerRepartition(document.getElementById('tbRepartition'), repartitionParAxe(sel, r).map(function (a) {
    var ax = axeParId(a.axe);
    return { nom: ax ? ax.nom : (a.axe || 'No area'), couleur: couleurAxe(a.axe), valeur: a.minutes, part: a.part };
  }));

  if (c) lancerTicChrono();
}

