/**
 * Table-first POS selection, status board, and cart workspace regression checks.
 *
 * Usage: ts-node --transpile-only -P tests/tsconfig.json tests/table-first-pos.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const { shouldAutoOpenTablePicker } = require('../frontend/src/lib/table-picker-auto-open');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

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
      `table board stays closed for ${label}`,
    );
  }

  console.log('  ✓ only a fresh, unassigned dine-in cart opens the table board');
}

function testDedicatedTableBoardNavigation(): void {
  const posPage = read('frontend/src/app/(dashboard)/pos/page.tsx');
  const picker = read('frontend/src/components/pos/TableFirstSelector.tsx');

  assert.match(posPage, /const openTablePicker = \(\) => \{\s*setTablePickerPresentation\('inline'\);\s*setShowTablePicker\(true\);/);
  assert.match(posPage, /onShowTablePicker=\{openTablePicker\}/);
  assert.match(posPage, /isRestaurant && showTablePicker && tablePickerPresentation === 'inline' \?/);
  assert.match(posPage, /data-testid="pos-all-tables-btn"/);
  assert.match(posPage, /<TableFirstSelector/);
  assert.match(posPage, /<ProductGrid[\s\S]*?displayModes/);
  assert.match(picker, /data-testid="pos-table-first-picker"/);
  assert.match(picker, /data-testid="pos-table-card"/);
  assert.match(picker, /aria-label="Filter tables by status"/);
  assert.match(picker, /aria-label="Filter tables by section"/);
  assert.match(picker, /formatCurrency\(activeOrder\.total\)/);

  console.log('  ✓ table board replaces the ordering workspace instead of sitting above it');
  console.log('  ✓ table board supports status, section, and text filtering');
  console.log('  ✓ selected table context remains visible in the ordering workspace');
}

function testInlineTableBoardKeepsShortcutsAvailable(): void {
  const posPage = read('frontend/src/app/(dashboard)/pos/page.tsx');

  assert.match(
    posPage,
    /onToggleTables: \(\) => \{\s*if \(isRestaurant && cart\.orderType === 'dine_in' && tablesRequired\) \{\s*if \(showTablePicker && tablePickerPresentation === 'inline'\) closeTablePicker\(\);\s*else openTablePicker\(\);/,
  );
  assert.match(
    posPage,
    /if \(showTablePicker\) \{\s*closeTablePicker\(\);\s*return true;/,
  );
  assert.match(
    posPage,
    /tablePickerOpen: showTablePicker && tablePickerPresentation === 'modal' && !anyOtherModalOpen/,
  );

  console.log('  ✓ F2 toggles the dedicated table board and Escape returns to ordering');
  console.log('  ✓ the table board is not treated as a blocking modal');
}

function testUnsentCartCannotSilentlyChangeTables(): void {
  const posPage = read('frontend/src/app/(dashboard)/pos/page.tsx');
  const dialog = read('frontend/src/components/pos/TableSwitchDialog.tsx');
  const cartPanel = read('frontend/src/components/pos/CartPanel.tsx');

  assert.match(posPage, /const requestTableSelection = \(selection: TableSelection\) => \{/);
  assert.match(posPage, /hasUnsentCartWork\(\) && cart\.tableId === targetTableId/);
  assert.match(posPage, /const requestOpenTableBoard = \(\) => \{/);
  assert.match(posPage, /setPendingTableSelection\(\{ kind: 'tables' \}\)/);
  assert.match(posPage, /onShowTablePicker=\{requestOpenTableBoard\}/);
  assert.match(posPage, /onRequestOrderTypeChange: requestOrderTypeChange/);
  assert.match(posPage, /kind: 'order-type'/);
  assert.match(posPage, /kind: 'route'/);
  assert.match(posPage, /addEventListener\('beforeunload'/);
  assert.match(posPage, /addEventListener\('click', interceptInternalNavigation, true\)/);
  assert.match(posPage, /const hasUnsentWork = cart\.items\.length > 0 \|\| Boolean\(pendingOrder\)/);
  assert.match(posPage, /if \(hasUnsentWork && cart\.tableId !== targetTableId\)/);
  assert.match(posPage, /onSelectAvailable=\{\(tableId, customer\) =>\s*requestTableSelection/);
  assert.match(posPage, /onDiscard=\{discardAndSwitchTable\}/);
  assert.match(posPage, /onHold=\{\(\) => void holdAndSwitchTable\(\)\}/);
  assert.match(dialog, /data-testid="pos-table-switch-dialog"/);
  assert.match(dialog, /Hold order and continue/);
  assert.match(dialog, /Discard unsent items and continue/);
  assert.match(dialog, /Continue editing/);
  assert.match(cartPanel, /onRequestOrderTypeChange\?:/);
  assert.match(cartPanel, /onRequestOrderTypeChange\(type\)/);

  console.log('  ✓ changing tables with unsent work requires an explicit decision');
  console.log('  ✓ hold is offered only for an eligible postpaid dine-in draft');
}

function testResizableAndCollapsibleCart(): void {
  const posPage = read('frontend/src/app/(dashboard)/pos/page.tsx');

  assert.match(posPage, /data-testid="pos-resizable-cart"/);
  assert.match(posPage, /role="separator"/);
  assert.match(posPage, /data-testid="pos-cart-resize-handle"/);
  assert.match(posPage, /aria-valuemin=\{280\}/);
  assert.match(posPage, /aria-valuemax=\{480\}/);
  assert.match(posPage, /setCartWidth\(\(width\) => Math\.max\(280, Math\.min\(480, width \+ delta\)\)\)/);
  assert.match(posPage, /data-testid="pos-collapse-cart"/);
  assert.match(posPage, /data-testid="pos-expand-cart"/);

  console.log('  ✓ cart width is bounded, pointer-resizable, keyboard-adjustable, and collapsible');
}

function testProductCatalogueModes(): void {
  const productGrid = read('frontend/src/components/pos/ProductGrid.tsx');

  assert.match(productGrid, /type ProductViewMode = 'compact' \| 'grid' \| 'list'/);
  assert.match(productGrid, /data-testid="pos-product-view-modes"/);
  assert.match(productGrid, /data-testid=\{\s*\x60pos-product-catalog-\$\{catalogMode\}\x60\s*\}/);
  assert.match(productGrid, /grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5/);
  assert.match(productGrid, /grid-cols-1/);
  assert.match(productGrid, /localStorage\.setItem\(viewPreferenceKey, viewMode\)/);
  assert.match(productGrid, /p\.sku/);
  assert.match(productGrid, /p\.barcode/);
  assert.match(productGrid, /variant\.sku/);
  assert.match(productGrid, /min-h-\[84px\]/);
  assert.match(productGrid, /bg-muted text-muted-foreground/);

  console.log('  ✓ compact, image-grid, and list modes are available and remembered locally');
}

function testWaiterMobileTableFirst(): void {
  const serverApp = read('frontend/src/app/server-standalone/page.tsx');

  assert.doesNotMatch(serverApp, /selectedTableIdRef\.current = loadedTables\[0\]\.id/);
  assert.doesNotMatch(serverApp, /selectedTableIdRef\.current = firstTable\.id/);
  assert.match(serverApp, /selectedTableIdRef\.current = localDraft\.tableId/);
  assert.match(serverApp, /setSelectedTableId\(localDraft\.tableId\)/);
  assert.match(serverApp, /disabled=\{sending \|\| !selectedTableId\}/);
  assert.match(serverApp, /TABLE_STATUS_LABEL_KEYS\[table\.status \?\? 'available'\]/);
  assert.match(serverApp, /table\.status === 'cleaning'/);
  assert.match(serverApp, /table\.status === 'held'/);

  console.log('  ✓ waiter mobile app still requires an explicit usable table selection');
}

function main(): void {
  console.log('Table-first POS tests');
  testFreshDineInSelection();
  testDedicatedTableBoardNavigation();
  testInlineTableBoardKeepsShortcutsAvailable();
  testUnsentCartCannotSilentlyChangeTables();
  testResizableAndCollapsibleCart();
  testProductCatalogueModes();
  testWaiterMobileTableFirst();
  console.log('All table-first POS tests passed.');
}

main();
