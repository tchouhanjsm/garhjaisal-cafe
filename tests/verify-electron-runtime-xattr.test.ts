/**
 * Regression coverage for GHSA-wjr9-g33j-w22x (CWE-754): the macOS Electron
 * runtime verifier must not treat unexpected `xattr` failures as a clean
 * quarantine check. Only the documented "attribute absent" result (exit 1
 * with "No such xattr") is an acceptable clean state.
 *
 * This exercises the pure classification function from the cross-platform
 * verifier, so it runs on every platform without needing `xattr`/`codesign`.
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const {
  classifyQuarantine,
  resolveElectronAbi,
  verifyElectronRuntime,
} = require('../scripts/verify-electron-runtime.cjs');

function run() {
  console.log('Testing Electron runtime xattr classification and ABI resolution...');

function createRuntimeOptions({
  appEntries = [{ name: 'Electron.app', isDirectory: () => true }],
  quarantine = { state: 'absent' },
} = {}) {
  const cwd = '/project';
  const electronDir = path.join(cwd, 'node_modules', 'electron');
  const packagePath = path.join(electronDir, 'package.json');
  const distDir = path.join(electronDir, 'dist');
  const appPath = path.join(distDir, 'Electron.app');

  return {
    cwd,
    platform: 'darwin',
    fileSystem: {
      existsSync(candidate) {
        return [electronDir, packagePath, distDir].includes(candidate);
      },
      readFileSync(candidate) {
        assert.equal(candidate, packagePath);
        return JSON.stringify({ version: '45.2.1' });
      },
      readdirSync(candidate) {
        assert.equal(candidate, distDir);
        return appEntries;
      },
    },
    resolveAbi(version) {
      assert.equal(version, '45.2.1');
      return '145';
    },
    readQuarantineAttribute(candidate) {
      assert.equal(candidate, appPath);
      return quarantine;
    },
    log() {},
  };
}

  const electronPkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../node_modules/electron/package.json'), 'utf8'),
  );
  assert.match(
    resolveElectronAbi(electronPkg.version),
    /^\d+$/,
    `resolveElectronAbi must resolve numeric ABI for installed Electron ${electronPkg.version}`,
  );
  assert.throws(
    () => resolveElectronAbi('999.0.0'),
    /Could not detect abi for version 999\.0\.0/,
    'resolveElectronAbi must throw when node-abi lacks a mapping for an unknown Electron version',
  );

  // Present attribute (exit 0, value on stdout) → must fail as quarantined.
  const present = classifyQuarantine(0, '', '0083;1234567890;Electron');
  assert.equal(present.state, 'present', 'exit 0 with stdout is "present"');
  assert.equal(present.value, '0083;1234567890;Electron', 'present value is captured from stdout');

  // Absent attribute (exit 1 + "No such xattr") → the only clean state.
  const absent = classifyQuarantine(1, 'xattr: No such xattr: com.apple.quarantine', '');
  assert.equal(absent.state, 'absent', 'exit 1 with "No such xattr" is "absent"');

  // Unexpected failure (exit 1 + permission denied) → must NOT be clean.
  const permissionDenied = classifyQuarantine(
    1,
    'xattr: [Errno 13] Permission denied: /path/Electron.app',
    '',
  );
  assert.equal(
    permissionDenied.state,
    'error',
    'exit 1 with a permission error is "error", not clean',
  );
  assert.match(
    permissionDenied.message,
    /Permission denied/,
    'permission error message is preserved',
  );

  // Unexpected failure (exit 1 + empty stderr) → must NOT be clean.
  const silentFailure = classifyQuarantine(1, '', '');
  assert.equal(
    silentFailure.state,
    'error',
    'exit 1 with no "No such xattr" stderr is "error", not clean',
  );

  // Missing tool (exit 127) → must NOT be clean.
  const missingTool = classifyQuarantine(127, 'xattr: command not found', '');
  assert.equal(missingTool.state, 'error', 'exit 127 (missing tool) is "error", not clean');


  const verifierSource = fs.readFileSync(
    path.join(__dirname, '../scripts/verify-electron-runtime.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    verifierSource,
    /execFileSync\(\s*['"]codesign['"]\s*,\s*\[\s*['"]-dv['"]/,
    'development runtime verification must not require codesign -dv metadata',
  );

  const cleanMacRuntime = verifyElectronRuntime(createRuntimeOptions());
  assert.equal(cleanMacRuntime.status, 'verified');
  assert.equal(cleanMacRuntime.platform, 'darwin');
  assert.equal(cleanMacRuntime.abi, '145');
  assert.equal(
    cleanMacRuntime.appPath,
    path.join('/project', 'node_modules', 'electron', 'dist', 'Electron.app'),
  );

  assert.throws(
    () =>
      verifyElectronRuntime(
        createRuntimeOptions({
          quarantine: { state: 'present', value: '0083;1234567890;Electron' },
        }),
      ),
    /marked com\.apple\.quarantine/,
    'a quarantined development bundle must fail verification',
  );
  assert.throws(
    () =>
      verifyElectronRuntime(
        createRuntimeOptions({
          quarantine: { state: 'error', message: 'Permission denied' },
        }),
      ),
    /could not read the quarantine attribute.*Permission denied/i,
    'an unexpected xattr failure must remain fail-closed',
  );
  assert.throws(
    () => verifyElectronRuntime(createRuntimeOptions({ appEntries: [] })),
    /no dist\/\*\.app bundle was found/,
    'a missing Electron app bundle must fail verification',
  );

  console.log('✅ Electron runtime verifier integration checks passed');
}

run();
