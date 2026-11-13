/* Self-test on a disposable folder, never on the real data (npm run smoke): the same command on Mac and
   on Windows, where PowerShell does not know the VAR=value syntax. */
'use strict';
const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const dossier = process.platform === 'win32' ? path.join(os.tmpdir(), 'sablier-smoke') : '/tmp/sablier-smoke';
const env = { ...process.env, SABLIER_SMOKE: '1', SABLIER_DONNEES: dossier, SABLIER_CAPTURES: dossier };
const r = spawnSync('cargo', ['run', '--manifest-path', path.join(__dirname, '..', 'src-tauri', 'Cargo.toml')], { env, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
