/* Tests du moteur de calcul : node tests/test-calculs.js */
'use strict';

const assert = require('assert');
const u = require('../js/utils.js');
const c = require('../js/calculs.js');

let n = 0;
function test(nom, fn) { fn(); n++; console.log('  ✓ ' + nom); }

const reglages = {
  tarifHoraire: 42.86, arrondi: 0.25, heuresJournee: 7, repereAnnuel: 192, delaiPaiement: 30,
  mentionTVA: 'TVA non applicable, article 293 B du CGI',
  contrat: { debut: '2026-10-01', fin: '2027-09-30' },
  cotisations: { tauxAcre: 19.4, finAcre: '2027-09-30', tauxPlein: 25.8 },
};

console.log('Durées et formats');
test('parseDuree comprend les écritures courantes', () => {
  assert.strictEqual(u.parseDuree('1h30'), 90);
  assert.strictEqual(u.parseDuree('1 h 30'), 90);
  assert.strictEqual(u.parseDuree('1:30'), 90);
  assert.strictEqual(u.parseDuree('45 min'), 45);
  assert.strictEqual(u.parseDuree('2,5'), 150);
  assert.strictEqual(u.parseDuree('2.25'), 135);
  assert.strictEqual(u.parseDuree('90'), 90);
  assert.strictEqual(u.parseDuree('2'), 120);
  assert.strictEqual(u.parseDuree('2h'), 120);
  assert.strictEqual(u.parseDuree('abc'), null);
  assert.strictEqual(u.parseDuree(''), null);
});
test('minutesEntre passe minuit', () => {
  assert.strictEqual(u.minutesEntre('09:00', '10:45'), 105);
  assert.strictEqual(u.minutesEntre('23:30', '00:15'), 45);
});
test('fmtDuree et fmtHeuresDec', () => {
  assert.strictEqual(u.fmtDuree(135), '2 h 15');
  assert.strictEqual(u.fmtDuree(45), '45 min');
  assert.strictEqual(u.fmtDuree(120), '2 h');
  assert.strictEqual(u.fmtHeuresDec(135), '2,25 h');
});
test('dates : mois, trimestres', () => {
  assert.strictEqual(u.ajouterMois('2026-12', 1), '2027-01');
  assert.strictEqual(u.dernierJour('2027-02'), '2027-02-28');
  assert.deepStrictEqual(u.listeMois('2026-10', '2027-01'), ['2026-10', '2026-11', '2026-12', '2027-01']);
  const t = u.trimestreDe('2026-11-15');
  assert.strictEqual(t.libelle, 'T4 2026');
  assert.strictEqual(t.echeance, '2027-01-31');
  assert.strictEqual(u.libelleDate('2026-10-01', 'long'), 'jeudi 1er octobre 2026');
  assert.strictEqual(u.ajouterJours('2026-10-31', 30), '2026-11-30');
});

console.log('Arrondi et regroupement');
test('arrondi au quart d\'heure supérieur', () => {
  assert.strictEqual(c.arrondirMinutes(0, 0.25), 0);
  assert.strictEqual(c.arrondirMinutes(1, 0.25), 15);
  assert.strictEqual(c.arrondirMinutes(15, 0.25), 15);
  assert.strictEqual(c.arrondirMinutes(16, 0.25), 30);
  assert.strictEqual(c.arrondirMinutes(125, 0.25), 135);
  assert.strictEqual(c.arrondirMinutes(125, 0), 125);
  assert.strictEqual(c.arrondirMinutes(61, 1), 120);
});
const entrees = [
  { id: 'a', date: '2026-10-05', axe: 'gouvernance', intervention: 'Recherche d\'idées', detail: 'Recherche en ligne', debut: '09:00', fin: '09:45', minutes: 45 },
  { id: 'b', date: '2026-10-05', axe: 'gouvernance', intervention: 'recherche d\'idées ', detail: 'Rédaction de fiches', debut: '09:45', fin: '10:15', minutes: 30 },
  { id: 'c', date: '2026-10-05', axe: 'gouvernance', intervention: 'Recherche d\'idées', detail: 'Synthèse', debut: '10:15', fin: '11:00', minutes: 45 },
  { id: 'd', date: '2026-10-06', axe: 'rapports', intervention: 'Campagne de rapports T3', minutes: 150 },
  { id: 'e', date: '2026-10-07', axe: 'projeta', intervention: 'Fiabilisation Projet A', detail: 'Correction d\'anomalies', minutes: 90 },
  { id: 'f', date: '2026-10-07', axe: 'projeta', intervention: 'Fiabilisation Projet A', detail: 'Tests', minutes: 35 },
  { id: 'g', date: '2026-11-02', axe: 'suivi', intervention: 'Point Partenaire', debut: '14:00', fin: '15:10' },
];
test('les lignes d\'une même intervention s\'additionnent, au temps exact', () => {
  const groupes = c.regrouperInterventions(c.entreesDuMois(entrees, '2026-10'), reglages);
  assert.strictEqual(groupes.length, 3);
  const rech = groupes[0];
  assert.strictEqual(rech.intervention, 'Recherche d\'idées');
  assert.strictEqual(rech.minutes, 120);
  assert.strictEqual(rech.minutesFacturables, 120);
  assert.deepStrictEqual(rech.details, ['Recherche en ligne', 'Rédaction de fiches', 'Synthèse']);
  assert.strictEqual(rech.nature, 'Recherche d\'idées : Recherche en ligne, Rédaction de fiches, Synthèse');
  const fiab = groupes[2];
  assert.strictEqual(fiab.minutes, 125);
  assert.strictEqual(fiab.minutesFacturables, 125);
  assert.strictEqual(u.arrondir2(fiab.montant), 89.29);
});
test('durée depuis début et fin quand la durée n\'est pas saisie', () => {
  assert.strictEqual(c.dureeEntree(entrees[6]), 70);
});
test('relevé du mois : totaux, journées, montant', () => {
  const r = c.releveDuMois(entrees, '2026-10', reglages, 12.5);
  assert.strictEqual(r.lignes.length, 3);
  assert.strictEqual(r.totalMinutes, 120 + 150 + 125);
  assert.strictEqual(r.arrondiMinutes, 10);
  assert.strictEqual(r.totalMinutesFacturables, 120 + 150 + 125 + 10);
  assert.strictEqual(r.heuresFacturables, 6.75);
  assert.strictEqual(r.journees, 0.96);
  assert.strictEqual(r.montantHT, u.arrondir2(6.75 * 42.86));
  assert.strictEqual(r.frais, 12.5);
  assert.strictEqual(r.total, u.arrondir2(r.montantHT + 12.5));
});
test('répartition par axe et heures par mois', () => {
  const rep = c.repartitionParAxe(entrees, reglages);
  assert.strictEqual(rep[0].axe, 'rapports');
  assert.strictEqual(rep[0].minutes, 150);
  const parMois = c.heuresParMois(entrees, ['2026-10', '2026-11', '2026-12'], reglages);
  assert.strictEqual(parMois[1].minutes, 70);
  assert.strictEqual(parMois[1].minutesFacturables, 75);
  assert.strictEqual(parMois[2].minutes, 0);
});
test('avancement du contrat', () => {
  const av = c.avancementContrat(entrees, reglages, '2026-11-15');
  assert.strictEqual(av.nbMois, 12);
  assert.strictEqual(av.moisEcoules, 2);
  assert.strictEqual(av.repereMinutes, 192 * 60);
  assert.strictEqual(av.minutesFacturables, 465);
  assert.strictEqual(av.attenduMinutes, 192 * 60 * 2 / 12);
});
test('libellés récents pour l\'autocomplétion', () => {
  const l = c.interventionsRecentes(entrees);
  assert.strictEqual(l[0], 'Point Partenaire');
  assert.strictEqual(l.length, 4);
});

console.log('Factures et trimestres');
test('numérotation continue par année', () => {
  assert.strictEqual(c.numeroFactureSuivant([], 2026), '2026-01');
  assert.strictEqual(c.numeroFactureSuivant([{ numero: '2026-01' }, { numero: '2026-02' }], 2026), '2026-03');
  assert.strictEqual(c.numeroFactureSuivant([{ numero: '2026-03' }], 2027), '2027-01');
});
test('construction d\'une facture figée', () => {
  const r = c.releveDuMois(entrees, '2026-10', reglages, 0);
  const f = c.construireFacture(r, reglages, { dateEmission: '2026-10-31', factures: [] });
  assert.strictEqual(f.numero, '2026-01');
  assert.strictEqual(f.dateEcheance, '2026-11-30');
  assert.strictEqual(f.lignes.length, 3);
  assert.strictEqual(f.total, r.total);
  assert.strictEqual(f.statut, 'emise');
  assert.strictEqual(c.statutFacture(f, '2026-11-15'), 'emise');
  assert.strictEqual(c.statutFacture(f, '2026-12-01'), 'retard');
});
test('taux de cotisation ACRE puis plein', () => {
  assert.strictEqual(c.tauxCotisation('2027-06-01', reglages), 19.4);
  assert.strictEqual(c.tauxCotisation('2027-09-30', reglages), 19.4);
  assert.strictEqual(c.tauxCotisation('2027-10-01', reglages), 25.8);
});
test('recettes par trimestre civil', () => {
  const factures = [
    { numero: '2026-01', total: 300, statut: 'payee', datePaiement: '2026-11-20' },
    { numero: '2026-02', total: 450, statut: 'payee', datePaiement: '2026-12-28' },
    { numero: '2026-03', total: 500, statut: 'emise', datePaiement: null },
    { numero: '2027-05', total: 1000, statut: 'payee', datePaiement: '2027-10-15' },
  ];
  const t = c.recettesParTrimestre(factures, reglages, '2027-01-10');
  const t4 = t.filter(x => x.cle === '2026-T4')[0];
  assert.strictEqual(t4.encaisse, 750);
  assert.strictEqual(t4.cotisations, u.arrondir2(750 * 0.194));
  /* Première déclaration : octobre 2026 à mars 2027, prélevée le 30/04/2027. */
  assert.strictEqual(t4.aDeclarer, false);
  assert.strictEqual(t4.echeance, '2027-04-30');
  assert.strictEqual(t4.premiere, true);
  const avril = c.recettesParTrimestre(factures, reglages, '2027-04-10');
  assert.ok(avril.filter(x => x.cle === '2026-T4' || x.cle === '2027-T1').every(x => x.aDeclarer && x.echeance === '2027-04-30'));
  const t1 = t.filter(x => x.cle === '2027-T1')[0];
  assert.strictEqual(t1.enCours, true);
  const t4b = t.filter(x => x.cle === '2027-T4')[0];
  assert.strictEqual(t4b.cotisations, 258);
});

console.log('Non facturable, forfait, factures multiples');
test('une ligne non facturable garde son temps mais vaut 0 €', () => {
  const lignes = [
    { id: 's1', date: '2026-07-06', axe: 'projeta', intervention: 'Fiabilisation', minutes: 90, facturable: false, motif: 'stage' },
    { id: 's2', date: '2026-07-06', axe: 'projeta', intervention: 'Fiabilisation', minutes: 35, facturable: false, motif: 'stage' },
    { id: 'f1', date: '2026-07-06', axe: 'rapports', intervention: 'Campagne', minutes: 50 },
  ];
  const r = c.releveDuMois(lignes, '2026-07', reglages, 0);
  assert.strictEqual(r.lignes.length, 2);
  const nf = r.lignes.filter(l => l.intervention === 'Fiabilisation')[0];
  assert.strictEqual(nf.minutes, 125);
  assert.strictEqual(nf.minutesFacturables, 0);
  assert.strictEqual(nf.montant, 0);
  assert.strictEqual(nf.facturable, false);
  assert.deepStrictEqual(nf.motifs, ['stage']);
  assert.strictEqual(r.totalMinutes, 175);
  assert.strictEqual(r.totalMinutesNonFacturables, 125);
  assert.strictEqual(r.totalMinutesFacturables, 60);
  assert.strictEqual(r.montantHT, 42.86);
});
test('un forfait remplace heures × tarif et calcule la remise', () => {
  const lignes = [
    { id: 'p1', date: '2026-10-01', axe: 'projeta', intervention: 'Reprise complète du catalogue', detail: 'fiches et DIC (4 h 20)', minutes: 1106, forfait: 600 },
    { id: 'o1', date: '2026-10-05', axe: 'rapports', intervention: 'Campagne T4', minutes: 60 },
  ];
  const r = c.releveDuMois(lignes, '2026-10', reglages, 0);
  const forfaitaire = r.lignes[0];
  assert.strictEqual(forfaitaire.minutesFacturables, 1106);
  assert.strictEqual(u.arrondir2(forfaitaire.valeurHoraire), 790.05);
  assert.strictEqual(forfaitaire.montant, 600);
  assert.strictEqual(u.arrondir2(forfaitaire.remise), 190.05);
  assert.strictEqual(r.arrondiMinutes, 0);
  assert.strictEqual(r.montantHT, 642.86);
  assert.strictEqual(u.arrondir2(r.valeurHoraire), 832.91);
  assert.strictEqual(u.arrondir2(r.remise), 190.05);
  const f = c.construireFacture(r, reglages, { dateEmission: '2026-10-31', factures: [] });
  assert.deepStrictEqual(f.entreesIds, ['p1', 'o1']);
  assert.strictEqual(f.lignes[0].forfait, 600);
  assert.strictEqual(f.total, 642.86);
});
test('plusieurs factures par mois : les lignes déjà facturées sont exclues', () => {
  const lignes = [
    { id: 'p1', date: '2026-10-01', axe: 'projeta', intervention: 'Reprise complète du catalogue', minutes: 1106, forfait: 600 },
    { id: 'o1', date: '2026-10-05', axe: 'rapports', intervention: 'Campagne T4', minutes: 60 },
    { id: 'o2', date: '2026-10-12', axe: 'rapports', intervention: 'Campagne T4', minutes: 120 },
  ];
  const r1 = c.releveDuMois(lignes.slice(0, 1), '2026-10', reglages, 0);
  const f1 = c.construireFacture(r1, reglages, { dateEmission: '2026-10-01', factures: [] });
  const deja = c.idsFactures([f1], '2026-10', lignes);
  assert.deepStrictEqual(deja, ['p1']);
  const r2 = c.releveDuMois(lignes, '2026-10', reglages, 0, { exclureIds: deja });
  assert.strictEqual(r2.lignes.length, 2);
  assert.strictEqual(r2.montantHT, 128.58);
  const ancienne = { mois: '2026-10', total: 10 };
  assert.deepStrictEqual(c.idsFactures([ancienne], '2026-10', lignes).sort(), ['o1', 'o2', 'p1']);
});

console.log('Priorités des chantiers');
test('priorité automatique selon l\'échéance', () => {
  const ref = '2026-09-02';
  assert.strictEqual(c.prioriteAutomatique({ echeance: '2026-09-04' }, ref), 'haute');
  assert.strictEqual(c.prioriteAutomatique({ echeance: '2026-09-06' }, ref), 'haute');
  assert.strictEqual(c.prioriteAutomatique({ echeance: '2026-09-07' }, ref), 'moyenne');
  assert.strictEqual(c.prioriteAutomatique({ echeance: '2026-09-16' }, ref), 'moyenne');
  assert.strictEqual(c.prioriteAutomatique({ echeance: '2026-09-17' }, ref), 'basse');
  assert.strictEqual(c.prioriteAutomatique({ echeance: null }, ref), null);
  assert.strictEqual(c.prioriteAutomatique({ echeance: '2026-09-03', statut: 'fait' }, ref), null);
});
test('un choix manuel n\'est jamais abaissé, l\'échéance peut le relever', () => {
  const ref = '2026-09-02';
  assert.deepStrictEqual(c.prioriteEffective({ priorite: 'haute', echeance: '2026-10-15' }, ref).niveau, 'haute');
  assert.strictEqual(c.prioriteEffective({ priorite: 'haute', echeance: '2026-10-15' }, ref).origine, 'manuelle');
  assert.strictEqual(c.prioriteEffective({ priorite: 'basse', echeance: '2026-09-04' }, ref).niveau, 'haute');
  assert.strictEqual(c.prioriteEffective({ priorite: 'basse', echeance: '2026-09-04' }, ref).origine, 'echeance');
  assert.strictEqual(c.prioriteEffective({ priorite: 'auto', echeance: '2026-09-10' }, ref).niveau, 'moyenne');
  assert.strictEqual(c.prioriteEffective({ priorite: 'auto' }, ref).niveau, 'basse');
  assert.strictEqual(c.prioriteEffective({ priorite: 'normale' }, ref).niveau, 'basse');
  assert.strictEqual(c.normaliserPriorite('normale'), 'auto');
});
test('tri : priorité, puis échéance proche, puis ordre', () => {
  const ref = '2026-09-02';
  const liste = [
    { id: 'seed', priorite: 'auto', ordre: 1 },
    { id: 'lointain', priorite: 'auto', echeance: '2026-10-20', ordre: 2 },
    { id: 'moyen', priorite: 'auto', echeance: '2026-09-12', ordre: 3 },
    { id: 'hauteManuelle', priorite: 'haute', ordre: 4 },
    { id: 'urgent', priorite: 'basse', echeance: '2026-09-03', ordre: 5 },
    { id: 'urgent2', priorite: 'auto', echeance: '2026-09-05', ordre: 6 },
    { id: 'seed0', priorite: 'auto', ordre: 0 },
  ];
  assert.deepStrictEqual(c.trierTaches(liste, ref).map(t => t.id), ['urgent', 'urgent2', 'hauteManuelle', 'moyen', 'lointain', 'seed0', 'seed']);
});

console.log('Formats des documents');
test('IBAN, téléphone et adresse mis en forme', () => {
  assert.strictEqual(u.formaterIban('FR7630006000011234567890189'), 'FR76 3000 6000 0112 3456 7890 189');
  assert.strictEqual(u.formaterIban(' fr76 3000 6000 0112 3456 7890 189 '), 'FR76 3000 6000 0112 3456 7890 189');
  assert.strictEqual(u.formaterTelephone('06 12 34 5678'), '06 12 34 56 78');
  assert.strictEqual(u.formaterTelephone('0612345678'), '06 12 34 56 78');
  assert.strictEqual(u.formaterTelephone('+33 6 12 34 56 78'), '+33 6 12 34 56 78');
  assert.deepStrictEqual(u.adresseLignes('12 rue des Essais, 75000 Paris'), ['12 rue des Essais', '75000 Paris']);
  assert.deepStrictEqual(u.adresseLignes('1 avenue des Tests 75000 Paris'), ['1 avenue des Tests', '75000 Paris']);
  assert.deepStrictEqual(u.adresseLignes(''), []);
  assert.strictEqual(u.libelleJours(0), 'Aujourd\'hui');
  assert.strictEqual(u.libelleJours(1), 'Demain');
  assert.strictEqual(u.libelleJours(12), 'J-12');
  assert.strictEqual(u.libelleJours(-3), 'J+3');
  assert.strictEqual(u.fmtTaille(2048), '2,0 Ko');
});

console.log('Rappels');
const donneesRappels = {
  entrees: [{ id: 'x', date: '2026-10-05', axe: 'projeta', intervention: 'Pack', minutes: 120 }],
  taches: [
    { id: 't1', statut: 'a-faire', titre: 'Tâche du jour', echeance: '2026-11-10' },
    { id: 't2', statut: 'en-cours', titre: 'Tâche dépassée', echeance: '2026-11-03' },
    { id: 't3', statut: 'fait', titre: 'Tâche finie', echeance: '2026-11-03' },
    { id: 't4', statut: 'a-faire', titre: 'Tâche lointaine', echeance: '2026-12-20' },
  ],
  echeances: [
    { id: 'e1', date: '2026-11-15', titre: 'Dans 5 jours', fait: false },
    { id: 'e2', date: '2026-11-15', titre: 'Rappel à 3 jours seulement', fait: false, rappelJours: 3 },
    { id: 'e3', date: '2026-11-01', titre: 'Faite', fait: true },
    { id: 'e4', date: '2026-11-11', titre: 'Reportée', fait: false },
  ],
  factures: [
    { id: 'f1', numero: '2026-01', statut: 'emise', dateEcheance: '2026-11-02', total: 600 },
    { id: 'f2', numero: '2026-02', statut: 'payee', dateEcheance: '2026-11-02', total: 100 },
  ],
  chrono: { debut: '2026-11-10T04:00:00.000Z', intervention: 'Longue session', pauseDepuis: null, pauseCumuleeMs: 0 },
};
const reglagesRappels = Object.assign({}, reglages, { rappels: { horizonEcheances: 7, horizonTaches: 3, horizonFactures: 5, chronoOublieHeures: 3, journalJours: 7 }, ui: { rappelsReportes: { 'echeance:e4': '2026-11-12' } } });
test('rappels : échéances, tâches, factures, mois à facturer, chrono, journal', () => {
  const ref = '2026-11-10';
  const maintenant = new Date('2026-11-10T09:00:00.000Z').getTime();
  const r = c.calculerRappels(donneesRappels, reglagesRappels, { ref, maintenant });
  const cles = r.map(x => x.cle);
  assert.ok(cles.indexOf('echeance:e1') >= 0, 'échéance à 5 jours dans l\'horizon de 7');
  assert.ok(cles.indexOf('echeance:e2') < 0, 'échéance avec rappel à 3 jours : pas encore');
  assert.ok(cles.indexOf('echeance:e3') < 0, 'échéance faite ignorée');
  const reportee = r.filter(x => x.cle === 'echeance:e4')[0];
  assert.strictEqual(reportee.reporte, '2026-11-12');
  assert.strictEqual(r.filter(x => x.cle === 'tache:t1')[0].niveau, 'urgent');
  assert.strictEqual(r.filter(x => x.cle === 'tache:t2')[0].niveau, 'retard');
  assert.ok(cles.indexOf('tache:t3') < 0 && cles.indexOf('tache:t4') < 0);
  const facturer = r.filter(x => x.cle === 'facturer:2026-10')[0];
  assert.ok(facturer && facturer.niveau === 'urgent' && facturer.detail.indexOf('2 h') === 0);
  assert.strictEqual(r.filter(x => x.cle === 'paiement:f1')[0].niveau, 'retard');
  assert.ok(cles.indexOf('paiement:f2') < 0, 'facture payée ignorée');
  const chrono = r.filter(x => x.cle === 'chrono:long')[0];
  assert.ok(chrono && chrono.titre.indexOf('5 h') >= 0);
  assert.ok(r.some(x => x.cle === 'journal:silence' && x.titre.indexOf('36 jours') > 0), 'journal délaissé depuis le 5 octobre');
  assert.ok(facturer.titre === 'Relevé d\'octobre 2026 à facturer', facturer.titre);
  assert.strictEqual(r[0].niveau, 'retard', 'les retards d\'abord');
  assert.ok(r.every((x, i) => i === 0 || c.NIVEAUX_RAPPEL[r[i - 1].niveau] >= c.NIVEAUX_RAPPEL[x.niveau]));
});
test('rappels : journal délaissé un jour ouvré, silencieux le week-end', () => {
  const sansChrono = Object.assign({}, donneesRappels, { chrono: null, entrees: [{ id: 'x', date: '2026-10-05', axe: 'projeta', intervention: 'Pack', minutes: 120 }] });
  const lundi = c.calculerRappels(sansChrono, reglagesRappels, { ref: '2026-11-16' });
  assert.ok(lundi.some(x => x.cle === 'journal:silence' && x.titre.indexOf('42 jours') > 0));
  const samedi = c.calculerRappels(sansChrono, reglagesRappels, { ref: '2026-11-14' });
  assert.ok(!samedi.some(x => x.cle === 'journal:silence'));
  const horsContrat = c.calculerRappels(sansChrono, reglagesRappels, { ref: '2026-09-14' });
  assert.ok(!horsContrat.some(x => x.cle === 'journal:silence'));
});
test('temps passé sur une tâche', () => {
  const m = c.minutesTache([{ tache: 'a', minutes: 30 }, { tache: 'a', minutes: 45 }, { tache: 'b', minutes: 10 }], 'a');
  assert.deepStrictEqual(m, { minutes: 75, lignes: 2 });
});

console.log('Robustesse (audit)');
test('arrondi commercial au centime sans erreur flottante', () => {
  assert.strictEqual(u.arrondir2(0.75 * 42.86), 32.15);
  assert.strictEqual(u.arrondir2(3.25 * 42.86), 139.3);
  assert.strictEqual(u.arrondir2(12.5 * 0.194), 2.43);
  assert.strictEqual(u.arrondir2(-1.005), -1.01);
  assert.strictEqual(u.arrondir2('abc'), 0);
});
test('la facture tombe juste : heures facturées × tarif = somme des lignes', () => {
  const lignes = [15, 45, 75, 105].map((m, i) => ({ id: 'q' + i, date: '2026-10-0' + (i + 1), axe: 'projeta', intervention: 'I' + i, minutes: m }));
  const rel = c.releveDuMois(lignes, '2026-10', reglages, 0);
  assert.strictEqual(rel.totalMinutesFacturables, 240);
  assert.strictEqual(rel.montantHT, u.arrondir2(4 * 42.86));
  assert.strictEqual(rel.montantHT, 171.44);
});
test('durées et montants tolérants aux chaînes et aux valeurs absentes', () => {
  assert.strictEqual(c.dureeEntree({ minutes: '30' }), 30);
  assert.strictEqual(c.dureeEntree({ minutes: '1,5' }), 2);
  assert.strictEqual(c.dureeEntree({ minutes: 'abc', debut: '09:00', fin: '09:20' }), 20);
  assert.strictEqual(u.parseDuree('10,5'), 630);
  assert.strictEqual(u.parseDuree('12.5'), 750);
  assert.strictEqual(u.parseDuree('1h30min'), 90);
  assert.strictEqual(u.parseDuree('1 h 30 min'), 90);
  assert.strictEqual(u.parseDuree('90'), 90);
  assert.strictEqual(u.lireMontant('1 250,50'), 1250.5);
  assert.strictEqual(u.lireMontant('1 250,50'), 1250.5);
  assert.strictEqual(u.lireMontant('abc'), null);
  assert.strictEqual(u.libelleDate('abc'), '');
  assert.ok(isNaN(u.joursEntre('', '2026-01-01')));
  assert.strictEqual(u.libelleJours(NaN), '');
});
test('une ligne facturée reste exclue, même déplacée dans un autre mois', () => {
  const lignes = [{ id: 'a', date: '2026-10-05', axe: 'projeta', intervention: 'A', minutes: 60 }, { id: 'b', date: '2026-11-02', axe: 'projeta', intervention: 'B', minutes: 60 }];
  const f = { mois: '2026-10', entreesIds: ['a'] };
  assert.deepStrictEqual(c.idsFactures([f], '2026-11', lignes), ['a']);
  assert.strictEqual(c.factureDeEntree([f], 'a'), f);
  assert.strictEqual(c.factureDeEntree([f, null], 'zz'), null);
  const relNov = c.releveDuMois([{ id: 'a', date: '2026-11-05', axe: 'projeta', intervention: 'A', minutes: 60 }, lignes[1]], '2026-11', reglages, 0, { exclureIds: c.idsFactures([f], '2026-11', lignes) });
  assert.deepStrictEqual(relNov.ids, ['b']);
});
test('l\'arrondi se fait une fois, sur le total, jamais par intervention', () => {
  /* Le cas qui a fait changer la règle (26/10/2026) : quatre séances de
     10 min faisaient facturer 4 quarts d'heure (1 h) pour 40 min. */
  const lignes = [1, 2, 3, 4].map(i => ({ id: 'x' + i, date: '2026-10-0' + i, axe: 'suivi', intervention: 'Séance ' + i, minutes: 10 }));
  const rel = c.releveDuMois(lignes, '2026-10', reglages, 0);
  assert.ok(rel.lignes.every(l => l.minutesFacturables === 10));
  assert.strictEqual(rel.arrondiMinutes, 5);
  assert.strictEqual(rel.totalMinutesFacturables, 45);
  assert.strictEqual(rel.montantHT, u.arrondir2(0.75 * 42.86));
  const f = c.construireFacture(rel, reglages, { numero: '2026-01', dateEmission: '2026-10-31' });
  assert.strictEqual(f.arrondiMinutes, 5);
  assert.strictEqual(f.minutesFacturees, 45);
  assert.strictEqual(f.montantHT, rel.montantHT);
  const t = c.totauxEntrees(lignes, reglages);
  assert.strictEqual(t.minutesFacturables, 45);
  assert.strictEqual(t.montant, rel.montantHT);
  assert.strictEqual(c.arrondiDuTotal([], reglages), 0);
});
test('intervention facturée en partie : le reste part au temps exact', () => {
  const a = { id: 'a', date: '2026-10-05', axe: 'projeta', intervention: 'Partielle', minutes: 20 };
  const f1 = c.construireFacture(c.releveDuMois([a], '2026-10', reglages, 0), reglages, { numero: '2026-01', dateEmission: '2026-10-06' });
  assert.strictEqual(f1.minutesFacturees, 30);
  const b = { id: 'b', date: '2026-10-05', axe: 'projeta', intervention: 'partielle', minutes: 25 };
  const reste = c.releveDuMois([a, b], '2026-10', reglages, 0, { exclureIds: f1.entreesIds });
  assert.strictEqual(reste.lignes.length, 1);
  assert.strictEqual(reste.lignes[0].minutesFacturables, 25);
  assert.strictEqual(reste.totalMinutesFacturables, 30);
  assert.strictEqual(reste.montantHT, u.arrondir2(0.5 * 42.86));
});
test('délai de paiement figé sur la facture, 30 jours par défaut', () => {
  const rel = c.releveDuMois(entrees, '2026-10', reglages, 0);
  assert.strictEqual(c.construireFacture(rel, Object.assign({}, reglages, { delaiPaiement: '' }), { numero: 'x', dateEmission: '2026-10-31' }).dateEcheance, '2026-11-30');
  const f0 = c.construireFacture(rel, Object.assign({}, reglages, { delaiPaiement: 0 }), { numero: 'x', dateEmission: '2026-10-31' });
  assert.strictEqual(f0.delaiPaiement, 0);
  assert.strictEqual(f0.dateEcheance, '2026-10-31');
});
test('trimestres : ceux sans encaissement figurent aussi', () => {
  const t = c.recettesParTrimestre([{ statut: 'payee', datePaiement: '2026-11-20', total: 100 }, { statut: 'payee', datePaiement: '2027-04-15', total: 100 }], reglages, '2027-04-20');
  assert.deepStrictEqual(t.map(x => x.cle), ['2026-T4', '2027-T1', '2027-T2', '2027-T3']);
  assert.ok(t[1].aDeclarer && t[1].encaisse === 0);
});
test('rappels et regroupement : entrées nulles ignorées', () => {
  const r = c.calculerRappels({ entrees: [null, { id: 'x', date: '', minutes: 5 }], taches: [null, { id: 't', statut: 'a-faire', echeance: 'abc', titre: 'x' }], echeances: [null, { id: 'e', date: '2026-09-03', titre: 'e' }], factures: [null, { id: 'f', statut: 'emise', dateEcheance: '', total: 10 }], chrono: { debut: 'abc' } }, { contrat: {}, rappels: {} }, { ref: '2026-09-02' });
  assert.deepStrictEqual(r.map(x => x.cle), ['echeance:e']);
  assert.deepStrictEqual(c.interventionsRecentes([null, { intervention: 'A', date: '2026-01-01' }]), ['A']);
});

console.log('Report sur un autre mois de facturation');
const sept = { id: 's1', date: '2026-09-15', axe: 'projeta', intervention: 'Préparation', minutes: 120, moisFacturation: '2026-10' };
test('le relevé suit le mois de facturation, le journal la date', () => {
  assert.strictEqual(c.moisFacturationDe(sept), '2026-10');
  assert.strictEqual(c.estReporte(sept), true);
  assert.strictEqual(c.moisFacturationDe({ date: '2026-09-15' }), '2026-09');
  assert.strictEqual(c.estReporte({ date: '2026-09-15' }), false);
  assert.strictEqual(c.entreesDuMois([sept], '2026-09').length, 1);
  assert.strictEqual(c.entreesDuMois([sept], '2026-10').length, 0);
  const relSept = c.releveDuMois([sept], '2026-09', reglages, 0);
  const relOct = c.releveDuMois([sept], '2026-10', reglages, 0);
  assert.strictEqual(relSept.lignes.length, 0);
  assert.strictEqual(relSept.montantHT, 0);
  assert.strictEqual(relOct.lignes.length, 1);
  assert.strictEqual(relOct.lignes[0].date, '2026-09-15');
  assert.strictEqual(relOct.lignes[0].reporte, true);
  assert.strictEqual(relOct.lignes[0].moisTravail, '2026-09');
  assert.strictEqual(relOct.montantHT, u.arrondir2(2 * 42.86));
});
test('les relevés annoncent ce qui part et ce qui arrive', () => {
  const relSept = c.releveDuMois([sept], '2026-09', reglages, 0);
  const relOct = c.releveDuMois([sept], '2026-10', reglages, 0);
  assert.deepStrictEqual(relSept.reportsEnvoyes.map(g => g.mois), ['2026-10']);
  assert.deepStrictEqual(relSept.reportsRecus, []);
  assert.deepStrictEqual(relOct.reportsRecus.map(g => g.mois), ['2026-09']);
  assert.strictEqual(relOct.reportsRecus[0].totaux.minutes, 120);
  assert.strictEqual(relOct.reportsRecus[0].totaux.montant, u.arrondir2(2 * 42.86));
});
test('un mois de facturation aberrant laisse la ligne sur son mois', () => {
  ['2026-13', '2026-1', 'octobre', '', null, '2026-10-05'].forEach((m) => {
    assert.strictEqual(c.moisFacturationDe({ date: '2026-09-15', moisFacturation: m }), '2026-09', String(m));
  });
  assert.strictEqual(c.releveDuMois([{ id: 'x', date: '2026-09-15', axe: 'a', intervention: 'X', minutes: 60, moisFacturation: '2026-13' }], '2026-09', reglages, 0).lignes.length, 1);
});
test('deux mois de facturation le même jour font deux interventions', () => {
  const a = { id: 'a', date: '2026-09-15', axe: 'projeta', intervention: 'Point', minutes: 20 };
  const b = { id: 'b', date: '2026-09-15', axe: 'projeta', intervention: 'point', minutes: 20, moisFacturation: '2026-10' };
  assert.notStrictEqual(c.cleIntervention(a), c.cleIntervention(b));
  assert.strictEqual(c.cleTravail(a), c.cleTravail(b));
  assert.strictEqual(c.releveDuMois([a, b], '2026-09', reglages, 0).totalMinutesFacturables, 30);
  assert.strictEqual(c.releveDuMois([a, b], '2026-10', reglages, 0).totalMinutesFacturables, 30);
});
test('report : la facture garde le mois de facturation de ses lignes', () => {
  const a = { id: 'a', date: '2026-09-15', axe: 'projeta', intervention: 'Suivi', minutes: 40, moisFacturation: '2026-10' };
  const f1 = c.construireFacture(c.releveDuMois([a], '2026-10', reglages, 0), reglages, { numero: '2026-01', dateEmission: '2026-10-05' });
  assert.strictEqual(f1.minutesFacturees, 45);
  assert.strictEqual(f1.lignes[0].moisFacturation, '2026-10');
});
test('une facture ancienne, sans liste de lignes, verrouille son mois', () => {
  const a = { id: 'a', date: '2026-06-10', axe: 'projeta', intervention: 'Ancien', minutes: 60, moisFacturation: '2026-10' };
  const vieille = { mois: '2026-06', numero: '2026-02', lignes: [] };
  assert.deepStrictEqual(c.idsFactures([vieille], '2026-10', [a]), ['a']);
  assert.strictEqual(c.releveDuMois([a], '2026-10', reglages, 0, { exclureIds: c.idsFactures([vieille], '2026-10', [a]) }).montantHT, 0);
  assert.strictEqual(c.peutReporter(a, [vieille]), false);
  assert.strictEqual(c.factureFigeant([vieille], a), vieille);
  assert.strictEqual(c.peutReporter(a, []), true);
});
test('une ligne figée sur une facture ne se reporte plus', () => {
  const a = { id: 'a', date: '2026-10-05', axe: 'projeta', intervention: 'Fixe', minutes: 60 };
  const f = { mois: '2026-10', numero: '2026-01', entreesIds: ['a'], lignes: [] };
  assert.strictEqual(c.peutReporter(a, [f]), false);
  assert.strictEqual(c.peutReporter({ id: 'b', date: '2026-10-06' }, [f]), true);
});
test('le rappel réclame le mois de facturation, pas celui du travail', () => {
  const donnees = { entrees: [sept], taches: [], echeances: [], factures: [] };
  const r = c.calculerRappels(donnees, reglages, { ref: '2026-11-03' });
  const facturer = r.filter(x => x.categorie === 'facture');
  assert.deepStrictEqual(facturer.map(x => x.cibleId), ['2026-10']);
  assert.ok(/octobre 2026/.test(facturer[0].titre));
});
test('un travail reporté dans le contrat compte dans l\'avancement', () => {
  const av = c.avancementContrat([sept], reglages, '2026-10-15');
  assert.strictEqual(av.minutesFacturables, 120);
  assert.strictEqual(c.entreesDuContrat([sept], reglages.contrat).length, 1);
  assert.strictEqual(c.entreesDuContrat([{ id: 'z', date: '2026-09-15', minutes: 60 }], reglages.contrat).length, 0);
});

test('une intervention à cheval sur deux mois : chaque facture arrondit son total', () => {
  const a = { id: 'a', date: '2026-10-05', axe: 'suivi', intervention: 'Point Partenaire', minutes: 50, moisFacturation: '2026-11' };
  const fNov = c.construireFacture(c.releveDuMois([a], '2026-11', reglages, 0), reglages, { numero: '2026-05', dateEmission: '2026-11-30' });
  assert.strictEqual(fNov.minutesFacturees, 60);
  const b = { id: 'b', date: '2026-10-05', axe: 'suivi', intervention: 'Point Partenaire', minutes: 40 };
  const relOct = c.releveDuMois([a, b], '2026-10', reglages, 0, { exclureIds: fNov.entreesIds });
  assert.strictEqual(relOct.lignes.length, 1);
  assert.strictEqual(relOct.lignes[0].minutesFacturables, 40);
  assert.strictEqual(relOct.totalMinutesFacturables, 45);
});
test('une facture ancienne ne couvre pas une ligne saisie après elle', () => {
  const ancienne = { mois: '2026-06', numero: '2026-02', dateEmission: '2026-07-02', lignes: [] };
  const avant = { id: 'a', date: '2026-06-10', axe: 'projeta', intervention: 'Ancien', minutes: 60, creeLe: '2026-06-10T09:00:00Z' };
  const apres = { id: 'b', date: '2026-06-12', axe: 'projeta', intervention: 'Oublié', minutes: 60, creeLe: '2026-10-28T09:00:00Z' };
  assert.deepStrictEqual(c.idsFactures([ancienne], '2026-06', [avant, apres]), ['a']);
  assert.strictEqual(c.peutReporter(avant, [ancienne]), false);
  assert.strictEqual(c.peutReporter(apres, [ancienne]), true);
});
test('un travail du contrat reporté après sa fin reste dans l\'avancement', () => {
  const tardif = { id: 'z', date: '2027-09-28', axe: 'projeta', intervention: 'Bilan', minutes: 240, moisFacturation: '2027-10' };
  assert.strictEqual(c.entreesDuContrat([tardif], reglages.contrat).length, 1);
  assert.strictEqual(c.avancementContrat([tardif], reglages, '2027-09-30').minutesFacturables, 240);
});
test('énumération des mois : virgules puis « et »', () => {
  assert.strictEqual(u.enumererMois(['2026-07']), 'juillet 2026');
  assert.strictEqual(u.enumererMois(['2026-07', '2026-09']), 'juillet 2026 et septembre 2026');
  assert.strictEqual(u.enumererMois(['2026-07', '2026-08', '2026-09']), 'juillet 2026, août 2026 et septembre 2026');
});
test('le rappel réclame aussi un mois sans ligne mais avec des frais', () => {
  const r = c.calculerRappels({ entrees: [], taches: [], echeances: [], factures: [] },
    Object.assign({}, reglages, { ui: { moisMeta: { '2026-10': { frais: 96 } } } }), { ref: '2026-11-03' });
  const facturer = r.filter(x => x.categorie === 'facture');
  assert.deepStrictEqual(facturer.map(x => x.cibleId), ['2026-10']);
  assert.ok(/frais/.test(facturer[0].detail));
});

console.log('Annexe de la facture');
test('les lignes de la facture se regroupent par axe et libellé, sans date', () => {
  const lignes = [
    { date: '2026-09-09', axe: 'rapports', intervention: 'Envoi du premier rapport client', nature: 'Envoi du premier rapport client : contrôle', details: ['contrôle'], moisFacturation: '2026-10', minutes: 45, minutesFacturables: 45, montant: 0.75 * 42.86, valeurHoraire: 0.75 * 42.86, facturable: true, motifs: [], forfait: null },
    { date: '2026-10-02', axe: 'projeta', intervention: 'Fiabilisation', nature: 'Fiabilisation', details: [], moisFacturation: '2026-10', minutes: 120, minutesFacturables: 120, montant: 2 * 42.86, valeurHoraire: 2 * 42.86, facturable: true, motifs: [], forfait: null },
    { date: '2026-10-05', axe: 'rapports', intervention: 'envoi du premier rapport  client', nature: 'envoi du premier rapport  client : relances', details: ['relances'], moisFacturation: '2026-10', minutes: 70, minutesFacturables: 75, montant: 1.25 * 42.86, valeurHoraire: 1.25 * 42.86, facturable: true, motifs: [], forfait: null },
    { date: '2026-10-06', axe: 'projeta', intervention: 'Fiabilisation', nature: 'Fiabilisation', details: [], moisFacturation: '2026-10', minutes: 30, minutesFacturables: 0, montant: 0, valeurHoraire: 0, facturable: false, motifs: ['geste commercial'], forfait: null },
    { date: '2026-10-07', axe: 'projetb', intervention: 'Atelier', nature: 'Atelier', details: [], moisFacturation: '2026-10', minutes: 240, minutesFacturables: 240, montant: 150, valeurHoraire: 4 * 42.86, facturable: true, motifs: [], forfait: 150 },
    { date: '2026-10-14', axe: 'projetb', intervention: 'Atelier', nature: 'Atelier', details: [], moisFacturation: '2026-10', minutes: 240, minutesFacturables: 240, montant: 150, valeurHoraire: 4 * 42.86, facturable: true, motifs: [], forfait: 150 },
  ];
  const g = c.regrouperLignesFacture(lignes);
  /* deux jours du même travail : une ligne ; les forfaits restent séparés ; la non facturable à part */
  assert.strictEqual(g.length, 5);
  assert.strictEqual(g[0].intervention, 'Envoi du premier rapport client');
  assert.strictEqual(g[0].nbLignes, 2);
  assert.strictEqual(g[0].minutes, 115);
  assert.strictEqual(g[0].minutesFacturables, 120);
  assert.strictEqual(u.arrondir2(g[0].montant), u.arrondir2(2 * 42.86));
  assert.strictEqual(g[0].nature, 'Envoi du premier rapport client : contrôle, relances');
  assert.strictEqual(g[1].intervention, 'Fiabilisation');
  assert.strictEqual(g[1].facturable, true);
  assert.strictEqual(g[2].facturable, false);
  assert.deepStrictEqual(g[2].motifs, ['geste commercial']);
  assert.strictEqual(g[2].minutesFacturables, 0);
  assert.strictEqual(g[3].forfait, 150);
  assert.strictEqual(g[4].forfait, 150);
  assert.ok(g.every(x => x.date === undefined));
  /* les totaux de l'annexe restent ceux de la facture */
  const somme = k => lignes.reduce((s, l) => s + l[k], 0);
  assert.strictEqual(g.reduce((s, x) => s + x.minutes, 0), somme('minutes'));
  assert.strictEqual(u.arrondir2(g.reduce((s, x) => s + x.montant, 0)), u.arrondir2(somme('montant')));
  assert.deepStrictEqual(c.regrouperLignesFacture([]), []);
  assert.deepStrictEqual(c.regrouperLignesFacture(null), []);
});

console.log('Montants de l\'annexe et trésorerie URSSAF');
test('la somme des montants affichés dans l\'annexe égale le total HT de la facture', () => {
  /* Le cas de la facture 2026-01 : 18 interventions, 35,75 h. Arrondies une à
     une, les lignes à demi-centime donnaient 1 532,33 € pour 1 532,25 €. */
  const heures = [].concat(Array(13).fill(0.75), Array(3).fill(1.25), [10, 12.25]);
  const entrees = heures.map((h, i) => ({ id: 'a' + i, date: '2026-10-' + u.deuxChiffres(i + 1), axe: 'projeta', intervention: 'Travail ' + i, minutes: h * 60 }));
  const f = c.construireFacture(c.releveDuMois(entrees, '2026-10', reglages, 0), reglages, { numero: '2026-01', dateEmission: '2026-10-25' });
  assert.strictEqual(f.minutesFacturees, 35.75 * 60);
  assert.strictEqual(f.montantHT, 1532.25);
  const annexe = c.regrouperLignesFacture(f.lignes);
  assert.strictEqual(annexe.length, 18);
  const centimes = l => Math.round(l * 100);
  assert.strictEqual(annexe.reduce((s, l) => s + centimes(u.arrondir2(l.montant)), 0), 153233);
  const affiches = c.montantsAuCentime(annexe.map(l => l.montant));
  assert.strictEqual(affiches.reduce((s, m) => s + centimes(m), 0), centimes(f.montantHT));
  annexe.forEach((l, i) => assert.ok(Math.abs(affiches[i] - l.montant) < 0.01));
  assert.deepStrictEqual(c.montantsAuCentime([10.715, 10.715, 0, 150]), [10.72, 10.71, 0, 150]);
  assert.deepStrictEqual(c.montantsAuCentime([]), []);
});
test('les détails se joignent sans double ponctuation', () => {
  assert.strictEqual(c.joindreDetails(['Contrôle fait.', 'Envoi', 'relances']), 'Contrôle fait. Envoi, relances');
  assert.ok(!/\.,/.test(c.joindreDetails(['a.', 'b.', 'c'])));
  assert.strictEqual(c.joindreDetails([]), '');
});
test('trésorerie d\'une facture : provision URSSAF, net, abattement BNC', () => {
  const t = c.tresorerieFacture({ numero: '2026-01', total: 1532.25, statut: 'emise', dateEmission: '2026-10-25', dateEcheance: '2026-11-24' }, reglages);
  assert.strictEqual(t.encaissee, false);
  assert.strictEqual(t.taux, 19.4);
  assert.strictEqual(t.cotisations, 297.26);
  assert.strictEqual(t.net, 1234.99);
  assert.strictEqual(t.imposable, 1011.29);
  assert.strictEqual(u.arrondir2(t.abattement + t.imposable), 1532.25);
  assert.strictEqual(t.prelevement, '2027-04-30');
  const payee = c.tresorerieFacture({ numero: '2027-09', total: 1000, statut: 'payee', datePaiement: '2027-10-15' }, reglages);
  assert.strictEqual(payee.cotisations, 258);
  assert.strictEqual(payee.prelevement, '2028-01-31');
  assert.strictEqual(c.periodeUrssaf('2027-02-10', reglages).echeance, '2027-04-30');
  assert.strictEqual(c.periodeUrssaf('2027-05-02', reglages).echeance, '2027-07-31');
  assert.strictEqual(c.periodeUrssaf('2027-05-02', reglages).premiere, false);
});

console.log('Facture figée et travail reporté');
test('la facture fige le prestataire et le client : changer les réglages ne la touche pas', () => {
  const r2 = Object.assign({}, reglages, { prestataire: { nom: 'Prestataire Essai', iban: 'FR7600' }, client: { societe: 'Client Essai' } });
  const rel = c.releveDuMois([{ id: 'a', date: '2031-03-05', axe: 'x', intervention: 'Essai', minutes: 60 }], '2031-03', r2, 0);
  const f = c.construireFacture(rel, r2, { numero: '2031-01', dateEmission: '2031-03-10' });
  r2.prestataire.iban = 'FR7699';
  r2.client.societe = 'Autre client';
  assert.strictEqual(f.prestataire.iban, 'FR7600');
  assert.strictEqual(f.client.societe, 'Client Essai');
});
test('la facture garde les reports annoncés par son relevé', () => {
  const lignes = [{ id: 'a', date: '2031-03-05', axe: 'x', intervention: 'Reste', minutes: 60 }, { id: 'b', date: '2031-03-06', axe: 'x', intervention: 'Part', minutes: 45, moisFacturation: '2031-04' }];
  const f = c.construireFacture(c.releveDuMois(lignes, '2031-03', reglages, 0), reglages, { numero: '2031-01', dateEmission: '2031-03-31' });
  assert.deepStrictEqual(f.reportsEnvoyes, [{ mois: '2031-04', totaux: { minutes: 45 } }]);
});
test('le travail reporté se compte au temps exact, seul le total du mois s\'arrondit', () => {
  const lignes = [{ id: 'a', date: '2031-03-05', axe: 'x', intervention: 'Petit', minutes: 7, moisFacturation: '2031-04' }, { id: 'b', date: '2031-03-06', axe: 'x', intervention: 'Autre', minutes: 7, moisFacturation: '2031-04' }];
  const t = c.totauxEntrees(lignes.slice(0, 1), reglages, true);
  assert.strictEqual(t.minutesFacturables, 7);
  assert.strictEqual(t.montant, u.arrondir2(7 / 60 * 42.86));
  assert.strictEqual(c.totauxEntrees(lignes.slice(0, 1), reglages).minutesFacturables, 15, 'sans exact : arrondi au quart d\'heure');
  const g = c.reportsDepuis(lignes, '2031-03', reglages)[0];
  assert.strictEqual(g.totaux.minutesFacturables, 14);
  assert.strictEqual(c.releveDuMois(lignes, '2031-04', reglages, 0).totalMinutesFacturables, 15, 'le relevé du mois garde son arrondi');
});

console.log('Mois à deux factures');
test('les factures font foi, plus ce qui reste à facturer', () => {
  const total = c.totalMoisFacture([{ minutesFacturees: 15, montantHT: 10.72 }, { minutesFacturees: 30, montantHT: 21.43 }], { totalMinutesFacturables: 7, montantHT: 5 });
  assert.deepStrictEqual(total, { minutes: 52, montant: 37.15 });
});
test('une suite le jour même d\'une facture se reporte seule', () => {
  const lignes = [{ id: 'a', date: '2031-03-02' }, { id: 'b', date: '2031-03-02' }];
  const factures = [{ mois: '2031-03', entreesIds: ['a'] }];
  assert.deepStrictEqual(c.partReportable(lignes, factures).map(e => e.id), ['b']);
  assert.deepStrictEqual(c.partReportable([lignes[0]], factures), []);
});

console.log('\n' + n + ' tests verts.');
