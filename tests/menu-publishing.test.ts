const Module = require('module');
const originalLoad = Module._load;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-menu-publishing-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-menu-publishing';

const assert = require('node:assert/strict');
const {
  initTestDb,
  createApp,
  startServer,
  seedOwnerUser,
  seedCategory,
  seedProduct,
  api,
  closeDatabase,
} = require('./helpers/test-setup');
const { menuPublishingRoutes } = require('../main/routes/menu-publishing');

async function main() {
  const db = initTestDb();
  const owner = seedOwnerUser(db);
  seedCategory(db, 'cat-publish-food', 'Food');
  seedProduct(db, 'prod-publish-paneer', 'cat-publish-food', 'Paneer Tikka', 250);

  const stamp = new Date().toISOString();
  const upsertSetting = db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  );
  upsertSetting.run('business_name', "Garh Jaisal's Kitchen", stamp);

  db.prepare(
    'INSERT INTO addon_groups ' +
      '(id, name, description, is_required, min_selection, max_selection, is_active, sort_order, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('group-publish-size', 'Size', null, 0, 0, 2, 1, 0, stamp, stamp);
  db.prepare(
    'INSERT INTO addons ' +
      '(id, addon_group_id, name, price, is_active, sort_order, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('addon-publish-large', 'group-publish-size', 'Large', 30, 1, 0, stamp, stamp);
  db.prepare(
    'INSERT INTO product_variants ' +
      '(id, product_id, name, price, is_active, sort_order, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('variant-publish-half', 'prod-publish-paneer', 'Half', 150, 1, 0, stamp, stamp);
  db.prepare('INSERT INTO category_addon_groups (category_id, addon_group_id) VALUES (?, ?)').run(
    'cat-publish-food',
    'group-publish-size',
  );
  db.prepare('INSERT INTO addon_group_product (product_id, addon_group_id) VALUES (?, ?)').run(
    'prod-publish-paneer',
    'group-publish-size',
  );

  db.prepare(
    'UPDATE products SET track_inventory = 1, stock_quantity = 17, low_stock_threshold = 4, image_url = ? WHERE id = ?',
  ).run('data:image/png;base64,aGVsbG8=', 'prod-publish-paneer');
  db.prepare(
    'UPDATE product_variants SET track_inventory = 1, stock_quantity = 6 WHERE id = ?',
  ).run('variant-publish-half');
  db.prepare('UPDATE addons SET track_inventory = 1, stock_quantity = 9 WHERE id = ?').run(
    'addon-publish-large',
  );

  const app = createApp({ '/api/menu-publishing': menuPublishingRoutes });
  const started = await startServer(app);
  const baseUrl = started.baseUrl;
  const server = started.server;

  try {
    let response = await api(baseUrl, '/api/menu-publishing/export', { headers: owner.authHeader });
    assert.equal(response.status, 200, 'catalog managers can export a menu bundle');
    const bundle = response.data;
    assert.equal(bundle.format_version, 1, 'menu package has a versioned format');
    assert.equal(bundle.catalog.products.length, 1, 'menu bundle contains products');
    assert.equal(
      bundle.catalog.product_variants.length,
      1,
      'menu bundle contains product variants',
    );
    assert.equal(bundle.catalog.addons.length, 1, 'menu bundle contains add-ons');
    assert.equal(
      bundle.catalog.products[0].image_url,
      'data:image/png;base64,aGVsbG8=',
      'menu bundle includes product images',
    );

    // Simulate a Windows-only catalog record and a price changed after the Mac export.
    db.prepare('UPDATE products SET price = 270 WHERE id = ?').run('prod-publish-paneer');
    seedProduct(db, 'prod-publish-windows-only', 'cat-publish-food', 'Windows-only item', 95);

    response = await api(baseUrl, '/api/menu-publishing/preview', {
      method: 'POST',
      headers: owner.authHeader,
      body: bundle,
    });
    assert.equal(response.status, 200, 'Windows can preview a valid menu package');
    assert.equal(response.data.summary.products.updated, 1, 'preview identifies a changed product');
    assert.equal(
      response.data.summary.products.retained_on_windows,
      1,
      'preview identifies Windows-only products',
    );
    const previewId = response.data.preview_id;

    // A concurrent Windows edit after preview must make apply fail closed.
    db.prepare('UPDATE products SET price = 275 WHERE id = ?').run('prod-publish-paneer');
    response = await api(baseUrl, '/api/menu-publishing/apply', {
      method: 'POST',
      headers: owner.authHeader,
      body: { bundle, preview_id: previewId },
    });
    assert.equal(
      response.status,
      409,
      'a stale preview cannot overwrite a newer Windows menu edit',
    );
    assert.equal(
      response.data.code,
      'target_changed_after_preview',
      'stale preview has a stable conflict code',
    );
    assert.equal(
      db.prepare('SELECT price FROM products WHERE id = ?').get('prod-publish-paneer').price,
      275,
      'the newer Windows price remains untouched',
    );

    response = await api(baseUrl, '/api/menu-publishing/preview', {
      method: 'POST',
      headers: owner.authHeader,
      body: bundle,
    });
    assert.equal(
      response.status,
      200,
      'a fresh preview can be generated after reviewing the newer menu',
    );
    response = await api(baseUrl, '/api/menu-publishing/apply', {
      method: 'POST',
      headers: owner.authHeader,
      body: { bundle, preview_id: response.data.preview_id },
    });
    assert.equal(response.status, 200, 'an approved menu package is applied');
    assert.equal(response.data.success, true, 'apply returns success');
    assert.ok(
      typeof response.data.recovery_backup === 'string' &&
        response.data.recovery_backup.endsWith('.db'),
      'apply creates and reports a Windows recovery backup before updating the menu',
    );
    assert.equal(
      db.prepare('SELECT price FROM products WHERE id = ?').get('prod-publish-paneer').price,
      250,
      'approved source price is applied',
    );
    assert.equal(
      db.prepare('SELECT id FROM products WHERE id = ?').get('prod-publish-windows-only').id,
      'prod-publish-windows-only',
      'Windows-only catalog products are retained',
    );

    const productStock = db
      .prepare(
        'SELECT track_inventory, stock_quantity, low_stock_threshold FROM products WHERE id = ?',
      )
      .get('prod-publish-paneer');
    assert.equal(
      productStock.track_inventory,
      1,
      'product inventory tracking remains Windows-local',
    );
    assert.equal(productStock.stock_quantity, 17, 'product stock quantity remains Windows-local');
    assert.equal(
      productStock.low_stock_threshold,
      4,
      'product stock threshold remains Windows-local',
    );
    assert.equal(
      db
        .prepare('SELECT stock_quantity FROM product_variants WHERE id = ?')
        .get('variant-publish-half').stock_quantity,
      6,
      'variant stock remains Windows-local',
    );
    assert.equal(
      db.prepare('SELECT stock_quantity FROM addons WHERE id = ?').get('addon-publish-large')
        .stock_quantity,
      9,
      'add-on stock remains Windows-local',
    );
    assert.equal(
      db
        .prepare('SELECT COUNT(*) AS count FROM category_addon_groups WHERE category_id = ?')
        .get('cat-publish-food').count,
      1,
      'category-to-add-on assignments are preserved',
    );
    assert.equal(
      db
        .prepare('SELECT COUNT(*) AS count FROM addon_group_product WHERE product_id = ?')
        .get('prod-publish-paneer').count,
      1,
      'product-to-add-on assignments are preserved',
    );

    const audit = db
      .prepare(
        'SELECT event_type, outcome, details_json FROM auth_audit_log WHERE event_type = ? ORDER BY id DESC LIMIT 1',
      )
      .get('menu_publish');
    assert.equal(audit.event_type, 'menu_publish', 'publishing creates an audit event');
    assert.equal(audit.outcome, 'success', 'audit event records a successful publication');
    assert.equal(
      JSON.parse(audit.details_json).product_count,
      1,
      'audit event records catalog counts',
    );

    // The Windows menu is now baselined. A later manual edit is a drift conflict.
    db.prepare('UPDATE products SET price = 300 WHERE id = ?').run('prod-publish-paneer');
    response = await api(baseUrl, '/api/menu-publishing/preview', {
      method: 'POST',
      headers: owner.authHeader,
      body: bundle,
    });
    assert.equal(
      response.status,
      409,
      'manual Windows catalog edits block the next Mac publication',
    );
    assert.equal(
      response.data.code,
      'target_catalog_drift',
      'manual drift has a stable conflict code',
    );

    const mismatchedBundle = {
      ...bundle,
      source: { ...bundle.source, business_name: 'Different Restaurant' },
    };
    response = await api(baseUrl, '/api/menu-publishing/preview', {
      method: 'POST',
      headers: owner.authHeader,
      body: mismatchedBundle,
    });
    assert.equal(response.status, 409, 'a menu package for another restaurant is rejected');
    assert.equal(response.data.code, 'store_mismatch', 'store identity mismatch is explicit');

    console.log('Menu publishing API tests passed');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
