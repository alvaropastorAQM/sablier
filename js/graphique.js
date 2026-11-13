/* ============================================================
   GRAPHIQUE : barres SVG maison, sans bibliothèque, dans la charte
   (barres neutres, mois courant en accent, repère mensuel pointillé,
   grille en cheveu, chiffres tabulaires).
   ============================================================ */
'use strict';

/* series : [{libelle, valeur (heures), actif, futur, titre}]
   options : {repere (heures), hauteur, unite} */
function dessinerBarres(conteneur, series, options) {
  if (!conteneur) return;
  var o = options || {};
  var W = 640, H = o.hauteur || 220;
  var mg = { haut: 18, bas: 40, gauche: 34, droite: 12 };
  var largeur = W - mg.gauche - mg.droite;
  var hauteur = H - mg.haut - mg.bas;
  var n = series.length || 1;
  var maxVal = Math.max(o.repere || 0, 1);
  series.forEach(function (s) { if (s.valeur > maxVal) maxVal = s.valeur; });
  maxVal = Math.ceil(maxVal / 4) * 4 || 4;
  var pas = maxVal <= 8 ? 2 : (maxVal <= 24 ? 4 : (maxVal <= 60 ? 10 : 20));
  var y = function (v) { return mg.haut + hauteur - (v / maxVal) * hauteur; };
  var pasX = largeur / n;
  var lb = Math.min(38, pasX * 0.62);
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Heures par mois">';
  for (var v = 0; v <= maxVal; v += pas) {
    svg += '<line class="gr-grille" x1="' + mg.gauche + '" x2="' + (W - mg.droite) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>';
    svg += '<text class="gr-texte" x="' + (mg.gauche - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>';
  }
  series.forEach(function (s, i) {
    var cx = mg.gauche + pasX * i + pasX / 2;
    var h = Math.max(0, (s.valeur / maxVal) * hauteur);
    var classes = 'gr-barre' + (s.actif ? ' actif' : '') + (s.futur ? ' futur' : '');
    svg += '<rect class="' + classes + '" x="' + (cx - lb / 2).toFixed(1) + '" y="' + (y(s.valeur)).toFixed(1) + '" width="' + lb.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"><title>' + echapper(s.titre || (s.libelle + ' : ' + s.valeur)) + '</title></rect>';
    if (s.valeur > 0) {
      svg += '<text class="gr-valeur" x="' + cx.toFixed(1) + '" y="' + (y(s.valeur) - 5).toFixed(1) + '" text-anchor="middle">' + fmtHeuresDec(s.valeur * 60, true) + '</text>';
    }
    svg += '<text class="gr-texte" x="' + cx.toFixed(1) + '" y="' + (H - 22) + '" text-anchor="middle">' + echapper(s.libelle) + '</text>';
    if (s.sous) svg += '<text class="gr-texte" x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" opacity="0.75">' + echapper(s.sous) + '</text>';
  });
  if (o.repere) {
    svg += '<line class="gr-repere" x1="' + mg.gauche + '" x2="' + (W - mg.droite) + '" y1="' + y(o.repere).toFixed(1) + '" y2="' + y(o.repere).toFixed(1) + '"/>';
    svg += '<text class="gr-repere-texte" x="' + (W - mg.droite) + '" y="' + (y(o.repere) - 4).toFixed(1) + '" text-anchor="end">repère ' + fmtHeuresDec(o.repere * 60) + ' / mois</text>';
  }
  svg += '</svg>';
  conteneur.innerHTML = svg;
}

/* Répartition en barres horizontales (HTML). lignes : [{nom, couleur, valeur, part}] */
function dessinerRepartition(conteneur, lignes) {
  if (!conteneur) return;
  if (!lignes.length) { conteneur.innerHTML = '<div class="vide">Aucune heure sur la période.</div>'; return; }
  var max = Math.max.apply(null, lignes.map(function (l) { return l.valeur; })) || 1;
  conteneur.innerHTML = '<div class="rep-lignes">' + lignes.map(function (l) {
    return '<div class="rep-ligne">'
      + '<div class="rep-nom" title="' + echapper(l.nom) + '">' + (l.couleur ? '<i class="axe-point" style="--axe:' + echapper(l.couleur) + '"></i>' : '') + echapper(l.nom) + '</div>'
      + '<div class="jauge"><span style="width:' + Math.max(1, l.valeur / max * 100).toFixed(1) + '%"></span></div>'
      + '<div class="rep-val">' + fmtHeuresDec(l.valeur) + (l.part != null ? ' <small>' + fmtPourcent(l.part) + '</small>' : '') + '</div>'
      + '</div>';
  }).join('') + '</div>';
}
