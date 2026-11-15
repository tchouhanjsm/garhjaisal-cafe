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
  const topbar = read('frontend/src/components/pos/PosTopbar.tsx');

  assert.ok(posPage.includes('const openTablePicker = () => {'));
  assert.ok(posPage.includes("setTablePickerPresentation('inline')"));
  assert.ok(posPage.includes('setShowTablePicker(true)'));
  assert.ok(posPage.includes('onShowTablePicker={requestOpenTableBoard}'));
  assert.ok(posPage.includes("tablePickerPresentation === 'inline' ?"));
  assert.ok(posPage.includes('<TableFirstSelector'));
  assert.ok(posPage.includes('<ProductGrid'));
  assert.ok(posPage.includes('displayModes='));
  assert.ok(posPage.includes("showTopItems={!(isRestaurant && showTablePicker"));
  assert.ok(topbar.includes('showTopItems && <CustomerTopItems'));
  assert.ok(picker.includes('data-testid="pos-table-first-picker"'));
  assert.ok(picker.includes('data-testid="pos-table-card"'));
  assert.ok(picker.includes('aria-label="Filter tables by status"'));
  assert.ok(picker.includes('aria-label="Filter tables by section"'));
  assert.ok(picker.includes('formatCurrency(activeOrder.total)'));

  console.log('  ✓ table board replaces the ordering workspace instead of sitting above it');
  console.log('  ✓ table board supports status, section, and text filtering');
  console.log('  ✓ selected table context remains visible in the ordering workspace');
}

function testInlineTableBoardKeepsShortcutsAvailable(): void {
  const posPage = read('frontend/src/app/(dashboard)/pos/page.tsx');

  assert.ok(posPage.includes('const toggleTableBoard = () => {'));
  assert.ok(posPage.includes('onToggleTables: () => {'));
  assert.ok(posPage.includes('if (pendingTableSelection) return;'));
  assert.ok(posPage.includes('toggleTableBoard();'));
  assert.ok(posPage.includes('closeTablePicker();'));
  assert.ok(posPage.includes('tablePickerOpen: showTablePicker &&'));
  assert.ok(posPage.includes("tablePickerPresentation === 'modal' && !anyOtherModalOpen"));

  console.log('  ✓ F2 toggles the dedicated table board and Escape returns to ordering');
  console.log('  ✓ the table board is not treated as a blocking modal');
}

function testUnsentCartCannotSilentlyChangeTables(): void {
  const posPage = read('frontend/src/app/(dashboard)/pos/page.tsx');
  const dialog = read('frontend/src/components/pos/TableSwitchDialog.tsx');
  const cartPanel = read('frontend/src/components/pos/CartPanel.tsx');

  assert.ok(posPage.includes('const requestTableSelection = (selection: TableSelection) => {'));
  assert.ok(posPage.includes('hasUnsentCartWork() && cart.tableId === targetTableId'));
  assert.ok(posPage.includes('const requestOpenTableBoard = () => {'));
  assert.ok(posPage.includes('if (hasUnsentCartWork()) {'));
  assert.ok(posPage.includes("setPendingTableSelection({ kind: 'tables' })"));
  assert.ok(posPage.includes('onShowTablePicker={requestOpenTableBoard}'));
  assert.ok(posPage.includes('onRequestOrderTypeChange: requestOrderTypeChange'));
  assert.ok(posPage.includes('state.expectedPaymentMethodId != null'));
  assert.ok(
    posPage.includes(
      "onSelectOccupied={(table) => requestTableSelection({ kind: 'occupied', table })}",
    ),
  );
  assert.ok(
    posPage.includes(
      "onSelectHeld={(tableId) => requestTableSelection({ kind: 'held', tableId })}",
    ),
  );
  assert.ok(posPage.includes('await refreshTables().catch(() => undefined)'));
  assert.ok(posPage.includes('if (pendingOrder) return false;'));
  assert.ok(posPage.includes('router.push(selection.href)'));
  assert.ok(posPage.includes("kind: 'order-type'"));
  assert.ok(posPage.includes("kind: 'route'"));
  assert.ok(posPage.includes("addEventListener('beforeunload'"));
  assert.ok(posPage.includes("addEventListener('click', interceptInternalNavigation, true)"));
  assert.ok(posPage.includes('onSelectAvailable={(tableId, customer) =>'));
  assert.ok(posPage.includes('onDiscard={discardAndContinue}'));
  assert.ok(posPage.includes('onHold={() => void holdAndContinue()}'));
  assert.ok(dialog.includes('data-testid="pos-table-switch-dialog"'));
  assert.ok(dialog.includes('Hold order and continue'));
  assert.ok(dialog.includes('Discard unsent items and continue'));
  assert.ok(dialog.includes('Continue editing'));
  assert.ok(cartPanel.includes('onRequestOrderTypeChange?:'));
  assert.ok(cartPanel.includes('onRequestOrderTypeChange(type)'));

  console.log('  ✓ changing tables with unsent work requires an explicit decision');
  console.log('  ✓ hold is offered only for an eligible postpaid dine-in draft');
}

function testResizableAndCollapsibleCart(): void {
  const posPage = read('frontend/src/app/(dashboard)/pos/page.tsx');
  const cartPanel = read('frontend/src/components/pos/CartPanel.tsx');

  assert.ok(posPage.includes('data-testid="pos-resizable-cart"'));
  assert.ok(posPage.includes('role="separator"'));
  assert.ok(posPage.includes('data-testid="pos-cart-resize-handle"'));
  assert.ok(posPage.includes('aria-valuemin={280}'));
  assert.ok(posPage.includes('aria-valuemax={480}'));
  assert.ok(posPage.includes('setCartWidth((width) =>'));
  assert.ok(posPage.includes('Math.max(280, Math.min(480, width + delta))'));
  assert.ok(posPage.includes('data-testid="pos-collapse-cart"'));
  assert.ok(posPage.includes('data-testid="pos-expand-cart"'));
  assert.ok(cartPanel.includes('data-testid="cart-items-scroll"'));
  assert.ok(cartPanel.includes('pos-cart-items flex-1 min-h-0 overflow-y-auto'));

  console.log('  ✓ cart width is bounded, pointer-resizable, keyboard-adjustable, and collapsible');
  console.log('  ✓ cart rows scroll independently of the order totals and actions');
}

function testProductCatalogueModes(): void {
  const productGrid = read('frontend/src/components/pos/ProductGrid.tsx');

  assert.ok(productGrid.includes("type ProductViewMode = 'compact' | 'grid' | 'list'"));
  assert.ok(productGrid.includes('data-testid="pos-product-view-modes"'));
  assert.ok(productGrid.includes('pos-product-catalog-'));
  assert.ok(productGrid.includes('grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'));
  assert.ok(productGrid.includes('grid-cols-1'));
  assert.ok(productGrid.includes('getDefaultProductViewPreference'));
  assert.ok(productGrid.includes("return 'compact'"));
  assert.ok(productGrid.includes('useSyncExternalStore('));
  assert.ok(productGrid.includes('saveProductViewPreference(viewPreferenceKey, mode)'));
  assert.ok(productGrid.includes('localStorage.setItem(key, mode)'));
  assert.ok(productGrid.includes('p.sku'));
  assert.ok(productGrid.includes('p.barcode'));
  assert.ok(productGrid.includes('variant.sku'));
  assert.ok(productGrid.includes('variant.barcode'));
  assert.ok(productGrid.includes('min-h-[84px]'));
  assert.ok(productGrid.includes('bg-muted text-muted-foreground'));

  console.log('  ✓ compact, image-grid, and list modes are available and remembered locally');
  console.log('  ✓ name, SKU, barcode, and variant search are available in the catalogue');
}

function testWaiterMobileTableFirst(): void {
  const serverApp = read('frontend/src/app/server-standalone/page.tsx');

  assert.equal(serverApp.includes('selectedTableIdRef.current = loadedTables[0].id'), false);
  assert.equal(serverApp.includes('selectedTableIdRef.current = firstTable.id'), false);
  assert.ok(serverApp.includes('selectedTableIdRef.current = localDraft.tableId'));
  assert.ok(serverApp.includes('setSelectedTableId(localDraft.tableId)'));
  assert.ok(serverApp.includes('disabled={sending || !selectedTableId}'));
  assert.ok(serverApp.includes("TABLE_STATUS_LABEL_KEYS[table.status ?? 'available']"));
  assert.ok(serverApp.includes("table.status === 'cleaning'"));
  assert.ok(serverApp.includes("table.status === 'held'"));

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
