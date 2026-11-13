/* ============================================================
   LIQUID GLASS BUBBLE: a single glass bubble per selection group
   (sidebar, segmented control). It slides from one element to the
   next on a spring, with a droplet effect at the start.
   A group carries data-bulle="<name>"; the chosen element carries the
   class active or actif. The group can be redrawn (innerHTML):
   the bubble starts again from the last known position for that name.
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
    /* Only transform is animated: the bubble starts from the old place,
       at the old size (scale), and moves to the new one. */
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

/* The page is drawn first, the bubble starts just after: an animation
   launched in the frame that builds the page would freeze mid-flight. */
function poserBullesBientot() {
  requestAnimationFrame(function () { requestAnimationFrame(poserBulles); });
}
