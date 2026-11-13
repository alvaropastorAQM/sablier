/* ============================================================
   UTILITIES: dates, durations, formats, small helpers.
   No DOM dependency: this file is also loaded by the node tests
   (module.exports at the end of the file).
   ============================================================ */
'use strict';

var MOIS_LONGS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var MOIS_COURTS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var JOURS_LONGS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var JOURS_COURTS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function uid(prefixe) {
  return (prefixe || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function echapper(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function deuxChiffres(n) { return (n < 10 ? '0' : '') + n; }

/* ---------- Dates (local ISO strings YYYY-MM-DD) ---------- */

function dateVersIso(d) {
  return d.getFullYear() + '-' + deuxChiffres(d.getMonth() + 1) + '-' + deuxChiffres(d.getDate());
}
function isoVersDate(iso) {
  var m = String(iso || '').match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1, 12, 0, 0);
}
/* True for a YYYY-MM-DD date that exists (30 February is rejected). */
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
/* A month written YYYY-MM, with a plausible month number. */
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
/* NaN if either date is missing or invalid. */
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
/* The month name without its year, for chips and buttons. */
function libelleMoisSeul(mois) {
  var i = Number(String(mois || '').slice(5, 7)) - 1;
  return MOIS_LONGS[i] || '';
}
/* A readable list: "October 2026", "July 2026 and September 2026",
   "July 2026, August 2026 and September 2026". */
function enumererMois(liste) {
  var noms = (liste || []).map(function (m) { return libelleMois(m); });
  if (noms.length < 2) return noms.join('');
  return noms.slice(0, -1).join(', ') + ' and ' + noms[noms.length - 1];
}
/* style: 'long' (Monday 5 October 2026), 'moyen' (5 Oct 2026),
   'jour' (Mon 5 Oct), 'court' (05/10/2026) */
function libelleDate(iso, style) {
  if (!iso) return '';
  var d = isoVersDate(iso);
  if (isNaN(d.getTime())) return '';
  if (style === 'court') return deuxChiffres(d.getDate()) + '/' + deuxChiffres(d.getMonth() + 1) + '/' + d.getFullYear();
  var jour = String(d.getDate());
  if (style === 'moyen') return jour + ' ' + MOIS_COURTS[d.getMonth()] + ' ' + d.getFullYear();
  if (style === 'jour') return JOURS_COURTS[d.getDay()] + ' ' + jour + ' ' + MOIS_COURTS[d.getMonth()];
  return JOURS_LONGS[d.getDay()] + ' ' + jour + ' ' + MOIS_LONGS[d.getMonth()] + ' ' + d.getFullYear();
}
function dateFr(iso) { return libelleDate(iso, 'court'); }

/* Calendar quarter of a date: label, bounds and URSSAF filing deadline
   (last day of the month after the quarter). */
function trimestreDe(iso) {
  var d = isoVersDate(iso);
  var t = Math.floor(d.getMonth() / 3) + 1;
  var annee = d.getFullYear();
  var debut = annee + '-' + deuxChiffres((t - 1) * 3 + 1) + '-01';
  var finMois = annee + '-' + deuxChiffres(t * 3);
  return {
    cle: annee + '-T' + t,
    libelle: 'Q' + t + ' ' + annee,
    debut: debut,
    fin: dernierJour(finMois),
    echeance: dernierJour(ajouterMois(finMois, 1)),
  };
}

/* ---------- Durations (whole minutes) ---------- */

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
/* Minutes between two HH:MM times, crossing midnight if needed. */
function minutesEntre(debut, fin) {
  var a = hmVersMinutes(debut), b = hmVersMinutes(fin);
  if (a == null || b == null) return null;
  var d = b - a;
  if (d < 0) d += 1440;
  return d;
}
/* Parses a freely typed duration: "1h30", "1 h 30", "1h30min",
   "1:30", "45 min", "2,5", "2.5", "90". A bare number with a decimal
   separator or below 10 is read as hours, a larger integer as minutes.
   Returns minutes or null. */
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
    /* a number with a decimal separator or below 10 is hours, a larger integer is minutes */
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
/* "2.25 h" */
function fmtHeuresDec(minutes, sansUnite) {
  var h = (minutes || 0) / 60;
  var s = h.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return sansUnite ? s : s + ' h';
}
function fmtNombre(n, decimales) {
  var d = decimales == null ? 2 : decimales;
  return Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtEuros(n) {
  return Number(n || 0).toLocaleString('en-GB', { style: 'currency', currency: 'EUR' });
}
function fmtPourcent(ratio, decimales) {
  return (ratio * 100).toLocaleString('en-GB', { minimumFractionDigits: decimales || 0, maximumFractionDigits: decimales || 0 }) + '%';
}
/* Commercial rounding to the cent, immune to floating-point noise
   (0.75 × 42.86 = 32.145 does give 32.15). */
function arrondir2(n) {
  var x = Number(n) * 100;
  if (!isFinite(x)) return 0;
  return Math.round(x + (x < 0 ? -1e-9 : 1e-9)) / 100;
}
/* Parses a freely typed amount ("1 250,50", "600.5", "12"): number or null. */
function lireMontant(txt) {
  var s = String(txt == null ? '' : txt).replace(/[\s\u202F\u00A0]/g, '').replace(',', '.').replace(/€/g, '');
  if (!s) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  var n = Number(s);
  return isFinite(n) ? n : null;
}
/* Number for an input field or a CSV: decimal point, no thousands separator. */
function fmtNombreSaisie(n, decimales) {
  var v = Number(n || 0);
  return decimales == null ? String(v) : v.toFixed(decimales);
}

/* ---------- Identities and contact details (documents) ---------- */

/* IBAN in groups of four: "FR76 3000 6000 0112 3456 7890 189". */
function formaterIban(iban) {
  var s = String(iban || '').replace(/\s+/g, '').toUpperCase();
  return s.replace(/(.{4})/g, '$1 ').trim();
}
/* French ten-digit number in pairs: "06 12 34 56 78". */
function formaterTelephone(tel) {
  var s = String(tel || '').trim();
  var chiffres = s.replace(/\D/g, '');
  if (/^0\d{9}$/.test(chiffres)) return chiffres.replace(/(\d{2})(?=\d)/g, '$1 ');
  if (/^33\d{9}$/.test(chiffres)) return '+33 ' + chiffres.slice(2).replace(/(\d)(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
  return s;
}
/* An address typed on one line ("12 rue des Essais, 75000 Paris")
   rendered on two: the street, then postcode and city. */
function adresseLignes(adresse) {
  var s = String(adresse || '').trim();
  if (!s) return [];
  var m = s.match(/^(.*?),?\s+(\d{5}\s+.+)$/);
  if (m && m[1]) return [m[1].replace(/,\s*$/, ''), m[2]];
  return s.split(/\s*,\s*/).filter(Boolean);
}
/* Short countdown: "Today", "Tomorrow", "D-12", "D+3" (past). */
function libelleJours(j) {
  if (!isFinite(j)) return '';
  if (j === 0) return 'Today';
  if (j === 1) return 'Tomorrow';
  if (j === -1) return 'Yesterday';
  return j < 0 ? 'D+' + (-j) : 'D-' + j;
}
/* The same in words: "in 12 days", "3 days ago". */
function libelleDelai(j) {
  if (!isFinite(j)) return '';
  if (j === 0) return 'today';
  if (j === 1) return 'tomorrow';
  if (j === -1) return 'yesterday';
  return j < 0 ? (-j) + ' days ago' : 'in ' + j + ' days';
}
function fmtTaille(octets) {
  var o = Number(octets) || 0;
  if (o < 1024) return o + ' B';
  if (o < 1024 * 1024) return fmtNombre(o / 1024, o < 10240 ? 1 : 0) + ' KB';
  return fmtNombre(o / 1024 / 1024, 1) + ' MB';
}

/* ---------- Miscellaneous ---------- */

function normaliserCle(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}
function capitaliser(s) {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/* Debounce that can be flushed (d.flush()): useful before quitting. */
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
