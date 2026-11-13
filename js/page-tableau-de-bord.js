/* ============================================================
   PAGE TABLEAU DE BORD : la photographie de la mission, et en tête ce
   qu'il ne faut pas rater (centre des rappels).
   ============================================================ */
'use strict';

var TABLEAU_PERIODE = null;   // 'AAAA-MM', 'contrat' ou 'tout'

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
  /* Le contrat, report compris : un travail de septembre facturé en octobre
     relève du contrat, comme la tuile d'avancement le compte. */
  if (TABLEAU_PERIODE === 'contrat') return entreesDuContrat(toutes, r.contrat);
  return entreesDuMois(toutes, TABLEAU_PERIODE);
}

function libellePeriodeTableau() {
  if (TABLEAU_PERIODE === 'tout') return 'toute la période';
  if (TABLEAU_PERIODE === 'contrat') return 'depuis le début du contrat';
  return 'en ' + libelleMois(TABLEAU_PERIODE);
}

/* Une échéance du tableau de bord : tuile de calendrier, titre lisible
   sur deux lignes, compte à rebours court. */
function ligneEcheanceTableauHtml(e, ref) {
  var j = joursEntre(ref, e.date);
  var d = isoVersDate(e.date);
  var jour = d.getDate() === 1 ? '1er' : String(d.getDate());
  var annee = d.getFullYear() !== isoVersDate(ref).getFullYear() ? ' ' + d.getFullYear() : '';
  return '<li class="dash-ech"><div class="dash-cal"><b>' + jour + '</b><span>' + MOIS_COURTS[d.getMonth()] + '</span></div>'
    + '<div class="dash-corps"><div class="titre" title="' + echapper(e.detail || '') + '">' + echapper(e.titre) + '</div>'
    + '<div class="sous">' + JOURS_LONGS[d.getDay()] + ' ' + jour + ' ' + MOIS_LONGS[d.getMonth()] + annee + ' · ' + echapper(TYPES_ECHEANCE[e.type] || 'Rappel') + '</div></div>'
    + '<span class="dash-jours' + (j < 0 ? ' neg' : (j <= 7 ? ' warn' : '')) + '" title="' + echapper(libelleDelai(j)) + '">' + echapper(libelleJours(j)) + '</span></li>';
}

function ligneTacheTableauHtml(x, ref) {
  var pe = prioriteEffective(x, ref);
  var j = x.echeance ? joursEntre(ref, x.echeance) : null;
  var etapes = x.etapes || [];
  var faites = etapes.filter(function (e) { return e.fait; }).length;
  return '<li class="dash-tache" data-action="tache" data-id="' + echapper(x.id) + '" title="Ouvrir la fiche"><span class="kb-priorite ' + pe.niveau + '" title="Priorité ' + LIBELLES_PRIORITE[pe.niveau].toLowerCase() + '"></span>'
    + '<div class="dash-corps"><div class="titre">' + echapper(x.titre) + '</div>'
    + '<div class="sous">' + (x.statut === 'en-cours' ? 'En cours' : 'À faire') + ' · ' + echapper(libelleAxe(x.axe)) + (etapes.length ? ' · ' + faites + '/' + etapes.length + ' étapes' : '') + (x.echeance ? ' · ' + libelleDate(x.echeance, 'jour') : '') + '</div></div>'
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

  var html = '<div class="page-entete"><div><h2 class="page-titre">Tableau de bord</h2>'
    + '<p class="page-sous">Contrat du ' + echapper(libelleDate(r.contrat.debut, 'moyen')) + ' au ' + echapper(libelleDate(r.contrat.fin, 'moyen')) + ' · aujourd\'hui ' + echapper(libelleDate(ref, 'long')) + '</p></div>'
    + '<div class="mois-nav">' + selectMoisHtml('tbPeriode', TABLEAU_PERIODE, { liste: moisDuContrat().slice().reverse(), tout: null })
    + '</div></div>';
  // options supplémentaires du sélecteur (contrat, tout)
  html = html.replace('<select id="tbPeriode" class="champ" style="width:auto;">',
    '<select id="tbPeriode" class="champ" style="width:auto;"><option value="contrat"' + (TABLEAU_PERIODE === 'contrat' ? ' selected' : '') + '>Depuis le début du contrat</option><option value="tout"' + (TABLEAU_PERIODE === 'tout' ? ' selected' : '') + '>Toute la période</option>');

  /* --- Rappels : ce qu'il ne faut pas rater --- */
  var rappels = rappelsActifs();
  if (rappels.length) {
    html += '<section class="card card-rappels" id="tbRappels"><div class="card-entete"><h2>' + icone('cloche', 16) + ' À ne pas rater <span class="nb">' + rappels.length + '</span></h2><button class="lien" data-action="rappels">Tout voir, reporter, marquer fait</button></div>'
      + listeRappelsHtml(rappels.slice(0, 5), { sansActions: true, cliquable: true })
      + (rappels.length > 5 ? '<div style="margin-top:8px;"><button class="lien" data-action="rappels">' + (rappels.length - 5) + (rappels.length - 5 > 1 ? ' autres rappels' : ' autre rappel') + '</button></div>' : '')
      + '</section>';
  }

  /* --- Tuiles --- */
  /* Ce qui a été gagné (toutes les factures émises) et ce qu'il faut mettre
     de côté pour le prochain prélèvement de l'URSSAF. */
  var lesFactures = factures();
  var emis = arrondir2(lesFactures.reduce(function (s, f) { return s + (Number(f.total) || 0); }, 0));
  var encaisse = arrondir2(lesFactures.filter(function (f) { return f.statut === 'payee'; }).reduce(function (s, f) { return s + (Number(f.total) || 0); }, 0));
  var urssaf = cotisationsAVenir(ref);
  var u0 = urssaf[0];
  html += '<div class="dash-tuiles">'
    + '<div class="dash-tuile"><div class="dash-lib">Heures facturables</div><div class="dash-val">' + fmtHeuresDec(t.minutesFacturables, true) + ' <small>h</small></div><div class="dash-sous">' + echapper(libellePeriodeTableau()) + ' · soit ' + fmtNombre(t.minutesFacturables / 60 / hj, 2) + ' journées de ' + fmtNombre(hj, 0) + ' h</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">Montant facturable</div><div class="dash-val">' + fmtEuros(t.montant) + '</div><div class="dash-sous">hors taxes, au tarif de ' + fmtEuros(r.tarifHoraire) + ' de l\'heure</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">Gagné depuis le début</div><div class="dash-val">' + fmtEuros(emis) + '</div><div class="dash-sous">' + (lesFactures.length ? lesFactures.length + (lesFactures.length > 1 ? ' factures émises' : ' facture émise') + ' · ' + fmtEuros(encaisse) + ' déjà encaissés' : 'aucune facture émise pour l\'instant') + '</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">À garder pour l\'URSSAF</div><div class="dash-val">' + fmtEuros(u0 ? u0.montant : 0) + '</div><div class="dash-sous">'
      + (u0 ? 'prélevés le ' + dateFr(u0.date) + (u0.enAttente ? (u0.enAttente === u0.montant ? ', dès que la facture est payée' : ', dont ' + fmtEuros(u0.enAttente) + ' de factures en attente') : '')
        + (urssaf.length > 1 ? ' · puis ' + urssaf.slice(1).map(function (d) { return fmtEuros(d.montant) + ' le ' + dateFr(d.date); }).join(', ') : '')
      : 'rien à mettre de côté pour l\'instant')
      + ' · hors impôt sur le revenu</div></div>'
    + '</div>';

  /* --- Graphiques --- */
  html += '<div class="dash-graph">'
    + '<section class="card"><h2>Heures facturables par mois</h2><div class="gr-conteneur" id="tbGraphique"></div></section>'
    + '<section class="card"><h2>Répartition par axe</h2><p class="desc">' + echapper(capitaliser(libellePeriodeTableau())) + ', temps passé.</p><div id="tbRepartition"></div></section>'
    + '</div>';

  /* --- Listes --- */
  var enCours = taches().filter(function (x) { return x.statut === 'en-cours' || x.statut === 'a-faire'; }).sort(function (a, b) {
    if (a.statut !== b.statut) return a.statut === 'en-cours' ? -1 : 1;
    return comparerTaches(a, b, ref);
  }).slice(0, 6);
  var prochaines = trierPar(echeances().filter(function (e) { return !e.fait && e.date >= ref; }), 'date').slice(0, 5);
  var dernieres = trierPar(entreesJournal(), function (e) { return e.date + (e.debut || '') + (e.creeLe || ''); }, true).slice(0, 5);

  html += '<div class="dash-colonnes">'
    + '<section class="card" id="tbTaches"><div class="card-entete"><h2>Tâches en cours</h2><button class="lien" data-action="page" data-page="taches">Voir le tableau</button></div>'
    + (enCours.length ? '<ul class="dash-liste">' + enCours.map(function (x) { return ligneTacheTableauHtml(x, ref); }).join('') + '</ul>' : '<div class="vide">Aucune tâche ouverte.</div>')
    + '</section>'
    + '<section class="card" id="tbEcheances"><div class="card-entete"><h2>Prochaines échéances</h2><button class="lien" data-action="page" data-page="echeances">Tout voir</button></div>'
    + (prochaines.length ? '<ul class="dash-liste">' + prochaines.map(function (e) { return ligneEcheanceTableauHtml(e, ref); }).join('') + '</ul>' : '<div class="vide">Aucune échéance à venir.</div>')
    + '</section>'
    + '<section class="card"><div class="card-entete"><h2>Dernières saisies</h2><button class="lien" data-action="page" data-page="journal">Ouvrir le journal</button></div>'
    + (dernieres.length ? '<ul class="dash-liste">' + dernieres.map(function (e) {
      return '<li><span class="date" style="min-width:86px;">' + libelleDate(e.date, 'jour') + '</span><span class="titre">' + echapper(e.intervention) + '</span><span class="num" style="color:var(--text-primary); font-weight:500;">' + fmtDuree(dureeEntree(e)) + '</span></li>';
    }).join('') + '</ul>' : '<div class="vide">Aucune saisie pour l\'instant. Le journal vous attend.</div>')
    + '</section>'
    + '</div>';

  document.getElementById('tableauContenu').innerHTML = html;

  /* Graphique des mois du contrat (12 mois glissants autour du mois choisi) */
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
      titre: capitaliser(libelleMois(m.mois)) + ' : ' + fmtHeuresDec(m.minutesFacturables) + ' facturables, ' + fmtEuros(m.montant),
    };
  }), { repere: av.repereMensuelMinutes ? arrondir2(av.repereMensuelMinutes / 60) : 0, hauteur: 230 });

  dessinerRepartition(document.getElementById('tbRepartition'), repartitionParAxe(sel, r).map(function (a) {
    var ax = axeParId(a.axe);
    return { nom: ax ? ax.nom : (a.axe || 'Sans axe'), couleur: couleurAxe(a.axe), valeur: a.minutes, part: a.part };
  }));

  if (c) lancerTicChrono();
}

