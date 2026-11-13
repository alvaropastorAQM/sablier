/* Tests de l'écriture des données, sur un dossier jetable : node tests/test-donnees.js */
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
  d.surErreur = (fichier, message) => d.alertes.push(fichier + ' : ' + message);
  return d;
}
/* Le disque refuse les renommages jusqu'à l'appel de la fonction rendue. */
function disquePlein() {
  const vrai = fs.renameSync;
  fs.renameSync = () => { const e = new Error('ENOSPC: plus de place'); e.code = 'ENOSPC'; throw e; };
  return () => { fs.renameSync = vrai; };
}

const tests = [
  ['l\'écriture passe sur le disque avant le renommage, sans laisser de fichier temporaire', () => {
    const d = nouvelles('ordre');
    const appels = [];
    const vraiFsync = fs.fsyncSync, vraiRename = fs.renameSync;
    fs.fsyncSync = (fd) => { appels.push('fsync'); return vraiFsync(fd); };
    fs.renameSync = (a, b) => { appels.push('renommage'); return vraiRename(a, b); };
    try { d.ecrire('journal', { entrees: [1] }); d.ecrireMaintenant('journal'); }
    finally { fs.fsyncSync = vraiFsync; fs.renameSync = vraiRename; }
    assert.deepStrictEqual(appels, ['fsync', 'renommage']);
    assert.deepStrictEqual(relire(d, 'journal'), { entrees: [1] });
    assert.ok(!fs.existsSync(d.chemin('journal') + '.tmp'));
    assert.deepStrictEqual(Object.keys(d.minuteries), []);
  }],

  ['une écriture refusée est retentée jusqu\'à passer, avec le dernier contenu', async () => {
    const d = nouvelles('retente');
    d.retenteMs = 20;
    d.ecrire('factures', { factures: ['2031-01'] });
    d.ecrireMaintenant('factures');
    const retablir = disquePlein();
    try {
      d.ecrire('factures', { factures: ['2031-01', '2031-02'] });
      d.ecrireMaintenant('factures');
      assert.deepStrictEqual(relire(d, 'factures').factures, ['2031-01']);
      assert.ok(d.minuteries.factures, 'une nouvelle tentative est prévue');
      await pause(60);
      assert.deepStrictEqual(relire(d, 'factures').factures, ['2031-01'], 'toujours refusée');
      d.ecrire('factures', { factures: ['2031-01', '2031-02', '2031-03'] });
      await pause(350);
    } finally { retablir(); }
    await pause(60);
    assert.deepStrictEqual(relire(d, 'factures').factures, ['2031-01', '2031-02', '2031-03']);
    assert.deepStrictEqual(Object.keys(d.minuteries), []);
  }],

  ['la nouvelle tentative attend 30 secondes par défaut', () => {
    assert.strictEqual(nouvelles('delai').retenteMs, 30000);
  }],

  ['l\'alerte ne se répète pas à chaque tentative, mais revient après 5 minutes', () => {
    const d = nouvelles('alerte');
    d.retenteMs = 60000;
    const retablir = disquePlein();
    try {
      d.ecrire('journal', { a: 1 }); d.ecrireMaintenant('journal');
      d.ecrire('notes', { a: 1 }); d.ecrireMaintenant('notes');
      assert.strictEqual(d.alertes.length, 1);
      assert.ok(/^journal : ENOSPC/.test(d.alertes[0]));
      d.derniereAlerte -= 5 * 60000;
      d.ecrireMaintenant('journal');
      assert.strictEqual(d.alertes.length, 2);
    } finally { retablir(); d.purger(); }
    assert.deepStrictEqual(Object.keys(d.minuteries), []);
  }],

  ['une relecture pendant la panne rend la mémoire, pas l\'ancien disque', () => {
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

  ['après une panne, purger écrit ce qui restait en attente', () => {
    const d = nouvelles('purge');
    d.retenteMs = 60000;
    const retablir = disquePlein();
    d.ecrire('chrono', { enCours: null });
    d.purger();
    assert.deepStrictEqual(Object.keys(d.minuteries), ['chrono'], 'après la purge, seul ce qui est refusé reste en attente');
    retablir();
    d.purger();
    assert.deepStrictEqual(relire(d, 'chrono'), { enCours: null });
    assert.deepStrictEqual(Object.keys(d.minuteries), []);
  }],

  ['la copie du jour : une seule par jour, une de plus si forcée, 30 gardées', () => {
    const d = nouvelles('copies');
    const copies = () => fs.readdirSync(path.join(d.dossier, 'Sauvegardes')).sort();
    d.sauvegardeQuotidienne();
    assert.deepStrictEqual(copies(), [], 'rien à copier tant qu\'aucun fichier n\'existe');
    d.ecrire('journal', { n: 1 }); d.ecrireMaintenant('journal');
    d.sauvegardeQuotidienne();
    assert.strictEqual(copies().length, 1);
    d.ecrire('journal', { n: 2 }); d.ecrireMaintenant('journal');
    d.sauvegardeQuotidienne();
    assert.strictEqual(copies().length, 1, 'l\'appel de chaque heure ne refait pas la copie du jour');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(d.dossier, 'Sauvegardes', copies()[0], 'journal.json'), 'utf8')), { n: 1 });
    d.sauvegardeQuotidienne(true);
    assert.strictEqual(copies().length, 2);
    for (let i = 10; i < 50; i++) fs.mkdirSync(path.join(d.dossier, 'Sauvegardes', '2020-01-' + i));
    d.sauvegardeQuotidienne(true);
    assert.strictEqual(copies().length, 30);
  }],

  ['un changement de jour déclenche une nouvelle copie sans relancer l\'application', () => {
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

  ['factures.json absent alors que le reste existe : signalé, pas au premier lancement', () => {
    const d = nouvelles('absent');
    d.lireTout();
    assert.deepStrictEqual(d.absents, [], 'premier lancement : aucun fichier, aucune alerte');
    FICHIERS.forEach(nom => { d.ecrire(nom, { schemaVersion: 1 }); });
    d.purger();
    d.lireTout();
    assert.deepStrictEqual(d.absents, []);
    fs.unlinkSync(d.chemin('factures'));
    d.lireTout();
    assert.deepStrictEqual(d.absents, ['factures']);
    assert.deepStrictEqual(d.illisibles, []);
  }],

  ['factures.json abîmé reste signalé comme illisible, pas comme absent', () => {
    const d = nouvelles('abime');
    d.ecrire('journal', { n: 1 }); d.ecrireMaintenant('journal');
    fs.writeFileSync(d.chemin('factures'), '{ abîmé', 'utf8');
    d.lireTout();
    assert.strictEqual(d.illisibles[0].nom, 'factures');
    assert.deepStrictEqual(d.absents, []);
  }],

  ['un PDF existant n\'est jamais écrasé : le suivant prend le premier nom libre', () => {
    const dossier = path.join(racine, 'pdf');
    fs.mkdirSync(dossier);
    const cible = path.join(dossier, 'Facture-2031-01.pdf');
    assert.strictEqual(cheminLibre(cible), cible);
    fs.writeFileSync(cible, 'signée');
    assert.strictEqual(cheminLibre(cible), path.join(dossier, 'Facture-2031-01 (2).pdf'));
    fs.writeFileSync(path.join(dossier, 'Facture-2031-01 (2).pdf'), 'copie');
    assert.strictEqual(cheminLibre(cible), path.join(dossier, 'Facture-2031-01 (3).pdf'));
    assert.strictEqual(fs.readFileSync(cible, 'utf8'), 'signée');
  }],
];

console.error = () => {};
(async () => {
  console.log('Écriture des données');
  try {
    for (const [nom, fn] of tests) { await fn(); n++; console.log('  ✓ ' + nom); }
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
  console.log('\n' + n + ' tests verts.');
  process.exit(0);
})().catch(e => { process.stdout.write(String(e && e.stack || e) + '\n'); process.exit(1); });
