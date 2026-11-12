const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(projectRoot, 'main/index.ts'), 'utf8');
const dbSource = fs.readFileSync(path.join(projectRoot, 'main/db.ts'), 'utf8');

const start = mainSource.indexOf('function resolveLocalProfileName');
const end = mainSource.indexOf('\nconst localProfileName', start);
assert.ok(start >= 0 && end > start, 'profile resolver and selection are present');

const resolverSource = mainSource
  .slice(start, end)
  .replace(
    'function resolveLocalProfileName(value: string | undefined): string | null {',
    'function resolveLocalProfileName(value) {',
  );
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-profile-contract-'));
const resolverPath = path.join(tempDir, 'resolver.cjs');

try {
  const resolverScript = [
    "const assert = require('node:assert/strict');",
    resolverSource,
    "assert.equal(resolveLocalProfileName(undefined), null);",
    "assert.equal(resolveLocalProfileName(''), null);",
    "assert.equal(resolveLocalProfileName(' Pilot '), 'pilot');",
    "assert.equal(resolveLocalProfileName('dev-01'), 'dev-01');",
    "for (const value of ['../pilot', '/tmp/pilot', 'pilot/test', '.hidden', 'a'.repeat(33)]) {",
    "  assert.throws(() => resolveLocalProfileName(value), /Invalid FLO_PROFILE/);",
    "}",
  ].join(String.fromCharCode(10));
  fs.writeFileSync(resolverPath, resolverScript);

  const execution = spawnSync(process.execPath, [resolverPath], { encoding: 'utf8' });
  assert.equal(execution.status, 0, execution.stderr || 'profile resolver assertions pass');

  const logInitialization = mainSource.indexOf('log.initialize()');
  const profileSelection = mainSource.indexOf('function resolveLocalProfileName');
  const profilePathSelection = mainSource.indexOf("app.setPath('userData', profileDirectory)");
  assert.ok(
    profileSelection >= 0 && profileSelection < logInitialization,
    'profile resolves before log initialization',
  );
  assert.ok(
    profilePathSelection >= 0 && profilePathSelection < logInitialization,
    'profile userData path is selected before log initialization',
  );
  assert.match(
    mainSource,
    /app\.setPath\('userData', path\.resolve\(process\.env\.FLO_E2E_USER_DATA_DIR\)\)/,
  );
  assert.match(mainSource, /app\.requestSingleInstanceLock\(\)/);
  assert.doesNotMatch(
    mainSource,
    /singleInstanceLockOptions/,
    'do not pretend requestSingleInstanceLock supports a named lock',
  );
  assert.match(mainSource, /FLO_E2E_USER_DATA_DIR/);
  assert.match(mainSource, /FLO_PROFILE/);
  assert.match(
    dbSource,
    /const useUserData =[\s\S]*app\.isPackaged[\s\S]*hasLocalProfile/,
  );
  assert.match(dbSource, /const hasLocalProfile = Boolean/);
  assert.ok(dbSource.includes('process.env.FLO_E2E_USER_DATA_DIR'));
  assert.match(
    dbSource,
    /export function getBackupDir\(\): string[\s\S]*app\.getPath\('userData'\)/,
  );
  console.log('Local profile isolation contract passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
