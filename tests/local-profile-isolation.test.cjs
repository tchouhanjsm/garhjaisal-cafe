const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(projectRoot, 'main/index.ts'), 'utf8');
const dbSource = fs.readFileSync(path.join(projectRoot, 'main/db.ts'), 'utf8');
const serverAppSource = fs.readFileSync(
  path.join(projectRoot, 'frontend/src/app/server-standalone/page.tsx'),
  'utf8',
);
const backupSource = fs.readFileSync(
  path.join(projectRoot, 'main/services/local-backup.ts'),
  'utf8',
);
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const profileLauncherSource = fs.readFileSync(
  path.join(projectRoot, 'scripts/dev/garh-jaisal-test.cjs'),
  'utf8',
);

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
const profileLogPathIndex = mainSource.indexOf('app.setAppLogsPath(isolatedLogsDirectory)');
assert.ok(
  profileLogPathIndex >= 0 && profileLogPathIndex < logInitializationIndex,
  'isolated profile logs must be selected before electron-log initializes',
);
assert.ok(
  mainSource.includes('process.env.FLO_E2E_USER_DATA_DIR') &&
    mainSource.includes('process.env.FLO_E2E_DB_PATH'),
  'native E2E data overrides must receive isolated logs',
);
assert.ok(
  backupSource.includes('process.env.FLO_PROFILE?.trim()') &&
    backupSource.includes('process.env.FLO_E2E_USER_DATA_DIR') &&
    backupSource.includes('process.env.FLO_E2E_DB_PATH'),
  'named profiles and E2E runs must receive isolated automatic backups',
);
assert.ok(
  backupSource.includes("path.join(app.getPath('userData'), 'FloCafe', 'Backups')"),
  'profile backups must be stored under the selected profile userData directory',
);
assert.equal(
  packageJson.scripts['dev:garh-jaisal-test'],
  'node scripts/dev/garh-jaisal-test.cjs',
  'the dedicated Garh Jaisal test-profile launcher must be available',
);
assert.ok(
  profileLauncherSource.includes("const profileName = 'garh-jaisal-test'") &&
    profileLauncherSource.includes('FLO_PROFILE: profileName'),
  'the Garh Jaisal test launcher must force the isolated test profile',
);
assert.ok(
  profileLauncherSource.includes('FLO_E2E_USER_DATA_DIR') &&
    profileLauncherSource.includes('FLO_E2E_DB_PATH'),
  'the test launcher must reject accidental E2E path overrides',
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

// The waiter app runs on a separate device and must never open the production
// SQLite file. Its only online data path is the authenticated LAN hub API;
// disconnected drafts and cached catalog snapshots stay in browser storage.
assert.ok(serverAppSource.includes('function createApi()'));
assert.ok(serverAppSource.includes('baseURL: window.location.origin'));
assert.ok(serverAppSource.includes("api.post('/api/auth/pin-login'"));
assert.ok(serverAppSource.includes('saveServerAppDraft(window.localStorage'));
assert.ok(
  !/better-sqlite3|node:sqlite|sqlite3|flo\.db/i.test(serverAppSource),
  'waiter browser code must not reference SQLite drivers or the production database file',
);

console.log('Local profile isolation contract passed');
