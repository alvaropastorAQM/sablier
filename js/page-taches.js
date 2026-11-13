/* ============================================================
   PAGE TÂCHES : tableau en trois colonnes (À faire, En cours, Fait).
   Dans chaque colonne, les cartes se rangent d'elles-mêmes : les
   priorités hautes d'abord, puis moyennes, puis basses, et à priorité
   égale l'échéance la plus proche en premier (règles dans js/calculs.js).
   Glisser-déposer au pointeur : la carte flotte avec un léger
   balancement, un emplacement s'ouvre là où elle se posera.

   La fiche d'une tâche porte tout ce qui sert à suivre son avancement :
   étapes à cocher, pièces jointes (fichiers, images, liens, extraits de
   code), pages de notes liées, journal d'avancement daté, temps passé.
   Les idées, elles, vivent dans les notes (page « Idées en vrac ») et
   deviennent des tâches d'un clic.
   ============================================================ */
'use strict';

var STATUTS_TACHE = [
  { id: 'a-faire', nom: 'À faire', vide: 'Ce qui est décidé et attend son tour. Les idées mûrissent dans les notes, page « Idées en vrac ».' },
  { id: 'en-cours', nom: 'En cours', vide: 'Ce sur quoi vous travaillez en ce moment.' },
  { id: 'fait', nom: 'Fait', vide: 'Les tâches terminées rejoignent le relevé du mois.' },
];
var TACHES_FILTRE_AXE = '';
var TACHES_RECHERCHE = '';
var TACHES_TOUT_FAIT = false;
var GLISSER = null;
var LANGAGES_CODE = ['texte', 'javascript', 'html', 'css', 'json', 'python', 'sql', 'bash', 'java', 'swift', 'markdown', 'autre'];

function initTaches() {
  PAGES.taches = rendreTaches;
  var zone = document.getElementById('tachesContenu');
  zone.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-action]');
    if (!b) return;
    var a = b.dataset.action, id = b.dataset.id;
    if (a === 'nouveau') ouvrirEditionTache(null, b.dataset.statut);
    else if (a === 'modifier') ouvrirEditionTache(id);
    else if (a === 'chrono') { var t = tacheParId(id); if (t) demarrerChrono({ axe: t.axe, intervention: t.titre, tache: t.id }); }
    else if (a === 'avancer') avancerTache(id);
    else if (a === 'supprimer') supprimerTache(id);
    else if (a === 'tout-fait') { TACHES_TOUT_FAIT = !TACHES_TOUT_FAIT; rendreColonnesTaches(true); }
    else if (a === 'idees') ouvrirPageNotes('page_idees');
  });
  zone.addEventListener('change', function (ev) {
    if (ev.target.id === 'kbFiltreAxe') { TACHES_FILTRE_AXE = ev.target.value; rendreColonnesTaches(true); }
  });
  zone.addEventListener('input', function (ev) {
    if (ev.target.id === 'kbRecherche') { TACHES_RECHERCHE = ev.target.value; rendreColonnesTaches(false); }
  });
  zone.addEventListener('pointerdown', debutPointeurTaches);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && GLISSER && GLISSER.actif) annulerGlisser(); });
}

function tacheParId(id) { return taches().filter(function (t) { return t.id === id; })[0] || null; }

/* ---------- Rendu ---------- */

function rendreTaches() {
  var zone = document.getElementById('tachesContenu');
  var enCours = taches().filter(function (t) { return t.statut === 'en-cours'; }).length;
  var resume = taches().length + (taches().length > 1 ? ' tâches, ' : ' tâche, ') + enCours + ' en cours';
  if (document.getElementById('kbColonnes')) {
    document.getElementById('kbResume').textContent = resume;
    /* Le filtre d'axe suit les Réglages (axe renommé, ajouté ou supprimé). */
    if (TACHES_FILTRE_AXE && !axeParId(TACHES_FILTRE_AXE)) TACHES_FILTRE_AXE = '';
    document.getElementById('kbFiltreAxe').innerHTML = optionsAxesHtml(TACHES_FILTRE_AXE, true);
    rendreColonnesTaches(true);
    return;
  }
  zone.innerHTML = '<div class="page-entete"><div><h2 class="page-titre">Tâches</h2>'
    + '<p class="page-sous">À faire, en cours, fait. Les cartes se rangent d\'elles-mêmes : priorité haute, moyenne puis basse, et l\'échéance la plus proche en premier. Glissez une carte d\'une colonne à l\'autre ; cliquez-la pour ouvrir sa fiche (étapes, pièces jointes, notes liées, avancement). Une tâche passée en « Fait » rejoint les travaux réalisés du relevé du mois.</p></div>'
    + '<div class="actions"><button class="btn btn-ghost" data-action="idees">Idées en vrac</button><button class="btn" data-action="nouveau" data-statut="a-faire">Nouvelle tâche</button></div></div>'
    + '<div class="kb-outils"><input type="text" id="kbRecherche" class="champ" style="max-width:260px;" placeholder="Rechercher…" value="' + echapper(TACHES_RECHERCHE) + '">'
    + '<select id="kbFiltreAxe" class="champ" style="width:auto;">' + optionsAxesHtml(TACHES_FILTRE_AXE, true) + '</select>'
    + '<span class="petit" id="kbResume">' + resume + '</span></div>'
    + '<div class="kb-colonnes" id="kbColonnes"></div>';
  rendreColonnesTaches(false);
}

function rendreColonnesTaches(animer) {
  var conteneur = document.getElementById('kbColonnes');
  if (!conteneur) return;
  if (GLISSER && GLISSER.actif) nettoyerGlisser();
  var ref = aujourdhui();
  var recherche = normaliserCle(TACHES_RECHERCHE);
  var anciens = {};
  if (animer) conteneur.querySelectorAll('.kb-carte').forEach(function (c) { anciens[c.dataset.id] = c.getBoundingClientRect(); });
  conteneur.innerHTML = STATUTS_TACHE.map(function (s) {
    var liste = taches().filter(function (t) {
      if (t.statut !== s.id) return false;
      if (TACHES_FILTRE_AXE && t.axe !== TACHES_FILTRE_AXE) return false;
      if (recherche && normaliserCle(t.titre + ' ' + (t.description || '')).indexOf(recherche) < 0) return false;
      return true;
    });
    if (s.id === 'fait') liste = trierPar(liste, function (t) { return (t.faitLe || '') + String(t.ordre || 0).padStart(6, '0'); }, true);
    else liste = trierTaches(liste, ref);
    var total = liste.length;
    var tronque = s.id === 'fait' && !TACHES_TOUT_FAIT && liste.length > 8;
    if (tronque) liste = liste.slice(0, 8);
    return '<div class="kb-colonne" data-statut="' + s.id + '">'
      + '<div class="kb-colonne-entete"><span class="kb-colonne-titre">' + echapper(s.nom) + '</span><span class="nb">' + total + '</span></div>'
      + (liste.length ? liste.map(function (t) { return carteTacheHtml(t, ref); }).join('') : '<div class="vide" style="padding:14px 8px; font-size:12.5px;">' + echapper(s.vide) + '</div>')
      + (tronque ? '<button class="lien" data-action="tout-fait" style="align-self:center;">Afficher les ' + total + ' tâches terminées</button>' : '')
      + '<button class="kb-ajout" data-action="nouveau" data-statut="' + s.id + '">+ Ajouter</button>'
      + '</div>';
  }).join('');
  if (animer) animerReclassement(conteneur, anciens);
}

/* Les cartes qui changent de place glissent de leur ancienne position
   vers la nouvelle (technique FLIP). */
function animerReclassement(conteneur, anciens) {
  var nouvelles = Array.prototype.slice.call(conteneur.querySelectorAll('.kb-carte'));
  var mouvements = [];
  nouvelles.forEach(function (c) {
    var a = anciens[c.dataset.id];
    if (!a) return;
    var b = c.getBoundingClientRect();
    var dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    c.style.transition = 'none';
    c.style.transform = 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
    mouvements.push(c);
  });
  if (!mouvements.length) return;
  conteneur.getBoundingClientRect();
  mouvements.forEach(function (c) {
    c.style.transition = 'transform 240ms var(--ease-out)';
    c.style.transform = '';
    c.addEventListener('transitionend', function fin() { c.style.transition = ''; c.removeEventListener('transitionend', fin); });
  });
}

function etapesFaites(t) { return (t.etapes || []).filter(function (e) { return e.fait; }).length; }

function carteTacheHtml(t, ref) {
  var pe = prioriteEffective(t, ref);
  var origine = pe.origine === 'echeance' ? ', relevée par l\'échéance' : (pe.origine === 'manuelle' ? ', choisie' : ', automatique');
  var prioHtml = '<span class="kb-priorite ' + pe.niveau + '" title="Priorité ' + LIBELLES_PRIORITE[pe.niveau].toLowerCase() + origine + '"></span>'
    + (t.statut !== 'fait' && pe.niveau !== 'basse' ? '<span class="kb-prio-lib ' + pe.niveau + '">' + LIBELLES_PRIORITE[pe.niveau] + '</span>' : '');
  var ech = '';
  if (t.echeance && t.statut !== 'fait') {
    var j = joursEntre(ref, t.echeance);
    ech = '<span class="kb-echeance' + (j < 0 ? ' retard' : (j <= 7 ? ' proche' : '')) + '" title="Échéance ' + libelleDelai(j) + '">' + libelleDate(t.echeance, 'jour') + ' · ' + libelleJours(j) + '</span>';
  }
  var etapes = t.etapes || [];
  var faites = etapesFaites(t);
  var progres = etapes.length ? '<div class="kb-progres" title="' + faites + ' étape' + (faites > 1 ? 's' : '') + ' sur ' + etapes.length + '"><span style="width:' + Math.round(100 * faites / etapes.length) + '%"></span></div>' : '';
  var temps = minutesTache(entreesJournal(), t.id);
  var compteurs = [];
  if (etapes.length) compteurs.push('<span title="Étapes">' + icone('case', 13) + faites + '/' + etapes.length + '</span>');
  if ((t.pieces || []).length) compteurs.push('<span title="Pièces jointes">' + icone('trombone', 13) + t.pieces.length + '</span>');
  if ((t.notes || []).length) compteurs.push('<span title="Notes liées">' + icone('note', 13) + t.notes.length + '</span>');
  if (temps.minutes) compteurs.push('<span title="Temps passé (journal)">' + icone('horloge', 13) + fmtDuree(temps.minutes) + '</span>');
  return '<div class="kb-carte' + (t.statut === 'fait' ? ' fait' : '') + '" data-id="' + echapper(t.id) + '">'
    + '<div class="kb-titre">' + echapper(t.titre) + '</div>'
    + (t.description ? '<div class="petit" style="overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">' + echapper(t.description) + '</div>' : '')
    + progres
    + '<div class="kb-meta">' + prioHtml + puceAxeHtml(t.axe) + ech
    + (t.statut === 'fait' && t.faitLe ? '<span class="kb-echeance">fait le ' + dateFr(t.faitLe) + '</span>' : '') + '</div>'
    + (compteurs.length ? '<div class="kb-compteurs">' + compteurs.join('') + '</div>' : '')
    + '<div class="kb-carte-actions">'
    + (t.statut !== 'fait' ? boutonIcone('chrono', 'play', 'Démarrer le chrono sur cette tâche', '', t.id) : '')
    + boutonIcone('modifier', 'crayon', 'Ouvrir la fiche', '', t.id)
    + (t.statut !== 'fait' ? boutonIcone('avancer', 'coche', t.statut === 'en-cours' ? 'Marquer fait' : 'Passer en cours', '', t.id) : '')
    + boutonIcone('supprimer', 'corbeille', 'Supprimer', 'danger', t.id)
    + '</div></div>';
}

/* ---------- Opérations ---------- */

function ordreSuivant(statut) {
  var max = 0;
  taches().forEach(function (t) { if (t.statut === statut && (t.ordre || 0) > max) max = t.ordre || 0; });
  return max + 1;
}

function appliquerStatut(t, statut) {
  if (t.statut === statut) return;
  t.statut = statut;
  t.modifieLe = new Date().toISOString();
  if (statut === 'fait') t.faitLe = t.faitLe || aujourdhui();
  else t.faitLe = null;
}

/* Dépose une tâche dans une colonne, avant la tâche « avantId » (ou en
   fin). L'ordre manuel ne départage que les cartes de même priorité et
   de même échéance : le classement automatique garde la main. */
function deplacerTache(t, statut, avantId) {
  var ref = aujourdhui();
  appliquerStatut(t, statut);
  var colonne = trierTaches(taches().filter(function (x) { return x.statut === statut && x.id !== t.id; }), ref);
  var idx = avantId ? colonne.findIndex(function (x) { return x.id === avantId; }) : -1;
  if (idx < 0) colonne.push(t); else colonne.splice(idx, 0, t);
  colonne.forEach(function (x, i) { x.ordre = i + 1; });
  sauver('chantiers');
  rafraichir();
}

function avancerTache(id) {
  var t = tacheParId(id);
  if (!t) return;
  var suite = { 'a-faire': 'en-cours', 'en-cours': 'fait' }[t.statut];
  if (!suite) return;
  appliquerStatut(t, suite);
  t.ordre = ordreSuivant(suite);
  sauver('chantiers');
  rafraichir();
  if (suite === 'fait') notifier('« ' + t.titre + ' » est terminée : elle figurera dans les travaux réalisés ' + deLibelleMois(moisDe(t.faitLe)) + '.', { type: 'succes' });
}

/* brouillon : les champs de la fiche ouverte, pour la rouvrir telle quelle
   si la suppression est annulée. */
function supprimerTache(id, brouillon) {
  var t = tacheParId(id);
  if (!t) return;
  var nbPieces = (t.pieces || []).filter(function (p) { return p.type === 'fichier'; }).length;
  confirmer('Supprimer la tâche « ' + t.titre + ' » ?' + (nbPieces ? ' Ses ' + nbPieces + ' fichier' + (nbPieces > 1 ? 's joints iront' : ' joint ira') + ' dans la corbeille.' : ''), { ok: 'Supprimer', danger: true, titre: 'Supprimer une tâche' }).then(function (ok) {
    if (!ok) { if (brouillon) ouvrirEditionTache(id, null, null, brouillon); return; }
    if (nbPieces && estApp()) window.sablier.pieces.supprimer(t.id);
    ETAT.chantiers.taches = taches().filter(function (x) { return x.id !== id; });
    sauver('chantiers');
    fermerModale();
    rafraichir();
  });
}

/* Créer une tâche sans passer par la fiche (depuis une note, par exemple). */
/* L'axe demandé, ou le dernier utilisé, à condition qu'il existe encore. */
function axeParDefaut(souhaite) {
  var id = souhaite || ETAT.reglages.ui.dernierAxe;
  if (axeParId(id)) return id;
  return axes()[0] ? axes()[0].id : '';
}

function creerTache(o) {
  var t = normaliserTache({
    id: uid('tache'), statut: o.statut || 'a-faire', axe: axeParDefaut(o.axe),
    titre: String(o.titre || '').trim() || 'Sans titre', description: String(o.description || '').trim(),
    priorite: normaliserPriorite(o.priorite), echeance: o.echeance || null, notes: (o.notes || []).slice(),
    ordre: 0, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), faitLe: null,
  });
  t.ordre = ordreSuivant(t.statut);
  if (t.statut === 'fait') t.faitLe = aujourdhui();
  taches().push(t);
  sauver('chantiers');
  return t;
}

/* ---------- Liens entre tâches et pages de notes ---------- */

function lierTacheANote(tacheId, pageId) {
  var t = tacheParId(tacheId);
  if (!t || !pageParId(pageId)) return false;
  if (!Array.isArray(t.notes)) t.notes = [];
  if (t.notes.indexOf(pageId) < 0) t.notes.push(pageId);
  t.modifieLe = new Date().toISOString();
  sauver('chantiers');
  return true;
}
function delierTacheDeNote(tacheId, pageId) {
  var t = tacheParId(tacheId);
  if (!t) return;
  t.notes = (t.notes || []).filter(function (id) { return id !== pageId; });
  t.modifieLe = new Date().toISOString();
  sauver('chantiers');
}
/* Menu de choix d'une page de notes (arborescence indentée). */
function menuChoixPage(ancre, exclure, surChoix) {
  var items = [];
  var parcourir = function (parent, niveau) {
    enfantsDe(parent).forEach(function (x) {
      if (exclure.indexOf(x.id) < 0) items.push({ libelle: (niveau ? '   '.repeat(niveau) + '↳ ' : '') + (x.titre || 'Sans titre'), fn: function () { surChoix(x.id); } });
      parcourir(x.id, niveau + 1);
    });
  };
  parcourir(null, 0);
  if (!items.length) items.push({ libelle: 'Aucune autre page', fn: function () {} });
  ouvrirMenu(ancre, items, { titre: 'Lier une page de notes' });
}
/* Pastille d'une tâche (dans les notes) : priorité, colonne, titre. */
function chipTacheHtml(t) {
  var ref = aujourdhui();
  var pe = prioriteEffective(t, ref);
  var st = STATUTS_TACHE.filter(function (s) { return s.id === t.statut; })[0];
  return '<button type="button" class="chip-tache' + (t.statut === 'fait' ? ' fait' : '') + '" data-action="tache" data-id="' + echapper(t.id) + '" title="Ouvrir la fiche"><span class="kb-priorite ' + pe.niveau + '"></span><span class="chip-tache-statut">' + echapper(st ? st.nom : t.statut) + '</span><span class="chip-tache-titre">' + echapper(t.titre) + '</span></button>';
}

/* ---------- Étapes, pièces, avancement (mutations directes) ----------
   Chaque fonction enregistre puis redessine la section de la fiche si
   elle est ouverte, et les cartes derrière. */

function ficheOuverte(t) { return document.querySelector('.modal[data-tache="' + t.id + '"]'); }
function apresMutationTache(t, section) {
  t.modifieLe = new Date().toISOString();
  sauver('chantiers');
  var m = ficheOuverte(t);
  if (m) rafraichirSectionFiche(m, t, section);
  rendreColonnesTaches(false);
  if (PAGE_COURANTE === 'notes' && typeof rendreTachesLieesNotes === 'function') { rendreTachesLieesNotes(); rendreRailNotes(); }
}

function ajouterEtapeTache(t, texte) {
  var s = String(texte || '').trim();
  if (!s) return null;
  var e = { id: uid('etape'), texte: s, fait: false };
  t.etapes.push(e);
  apresMutationTache(t, 'etapes');
  return e;
}
function basculerEtapeTache(t, etapeId, fait) {
  var e = t.etapes.filter(function (x) { return x.id === etapeId; })[0];
  if (!e) return;
  e.fait = fait == null ? !e.fait : !!fait;
  e.faitLe = e.fait ? aujourdhui() : null;
  apresMutationTache(t, 'etapes');
}
function modifierEtapeTache(t, etapeId, texte) {
  var e = t.etapes.filter(function (x) { return x.id === etapeId; })[0];
  if (!e) return;
  var s = String(texte || '').trim();
  if (!s) { t.etapes = t.etapes.filter(function (x) { return x.id !== etapeId; }); }
  else e.texte = s;
  apresMutationTache(t, 'etapes');
}
function supprimerEtapeTache(t, etapeId) {
  t.etapes = t.etapes.filter(function (x) { return x.id !== etapeId; });
  apresMutationTache(t, 'etapes');
}

function ajouterAvancementTache(t, texte) {
  var s = String(texte || '').trim();
  if (!s) return null;
  var a = { id: uid('av'), date: aujourdhui(), texte: s, creeLe: new Date().toISOString() };
  t.avancement.push(a);
  apresMutationTache(t, 'avancement');
  return a;
}
function supprimerAvancementTache(t, id) {
  t.avancement = t.avancement.filter(function (x) { return x.id !== id; });
  apresMutationTache(t, 'avancement');
}

function pieceParId(t, id) { return (t.pieces || []).filter(function (p) { return p.id === id; })[0] || null; }
function ajouterPieceCode(t, o) {
  var p = { id: uid('piece'), type: 'code', nom: String(o.nom || '').trim() || 'Extrait', langage: o.langage || 'texte', contenu: String(o.contenu || ''), ajouteLe: new Date().toISOString() };
  t.pieces.push(p);
  apresMutationTache(t, 'pieces');
  return p;
}
function ajouterPieceLien(t, o) {
  var url = String(o.url || '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  var p = { id: uid('piece'), type: 'lien', nom: String(o.nom || '').trim() || url.replace(/^https?:\/\//, ''), url: url, ajouteLe: new Date().toISOString() };
  t.pieces.push(p);
  apresMutationTache(t, 'pieces');
  return p;
}
/* Fichiers : copiés dans le dossier de données (Pieces/<tâche>/) par
   l'application, depuis des chemins ou des fichiers déposés ; sans rien,
   un sélecteur de fichiers s'ouvre. */
function ajouterPiecesFichiers(t, chemins) {
  if (!estApp()) { notifier('Les fichiers joints sont disponibles dans l\'application macOS.'); return Promise.resolve(false); }
  return window.sablier.pieces.ajouter(t.id, chemins || null).then(function (res) {
    if (!res || res.annule) return false;
    if (!res.ok) { notifier('Fichier non joint : ' + (res.message || 'erreur'), { type: 'erreur' }); return false; }
    (res.pieces || []).forEach(function (p) {
      t.pieces.push({ id: uid('piece'), type: 'fichier', nom: p.nom, fichier: p.fichier, taille: p.taille, image: !!p.image, ajouteLe: new Date().toISOString() });
    });
    if (res.erreurs && res.erreurs.length) notifier(res.erreurs.join(' ; '), { type: 'erreur' });
    else if (res.pieces && res.pieces.length) notifier(res.pieces.length > 1 ? res.pieces.length + ' fichiers joints.' : 'Fichier joint : ' + res.pieces[0].nom, { type: 'succes' });
    apresMutationTache(t, 'pieces');
    return true;
  });
}
/* Renvoie une promesse tenue quand la question (pour un fichier) est tranchée. */
function supprimerPieceTache(t, pieceId) {
  var p = pieceParId(t, pieceId);
  if (!p) return Promise.resolve(false);
  var faire = function () {
    if (p.type === 'fichier' && estApp() && p.fichier) window.sablier.pieces.supprimer(p.fichier);
    t.pieces = t.pieces.filter(function (x) { return x.id !== pieceId; });
    apresMutationTache(t, 'pieces');
    return true;
  };
  if (p.type === 'fichier') return confirmer('Retirer « ' + p.nom + ' » de la tâche ? Le fichier ira dans la corbeille.', { ok: 'Retirer', danger: true, titre: 'Retirer une pièce jointe' }).then(function (ok) { return ok ? faire() : false; });
  return Promise.resolve(faire());
}
function ouvrirPieceTache(t, pieceId) {
  var p = pieceParId(t, pieceId);
  if (!p) return;
  if (p.type === 'lien') { if (estApp()) window.sablier.fichiers.ouvrirUrl(p.url); else window.open(p.url, '_blank'); }
  else if (p.type === 'fichier' && estApp()) window.sablier.pieces.ouvrir(p.fichier);
}
function urlPiece(p) { return estApp() && p.fichier ? window.sablier.pieces.url(p.fichier) : ''; }

/* ---------- Fiche d'une tâche ---------- */

function texteAidePriorite(priorite, echeance, statut) {
  var ref = aujourdhui();
  var pe = prioriteEffective({ priorite: priorite, echeance: echeance || null, statut: statut }, ref);
  var niveau = LIBELLES_PRIORITE[pe.niveau].toLowerCase();
  if (pe.origine === 'echeance') return 'Priorité effective : ' + niveau + ', relevée par l\'échéance (' + libelleDelai(joursEntre(ref, echeance)) + '). Un choix manuel n\'est jamais abaissé.';
  if (pe.origine === 'defaut') return 'Sans échéance, la priorité automatique reste basse : donnez une date pour qu\'elle monte toute seule (moins de 5 jours : haute ; jusqu\'à 14 jours : moyenne).';
  return 'Priorité effective : ' + niveau + '.' + (echeance ? ' L\'échéance la relèvera d\'elle-même en approchant.' : '');
}

function champsPrincipauxHtml(v) {
  var optionsPrio = [['auto', 'Automatique, selon l\'échéance'], ['haute', 'Haute'], ['moyenne', 'Moyenne'], ['basse', 'Basse']];
  return champHtml('tcTitre', 'Titre', 'text', v.titre, { attrs: 'placeholder="ex. Campagne pilote sur 20 clients"' })
    + '<div class="grid-4" style="margin-top:12px;">'
    + '<div class="field"><label for="tcStatut">Colonne</label><select id="tcStatut">' + STATUTS_TACHE.map(function (s) { return '<option value="' + s.id + '"' + (s.id === v.statut ? ' selected' : '') + '>' + echapper(s.nom) + '</option>'; }).join('') + '</select></div>'
    + '<div class="field"><label for="tcAxe">Axe</label><select id="tcAxe">' + optionsAxesHtml(v.axe) + '</select></div>'
    + '<div class="field"><label for="tcPriorite">Priorité</label><select id="tcPriorite">' + optionsPrio.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === v.priorite ? ' selected' : '') + '>' + echapper(p[1]) + '</option>'; }).join('') + '</select></div>'
    + champHtml('tcEcheance', 'Échéance', 'date', v.echeance || '')
    + '</div>'
    + '<p class="hint" id="tcPrioAide" style="margin:6px 0 0;">' + echapper(texteAidePriorite(v.priorite, v.echeance, v.statut)) + '</p>'
    + '<div style="margin-top:12px;">' + champHtml('tcDescription', 'Description', 'textarea', v.description, { attrs: 'rows="3"' }) + '</div>';
}

/* Les champs principaux tels qu'ils sont dans la fiche ouverte (pour la
   rouvrir sans perdre la saisie après une boîte de dialogue). */
function brouillonFiche(m) {
  if (!m || !m.querySelector('#tcTitre')) return null;
  return { titre: m.querySelector('#tcTitre').value, statut: m.querySelector('#tcStatut').value, axe: m.querySelector('#tcAxe').value, priorite: m.querySelector('#tcPriorite').value, echeance: m.querySelector('#tcEcheance').value, description: m.querySelector('#tcDescription').value };
}

/* Fiche : les champs principaux s'enregistrent avec le bouton ; les
   sections de suivi (étapes, pièces, notes, avancement) s'enregistrent
   au fil de l'eau. prefill : valeurs de départ d'une nouvelle tâche
   (titre, description, notes liées…) ; brouillon : champs en cours de
   saisie à restaurer par-dessus la tâche. */
function ouvrirEditionTache(id, statutInitial, prefill, brouillon) {
  var t = id ? tacheParId(id) : null;
  if (id && !t) return;
  var v = Object.assign({ titre: '', statut: statutInitial || 'a-faire', axe: axeParDefaut(null), priorite: 'auto', echeance: '', description: '', notes: [] }, prefill || {}, t || {}, brouillon || {});
  if (!axeParId(v.axe)) v.axe = axeParDefaut(v.axe);
  v.priorite = normaliserPriorite(v.priorite);
  var m = ouvrirModale({
    titre: t ? 'Tâche' : 'Nouvelle tâche',
    classe: t ? 'modal-wide modal-fiche' : '',
    sousTitre: t ? [t.creeLe ? 'Créée le ' + libelleDate(String(t.creeLe).slice(0, 10), 'moyen') : '', t.faitLe ? 'terminée le ' + libelleDate(t.faitLe, 'moyen') : '', t.modifieLe ? 'modifiée le ' + libelleDate(String(t.modifieLe).slice(0, 10), 'moyen') : ''].filter(Boolean).join(' · ') : (v.notes && v.notes.length ? 'Liée à la page « ' + ((pageParId(v.notes[0]) || {}).titre || 'Sans titre') + ' »' : ''),
    corps: champsPrincipauxHtml(v) + (t ? '<div class="fiche-sections" id="tcSections">' + sectionsFicheHtml(t) + '</div>' : '<p class="hint" style="margin-top:10px;">Étapes, pièces jointes, notes liées et journal d\'avancement se remplissent dans la fiche, une fois la tâche créée.</p>'),
    pied: (t ? '<button class="btn btn-danger-ligne btn-petit" data-role="supprimer">Supprimer</button>' + (t.statut !== 'fait' ? '<button class="btn btn-or-ligne btn-petit" data-role="chrono">Démarrer le chrono</button>' : '') : '')
      + '<div class="a-droite"><button class="btn btn-ghost" data-role="annuler">' + (t ? 'Fermer' : 'Annuler') + '</button><button class="btn" data-role="ok">' + (t ? 'Enregistrer' : 'Créer la tâche') + '</button></div>',
  });
  var modale = m.querySelector('.modal');
  if (t) modale.dataset.tache = t.id;
  var majAide = function () {
    m.querySelector('#tcPrioAide').textContent = texteAidePriorite(m.querySelector('#tcPriorite').value, m.querySelector('#tcEcheance').value, m.querySelector('#tcStatut').value);
  };
  m.querySelector('#tcStatut').addEventListener('change', majAide);
  m.querySelector('#tcPriorite').addEventListener('change', majAide);
  m.querySelector('#tcEcheance').addEventListener('change', majAide);
  m.querySelector('[data-role=annuler]').addEventListener('click', fermerModale);
  var sup = m.querySelector('[data-role=supprimer]');
  if (sup) sup.addEventListener('click', function () { supprimerTache(t.id, brouillonFiche(m)); });
  var chr = m.querySelector('[data-role=chrono]');
  if (chr) chr.addEventListener('click', function () { fermerModale(); demarrerChrono({ axe: t.axe, intervention: t.titre, tache: t.id }); });
  m.querySelector('[data-role=ok]').addEventListener('click', function () {
    var titre = m.querySelector('#tcTitre').value.trim();
    if (!titre) { m.querySelector('#tcTitre').classList.add('invalide'); m.querySelector('#tcTitre').focus(); return; }
    var statut = m.querySelector('#tcStatut').value;
    if (!t) {
      var n = creerTache({ titre: titre, statut: statut, axe: m.querySelector('#tcAxe').value, priorite: m.querySelector('#tcPriorite').value, echeance: m.querySelector('#tcEcheance').value || null, description: m.querySelector('#tcDescription').value, notes: v.notes });
      fermerModale();
      rafraichir();
      notifier('Tâche créée : « ' + n.titre + ' ».', { type: 'succes', action: { libelle: 'Ouvrir la fiche', fn: function () { ouvrirEditionTache(n.id); } } });
      return;
    }
    var ancien = t.statut;
    t.titre = titre;
    t.axe = m.querySelector('#tcAxe').value;
    t.priorite = normaliserPriorite(m.querySelector('#tcPriorite').value);
    t.echeance = m.querySelector('#tcEcheance').value || null;
    t.description = m.querySelector('#tcDescription').value.trim();
    if (ancien !== statut) { appliquerStatut(t, statut); t.ordre = ordreSuivant(statut); }
    t.modifieLe = new Date().toISOString();
    sauver('chantiers');
    fermerModale();
    rafraichir();
    notifier('Tâche enregistrée.', { type: 'succes' });
  });
  m.querySelector('#tcTitre').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); m.querySelector('[data-role=ok]').click(); } });
  if (t) brancherSectionsFiche(m, t);
}

/* ---------- Sections de la fiche ---------- */

function sectionsFicheHtml(t) {
  return sectionEtapesHtml(t) + sectionPiecesHtml(t) + sectionNotesHtml(t) + sectionAvancementHtml(t) + sectionTempsHtml(t);
}
function sectionHtml(nom, titre, compteur, actions, corps) {
  return '<section class="fiche-section" data-section="' + nom + '"><div class="fiche-section-entete"><h4>' + echapper(titre) + (compteur ? ' <span class="nb">' + echapper(compteur) + '</span>' : '') + '</h4><div class="actions">' + (actions || '') + '</div></div><div class="fiche-section-corps">' + corps + '</div></section>';
}
/* Redessine une section en conservant ce qui était en cours de frappe
   dans ses champs (et le focus). */
function rafraichirSectionFiche(m, t, nom) {
  var ancienne = m.querySelector('.fiche-section[data-section="' + nom + '"]');
  if (!ancienne) return;
  var conserves = {};
  var actif = document.activeElement && document.activeElement.id && ancienne.contains(document.activeElement) ? document.activeElement.id : null;
  Array.prototype.forEach.call(ancienne.querySelectorAll('input[type=text][id], textarea[id]'), function (el) { if (el.value) conserves[el.id] = el.value; });
  var html = { etapes: sectionEtapesHtml, pieces: sectionPiecesHtml, notes: sectionNotesHtml, avancement: sectionAvancementHtml, temps: sectionTempsHtml }[nom](t);
  var tmp = document.createElement('div');
  tmp.innerHTML = html;
  var nouvelle = tmp.firstElementChild;
  ancienne.replaceWith(nouvelle);
  Object.keys(conserves).forEach(function (id) { var el = nouvelle.querySelector('#' + id); if (el) el.value = conserves[id]; });
  if (actif) { var f = nouvelle.querySelector('#' + actif); if (f) f.focus(); }
}

function sectionEtapesHtml(t) {
  var etapes = t.etapes || [];
  var faites = etapesFaites(t);
  var corps = (etapes.length ? '<ul class="etapes">' + etapes.map(function (e) {
    return '<li class="etape' + (e.fait ? ' fait' : '') + '" data-etape="' + echapper(e.id) + '"><input type="checkbox" data-fiche="etape-basculer" data-id="' + echapper(e.id) + '"' + (e.fait ? ' checked' : '') + '><span class="etape-texte" data-fiche="etape-modifier" data-id="' + echapper(e.id) + '" title="Cliquer pour modifier">' + echapper(e.texte) + '</span>' + boutonIcone('etape-supprimer', 'corbeille', 'Retirer l\'étape', 'danger', e.id).replace('data-action=', 'data-fiche=') + '</li>';
  }).join('') + '</ul>' : '')
    + (etapes.length ? '<div class="kb-progres" style="margin:8px 0 10px;"><span style="width:' + Math.round(100 * faites / etapes.length) + '%"></span></div>' : '')
    + '<div class="etape-ajout"><input type="text" id="tcNouvelleEtape" class="champ" placeholder="Nouvelle étape, puis Entrée"><button type="button" class="btn btn-ghost btn-petit" data-fiche="etape-ajouter">Ajouter</button></div>';
  return sectionHtml('etapes', 'Étapes', etapes.length ? faites + '/' + etapes.length : '', '', corps);
}

function pieceHtml(t, p) {
  var quand = p.ajouteLe ? libelleDate(p.ajouteLe.slice(0, 10), 'moyen') : '';
  if (p.type === 'code') {
    return '<div class="piece piece-code" data-piece="' + echapper(p.id) + '"><div class="piece-entete">' + icone('code', 14) + '<b>' + echapper(p.nom) + '</b><span class="petit">' + echapper(p.langage || 'texte') + (quand ? ' · ' + quand : '') + '</span>'
      + '<span class="piece-actions">' + boutonIcone('piece-copier', 'copie', 'Copier le code', '', p.id).replace('data-action=', 'data-fiche=') + boutonIcone('piece-modifier', 'crayon', 'Modifier', '', p.id).replace('data-action=', 'data-fiche=') + boutonIcone('piece-supprimer', 'corbeille', 'Retirer', 'danger', p.id).replace('data-action=', 'data-fiche=') + '</span></div>'
      + '<pre><code>' + echapper(p.contenu) + '</code></pre></div>';
  }
  if (p.type === 'lien') {
    return '<div class="piece piece-ligne" data-piece="' + echapper(p.id) + '">' + icone('externe', 15) + '<button type="button" class="lien piece-nom" data-fiche="piece-ouvrir" data-id="' + echapper(p.id) + '" title="' + echapper(p.url) + '">' + echapper(p.nom) + '</button><span class="petit piece-sous">' + echapper(p.url) + '</span>'
      + '<span class="piece-actions">' + boutonIcone('piece-modifier', 'crayon', 'Modifier', '', p.id).replace('data-action=', 'data-fiche=') + boutonIcone('piece-supprimer', 'corbeille', 'Retirer', 'danger', p.id).replace('data-action=', 'data-fiche=') + '</span></div>';
  }
  if (p.image) {
    return '<div class="piece piece-image" data-piece="' + echapper(p.id) + '"><button type="button" class="piece-vignette" data-fiche="piece-ouvrir" data-id="' + echapper(p.id) + '" title="Ouvrir ' + echapper(p.nom) + '"><img src="' + echapper(urlPiece(p)) + '" alt="' + echapper(p.nom) + '"></button>'
      + '<div class="piece-legende"><span class="piece-nom" title="' + echapper(p.nom) + '">' + echapper(p.nom) + '</span><span class="piece-actions">' + boutonIcone('piece-reveler', 'dossier', 'Afficher dans le Finder', '', p.id).replace('data-action=', 'data-fiche=') + boutonIcone('piece-supprimer', 'corbeille', 'Retirer', 'danger', p.id).replace('data-action=', 'data-fiche=') + '</span></div></div>';
  }
  return '<div class="piece piece-ligne" data-piece="' + echapper(p.id) + '">' + icone('fichier', 15) + '<button type="button" class="lien piece-nom" data-fiche="piece-ouvrir" data-id="' + echapper(p.id) + '">' + echapper(p.nom) + '</button><span class="petit piece-sous">' + (p.taille ? fmtTaille(p.taille) : '') + (quand ? ' · ' + quand : '') + '</span>'
    + '<span class="piece-actions">' + boutonIcone('piece-reveler', 'dossier', 'Afficher dans le Finder', '', p.id).replace('data-action=', 'data-fiche=') + boutonIcone('piece-supprimer', 'corbeille', 'Retirer', 'danger', p.id).replace('data-action=', 'data-fiche=') + '</span></div>';
}
function sectionPiecesHtml(t) {
  var pieces = t.pieces || [];
  var images = pieces.filter(function (p) { return p.type === 'fichier' && p.image; });
  var autres = pieces.filter(function (p) { return !(p.type === 'fichier' && p.image); });
  var actions = '<button type="button" class="btn btn-ghost btn-petit" data-fiche="piece-fichier">' + icone('trombone', 13) + ' Fichier ou image…</button>'
    + '<button type="button" class="btn btn-ghost btn-petit" data-fiche="piece-lien">' + icone('externe', 13) + ' Lien</button>'
    + '<button type="button" class="btn btn-ghost btn-petit" data-fiche="piece-code">' + icone('code', 13) + ' Code</button>';
  var corps = (images.length ? '<div class="pieces-grille">' + images.map(function (p) { return pieceHtml(t, p); }).join('') + '</div>' : '')
    + (autres.length ? '<div class="pieces-liste">' + autres.map(function (p) { return pieceHtml(t, p); }).join('') + '</div>' : '')
    + (!pieces.length ? '<div class="fiche-vide">Glissez des fichiers ou des images ici, ou ajoutez un lien, un extrait de code.</div>' : '<div class="hint" style="margin-top:6px;">Vous pouvez aussi glisser des fichiers depuis le Finder sur cette fiche.</div>');
  return sectionHtml('pieces', 'Pièces jointes', pieces.length ? String(pieces.length) : '', actions, corps);
}

function sectionNotesHtml(t) {
  var pages = (t.notes || []).map(pageParId).filter(Boolean);
  var actions = '<button type="button" class="btn btn-ghost btn-petit" data-fiche="note-lier">' + icone('lien', 13) + ' Lier une page…</button>'
    + '<button type="button" class="btn btn-ghost btn-petit" data-fiche="note-nouvelle">' + icone('note', 13) + ' Nouvelle page liée</button>';
  var corps = pages.length ? '<div class="notes-liees">' + pages.map(function (p) {
    var chemin = cheminDe(p.id).slice(0, -1).map(function (x) { return x.titre || 'Sans titre'; }).join(' › ');
    return '<div class="chip-note"><button type="button" class="chip-note-ouvrir" data-fiche="note-ouvrir" data-id="' + echapper(p.id) + '" title="Ouvrir la page">' + icone('note', 14) + '<span>' + (chemin ? '<span class="petit">' + echapper(chemin) + ' › </span>' : '') + echapper(p.titre || 'Sans titre') + '</span></button>' + boutonIcone('note-delier', 'corbeille', 'Retirer le lien (la page reste)', 'danger', p.id).replace('data-action=', 'data-fiche=') + '</div>';
  }).join('') + '</div>' : '<div class="fiche-vide">Aucune page liée. Une page de notes peut porter le détail, les comptes rendus, les décisions.</div>';
  return sectionHtml('notes', 'Notes liées', pages.length ? String(pages.length) : '', actions, corps);
}

function sectionAvancementHtml(t) {
  var liste = trierPar(t.avancement || [], function (a) { return (a.date || '') + (a.creeLe || ''); }, true);
  var corps = '<div class="avancement-ajout"><textarea id="tcAvancement" rows="2" placeholder="Où en est-on ? Un point daté, en une ou deux phrases (⌘ Entrée pour ajouter)."></textarea><button type="button" class="btn btn-ghost btn-petit" data-fiche="avancement-ajouter">Ajouter le point</button></div>'
    + (liste.length ? '<div class="avancement">' + liste.map(function (a) {
      return '<div class="avancement-entree"><div class="avancement-date">' + echapper(libelleDate(a.date, 'moyen')) + '</div><div class="avancement-texte">' + echapper(a.texte).replace(/\n/g, '<br>') + '</div>' + boutonIcone('avancement-supprimer', 'corbeille', 'Retirer ce point', 'danger', a.id).replace('data-action=', 'data-fiche=') + '</div>';
    }).join('') + '</div>' : '');
  return sectionHtml('avancement', 'Journal d\'avancement', liste.length ? String(liste.length) : '', '', corps);
}

function sectionTempsHtml(t) {
  var temps = minutesTache(entreesJournal(), t.id);
  var c = chronoEnCours();
  var enCours = c && c.tache === t.id;
  var lignes = trierPar(entreesJournal().filter(function (e) { return e.tache === t.id; }), function (e) { return e.date + (e.debut || ''); }, true).slice(0, 5);
  var corps = '<div class="temps-resume"><b>' + fmtDuree(temps.minutes) + '</b> <span class="petit">sur ' + temps.lignes + (temps.lignes > 1 ? ' lignes du journal' : ' ligne du journal') + (enCours ? ' · chrono en cours' : '') + '</span></div>'
    + (lignes.length ? '<ul class="temps-lignes">' + lignes.map(function (e) { return '<li><span class="date">' + libelleDate(e.date, 'jour') + '</span><span class="titre">' + echapper(e.intervention) + (e.detail ? ' <span class="petit">' + echapper(e.detail) + '</span>' : '') + '</span><span class="num">' + fmtDuree(dureeEntree(e)) + '</span></li>'; }).join('') + '</ul>' : '<div class="fiche-vide">Aucune ligne du journal ne cite cette tâche. Le chrono lancé depuis la carte les rattache tout seul.</div>');
  return sectionHtml('temps', 'Temps passé', '', (t.statut !== 'fait' && !enCours ? '<button type="button" class="btn btn-or-ligne btn-petit" data-fiche="chrono">' + icone('play', 12) + ' Chrono</button>' : ''), corps);
}

function brancherSectionsFiche(m, t) {
  m.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-fiche]');
    if (!b || b.tagName === 'INPUT') return;
    var a = b.dataset.fiche, id = b.dataset.id;
    if (a === 'etape-ajouter') { var inp = m.querySelector('#tcNouvelleEtape'); var texteEtape = inp.value; inp.value = ''; if (ajouterEtapeTache(t, texteEtape)) { var i2 = m.querySelector('#tcNouvelleEtape'); if (i2) { i2.value = ''; i2.focus(); } } else inp.value = texteEtape; }
    else if (a === 'etape-supprimer') supprimerEtapeTache(t, id);
    else if (a === 'etape-modifier') {
      var e = t.etapes.filter(function (x) { return x.id === id; })[0];
      var br = brouillonFiche(m);
      if (e) demander({ titre: 'Modifier l\'étape', libelle: 'Étape', valeur: e.texte, ok: 'Enregistrer' }).then(function (v) { if (v != null) modifierEtapeTache(t, id, v); ouvrirEditionTache(t.id, null, null, br); });
    }
    else if (a === 'piece-fichier') ajouterPiecesFichiers(t, null);
    else if (a === 'piece-lien') ouvrirEditionLien(t, null, brouillonFiche(m));
    else if (a === 'piece-code') ouvrirEditionCode(t, null, brouillonFiche(m));
    else if (a === 'piece-modifier') { var p = pieceParId(t, id); if (p && p.type === 'code') ouvrirEditionCode(t, p.id, brouillonFiche(m)); else if (p && p.type === 'lien') ouvrirEditionLien(t, p.id, brouillonFiche(m)); }
    else if (a === 'piece-copier') { var pc = pieceParId(t, id); if (pc && navigator.clipboard) navigator.clipboard.writeText(pc.contenu || '').then(function () { notifier('Code copié.'); }); }
    else if (a === 'piece-ouvrir') ouvrirPieceTache(t, id);
    else if (a === 'piece-reveler') { var pr = pieceParId(t, id); if (pr && estApp() && pr.fichier) window.sablier.pieces.reveler(pr.fichier); }
    else if (a === 'piece-supprimer') { var pS = pieceParId(t, id); if (pS && pS.type === 'fichier') { var brS = brouillonFiche(m); supprimerPieceTache(t, id).then(function () { ouvrirEditionTache(t.id, null, null, brS); }); } else supprimerPieceTache(t, id); }
    else if (a === 'note-lier') menuChoixPage(b, t.notes || [], function (pageId) { lierTacheANote(t.id, pageId); apresMutationTache(t, 'notes'); });
    else if (a === 'note-nouvelle') {
      var page = creerPageNotesSilencieuse(t.titre, null);
      lierTacheANote(t.id, page.id);
      apresMutationTache(t, 'notes');
      notifier('Page « ' + page.titre + ' » créée et liée.', { type: 'succes', action: { libelle: 'Ouvrir', fn: function () { fermerModale(); ouvrirPageNotes(page.id); } } });
    }
    else if (a === 'note-ouvrir') { fermerModale(); ouvrirPageNotes(id); }
    else if (a === 'note-delier') { delierTacheDeNote(t.id, id); apresMutationTache(t, 'notes'); }
    else if (a === 'avancement-ajouter') { var ta = m.querySelector('#tcAvancement'); var textePoint = ta.value; ta.value = ''; if (ajouterAvancementTache(t, textePoint)) { var ta2 = m.querySelector('#tcAvancement'); if (ta2) { ta2.value = ''; ta2.focus(); } } else ta.value = textePoint; }
    else if (a === 'avancement-supprimer') supprimerAvancementTache(t, id);
    else if (a === 'chrono') { fermerModale(); demarrerChrono({ axe: t.axe, intervention: t.titre, tache: t.id }); }
  });
  m.addEventListener('change', function (ev) {
    var c = ev.target.closest('input[type=checkbox][data-fiche=etape-basculer]');
    if (c) basculerEtapeTache(t, c.dataset.id, c.checked);
  });
  m.addEventListener('keydown', function (ev) {
    if (ev.target.id === 'tcNouvelleEtape' && ev.key === 'Enter') { ev.preventDefault(); var texteE = ev.target.value; ev.target.value = ''; if (ajouterEtapeTache(t, texteE)) { var i2 = m.querySelector('#tcNouvelleEtape'); if (i2) { i2.value = ''; i2.focus(); } } else ev.target.value = texteE; }
    if (ev.target.id === 'tcAvancement' && ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); var texteP = ev.target.value; ev.target.value = ''; if (ajouterAvancementTache(t, texteP)) { var ta3 = m.querySelector('#tcAvancement'); if (ta3) { ta3.value = ''; ta3.focus(); } } else ev.target.value = texteP; }
  });
  /* Glisser des fichiers du Finder sur la fiche. */
  ['dragenter', 'dragover'].forEach(function (type) {
    m.addEventListener(type, function (ev) {
      if (!ev.dataTransfer || Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') < 0) return;
      ev.preventDefault();
      m.querySelector('.modal').classList.add('depot');
    });
  });
  m.addEventListener('dragleave', function (ev) { if (!m.querySelector('.modal').contains(ev.relatedTarget)) m.querySelector('.modal').classList.remove('depot'); });
  m.addEventListener('drop', function (ev) {
    m.querySelector('.modal').classList.remove('depot');
    if (!ev.dataTransfer || !ev.dataTransfer.files || !ev.dataTransfer.files.length) return;
    ev.preventDefault();
    if (!estApp()) { notifier('Les fichiers joints sont disponibles dans l\'application macOS.'); return; }
    ajouterPiecesFichiers(t, Array.prototype.slice.call(ev.dataTransfer.files));
  });
}

/* Petites modales d'édition d'un lien ou d'un extrait de code. Elles
   remplacent la fiche à l'écran puis la rouvrent. */
function ouvrirEditionLien(t, pieceId, brouillon) {
  var p = pieceId ? pieceParId(t, pieceId) : null;
  var m = ouvrirModale({
    titre: p ? 'Modifier le lien' : 'Ajouter un lien',
    classe: 'modal-etroite',
    corps: champHtml('plUrl', 'Adresse', 'url', p ? p.url : '', { attrs: 'placeholder="https://…"' }) + '<div style="margin-top:10px;">' + champHtml('plNom', 'Libellé (facultatif)', 'text', p ? p.nom : '') + '</div>',
    pied: '<div class="a-droite"><button class="btn btn-ghost" data-role="annuler">Annuler</button><button class="btn" data-role="ok">' + (p ? 'Enregistrer' : 'Ajouter') + '</button></div>',
    auFermer: function () { ouvrirEditionTache(t.id, null, null, brouillon); },
  });
  var valider = function () {
    var url = m.querySelector('#plUrl').value.trim();
    if (!url) { m.querySelector('#plUrl').classList.add('invalide'); return; }
    m._auFermer = null;
    fermerModale();
    if (p) { p.url = /^https?:\/\//i.test(url) ? url : 'https://' + url; p.nom = m.querySelector('#plNom').value.trim() || p.url.replace(/^https?:\/\//, ''); t.modifieLe = new Date().toISOString(); sauver('chantiers'); }
    else ajouterPieceLien(t, { url: url, nom: m.querySelector('#plNom').value });
    ouvrirEditionTache(t.id, null, null, brouillon);
  };
  m.querySelector('[data-role=annuler]').addEventListener('click', fermerModale);
  m.querySelector('[data-role=ok]').addEventListener('click', valider);
  m.querySelectorAll('input').forEach(function (i) { i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); valider(); } }); });
}
function ouvrirEditionCode(t, pieceId, brouillon) {
  var p = pieceId ? pieceParId(t, pieceId) : null;
  var m = ouvrirModale({
    titre: p ? 'Modifier l\'extrait de code' : 'Ajouter un extrait de code',
    classe: 'modal-wide',
    corps: '<div class="grid-2">' + champHtml('pcNom', 'Titre', 'text', p ? p.nom : '', { attrs: 'placeholder="ex. requête de contrôle"' })
      + '<div class="field"><label for="pcLangage">Langage</label><select id="pcLangage">' + LANGAGES_CODE.map(function (l) { return '<option value="' + l + '"' + (p && p.langage === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select></div></div>'
      + '<div class="field" style="margin-top:10px;"><label for="pcContenu">Code</label><textarea id="pcContenu" class="code" rows="12" spellcheck="false">' + echapper(p ? p.contenu : '') + '</textarea></div>',
    pied: '<div class="a-droite"><button class="btn btn-ghost" data-role="annuler">Annuler</button><button class="btn" data-role="ok">' + (p ? 'Enregistrer' : 'Ajouter') + '</button></div>',
    auFermer: function () { ouvrirEditionTache(t.id, null, null, brouillon); },
  });
  m.querySelector('#pcContenu').addEventListener('keydown', function (ev) {
    if (ev.key === 'Tab') { ev.preventDefault(); document.execCommand('insertText', false, '  '); }
  });
  m.querySelector('[data-role=annuler]').addEventListener('click', fermerModale);
  m.querySelector('[data-role=ok]').addEventListener('click', function () {
    var contenu = m.querySelector('#pcContenu').value;
    if (!contenu.trim()) { m.querySelector('#pcContenu').classList.add('invalide'); return; }
    m._auFermer = null;
    fermerModale();
    if (p) { p.nom = m.querySelector('#pcNom').value.trim() || p.nom; p.langage = m.querySelector('#pcLangage').value; p.contenu = contenu; t.modifieLe = new Date().toISOString(); sauver('chantiers'); }
    else ajouterPieceCode(t, { nom: m.querySelector('#pcNom').value, langage: m.querySelector('#pcLangage').value, contenu: contenu });
    ouvrirEditionTache(t.id, null, null, brouillon);
  });
}

/* ---------- Glisser-déposer au pointeur ----------
   La carte saisie quitte sa colonne et flotte sous le pointeur avec un
   léger balancement (inclinaison liée à la vitesse). Un emplacement vide
   se déplace dans les colonnes pour montrer où elle se posera ; les autres
   cartes glissent pour lui faire place. Un simple clic ouvre la fiche. */

function debutPointeurTaches(ev) {
  if (ev.button !== 0 || GLISSER) return;
  if (ev.target.closest('button, input, select, textarea, a')) return;
  var carte = ev.target.closest('.kb-carte');
  if (!carte) return;
  GLISSER = { carte: carte, id: carte.dataset.id, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, actif: false, vx: 0, angle: 0, dernierX: ev.clientX, dernierT: performance.now() };
  document.addEventListener('pointermove', mouvementPointeurTaches);
  document.addEventListener('pointerup', finPointeurTaches);
  document.addEventListener('pointercancel', finPointeurTaches);
}

function demarrerGlisser() {
  var g = GLISSER;
  var carte = g.carte;
  var r = carte.getBoundingClientRect();
  g.actif = true;
  g.gauche0 = r.left;
  g.haut0 = r.top;
  g.placeholder = document.createElement('div');
  g.placeholder.className = 'kb-placeholder';
  g.placeholder.style.height = r.height + 'px';
  carte.parentNode.insertBefore(g.placeholder, carte);
  carte.classList.add('kb-flottante');
  carte.style.width = r.width + 'px';
  carte.style.left = r.left + 'px';
  carte.style.top = r.top + 'px';
  document.body.appendChild(carte);
  document.body.classList.add('kb-glisser-actif');
  marquerColonneSurvolee(g.placeholder.closest('.kb-colonne'));
  g.angle = -2.5;
  g.raf = requestAnimationFrame(animerGlisser);
}

function animerGlisser() {
  var g = GLISSER;
  if (!g || !g.actif) return;
  var cible = Math.max(-9, Math.min(9, g.vx * 28));
  g.angle += (cible - g.angle) * 0.18;
  g.vx *= 0.82;
  g.carte.style.transform = 'translate(' + (g.x - g.x0).toFixed(1) + 'px, ' + (g.y - g.y0).toFixed(1) + 'px) rotate(' + g.angle.toFixed(2) + 'deg) scale(1.03)';
  g.raf = requestAnimationFrame(animerGlisser);
}

function mouvementPointeurTaches(ev) {
  var g = GLISSER;
  if (!g) return;
  if (!g.actif) {
    if (Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < 6) return;
    demarrerGlisser();
  }
  ev.preventDefault();
  var maintenant = performance.now();
  var dt = Math.max(1, maintenant - g.dernierT);
  g.vx = (ev.clientX - g.dernierX) / dt;
  g.dernierX = ev.clientX;
  g.dernierT = maintenant;
  g.x = ev.clientX;
  g.y = ev.clientY;
  placerEmplacement(ev.clientX, ev.clientY);
}

/* Déplace l'emplacement vide dans la colonne survolée, entre les cartes
   selon la hauteur du pointeur, et fait glisser les cartes voisines. */
function placerEmplacement(x, y) {
  var g = GLISSER;
  var sous = document.elementFromPoint(x, y);
  var col = sous && sous.closest ? sous.closest('.kb-colonne') : null;
  if (!col) return;
  var cartes = Array.prototype.filter.call(col.querySelectorAll('.kb-carte'), function (c) { return c !== g.carte; });
  var avant = null;
  for (var i = 0; i < cartes.length; i++) {
    var r = cartes[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) { avant = cartes[i]; break; }
  }
  var repere = avant || col.querySelector('.kb-ajout');
  marquerColonneSurvolee(col);
  if (g.placeholder.parentNode === col && g.placeholder.nextElementSibling === repere) return;
  var toutes = Array.prototype.slice.call(document.querySelectorAll('.kb-colonne .kb-carte'));
  var avantRects = toutes.map(function (c) { return c.getBoundingClientRect(); });
  toutes.forEach(function (c) { c.style.transition = 'none'; c.style.transform = ''; });
  col.insertBefore(g.placeholder, repere);
  var bouge = [];
  toutes.forEach(function (c, i) {
    var a = avantRects[i], b = c.getBoundingClientRect();
    var dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    c.style.transform = 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
    bouge.push(c);
  });
  document.body.getBoundingClientRect();
  bouge.forEach(function (c) { c.style.transition = 'transform 200ms var(--ease-out)'; c.style.transform = ''; });
}

function marquerColonneSurvolee(col) {
  document.querySelectorAll('.kb-colonne.survol').forEach(function (c) { if (c !== col) c.classList.remove('survol'); });
  if (col) col.classList.add('survol');
}

function finPointeurTaches(ev) {
  var g = GLISSER;
  if (!g) return;
  document.removeEventListener('pointermove', mouvementPointeurTaches);
  document.removeEventListener('pointerup', finPointeurTaches);
  document.removeEventListener('pointercancel', finPointeurTaches);
  if (!g.actif) {
    GLISSER = null;
    if (ev.type === 'pointerup') ouvrirEditionTache(g.id);
    return;
  }
  cancelAnimationFrame(g.raf);
  var col = g.placeholder.closest('.kb-colonne');
  var statut = col ? col.dataset.statut : null;
  var suivant = g.placeholder.nextElementSibling;
  while (suivant && !suivant.classList.contains('kb-carte')) suivant = suivant.nextElementSibling;
  var avantId = suivant ? suivant.dataset.id : null;
  var pr = g.placeholder.getBoundingClientRect();
  var id = g.id;
  g.carte.style.transition = 'transform 170ms var(--ease-out)';
  g.carte.style.transform = 'translate(' + (pr.left - g.gauche0).toFixed(1) + 'px, ' + (pr.top - g.haut0).toFixed(1) + 'px) rotate(0deg) scale(1)';
  setTimeout(function () {
    nettoyerGlisser();
    var t = tacheParId(id);
    if (t && statut) deplacerTache(t, statut, avantId); else rendreColonnesTaches(false);
  }, 180);
}

function nettoyerGlisser() {
  var g = GLISSER;
  GLISSER = null;
  if (!g) return;
  cancelAnimationFrame(g.raf);
  document.removeEventListener('pointermove', mouvementPointeurTaches);
  document.removeEventListener('pointerup', finPointeurTaches);
  document.removeEventListener('pointercancel', finPointeurTaches);
  document.body.classList.remove('kb-glisser-actif');
  if (g.placeholder && g.placeholder.parentNode) g.placeholder.remove();
  if (g.carte) { g.carte.classList.remove('kb-flottante'); g.carte.style.cssText = ''; g.carte.remove(); }
  document.querySelectorAll('.kb-colonne.survol').forEach(function (c) { c.classList.remove('survol'); });
  document.querySelectorAll('.kb-colonne .kb-carte').forEach(function (c) { c.style.transform = ''; c.style.transition = ''; });
}

function annulerGlisser() {
  nettoyerGlisser();
  rendreColonnesTaches(false);
}
