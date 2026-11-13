/* Auto-test sur un dossier jetable, jamais sur les vraies données (npm run smoke) : la même commande sur Mac et
   sous Windows, où PowerShell ne connaît pas la syntaxe VAR=valeur. */
'use strict';
const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const dossier = process.platform === 'win32' ? path.join(os.tmpdir(), 'sablier-smoke') : '/tmp/sablier-smoke';
const env = { ...process.env, SABLIER_SMOKE: '1', SABLIER_DONNEES: dossier, SABLIER_CAPTURES: dossier };
const r = spawnSync('cargo', ['run', '--manifest-path', path.join(__dirname, '..', 'src-tauri', 'Cargo.toml')], { env, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
