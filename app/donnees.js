/* ============================================================
   Sablier (desktop application): data in readable files.

   Folder: <app data folder>/Sablier/Donnees/ (on Linux, ~/.config/Sablier/Donnees/)
     reglages.json    rate, identities, areas, contributions, preferences
     journal.json     the time entries
     chantiers.json   ideas and work
     notes.json       pages and blocks
     factures.json    issued invoices and payments
     echeances.json   administrative calendar and reminders
     chrono.json      the running timer (survives closing)
     Sauvegardes/     one dated copy per day, the last 30

   Atomic writes (temporary file forced to disk, then rename), delayed by
   300 ms to group bursts; flushed on quit. A refused write is retried
   every 30 seconds.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const FICHIERS = ['reglages', 'journal', 'chantiers', 'notes', 'factures', 'echeances', 'chrono'];
const SAUVEGARDES_CONSERVEES = 30;
const RAPPEL_ALERTE_MS = 5 * 60000;
/* Created at first launch: their absence afterwards is never normal. */
const ESSENTIELS = ['journal', 'factures'];

class Donnees {
  constructor(dossier) {
    this.dossier = dossier;
    this.cache = {};
    this.minuteries = {};
    this.illisibles = [];          // files set aside at the last load
    this.absents = [];             // essential files missing at the last load
    this.surErreur = null;         // callback (name, message) when a write fails
    this.derniereAlerte = 0;
    this.retenteMs = 30000;
    fs.mkdirSync(dossier, { recursive: true });
    fs.mkdirSync(path.join(dossier, 'Sauvegardes'), { recursive: true });
  }

  chemin(nom) { return path.join(this.dossier, nom + '.json'); }

  /* Reads the seven files. Pending writes go to disk first, otherwise a
     re-read (window reload) would return the old content and then write it
     over the new one. */
  lireTout() {
    this.purger();
    const out = {};
    this.illisibles = [];
    FICHIERS.forEach(nom => {
      /* Write still refused: memory is more recent than the disk. */
      if (this.minuteries[nom]) { out[nom] = this.cache[nom]; return; }
      try {
        const brut = fs.readFileSync(this.chemin(nom), 'utf8');
        this.cache[nom] = JSON.parse(brut);
        out[nom] = this.cache[nom];
      } catch (e) {
        if (e.code !== 'ENOENT') {
          /* Damaged file: set it aside rather than overwrite it. */
          const copie = this.chemin(nom) + '.illisible-' + Date.now();
          try { fs.renameSync(this.chemin(nom), copie); } catch (e2) {}
          this.illisibles.push({ nom, copie, message: e.message });
          console.error('[donnees] ' + nom + '.json unreadable: ' + e.message);
        }
      }
    });
    this.absents = Object.keys(out).length ? ESSENTIELS.filter(nom => out[nom] === undefined && !this.illisibles.some(x => x.nom === nom)) : [];
    return out;
  }

  ecrire(nom, objet) {
    if (FICHIERS.indexOf(nom) < 0) return;
    if (!objet || typeof objet !== 'object' || Array.isArray(objet)) return;
    this.cache[nom] = objet;
    clearTimeout(this.minuteries[nom]);
    this.minuteries[nom] = setTimeout(() => this.ecrireMaintenant(nom), 300);
  }

  ecrireMaintenant(nom) {
    clearTimeout(this.minuteries[nom]);
    delete this.minuteries[nom];
    if (this.cache[nom] === undefined) return;
    const cible = this.chemin(nom);
    const tmp = cible + '.tmp';
    const contenu = JSON.stringify(this.cache[nom], null, 2) + '\n';
    /* fsync before the rename: a power cut cannot replace the good file
       with an empty or truncated one. */
    const tenter = () => {
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeFileSync(fd, contenu, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, cible);
    };
    try { tenter(); return; }
    catch (e) {
      /* Folder gone or moved: recreate it and retry once. */
      try { fs.mkdirSync(this.dossier, { recursive: true }); tenter(); return; }
      catch (e2) {
        console.error('[donnees] write ' + nom + ': ' + e2.message);
        /* The data stays in memory: retry as long as the disk refuses. */
        this.minuteries[nom] = setTimeout(() => this.ecrireMaintenant(nom), this.retenteMs);
        if (Date.now() - this.derniereAlerte >= RAPPEL_ALERTE_MS && typeof this.surErreur === 'function') { this.derniereAlerte = Date.now(); try { this.surErreur(nom, e2.message); } catch (e3) {} }
      }
    }
  }

  purger() {
    Object.keys(this.minuteries).forEach(nom => this.ecrireMaintenant(nom));
  }

  /* A dated copy of the files, once a day (or forced). */
  sauvegardeQuotidienne(forcer) {
    try {
      const d = new Date();
      const jour = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const racine = path.join(this.dossier, 'Sauvegardes');
      let cible = path.join(racine, jour);
      if (fs.existsSync(cible)) {
        if (!forcer) return;
        cible = path.join(racine, jour + '-' + Date.now());
      }
      const presents = FICHIERS.filter(nom => fs.existsSync(this.chemin(nom)));
      if (!presents.length) return;
      fs.mkdirSync(cible, { recursive: true });
      presents.forEach(nom => fs.copyFileSync(this.chemin(nom), path.join(cible, nom + '.json')));
      const anciennes = fs.readdirSync(racine).filter(n => /^\d{4}-\d{2}-\d{2}/.test(n)).sort();
      while (anciennes.length > SAUVEGARDES_CONSERVEES) {
        const vieille = anciennes.shift();
        fs.rmSync(path.join(racine, vieille), { recursive: true, force: true });
      }
    } catch (e) { console.error('[donnees] backup: ' + e.message); }
  }
}

module.exports = { Donnees, FICHIERS };
