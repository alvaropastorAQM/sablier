/* Tests of data writing, on a throwaway folder: node tests/test-donnees.js */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Donnees, FICHIERS } = require('../app/donnees.js');
const { cheminLibre } = require('../app/pdf.js');

let n = 0;
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'sablier-test-donnees-'));
const pause = (ms) => new Promise(r => setTimeout(r, ms));
const relire = (d, nom) => JSON.parse(fs.readFileSync(d.chemin(nom), 'utf8'));

function nouvelles(nom) {
  const d = new Donnees(path.join(racine, nom));
  d.alertes = [];
  d.surErreur = (fichier, message) => d.alertes.push(fichier + ': ' + message);
  return d;
}
/* The disk refuses renames until the returned function is called. */
function disquePlein() {
  const vrai = fs.renameSync;
  fs.renameSync = () => { const e = new Error('ENOSPC: no space left'); e.code = 'ENOSPC'; throw e; };
  return () => { fs.renameSync = vrai; };
}

const tests = [
  ['the write reaches the disk before the rename, leaving no temporary file', () => {
    const d = nouvelles('ordre');
    const appels = [];
    const vraiFsync = fs.fsyncSync, vraiRename = fs.renameSync;
    fs.fsyncSync = (fd) => { appels.push('fsync'); return vraiFsync(fd); };
    fs.renameSync = (a, b) => { appels.push('rename'); return vraiRename(a, b); };
    try { d.ecrire('journal', { entrees: [1] }); d.ecrireMaintenant('journal'); }
    finally { fs.fsyncSync = vraiFsync; fs.renameSync = vraiRename; }
    assert.deepStrictEqual(appels, ['fsync', 'rename']);
    assert.deepStrictEqual(relire(d, 'journal'), { entrees: [1] });
    assert.ok(!fs.existsSync(d.chemin('journal') + '.tmp'));
    assert.deepStrictEqual(Object.keys(d.minuteries), []);
  }],

  ['a refused write is retried until it goes through, with the latest content', async () => {
    const d = nouvelles('retente');
    d.retenteMs = 20;
    d.ecrire('factures', { factures: ['2031-01'] });
    d.ecrireMaintenant('factures');
    const retablir = disquePlein();
    try {
      d.ecrire('factures', { factures: ['2031-01', '2031-02'] });
      d.ecrireMaintenant('factures');
      assert.deepStrictEqual(relire(d, 'factures').factures, ['2031-01']);
      assert.ok(d.minuteries.factures, 'a new attempt is scheduled');
      await pause(60);
      assert.deepStrictEqual(relire(d, 'factures').factures, ['2031-01'], 'still refused');
      d.ecrire('factures', { factures: ['2031-01', '2031-02', '2031-03'] });
      await pause(350);
    } finally { retablir(); }
    await pause(60);
    assert.deepStrictEqual(relire(d, 'factures').factures, ['2031-01', '2031-02', '2031-03']);
    assert.deepStrictEqual(Object.keys(d.minuteries), []);
  }],

  ['the retry waits 30 seconds by default', () => {
    assert.strictEqual(nouvelles('delai').retenteMs, 30000);
  }],

  ['the alert does not repeat on every attempt, but comes back after 5 minutes', () => {
    const d = nouvelles('alerte');
    d.retenteMs = 60000;
    const retablir = disquePlein();
    try {
      d.ecrire('journal', { a: 1 }); d.ecrireMaintenant('journal');
      d.ecrire('notes', { a: 1 }); d.ecrireMaintenant('notes');
      assert.strictEqual(d.alertes.length, 1);
      assert.ok(/^journal: ENOSPC/.test(d.alertes[0]));
      d.derniereAlerte -= 5 * 60000;
      d.ecrireMaintenant('journal');
      assert.strictEqual(d.alertes.length, 2);
    } finally { retablir(); d.purger(); }
    assert.deepStrictEqual(Object.keys(d.minuteries), []);
  }],

  ['a re-read during the outage returns memory, not the old disk content', () => {
    const d = nouvelles('relecture');
    d.retenteMs = 60000;
    d.ecrire('factures', { factures: ['2031-01'] }); d.ecrireMaintenant('factures');
    d.ecrire('journal', { entrees: [] }); d.ecrireMaintenant('journal');
    const retablir = disquePlein();
    try {
      d.ecrire('factures', { factures: ['2031-01', '2031-02'] });
      const relu = d.lireTout();
      assert.deepStrictEqual(relu.factures.factures, ['2031-01', '2031-02']);
      assert.deepStrictEqual(d.cache.factures.factures, ['2031-01', '2031-02']);
      assert.deepStrictEqual(d.absents, []);
    } finally { retablir(); d.purger(); }
    assert.deepStrictEqual(relire(d, 'factures').factures, ['2031-01', '2031-02']);
  }],

  ['after an outage, purging writes what was still pending', () => {
    const d = nouvelles('purge');
    d.retenteMs = 60000;
    const retablir = disquePlein();
    d.ecrire('chrono', { enCours: null });
    d.purger();
    assert.deepStrictEqual(Object.keys(d.minuteries), ['chrono'], 'after the purge, only what is refused stays pending');
    retablir();
    d.purger();
    assert.deepStrictEqual(relire(d, 'chrono'), { enCours: null });
    assert.deepStrictEqual(Object.keys(d.minuteries), []);
  }],

  ['the daily copy: only one per day, one more if forced, 30 kept', () => {
    const d = nouvelles('copies');
    const copies = () => fs.readdirSync(path.join(d.dossier, 'Sauvegardes')).sort();
    d.sauvegardeQuotidienne();
    assert.deepStrictEqual(copies(), [], 'nothing to copy while no file exists');
    d.ecrire('journal', { n: 1 }); d.ecrireMaintenant('journal');
    d.sauvegardeQuotidienne();
    assert.strictEqual(copies().length, 1);
    d.ecrire('journal', { n: 2 }); d.ecrireMaintenant('journal');
    d.sauvegardeQuotidienne();
    assert.strictEqual(copies().length, 1, 'the hourly call does not redo the day\'s copy');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(d.dossier, 'Sauvegardes', copies()[0], 'journal.json'), 'utf8')), { n: 1 });
    d.sauvegardeQuotidienne(true);
    assert.strictEqual(copies().length, 2);
    for (let i = 10; i < 50; i++) fs.mkdirSync(path.join(d.dossier, 'Sauvegardes', '2020-01-' + i));
    d.sauvegardeQuotidienne(true);
    assert.strictEqual(copies().length, 30);
  }],

  ['a change of day triggers a new copy without restarting the app', () => {
    const d = nouvelles('jour');
    d.ecrire('journal', { n: 1 }); d.ecrireMaintenant('journal');
    const VraieDate = Date;
    const fixer = (iso) => { global.Date = class extends VraieDate { constructor(...a) { super(...(a.length ? a : [iso])); } static now() { return new VraieDate(iso).getTime(); } }; };
    try {
      fixer('2031-03-05T10:00:00');
      d.sauvegardeQuotidienne();
      d.sauvegardeQuotidienne();
      fixer('2031-03-06T00:30:00');
      d.sauvegardeQuotidienne();
    } finally { global.Date = VraieDate; }
    assert.deepStrictEqual(fs.readdirSync(path.join(d.dossier, 'Sauvegardes')).sort(), ['2031-03-05', '2031-03-06']);
  }],

  ['factures.json missing while the rest exists: reported, but not on first launch', () => {
    const d = nouvelles('absent');
    d.lireTout();
    assert.deepStrictEqual(d.absents, [], 'first launch: no file, no alert');
    FICHIERS.forEach(nom => { d.ecrire(nom, { schemaVersion: 1 }); });
    d.purger();
    d.lireTout();
    assert.deepStrictEqual(d.absents, []);
    fs.unlinkSync(d.chemin('factures'));
    d.lireTout();
    assert.deepStrictEqual(d.absents, ['factures']);
    assert.deepStrictEqual(d.illisibles, []);
  }],

  ['a corrupted factures.json is still reported as unreadable, not as missing', () => {
    const d = nouvelles('abime');
    d.ecrire('journal', { n: 1 }); d.ecrireMaintenant('journal');
    fs.writeFileSync(d.chemin('factures'), '{ corrupted', 'utf8');
    d.lireTout();
    assert.strictEqual(d.illisibles[0].nom, 'factures');
    assert.deepStrictEqual(d.absents, []);
  }],

  ['an existing PDF is never overwritten: the next one takes the first free name', () => {
    const dossier = path.join(racine, 'pdf');
    fs.mkdirSync(dossier);
    const cible = path.join(dossier, 'Facture-2031-01.pdf');
    assert.strictEqual(cheminLibre(cible), cible);
    fs.writeFileSync(cible, 'signed');
    assert.strictEqual(cheminLibre(cible), path.join(dossier, 'Facture-2031-01 (2).pdf'));
    fs.writeFileSync(path.join(dossier, 'Facture-2031-01 (2).pdf'), 'copy');
    assert.strictEqual(cheminLibre(cible), path.join(dossier, 'Facture-2031-01 (3).pdf'));
    assert.strictEqual(fs.readFileSync(cible, 'utf8'), 'signed');
  }],
];

console.error = () => {};
(async () => {
  console.log('Data writing');
  try {
    for (const [nom, fn] of tests) { await fn(); n++; console.log('  ✓ ' + nom); }
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
  console.log('\n' + n + ' tests passed.');
  process.exit(0);
})().catch(e => { process.stdout.write(String(e && e.stack || e) + '\n'); process.exit(1); });
