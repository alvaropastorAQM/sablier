/* Construit Sablier.app (Tauri), le vérifie par les tests et l'auto-test, puis le met dans /Applications (npm run app:build).
   Une version qui ne passe pas ses vérifications n'est jamais installée ; Sablier ouvert est quitté normalement
   (ses écritures en attente passent sur le disque), jamais tué. */
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

/* Le bundle, à la main : l'exécutable, l'icône et l'Info.plist (même identifiant que la version Electron :
   macOS garde l'autorisation des notifications et la place dans le Dock). */
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
  <key>CFBundleDevelopmentRegion</key><string>fr</string>
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

/* L'auto-test complet sur le bundle, avec le jeu de démonstration dans un dossier jetable. */
const essai = fs.mkdtempSync(path.join(os.tmpdir(), 'sablier-essai-'));
lancer('node', ['outils/jeu-demo.js', path.join(essai, 'donnees')], { stdio: 'ignore' });
const env = { ...process.env, SABLIER_SMOKE: '1', SABLIER_SMOKE_SCENARIO: '1', SABLIER_SMOKE_AUDIT: '1', SABLIER_SMOKE_PDF: '1', SABLIER_DONNEES: path.join(essai, 'donnees'), SABLIER_CAPTURES: essai };
const test = spawnSync(path.join(contenu, 'MacOS/Sablier'), [], { env, timeout: 240000, encoding: 'utf8' });
const verdict = (test.stdout || '').split('\n').filter(l => /^SABLIER_SMOKE_(OK|ECHEC|ERREUR)/.test(l)).pop() || 'aucun verdict';
console.log(verdict.slice(0, 600));
if (test.status !== 0) { console.error('Auto-test en échec : Sablier n\'est pas installé. Détail dans ' + essai); process.exit(1); }
fs.rmSync(essai, { recursive: true, force: true });

/* Sablier ouvert : on lui demande de quitter, comme ⌘Q. */
const ouvert = () => spawnSync('pgrep', ['-x', 'Sablier']).status === 0;
if (ouvert()) {
  spawnSync('osascript', ['-e', 'tell application id "com.example.sablier" to quit']);
  for (let i = 0; i < 30 && ouvert(); i++) attendre(500);
  if (ouvert()) { console.error('Sablier est encore ouvert (une question attend peut-être une réponse) : quittez-le puis relancez.'); process.exit(1); }
}

/* La copie est prête à côté avant de toucher à l'app : l'échange tient en deux renommages. */
const nouvelle = cible + '.nouvelle', ancienne = cible + '.ancienne';
fs.rmSync(nouvelle, { recursive: true, force: true });
fs.rmSync(ancienne, { recursive: true, force: true });
lancer('ditto', [construite, nouvelle]);
lancer('codesign', ['--verify', '--strict', nouvelle]);
if (fs.existsSync(cible)) fs.renameSync(cible, ancienne);
fs.renameSync(nouvelle, cible);
fs.rmSync(ancienne, { recursive: true, force: true });
/* Le Dock et le Finder affichent « Sablier » et non « Sablier.app ». */
try { execFileSync('/usr/bin/SetFile', ['-a', 'E', cible]); } catch (e) { console.log('SetFile indisponible : extension .app laissée visible.'); }
console.log('Installé : ' + cible);
/* Juste après l'échange, macOS peut ne pas avoir fini d'enregistrer la nouvelle app : on réessaie un peu plus tard. */
for (let i = 1; ; i++) {
  try { lancer('open', [cible]); break; } catch (e) {
    if (i === 5) throw e;
    attendre(1000);
  }
}
