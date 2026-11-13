/* Builds Sablier.app (Tauri), checks it with the tests and the self-test, then puts it in /Applications (npm run app:build).
   A build that fails its checks is never installed; an open Sablier is quit normally
   (its pending writes reach the disk), never killed. */
'use strict';
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const racine = path.join(__dirname, '..');
const tauri = path.join(racine, 'src-tauri');
const cible = '/Applications/Sablier.app';
const lancer = (commande, args, options = {}) => execFileSync(commande, args, { cwd: racine, stdio: 'inherit', ...options });
const version = require(path.join(racine, 'package.json')).version;
const attendre = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

lancer('node', ['tests/test-calculs.js']);
lancer('cargo', ['test', '--release', '--quiet'], { cwd: tauri });
lancer('cargo', ['build', '--release'], { cwd: tauri });

/* The bundle, by hand: the executable, the icon and the Info.plist (same identifier as the Electron version:
   macOS keeps the notification permission and the place in the Dock). */
const construite = path.join(racine, 'release', 'Sablier.app');
const contenu = path.join(construite, 'Contents');
fs.rmSync(construite, { recursive: true, force: true });
fs.mkdirSync(path.join(contenu, 'MacOS'), { recursive: true });
fs.mkdirSync(path.join(contenu, 'Resources'));
fs.copyFileSync(path.join(tauri, 'target/release/sablier'), path.join(contenu, 'MacOS/Sablier'));
fs.chmodSync(path.join(contenu, 'MacOS/Sablier'), 0o755);
fs.copyFileSync(path.join(tauri, 'icons/icon.icns'), path.join(contenu, 'Resources/icon.icns'));
fs.writeFileSync(path.join(contenu, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>Sablier</string>
  <key>CFBundleExecutable</key><string>Sablier</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundleIdentifier</key><string>com.example.sablier</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>Sablier</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`);
lancer('codesign', ['--force', '--sign', '-', construite]);
lancer('codesign', ['--verify', '--strict', construite]);

/* The full self-test on the bundle, with the demo data set in a disposable folder. */
const essai = fs.mkdtempSync(path.join(os.tmpdir(), 'sablier-essai-'));
lancer('node', ['outils/jeu-demo.js', path.join(essai, 'donnees')], { stdio: 'ignore' });
const env = { ...process.env, SABLIER_SMOKE: '1', SABLIER_SMOKE_SCENARIO: '1', SABLIER_SMOKE_AUDIT: '1', SABLIER_SMOKE_PDF: '1', SABLIER_DONNEES: path.join(essai, 'donnees'), SABLIER_CAPTURES: essai };
const test = spawnSync(path.join(contenu, 'MacOS/Sablier'), [], { env, timeout: 240000, encoding: 'utf8' });
const verdict = (test.stdout || '').split('\n').filter(l => /^SABLIER_SMOKE_(OK|ECHEC|ERREUR)/.test(l)).pop() || 'no verdict';
console.log(verdict.slice(0, 600));
if (test.status !== 0) { console.error('Self-test failed: Sablier is not installed. Details in ' + essai); process.exit(1); }
fs.rmSync(essai, { recursive: true, force: true });

/* Sablier open: ask it to quit, like Cmd+Q. */
const ouvert = () => spawnSync('pgrep', ['-x', 'Sablier']).status === 0;
if (ouvert()) {
  spawnSync('osascript', ['-e', 'tell application id "com.example.sablier" to quit']);
  for (let i = 0; i < 30 && ouvert(); i++) attendre(500);
  if (ouvert()) { console.error('Sablier is still open (a question may be waiting for an answer): quit it, then run this again.'); process.exit(1); }
}

/* The new copy is ready alongside before touching the app: the swap is two renames. */
const nouvelle = cible + '.nouvelle', ancienne = cible + '.ancienne';
fs.rmSync(nouvelle, { recursive: true, force: true });
fs.rmSync(ancienne, { recursive: true, force: true });
lancer('ditto', [construite, nouvelle]);
lancer('codesign', ['--verify', '--strict', nouvelle]);
if (fs.existsSync(cible)) fs.renameSync(cible, ancienne);
fs.renameSync(nouvelle, cible);
fs.rmSync(ancienne, { recursive: true, force: true });
/* The Dock and the Finder show "Sablier" and not "Sablier.app". */
try { execFileSync('/usr/bin/SetFile', ['-a', 'E', cible]); } catch (e) { console.log('SetFile unavailable: .app extension left visible.'); }
console.log('Installed: ' + cible);
/* Right after the swap, macOS may not have finished registering the new app: try again a little later. */
for (let i = 1; ; i++) {
  try { lancer('open', [cible]); break; } catch (e) {
    if (i === 5) throw e;
    attendre(1000);
  }
}
