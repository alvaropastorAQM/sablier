/* Registers the Linux build (dist-app/linux-*-unpacked) as a desktop app:
   a .desktop entry in ~/.local/share/applications. Under WSLg, Windows
   picks that entry up and lists Sablier in the Start menu. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const racine = path.join(__dirname, '..');
const construction = fs.readdirSync(path.join(racine, 'dist-app')).find((d) => /^linux-.*unpacked$/.test(d));
if (!construction) throw new Error('No Linux build in dist-app: run electron-builder --linux --dir first.');
const executable = path.join(racine, 'dist-app', construction, 'sablier');

const icones = path.join(os.homedir(), '.local/share/icons');
const applications = path.join(os.homedir(), '.local/share/applications');
fs.mkdirSync(icones, { recursive: true });
fs.mkdirSync(applications, { recursive: true });
fs.copyFileSync(path.join(racine, 'app/icone.png'), path.join(icones, 'sablier.png'));
fs.writeFileSync(path.join(applications, 'sablier.desktop'), [
  '[Desktop Entry]',
  'Type=Application',
  'Name=Sablier',
  'Comment=Time tracking, activity statements and invoices',
  'Exec="' + executable + '" %U',
  'Icon=' + path.join(icones, 'sablier.png'),
  'Categories=Office;',
  'StartupWMClass=Sablier',
  '',
].join('\n'));
console.log('Installed: ' + path.join(applications, 'sablier.desktop') + ' -> ' + executable);
