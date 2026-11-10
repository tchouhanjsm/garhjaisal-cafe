/**
 * Menu Studio API: transactional catalog edits, stale-write rejection and audit history.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/menu-studio-api.test.ts
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-menu-studio-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-menu-studio';

const jwt = require('jsonwebtoken');
const {
  initTestDb,
  createApp,
  startServer,
  seedOwnerUser,
  seedCategory,
  seedProduct,
  api,
  assert,
  assertEqual,
  getResults,
  closeDatabase,
} = require('./helpers/test-setup');
const { getJWTSecret } = require('../main/routes/auth');
const { menuStudioRoutes } = require('../main/routes/menu-studio');

function readProduct(db: any, id: string) {
  return db
    .prepare(
      'SELECT id, name, category_id, price, is_active, updated_at FROM products WHERE id = ?',
    )
    .get(id) as any;
}

function expectedSnapshot(product: any) {
  return {
    name: product.name,
    category_id: product.category_id,
    price: Number(product.price),
    is_active: Number(product.is_active) === 1,
  };
}

async function main() {
  const db = initTestDb();
  const owner = seedOwnerUser(db);
  seedCategory(db, 'cat-menu-studio-food', 'Food');
  seedCategory(db, 'cat-menu-studio-drinks', 'Drinks');
  seedProduct(db, 'prod-menu-studio-a', 'cat-menu-studio-food', 'Paneer Tikka', 220);
  seedProduct(db, 'prod-menu-studio-b', 'cat-menu-studio-drinks', 'Masala Chai', 80);

  db.prepare(`
    INSERT INTO product_variants (id, product_id, name, price, is_active, sort_order, created_at, updated_at)
    VALUES ('var-menu-studio-a', 'prod-menu-studio-a', 'Half', 140, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run();

  const app = createApp({ '/api/menu-studio': menuStudioRoutes });
  const { baseUrl, server } = await startServer(app);
  const unauthorisedToken = jwt.sign(
    { userId: 'menu-studio-no-access', email: 'no-access@test.local', role: 'server' },
    getJWTSecret(),
    { expiresIn: '1h' },
  );

  try {
    const initialA = readProduct(db, 'prod-menu-studio-a');
    const initialB = readProduct(db, 'prod-menu-studio-b');

    let response = await api(baseUrl, '/api/menu-studio/updates', {
      method: 'POST',
      headers: owner.authHeader,
      body: {
        changes: [
          {
            id: initialA.id,
            expected_updated_at: initialA.updated_at,
            expected: expectedSnapshot(initialA),
            patch: { price: 240 },
          },
          {
            id: initialB.id,
            expected_updated_at: initialB.updated_at,
            expected: expectedSnapshot(initialB),
            patch: { is_active: false },
          },
        ],
      },
    });
    assertEqual(response.status, 200, 'a multi-product edit is accepted');
    assertEqual(response.data.updated_count, 2, 'both products are committed in one batch');
    assert(Boolean(response.data.batch_id), 'the batch receives a traceable batch ID');
    assertEqual(readProduct(db, initialA.id).price, 240, 'the base product price is updated');
    assertEqual(readProduct(db, initialB.id).is_active, 0, 'availability is updated');
    assertEqual(
      db.prepare('SELECT price FROM product_variants WHERE id = ?').get('var-menu-studio-a').price,
      140,
      'variant prices remain unchanged by a base-product edit',
    );

    const firstBatchAudit = db
      .prepare('SELECT * FROM menu_studio_audit_log WHERE batch_id = ? ORDER BY id')
      .all(response.data.batch_id) as any[];
    assertEqual(firstBatchAudit.length, 2, 'one audit entry is written for each changed product');
    assertEqual(
      firstBatchAudit[0].actor_user_id,
      owner.userId,
      'audit entries retain the acting user',
    );
    assertEqual(
      JSON.parse(firstBatchAudit[0].before_json).price,
      220,
      'audit stores the previous price',
    );
    assertEqual(
      JSON.parse(firstBatchAudit[0].after_json).price,
      240,
      'audit stores the resulting price',
    );
    assertEqual(
      firstBatchAudit[0].action,
      'price_updated',
      'price changes are classified in the audit',
    );

    const staleFirst = readProduct(db, initialA.id);
    const staleSecond = readProduct(db, initialB.id);
    db.prepare('UPDATE products SET price = ? WHERE id = ?').run(245, initialA.id);
    const auditCountBeforeStale = (
      db.prepare('SELECT COUNT(*) AS count FROM menu_studio_audit_log').get() as any
    ).count;

    response = await api(baseUrl, '/api/menu-studio/updates', {
      method: 'POST',
      headers: owner.authHeader,
      body: {
        changes: [
          {
            id: staleFirst.id,
            expected_updated_at: staleFirst.updated_at,
            expected: expectedSnapshot(staleFirst),
            patch: { price: 250 },
          },
          {
            id: staleSecond.id,
            expected_updated_at: staleSecond.updated_at,
            expected: expectedSnapshot(staleSecond),
            patch: { name: 'Chai' },
          },
        ],
      },
    });
    assertEqual(response.status, 409, 'a stale edit is rejected');
    assertEqual(response.data.code, 'stale_write', 'the stale conflict has a stable machine code');
    assertEqual(
      readProduct(db, staleFirst.id).price,
      245,
      'the newer concurrent price is preserved',
    );
    assertEqual(
      readProduct(db, staleSecond.id).name,
      staleSecond.name,
      'the rest of a stale batch is rolled back',
    );
    assertEqual(
      (db.prepare('SELECT COUNT(*) AS count FROM menu_studio_audit_log').get() as any).count,
      auditCountBeforeStale,
      'a rejected batch writes no partial audit entries',
    );

    response = await api(baseUrl, '/api/menu-studio/updates', {
      method: 'POST',
      headers: owner.authHeader,
      body: {
        changes: [
          {
            id: staleSecond.id,
            expected_updated_at: staleSecond.updated_at,
            expected: expectedSnapshot(staleSecond),
            patch: { variants: [{ name: 'Large', price: 300 }] },
          },
        ],
      },
    });
    assertEqual(
      response.status,
      400,
      'unsupported catalog fields cannot enter through Menu Studio',
    );
    assertEqual(
      readProduct(db, staleSecond.id).name,
      staleSecond.name,
      'an unsupported field leaves the catalog untouched',
    );

    response = await api(baseUrl, '/api/menu-studio/updates', {
      method: 'POST',
      headers: { Authorization: `Bearer ${unauthorisedToken}` },
      body: { changes: [] },
    });
    assertEqual(response.status, 403, 'catalog writers without catalog.manage are denied');

    response = await api(baseUrl, `/api/menu-studio/audit?product_id=${initialA.id}&limit=10`, {
      headers: owner.authHeader,
    });
    assertEqual(response.status, 200, 'audit history can be read');
    assert(
      response.data.entries.some((entry: any) => entry.product_id === initialA.id),
      'the product audit filter returns its edits',
    );
    assert(
      response.data.entries.some(
        (entry: any) => entry.before?.price === 220 && entry.after?.price === 240,
      ),
      'audit API returns parsed before and after snapshots',
    );

    response = await api(baseUrl, '/api/menu-studio/updates', {
      method: 'POST',
      headers: owner.authHeader,
      body: { changes: [] },
    });
    assertEqual(response.status, 400, 'empty edit batches are rejected');

    console.log('\n─── Menu Studio CSV export, preview and transactional apply ───');
    const formulaProductId = 'prod-menu-studio-csv-formula';
    seedProduct(db, formulaProductId, 'cat-menu-studio-food', '+CSV Formula Item', 35);
    const exportResponse = await (globalThis as any).fetch(
      baseUrl + '/api/menu-studio/csv/export',
      {
        headers: owner.authHeader,
      },
    );
    assertEqual(
      exportResponse.status,
      200,
      'Menu Studio CSV export is available to catalog managers',
    );
    const exportedCsv = await exportResponse.text();
    assert(
      exportedCsv.startsWith(
        'id,sku,name,category_id,price,is_active,updated_at,flo_csv_encoding',
      ),
      'Menu Studio CSV export includes stable identity and stale-write columns',
    );
    assert(
      exportedCsv.includes("'+CSV Formula Item"),
      'CSV export neutralizes spreadsheet formula-leading product names',
    );
    assert(
      exportedCsv.includes('quote-v1'),
      'CSV export carries the reversible formula-safety marker',
    );

    const formulaProduct = db.prepare(
      'SELECT id, sku, name, category_id, price, is_active, updated_at FROM products WHERE id = ?',
    ).get(formulaProductId) as any;
    const { toQuoteV1CsvRow, FLO_CSV_ENCODING_QUOTE_V1 } = require('../main/lib/csv');
    const importHeader = 'id,sku,name,category_id,price,is_active,updated_at,flo_csv_encoding';
    const previewCsv = [
      importHeader,
      toQuoteV1CsvRow([
        formulaProduct.id,
        formulaProduct.sku,
        formulaProduct.name,
        formulaProduct.category_id,
        39,
        'yes',
        formulaProduct.updated_at,
        FLO_CSV_ENCODING_QUOTE_V1,
      ]),
    ].join('\n');
    response = await api(baseUrl, '/api/menu-studio/csv/preview', {
      method: 'POST',
      headers: owner.authHeader,
      body: { csv: previewCsv },
    });
    assertEqual(response.status, 200, 'a valid Menu Studio CSV can be previewed');
    assertEqual(response.data.ready_count, 1, 'preview identifies one valid product change');
    assertEqual(response.data.error_count, 0, 'valid CSV preview has no row errors');
    assertEqual(
      readProduct(db, formulaProductId).price,
      35,
      'preview never mutates catalog values',
    );
    assertEqual(
      response.data.rows[0].before.name,
      '+CSV Formula Item',
      'quote-v1 preview restores formula-leading names without changing the item identity',
    );

    const csvApply = await api(baseUrl, '/api/menu-studio/updates', {
      method: 'POST',
      headers: owner.authHeader,
      body: { changes: response.data.changes },
    });
    assertEqual(
      csvApply.status,
      200,
      'previewed CSV updates use the transactional Menu Studio API',
    );
    assertEqual(readProduct(db, formulaProductId).price, 39, 'confirmed CSV price is saved');
    assertEqual(
      readProduct(db, formulaProductId).name,
      '+CSV Formula Item',
      'CSV apply preserves the original formula-leading product name',
    );

    const currentFormulaProduct = db.prepare(
      'SELECT id, sku, name, category_id, price, is_active, updated_at FROM products WHERE id = ?',
    ).get(formulaProductId) as any;
    const duplicateRow = toQuoteV1CsvRow([
      currentFormulaProduct.id,
      currentFormulaProduct.sku,
      currentFormulaProduct.name,
      currentFormulaProduct.category_id,
      40,
      'yes',
      currentFormulaProduct.updated_at,
      FLO_CSV_ENCODING_QUOTE_V1,
    ]);
    response = await api(baseUrl, '/api/menu-studio/csv/preview', {
      method: 'POST',
      headers: owner.authHeader,
      body: { csv: [importHeader, duplicateRow, duplicateRow].join('\n') },
    });
    assertEqual(response.status, 200, 'duplicate CSV rows return a reviewable preview');
    assertEqual(response.data.error_count, 1, 'duplicate product IDs are detected');
    assertEqual(response.data.can_apply, false, 'a CSV with any invalid row cannot be applied');
    assertEqual(
      readProduct(db, formulaProductId).price,
      39,
      'duplicate preview leaves catalog unchanged',
    );

    const staleCsv = [
      importHeader,
      toQuoteV1CsvRow([
        currentFormulaProduct.id,
        currentFormulaProduct.sku,
        currentFormulaProduct.name,
        currentFormulaProduct.category_id,
        41,
        'yes',
        currentFormulaProduct.updated_at,
        FLO_CSV_ENCODING_QUOTE_V1,
      ]),
    ].join('\n');
    db.prepare('UPDATE products SET price = ?, updated_at = ? WHERE id = ?').run(
      42,
      '2026-11-10 17:30:00',
      formulaProductId,
    );
    response = await api(baseUrl, '/api/menu-studio/csv/preview', {
      method: 'POST',
      headers: owner.authHeader,
      body: { csv: staleCsv },
    });
    assertEqual(response.data.error_count, 1, 'stale CSV rows are rejected during preview');
    assertEqual(response.data.can_apply, false, 'stale CSV preview cannot be applied');
    assertEqual(
      readProduct(db, formulaProductId).price,
      42,
      'stale CSV cannot overwrite a newer edit',
    );

    const results = getResults();
    console.log(`\nMenu Studio API: ${results.passed}/${results.total} checks passed.`);
    if (results.failed > 0) process.exitCode = 1;
  } finally {
    server.close();
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

main().catch((error: any) => {
  console.error(error);
  process.exit(1);
});
