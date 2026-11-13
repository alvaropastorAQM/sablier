/* ============================================================
   MOTEUR DE CALCUL : durées, regroupement par intervention, arrondi
   du temps facturé, relevé mensuel, factures, trimestres URSSAF.

   Règles (contrat du 01/10/2026, article 6.1) :
   - décompte à l'heure, arrondi au quart d'heure supérieur ;
   - une « intervention » = même jour + même axe + même libellé ;
     ses lignes s'additionnent AVANT l'arrondi, comme dans le
     classeur Excel d'origine ;
   - montant = heures facturées x tarif horaire ;
   - aucune TVA (franchise en base).

   Fichier sans DOM, testé par tests/test-calculs.js.
   ============================================================ */
'use strict';

if (typeof module !== 'undefined' && module.exports && typeof moisDe === 'undefined') {
  Object.assign(globalThis, require('./utils.js'));
}

/* Durée d'une ligne en minutes : la durée saisie prime ; à défaut,
   l'écart entre début et fin. */
function dureeEntree(e) {
  if (!e) return 0;
  var m = e.minutes;
  if (typeof m === 'string' && m.trim() !== '') m = Number(m.replace(',', '.'));
  if (typeof m === 'number' && isFinite(m) && m >= 0) return Math.round(m);
  var d = minutesEntre(e.debut, e.fin);
  return d == null ? 0 : d;
}

/* Arrondi au multiple supérieur de « arrondiHeures » (0.25 = quart d'heure).
   Un arrondi nul ou absent laisse les minutes telles quelles. */
function arrondirMinutes(minutes, arrondiHeures) {
  var pas = Math.round((Number(arrondiHeures) || 0) * 60);
  var m = Math.max(0, Math.round(minutes || 0));
  if (!pas) return m;
  return Math.ceil(m / pas) * pas;
}

/* Mois de facturation d'une ligne : le champ moisFacturation quand il est
   renseigné (un travail de septembre porté sur la facture d'octobre),
   sinon le mois de sa date. */
function moisFacturationDe(e) {
  var m = e && e.moisFacturation;
  return moisValide(m) ? m : moisDe(e && e.date);
}
/* Vrai quand la ligne est facturée sur un autre mois que celui du travail. */
function estReporte(e) {
  var m = moisDe(e && e.date);
  return !!m && moisFacturationDe(e) !== m;
}
/* Mois de facturation d'une ligne figée sur une facture : les factures
   émises avant le report n'en portent pas, leur mois est celui de la facture. */
function moisFacturationLigneFacture(l, f) {
  if (l && moisValide(l.moisFacturation)) return l.moisFacturation;
  if (f && moisValide(f.mois)) return f.mois;
  return moisDe(l && l.date);
}
/* Le travail lui-même : même jour, même axe, même libellé, quel que soit
   le mois sur lequel il est facturé. Toutes ses lignes se reportent
   ensemble. */
function cleTravail(e) {
  return e.date + '|' + (e.axe || '') + '|' + normaliserCle(e.intervention);
}
function cleGroupe(moisFacturation, date, axe, intervention) {
  return moisFacturation + '|' + date + '|' + (axe || '') + '|' + normaliserCle(intervention);
}
function cleIntervention(e) {
  return cleGroupe(moisFacturationDe(e), e.date, e.axe, e.intervention);
}

/* Une ligne est facturable sauf mention contraire (facturable: false, avec
   un motif : stage, geste commercial…). Un forfait est un montant HT fixe
   qui remplace heures × tarif pour l'intervention. */
function estFacturable(e) { return !(e && e.facturable === false); }

/* Les détails d'une intervention bout à bout : une virgule entre deux
   bouts de phrase, une espace après une phrase finie (jamais « ., »). */
function joindreDetails(details) {
  return (details || []).reduce(function (s, d, i) { return i ? s + (/[.!?…]$/.test(s) ? ' ' : ', ') + d : d; }, '');
}

/* Montants au centime dont la somme tombe juste sur le total arrondi
   (méthode du plus fort reste) : chaque ligne part du centime inférieur,
   les centimes manquants vont aux plus fortes décimales. Arrondies une à
   une, des lignes à demi-centime (0,75 h × 42,86 = 32,145) dépasseraient
   le total de plusieurs centimes. */
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

/* Regroupe les lignes en interventions (jour + axe + libellé), triées
   par date puis heure de début. Chaque intervention porte le temps
   passé, le temps facturé (exact, l'arrondi se fait sur le total) et le
   montant. */
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
    /* Les montants d'une intervention restent exacts (comme les cellules du
       classeur) ; seuls les totaux et l'affichage s'arrondissent au centime,
       si bien que « heures facturées × tarif » tombe juste sur la facture. */
    g.valeurHoraire = g.minutesFacturables / 60 * tarif;
    g.montant = g.forfait != null ? g.forfait : g.valeurHoraire;
    g.facturable = g.minutesBrutesFacturables > 0 || g.forfait != null;
    g.remise = g.forfait != null ? g.valeurHoraire - g.forfait : 0;
    g.reporte = g.moisFacturation !== g.moisTravail;
    g.nature = g.intervention + (g.details.length ? ' : ' + joindreDetails(g.details) : '');
    return g;
  });
  liste.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.premierDebut !== b.premierDebut) return a.premierDebut < b.premierDebut ? -1 : 1;
    return 0;
  });
  return liste;
}

/* Minutes à ajouter pour arrondir au quart d'heure supérieur le TOTAL du
   temps facturé à l'heure (article 6.1 du contrat). Règle du prestataire du
   26/10/2026 : arrondir chaque intervention faisait payer près de deux
   heures de trop par mois. Les forfaits restent hors du total arrondi. */
function arrondiDuTotal(groupes, reglages) {
  var pas = reglages && reglages.arrondi != null ? reglages.arrondi : 0.25;
  var exact = (groupes || []).reduce(function (s, g) { return s + (g.forfait == null ? g.minutesFacturables : 0); }, 0);
  return exact > 0 ? arrondirMinutes(exact, pas) - exact : 0;
}

/* Les lignes TRAVAILLÉES dans le mois : le journal, le tableau de bord et
   les pastilles s'en tiennent là. */
function entreesDuMois(entrees, mois) {
  return (entrees || []).filter(function (e) { return e && moisDe(e.date) === mois; });
}
/* Les lignes FACTURÉES sur le mois : le relevé et les factures s'appuient
   dessus, le report les déplace d'un mois à l'autre. */
function entreesDuMoisDeFacturation(entrees, mois) {
  return (entrees || []).filter(function (e) { return e && e.date && moisFacturationDe(e) === mois; });
}
function entreesPeriode(entrees, debut, fin) {
  return (entrees || []).filter(function (e) {
    return e && e.date && (!debut || e.date >= debut) && (!fin || e.date <= fin);
  });
}
/* Ce qui relève du contrat : le travail qui y tombe, plus celui qui y est
   facturé après report (le travail de septembre facturé en octobre compte
   dans l'avancement, puisqu'il est sur une facture du contrat). */
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

/* Totaux d'un ensemble de lignes (après regroupement), total arrondi. Avec
   exact, sans arrondi : un morceau de relevé (travail reporté) n'a pas de
   total à arrondir, l'arrondi se fait sur celui du mois qui le reçoit. */
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

/* Les reports d'un mois, regroupés par mois voisin : ce qu'il reçoit
   (« versLeMois ») ou ce qu'il envoie ailleurs. Chaque groupe porte ses
   lignes et ses totaux, pour que l'écran et les documents n'aient plus
   qu'à les écrire. */
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
/* Ce que ce mois facture pour le compte d'autres mois. */
function reportsVers(entrees, mois, reglages) { return reportsGroupes(entrees, mois, reglages, true); }
/* Ce que ce mois a travaillé mais fait facturer ailleurs. */
function reportsDepuis(entrees, mois, reglages) { return reportsGroupes(entrees, mois, reglages, false); }

/* Le relevé d'un mois : lignes et totaux, prêt pour l'écran et le PDF.
   options.exclureIds : lignes déjà facturées à laisser de côté. Les
   interventions gardent leur temps exact ; le total est arrondi une fois
   (arrondiMinutes), comme celui de chaque facture.

   Le relevé porte le travail FACTURÉ sur le mois, report compris : une
   ligne de septembre reportée sur octobre quitte le relevé de septembre
   pour celui d'octobre, en gardant sa date. */
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
    /* De quoi expliquer, sur le relevé, l'écart avec le journal. */
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

/* Répartition du temps par axe. */
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

/* Heures par mois sur une liste de mois. */
function heuresParMois(entrees, moisListe, reglages) {
  return (moisListe || []).map(function (m) {
    var t = totauxEntrees(entreesDuMois(entrees, m), reglages);
    return { mois: m, minutes: t.minutes, minutesFacturables: t.minutesFacturables, montant: t.montant };
  });
}

/* Avancement par rapport au repère annuel du contrat. */
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

/* Libellés d'intervention déjà utilisés, du plus récent au plus ancien
   (pour l'autocomplétion de la saisie). */
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

/* ---------- Factures ---------- */

/* Numéro continu par année : AAAA-NN. */
function numeroFactureSuivant(factures, annee) {
  var max = 0;
  (factures || []).forEach(function (f) {
    var m = String(f.numero || '').match(/^(\d{4})-(\d+)$/);
    if (m && Number(m[1]) === Number(annee)) max = Math.max(max, Number(m[2]));
  });
  return annee + '-' + deuxChiffres(max + 1);
}

/* Construit l'objet facture à partir d'un relevé : les lignes, les deux
   parties et les reports annoncés par le relevé sont figés. */
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

/* Lignes d'une facture regroupées pour son annexe. La facture ne dit pas
   quand le travail a été réalisé (ni date, ni mois d'origine) : une même
   intervention menée sur plusieurs jours (même axe, même libellé) y tient
   donc sur une seule ligne, temps et montants additionnés. Chaque forfait
   garde sa ligne (sa remise lui est propre) ; les lignes non facturables se
   regroupent entre elles. Les lignes figées de la facture, elles, gardent
   leur date : c'est la trace, visible dans l'application. */
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
    g.nature = g.intervention + (g.details.length ? ' : ' + joindreDetails(g.details) : '');
    return g;
  });
}

/* Taux de cotisations applicable à une date d'encaissement. */
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

/* Abattement forfaitaire du régime micro-BNC sur le chiffre d'affaires. */
var ABATTEMENT_BNC = 34;

/* Période déclarée et date de prélèvement URSSAF d'un encaissement. La
   première déclaration regroupe le trimestre du début d'activité et le
   suivant (début le 01/10/2026 : octobre à mars, prélevé le 30/04/2027) ;
   ensuite, un trimestre civil prélevé à la fin du mois qui suit. */
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

/* Ce que laisse une facture : provision URSSAF au taux du jour
   d'encaissement (l'échéance de paiement tant qu'elle n'est pas payée),
   net disponible, abattement BNC et revenu imposable estimé. */
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

/* Recettes encaissées par trimestre civil, avec estimation des
   cotisations et échéance de déclaration. Le trimestre en cours et les
   trimestres à venir du contrat sont listés même sans encaissement. Les
   montants sont la somme de ceux des factures, pour que les deux tableaux
   de l'écran tombent juste. */
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
  /* Tous les trimestres du contrat jusqu'à aujourd'hui (et jusqu'à sa fin),
     même sans encaissement : une déclaration à néant reste à faire. */
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

/* ---------- Priorités des tâches ----------
   La priorité effective d'une tâche est la plus haute entre le choix
   manuel (haute, moyenne, basse) et celle que dicte l'échéance : moins de
   5 jours = haute, jusqu'à 14 jours = moyenne, au-delà = basse. Un choix
   manuel n'est jamais abaissé ; « auto » s'en remet à l'échéance seule. */
var NIVEAUX_PRIORITE = { basse: 1, moyenne: 2, haute: 3 };
var LIBELLES_PRIORITE = { haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse', auto: 'Automatique' };

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
/* Ordre d'une colonne : priorité effective décroissante, puis échéance la
   plus proche (les tâches datées avant les autres), puis ordre manuel. */
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

/* Identifiants des lignes déjà prises par une facture : toutes les factures
   comptent (une ligne facturée ne se refacture jamais, même déplacée dans un
   autre mois). Une facture sans liste de lignes (anciennes données) couvre
   tout son mois. */
function idsFactures(factures, mois, entrees) {
  var ids = [];
  (factures || []).forEach(function (f) {
    if (!f) return;
    if (Array.isArray(f.entreesIds)) ids = ids.concat(f.entreesIds.filter(function (id) { return id != null; }));
    /* Une facture sans liste de lignes couvre le travail DATÉ dans son mois
       et déjà saisi quand elle a été émise, quel que soit le relevé calculé :
       une ligne qu'elle a payée ne doit pas revenir sur un autre mois par un
       report, mais une ligne saisie après elle reste facturable. */
    else if (f.mois) (entrees || []).forEach(function (e) { if (couvertParFactureAncienne(e, f)) ids.push(e.id); });
  });
  return ids;
}
/* La facture qui a figé une ligne du journal, ou null. */
function factureDeEntree(factures, id) {
  if (id == null) return null;
  for (var i = 0; i < (factures || []).length; i++) {
    var f = factures[i];
    if (f && Array.isArray(f.entreesIds) && f.entreesIds.indexOf(id) >= 0) return f;
  }
  return null;
}
/* Une facture ancienne (sans liste de lignes) couvre le travail de son mois
   qui existait au moment de son émission. */
function couvertParFactureAncienne(e, f) {
  if (!e || !e.date || !f || Array.isArray(f.entreesIds) || !f.mois) return false;
  if (moisDe(e.date) !== f.mois) return false;
  var emise = f.dateEmission || '';
  var creee = String(e.creeLe || '').slice(0, 10);
  return !emise || !creee || creee <= emise;
}
/* La facture qui fige une ligne : par sa liste d'identifiants, ou, pour les
   factures anciennes qui n'en ont pas, par le mois du travail. */
function factureFigeant(factures, e) {
  if (!e) return null;
  var parId = factureDeEntree(factures, e.id);
  if (parId) return parId;
  for (var i = 0; i < (factures || []).length; i++) {
    if (couvertParFactureAncienne(e, factures[i])) return factures[i];
  }
  return null;
}
/* Une ligne figée sur une facture ne change plus de mois de facturation. */
function peutReporter(e, factures) { return !!e && !factureFigeant(factures, e); }
/* La part d'une intervention qu'une facture n'a pas figée : une suite faite le jour même d'une facture se reporte seule. */
function partReportable(lignes, factures) {
  return (lignes || []).filter(function (e) { return peutReporter(e, factures); });
}
/* Le total d'un mois déjà facturé : ses factures font foi, chacune arrondie et figée à son émission, plus ce qui reste à facturer. */
function totalMoisFacture(lesFactures, reste) {
  return {
    minutes: lesFactures.reduce(function (s, f) { return s + (Number(f.minutesFacturees) || 0); }, 0) + reste.totalMinutesFacturables,
    montant: arrondir2(lesFactures.reduce(function (s, f) { return s + (Number(f.montantHT) || 0); }, 0) + reste.montantHT),
  };
}

/* Statut d'affichage d'une facture (retard de paiement). */
function statutFacture(f, dateRef) {
  var ref = dateRef || aujourdhui();
  if (f.statut === 'payee') return 'payee';
  if (f.dateEcheance && ref > f.dateEcheance) return 'retard';
  return 'emise';
}

/* ---------- Rappels ----------
   Tout ce qu'il ne faut pas rater, calculé à partir des données : échéances
   (chacune avec son délai de rappel), tâches datées, mois écoulés à
   facturer, factures en attente de paiement, chrono oublié, journal
   délaissé. Trois niveaux : « retard » (dépassé), « urgent » (aujourd'hui
   ou à faire maintenant), « bientot » (dans l'horizon de rappel).
   Un rappel reporté (ui.rappelsReportes[cle] = date) reste listé avec sa
   date de report ; l'écran choisit de le masquer. */
var NIVEAUX_RAPPEL = { retard: 3, urgent: 2, bientot: 1 };

function nombreOu(v, defaut) { var n = Number(v); return isFinite(n) && v !== '' && v != null ? n : defaut; }
/* « d'octobre 2026 », « de novembre 2026 ». */
function deLibelleMois(mois) { var l = libelleMois(mois); return (/^[aeiouyàâéèêîôûù]/i.test(l) ? 'd\'' : 'de ') + l; }

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

  /* Échéances (calendrier administratif et rappels personnels). */
  echeances.forEach(function (e) {
    if (!e || e.fait || !e.date) return;
    var j = joursEntre(ref, e.date);
    if (!isFinite(j)) return;
    var niveau = niveauPour(j, nombreOu(e.rappelJours, hEch));
    if (!niveau) return;
    ajouter({ cle: 'echeance:' + e.id, categorie: 'echeance', niveau: niveau, titre: e.titre, detail: e.detail || '', date: e.date, jours: j, page: 'echeances', cibleId: e.id });
  });

  /* Tâches datées, hors « Fait ». */
  taches.forEach(function (t) {
    if (!t || t.statut === 'fait' || !t.echeance) return;
    var j = joursEntre(ref, t.echeance);
    if (!isFinite(j)) return;
    var niveau = niveauPour(j, hTaches);
    if (!niveau) return;
    ajouter({ cle: 'tache:' + t.id, categorie: 'tache', niveau: niveau, titre: t.titre, detail: t.statut === 'en-cours' ? 'Tâche en cours' : 'Tâche à faire', date: t.echeance, jours: j, page: 'taches', cibleId: t.id });
  });

  /* Mois écoulés du contrat qui restent à facturer. */
  var courant = moisDe(ref);
  var debutContrat = reglages && reglages.contrat && reglages.contrat.debut ? moisDe(reglages.contrat.debut) : '';
  var moisVus = {};
  /* Le mois de FACTURATION : un mois qui n'existe que par report doit être
     réclamé lui aussi, et un mois vidé par un report ne l'est plus. Un mois
     sans ligne mais avec des frais autorisés reste à facturer. */
  entrees.forEach(function (e) { var m = moisFacturationDe(e); if (m && m < courant && m >= debutContrat) moisVus[m] = true; });
  var moisMeta = (reglages && reglages.ui && reglages.ui.moisMeta) || {};
  Object.keys(moisMeta).forEach(function (m) { if (m && m < courant && m >= debutContrat && Number(moisMeta[m] && moisMeta[m].frais) > 0) moisVus[m] = true; });
  Object.keys(moisVus).sort().forEach(function (m) {
    var fraisMois = Number(moisMeta[m] && moisMeta[m].frais) || 0;
    var fraisFactures = factures.reduce(function (s, f) { return s + (f && f.mois === m ? Number(f.frais) || 0 : 0); }, 0);
    var fraisRestants = Math.max(0, arrondir2(fraisMois - fraisFactures));
    var rel = releveDuMois(entrees, m, reglages, fraisRestants, { exclureIds: idsFactures(factures, m, entrees) });
    if (rel.total <= 0) return;
    var detail = fmtHeuresDec(rel.totalMinutesFacturables) + ' facturables, ' + fmtEuros(rel.montantHT) + ' HT'
      + (rel.frais ? ' et ' + fmtEuros(rel.frais) + ' de frais' : '');
    ajouter({ cle: 'facturer:' + m, categorie: 'facture', niveau: 'urgent', titre: 'Relevé ' + deLibelleMois(m) + ' à facturer', detail: detail, date: null, jours: null, page: 'releve', cibleId: m });
  });

  /* Factures émises : échéance de paiement proche ou dépassée. */
  factures.forEach(function (f) {
    if (!f || f.statut === 'payee' || !f.dateEcheance) return;
    var j = joursEntre(ref, f.dateEcheance);
    if (!isFinite(j)) return;
    var niveau = niveauPour(j, hFactures);
    if (!niveau) return;
    ajouter({ cle: 'paiement:' + f.id, categorie: 'facture', niveau: niveau, titre: 'Facture n° ' + f.numero + (j < 0 ? ' impayée' : ' à encaisser'), detail: fmtEuros(f.total) + (j < 0 ? ', échue le ' + dateFr(f.dateEcheance) : ', échéance de paiement le ' + dateFr(f.dateEcheance)), date: f.dateEcheance, jours: j, page: 'factures', cibleId: f.id });
  });

  /* Chrono oublié : en marche depuis longtemps, ou en pause depuis longtemps. */
  var c = d.chrono || null;
  if (c && c.debut && chronoH > 0 && isFinite(new Date(c.debut).getTime())) {
    var finMesure = c.pauseDepuis ? new Date(c.pauseDepuis).getTime() : maintenant;
    var ms = Math.max(0, finMesure - new Date(c.debut).getTime() - (c.pauseCumuleeMs || 0));
    var libelle = String(c.intervention || '').trim() || 'sans libellé';
    if (!c.pauseDepuis && ms >= chronoH * 3600000) {
      ajouter({ cle: 'chrono:long', categorie: 'chrono', niveau: 'urgent', titre: 'Le chrono tourne depuis ' + fmtDuree(Math.round(ms / 60000)), detail: 'Sur « ' + libelle + ' » : toujours en cours ? Sinon, arrêtez-le pour enregistrer la ligne.', date: null, jours: null, page: 'journal', cibleId: null });
    } else if (c.pauseDepuis && maintenant - new Date(c.pauseDepuis).getTime() >= 8 * 3600000) {
      ajouter({ cle: 'chrono:pause', categorie: 'chrono', niveau: 'urgent', titre: 'Un chrono est en pause depuis ' + fmtDuree(Math.round((maintenant - new Date(c.pauseDepuis).getTime()) / 60000)), detail: 'Sur « ' + libelle + ' » (' + fmtDuree(Math.round(ms / 60000)) + ' mesurées) : reprenez-le ou arrêtez-le.', date: null, jours: null, page: 'journal', cibleId: null });
    }
  }

  /* Journal délaissé pendant le contrat (jours ouvrés seulement). */
  var contrat = (reglages && reglages.contrat) || {};
  if (journalJours > 0 && contrat.debut && ref >= contrat.debut && (!contrat.fin || ref <= contrat.fin)) {
    var jourSemaine = isoVersDate(ref).getDay();
    if (jourSemaine >= 1 && jourSemaine <= 5) {
      var derniere = '';
      entrees.forEach(function (e) { if (e.date && e.date <= ref && e.date > derniere) derniere = e.date; });
      var depuis = derniere ? joursEntre(derniere, ref) : joursEntre(contrat.debut, ref);
      if (isFinite(depuis) && depuis >= journalJours) {
        ajouter({ cle: 'journal:silence', categorie: 'journal', niveau: 'bientot', titre: derniere ? 'Aucune saisie depuis ' + depuis + ' jours' : 'Aucune saisie depuis le début du contrat', detail: derniere ? 'Dernière ligne le ' + dateFr(derniere) + '. Le relevé du mois se construit au fil de l\'eau.' : 'Le relevé du mois se construit au fil de l\'eau.', date: null, jours: null, page: 'journal', cibleId: null });
      }
    }
  }

  liste.sort(function (a, b) {
    if (NIVEAUX_RAPPEL[a.niveau] !== NIVEAUX_RAPPEL[b.niveau]) return NIVEAUX_RAPPEL[b.niveau] - NIVEAUX_RAPPEL[a.niveau];
    var ja = a.jours == null ? 0 : a.jours, jb = b.jours == null ? 0 : b.jours;
    if (ja !== jb) return ja - jb;
    return String(a.titre).localeCompare(String(b.titre), 'fr');
  });
  return liste;
}

/* Temps passé sur une tâche (lignes du journal qui la référencent). */
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
