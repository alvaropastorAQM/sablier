/* Demo data set for visual checks.
   Usage: node outils/jeu-demo.js <data-folder>
   then: SABLIER_DONNEES=<folder> npm start   (or npm run smoke)
   The application's real data folder is never touched. */
'use strict';
const fs = require('fs');
const path = require('path');
const c = require('../js/calculs.js');

const dossier = process.argv[2];
if (!dossier) { console.error('data folder expected as argument'); process.exit(1); }
fs.mkdirSync(dossier, { recursive: true });

const reglages = {
  tarifHoraire: 42.86, arrondi: 0.25, heuresJournee: 7, repereAnnuel: 192, delaiPaiement: 30,
  contrat: { debut: '2026-07-01', fin: '2027-06-30' },
  prestataire: {
    nom: 'Ana García López', nif: '12345678Z', adresse: 'Calle Mayor 1, 3º B, 28013 Madrid', email: 'ana@example.org', telephone: '612345678',
    titulaireCompte: 'Ana García López', banque: 'Banco de Pruebas', iban: 'ES9121000418450200051332', bic: 'CAIXESBBXXX',
  },
  client: { societe: 'Cliente de Pruebas SL', contact: 'Luis Pérez', adresse: 'Avenida de la Prueba 5, 08001 Barcelona', nif: 'B12345678', email: '' },
  impots: { tauxTva: 21, tauxIrpf: 15, cotisationMensuelle: 80, debutActivite: '2026-07-01' },
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
  e('2026-07-06', 'projeta', 'Project A stabilisation', 'Bug fixes', '09:00', '10:30'),
  e('2026-07-06', 'projeta', 'Project A stabilisation', 'Tests', '10:30', '11:05'),
  e('2026-07-08', 'rapports', 'Q2 reporting campaign', 'Checking the figures before sending', '14:00', '16:30'),
  e('2026-07-10', 'suivi', 'Partner meeting', 'Task overhaul, SRI indicator', '11:00', '12:10'),
  e('2026-07-15', 'gouvernance', 'Idea research', 'Tax watch', '', '', 45),
  e('2026-07-22', 'integration', 'Simple version preparation', 'Module synchronisation', '', '', 120),
  e('2026-08-03', 'projeta', 'Contracts tab: insurer slip', 'Field mapping', '', '', 195),
  e('2026-08-05', 'rapports', 'Client database qualification', 'Qualification file', '', '', 100),
  e('2026-08-12', 'suivi', 'Project B progress report', '', '', '', 55),
  e('2026-08-19', 'projeta', 'Native SMTP settings', 'Form and restore', '09:15', '11:25'),
  e('2026-08-26', 'gouvernance', 'Note: proactive alerts', 'Interest, effort, prerequisites', '', '', 50),
  e('2026-08-28', 'annexe', 'File extraction for a product campaign', 'On written instruction of 27 Aug', '', '', 60),
  e('2026-09-01', 'projeta', 'Audit and fixes', 'Tracking sheets brought back in line', '09:30', '11:45'),
  e('2026-09-01', 'rapports', 'Q3 campaign preparation', 'Schedule and statements to request', '14:00', '15:20'),
];

const factures = [];
const r7 = c.releveDuMois(entrees, '2026-07', reglages, 0);
const f1 = c.construireFacture(r7, reglages, { dateEmission: '2026-07-31', factures, travaux: [{ titre: 'Simple version of Project A delivered to Partner', axe: 'integration' }] });
f1.statut = 'payee'; f1.datePaiement = '2026-08-20'; f1.modePaiement = 'virement';
factures.push(f1);
const r8 = c.releveDuMois(entrees, '2026-08', reglages, 18.4);
const f2 = c.construireFacture(r8, reglages, { dateEmission: '2026-08-31', factures, travaux: [{ titre: 'Contracts tab: Signature Premium slip (insurer)', axe: 'projeta' }] });
factures.push(f2);

const chrono = { schemaVersion: 1, enCours: { debut: new Date(Date.now() - 25 * 60000).toISOString(), axe: 'projeta', intervention: 'Audit and fixes', detail: 'Continuing from this morning', tache: null } };

fs.writeFileSync(path.join(dossier, 'reglages.json'), JSON.stringify(reglages, null, 2));
fs.writeFileSync(path.join(dossier, 'journal.json'), JSON.stringify({ schemaVersion: 1, entrees }, null, 2));
fs.writeFileSync(path.join(dossier, 'factures.json'), JSON.stringify({ schemaVersion: 1, factures }, null, 2));
fs.writeFileSync(path.join(dossier, 'chrono.json'), JSON.stringify(chrono, null, 2));
console.log('demo data set written to ' + dossier + ': ' + entrees.length + ' entries, ' + factures.length + ' invoices');
