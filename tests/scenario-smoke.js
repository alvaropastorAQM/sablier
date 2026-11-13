/* Self-test scenario (SABLIER_SMOKE_SCENARIO=1): timer, tasks, notes, attachments, reminders, templates.
   Body of an async function run in the page by the self-test (src-tauri/src/autotest.rs); FICHIER_TEST and
   IMAGE_TEST are the paths of a text file and a one-pixel image prepared by the self-test. Each key of
   res is true when the expected behaviour is observed. */
var res = {};
function ev(el, type, opts) { el.dispatchEvent(type === 'input' ? new Event('input', { bubbles: true }) : new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, opts))); }
try {
  /* --- Timer: stop then restart --- */
  if (!chronoEnCours()) demarrerChrono({ axe: 'projeta', intervention: 'Starting timer', detail: '' });
  var avant = entreesJournal().length;
  var e = arreterChrono(true);
  res.chronoArret = !!e && entreesJournal().length === avant + 1 && e.minutes >= 1;
  demarrerChrono({ axe: 'suivi', intervention: 'Timer test', detail: '' });
  res.chronoDemarre = !!chronoEnCours() && chronoEnCours().intervention === 'Timer test';
  arreterChrono(true);
  res.chronoCourtEnregistre = !chronoEnCours() && entreesJournal().length === avant + 2 && entreesJournal()[avant + 1].minutes === 1;
  /* --- Log and statement: the timer's day unfolds into its entries --- */
  RELEVE_JOURS = {};
  afficherPage('journal');
  var jourChrono = document.querySelector('#releveContenu .rl-jour[data-jour="' + e.date + '"]');
  if (jourChrono) jourChrono.click();
  res.journeeDepliee = !!jourChrono && !!document.querySelector('#releveContenu .rl-detail .jr-ligne[data-id="' + e.id + '"]');
  res.sansBoutonExport = !document.querySelector('#releveContenu [data-action="pdf-releve"]');
  /* --- Card and deadline buttons (ids) --- */
  afficherPage('taches');
  var boutons = Array.prototype.slice.call(document.querySelectorAll('.kb-carte .btn-icone[data-action]'));
  res.cartesAvecId = boutons.length > 0 && boutons.every(function (b) { return !!b.dataset.id; });
  res.troisColonnes = document.querySelectorAll('.kb-colonne').length === 3 && !document.querySelector('.kb-colonne[data-statut="idee"]');
  afficherPage('echeances');
  var be = Array.prototype.slice.call(document.querySelectorAll('.ec-actions .btn-icone[data-action]'));
  res.echeancesAvecId = be.length > 0 && be.every(function (b) { return !!b.dataset.id; });
  /* --- Timer from a card, banner, pause, resume, stop --- */
  afficherPage('taches');
  var carteChrono = document.querySelector('.kb-carte .btn-icone[data-action=chrono]');
  carteChrono.click();
  var cc = chronoEnCours();
  res.chronoDepuisCarte = !!cc && cc.tache === carteChrono.dataset.id && cc.intervention === tacheParId(carteChrono.dataset.id).titre;
  var bandeau = document.getElementById('chronoBandeau');
  res.bandeauVisible = bandeau.classList.contains('visible') && bandeau.textContent.indexOf(cc.intervention) >= 0;
  afficherPage('notes');
  res.bandeauPartout = document.getElementById('chronoBandeau').classList.contains('visible');
  document.querySelector('#chronoBandeau [data-action=pause]').click();
  res.pause = chronoEnPause() && document.getElementById('chronoBandeau').classList.contains('en-pause');
  var tPause = dureeChronoMs(chronoEnCours());
  await new Promise(function (r) { setTimeout(r, 1200); });
  res.pauseFige = dureeChronoMs(chronoEnCours()) === tPause;
  document.querySelector('#chronoBandeau [data-action=pause]').click();
  res.reprise = !chronoEnPause() && dureeChronoMs(chronoEnCours()) < 1000;
  var avantStop = entreesJournal().length;
  document.querySelector('#chronoBandeau [data-action=arreter]').click();
  var ligneStop = entreesJournal()[entreesJournal().length - 1];
  res.arretDepuisBandeau = entreesJournal().length === avantStop + 1 && ligneStop.minutes === 1 && ligneStop.tache === carteChrono.dataset.id && !chronoEnCours() && !document.getElementById('chronoBandeau').classList.contains('visible');
  fermerModale();
  /* --- Priorities, automatic card sorting --- */
  var refJ = aujourdhui();
  var creerTest = function (titre, prio, jours) {
    var tt = normaliserTache({ id: uid('tt'), statut: 'a-faire', axe: 'projeta', titre: titre, description: '', priorite: prio, echeance: jours == null ? null : ajouterJours(refJ, jours), ordre: 999, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), faitLe: null });
    taches().push(tt); return tt;
  };
  var tUrgent = creerTest('Urgent test (low, 2 days)', 'basse', 2);
  var tHaute = creerTest('Manual high test (40 days)', 'haute', 40);
  var tMoyen = creerTest('Auto test (10 days)', 'auto', 10);
  var tLoin = creerTest('Auto test (30 days)', 'auto', 30);
  sauver('chantiers');
  afficherPage('taches');
  var ordreDom = Array.prototype.map.call(document.querySelectorAll('.kb-colonne[data-statut="a-faire"] .kb-carte'), function (c) { return c.dataset.id; });
  var posDe = function (tt) { return ordreDom.indexOf(tt.id); };
  res.triPriorites = posDe(tUrgent) === 0 && posDe(tHaute) === 1 && posDe(tMoyen) === 2 && posDe(tLoin) === 3 && ordreDom.length > 4;
  res.prioriteRelevee = prioriteEffective(tUrgent, refJ).niveau === 'haute' && prioriteEffective(tUrgent, refJ).origine === 'echeance' && prioriteEffective(tHaute, refJ).niveau === 'haute' && prioriteEffective(tMoyen, refJ).niveau === 'moyenne' && prioriteEffective(tLoin, refJ).niveau === 'basse';
  res.pastilleHaute = !!document.querySelector('.kb-carte[data-id="' + tUrgent.id + '"] .kb-priorite.haute') && !!document.querySelector('.kb-carte[data-id="' + tMoyen.id + '"] .kb-priorite.moyenne');
  res.puceCouleur = !!document.querySelector('.kb-carte .puce-axe .axe-point') && !document.querySelector('.puce-axe .code');
  /* --- Pointer drag and drop to "In progress" --- */
  var carteEl = document.querySelector('.kb-carte[data-id="' + tLoin.id + '"]');
  var colCible = document.querySelector('.kb-colonne[data-statut="en-cours"]');
  var r1 = carteEl.getBoundingClientRect(), r2 = colCible.getBoundingClientRect();
  var pe = function (type, x, y, cible) { (cible || document).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, isPrimary: true, pointerType: 'mouse' })); };
  pe('pointerdown', r1.left + 20, r1.top + 12, carteEl);
  pe('pointermove', r1.left + 40, r1.top + 30);
  res.glisserDemarre = !!document.querySelector('.kb-placeholder') && carteEl.classList.contains('kb-flottante');
  pe('pointermove', r2.left + r2.width / 2, r2.top + 70);
  res.emplacementDansCible = !!colCible.querySelector('.kb-placeholder');
  pe('pointerup', r2.left + r2.width / 2, r2.top + 70);
  await new Promise(function (r) { setTimeout(r, 300); });
  res.deposeEnCours = tacheParId(tLoin.id).statut === 'en-cours' && !document.querySelector('.kb-placeholder') && !document.querySelector('.kb-flottante');
  /* a single click on a card opens its sheet */
  var carteClic = document.querySelector('.kb-carte[data-id="' + tHaute.id + '"]');
  var rc = carteClic.getBoundingClientRect();
  pe('pointerdown', rc.left + 20, rc.top + 12, carteClic);
  pe('pointerup', rc.left + 21, rc.top + 12, carteClic);
  res.clicOuvreFiche = modaleOuverte() && document.querySelector('#tcTitre').value === tHaute.titre;
  fermerModale();
  ETAT.chantiers.taches = taches().filter(function (tt) { return [tUrgent.id, tHaute.id, tMoyen.id, tLoin.id].indexOf(tt.id) < 0; });
  sauver('chantiers');
  afficherPage('taches');
  /* --- Edit a card from its button --- */
  document.querySelector('.kb-carte .btn-icone[data-action=modifier]').click();
  res.modaleCarte = modaleOuverte() && !!document.querySelector('#tcTitre');
  fermerModale();
  /* --- Migration of ideas to notes --- */
  taches().push({ id: 'idee_test', statut: 'idee', axe: 'gouvernance', titre: 'Test idea', description: 'A detail', interet: 'fort', effort: 'petit', prerequis: 'rien', priorite: 'auto', echeance: null, ordre: 999, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), faitLe: null });
  var nbAvant = pageIdees().blocs.length;
  var nbMigre = migrerIdeesVersNotes();
  sauver('chantiers'); sauver('notes');
  var blocMigre = pageIdees().blocs[nbAvant];
  res.migrationIdees = nbMigre === 1 && pageIdees().blocs.length === nbAvant + 1 && !taches().some(function (x) { return x.statut === 'idee'; }) && blocMigre.type === 'idee' && blocMigre.html.indexOf('<b>Test idea</b>') === 0 && blocMigre.html.indexOf('Interest: fort') > 0;
  res.ideesDefautDansNotes = pageIdees().blocs.filter(function (b) { return b.type === 'idee'; }).length >= 4;
  /* --- Idea to task --- */
  afficherPage('notes');
  ouvrirPageNotes('page_idees');
  var lignesIdee = document.querySelectorAll('#ntDoc .ligne-idee');
  var ligneIdee = lignesIdee[lignesIdee.length - 1];
  res.blocIdeeRendu = !!ligneIdee && !!ligneIdee.querySelector('[data-bloc-action=tache]');
  var nbT = taches().length;
  var nouvelle = creerTacheDepuisLigne(ligneIdee);
  res.conversionIdee = !!nouvelle && taches().length === nbT + 1 && nouvelle.titre === 'Test idea' && nouvelle.statut === 'a-faire' && nouvelle.description.indexOf('A detail') === 0 && nouvelle.notes.indexOf('page_idees') >= 0
    && !!document.querySelector('#ntDoc .ligne[data-tache="' + nouvelle.id + '"] [data-bloc-action=ouvrir-tache]') && pageParId('page_idees').blocs.some(function (b) { return b.tache === nouvelle.id; });
  res.tachesLieesStrip = !!document.querySelector('#ntTaches .chip-tache[data-id="' + nouvelle.id + '"]');
  /* --- Full sheet: steps, attachments, notes, progress, time --- */
  afficherPage('taches');
  ouvrirEditionTache(nouvelle.id);
  res.ficheSections = ['etapes', 'pieces', 'notes', 'avancement', 'temps'].every(function (s) { return !!document.querySelector('.fiche-section[data-section="' + s + '"]'); });
  ajouterEtapeTache(nouvelle, 'First step');
  ajouterEtapeTache(nouvelle, 'Second step');
  basculerEtapeTache(nouvelle, nouvelle.etapes[0].id, true);
  res.etapes = nouvelle.etapes.length === 2 && nouvelle.etapes[0].fait === true && document.querySelector('.fiche-section[data-section="etapes"] .nb').textContent === '1/2' && document.querySelectorAll('.fiche-section[data-section="etapes"] .etape').length === 2;
  ajouterPieceCode(nouvelle, { nom: 'example.js', langage: 'javascript', contenu: 'console.log(1)' });
  res.pieceCode = nouvelle.pieces.length === 1 && !!document.querySelector('.fiche-section[data-section="pieces"] .piece-code pre') && document.querySelector('.piece-code pre').textContent === 'console.log(1)';
  ajouterPieceLien(nouvelle, { nom: 'Documentation', url: 'example.org/doc' });
  res.pieceLien = nouvelle.pieces.length === 2 && nouvelle.pieces[1].url === 'https://example.org/doc' && !!document.querySelector('.piece-ligne .piece-nom');
  var okFichier = await ajouterPiecesFichiers(nouvelle, [FICHIER_TEST, IMAGE_TEST]);
  var pf = nouvelle.pieces.filter(function (p) { return p.type === 'fichier' && !p.image; })[0];
  var pi = nouvelle.pieces.filter(function (p) { return p.type === 'fichier' && p.image; })[0];
  res.pieceFichier = okFichier === true && !!pf && pf.nom === 'sablier-piece-test.txt' && pf.taille > 0 && !!pi && pi.nom === 'sablier-pixel.png';
  res.pieceFichierChemin = pf ? pf.fichier : '';
  var img = document.querySelector('.fiche-section[data-section="pieces"] .piece-image img');
  res.imageUrl = !!img && /^(sablier-piece:\/\/|http:\/\/sablier-piece\.localhost\/)pieces\//.test(img.getAttribute('src'));
  await new Promise(function (r) { if (!img || img.complete) return r(); img.addEventListener('load', r); img.addEventListener('error', r); setTimeout(r, 2500); });
  res.imageChargee = !!img && img.complete && img.naturalWidth === 1;
  lierTacheANote(nouvelle.id, 'page_projeta');
  apresMutationTache(nouvelle, 'notes');
  res.lienNote = nouvelle.notes.indexOf('page_projeta') >= 0 && tachesLieesAPage('page_projeta').length === 1 && document.querySelectorAll('.fiche-section[data-section="notes"] .chip-note').length === 2;
  ajouterAvancementTache(nouvelle, 'First progress update');
  res.avancement = nouvelle.avancement.length === 1 && !!document.querySelector('.fiche-section[data-section="avancement"] .avancement-entree');
  demarrerChrono({ axe: nouvelle.axe, intervention: nouvelle.titre, tache: nouvelle.id });
  arreterChrono(true);
  fermerModale();
  ouvrirEditionTache(nouvelle.id);
  res.tempsTache = minutesTache(entreesJournal(), nouvelle.id).minutes === 1 && document.querySelector('.fiche-section[data-section="temps"] .temps-resume b').textContent === '1 min';
  fermerModale();
  res.carteCompteurs = !!document.querySelector('.kb-carte[data-id="' + nouvelle.id + '"] .kb-compteurs') && !!document.querySelector('.kb-carte[data-id="' + nouvelle.id + '"] .kb-progres');
  /* --- Reminders --- */
  echeances().push({ id: 'ech_test', date: ajouterJours(aujourdhui(), -2), titre: 'Overdue test deadline', detail: '', type: 'perso', fait: false, faitLe: null, creeLe: new Date().toISOString() });
  echeances().push({ id: 'ech_test2', date: ajouterJours(aujourdhui(), 5), titre: 'Test deadline, 5 days out', detail: '', type: 'perso', rappelJours: 3, fait: false, faitLe: null, creeLe: new Date().toISOString() });
  sauver('echeances');
  nouvelle.echeance = aujourdhui(); sauver('chantiers');
  var rr = rappelsActifs();
  res.rappelsEcheance = rr.some(function (r) { return r.cle === 'echeance:ech_test' && r.niveau === 'retard'; }) && !rr.some(function (r) { return r.cle === 'echeance:ech_test2'; });
  res.rappelTache = rr.some(function (r) { return r.cle === 'tache:' + nouvelle.id && r.niveau === 'urgent'; });
  rafraichir();
  res.pastilleRappels = Number(document.getElementById('pastilleRappels').textContent) === rr.length && document.getElementById('btnRappels').classList.contains('urgent');
  ouvrirRappels();
  res.panneauRappels = modaleOuverte() && !!document.querySelector('.modal-rappels .rappel[data-cle="echeance:ech_test"]') && !!document.querySelector('.modal-rappels .rappels-groupe h4.niveau-retard');
  reporterRappel('echeance:ech_test', 1);
  res.report = !rappelsActifs().some(function (r) { return r.cle === 'echeance:ech_test'; }) && !!document.querySelector('.modal-rappels .rappel.reporte[data-cle="echeance:ech_test"]');
  reporterRappel('echeance:ech_test', 0);
  res.reactive = rappelsActifs().some(function (r) { return r.cle === 'echeance:ech_test'; });
  fermerModale();
  afficherPage('tableau');
  res.tableauRappels = !!document.querySelector('#tbRappels .rappel.cliquable[data-cle="echeance:ech_test"]');
  res.echeancesTableau = !!document.querySelector('#tbEcheances .dash-ech .dash-cal b') && !!document.querySelector('#tbEcheances .dash-jours') && !/in \d+ day/.test(document.getElementById('tbEcheances').textContent);
  res.tachesTableau = !!document.querySelector('#tbTaches .dash-tache[data-id="' + nouvelle.id + '"] .dash-jours');
  /* --- Invoices and income: a tab of its own, no switch inside the statement --- */
  document.querySelector('.tab-btn[data-tab="factures"]').click();
  res.vueFactures = PAGE_COURANTE === 'factures' && !!document.querySelector('#facturesContenu #facturesTableau') && !document.querySelector('#rlVues');
  document.querySelector('.tab-btn[data-tab="releve"]').click();
  res.vueReleve = PAGE_COURANTE === 'releve' && !!document.querySelector('#rlMois') && !document.querySelector('#releveContenu .segment');
  /* --- Invoice template: clean header, Payment terms block, legal notices --- */
  var sauveP = JSON.stringify(ETAT.reglages.prestataire);
  var titulaireSeed = ETAT.reglages.prestataire.titulaireCompte, banqueSeed = ETAT.reglages.prestataire.banque;
  ETAT.reglages.prestataire.iban = 'FR7612345678901234567890123'; ETAT.reglages.prestataire.bic = 'BANKFRPPXXX'; ETAT.reglages.prestataire.email = 'test@example.org'; ETAT.reglages.prestataire.telephone = '0612345678'; ETAT.reglages.prestataire.adresse = '12 rue des Essais, 75000 Paris';
  var rel = releveDuMois(entreesJournal(), moisCourant(), ETAT.reglages, 0);
  var fx = construireFacture(rel, ETAT.reglages, { numero: '2099-01', dateEmission: aujourdhui(), travaux: [], factures: [] });
  /* The checks read the document, not its <style>, where the fonts travel as base64. */
  var sansStyle = function (h) { return h.replace(/<style>[\s\S]*?<\/style>/g, ''); };
  var hf = sansStyle(htmlFacture(fx));
  res.factureEpuree = hf.indexOf('APE') < 0 && hf.indexOf('SIRET 123 456 789 00015') > 0 && hf.indexOf('L. 441-10 of the French Commercial Code') > 0 && hf.indexOf('06 12 34 56 78') > 0 && hf.indexOf('<div>12 rue des Essais</div><div>75000 Paris</div>') > 0;
  res.factureReglement = hf.indexOf('class="rib"') > 0 && hf.indexOf('FR76 1234 5678 9012 3456 7890 123') > 0 && hf.indexOf(titulaireSeed) > 0 && hf.indexOf(banqueSeed) > 0 && hf.indexOf('Early payment discount: none') > 0 && hf.indexOf('fixed recovery fee of €40') > 0 && hf.indexOf('Total due') > 0 && hf.indexOf(ETAT.reglages.prestataire.nom + ' EI</div>') > 0;
  /* The invoice does not say when the work was done: no Date column,
     no "Done in" mention, no day date in the annex. */
  res.factureSansDate = hf.indexOf('<th class="num">Date</th>') < 0 && hf.indexOf('Done in') < 0 && !/\d{2}\/\d{2}\/\d{4}<\/td>/.test(hf.split('class="annexe"')[1] || '') && hf.indexOf('Annex to invoice no. 2099-01') > 0;
  ETAT.reglages.prestataire = JSON.parse(sauveP);
  res.releveEpure = sansStyle(htmlReleve(rel, {})).indexOf('APE') < 0;
  /* --- Notes editor: a single area, one line per line break --- */
  afficherPage('notes');
  creerPageNotes(null);
  var idTest = NOTES_PAGE;
  var titre = document.getElementById('ntTitre');
  titre.textContent = 'Test page';
  ev(titre, 'input');
  res.titre = pageParId(NOTES_PAGE).titre === 'Test page';
  var doc = docNotes();
  var nl = function () { return doc.querySelectorAll(':scope > .ligne').length; };
  var li = function (i) { return doc.querySelectorAll(':scope > .ligne')[i]; };
  var taper = function (t) { document.execCommand('insertText', false, t); };
  res.zoneUnique = doc.isContentEditable && !doc.querySelector('[contenteditable="true"]') && !document.querySelector('.bloc-poignee');
  placerCaret(li(0), false);
  taper('First block');
  ev(doc, 'keydown', { key: 'Enter' });
  res.enterCreeBloc = nl() === 2 && li(0).textContent === 'First block' && ligneCourante() === li(1) && document.activeElement === doc;
  taper('- ');
  res.raccourciPuce = li(1).dataset.type === 'puce' && li(1).textContent === '';
  taper('Item');
  ev(doc, 'keydown', { key: 'Enter' });
  res.enterPuceSuivante = nl() === 3 && li(2).dataset.type === 'puce';
  ev(doc, 'keydown', { key: 'Enter' });
  res.puceVideDevientP = nl() === 3 && li(2).dataset.type === 'p';
  taper('/');
  res.menuSlashOuvert = !!document.getElementById('menuSlash');
  taper('idea');
  res.menuSlashIdee = document.querySelectorAll('#menuSlash button').length === 1;
  ev(doc, 'keydown', { key: 'Enter' });
  res.slashIdee = li(2).dataset.type === 'idee' && !document.getElementById('menuSlash') && !!li(2).querySelector('[data-bloc-action=tache]') && li(2).textContent === '';
  taper('A typed idea');
  ev(doc, 'keydown', { key: 'Enter' });
  taper('the detail');
  res.ideeSurDeuxLignes = nl() === 3 && texteBrutDe(nettoyerHtml(li(2).innerHTML)) === 'A typed idea\nthe detail';
  ev(doc, 'keydown', { key: 'Enter' });
  ev(doc, 'keydown', { key: 'Enter' });
  res.ideeDoubleEntreeSort = nl() === 4 && li(3).dataset.type === 'p' && nettoyerHtml(li(2).innerHTML) === 'A typed idea<br>the detail';
  ev(doc, 'keydown', { key: 'Backspace' });
  res.backspaceLigneVide = nl() === 3;
  li(2).innerHTML = 'A typed idea';
  decorerLigne(li(2));
  placerCaret(li(2), true);
  ev(doc, 'keydown', { key: 'Backspace' });
  res.backspaceIdeeDevientP = li(2).dataset.type === 'p' && li(2).textContent === 'A typed idea';
  placerCaret(li(2), true);
  ev(doc, 'keydown', { key: 'Backspace' });
  res.backspaceFusionne = nl() === 2 && li(1).textContent === 'ItemA typed idea';
  placerCaret(li(1), false);
  ev(doc, 'keydown', { key: 'Enter' });
  taper('[] ');
  res.raccourciCase = li(2).dataset.type === 'case';
  taper('To check');
  var rc = li(2).getBoundingClientRect();
  li(2).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: rc.left + 9, clientY: rc.top + 12 }));
  res.caseCochee = li(2).classList.contains('coche');
  ev(doc, 'keydown', { key: 'Tab' });
  res.tabRetrait = li(2).dataset.retrait === '1';
  serialiserDoc();
  var p = pageParId(idTest);
  res.serialise = p.blocs.length === 3 && p.blocs[0].html === 'First block' && p.blocs[1].type === 'puce' && p.blocs[2].type === 'case' && p.blocs[2].coche === true && p.blocs[2].retrait === 1;
  /* Paste: always plain text, even from a web page or Markdown */
  var coller = function (texte, html) {
    var dt = new DataTransfer();
    dt.setData('text/plain', texte);
    if (html) dt.setData('text/html', html);
    doc.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  };
  placerCaret(li(0), false);
  coller('Line A\n- not a bullet\n# not a heading', '<h1 style="color:red">Line A</h1><ul><li>not a bullet</li></ul><h1>not a heading</h1>');
  res.collageBrut = nl() === 5 && li(0).textContent === 'First blockLine A' && li(1).dataset.type === 'p' && li(1).textContent === '- not a bullet' && li(2).dataset.type === 'p' && li(2).textContent === '# not a heading'
    && !doc.querySelector('h1, ul, li, span, font, [style]') && ligneCourante() === li(2);
  coller('word', '<b style="font-size:30px">word</b>');
  res.collageUneLigne = li(2).innerHTML === '# not a headingword';
  annulerNotes();
  annulerNotes();
  res.annuler = nl() === 3 && li(0).textContent === 'First block';
  retablirNotes();
  res.retablir = nl() === 5 && li(1).textContent === '- not a bullet';
  /* Tidying up after a change made by the browser */
  li(1).insertAdjacentHTML('beforeend', '<span style="font-size:24px">x</span>');
  doc.appendChild(document.createTextNode('orphan'));
  doc.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  res.normalisation = !doc.querySelector('span:not(.ligne-outils), [style]') && Array.prototype.every.call(doc.childNodes, function (n) { return n.nodeType === 1 && n.classList.contains('ligne'); }) && li(1).textContent === '- not a bulletx' && doc.lastChild.textContent === 'orphan';
  /* Move a line up, separator */
  placerCaret(li(1), true);
  ev(doc, 'keydown', { key: 'ArrowUp', altKey: true, shiftKey: true });
  res.monterLigne = li(0).textContent === '- not a bulletx' && li(1).textContent === 'First blockLine A';
  var avantSep = nl();
  placerCaret(li(0), false);
  insererSeparateur();
  res.separateur = nl() === avantSep + 1 && li(1).dataset.type === 'separateur' && li(1).getAttribute('contenteditable') === 'false';
  serialiserDoc();
  var html = '<div>a<b>b</b><span style="color:red">c</span><script>x</script></div>';
  res.nettoyage = nettoyerHtml(html) === 'a<b>b</b>c';
  var pt = new DataTransfer();
  pt.setData('text/plain', 'Title\npasted');
  pt.setData('text/html', '<h1 style="color:red">Title</h1>');
  placerCaret(titre, false);
  titre.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: pt }));
  res.titreCollageBrut = titre.innerHTML === 'Test pageTitle pasted';
  NOTES_RECHERCHE = 'not a bullet';
  rendreRailNotes();
  res.rechercheContenu = !!document.querySelector('#ntArbre .nt-item[data-id="' + idTest + '"] .nt-extrait');
  NOTES_RECHERCHE = '';
  rendreRailNotes();
  /* --- Liquid Glass bubble: placed on the displayed page --- */
  afficherPage('journal');
  poserBulles();
  var bulle = document.querySelector('.tabs > .bulle'), bJournal = document.querySelector('.tab-btn[data-tab="releve"]');
  res.bulleNavigation = !!bulle && bulle.style.transform.replace(/\s/g, '') === 'translate(' + bJournal.offsetLeft + 'px,' + bJournal.offsetTop + 'px)' && bulle.style.width === bJournal.offsetWidth + 'px';
  /* --- Tasks: advance and finish --- */
  afficherPage('taches');
  var t = taches().filter(function (x) { return x.statut === 'en-cours'; })[0];
  if (t) { avancerTache(t.id); res.tacheFaite = t.statut === 'fait' && t.faitLe === aujourdhui(); }
  /* --- Statement: work items of the month --- */
  afficherPage('releve');
  res.travauxReleve = travauxDuMois(moisCourant()).length >= 1;
  /* --- Deadlines --- */
  var ech = echeances()[0];
  marquerEcheanceFaite(ech.id, true);
  res.echeanceFaite = ech.fait === true;
  marquerEcheanceFaite(ech.id, false);
  /* --- Cleanup --- */
  ETAT.notes.pages = pagesNotes().filter(function (x) { return x.id !== idTest; });
  sauver('notes');
  ETAT.echeances.echeances = echeances().filter(function (x) { return x.id !== 'ech_test' && x.id !== 'ech_test2'; });
  sauver('echeances');
  afficherPage('tableau');
} catch (err) { res.erreur = String(err && err.stack || err); }
return JSON.stringify(res);
