/* ============================================================
   Sablier (application macOS) : données en fichiers lisibles.

   Dossier : ~/Library/Application Support/Sablier/Donnees/
     reglages.json    tarif, identités, axes, cotisations, préférences
     journal.json     les lignes de temps
     chantiers.json   idées et travaux
     notes.json       pages et blocs
     factures.json    factures émises et encaissements
     echeances.json   calendrier administratif et rappels
     chrono.json      le chrono en cours (survit à la fermeture)
     Sauvegardes/     une copie datée par jour, les 30 dernières

   Écritures atomiques (fichier temporaire forcé sur le disque, puis
   renommage), différées de 300 ms pour grouper les rafales ; purgées à la
   fermeture. Une écriture refusée est retentée toutes les 30 secondes.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const FICHIERS = ['reglages', 'journal', 'chantiers', 'notes', 'factures', 'echeances', 'chrono'];
const SAUVEGARDES_CONSERVEES = 30;
const RAPPEL_ALERTE_MS = 5 * 60000;
/* Créés dès le premier lancement : leur absence ensuite n'est jamais normale. */
const ESSENTIELS = ['journal', 'factures'];

class Donnees {
  constructor(dossier) {
    this.dossier = dossier;
    this.cache = {};
    this.minuteries = {};
    this.illisibles = [];          // fichiers mis de côté au dernier chargement
    this.absents = [];             // fichiers essentiels manquants au dernier chargement
    this.surErreur = null;         // rappel (nom, message) quand une écriture échoue
    this.derniereAlerte = 0;
    this.retenteMs = 30000;
    fs.mkdirSync(dossier, { recursive: true });
    fs.mkdirSync(path.join(dossier, 'Sauvegardes'), { recursive: true });
  }

  chemin(nom) { return path.join(this.dossier, nom + '.json'); }

  /* Lit les sept fichiers. Les écritures en attente passent d'abord sur le
     disque, sinon une relecture (rechargement de la fenêtre) rendrait
     l'ancien contenu puis l'écrirait par-dessus le nouveau. */
  lireTout() {
    this.purger();
    const out = {};
    this.illisibles = [];
    FICHIERS.forEach(nom => {
      /* Écriture encore refusée : la mémoire est plus récente que le disque. */
      if (this.minuteries[nom]) { out[nom] = this.cache[nom]; return; }
      try {
        const brut = fs.readFileSync(this.chemin(nom), 'utf8');
        this.cache[nom] = JSON.parse(brut);
        out[nom] = this.cache[nom];
      } catch (e) {
        if (e.code !== 'ENOENT') {
          /* Fichier abîmé : on le met de côté plutôt que de l'écraser. */
          const copie = this.chemin(nom) + '.illisible-' + Date.now();
          try { fs.renameSync(this.chemin(nom), copie); } catch (e2) {}
          this.illisibles.push({ nom, copie, message: e.message });
          console.error('[donnees] ' + nom + '.json illisible : ' + e.message);
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
    /* fsync avant le renommage : une coupure de courant ne peut pas remplacer
       le bon fichier par un fichier vide ou tronqué. */
    const tenter = () => {
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeFileSync(fd, contenu, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, cible);
    };
    try { tenter(); return; }
    catch (e) {
      /* Dossier disparu ou déplacé : on le recrée et on réessaie une fois. */
      try { fs.mkdirSync(this.dossier, { recursive: true }); tenter(); return; }
      catch (e2) {
        console.error('[donnees] écriture ' + nom + ' : ' + e2.message);
        /* Les données restent en mémoire : on retente tant que le disque refuse. */
        this.minuteries[nom] = setTimeout(() => this.ecrireMaintenant(nom), this.retenteMs);
        if (Date.now() - this.derniereAlerte >= RAPPEL_ALERTE_MS && typeof this.surErreur === 'function') { this.derniereAlerte = Date.now(); try { this.surErreur(nom, e2.message); } catch (e3) {} }
      }
    }
  }

  purger() {
    Object.keys(this.minuteries).forEach(nom => this.ecrireMaintenant(nom));
  }

  /* Une copie datée des fichiers, une fois par jour (ou forcée). */
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
    } catch (e) { console.error('[donnees] sauvegarde : ' + e.message); }
  }
}

module.exports = { Donnees, FICHIERS };
