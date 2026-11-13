/* ============================================================
   GABARITS : les documents PDF (relevé d'activité, facture), rendus en
   HTML puis imprimés en PDF par l'application (src-tauri/src/mac.rs).

   Même charte que les rapports Projet A : bandeau marine, titres serif,
   or en filet, chiffres tabulaires. Aucun tiret cadratin.

   En tête, seules les mentions utiles : nom suivi de « EI », adresse sur
   deux lignes, SIRET, moyens de contact ; la facture porte en plus ses
   conditions de règlement et les coordonnées bancaires.
   ============================================================ */
'use strict';

function styleDocument() {
  return '<style>'
    + '@page { size: A4; margin: 16mm 15mm 18mm; }'
    + 'html, body { margin: 0; padding: 0; }'
    + 'body { font-family: "Avenir Next", "Avenir", -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; color: #1C2B3A; line-height: 1.45; font-feature-settings: "tnum" 1, "lnum" 1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }'
    + 'h1, h2, h3 { font-family: "Charter", "Iowan Old Style", "Georgia", serif; margin: 0; }'
    + 'p { margin: 0; }'
    + '.bandeau { background: #1F497D; color: #FFFFFF; padding: 8mm 8mm 7mm; border-radius: 3mm; display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; }'
    + '.bandeau .sur { font-size: 8.5pt; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.82; margin-bottom: 1mm; font-weight: 400; }'
    + '.bandeau h1 { font-size: 20pt; font-weight: 400; letter-spacing: 0.01em; }'
    + '.bandeau .sous { font-size: 10pt; opacity: 0.85; margin-top: 2mm; }'
    + '.bandeau .marque { text-align: right; font-size: 9pt; opacity: 0.9; }'
    + '.bandeau .marque b { display: block; font-family: "Charter", "Georgia", serif; font-size: 12pt; font-weight: 600; opacity: 1; }'
    + '.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm 10mm; margin: 7mm 0 6mm; }'
    + '.partie .lib { font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase; color: #5F7186; font-weight: 400; margin-bottom: 1.5mm; }'
    + '.partie .nom { font-weight: 600; font-size: 11.5pt; margin-bottom: 0.6mm; }'
    + '.partie div { margin: 0; line-height: 1.5; }'
    + '.partie .sec { color: #46586C; font-size: 9.5pt; }'
    + '.partie .sec:first-of-type { margin-top: 1.2mm; }'
    + '.meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin: 0 0 6mm; }'
    + '.meta .case { border: 1px solid #E4E9F0; border-radius: 2.5mm; padding: 3mm 4mm; background: #F7F9FB; }'
    + '.meta .lib { font-size: 7.5pt; letter-spacing: 0.10em; text-transform: uppercase; color: #5F7186; font-weight: 400; }'
    + '.meta .val { font-size: 11pt; font-weight: 400; margin-top: 1mm; }'
    + 'table { width: 100%; border-collapse: collapse; margin-top: 2mm; }'
    + 'table.releve { table-layout: fixed; }'
    + 'table.releve td { font-size: 9.5pt; }'
    + 'table.releve th { white-space: normal; font-size: 7.5pt; letter-spacing: 0.06em; vertical-align: bottom; }'
    + 'th { text-align: left; font-size: 8pt; letter-spacing: 0.10em; text-transform: uppercase; color: #5F7186; padding: 2.5mm 2.5mm; border-bottom: 1.5px solid #1F497D; font-weight: 400; }'
    + 'td { padding: 2.4mm 2.5mm; border-bottom: 1px solid #E4E9F0; vertical-align: top; font-size: 10pt; }'
    + 'td.num, th.num { text-align: right; white-space: nowrap; }'
    + 'tr { break-inside: avoid; page-break-inside: avoid; }'
    + 'thead { break-after: avoid; page-break-after: avoid; }'
    /* Le total n'apparaît qu'une fois, à la fin, pas en bas de chaque page. */
    + 'tfoot { display: table-row-group; }'
    + '.insec { white-space: nowrap; }'
    + 'tfoot td { border-top: 1.5px solid #1F497D; border-bottom: none; font-weight: 400; background: #F7F9FB; }'
    + '.axe { display: inline-flex; align-items: center; gap: 1.6mm; font-size: 8pt; font-weight: 400; border: 1px solid; border-radius: 3mm; padding: 0.4mm 2.2mm 0.4mm 1.6mm; white-space: normal; line-height: 1.35; vertical-align: middle; }'
    + '.axe i { display: inline-block; width: 2.2mm; height: 2.2mm; border-radius: 50%; flex: none; }'
    + '.sec { color: #46586C; font-size: 9pt; }'
    + '.total-bloc { margin-top: 6mm; display: flex; justify-content: flex-end; }'
    + '.total-bloc table { width: 90mm; margin: 0; }'
    + '.total-bloc td { border-bottom: 1px solid #E4E9F0; padding: 2mm 2.5mm; }'
    + '.total-bloc tr.grand td { border-top: 1.5px solid #A5813C; border-bottom: none; font-family: "Charter", "Georgia", serif; font-size: 13pt; font-weight: 400; color: #1B3D63; padding-top: 3mm; }'
    + '.mention { margin-top: 6mm; font-size: 9pt; color: #46586C; border-left: 2px solid #A5813C; padding: 1.5mm 3mm; background: rgba(165,129,60,0.07); border-radius: 0 2mm 2mm 0; }'
    + '.reglement { margin-top: 7mm; border: 1px solid #E4E9F0; border-radius: 3mm; padding: 4.5mm 5.5mm 5mm; display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 10mm; font-size: 9.5pt; color: #1C2B3A; page-break-inside: avoid; }'
    + '.reglement h3 { grid-column: 1 / -1; font-size: 11.5pt; font-weight: 400; color: #1B3D63; margin: 0 0 1.5mm; padding-bottom: 1.5mm; border-bottom: 1px solid #E4E9F0; }'
    + '.reglement .modalites p { margin: 0 0 1.8mm; line-height: 1.5; color: #46586C; }'
    + '.rib { display: grid; grid-template-columns: auto 1fr; gap: 1.6mm 5mm; align-items: baseline; align-content: start; }'
    + '.rib .lib { font-size: 7.5pt; letter-spacing: 0.10em; text-transform: uppercase; color: #5F7186; font-weight: 400; }'
    + '.rib .iban { font-size: 10pt; letter-spacing: 0.04em; color: #1C2B3A; white-space: nowrap; }'
    + '.rib .bic { font-size: 10pt; letter-spacing: 0.04em; }'
    + '.signature { margin-top: 12mm; display: flex; justify-content: space-between; gap: 10mm; font-size: 9.5pt; color: #46586C; break-inside: avoid; page-break-inside: avoid; }'
    + '.signature .cadre { width: 70mm; height: 22mm; border: 1px dashed #CBD5E1; border-radius: 2mm; margin-top: 2mm; }'
    + '.annexe { page-break-before: always; }'
    + '.annexe-titre { font-size: 15pt; font-weight: 400; color: #1B3D63; margin: 0 0 1mm; }'
    + '.annexe-sous { color: #46586C; font-size: 9.5pt; margin: 0 0 4mm; }'
    + 'h2.section { font-size: 12.5pt; font-weight: 400; color: #1B3D63; margin: 7mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #E4E9F0; break-after: avoid; page-break-after: avoid; }'
    + 'ul.travaux { margin: 2mm 0 0; padding-left: 5mm; }'
    + 'ul.travaux li { margin: 1.2mm 0; break-inside: avoid; page-break-inside: avoid; }'
    + 'ul.travaux li::marker { color: #A5813C; }'
    + '.vide { color: #5F7186; font-style: italic; padding: 4mm 0; }'
    /* Facture : en-tête classique, émetteur à gauche, références à droite, client décalé. */
    + '.fx-tete { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; padding-bottom: 5mm; border-bottom: 1.5px solid #1F497D; }'
    + '.fx-emetteur { font-size: 9.5pt; line-height: 1.5; }'
    + '.fx-emetteur .fx-nom { font-family: "Charter", "Iowan Old Style", "Georgia", serif; font-size: 15pt; font-weight: 600; color: #1B3D63; margin-bottom: 1.5mm; }'
    + '.fx-emetteur .sec, .fx-client .sec { font-size: 9pt; }'
    + '.fx-emetteur .sec:first-of-type, .fx-client .sec { margin-top: 1.2mm; }'
    + '.fx-titre { text-align: right; }'
    + '.fx-titre h1 { font-size: 26pt; font-weight: 400; color: #1B3D63; letter-spacing: 0.03em; line-height: 1; margin-bottom: 4mm; }'
    + '.fx-ref { width: auto; margin: 0 0 0 auto; }'
    + '.fx-ref td { border: none; padding: 0.7mm 0 0.7mm 6mm; font-size: 10pt; text-align: right; white-space: nowrap; }'
    + '.fx-ref td:first-child { font-size: 7.5pt; letter-spacing: 0.10em; text-transform: uppercase; color: #5F7186; }'
    + '.fx-ref td:last-child { font-weight: 600; }'
    + '.fx-client { margin: 9mm 0 9mm 100mm; font-size: 10pt; line-height: 1.5; }'
    + '.fx-client .lib { font-size: 7.5pt; letter-spacing: 0.12em; text-transform: uppercase; color: #5F7186; margin-bottom: 1.5mm; }'
    + '.fx-client .nom { font-weight: 600; font-size: 11.5pt; }'
    + 'table.fx-lignes { table-layout: fixed; }'
    + 'table.fx-lignes td { padding: 3mm 2.5mm; }'
    + 'table.fx-lignes td .sec { margin-top: 0.8mm; }'
    + '.fx-annexe tr.fx-axe { break-after: avoid; page-break-after: avoid; }'
    + '.fx-annexe tr.fx-axe td { font-weight: 600; color: #1B3D63; background: #F7F9FB; border-bottom: 1px solid #CBD5E1; padding-top: 2.6mm; }'
    + '.fx-annexe td.fx-nature { padding-left: 5mm; }'
    + '.fx-annexe .fx-int { font-weight: 500; }'
    + '.fx-annexe td .sec { margin-top: 0.6mm; line-height: 1.45; }'
    + '</style>';
}

/* Espace fine insécable avant « € » : l'espace insécable ordinaire de
   Charter est si large que le symbole paraissait détaché du montant. */
function documentHtml(titre, corps) {
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>' + echapper(titre) + '</title>' + styleDocument() + '</head><body>' + corps.replace(/ €/g, ' €') + '</body></html>';
}

function hexVersRgba(hex, alpha) {
  var h = String(hex || '#5F7186').replace('#', '');
  if (h.length !== 6) h = '5F7186';
  return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + alpha + ')';
}
/* Pastille d'axe pour les documents : couleurs posées en dur (impression). */
function axePdfHtml(id) {
  var a = axeParId(id);
  var c = couleurAxe(id);
  var nom = a ? a.nom : (id || '');
  return '<span class="axe" style="color:' + c + '; background:' + hexVersRgba(c, 0.09) + '; border-color:' + hexVersRgba(c, 0.32) + '"><i style="background:' + c + '"></i>' + echapper(nom) + '</span>';
}

/* Les mots à trait d'union (« sous-jacents ») ne se coupent pas en fin de ligne. */
function texteInsecable(s) {
  return echapper(s).replace(/\S+-\S+/g, function (m) { return '<span class="insec">' + m + '</span>'; });
}
/* Heures des documents, partout à la minute (« 1 h 05 ») : des centièmes arrondis ne s'additionnent pas (3 fois 0,12 pour 0,35).
   L'unité ne passe jamais seule à la ligne. */
function heuresDoc(minutes) {
  var m = Math.round(minutes || 0);
  return Math.floor(m / 60) + '\u00a0h\u00a0' + String(m % 60).padStart(2, '0');
}

/* Nom de l'entrepreneur suivi de « EI », obligatoire sur ses documents professionnels. */
function nomEI(p) {
  var nom = String((p && p.nom) || '').trim();
  return /(^|\s)EI$/.test(nom) ? nom : nom + ' EI';
}

/* Les deux parties, sobres : nom, adresse sur deux lignes, SIRET de
   l'établissement (il contient le SIREN ; à défaut, le SIREN), contact.
   Pas de code APE, non obligatoire. */
function blocParties(r, options) {
  var o = options || {};
  var p = r.prestataire || {}, c = r.client || {};
  var ligne = function (t, classe) { return t ? '<div' + (classe ? ' class="' + classe + '"' : '') + '>' + echapper(t) + '</div>' : ''; };
  return '<div class="parties">'
    + '<div class="partie"><div class="lib">Prestataire</div><div class="nom">' + echapper(nomEI(p)) + '</div>'
    + adresseLignes(p.adresse).map(function (l) { return ligne(l); }).join('')
    + ligne(p.siret ? 'SIRET ' + p.siret : (p.siren ? 'SIREN ' + p.siren : ''), 'sec')
    + ligne(p.email, 'sec')
    + ligne(p.telephone ? formaterTelephone(p.telephone) : '', 'sec')
    + '</div>'
    + '<div class="partie"><div class="lib">' + echapper(o.clientLib || 'Client') + '</div><div class="nom">' + echapper(c.societe) + '</div>'
    + ligne(c.contact)
    + adresseLignes(c.adresse).map(function (l) { return ligne(l); }).join('')
    + ligne(c.siren ? 'SIREN ' + c.siren : '', 'sec')
    + '</div></div>';
}

/* Tableau des interventions. Avec sansDate (annexe de la facture), ni
   colonne Date ni mois d'origine : le document ne dit pas quand le travail
   a été réalisé. */
function tableauReleveHtml(lignes, options) {
  var o = options || {};
  if (!lignes.length) return '<div class="vide">Aucune intervention sur le mois.</div>';
  var totalMin = 0, totalFact = 0, totalMontant = 0;
  /* Montants affichés au centime, dont la somme égale le total imprimé ;
     le dernier est celui de l'arrondi du total au quart d'heure. */
  var arrondi = Number(o.arrondiMinutes) || 0, montantArrondi = arrondi / 60 * (Number(o.tarif) || 0);
  var montants = montantsAuCentime(lignes.map(function (l) { return l.montant; }).concat([montantArrondi]));
  var rows = lignes.map(function (l, i) {
    var facturable = l.facturable !== false;
    var forfait = l.forfait != null ? Number(l.forfait) : null;
    var valeur = Number(l.valeurHoraire) || 0;
    totalMin += l.minutes; totalFact += facturable ? l.minutesFacturables : 0; totalMontant += l.montant;
    var complement = '';
    if (!facturable) complement += '<div class="sec">Non facturable' + (l.motifs && l.motifs.length ? ' : ' + echapper(l.motifs.join(', ')) : '') + '</div>';
    /* Un travail reporté garde sa date : le relevé dit d'où il vient. */
    if (!o.sansDate && o.mois && moisDe(l.date) !== o.mois) complement += '<div class="sec">Réalisé en ' + echapper(libelleMois(moisDe(l.date))) + '</div>';
    if (forfait != null) complement += '<div class="sec">Forfait' + (valeur > forfait ? ', au lieu de ' + fmtEuros(valeur) + ' au tarif horaire' : '') + '</div>';
    /* Une ligne ne se coupe jamais entre deux pages (sauf si elle dépasse une page entière). */
    return '<tr>' + (o.sansDate ? '' : '<td class="num">' + dateFr(l.date) + '</td>')
      + '<td>' + axePdfHtml(l.axe) + '</td>'
      + '<td>' + texteInsecable(l.nature) + complement + '</td>'
      + '<td class="num">' + heuresDoc(l.minutes) + '</td>'
      + '<td class="num">' + heuresDoc(facturable ? l.minutesFacturables : 0) + '</td>'
      + (o.sansMontant ? '' : '<td class="num">' + fmtEuros(montants[i]) + '</td>')
      + '</tr>';
  }).join('');
  if (arrondi) {
    totalFact += arrondi; totalMontant += montantArrondi;
    rows += '<tr>' + (o.sansDate ? '' : '<td></td>') + '<td></td><td>Arrondi du total au quart d\'heure supérieur</td><td class="num"></td><td class="num">' + heuresDoc(arrondi) + '</td>'
      + (o.sansMontant ? '' : '<td class="num">' + fmtEuros(montants[lignes.length]) + '</td>') + '</tr>';
  }
  return '<table class="releve"><colgroup>' + (o.sansDate ? '' : '<col style="width:21mm">') + '<col style="width:37mm"><col><col style="width:19mm"><col style="width:20mm">' + (o.sansMontant ? '' : '<col style="width:22mm">') + '</colgroup>'
    + '<thead><tr>' + (o.sansDate ? '' : '<th class="num">Date</th>') + '<th>Axe</th><th>Nature du travail</th><th class="num">Temps passé</th><th class="num">Temps facturé</th>' + (o.sansMontant ? '' : '<th class="num">Montant HT</th>') + '</tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '<tfoot><tr><td colspan="' + (o.sansDate ? 2 : 3) + '">' + (o.libelleTotal || 'Total du mois') + '</td><td class="num">' + heuresDoc(totalMin) + '</td><td class="num">' + heuresDoc(totalFact) + '</td>' + (o.sansMontant ? '' : '<td class="num">' + fmtEuros(arrondir2(totalMontant)) + '</td>') + '</tr></tfoot></table>';
}

/* Les tâches terminées rattachées au relevé : celles du mois, plus celles
   des mois dont il facture le travail reporté. La date les situe, sauf sur
   la facture (sansDate). */
function listeTravauxHtml(travaux, options) {
  var o = options || {};
  if (!travaux || !travaux.length) return '';
  return '<h2 class="section">' + (o.sansDate ? 'Travaux terminés rattachés à cette facture' : 'Travaux terminés rattachés à ce relevé') + '</h2><ul class="travaux">'
    + travaux.map(function (t) {
      return '<li>' + texteInsecable(t.titre) + (t.axe ? ' ' + (o.sansDate ? '<span class="sec">(' + echapper(libelleAxe(t.axe)) + ')</span>' : axePdfHtml(t.axe)) : '')
        + (!o.sansDate && t.faitLe ? ' <span class="sec">(' + echapper(libelleDate(t.faitLe, 'moyen')) + ')</span>' : '') + '</li>';
    }).join('') + '</ul>';
}

/* Relevé d'activité d'un mois (document autonome). */
function htmlReleve(releve, options) {
  var o = options || {};
  var r = ETAT.reglages;
  var parties = { prestataire: o.prestataire || r.prestataire, client: o.client || r.client };
  var hj = Number(r.heuresJournee) || 7;
  /* Ce que ce relevé fait facturer pour d'autres mois, et ce qu'il a laissé
     partir ailleurs : le document doit dire les deux, il fait foi. */
  var origines = [];
  releve.lignes.forEach(function (l) {
    var m = moisDe(l.date);
    if (m && m !== releve.mois && origines.indexOf(m) < 0) origines.push(m);
  });
  origines.sort();
  var toutVientDAilleurs = origines.length > 0 && releve.lignes.every(function (l) { return moisDe(l.date) !== releve.mois; });
  var partis = releve.reportsEnvoyes || [];
  var minutesParties = partis.reduce(function (s, g) { return s + (g.totaux ? g.totaux.minutes : 0); }, 0);
  var corps = '<div class="bandeau"><div><div class="sur">Relevé d\'activité</div><h1>' + capitaliser(libelleMois(releve.mois)) + '</h1><div class="sous">' + (o.numeroFacture ? (String(o.numeroFacture).indexOf(',') >= 0 ? 'Annexe des factures n° ' : 'Annexe de la facture n° ') + echapper(o.numeroFacture) : 'Détail des interventions du mois') + '</div></div>'
    + '<div class="marque"><b>' + echapper(parties.prestataire.nom) + '</b>pour ' + echapper(parties.client.societe) + '</div></div>'
    + blocParties(parties)
    + '<div class="meta">'
    + '<div class="case"><div class="lib">Tarif horaire</div><div class="val">' + fmtEuros(releve.tarif) + ' HT</div></div>'
    + '<div class="case"><div class="lib">Temps passé</div><div class="val">' + heuresDoc(releve.totalMinutes) + '</div></div>'
    + '<div class="case"><div class="lib">Temps facturé</div><div class="val">' + heuresDoc(releve.totalMinutesFacturables) + '</div></div>'
    + '<div class="case"><div class="lib">Journées de ' + fmtNombre(hj, 0) + ' h</div><div class="val">' + fmtNombre(releve.journees, 2) + '</div></div>'
    + '</div>'
    + tableauReleveHtml(releve.lignes, { mois: releve.mois, arrondiMinutes: releve.arrondiMinutes, tarif: releve.tarif })
    + '<div class="total-bloc"><table>'
    + (releve.totalMinutesNonFacturables ? '<tr><td>Temps non facturable</td><td class="num">' + heuresDoc(releve.totalMinutesNonFacturables) + ' · 0,00 €</td></tr>' : '')
    + '<tr><td>Temps facturé</td><td class="num">' + heuresDoc(releve.totalMinutesFacturables) + ' × ' + fmtEuros(releve.tarif) + '</td></tr>'
    + (releve.remise > 0 ? '<tr><td>Valeur au tarif horaire</td><td class="num">' + fmtEuros(releve.valeurHoraire) + '</td></tr><tr><td>Remise sur forfait</td><td class="num">' + fmtEuros(-releve.remise) + '</td></tr>' : '')
    + '<tr><td>Montant HT</td><td class="num">' + fmtEuros(releve.montantHT) + '</td></tr>'
    + (releve.frais ? '<tr><td>Frais de déplacement autorisés (justificatifs joints)</td><td class="num">' + fmtEuros(releve.frais) + '</td></tr>' : '')
    + '<tr class="grand"><td>Montant à facturer</td><td class="num">' + fmtEuros(releve.total) + '</td></tr>'
    + '</table></div>'
    + '<div class="mention">' + echapper([
      o.mentionTVA || r.mentionTVA,
      'Décompte à l\'heure : chaque intervention à son temps exact, le total arrondi une fois au quart d\'heure supérieur (article 6.1 du contrat)',
      origines.length ? (toutVientDAilleurs ? 'Les interventions de ce relevé ont été réalisées en ' : 'Certaines interventions ont été réalisées en ') + enumererMois(origines) + ' et sont facturées sur ce mois' : '',
      minutesParties ? 'Des interventions réalisées en ' + libelleMois(releve.mois) + ' (' + heuresDoc(minutesParties) + ') sont facturées sur le relevé ' + partis.map(function (g) { return deLibelleMois(g.mois); }).join(' et sur celui ') : '',
    ].filter(Boolean).join('. ')) + '.</div>'
    + listeTravauxHtml(o.travaux)
    + '<div class="signature"><div>Établi le ' + dateFr(o.dateEtabli || aujourdhui()) + '<div class="cadre"></div><div class="sec">Signature du prestataire</div></div></div>';
  return documentHtml('Relevé d\'activité ' + libelleMois(releve.mois), corps);
}

/* Conditions de règlement : échéance, escompte, pénalités et indemnité de
   retard (obligatoires entre professionnels, donc toujours imprimées), et
   coordonnées bancaires à droite (IBAN par groupes de quatre). */
function blocReglementHtml(f, r) {
  var p = f.prestataire || r.prestataire || {};
  /* Le délai imprimé est celui figé sur la facture (sinon l'écart entre émission et échéance). */
  var joursDelai = f.delaiPaiement != null ? Number(f.delaiPaiement) : joursEntre(f.dateEmission, f.dateEcheance);
  if (!isFinite(joursDelai)) joursDelai = nombreOu(r.delaiPaiement, 30);
  var delai = fmtNombre(joursDelai, 0);
  var rib = '';
  if (p.titulaireCompte) rib += '<span class="lib">Titulaire</span><span>' + echapper(p.titulaireCompte) + '</span>';
  if (p.banque) rib += '<span class="lib">Banque</span><span>' + echapper(p.banque) + '</span>';
  if (p.iban) rib += '<span class="lib">IBAN</span><span class="iban">' + echapper(formaterIban(p.iban)) + '</span>';
  if (p.bic) rib += '<span class="lib">BIC</span><span class="bic">' + echapper(String(p.bic).replace(/\s+/g, '').toUpperCase()) + '</span>';
  return '<div class="reglement"><h3>Conditions de règlement</h3>'
    + '<div class="modalites"><p>' + (joursDelai > 0 ? 'Paiement par virement bancaire à ' + delai + ' jours date de facture, au plus tard le ' + dateFr(f.dateEcheance) + '.' : 'Paiement par virement bancaire à réception de la facture.') + '</p>'
    + '<p>Escompte pour paiement anticipé : néant.</p>'
    + '<p>En cas de retard de paiement, pénalités exigibles sans rappel au taux de refinancement de la Banque centrale européenne majoré de dix points, et indemnité forfaitaire de 40 € pour frais de recouvrement (article L. 441-10 du Code de commerce).</p></div>'
    + (rib ? '<div class="rib">' + rib + '</div>' : '<div class="sec">Coordonnées bancaires à renseigner dans les Réglages.</div>')
    + '</div>';
}

/* Annexe de la facture : les interventions regroupées par axe, chaque axe
   avec son sous-total, libellé puis détail. Montants au centime, dont la
   somme égale le total. */
function annexeFactureHtml(lignes, arrondiMinutes, tarif) {
  if (!lignes.length) return '<div class="vide">Aucune intervention.</div>';
  var arrondi = Number(arrondiMinutes) || 0, montantArrondi = arrondi / 60 * (Number(tarif) || 0);
  var montants = montantsAuCentime(lignes.map(function (l) { return l.montant; }).concat([montantArrondi]));
  var ordreAxes = (ETAT.reglages.axes || []).map(function (a) { return a.id; });
  var rang = function (axe) { var i = ordreAxes.indexOf(axe); return i < 0 ? ordreAxes.length : i; };
  var ordre = lignes.map(function (l, i) { return i; }).sort(function (a, b) { return rang(lignes[a].axe) - rang(lignes[b].axe) || a - b; });
  var sousTotaux = {}, totalMin = 0, totalFact = 0, totalMontant = 0;
  ordre.forEach(function (i) {
    var l = lignes[i], s = sousTotaux[l.axe] || (sousTotaux[l.axe] = { fact: 0, montant: 0 });
    var fact = l.facturable !== false ? l.minutesFacturables : 0;
    s.fact += fact; s.montant += montants[i];
    totalMin += l.minutes; totalFact += fact; totalMontant += l.montant;
  });
  var axeCourant = null;
  var rows = ordre.map(function (i) {
    var l = lignes[i];
    var facturable = l.facturable !== false;
    var valeur = Number(l.valeurHoraire) || 0;
    var tete = '';
    if (l.axe !== axeCourant) {
      axeCourant = l.axe;
      tete = '<tr class="fx-axe"><td>' + echapper(libelleAxe(l.axe)) + '</td><td></td><td class="num">' + heuresDoc(sousTotaux[l.axe].fact) + '</td><td class="num">' + fmtEuros(arrondir2(sousTotaux[l.axe].montant)) + '</td></tr>';
    }
    var complement = '';
    if (!facturable) complement += '<div class="sec">Non facturé' + (l.motifs && l.motifs.length ? ' : ' + echapper(l.motifs.join(', ')) : '') + '</div>';
    if (l.forfait != null) complement += '<div class="sec">Forfait' + (valeur > l.forfait ? ', au lieu de ' + fmtEuros(valeur) + ' au tarif horaire' : '') + '</div>';
    return tete + '<tr><td class="fx-nature"><div class="fx-int">' + texteInsecable(l.intervention) + '</div>'
      + (l.details && l.details.length ? '<div class="sec">' + texteInsecable(joindreDetails(l.details)) + '</div>' : '') + complement + '</td>'
      + '<td class="num">' + heuresDoc(l.minutes) + '</td>'
      + '<td class="num">' + heuresDoc(facturable ? l.minutesFacturables : 0) + '</td>'
      + '<td class="num">' + fmtEuros(montants[i]) + '</td></tr>';
  }).join('');
  if (arrondi) {
    totalFact += arrondi; totalMontant += montantArrondi;
    rows += '<tr class="fx-axe"><td>Arrondi du total au quart d\'heure supérieur</td><td></td><td class="num">' + heuresDoc(arrondi) + '</td><td class="num">' + fmtEuros(montants[lignes.length]) + '</td></tr>';
  }
  return '<table class="releve fx-annexe"><colgroup><col><col style="width:20mm"><col style="width:20mm"><col style="width:24mm"></colgroup>'
    + '<thead><tr><th>Nature du travail</th><th class="num">Temps passé</th><th class="num">Temps facturé</th><th class="num">Montant HT</th></tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '<tfoot><tr><td>Total de la facture</td><td class="num">' + heuresDoc(totalMin) + '</td><td class="num">' + heuresDoc(totalFact) + '</td><td class="num">' + fmtEuros(arrondir2(totalMontant)) + '</td></tr></tfoot></table>';
}

/* Facture : en-tête de l'émetteur (nom suivi de « EI »), références,
   client, désignation, totaux, conditions de règlement ; en annexe, les
   interventions regroupées par axe. La facture ne dit pas quand le travail
   a été réalisé (décision du prestataire du 09/09/2026, confirmée le
   26/10/2026) : le relevé d'activité daté se joint à part (article 6.3 du
   contrat). Les parties sont celles figées à l'émission ; une facture d'avant
   le 02/11/2026 n'en porte pas et reprend celles des réglages. */
function htmlFacture(f) {
  var r = ETAT.reglages;
  var p = f.prestataire || r.prestataire || {}, c = f.client || r.client || {};
  var lignes = f.lignes || [];
  var horaires = lignes.filter(function (l) { return l.facturable !== false && l.forfait == null; });
  var forfaits = lignes.filter(function (l) { return l.facturable !== false && l.forfait != null; });
  /* Une facture d'avant le 26/10/2026 n'a pas d'arrondiMinutes : ses interventions étaient déjà arrondies. */
  var arrondi = Number(f.arrondiMinutes) || 0;
  var minutesH = horaires.reduce(function (s2, l) { return s2 + (l.minutesFacturables || 0); }, 0) + arrondi;
  var montantH = arrondir2(horaires.reduce(function (s2, l) { return s2 + (l.montant || 0); }, 0) + arrondi / 60 * (Number(f.tarif) || 0));
  var ligne = function (t, classe) { return t ? '<div' + (classe ? ' class="' + classe + '"' : '') + '>' + echapper(t) + '</div>' : ''; };
  var reference = function (lib, val) { return '<tr><td>' + lib + '</td><td>' + echapper(val) + '</td></tr>'; };
  var lignesFacture = '';
  if (horaires.length || (!forfaits.length && !f.frais)) {
    lignesFacture += '<tr><td>Prestations de services informatiques et d\'assistance<div class="sec">Relevé d\'activité ' + echapper(deLibelleMois(f.mois)) + ' joint, détail en annexe</div></td>'
      + '<td class="num">' + heuresDoc(minutesH) + '</td><td class="num">' + fmtEuros(f.tarif) + '</td><td class="num">' + fmtEuros(montantH) + '</td></tr>';
  }
  forfaits.forEach(function (l) {
    var valeur = Number(l.valeurHoraire) || 0;
    lignesFacture += '<tr><td>' + echapper(l.intervention || l.nature) + ' (forfait' + (valeur > l.forfait ? ' : ' + heuresDoc(l.minutesFacturables) + ' valorisées ' + fmtEuros(valeur) + ' au tarif horaire, remise de ' + fmtEuros(arrondir2(valeur - l.forfait)) : '') + ')'
      + (l.details && l.details.length ? '<div class="sec">' + echapper(joindreDetails(l.details)) + '</div>' : '') + '</td>'
      + '<td class="num">1</td><td class="num">' + fmtEuros(l.forfait) + '</td><td class="num">' + fmtEuros(l.forfait) + '</td></tr>';
  });
  if (f.frais) lignesFacture += '<tr><td>Frais de déplacement autorisés, sur justificatifs joints</td><td class="num"></td><td class="num"></td><td class="num">' + fmtEuros(f.frais) + '</td></tr>';
  var corps = '<div class="fx-tete"><div class="fx-emetteur"><div class="fx-nom">' + echapper(nomEI(p)) + '</div>'
    + adresseLignes(p.adresse).map(function (l) { return ligne(l); }).join('')
    + ligne(p.siret ? 'SIRET ' + p.siret : (p.siren ? 'SIREN ' + p.siren : ''), 'sec')
    + ligne(p.email, 'sec')
    + ligne(p.telephone ? formaterTelephone(p.telephone) : '', 'sec')
    + '</div><div class="fx-titre"><h1>Facture</h1><table class="fx-ref">'
    + reference('Numéro', f.numero)
    + reference('Date d\'émission', dateFr(f.dateEmission))
    + reference('Échéance', dateFr(f.dateEcheance))
    + '</table></div></div>'
    + '<div class="fx-client"><div class="lib">Facturé à</div><div class="nom">' + echapper(c.societe) + '</div>'
    + ligne(c.contact ? 'À l\'attention de ' + c.contact : '')
    + adresseLignes(c.adresse).map(function (l) { return ligne(l); }).join('')
    + ligne(c.siren ? 'SIREN ' + c.siren : '', 'sec')
    + '</div>'
    + '<table class="fx-lignes"><colgroup><col><col style="width:22mm"><col style="width:30mm"><col style="width:28mm"></colgroup><thead><tr><th>Désignation</th><th class="num">Quantité</th><th class="num">Prix unitaire HT</th><th class="num">Montant HT</th></tr></thead><tbody>' + lignesFacture + '</tbody></table>'
    + '<div class="total-bloc"><table>'
    + '<tr><td>Total HT</td><td class="num">' + fmtEuros(arrondir2(f.montantHT + (f.frais || 0))) + '</td></tr>'
    + '<tr><td>TVA</td><td class="num">Non applicable</td></tr>'
    + '<tr class="grand"><td>Total TTC à payer</td><td class="num">' + fmtEuros(f.total) + '</td></tr>'
    + '</table></div>'
    + '<div class="mention">' + echapper(String(f.mentionTVA || r.mentionTVA).replace(/[.\s]*$/, '.')) + '</div>'
    + blocReglementHtml(f, r)
    + '<div class="annexe">'
    + '<h2 class="annexe-titre">Annexe à la facture n° ' + echapper(f.numero) + '</h2>'
    + '<p class="annexe-sous">Détail des interventions facturées, par axe de la mission. Tarif horaire de ' + fmtEuros(f.tarif) + ' HT ; chaque intervention à son temps exact, le total arrondi une fois au quart d\'heure supérieur (article 6.1 du contrat).</p>'
    + annexeFactureHtml(regrouperLignesFacture(f.lignes), f.arrondiMinutes, f.tarif)
    + listeTravauxHtml(f.travaux, { sansDate: true })
    + '</div>';
  return documentHtml('Facture ' + f.numero, corps);
}

/* Génération d'un PDF via l'application ; en navigateur nu, ouvre le
   document dans un nouvel onglet pour impression. */
function genererPdf(html, nomFichier) {
  if (!estApp()) {
    var w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    return Promise.resolve({ ok: true, navigateur: true });
  }
  return window.sablier.pdf.generer(html, nomFichier).then(function (res) {
    if (res && res.ok) {
      notifier('PDF enregistré : ' + res.chemin.split('/').pop(), {
        type: 'succes',
        action: { libelle: 'Ouvrir', fn: function () { window.sablier.fichiers.ouvrir(res.chemin); } },
      });
    } else if (res && res.annule) {
      notifier('PDF non enregistré. Vous pourrez le refaire depuis « Factures et recettes ».', { duree: 6000 });
    } else if (res) {
      notifier('Le PDF n\'a pas pu être créé : ' + (res.message || 'erreur inconnue'), { type: 'erreur' });
    }
    return res;
  });
}

/* La facture et le relevé de son mois, enregistrés d'office dans le dossier
   des factures (Réglages), sous-dossier « AAAA-MM mois » ; sans dossier
   réglé, chacun passe par la fenêtre d'enregistrement. */
function enregistrerPdfFacture(f, htmlRel) {
  var docs = [{ html: htmlFacture(f), nom: nomFichierFacture(f) }, { html: htmlRel, nom: nomFichierReleve(f.mois) }];
  var base = ETAT.reglages.dossierFactures;
  if (!estApp() || !base) return docs.reduce(function (p, d) { return p.then(function () { return genererPdf(d.html, d.nom); }); }, Promise.resolve());
  return docs.reduce(function (p, d) {
    return p.then(function (faits) {
      return window.sablier.pdf.classer(d.html, base, f.mois, f.mois + ' ' + libelleMoisSeul(f.mois), d.nom).then(function (res) { faits.push(res); return faits; });
    });
  }, Promise.resolve([])).then(function (res) {
    var ko = res.filter(function (x) { return !x || !x.ok; })[0];
    if (ko !== undefined) { notifier('PDF non enregistrés : ' + ((ko && ko.message) || 'erreur inconnue') + '.', { type: 'erreur', duree: 9000 }); return res; }
    notifier('Facture et relevé enregistrés dans « ' + res[0].chemin.split('/').slice(-2, -1)[0] + ' ».', {
      type: 'succes', duree: 8000,
      action: { libelle: 'Afficher', fn: function () { window.sablier.fichiers.reveler(res[0].chemin); } },
    });
    return res;
  });
}

function nomFichierReleve(mois) { return 'Releve-activite-' + mois + '.pdf'; }
function nomFichierFacture(f) { return 'Facture-' + f.numero + '.pdf'; }
