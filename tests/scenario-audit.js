/* Audit scenario run in the renderer by the self-test
   (SABLIER_SMOKE=1 SABLIER_SMOKE_AUDIT=1). The body below is inserted
   into an async function that receives "res" (results); each key is true
   when the expected behaviour is observed. Test data is created and then
   removed. */

/* --- 1. Task sheet: a secondary modal does not lose the input in progress --- */
var tA = creerTache({ titre: 'Audit sheet', statut: 'a-faire', axe: 'projeta' });
afficherPage('taches');
ouvrirEditionTache(tA.id);
document.querySelector('#tcTitre').value = 'Audit sheet edited';
document.querySelector('#tcDescription').value = 'brouillon';
ajouterEtapeTache(tA, 'Step to rename');
document.querySelector('.fiche-section[data-section="etapes"] .etape-texte').click();
res.etapeModifOuvreDemande = !!document.querySelector('#demanderValeur');
document.querySelector('#demanderValeur').value = 'Step renamed';
document.querySelector('[data-role=ok]').click();
await new Promise(function (r) { setTimeout(r, 60); });
res.ficheRouverteApresEtape = !!document.querySelector('.modal[data-tache="' + tA.id + '"]') && document.querySelector('#tcTitre').value === 'Audit sheet edited' && document.querySelector('#tcDescription').value === 'brouillon' && tA.etapes[0].texte === 'Step renamed';
/* link: open, cancel → the sheet comes back with the draft */
document.querySelector('[data-fiche="piece-lien"]').click();
res.modaleLienOuverte = !!document.querySelector('#plUrl');
document.querySelector('[data-role=annuler]').click();
await new Promise(function (r) { setTimeout(r, 60); });
res.ficheRouverteApresLien = !!document.querySelector('.modal[data-tache="' + tA.id + '"]') && document.querySelector('#tcTitre').value === 'Audit sheet edited';
/* deletion cancelled → the sheet comes back */
document.querySelector('[data-role=supprimer]').click();
await new Promise(function (r) { setTimeout(r, 60); });
res.confirmationSuppression = modaleOuverte() && !document.querySelector('#tcTitre');
document.querySelector('[data-role=annuler]').click();
await new Promise(function (r) { setTimeout(r, 60); });
res.ficheRouverteApresAnnulation = !!document.querySelector('.modal[data-tache="' + tA.id + '"]') && !!tacheParId(tA.id);
fermerModale();

/* --- 2. Deleting a task linked to a note block and to the log --- */
afficherPage('notes');
ouvrirPageNotes('page_idees');
var blocsIdee = document.querySelectorAll('#ntDoc .ligne-idee');
var blocConv = blocsIdee[0];
var tB = creerTacheDepuisLigne(blocConv);
entreesJournal().push({ id: 'ent_audit', date: aujourdhui(), axe: 'projeta', intervention: 'Audit', detail: '', debut: '', fin: '', minutes: 30, tache: tB.id, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString() });
sauver('journal');
ETAT.chantiers.taches = taches().filter(function (x) { return x.id !== tB.id; });
sauver('chantiers');
rendreNotes();
var blocApres = document.querySelector('#ntDoc .ligne[data-tache="' + tB.id + '"]');
res.blocSansTacheRedevientIdee = !!blocApres && !!blocApres.querySelector('[data-bloc-action=tache]') && !blocApres.querySelector('[data-bloc-action=ouvrir-tache]');
RELEVE_MOIS = moisCourant(); RELEVE_JOURS[aujourdhui()] = true;
afficherPage('journal');
res.journalSansTacheOk = !!document.querySelector('.jr-ligne[data-id="ent_audit"]');
afficherPage('tableau');
res.tableauSansTacheOk = !!document.getElementById('tbTaches');
ETAT.journal.entrees = entreesJournal().filter(function (x) { return x.id !== 'ent_audit'; });
sauver('journal');

/* --- 3. Deleting a notes page linked to a task --- */
var pageX = creerPageNotesSilencieuse('Audit linked page', null);
lierTacheANote(tA.id, pageX.id);
ETAT.notes.pages = pagesNotes().filter(function (x) { return x.id !== pageX.id; });
taches().forEach(function (t) { if (Array.isArray(t.notes)) t.notes = t.notes.filter(function (n) { return n !== pageX.id; }); });
sauver('notes'); sauver('chantiers');
afficherPage('taches');
ouvrirEditionTache(tA.id);
res.ficheSansPageOk = !!document.querySelector('.fiche-section[data-section="notes"]') && tA.notes.indexOf(pageX.id) < 0;
fermerModale();
/* task without creation dates (imported data) */
var tC = creerTache({ titre: 'No dates', statut: 'a-faire' });
delete tC.creeLe; delete tC.modifieLe;
var okSansDates = true;
try { ouvrirEditionTache(tC.id); } catch (e) { okSansDates = false; }
res.ficheSansDatesOk = okSansDates && !!document.querySelector('#tcTitre');
fermerModale();

/* --- 4. Area in use: deletion refused; timer on an area --- */
res.axeUtiliseParTache = axeUtilise(tA.axe) === true;

/* --- 5. Timer that crosses midnight --- */
var hier = ajouterJours(aujourdhui(), -1);
var debutHier = new Date(isoVersDate(hier)); debutHier.setHours(23, 50, 0, 0);
ETAT.chrono.enCours = { debut: debutHier.toISOString(), axe: 'projeta', intervention: 'Nuit', detail: '', tache: null, pauseDepuis: null, pauseCumuleeMs: 0 };
sauver('chrono');
var eNuit = arreterChrono(true);
var minutesAttendues = Math.round((Date.now() - debutHier.getTime()) / 60000);
res.chronoMinuit = !!eNuit && eNuit.date === hier && eNuit.debut === '23:50' && Math.abs(eNuit.minutes - minutesAttendues) <= 1;
ETAT.journal.entrees = entreesJournal().filter(function (x) { return x.id !== eNuit.id; });
sauver('journal');

/* --- 6. Old backup imported: ideas, "normale" priority, null rows --- */
var paquet = paquetSauvegarde();
var ancien = JSON.parse(JSON.stringify(paquet));
ancien.chantiers.taches.push({ id: 'idee_import', statut: 'idee', axe: 'gouvernance', titre: 'Imported idea', description: 'd', interet: 'i', effort: 'e', prerequis: 'p', priorite: 'normale', ordre: 5 });
ancien.chantiers.taches.push({ id: 'tache_import', statut: 'a-faire', axe: 'projeta', titre: 'Imported task', priorite: 'normale' });
ancien.journal.entrees.push(null);
ancien.journal.entrees.push({ id: 'ent_import', date: '2026-10-03', axe: 'projeta', intervention: 'Imported', minutes: 10 });
ancien.notes.pages.push(null);
ancien.echeances.echeances.push(null);
ancien.factures.factures.push(null);
var okImport = true;
try { remplacerEtat(ancien); rafraichir(); afficherPage('tableau'); afficherPage('journal'); afficherPage('releve'); afficherPage('factures'); afficherPage('taches'); afficherPage('notes'); afficherPage('echeances'); } catch (e) { okImport = false; res.erreurImport = String(e && e.stack || e); }
res.importAncienOk = okImport && !taches().some(function (t) { return t.statut === 'idee'; }) && pageIdees().blocs.some(function (b) { return b.type === 'idee' && b.html.indexOf('Imported idea') >= 0; })
  && tacheParId('tache_import').priorite === 'auto' && Array.isArray(tacheParId('tache_import').etapes) && !entreesJournal().some(function (e) { return e == null; }) && !pagesNotes().some(function (p) { return p == null; }) && !echeances().some(function (e) { return e == null; }) && !factures().some(function (f) { return f == null; });
remplacerEtat(paquet);
rafraichir();

/* --- 7. Invoice: the number follows the year of the issue date --- */
afficherPage('releve');
RELEVE_MOIS = moisCourant();
entreesJournal().push({ id: 'ent_fact', date: aujourdhui(), axe: 'projeta', intervention: 'To invoice', detail: '', debut: '', fin: '', minutes: 60, tache: null, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString() });
sauver('journal');
rendreReleve();
document.querySelector('[data-action=facture]').click();
res.modaleFacture = !!document.querySelector('#faNumero');
var numAvant = document.querySelector('#faNumero').value;
var dateAutreAnnee = (Number(aujourdhui().slice(0, 4)) + 1) + '-01-15';
document.querySelector('#faDate').value = dateAutreAnnee;
document.querySelector('#faDate').dispatchEvent(new Event('change', { bubbles: true }));
res.numeroSuitAnnee = document.querySelector('#faNumero').value === (Number(aujourdhui().slice(0, 4)) + 1) + '-01' && numAvant !== document.querySelector('#faNumero').value;
fermerModale();
ETAT.journal.entrees = entreesJournal().filter(function (x) { return x.id !== 'ent_fact'; });
sauver('journal');

/* --- 8. Statement: work item partly invoiced --- */
var moisTest = '2031-03';
entreesJournal().push({ id: 'ent_p1', date: moisTest + '-05', axe: 'projeta', intervention: 'Partial', detail: '', debut: '', fin: '', minutes: 60, tache: null, creeLe: new Date().toISOString() });
sauver('journal');
var relP = releveDuMois(entreesJournal(), moisTest, ETAT.reglages, 0);
var fP = construireFacture(relP, ETAT.reglages, { numero: '2031-99', dateEmission: moisTest + '-06', travaux: [], factures: [] });
factures().push(fP); sauver('factures');
entreesJournal().push({ id: 'ent_p2', date: moisTest + '-05', axe: 'projeta', intervention: 'Partial', detail: 'continued', debut: '', fin: '', minutes: 30, tache: null, creeLe: new Date().toISOString() });
sauver('journal');
RELEVE_MOIS = moisTest;
rendreReleve();
var etatCell = document.querySelector('#releveContenu tbody tr td:last-child');
res.partiellementFacture = !!etatCell && /partly invoiced/i.test(etatCell.textContent);
var resteP = releveAFacturer(moisTest);
res.resteFactureLigneNouvelle = resteP.lignes.length === 1 && resteP.lignes[0].minutes === 30;
ETAT.factures.factures = factures().filter(function (f) { return f.id !== fP.id; });
ETAT.journal.entrees = entreesJournal().filter(function (x) { return x.id !== 'ent_p1' && x.id !== 'ent_p2'; });
sauver('factures'); sauver('journal');

/* --- 8 bis. Moving a work item to another billing month --- */
var moisR = '2031-05', moisCible = '2031-06';
entreesJournal().push({ id: 'ent_r1', date: moisR + '-12', axe: 'projeta', intervention: 'Movable', detail: '', debut: '', fin: '', minutes: 40, tache: null, creeLe: new Date().toISOString() });
entreesJournal().push({ id: 'ent_r2', date: moisR + '-12', axe: 'projeta', intervention: 'Movable', detail: 'continued', debut: '', fin: '', minutes: 20, tache: null, creeLe: new Date().toISOString() });
sauver('journal');
RELEVE_MOIS = moisR;
rendreReleve();
res.boutonReportActif = !!document.querySelector('[data-action=reporter]') && !document.querySelector('[data-action=reporter]').disabled;
var reportables = interventionsReportables(moisR);
res.uneInterventionReportable = reportables.length === 1 && reportables[0].lignes.length === 2;
appliquerMoisFacturation(reportables[0].lignes, moisCible);
rafraichir();
/* The work leaves the original statement, whole, and arrives on the other. */
var relDepart = releveDuMois(entreesJournal(), moisR, ETAT.reglages, 0);
var relArrivee = releveDuMois(entreesJournal(), moisCible, ETAT.reglages, 0);
res.reportVideLeMoisDepart = relDepart.lignes.length === 0 && relDepart.reportsEnvoyes.length === 1;
res.reportRempliLeMoisArrivee = relArrivee.lignes.length === 1 && relArrivee.lignes[0].minutes === 60 && relArrivee.lignes[0].minutesFacturables === 60 && relArrivee.lignes[0].reporte === true;
res.journalGardeLaDate = entreesDuMois(entreesJournal(), moisR).length === 2;
RELEVE_MOIS = moisCible;
rendreReleve();
/* On screen, the target month has a "Moved from May 2031" line; the statement PDF keeps "Done in". */
res.mentionOrigineAffichee = /Moved from May 2031/.test(document.getElementById('releveContenu').textContent) && !/Done in/.test(document.getElementById('releveContenu').textContent);
res.pdfReportMention = /Done in May 2031/.test(htmlReleve(relArrivee, {}));
/* Once invoiced, the work item can no longer be moved. */
var relR = releveAFacturer(moisCible);
var fR = construireFacture(relR, ETAT.reglages, { numero: '2031-98', dateEmission: moisCible + '-30', travaux: [], factures: [] });
factures().push(fR); sauver('factures');
res.factureReporteeGardeLaDate = fR.lignes.length === 1 && fR.lignes[0].date === moisR + '-12' && fR.lignes[0].moisFacturation === moisCible;
/* The invoice PDF states neither the date nor the month the work was done; the screen keeps it. */
var hfR = htmlFacture(fR);
res.factureSansDateDeRealisation = hfR.indexOf('Done in') < 0 && hfR.indexOf(dateFr(moisR + '-12')) < 0 && hfR.indexOf('May 2031') < 0 && hfR.indexOf('Movable') > 0 && /Moved from May 2031/.test(document.getElementById('releveContenu').textContent);
/* The original month keeps its days, marked "moved to June", outside the total. */
RELEVE_MOIS = moisR; rendreReleve();
res.journeeResteDansSonMois = !!document.querySelector('#releveContenu .rl-jour[data-jour="' + moisR + '-12"].rl-reporte') && /moved to June/.test(document.getElementById('releveContenu').textContent);
RELEVE_MOIS = moisCible; rendreReleve();
res.reportVerrouilleApresFacture = interventionsReportables(moisCible).length === 0 && appliquerMoisFacturation(entreesJournal().filter(function (e) { return e.id === 'ent_r1'; }), moisR) === 0;
ETAT.factures.factures = factures().filter(function (f) { return f.id !== fR.id; });
ETAT.journal.entrees = entreesJournal().filter(function (x) { return x.id !== 'ent_r1' && x.id !== 'ent_r2'; });
sauver('factures'); sauver('journal');

/* --- 8 ter. Linking a log entry to a task from its sheet --- */
var tL = normaliserTache({ id: 'tache_lien_test', statut: 'en-cours', axe: 'projeta', titre: 'Linked test task', description: '', priorite: 'auto', echeance: null, ordre: 99, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString(), faitLe: null });
taches().push(tL); sauver('chantiers');
entreesJournal().push({ id: 'ent_lien', date: '2031-04-03', axe: 'projeta', intervention: 'To link', detail: '', debut: '', fin: '', minutes: 50, tache: null, creeLe: new Date().toISOString() });
sauver('journal');
RELEVE_MOIS = '2031-04'; RELEVE_JOURS['2031-04-03'] = true; afficherPage('journal');
ouvrirEditionEntree('ent_lien');
var selT = document.querySelector('#edTache');
res.champTacheDansFiche = !!selT && !!selT.querySelector('option[value="tache_lien_test"]');
selT.value = 'tache_lien_test'; selT.dispatchEvent(new Event('change', { bubbles: true }));
document.querySelector('#modaleRacine [data-role=ok]').click();
res.ligneLieeEnregistree = entreeParId('ent_lien').tache === 'tache_lien_test';
res.puceTacheDansJournal = !!document.querySelector('#releveContenu .jr-ligne[data-id="ent_lien"] .puce.tache');
res.tempsCompteDansLaTache = minutesTache(entreesJournal(), 'tache_lien_test').minutes === 50;
document.querySelector('#releveContenu .jr-ligne[data-id="ent_lien"] .puce.tache').click();
res.puceOuvreLaFiche = !!document.querySelector('#modaleRacine [data-tache="tache_lien_test"], #modaleRacine .modal[data-tache], #modaleRacine .fiche') || modaleOuverte();
fermerModale();
ETAT.journal.entrees = entreesJournal().filter(function (x) { return x.id !== 'ent_lien'; });
ETAT.chantiers.taches = taches().filter(function (x) { return x.id !== 'tache_lien_test'; });
sauver('journal'); sauver('chantiers');

/* --- 9. Notes: multi-line idea block, conversion --- */
afficherPage('notes');
ouvrirPageNotes('page_idees');
var contI = docNotes();
var dernier = contI.lastElementChild;
var nouveauBloc = insererLigneApres(dernier, bloc('idee', '<b>Multi idea</b><br>line 2<br>line 3'));
serialiserDoc();
var tD = creerTacheDepuisLigne(nouveauBloc);
res.ideeMultiLignes = !!tD && tD.titre === 'Multi idea' && tD.description === 'line 2\nline 3';
var blocD = document.querySelector('#ntDoc .ligne[data-tache="' + tD.id + '"]');
if (blocD) { blocD.remove(); serialiserDoc(); }
ETAT.chantiers.taches = taches().filter(function (x) { return x.id !== tD.id; });
sauver('chantiers');

/* --- 10. Settings: an emptied number field does not reset the value to zero --- */
afficherPage('reglages');
var tarifAvant = ETAT.reglages.tarifHoraire;
var champTarif = document.getElementById('reglTarif');
champTarif.value = '';
champTarif.dispatchEvent(new Event('change', { bubbles: true }));
res.tarifVideConserve = ETAT.reglages.tarifHoraire === tarifAvant && Number(document.getElementById('reglTarif').value) === tarifAvant;

/* --- 11. Reminders: orphan snooze, missing settings --- */
var sauveRappels = ETAT.reglages.rappels;
ETAT.reglages.rappels = undefined;
var okRappels = true;
try { rappelsActifs(); rendreBadgeRappels(); ouvrirRappels(); fermerModale(); } catch (e) { okRappels = false; res.erreurRappels = String(e); }
ETAT.reglages.rappels = sauveRappels;
ETAT.reglages.ui.rappelsReportes = undefined;
try { reporterRappel('echeance:inexistante', 1); } catch (e) { okRappels = false; res.erreurRappels2 = String(e); }
res.rappelsRobustes = okRappels;

/* --- 12. Dashboard and pages with empty data --- */
var sauvegardeTout = JSON.parse(JSON.stringify(paquetSauvegarde()));
ETAT.journal.entrees = []; ETAT.chantiers.taches = []; ETAT.echeances.echeances = []; ETAT.factures.factures = []; ETAT.notes.pages = []; ETAT.chrono.enCours = null;
var okVide = true;
try { afficherPage('tableau'); afficherPage('journal'); afficherPage('releve'); afficherPage('factures'); afficherPage('taches'); afficherPage('notes'); afficherPage('echeances'); rendreBadgeRappels(); } catch (e) { okVide = false; res.erreurVide = String(e && e.stack || e); }
res.pagesVidesOk = okVide;
remplacerEtat(sauvegardeTout);
rafraichir();

/* --- 13. Cancelled drag (pointercancel) --- */
afficherPage('taches');
var carteG = document.querySelector('.kb-carte');
var rg = carteG.getBoundingClientRect();
var peG = function (type, x, y, cible) { (cible || document).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, isPrimary: true, pointerType: 'mouse' })); };
peG('pointerdown', rg.left + 20, rg.top + 12, carteG);
peG('pointermove', rg.left + 60, rg.top + 40);
peG('pointercancel', rg.left + 60, rg.top + 40);
await new Promise(function (r) { setTimeout(r, 250); });
res.glisserAnnuleNettoye = !document.querySelector('.kb-placeholder') && !document.querySelector('.kb-flottante') && !document.body.classList.contains('kb-glisser-actif') && GLISSER === null;

/* --- 14. Navigation: unknown page, aliases --- */
afficherPage('inconnue');
res.pageInconnue = PAGE_COURANTE === 'tableau';
afficherPage('chantiers');
res.aliasChantiers = PAGE_COURANTE === 'taches';

/* --- 14 bis. Dashboard: earned and to set aside for taxes, like the invoices page --- */
afficherPage('tableau');
var libsTuiles = Array.prototype.map.call(document.querySelectorAll('#tableauContenu .dash-tuile .dash-lib'), function (x) { return x.textContent; });
res.tuilesTableau = libsTuiles.indexOf('Earned since the start') >= 0 && libsTuiles.indexOf('To set aside for taxes') >= 0 && libsTuiles.indexOf('Hours spent') < 0 && libsTuiles.indexOf('Contract progress') < 0;
var declaresAudit = ETAT.reglages.ui.trimestresDeclares || {};
var dusAudit = trimestresFiscaux(factures(), ETAT.reglages, aujourdhui()).filter(function (t) { return !declaresAudit[t.cle] && t.echeance >= aujourdhui() && t.tva + t.paiement130 > 0; });
var aVenirAudit = impotsAVenir(aujourdhui());
var valeurTuile = Array.prototype.filter.call(document.querySelectorAll('#tableauContenu .dash-tuile'), function (x) { return x.querySelector('.dash-lib').textContent === 'To set aside for taxes'; })[0];
res.impotsCommeLesFactures = (dusAudit.length ? aVenirAudit[0].cle === dusAudit[0].cle && Math.abs(aVenirAudit[0].aMettreDeCote - dusAudit[0].tva - dusAudit[0].paiement130) < 0.005 : aVenirAudit.length === 0)
  && !!valeurTuile && valeurTuile.querySelector('.dash-val').textContent === fmtEuros(aVenirAudit.length ? aVenirAudit[0].aMettreDeCote : 0);

/* --- 15. Log and statement: one row per day, PDFs filed automatically --- */
afficherPage('journal');
res.aliasJournal = PAGE_COURANTE === 'releve';
var fDemo = factures()[0];
if (fDemo) {
  RELEVE_MOIS = fDemo.mois; RELEVE_JOURS = {}; rendreReleve();
  var joursRl = document.querySelectorAll('#releveContenu .rl-jour');
  res.uneLigneParJour = joursRl.length > 0 && !document.querySelector('#releveContenu .rl-detail');
  joursRl[0].click();
  res.jourDeplie = !!document.querySelector('#releveContenu .rl-detail .jr-ligne');
  res.boutonsMasquesApresFacture = !document.querySelector('#releveContenu [data-action="facture"]') && !document.querySelector('#releveContenu [data-action="pdf-releve"]');
  res.deuxEncadres = document.querySelectorAll('#releveContenu .rl-recap .panneau').length === 2;
  if (ETAT.reglages.dossierFactures) {
    res.pdfRanges = [];
    for (var iF = 0; iF < factures().length; iF++) {
      var pdfs = await exporterFacturePdf(factures()[iF].id);
      res.pdfRanges = res.pdfRanges.concat((pdfs || []).map(function (x) { return x && x.ok ? x.chemin : 'ECHEC ' + (x && x.message); }));
    }
  }
}

/* --- 16. Issued invoice: parties and statement frozen, number sequence, payment --- */
var sauveReglages16 = JSON.stringify(ETAT.reglages);
var sauveFactures16 = factures().slice();
var sauveJournal16 = entreesJournal().slice();
var mois16 = '2033-03';
var ligne16 = function (id, jour, minutes) { return { id: id, date: mois16 + '-' + jour, axe: 'projeta', intervention: 'Essai ' + id, detail: '', debut: '', fin: '', minutes: minutes, tache: null, creeLe: mois16 + '-' + jour + 'T10:00:00.000Z' }; };
ETAT.reglages.dossierFactures = await window.sablier.donnees.dossier();
ETAT.reglages.prestataire.iban = 'FR7600000000000000000000001';
ETAT.reglages.client.societe = 'Client de depart';
entreesJournal().push(ligne16('f1', '05', 120));
sauver('journal');
var valider16 = function (numero, date) {
  RELEVE_MOIS = mois16; rendreReleve();
  document.querySelector('[data-action=facture]').click();
  var champ = document.querySelector('#faDate');
  champ.value = date; champ.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#faNumero').value = numero;
  var avant = factures().length;
  document.querySelector('[data-role=ok]').click();
  var cree = factures().length > avant;
  if (!cree) fermerModale();
  return cree;
};
res.premiereFacture = valider16('2033-01', mois16 + '-10');
var f16 = factures()[factures().length - 1];
await new Promise(function (r) { setTimeout(r, 2500); });
var pdf16 = await exporterFacturePdf(f16.id);
res.refaireNEcrasePas = pdf16.length === 2 && /Invoice-2033-01 \(2\)\.pdf$/.test(pdf16[0].chemin) && /Activity-statement-2033-03 \(2\)\.pdf$/.test(pdf16[1].chemin);
ETAT.reglages.prestataire.iban = 'FR7699999999999999999999999';
ETAT.reglages.client.societe = 'Client de remplacement';
var hf16 = htmlFacture(f16);
res.factureGardeSesParties = hf16.indexOf('FR76 0000') > 0 && hf16.indexOf('Client de depart') > 0 && hf16.indexOf('FR76 9999') < 0 && hf16.indexOf('Client de remplacement') < 0;
entreesJournal().push(ligne16('f2', '20', 60));
var hr16 = htmlReleveDuMois(mois16);
res.releveResteFige = hr16.indexOf('85.72') > 0 && hr16.indexOf('128.58') < 0 && hr16.indexOf('Essai f2') < 0 && hr16.indexOf('Client de depart') > 0 && hr16.indexOf('Client de remplacement') < 0 && hr16.indexOf('Prepared on 10/03/2033') > 0;
var ancienne16 = JSON.parse(JSON.stringify(f16));
delete ancienne16.prestataire; delete ancienne16.client; delete ancienne16.reportsEnvoyes;
var hfa16 = htmlFacture(ancienne16);
res.factureSansPartiesLisible = hfa16.indexOf('Client de remplacement') > 0 && hfa16.indexOf('FR76 9999') > 0 && hfa16.indexOf('85.72') > 0;
res.numeroDoublonRefuse = !valider16('2033-1', mois16 + '-20');
res.numeroTrouRefuse = !valider16('2033-05', mois16 + '-20');
res.numeroAutreAnneeRefuse = !valider16('2034-01', mois16 + '-20');
res.dateAnterieureRefusee = !valider16('2033-02', mois16 + '-09');
f16.statut = 'payee'; f16.datePaiement = mois16 + '-25';
afficherPage('factures');
res.pasDeBoutonSurPayee = !document.querySelector('#facturesContenu [data-action=supprimer]');
supprimerFacture(f16.id);
res.payeeNonSupprimee = !modaleOuverte() && factureParId(f16.id) === f16;
f16.statut = 'emise'; f16.datePaiement = null;
res.numeroSuivantAccepte = valider16('2033-02', mois16 + '-10');
await new Promise(function (r) { setTimeout(r, 2500); });
ETAT.reglages = JSON.parse(sauveReglages16);
ETAT.factures.factures = sauveFactures16;
ETAT.journal.entrees = sauveJournal16;
sauver('reglages'); sauver('factures'); sauver('journal');

/* --- Cleanup --- */
ETAT.chantiers.taches = taches().filter(function (x) { return [tA.id, tC.id].indexOf(x.id) < 0; });
sauver('chantiers');
afficherPage('tableau');
