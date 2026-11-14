import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
let activeTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-migration-v129-garh-jaisal-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: true,
        getPath: () => activeTestDir,
        getVersion: () => 'test',
      },
    };
  }
  return originalLoad.apply(this, arguments as any);
};

const { MIGRATIONS, initDatabase, getDatabase, closeDatabase, now, upsertSettings } = require('../main/db');

function runProfileUpgrade(profile: string, shouldGrantManager: boolean): void {
  activeTestDir = fs.mkdtempSync(path.join(os.tmpdir(), `flo-migration-v129-${profile}-`));
  const v129 = MIGRATIONS.pop();
  assert.equal(v129?.version, 129, 'the fixture removes only migration v129');

  try {
    initDatabase();
    const db = getDatabase();
    const timestamp = now();
    db.prepare(
      'INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    ).run(
      'migration-v129-owner',
      'Migration Owner',
      `migration-v129-owner-${profile}@test.local`,
      'unused-test-hash',
      'owner',
      timestamp,
      timestamp,
    );
    upsertSettings({ setup_profile: profile });
    assert.equal(
      db.pragma('user_version', { simple: true }),
      128,
      'the fixture database is at v128 before the data migration',
    );
    closeDatabase();

    MIGRATIONS.push(v129);
    initDatabase();
    const grant = getDatabase()
      .prepare(
        "SELECT effect FROM role_permission_overrides WHERE role = 'manager' AND permission_id = 'cash.day-close'",
      )
      .get() as { effect: string } | undefined;

    assert.equal(
      grant?.effect,
      shouldGrantManager ? 'allow' : undefined,
      shouldGrantManager
        ? 'upgrading an existing Garh Jaisal profile grants Manager day-close'
        : 'other restaurant profiles do not receive the Manager day-close grant',
    );
    assert.equal(
      getDatabase().pragma('user_version', { simple: true }),
      129,
      'the upgrade records schema/data migration v129',
    );
  } finally {
    if (!MIGRATIONS.some((migration: any) => migration.version === 129)) MIGRATIONS.push(v129);
    closeDatabase();
    fs.rmSync(activeTestDir, { recursive: true, force: true });
  }
}

try {
  runProfileUpgrade('garh-jaisal', true);
  runProfileUpgrade('demo', false);
  console.log('Garh Jaisal v129 Manager day-close upgrade tests passed.');
} finally {
  Module._load = originalLoad;
}
