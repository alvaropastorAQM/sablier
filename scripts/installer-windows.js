/* Builds Sablier.exe, checks it with the tests and the self-test, then installs it for the current user
   (npm run app:build:windows): %LOCALAPPDATA%\Programs\Sablier\Sablier.exe and a Start menu shortcut.
   A build that fails its checks is never installed; an open Sablier is closed normally
   (its pending writes reach the disk), never killed. --verifier stops before the installation. */
'use strict';
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const racine = path.join(__dirname, '..');
const tauri = path.join(racine, 'src-tauri');
const construite = path.join(tauri, 'target', 'release', 'sablier.exe');
const dossierCible = path.join(process.env.LOCALAPPDATA, 'Programs', 'Sablier');
const cible = path.join(dossierCible, 'Sablier.exe');
const raccourci = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Sablier.lnk');
const lancer = (commande, args, options = {}) => execFileSync(commande, args, { cwd: racine, stdio: 'inherit', ...options });
const powershell = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
const attendre = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/* A single-quoted string for PowerShell. */
const ps = (s) => "'" + String(s).replace(/'/g, "''") + "'";

if (process.platform !== 'win32') { console.error('This script builds the Windows version; on Mac: npm run app:build.'); process.exit(1); }

lancer('node', ['tests/test-calculs.js']);
lancer('cargo', ['test', '--release', '--quiet'], { cwd: tauri });
lancer('cargo', ['build', '--release'], { cwd: tauri });

/* The full self-test on the built executable, with the demo data set in a disposable folder. */
const essai = fs.mkdtempSync(path.join(os.tmpdir(), 'sablier-essai-'));
lancer('node', ['outils/jeu-demo.js', path.join(essai, 'donnees')], { stdio: 'ignore' });
const env = { ...process.env, SABLIER_SMOKE: '1', SABLIER_SMOKE_SCENARIO: '1', SABLIER_SMOKE_AUDIT: '1', SABLIER_SMOKE_PDF: '1', SABLIER_DONNEES: path.join(essai, 'donnees'), SABLIER_CAPTURES: essai };
const test = spawnSync(construite, [], { env, timeout: 240000, encoding: 'utf8' });
const verdict = (test.stdout || '').split(/\r?\n/).filter(l => /^SABLIER_SMOKE_(OK|ECHEC|ERREUR)/.test(l)).pop() || 'no verdict';
console.log(verdict.slice(0, 600));
if (test.status !== 0) { console.error('Self-test failed: Sablier is not installed. Details in ' + essai); process.exit(1); }
fs.rmSync(essai, { recursive: true, force: true });

if (process.argv.includes('--verifier')) { console.log('Verified, not installed (--verifier).'); process.exit(0); }

/* Sablier open from the installed location: its window is closed, like a click on the close button. */
const ouverts = () => powershell('@(Get-Process -Name Sablier -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ' + ps(cible) + ' }).Count').trim() !== '0';
if (ouverts()) {
  powershell('Get-Process -Name Sablier -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ' + ps(cible) + ' } | ForEach-Object { [void]$_.CloseMainWindow() }');
  for (let i = 0; i < 30 && ouverts(); i++) attendre(500);
  if (ouverts()) { console.error('Sablier is still open (a question may be waiting for an answer): quit it, then run this again.'); process.exit(1); }
}

/* The new copy is ready alongside before touching the old one: the swap is a single rename. */
fs.mkdirSync(dossierCible, { recursive: true });
const nouvelle = cible + '.nouvelle';
fs.copyFileSync(construite, nouvelle);
fs.renameSync(nouvelle, cible);
powershell('$r = (New-Object -ComObject WScript.Shell).CreateShortcut(' + ps(raccourci) + '); $r.TargetPath = ' + ps(cible)
  + '; $r.WorkingDirectory = ' + ps(dossierCible) + '; $r.IconLocation = ' + ps(cible + ',0') + '; $r.Description = ' + ps('Sablier') + '; $r.Save()');
console.log('Installed: ' + cible + '\nShortcut: ' + raccourci);
