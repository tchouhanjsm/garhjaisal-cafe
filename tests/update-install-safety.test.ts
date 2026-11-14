import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-update-install-safety-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

const {
  initDatabase,
  getDatabase,
  closeDatabase,
  now,
  upsertSettings,
  localDateInTimezone,
  parseDbTimestamp,
  withDatabaseMaintenanceLock,
} = require('../main/db');
const { getUpdateInstallSafety } = require('../main/update-install-safety');

function insertOrder(status: string, createdAt = now(), updatedAt = createdAt): number {
  const result = getDatabase()
    .prepare(
      'INSERT INTO orders (order_number, status, subtotal, total, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?)',
    )
    .run(`SAFETY-${Math.random().toString(16).slice(2)}`, status, createdAt, updatedAt);
  return Number(result.lastInsertRowid);
}

function clearOperationalRows(): void {
  const db = getDatabase();
  db.exec('DELETE FROM refunds');
  db.exec('DELETE FROM cash_drawer_movements');
  db.exec('DELETE FROM cash_sessions');
  db.exec('DELETE FROM held_orders');
  db.exec('DELETE FROM order_items');
  db.exec('DELETE FROM bills');
  db.exec('DELETE FROM order_audit_log');
  db.exec('DELETE FROM orders');
  db.exec('DELETE FROM cash_closures');
}

function addDayClose(businessDate: string, closedAt: string): void {
  getDatabase()
    .prepare(
      `
        INSERT INTO cash_closures (
          scope, business_date, period_start, period_end,
          expected_cash_cents, counted_cash_cents, variance_cents,
          gross_collected_cents, refunded_cents, net_collected_cents,
          bill_count, refund_count, z_number, closed_by, created_at
        ) VALUES ('day', ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, 'update-safety-owner', ?)
      `,
    )
    .run(businessDate, closedAt, closedAt, Math.floor(Math.random() * 1_000_000) + 1, closedAt);
}

function plusSeconds(value: string, seconds: number): string {
  return new Date(parseDbTimestamp(value).getTime() + seconds * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '');
}

async function main(): Promise<void> {
  initDatabase();
  const db = getDatabase();
  const timestamp = now();
  db.prepare(
    'INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
  ).run(
    'update-safety-owner',
    'Update Safety Owner',
    'update-safety-owner@test.local',
    'unused-test-hash',
    'owner',
    timestamp,
    timestamp,
  );
  upsertSettings({
    country: 'IN',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    business_day_start_time: '00:00',
  });

  try {
    clearOperationalRows();
    assert.deepEqual(
      getUpdateInstallSafety(),
      { ok: true },
      'an initialized but idle restaurant can install an update',
    );

    db.prepare(
      'INSERT INTO cash_sessions (opened_by, opened_by_name, opened_at, opening_float_cents, status) VALUES (?, ?, ?, 0, ?)',
    ).run('update-safety-owner', 'Update Safety Owner', timestamp, 'open');
    assert.equal(
      (getUpdateInstallSafety() as any).code,
      'open-cash-shift',
      'an open cash shift blocks updater installation',
    );

    clearOperationalRows();
    insertOrder('pending');
    assert.equal(
      (getUpdateInstallSafety() as any).code,
      'active-orders',
      'an active order blocks updater installation',
    );

    clearOperationalRows();
    const completedOrder = insertOrder('completed');
    db.prepare(
      'INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, total, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(completedOrder, 'safety-product', 'Safety Product', 100, 1, 100, 100, 'pending', timestamp, timestamp);
    assert.equal(
      (getUpdateInstallSafety() as any).code,
      'pending-kitchen-work',
      'pending kitchen/KOT items block updater installation even if the parent order is terminal',
    );

    clearOperationalRows();
    db.prepare(
      'INSERT INTO held_orders (id, table_id, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('held-safety-order', 'T1', '[]', timestamp, timestamp);
    assert.equal(
      (getUpdateInstallSafety() as any).code,
      'held-orders',
      'a saved held order blocks updater installation',
    );

    clearOperationalRows();
    const unpaidOrder = insertOrder('completed');
    db.prepare(
      'INSERT INTO bills (bill_number, order_id, subtotal, total, paid_amount, balance, payment_status, payment_details, created_at, updated_at) VALUES (?, ?, 100, 100, 0, 100, ?, ?, ?, ?)',
    ).run('SAFETY-UNPAID', unpaidOrder, 'unpaid', '[]', timestamp, timestamp);
    assert.equal(
      (getUpdateInstallSafety() as any).code,
      'unsettled-bills',
      'an unsettled bill blocks updater installation',
    );

    clearOperationalRows();
    const dayOrder = insertOrder('completed', timestamp, timestamp);
    const currentBusinessDate = localDateInTimezone(
      parseDbTimestamp(timestamp),
      'Asia/Kolkata',
      '00:00',
    );
    const idleAfterCloseAt = plusSeconds(timestamp, 1);
    addDayClose(currentBusinessDate, idleAfterCloseAt);
    const afterClose = getUpdateInstallSafety(new Date(plusSeconds(timestamp, 3)));
    assert.deepEqual(
      afterClose,
      { ok: true },
      'completed activity is safe once the matching business day is closed',
    );

    db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(
      plusSeconds(timestamp, 2),
      dayOrder,
    );
    assert.equal(
      (getUpdateInstallSafety(new Date(plusSeconds(timestamp, 3))) as any).code,
      'business-day-open',
      'new activity after day-close reopens the installation safety gate',
    );

    clearOperationalRows();
    let releaseMaintenance: (() => void) | null = null;
    let markMaintenanceStarted: (() => void) | null = null;
    const maintenanceStarted = new Promise<void>((resolve) => {
      markMaintenanceStarted = resolve;
    });
    const maintenanceHold = new Promise<void>((resolve) => {
      releaseMaintenance = resolve;
    });
    const maintenance = withDatabaseMaintenanceLock(async () => {
      markMaintenanceStarted?.();
      await maintenanceHold;
    });
    await maintenanceStarted;
    assert.equal(
      (getUpdateInstallSafety() as any).code,
      'database-maintenance',
      'an active backup/restore maintenance lock blocks updater installation',
    );
    releaseMaintenance?.();
    await maintenance;

    console.log('Update installation safety tests passed.');
  } finally {
    closeDatabase();
    Module._load = originalLoad;
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
