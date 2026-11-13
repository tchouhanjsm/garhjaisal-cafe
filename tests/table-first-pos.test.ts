/**
 * Table-first POS behavior and table picker presentation.
 *
 * Usage: ts-node --transpile-only -P tests/tsconfig.json tests/table-first-pos.test.ts
 */
import assert from 'node:assert/strict';
import path from 'node:path';

const { shouldAutoOpenTablePicker } = require('../frontend/src/lib/table-picker-auto-open');

function testTablePickerAutoOpenRules(): void {
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

  assert.equal(
    shouldAutoOpenTablePicker(eligible),
    true,
    'fresh dine-in service opens table selection',
  );

  const blockedCases = [
    ['non-restaurant', { isRestaurant: false }],
    ['tables optional', { tablesRequired: false }],
    ['no configured tables', { tableCount: 0 }],
    ['takeaway', { orderType: 'takeaway' }],
    ['table already selected', { tableId: 'tbl-1' }],
    ['draft already has items', { itemCount: 1 }],
    ['existing order is being edited', { hasPendingOrder: true }],
    ['table checkout is open', { isCheckoutOpen: true }],
    ['prompt already shown this cycle', { alreadyPrompted: true }],
  ] as const;

  for (const [label, override] of blockedCases) {
    assert.equal(
      shouldAutoOpenTablePicker({ ...eligible, ...override } as any),
      false,
      `does not auto-open for ${label}`,
    );
  }

  console.log('  ✓ table selection opens only for a fresh, unassigned dine-in order');
}

function testInlineAndModalTablePicker(): void {
  const root = path.join(__dirname, '..');
  const Module = require('module');
  const frontendRequire = Module.createRequire(path.join(root, 'frontend/package.json'));
  const moduleApi = require('module') as {
    _load: (...args: any[]) => any;
    _resolveFilename: (...args: any[]) => string;
  };
  const originalResolveFilename = moduleApi._resolveFilename;
  const originalLoad = moduleApi._load;

  moduleApi._resolveFilename = function (
    request: string,
    parent: any,
    isMain: boolean,
    options?: any,
  ) {
    const resolvedRequest = request.startsWith('@/') 
      ? path.resolve(root, 'frontend/src', request.slice(2))
      : request;
    return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
  };

  const React = frontendRequire('react');
  const ReactDOMServer = frontendRequire('react-dom/server');
  const mocks: Record<string, unknown> = {
    'use-intl': {
      useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
    },
    '@/store/held-orders': {
      useHeldOrdersStore: () => ({ hasHeldOrder: () => false }),
    },
    '@/hooks/useFormatCurrency': {
      useFormatCurrency: () => (amount: number) => `₹${Number(amount).toFixed(2)}`,
    },
    '@/components/tables/TableTurnoverBadge': {
      TableTurnoverBadge: () => null,
    },
    'lucide-react': { X: () => null },
  };

  moduleApi._load = function (request: string, parent: any, isMain: boolean) {
    if (request in mocks) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const TablePickerModal = require('../frontend/src/components/pos/TablePickerModal').default;
    const table = {
      id: 'tbl-1',
      name: 'Table 1',
      capacity: 4,
      status: 'occupied',
      kitchen_station_id: null,
      floor: 'Rooftop',
      section: 'Main',
      position_x: null,
      position_y: null,
      is_active: true,
      seated_at: null,
      current_order: { id: 101, order_number: '0101', total: 425 },
      activeOrder: null,
    };
    const pickerProps = {
      tables: [table],
      selectedTableId: null,
      onSelectAvailable: () => undefined,
      onSelectOccupied: () => undefined,
      onSelectHeld: () => undefined,
      onPlaceOrder: () => undefined,
      onHoldTable: () => undefined,
      onClose: () => undefined,
    };
    const renderPicker = (presentation?: 'modal' | 'inline') =>
      ReactDOMServer.renderToStaticMarkup(
        React.createElement(TablePickerModal, {
          ...pickerProps,
          ...(presentation ? { presentation } : {}),
        }),
      );

    const inlineMarkup = renderPicker('inline');
    assert.ok(
      inlineMarkup.includes('data-testid="pos-table-first-picker"'),
      'initial table selection renders as an inline region',
    );
    assert.ok(
      !inlineMarkup.includes('fixed inset-0'),
      'inline table selection does not create a blocking screen overlay',
    );
    assert.ok(
      !inlineMarkup.includes('aria-label="pos.close"'),
      'inline table selection cannot be dismissed before choosing a table',
    );

    const modalMarkup = renderPicker();
    assert.ok(
      modalMarkup.includes('data-testid="pos-table-picker-modal"'),
      'manual table switching keeps the modal presentation',
    );
    assert.ok(modalMarkup.includes('fixed inset-0'), 'manual table picker remains modal');

    for (const markup of [inlineMarkup, modalMarkup]) {
      assert.ok(markup.includes('Table 1'), 'renders the table');
      assert.ok(markup.includes('#0101'), 'renders the active order number');
      assert.ok(markup.includes('₹425.00'), 'renders the active order total');
    }

    console.log('  ✓ initial table selection is inline and manual table switching remains modal');
    console.log('  ✓ occupied table shows its active order number and total');
  } finally {
    moduleApi._load = originalLoad;
    moduleApi._resolveFilename = originalResolveFilename;
  }
}

function main(): void {
  console.log('Table-first POS tests');
  testTablePickerAutoOpenRules();
  testInlineAndModalTablePicker();
  console.log('All table-first POS tests passed.');
}

main();
