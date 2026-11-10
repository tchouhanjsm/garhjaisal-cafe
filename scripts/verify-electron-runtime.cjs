#!/usr/bin/env node
// Cross-platform postinstall sanity check for the Electron development package.
// Verifies that node-abi resolves the installed Electron ABI on every platform;
// macOS also verifies the app bundle exists and is not quarantined.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function resolveElectronAbi(electronVersion) {
  const nodeAbi = require('node-abi');
  const abi = nodeAbi.getAbi(electronVersion, 'electron');
  if (!abi || !/^\d+$/.test(String(abi))) {
    throw new Error(`node-abi returned invalid ABI "${abi}" for Electron ${electronVersion}`);
  }
  return String(abi);
}

// macOS `xattr -p` exit semantics:
//   0                         -> attribute present (value on stdout)
//   1 + "No such xattr"       -> attribute absent (the documented clean state)
//   any other status / stderr -> unexpected failure (permission, tool missing,
//                                 I/O error, ...) and must NOT be treated as
//                                 clean (GHSA-wjr9-g33j-w22x).
function classifyQuarantine(status, stderr, stdout) {
  if (status === 0) {
    return { state: 'present', value: String(stdout || '') };
  }
  if (status === 1 && /no such xattr/i.test(String(stderr || ''))) {
    return { state: 'absent' };
  }
  return { state: 'error', message: String(stderr || '').trim() };
}

function readQuarantine(appPath, runCommand = execFileSync) {
  let stdout = '';
  try {
    stdout = runCommand('xattr', ['-p', 'com.apple.quarantine', appPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return classifyQuarantine(0, '', stdout);
  } catch (error) {
    return classifyQuarantine(error && error.status, error && error.stderr, '');
  }
}

function verifyElectronRuntime({
  cwd = process.cwd(),
  platform = process.platform,
  fileSystem = fs,
  resolveAbi = resolveElectronAbi,
  readQuarantineAttribute = readQuarantine,
  log = console.log,
} = {}) {
  const electronDir = path.join(cwd, 'node_modules', 'electron');
  if (!fileSystem.existsSync(electronDir)) {
    return { status: 'skipped', reason: 'Electron package is not installed' };
  }

  const electronPkgPath = path.join(electronDir, 'package.json');
  let electronVersion = null;
  let abi = null;
  if (fileSystem.existsSync(electronPkgPath)) {
    ({ version: electronVersion } = JSON.parse(fileSystem.readFileSync(electronPkgPath, 'utf8')));
    try {
      abi = resolveAbi(electronVersion);
    } catch (error) {
      throw new Error(
        `node-abi cannot resolve ABI for Electron ${electronVersion}: ${error && error.message ? error.message : String(error)}`,
      );
    }
    log(
      `verify-electron-runtime: Electron ${electronVersion} resolves to ABI ${abi} via node-abi.`,
    );
  }

  if (platform !== 'darwin') {
    return { status: 'verified', platform, version: electronVersion, abi };
  }

  const distDir = path.join(electronDir, 'dist');
  const app = fileSystem.existsSync(distDir)
    ? fileSystem
        .readdirSync(distDir, { withFileTypes: true })
        .find((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    : null;

  if (!app) {
    throw new Error('node_modules/electron is installed but no dist/*.app bundle was found.');
  }

  const appPath = path.join(distDir, app.name);
  const quarantine = readQuarantineAttribute(appPath);
  if (quarantine && quarantine.state === 'present') {
    throw new Error(`${appPath} is marked com.apple.quarantine (${quarantine.value.trim()}).`);
  }
  if (!quarantine || quarantine.state !== 'absent') {
    throw new Error(
      `could not read the quarantine attribute of ${appPath}: ${quarantine && quarantine.message ? quarantine.message : 'unexpected xattr failure'}`,
    );
  }

  log(
    `verify-electron-runtime: ${appPath} present and unquarantined; ` +
      'development runtime checks passed.',
  );
  return { status: 'verified', platform, version: electronVersion, abi, appPath };
}

function fail(message) {
  console.error(`::error::${message}`);
  console.error('Do NOT disable Gatekeeper system-wide to work around this.');
  console.error('Approved remediation: remove node_modules/electron and run npm install again.');
  process.exit(1);
}

function main() {
  try {
    verifyElectronRuntime();
  } catch (error) {
    fail(error && error.message ? error.message : String(error));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  classifyQuarantine,
  readQuarantine,
  resolveElectronAbi,
  verifyElectronRuntime,
};
