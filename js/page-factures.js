/* ============================================================
   INVOICES AND INCOME PAGE: issued invoices, payments (income ledger),
   VAT and IRPF quarters.
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
  var totalBase = 0, totalEncaisse = 0, totalAttendu = 0;
  liste.forEach(function (f) { totalBase += baseFacture(f); if (f.statut === 'payee') totalEncaisse += f.total; else totalAttendu += f.total; });
  var treso = liste.map(tresorerieFacture);
  var trimestres = trimestresFiscaux(factures(), r, ref);
  var declares = r.ui.trimestresDeclares || {};
  var aVenir = impotsAVenir(ref);

  var html = '<div class="page-entete"><div><h2 class="page-titre">Invoices and income</h2>'
    + '<p class="page-sous">Numbering runs continuously within each year, payment within ' + fmtNombre(Number(r.delaiPaiement) || 30, 0) + ' days. VAT and the IRPF instalment are declared quarter by quarter, on the invoices issued.</p></div>'
    + '</div>';

  html += '<div class="dash-tuiles">'
    + '<div class="dash-tuile"><div class="dash-lib">Invoiced</div><div class="dash-val">' + fmtEuros(arrondir2(totalBase)) + '</div><div class="dash-sous">excl. VAT, ' + liste.length + (liste.length > 1 ? ' invoices issued' : ' invoice issued') + '</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">Paid</div><div class="dash-val">' + fmtEuros(arrondir2(totalEncaisse)) + '</div><div class="dash-sous">transfers received</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">Pending</div><div class="dash-val">' + fmtEuros(arrondir2(totalAttendu)) + '</div><div class="dash-sous">' + liste.filter(function (f) { return f.statut !== 'payee'; }).length + ' to collect</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">To set aside for taxes</div><div class="dash-val">' + fmtEuros(aVenir.length ? aVenir[0].aMettreDeCote : 0) + '</div><div class="dash-sous">' + texteImpotsAVenir(aVenir) + '</div></div>'
    + '</div>';

  html += '<section class="card" id="facturesTableau"><h2>Issued invoices</h2>';
  if (!liste.length) {
    html += '<div class="vide">No invoices yet. They are created from the month\'s statement, with the "Create the invoice" button.</div>';
  } else {
    html += '<div class="tableau-defilant"><table class="tableau"><thead><tr><th>Number</th><th>Month</th><th>Issued on</th><th>Due date</th><th class="num">Hours</th><th class="num">Excl. VAT</th><th class="num">Total due</th><th>Status</th><th></th></tr></thead><tbody>'
      + liste.map(function (f, i) {
        var st = statutFacture(f, ref);
        var libSt = st === 'payee' ? 'paid on ' + dateFr(f.datePaiement) : (st === 'retard' ? 'overdue' : 'issued');
        var derniere = i === 0;
        var venus = moisReportesFacture(f);
        return '<tr><td><b>' + echapper(f.numero) + '</b></td><td>' + echapper(capitaliser(libelleMois(f.mois)))
          + (venus.length ? '<div class="sec">including work from ' + echapper(venus.map(function (m) { return libelleMois(m); }).join(', ')) + '</div>' : '') + '</td>'
          + '<td class="num">' + dateFr(f.dateEmission) + '</td><td class="num">' + dateFr(f.dateEcheance) + '</td>'
          + '<td class="num">' + fmtHeuresDec(f.minutesFacturees) + '</td><td class="num">' + fmtEuros(baseFacture(f)) + '</td><td class="num"><b>' + fmtEuros(f.total) + '</b></td>'
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
    html += '<section class="card"><h2>What each invoice leaves</h2>'
      + '<p class="desc">For each invoice: the taxable base, the VAT you collect for the tax office (keep it until the model 303 of its quarter), the IRPF the client withholds and pays on your behalf, and what reaches your account.</p>'
      + '<div class="tableau-defilant"><table class="tableau"><thead><tr><th>Invoice</th><th>Quarter</th><th class="num">Excl. VAT</th><th class="num">VAT to set aside</th><th>Until</th><th class="num">IRPF withheld</th><th class="num">Transferred</th></tr></thead><tbody>'
      + treso.map(function (t) {
        return '<tr><td><b>' + echapper(t.numero) + '</b></td><td>' + echapper(t.trimestre) + '</td>'
          + '<td class="num">' + fmtEuros(t.base) + '</td><td class="num"><b>' + fmtEuros(t.tva) + '</b></td><td class="num">' + dateFr(t.echeance) + '</td>'
          + '<td class="num">' + fmtEuros(t.irpf) + '</td><td class="num">' + fmtEuros(t.total) + (t.encaissee ? '' : '<div class="sec">pending</div>') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  /* Income ledger */
  var recettes = trierPar(factures().filter(function (f) { return f.statut === 'payee' && f.datePaiement; }), 'datePaiement', true);
  html += '<section class="card"><div class="card-entete"><h2>Income ledger</h2>' + (recettes.length ? '<button class="btn btn-ghost btn-petit" data-action="csv-recettes">Export as CSV…</button>' : '') + '</div>'
    + '<p class="desc">Each payment, in chronological order: date, invoice reference, client, amount, payment method.</p>';
  if (!recettes.length) html += '<div class="vide">No payments recorded.</div>';
  else html += '<div class="tableau-defilant"><table class="tableau"><thead><tr><th>Date</th><th>Reference</th><th>Client</th><th>Description</th><th class="num">Amount</th><th>Method</th></tr></thead><tbody>'
    + recettes.map(function (f) {
      return '<tr><td class="num">' + dateFr(f.datePaiement) + '</td><td>Invoice ' + echapper(f.numero) + '</td><td>' + echapper((f.client || r.client).societe) + '</td><td class="sec">Services ' + echapper(libelleMois(f.mois)) + '</td><td class="num"><b>' + fmtEuros(f.total) + '</b></td><td>' + echapper(libelleModePaiement(f)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  html += '</section>';

  /* VAT and IRPF quarters */
  html += '<section class="card"><h2>VAT and IRPF by quarter</h2>'
    + '<p class="desc">Invoices count on their issue date, paid or not. Model 303 is filed from the 1st to the 20th of the month after the quarter (the fourth quarter until 30 January), even with nothing to declare; the VAT on your own business expenses is deductible there and is not counted here. Model 130 is only due when less than 70% of your income has IRPF withheld: Sablier then estimates it, with the autónomo fees as the only expense. Tick "Filed" once the returns are done.</p>'
    + '<div class="tableau-defilant"><table class="tableau"><thead><tr><th>Quarter</th><th>Period</th><th class="num">Invoiced excl. VAT</th><th class="num">VAT (303)</th><th class="num">IRPF withheld</th><th class="num">Autónomo fees</th><th class="num">Model 130</th><th>Deadline</th><th>Status</th><th>Filed</th></tr></thead><tbody>'
    + trimestres.map(function (t) {
      var fait = declares[t.cle];
      var etat = fait ? '<span class="fa-statut payee">filed on ' + dateFr(fait) + '</span>' : (t.aDeclarer ? '<span class="fa-statut emise">to file</span>' : (t.enCours ? '<span class="fa-statut payee">in progress</span>' : (ref > t.echeance ? '<span class="puce neutre">past</span>' : '<span class="puce neutre">upcoming</span>')));
      var modele130 = t.obligation130 ? fmtEuros(t.paiement130) : 'not due';
      if (t.partRetenue != null) modele130 += '<div class="sec">' + fmtNombre(t.partRetenue, 0) + '% of the year withheld</div>';
      return '<tr class="fa-trimestre' + (t.enCours ? ' actif' : '') + '"><td><b>' + echapper(t.libelle) + '</b></td><td class="sec">' + dateFr(t.debut) + ' to ' + dateFr(t.fin) + '</td><td class="num">' + fmtEuros(t.base) + '</td><td class="num"><b>' + fmtEuros(t.tva) + '</b></td><td class="num">' + fmtEuros(t.irpf) + '</td><td class="num">' + fmtEuros(t.cotisations) + '</td><td class="num">' + modele130 + '</td><td class="num">' + dateFr(t.echeance) + '</td><td>' + etat + '</td>'
        + '<td><input type="checkbox" data-trimestre="' + echapper(t.cle) + '"' + (fait ? ' checked' : '') + (t.enCours ? ' disabled title="Current quarter"' : '') + '></td></tr>';
    }).join('') + '</tbody></table></div>'
    + '<p class="hint">Indicative estimate: the tax office calculates the exact amounts on the returns.</p>'
    + '</section>';

  document.getElementById('facturesContenu').innerHTML = html;
}

/* The quarters not filed yet whose deadline has not passed and that leave
   something to pay (VAT, model 130), nearest deadline first (dashboard). */
function impotsAVenir(ref) {
  var declares = ETAT.reglages.ui.trimestresDeclares || {};
  return trimestresFiscaux(factures(), ETAT.reglages, ref).filter(function (t) { return !declares[t.cle] && t.echeance >= ref && t.aMettreDeCote > 0; });
}

/* The sentence under the "To set aside for taxes" tiles. */
function texteImpotsAVenir(aVenir) {
  if (!aVenir.length) return 'nothing to set aside for now';
  var t = aVenir[0];
  return (t.paiement130 ? 'models 303 and 130' : 'model 303') + ' for ' + t.libelle + ', due by ' + dateFr(t.echeance)
    + (aVenir.length > 1 ? ' · then ' + aVenir.slice(1).map(function (x) { return fmtEuros(x.aMettreDeCote) + ' by ' + dateFr(x.echeance); }).join(', ') : '');
}

/* How a payment arrived; invoices store "virement" (bank transfer). */
function libelleModePaiement(f) {
  return !f.modePaiement || f.modePaiement === 'virement' ? 'Bank transfer' : f.modePaiement;
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
  if (f.statut === 'payee') { notifier('A paid invoice cannot be deleted. If the payment is a mistake, undo it first.', { type: 'erreur', duree: 7000 }); return; }
  var derniere = trierPar(factures(), function (x) { return x.dateEmission + x.numero; }, true)[0];
  if (!derniere || derniere.id !== f.id) { notifier('Only the latest issued invoice can be deleted.', { type: 'erreur' }); return; }
  confirmer('Delete invoice no. ' + f.numero + ' (' + fmtEuros(f.total) + ')? Only do this if it has not been sent: an invoice that has been sent is cancelled with a corrective invoice (factura rectificativa), never by deletion.', { ok: 'Delete', danger: true, titre: 'Delete the latest invoice' }).then(function (ok) {
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
    lignes.push([dateFr(f.datePaiement), 'Invoice ' + f.numero, (f.client || r.client).societe, 'Services ' + libelleMois(f.mois), fmtNombreSaisie(f.total, 2), libelleModePaiement(f)]);
  });
  var csv = lignes.map(function (l) { return l.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\n');
  exporterTexte('income-ledger.csv', '﻿' + csv);
}

function exporterTexte(nomFichier, contenu) {
  if (estApp()) {
    window.sablier.fichiers.exporterTexte(nomFichier, contenu).then(function (res) {
      if (res && res.ok) notifier('File saved: ' + partiesChemin(res.chemin).pop(), { type: 'succes', action: { libelle: 'Show in file manager', fn: function () { window.sablier.fichiers.reveler(res.chemin); } } });
    });
  } else {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contenu], { type: 'text/plain;charset=utf-8' }));
    a.download = nomFichier;
    a.click();
  }
}
