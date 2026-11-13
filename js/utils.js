/* ============================================================
   UTILITAIRES : dates, durées, formats, petites fonctions.
   Aucune dépendance au DOM : ce fichier est aussi chargé par les
   tests node (module.exports en fin de fichier).
   ============================================================ */
'use strict';

var MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
var MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
var JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
var JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

function uid(prefixe) {
  return (prefixe || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function echapper(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function deuxChiffres(n) { return (n < 10 ? '0' : '') + n; }

/* ---------- Dates (chaînes ISO locales AAAA-MM-JJ) ---------- */

function dateVersIso(d) {
  return d.getFullYear() + '-' + deuxChiffres(d.getMonth() + 1) + '-' + deuxChiffres(d.getDate());
}
function isoVersDate(iso) {
  var m = String(iso || '').match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1, 12, 0, 0);
}
/* Vrai pour une date AAAA-MM-JJ qui existe (le 30 février est refusé). */
function dateValide(iso) {
  var d = isoVersDate(iso);
  return !isNaN(d.getTime()) && dateVersIso(d) === String(iso).slice(0, 10);
}
function aujourdhui() { return dateVersIso(new Date()); }
function maintenantHM() {
  var d = new Date();
  return deuxChiffres(d.getHours()) + ':' + deuxChiffres(d.getMinutes());
}
function moisDe(iso) { return String(iso || '').slice(0, 7); }
/* Un mois écrit AAAA-MM, avec un numéro de mois plausible. */
function moisValide(m) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m == null ? '' : m)); }
function moisCourant() { return moisDe(aujourdhui()); }
function ajouterMois(mois, n) {
  var p = String(mois || '').split('-').map(Number);
  var d = new Date(p[0], p[1] - 1 + n, 1, 12);
  return d.getFullYear() + '-' + deuxChiffres(d.getMonth() + 1);
}
function premierJour(mois) { return mois + '-01'; }
function dernierJour(mois) {
  var p = mois.split('-').map(Number);
  var d = new Date(p[0], p[1], 0, 12);
  return dateVersIso(d);
}
function listeMois(moisDebut, moisFin) {
  var out = [];
  var m = moisDebut;
  var garde = 0;
  while (m <= moisFin && garde++ < 600) { out.push(m); m = ajouterMois(m, 1); }
  return out;
}
function ajouterJours(iso, n) {
  var d = isoVersDate(iso);
  d.setDate(d.getDate() + n);
  return dateVersIso(d);
}
/* NaN si l'une des deux dates est absente ou invalide. */
function joursEntre(isoA, isoB) {
  var a = isoVersDate(isoA), b = isoVersDate(isoB);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return NaN;
  return Math.round((b - a) / 86400000);
}
function libelleMois(mois, court) {
  if (!mois) return '';
  var p = mois.split('-').map(Number);
  return (court ? MOIS_COURTS : MOIS_LONGS)[p[1] - 1] + ' ' + p[0];
}
/* Le nom du mois sans son année, pour les pastilles et les boutons. */
function libelleMoisSeul(mois) {
  var i = Number(String(mois || '').slice(5, 7)) - 1;
  return MOIS_LONGS[i] || '';
}
/* Une énumération lisible : « octobre 2026 », « juillet 2026 et
   septembre 2026 », « juillet 2026, août 2026 et septembre 2026 ». */
function enumererMois(liste) {
  var noms = (liste || []).map(function (m) { return libelleMois(m); });
  if (noms.length < 2) return noms.join('');
  return noms.slice(0, -1).join(', ') + ' et ' + noms[noms.length - 1];
}
/* style : 'long' (lundi 5 octobre 2026), 'moyen' (5 oct. 2026),
   'jour' (lun. 5 oct.), 'court' (05/10/2026) */
function libelleDate(iso, style) {
  if (!iso) return '';
  var d = isoVersDate(iso);
  if (isNaN(d.getTime())) return '';
  if (style === 'court') return deuxChiffres(d.getDate()) + '/' + deuxChiffres(d.getMonth() + 1) + '/' + d.getFullYear();
  var jour = d.getDate() === 1 ? '1er' : String(d.getDate());
  if (style === 'moyen') return jour + ' ' + MOIS_COURTS[d.getMonth()] + ' ' + d.getFullYear();
  if (style === 'jour') return JOURS_COURTS[d.getDay()] + ' ' + jour + ' ' + MOIS_COURTS[d.getMonth()];
  return JOURS_LONGS[d.getDay()] + ' ' + jour + ' ' + MOIS_LONGS[d.getMonth()] + ' ' + d.getFullYear();
}
function dateFr(iso) { return libelleDate(iso, 'court'); }

/* Trimestre civil d'une date : libellé, bornes et échéance de déclaration
   URSSAF (dernier jour du mois suivant le trimestre). */
function trimestreDe(iso) {
  var d = isoVersDate(iso);
  var t = Math.floor(d.getMonth() / 3) + 1;
  var annee = d.getFullYear();
  var debut = annee + '-' + deuxChiffres((t - 1) * 3 + 1) + '-01';
  var finMois = annee + '-' + deuxChiffres(t * 3);
  return {
    cle: annee + '-T' + t,
    libelle: 'T' + t + ' ' + annee,
    debut: debut,
    fin: dernierJour(finMois),
    echeance: dernierJour(ajouterMois(finMois, 1)),
  };
}

/* ---------- Durées (minutes entières) ---------- */

function hmVersMinutes(hm) {
  if (!hm) return null;
  var p = String(hm).split(':').map(Number);
  if (isNaN(p[0])) return null;
  return p[0] * 60 + (p[1] || 0);
}
function minutesVersHM(minutes) {
  var m = Math.max(0, Math.round(minutes)) % 1440;
  return deuxChiffres(Math.floor(m / 60)) + ':' + deuxChiffres(m % 60);
}
/* Minutes entre deux horaires HH:MM, en passant minuit au besoin. */
function minutesEntre(debut, fin) {
  var a = hmVersMinutes(debut), b = hmVersMinutes(fin);
  if (a == null || b == null) return null;
  var d = b - a;
  if (d < 0) d += 1440;
  return d;
}
/* Interprète une durée tapée librement : "1h30", "1 h 30", "1h30min",
   "1:30", "45 min", "2,5", "2.5", "90". Un nombre nu à virgule ou
   inférieur à 10 est lu en heures, un entier plus grand en minutes.
   Retourne des minutes ou null. */
function parseDuree(txt) {
  var s = String(txt || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  var m;
  if ((m = s.match(/^(\d+)h(\d{0,2})(?:min|mn|m)?$/))) return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  if ((m = s.match(/^(\d+(?:[.,]\d+)?)(min|mn|m)$/))) return Math.round(parseFloat(m[1].replace(',', '.')));
  if ((m = s.match(/^(\d+(?:[.,]\d+)?)h?$/))) {
    var n = parseFloat(m[1].replace(',', '.'));
    if (isNaN(n)) return null;
    /* un nombre à virgule ou inférieur à 10 se lit en heures, un entier plus grand en minutes */
    if (s.indexOf('h') >= 0 || n < 10 || /[.,]/.test(m[1])) return Math.round(n * 60);
    return Math.round(n);
  }
  return null;
}
/* "2 h 15", "45 min", "0 min" */
function fmtDuree(minutes) {
  var m = Math.round(minutes || 0);
  var h = Math.floor(m / 60), r = m % 60;
  if (h === 0) return r + ' min';
  return h + ' h' + (r ? ' ' + deuxChiffres(r) : '');
}
/* "2,25 h" */
function fmtHeuresDec(minutes, sansUnite) {
  var h = (minutes || 0) / 60;
  var s = h.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return sansUnite ? s : s + ' h';
}
function fmtNombre(n, decimales) {
  var d = decimales == null ? 2 : decimales;
  return Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtEuros(n) {
  return Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}
function fmtPourcent(ratio, decimales) {
  return (ratio * 100).toLocaleString('fr-FR', { minimumFractionDigits: decimales || 0, maximumFractionDigits: decimales || 0 }) + ' %';
}
/* Arrondi commercial au centime, insensible aux imprécisions flottantes
   (0,75 × 42,86 = 32,145 donne bien 32,15). */
function arrondir2(n) {
  var x = Number(n) * 100;
  if (!isFinite(x)) return 0;
  return Math.round(x + (x < 0 ? -1e-9 : 1e-9)) / 100;
}
/* Lit un montant tapé librement ("1 250,50", "600.5", "12") : nombre ou null. */
function lireMontant(txt) {
  var s = String(txt == null ? '' : txt).replace(/[\s\u202F\u00A0]/g, '').replace(',', '.').replace(/€/g, '');
  if (!s) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  var n = Number(s);
  return isFinite(n) ? n : null;
}
/* Nombre pour un champ de saisie ou un CSV : virgule décimale, sans séparateur de milliers. */
function fmtNombreSaisie(n, decimales) {
  var v = Number(n || 0);
  return (decimales == null ? String(v) : v.toFixed(decimales)).replace('.', ',');
}

/* ---------- Identités et coordonnées (documents) ---------- */

/* IBAN en groupes de quatre : "FR76 3000 6000 0112 3456 7890 189". */
function formaterIban(iban) {
  var s = String(iban || '').replace(/\s+/g, '').toUpperCase();
  return s.replace(/(.{4})/g, '$1 ').trim();
}
/* Numéro français à dix chiffres en paires : "06 12 34 56 78". */
function formaterTelephone(tel) {
  var s = String(tel || '').trim();
  var chiffres = s.replace(/\D/g, '');
  if (/^0\d{9}$/.test(chiffres)) return chiffres.replace(/(\d{2})(?=\d)/g, '$1 ');
  if (/^33\d{9}$/.test(chiffres)) return '+33 ' + chiffres.slice(2).replace(/(\d)(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
  return s;
}
/* Une adresse saisie sur une ligne ("12 rue des Essais, 75000 Paris")
   rendue sur deux : la voie, puis code postal et ville. */
function adresseLignes(adresse) {
  var s = String(adresse || '').trim();
  if (!s) return [];
  var m = s.match(/^(.*?),?\s+(\d{5}\s+.+)$/);
  if (m && m[1]) return [m[1].replace(/,\s*$/, ''), m[2]];
  return s.split(/\s*,\s*/).filter(Boolean);
}
/* Compte à rebours court : "Aujourd'hui", "Demain", "J-12", "J+3" (dépassé). */
function libelleJours(j) {
  if (!isFinite(j)) return '';
  if (j === 0) return 'Aujourd\'hui';
  if (j === 1) return 'Demain';
  if (j === -1) return 'Hier';
  return j < 0 ? 'J+' + (-j) : 'J-' + j;
}
/* Même chose en toutes lettres : "dans 12 jours", "il y a 3 jours". */
function libelleDelai(j) {
  if (!isFinite(j)) return '';
  if (j === 0) return 'aujourd\'hui';
  if (j === 1) return 'demain';
  if (j === -1) return 'hier';
  return j < 0 ? 'il y a ' + (-j) + ' jours' : 'dans ' + j + ' jours';
}
function fmtTaille(octets) {
  var o = Number(octets) || 0;
  if (o < 1024) return o + ' o';
  if (o < 1024 * 1024) return fmtNombre(o / 1024, o < 10240 ? 1 : 0) + ' Ko';
  return fmtNombre(o / 1024 / 1024, 1) + ' Mo';
}

/* ---------- Divers ---------- */

function normaliserCle(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}
function capitaliser(s) {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/* Différé qui sait se vider (d.flush()) : utile avant de quitter. */
function debounce(fn, ms) {
  var t = null, args = null, ctx = null;
  var d = function () {
    args = arguments; ctx = this;
    clearTimeout(t);
    t = setTimeout(d.flush, ms);
  };
  d.flush = function () {
    if (t === null) return;
    clearTimeout(t); t = null;
    var a = args, c = ctx; args = ctx = null;
    fn.apply(c, a);
  };
  d.enAttente = function () { return t !== null; };
  return d;
}
function trierPar(tableau, cle, desc) {
  return tableau.slice().sort(function (a, b) {
    var x = typeof cle === 'function' ? cle(a) : a[cle];
    var y = typeof cle === 'function' ? cle(b) : b[cle];
    if (x < y) return desc ? 1 : -1;
    if (x > y) return desc ? -1 : 1;
    return 0;
  });
}
function copier(obj) { return JSON.parse(JSON.stringify(obj)); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    uid: uid, echapper: echapper, deuxChiffres: deuxChiffres,
    dateVersIso: dateVersIso, isoVersDate: isoVersDate, aujourdhui: aujourdhui, maintenantHM: maintenantHM,
    moisDe: moisDe, moisValide: moisValide, moisCourant: moisCourant, ajouterMois: ajouterMois, premierJour: premierJour, dernierJour: dernierJour,
    listeMois: listeMois, ajouterJours: ajouterJours, joursEntre: joursEntre, libelleMois: libelleMois, libelleMoisSeul: libelleMoisSeul, enumererMois: enumererMois, libelleDate: libelleDate,
    dateFr: dateFr, trimestreDe: trimestreDe, hmVersMinutes: hmVersMinutes, minutesVersHM: minutesVersHM, minutesEntre: minutesEntre,
    parseDuree: parseDuree, fmtDuree: fmtDuree, fmtHeuresDec: fmtHeuresDec, fmtNombre: fmtNombre, fmtEuros: fmtEuros,
    fmtPourcent: fmtPourcent, arrondir2: arrondir2, normaliserCle: normaliserCle, capitaliser: capitaliser, debounce: debounce,
    trierPar: trierPar, copier: copier,
    formaterIban: formaterIban, formaterTelephone: formaterTelephone, adresseLignes: adresseLignes, libelleJours: libelleJours, libelleDelai: libelleDelai, fmtTaille: fmtTaille,
    dateValide: dateValide, lireMontant: lireMontant, fmtNombreSaisie: fmtNombreSaisie,
  };
}
