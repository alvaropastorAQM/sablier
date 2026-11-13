/* ============================================================
   PAGE FACTURES ET RECETTES : factures émises, encaissements (livre des
   recettes), trimestres URSSAF.
   ============================================================ */
'use strict';

/* Les mois de travail d'une facture qui ne sont pas son mois de facturation
   (travail reporté). */
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
  /* Trésorerie : à garder pour l'URSSAF tant que le prélèvement n'est pas passé. */
  var p = r.prestataire || {}, co = r.cotisations || {};
  var treso = liste.map(function (f) { return tresorerieFacture(f, r); });
  var aVenir = treso.filter(function (t) { return t.prelevement >= ref; });
  var somme = function (l) { return arrondir2(l.reduce(function (s, t) { return s + t.cotisations; }, 0)); };
  var aGarder = somme(aVenir.filter(function (t) { return t.encaissee; }));
  var aPrevoir = somme(aVenir.filter(function (t) { return !t.encaissee; }));
  var prochain = aVenir.map(function (t) { return t.prelevement; }).sort()[0] || periodeUrssaf(ref, r).echeance;

  var html = '<div class="page-entete"><div><h2 class="page-titre">Factures et recettes</h2>'
    + '<p class="page-sous">Numérotation continue par année, paiement à ' + fmtNombre(Number(r.delaiPaiement) || 30, 0) + ' jours. Les cotisations se déclarent sur le chiffre d\'affaires encaissé, trimestre par trimestre.</p></div>'
    + '</div>';

  html += '<div class="dash-tuiles">'
    + '<div class="dash-tuile"><div class="dash-lib">Facturé</div><div class="dash-val">' + fmtEuros(totalEmis) + '</div><div class="dash-sous">' + liste.length + (liste.length > 1 ? ' factures émises' : ' facture émise') + '</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">Encaissé</div><div class="dash-val">' + fmtEuros(totalEncaisse) + '</div><div class="dash-sous">virements reçus</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">En attente</div><div class="dash-val">' + fmtEuros(totalAttendu) + '</div><div class="dash-sous">' + liste.filter(function (f) { return f.statut !== 'payee'; }).length + ' à encaisser</div></div>'
    + '<div class="dash-tuile"><div class="dash-lib">À garder pour l\'URSSAF</div><div class="dash-val">' + fmtEuros(aGarder) + '</div><div class="dash-sous">prélèvement le ' + dateFr(prochain) + (aPrevoir ? ', puis ' + fmtEuros(aPrevoir) + ' à l\'encaissement des factures en attente' : '') + '</div></div>'
    + '</div>';

  html += '<section class="card" id="facturesTableau"><h2>Factures émises</h2>';
  if (!liste.length) {
    html += '<div class="vide">Aucune facture pour l\'instant. Elles se créent depuis le relevé du mois, avec le bouton « Établir la facture ».</div>';
  } else {
    html += '<div class="tableau-defilant"><table class="tableau"><thead><tr><th>Numéro</th><th>Mois</th><th>Émise le</th><th>Échéance</th><th class="num">Heures</th><th class="num">Montant</th><th>Statut</th><th></th></tr></thead><tbody>'
      + liste.map(function (f, i) {
        var st = statutFacture(f, ref);
        var libSt = st === 'payee' ? 'payée le ' + dateFr(f.datePaiement) : (st === 'retard' ? 'en retard' : 'émise');
        var derniere = i === 0;
        var venus = moisReportesFacture(f);
        return '<tr><td><b>' + echapper(f.numero) + '</b></td><td>' + echapper(capitaliser(libelleMois(f.mois)))
          + (venus.length ? '<div class="sec">dont travaux ' + echapper(venus.map(deLibelleMois).join(', ')) + '</div>' : '') + '</td>'
          + '<td class="num">' + dateFr(f.dateEmission) + '</td><td class="num">' + dateFr(f.dateEcheance) + '</td>'
          + '<td class="num">' + fmtHeuresDec(f.minutesFacturees) + '</td><td class="num"><b>' + fmtEuros(f.total) + '</b></td>'
          + '<td><span class="fa-statut ' + st + '">' + echapper(libSt) + '</span></td>'
          + '<td><div class="actions" style="gap:4px; justify-content:flex-end;">'
          + boutonIcone('pdf', 'document', 'PDF de la facture', '', f.id)
          + (st === 'payee' ? boutonIcone('impayee', 'haut', 'Annuler l\'encaissement', '', f.id) : boutonIcone('payee', 'coche', 'Marquer payée', '', f.id))
          + boutonIcone('releve', 'chrono', 'Voir le relevé du mois', '', f.id).replace('data-action="releve"', 'data-action="releve" data-mois="' + f.mois + '"')
          + (derniere && st !== 'payee' ? boutonIcone('supprimer', 'corbeille', 'Supprimer (dernière facture uniquement)', 'danger', f.id) : '')
          + '</div></td></tr>';
      }).join('')
      + '</tbody></table></div>';
  }
  html += '</section>';

  /* Trésorerie par facture : écran seulement, jamais sur les PDF. */
  if (treso.length) {
    html += '<section class="card"><h2>Trésorerie et provision URSSAF</h2>'
      + '<p class="desc">Pour chaque facture : ce qu\'il faut laisser sur le compte ' + echapper(p.banque || 'professionnel') + ' jusqu\'au prélèvement de l\'URSSAF, ce qui reste vraiment, et le revenu imposable estimé après l\'abattement forfaitaire de ' + ABATTEMENT_BNC + ' % du régime micro-BNC. Une facture en attente est comptée à sa date d\'échéance de paiement.</p>'
      + '<div class="tableau-defilant"><table class="tableau"><thead><tr><th>Facture</th><th>Encaissement</th><th class="num">Chiffre d\'affaires HT</th><th class="num">À garder pour l\'URSSAF</th><th>Prélèvement le</th><th class="num">Revenu net disponible</th><th class="num">Imposable estimé (' + (100 - ABATTEMENT_BNC) + ' %)</th></tr></thead><tbody>'
      + treso.map(function (t) {
        return '<tr><td><b>' + echapper(t.numero) + '</b></td><td>' + (t.encaissee ? 'le ' + dateFr(t.date) : '<span class="sec">attendu le ' + dateFr(t.date) + '</span>') + '<div class="sec">' + echapper(t.trimestre) + '</div></td>'
          + '<td class="num">' + fmtEuros(t.ca) + '</td><td class="num"><b>' + fmtEuros(t.cotisations) + '</b><div class="sec">à ' + fmtNombre(t.taux, 1) + ' %</div></td>'
          + '<td class="num">' + dateFr(t.prelevement) + '</td><td class="num">' + fmtEuros(t.net) + '</td><td class="num">' + fmtEuros(t.imposable) + '<div class="sec">abattement de ' + fmtEuros(t.abattement) + '</div></td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  /* Livre des recettes */
  var recettes = trierPar(factures().filter(function (f) { return f.statut === 'payee' && f.datePaiement; }), 'datePaiement', true);
  html += '<section class="card"><div class="card-entete"><h2>Livre des recettes</h2>' + (recettes.length ? '<button class="btn btn-ghost btn-petit" data-action="csv-recettes">Exporter en CSV…</button>' : '') + '</div>'
    + '<p class="desc">Chaque encaissement, dans l\'ordre chronologique : date, référence de la facture, client, montant, mode de règlement.</p>';
  if (!recettes.length) html += '<div class="vide">Aucun encaissement enregistré.</div>';
  else html += '<div class="tableau-defilant"><table class="tableau"><thead><tr><th>Date</th><th>Référence</th><th>Client</th><th>Nature</th><th class="num">Montant</th><th>Mode</th></tr></thead><tbody>'
    + recettes.map(function (f) {
      return '<tr><td class="num">' + dateFr(f.datePaiement) + '</td><td>Facture ' + echapper(f.numero) + '</td><td>' + echapper((f.client || r.client).societe) + '</td><td class="sec">Prestation ' + echapper(libelleMois(f.mois)) + '</td><td class="num"><b>' + fmtEuros(f.total) + '</b></td><td>' + echapper(f.modePaiement || 'virement') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  html += '</section>';

  /* Trimestres URSSAF */
  var trimestres = recettesParTrimestre(factures(), r, ref);
  var declares = r.ui.trimestresDeclares || {};
  html += '<section class="card"><h2>Déclarations URSSAF par trimestre</h2>'
    + '<p class="desc">Début d\'activité le ' + dateFr(co.debutActivite || r.contrat.debut) + ', micro-entreprise BNC' + (p.ape ? ' (APE ' + echapper(p.ape) + ')' : '') + ', franchise en base de TVA, sans versement libératoire de l\'impôt. Chiffre d\'affaires encaissé par trimestre civil, déclaré et prélevé à la fin du mois suivant. Cotisations et formation professionnelle estimées à ' + fmtNombre(co.tauxAcre, 1) + ' % jusqu\'au ' + dateFr(co.finAcre) + ' (ACRE), puis ' + fmtNombre(co.tauxPlein, 1) + ' %. Cochez « Déclaré » une fois la déclaration faite.</p>'
    + '<div class="tableau-defilant"><table class="tableau"><thead><tr><th>Trimestre</th><th>Période</th><th class="num">Encaissé</th><th class="num">Taux</th><th class="num">Cotisations estimées</th><th class="num">Net estimé</th><th class="num">Imposable estimé</th><th>Déclaration et prélèvement le</th><th>État</th><th>Déclaré</th></tr></thead><tbody>'
    + trimestres.map(function (t) {
      var fait = declares[t.cle];
      var etat = fait ? '<span class="fa-statut payee">déclaré le ' + dateFr(fait) + '</span>' : (t.aDeclarer ? '<span class="fa-statut emise">à déclarer</span>' : (t.enCours ? '<span class="fa-statut payee">en cours</span>' : (ref > t.echeance ? '<span class="puce neutre">passé</span>' : '<span class="puce neutre">à venir</span>')));
      return '<tr class="fa-trimestre' + (t.enCours ? ' actif' : '') + '"><td><b>' + echapper(t.libelle) + '</b></td><td class="sec">' + dateFr(t.debut) + ' au ' + dateFr(t.fin) + '</td><td class="num">' + fmtEuros(t.encaisse) + '</td><td class="num">' + fmtNombre(t.taux, 1) + ' %</td><td class="num">' + fmtEuros(t.cotisations) + '</td><td class="num">' + fmtEuros(t.net) + '</td><td class="num">' + fmtEuros(t.imposable) + '</td><td class="num">' + dateFr(t.echeance) + (t.premiere ? '<div class="sec">1re déclaration</div>' : '') + '</td><td>' + etat + '</td>'
        + '<td><input type="checkbox" data-trimestre="' + echapper(t.cle) + '"' + (fait ? ' checked' : '') + (t.enCours ? ' disabled title="Trimestre en cours"' : '') + '></td></tr>';
    }).join('') + '</tbody></table></div>'
    + '<p class="hint">Estimation indicative : le montant exact est calculé par l\'URSSAF au moment de la déclaration. La première déclaration regroupe le trimestre du début d\'activité et le suivant ; le prélèvement a lieu à la date limite de déclaration.</p>'
    + '</section>';

  document.getElementById('facturesContenu').innerHTML = html;
}

/* Cotisations URSSAF des factures dont le prélèvement n'est pas encore
   passé, regroupées par date de prélèvement (tableau de bord). */
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
  demander({ titre: 'Encaissement de la facture n° ' + f.numero, texte: 'Date de réception du virement (' + fmtEuros(f.total) + ').', libelle: 'Date d\'encaissement', type: 'date', valeur: aujourdhui(), ok: 'Marquer payée' }).then(function (d) {
    if (d == null) return;
    if (!d || !dateValide(d)) { notifier('Indiquez la date de réception du virement.', { type: 'erreur' }); return; }
    if (f.dateEmission && d < f.dateEmission) { notifier('La date d\'encaissement précède l\'émission de la facture (' + dateFr(f.dateEmission) + ').', { type: 'erreur' }); return; }
    f.statut = 'payee';
    f.datePaiement = d;
    f.modePaiement = 'virement';
    sauver('factures');
    rafraichir();
    notifier('Facture n° ' + f.numero + ' encaissée le ' + dateFr(d) + '.', { type: 'succes' });
  });
}

function marquerImpayee(id) {
  var f = factureParId(id);
  if (!f) return;
  confirmer('Annuler l\'encaissement de la facture n° ' + f.numero + ' ? Elle repassera en attente de paiement.', { ok: 'Annuler l\'encaissement' }).then(function (ok) {
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
  if (f.statut === 'payee') { notifier('Une facture encaissée ne se supprime pas : sa recette compte pour l\'URSSAF. Si l\'encaissement est une erreur, annulez-le d\'abord.', { type: 'erreur', duree: 7000 }); return; }
  var derniere = trierPar(factures(), function (x) { return x.dateEmission + x.numero; }, true)[0];
  if (!derniere || derniere.id !== f.id) { notifier('Seule la dernière facture émise peut être supprimée.', { type: 'erreur' }); return; }
  confirmer('Supprimer la facture n° ' + f.numero + ' (' + fmtEuros(f.total) + ') ? À ne faire que si elle n\'a pas été envoyée : une facture transmise s\'annule par un avoir, jamais par suppression.', { ok: 'Supprimer', danger: true, titre: 'Supprimer la dernière facture' }).then(function (ok) {
    if (!ok) return;
    ETAT.factures.factures = factures().filter(function (x) { return x.id !== f.id; });
    sauver('factures');
    rafraichir();
    notifier('Facture n° ' + f.numero + ' supprimée.');
  });
}

function exporterRecettesCsv() {
  var r = ETAT.reglages;
  var lignes = [['Date', 'Référence', 'Client', 'Nature', 'Montant', 'Mode']];
  trierPar(factures().filter(function (f) { return f.statut === 'payee' && f.datePaiement; }), 'datePaiement').forEach(function (f) {
    lignes.push([dateFr(f.datePaiement), 'Facture ' + f.numero, (f.client || r.client).societe, 'Prestation ' + libelleMois(f.mois), fmtNombreSaisie(f.total, 2), f.modePaiement || 'virement']);
  });
  var csv = lignes.map(function (l) { return l.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\n');
  exporterTexte('livre-des-recettes.csv', '﻿' + csv);
}

function exporterTexte(nomFichier, contenu) {
  if (estApp()) {
    window.sablier.fichiers.exporterTexte(nomFichier, contenu).then(function (res) {
      if (res && res.ok) notifier('Fichier enregistré : ' + res.chemin.split('/').pop(), { type: 'succes', action: { libelle: 'Afficher dans le Finder', fn: function () { window.sablier.fichiers.reveler(res.chemin); } } });
    });
  } else {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contenu], { type: 'text/plain;charset=utf-8' }));
    a.download = nomFichier;
    a.click();
  }
}
