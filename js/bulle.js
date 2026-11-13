/* ============================================================
   BULLE LIQUID GLASS : une seule bulle de verre par groupe de
   sélection (barre latérale, contrôle segmenté). Elle glisse d'un
   élément à l'autre sur un ressort, avec un effet de goutte au départ.
   Un groupe porte data-bulle="<nom>" ; l'élément choisi porte la
   classe active ou actif. Le groupe peut être redessiné (innerHTML) :
   la bulle repart de la dernière position connue de ce nom.
   ============================================================ */
'use strict';

var POSITIONS_BULLES = {};

function poserBulles() {
  document.querySelectorAll('[data-bulle]').forEach(function (g) {
    var b = g.querySelector(':scope > .bulle');
    if (!b) {
      b = document.createElement('span');
      b.className = 'bulle fixe';
      b.setAttribute('aria-hidden', 'true');
      b.appendChild(document.createElement('i'));
      g.insertBefore(b, g.firstChild);
    }
    var el = g.querySelector(':scope > .active, :scope > .actif');
    if (!el || !el.offsetWidth) { b.style.opacity = '0'; return; }
    var p = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    var nom = g.dataset.bulle, avant = POSITIONS_BULLES[nom];
    POSITIONS_BULLES[nom] = p;
    var fin = 'translate(' + p.x + 'px,' + p.y + 'px)';
    b.style.opacity = '1';
    b.style.width = p.w + 'px';
    b.style.height = p.h + 'px';
    var bouge = avant && (avant.x !== p.x || avant.y !== p.y);
    b.classList.add('fixe');
    /* Seul transform s'anime : la bulle part de l'ancienne place, à
       l'ancienne taille (échelle), et rejoint la nouvelle. */
    b.style.transform = bouge ? 'translate(' + avant.x + 'px,' + avant.y + 'px) scale(' + avant.w / p.w + ',' + avant.h / p.h + ')' : fin;
    void b.offsetWidth;
    b.classList.remove('fixe');
    if (!bouge) return;
    b.style.transform = fin;
    var goutte = b.firstChild;
    goutte.classList.remove('goutte-x', 'goutte-y');
    void goutte.offsetWidth;
    goutte.classList.add(Math.abs(p.y - avant.y) > Math.abs(p.x - avant.x) ? 'goutte-y' : 'goutte-x');
  });
}

/* La page se dessine d'abord, la bulle part juste après : une animation
   lancée dans l'image qui construit la page se figerait en plein vol. */
function poserBullesBientot() {
  requestAnimationFrame(function () { requestAnimationFrame(poserBulles); });
}
