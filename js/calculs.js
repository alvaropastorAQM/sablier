/* ============================================================
   CALCULATION ENGINE: durations, grouping by work item, rounding
   of billed time, monthly statement, invoices, URSSAF quarters.

   Rules (contract of 01/10/2026, article 6.1):
   - time is counted by the hour, rounded up to the next quarter hour;
   - a "work item" = same day + same area + same label;
     its entries are added up BEFORE rounding, as in the original
     Excel workbook;
   - amount = billed hours x hourly rate;
   - no VAT (VAT exemption).

   No DOM; tested by tests/test-calculs.js.
   ============================================================ */
'use strict';

if (typeof module !== 'undefined' && module.exports && typeof moisDe === 'undefined') {
  Object.assign(globalThis, require('./utils.js'));
}

/* Duration of an entry in minutes: the typed duration wins; failing
   that, the gap between start and end. */
function dureeEntree(e) {
  if (!e) return 0;
  var m = e.minutes;
  if (typeof m === 'string' && m.trim() !== '') m = Number(m.replace(',', '.'));
  if (typeof m === 'number' && isFinite(m) && m >= 0) return Math.round(m);
  var d = minutesEntre(e.debut, e.fin);
  return d == null ? 0 : d;
}

/* Rounds up to the next multiple of "arrondiHeures" (0.25 = quarter hour).
   A zero or missing rounding leaves the minutes as they are. */
function arrondirMinutes(minutes, arrondiHeures) {
  var pas = Math.round((Number(arrondiHeures) || 0) * 60);
  var m = Math.max(0, Math.round(minutes || 0));
  if (!pas) return m;
  return Math.ceil(m / pas) * pas;
}

/* Billing month of an entry: the moisFacturation field when it is set
   (September work carried onto the October invoice), otherwise the
   month of its date. */
function moisFacturationDe(e) {
  var m = e && e.moisFacturation;
  return moisValide(m) ? m : moisDe(e && e.date);
}
/* True when the entry is billed in a different month than the one it was worked in. */
function estReporte(e) {
  var m = moisDe(e && e.date);
  return !!m && moisFacturationDe(e) !== m;
}
/* Billing month of a line frozen on an invoice: invoices issued before
   the move feature carry none, so their month is the invoice's. */
function moisFacturationLigneFacture(l, f) {
  if (l && moisValide(l.moisFacturation)) return l.moisFacturation;
  if (f && moisValide(f.mois)) return f.mois;
  return moisDe(l && l.date);
}
/* The work itself: same day, same area, same label, whatever month it is
   billed in. All its entries move together. */
function cleTravail(e) {
  return e.date + '|' + (e.axe || '') + '|' + normaliserCle(e.intervention);
}
function cleGroupe(moisFacturation, date, axe, intervention) {
  return moisFacturation + '|' + date + '|' + (axe || '') + '|' + normaliserCle(intervention);
}
function cleIntervention(e) {
  return cleGroupe(moisFacturationDe(e), e.date, e.axe, e.intervention);
}

/* An entry is billable unless stated otherwise (facturable: false, with
   a reason: training, goodwill gesture...). A flat fee is a fixed amount
   excl. tax that replaces hours × rate for the work item. */
function estFacturable(e) { return !(e && e.facturable === false); }

/* The details of a work item end to end: a comma between two sentence
   fragments, a space after a finished sentence (never ".,"). */
function joindreDetails(details) {
  return (details || []).reduce(function (s, d, i) { return i ? s + (/[.!?…]$/.test(s) ? ' ' : ', ') + d : d; }, '');
}

/* Amounts to the cent whose sum lands exactly on the rounded total
   (largest remainder method): each line starts from the lower cent, the
   missing cents go to the largest fractions. Rounded one by one, lines
   at half a cent (0.75 h × 42.86 = 32.145) would exceed the total by
   several cents. */
function montantsAuCentime(montants) {
  var cents = (montants || []).map(function (m) { return (Number(m) || 0) * 100; });
  var bas = cents.map(function (x) { return Math.floor(x + 1e-6); });
  var total = Math.round(arrondir2(cents.reduce(function (s, x) { return s + x; }, 0) / 100) * 100);
  var manque = total - bas.reduce(function (s, b) { return s + b; }, 0);
  cents.map(function (x, i) { return i; })
    .sort(function (a, b) { return (cents[b] - bas[b]) - (cents[a] - bas[a]) || a - b; })
    .slice(0, Math.max(0, manque))
    .forEach(function (i) { bas[i]++; });
  return bas.map(function (b) { return b / 100; });
}
function forfaitEntree(e) {
  var f = Number(e && e.forfait);
  return isFinite(f) && f > 0 ? arrondir2(f) : null;
}

/* Groups entries into work items (day + area + label), sorted by date
   then start time. Each work item carries the time spent, the billed
   time (exact, rounding is done on the total) and the amount. */
function regrouperInterventions(entrees, reglages) {
  var tarif = Number(reglages && reglages.tarifHoraire) || 0;
  var groupes = {};
  var ordre = [];
  (entrees || []).forEach(function (e) {
    if (!e || !e.date) return;
    var cle = cleIntervention(e);
    if (!groupes[cle]) {
      groupes[cle] = {
        cle: cle, date: e.date, axe: e.axe || '', intervention: String(e.intervention || '').trim(),
        details: [], entrees: [], ids: [], minutes: 0, minutesBrutesFacturables: 0, minutesNonFacturables: 0,
        motifs: [], forfait: null, premierDebut: e.debut || '',
        moisTravail: moisDe(e.date), moisFacturation: moisFacturationDe(e),
      };
      ordre.push(cle);
    }
    var g = groupes[cle];
    var m = dureeEntree(e);
    g.entrees.push(e);
    g.ids.push(e.id);
    g.minutes += m;
    if (estFacturable(e)) g.minutesBrutesFacturables += m;
    else {
      g.minutesNonFacturables += m;
      var motif = String(e.motif || '').trim();
      if (motif && g.motifs.indexOf(motif) < 0) g.motifs.push(motif);
    }
    var f = forfaitEntree(e);
    if (f != null && estFacturable(e)) g.forfait = arrondir2((g.forfait || 0) + f);
    var det = String(e.detail || '').trim();
    if (det && g.details.indexOf(det) < 0) g.details.push(det);
    if (e.debut && (!g.premierDebut || e.debut < g.premierDebut)) g.premierDebut = e.debut;
  });
  var liste = ordre.map(function (cle) {
    var g = groupes[cle];
    g.minutesFacturables = g.minutesBrutesFacturables;
    /* The amounts of a work item stay exact (like the workbook cells); only
       totals and display are rounded to the cent, so that "billed hours ×
       rate" comes out right on the invoice. */
    g.valeurHoraire = g.minutesFacturables / 60 * tarif;
    g.montant = g.forfait != null ? g.forfait : g.valeurHoraire;
    g.facturable = g.minutesBrutesFacturables > 0 || g.forfait != null;
    g.remise = g.forfait != null ? g.valeurHoraire - g.forfait : 0;
    g.reporte = g.moisFacturation !== g.moisTravail;
    g.nature = g.intervention + (g.details.length ? ': ' + joindreDetails(g.details) : '');
    return g;
  });
  liste.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.premierDebut !== b.premierDebut) return a.premierDebut < b.premierDebut ? -1 : 1;
    return 0;
  });
  return liste;
}

/* Minutes to add to round the TOTAL of the time billed by the hour up to
   the next quarter hour (article 6.1 of the contract). Contractor's rule
   of 26/10/2026: rounding each work item charged nearly two hours too
   many per month. Flat fees stay out of the rounded total. */
function arrondiDuTotal(groupes, reglages) {
  var pas = reglages && reglages.arrondi != null ? reglages.arrondi : 0.25;
  var exact = (groupes || []).reduce(function (s, g) { return s + (g.forfait == null ? g.minutesFacturables : 0); }, 0);
  return exact > 0 ? arrondirMinutes(exact, pas) - exact : 0;
}

/* The entries WORKED in the month: the log, the dashboard and the chips
   stick to these. */
function entreesDuMois(entrees, mois) {
  return (entrees || []).filter(function (e) { return e && moisDe(e.date) === mois; });
}
/* The entries BILLED in the month: the statement and the invoices rely
   on these, moving an entry shifts it from one month to another. */
function entreesDuMoisDeFacturation(entrees, mois) {
  return (entrees || []).filter(function (e) { return e && e.date && moisFacturationDe(e) === mois; });
}
function entreesPeriode(entrees, debut, fin) {
  return (entrees || []).filter(function (e) {
    return e && e.date && (!debut || e.date >= debut) && (!fin || e.date <= fin);
  });
}
/* What belongs to the contract: the work that falls in it, plus the work
   billed in it after a move (September work billed in October counts
   toward progress, since it is on an invoice of the contract). */
function entreesDuContrat(entrees, contrat) {
  var c = contrat || {};
  var debut = c.debut || '', fin = c.fin || '';
  var mDebut = debut ? moisDe(debut) : '', mFin = fin ? moisDe(fin) : '';
  return (entrees || []).filter(function (e) {
    if (!e || !e.date) return false;
    var parTravail = (!debut || e.date >= debut) && (!fin || e.date <= fin);
    var m = moisFacturationDe(e);
    var parFacturation = (!mDebut || m >= mDebut) && (!mFin || m <= mFin);
    return parTravail || parFacturation;
  });
}

/* Totals of a set of entries (after grouping), rounded total. With
   exact, no rounding: a piece of a statement (moved work) has no total
   to round, rounding is done on the total of the month that receives it. */
function totauxEntrees(entrees, reglages, exact) {
  var groupes = regrouperInterventions(entrees, reglages);
  var t = { minutes: 0, minutesFacturables: 0, montant: 0, nbInterventions: groupes.length, nbLignes: (entrees || []).length };
  groupes.forEach(function (g) {
    t.minutes += g.minutes;
    t.minutesFacturables += g.minutesFacturables;
    t.montant += g.montant;
  });
  var arrondi = exact ? 0 : arrondiDuTotal(groupes, reglages);
  t.minutesFacturables += arrondi;
  t.montant = arrondir2(t.montant + arrondi / 60 * (Number(reglages && reglages.tarifHoraire) || 0));
  return t;
}

/* The moves of a month, grouped by neighbouring month: what it receives
   ("versLeMois") or what it sends elsewhere. Each group carries its
   entries and totals, so the screen and the documents only have to
   print them. */
function reportsGroupes(entrees, mois, reglages, versLeMois) {
  var parMois = {}, ordre = [];
  (entrees || []).forEach(function (e) {
    if (!e || !e.date || !estReporte(e)) return;
    var origine = moisDe(e.date), arrivee = moisFacturationDe(e);
    if (versLeMois ? arrivee !== mois : origine !== mois) return;
    var cle = versLeMois ? origine : arrivee;
    if (!parMois[cle]) { parMois[cle] = { mois: cle, entrees: [] }; ordre.push(cle); }
    parMois[cle].entrees.push(e);
  });
  return ordre.sort().map(function (m) {
    var g = parMois[m];
    g.totaux = totauxEntrees(g.entrees, reglages, true);
    return g;
  });
}
/* What this month bills on behalf of other months. */
function reportsVers(entrees, mois, reglages) { return reportsGroupes(entrees, mois, reglages, true); }
/* What this month worked but has billed elsewhere. */
function reportsDepuis(entrees, mois, reglages) { return reportsGroupes(entrees, mois, reglages, false); }

/* The statement of a month: lines and totals, ready for the screen and
   the PDF. options.exclureIds: entries already invoiced to leave out.
   Work items keep their exact time; the total is rounded once
   (arrondiMinutes), like that of each invoice.

   The statement carries the work BILLED in the month, moves included: a
   September entry moved to October leaves the September statement for
   the October one, keeping its date. */
function releveDuMois(entrees, mois, reglages, frais, options) {
  var o = options || {};
  var toutes = entreesDuMoisDeFacturation(entrees, mois);
  var selection = toutes;
  if (o.exclureIds && o.exclureIds.length) selection = selection.filter(function (e) { return o.exclureIds.indexOf(e.id) < 0; });
  var lignes = regrouperInterventions(selection, reglages);
  var heuresJournee = Number(reglages && reglages.heuresJournee) || 7;
  var tarif = Number(reglages && reglages.tarifHoraire) || 0;
  var totalMinutes = 0, totalFact = 0, totalNonFact = 0, montant = 0, valeur = 0;
  var ids = [];
  lignes.forEach(function (l) {
    totalMinutes += l.minutes; totalFact += l.minutesFacturables; totalNonFact += l.minutesNonFacturables;
    montant += l.montant; valeur += l.valeurHoraire; ids = ids.concat(l.ids);
  });
  var arrondi = arrondiDuTotal(lignes, reglages);
  totalFact += arrondi; montant += arrondi / 60 * tarif; valeur += arrondi / 60 * tarif;
  montant = arrondir2(montant);
  valeur = arrondir2(valeur);
  var fraisNum = arrondir2(Number(frais) || 0);
  return {
    mois: mois,
    lignes: lignes,
    /* Enough to explain, on the statement, the gap with the log. */
    reportsRecus: reportsVers(entrees, mois, reglages),
    reportsEnvoyes: reportsDepuis(entrees, mois, reglages),
    ids: ids,
    tarif: tarif,
    totalMinutes: totalMinutes,
    totalMinutesFacturables: totalFact,
    arrondiMinutes: arrondi,
    totalMinutesNonFacturables: totalNonFact,
    heuresFacturables: arrondir2(totalFact / 60),
    journees: arrondir2(totalFact / 60 / heuresJournee),
    valeurHoraire: valeur,
    remise: arrondir2(Math.max(0, valeur - montant)),
    montantHT: montant,
    frais: fraisNum,
    total: arrondir2(montant + fraisNum),
  };
}

/* Time split by area. */
function repartitionParAxe(entrees, reglages) {
  var groupes = regrouperInterventions(entrees, reglages);
  var parAxe = {};
  var total = 0;
  groupes.forEach(function (g) {
    if (!parAxe[g.axe]) parAxe[g.axe] = { axe: g.axe, minutes: 0, minutesFacturables: 0, montant: 0 };
    parAxe[g.axe].minutes += g.minutes;
    parAxe[g.axe].minutesFacturables += g.minutesFacturables;
    parAxe[g.axe].montant += g.montant;
    total += g.minutes;
  });
  var liste = Object.keys(parAxe).map(function (k) { return parAxe[k]; });
  liste.forEach(function (a) { a.part = total ? a.minutes / total : 0; a.montant = arrondir2(a.montant); });
  liste.sort(function (a, b) { return b.minutes - a.minutes; });
  return liste;
}

/* Hours per month over a list of months. */
function heuresParMois(entrees, moisListe, reglages) {
  return (moisListe || []).map(function (m) {
    var t = totauxEntrees(entreesDuMois(entrees, m), reglages);
    return { mois: m, minutes: t.minutes, minutesFacturables: t.minutesFacturables, montant: t.montant };
  });
}

/* Progress against the contract's annual benchmark. */
function avancementContrat(entrees, reglages, dateRef) {
  var c = (reglages && reglages.contrat) || {};
  var debut = c.debut || '';
  var fin = c.fin || '';
  var t = totauxEntrees(entreesDuContrat(entrees, c), reglages);
  var repereMinutes = (Number(reglages && reglages.repereAnnuel) || 0) * 60;
  var ref = dateRef || aujourdhui();
  var moisContrat = debut && fin ? listeMois(moisDe(debut), moisDe(fin)) : [];
  var moisEcoules = moisContrat.filter(function (m) { return m <= moisDe(ref); }).length;
  var attendu = moisContrat.length ? repereMinutes * moisEcoules / moisContrat.length : 0;
  return {
    minutes: t.minutes,
    minutesFacturables: t.minutesFacturables,
    montant: t.montant,
    repereMinutes: repereMinutes,
    ratio: repereMinutes ? t.minutesFacturables / repereMinutes : 0,
    moisEcoules: moisEcoules,
    nbMois: moisContrat.length,
    attenduMinutes: attendu,
    repereMensuelMinutes: moisContrat.length ? repereMinutes / moisContrat.length : repereMinutes / 12,
  };
}

/* Work item labels already used, newest first (for autocompleting
   the entry form). */
function interventionsRecentes(entrees, axe) {
  var vus = {};
  var liste = [];
  trierPar((entrees || []).filter(Boolean), function (e) { return (e.date || '') + (e.debut || '') + (e.creeLe || ''); }, true).forEach(function (e) {
    if (axe && e.axe !== axe) return;
    var k = normaliserCle(e.intervention);
    if (!k || vus[k]) return;
    vus[k] = true;
    liste.push(String(e.intervention).trim());
  });
  return liste;
}

/* ---------- Invoices ---------- */

/* Continuous number per year: YYYY-NN. */
function numeroFactureSuivant(factures, annee) {
  var max = 0;
  (factures || []).forEach(function (f) {
    var m = String(f.numero || '').match(/^(\d{4})-(\d+)$/);
    if (m && Number(m[1]) === Number(annee)) max = Math.max(max, Number(m[2]));
  });
  return annee + '-' + deuxChiffres(max + 1);
}

/* Builds the invoice object from a statement: the lines, the two
   parties and the moves announced by the statement are frozen. */
function construireFacture(releve, reglages, options) {
  var o = options || {};
  var dateEmission = o.dateEmission || aujourdhui();
  var delai = nombreOu(reglages && reglages.delaiPaiement, 30);
  var annee = Number(dateEmission.slice(0, 4));
  return {
    id: o.id || uid('fac'),
    numero: o.numero || numeroFactureSuivant(o.factures || [], annee),
    mois: releve.mois,
    dateEmission: dateEmission,
    delaiPaiement: delai,
    dateEcheance: ajouterJours(dateEmission, delai),
    tarif: releve.tarif,
    minutesPassees: releve.totalMinutes,
    minutesFacturees: releve.totalMinutesFacturables,
    arrondiMinutes: releve.arrondiMinutes || 0,
    heuresFacturees: releve.heuresFacturables,
    journees: releve.journees,
    valeurHoraire: releve.valeurHoraire,
    remise: releve.remise,
    montantHT: releve.montantHT,
    frais: releve.frais,
    total: releve.total,
    mentionTVA: (reglages && reglages.mentionTVA) || '',
    prestataire: Object.assign({}, reglages && reglages.prestataire),
    client: Object.assign({}, reglages && reglages.client),
    reportsEnvoyes: (releve.reportsEnvoyes || []).map(function (g) { return { mois: g.mois, totaux: { minutes: g.totaux.minutes } }; }),
    entreesIds: releve.ids.slice(),
    lignes: releve.lignes.map(function (l) {
      return {
        date: l.date, axe: l.axe, nature: l.nature, intervention: l.intervention, details: l.details.slice(),
        moisFacturation: l.moisFacturation,
        minutes: l.minutes, minutesFacturables: l.minutesFacturables, montant: l.montant,
        facturable: l.facturable, motifs: l.motifs.slice(), forfait: l.forfait, valeurHoraire: l.valeurHoraire,
      };
    }),
    travaux: o.travaux || [],
    statut: 'emise',
    datePaiement: null,
    modePaiement: '',
    creeLe: new Date().toISOString(),
  };
}

/* Invoice lines grouped for its appendix. The invoice does not say when
   the work was done (no date, no original month): a work item carried out
   over several days (same area, same label) therefore fits on a single
   line, time and amounts added up. Each flat fee keeps its own line (its
   discount is its own); non-billable lines are grouped together. The
   lines frozen on the invoice keep their date: that is the trail,
   visible in the app. */
function regrouperLignesFacture(lignes) {
  var groupes = {}, ordre = [];
  (lignes || []).forEach(function (l) {
    if (!l) return;
    var facturable = l.facturable !== false;
    var forfait = facturable && l.forfait != null;
    var intervention = String(l.intervention || l.nature || '').replace(/\s+/g, ' ').trim();
    var cle = forfait ? 'forfait|' + ordre.length : (facturable ? 'h' : 'nf') + '|' + String(l.axe || '') + '|' + intervention.toLowerCase();
    if (!groupes[cle]) {
      groupes[cle] = {
        axe: l.axe || '', intervention: intervention, details: [], motifs: [],
        minutes: 0, minutesFacturables: 0, montant: 0, valeurHoraire: 0,
        facturable: facturable, forfait: forfait ? Number(l.forfait) : null, nbLignes: 0,
      };
      ordre.push(cle);
    }
    var g = groupes[cle];
    g.nbLignes++;
    g.minutes += Number(l.minutes) || 0;
    g.minutesFacturables += facturable ? (Number(l.minutesFacturables) || 0) : 0;
    g.montant += Number(l.montant) || 0;
    g.valeurHoraire += Number(l.valeurHoraire) || 0;
    (l.details || []).forEach(function (d) { if (d && g.details.indexOf(d) < 0) g.details.push(d); });
    (l.motifs || []).forEach(function (m) { if (m && g.motifs.indexOf(m) < 0) g.motifs.push(m); });
  });
  return ordre.map(function (cle) {
    var g = groupes[cle];
    g.nature = g.intervention + (g.details.length ? ': ' + joindreDetails(g.details) : '');
    return g;
  });
}

/* Social contribution rate that applies on a payment date. */
function tauxCotisation(iso, reglages) {
  var c = (reglages && reglages.cotisations) || {};
  var finAcre = c.finAcre || '';
  var acre = Number(c.tauxAcre);
  var plein = Number(c.tauxPlein);
  if (isNaN(plein)) plein = 25.8;
  if (isNaN(acre)) acre = plein;
  if (finAcre && iso && iso <= finAcre) return acre;
  return plein;
}

/* Flat-rate allowance of the micro-BNC regime on revenue. */
var ABATTEMENT_BNC = 34;

/* Declared period and URSSAF direct debit date of a payment. The first
   declaration covers the quarter in which activity starts and the next
   one (start on 01/10/2026: October to March, debited on 30/04/2027);
   after that, a calendar quarter debited at the end of the following
   month. */
function periodeUrssaf(iso, reglages) {
  var t = trimestreDe(iso);
  var c = (reglages && reglages.cotisations) || {};
  var debut = c.debutActivite || (reglages && reglages.contrat && reglages.contrat.debut) || '';
  if (dateValide(debut)) {
    var suivant = trimestreDe(ajouterJours(trimestreDe(debut).fin, 1));
    if (t.fin <= suivant.fin) return { fin: suivant.fin, echeance: suivant.echeance, premiere: true };
  }
  return { fin: t.fin, echeance: t.echeance, premiere: false };
}

/* What an invoice leaves: URSSAF provision at the rate of the payment
   day (the due date while it is unpaid), net available, BNC allowance and
   estimated taxable income. */
function tresorerieFacture(f, reglages) {
  var encaissee = f.statut === 'payee' && !!f.datePaiement;
  var date = encaissee ? f.datePaiement : (f.dateEcheance || f.dateEmission);
  var ca = arrondir2(Number(f.total) || 0);
  var taux = tauxCotisation(date, reglages);
  var cotisations = arrondir2(ca * taux / 100);
  var imposable = arrondir2(ca * (100 - ABATTEMENT_BNC) / 100);
  return {
    numero: f.numero, encaissee: encaissee, date: date, trimestre: trimestreDe(date).libelle,
    ca: ca, taux: taux, cotisations: cotisations, net: arrondir2(ca - cotisations),
    abattement: arrondir2(ca - imposable), imposable: imposable,
    prelevement: periodeUrssaf(date, reglages).echeance,
  };
}

/* Income collected per calendar quarter, with an estimate of the
   contributions and the declaration deadline. The current quarter and
   the contract's upcoming quarters are listed even with no payment. The
   amounts are the sum of those of the invoices, so that the two tables
   on screen agree. */
function recettesParTrimestre(factures, reglages, dateRef) {
  var ref = dateRef || aujourdhui();
  var cles = {};
  var liste = [];
  function obtenir(iso) {
    var t = trimestreDe(iso);
    if (!cles[t.cle]) {
      var p = periodeUrssaf(iso, reglages);
      cles[t.cle] = { cle: t.cle, libelle: t.libelle, debut: t.debut, fin: t.fin, echeance: p.echeance, finDeclaration: p.fin, premiere: p.premiere, encaisse: 0, cotisations: 0, imposable: 0, factures: [] };
      liste.push(cles[t.cle]);
    }
    return cles[t.cle];
  }
  (factures || []).forEach(function (f) {
    if (!f || f.statut !== 'payee' || !f.datePaiement) return;
    var t = obtenir(f.datePaiement);
    var x = tresorerieFacture(f, reglages);
    t.encaisse += x.ca;
    t.cotisations += x.cotisations;
    t.imposable += x.imposable;
    t.factures.push(f.numero);
  });
  /* All the contract's quarters up to today (and up to its end), even
     with no payment: a nil declaration is still due. */
  var c = (reglages && reglages.contrat) || {};
  var de = c.debut && dateValide(c.debut) && c.debut < ref ? moisDe(c.debut) : moisDe(ref);
  var a = c.fin && dateValide(c.fin) && c.fin > ref ? moisDe(c.fin) : moisDe(ref);
  listeMois(de, a).forEach(function (m) { obtenir(m + '-01'); });
  obtenir(ref);
  liste.forEach(function (t) {
    t.encaisse = arrondir2(t.encaisse);
    t.cotisations = arrondir2(t.cotisations);
    t.imposable = arrondir2(t.imposable);
    t.net = arrondir2(t.encaisse - t.cotisations);
    t.taux = tauxCotisation(t.fin, reglages);
    t.enCours = ref >= t.debut && ref <= t.fin;
    t.aDeclarer = ref > t.finDeclaration && ref <= t.echeance;
  });
  liste.sort(function (a, b) { return a.debut < b.debut ? -1 : 1; });
  return liste;
}

/* ---------- Task priorities ----------
   The effective priority of a task is the higher of the manual choice
   (high, medium, low) and the one dictated by the due date: under 5 days
   = high, up to 14 days = medium, beyond = low. A manual choice is never
   lowered; "auto" relies on the due date alone. */
var NIVEAUX_PRIORITE = { basse: 1, moyenne: 2, haute: 3 };
var LIBELLES_PRIORITE = { haute: 'High', moyenne: 'Medium', basse: 'Low', auto: 'Automatic' };

function normaliserPriorite(p) {
  return p === 'haute' || p === 'moyenne' || p === 'basse' ? p : 'auto';
}
function prioriteAutomatique(t, ref) {
  if (!t || !t.echeance || t.statut === 'fait') return null;
  var j = joursEntre(ref || aujourdhui(), t.echeance);
  if (j < 5) return 'haute';
  if (j <= 14) return 'moyenne';
  return 'basse';
}
function prioriteEffective(t, ref) {
  var auto = prioriteAutomatique(t, ref);
  var manuelle = normaliserPriorite(t && t.priorite);
  if (manuelle === 'auto') return { niveau: auto || 'basse', origine: auto ? 'echeance' : 'defaut', auto: auto, manuelle: null };
  if (auto && NIVEAUX_PRIORITE[auto] > NIVEAUX_PRIORITE[manuelle]) return { niveau: auto, origine: 'echeance', auto: auto, manuelle: manuelle };
  return { niveau: manuelle, origine: 'manuelle', auto: auto, manuelle: manuelle };
}
/* Order of a column: effective priority descending, then nearest due
   date (dated tasks before the others), then manual order. */
function comparerTaches(a, b, ref) {
  var na = NIVEAUX_PRIORITE[prioriteEffective(a, ref).niveau], nb = NIVEAUX_PRIORITE[prioriteEffective(b, ref).niveau];
  if (na !== nb) return nb - na;
  if (!!a.echeance !== !!b.echeance) return a.echeance ? -1 : 1;
  if (a.echeance && b.echeance && a.echeance !== b.echeance) return a.echeance < b.echeance ? -1 : 1;
  var oa = Number(a.ordre) || 0, ob = Number(b.ordre) || 0;
  if (oa !== ob) return oa - ob;
  return String(a.creeLe || '') < String(b.creeLe || '') ? -1 : (String(a.creeLe || '') > String(b.creeLe || '') ? 1 : 0);
}
function trierTaches(liste, ref) {
  return liste.slice().sort(function (a, b) { return comparerTaches(a, b, ref); });
}

/* Ids of the entries already taken by an invoice: all invoices count (an
   invoiced entry is never invoiced again, even if moved to another
   month). An invoice without a list of entries (old data) covers its
   whole month. */
function idsFactures(factures, mois, entrees) {
  var ids = [];
  (factures || []).forEach(function (f) {
    if (!f) return;
    if (Array.isArray(f.entreesIds)) ids = ids.concat(f.entreesIds.filter(function (id) { return id != null; }));
    /* An invoice without a list of entries covers the work DATED in its
       month and already entered when it was issued, whatever statement is
       computed: an entry it paid for must not come back on another month
       through a move, but an entry added after it stays billable. */
    else if (f.mois) (entrees || []).forEach(function (e) { if (couvertParFactureAncienne(e, f)) ids.push(e.id); });
  });
  return ids;
}
/* The invoice that froze a log entry, or null. */
function factureDeEntree(factures, id) {
  if (id == null) return null;
  for (var i = 0; i < (factures || []).length; i++) {
    var f = factures[i];
    if (f && Array.isArray(f.entreesIds) && f.entreesIds.indexOf(id) >= 0) return f;
  }
  return null;
}
/* An old invoice (without a list of entries) covers the work of its month
   that existed when it was issued. */
function couvertParFactureAncienne(e, f) {
  if (!e || !e.date || !f || Array.isArray(f.entreesIds) || !f.mois) return false;
  if (moisDe(e.date) !== f.mois) return false;
  var emise = f.dateEmission || '';
  var creee = String(e.creeLe || '').slice(0, 10);
  return !emise || !creee || creee <= emise;
}
/* The invoice that freezes an entry: by its list of ids, or, for old
   invoices that have none, by the month of the work. */
function factureFigeant(factures, e) {
  if (!e) return null;
  var parId = factureDeEntree(factures, e.id);
  if (parId) return parId;
  for (var i = 0; i < (factures || []).length; i++) {
    if (couvertParFactureAncienne(e, factures[i])) return factures[i];
  }
  return null;
}
/* An entry frozen on an invoice no longer changes billing month. */
function peutReporter(e, factures) { return !!e && !factureFigeant(factures, e); }
/* The part of a work item that no invoice has frozen: a follow-up done on the day of an invoice can be moved on its own. */
function partReportable(lignes, factures) {
  return (lignes || []).filter(function (e) { return peutReporter(e, factures); });
}
/* The total of an already invoiced month: its invoices are authoritative, each rounded and frozen when issued, plus what is left to invoice. */
function totalMoisFacture(lesFactures, reste) {
  return {
    minutes: lesFactures.reduce(function (s, f) { return s + (Number(f.minutesFacturees) || 0); }, 0) + reste.totalMinutesFacturables,
    montant: arrondir2(lesFactures.reduce(function (s, f) { return s + (Number(f.montantHT) || 0); }, 0) + reste.montantHT),
  };
}

/* Display status of an invoice (late payment). */
function statutFacture(f, dateRef) {
  var ref = dateRef || aujourdhui();
  if (f.statut === 'payee') return 'payee';
  if (f.dateEcheance && ref > f.dateEcheance) return 'retard';
  return 'emise';
}

/* ---------- Reminders ----------
   Everything that must not be missed, computed from the data: deadlines
   (each with its reminder lead time), dated tasks, past months to
   invoice, invoices awaiting payment, forgotten timer, neglected log.
   Three levels: "retard" (overdue), "urgent" (today or to do now),
   "bientot" (within the reminder horizon).
   A snoozed reminder (ui.rappelsReportes[cle] = date) is still listed
   with its snooze date; the screen chooses to hide it. */
var NIVEAUX_RAPPEL = { retard: 3, urgent: 2, bientot: 1 };

function nombreOu(v, defaut) { var n = Number(v); return isFinite(n) && v !== '' && v != null ? n : defaut; }
/* "October 2026", "November 2026": the month label to drop into a sentence. */
function deLibelleMois(mois) { return libelleMois(mois); }

function calculerRappels(donnees, reglages, options) {
  var o = options || {};
  var ref = o.ref || aujourdhui();
  var maintenant = o.maintenant || Date.now();
  var d = donnees || {};
  var objets = function (l) { return (Array.isArray(l) ? l : []).filter(function (x) { return x && typeof x === 'object'; }); };
  var entrees = objets(d.entrees), taches = objets(d.taches), echeances = objets(d.echeances), factures = objets(d.factures);
  var pr = (reglages && reglages.rappels) || {};
  var hEch = nombreOu(pr.horizonEcheances, 7), hTaches = nombreOu(pr.horizonTaches, 3), hFactures = nombreOu(pr.horizonFactures, 5);
  var chronoH = nombreOu(pr.chronoOublieHeures, 3), journalJours = nombreOu(pr.journalJours, 7);
  var reportes = (reglages && reglages.ui && reglages.ui.rappelsReportes) || {};
  var liste = [];
  function niveauPour(j, horizon) {
    if (j < 0) return 'retard';
    if (j === 0) return 'urgent';
    return j <= horizon ? 'bientot' : null;
  }
  function ajouter(x) {
    if (reportes[x.cle] && reportes[x.cle] > ref) x.reporte = reportes[x.cle];
    liste.push(x);
  }

  /* Deadlines (admin calendar and personal reminders). */
  echeances.forEach(function (e) {
    if (!e || e.fait || !e.date) return;
    var j = joursEntre(ref, e.date);
    if (!isFinite(j)) return;
    var niveau = niveauPour(j, nombreOu(e.rappelJours, hEch));
    if (!niveau) return;
    ajouter({ cle: 'echeance:' + e.id, categorie: 'echeance', niveau: niveau, titre: e.titre, detail: e.detail || '', date: e.date, jours: j, page: 'echeances', cibleId: e.id });
  });

  /* Dated tasks, excluding "Done". */
  taches.forEach(function (t) {
    if (!t || t.statut === 'fait' || !t.echeance) return;
    var j = joursEntre(ref, t.echeance);
    if (!isFinite(j)) return;
    var niveau = niveauPour(j, hTaches);
    if (!niveau) return;
    ajouter({ cle: 'tache:' + t.id, categorie: 'tache', niveau: niveau, titre: t.titre, detail: t.statut === 'en-cours' ? 'Task in progress' : 'Task to do', date: t.echeance, jours: j, page: 'taches', cibleId: t.id });
  });

  /* Past months of the contract that are still to invoice. */
  var courant = moisDe(ref);
  var debutContrat = reglages && reglages.contrat && reglages.contrat.debut ? moisDe(reglages.contrat.debut) : '';
  var moisVus = {};
  /* The BILLING month: a month that exists only through a move must be
     claimed too, and a month emptied by a move no longer is. A month with
     no entries but with approved expenses is still to invoice. */
  entrees.forEach(function (e) { var m = moisFacturationDe(e); if (m && m < courant && m >= debutContrat) moisVus[m] = true; });
  var moisMeta = (reglages && reglages.ui && reglages.ui.moisMeta) || {};
  Object.keys(moisMeta).forEach(function (m) { if (m && m < courant && m >= debutContrat && Number(moisMeta[m] && moisMeta[m].frais) > 0) moisVus[m] = true; });
  Object.keys(moisVus).sort().forEach(function (m) {
    var fraisMois = Number(moisMeta[m] && moisMeta[m].frais) || 0;
    var fraisFactures = factures.reduce(function (s, f) { return s + (f && f.mois === m ? Number(f.frais) || 0 : 0); }, 0);
    var fraisRestants = Math.max(0, arrondir2(fraisMois - fraisFactures));
    var rel = releveDuMois(entrees, m, reglages, fraisRestants, { exclureIds: idsFactures(factures, m, entrees) });
    if (rel.total <= 0) return;
    var detail = fmtHeuresDec(rel.totalMinutesFacturables) + ' billable, ' + fmtEuros(rel.montantHT) + ' excl. tax'
      + (rel.frais ? ' and ' + fmtEuros(rel.frais) + ' in expenses' : '');
    ajouter({ cle: 'facturer:' + m, categorie: 'facture', niveau: 'urgent', titre: deLibelleMois(m) + ' statement ready to invoice', detail: detail, date: null, jours: null, page: 'releve', cibleId: m });
  });

  /* Issued invoices: payment due date near or past. */
  factures.forEach(function (f) {
    if (!f || f.statut === 'payee' || !f.dateEcheance) return;
    var j = joursEntre(ref, f.dateEcheance);
    if (!isFinite(j)) return;
    var niveau = niveauPour(j, hFactures);
    if (!niveau) return;
    ajouter({ cle: 'paiement:' + f.id, categorie: 'facture', niveau: niveau, titre: 'Invoice no. ' + f.numero + (j < 0 ? ' unpaid' : ' to collect'), detail: fmtEuros(f.total) + (j < 0 ? ', overdue since ' + dateFr(f.dateEcheance) : ', due on ' + dateFr(f.dateEcheance)), date: f.dateEcheance, jours: j, page: 'factures', cibleId: f.id });
  });

  /* Forgotten timer: running for a long time, or paused for a long time. */
  var c = d.chrono || null;
  if (c && c.debut && chronoH > 0 && isFinite(new Date(c.debut).getTime())) {
    var finMesure = c.pauseDepuis ? new Date(c.pauseDepuis).getTime() : maintenant;
    var ms = Math.max(0, finMesure - new Date(c.debut).getTime() - (c.pauseCumuleeMs || 0));
    var libelle = String(c.intervention || '').trim() || 'no label';
    if (!c.pauseDepuis && ms >= chronoH * 3600000) {
      ajouter({ cle: 'chrono:long', categorie: 'chrono', niveau: 'urgent', titre: 'The timer has been running for ' + fmtDuree(Math.round(ms / 60000)), detail: 'On "' + libelle + '": still going? If not, stop it to save the entry.', date: null, jours: null, page: 'journal', cibleId: null });
    } else if (c.pauseDepuis && maintenant - new Date(c.pauseDepuis).getTime() >= 8 * 3600000) {
      ajouter({ cle: 'chrono:pause', categorie: 'chrono', niveau: 'urgent', titre: 'A timer has been paused for ' + fmtDuree(Math.round((maintenant - new Date(c.pauseDepuis).getTime()) / 60000)), detail: 'On "' + libelle + '" (' + fmtDuree(Math.round(ms / 60000)) + ' measured): resume it or stop it.', date: null, jours: null, page: 'journal', cibleId: null });
    }
  }

  /* Log neglected during the contract (working days only). */
  var contrat = (reglages && reglages.contrat) || {};
  if (journalJours > 0 && contrat.debut && ref >= contrat.debut && (!contrat.fin || ref <= contrat.fin)) {
    var jourSemaine = isoVersDate(ref).getDay();
    if (jourSemaine >= 1 && jourSemaine <= 5) {
      var derniere = '';
      entrees.forEach(function (e) { if (e.date && e.date <= ref && e.date > derniere) derniere = e.date; });
      var depuis = derniere ? joursEntre(derniere, ref) : joursEntre(contrat.debut, ref);
      if (isFinite(depuis) && depuis >= journalJours) {
        ajouter({ cle: 'journal:silence', categorie: 'journal', niveau: 'bientot', titre: derniere ? 'No entry for ' + depuis + ' days' : 'No entry since the start of the contract', detail: derniere ? 'Last entry on ' + dateFr(derniere) + '. The monthly statement is built up as you go.' : 'The monthly statement is built up as you go.', date: null, jours: null, page: 'journal', cibleId: null });
      }
    }
  }

  liste.sort(function (a, b) {
    if (NIVEAUX_RAPPEL[a.niveau] !== NIVEAUX_RAPPEL[b.niveau]) return NIVEAUX_RAPPEL[b.niveau] - NIVEAUX_RAPPEL[a.niveau];
    var ja = a.jours == null ? 0 : a.jours, jb = b.jours == null ? 0 : b.jours;
    if (ja !== jb) return ja - jb;
    return String(a.titre).localeCompare(String(b.titre), 'en');
  });
  return liste;
}

/* Time spent on a task (log entries that reference it). */
function minutesTache(entrees, tacheId) {
  var total = 0, nb = 0;
  (entrees || []).forEach(function (e) { if (e && e.tache === tacheId) { total += dureeEntree(e); nb++; } });
  return { minutes: total, lignes: nb };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    dureeEntree: dureeEntree, arrondirMinutes: arrondirMinutes, arrondiDuTotal: arrondiDuTotal, cleIntervention: cleIntervention,
    cleTravail: cleTravail, cleGroupe: cleGroupe, moisFacturationDe: moisFacturationDe, estReporte: estReporte,
    moisFacturationLigneFacture: moisFacturationLigneFacture, peutReporter: peutReporter, partReportable: partReportable, totalMoisFacture: totalMoisFacture, factureFigeant: factureFigeant,
    couvertParFactureAncienne: couvertParFactureAncienne,
    entreesDuMoisDeFacturation: entreesDuMoisDeFacturation, entreesDuContrat: entreesDuContrat,
    reportsVers: reportsVers, reportsDepuis: reportsDepuis,
    estFacturable: estFacturable, forfaitEntree: forfaitEntree, idsFactures: idsFactures, factureDeEntree: factureDeEntree, nombreOu: nombreOu,
    regrouperInterventions: regrouperInterventions, entreesDuMois: entreesDuMois, entreesPeriode: entreesPeriode,
    totauxEntrees: totauxEntrees, releveDuMois: releveDuMois, repartitionParAxe: repartitionParAxe,
    heuresParMois: heuresParMois, avancementContrat: avancementContrat, interventionsRecentes: interventionsRecentes,
    numeroFactureSuivant: numeroFactureSuivant, construireFacture: construireFacture, regrouperLignesFacture: regrouperLignesFacture, tauxCotisation: tauxCotisation,
    recettesParTrimestre: recettesParTrimestre, statutFacture: statutFacture,
    joindreDetails: joindreDetails, montantsAuCentime: montantsAuCentime, periodeUrssaf: periodeUrssaf, tresorerieFacture: tresorerieFacture, ABATTEMENT_BNC: ABATTEMENT_BNC,
    NIVEAUX_PRIORITE: NIVEAUX_PRIORITE, LIBELLES_PRIORITE: LIBELLES_PRIORITE, normaliserPriorite: normaliserPriorite,
    prioriteAutomatique: prioriteAutomatique, prioriteEffective: prioriteEffective, comparerTaches: comparerTaches, trierTaches: trierTaches,
    NIVEAUX_RAPPEL: NIVEAUX_RAPPEL, calculerRappels: calculerRappels, minutesTache: minutesTache, deLibelleMois: deLibelleMois,
  };
}
