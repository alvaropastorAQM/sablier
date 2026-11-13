/* Construit Sablier.exe, le vérifie par les tests et l'auto-test, puis l'installe pour l'utilisateur
   (npm run app:build:windows) : %LOCALAPPDATA%\Programs\Sablier\Sablier.exe et un raccourci dans le menu Démarrer.
   Une version qui ne passe pas ses vérifications n'est jamais installée ; Sablier ouvert est fermé normalement
   (ses écritures en attente passent sur le disque), jamais tué. --verifier s'arrête avant l'installation. */
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
/* Une chaîne entre apostrophes pour PowerShell. */
const ps = (s) => "'" + String(s).replace(/'/g, "''") + "'";

if (process.platform !== 'win32') { console.error('Ce script construit la version Windows ; sur Mac : npm run app:build.'); process.exit(1); }

lancer('node', ['tests/test-calculs.js']);
lancer('cargo', ['test', '--release', '--quiet'], { cwd: tauri });
lancer('cargo', ['build', '--release'], { cwd: tauri });

/* L'auto-test complet sur l'exécutable construit, avec le jeu de démonstration dans un dossier jetable. */
const essai = fs.mkdtempSync(path.join(os.tmpdir(), 'sablier-essai-'));
lancer('node', ['outils/jeu-demo.js', path.join(essai, 'donnees')], { stdio: 'ignore' });
const env = { ...process.env, SABLIER_SMOKE: '1', SABLIER_SMOKE_SCENARIO: '1', SABLIER_SMOKE_AUDIT: '1', SABLIER_SMOKE_PDF: '1', SABLIER_DONNEES: path.join(essai, 'donnees'), SABLIER_CAPTURES: essai };
const test = spawnSync(construite, [], { env, timeout: 240000, encoding: 'utf8' });
const verdict = (test.stdout || '').split(/\r?\n/).filter(l => /^SABLIER_SMOKE_(OK|ECHEC|ERREUR)/.test(l)).pop() || 'aucun verdict';
console.log(verdict.slice(0, 600));
if (test.status !== 0) { console.error('Auto-test en échec : Sablier n\'est pas installé. Détail dans ' + essai); process.exit(1); }
fs.rmSync(essai, { recursive: true, force: true });

if (process.argv.includes('--verifier')) { console.log('Vérifié, non installé (--verifier).'); process.exit(0); }

/* Sablier ouvert depuis l'emplacement installé : on ferme sa fenêtre, comme un clic sur la croix. */
const ouverts = () => powershell('@(Get-Process -Name Sablier -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ' + ps(cible) + ' }).Count').trim() !== '0';
if (ouverts()) {
  powershell('Get-Process -Name Sablier -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ' + ps(cible) + ' } | ForEach-Object { [void]$_.CloseMainWindow() }');
  for (let i = 0; i < 30 && ouverts(); i++) attendre(500);
  if (ouverts()) { console.error('Sablier est encore ouvert (une question attend peut-être une réponse) : quittez-le puis relancez.'); process.exit(1); }
}

/* La copie est prête à côté avant de toucher à l'ancienne : l'échange tient en un renommage. */
fs.mkdirSync(dossierCible, { recursive: true });
const nouvelle = cible + '.nouvelle';
fs.copyFileSync(construite, nouvelle);
fs.renameSync(nouvelle, cible);
powershell('$r = (New-Object -ComObject WScript.Shell).CreateShortcut(' + ps(raccourci) + '); $r.TargetPath = ' + ps(cible)
  + '; $r.WorkingDirectory = ' + ps(dossierCible) + '; $r.IconLocation = ' + ps(cible + ',0') + '; $r.Description = ' + ps('Sablier') + '; $r.Save()');
console.log('Installé : ' + cible + '\nRaccourci : ' + raccourci);
