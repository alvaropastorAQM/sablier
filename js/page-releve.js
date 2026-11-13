/* ============================================================
   PAGE JOURNAL ET RELEVÉ : le travail du mois jour par jour, le relevé
   d'activité du contrat (article 6.3) et l'établissement des factures.

   Un mois peut porter plusieurs factures : chacune ne prend que les
   lignes pas encore facturées (par exemple une facture de démarrage en
   début de mois, puis celle du travail courant en fin de mois).
   ============================================================ */
'use strict';

var RELEVE_MOIS = null;
var RELEVE_JOURS = {};        // journées dépliées (date ISO)
var RELEVE_TRAVAUX_TOUS = false;
var TRAVAUX_VISIBLES = 4;

function initReleve() {
  PAGES.releve = rendreReleve;
  var zone = document.getElementById('releveContenu');
  zone.addEventListener('click', function (ev) {
    /* Les lignes du journal dépliées gardent leurs propres actions. */
    if (ev.target.closest('.jr-ligne')) { clicListeJournal(ev); return; }
    var b = ev.target.closest('[data-action]');
    if (!b) return;
    var a = b.dataset.action;
    if (a === 'mois-prec') { RELEVE_MOIS = ajouterMois(RELEVE_MOIS, -1); rendreReleve(); }
    else if (a === 'mois-suiv') { RELEVE_MOIS = ajouterMois(RELEVE_MOIS, 1); rendreReleve(); }
    else if (a === 'voir-factures') afficherPage('factures');
    else if (a === 'releve') { RELEVE_MOIS = b.dataset.mois; rendreReleve(); }
    else if (a === 'facture') etablirFacture();
    else if (a === 'reporter') ouvrirReport();
    else if (a === 'pdf-facture') exporterFacturePdf(b.dataset.id);
    else if (a === 'jour') { RELEVE_JOURS[b.dataset.jour] = !RELEVE_JOURS[b.dataset.jour]; rendreReleve(); }
    else if (a === 'travaux-tous') { RELEVE_TRAVAUX_TOUS = !RELEVE_TRAVAUX_TOUS; rendreReleve(); }
    else if (a === 'nouvelle-ligne') ouvrirEditionEntree(null);
  });
  zone.addEventListener('change', function (ev) {
    var meta = moisMeta(RELEVE_MOIS);
    if (ev.target.id === 'rlMois') { RELEVE_MOIS = ev.target.value; rendreReleve(); }
    else if (ev.target.id === 'rlFrais') {
      var txt = ev.target.value.trim();
      var n = txt ? lireMontant(txt) : 0;
      if (n == null || n < 0) { notifier('Montant des frais non compris (ex. 12,50).', { type: 'erreur' }); rendreReleve(); return; }
      meta.frais = arrondir2(n);
      sauver('reglages');
      rendreReleve();
    }
    else if (ev.target.id === 'rlJoindre') { meta.joindreTravaux = ev.target.checked; sauver('reglages'); }
  });
}

function facturesDuMois(mois) {
  return trierPar(factures().filter(function (f) { return f.mois === mois; }), function (f) { return f.dateEmission + f.numero; });
}
/* La dernière facture du mois (compatibilité). */
function factureDuMois(mois) {
  var l = facturesDuMois(mois);
  return l.length ? l[l.length - 1] : null;
}
/* Les tâches terminées que le relevé du mois peut joindre : celles du mois,
   plus celles des mois dont il facture le travail reporté. */
function travauxDuMois(mois) {
  var moisConcernes = [mois];
  reportsVers(entreesJournal(), mois, ETAT.reglages).forEach(function (g) { if (moisConcernes.indexOf(g.mois) < 0) moisConcernes.push(g.mois); });
  return trierPar(taches().filter(function (t) { return t.statut === 'fait' && t.faitLe && moisConcernes.indexOf(moisDe(t.faitLe)) >= 0; }), 'faitLe');
}
/* Ce qui reste à facturer dans un mois : lignes hors factures existantes,
   frais non encore repris. */
function releveAFacturer(mois) {
  var r = ETAT.reglages;
  var meta = moisMeta(mois);
  var lesFactures = facturesDuMois(mois);
  var fraisFactures = lesFactures.reduce(function (s, f) { return s + (Number(f.frais) || 0); }, 0);
  var fraisRestants = Math.max(0, arrondir2((Number(meta.frais) || 0) - fraisFactures));
  var deja = idsFactures(factures(), mois, entreesJournal());
  return releveDuMois(entreesJournal(), mois, r, fraisRestants, { exclureIds: deja });
}
/* État de facturation d'une intervention du relevé : { facture, partiel }.
   « partiel » quand une partie seulement de ses lignes est facturée.
   Les factures anciennes, sans liste de lignes, couvrent le mois du travail ;
   les autres se lisent sur le mois de facturation du relevé affiché. */
function etatFacturationLigne(l) {
  var anciennes = facturesDuMois(moisDe(l.date)).filter(function (f) { return !Array.isArray(f.entreesIds); });
  if (anciennes.length) return { facture: anciennes[0], partiel: false };
  var facturees = l.ids.map(function (id) { return factureDeEntree(factures(), id); }).filter(Boolean);
  if (!facturees.length) return { facture: null, partiel: false };
  return { facture: facturees[0], partiel: facturees.length < l.ids.length };
}
/* Un mois facturé se relit depuis les lignes figées de ses factures (le
   tarif ou les lignes ont pu changer depuis, du travail a pu s'ajouter). */
function releveFige(mois, lesFactures) {
  var r = ETAT.reglages;
  var heuresJournee = Number(r.heuresJournee) || 7;
  var lignes = [], frais = 0, tarif = 0, arrondi = 0, montantArrondi = 0;
  lesFactures.forEach(function (f) {
    tarif = Number(f.tarif) || tarif;
    frais += Number(f.frais) || 0;
    arrondi += Number(f.arrondiMinutes) || 0;
    montantArrondi += (Number(f.arrondiMinutes) || 0) / 60 * (Number(f.tarif) || 0);
    (f.lignes || []).forEach(function (l) {
      lignes.push(Object.assign({ ids: [], entrees: [], details: [], motifs: [], remise: l.forfait != null ? (Number(l.valeurHoraire) || 0) - l.forfait : 0 }, l));
    });
  });
  lignes.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  var totalMinutes = 0, totalFact = 0, totalNonFact = 0, montant = 0, valeur = 0;
  lignes.forEach(function (l) {
    totalMinutes += l.minutes || 0;
    if (l.facturable === false) totalNonFact += l.minutes || 0; else totalFact += l.minutesFacturables || 0;
    montant += l.montant || 0; valeur += l.valeurHoraire || 0;
  });
  totalFact += arrondi; montant += montantArrondi; valeur += montantArrondi;
  montant = arrondir2(montant); valeur = arrondir2(valeur); frais = arrondir2(frais);
  return { mois: mois, lignes: lignes,
    reportsRecus: reportsVers(entreesJournal(), mois, r), reportsEnvoyes: lesFactures[lesFactures.length - 1].reportsEnvoyes || reportsDepuis(entreesJournal(), mois, r),
    ids: [], tarif: tarif, totalMinutes: totalMinutes, totalMinutesFacturables: totalFact, arrondiMinutes: arrondi, totalMinutesNonFacturables: totalNonFact, heuresFacturables: arrondir2(totalFact / 60), journees: arrondir2(totalFact / 60 / heuresJournee), valeurHoraire: valeur, remise: arrondir2(Math.max(0, valeur - montant)), montantHT: montant, frais: frais, total: arrondir2(montant + frais) };
}

/* Le bandeau d'un groupe de lignes reportées. Le mot « facturé » n'a de
   sens que si le groupe porte un montant : sinon il n'est que « porté ». */
function bandeauReportHtml(g, sens) {
  var t = g.totaux;
  var n = t.nbInterventions;
  var chiffres = t.montant > 0 ? fmtHeuresDec(t.minutesFacturables) + ', ' + fmtEuros(t.montant) + ' HT' : fmtDuree(t.minutes) + ', sans montant (non facturable)';
  var sujet = n > 1 ? n + ' interventions' : 'Une intervention';
  var texte = sens === 'envoye'
    ? sujet + ' ' + deLibelleMois(RELEVE_MOIS) + (n > 1 ? ' sont portées' : ' est portée') + ' sur le relevé ' + deLibelleMois(g.mois) + ' : ' + chiffres + '.'
    : sujet + ' réalisée' + (n > 1 ? 's' : '') + ' en ' + libelleMois(g.mois) + (n > 1 ? ' sont portées' : ' est portée') + ' sur ce relevé : ' + chiffres + '.';
  return '<div class="alert alert-info"><span>' + echapper(texte) + '</span>'
    + '<button class="btn btn-petit btn-ghost" data-action="releve" data-mois="' + echapper(g.mois) + '">Voir le relevé ' + echapper(deLibelleMois(g.mois)) + '</button></div>';
}

/* Les mois du contrat, élargis au mois affiché s'il en sort. */
function moisAutour(mois) {
  var liste = moisDuContrat();
  if (!mois || liste.indexOf(mois) >= 0) return liste;
  return listeMois(mois < liste[0] ? mois : liste[0], mois > liste[liste.length - 1] ? mois : liste[liste.length - 1]);
}

function rendreReleve() {
  if (!RELEVE_MOIS) RELEVE_MOIS = moisCourant();
  var r = ETAT.reglages;
  var meta = moisMeta(RELEVE_MOIS);
  var releve = releveDuMois(entreesJournal(), RELEVE_MOIS, r, meta.frais);
  var reste = releveAFacturer(RELEVE_MOIS);
  var lesFactures = facturesDuMois(RELEVE_MOIS);
  var travaux = travauxDuMois(RELEVE_MOIS);
  var hj = Number(r.heuresJournee) || 7;
  var totalFoi = lesFactures.length ? totalMoisFacture(lesFactures, reste) : { minutes: releve.totalMinutesFacturables, montant: releve.montantHT };
  document.getElementById('jrInterventionsListe').innerHTML = interventionsRecentes(entreesJournal()).slice(0, 40).map(function (l) {
    return '<option value="' + echapper(l) + '"></option>';
  }).join('');

  var html = '<div class="page-entete"><div><h2 class="page-titre">Journal et relevé</h2>'
    + '<p class="page-sous">Le travail du mois, jour par jour : un clic sur une journée montre ses lignes. Le relevé suit le contrat (article 6.3) ; le total du mois est arrondi une seule fois au quart d\'heure supérieur (article 6.1).</p></div>'
    + '<div class="actions"><button class="btn btn-ghost" data-action="nouvelle-ligne">Ajouter une ligne</button>'
    + '<div class="mois-nav"><button class="btn-icone" data-action="mois-prec" title="Mois précédent">‹</button>' + selectMoisHtml('rlMois', RELEVE_MOIS, { liste: moisAutour(RELEVE_MOIS) }) + '<button class="btn-icone" data-action="mois-suiv" title="Mois suivant">›</button></div></div></div>';

  lesFactures.forEach(function (f) {
    var nb = Array.isArray(f.entreesIds) ? f.entreesIds.length : null;
    html += '<div class="alert alert-success"><span>Facture n° <b>' + echapper(f.numero) + '</b> émise le ' + dateFr(f.dateEmission) + ' : ' + fmtEuros(f.total) + (nb != null ? ' (' + nb + (nb > 1 ? ' saisies' : ' saisie') + ', ' + (f.lignes || []).length + ((f.lignes || []).length > 1 ? ' interventions' : ' intervention') + ')' : '') + (f.statut === 'payee' ? ', payée le ' + dateFr(f.datePaiement) : '') + '.</span>'
      + '<span style="margin-left:auto; display:flex; gap:8px;"><button class="btn btn-petit btn-ghost" data-action="pdf-facture" data-id="' + echapper(f.id) + '" title="Une nouvelle copie de la facture et du relevé, sans toucher aux PDF déjà enregistrés">Refaire les PDF</button><button class="btn btn-petit btn-ghost" data-action="voir-factures">Voir les factures</button></span></div>';
  });

  /* Ce que le mois envoie ailleurs ; ce qu'il reçoit a sa ligne dans le tableau. */
  releve.reportsEnvoyes.forEach(function (g) {
    html += bandeauReportHtml(g, 'envoye');
  });

  html += '<section class="card">'
    + '<div class="rl-entete">'
    + '<div><div class="libelle">Prestataire</div><div>' + echapper(r.prestataire.nom) + ' · SIREN ' + echapper(r.prestataire.siren) + '</div></div>'
    + '<div><div class="libelle">Client</div><div>' + echapper(r.client.societe) + (r.client.contact ? ' · ' + echapper(r.client.contact) : '') + '</div></div>'
    + '<div><div class="libelle">Mois</div><div>' + echapper(capitaliser(libelleMois(RELEVE_MOIS))) + '</div></div>'
    + '<div><div class="libelle">Tarif horaire</div><div>' + fmtEuros(r.tarifHoraire) + ' HT · ' + echapper(r.mentionTVA) + '</div></div>'
    + '</div>';

  /* Chaque journée reste dans son mois de travail ; celles facturées sur un
     autre mois y sont marquées « reporté sur … », chiffres hors total. Le
     travail reçu d'autres mois tient sur une ligne par mois d'origine, pour
     que le total reste celui de la facture. */
  var partis = entreesDuMois(entreesJournal(), RELEVE_MOIS).filter(function (e) { return moisFacturationDe(e) !== RELEVE_MOIS; });
  if (!releve.lignes.length && !partis.length) {
    html += '<div class="vide">Aucune intervention en ' + echapper(libelleMois(RELEVE_MOIS)) + '. <button class="lien" data-action="nouvelle-ligne">Ajouter une ligne</button></div>';
  } else {
    var arrondi = releve.arrondiMinutes || 0;
    var montants = montantsAuCentime(releve.lignes.map(function (l) { return l.montant; }).concat([arrondi / 60 * releve.tarif]));
    /* La ligne d'arrondi fait le pont entre les lignes du mois et le total qui fait foi. */
    var minutesArrondi = totalFoi.minutes - releve.lignes.reduce(function (s, l) { return s + (l.facturable ? l.minutesFacturables : 0); }, 0);
    var montantArrondi = arrondir2(totalFoi.montant - montants.slice(0, releve.lignes.length).reduce(function (s, m) { return s + m; }, 0));
    var jours = [], parJour = {}, recus = [], parRecu = {};
    var jourDe = function (date) {
      if (!parJour[date]) { parJour[date] = { date: date, nb: 0, entrees: [], minutes: 0, montant: 0, factures: [], aFacturer: false, partiel: false, reportes: [], partisJour: [] }; jours.push(parJour[date]); }
      return parJour[date];
    };
    var noter = function (g, ef) {
      if (ef && ef.facture) { if (g.factures.indexOf(ef.facture) < 0) g.factures.push(ef.facture); if (ef.partiel) g.partiel = true; }
      else if (ef) g.aFacturer = true;
    };
    releve.lignes.forEach(function (l, i) {
      var ef = l.facturable ? etatFacturationLigne(l) : null;
      var origine = moisDe(l.date);
      var g;
      if (origine !== RELEVE_MOIS) {
        if (!parRecu[origine]) { parRecu[origine] = { mois: origine, nb: 0, minutes: 0, montant: 0, factures: [], aFacturer: false, partiel: false }; recus.push(parRecu[origine]); }
        g = parRecu[origine];
      } else {
        g = jourDe(l.date);
        g.entrees = g.entrees.concat(l.entrees);
      }
      g.nb++;
      if (l.facturable) g.minutes += l.minutesFacturables;
      g.montant += montants[i];
      noter(g, ef);
    });
    partis.forEach(function (e) {
      var j = jourDe(e.date);
      j.entrees.push(e);
      j.partisJour.push(e);
      if (j.reportes.indexOf(moisFacturationDe(e)) < 0) j.reportes.push(moisFacturationDe(e));
    });
    var etatHtml = function (g) {
      var enPartie = g.factures.length && (g.partiel || g.aFacturer);
      return g.factures.length
        ? g.factures.map(function (f) { return '<span class="fa-statut ' + (f.statut === 'payee' && !enPartie ? 'payee' : 'emise') + '" title="' + (enPartie ? 'Une partie des lignes reste à facturer' : 'Facture n° ' + echapper(f.numero)) + '">' + (enPartie ? 'en partie facturé n° ' : 'facturé n° ') + echapper(f.numero) + '</span>'; }).join(' ')
        : (g.aFacturer ? '<span class="puce">à facturer</span>' : (g.nb ? '<span class="puce neutre">non facturable</span>' : ''));
    };
    html += '<div class="tableau-defilant"><table class="tableau rl-jours"><thead><tr><th>Jour</th><th class="num">Interventions</th><th class="num">Temps facturé</th><th class="num">Montant HT</th><th>État</th></tr></thead><tbody>'
      + trierPar(jours, 'date').map(function (j) {
        var ouvert = !!RELEVE_JOURS[j.date];
        /* Une journée entièrement reportée montre ses chiffres en grisé, hors total. */
        var t = j.nb ? null : totauxEntrees(j.partisJour, r, true);
        var nb = j.nb + (j.partisJour.length ? regrouperInterventions(j.partisJour, r).length : 0);
        var etat = [etatHtml(j)].concat(j.reportes.map(function (m) {
          var fac = j.partisJour.map(function (e) { return factureDeEntree(factures(), e.id); }).filter(Boolean)[0];
          return '<span class="puce" title="Facturé ' + deLibelleMois(m) + (fac ? ', facture n° ' + echapper(fac.numero) : '') + '">reporté sur ' + echapper(libelleMoisSeul(m)) + '</span>';
        })).filter(Boolean).join(' ');
        var detail = ouvert
          ? '<tr class="rl-detail"><td colspan="5">' + trierPar(j.entrees, function (e) { return (e.debut || '99:99') + (e.creeLe || ''); }).map(ligneJournalHtml).join('') + '</td></tr>'
          : '';
        return '<tr class="rl-jour' + (ouvert ? ' ouvert' : '') + (t ? ' rl-reporte' : '') + '" data-action="jour" data-jour="' + echapper(j.date) + '" title="' + (ouvert ? 'Replier' : 'Voir le détail') + '">'
          + '<td><span class="rl-chevron">' + icone('chevron', 12) + '</span>' + echapper(capitaliser(libelleDate(j.date, 'long'))) + '</td>'
          + '<td class="num">' + nb + '</td><td class="num">' + fmtHeuresDec(t ? t.minutesFacturables : j.minutes) + '</td><td class="num">' + fmtEuros(t ? t.montant : arrondir2(j.montant)) + '</td><td>' + etat + '</td></tr>'
          + detail;
      }).join('')
      + recus.map(function (g) {
        return '<tr class="rl-recu" data-action="releve" data-mois="' + echapper(g.mois) + '" title="Voir ' + echapper(libelleMois(g.mois)) + '">'
          + '<td><span class="rl-chevron">' + icone('chevron', 12) + '</span>Reporté de ' + echapper(libelleMois(g.mois)) + '</td>'
          + '<td class="num">' + g.nb + '</td><td class="num">' + fmtHeuresDec(g.minutes) + '</td><td class="num">' + fmtEuros(arrondir2(g.montant)) + '</td><td>' + etatHtml(g) + '</td></tr>';
      }).join('')
      + (minutesArrondi || montantArrondi ? '<tr><td>' + (lesFactures.length ? 'Arrondi de chaque facture' : 'Arrondi du total') + ' au quart d\'heure supérieur</td><td class="num"></td><td class="num">' + fmtHeuresDec(minutesArrondi) + '</td><td class="num">' + fmtEuros(montantArrondi) + '</td><td></td></tr>' : '')
      + '</tbody><tfoot><tr><td>Total facturé sur le mois</td><td class="num">' + releve.lignes.length + '</td><td class="num">' + fmtHeuresDec(totalFoi.minutes) + '</td><td class="num">' + fmtEuros(totalFoi.montant) + '</td><td></td></tr></tfoot></table></div>';
  }

  var minutesRecues = releve.reportsRecus.reduce(function (s, g) { return s + g.totaux.minutes; }, 0);
  var minutesParties = releve.reportsEnvoyes.reduce(function (s, g) { return s + g.totaux.minutes; }, 0);
  var moisRecu = releve.reportsRecus.length === 1 ? ' ' + deLibelleMois(releve.reportsRecus[0].mois) : ' d\'autres mois';
  var moisParti = releve.reportsEnvoyes.length === 1 ? ' ' + deLibelleMois(releve.reportsEnvoyes[0].mois) : ' d\'autres mois';
  html += '<div class="rl-recap">'
    + '<div class="panneau"><div class="libelle">Temps passé</div><div class="val">' + fmtHeuresDec(releve.totalMinutes) + '</div>'
      + (releve.totalMinutesNonFacturables ? '<div class="petit">dont ' + fmtHeuresDec(releve.totalMinutesNonFacturables) + ' non facturables</div>' : '')
      + (minutesRecues ? '<div class="petit">dont ' + fmtHeuresDec(minutesRecues) + ' venues' + echapper(moisRecu) + '</div>' : '')
      + (minutesParties ? '<div class="petit">hors ' + fmtHeuresDec(minutesParties) + ' portées' + echapper(moisParti === ' d\'autres mois' ? ' sur d\'autres mois' : ' sur le relevé' + moisParti) + '</div>' : '')
      + '</div>'
    + '<div class="panneau"><div class="libelle">Temps facturé</div><div class="val">' + fmtHeuresDec(totalFoi.minutes) + '</div><div class="petit">' + fmtNombre(totalFoi.minutes / 60 / hj, 2) + ' journées de ' + fmtNombre(hj, 0) + ' h</div></div>'
    + '</div>';

  var travauxVus = RELEVE_TRAVAUX_TOUS ? travaux : travaux.slice(0, TRAVAUX_VISIBLES);
  html += '<div class="grid-2" style="align-items:start;">'
    + '<div class="panneau"><div class="libelle" style="margin-bottom:8px;">Frais de déplacement autorisés</div>'
    + '<div class="rl-frais"><input type="text" id="rlFrais" class="champ" value="' + (meta.frais ? fmtNombreSaisie(meta.frais, 2) : '') + '" placeholder="0,00" inputmode="decimal"> <span class="petit">€ sur le mois, sur accord préalable et justificatifs (article 6.6)</span></div></div>'
    + '<div class="panneau"><label class="field-ligne" style="padding:0 0 6px;"><input type="checkbox" id="rlJoindre"' + (meta.joindreTravaux !== false ? ' checked' : '') + '> <span class="libelle" style="margin:0;">Joindre les travaux réalisés au relevé</span></label>'
    + (travaux.length ? '<ul class="rl-travaux">' + travauxVus.map(function (t) { return '<li>' + echapper(t.titre) + ' <span class="petit">(' + echapper(libelleAxe(t.axe)) + ', ' + libelleDate(t.faitLe, 'moyen') + ')</span></li>'; }).join('') + '</ul>'
      + (travaux.length > TRAVAUX_VISIBLES ? '<button class="lien" data-action="travaux-tous">' + (RELEVE_TRAVAUX_TOUS ? 'Voir moins' : 'Voir plus (' + (travaux.length - TRAVAUX_VISIBLES) + ')') + '</button>' : '')
      : '<p class="petit" style="margin:4px 0 0;">Aucune tâche passée en « Fait » ce mois. Les tâches terminées apparaissent ici automatiquement.</p>')
    + '</div></div>';

  /* Une fois tout facturé, les boutons sans objet disparaissent. */
  var peutFacturer = reste.total > 0 && (reste.lignes.some(function (l) { return l.facturable && l.montant > 0; }) || reste.frais > 0);
  var reportables = interventionsReportables(RELEVE_MOIS);
  if (reportables.length || peutFacturer) {
    html += '<div class="actions" style="margin-top:18px;">'
      + (reportables.length ? '<button class="btn btn-ghost" data-action="reporter" title="Porter des interventions de ce relevé sur un autre mois de facturation">Reporter sur un autre mois</button>' : '')
      + (peutFacturer ? '<button class="btn" data-action="facture">Établir la facture (' + fmtHeuresDec(reste.totalMinutesFacturables) + ', ' + fmtEuros(reste.total) + ')</button>' : '')
      + '</div>';
  }
  html += '</section>';

  document.getElementById('releveContenu').innerHTML = html;
}

/* Le relevé PDF d'un mois : dès qu'une facture existe, il reste celui qui
   l'accompagnait, quoi qu'il soit arrivé depuis. Une facture très ancienne,
   sans lignes figées, ne laisse que le journal. */
function htmlReleveDuMois(mois) {
  var meta = moisMeta(mois);
  var releve = releveDuMois(entreesJournal(), mois, ETAT.reglages, meta.frais);
  var lesFactures = facturesDuMois(mois);
  var options = { travaux: meta.joindreTravaux !== false ? travauxDuMois(mois) : [], numeroFacture: lesFactures.length ? lesFactures.map(function (f) { return f.numero; }).join(', ') : null };
  if (lesFactures.length && lesFactures.every(function (f) { return Array.isArray(f.lignes); })) {
    var derniere = lesFactures[lesFactures.length - 1];
    releve = releveFige(mois, lesFactures);
    if (Array.isArray(derniere.travaux)) options.travaux = derniere.travaux;
    options.dateEtabli = derniere.dateEmission;
    options.prestataire = derniere.prestataire;
    options.client = derniere.client;
    options.mentionTVA = derniere.mentionTVA;
  }
  return htmlReleve(releve, options);
}

function etablirFacture() {
  var mois = RELEVE_MOIS;
  var meta = moisMeta(mois);
  var releve = releveAFacturer(mois);
  if (releve.total <= 0 || !(releve.lignes.some(function (l) { return l.facturable && l.montant > 0; }) || releve.frais > 0)) { notifier('Rien à facturer pour ce mois.'); return; }
  var travaux = meta.joindreTravaux !== false ? travauxDuMois(mois).map(function (t) { return { titre: t.titre, axe: t.axe, faitLe: t.faitLe }; }) : [];
  var annee = Number(aujourdhui().slice(0, 4));
  var numero = numeroFactureSuivant(factures(), annee);
  var nbNonFact = releve.lignes.filter(function (l) { return !l.facturable; }).length;
  /* Les mois d'origine du travail reporté : la facture doit le dire. */
  var venus = {};
  releve.lignes.forEach(function (l) { if (l.reporte) venus[l.moisTravail] = true; });
  var moisVenus = Object.keys(venus).sort();
  var p = ETAT.reglages.prestataire || {};
  var m = ouvrirModale({
    titre: 'Établir la facture n° ' + numero,
    sousTitre: capitaliser(libelleMois(mois)) + ' · ' + fmtHeuresDec(releve.totalMinutesFacturables) + ' facturées · ' + fmtEuros(releve.total),
    corps: '<p class="petit" style="margin:0 0 12px;">La facture fige les ' + releve.lignes.filter(function (l) { return l.facturable; }).length + ' interventions facturables restantes du mois' + (nbNonFact ? ' (les ' + nbNonFact + ' interventions non facturables restent sur le relevé à 0 €)' : '') + (releve.remise > 0 ? ', avec ' + fmtEuros(releve.remise) + ' de remise sur forfait' : '') + '.'
      + (moisVenus.length ? ' Elle comprend du travail réalisé en ' + echapper(enumererMois(moisVenus)) + ', reporté sur ce mois ; la facture ne mentionne pas les dates de réalisation, le relevé et le journal les gardent.' : '')
      + ' Une facture émise ne se modifie plus ; seule la dernière peut être supprimée en cas d\'erreur avant envoi.</p>'
      + '<div class="grid-2">' + champHtml('faDate', 'Date d\'émission', 'date', aujourdhui()) + champHtml('faNumero', 'Numéro', 'text', numero) + '</div>'
      + '<p class="hint">Échéance de paiement à ' + fmtNombre(Number(ETAT.reglages.delaiPaiement) || 30, 0) + ' jours. ' + (p.iban ? 'Coordonnées bancaires imprimées dans le bloc Règlement (' + echapper(p.banque || 'banque non précisée') + ').' : 'Aucun IBAN renseigné dans les Réglages : la facture n\'en portera pas.')
      + ' ' + (ETAT.reglages.dossierFactures ? 'La facture et le relevé seront enregistrés dans le dossier des factures, sous-dossier « ' + echapper(mois + ' ' + libelleMoisSeul(mois)) + ' ».' : 'Aucun dossier des factures dans les Réglages : Sablier demandera où enregistrer les deux PDF.') + '</p>',
    pied: '<div class="a-droite"><button class="btn btn-ghost" data-role="annuler">Annuler</button><button class="btn" data-role="ok">Créer la facture et les PDF</button></div>',
  });
  /* Le numéro proposé suit l'année de la date d'émission, tant qu'il n'a
     pas été modifié à la main. */
  var numeroPropose = numero;
  m.querySelector('#faDate').addEventListener('change', function () {
    var champN = m.querySelector('#faNumero');
    var an = Number(String(this.value || '').slice(0, 4));
    if (!an || champN.value.trim() !== numeroPropose) return;
    numeroPropose = numeroFactureSuivant(factures(), an);
    champN.value = numeroPropose;
  });
  m.querySelector('[data-role=annuler]').addEventListener('click', fermerModale);
  m.querySelector('[data-role=ok]').addEventListener('click', function () {
    var dateEmission = m.querySelector('#faDate').value || aujourdhui();
    var attendu = numeroFactureSuivant(factures(), Number(dateEmission.slice(0, 4)));
    var num = m.querySelector('#faNumero').value.trim() || attendu;
    if (num !== attendu) { m.querySelector('#faNumero').classList.add('invalide'); notifier('Les numéros se suivent sans trou : le prochain pour ' + dateEmission.slice(0, 4) + ' est le ' + attendu + '.', { type: 'erreur' }); return; }
    var precedente = trierPar(factures(), function (x) { return x.dateEmission + x.numero; }, true)[0];
    if (precedente && dateEmission < precedente.dateEmission) { m.querySelector('#faDate').classList.add('invalide'); notifier('La date d\'émission ne peut pas précéder celle de la facture n° ' + precedente.numero + ' (' + dateFr(precedente.dateEmission) + ').', { type: 'erreur' }); return; }
    var f = construireFacture(releve, ETAT.reglages, { numero: num, dateEmission: dateEmission, travaux: travaux, factures: factures() });
    factures().push(f);
    sauver('factures');
    fermerModale();
    rafraichir();
    notifier('Facture n° ' + f.numero + ' créée (' + fmtEuros(f.total) + ').', { type: 'succes' });
    exporterFacturePdf(f.id);
  });
}

/* ---------- Reporter sur un autre mois de facturation ----------
   Le travail garde sa date dans le journal ; seule change la facture qui
   le portera. Le report emporte toute la part qu'une facture n'a pas figée. */

/* Les interventions du relevé affiché qu'une facture n'a pas encore figées. */
function interventionsReportables(mois) {
  var deja = {};
  var liste = [];
  entreesDuMoisDeFacturation(entreesJournal(), mois).forEach(function (e) {
    var cle = cleTravail(e);
    if (deja[cle]) return;
    deja[cle] = true;
    var lignes = partReportable(lignesMemeIntervention(e), factures());
    if (!lignes.length) return;
    liste.push({ cle: cle, lignes: lignes, date: e.date, axe: e.axe, intervention: e.intervention, moisTravail: moisDe(e.date), totaux: totauxEntrees(lignes, ETAT.reglages, true) });
  });
  return trierPar(liste, function (x) { return x.date + x.intervention; });
}

function ouvrirReport() {
  var mois = RELEVE_MOIS;
  var liste = interventionsReportables(mois);
  if (!liste.length) { notifier('Rien à reporter sur ce relevé : tout est déjà figé sur une facture.'); return; }
  /* Le mois du travail le plus ancien donne le plancher des choix possibles. */
  var plancher = liste.reduce(function (p, x) { return !p || x.moisTravail < p ? x.moisTravail : p; }, '');
  var m = ouvrirModale({
    titre: 'Reporter sur un autre mois',
    sousTitre: 'Relevé ' + deLibelleMois(mois) + ' · ' + liste.length + (liste.length > 1 ? ' interventions déplaçables' : ' intervention déplaçable'),
    corps: '<p class="petit" style="margin:0 0 12px;">Le travail garde sa date dans le journal. Il quitte le relevé ' + echapper(deLibelleMois(mois)) + ' et rejoint le relevé et la facture du mois choisi. Une intervention se déplace toujours entière.</p>'
      + '<div class="field"><label for="rpMois">Mois de facturation</label>'
      + selectMoisHtml('rpMois', mois, { liste: moisFacturationPossibles(plancher, mois), pleineLargeur: true })
      + '<p class="hint" id="rpAide"></p></div>'
      + '<div class="field"><label>Interventions à reporter</label><div class="rp-liste">'
      + liste.map(function (x, i) {
        return '<label class="rp-item" data-travail="' + echapper(x.moisTravail) + '"><input type="checkbox" data-i="' + i + '" checked>'
          + '<span class="rp-nom">' + puceAxeHtml(x.axe) + '<span>' + echapper(x.intervention) + '</span></span>'
          + '<span class="rp-chiffres">' + dateFr(x.date) + ' · ' + fmtHeuresDec(x.totaux.minutesFacturables) + ' · ' + fmtEuros(x.totaux.montant) + '</span></label>';
      }).join('')
      + '</div><p class="hint" id="rpImpossibles"></p></div>',
    pied: '<div class="a-droite"><button class="btn btn-ghost" data-role="annuler">Annuler</button><button class="btn" data-role="ok">Reporter</button></div>',
  });
  var champ = m.querySelector('#rpMois');
  var ok = m.querySelector('[data-role=ok]');
  var cases = Array.prototype.slice.call(m.querySelectorAll('.rp-item input'));
  var maj = function () {
    var cible = champ.value;
    /* Une intervention ne se facture jamais avant d'avoir été faite : celles
       qui sont postérieures au mois choisi sortent de la sélection. */
    var horsDelai = 0;
    cases.forEach(function (c) {
      var item = c.closest('.rp-item');
      var trop = item.dataset.travail > cible;
      item.classList.toggle('rp-impossible', trop);
      c.disabled = trop;
      if (trop) { c.checked = false; horsDelai++; }
    });
    var choisies = cases.filter(function (c) { return c.checked && !c.disabled; }).length;
    m.querySelector('#rpImpossibles').textContent = horsDelai
      ? (horsDelai > 1 ? horsDelai + ' interventions sont postérieures' : 'Une intervention est postérieure') + ' à ' + libelleMois(cible) + ' : elles ne peuvent pas y être facturées.'
      : '';
    m.querySelector('#rpAide').textContent = cible === mois
      ? 'Choisissez le mois qui portera ce travail. Le mois affiché le porte aujourd\'hui.'
      : aideMoisFacturation(plancher, cible);
    ok.textContent = choisies > 1 ? 'Reporter ' + choisies + ' interventions' : 'Reporter';
    ok.disabled = !choisies || cible === mois;
  };
  cases.forEach(function (c) { c.addEventListener('change', maj); });
  champ.addEventListener('change', maj);
  maj();
  m.querySelector('[data-role=annuler]').addEventListener('click', fermerModale);
  ok.addEventListener('click', function () {
    var cible = champ.value;
    var choisies = cases.filter(function (c) { return c.checked && !c.disabled; }).map(function (c) { return liste[Number(c.dataset.i)]; });
    if (!choisies.length || cible === mois) return;
    fermerModale();
    appliquerReportInterventions(choisies, cible, mois);
  });
}

/* Applique le mois choisi, puis le dit sans ambiguïté. */
function appliquerReportInterventions(choisies, cible, moisDepart) {
  var lignes = [];
  choisies.forEach(function (x) { lignes = lignes.concat(x.lignes); });
  var n = appliquerMoisFacturation(lignes, cible);
  if (!n) { notifier('Rien n\'a changé : ces interventions sont déjà facturées en ' + libelleMois(cible) + '.'); return; }
  rafraichir();
  var t = totauxEntrees(lignes, ETAT.reglages, true);
  var quoi = choisies.length > 1 ? choisies.length + ' interventions' : '« ' + choisies[0].intervention + ' »';
  notifier(quoi + ' : ' + fmtHeuresDec(t.minutesFacturables) + ' et ' + fmtEuros(t.montant) + ' HT passent sur le relevé ' + deLibelleMois(cible) + '.', {
    type: 'succes', duree: 9000,
    action: {
      libelle: 'Annuler le report',
      fn: function () {
        appliquerMoisFacturation(lignes, moisDepart);
        rafraichir();
        notifier('Report annulé : le travail revient sur le relevé ' + deLibelleMois(moisDepart) + '.');
      },
    },
  });
}
