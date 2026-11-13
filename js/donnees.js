/* ============================================================
   DONNÉES : l'état de l'application et sa persistance.

   Dans l'application macOS, window.sablier (js/pont.js) lit et écrit
   des fichiers JSON dans le dossier de données. Dans un navigateur nu
   (développement), on retombe sur localStorage.

   Fichiers : reglages, journal, chantiers (les tâches, nom historique du
   fichier), notes, factures, echeances, chrono. Chaque premier lancement
   pose des données de départ tirées du contrat (axes, échéances
   administratives, pages et tâches).
   ============================================================ */
'use strict';

var FICHIERS = ['reglages', 'journal', 'chantiers', 'notes', 'factures', 'echeances', 'chrono'];
var ETAT = {};

function estApp() { return typeof window !== 'undefined' && !!window.sablier; }

/* ---------- Valeurs de départ ---------- */

/* Nuancier sobre proposé pour les axes (tons du cabinet, jamais criards). */
var PALETTE_AXES = ['#1F497D', '#2E6F9E', '#2F7F8A', '#4E8B6D', '#7A8A3A', '#A5813C', '#B3652F', '#9E3A45', '#7A4F8C', '#5F7186'];
var COULEURS_AXES_DEFAUT = { rapports: '#2E6F9E', projeta: '#1F497D', integration: '#2F7F8A', suivi: '#7A4F8C', gouvernance: '#4E8B6D', annexe: '#A5813C' };

function axesDefaut() {
  return [
    { id: 'rapports', code: '1', nom: 'Rapports clients', couleur: '#2E6F9E' },
    { id: 'projeta', code: '2', nom: 'Développement Projet A', couleur: '#1F497D' },
    { id: 'integration', code: '3', nom: 'Intégration Projet B', couleur: '#2F7F8A' },
    { id: 'suivi', code: '4', nom: 'Suivi Projet B / Partenaire', couleur: '#7A4F8C' },
    { id: 'gouvernance', code: '5', nom: 'Gouvernance, veille et idées', couleur: '#4E8B6D' },
    { id: 'annexe', code: 'A', nom: 'Mission annexe', couleur: '#A5813C' },
  ];
}

function reglagesDefaut() {
  return {
    schemaVersion: 2,
    tarifHoraire: 42.86,
    arrondi: 0.25,
    heuresJournee: 7,
    repereAnnuel: 192,
    delaiPaiement: 30,
    mentionTVA: 'TVA non applicable, article 293 B du CGI',
    contrat: { debut: '2026-10-01', fin: '2027-09-30' },
    prestataire: {
      nom: 'Prénom Nom', formeJuridique: 'Entrepreneur individuel', siren: '123 456 789', siret: '123 456 789 00015', ape: '62.02A',
      adresse: '', email: '', telephone: '',
      titulaireCompte: 'EI Nom Prénom', banque: 'Banque Exemple', iban: '', bic: '',
    },
    client: {
      societe: 'Client Exemple', contact: 'Jean Dupont',
      adresse: '1 avenue des Tests, 75000 Paris', siren: '987 654 321', email: '',
    },
    axes: axesDefaut(),
    cotisations: { debutActivite: '2026-10-01', tauxAcre: 19.4, finAcre: '2027-09-30', tauxPlein: 25.8 },
    /* Rappels : horizons en jours, chrono oublié en heures, journal
       délaissé en jours (0 pour désactiver), notifications macOS. */
    rappels: { natives: true, auDemarrage: true, horizonEcheances: 7, horizonTaches: 3, horizonFactures: 5, chronoOublieHeures: 3, journalJours: 7 },
    ui: { dernierAxe: 'projeta', periodeTableau: 'mois', moisMeta: {}, rappelsNotifies: {}, rappelsReportes: {}, rappelsDigestLe: '' },
  };
}

function echeancesDefaut() {
  var maintenant = new Date().toISOString();
  return [
    ['2026-10-01', 'Début du contrat et de l\'activité', 'Contrat du 1er octobre 2026 au 30 septembre 2027. Première période : mise en place (20 à 30 h en sus du rythme de croisière).', 'contrat'],
    ['2026-10-13', 'Déposer la demande d\'ACRE à l\'URSSAF', 'Au plus tard 60 jours après le début d\'activité. Passé le délai, l\'aide est définitivement perdue. Effet : cotisations à 19,40 % jusqu\'au 30/09/2027.', 'admin'],
    ['2026-10-31', 'Souscrire une assurance responsabilité civile professionnelle', 'Recommandée dès le démarrage (150 à 300 € par an). Vérifier la couverture des dommages immatériels non consécutifs et du travail à distance depuis l\'étranger.', 'admin'],
    ['2026-12-31', 'Déposer la déclaration initiale de CFE (formulaire 1447-C-SD)', 'Auprès du service des impôts des entreprises, avant le 31 décembre de l\'année de création. Conditionne l\'exonération de la première année. Créer au passage l\'espace professionnel sur impots.gouv.fr.', 'admin'],
    ['2027-03-31', 'Transmettre au client l\'attestation de vigilance URSSAF et un avis SIRENE', 'Tous les six mois : les deux documents se téléchargent en ligne en quelques minutes.', 'admin'],
    ['2027-04-30', 'Première déclaration de chiffre d\'affaires à l\'URSSAF', 'Période d\'octobre 2026 à mars 2027, sur le chiffre d\'affaires encaissé (autoentrepreneur.urssaf.fr). Le tableau des trimestres de la vue Factures donne le montant.', 'admin'],
    ['2027-05-31', 'Déclaration de revenus 2026 (formulaire 2042-C-PRO)', 'Reporter le chiffre d\'affaires encaissé en 2026 en case 5HQ (micro-BNC). Date exacte selon le calendrier fiscal du printemps 2027.', 'admin'],
    ['2027-06-15', 'Préparer l\'entretien de bilan de l\'été 2027', 'Relevé consolidé des heures par axe, travaux accomplis, priorités de la période suivante, révision du tarif (article 6.7 : la fin de l\'ACRE est un motif légitime de réexamen).', 'contrat'],
    ['2027-07-31', 'Déclaration URSSAF du 2e trimestre 2027', 'Chiffre d\'affaires encaissé d\'avril à juin 2027.', 'admin'],
    ['2027-09-01', 'Facturation électronique obligatoire', 'À compter du 1er septembre 2027, émission des factures via une plateforme agréée. En choisir une au printemps (plusieurs sont gratuites à faible volume).', 'admin'],
    ['2027-09-30', 'Fin du contrat et fin de l\'ACRE', 'Le contrat ne se renouvelle pas tacitement : un écrit signé des deux parties est nécessaire pour poursuivre. Les cotisations passent de 19,40 % à 25,80 % le 1er octobre 2027.', 'contrat'],
    ['2027-10-01', 'Transmettre l\'attestation de vigilance URSSAF (six mois)', 'Si la collaboration se poursuit.', 'admin'],
    ['2027-10-31', 'Déclaration URSSAF du 3e trimestre 2027', 'Chiffre d\'affaires encaissé de juillet à septembre 2027.', 'admin'],
    ['2028-01-31', 'Déclaration URSSAF du 4e trimestre 2027', 'Chiffre d\'affaires encaissé d\'octobre à décembre 2027.', 'admin'],
  ].map(function (t, i) {
    return { id: 'ech_defaut_' + i, date: t[0], titre: t[1], detail: t[2], type: t[3], rappelJours: null, fait: false, faitLe: null, creeLe: maintenant };
  });
}

/* Une tâche complète : les champs de suivi (étapes, pièces, notes liées,
   journal d'avancement) sont toujours présents. */
var STATUTS_TACHE_VALIDES = ['a-faire', 'en-cours', 'fait', 'idee'];
function normaliserTache(t) {
  if (!t || typeof t !== 'object') return t;
  if (!t.id) t.id = uid('tache');
  if (STATUTS_TACHE_VALIDES.indexOf(t.statut) < 0) t.statut = 'a-faire';
  if (typeof t.titre !== 'string') t.titre = String(t.titre == null ? '' : t.titre);
  if (!t.creeLe) t.creeLe = new Date().toISOString();
  if (!t.modifieLe) t.modifieLe = t.creeLe;
  t.priorite = normaliserPriorite(t.priorite === 'normale' ? 'auto' : t.priorite);
  if (!Array.isArray(t.etapes)) t.etapes = [];
  if (!Array.isArray(t.pieces)) t.pieces = [];
  if (!Array.isArray(t.notes)) t.notes = [];
  if (!Array.isArray(t.avancement)) t.avancement = [];
  if (t.description == null) t.description = '';
  return t;
}

function chantiersDefaut() {
  var maintenant = new Date().toISOString();
  return [
    ['a-faire', 'rapports', 'Préparer le premier rapport client', 'Rassembler les données, relire, envoyer.'],
    ['en-cours', 'projeta', 'Fiabiliser le Projet A', 'Corriger les anomalies connues avant d\'ajouter des fonctionnalités.'],
    ['a-faire', 'integration', 'Livrer une première version du Projet A au partenaire', 'Version numérotée et datée, avec une courte documentation.'],
    ['a-faire', 'suivi', 'Premier point d\'avancement avec le partenaire', 'Ce qui a été livré, ce qui est en service, ce qui reste à faire.'],
    ['a-faire', 'gouvernance', 'Documenter la sauvegarde et la restauration', 'Sauvegarde régulière et procédure de restauration testée.'],
  ].map(function (t, i) {
    return normaliserTache({ id: 'tache_defaut_' + i, statut: t[0], axe: t[1], titre: t[2], description: t[3], priorite: 'auto', echeance: null, ordre: i, creeLe: maintenant, modifieLe: maintenant, faitLe: null });
  });
}

function bloc(type, html, extra) {
  var b = { id: uid('bloc'), type: type, html: html || '' };
  if (type === 'case') b.coche = !!(extra && extra.coche);
  if (extra && extra.tache) b.tache = extra.tache;
  return b;
}

/* Le texte d'un bloc « idée » : le titre en gras, puis la description et
   les repères (intérêt, effort, prérequis) sur les lignes suivantes. */
function ideeBlocHtml(titre, description, interet, effort, prerequis) {
  var lignes = ['<b>' + echapper(titre) + '</b>'];
  if (description) lignes.push(echapper(description));
  var reperes = [interet ? 'Intérêt : ' + interet : '', effort ? 'Effort : ' + effort : '', prerequis ? 'Prérequis : ' + prerequis : ''].filter(Boolean);
  if (reperes.length) lignes.push(echapper(reperes.join(' · ')));
  return lignes.join('<br>');
}

function ideesDefaut() {
  return [
    bloc('idee', ideeBlocHtml('Alertes proactives', 'Échéances proches remontées au tableau de bord.', 'fort, évite les oublis', 'petit', 'aucun')),
    bloc('idee', ideeBlocHtml('Export CSV du journal', 'Pour retravailler les heures dans un tableur.', 'moyen', 'petit', 'aucun')),
    bloc('idee', ideeBlocHtml('Modèles de tâches', 'Des listes d\'étapes prêtes pour les travaux qui reviennent.', 'moyen', 'moyen', 'aucun')),
  ];
}

function notesDefaut() {
  var maintenant = new Date().toISOString();
  function page(id, titre, parent, blocs, ordre) {
    return { id: id, titre: titre, parent: parent || null, blocs: blocs, ordre: ordre || 0, creeLe: maintenant, modifieLe: maintenant };
  }
  return [
    page('page_projeta', 'Projet A', null, [
      bloc('encadre', 'Exemple de page : la justesse avant les fonctionnalités.'),
      bloc('h2', 'Livrables'),
      bloc('case', 'Paramétrage complet et vérifié'),
      bloc('case', 'Documentation et mode d\'emploi tenus à jour'),
      bloc('h2', 'Journal des décisions'),
      bloc('p', ''),
    ], 0),
    page('page_admin', 'Administratif', null, [
      bloc('p', 'Le rituel de la micro-entreprise, en plus des échéances datées de la page Échéances.'),
      bloc('h2', 'Chaque mois'),
      bloc('puce', 'Relevé d\'activité et facture depuis Sablier, envoyés au client en fin de mois'),
      bloc('puce', 'À l\'encaissement : marquer la facture payée (livre des recettes)'),
      bloc('h2', 'Chaque trimestre'),
      bloc('puce', 'Déclarer le chiffre d\'affaires encaissé sur autoentrepreneur.urssaf.fr'),
    ], 1),
    page('page_idees', 'Idées en vrac', null, [
      bloc('p', 'Un endroit pour noter vite. Chaque idée a le style « Idée » : bouton ampoule de la barre, ou tapez / puis « Idée ». Quand elle est mûre, « En faire une tâche » l\'envoie dans la colonne À faire.'),
    ].concat(ideesDefaut()), 2),
  ];
}

/* ---------- Lecture et écriture ---------- */

function lireFichier(nom) {
  if (estApp()) return window.sablier.donnees.lire(nom);
  try { return JSON.parse(localStorage.getItem('sablier_' + nom) || 'null'); }
  catch (e) { return null; }
}

function sauver(nom) {
  if (FICHIERS.indexOf(nom) < 0) throw new Error('fichier inconnu : ' + nom);
  if (estApp()) window.sablier.donnees.ecrire(nom, ETAT[nom]);
  else localStorage.setItem('sablier_' + nom, JSON.stringify(ETAT[nom]));
}

/* Un objet (ni tableau, ni scalaire), sinon null. */
function objetOu(x) { return x && typeof x === 'object' && !Array.isArray(x) ? x : null; }
/* Un tableau d'objets (les éléments nuls ou scalaires sont écartés), sinon
   null. Une liste devenue un objet indexé ({"0":…, "1":…}, par une retouche
   manuelle ou un outil tiers) est récupérée plutôt que perdue : on ne jette
   jamais des données qu'on peut lire. */
function tableauObjets(x) {
  if (Array.isArray(x)) return x.filter(function (e) { return e && typeof e === 'object'; });
  if (x && typeof x === 'object') {
    var liste = Object.keys(x).map(function (k) { return x[k]; }).filter(function (e) { return e && typeof e === 'object'; });
    return liste.length ? liste : null;
  }
  return null;
}
/* Coerce un nombre écrit en chaîne ("42,86") ; sinon la valeur par défaut. */
function nombreDe(v, defaut) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) { var n = Number(v.replace(',', '.')); if (isFinite(n)) return n; }
  return defaut;
}

function completer(cible, defaut) {
  Object.keys(defaut).forEach(function (k) {
    if (cible[k] === undefined || cible[k] === null) cible[k] = defaut[k];
    else if (typeof defaut[k] === 'object' && !Array.isArray(defaut[k]) && defaut[k] !== null && typeof cible[k] === 'object') completer(cible[k], defaut[k]);
  });
  return cible;
}

function chargerEtat() {
  /* Premier lancement : aucun des fichiers n'existe. Un fichier de réglages
     illisible seul ne remet pas tout à zéro. */
  var premierLancement = FICHIERS.every(function (nom) { return lireFichier(nom) == null; });
  var aReparer = {};

  var defauts = reglagesDefaut();
  var brutReglages = objetOu(lireFichier('reglages')) || {};
  ETAT.reglages = completer(brutReglages, defauts);
  ['prestataire', 'client', 'contrat', 'factures', 'cotisations', 'rappels', 'ui'].forEach(function (k) {
    if (!objetOu(ETAT.reglages[k])) { ETAT.reglages[k] = defauts[k]; aReparer.reglages = true; }
  });
  ['tarifHoraire', 'arrondi', 'heuresJournee', 'repereAnnuel', 'delaiPaiement'].forEach(function (k) {
    var v = nombreDe(ETAT.reglages[k], defauts[k]);
    if (v !== ETAT.reglages[k]) { ETAT.reglages[k] = v; aReparer.reglages = true; }
  });
  if (!objetOu(ETAT.reglages.ui.moisMeta)) ETAT.reglages.ui.moisMeta = {};
  var axesLus = tableauObjets(ETAT.reglages.axes);
  ETAT.reglages.axes = axesLus && axesLus.length ? axesLus : axesDefaut();
  /* Chaque axe porte une couleur (migration des données antérieures). */
  ETAT.reglages.axes.forEach(function (a, i) {
    if (!a.id) a.id = uid('axe');
    if (typeof a.nom !== 'string') a.nom = String(a.nom == null ? '' : a.nom);
    if (!/^#[0-9a-fA-F]{6}$/.test(String(a.couleur || ''))) a.couleur = COULEURS_AXES_DEFAUT[a.id] || PALETTE_AXES[i % PALETTE_AXES.length];
  });

  var j = objetOu(lireFichier('journal')) || {};
  var entrees = tableauObjets(j.entrees) || [];
  if (j.entrees != null && (!Array.isArray(j.entrees) || entrees.length !== j.entrees.length)) aReparer.journal = true;
  entrees.forEach(function (e) {
    if (!e.id) { e.id = uid('ent'); aReparer.journal = true; }
    if (typeof e.minutes === 'string') { var m = nombreDe(e.minutes, null); if (m != null) { e.minutes = m; aReparer.journal = true; } }
    if (typeof e.forfait === 'string') { var fo = nombreDe(e.forfait, null); e.forfait = fo != null && fo > 0 ? fo : null; aReparer.journal = true; }
    /* Mois de facturation : un mois mal écrit sortirait la ligne de son
       propre mois sans la mettre dans aucun autre, et elle ne serait
       jamais facturée. Le mois du travail lui-même ne se stocke pas. */
    if (e.moisFacturation != null && (!moisValide(e.moisFacturation) || e.moisFacturation <= moisDe(e.date))) {
      e.moisFacturation = null;
      aReparer.journal = true;
    }
  });
  ETAT.journal = { schemaVersion: 1, entrees: entrees };

  /* Tâches, notes et échéances reçoivent leurs valeurs de départ tant
     que leur fichier n'existe pas (un fichier présent mais vide reste vide). */
  var c = lireFichier('chantiers');
  var tachesLues = c != null ? (tableauObjets(objetOu(c) && c.taches) || []) : chantiersDefaut();
  if (c != null && objetOu(c) && Array.isArray(c.taches) && tachesLues.length !== c.taches.length) aReparer.chantiers = true;
  ETAT.chantiers = { schemaVersion: 2, taches: tachesLues };
  ETAT.chantiers.taches.forEach(normaliserTache);

  var n = lireFichier('notes');
  var pagesLues = n != null ? (tableauObjets(objetOu(n) && n.pages) || []) : notesDefaut();
  if (n != null && objetOu(n) && Array.isArray(n.pages) && pagesLues.length !== n.pages.length) aReparer.notes = true;
  pagesLues.forEach(function (p) {
    if (!p.id) { p.id = uid('page'); aReparer.notes = true; }
    if (!Array.isArray(p.blocs)) { p.blocs = []; aReparer.notes = true; }
    else { var avant = p.blocs.length; p.blocs = p.blocs.filter(function (b) { return b && typeof b === 'object'; }); if (p.blocs.length !== avant) aReparer.notes = true; }
    if (!p.creeLe) p.creeLe = new Date().toISOString();
    if (!p.modifieLe) p.modifieLe = p.creeLe;
  });
  ETAT.notes = { schemaVersion: 1, pages: pagesLues };

  var f = objetOu(lireFichier('factures')) || {};
  var facturesLues = tableauObjets(f.factures) || [];
  if (Array.isArray(f.factures) && facturesLues.length !== f.factures.length) aReparer.factures = true;
  ETAT.factures = { schemaVersion: 1, factures: facturesLues };

  var e = lireFichier('echeances');
  var echeancesLues = e != null ? (tableauObjets(objetOu(e) && e.echeances) || []) : echeancesDefaut();
  if (e != null && objetOu(e) && Array.isArray(e.echeances) && echeancesLues.length !== e.echeances.length) aReparer.echeances = true;
  echeancesLues.forEach(function (x) { if (!x.id) { x.id = uid('ech'); aReparer.echeances = true; } });
  ETAT.echeances = { schemaVersion: 1, echeances: echeancesLues };

  var ch = objetOu(lireFichier('chrono')) || {};
  ETAT.chrono = { schemaVersion: 1, enCours: objetOu(ch.enCours) && ch.enCours.debut ? ch.enCours : null };

  /* Les idées ne sont plus une colonne du tableau : celles qui y étaient
     rejoignent la page « Idées en vrac » des notes. */
  if (migrerIdeesVersNotes()) { aReparer.chantiers = true; aReparer.notes = true; }

  /* Une intervention ne se coupe pas entre deux mois de facturation
     (l'arrondi au quart d'heure serait compté deux fois). L'interface s'y
     tient, un fichier modifié à la main ou un import pourraient non. */
  if (alignerMoisFacturation()) aReparer.journal = true;

  if (premierLancement) FICHIERS.forEach(function (nom) { sauver(nom); });
  else Object.keys(aReparer).forEach(function (nom) { sauver(nom); });
  return premierLancement;
}

/* Remet sur un seul mois de facturation les lignes d'une même intervention
   (même jour, même axe, même libellé) qui auraient divergé : le mois d'une
   ligne déjà figée sur une facture fait foi, sinon le plus tardif, qui ne
   peut jamais facturer deux fois. Renvoie le nombre de lignes corrigées. */
function alignerMoisFacturation() {
  var lesFactures = factures();
  var groupes = {};
  entreesJournal().forEach(function (e) {
    if (!e || !e.date) return;
    (groupes[cleTravail(e)] = groupes[cleTravail(e)] || []).push(e);
  });
  var corrigees = 0;
  Object.keys(groupes).forEach(function (cle) {
    var lignes = groupes[cle];
    if (lignes.length < 2) return;
    var mois = lignes.map(moisFacturationDe);
    if (mois.every(function (m) { return m === mois[0]; })) return;
    var figee = lignes.filter(function (e) { return !!factureFigeant(lesFactures, e); })[0];
    var cible = figee ? moisFacturationDe(figee) : mois.slice().sort()[mois.length - 1];
    lignes.forEach(function (e) {
      /* Une ligne portée par une facture ne bouge jamais. */
      if (moisFacturationDe(e) === cible || factureFigeant(lesFactures, e)) return;
      e.moisFacturation = cible === moisDe(e.date) ? null : cible;
      e.modifieLe = new Date().toISOString();
      corrigees++;
    });
  });
  return corrigees;
}

/* Déplace les tâches de statut « idee » vers la page Idées en vrac, sous
   forme de blocs « idée » transformables en tâche. Renvoie le nombre
   d'idées déplacées. */
function migrerIdeesVersNotes() {
  var idees = taches().filter(function (t) { return t.statut === 'idee'; });
  if (!idees.length) return 0;
  var page = pageIdees();
  trierPar(idees, function (t) { return Number(t.ordre) || 0; }).forEach(function (t) {
    page.blocs.push(bloc('idee', ideeBlocHtml(t.titre, t.description, t.interet, t.effort, t.prerequis)));
  });
  page.modifieLe = new Date().toISOString();
  ETAT.chantiers.taches = taches().filter(function (t) { return t.statut !== 'idee'; });
  return idees.length;
}

/* La page « Idées en vrac », créée au besoin. */
function pageIdees() {
  var p = pagesNotes().filter(function (x) { return x.id === 'page_idees'; })[0];
  if (p) { if (!Array.isArray(p.blocs)) p.blocs = []; return p; }
  var maintenant = new Date().toISOString();
  var racines = pagesNotes().filter(function (x) { return !x.parent; });
  p = { id: 'page_idees', titre: 'Idées en vrac', parent: null, blocs: [bloc('p', 'Un endroit pour noter vite. Quand une idée est mûre, « En faire une tâche » l\'envoie dans la colonne À faire.')], ordre: (racines.length ? Math.max.apply(null, racines.map(function (x) { return x.ordre || 0; })) : 0) + 1, creeLe: maintenant, modifieLe: maintenant };
  pagesNotes().push(p);
  return p;
}

/* Remplace tout l'état par le contenu d'une sauvegarde importée. Le
   paquet doit porter les sept fichiers (chrono facultatif) ; sinon rien
   n'est écrit et la liste des fichiers manquants est renvoyée. */
function remplacerEtat(paquet) {
  var manquants = FICHIERS.filter(function (nom) { return nom !== 'chrono' && !objetOu(paquet && paquet[nom]); });
  if (manquants.length) return { ok: false, manquants: manquants };
  FICHIERS.forEach(function (nom) {
    var contenu = objetOu(paquet[nom]) || { schemaVersion: 1, enCours: null };
    if (estApp()) window.sablier.donnees.ecrire(nom, contenu);
    else localStorage.setItem('sablier_' + nom, JSON.stringify(contenu));
  });
  chargerEtat();
  return { ok: true };
}

function paquetSauvegarde() {
  var p = { application: 'Sablier', version: 1, exporteLe: new Date().toISOString() };
  FICHIERS.forEach(function (nom) { p[nom] = ETAT[nom]; });
  return p;
}

/* ---------- Accès pratiques ---------- */

function axes() { return ETAT.reglages.axes || []; }
function axeParId(id) {
  var a = axes().filter(function (x) { return x.id === id; })[0];
  return a || null;
}
function libelleAxe(id) { var a = axeParId(id); return a ? a.nom : (id || 'Sans axe'); }
function codeAxe(id) { var a = axeParId(id); return a ? a.code : ''; }
function couleurAxe(id) { var a = axeParId(id); return a && a.couleur ? a.couleur : '#5F7186'; }
/* Pastille d'axe : un point de la couleur de l'axe et son nom. */
function puceAxeHtml(id) {
  var a = axeParId(id);
  var nom = a ? a.nom : (id || 'Sans axe');
  return '<span class="puce-axe" style="--axe:' + echapper(couleurAxe(id)) + '" title="' + echapper(nom) + '"><i class="axe-point"></i>' + echapper(nom) + '</span>';
}
function entreesJournal() { return ETAT.journal.entrees; }
function taches() { return ETAT.chantiers.taches; }
function pagesNotes() { return ETAT.notes.pages; }
function factures() { return ETAT.factures.factures; }
function echeances() { return ETAT.echeances.echeances; }
/* Les tâches qui renvoient à une page de notes. */
function tachesLieesAPage(pageId) {
  return taches().filter(function (t) { return Array.isArray(t.notes) && t.notes.indexOf(pageId) >= 0; });
}
function moisMeta(mois) {
  var ui = ETAT.reglages.ui;
  if (!ui.moisMeta) ui.moisMeta = {};
  if (!ui.moisMeta[mois]) ui.moisMeta[mois] = { frais: 0, joindreTravaux: true, note: '' };
  return ui.moisMeta[mois];
}
/* Les données que lit le moteur de rappels. */
function donneesRappels() {
  return { entrees: entreesJournal(), taches: taches(), echeances: echeances(), factures: factures(), chrono: ETAT.chrono ? ETAT.chrono.enCours : null };
}
