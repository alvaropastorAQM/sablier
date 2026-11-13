/* Scénario de l'auto-test (SABLIER_SMOKE_SCENARIO=1) : chrono, tâches, notes, pièces jointes, rappels, gabarits.
   Corps d'une fonction async exécutée dans la page par l'auto-test (src-tauri/src/autotest.rs) ; FICHIER_TEST et
   IMAGE_TEST sont les chemins d'un fichier texte et d'une image d'un pixel préparés par l'auto-test. Chaque clé de
   res vaut true quand le comportement attendu est observé. */
var res = {};
function ev(el, type, opts) { el.dispatchEvent(type === 'input' ? new Event('input', { bubbles: true }) : new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, opts))); }
try {
  /* --- Chrono : arrêt puis redémarrage --- */
  if (!chronoEnCours()) demarrerChrono({ axe: 'projeta', intervention: 'Chrono de départ', detail: '' });
  var avant = entreesJournal().length;
  var e = arreterChrono(true);
  res.chronoArret = !!e && entreesJournal().length === avant + 1 && e.minutes >= 1;
  demarrerChrono({ axe: 'suivi', intervention: 'Test du chrono', detail: '' });
  res.chronoDemarre = !!chronoEnCours() && chronoEnCours().intervention === 'Test du chrono';
  arreterChrono(true);
  res.chronoCourtEnregistre = !chronoEnCours() && entreesJournal().length === avant + 2 && entreesJournal()[avant + 1].minutes === 1;
  /* --- Journal et relevé : la journée du chrono se déplie sur ses lignes --- */
  RELEVE_JOURS = {};
  afficherPage('journal');
  var jourChrono = document.querySelector('#releveContenu .rl-jour[data-jour="' + e.date + '"]');
  if (jourChrono) jourChrono.click();
  res.journeeDepliee = !!jourChrono && !!document.querySelector('#releveContenu .rl-detail .jr-ligne[data-id="' + e.id + '"]');
  res.sansBoutonExport = !document.querySelector('#releveContenu [data-action="pdf-releve"]');
  /* --- Boutons des cartes et des échéances (identifiants) --- */
  afficherPage('taches');
  var boutons = Array.prototype.slice.call(document.querySelectorAll('.kb-carte .btn-icone[data-action]'));
  res.cartesAvecId = boutons.length > 0 && boutons.every(function (b) { return !!b.dataset.id; });
  res.troisColonnes = document.querySelectorAll('.kb-colonne').length === 3 && !document.querySelector('.kb-colonne[data-statut="idee"]');
  afficherPage('echeances');
  var be = Array.prototype.slice.call(document.querySelectorAll('.ec-actions .btn-icone[data-action]'));
  res.echeancesAvecId = be.length > 0 && be.every(function (b) { return !!b.dataset.id; });
  /* --- Chrono depuis une carte, bandeau, pause, reprise, arrêt --- */
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
  /* --- Priorités, tri automatique des cartes --- */
  var refJ = aujourdhui();
  var creerTest = function (titre, prio, jours) {
    var tt = normaliserTache({ id: uid('tt'), statut: 'a-faire', axe: 'projeta', titre: titre, description: '', priorite: prio, echeance: jours == null ? null : ajouterJours(refJ, jours), ordre: 999, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), faitLe: null });
    taches().push(tt); return tt;
  };
  var tUrgent = creerTest('Test urgent (basse, 2 jours)', 'basse', 2);
  var tHaute = creerTest('Test haute manuelle (40 jours)', 'haute', 40);
  var tMoyen = creerTest('Test auto (10 jours)', 'auto', 10);
  var tLoin = creerTest('Test auto (30 jours)', 'auto', 30);
  sauver('chantiers');
  afficherPage('taches');
  var ordreDom = Array.prototype.map.call(document.querySelectorAll('.kb-colonne[data-statut="a-faire"] .kb-carte'), function (c) { return c.dataset.id; });
  var posDe = function (tt) { return ordreDom.indexOf(tt.id); };
  res.triPriorites = posDe(tUrgent) === 0 && posDe(tHaute) === 1 && posDe(tMoyen) === 2 && posDe(tLoin) === 3 && ordreDom.length > 4;
  res.prioriteRelevee = prioriteEffective(tUrgent, refJ).niveau === 'haute' && prioriteEffective(tUrgent, refJ).origine === 'echeance' && prioriteEffective(tHaute, refJ).niveau === 'haute' && prioriteEffective(tMoyen, refJ).niveau === 'moyenne' && prioriteEffective(tLoin, refJ).niveau === 'basse';
  res.pastilleHaute = !!document.querySelector('.kb-carte[data-id="' + tUrgent.id + '"] .kb-priorite.haute') && !!document.querySelector('.kb-carte[data-id="' + tMoyen.id + '"] .kb-priorite.moyenne');
  res.puceCouleur = !!document.querySelector('.kb-carte .puce-axe .axe-point') && !document.querySelector('.puce-axe .code');
  /* --- Glisser-déposer au pointeur vers « En cours » --- */
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
  /* clic simple sur une carte : la fiche s'ouvre */
  var carteClic = document.querySelector('.kb-carte[data-id="' + tHaute.id + '"]');
  var rc = carteClic.getBoundingClientRect();
  pe('pointerdown', rc.left + 20, rc.top + 12, carteClic);
  pe('pointerup', rc.left + 21, rc.top + 12, carteClic);
  res.clicOuvreFiche = modaleOuverte() && document.querySelector('#tcTitre').value === tHaute.titre;
  fermerModale();
  ETAT.chantiers.taches = taches().filter(function (tt) { return [tUrgent.id, tHaute.id, tMoyen.id, tLoin.id].indexOf(tt.id) < 0; });
  sauver('chantiers');
  afficherPage('taches');
  /* --- Modifier une carte depuis son bouton --- */
  document.querySelector('.kb-carte .btn-icone[data-action=modifier]').click();
  res.modaleCarte = modaleOuverte() && !!document.querySelector('#tcTitre');
  fermerModale();
  /* --- Migration des idées vers les notes --- */
  taches().push({ id: 'idee_test', statut: 'idee', axe: 'gouvernance', titre: 'Idée de test', description: 'Un détail', interet: 'fort', effort: 'petit', prerequis: 'rien', priorite: 'auto', echeance: null, ordre: 999, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), faitLe: null });
  var nbAvant = pageIdees().blocs.length;
  var nbMigre = migrerIdeesVersNotes();
  sauver('chantiers'); sauver('notes');
  var blocMigre = pageIdees().blocs[nbAvant];
  res.migrationIdees = nbMigre === 1 && pageIdees().blocs.length === nbAvant + 1 && !taches().some(function (x) { return x.statut === 'idee'; }) && blocMigre.type === 'idee' && blocMigre.html.indexOf('<b>Idée de test</b>') === 0 && blocMigre.html.indexOf('Intérêt : fort') > 0;
  res.ideesDefautDansNotes = pageIdees().blocs.filter(function (b) { return b.type === 'idee'; }).length >= 4;
  /* --- Idée → tâche --- */
  afficherPage('notes');
  ouvrirPageNotes('page_idees');
  var lignesIdee = document.querySelectorAll('#ntDoc .ligne-idee');
  var ligneIdee = lignesIdee[lignesIdee.length - 1];
  res.blocIdeeRendu = !!ligneIdee && !!ligneIdee.querySelector('[data-bloc-action=tache]');
  var nbT = taches().length;
  var nouvelle = creerTacheDepuisLigne(ligneIdee);
  res.conversionIdee = !!nouvelle && taches().length === nbT + 1 && nouvelle.titre === 'Idée de test' && nouvelle.statut === 'a-faire' && nouvelle.description.indexOf('Un détail') === 0 && nouvelle.notes.indexOf('page_idees') >= 0
    && !!document.querySelector('#ntDoc .ligne[data-tache="' + nouvelle.id + '"] [data-bloc-action=ouvrir-tache]') && pageParId('page_idees').blocs.some(function (b) { return b.tache === nouvelle.id; });
  res.tachesLieesStrip = !!document.querySelector('#ntTaches .chip-tache[data-id="' + nouvelle.id + '"]');
  /* --- Fiche complète : étapes, pièces, notes, avancement, temps --- */
  afficherPage('taches');
  ouvrirEditionTache(nouvelle.id);
  res.ficheSections = ['etapes', 'pieces', 'notes', 'avancement', 'temps'].every(function (s) { return !!document.querySelector('.fiche-section[data-section="' + s + '"]'); });
  ajouterEtapeTache(nouvelle, 'Première étape');
  ajouterEtapeTache(nouvelle, 'Seconde étape');
  basculerEtapeTache(nouvelle, nouvelle.etapes[0].id, true);
  res.etapes = nouvelle.etapes.length === 2 && nouvelle.etapes[0].fait === true && document.querySelector('.fiche-section[data-section="etapes"] .nb').textContent === '1/2' && document.querySelectorAll('.fiche-section[data-section="etapes"] .etape').length === 2;
  ajouterPieceCode(nouvelle, { nom: 'exemple.js', langage: 'javascript', contenu: 'console.log(1)' });
  res.pieceCode = nouvelle.pieces.length === 1 && !!document.querySelector('.fiche-section[data-section="pieces"] .piece-code pre') && document.querySelector('.piece-code pre').textContent === 'console.log(1)';
  ajouterPieceLien(nouvelle, { nom: 'Documentation', url: 'example.org/doc' });
  res.pieceLien = nouvelle.pieces.length === 2 && nouvelle.pieces[1].url === 'https://example.org/doc' && !!document.querySelector('.piece-ligne .piece-nom');
  var okFichier = await ajouterPiecesFichiers(nouvelle, [FICHIER_TEST, IMAGE_TEST]);
  var pf = nouvelle.pieces.filter(function (p) { return p.type === 'fichier' && !p.image; })[0];
  var pi = nouvelle.pieces.filter(function (p) { return p.type === 'fichier' && p.image; })[0];
  res.pieceFichier = okFichier === true && !!pf && pf.nom === 'sablier-piece-test.txt' && pf.taille > 0 && !!pi && pi.nom === 'sablier-pixel.png';
  res.pieceFichierChemin = pf ? pf.fichier : '';
  var img = document.querySelector('.fiche-section[data-section="pieces"] .piece-image img');
  res.imageUrl = !!img && img.getAttribute('src').indexOf('sablier-piece://pieces/') === 0;
  await new Promise(function (r) { if (!img || img.complete) return r(); img.addEventListener('load', r); img.addEventListener('error', r); setTimeout(r, 2500); });
  res.imageChargee = !!img && img.complete && img.naturalWidth === 1;
  lierTacheANote(nouvelle.id, 'page_projeta');
  apresMutationTache(nouvelle, 'notes');
  res.lienNote = nouvelle.notes.indexOf('page_projeta') >= 0 && tachesLieesAPage('page_projeta').length === 1 && document.querySelectorAll('.fiche-section[data-section="notes"] .chip-note').length === 2;
  ajouterAvancementTache(nouvelle, 'Premier point d\'avancement');
  res.avancement = nouvelle.avancement.length === 1 && !!document.querySelector('.fiche-section[data-section="avancement"] .avancement-entree');
  demarrerChrono({ axe: nouvelle.axe, intervention: nouvelle.titre, tache: nouvelle.id });
  arreterChrono(true);
  fermerModale();
  ouvrirEditionTache(nouvelle.id);
  res.tempsTache = minutesTache(entreesJournal(), nouvelle.id).minutes === 1 && document.querySelector('.fiche-section[data-section="temps"] .temps-resume b').textContent === '1 min';
  fermerModale();
  res.carteCompteurs = !!document.querySelector('.kb-carte[data-id="' + nouvelle.id + '"] .kb-compteurs') && !!document.querySelector('.kb-carte[data-id="' + nouvelle.id + '"] .kb-progres');
  /* --- Rappels --- */
  echeances().push({ id: 'ech_test', date: ajouterJours(aujourdhui(), -2), titre: 'Échéance de test dépassée', detail: '', type: 'perso', fait: false, faitLe: null, creeLe: new Date().toISOString() });
  echeances().push({ id: 'ech_test2', date: ajouterJours(aujourdhui(), 5), titre: 'Échéance de test à 5 jours', detail: '', type: 'perso', rappelJours: 3, fait: false, faitLe: null, creeLe: new Date().toISOString() });
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
  res.echeancesTableau = !!document.querySelector('#tbEcheances .dash-ech .dash-cal b') && !!document.querySelector('#tbEcheances .dash-jours') && !/dans \d+ jour/.test(document.getElementById('tbEcheances').textContent);
  res.tachesTableau = !!document.querySelector('#tbTaches .dash-tache[data-id="' + nouvelle.id + '"] .dash-jours');
  /* --- Factures et recettes : un onglet à part, sans bascule dans le relevé --- */
  document.querySelector('.tab-btn[data-tab="factures"]').click();
  res.vueFactures = PAGE_COURANTE === 'factures' && !!document.querySelector('#facturesContenu #facturesTableau') && !document.querySelector('#rlVues');
  document.querySelector('.tab-btn[data-tab="releve"]').click();
  res.vueReleve = PAGE_COURANTE === 'releve' && !!document.querySelector('#rlMois') && !document.querySelector('#releveContenu .segment');
  /* --- Gabarit de facture : en-tête épuré, bloc Règlement, mentions --- */
  var sauveP = JSON.stringify(ETAT.reglages.prestataire);
  ETAT.reglages.prestataire.iban = 'FR7612345678901234567890123'; ETAT.reglages.prestataire.bic = 'BANKFRPPXXX'; ETAT.reglages.prestataire.email = 'test@example.org'; ETAT.reglages.prestataire.telephone = '0612345678'; ETAT.reglages.prestataire.adresse = '12 rue des Essais, 75000 Paris';
  var rel = releveDuMois(entreesJournal(), moisCourant(), ETAT.reglages, 0);
  var fx = construireFacture(rel, ETAT.reglages, { numero: '2099-01', dateEmission: aujourdhui(), travaux: [], factures: [] });
  var hf = htmlFacture(fx);
  res.factureEpuree = hf.indexOf('APE') < 0 && hf.indexOf('SIRET 123 456 789 00015') > 0 && hf.indexOf('L. 441-10 du Code de commerce') > 0 && hf.indexOf('06 12 34 56 78') > 0 && hf.indexOf('<div>12 rue des Essais</div><div>75000 Paris</div>') > 0;
  res.factureReglement = hf.indexOf('class="rib"') > 0 && hf.indexOf('FR76 1234 5678 9012 3456 7890 123') > 0 && hf.indexOf('EI Nom Prénom') > 0 && hf.indexOf('Banque Exemple') > 0 && hf.indexOf('Escompte pour paiement anticipé : néant') > 0 && hf.indexOf('indemnité forfaitaire de 40') > 0 && hf.indexOf('Total TTC à payer') > 0 && hf.indexOf(ETAT.reglages.prestataire.nom + ' EI</div>') > 0;
  /* La facture ne dit pas quand le travail a été réalisé : ni colonne
     Date, ni mention « Réalisé en », ni date du jour dans l'annexe. */
  res.factureSansDate = hf.indexOf('<th class="num">Date</th>') < 0 && hf.indexOf('Réalisé en') < 0 && !/\d{2}\/\d{2}\/\d{4}<\/td>/.test(hf.split('class="annexe"')[1] || '') && hf.indexOf('Annexe à la facture n° 2099-01') > 0;
  ETAT.reglages.prestataire = JSON.parse(sauveP);
  res.releveEpure = htmlReleve(rel, {}).indexOf('APE') < 0;
  /* --- Éditeur de notes : une seule zone, une ligne par retour à la ligne --- */
  afficherPage('notes');
  creerPageNotes(null);
  var idTest = NOTES_PAGE;
  var titre = document.getElementById('ntTitre');
  titre.textContent = 'Page de test';
  ev(titre, 'input');
  res.titre = pageParId(NOTES_PAGE).titre === 'Page de test';
  var doc = docNotes();
  var nl = function () { return doc.querySelectorAll(':scope > .ligne').length; };
  var li = function (i) { return doc.querySelectorAll(':scope > .ligne')[i]; };
  var taper = function (t) { document.execCommand('insertText', false, t); };
  res.zoneUnique = doc.isContentEditable && !doc.querySelector('[contenteditable="true"]') && !document.querySelector('.bloc-poignee');
  placerCaret(li(0), false);
  taper('Premier bloc');
  ev(doc, 'keydown', { key: 'Enter' });
  res.enterCreeBloc = nl() === 2 && li(0).textContent === 'Premier bloc' && ligneCourante() === li(1) && document.activeElement === doc;
  taper('- ');
  res.raccourciPuce = li(1).dataset.type === 'puce' && li(1).textContent === '';
  taper('Élément');
  ev(doc, 'keydown', { key: 'Enter' });
  res.enterPuceSuivante = nl() === 3 && li(2).dataset.type === 'puce';
  ev(doc, 'keydown', { key: 'Enter' });
  res.puceVideDevientP = nl() === 3 && li(2).dataset.type === 'p';
  taper('/');
  res.menuSlashOuvert = !!document.getElementById('menuSlash');
  taper('idée');
  res.menuSlashIdee = document.querySelectorAll('#menuSlash button').length === 1;
  ev(doc, 'keydown', { key: 'Enter' });
  res.slashIdee = li(2).dataset.type === 'idee' && !document.getElementById('menuSlash') && !!li(2).querySelector('[data-bloc-action=tache]') && li(2).textContent === '';
  taper('Une idée tapée');
  ev(doc, 'keydown', { key: 'Enter' });
  taper('le détail');
  res.ideeSurDeuxLignes = nl() === 3 && texteBrutDe(nettoyerHtml(li(2).innerHTML)) === 'Une idée tapée\nle détail';
  ev(doc, 'keydown', { key: 'Enter' });
  ev(doc, 'keydown', { key: 'Enter' });
  res.ideeDoubleEntreeSort = nl() === 4 && li(3).dataset.type === 'p' && nettoyerHtml(li(2).innerHTML) === 'Une idée tapée<br>le détail';
  ev(doc, 'keydown', { key: 'Backspace' });
  res.backspaceLigneVide = nl() === 3;
  li(2).innerHTML = 'Une idée tapée';
  decorerLigne(li(2));
  placerCaret(li(2), true);
  ev(doc, 'keydown', { key: 'Backspace' });
  res.backspaceIdeeDevientP = li(2).dataset.type === 'p' && li(2).textContent === 'Une idée tapée';
  placerCaret(li(2), true);
  ev(doc, 'keydown', { key: 'Backspace' });
  res.backspaceFusionne = nl() === 2 && li(1).textContent === 'ÉlémentUne idée tapée';
  placerCaret(li(1), false);
  ev(doc, 'keydown', { key: 'Enter' });
  taper('[] ');
  res.raccourciCase = li(2).dataset.type === 'case';
  taper('À cocher');
  var rc = li(2).getBoundingClientRect();
  li(2).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: rc.left + 9, clientY: rc.top + 12 }));
  res.caseCochee = li(2).classList.contains('coche');
  ev(doc, 'keydown', { key: 'Tab' });
  res.tabRetrait = li(2).dataset.retrait === '1';
  serialiserDoc();
  var p = pageParId(idTest);
  res.serialise = p.blocs.length === 3 && p.blocs[0].html === 'Premier bloc' && p.blocs[1].type === 'puce' && p.blocs[2].type === 'case' && p.blocs[2].coche === true && p.blocs[2].retrait === 1;
  /* Coller : toujours du texte normal, même depuis une page web ou du Markdown */
  var coller = function (texte, html) {
    var dt = new DataTransfer();
    dt.setData('text/plain', texte);
    if (html) dt.setData('text/html', html);
    doc.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  };
  placerCaret(li(0), false);
  coller('Ligne A\n- pas une puce\n# pas un titre', '<h1 style="color:red">Ligne A</h1><ul><li>pas une puce</li></ul><h1>pas un titre</h1>');
  res.collageBrut = nl() === 5 && li(0).textContent === 'Premier blocLigne A' && li(1).dataset.type === 'p' && li(1).textContent === '- pas une puce' && li(2).dataset.type === 'p' && li(2).textContent === '# pas un titre'
    && !doc.querySelector('h1, ul, li, span, font, [style]') && ligneCourante() === li(2);
  coller('mot', '<b style="font-size:30px">mot</b>');
  res.collageUneLigne = li(2).innerHTML === '# pas un titremot';
  annulerNotes();
  annulerNotes();
  res.annuler = nl() === 3 && li(0).textContent === 'Premier bloc';
  retablirNotes();
  res.retablir = nl() === 5 && li(1).textContent === '- pas une puce';
  /* Remise en ordre après une modification faite par le navigateur */
  li(1).insertAdjacentHTML('beforeend', '<span style="font-size:24px">x</span>');
  doc.appendChild(document.createTextNode('orphelin'));
  doc.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  res.normalisation = !doc.querySelector('span:not(.ligne-outils), [style]') && Array.prototype.every.call(doc.childNodes, function (n) { return n.nodeType === 1 && n.classList.contains('ligne'); }) && li(1).textContent === '- pas une pucex' && doc.lastChild.textContent === 'orphelin';
  /* Monter une ligne, séparateur */
  placerCaret(li(1), true);
  ev(doc, 'keydown', { key: 'ArrowUp', altKey: true, shiftKey: true });
  res.monterLigne = li(0).textContent === '- pas une pucex' && li(1).textContent === 'Premier blocLigne A';
  var avantSep = nl();
  placerCaret(li(0), false);
  insererSeparateur();
  res.separateur = nl() === avantSep + 1 && li(1).dataset.type === 'separateur' && li(1).getAttribute('contenteditable') === 'false';
  serialiserDoc();
  var html = '<div>a<b>b</b><span style="color:red">c</span><script>x</script></div>';
  res.nettoyage = nettoyerHtml(html) === 'a<b>b</b>c';
  var pt = new DataTransfer();
  pt.setData('text/plain', 'Titre\ncollé');
  pt.setData('text/html', '<h1 style="color:red">Titre</h1>');
  placerCaret(titre, false);
  titre.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: pt }));
  res.titreCollageBrut = titre.innerHTML === 'Page de testTitre collé';
  NOTES_RECHERCHE = 'pas une puce';
  rendreRailNotes();
  res.rechercheContenu = !!document.querySelector('#ntArbre .nt-item[data-id="' + idTest + '"] .nt-extrait');
  NOTES_RECHERCHE = '';
  rendreRailNotes();
  /* --- Bulle Liquid Glass : posée sur la page affichée --- */
  afficherPage('journal');
  poserBulles();
  var bulle = document.querySelector('.tabs > .bulle'), bJournal = document.querySelector('.tab-btn[data-tab="releve"]');
  res.bulleNavigation = !!bulle && bulle.style.transform.replace(/\s/g, '') === 'translate(' + bJournal.offsetLeft + 'px,' + bJournal.offsetTop + 'px)' && bulle.style.width === bJournal.offsetWidth + 'px';
  /* --- Tâches : avancer et terminer --- */
  afficherPage('taches');
  var t = taches().filter(function (x) { return x.statut === 'en-cours'; })[0];
  if (t) { avancerTache(t.id); res.tacheFaite = t.statut === 'fait' && t.faitLe === aujourdhui(); }
  /* --- Relevé : travaux du mois --- */
  afficherPage('releve');
  res.travauxReleve = travauxDuMois(moisCourant()).length >= 1;
  /* --- Échéances --- */
  var ech = echeances()[0];
  marquerEcheanceFaite(ech.id, true);
  res.echeanceFaite = ech.fait === true;
  marquerEcheanceFaite(ech.id, false);
  /* --- Nettoyage --- */
  ETAT.notes.pages = pagesNotes().filter(function (x) { return x.id !== idTest; });
  sauver('notes');
  ETAT.echeances.echeances = echeances().filter(function (x) { return x.id !== 'ech_test' && x.id !== 'ech_test2'; });
  sauver('echeances');
  afficherPage('tableau');
} catch (err) { res.erreur = String(err && err.stack || err); }
return JSON.stringify(res);
