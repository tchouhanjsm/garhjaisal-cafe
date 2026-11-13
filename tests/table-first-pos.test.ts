/**
 * Table-first POS selection and occupied-table summary regression checks.
 *
 * Usage: ts-node --transpile-only -P tests/tsconfig.json tests/table-first-pos.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const { shouldAutoOpenTablePicker } = require('../frontend/src/lib/table-picker-auto-open');

function testFreshDineInSelection(): void {
  const eligible = {
    isRestaurant: true,
    tablesRequired: true,
    tableCount: 10,
    orderType: 'dine_in' as const,
    tableId: null,
    itemCount: 0,
    hasPendingOrder: false,
    isCheckoutOpen: false,
    alreadyPrompted: false,
  };

  assert.equal(shouldAutoOpenTablePicker(eligible), true);

  const blockedCases = [
    ['non-restaurant', { isRestaurant: false }],
    ['tables optional', { tablesRequired: false }],
    ['no tables', { tableCount: 0 }],
    ['takeaway', { orderType: 'takeaway' }],
    ['table already selected', { tableId: 'tbl-1' }],
    ['cart has items', { itemCount: 1 }],
    ['editing an order', { hasPendingOrder: true }],
    ['checkout is open', { isCheckoutOpen: true }],
    ['already prompted', { alreadyPrompted: true }],
  ] as const;

  for (const [label, override] of blockedCases) {
    assert.equal(
      shouldAutoOpenTablePicker({ ...eligible, ...override } as any),
      false,
      `table picker stays closed for ${label}`,
    );
  }

  console.log('  ✓ only a fresh, unassigned dine-in cart opens table selection');
}

function testInlineTableFirstPresentation(): void {
  const posPage = fs.readFileSync(
    path.join(ROOT, 'frontend/src/app/(dashboard)/pos/page.tsx'),
    'utf8',
  );
  const picker = fs.readFileSync(
    path.join(ROOT, 'frontend/src/components/pos/TablePickerModal.tsx'),
    'utf8',
  );

  assert.match(posPage, /setTablePickerPresentation\('inline'\);\s*setShowTablePicker\(true\);/);
  assert.match(posPage, /onShowTablePicker=\{openTablePicker\}/);
  assert.match(posPage, /presentation=\{tablePickerPresentation\}/);
  assert.match(picker, /data-testid=\{isInline \? 'pos-table-first-picker'/);
  assert.match(picker, /fixed inset-0 z-50/);
  assert.match(picker, /formatCurrency\(activeOrder\.total\)/);

  console.log('  ✓ first table selection is inline; manual switching remains modal');
  console.log('  ✓ occupied table cards show the active order total');
}

function testWaiterMobileTableFirst(): void {
  const serverApp = fs.readFileSync(
    path.join(ROOT, 'frontend/src/app/server-standalone/page.tsx'),
    'utf8',
  );

  assert.doesNotMatch(serverApp, /selectedTableIdRef\.current = loadedTables\[0\]\.id/);
  assert.doesNotMatch(serverApp, /selectedTableIdRef\.current = firstTable\.id/);
  assert.match(serverApp, /selectedTableIdRef\.current = localDraft\.tableId/);
  assert.match(serverApp, /setSelectedTableId\(localDraft\.tableId\)/);
  assert.match(serverApp, /disabled=\{sending \|\| !selectedTableId\}/);
  assert.match(serverApp, /TABLE_STATUS_LABEL_KEYS\[table\.status \?\? 'available'\]/);
  assert.match(serverApp, /table\.status === 'cleaning'/);
  assert.match(serverApp, /table\.status === 'held'/);

  console.log('  ✓ waiter mobile app requires an explicit usable table selection');
}

function main(): void {
  console.log('Table-first POS tests');
  testFreshDineInSelection();
  testInlineTableFirstPresentation();
  testWaiterMobileTableFirst();
  console.log('All table-first POS tests passed.');
}

main();
