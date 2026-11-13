'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');
const profileName = 'garh-jaisal-test';

for (const override of ['FLO_E2E_USER_DATA_DIR', 'FLO_E2E_DB_PATH']) {
  if (process.env[override]?.trim()) {
    console.error(
      `Refusing to start the Garh Jaisal test profile while ${override} is set. Clear the E2E override first.`,
    );
    process.exit(1);
  }
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npmCommand, ['run', 'dev'], {
  cwd: projectRoot,
  env: { ...process.env, FLO_PROFILE: profileName },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.once('error', (error) => {
  console.error('[Garh Jaisal test profile] Could not start the development app:', error);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`[Garh Jaisal test profile] Development app exited from signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
