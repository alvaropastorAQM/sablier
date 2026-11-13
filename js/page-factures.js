/* ============================================================
   INVOICES AND INCOME PAGE: issued invoices, payments (income ledger),
   URSSAF quarters.
   ============================================================ */
'use strict';

/* The work months of an invoice that are not its billing month (work
   moved to another month). */
function moisReportesFacture(f) {
  var out = [];
  (f.lignes || []).forEach(function (l) {
    var m = moisDe(l.date);
    if (m && m !== f.mois && out.indexOf(m) < 0) out.push(m);
  });
  return out.sort();
}

function initFactures() {
  PAGES.factures = rendreFactures;
  document.getElementById('facturesContenu').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-action]');
    if (!b) return;
    var a = b.dataset.action, id = b.dataset.id;
    if (a === 'pdf') exporterFacturePdf(id);
    else if (a === 'payee') marquerPayee(id);
    else if (a === 'impayee') marquerImpayee(id);
    else if (a === 'supprimer') supprimerFacture(id);
    else if (a === 'releve') { RELEVE_MOIS = b.dataset.mois; afficherPage('releve'); }
    else if (a === 'csv-recettes') exporterRecettesCsv();
  });
  document.getElementById('facturesContenu').addEventListener('change', function (ev) {
    if (ev.target.matches('input[type=checkbox][data-trimestre]')) {
      var ui = ETAT.reglages.ui;
      if (!ui.trimestresDeclares) ui.trimestresDeclares = {};
      if (ev.target.checked) ui.trimestresDeclares[ev.target.dataset.trimestre] = aujourdhui();
      else delete ui.trimestresDeclares[ev.target.dataset.trimestre];
      sauver('reglages');
      rendreFactures();
    }
  });
}

function factureParId(id) { return factures().filter(function (f) { return f.id === id; })[0] || null; }

function rendreFactures() {
  var r = ETAT.reglages;
  var ref = aujourdhui();
  var liste = trierPar(factures(), function (f) { return f.dateEmission + f.numero; }, true);
  var totalEmis = 0, totalEncaisse = 0, totalAttendu = 0;
  liste.forEach(function (f) { totalEmis += f.total; if (f.statut === 'payee') totalEncaisse += f.total; else totalAttendu += f.total; });
  /* Cash position: to set aside for URSSAF until the direct debit has gone through. */
  var p = r.prestataire || {}, co = r.cotisations || {};
  var treso = liste.map(function (f) { return tresorerieFacture(f, r); });
  var aVenir = treso.filter(function (t) { return t.prelevement >= ref; });
  var somme = function (l) { return arrondir2(l.reduce(function (s, t) { return s + t.cotisations; }, 0)); };
  var aGarder = somme(aVenir.filter(function (t) { return t.encaissee; }));
  var aPrevoir = somme(aVenir.filter(function (t) { return !t.encaissee; }));
  var prochain = aVenir.map(function (t) { return t.prelevement; }).sort()[0] || periodeUrssaf(ref, r).echeance;

  var html = '<div class="page-entete"><div><h2 class="page-titre">Invoices and income</h2>'
    + '<p class="page-sous">Numbering runs continuously within each year, payment within ' + fmtNombre(Number(r.delaiPaiement) || 30, 0) + ' days. Social contributions are declared on the revenue collected, quarter by quarter.</p></div>'
    + '</div>';

  html += '<div class="dash-tuiles">'
    + '<div class="dash-tuile"><div class="dash-lib">Invoiced</div><div class="dash-val">' + fmtEuros(totalEmis) + '</div><div class="dash-sous">' + liste.length + (liste.length > 1 ? ' invoices issued' : ' invoice issued') + '</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">Paid</div><div class="dash-val">' + fmtEuros(totalEncaisse) + '</div><div class="dash-sous">transfers received</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">Pending</div><div class="dash-val">' + fmtEuros(totalAttendu) + '</div><div class="dash-sous">' + liste.filter(function (f) { return f.statut !== 'payee'; }).length + ' to collect</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">To set aside for URSSAF</div><div class="dash-val">' + fmtEuros(aGarder) + '</div><div class="dash-sous">direct debit on ' + dateFr(prochain) + (aPrevoir ? ', then ' + fmtEuros(aPrevoir) + ' when the pending invoices are paid' : '') + '</div></div>'
    + '</div>';

  html += '<section class="card" id="facturesTableau"><h2>Issued invoices</h2>';
  if (!liste.length) {
    html += '<div class="vide">No invoices yet. They are created from the month\'s statement, with the "Create the invoice" button.</div>';
  } else {
    html += '<div class="tableau-defilant"><table class="tableau"><thead><tr><th>Number</th><th>Month</th><th>Issued on</th><th>Due date</th><th class="num">Hours</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead><tbody>'
      + liste.map(function (f, i) {
        var st = statutFacture(f, ref);
        var libSt = st === 'payee' ? 'paid on ' + dateFr(f.datePaiement) : (st === 'retard' ? 'overdue' : 'issued');
        var derniere = i === 0;
        var venus = moisReportesFacture(f);
        return '<tr><td><b>' + echapper(f.numero) + '</b></td><td>' + echapper(capitaliser(libelleMois(f.mois)))
          + (venus.length ? '<div class="sec">including work from ' + echapper(venus.map(function (m) { return libelleMois(m); }).join(', ')) + '</div>' : '') + '</td>'
          + '<td class="num">' + dateFr(f.dateEmission) + '</td><td class="num">' + dateFr(f.dateEcheance) + '</td>'
          + '<td class="num">' + fmtHeuresDec(f.minutesFacturees) + '</td><td class="num"><b>' + fmtEuros(f.total) + '</b></td>'
          + '<td><span class="fa-statut ' + st + '">' + echapper(libSt) + '</span></td>'
          + '<td><div class="actions" style="gap:4px; justify-content:flex-end;">'
          + boutonIcone('pdf', 'document', 'Invoice PDF', '', f.id)
          + (st === 'payee' ? boutonIcone('impayee', 'haut', 'Undo payment', '', f.id) : boutonIcone('payee', 'coche', 'Mark as paid', '', f.id))
          + boutonIcone('releve', 'chrono', 'View the month\'s statement', '', f.id).replace('data-action="releve"', 'data-action="releve" data-mois="' + f.mois + '"')
          + (derniere && st !== 'payee' ? boutonIcone('supprimer', 'corbeille', 'Delete (latest invoice only)', 'danger', f.id) : '')
          + '</div></td></tr>';
      }).join('')
      + '</tbody></table></div>';
  }
  html += '</section>';

  /* Cash position per invoice: on screen only, never on the PDFs. */
  if (treso.length) {
    html += '<section class="card"><h2>Cash position and URSSAF provision</h2>'
      + '<p class="desc">For each invoice: what to leave in the ' + echapper(p.banque || 'business') + ' account until the URSSAF direct debit, what is really left, and the estimated taxable income after the flat ' + ABATTEMENT_BNC + '% allowance of the micro-BNC regime. A pending invoice is counted at its payment due date.</p>'
      + '<div class="tableau-defilant"><table class="tableau"><thead><tr><th>Invoice</th><th>Payment</th><th class="num">Revenue excl. tax</th><th class="num">To set aside for URSSAF</th><th>Direct debit on</th><th class="num">Net income available</th><th class="num">Estimated taxable (' + (100 - ABATTEMENT_BNC) + '%)</th></tr></thead><tbody>'
      + treso.map(function (t) {
        return '<tr><td><b>' + echapper(t.numero) + '</b></td><td>' + (t.encaissee ? 'on ' + dateFr(t.date) : '<span class="sec">expected on ' + dateFr(t.date) + '</span>') + '<div class="sec">' + echapper(t.trimestre) + '</div></td>'
          + '<td class="num">' + fmtEuros(t.ca) + '</td><td class="num"><b>' + fmtEuros(t.cotisations) + '</b><div class="sec">at ' + fmtNombre(t.taux, 1) + '%</div></td>'
          + '<td class="num">' + dateFr(t.prelevement) + '</td><td class="num">' + fmtEuros(t.net) + '</td><td class="num">' + fmtEuros(t.imposable) + '<div class="sec">allowance of ' + fmtEuros(t.abattement) + '</div></td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  /* Income ledger */
  var recettes = trierPar(factures().filter(function (f) { return f.statut === 'payee' && f.datePaiement; }), 'datePaiement', true);
  html += '<section class="card"><div class="card-entete"><h2>Income ledger</h2>' + (recettes.length ? '<button class="btn btn-ghost btn-petit" data-action="csv-recettes">Export as CSV…</button>' : '') + '</div>'
    + '<p class="desc">Each payment, in chronological order: date, invoice reference, client, amount, payment method.</p>';
  if (!recettes.length) html += '<div class="vide">No payments recorded.</div>';
  else html += '<div class="tableau-defilant"><table class="tableau"><thead><tr><th>Date</th><th>Reference</th><th>Client</th><th>Description</th><th class="num">Amount</th><th>Method</th></tr></thead><tbody>'
    + recettes.map(function (f) {
      return '<tr><td class="num">' + dateFr(f.datePaiement) + '</td><td>Invoice ' + echapper(f.numero) + '</td><td>' + echapper((f.client || r.client).societe) + '</td><td class="sec">Services ' + echapper(libelleMois(f.mois)) + '</td><td class="num"><b>' + fmtEuros(f.total) + '</b></td><td>' + echapper(f.modePaiement || 'virement') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  html += '</section>';

  /* URSSAF quarters */
  var trimestres = recettesParTrimestre(factures(), r, ref);
  var declares = r.ui.trimestresDeclares || {};
  html += '<section class="card"><h2>URSSAF declarations by quarter</h2>'
    + '<p class="desc">Activity started on ' + dateFr(co.debutActivite || r.contrat.debut) + ', micro-entreprise BNC' + (p.ape ? ' (APE ' + echapper(p.ape) + ')' : '') + ', VAT exemption, no flat-rate income tax payment. Revenue collected per calendar quarter, declared and debited at the end of the following month. Contributions and vocational training estimated at ' + fmtNombre(co.tauxAcre, 1) + '% until ' + dateFr(co.finAcre) + ' (ACRE), then ' + fmtNombre(co.tauxPlein, 1) + '%. Tick "Declared" once the declaration is done.</p>'
    + '<div class="tableau-defilant"><table class="tableau"><thead><tr><th>Quarter</th><th>Period</th><th class="num">Collected</th><th class="num">Rate</th><th class="num">Estimated contributions</th><th class="num">Estimated net</th><th class="num">Estimated taxable</th><th>Declaration and direct debit on</th><th>Status</th><th>Declared</th></tr></thead><tbody>'
    + trimestres.map(function (t) {
      var fait = declares[t.cle];
      var etat = fait ? '<span class="fa-statut payee">declared on ' + dateFr(fait) + '</span>' : (t.aDeclarer ? '<span class="fa-statut emise">to declare</span>' : (t.enCours ? '<span class="fa-statut payee">in progress</span>' : (ref > t.echeance ? '<span class="puce neutre">past</span>' : '<span class="puce neutre">upcoming</span>')));
      return '<tr class="fa-trimestre' + (t.enCours ? ' actif' : '') + '"><td><b>' + echapper(t.libelle) + '</b></td><td class="sec">' + dateFr(t.debut) + ' to ' + dateFr(t.fin) + '</td><td class="num">' + fmtEuros(t.encaisse) + '</td><td class="num">' + fmtNombre(t.taux, 1) + '%</td><td class="num">' + fmtEuros(t.cotisations) + '</td><td class="num">' + fmtEuros(t.net) + '</td><td class="num">' + fmtEuros(t.imposable) + '</td><td class="num">' + dateFr(t.echeance) + (t.premiere ? '<div class="sec">1st declaration</div>' : '') + '</td><td>' + etat + '</td>'
        + '<td><input type="checkbox" data-trimestre="' + echapper(t.cle) + '"' + (fait ? ' checked' : '') + (t.enCours ? ' disabled title="Current quarter"' : '') + '></td></tr>';
    }).join('') + '</tbody></table></div>'
    + '<p class="hint">Indicative estimate: URSSAF calculates the exact amount when the declaration is made. The first declaration covers the quarter in which the activity started and the next one; the direct debit takes place on the declaration deadline.</p>'
    + '</section>';

  document.getElementById('facturesContenu').innerHTML = html;
}

/* URSSAF contributions of the invoices whose direct debit has not gone
   through yet, grouped by debit date (dashboard). */
function cotisationsAVenir(ref) {
  var parDate = {};
  factures().forEach(function (f) {
    var t = tresorerieFacture(f, ETAT.reglages);
    if (t.prelevement < ref) return;
    var d = parDate[t.prelevement] || (parDate[t.prelevement] = { date: t.prelevement, montant: 0, enAttente: 0 });
    d.montant = arrondir2(d.montant + t.cotisations);
    if (!t.encaissee) d.enAttente = arrondir2(d.enAttente + t.cotisations);
  });
  return trierPar(Object.keys(parDate).map(function (k) { return parDate[k]; }), 'date');
}

function exporterFacturePdf(id) {
  var f = factureParId(id);
  if (!f) return;
  return enregistrerPdfFacture(f, htmlReleveDuMois(f.mois));
}

function marquerPayee(id) {
  var f = factureParId(id);
  if (!f) return;
  demander({ titre: 'Payment of invoice no. ' + f.numero, texte: 'Date the transfer was received (' + fmtEuros(f.total) + ').', libelle: 'Payment date', type: 'date', valeur: aujourdhui(), ok: 'Mark as paid' }).then(function (d) {
    if (d == null) return;
    if (!d || !dateValide(d)) { notifier('Enter the date the transfer was received.', { type: 'erreur' }); return; }
    if (f.dateEmission && d < f.dateEmission) { notifier('The payment date is before the invoice was issued (' + dateFr(f.dateEmission) + ').', { type: 'erreur' }); return; }
    f.statut = 'payee';
    f.datePaiement = d;
    f.modePaiement = 'virement';
    sauver('factures');
    rafraichir();
    notifier('Invoice no. ' + f.numero + ' paid on ' + dateFr(d) + '.', { type: 'succes' });
  });
}

function marquerImpayee(id) {
  var f = factureParId(id);
  if (!f) return;
  confirmer('Undo the payment of invoice no. ' + f.numero + '? It will go back to awaiting payment.', { ok: 'Undo payment' }).then(function (ok) {
    if (!ok) return;
    f.statut = 'emise';
    f.datePaiement = null;
    sauver('factures');
    rafraichir();
  });
}

function supprimerFacture(id) {
  var f = factureParId(id);
  if (!f) return;
  if (f.statut === 'payee') { notifier('A paid invoice cannot be deleted: its income counts for URSSAF. If the payment is a mistake, undo it first.', { type: 'erreur', duree: 7000 }); return; }
  var derniere = trierPar(factures(), function (x) { return x.dateEmission + x.numero; }, true)[0];
  if (!derniere || derniere.id !== f.id) { notifier('Only the latest issued invoice can be deleted.', { type: 'erreur' }); return; }
  confirmer('Delete invoice no. ' + f.numero + ' (' + fmtEuros(f.total) + ')? Only do this if it has not been sent: an invoice that has been sent is cancelled with a credit note, never by deletion.', { ok: 'Delete', danger: true, titre: 'Delete the latest invoice' }).then(function (ok) {
    if (!ok) return;
    ETAT.factures.factures = factures().filter(function (x) { return x.id !== f.id; });
    sauver('factures');
    rafraichir();
    notifier('Invoice no. ' + f.numero + ' deleted.');
  });
}

function exporterRecettesCsv() {
  var r = ETAT.reglages;
  var lignes = [['Date', 'Reference', 'Client', 'Description', 'Amount', 'Method']];
  trierPar(factures().filter(function (f) { return f.statut === 'payee' && f.datePaiement; }), 'datePaiement').forEach(function (f) {
    lignes.push([dateFr(f.datePaiement), 'Invoice ' + f.numero, (f.client || r.client).societe, 'Services ' + libelleMois(f.mois), fmtNombreSaisie(f.total, 2), f.modePaiement || 'virement']);
  });
  var csv = lignes.map(function (l) { return l.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\n');
  exporterTexte('income-ledger.csv', '﻿' + csv);
}

function exporterTexte(nomFichier, contenu) {
  if (estApp()) {
    window.sablier.fichiers.exporterTexte(nomFichier, contenu).then(function (res) {
      if (res && res.ok) notifier('File saved: ' + res.chemin.split('/').pop(), { type: 'succes', action: { libelle: 'Show in file manager', fn: function () { window.sablier.fichiers.reveler(res.chemin); } } });
    });
  } else {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contenu], { type: 'text/plain;charset=utf-8' }));
    a.download = nomFichier;
    a.click();
  }
}
