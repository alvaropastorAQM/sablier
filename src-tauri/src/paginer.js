/* Pagination des PDF (relevé, facture), jouée dans la fenêtre cachée juste avant l'impression (mac.rs).

   Chromium (version Electron) ne coupait jamais une ligne de tableau entre deux pages et répétait l'en-tête du
   tableau en haut de chaque page ; WebKit ne fait ni l'un ni l'autre. On mesure donc le document d'un seul tenant,
   à la largeur imprimée, et on pose soi-même les sauts de page : une ligne de tableau, un élément de liste ou un
   bloc qui ne tient plus passe à la page suivante, et un tableau coupé y reprend son en-tête. Ce qui ne doit pas
   finir une page (break-after: avoid : titres de section, en-têtes de groupe) passe avec lui. Un saut déjà demandé
   par le gabarit (break-before: page) ouvre une nouvelle page.

   Corps d'une fonction : rend le nombre de sauts posés. */
var corps = document.body;
var marges = { haut: '0mm', bas: '0mm', gauche: '0mm', droite: '0mm' };
Array.prototype.forEach.call(document.styleSheets, function (feuille) {
  Array.prototype.forEach.call(feuille.cssRules || [], function (r) {
    if (r.type !== CSSRule.PAGE_RULE) return;
    marges = { haut: r.style.marginTop || '0mm', bas: r.style.marginBottom || '0mm', gauche: r.style.marginLeft || '0mm', droite: r.style.marginRight || '0mm' };
  });
});
/* La hauteur utile d'une page A4, dans les unités du document (zoom compris). */
var sonde = document.createElement('div');
sonde.style.cssText = 'position:absolute;visibility:hidden;width:1px;top:0;left:0;height:calc(297mm - ' + marges.haut + ' - ' + marges.bas + ')';
corps.appendChild(sonde);
var H = sonde.getBoundingClientRect().height - 1;
sonde.remove();
/* Les lignes coupent comme à l'impression : même largeur que la page. */
var largeur = corps.style.width;
corps.style.width = 'calc(210mm - ' + marges.gauche + ' - ' + marges.droite + ')';

function style(el) { return getComputedStyle(el); }
function origine() { return corps.getBoundingClientRect().top; }
function hautMarge(el) { return el.getBoundingClientRect().top - (parseFloat(style(el).marginTop) || 0) - origine(); }
function eviteApres(el) { var s = style(el); return s.breakAfter === 'avoid' || s.breakAfter === 'avoid-page' || s.pageBreakAfter === 'avoid'; }
function sautAvant(el) { var v = style(el).breakBefore; return ['page', 'always', 'left', 'right', 'recto', 'verso'].indexOf(v) >= 0; }

/* Le saut demandé par le gabarit sur l'élément ou sur le conteneur qu'il ouvre. */
function sautDemande(el) {
  var e = el;
  while (e && e !== corps) {
    if (sautAvant(e)) return e;
    if (e.previousElementSibling) return null;
    if (e.tagName === 'TR') {
      var table = e.closest('table');
      // Seule la première ligne du tableau en ouvre le début.
      if (e.parentElement !== table.querySelector(':scope > tbody, :scope > tfoot')) return null;
      e = table;
    } else {
      e = e.parentElement;
    }
  }
  return null;
}

/* Les éléments qu'on ne coupe pas, dans l'ordre du document. */
var atomes = [];
(function parcourir(parent) {
  Array.prototype.forEach.call(parent.children, function (el) {
    var s = style(el);
    if (s.display === 'none' || s.position === 'absolute' || s.position === 'fixed') return;
    if (el.tagName === 'TABLE') Array.prototype.forEach.call(el.querySelectorAll(':scope > tbody > tr, :scope > tfoot > tr'), function (tr) { atomes.push(tr); });
    else if (el.tagName === 'UL' || el.tagName === 'OL') Array.prototype.forEach.call(el.children, function (li) { atomes.push(li); });
    else if (el.children.length && el.getBoundingClientRect().height > H / 2) parcourir(el);
    else atomes.push(el);
  });
})(corps);

/* Saut avant l'élément ; une ligne de tableau ouvre un nouveau tableau, avec l'en-tête. Rend le haut de la nouvelle page. */
function couperAvant(el) {
  if (el.tagName === 'TR') {
    var table = el.closest('table'), groupe = el.parentElement;
    var premier = table.querySelector(':scope > tbody, :scope > tfoot');
    if (el.previousElementSibling || groupe !== premier) {
      var suite = table.cloneNode(false);
      Array.prototype.forEach.call(table.querySelectorAll(':scope > colgroup, :scope > thead'), function (x) { suite.appendChild(x.cloneNode(true)); });
      var lignes = groupe.cloneNode(false);
      suite.appendChild(lignes);
      for (var n = el; n;) { var apres = n.nextElementSibling; lignes.appendChild(n); n = apres; }
      for (var g = groupe.nextElementSibling; g;) { var ensuite = g.nextElementSibling; suite.appendChild(g); g = ensuite; }
      table.after(suite);
      el = suite;
    } else {
      el = table;
    }
  }
  el.style.breakBefore = 'page';
  el.style.pageBreakBefore = 'always';
  return hautMarge(el);
}

var debut = 0, sauts = 0;
for (var i = 0; i < atomes.length; i++) {
  var demande = sautDemande(atomes[i]);
  if (demande) debut = hautMarge(demande);
  var r = atomes[i].getBoundingClientRect(), o = origine();
  if (r.bottom - o - debut <= H || r.top - o <= debut + 0.5) continue;
  var j = i;
  while (j > 0 && eviteApres(atomes[j - 1]) && atomes[j - 1].getBoundingClientRect().top - o > debut + 0.5) j--;
  debut = couperAvant(atomes[j]);
  sauts++;
  i = j;
}
corps.style.width = largeur;
return sauts;
