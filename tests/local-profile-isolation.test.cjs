const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(projectRoot, 'main/index.ts'), 'utf8');
const dbSource = fs.readFileSync(path.join(projectRoot, 'main/db.ts'), 'utf8');

const profileResolverIndex = mainSource.indexOf('function resolveLocalProfileName');
const profilePathIndex = mainSource.indexOf("app.setPath('userData', profileDirectory)");
const logInitializationIndex = mainSource.indexOf('log.initialize()');

assert.ok(profileResolverIndex >= 0, 'profile name validation must exist');
assert.ok(
  mainSource.includes('/^[a-z0-9][a-z0-9-]{0,31}$/'),
  'profile names must be constrained to safe identifiers',
);
assert.ok(
  profileResolverIndex < logInitializationIndex,
  'profile selection must happen before log initialization',
);
assert.ok(
  profilePathIndex >= 0 && profilePathIndex < logInitializationIndex,
  'profile userData path must be selected before log initialization',
);
assert.ok(
  mainSource.includes("app.setPath('userData', path.resolve(process.env.FLO_E2E_USER_DATA_DIR))"),
  'native E2E userData override must remain supported',
);
assert.ok(
  mainSource.includes('app.requestSingleInstanceLock()'),
  'the normal Electron single-instance lock must remain enabled',
);
assert.ok(
  !mainSource.includes('singleInstanceLockOptions'),
  'the app must not claim Electron has a profile-specific lock option',
);

assert.ok(dbSource.includes('const useUserData = app.isPackaged || hasLocalProfile'));
assert.ok(dbSource.includes('const hasLocalProfile = Boolean('));
assert.ok(dbSource.includes('process.env.FLO_PROFILE?.trim()'));
assert.ok(dbSource.includes('process.env.FLO_E2E_USER_DATA_DIR'));
assert.ok(dbSource.includes("return path.join(userDataPath, 'flo.db')"));
assert.ok(
  dbSource.includes("return path.join(userDataPath, 'backups')"),
  'profile backups must use the same selected userData directory as the database',
);

console.log('Local profile isolation contract passed');
