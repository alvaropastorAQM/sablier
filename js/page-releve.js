/* ============================================================
   LOG AND STATEMENT PAGE: the month's work day by day, the activity
   statement of the contract (article 6.3) and invoice creation.

   A month can carry several invoices: each one only takes the entries not
   yet invoiced (for example a start-up invoice early in the month, then
   the one for the current work at the end of the month).
   ============================================================ */
'use strict';

var RELEVE_MOIS = null;
var RELEVE_JOURS = {};        // expanded days (ISO date)
var RELEVE_TRAVAUX_TOUS = false;
var TRAVAUX_VISIBLES = 4;

function initReleve() {
  PAGES.releve = rendreReleve;
  var zone = document.getElementById('releveContenu');
  zone.addEventListener('click', function (ev) {
    /* The expanded log entries keep their own actions. */
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
      if (n == null || n < 0) { notifier('Could not read the expenses amount (e.g. 12.50).', { type: 'erreur' }); rendreReleve(); return; }
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
/* The latest invoice of the month (compatibility). */
function factureDuMois(mois) {
  var l = facturesDuMois(mois);
  return l.length ? l[l.length - 1] : null;
}
/* The completed tasks the month's statement can attach: those of the
   month, plus those of the months whose moved work it bills. */
function travauxDuMois(mois) {
  var moisConcernes = [mois];
  reportsVers(entreesJournal(), mois, ETAT.reglages).forEach(function (g) { if (moisConcernes.indexOf(g.mois) < 0) moisConcernes.push(g.mois); });
  return trierPar(taches().filter(function (t) { return t.statut === 'fait' && t.faitLe && moisConcernes.indexOf(moisDe(t.faitLe)) >= 0; }), 'faitLe');
}
/* What is left to invoice in a month: entries outside existing invoices,
   expenses not yet included. */
function releveAFacturer(mois) {
  var r = ETAT.reglages;
  var meta = moisMeta(mois);
  var lesFactures = facturesDuMois(mois);
  var fraisFactures = lesFactures.reduce(function (s, f) { return s + (Number(f.frais) || 0); }, 0);
  var fraisRestants = Math.max(0, arrondir2((Number(meta.frais) || 0) - fraisFactures));
  var deja = idsFactures(factures(), mois, entreesJournal());
  return releveDuMois(entreesJournal(), mois, r, fraisRestants, { exclureIds: deja });
}
/* Invoicing state of a statement work item: { facture, partiel }.
   "partiel" when only some of its entries are invoiced.
   Old invoices, with no list of entries, cover the month of the work;
   the others are read on the billing month of the displayed statement. */
function etatFacturationLigne(l) {
  var anciennes = facturesDuMois(moisDe(l.date)).filter(function (f) { return !Array.isArray(f.entreesIds); });
  if (anciennes.length) return { facture: anciennes[0], partiel: false };
  var facturees = l.ids.map(function (id) { return factureDeEntree(factures(), id); }).filter(Boolean);
  if (!facturees.length) return { facture: null, partiel: false };
  return { facture: facturees[0], partiel: facturees.length < l.ids.length };
}
/* An invoiced month is read back from the frozen lines of its invoices
   (the rate or the lines may have changed since, work may have been added). */
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

/* The banner of a group of moved entries. The word "billed" only makes
   sense if the group carries an amount: otherwise it is just "moved". */
function bandeauReportHtml(g, sens) {
  var t = g.totaux;
  var n = t.nbInterventions;
  var chiffres = t.montant > 0 ? fmtHeuresDec(t.minutesFacturables) + ', ' + fmtEuros(t.montant) + ' excl. tax' : fmtDuree(t.minutes) + ', no amount (non-billable)';
  var sujet = n > 1 ? n + ' work items' : 'One work item';
  var texte = sens === 'envoye'
    ? sujet + ' from ' + libelleMois(RELEVE_MOIS) + (n > 1 ? ' are' : ' is') + ' moved to the ' + libelleMois(g.mois) + ' statement: ' + chiffres + '.'
    : sujet + ' done in ' + libelleMois(g.mois) + (n > 1 ? ' are' : ' is') + ' moved to this statement: ' + chiffres + '.';
  return '<div class="alert alert-info"><span>' + echapper(texte) + '</span>'
    + '<button class="btn btn-petit btn-ghost" data-action="releve" data-mois="' + echapper(g.mois) + '">View the ' + echapper(libelleMois(g.mois)) + ' statement</button></div>';
}

/* The contract's months, extended to the displayed month if it falls outside. */
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

  var html = '<div class="page-entete"><div><h2 class="page-titre">Log and statement</h2>'
    + '<p class="page-sous">The month\'s work, day by day: click a day to see its entries. The statement follows the contract (article 6.3); the month total is rounded up only once to the next quarter hour (article 6.1).</p></div>'
    + '<div class="actions"><button class="btn btn-ghost" data-action="nouvelle-ligne">Add an entry</button>'
    + '<div class="mois-nav"><button class="btn-icone" data-action="mois-prec" title="Previous month">‹</button>' + selectMoisHtml('rlMois', RELEVE_MOIS, { liste: moisAutour(RELEVE_MOIS) }) + '<button class="btn-icone" data-action="mois-suiv" title="Next month">›</button></div></div></div>';

  lesFactures.forEach(function (f) {
    var nb = Array.isArray(f.entreesIds) ? f.entreesIds.length : null;
    var nbInt = (f.lignes || []).length;
    html += '<div class="alert alert-success"><span>Invoice no. <b>' + echapper(f.numero) + '</b> issued on ' + dateFr(f.dateEmission) + ': ' + fmtEuros(f.total) + (nb != null ? ' (' + nb + (nb > 1 ? ' entries' : ' entry') + ', ' + nbInt + (nbInt > 1 ? ' work items' : ' work item') + ')' : '') + (f.statut === 'payee' ? ', paid on ' + dateFr(f.datePaiement) : '') + '.</span>'
      + '<span style="margin-left:auto; display:flex; gap:8px;"><button class="btn btn-petit btn-ghost" data-action="pdf-facture" data-id="' + echapper(f.id) + '" title="A new copy of the invoice and the statement, without touching the PDFs already saved">Regenerate the PDFs</button><button class="btn btn-petit btn-ghost" data-action="voir-factures">View the invoices</button></span></div>';
  });

  /* What the month sends elsewhere; what it receives has its own row in the table. */
  releve.reportsEnvoyes.forEach(function (g) {
    html += bandeauReportHtml(g, 'envoye');
  });

  html += '<section class="card">'
    + '<div class="rl-entete">'
    + '<div><div class="libelle">Contractor</div><div>' + echapper(r.prestataire.nom) + ' · SIREN ' + echapper(r.prestataire.siren) + '</div></div>'
    + '<div><div class="libelle">Client</div><div>' + echapper(r.client.societe) + (r.client.contact ? ' · ' + echapper(r.client.contact) : '') + '</div></div>'
    + '<div><div class="libelle">Month</div><div>' + echapper(capitaliser(libelleMois(RELEVE_MOIS))) + '</div></div>'
    + '<div><div class="libelle">Hourly rate</div><div>' + fmtEuros(r.tarifHoraire) + ' excl. tax · ' + echapper(r.mentionTVA) + '</div></div>'
    + '</div>';

  /* Each day stays in its work month; those invoiced on another month are
     marked "moved to …", figures outside the total. Work received from
     other months takes one row per month of origin, so that the total
     stays the invoice's. */
  var partis = entreesDuMois(entreesJournal(), RELEVE_MOIS).filter(function (e) { return moisFacturationDe(e) !== RELEVE_MOIS; });
  if (!releve.lignes.length && !partis.length) {
    html += '<div class="vide">No work items in ' + echapper(libelleMois(RELEVE_MOIS)) + '. <button class="lien" data-action="nouvelle-ligne">Add an entry</button></div>';
  } else {
    var arrondi = releve.arrondiMinutes || 0;
    var montants = montantsAuCentime(releve.lignes.map(function (l) { return l.montant; }).concat([arrondi / 60 * releve.tarif]));
    /* The rounding row bridges the month's lines and the authoritative total. */
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
        ? g.factures.map(function (f) { return '<span class="fa-statut ' + (f.statut === 'payee' && !enPartie ? 'payee' : 'emise') + '" title="' + (enPartie ? 'Some entries are still to be invoiced' : 'Invoice no. ' + echapper(f.numero)) + '">' + (enPartie ? 'partly invoiced (no. ' : 'invoiced (no. ') + echapper(f.numero) + ')</span>'; }).join(' ')
        : (g.aFacturer ? '<span class="puce">to invoice</span>' : (g.nb ? '<span class="puce neutre">non-billable</span>' : ''));
    };
    html += '<div class="tableau-defilant"><table class="tableau rl-jours"><thead><tr><th>Day</th><th class="num">Work items</th><th class="num">Billed time</th><th class="num">Amount excl. tax</th><th>Status</th></tr></thead><tbody>'
      + trierPar(jours, 'date').map(function (j) {
        var ouvert = !!RELEVE_JOURS[j.date];
        /* A fully moved day shows its figures greyed out, outside the total. */
        var t = j.nb ? null : totauxEntrees(j.partisJour, r, true);
        var nb = j.nb + (j.partisJour.length ? regrouperInterventions(j.partisJour, r).length : 0);
        var etat = [etatHtml(j)].concat(j.reportes.map(function (m) {
          var fac = j.partisJour.map(function (e) { return factureDeEntree(factures(), e.id); }).filter(Boolean)[0];
          return '<span class="puce" title="Billed in ' + libelleMois(m) + (fac ? ', invoice no. ' + echapper(fac.numero) : '') + '">moved to ' + echapper(libelleMoisSeul(m)) + '</span>';
        })).filter(Boolean).join(' ');
        var detail = ouvert
          ? '<tr class="rl-detail"><td colspan="5">' + trierPar(j.entrees, function (e) { return (e.debut || '99:99') + (e.creeLe || ''); }).map(ligneJournalHtml).join('') + '</td></tr>'
          : '';
        return '<tr class="rl-jour' + (ouvert ? ' ouvert' : '') + (t ? ' rl-reporte' : '') + '" data-action="jour" data-jour="' + echapper(j.date) + '" title="' + (ouvert ? 'Collapse' : 'Show details') + '">'
          + '<td><span class="rl-chevron">' + icone('chevron', 12) + '</span>' + echapper(capitaliser(libelleDate(j.date, 'long'))) + '</td>'
          + '<td class="num">' + nb + '</td><td class="num">' + fmtHeuresDec(t ? t.minutesFacturables : j.minutes) + '</td><td class="num">' + fmtEuros(t ? t.montant : arrondir2(j.montant)) + '</td><td>' + etat + '</td></tr>'
          + detail;
      }).join('')
      + recus.map(function (g) {
        return '<tr class="rl-recu" data-action="releve" data-mois="' + echapper(g.mois) + '" title="View ' + echapper(libelleMois(g.mois)) + '">'
          + '<td><span class="rl-chevron">' + icone('chevron', 12) + '</span>Moved from ' + echapper(libelleMois(g.mois)) + '</td>'
          + '<td class="num">' + g.nb + '</td><td class="num">' + fmtHeuresDec(g.minutes) + '</td><td class="num">' + fmtEuros(arrondir2(g.montant)) + '</td><td>' + etatHtml(g) + '</td></tr>';
      }).join('')
      + (minutesArrondi || montantArrondi ? '<tr><td>' + (lesFactures.length ? 'Each invoice rounded up to the next quarter hour' : 'Total rounded up to the next quarter hour') + '</td><td class="num"></td><td class="num">' + fmtHeuresDec(minutesArrondi) + '</td><td class="num">' + fmtEuros(montantArrondi) + '</td><td></td></tr>' : '')
      + '</tbody><tfoot><tr><td>Total billed for the month</td><td class="num">' + releve.lignes.length + '</td><td class="num">' + fmtHeuresDec(totalFoi.minutes) + '</td><td class="num">' + fmtEuros(totalFoi.montant) + '</td><td></td></tr></tfoot></table></div>';
  }

  var minutesRecues = releve.reportsRecus.reduce(function (s, g) { return s + g.totaux.minutes; }, 0);
  var minutesParties = releve.reportsEnvoyes.reduce(function (s, g) { return s + g.totaux.minutes; }, 0);
  var moisRecu = releve.reportsRecus.length === 1 ? libelleMois(releve.reportsRecus[0].mois) : 'other months';
  var moisParti = releve.reportsEnvoyes.length === 1 ? 'the ' + libelleMois(releve.reportsEnvoyes[0].mois) + ' statement' : 'other months';
  html += '<div class="rl-recap">'
    + '<div class="panneau"><div class="libelle">Time spent</div><div class="val">' + fmtHeuresDec(releve.totalMinutes) + '</div>'
      + (releve.totalMinutesNonFacturables ? '<div class="petit">of which ' + fmtHeuresDec(releve.totalMinutesNonFacturables) + ' non-billable</div>' : '')
      + (minutesRecues ? '<div class="petit">of which ' + fmtHeuresDec(minutesRecues) + ' from ' + echapper(moisRecu) + '</div>' : '')
      + (minutesParties ? '<div class="petit">excluding ' + fmtHeuresDec(minutesParties) + ' moved to ' + echapper(moisParti) + '</div>' : '')
      + '</div>'
    + '<div class="panneau"><div class="libelle">Billed time</div><div class="val">' + fmtHeuresDec(totalFoi.minutes) + '</div><div class="petit">' + fmtNombre(totalFoi.minutes / 60 / hj, 2) + ' days of ' + fmtNombre(hj, 0) + ' h</div></div>'
    + '</div>';

  var travauxVus = RELEVE_TRAVAUX_TOUS ? travaux : travaux.slice(0, TRAVAUX_VISIBLES);
  html += '<div class="grid-2" style="align-items:start;">'
    + '<div class="panneau"><div class="libelle" style="margin-bottom:8px;">Authorised travel expenses</div>'
    + '<div class="rl-frais"><input type="text" id="rlFrais" class="champ" value="' + (meta.frais ? fmtNombreSaisie(meta.frais, 2) : '') + '" placeholder="0.00" inputmode="decimal"> <span class="petit">€ for the month, with prior agreement and receipts (article 6.6)</span></div></div>'
    + '<div class="panneau"><label class="field-ligne" style="padding:0 0 6px;"><input type="checkbox" id="rlJoindre"' + (meta.joindreTravaux !== false ? ' checked' : '') + '> <span class="libelle" style="margin:0;">Attach the completed tasks to the statement</span></label>'
    + (travaux.length ? '<ul class="rl-travaux">' + travauxVus.map(function (t) { return '<li>' + echapper(t.titre) + ' <span class="petit">(' + echapper(libelleAxe(t.axe)) + ', ' + libelleDate(t.faitLe, 'moyen') + ')</span></li>'; }).join('') + '</ul>'
      + (travaux.length > TRAVAUX_VISIBLES ? '<button class="lien" data-action="travaux-tous">' + (RELEVE_TRAVAUX_TOUS ? 'See less' : 'See more (' + (travaux.length - TRAVAUX_VISIBLES) + ')') + '</button>' : '')
      : '<p class="petit" style="margin:4px 0 0;">No task marked "Done" this month. Completed tasks appear here automatically.</p>')
    + '</div></div>';

  /* Once everything is invoiced, the buttons with no purpose disappear. */
  var peutFacturer = reste.total > 0 && (reste.lignes.some(function (l) { return l.facturable && l.montant > 0; }) || reste.frais > 0);
  var reportables = interventionsReportables(RELEVE_MOIS);
  if (reportables.length || peutFacturer) {
    html += '<div class="actions" style="margin-top:18px;">'
      + (reportables.length ? '<button class="btn btn-ghost" data-action="reporter" title="Move some work items from this statement to another billing month">Move to another month</button>' : '')
      + (peutFacturer ? '<button class="btn" data-action="facture">Create the invoice (' + fmtHeuresDec(reste.totalMinutesFacturables) + ', ' + fmtEuros(reste.total) + ')</button>' : '')
      + '</div>';
  }
  html += '</section>';

  document.getElementById('releveContenu').innerHTML = html;
}

/* A month's PDF statement: as soon as an invoice exists, it stays the one
   that came with it, whatever happened since. A very old invoice, with no
   frozen lines, leaves only the log. */
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
  if (releve.total <= 0 || !(releve.lignes.some(function (l) { return l.facturable && l.montant > 0; }) || releve.frais > 0)) { notifier('Nothing to invoice for this month.'); return; }
  var travaux = meta.joindreTravaux !== false ? travauxDuMois(mois).map(function (t) { return { titre: t.titre, axe: t.axe, faitLe: t.faitLe }; }) : [];
  var annee = Number(aujourdhui().slice(0, 4));
  var numero = numeroFactureSuivant(factures(), annee);
  var nbNonFact = releve.lignes.filter(function (l) { return !l.facturable; }).length;
  var nbFact = releve.lignes.filter(function (l) { return l.facturable; }).length;
  /* The months the moved work comes from: the invoice must say so. */
  var venus = {};
  releve.lignes.forEach(function (l) { if (l.reporte) venus[l.moisTravail] = true; });
  var moisVenus = Object.keys(venus).sort();
  var p = ETAT.reglages.prestataire || {};
  var m = ouvrirModale({
    titre: 'Create invoice no. ' + numero,
    sousTitre: capitaliser(libelleMois(mois)) + ' · ' + fmtHeuresDec(releve.totalMinutesFacturables) + ' billed · ' + fmtEuros(releve.total),
    corps: '<p class="petit" style="margin:0 0 12px;">The invoice freezes the ' + nbFact + ' remaining billable work ' + (nbFact === 1 ? 'item' : 'items') + ' of the month' + (nbNonFact ? ' (the ' + nbNonFact + ' non-billable work ' + (nbNonFact === 1 ? 'item stays' : 'items stay') + ' on the statement at €0)' : '') + (releve.remise > 0 ? ', with a flat-fee discount of ' + fmtEuros(releve.remise) : '') + '.'
      + (moisVenus.length ? ' It includes work done in ' + echapper(enumererMois(moisVenus)) + ', moved to this month; the invoice does not show completion dates, the statement and the log keep them.' : '')
      + ' An issued invoice can no longer be edited; only the latest one can be deleted if there is a mistake before it is sent.</p>'
      + '<div class="grid-2">' + champHtml('faDate', 'Issue date', 'date', aujourdhui()) + champHtml('faNumero', 'Number', 'text', numero) + '</div>'
      + '<p class="hint">Payment due in ' + fmtNombre(Number(ETAT.reglages.delaiPaiement) || 30, 0) + ' days. ' + (p.iban ? 'Bank details printed in the Payment terms block (' + echapper(p.banque || 'bank not specified') + ').' : 'No IBAN entered in Settings: the invoice will not show one.')
      + ' ' + (ETAT.reglages.dossierFactures ? 'The invoice and the statement will be saved in the invoices folder, in the subfolder "' + echapper(mois + ' ' + libelleMoisSeul(mois)) + '".' : 'No invoices folder set in Settings: Sablier will ask where to save the two PDFs.') + '</p>',
    pied: '<div class="a-droite"><button class="btn btn-ghost" data-role="annuler">Cancel</button><button class="btn" data-role="ok">Create the invoice and PDFs</button></div>',
  });
  /* The suggested number follows the year of the issue date, as long as it
     has not been edited by hand. */
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
    if (num !== attendu) { m.querySelector('#faNumero').classList.add('invalide'); notifier('Invoice numbers run without gaps: the next one for ' + dateEmission.slice(0, 4) + ' is ' + attendu + '.', { type: 'erreur' }); return; }
    var precedente = trierPar(factures(), function (x) { return x.dateEmission + x.numero; }, true)[0];
    if (precedente && dateEmission < precedente.dateEmission) { m.querySelector('#faDate').classList.add('invalide'); notifier('The issue date cannot be earlier than that of invoice no. ' + precedente.numero + ' (' + dateFr(precedente.dateEmission) + ').', { type: 'erreur' }); return; }
    var f = construireFacture(releve, ETAT.reglages, { numero: num, dateEmission: dateEmission, travaux: travaux, factures: factures() });
    factures().push(f);
    sauver('factures');
    fermerModale();
    rafraichir();
    notifier('Invoice no. ' + f.numero + ' created (' + fmtEuros(f.total) + ').', { type: 'succes' });
    exporterFacturePdf(f.id);
  });
}

/* ---------- Move to another billing month ----------
   The work keeps its date in the log; only the invoice that will carry it
   changes. The move takes all the part that no invoice has frozen. */

/* The displayed statement's work items that no invoice has frozen yet. */
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
  if (!liste.length) { notifier('Nothing to move on this statement: everything is already frozen on an invoice.'); return; }
  /* The oldest work month sets the floor of the possible choices. */
  var plancher = liste.reduce(function (p, x) { return !p || x.moisTravail < p ? x.moisTravail : p; }, '');
  var m = ouvrirModale({
    titre: 'Move to another month',
    sousTitre: 'Statement for ' + libelleMois(mois) + ' · ' + liste.length + (liste.length > 1 ? ' movable work items' : ' movable work item'),
    corps: '<p class="petit" style="margin:0 0 12px;">The work keeps its date in the log. It leaves the ' + echapper(libelleMois(mois)) + ' statement and joins the statement and invoice of the chosen month. A work item always moves as a whole.</p>'
      + '<div class="field"><label for="rpMois">Billing month</label>'
      + selectMoisHtml('rpMois', mois, { liste: moisFacturationPossibles(plancher, mois), pleineLargeur: true })
      + '<p class="hint" id="rpAide"></p></div>'
      + '<div class="field"><label>Work items to move</label><div class="rp-liste">'
      + liste.map(function (x, i) {
        return '<label class="rp-item" data-travail="' + echapper(x.moisTravail) + '"><input type="checkbox" data-i="' + i + '" checked>'
          + '<span class="rp-nom">' + puceAxeHtml(x.axe) + '<span>' + echapper(x.intervention) + '</span></span>'
          + '<span class="rp-chiffres">' + dateFr(x.date) + ' · ' + fmtHeuresDec(x.totaux.minutesFacturables) + ' · ' + fmtEuros(x.totaux.montant) + '</span></label>';
      }).join('')
      + '</div><p class="hint" id="rpImpossibles"></p></div>',
    pied: '<div class="a-droite"><button class="btn btn-ghost" data-role="annuler">Cancel</button><button class="btn" data-role="ok">Move</button></div>',
  });
  var champ = m.querySelector('#rpMois');
  var ok = m.querySelector('[data-role=ok]');
  var cases = Array.prototype.slice.call(m.querySelectorAll('.rp-item input'));
  var maj = function () {
    var cible = champ.value;
    /* A work item is never invoiced before it was done: those dated after
       the chosen month drop out of the selection. */
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
      ? (horsDelai > 1 ? horsDelai + ' work items are dated after ' + libelleMois(cible) + ': they cannot be invoiced in it.' : 'One work item is dated after ' + libelleMois(cible) + ': it cannot be invoiced in it.')
      : '';
    m.querySelector('#rpAide').textContent = cible === mois
      ? 'Choose the month that will carry this work. The displayed month carries it today.'
      : aideMoisFacturation(plancher, cible);
    ok.textContent = choisies > 1 ? 'Move ' + choisies + ' work items' : 'Move';
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

/* Applies the chosen month, then says so unambiguously. */
function appliquerReportInterventions(choisies, cible, moisDepart) {
  var lignes = [];
  choisies.forEach(function (x) { lignes = lignes.concat(x.lignes); });
  var n = appliquerMoisFacturation(lignes, cible);
  if (!n) { notifier('Nothing changed: these work items are already invoiced in ' + libelleMois(cible) + '.'); return; }
  rafraichir();
  var t = totauxEntrees(lignes, ETAT.reglages, true);
  var quoi = choisies.length > 1 ? choisies.length + ' work items' : '"' + choisies[0].intervention + '"';
  notifier(quoi + ': ' + fmtHeuresDec(t.minutesFacturables) + ' and ' + fmtEuros(t.montant) + ' excl. tax move to the ' + libelleMois(cible) + ' statement.', {
    type: 'succes', duree: 9000,
    action: {
      libelle: 'Undo move',
      fn: function () {
        appliquerMoisFacturation(lignes, moisDepart);
        rafraichir();
        notifier('Move undone: the work is back on the ' + libelleMois(moisDepart) + ' statement.');
      },
    },
  });
}
