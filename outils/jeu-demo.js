/* Jeu de données de démonstration pour les vérifications visuelles.
   Usage : node outils/jeu-demo.js <dossier-de-donnees>
   puis : SABLIER_DONNEES=<dossier> npm start   (ou npm run smoke)
   Le dossier de données réel de l'application n'est jamais touché. */
'use strict';
const fs = require('fs');
const path = require('path');
const c = require('../js/calculs.js');

const dossier = process.argv[2];
if (!dossier) { console.error('dossier de données attendu en argument'); process.exit(1); }
fs.mkdirSync(dossier, { recursive: true });

const reglages = {
  tarifHoraire: 42.86, arrondi: 0.25, heuresJournee: 7, repereAnnuel: 192, delaiPaiement: 30,
  mentionTVA: 'TVA non applicable, article 293 B du CGI',
  contrat: { debut: '2026-07-01', fin: '2027-06-30' },
  cotisations: { tauxAcre: 19.4, finAcre: '2027-09-30', tauxPlein: 25.8 },
  ui: { dernierAxe: 'projeta', moisMeta: { '2026-08': { frais: 18.4, joindreTravaux: true } } },
};

let n = 0;
function e(date, axe, intervention, detail, debut, fin, minutes) {
  n++;
  const o = { id: 'demo_' + n, date, axe, intervention, detail: detail || '', debut: debut || '', fin: fin || '', tache: null, creeLe: date + 'T12:00:00.000Z', modifieLe: date + 'T12:00:00.000Z' };
  o.minutes = minutes != null ? minutes : c.dureeEntree(o);
  return o;
}
const entrees = [
  e('2026-07-06', 'projeta', 'Fiabilisation Projet A', 'Correction d\'anomalies', '09:00', '10:30'),
  e('2026-07-06', 'projeta', 'Fiabilisation Projet A', 'Tests', '10:30', '11:05'),
  e('2026-07-08', 'rapports', 'Campagne de rapports T2', 'Contrôle des chiffres avant envoi', '14:00', '16:30'),
  e('2026-07-10', 'suivi', 'Point Partenaire', 'Refonte des tâches, indicateur SRI', '11:00', '12:10'),
  e('2026-07-15', 'gouvernance', 'Recherche d\'idées', 'Veille fiscale', '', '', 45),
  e('2026-07-22', 'integration', 'Préparation de la version simple', 'Synchronisation des modules', '', '', 120),
  e('2026-08-03', 'projeta', 'Onglet Contrats : bulletin assureur', 'Correspondance des champs', '', '', 195),
  e('2026-08-05', 'rapports', 'Qualification de la base clients', 'Fichier de qualification', '', '', 100),
  e('2026-08-12', 'suivi', 'Compte rendu d\'avancement Projet B', '', '', '', 55),
  e('2026-08-19', 'projeta', 'Réglages SMTP natifs', 'Formulaire et restauration', '09:15', '11:25'),
  e('2026-08-26', 'gouvernance', 'Note : alertes proactives', 'Intérêt, effort, prérequis', '', '', 50),
  e('2026-08-28', 'annexe', 'Extraction de fichiers pour une campagne produit', 'Sur instruction écrite du 27/08', '', '', 60),
  e('2026-09-01', 'projeta', 'Audit et corrections', 'Fiches de suivi remises en phase', '09:30', '11:45'),
  e('2026-09-01', 'rapports', 'Préparation de la campagne T3', 'Calendrier et relevés à demander', '14:00', '15:20'),
];

const factures = [];
const r7 = c.releveDuMois(entrees, '2026-07', reglages, 0);
const f1 = c.construireFacture(r7, reglages, { dateEmission: '2026-07-31', factures, travaux: [{ titre: 'Version simple de Projet A livrée à Partenaire', axe: 'integration' }] });
f1.statut = 'payee'; f1.datePaiement = '2026-08-20'; f1.modePaiement = 'virement';
factures.push(f1);
const r8 = c.releveDuMois(entrees, '2026-08', reglages, 18.4);
const f2 = c.construireFacture(r8, reglages, { dateEmission: '2026-08-31', factures, travaux: [{ titre: 'Onglet Contrats : bulletin Signature Premium (assureur)', axe: 'projeta' }] });
factures.push(f2);

const chrono = { schemaVersion: 1, enCours: { debut: new Date(Date.now() - 25 * 60000).toISOString(), axe: 'projeta', intervention: 'Audit et corrections', detail: 'Suite du matin', tache: null } };

fs.writeFileSync(path.join(dossier, 'reglages.json'), JSON.stringify(reglages, null, 2));
fs.writeFileSync(path.join(dossier, 'journal.json'), JSON.stringify({ schemaVersion: 1, entrees }, null, 2));
fs.writeFileSync(path.join(dossier, 'factures.json'), JSON.stringify({ schemaVersion: 1, factures }, null, 2));
fs.writeFileSync(path.join(dossier, 'chrono.json'), JSON.stringify(chrono, null, 2));
console.log('jeu de démonstration écrit dans ' + dossier + ' : ' + entrees.length + ' lignes, ' + factures.length + ' factures');
