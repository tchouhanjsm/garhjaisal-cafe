/**
 * Regression coverage for GHSA-wjr9-g33j-w22x (CWE-754): the macOS Electron
 * runtime verifier must not treat unexpected `xattr` failures as a clean
 * quarantine check. Only the documented "attribute absent" result (exit 1
 * with "No such xattr") is an acceptable clean state.
 *
 * Development runtime verification intentionally does not require a code
 * signature. Production release artifacts are checked independently by the
 * release workflow.
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const {
  classifyQuarantine,
  readQuarantine,
  resolveElectronAbi,
  verifyElectronRuntime,
} = require('../scripts/verify-electron-runtime.cjs');

function createRuntimeFixture({
  electronInstalled = true,
  packageInstalled = true,
  distExists = true,
  appEntries = [{ name: 'Electron.app', isDirectory: () => true }],
} = {}) {
  const cwd = '/fixture/project';
  const electronDir = path.join(cwd, 'node_modules', 'electron');
  const packagePath = path.join(electronDir, 'package.json');
  const distDir = path.join(electronDir, 'dist');
  const existingPaths = new Set();

  if (electronInstalled) existingPaths.add(electronDir);
  if (packageInstalled) existingPaths.add(packagePath);
  if (distExists) existingPaths.add(distDir);

  const fileSystem = {
    existsSync(candidate) {
      return existingPaths.has(candidate);
    },
    readFileSync(candidate, encoding) {
      assert.equal(candidate, packagePath);
      assert.equal(encoding, 'utf8');
      return JSON.stringify({ version: '45.0.0' });
    },
    readdirSync(candidate, options) {
      assert.equal(candidate, distDir);
      assert.deepEqual(options, { withFileTypes: true });
      return appEntries;
    },
  };

  return { cwd, fileSystem };
}

function resolveFixtureAbi(version) {
  assert.equal(version, '45.0.0');
  return '140';
}

function verifyFixture(fixture, overrides = {}) {
  return verifyElectronRuntime({
    cwd: fixture.cwd,
    platform: 'darwin',
    fileSystem: fixture.fileSystem,
    resolveAbi: resolveFixtureAbi,
    readQuarantineAttribute: () => ({ state: 'absent' }),
    log: () => {},
    ...overrides,
  });
}

function assertRuntimeRejects(fixture, overrides, expectedMessage) {
  assert.throws(
    () => verifyFixture(fixture, overrides),
    expectedMessage,
  );
}

function returnPresentQuarantine() {
  return { state: 'present', value: '0083;1234567890;Electron' };
}

function returnQuarantineError() {
  return { state: 'error', message: 'Permission denied' };
}

function returnUnknownQuarantineState() {
  return { state: 'unknown' };
}

function rejectUnsupportedAbi() {
  throw new Error('unsupported Electron ABI');
}

function rejectMacQuarantineLookup() {
  throw new Error('macOS quarantine lookup must not run on Linux');
}

function throwOnRead(error) {
  return () => {
    throw error;
  };
}

function run() {
  console.log('Testing Electron development runtime quarantine and ABI verification...');

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

  const verifierSource = fs.readFileSync(
    path.join(__dirname, '../scripts/verify-electron-runtime.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    verifierSource,
    /\bcodesign\s+-dv\b/,
    'the development runtime verifier must not require code-signature metadata',
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

  // The command wrapper must check the Electron app's quarantine attribute specifically.
  const appPath = '/fixture/Electron.app';
  let invocation;
  const presentRead = readQuarantine(appPath, (command, args, options) => {
    invocation = { command, args, options };
    return '0083;1234567890;Electron';
  });
  assert.equal(presentRead.state, 'present');
  assert.deepEqual(invocation, {
    command: 'xattr',
    args: ['-p', 'com.apple.quarantine', appPath],
    options: { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  });

  const missingAttribute = Object.assign(new Error('attribute absent'), {
    status: 1,
    stderr: 'xattr: No such xattr: com.apple.quarantine',
  });
  const missingAttributeRead = readQuarantine(appPath, throwOnRead(missingAttribute));
  assert.equal(
    missingAttributeRead.state,
    'absent',
    'the documented missing-attribute response is clean',
  );

  const unexpectedAttributeError = Object.assign(new Error('permission denied'), {
    status: 1,
    stderr: 'xattr: Permission denied',
  });
  const failedAttributeRead = readQuarantine(appPath, throwOnRead(unexpectedAttributeError));
  assert.equal(
    failedAttributeRead.state,
    'error',
    'permission failures must remain fail-closed',
  );

  // No Electron package is a supported no-op during source-only installs.
  const missingPackage = createRuntimeFixture({ electronInstalled: false });
  assert.deepEqual(verifyFixture(missingPackage), {
    status: 'skipped',
    reason: 'Electron package is not installed',
  });

  // Non-macOS installs still validate ABI, but must not inspect macOS bundles.
  const nonMac = createRuntimeFixture({ distExists: false });
  const nonMacResult = verifyFixture(nonMac, {
    platform: 'linux',
    readQuarantineAttribute: rejectMacQuarantineLookup,
  });
  assert.deepEqual(nonMacResult, {
    status: 'verified',
    platform: 'linux',
    version: '45.0.0',
    abi: '140',
  });

  // macOS must fail when the Electron package has no app bundle.
  const missingBundle = createRuntimeFixture({ appEntries: [] });
  assertRuntimeRejects(missingBundle, {}, /no dist\/\*\.app bundle was found/);

  // A present quarantine attribute blocks the development runtime.
  const quarantined = createRuntimeFixture();
  assertRuntimeRejects(
    quarantined,
    { readQuarantineAttribute: returnPresentQuarantine },
    /marked com\.apple\.quarantine/,
  );

  // Unexpected lookup errors and unknown return states must fail closed.
  const failedQuarantine = createRuntimeFixture();
  assertRuntimeRejects(
    failedQuarantine,
    { readQuarantineAttribute: returnQuarantineError },
    /could not read the quarantine attribute.*Permission denied/,
  );
  assertRuntimeRejects(
    failedQuarantine,
    { readQuarantineAttribute: returnUnknownQuarantineState },
    /unexpected xattr failure/,
  );

  // ABI resolution failure is surfaced with the installed Electron version.
  assertRuntimeRejects(
    createRuntimeFixture(),
    { resolveAbi: rejectUnsupportedAbi },
    /node-abi cannot resolve ABI for Electron 45\.0\.0: unsupported Electron ABI/,
  );

  console.log('✅ Electron runtime quarantine, ABI, and full decision-path checks passed');
}

run();
