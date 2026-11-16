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
      `table picker stays closed for ${label}`,
    );
  }

  console.log('  ✓ only a fresh, unassigned dine-in cart opens table selection');
}

function testDedicatedTableBoard(): void {
  const posPage = read('frontend/src/app/(dashboard)/pos/page.tsx');
  const picker = read('frontend/src/components/pos/TableFirstSelector.tsx');
  const topbar = read('frontend/src/components/pos/PosTopbar.tsx');

  assert.ok(posPage.includes("setTablePickerPresentation('inline')"));
  assert.ok(posPage.includes("tablePickerPresentation === 'inline' ?"));
  assert.ok(posPage.includes('<TableFirstSelector'));
  assert.ok(posPage.includes('<ProductGrid'));
  assert.ok(posPage.includes('onShowTablePicker={requestOpenTableBoard}'));
  assert.ok(posPage.includes('showTopItems={!(isRestaurant && showTablePicker'));
  assert.ok(topbar.includes('showTopItems && <CustomerTopItems'));
  assert.ok(picker.includes('data-testid="pos-table-first-picker"'));
  assert.ok(picker.includes('data-testid="pos-table-card"'));
  assert.ok(picker.includes('aria-label="Filter tables by status"'));
  assert.ok(picker.includes('aria-label="Filter tables by section"'));

  console.log('  ✓ All Tables is separate from the ordering workspace');
  console.log('  ✓ table board filters and ordering context remain available');
}

function testDraftNavigationProtection(): void {
  const posPage = read('frontend/src/app/(dashboard)/pos/page.tsx');
  const dialog = read('frontend/src/components/pos/TableSwitchDialog.tsx');
  const cartPanel = read('frontend/src/components/pos/CartPanel.tsx');

  assert.ok(posPage.includes('const hasUnsentCartWork = useCallback'));
  const itemGuardIndex = posPage.indexOf('if (state.items.length > 0) return true;');
  const existingOrderGuardIndex = posPage.indexOf('if (pendingOrder) return false;');
  assert.ok(itemGuardIndex >= 0 && itemGuardIndex < existingOrderGuardIndex);
  for (const fieldCheck of [
    'state.customerId != null',
    'state.customer != null',
    'state.customerSource != null',
    'state.guestCount > 1',
    'state.orderNotes.trim()',
    'state.roomNumber.trim()',
    'state.deliveryAddress.trim()',
    'state.deliveryNote.trim()',
    'state.scheduledFor.trim()',
    'state.expectedPaymentMethod.trim()',
    'state.expectedPaymentMethodId != null',
    'state.onlinePlatform.trim()',
    'state.externalOrderId.trim()',
    'state.waivedChargeIds.size > 0',
    'state.optedInChargeIds.size > 0',
  ]) {
    assert.ok(posPage.includes(fieldCheck), `draft guard must protect ${fieldCheck}`);
  }
  assert.ok(posPage.includes('if (pendingOrder) return false;'));
  assert.ok(posPage.includes('const requestTableSelection = (selection: TableSelection) => {'));
  assert.ok(posPage.includes('const requestOpenTableBoard = () => {'));
  assert.ok(posPage.includes('if (hasUnsentCartWork()) {'));
  assert.ok(posPage.includes("setPendingTableSelection({ kind: 'tables' })"));
  assert.ok(posPage.includes("kind: 'order-type'"));
  assert.ok(posPage.includes("kind: 'route'"));
  assert.ok(posPage.includes("addEventListener('beforeunload'"));
  assert.ok(posPage.includes("addEventListener('click', interceptInternalNavigation, true)"));
  assert.ok(posPage.includes('onShowTablePicker={requestOpenTableBoard}'));
  assert.ok(posPage.includes('onRequestOrderTypeChange: requestOrderTypeChange'));
  assert.ok(posPage.includes('onDiscard={discardAndContinue}'));
  assert.ok(posPage.includes('onHold={() => void holdAndContinue()}'));
  assert.ok(posPage.includes('await refreshTables().catch(() => undefined)'));
  assert.ok(posPage.includes('state.expectedPaymentMethodId != null'));
  assert.ok(dialog.includes('data-testid="pos-table-switch-dialog"'));
  assert.ok(dialog.includes('Hold order and continue'));
  assert.ok(dialog.includes('Discard unsent items and continue'));
  assert.ok(dialog.includes('Continue editing'));
  assert.ok(cartPanel.includes('onRequestOrderTypeChange?:'));
  assert.ok(cartPanel.includes('onRequestOrderTypeChange(type)'));

  console.log('  ✓ table, order-type, and route changes protect cart drafts');
  console.log('  ✓ submitted orders are not treated as unsent drafts');
}

function testCatalogueModesAndSearch(): void {
  const productGrid = read('frontend/src/components/pos/ProductGrid.tsx');

  assert.ok(productGrid.includes("type ProductViewMode = 'compact' | 'grid' | 'list'"));
  assert.ok(productGrid.includes('data-testid="pos-product-view-modes"'));
  assert.ok(productGrid.includes('grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'));
  assert.ok(productGrid.includes('grid-cols-1'));
  assert.ok(productGrid.includes('getDefaultProductViewPreference'));
  assert.ok(productGrid.includes('useSyncExternalStore('));
  assert.ok(productGrid.includes('localStorage.setItem(key, mode)'));
  assert.ok(productGrid.includes('p.sku'));
  assert.ok(productGrid.includes('p.barcode'));
  assert.ok(productGrid.includes('variant.sku'));
  assert.ok(productGrid.includes('variant.barcode'));
  assert.ok(productGrid.includes('min-h-[84px]'));
  assert.ok(productGrid.includes('bg-muted text-muted-foreground'));

  console.log('  ✓ compact, image-grid, and list modes persist locally');
  console.log('  ✓ name, SKU, barcode, and variant identifiers are searchable');
}

function testResizableCart(): void {
  const posPage = read('frontend/src/app/(dashboard)/pos/page.tsx');
  const cartPanel = read('frontend/src/components/pos/CartPanel.tsx');

  assert.ok(posPage.includes('data-testid="pos-resizable-cart"'));
  assert.ok(posPage.includes('role="separator"'));
  assert.ok(posPage.includes('aria-valuemin={280}'));
  assert.ok(posPage.includes('aria-valuemax={480}'));
  assert.ok(posPage.includes('data-testid="pos-cart-resize-handle"'));
  assert.ok(posPage.includes('data-testid="pos-collapse-cart"'));
  assert.ok(posPage.includes('data-testid="pos-expand-cart"'));
  assert.ok(cartPanel.includes('data-testid="cart-items-scroll"'));
  assert.ok(cartPanel.includes('pos-cart-items flex-1 min-h-0 overflow-y-auto'));

  console.log('  ✓ cart is accessible, resizable, collapsible, and independently scrollable');
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
  testDedicatedTableBoard();
  testDraftNavigationProtection();
  testCatalogueModesAndSearch();
  testResizableCart();
  testWaiterMobileTableFirst();
  console.log('All table-first POS tests passed.');
}

main();
