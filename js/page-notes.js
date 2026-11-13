/* ============================================================
   NOTES PAGE: hierarchical pages and continuous editor.

   A page is written in one go, as in Apple Notes: a single text area
   where Enter simply starts a new line, with no blocks or handles. Each
   line keeps a style (text, headings, lists, checkbox, idea, quote,
   callout, divider), chosen from the toolbar, with the keyboard, with
   "/" or with Markdown shortcuts. On disk, the page stays a list of
   blocks {id, type, html, coche, tache, retrait}: one line = one block.

   Pasted or dropped text always arrives unformatted. Undo and redo
   follow a history of their own, kept by the editor.

   Notes and tasks refer to each other: a page shows the tasks linked to
   it; an idea (or any line) becomes a task in the To do column in one
   click, and keeps the link.
   ============================================================ */
'use strict';

var TYPES_BLOC = [
  { type: 'p', nom: 'Text', sous: 'Plain body text', ic: 'T', raccourci: 'Ctrl+Alt+0' },
  { type: 'h1', nom: 'Heading 1', sous: 'Large section heading', ic: 'H1', raccourci: 'Ctrl+Alt+1' },
  { type: 'h2', nom: 'Heading 2', sous: 'Subheading', ic: 'H2', raccourci: 'Ctrl+Alt+2' },
  { type: 'h3', nom: 'Heading 3', sous: 'Small heading', ic: 'H3', raccourci: 'Ctrl+Alt+3' },
  { type: 'puce', nom: 'Bulleted list', sous: 'Enter continues the list', ic: '•', raccourci: 'Ctrl+Shift+7' },
  { type: 'numero', nom: 'Numbered list', sous: 'Automatic numbering', ic: '1.', raccourci: 'Ctrl+Shift+9' },
  { type: 'case', nom: 'Checkbox', sous: 'Something to do', ic: '○', raccourci: 'Ctrl+Shift+L' },
  { type: 'idee', nom: 'Idea', sous: 'To sort, can become a task', ic: '✦' },
  { type: 'citation', nom: 'Quote', sous: 'Indented text, navy rule', ic: '“', raccourci: 'Ctrl+\'' },
  { type: 'encadre', nom: 'Callout', sous: 'Important point, gold rule', ic: '!' },
  { type: 'separateur', nom: 'Divider', sous: 'A horizontal line', ic: '···' },
];
var LISTES = ['puce', 'numero', 'case'];
var CONTINUES = ['puce', 'numero', 'case', 'citation', 'encadre'];   // Enter keeps the style
var AVEC_RETRAIT = ['p', 'puce', 'numero', 'case'];
var RETRAIT_MAX = 4;
var BALISES_LIGNE = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, CODE: 1, A: 1, BR: 1, MARK: 1 };
var NOTES_PAGE = null;
var NOTES_RECHERCHE = '';
var NOTES_PLIES = {};
var MENU_SLASH = null;       // {ligne, filtre, selection}
var HISTO = { pile: [], index: -1, nature: '', debut: 0, derniere: 0 };
var HISTO_CLAVIER = 0;       // time of the last Ctrl+Z handled from the keyboard (avoids a duplicate from the Edit menu)
var notesSauverDiffere = debounce(function () { sauver('notes'); }, 400);
var notesSerialiserDiffere = debounce(function () { serialiserDoc(); }, 200);

function initNotes() {
  PAGES.notes = rendreNotes;
  var zone = document.getElementById('notesContenu');
  zone.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-action]');
    if (!b) return;
    var a = b.dataset.action, id = b.dataset.id;
    if (a === 'ouvrir') { NOTES_PAGE = id; rendreNotes(); }
    else if (a === 'plier') { ev.stopPropagation(); NOTES_PLIES[id] = !NOTES_PLIES[id]; rendreRailNotes(); }
    else if (a === 'nouvelle-page') creerPageNotes(null);
    else if (a === 'sous-page') creerPageNotes(NOTES_PAGE);
    else if (a === 'supprimer-page') supprimerPageNotes(NOTES_PAGE);
    else if (a === 'deplacer-page') deplacerPageNotes(NOTES_PAGE, b);
    else if (a === 'tache') ouvrirEditionTache(id);
    else if (a === 'lier-tache') menuLierTache(b);
    else if (a === 'nouvelle-tache') ouvrirEditionTache(null, 'a-faire', { notes: [NOTES_PAGE] });
  });
  zone.addEventListener('input', function (ev) {
    if (ev.target.id === 'ntRecherche') { NOTES_RECHERCHE = ev.target.value; rendreRailNotes(); }
    else if (ev.target.id === 'ntTitre') {
      var p = pageParId(NOTES_PAGE);
      if (!p) return;
      p.titre = ev.target.textContent.replace(/\n/g, ' ').trim();
      p.modifieLe = new Date().toISOString();
      var item = zone.querySelector('.nt-item[data-id="' + NOTES_PAGE + '"] .nom');
      if (item) item.textContent = p.titre || 'Untitled';
      var fil = zone.querySelector('#ntFilCourant');
      if (fil) fil.textContent = p.titre || 'Untitled';
      notesSauverDiffere();
    }
  });
  /* From the title, Enter, Tab or Down move into the page. */
  zone.addEventListener('keydown', function (ev) {
    if (ev.target.id !== 'ntTitre' || ev.isComposing) return;
    if (ev.key === 'Enter' || (ev.key === 'Tab' && !ev.shiftKey) || (ev.key === 'ArrowDown' && caretALaFin(ev.target))) {
      ev.preventDefault();
      var doc = docNotes();
      var premiere = doc && lignesDe(doc).filter(function (l) { return l.dataset.type !== 'separateur'; })[0];
      if (premiere) placerCaret(premiere, true);
    }
  });
  /* The title only accepts text, on a single line. */
  zone.addEventListener('paste', function (ev) {
    if (!ev.target.closest || !ev.target.closest('#ntTitre')) return;
    ev.preventDefault();
    var t = texteColle(ev).replace(/\s*\n\s*/g, ' ').trim();
    if (t) document.execCommand('insertText', false, t);
  });
  document.addEventListener('selectionchange', function () { if (PAGE_COURANTE === 'notes') majEtatEditeur(); });
  /* The last keystrokes are written to disk before closing. */
  window.addEventListener('pagehide', function () { notesSerialiserDiffere.flush(); notesSauverDiffere.flush(); });
}

function pageParId(id) { return pagesNotes().filter(function (p) { return p.id === id; })[0] || null; }
function enfantsDe(id) {
  return trierPar(pagesNotes().filter(function (p) { return (p.parent || null) === (id || null); }), function (p) { return String(p.ordre || 0).padStart(6, '0') + (p.titre || ''); });
}
function descendantsDe(id) {
  var out = [];
  enfantsDe(id).forEach(function (e) { out.push(e); out = out.concat(descendantsDe(e.id)); });
  return out;
}
function cheminDe(id) {
  var chemin = [];
  var p = pageParId(id);
  var garde = 0;
  while (p && garde++ < 20) { chemin.unshift(p); p = p.parent ? pageParId(p.parent) : null; }
  return chemin;
}

/* Opens the Notes page on a given page (from a task, for example). */
function ouvrirPageNotes(id) {
  if (pageParId(id)) NOTES_PAGE = id;
  cheminDe(id).forEach(function (p) { if (p.parent) NOTES_PLIES[p.parent] = false; });
  afficherPage('notes');
}

/* ---------- Page rendering ---------- */

function rendreNotes() {
  fermerMenuSlash();
  if (!NOTES_PAGE || !pageParId(NOTES_PAGE)) {
    var racines = enfantsDe(null);
    NOTES_PAGE = racines.length ? racines[0].id : null;
  }
  /* Whatever was just typed is saved before redrawing; on the same page,
     the cursor and the history are kept. */
  var ancien = docNotes();
  var memePage = !!ancien && ancien.dataset.page === NOTES_PAGE;
  var garder = null;
  if (ancien) {
    notesSerialiserDiffere.flush();
    if (memePage && document.activeElement === ancien) garder = memoriserSelectionIndices();
  }
  var zone = document.getElementById('notesContenu');
  zone.innerHTML = '<section class="card" style="padding:18px 20px;"><div class="nt-disposition">'
    + '<aside class="nt-rail"><input type="text" id="ntRecherche" placeholder="Search notes…" value="' + echapper(NOTES_RECHERCHE) + '">'
    + '<button class="btn btn-ghost btn-petit" data-action="nouvelle-page">New page</button>'
    + '<div class="nt-arbre" id="ntArbre"></div></aside>'
    + '<div class="nt-editeur" id="ntEditeur"></div>'
    + '</div></section>';
  rendreRailNotes();
  rendreEditeurNotes(memePage);
  if (garder) restaurerSelectionIndices(garder);
}

function rendreRailNotes() {
  var arbre = document.getElementById('ntArbre');
  if (!arbre) return;
  var recherche = normaliserCle(NOTES_RECHERCHE);
  var html = '';
  if (recherche) {
    notesSerialiserDiffere.flush();
    var trouvees = [];
    pagesNotes().forEach(function (p) {
      if (normaliserCle(p.titre || 'Untitled').indexOf(recherche) >= 0) { trouvees.push({ p: p, extrait: '' }); return; }
      var dedans = (p.blocs || []).map(function (b) { return texteBrutDe(b.html); }).filter(function (t) { return normaliserCle(t).indexOf(recherche) >= 0; })[0];
      if (dedans != null) trouvees.push({ p: p, extrait: extraitAutour(dedans, recherche) });
    });
    html = trouvees.length ? trouvees.map(function (x) { return itemPageHtml(x.p, 0, false, x.extrait); }).join('') : '<div class="vide" style="padding:10px;">No page contains this text.</div>';
  } else {
    var parcourir = function (parent, niveau) {
      enfantsDe(parent).forEach(function (p) {
        var enfants = enfantsDe(p.id);
        html += itemPageHtml(p, niveau, enfants.length > 0);
        if (enfants.length && !NOTES_PLIES[p.id]) parcourir(p.id, niveau + 1);
      });
    };
    parcourir(null, 0);
    if (!html) html = '<div class="vide" style="padding:10px;">No pages yet. Create one.</div>';
  }
  arbre.innerHTML = html;
}

/* A few words around the matched text, for the results list. */
function extraitAutour(texte, recherche) {
  var t = String(texte || '').replace(/\s+/g, ' ').trim();
  var i = t.toLowerCase().indexOf(recherche);
  if (i < 0) return t.slice(0, 70);
  var debut = Math.max(0, i - 24);
  return (debut ? '…' : '') + t.slice(debut, i + recherche.length + 46) + (i + recherche.length + 46 < t.length ? '…' : '');
}

function itemPageHtml(p, niveau, aEnfants, extrait) {
  var nbTaches = tachesLieesAPage(p.id).filter(function (t) { return t.statut !== 'fait'; }).length;
  return '<button class="nt-item niveau-' + Math.min(3, niveau) + (p.id === NOTES_PAGE ? ' actif' : '') + '" data-action="ouvrir" data-id="' + echapper(p.id) + '">'
    + '<span class="pli"' + (aEnfants ? ' data-action="plier" data-id="' + echapper(p.id) + '"' : '') + '>' + (aEnfants ? (NOTES_PLIES[p.id] ? '▸' : '▾') : '') + '</span>'
    + '<span class="nom">' + echapper(p.titre || 'Untitled') + (extrait ? '<span class="nt-extrait">' + echapper(extrait) + '</span>' : '') + '</span>'
    + (nbTaches ? '<span class="nt-nb" title="Open linked tasks">' + nbTaches + '</span>' : '') + '</button>';
}

function rendreEditeurNotes(memePage) {
  var ed = document.getElementById('ntEditeur');
  if (!ed) return;
  var p = pageParId(NOTES_PAGE);
  if (!p) {
    ed.innerHTML = '<div class="vide" style="margin-top:40px;">No page open. <button class="lien" data-action="nouvelle-page">Create a page</button></div>';
    return;
  }
  var chemin = cheminDe(p.id);
  ed.innerHTML = '<div class="nt-fil">' + chemin.map(function (c, i) {
    return i < chemin.length - 1 ? '<button class="lien" data-action="ouvrir" data-id="' + echapper(c.id) + '">' + echapper(c.titre || 'Untitled') + '</button><span>›</span>' : '<span id="ntFilCourant">' + echapper(c.titre || 'Untitled') + '</span>';
  }).join('') + '</div>'
    + '<h1 class="nt-titre" id="ntTitre" contenteditable="true" spellcheck="false">' + echapper(p.titre) + '</h1>'
    + '<div class="nt-outils"><span id="ntInfos"></span>'
    + '<span class="a-droite"><button class="btn btn-ghost btn-petit" data-action="sous-page">Subpage</button><button class="btn btn-ghost btn-petit" data-action="deplacer-page">Move…</button><button class="btn btn-danger-ligne btn-petit" data-action="supprimer-page">Delete</button></span></div>'
    + '<div class="nt-taches" id="ntTaches"></div>'
    + '<div class="nt-barre" id="ntBarre" role="toolbar" aria-label="Formatting">' + barreNotesHtml() + '</div>'
    + '<div class="nt-doc" id="ntDoc" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" aria-label="Page content" data-page="' + echapper(p.id) + '"></div>';
  rendreTachesLieesNotes();
  var doc = docNotes();
  if (!p.blocs || !p.blocs.length) p.blocs = [bloc('p', '')];
  p.blocs.forEach(function (b) { doc.appendChild(creerLigneDom(b)); });
  normaliserDoc(doc);
  renumeroter(doc);
  brancherEditeur(doc);
  brancherBarre(document.getElementById('ntBarre'));
  if (!memePage) { HISTO = { pile: [], index: -1, nature: '', debut: 0, derniere: 0 }; noterEtat('init'); }
  majInfosNotes();
  majEtatEditeur();
}

function majInfosNotes() {
  var zone = document.getElementById('ntInfos'), doc = docNotes(), p = pageParId(NOTES_PAGE);
  if (!zone || !doc || !p) return;
  var mots = (doc.innerText.match(/\S+/g) || []).length;
  zone.textContent = 'Modified ' + libelleDate(String(p.modifieLe || '').slice(0, 10), 'moyen') + ' · ' + mots + (mots === 1 ? ' word' : ' words');
}

/* The strip of tasks linked to the open page. */
function rendreTachesLieesNotes() {
  var zone = document.getElementById('ntTaches');
  if (!zone || !NOTES_PAGE) return;
  var liees = tachesLieesAPage(NOTES_PAGE).sort(function (a, b) {
    var oa = a.statut === 'fait' ? 1 : 0, ob = b.statut === 'fait' ? 1 : 0;
    if (oa !== ob) return oa - ob;
    return comparerTaches(a, b, aujourdhui());
  });
  zone.innerHTML = '<span class="libelle">Linked tasks</span>'
    + liees.map(chipTacheHtml).join('')
    + '<button type="button" class="lien" data-action="lier-tache">' + (liees.length ? 'Link another task…' : 'Link a task…') + '</button>'
    + '<span class="petit">·</span><button type="button" class="lien" data-action="nouvelle-tache">New linked task</button>';
}

function menuLierTache(ancre) {
  var deja = tachesLieesAPage(NOTES_PAGE).map(function (t) { return t.id; });
  var items = [];
  STATUTS_TACHE.forEach(function (s) {
    var liste = trierTaches(taches().filter(function (t) { return t.statut === s.id && deja.indexOf(t.id) < 0; }), aujourdhui());
    if (!liste.length) return;
    items.push({ titre: s.nom });
    liste.forEach(function (t) { items.push({ libelle: t.titre, sous: libelleAxe(t.axe), fn: function () { lierTacheANote(t.id, NOTES_PAGE); rendreTachesLieesNotes(); rendreRailNotes(); notifier('Linked "' + t.titre + '" to this page.'); } }); });
  });
  ouvrirMenu(ancre, items, { titre: items.length ? 'Link a task' : 'All tasks are already linked' });
}

/* ---------- Toolbar ---------- */

function barreNotesHtml() {
  var bouton = function (attrs, contenu, titre) {
    return '<button type="button" class="nt-outil" ' + attrs + ' title="' + echapper(titre) + '" aria-label="' + echapper(titre) + '">' + contenu + '</button>';
  };
  var sep = '<span class="sep"></span>';
  return bouton('data-outil="style"', '<span class="nt-style-nom">Text</span><span class="chevron">▾</span>', 'Paragraph style: text or heading')
    + sep
    + bouton('data-cmd="bold"', '<b>B</b>', 'Bold (Ctrl+B)')
    + bouton('data-cmd="italic"', '<i>I</i>', 'Italic (Ctrl+I)')
    + bouton('data-cmd="underline"', '<u>U</u>', 'Underline (Ctrl+U)')
    + bouton('data-cmd="strikeThrough"', '<s>ab</s>', 'Strikethrough (Ctrl+Shift+X)')
    + bouton('data-outil="surligner"', icone('surligneur', 16), 'Highlight (Ctrl+Shift+E)')
    + sep
    + bouton('data-type="puce"', icone('liste', 16), 'Bulleted list (Ctrl+Shift+7)')
    + bouton('data-type="numero"', icone('listeNumeros', 16), 'Numbered list (Ctrl+Shift+9)')
    + bouton('data-type="case"', icone('cercleCoche', 16), 'Checkbox (Ctrl+Shift+L)')
    + sep
    + bouton('data-type="citation"', '<span class="glyphe">“</span>', 'Quote (Ctrl+\')')
    + bouton('data-type="encadre"', icone('encadre', 16), 'Callout: important point')
    + bouton('data-type="idee"', icone('ampoule', 16), 'Idea, can become a task')
    + bouton('data-outil="separateur"', icone('trait', 16), 'Divider')
    + sep
    + bouton('data-outil="lien"', icone('lien', 16), 'Link (Ctrl+K)')
    + bouton('data-outil="tache"', icone('fleche', 14) + '<span>Task</span>', 'Turn into a To do task, linked to this page')
    + '<span class="a-droite">'
    + bouton('data-outil="annuler"', icone('annuler', 16), 'Undo (Ctrl+Z)')
    + bouton('data-outil="retablir"', icone('retablir', 16), 'Redo (Ctrl+Shift+Z)')
    + '</span>';
}

function brancherBarre(barre) {
  if (!barre) return;
  /* Clicking the toolbar does not take the cursor out of the page. */
  barre.addEventListener('mousedown', function (ev) { if (ev.target.closest('.nt-outil')) ev.preventDefault(); });
  barre.addEventListener('click', function (ev) {
    var b = ev.target.closest('.nt-outil');
    if (!b || b.disabled) return;
    var o = b.dataset.outil;
    if (o === 'annuler') { annulerNotes(); return; }
    if (o === 'retablir') { retablirNotes(); return; }
    assurerSelectionDansDoc();
    if (b.dataset.cmd) { document.execCommand(b.dataset.cmd); majEtatEditeur(); return; }
    if (b.dataset.type) { basculerType(b.dataset.type); return; }
    if (o === 'style') menuStyle(b);
    else if (o === 'surligner') surligner();
    else if (o === 'separateur') insererSeparateur();
    else if (o === 'lien') insererLien();
    else if (o === 'tache') actionTacheLigne();
  });
}

function assurerSelectionDansDoc() {
  var doc = docNotes();
  if (!doc) return;
  var s = window.getSelection();
  if (s.rangeCount && doc.contains(s.getRangeAt(0).startContainer)) {
    if (document.activeElement !== doc) { var m = memoriserSelectionIndices(); doc.focus({ preventScroll: true }); restaurerSelectionIndices(m); }
    return;
  }
  var lignes = lignesDe(doc).filter(function (l) { return l.dataset.type !== 'separateur'; });
  placerCaret(lignes[lignes.length - 1], false);
}

function menuStyle(ancre) {
  var memo = memoriserSelectionIndices();
  ouvrirMenu(ancre, ['p', 'h1', 'h2', 'h3'].map(function (t) {
    var d = defType(t);
    return { libelle: d.nom, sous: d.raccourci, icone: echapper(d.ic), fn: function () { restaurerSelectionIndices(memo); basculerType(t, true); } };
  }), { titre: 'Style' });
}

/* The toolbar and hints follow the line where the cursor is. */
function majEtatEditeur() {
  var doc = docNotes();
  if (!doc) return;
  var s = window.getSelection();
  var actif = document.activeElement === doc;
  var dans = actif && s.rangeCount > 0 && doc.contains(s.getRangeAt(0).startContainer);
  var el = dans ? ligneCourante() : null;
  Array.prototype.forEach.call(doc.querySelectorAll('.ligne.courante, .ligne.indice'), function (l) { if (l !== el) l.classList.remove('courante', 'indice'); });
  if (el) { el.classList.add('courante'); el.classList.toggle('indice', s.isCollapsed && ligneVide(el)); }
  var lignes = doc.children;
  doc.classList.toggle('doc-vide', !actif && lignes.length === 1 && lignes[0].dataset.type === 'p' && ligneVide(lignes[0]));
  var barre = document.getElementById('ntBarre');
  if (!barre) return;
  var type = el ? el.dataset.type : '';
  var titre = ['h1', 'h2', 'h3'].indexOf(type) >= 0;
  Array.prototype.forEach.call(barre.querySelectorAll('[data-type]'), function (b) { b.classList.toggle('actif', b.dataset.type === type); });
  var style = barre.querySelector('[data-outil="style"] .nt-style-nom');
  if (style) style.textContent = titre ? defType(type).nom : 'Text';
  Array.prototype.forEach.call(barre.querySelectorAll('[data-cmd]'), function (b) {
    var on = false;
    if (dans && !(titre && b.dataset.cmd === 'bold')) { try { on = document.queryCommandState(b.dataset.cmd); } catch (e) { on = false; } }
    b.classList.toggle('actif', !!on);
  });
  var surl = barre.querySelector('[data-outil="surligner"]');
  if (surl) surl.classList.toggle('actif', !!(dans && parentBalise(s.anchorNode, 'MARK', doc)));
  var bt = barre.querySelector('[data-outil="tache"]');
  if (bt) {
    var liee = !!(el && el.dataset.tache && tacheParId(el.dataset.tache));
    bt.classList.toggle('actif', liee);
    bt.title = liee ? 'Open the task linked to this line' : 'Turn into a To do task, linked to this page';
  }
  var an = barre.querySelector('[data-outil="annuler"]'), re = barre.querySelector('[data-outil="retablir"]');
  if (an) an.disabled = HISTO.index <= 0;
  if (re) re.disabled = HISTO.index >= HISTO.pile.length - 1;
}

function parentBalise(node, balise, limite) {
  while (node && node !== limite) {
    if (node.nodeType === 1 && node.tagName === balise) return node;
    node = node.parentNode;
  }
  return null;
}

/* ---------- Lines ---------- */

function defType(type) { return TYPES_BLOC.filter(function (t) { return t.type === type; })[0] || TYPES_BLOC[0]; }
function docNotes() { return document.getElementById('ntDoc'); }
function lignesDe(doc) { return Array.prototype.filter.call(doc.children, function (el) { return el.classList.contains('ligne'); }); }

function creerLigneDom(b) {
  b = b || {};
  var el = document.createElement('div');
  var type = defType(b.type).type;
  el.dataset.id = b.id || uid('bloc');
  if (b.tache) el.dataset.tache = b.tache;
  var r = Math.max(0, Math.min(RETRAIT_MAX, Math.round(Number(b.retrait) || 0)));
  if (r && AVEC_RETRAIT.indexOf(type) >= 0) el.dataset.retrait = r;
  if (type === 'case' && b.coche) el.classList.add('coche');
  if (type !== 'separateur') el.innerHTML = nettoyerHtml(b.html || '').replace(/\n/g, '<br>') || '<br>';
  appliquerType(el, type);
  titresLiens(el);
  return el;
}

/* Gives a line its style while keeping its text (except for dividers). */
function appliquerType(el, type) {
  var etait = el.dataset.type;
  Array.prototype.slice.call(el.classList).forEach(function (c) { if (c.indexOf('ligne-') === 0) el.classList.remove(c); });
  el.classList.add('ligne', 'ligne-' + type);
  el.dataset.type = type;
  if (type !== 'case') el.classList.remove('coche');
  if (AVEC_RETRAIT.indexOf(type) < 0) delete el.dataset.retrait;
  if (type === 'separateur') { el.setAttribute('contenteditable', 'false'); el.innerHTML = '<hr>'; delete el.dataset.tache; }
  else if (etait === 'separateur') { el.removeAttribute('contenteditable'); el.innerHTML = '<br>'; }
  decorerLigne(el);
}

/* The small button of an idea or of a line linked to a task, outside the
   text: its label comes from the CSS, so it does not count as text. */
function outilsLigneHtml(el) {
  if (el.dataset.type === 'separateur') return '';
  var t = el.dataset.tache ? tacheParId(el.dataset.tache) : null;
  if (t) {
    var st = STATUTS_TACHE.filter(function (s) { return s.id === t.statut; })[0];
    return '<span class="ligne-outils" contenteditable="false"><button type="button" class="ligne-action liee" data-bloc-action="ouvrir-tache" data-id="' + echapper(t.id) + '" data-libelle="Task: ' + echapper(st ? st.nom.toLowerCase() : t.statut) + '" title="Open the task">' + icone('fleche', 12) + '</button></span>';
  }
  if (el.dataset.type === 'idee') return '<span class="ligne-outils" contenteditable="false"><button type="button" class="ligne-action" data-bloc-action="tache" data-libelle="Turn into a task" title="Create a To do task from this idea">' + icone('fleche', 12) + '</button></span>';
  return '';
}
function outilsAttendus(el) { return el.dataset.type === 'idee' || !!(el.dataset.tache && tacheParId(el.dataset.tache)); }
function decorerLigne(el) {
  Array.prototype.slice.call(el.querySelectorAll('.ligne-outils')).forEach(function (o) { o.remove(); });
  var html = outilsLigneHtml(el);
  if (html) el.insertAdjacentHTML('afterbegin', html);
  el.classList.toggle('avec-outils', !!html);
}
function titresLiens(el) {
  Array.prototype.forEach.call(el.querySelectorAll('a[href]'), function (a) { a.title = 'Ctrl+click to open ' + a.getAttribute('href'); });
}

function ligneVide(el) { return !el.textContent.replace(/[\u200b\ufeff]/g, '').length; }
function completerLigneVide(el) {
  if (el.dataset.type !== 'separateur' && !el.textContent.length && !el.querySelector('br')) el.appendChild(document.createElement('br'));
}
function retirerSautsFinaux(el) {
  var n = el.lastChild;
  while (n && ((n.nodeType === 1 && n.tagName === 'BR') || (n.nodeType === 3 && !n.nodeValue.length))) { var avant = n.previousSibling; n.remove(); n = avant; }
  completerLigneVide(el);
}
function insererLigneApres(elRef, b) {
  var nouveau = creerLigneDom(b);
  var doc = docNotes();
  if (elRef && elRef.parentNode) elRef.parentNode.insertBefore(nouveau, elRef.nextSibling);
  else doc.appendChild(nouveau);
  return nouveau;
}

/* Numbering of lists, level by level. */
function renumeroter(doc) {
  doc = doc || docNotes();
  if (!doc) return;
  var compteurs = [];
  lignesDe(doc).forEach(function (el) {
    var niveau = Number(el.dataset.retrait) || 0;
    if (el.dataset.type === 'numero') {
      compteurs.length = niveau + 1;
      compteurs[niveau] = (compteurs[niveau] || 0) + 1;
      var v = compteurs[niveau] + '.';
      if (el.dataset.n !== v) el.dataset.n = v;
      return;
    }
    if (el.dataset.n) delete el.dataset.n;
    if (LISTES.indexOf(el.dataset.type) >= 0 || niveau > 0) compteurs.length = Math.min(compteurs.length, niveau);
    else compteurs = [];
  });
}

/* Saves the content of the displayed page (one line = one block). */
function serialiserDoc() {
  var doc = docNotes();
  if (!doc) return;
  var p = pageParId(doc.dataset.page);
  if (!p) return;
  var avant = JSON.stringify(p.blocs || []);
  p.blocs = lignesDe(doc).map(function (el) {
    var b = { id: el.dataset.id, type: el.dataset.type, html: el.dataset.type === 'separateur' ? '' : nettoyerHtml(el.innerHTML) };
    if (b.type === 'case') b.coche = el.classList.contains('coche');
    if (el.dataset.tache) b.tache = el.dataset.tache;
    if (el.dataset.retrait) b.retrait = Number(el.dataset.retrait);
    return b;
  });
  if (JSON.stringify(p.blocs) === avant) return;
  p.modifieLe = new Date().toISOString();
  notesSauverDiffere();
  if (p.id === NOTES_PAGE) majInfosNotes();
}

/* Keeps only simple formatting tags. The HTML is parsed in a separate
   document: nothing is loaded or run in it. */
var BALISES_OK = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', CODE: 'code', A: 'a', BR: 'br', MARK: 'mark' };
var DOC_INERTE = null;
function nettoyerHtml(html) {
  if (!DOC_INERTE) DOC_INERTE = document.implementation.createHTMLDocument('');
  var src = DOC_INERTE.createElement('div');
  src.innerHTML = html || '';
  var parcourir = function (node) {
    var out = '';
    Array.prototype.forEach.call(node.childNodes, function (n) {
      if (n.nodeType === 3) { out += echapper(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      var nom = n.tagName.toUpperCase();
      if (['SCRIPT', 'STYLE', 'TEMPLATE', 'SVG', 'BUTTON'].indexOf(nom) >= 0 || n.classList.contains('ligne-outils')) return;
      var tag = BALISES_OK[nom];
      if (tag === 'br') { out += '<br>'; return; }
      var interieur = parcourir(n);
      if (!tag) { out += (nom === 'DIV' || nom === 'P') && out && !/<br>$/.test(out) ? '<br>' + interieur : interieur; return; }
      if (!interieur) return;
      if (tag === 'a') { var href = n.getAttribute('href') || ''; out += /^https?:\/\//.test(href) ? '<a href="' + echapper(href) + '">' + interieur + '</a>' : interieur; return; }
      out += '<' + tag + '>' + interieur + '</' + tag + '>';
    });
    return out;
  };
  return parcourir(src).replace(/(<br>)+$/, '');
}

/* Plain text of a block's HTML, with <br> turned into line breaks. */
function texteBrutDe(html) {
  if (!DOC_INERTE) DOC_INERTE = document.implementation.createHTMLDocument('');
  var d = DOC_INERTE.createElement('div');
  d.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n');
  return d.textContent;
}

/* ---------- Tidying up after a native edit ----------
   The browser handles typing, deleting a multi-line selection and the
   spellchecker on its own. Afterwards, every child of the area must
   remain a clean line: limited formatting, a unique id, at least one
   <br> if it is empty. The cursor is put back at the same place in the
   text. */

function normaliserDoc(doc) {
  if (!doc || !besoinNormaliser(doc)) return false;
  var memo = memoSelectionNoeuds(doc);
  var vus = {}, orpheline = null;
  Array.prototype.slice.call(doc.childNodes).forEach(function (n) {
    if (n.nodeType === 1 && n.classList.contains('ligne')) {
      orpheline = null;
      if (!n.dataset.id || vus[n.dataset.id]) n.dataset.id = uid('bloc');
      vus[n.dataset.id] = true;
      var type = defType(n.dataset.type).type;
      if (n.dataset.type !== type || !n.classList.contains('ligne-' + type)) appliquerType(n, type);
      if (type === 'separateur') { if (n.childNodes.length !== 1 || !n.querySelector('hr')) n.innerHTML = '<hr>'; }
      else assainirLigne(n);
      return;
    }
    if ((n.nodeType !== 1 && n.nodeType !== 3) || (n.nodeType === 3 && !n.nodeValue.length)) { n.remove(); return; }
    var estBloc = n.nodeType === 1 && /^(DIV|P|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE|HR)$/.test(n.tagName);
    if (estBloc || !orpheline) {
      orpheline = document.createElement('div');
      orpheline.dataset.id = uid('bloc');
      vus[orpheline.dataset.id] = true;
      appliquerType(orpheline, 'p');
      doc.insertBefore(orpheline, n);
    }
    deplacerMemo(memo, n, orpheline, orpheline.textContent.length);
    if (estBloc) { while (n.firstChild) orpheline.appendChild(n.firstChild); n.remove(); }
    else orpheline.appendChild(n);
    assainirLigne(orpheline);
    if (estBloc) orpheline = null;
  });
  if (!lignesDe(doc).some(function (l) { return l.dataset.type !== 'separateur'; })) doc.appendChild(creerLigneDom({ type: 'p' }));
  renumeroter(doc);
  restaurerMemoNoeuds(doc, memo);
  return true;
}

function besoinNormaliser(doc) {
  var vus = {}, editable = false;
  for (var n = doc.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1 || !n.classList.contains('ligne')) return true;
    var id = n.dataset.id, type = n.dataset.type;
    if (!id || vus[id] || !type || defType(type).type !== type || !n.classList.contains('ligne-' + type)) return true;
    vus[id] = true;
    if (type === 'separateur') continue;
    editable = true;
    if (!ligneSaine(n)) return true;
  }
  return !editable;
}

function ligneSaine(el) {
  var nbOutils = 0;
  var tous = el.getElementsByTagName('*');
  for (var i = 0; i < tous.length; i++) {
    var n = tous[i];
    if (n.classList.contains('ligne-outils')) { if (n.parentNode !== el) return false; nbOutils++; continue; }
    if (n.closest('.ligne-outils')) continue;
    var nom = n.tagName.toUpperCase();
    if (!BALISES_LIGNE[nom]) return false;
    for (var j = 0; j < n.attributes.length; j++) {
      var a = n.attributes[j].name;
      if (!(nom === 'A' && (a === 'href' || a === 'title'))) return false;
    }
  }
  if (nbOutils !== (outilsAttendus(el) ? 1 : 0)) return false;
  if (el.textContent.indexOf('\n') >= 0) return false;
  return el.textContent.length > 0 || el.getElementsByTagName('br').length > 0;
}

function assainirLigne(el) {
  Array.prototype.slice.call(el.querySelectorAll('*')).forEach(function (n) {
    if (!n.parentNode || !el.contains(n)) return;
    var outils = n.closest('.ligne-outils');
    if (outils) { if (outils === n && n.parentNode !== el) n.remove(); return; }
    var nom = n.tagName.toUpperCase();
    if (BALISES_LIGNE[nom]) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) { if (!(nom === 'A' && (a.name === 'href' || a.name === 'title'))) n.removeAttribute(a.name); });
      return;
    }
    if (/^(SCRIPT|STYLE|TEMPLATE|IMG|SVG|BUTTON|INPUT|HR|IFRAME|OBJECT|VIDEO|AUDIO|CANVAS)$/.test(nom)) { n.remove(); return; }
    if (/^(DIV|P|H[1-6]|LI|BLOCKQUOTE|PRE|UL|OL)$/.test(nom) && n.previousSibling) n.parentNode.insertBefore(document.createElement('br'), n);
    deballer(n);
  });
  /* A "\n" in the text becomes a real line break. */
  var parcours = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), textes = [], t;
  while ((t = parcours.nextNode())) if (t.nodeValue.indexOf('\n') >= 0) textes.push(t);
  textes.forEach(function (n) {
    n.nodeValue.split('\n').forEach(function (morceau, i) {
      if (i) n.parentNode.insertBefore(document.createElement('br'), n);
      if (morceau) n.parentNode.insertBefore(document.createTextNode(morceau), n);
    });
    n.remove();
  });
  var outilsDirects = Array.prototype.filter.call(el.children, function (c) { return c.classList.contains('ligne-outils'); });
  if (outilsDirects.length !== (outilsAttendus(el) ? 1 : 0)) decorerLigne(el);
  completerLigneVide(el);
}
function deballer(n) {
  var parent = n.parentNode;
  while (n.firstChild) parent.insertBefore(n.firstChild, n);
  parent.removeChild(n);
}

/* Cursor position identified by the top-level child that contains it
   and the number of characters before it. */
function memoSelectionNoeuds(doc) {
  var s = window.getSelection();
  if (!s.rangeCount) return null;
  var r = s.getRangeAt(0);
  if (!doc.contains(r.startContainer) || !doc.contains(r.endContainer)) return null;
  var point = function (node, offset) {
    if (node === doc) {
      var enfant = doc.childNodes[offset] || doc.lastChild;
      return enfant ? { noeud: enfant, o: offset < doc.childNodes.length ? 0 : enfant.textContent.length } : null;
    }
    var haut = node;
    while (haut.parentNode !== doc) haut = haut.parentNode;
    var pr = document.createRange();
    pr.setStart(haut, 0);
    pr.setEnd(node, offset);
    return { noeud: haut, o: pr.toString().length };
  };
  return { d: point(r.startContainer, r.startOffset), f: point(r.endContainer, r.endOffset) };
}
function deplacerMemo(memo, ancien, nouveau, base) {
  if (!memo) return;
  ['d', 'f'].forEach(function (k) { var p = memo[k]; if (p && p.noeud === ancien) { p.noeud = nouveau; p.o += base; } });
}
function restaurerMemoNoeuds(doc, memo) {
  if (!memo) return;
  var vers = function (p) { return p && p.noeud && p.noeud.nodeType === 1 && p.noeud.parentNode === doc ? positionDans(p.noeud, p.o) : null; };
  var a = vers(memo.d);
  if (!a) {
    var l = lignesDe(doc).filter(function (x) { return x.dataset.type !== 'separateur'; })[0];
    if (l) placerCaret(l, true);
    return;
  }
  var b = vers(memo.f) || a;
  var r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  var s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

/* ---------- Cursor ---------- */

/* The DOM point that matches the nth character of a line. */
function positionDans(el, o) {
  var parcours = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  var reste = Math.max(0, o || 0), n, dernier = null;
  while ((n = parcours.nextNode())) {
    if (reste <= n.nodeValue.length) return { node: n, offset: reste };
    reste -= n.nodeValue.length;
    dernier = n;
  }
  if (dernier) return { node: dernier, offset: dernier.nodeValue.length };
  for (var i = 0; i < el.childNodes.length; i++) { if (el.childNodes[i].nodeName === 'BR') return { node: el, offset: i }; }
  return { node: el, offset: el.childNodes.length };
}
function placerCaret(el, auDebut) {
  if (!el) return;
  var hote = el.closest('[contenteditable="true"]') || el;
  if (document.activeElement !== hote) hote.focus({ preventScroll: true });
  placerCaretAOffset(el, auDebut ? 0 : el.textContent.length);
}
function placerCaretAOffset(el, offset) {
  var p = positionDans(el, offset);
  var r = document.createRange();
  r.setStart(p.node, p.offset);
  r.collapse(true);
  var s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  if (el.classList.contains('ligne') && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}
function caretAuDebut(el) {
  var s = window.getSelection();
  if (!s.rangeCount) return false;
  var r = s.getRangeAt(0);
  if (!r.collapsed) return false;
  var pre = r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length === 0;
}
function caretALaFin(el) {
  var s = window.getSelection();
  if (!s.rangeCount) return false;
  var r = s.getRangeAt(0);
  if (!r.collapsed) return false;
  var post = r.cloneRange();
  post.selectNodeContents(el);
  post.setStart(r.endContainer, r.endOffset);
  return post.toString().length === 0;
}
function texteAvantCaret(el) {
  var s = window.getSelection();
  if (!s.rangeCount || !s.isCollapsed) return null;
  var r = s.getRangeAt(0);
  if (!el.contains(r.startContainer)) return null;
  var pre = document.createRange();
  pre.setStart(el, 0);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString();
}
/* Extracts (and removes) what follows the cursor in a line. */
function extraireApresCaret(el) {
  var s = window.getSelection();
  if (!s.rangeCount) return '';
  var r = s.getRangeAt(0);
  var post = r.cloneRange();
  post.selectNodeContents(el);
  post.setStart(r.endContainer, r.endOffset);
  var frag = post.extractContents();
  var d = document.createElement('div');
  d.appendChild(frag);
  return d.innerHTML;
}

/* The line that contains a DOM point. */
function ligneDe(node, offset) {
  var doc = docNotes();
  if (!doc || !node || !doc.contains(node)) return null;
  if (node === doc) node = doc.childNodes[Math.min(offset || 0, doc.childNodes.length - 1)];
  while (node && node.parentNode !== doc) node = node.parentNode;
  return node && node.nodeType === 1 && node.classList.contains('ligne') ? node : null;
}
function ligneCourante() {
  var s = window.getSelection();
  if (!s.rangeCount) return null;
  var r = s.getRangeAt(0);
  return ligneDe(r.startContainer, r.startOffset);
}
/* The lines touched by the selection. A selection that ends at the very
   start of a line (triple click) does not count that last line. */
function lignesSelection() {
  var doc = docNotes(), s = window.getSelection();
  if (!doc || !s.rangeCount) return [];
  var r = s.getRangeAt(0);
  if (!doc.contains(r.startContainer)) return [];
  var a = ligneDe(r.startContainer, r.startOffset);
  var b = r.endContainer === doc ? ligneDe(doc, Math.max(0, r.endOffset - 1)) : ligneDe(r.endContainer, r.endOffset);
  if (!a || !b) return a ? [a] : (b ? [b] : []);
  if (b !== a && !r.collapsed && r.endContainer !== doc) {
    var pre = document.createRange();
    pre.setStart(b, 0);
    pre.setEnd(r.endContainer, r.endOffset);
    if (!pre.toString().length) b = b.previousElementSibling || b;
  }
  var lignes = lignesDe(doc), i = lignes.indexOf(a), j = lignes.indexOf(b);
  if (i < 0 || j < 0) return [a];
  return lignes.slice(Math.min(i, j), Math.max(i, j) + 1);
}
function surPremiereLigneVisuelle(el) {
  var doc = docNotes();
  if (!doc || el !== doc.firstElementChild) return false;
  var s = window.getSelection();
  if (!s.rangeCount) return false;
  var rects = s.getRangeAt(0).getClientRects();
  var haut = rects.length ? rects[0].top : el.getBoundingClientRect().top;
  return haut - el.getBoundingClientRect().top < 20;
}

/* Selection identified by line number and character count, for the
   history and after a re-render. */
function memoriserSelectionIndices() {
  var doc = docNotes(), s = window.getSelection();
  if (!doc || !s.rangeCount) return null;
  var r = s.getRangeAt(0);
  if (!doc.contains(r.startContainer)) return null;
  var lignes = lignesDe(doc);
  var point = function (node, offset) {
    var el = ligneDe(node, offset);
    if (!el) return null;
    var pr = document.createRange();
    pr.setStart(el, 0);
    pr.setEnd(node, offset);
    return [lignes.indexOf(el), pr.toString().length];
  };
  var d = point(r.startContainer, r.startOffset);
  return d ? { d: d, f: point(r.endContainer, r.endOffset) } : null;
}
function restaurerSelectionIndices(m) {
  var doc = docNotes();
  if (!doc || !m || !m.d) return;
  var lignes = lignesDe(doc);
  if (!lignes.length) return;
  var pos = function (p) { return positionDans(lignes[Math.max(0, Math.min(p[0], lignes.length - 1))], p[1]); };
  if (document.activeElement !== doc) doc.focus({ preventScroll: true });
  var a = pos(m.d), b = m.f ? pos(m.f) : a;
  var r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  var s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

/* ---------- History (undo, redo) ----------
   A state is taken after each change; keystrokes close together are
   grouped into a single step, as in Notes. */

function htmlPropre(doc) {
  var marquees = Array.prototype.slice.call(doc.querySelectorAll('.ligne.courante, .ligne.indice'));
  var classes = marquees.map(function (el) { return el.className; });
  marquees.forEach(function (el) { el.classList.remove('courante', 'indice'); });
  var html = doc.innerHTML;
  marquees.forEach(function (el, i) { el.className = classes[i]; });
  return html;
}
function noterEtat(nature) {
  var doc = docNotes();
  if (!doc) return;
  var etat = { page: doc.dataset.page, html: htmlPropre(doc), sel: memoriserSelectionIndices() };
  var h = HISTO, maintenant = Date.now(), actuel = h.pile[h.index];
  if (actuel && actuel.page === etat.page && actuel.html === etat.html) { if (etat.sel) actuel.sel = etat.sel; return; }
  var fusion = (nature === 'frappe' || nature === 'suppression') && h.nature === nature && h.index > 0
    && h.index === h.pile.length - 1 && maintenant - h.derniere < 1500 && maintenant - h.debut < 5000;
  if (fusion) h.pile[h.index] = etat;
  else {
    h.pile = h.pile.slice(0, h.index + 1);
    h.pile.push(etat);
    if (h.pile.length > 300) h.pile.shift();
    h.index = h.pile.length - 1;
    h.debut = maintenant;
  }
  h.nature = nature;
  h.derniere = maintenant;
}
function annulerNotes() { if (HISTO.index > 0) { HISTO.index--; restaurerEtat(HISTO.pile[HISTO.index]); } }
function retablirNotes() { if (HISTO.index < HISTO.pile.length - 1) { HISTO.index++; restaurerEtat(HISTO.pile[HISTO.index]); } }
function restaurerEtat(etat) {
  var doc = docNotes();
  if (!doc || !etat || etat.page !== doc.dataset.page) return;
  fermerMenuSlash();
  var avant = memoriserSelectionIndices();
  doc.innerHTML = etat.html;
  lignesDe(doc).forEach(decorerLigne);
  renumeroter(doc);
  restaurerSelectionIndices(etat.sel || avant);
  HISTO.nature = 'historique';
  notesSerialiserDiffere();
  notesSerialiserDiffere.flush();
  majEtatEditeur();
}

/* ---------- After each change ---------- */

function apresSaisie(type) {
  var doc = docNotes();
  if (!doc) return;
  type = type || '';
  normaliserDoc(doc);
  /* Everything erased: the page starts over with one plain text line. */
  var seule = doc.children.length === 1 ? doc.firstElementChild : null;
  if (seule && type.indexOf('delete') === 0 && ligneVide(seule) && (seule.dataset.type !== 'p' || seule.dataset.retrait || seule.innerHTML !== '<br>')) {
    seule.innerHTML = '<br>';
    delete seule.dataset.retrait;
    appliquerType(seule, 'p');
    placerCaret(seule, true);
  }
  var el = ligneCourante();
  if (el && type === 'insertText' && raccourciMarkdownLigne(el)) return;
  majMenuSlash(el);
  renumeroter(doc);
  noterEtat(/^insert(Text|CompositionText|ReplacementText)$/.test(type) ? 'frappe' : (type.indexOf('delete') === 0 ? 'suppression' : 'structure'));
  notesSerialiserDiffere();
  majEtatEditeur();
}
function apresStructure() {
  var doc = docNotes();
  if (!doc) return;
  renumeroter(doc);
  noterEtat('structure');
  notesSerialiserDiffere();
  notesSerialiserDiffere.flush();
  majEtatEditeur();
}

/* ---------- Editor events ---------- */

function brancherEditeur(doc) {
  doc.addEventListener('keydown', function (ev) {
    if (ev.isComposing || ev.keyCode === 229) return;
    var el = ligneCourante();
    if (MENU_SLASH) {
      if (MENU_SLASH.ligne !== el) fermerMenuSlash();
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); bougerSelectionSlash(ev.key === 'ArrowDown' ? 1 : -1); return; }
      else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); validerSlash(); return; }
      else if (ev.key === 'Escape') { ev.preventDefault(); fermerMenuSlash(); return; }
    }
    var cmd = ev.metaKey || ev.ctrlKey;
    if (cmd && raccourciNotes(ev)) { ev.preventDefault(); return; }
    if (ev.altKey && ev.shiftKey && !cmd && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) { ev.preventDefault(); deplacerLignes(ev.key === 'ArrowUp' ? -1 : 1); return; }
    if (ev.key === 'Tab' && !cmd && !ev.altKey) { ev.preventDefault(); decaler(ev.shiftKey ? -1 : 1); return; }
    if (!el) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (cmd) entreeCommande(el);
      else if (ev.shiftKey) sautDeLigne();
      else retourLigne(el);
      return;
    }
    if (ev.key === 'Backspace' && !cmd && !ev.altKey && effacerArriere(el)) { ev.preventDefault(); return; }
    if (ev.key === 'Delete' && !cmd && !ev.altKey && effacerAvant(el)) { ev.preventDefault(); return; }
    if (ev.key === 'ArrowUp' && !ev.shiftKey && !cmd && !ev.altKey && surPremiereLigneVisuelle(el)) {
      var titre = document.getElementById('ntTitre');
      if (titre) { ev.preventDefault(); placerCaret(titre, false); }
      return;
    }
    if (ev.key === 'Escape') doc.blur();
  });

  /* The Edit menu (Undo, Redo) and Enter also come through here. */
  doc.addEventListener('beforeinput', function (ev) {
    var t = ev.inputType;
    if (t === 'historyUndo' || t === 'historyRedo') {
      ev.preventDefault();
      if (Date.now() - HISTO_CLAVIER > 150) { if (t === 'historyUndo') annulerNotes(); else retablirNotes(); }
      return;
    }
    if (t === 'insertParagraph') { ev.preventDefault(); var el = ligneCourante(); if (el) retourLigne(el); return; }
    if (t === 'insertLineBreak') { ev.preventDefault(); sautDeLigne(); return; }
    if (t === 'insertFromDrop') ev.preventDefault();
  });
  doc.addEventListener('input', function (ev) { if (!ev.isComposing) apresSaisie(ev.inputType); });
  doc.addEventListener('compositionend', function () { setTimeout(function () { apresSaisie('insertText'); }, 0); });

  doc.addEventListener('paste', function (ev) {
    ev.preventDefault();
    collerTexte(texteColle(ev));
  });
  /* No dragging text within the page; dropped text arrives unformatted. */
  doc.addEventListener('dragstart', function (ev) { ev.preventDefault(); });
  doc.addEventListener('dragover', function (ev) { ev.preventDefault(); });
  doc.addEventListener('drop', function (ev) {
    ev.preventDefault();
    var t = ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '';
    if (!t) return;
    var r = document.caretRangeFromPoint ? document.caretRangeFromPoint(ev.clientX, ev.clientY) : null;
    if (r && doc.contains(r.startContainer)) {
      doc.focus({ preventScroll: true });
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
    collerTexte(String(t).replace(/\r\n?/g, '\n'));
  });

  doc.addEventListener('mousedown', function (ev) {
    if (ev.button !== 0) return;
    if (ev.target.closest('.ligne-outils')) { ev.preventDefault(); return; }
    var c = ev.target.closest('.ligne-case');
    if (c && dansCase(c, ev)) { ev.preventDefault(); basculerCoche(c); return; }
    /* A click below the last line puts the cursor there, or opens a text
       line after a heading, a list or an idea. */
    if (ev.target !== doc) return;
    var lignes = lignesDe(doc), der = lignes[lignes.length - 1];
    if (!der || ev.clientY <= der.getBoundingClientRect().bottom) return;
    ev.preventDefault();
    if (der.dataset.type !== 'p') { der = insererLigneApres(der, { type: 'p' }); placerCaret(der, true); apresStructure(); }
    else placerCaret(der, false);
  });
  doc.addEventListener('click', function (ev) {
    var ba = ev.target.closest('[data-bloc-action]');
    if (ba) {
      ev.preventDefault();
      if (ba.dataset.blocAction === 'tache') creerTacheDepuisLigne(ligneDe(ba));
      else if (ba.dataset.blocAction === 'ouvrir-tache') ouvrirEditionTache(ba.dataset.id);
      return;
    }
    var a = ev.target.closest('a[href]');
    if (a && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      if (window.sablier && window.sablier.fichiers) window.sablier.fichiers.ouvrirUrl(a.getAttribute('href'));
    }
  });
  doc.addEventListener('blur', function () {
    fermerMenuSlash();
    notesSerialiserDiffere.flush();
    setTimeout(majEtatEditeur, 0);
  });
}

function dansCase(el, ev) {
  var r = el.getBoundingClientRect();
  var g = (Number(el.dataset.retrait) || 0) * 24;
  var x = ev.clientX - r.left, y = ev.clientY - r.top;
  return x >= g - 4 && x <= g + 24 && y <= 28;
}

/* Keyboard shortcuts with Ctrl (close to those of Notes). */
function raccourciNotes(ev) {
  var k = (ev.key || '').toLowerCase(), code = ev.code || '';
  if (!ev.altKey && !ev.shiftKey) {
    if (k === 'b') { document.execCommand('bold'); return true; }
    if (k === 'i') { document.execCommand('italic'); return true; }
    if (k === 'u') { document.execCommand('underline'); return true; }
    if (k === 'k') { insererLien(); return true; }
    if (k === 'z') { HISTO_CLAVIER = Date.now(); annulerNotes(); return true; }
    if (k === '\'') { basculerType('citation'); return true; }
    return false;
  }
  if (ev.shiftKey && !ev.altKey) {
    if (k === 'z') { HISTO_CLAVIER = Date.now(); retablirNotes(); return true; }
    if (k === 'x') { document.execCommand('strikeThrough'); return true; }
    if (k === 'e') { surligner(); return true; }
    if (k === 'l') { basculerType('case'); return true; }
    if (code === 'Digit7') { basculerType('puce'); return true; }
    if (code === 'Digit9') { basculerType('numero'); return true; }
    return false;
  }
  if (ev.altKey && !ev.shiftKey) {
    var styles = { Digit0: 'p', Digit1: 'h1', Digit2: 'h2', Digit3: 'h3', Numpad0: 'p', Numpad1: 'h1', Numpad2: 'h2', Numpad3: 'h3' };
    if (styles[code]) { basculerType(styles[code], true); return true; }
  }
  return false;
}

/* ---------- Line operations ---------- */

/* Enter: a new line. Lists, checkboxes, quotes and callouts continue; an
   empty list line leaves the list; after a heading comes plain text.
   Inside an idea, Enter breaks the line within the idea; pressing Enter
   twice at the end leaves it. */
function retourLigne(el) {
  var s = window.getSelection();
  if (!s.isCollapsed) {
    document.execCommand('delete');
    normaliserDoc(docNotes());
    el = ligneCourante();
    if (!el) return;
  }
  var type = el.dataset.type;
  if (type === 'separateur') { var n0 = insererLigneApres(el, { type: 'p' }); placerCaret(n0, true); apresStructure(); return; }
  var vide = ligneVide(el);
  if (vide && type !== 'p' && ['h1', 'h2', 'h3'].indexOf(type) < 0) {
    if (LISTES.indexOf(type) >= 0 && Number(el.dataset.retrait) > 0) decalerLigne(el, -1);
    else appliquerType(el, 'p');
    placerCaret(el, true);
    apresStructure();
    return;
  }
  if (type === 'idee') {
    if (caretALaFin(el) && finitParSautDeLigne(el)) {
      retirerSautsFinaux(el);
      var ni = insererLigneApres(el, { type: 'p' });
      placerCaret(ni, true);
      apresStructure();
    } else sautDeLigne();
    return;
  }
  var suivant = CONTINUES.indexOf(type) >= 0 ? type : 'p';
  var retrait = AVEC_RETRAIT.indexOf(suivant) >= 0 ? Number(el.dataset.retrait) || 0 : 0;
  if (!vide && caretAuDebut(el)) {
    /* At the start of a non-empty line: an empty line opens above. */
    el.parentNode.insertBefore(creerLigneDom({ type: suivant, retrait: retrait }), el);
    apresStructure();
    return;
  }
  var reste = extraireApresCaret(el);
  completerLigneVide(el);
  var n = insererLigneApres(el, { type: suivant, html: reste, retrait: retrait });
  placerCaret(n, true);
  apresStructure();
}
function finitParSautDeLigne(el) {
  var s = window.getSelection();
  if (!s.rangeCount) return false;
  var r = s.getRangeAt(0).cloneRange();
  r.setStart(el, 0);
  var d = document.createElement('div');
  d.appendChild(r.cloneContents());
  Array.prototype.forEach.call(d.querySelectorAll('.ligne-outils'), function (o) { o.remove(); });
  return /<br>\s*$/i.test(d.innerHTML);
}
/* Shift+Enter: line break without starting a new note line. The <br> is
   inserted by hand (the browser would insert a "\n" character); at the
   end of a line, a second <br> makes the new line visible. */
function sautDeLigne() {
  var s = window.getSelection();
  if (!s.rangeCount) return;
  if (!s.isCollapsed) document.execCommand('delete');
  var el = ligneCourante();
  if (!el || el.dataset.type === 'separateur') return;
  var br = document.createElement('br');
  s.getRangeAt(0).insertNode(br);
  var suite = document.createRange();
  suite.selectNodeContents(el);
  suite.setStartAfter(br);
  var d = document.createElement('div');
  d.appendChild(suite.cloneContents());
  if (!d.textContent.length && !d.querySelector('br')) el.appendChild(document.createElement('br'));
  var r = document.createRange();
  r.setStartAfter(br);
  r.collapse(true);
  s.removeAllRanges();
  s.addRange(r);
  apresSaisie('insertLineBreak');
}
/* Ctrl+Enter: ticks a checkbox, or opens a text line below. */
function entreeCommande(el) {
  if (el.dataset.type === 'case') { basculerCoche(el); return; }
  var n = insererLigneApres(el, { type: 'p' });
  placerCaret(n, true);
  apresStructure();
}

/* Backspace at the start of a line: a styled line goes back to plain
   text, an indent decreases, otherwise the line joins the previous one. */
function effacerArriere(el) {
  var s = window.getSelection();
  if (!s.isCollapsed || !caretAuDebut(el)) return false;
  var type = el.dataset.type, retrait = Number(el.dataset.retrait) || 0;
  if (type !== 'p') {
    if (retrait && LISTES.indexOf(type) >= 0) decalerLigne(el, -1);
    else appliquerType(el, 'p');
    placerCaret(el, true);
    apresStructure();
    return true;
  }
  if (retrait) { decalerLigne(el, -1); apresStructure(); return true; }
  var prec = el.previousElementSibling;
  if (!prec) return true;
  if (prec.dataset.type === 'separateur' || ligneVide(prec)) { prec.remove(); apresStructure(); return true; }
  var longueur = prec.textContent.length;
  var html = nettoyerHtml(el.innerHTML);
  if (html) { retirerSautsFinaux(prec); prec.insertAdjacentHTML('beforeend', html); }
  el.remove();
  titresLiens(prec);
  placerCaretAOffset(prec, longueur);
  apresStructure();
  return true;
}
/* Delete at the end of a line: the next one joins it. */
function effacerAvant(el) {
  var s = window.getSelection();
  if (!s.isCollapsed || !caretALaFin(el)) return false;
  var suiv = el.nextElementSibling;
  if (!suiv) return true;
  if (suiv.dataset.type === 'separateur' || ligneVide(suiv)) { suiv.remove(); apresStructure(); return true; }
  var longueur = el.textContent.length;
  retirerSautsFinaux(el);
  if (ligneVide(el)) el.innerHTML = '';
  el.insertAdjacentHTML('beforeend', nettoyerHtml(suiv.innerHTML));
  suiv.remove();
  decorerLigne(el);
  completerLigneVide(el);
  titresLiens(el);
  placerCaretAOffset(el, longueur);
  apresStructure();
  return true;
}

/* Changes the style of the selected lines; asking for the same style
   again (list, checkbox…) goes back to plain text, as in Notes. */
function basculerType(type, forcer) {
  if (type === 'separateur') { insererSeparateur(); return; }
  var lignes = lignesSelection().filter(function (l) { return l.dataset.type !== 'separateur'; });
  if (!lignes.length) return;
  var cible = !forcer && type !== 'p' && lignes.every(function (l) { return l.dataset.type === type; }) ? 'p' : type;
  var memo = memoriserSelectionIndices();
  lignes.forEach(function (l) { if (l.dataset.type !== cible) appliquerType(l, cible); });
  restaurerSelectionIndices(memo);
  apresStructure();
}
function insererSeparateur() {
  var doc = docNotes();
  if (!doc) return;
  var el = ligneCourante();
  if (!el) { var toutes = lignesDe(doc); el = toutes[toutes.length - 1]; }
  var sep = creerLigneDom({ type: 'separateur' });
  if (el.dataset.type === 'p' && ligneVide(el)) doc.replaceChild(sep, el);
  else doc.insertBefore(sep, el.nextSibling);
  var suiv = sep.nextElementSibling;
  if (!suiv || suiv.dataset.type === 'separateur') suiv = insererLigneApres(sep, { type: 'p' });
  placerCaret(suiv, true);
  apresStructure();
}
/* Tab and Shift+Tab: indent lists, checkboxes and paragraphs. */
function decaler(delta) {
  var lignes = lignesSelection().filter(function (l) { return AVEC_RETRAIT.indexOf(l.dataset.type) >= 0; });
  if (!lignes.length) return;
  lignes.forEach(function (l) { decalerLigne(l, delta); });
  apresStructure();
}
function decalerLigne(el, delta) {
  var r = Math.max(0, Math.min(RETRAIT_MAX, (Number(el.dataset.retrait) || 0) + delta));
  if (r) el.dataset.retrait = r; else delete el.dataset.retrait;
}
/* Alt+Shift+Up and Alt+Shift+Down: move the selected lines up or down. */
function deplacerLignes(sens) {
  var lignes = lignesSelection();
  if (!lignes.length) return;
  var premiere = lignes[0], derniere = lignes[lignes.length - 1];
  if (sens < 0) {
    var avant = premiere.previousElementSibling;
    if (!avant) return;
    derniere.parentNode.insertBefore(avant, derniere.nextSibling);
  } else {
    var apres = derniere.nextElementSibling;
    if (!apres) return;
    premiere.parentNode.insertBefore(apres, premiere);
  }
  apresStructure();
}
function basculerCoche(el) {
  el.classList.toggle('coche');
  apresStructure();
}

/* Highlights the selection (or removes the highlight if it starts in one). */
function surligner() {
  var doc = docNotes(), s = window.getSelection();
  if (!doc || !s.rangeCount || s.isCollapsed) return;
  var r = s.getRangeAt(0);
  if (!doc.contains(r.commonAncestorContainer)) return;
  if (parentBalise(r.startContainer, 'MARK', doc)) {
    var memo = memoriserSelectionIndices();
    Array.prototype.filter.call(doc.querySelectorAll('mark'), function (m) { return r.intersectsNode(m); }).forEach(deballer);
    restaurerSelectionIndices(memo);
    apresStructure();
    return;
  }
  var lignes = lignesSelection(), marques = [];
  lignes.forEach(function (el, i) {
    if (el.dataset.type === 'separateur') return;
    var sous = document.createRange();
    sous.selectNodeContents(el);
    if (i === 0 && el.contains(r.startContainer)) sous.setStart(r.startContainer, r.startOffset);
    if (i === lignes.length - 1 && el.contains(r.endContainer)) sous.setEnd(r.endContainer, r.endOffset);
    if (sous.collapsed || !sous.toString().length) return;
    var frag = sous.extractContents();
    Array.prototype.forEach.call(frag.querySelectorAll('.ligne-outils'), function (o) { o.remove(); });
    Array.prototype.slice.call(frag.querySelectorAll('mark')).forEach(deballer);
    var m = document.createElement('mark');
    m.appendChild(frag);
    sous.insertNode(m);
    if (!el.querySelector(':scope > .ligne-outils') && outilsAttendus(el)) decorerLigne(el);
    marques.push(m);
  });
  if (marques.length) {
    var nr = document.createRange();
    nr.setStartBefore(marques[0]);
    nr.setEndAfter(marques[marques.length - 1]);
    s.removeAllRanges();
    s.addRange(nr);
  }
  apresStructure();
}

/* Ctrl+K: adds, edits or removes a link (empty address = remove). */
function insererLien() {
  var doc = docNotes(), s = window.getSelection();
  if (!doc || !s.rangeCount || !doc.contains(s.getRangeAt(0).startContainer)) return;
  var memo = memoriserSelectionIndices();
  var existant = parentBalise(s.anchorNode, 'A', doc);
  var vide = s.isCollapsed;
  demander({ titre: existant ? 'Edit link' : 'Add link', libelle: 'Address', valeur: existant ? existant.getAttribute('href') : '', placeholder: 'https://…', ok: 'OK' }).then(function (url) {
    restaurerSelectionIndices(memo);
    if (url === null) return;
    url = String(url).trim();
    if (!url) {
      if (existant && doc.contains(existant)) deballer(existant);
      apresStructure();
      return;
    }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (existant && doc.contains(existant)) existant.setAttribute('href', url);
    else if (vide) document.execCommand('insertHTML', false, '<a href="' + echapper(url) + '">' + echapper(url) + '</a>');
    else document.execCommand('createLink', false, url);
    lignesDe(doc).forEach(titresLiens);
    apresStructure();
  });
}

/* ---------- Paste and drop: always plain text ---------- */

function texteColle(ev) {
  var d = ev.clipboardData || window.clipboardData;
  var t = d ? d.getData('text/plain') : '';
  return String(t || '').replace(/\r\n?/g, '\n').replace(/[\u2028\u2029\u000b]/g, '\n').replace(/[\u200b\ufeff]/g, '').replace(/\u00a0/g, ' ');
}
/* The text arrives with no formatting at all: the first line at the
   cursor, the following ones as plain text lines. Inside an idea,
   everything stays in the idea. */
function collerTexte(t) {
  var doc = docNotes();
  if (!doc || !t) return;
  t = t.replace(/\n$/, '');
  if (!t) return;
  var s = window.getSelection();
  if (!s.rangeCount || !doc.contains(s.getRangeAt(0).startContainer)) return;
  HISTO.nature = 'collage';
  if (!s.isCollapsed) { document.execCommand('delete'); normaliserDoc(doc); }
  var el = ligneCourante();
  if (!el) return;
  if (el.dataset.type === 'separateur') { el = insererLigneApres(el, { type: 'p' }); placerCaret(el, true); }
  var lignes = t.split('\n');
  if (lignes.length === 1 || el.dataset.type === 'idee') {
    lignes.forEach(function (l, i) {
      if (i) sautDeLigne();
      if (l) document.execCommand('insertText', false, l);
    });
    HISTO.nature = 'collage';
    return;
  }
  var reste = extraireApresCaret(el);
  if (lignes[0]) {
    var r = s.getRangeAt(0);
    var tn = document.createTextNode(lignes[0]);
    r.insertNode(tn);
  }
  completerLigneVide(el);
  var courante = el;
  lignes.slice(1).forEach(function (l) { courante = insererLigneApres(courante, { type: 'p', html: echapper(l) }); });
  var longueur = courante.textContent.length;
  if (reste) {
    retirerSautsFinaux(courante);
    if (ligneVide(courante)) courante.innerHTML = '';
    courante.insertAdjacentHTML('beforeend', nettoyerHtml(reste));
    completerLigneVide(courante);
  }
  placerCaretAOffset(courante, longueur);
  apresStructure();
  HISTO.nature = 'collage';
}

/* ---------- Idea → task ---------- */

/* Creates a "To do" task from a line: the first line of the text becomes
   the title, the rest the description; the task is linked to the page
   and the line keeps the link to the task. */
function creerTacheDepuisLigne(el) {
  if (!el || el.dataset.type === 'separateur') return null;
  var brut = texteBrutDe(nettoyerHtml(el.innerHTML)).replace(/\r/g, '');
  var lignes = brut.split('\n').map(function (l) { return l.trim(); });
  var titre = (lignes.filter(Boolean)[0] || '').trim();
  if (!titre) { notifier('Write the idea on the line first.'); placerCaret(el, true); return null; }
  var description = lignes.slice(lignes.indexOf(lignes.filter(Boolean)[0]) + 1).join('\n').trim();
  var t = creerTache({ titre: titre.slice(0, 200), description: description, statut: 'a-faire', notes: NOTES_PAGE ? [NOTES_PAGE] : [] });
  el.dataset.tache = t.id;
  decorerLigne(el);
  apresStructure();
  rendreTachesLieesNotes();
  rendreRailNotes();
  if (typeof rendrePastilles === 'function') rendrePastilles();
  notifier('Task created in "To do": ' + t.titre, { type: 'succes', action: { libelle: 'Open task', fn: function () { ouvrirEditionTache(t.id); } } });
  return t;
}
function actionTacheLigne() {
  var el = ligneCourante();
  if (!el || el.dataset.type === 'separateur') return;
  if (el.dataset.tache && tacheParId(el.dataset.tache)) ouvrirEditionTache(el.dataset.tache);
  else creerTacheDepuisLigne(el);
}

/* ---------- Markdown shortcuts and "/" menu ---------- */

function raccourciMarkdown(brut) {
  if (/^# $/.test(brut)) return 'h1';
  if (/^## $/.test(brut)) return 'h2';
  if (/^### $/.test(brut)) return 'h3';
  if (/^[-*] $/.test(brut)) return 'puce';
  if (/^1[.)] $/.test(brut)) return 'numero';
  if (/^\[ ?\] $/.test(brut)) return 'case';
  if (/^> $/.test(brut)) return 'citation';
  if (/^!! $/.test(brut)) return 'encadre';
  if (/^\? $/.test(brut)) return 'idee';
  if (/^---$/.test(brut)) return 'separateur';
  return null;
}
/* Typed at the start of a line ("- ", "1. ", "[] ", "# "…), the shortcut
   gives the line its style and disappears; any text already there stays. */
function raccourciMarkdownLigne(el) {
  if (['p', 'puce', 'numero', 'case', 'citation'].indexOf(el.dataset.type) < 0) return false;
  var avant = texteAvantCaret(el);
  if (avant == null) return false;
  var type = raccourciMarkdown(avant.replace(/\u00a0/g, ' '));
  if (!type || type === el.dataset.type) return false;
  if (type === 'separateur') {
    if (el.dataset.type !== 'p' || el.textContent !== '---') return false;
    appliquerType(el, 'separateur');
    var suiv = el.nextElementSibling;
    if (!suiv || suiv.dataset.type === 'separateur') suiv = insererLigneApres(el, { type: 'p' });
    placerCaret(suiv, true);
  } else {
    var s = window.getSelection().getRangeAt(0);
    var r = document.createRange();
    r.setStart(el, 0);
    r.setEnd(s.startContainer, s.startOffset);
    r.deleteContents();
    completerLigneVide(el);
    appliquerType(el, type);
    placerCaret(el, true);
  }
  fermerMenuSlash();
  apresStructure();
  return true;
}

function majMenuSlash(el) {
  if (!el || el.dataset.type === 'separateur') { fermerMenuSlash(); return; }
  var brut = el.textContent;
  if (MENU_SLASH && MENU_SLASH.ligne === el) {
    if (brut.charAt(0) !== '/') fermerMenuSlash();
    else { MENU_SLASH.filtre = brut.slice(1); rendreMenuSlash(); }
  } else if (brut === '/') ouvrirMenuSlash(el);
  else if (MENU_SLASH) fermerMenuSlash();
}
function ouvrirMenuSlash(el) {
  MENU_SLASH = { ligne: el, filtre: '', selection: 0 };
  rendreMenuSlash();
}
function itemsSlash() {
  var f = normaliserCle(MENU_SLASH ? MENU_SLASH.filtre : '');
  return TYPES_BLOC.filter(function (t) { return !f || normaliserCle(t.nom + ' ' + t.sous + ' ' + t.type).indexOf(f) >= 0; });
}
function rendreMenuSlash() {
  var ancien = document.getElementById('menuSlash');
  if (ancien) ancien.remove();
  if (!MENU_SLASH) return;
  var items = itemsSlash();
  if (!items.length) { fermerMenuSlash(); return; }
  if (MENU_SLASH.selection >= items.length) MENU_SLASH.selection = 0;
  var menu = document.createElement('div');
  menu.className = 'menu-blocs';
  menu.id = 'menuSlash';
  menu.innerHTML = '<div class="menu-blocs-titre">Insert</div>' + items.map(function (t, i) {
    return '<button type="button" data-type="' + t.type + '" class="' + (i === MENU_SLASH.selection ? 'selection' : '') + '"><span class="ic">' + echapper(t.ic) + '</span><span>' + echapper(t.nom) + '<span class="sous">' + echapper(t.sous) + (t.raccourci ? ' · ' + echapper(t.raccourci) : '') + '</span></span></button>';
  }).join('');
  menu.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
  menu.addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (b) appliquerSlash(b.dataset.type);
  });
  document.body.appendChild(menu);
  var r = MENU_SLASH.ligne.getBoundingClientRect();
  var top = r.bottom + 4;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
  menu.style.top = top + 'px';
  menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
}
function bougerSelectionSlash(delta) {
  var n = itemsSlash().length;
  if (!n) return;
  MENU_SLASH.selection = (MENU_SLASH.selection + delta + n) % n;
  rendreMenuSlash();
}
function validerSlash() {
  var items = itemsSlash();
  if (items.length) appliquerSlash(items[MENU_SLASH.selection].type);
}
function appliquerSlash(type) {
  if (!MENU_SLASH) return;
  var el = MENU_SLASH.ligne;
  fermerMenuSlash();
  if (!el.parentNode) return;
  el.innerHTML = '<br>';
  if (type === 'separateur') {
    appliquerType(el, 'separateur');
    var suiv = el.nextElementSibling;
    if (!suiv || suiv.dataset.type === 'separateur') suiv = insererLigneApres(el, { type: 'p' });
    placerCaret(suiv, true);
  } else {
    appliquerType(el, type);
    placerCaret(el, true);
  }
  apresStructure();
}
function fermerMenuSlash() {
  MENU_SLASH = null;
  var m = document.getElementById('menuSlash');
  if (m) m.remove();
}

/* ---------- Pages ---------- */

/* Creates a page without displaying it (from a task's edit form). */
function creerPageNotesSilencieuse(titre, parent) {
  var freres = enfantsDe(parent);
  var p = { id: uid('page'), titre: String(titre || '').trim(), parent: parent || null, blocs: [bloc('p', '')], ordre: (freres.length ? Math.max.apply(null, freres.map(function (x) { return x.ordre || 0; })) : 0) + 1, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString() };
  pagesNotes().push(p);
  sauver('notes');
  return p;
}

function creerPageNotes(parent) {
  var p = creerPageNotesSilencieuse('', parent);
  if (parent) NOTES_PLIES[parent] = false;
  NOTES_PAGE = p.id;
  rendreNotes();
  var titre = document.getElementById('ntTitre');
  if (titre) placerCaret(titre, true);
}

function supprimerPageNotes(id) {
  var p = pageParId(id);
  if (!p) return;
  var desc = descendantsDe(id);
  confirmer('Delete the page "' + (p.titre || 'Untitled') + '"' + (desc.length ? ' and its ' + desc.length + ' subpage' + (desc.length > 1 ? 's' : '') : '') + '?', { ok: 'Delete', danger: true, titre: 'Delete page' }).then(function (ok) {
    if (!ok) return;
    var ids = [id].concat(desc.map(function (d) { return d.id; }));
    ETAT.notes.pages = pagesNotes().filter(function (x) { return ids.indexOf(x.id) < 0; });
    /* Linked tasks forget these pages. */
    var touche = false;
    taches().forEach(function (t) { if (Array.isArray(t.notes) && t.notes.some(function (n) { return ids.indexOf(n) >= 0; })) { t.notes = t.notes.filter(function (n) { return ids.indexOf(n) < 0; }); touche = true; } });
    if (touche) sauver('chantiers');
    NOTES_PAGE = p.parent || null;
    sauver('notes');
    rendreNotes();
  });
}

function deplacerPageNotes(id, ancre) {
  var p = pageParId(id);
  if (!p) return;
  var exclus = [id].concat(descendantsDe(id).map(function (d) { return d.id; }));
  var items = [{ libelle: 'To the top level', fn: function () { p.parent = null; p.modifieLe = new Date().toISOString(); sauver('notes'); rendreNotes(); } }];
  var parcourir = function (parent, niveau) {
    enfantsDe(parent).forEach(function (x) {
      if (exclus.indexOf(x.id) >= 0) return;
      items.push({ libelle: (niveau ? '   '.repeat(niveau) + '↳ ' : '') + (x.titre || 'Untitled'), fn: function () { p.parent = x.id; p.modifieLe = new Date().toISOString(); NOTES_PLIES[x.id] = false; sauver('notes'); rendreNotes(); } });
      parcourir(x.id, niveau + 1);
    });
  };
  parcourir(null, 0);
  ouvrirMenu(ancre, items, { titre: 'Move under…' });
}
