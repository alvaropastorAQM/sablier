/* Reconstitue des sessions de travail à partir de l'historique git d'un dépôt
   et les verse dans le journal de Sablier.

   Usage :
     node outils/importer-git.js <dossier du dépôt> [options]
   Options :
     --axe <id>            axe des lignes créées (défaut : projeta)
     --ecart <heures>      deux commits séparés de plus de N heures ouvrent
                           une nouvelle session (défaut : 3)
     --amorce <minutes>    travail compté avant le premier commit d'une
                           session (défaut : 60)
     --minimum <minutes>   durée minimale d'une session (défaut : 60)
     --coefficient <x>     multiplie la durée retenue (ex. 0.6 : travail
                           assisté, plus rapide) ; début et fin sont alors omis
     --libelles <json>     fichier {"AAAA-MM-JJ": "libellé"} pour nommer les
                           interventions jour par jour
     --appliquer           écrit dans le journal (sinon : aperçu seulement)
     --donnees <dossier>   dossier de données de Sablier (défaut : celui de
                           l'application, ~/Library/Application Support/Sablier/Donnees)

   Méthode : tous les commits (fusions comprises) sont triés par date
   d'auteur ; une session s'étend du premier au dernier commit, plus
   l'amorce. Les lignes créées portent source = "git:<dépôt>" et sont
   remplacées à chaque nouvel import (jamais dupliquées). L'application
   doit être fermée pendant l'import.
   ============================================================ */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
if (!args.length) { console.error('dossier du dépôt attendu'); process.exit(1); }
const depot = path.resolve(args[0]);
function option(nom, defaut) { const i = args.indexOf(nom); return i >= 0 && args[i + 1] ? args[i + 1] : defaut; }
const AXE = option('--axe', 'projeta');
const ECART_MS = Number(option('--ecart', '3')) * 3600000;
const AMORCE_MIN = Number(option('--amorce', '60'));
const MINIMUM_MIN = Number(option('--minimum', '60'));
const COEFFICIENT = Number(option('--coefficient', '1')) || 1;
const APPLIQUER = args.indexOf('--appliquer') >= 0;
const LIBELLES = option('--libelles', '') ? JSON.parse(fs.readFileSync(option('--libelles', ''), 'utf8')) : {};
const DONNEES = option('--donnees', path.join(os.homedir(), 'Library', 'Application Support', 'Sablier', 'Donnees'));

/* Le dépôt : son remote « origin » donne le nom (sinon le nom du dossier). */
function git(argsGit, message) {
  try { return execFileSync('git', ['-C', depot].concat(argsGit), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { console.error(message + ' : ' + String(e.stderr || e.message).trim().split('\n')[0]); process.exit(1); }
}
let remote = '';
try { remote = execFileSync('git', ['-C', depot, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { remote = ''; }
const nomDepot = remote ? remote.replace(/\.git$/, '').split('/').slice(-2).join('/') : path.basename(path.resolve(depot));
const brut = git(['log', '--all', '--format=%at|%h|%P|%s'], 'Impossible de lire l\'historique git de ' + depot);
if (!brut.trim()) { console.error('Aucun commit dans ' + depot); process.exit(1); }
const commits = brut.trim().split('\n').map(l => {
  const [ts, h, parents, ...reste] = l.split('|');
  return { t: Number(ts) * 1000, h, fusion: String(parents || '').trim().split(' ').filter(Boolean).length > 1, sujet: reste.join('|') };
}).sort((a, b) => a.t - b.t);

function deuxChiffres(n) { return (n < 10 ? '0' : '') + n; }
function isoLocal(d) { return d.getFullYear() + '-' + deuxChiffres(d.getMonth() + 1) + '-' + deuxChiffres(d.getDate()); }
function hm(d) { return deuxChiffres(d.getHours()) + ':' + deuxChiffres(d.getMinutes()); }
function fmt(min) { const h = Math.floor(min / 60), m = min % 60; return h + ' h' + (m ? ' ' + deuxChiffres(m) : ''); }

/* Regroupement en sessions */
const sessions = [];
let courante = null;
commits.forEach(c => {
  if (!courante || c.t - courante.fin > ECART_MS) { courante = { debut: c.t, fin: c.t, commits: [] }; sessions.push(courante); }
  courante.fin = c.t;
  courante.commits.push(c);
});
sessions.forEach(s => {
  s.debutTravail = s.debut - AMORCE_MIN * 60000;
  s.minutesSession = Math.max(MINIMUM_MIN, Math.round((s.fin - s.debutTravail) / 60000));
  s.minutes = Math.max(1, Math.round(s.minutesSession * COEFFICIENT));
  s.date = isoLocal(new Date(s.debutTravail));
  s.pr = s.commits.map(c => (c.sujet.match(/Merge pull request #(\d+)/) || [])[1]).filter(Boolean).map(Number);
  s.sujets = s.commits.filter(c => !c.fusion).map(c => c.sujet);
});

/* Libellés : fichier fourni, sinon le premier sujet du jour */
function libelleSession(s) {
  if (LIBELLES[s.date]) return LIBELLES[s.date];
  return s.sujets[0] ? s.sujets[0].replace(/\s*[:：].*$/, '') : 'Développement';
}
function detailSession(s) {
  const pr = s.pr.length ? (s.pr.length > 1 ? 'PR #' + Math.min(...s.pr) + ' à #' + Math.max(...s.pr) : 'PR #' + s.pr[0]) : s.commits.length + ' commit' + (s.commits.length > 1 ? 's' : '');
  return pr + ', ' + s.commits.length + ' commit' + (s.commits.length > 1 ? 's' : '') + ' sur GitHub' + (COEFFICIENT !== 1 ? ', ' + fmt(s.minutesSession) + ' de session × ' + String(COEFFICIENT).replace('.', ',') : '');
}

/* Aperçu */
let total = 0;
const parMois = {};
console.log('Dépôt ' + nomDepot + ' : ' + commits.length + ' commits, ' + sessions.length + ' sessions (écart ' + (ECART_MS / 3600000) + ' h, amorce ' + AMORCE_MIN + ' min, minimum ' + MINIMUM_MIN + ' min' + (COEFFICIENT !== 1 ? ', coefficient ' + COEFFICIENT : '') + ')\n');
sessions.forEach(s => {
  total += s.minutes;
  const mois = s.date.slice(0, 7);
  parMois[mois] = (parMois[mois] || 0) + s.minutes;
  console.log(s.date + '  ' + hm(new Date(s.debutTravail)) + ' à ' + hm(new Date(s.fin)) + '  ' + fmt(s.minutes).padStart(8) + '  ' + libelleSession(s) + '  [' + detailSession(s) + ']');
});
console.log('\nPar mois :');
Object.keys(parMois).sort().forEach(m => console.log('  ' + m + '  ' + fmt(parMois[m])));
console.log('Total : ' + fmt(total) + ' (' + (total / 60).toFixed(2) + ' h)');

if (!APPLIQUER) { console.log('\nAperçu seulement : ajoutez --appliquer pour écrire dans ' + DONNEES); process.exit(0); }

/* Écriture dans le journal */
const cheminJournal = path.join(DONNEES, 'journal.json');
let journal = { schemaVersion: 1, entrees: [] };
try { journal = JSON.parse(fs.readFileSync(cheminJournal, 'utf8')); } catch (e) {}
if (!Array.isArray(journal.entrees)) journal.entrees = [];
const source = 'git:' + nomDepot;
const avant = journal.entrees.length;

/* Une ligne portée par une facture ne se réécrit pas : l'import recrée les
   lignes de la source, ce qui changerait une prestation déjà facturée. */
let facturees = [];
try {
  const lesFactures = JSON.parse(fs.readFileSync(path.join(DONNEES, 'factures.json'), 'utf8')).factures || [];
  const ids = new Set();
  lesFactures.forEach(f => (f.entreesIds || []).forEach(id => ids.add(id)));
  const moisFactures = new Set(lesFactures.filter(f => !Array.isArray(f.entreesIds) && f.mois).map(f => f.mois));
  facturees = journal.entrees.filter(e => e.source === source && (ids.has(e.id) || moisFactures.has(String(e.date).slice(0, 7))));
} catch (e) {}
if (facturees.length) {
  console.error('\nImport interrompu : ' + facturees.length + ' ligne(s) de ' + source + ' sont portées par une facture émise.');
  console.error('Les recréer changerait une prestation déjà facturée. Supprimez la facture concernée, ou importez dans un autre dossier de données (SABLIER_DONNEES).');
  process.exit(1);
}

/* Les annotations posées à la main (non facturable et son motif, forfait,
   mois de facturation) survivent au réimport : sans cela, des heures
   volontairement offertes redeviendraient facturables. Elles sont rattachées
   au TRAVAIL (jour et libellé), non au numéro de session, qui se décale dès
   qu'un commit change les regroupements. */
const cleTravail = (e) => String(e.date) + '|' + String(e.intervention || '').trim().toLowerCase();
const annotations = {};
journal.entrees.forEach((e) => {
  if (e.source !== source) return;
  if (e.facturable === false || e.motif || e.forfait != null || e.moisFacturation) {
    annotations[cleTravail(e)] = { facturable: e.facturable, motif: e.motif, forfait: e.forfait, moisFacturation: e.moisFacturation };
  }
});
journal.entrees = journal.entrees.filter(e => e.source !== source);
const maintenant = new Date().toISOString();
const reprises = new Set();
sessions.forEach((s, i) => {
  const d = new Date(s.debutTravail), f = new Date(s.fin);
  const base = {
    id: 'git_' + nomDepot.replace(/[^A-Za-z0-9]/g, '_') + '_' + i,
    date: s.date, axe: AXE, intervention: libelleSession(s), detail: detailSession(s),
    debut: COEFFICIENT === 1 ? hm(d) : '', fin: COEFFICIENT === 1 ? hm(f) : '', minutes: s.minutes, tache: null, source: source, pr: s.pr,
    creeLe: maintenant, modifieLe: maintenant,
  };
  const cle = cleTravail(base);
  if (annotations[cle]) reprises.add(cle);
  journal.entrees.push(Object.assign(base, annotations[cle] || {}));
});
const orphelines = Object.keys(annotations).filter(cle => !reprises.has(cle));
if (reprises.size) console.log('Annotations conservées (facturation, motif, forfait, mois de facturation) sur ' + reprises.size + ' travaux.');
if (orphelines.length) {
  console.error('\nATTENTION : ' + orphelines.length + ' annotation(s) n\'ont pas retrouvé leur travail (libellé ou date modifiés par le nouvel import).');
  orphelines.forEach(cle => console.error('  ' + cle.replace('|', '  ')));
  console.error('Ces lignes sont redevenues facturables : vérifiez-les dans le journal.');
}
journal.entrees.sort((a, b) => (a.date + (a.debut || '')) < (b.date + (b.debut || '')) ? -1 : 1);
const sauvegarde = cheminJournal + '.avant-import-' + Date.now();
if (fs.existsSync(cheminJournal)) fs.copyFileSync(cheminJournal, sauvegarde);
fs.writeFileSync(cheminJournal + '.tmp', JSON.stringify(journal, null, 2) + '\n');
fs.renameSync(cheminJournal + '.tmp', cheminJournal);
console.log('\nJournal mis à jour : ' + (journal.entrees.length - (avant - (avant - journal.entrees.filter(e => e.source !== source).length))) + ' lignes issues de ' + source + ' (' + journal.entrees.length + ' lignes au total). Copie de sûreté : ' + path.basename(sauvegarde));
