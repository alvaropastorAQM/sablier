/* Masque l'extension « .app » du bundle construit (attribut Finder) :
   le Dock et le Finder affichent alors « Sablier » et non « Sablier.app ».
   Lancé automatiquement après chaque construction. */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
[path.join(racine, 'dist-app', 'mac-arm64', 'Sablier.app'), path.join(racine, 'dist-app', 'mac', 'Sablier.app')].forEach(p => {
  if (!fs.existsSync(p)) return;
  try {
    execFileSync('/usr/bin/SetFile', ['-a', 'E', p]);
    console.log('Extension .app masquée : ' + p);
  } catch (e) {
    console.log('SetFile indisponible (' + e.message + ') : extension laissée visible.');
  }
});
