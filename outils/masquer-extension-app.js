/* Hides the ".app" extension of the built bundle (Finder attribute):
   the Dock and the Finder then show "Sablier" and not "Sablier.app".
   Run automatically after each build. */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
[path.join(racine, 'dist-app', 'mac-arm64', 'Sablier.app'), path.join(racine, 'dist-app', 'mac', 'Sablier.app')].forEach(p => {
  if (!fs.existsSync(p)) return;
  try {
    execFileSync('/usr/bin/SetFile', ['-a', 'E', p]);
    console.log('.app extension hidden: ' + p);
  } catch (e) {
    console.log('SetFile unavailable (' + e.message + '): extension left visible.');
  }
});
