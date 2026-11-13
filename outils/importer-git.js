/* Rebuilds work sessions from the git history of a repository
   and adds them to the Sablier log.

   Usage:
     node outils/importer-git.js <repository folder> [options]
   Options:
     --axe <id>            area of the entries created (default: projeta)
     --ecart <hours>       two commits more than N hours apart start
                           a new session (default: 3)
     --amorce <minutes>    work counted before the first commit of a
                           session (default: 60)
     --minimum <minutes>   minimum duration of a session (default: 60)
     --coefficient <x>     multiplies the retained duration (e.g. 0.6:
                           assisted, faster work); start and end are then omitted
     --libelles <json>     file {"YYYY-MM-DD": "label"} to name the
                           work items day by day
     --appliquer           writes to the log (otherwise: preview only)
     --donnees <folder>    Sablier data folder (default: the application's
                           own, ~/.config/Sablier/Donnees)

   Method: all commits (merges included) are sorted by author date; a
   session runs from the first to the last commit, plus the lead-in. The
   entries created carry source = "git:<repository>" and are replaced at
   each new import (never duplicated). The application must be closed
   during the import.
   ============================================================ */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
if (!args.length) { console.error('repository folder expected'); process.exit(1); }
const depot = path.resolve(args[0]);
function option(nom, defaut) { const i = args.indexOf(nom); return i >= 0 && args[i + 1] ? args[i + 1] : defaut; }
const AXE = option('--axe', 'projeta');
const ECART_MS = Number(option('--ecart', '3')) * 3600000;
const AMORCE_MIN = Number(option('--amorce', '60'));
const MINIMUM_MIN = Number(option('--minimum', '60'));
const COEFFICIENT = Number(option('--coefficient', '1')) || 1;
const APPLIQUER = args.indexOf('--appliquer') >= 0;
const LIBELLES = option('--libelles', '') ? JSON.parse(fs.readFileSync(option('--libelles', ''), 'utf8')) : {};
const DONNEES = option('--donnees', path.join(os.homedir(), '.config', 'Sablier', 'Donnees'));

/* The repository: its "origin" remote gives the name (otherwise the folder name). */
function git(argsGit, message) {
  try { return execFileSync('git', ['-C', depot].concat(argsGit), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { console.error(message + ': ' + String(e.stderr || e.message).trim().split('\n')[0]); process.exit(1); }
}
let remote = '';
try { remote = execFileSync('git', ['-C', depot, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { remote = ''; }
const nomDepot = remote ? remote.replace(/\.git$/, '').split('/').slice(-2).join('/') : path.basename(path.resolve(depot));
const brut = git(['log', '--all', '--format=%at|%h|%P|%s'], 'Cannot read the git history of ' + depot);
if (!brut.trim()) { console.error('No commits in ' + depot); process.exit(1); }
const commits = brut.trim().split('\n').map(l => {
  const [ts, h, parents, ...reste] = l.split('|');
  return { t: Number(ts) * 1000, h, fusion: String(parents || '').trim().split(' ').filter(Boolean).length > 1, sujet: reste.join('|') };
}).sort((a, b) => a.t - b.t);

function deuxChiffres(n) { return (n < 10 ? '0' : '') + n; }
function isoLocal(d) { return d.getFullYear() + '-' + deuxChiffres(d.getMonth() + 1) + '-' + deuxChiffres(d.getDate()); }
function hm(d) { return deuxChiffres(d.getHours()) + ':' + deuxChiffres(d.getMinutes()); }
function fmt(min) { const h = Math.floor(min / 60), m = min % 60; return h + ' h' + (m ? ' ' + deuxChiffres(m) : ''); }

/* Grouping into sessions */
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

/* Labels: the file provided, otherwise the first subject of the day */
function libelleSession(s) {
  if (LIBELLES[s.date]) return LIBELLES[s.date];
  return s.sujets[0] ? s.sujets[0].replace(/\s*[:：].*$/, '') : 'Development';
}
function detailSession(s) {
  const pr = s.pr.length ? (s.pr.length > 1 ? 'PR #' + Math.min(...s.pr) + ' to #' + Math.max(...s.pr) : 'PR #' + s.pr[0]) : s.commits.length + ' commit' + (s.commits.length > 1 ? 's' : '');
  return pr + ', ' + s.commits.length + ' commit' + (s.commits.length > 1 ? 's' : '') + ' on GitHub' + (COEFFICIENT !== 1 ? ', ' + fmt(s.minutesSession) + ' session × ' + String(COEFFICIENT) : '');
}

/* Preview */
let total = 0;
const parMois = {};
console.log('Repository ' + nomDepot + ': ' + commits.length + ' commits, ' + sessions.length + ' sessions (gap ' + (ECART_MS / 3600000) + ' h, lead-in ' + AMORCE_MIN + ' min, minimum ' + MINIMUM_MIN + ' min' + (COEFFICIENT !== 1 ? ', coefficient ' + COEFFICIENT : '') + ')\n');
sessions.forEach(s => {
  total += s.minutes;
  const mois = s.date.slice(0, 7);
  parMois[mois] = (parMois[mois] || 0) + s.minutes;
  console.log(s.date + '  ' + hm(new Date(s.debutTravail)) + ' to ' + hm(new Date(s.fin)) + '  ' + fmt(s.minutes).padStart(8) + '  ' + libelleSession(s) + '  [' + detailSession(s) + ']');
});
console.log('\nPer month:');
Object.keys(parMois).sort().forEach(m => console.log('  ' + m + '  ' + fmt(parMois[m])));
console.log('Total: ' + fmt(total) + ' (' + (total / 60).toFixed(2) + ' h)');

if (!APPLIQUER) { console.log('\nPreview only: add --appliquer to write to ' + DONNEES); process.exit(0); }

/* Writing to the log */
const cheminJournal = path.join(DONNEES, 'journal.json');
let journal = { schemaVersion: 1, entrees: [] };
try { journal = JSON.parse(fs.readFileSync(cheminJournal, 'utf8')); } catch (e) {}
if (!Array.isArray(journal.entrees)) journal.entrees = [];
const source = 'git:' + nomDepot;
const avant = journal.entrees.length;

/* An entry carried by an invoice is not rewritten: the import recreates the
   entries of the source, which would change a service already invoiced. */
let facturees = [];
try {
  const lesFactures = JSON.parse(fs.readFileSync(path.join(DONNEES, 'factures.json'), 'utf8')).factures || [];
  const ids = new Set();
  lesFactures.forEach(f => (f.entreesIds || []).forEach(id => ids.add(id)));
  const moisFactures = new Set(lesFactures.filter(f => !Array.isArray(f.entreesIds) && f.mois).map(f => f.mois));
  facturees = journal.entrees.filter(e => e.source === source && (ids.has(e.id) || moisFactures.has(String(e.date).slice(0, 7))));
} catch (e) {}
if (facturees.length) {
  console.error('\nImport aborted: ' + facturees.length + ' entry(ies) from ' + source + ' are carried by an issued invoice.');
  console.error('Recreating them would change a service already invoiced. Delete the invoice concerned, or import into another data folder (SABLIER_DONNEES).');
  process.exit(1);
}

/* Annotations set by hand (non-billable and its reason, flat fee, billing
   month) survive a re-import: without this, hours deliberately given for
   free would become billable again. They are attached to the WORK (day and
   label), not to the session number, which shifts as soon as a commit
   changes the grouping. */
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
if (reprises.size) console.log('Annotations kept (billing, reason, flat fee, billing month) on ' + reprises.size + ' work items.');
if (orphelines.length) {
  console.error('\nWARNING: ' + orphelines.length + ' annotation(s) did not find their work item again (label or date changed by the new import).');
  orphelines.forEach(cle => console.error('  ' + cle.replace('|', '  ')));
  console.error('These entries are billable again: check them in the log.');
}
journal.entrees.sort((a, b) => (a.date + (a.debut || '')) < (b.date + (b.debut || '')) ? -1 : 1);
const sauvegarde = cheminJournal + '.avant-import-' + Date.now();
if (fs.existsSync(cheminJournal)) fs.copyFileSync(cheminJournal, sauvegarde);
fs.writeFileSync(cheminJournal + '.tmp', JSON.stringify(journal, null, 2) + '\n');
fs.renameSync(cheminJournal + '.tmp', cheminJournal);
console.log('\nLog updated: ' + (journal.entrees.length - (avant - (avant - journal.entrees.filter(e => e.source !== source).length))) + ' entries from ' + source + ' (' + journal.entrees.length + ' entries in total). Safety copy: ' + path.basename(sauvegarde));
