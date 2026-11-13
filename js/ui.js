/* ============================================================
   INTERFACE : navigation entre pages, notifications, modales,
   menus flottants, petits composants partagés.
   ============================================================ */
'use strict';

var PAGE_COURANTE = 'tableau';
var PAGES = {};   // nom de page -> fonction de rendu (remplie par les modules page-*.js)

/* Anciens noms de pages : « chantiers » est devenu « taches », et le
   journal vit dans la page du relevé mensuel. */
function afficherPage(nom) {
  if (nom === 'chantiers') nom = 'taches';
  if (nom === 'journal') nom = 'releve';
  if (!document.querySelector('[data-tab-panel="' + nom + '"]')) nom = 'tableau';
  PAGE_COURANTE = nom;
  document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === nom); });
  document.querySelectorAll('.tab-panel').forEach(function (p) { p.style.display = p.dataset.tabPanel === nom ? '' : 'none'; });
  var principal = document.getElementById('principal');
  if (principal) principal.scrollTop = 0;
  rafraichir();
}

/* Re-dessine la page courante et les éléments permanents (pastilles,
   chrono, rappels). À appeler après toute modification des données. */
function rafraichir() {
  var rendu = PAGES[PAGE_COURANTE];
  if (typeof rendu === 'function') rendu();
  if (typeof rendrePastilles === 'function') rendrePastilles();
  if (typeof rendreChronoPied === 'function') rendreChronoPied();
  if (typeof rendreChronoBandeau === 'function') rendreChronoBandeau();
  if (typeof rendreBadgeRappels === 'function') rendreBadgeRappels();
  if (typeof poserBullesBientot === 'function') poserBullesBientot();
}

/* ---------- Notification discrète (barre d'état) ---------- */
var NOTIF_TIMER = null;
function notifier(texte, options) {
  var o = options || {};
  var bar = document.getElementById('statusBar');
  if (!bar) return;
  bar.className = 'status-bar show' + (o.type ? ' ' + o.type : '');
  bar.innerHTML = '<span>' + echapper(texte) + '</span>';
  if (o.action) {
    var b = document.createElement('button');
    b.className = 'lien';
    b.textContent = o.action.libelle;
    b.addEventListener('click', function () { bar.classList.remove('show'); o.action.fn(); });
    bar.appendChild(b);
  }
  clearTimeout(NOTIF_TIMER);
  NOTIF_TIMER = setTimeout(function () { bar.classList.remove('show'); }, o.duree || (o.action ? 9000 : 3800));
}

/* ---------- Modales ---------- */
function ouvrirModale(o) {
  fermerModale();
  var racine = document.getElementById('modaleRacine');
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal' + (o.classe ? ' ' + o.classe : '') + '" role="dialog" aria-modal="true">'
    + '<div class="modal-head"><div><h3>' + echapper(o.titre || '') + '</h3>' + (o.sousTitre ? '<div class="modal-subtitle">' + echapper(o.sousTitre) + '</div>' : '') + '</div>'
    + '<button class="modal-close" title="Fermer" aria-label="Fermer">✕</button></div>'
    + '<div class="modal-body">' + (o.corps || '') + '</div>'
    + (o.pied ? '<div class="modal-foot">' + o.pied + '</div>' : '')
    + '</div>';
  racine.appendChild(overlay);
  overlay.querySelector('.modal-close').addEventListener('click', fermerModale);
  overlay.addEventListener('mousedown', function (ev) { if (ev.target === overlay) fermerModale(); });
  overlay._auFermer = o.auFermer;
  var premier = overlay.querySelector('input:not([type=hidden]), select, textarea, [contenteditable]');
  if (premier && !o.sansFocus) setTimeout(function () { premier.focus(); }, 30);
  return overlay;
}
/* Ferme toute modale ouverte. Le rappel « auFermer » est détaché avant
   d'être appelé : il peut lui-même rouvrir une modale sans boucler. */
function fermerModale() {
  var racine = document.getElementById('modaleRacine');
  if (!racine) return;
  Array.prototype.slice.call(racine.children).forEach(function (el) {
    var fn = el._auFermer;
    el._auFermer = null;
    el.remove();
    if (typeof fn === 'function') { try { fn(); } catch (e) {} }
  });
}
function modaleOuverte() {
  var racine = document.getElementById('modaleRacine');
  return !!(racine && racine.children.length);
}

/* Confirmation : renvoie une promesse booléenne. */
function confirmer(texte, options) {
  var o = options || {};
  return new Promise(function (resoudre) {
    var m = ouvrirModale({
      titre: o.titre || 'Confirmer',
      classe: 'modal-etroite',
      corps: '<p style="margin:0; font-size:13.5px; color:var(--text-secondary); line-height:1.6;">' + echapper(texte) + '</p>',
      pied: '<div class="a-droite"><button class="btn btn-ghost" data-role="annuler">Annuler</button>'
        + '<button class="btn ' + (o.danger ? 'btn-danger-ligne' : '') + '" data-role="ok">' + echapper(o.ok || 'Confirmer') + '</button></div>',
      auFermer: function () { resoudre(false); },
      sansFocus: true,
    });
    m.querySelector('[data-role=annuler]').addEventListener('click', fermerModale);
    m.querySelector('[data-role=ok]').addEventListener('click', function () { m._auFermer = null; fermerModale(); resoudre(true); });
    setTimeout(function () { m.querySelector('[data-role=ok]').focus(); }, 30);
  });
}

/* Petite question à réponse texte, date ou texte long. */
function demander(o) {
  return new Promise(function (resoudre) {
    var champHtmlLocal = o.type === 'textarea'
      ? '<textarea id="demanderValeur" rows="' + (o.lignes || 5) + '" ' + (o.placeholder ? 'placeholder="' + echapper(o.placeholder) + '"' : '') + '>' + echapper(o.valeur || '') + '</textarea>'
      : '<input type="' + (o.type || 'text') + '" id="demanderValeur" value="' + echapper(o.valeur || '') + '" ' + (o.placeholder ? 'placeholder="' + echapper(o.placeholder) + '"' : '') + '>';
    var m = ouvrirModale({
      titre: o.titre || '',
      classe: o.type === 'textarea' ? '' : 'modal-etroite',
      corps: (o.texte ? '<p class="petit" style="margin:0 0 12px;">' + echapper(o.texte) + '</p>' : '')
        + '<div class="field"><label>' + echapper(o.libelle || '') + '</label>' + champHtmlLocal + '</div>',
      pied: '<div class="a-droite"><button class="btn btn-ghost" data-role="annuler">Annuler</button><button class="btn" data-role="ok">' + echapper(o.ok || 'Valider') + '</button></div>',
      auFermer: function () { resoudre(null); },
    });
    var champ = m.querySelector('#demanderValeur');
    var valider = function () { var v = champ.value; m._auFermer = null; fermerModale(); resoudre(v); };
    m.querySelector('[data-role=annuler]').addEventListener('click', fermerModale);
    m.querySelector('[data-role=ok]').addEventListener('click', valider);
    champ.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && (o.type !== 'textarea' || ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); valider(); } });
  });
}

/* ---------- Menu flottant ---------- */
function ouvrirMenu(ancre, items, options) {
  fermerMenu();
  var menu = document.createElement('div');
  menu.className = 'menu-blocs';
  menu.id = 'menuFlottant';
  var html = '';
  if (options && options.titre) html += '<div class="menu-blocs-titre">' + echapper(options.titre) + '</div>';
  items.forEach(function (it, i) {
    if (it === 'sep') { html += '<div class="sep"></div>'; return; }
    if (it && it.titre) { html += '<div class="menu-blocs-titre">' + echapper(it.titre) + '</div>'; return; }
    html += '<button type="button" data-i="' + i + '" class="' + (it.danger ? 'danger' : '') + '">'
      + (it.icone ? '<span class="ic">' + it.icone + '</span>' : '')
      + '<span>' + echapper(it.libelle) + (it.sous ? '<span class="sous">' + echapper(it.sous) + '</span>' : '') + '</span></button>';
  });
  if (!html) html = '<div class="menu-blocs-titre">Rien à proposer</div>';
  menu.innerHTML = html;
  document.body.appendChild(menu);
  var r = ancre.getBoundingClientRect();
  var top = r.bottom + 4, left = r.left;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
  if (left + menu.offsetWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menu.offsetWidth - 8);
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
  menu.addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    var it = items[Number(b.dataset.i)];
    fermerMenu();
    if (it && typeof it.fn === 'function') it.fn();
  });
  setTimeout(function () {
    document.addEventListener('mousedown', fermerMenuSiDehors);
    document.addEventListener('keydown', fermerMenuEchap);
  }, 0);
  return menu;
}
function fermerMenuSiDehors(ev) {
  var menu = document.getElementById('menuFlottant');
  if (menu && !menu.contains(ev.target)) fermerMenu();
}
function fermerMenuEchap(ev) { if (ev.key === 'Escape') fermerMenu(); }
function fermerMenu() {
  var menu = document.getElementById('menuFlottant');
  if (menu) menu.remove();
  document.removeEventListener('mousedown', fermerMenuSiDehors);
  document.removeEventListener('keydown', fermerMenuEchap);
}

/* ---------- Composants partagés ---------- */
function optionsAxesHtml(valeur, avecVide) {
  var html = avecVide ? '<option value="">Tous les axes</option>' : '';
  axes().forEach(function (a) {
    html += '<option value="' + echapper(a.id) + '"' + (a.id === valeur ? ' selected' : '') + '>' + echapper(a.nom) + '</option>';
  });
  return html;
}
function selectMoisHtml(id, moisChoisi, options) {
  var o = options || {};
  var liste = o.liste || moisDuContrat();
  var html = '<select id="' + id + '" class="champ"' + (o.pleineLargeur ? '' : ' style="width:auto;"') + '>';
  if (o.tout) html += '<option value="tout"' + (moisChoisi === 'tout' ? ' selected' : '') + '>' + echapper(o.tout) + '</option>';
  html += optionsMoisHtml(liste, moisChoisi);
  html += '</select>';
  return html;
}
/* Les options seules, pour reconstruire une liste de mois sans refaire le select. */
function optionsMoisHtml(liste, moisChoisi) {
  return (liste || []).map(function (m) {
    return '<option value="' + m + '"' + (m === moisChoisi ? ' selected' : '') + '>' + capitaliser(libelleMois(m)) + '</option>';
  }).join('');
}
/* Les mois du contrat, élargis aux mois qui portent des saisies ou des
   factures, et au mois courant. */
function moisDuContrat() {
  var c = ETAT.reglages.contrat || {};
  var debut = c.debut ? moisDe(c.debut) : moisCourant();
  var fin = c.fin ? moisDe(c.fin) : ajouterMois(debut, 11);
  var courant = moisCourant();
  if (courant < debut) debut = courant;
  if (courant > fin) fin = courant;
  entreesJournal().forEach(function (e) {
    [moisDe(e.date), moisFacturationDe(e)].forEach(function (m) {
      if (m && m < debut) debut = m;
      if (m && m > fin) fin = m;
    });
  });
  factures().forEach(function (f) { if (f.mois && f.mois < debut) debut = f.mois; if (f.mois && f.mois > fin) fin = f.mois; });
  return listeMois(debut, fin);
}

/* ---------- Mois de facturation et report ----------
   Un travail se facture sur son mois, ou sur un mois suivant : jamais
   avant qu'il n'ait été fait. Le mois du travail reste toujours offert,
   pour que le report se défasse aussi simplement qu'il se pose. */

function moisFacturationPossibles(moisTravail, moisChoisi) {
  var plancher = moisTravail || moisCourant();
  if (moisChoisi && moisChoisi < plancher) plancher = moisChoisi;
  var liste = moisDuContrat().filter(function (m) { return m >= plancher; });
  var dernier = liste.length ? liste[liste.length - 1] : plancher;
  var six = ajouterMois(plancher, 6);
  return listeMois(plancher, six > dernier ? six : dernier);
}
/* Les tâches proposées pour lier une ligne du journal : en cours, puis à
   faire, puis faites (une ligne peut rejoindre une tâche déjà terminée). */
function optionsTachesHtml(valeur) {
  var libelles = { 'en-cours': 'En cours', 'a-faire': 'À faire', 'fait': 'Fait' };
  var html = '<option value=""' + (!valeur ? ' selected' : '') + '>Aucune</option>';
  ['en-cours', 'a-faire', 'fait'].forEach(function (statut) {
    var liste = trierTaches(taches().filter(function (t) { return t.statut === statut; }));
    if (!liste.length) return;
    html += '<optgroup label="' + libelles[statut] + '">' + liste.map(function (t) {
      return '<option value="' + echapper(t.id) + '"' + (t.id === valeur ? ' selected' : '') + '>' + echapper(t.titre) + '</option>';
    }).join('') + '</optgroup>';
  });
  return html;
}
/* Toutes les lignes du même travail : elles se reportent ensemble. */
function lignesMemeIntervention(e) {
  if (!e || !e.date) return e ? [e] : [];
  var cle = cleTravail(e);
  return entreesJournal().filter(function (x) { return x && x.date && cleTravail(x) === cle; });
}
/* Vrai si une ligne de ce travail est déjà figée sur une facture : le mois
   de facturation ne bouge plus. */
function interventionFigee(e) {
  var lesFactures = factures();
  return lignesMemeIntervention(e).some(function (x) { return !peutReporter(x, lesFactures); });
}
/* Le texte d'aide sous le choix du mois de facturation. */
function aideMoisFacturation(moisTravail, moisChoisi) {
  if (!moisChoisi || moisChoisi === moisTravail) return 'Par défaut, le mois du travail. Choisissez un mois plus tard pour porter ce travail sur un relevé et une facture ultérieurs.';
  if (moisChoisi < moisTravail) return 'Un travail ne se facture pas avant d\'avoir été fait : choisissez ' + libelleMois(moisTravail) + ' ou un mois plus tard.';
  var lesFactures = factures().filter(function (f) { return f.mois === moisChoisi; });
  return 'Le journal garde la date du travail ; le relevé ' + deLibelleMois(moisChoisi) + ' le porte.'
    + (lesFactures.length ? ' Ce mois porte déjà ' + (lesFactures.length > 1 ? lesFactures.length + ' factures' : 'la facture n° ' + lesFactures[0].numero) + ' : le report donnera lieu à une facture supplémentaire.' : '');
}
/* Une ligne qui rejoint une intervention déjà reportée prend son mois de
   facturation : une intervention ne se coupe pas en deux. */
function heriterMoisFacturation(e) {
  var soeurs = lignesMemeIntervention(e).filter(function (x) { return x.id !== e.id; });
  if (!soeurs.length) return null;
  /* Le mois d'une sœur déjà portée par une facture fait foi. */
  var lesFactures = factures();
  var reference = soeurs.filter(function (x) { return !peutReporter(x, lesFactures); })[0] || soeurs[0];
  var m = moisFacturationDe(reference);
  e.moisFacturation = m && m !== moisDe(e.date) ? m : null;
  return e.moisFacturation;
}
/* Écrit le mois de facturation sur des lignes du journal (null pour revenir
   au mois du travail), en refusant celles qu'une facture a figées. */
function appliquerMoisFacturation(lignes, mois) {
  var lesFactures = factures();
  var modifiables = (lignes || []).filter(function (e) {
    /* Jamais avant que le travail n'ait été fait : une facture ne peut pas
       porter une prestation postérieure à son mois. */
    if (mois && e && e.date && mois < moisDe(e.date)) return false;
    return peutReporter(e, lesFactures);
  });
  if (!modifiables.length) return 0;
  var maintenant = new Date().toISOString();
  var n = 0;
  modifiables.forEach(function (e) {
    var cible = mois && mois !== moisDe(e.date) ? mois : null;
    if ((e.moisFacturation || null) === cible) return;
    e.moisFacturation = cible;
    e.modifieLe = maintenant;
    n++;
  });
  if (n) sauver('journal');
  return n;
}

/* Pastilles de la barre latérale. */
function rendrePastilles() {
  var m = moisCourant();
  var minutesMois = totauxEntrees(entreesDuMois(entreesJournal(), m), ETAT.reglages).minutesFacturables;
  var pj = document.getElementById('pastilleJournal');
  if (pj) pj.textContent = minutesMois ? fmtHeuresDec(minutesMois, true) + ' h' : '';
  var enCours = taches().filter(function (t) { return t.statut === 'en-cours'; }).length;
  var pt = document.getElementById('pastilleTaches');
  if (pt) pt.textContent = enCours ? String(enCours) : '';
  var ref = aujourdhui();
  var proches = echeances().filter(function (e) { return !e.fait && joursEntre(ref, e.date) <= 14; }).length;
  var pe = document.getElementById('pastilleEcheances');
  if (pe) pe.textContent = proches ? String(proches) : '';
  var impayees = factures().filter(function (f) { return f.statut !== 'payee'; }).length;
  var pr = document.getElementById('pastilleReleve');
  if (pr) { pr.textContent = impayees ? String(impayees) : ''; pr.title = impayees ? impayees + (impayees > 1 ? ' factures à encaisser' : ' facture à encaisser') : ''; }
}

/* Raccourci de construction d'une ligne de formulaire. */
function champHtml(id, libelle, type, valeur, extra) {
  return '<div class="field' + (extra && extra.classe ? ' ' + extra.classe : '') + '"><label for="' + id + '">' + echapper(libelle) + '</label>'
    + (type === 'textarea'
      ? '<textarea id="' + id + '" ' + (extra && extra.attrs ? extra.attrs : '') + '>' + echapper(valeur || '') + '</textarea>'
      : '<input type="' + type + '" id="' + id + '" value="' + echapper(valeur == null ? '' : valeur) + '" ' + (extra && extra.attrs ? extra.attrs : '') + '>')
    + '</div>';
}

/* ---------- Icônes en SVG (traits fins, couleur courante) ---------- */
var ICONES = {
  play: '<path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5v10M13 5v10" stroke-width="2.2"/>',
  crayon: '<path d="M4 16l1-4 8.5-8.5a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L8 15z"/>',
  copie: '<rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M4 13V5a1 1 0 0 1 1-1h8"/>',
  corbeille: '<path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  haut: '<path d="M10 15V5M5 10l5-5 5 5"/>',
  bas: '<path d="M10 5v10M5 10l5 5 5-5"/>',
  coche: '<path d="M4 10.5l4 4 8-9"/>',
  points: '<circle cx="5" cy="10" r="1.4" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.4" fill="currentColor" stroke="none"/>',
  document: '<path d="M6 3h6l4 4v10H6z"/><path d="M12 3v4h4"/>',
  chrono: '<circle cx="10" cy="11" r="6"/><path d="M10 8v3l2 2M8 3h4"/>',
  poignee: '<circle cx="7" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="13" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="7" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="13" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="7" cy="14" r="1.2" fill="currentColor" stroke="none"/><circle cx="13" cy="14" r="1.2" fill="currentColor" stroke="none"/>',
  cloche: '<path d="M6 13.5V9a4 4 0 0 1 8 0v4.5l1.5 1.5h-11z"/><path d="M8.5 16.5a1.5 1.5 0 0 0 3 0"/>',
  lien: '<path d="M8.5 11.5l3-3"/><path d="M7 13l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L4.8 8.2a2.5 2.5 0 0 1 3.5 0"/><path d="M13 7l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5l-2.5 2.5a2.5 2.5 0 0 1-3.5 0"/>',
  image: '<rect x="3.5" y="4.5" width="13" height="11" rx="1.5"/><circle cx="7.5" cy="8.5" r="1.3"/><path d="M4 14l4-4 3 3 2-2 3.5 3.5"/>',
  code: '<path d="M7 6l-4 4 4 4M13 6l4 4-4 4M11.5 4.5l-3 11"/>',
  fichier: '<path d="M6 3h6l4 4v10H6z"/><path d="M12 3v4h4M8 11h5M8 14h5"/>',
  trombone: '<path d="M14 8.5l-5.2 5.2a2 2 0 0 1-2.8-2.8l5.5-5.5a3.2 3.2 0 0 1 4.5 4.5L10.5 15.5a4.4 4.4 0 0 1-6.2-6.2L9.5 4"/>',
  ampoule: '<path d="M7 15.5h6M8 17.5h4M6.5 8.5a3.5 3.5 0 1 1 7 0c0 1.8-1.2 2.6-1.7 3.5-.3.5-.3 1-.3 1.5H8.5c0-.5 0-1-.3-1.5-.5-.9-1.7-1.7-1.7-3.5z"/>',
  note: '<path d="M5 3.5h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z"/><path d="M7 7.5h6M7 10.5h6M7 13.5h3"/>',
  externe: '<path d="M11 4h5v5M16 4l-7 7"/><path d="M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5"/>',
  fleche: '<path d="M4 10h12M11 5l5 5-5 5"/>',
  horloge: '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.5"/>',
  dossier: '<path d="M3.5 6.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/>',
  grille: '<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.3"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.3"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.3"/><rect x="11" y="11" width="5.5" height="5.5" rx="1.3"/>',
  reglages: '<path d="M3.5 6.5h7M15.5 6.5h1M3.5 13.5h1M8.5 13.5h8"/><circle cx="13" cy="6.5" r="2"/><circle cx="6.5" cy="13.5" r="2"/>',
  aide: '<circle cx="10" cy="10" r="6.5"/><path d="M8.2 8.2a1.9 1.9 0 1 1 2.6 1.7c-.5.2-.8.6-.8 1.1v.4"/><circle cx="10" cy="13.6" r="0.5" fill="currentColor"/>',
  calendrier: '<rect x="3.5" y="5" width="13" height="11.5" rx="1.5"/><path d="M3.5 9h13M7 3.5v3M13 3.5v3"/>',
  case: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M7 10.5l2 2 4-5"/>',
  cercleCoche: '<circle cx="10" cy="10" r="6.5"/><path d="M7.3 10.2l1.9 1.9 3.6-4"/>',
  liste: '<circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="14" r="1.1" fill="currentColor" stroke="none"/><path d="M8.5 6h8M8.5 10h8M8.5 14h8"/>',
  listeNumeros: '<path d="M8.5 6h8M8.5 10h8M8.5 14h8"/><path d="M3.4 4.6l1.3-.8v4" stroke-width="1.3"/><path d="M3.2 11.3c.2-.7 2.3-.9 2.3.3 0 .9-2.3 1.6-2.3 2.6h2.4" stroke-width="1.3"/>',
  encadre: '<rect x="3.5" y="4" width="13" height="12" rx="2"/><path d="M10 7v4.2M10 13.6v.2"/>',
  trait: '<path d="M3.5 10h13"/>',
  surligneur: '<path d="M6 13.5l1-3.5 6.5-6.5 2.5 2.5-6.5 6.5z"/><path d="M5.5 14l-1.5 2.5h3.5"/><path d="M3.5 17.5h13" stroke-width="2.2"/>',
  annuler: '<path d="M7 5L3.5 8.5 7 12"/><path d="M3.5 8.5h8a4.5 4.5 0 0 1 0 9H9"/>',
  retablir: '<path d="M13 5l3.5 3.5L13 12"/><path d="M16.5 8.5h-8a4.5 4.5 0 0 0 0 9H11"/>',
  chevron: '<path d="M8 5.5l4.5 4.5L8 14.5"/>',
};
function icone(nom, taille) {
  var t = taille || 15;
  return '<svg viewBox="0 0 20 20" width="' + t + '" height="' + t + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONES[nom] || '') + '</svg>';
}
function boutonIcone(action, nom, titre, classes, id) {
  return '<button type="button" class="btn-icone' + (classes ? ' ' + classes : '') + '" data-action="' + action + '"' + (id ? ' data-id="' + echapper(id) + '"' : '') + ' title="' + echapper(titre) + '" aria-label="' + echapper(titre) + '">' + icone(nom) + '</button>';
}
