import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import {
  createBackupUnlocked,
  getDatabase,
  getSettingValue,
  now,
  recordAuthAudit,
  throwIfDatabaseMaintenanceAborted,
  withDatabaseMaintenanceLock,
} from '../db';
import { getActiveCountryPack, hasConfiguredTaxCategories } from './tax';

type CatalogRow = Record<string, unknown>;
type CatalogPayload = {
  categories: CatalogRow[];
  products: CatalogRow[];
  addon_groups: CatalogRow[];
  addons: CatalogRow[];
  product_variants: CatalogRow[];
  category_addon_groups: CatalogRow[];
  addon_group_product: CatalogRow[];
};
type MenuBundle = {
  format_version: 1;
  source: { business_name: string; country: string; currency: string };
  catalog: CatalogPayload;
  fingerprint: string;
};
type PreviewRecord = {
  bundleFingerprint: string;
  targetFingerprint: string;
  userId: string;
  expiresAt: number;
};

export class MenuPublishError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'MenuPublishError';
  }
}

const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_DATA_URI_LENGTH = 50_000;
const MAX_ROWS = {
  categories: 500,
  products: 5000,
  addon_groups: 1000,
  addons: 5000,
  product_variants: 10000,
  category_addon_groups: 5000,
  addon_group_product: 20000,
};
const PREVIEW_TTL_MS = 10 * 60_000;
const MAX_PENDING_PREVIEWS = 100;
const previews = new Map<string, PreviewRecord>();
const SETTING_UPSERT_SQL =
  'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
  'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';

const FIELDS: Record<keyof CatalogPayload, string[]> = {
  categories: [
    'id',
    'name',
    'description',
    'image_url',
    'sort_order',
    'is_active',
    'parent_id',
    'slug',
    'color',
    'icon',
  ],
  products: [
    'id',
    'category_id',
    'name',
    'description',
    'price',
    'cost',
    'sku',
    'barcode',
    'sale_unit',
    'allow_fractional_quantity',
    'weight_precision',
    'image_url',
    'is_active',
    'sort_order',
    'tax_type',
    'tax_rate',
    'tax_category_id',
    'tax_behavior',
    'cb_percent',
    'tags',
    'dietary_tags',
  ],
  addon_groups: [
    'id',
    'name',
    'description',
    'is_required',
    'min_selection',
    'max_selection',
    'allow_multiple_quantities',
    'is_active',
    'sort_order',
  ],
  addons: [
    'id',
    'addon_group_id',
    'name',
    'price',
    'tax_category_id',
    'tax_behavior',
    'inherit_parent_tax_category',
    'is_active',
    'sort_order',
  ],
  product_variants: [
    'id',
    'product_id',
    'name',
    'sku',
    'barcode',
    'price',
    'online_price',
    'cost_price',
    'is_active',
    'sort_order',
  ],
  category_addon_groups: ['category_id', 'addon_group_id'],
  addon_group_product: ['product_id', 'addon_group_id'],
};

function pickFields(row: CatalogRow, fields: string[]): CatalogRow {
  const picked: CatalogRow = {};
  for (const field of fields) picked[field] = row[field] === undefined ? null : row[field];
  return picked;
}

function canonicalCatalog(catalog: CatalogPayload): CatalogPayload {
  const result = {} as CatalogPayload;
  for (const key of Object.keys(FIELDS) as (keyof CatalogPayload)[]) {
    result[key] = (catalog[key] || [])
      .map((row) => pickFields(row, FIELDS[key]))
      .sort((left, right) => {
        const leftKey =
          String(left.id ?? left.category_id ?? left.product_id ?? '') +
          ':' +
          String(left.addon_group_id ?? '');
        const rightKey =
          String(right.id ?? right.category_id ?? right.product_id ?? '') +
          ':' +
          String(right.addon_group_id ?? '');
        return leftKey.localeCompare(rightKey);
      });
  }
  return result;
}

function fingerprintCatalog(catalog: CatalogPayload): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalCatalog(catalog)))
    .digest('hex');
}

function readCatalog(): CatalogPayload {
  const db = getDatabase();
  return {
    categories: db
      .prepare(
        'SELECT id, name, description, image_url, sort_order, is_active, parent_id, slug, color, icon ' +
          'FROM categories WHERE deleted_at IS NULL ORDER BY id',
      )
      .all() as CatalogRow[],
    products: db
      .prepare(
        'SELECT id, category_id, name, description, price, cost, sku, barcode, sale_unit, ' +
          'allow_fractional_quantity, weight_precision, image_url, is_active, sort_order, tax_type, ' +
          'tax_rate, tax_category_id, tax_behavior, cb_percent, tags, dietary_tags ' +
          'FROM products WHERE deleted_at IS NULL ORDER BY id',
      )
      .all() as CatalogRow[],
    addon_groups: db
      .prepare(
        'SELECT id, name, description, is_required, min_selection, max_selection, ' +
          'allow_multiple_quantities, is_active, sort_order FROM addon_groups ORDER BY id',
      )
      .all() as CatalogRow[],
    addons: db
      .prepare(
        'SELECT id, addon_group_id, name, price, tax_category_id, tax_behavior, ' +
          'inherit_parent_tax_category, is_active, sort_order FROM addons ORDER BY id',
      )
      .all() as CatalogRow[],
    product_variants: db
      .prepare(
        'SELECT v.id, v.product_id, v.name, v.sku, v.barcode, v.price, v.online_price, v.cost_price, ' +
          'v.is_active, v.sort_order FROM product_variants v ' +
          'INNER JOIN products p ON p.id = v.product_id AND p.deleted_at IS NULL ORDER BY v.id',
      )
      .all() as CatalogRow[],
    category_addon_groups: db
      .prepare(
        'SELECT r.category_id, r.addon_group_id FROM category_addon_groups r ' +
          'INNER JOIN categories c ON c.id = r.category_id AND c.deleted_at IS NULL ' +
          'ORDER BY r.category_id, r.addon_group_id',
      )
      .all() as CatalogRow[],
    addon_group_product: db
      .prepare(
        'SELECT r.product_id, r.addon_group_id FROM addon_group_product r ' +
          'INNER JOIN products p ON p.id = r.product_id AND p.deleted_at IS NULL ' +
          'ORDER BY r.product_id, r.addon_group_id',
      )
      .all() as CatalogRow[],
  };
}

function currentStoreIdentity() {
  return {
    business_name: String(getSettingValue('business_name') || '').trim(),
    country: String(getSettingValue('country') || '')
      .trim()
      .toUpperCase(),
    currency: String(getSettingValue('currency') || '')
      .trim()
      .toUpperCase(),
  };
}

function cleanupPreviews(): void {
  const timestamp = Date.now();
  for (const [id, preview] of previews) {
    if (preview.expiresAt <= timestamp) previews.delete(id);
  }
  while (previews.size >= MAX_PENDING_PREVIEWS) {
    const oldest = previews.keys().next().value as string | undefined;
    if (!oldest) break;
    previews.delete(oldest);
  }
}

export function exportMenuBundle(): MenuBundle {
  const catalog = canonicalCatalog(readCatalog());
  const source = currentStoreIdentity();
  if (!source.business_name || !source.country || !source.currency) {
    throw new MenuPublishError(
      'Complete the restaurant identity and regional settings before publishing a menu.',
      409,
      'source_identity_incomplete',
    );
  }
  return {
    format_version: 1,
    source,
    catalog,
    fingerprint: fingerprintCatalog(catalog),
  };
}

function invalid(message: string, code = 'invalid_menu_bundle'): never {
  throw new MenuPublishError(message, 400, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 128) {
    invalid(field + ' must be a non-empty identifier.');
  }
  return value;
}

function requireName(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 120) {
    invalid(field + ' must contain between 1 and 120 characters.');
  }
  return value.trim();
}

function requireBoolean(value: unknown, field: string): void {
  if (value !== true && value !== false && value !== 0 && value !== 1) {
    invalid(field + ' must be a boolean value.');
  }
}

function requireNumber(value: unknown, field: string, maximum = 1_000_000_000): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    invalid(field + ' must be a finite non-negative number.');
  }
}

function validateImage(value: unknown, field: string): void {
  if (value === null || value === undefined || value === '') return;
  if (typeof value !== 'string' || value.length > MAX_IMAGE_DATA_URI_LENGTH) {
    invalid(field + ' exceeds the supported image size.');
  }
  if (
    value.startsWith('data:') &&
    !/^data:image\/(webp|png|jpeg|jpg);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)
  ) {
    invalid(field + ' contains an unsupported image data URI.');
  }
}

function normalizeAndValidateBundle(value: unknown): MenuBundle {
  if (
    !isRecord(value) ||
    value.format_version !== 1 ||
    !isRecord(value.source) ||
    !isRecord(value.catalog)
  ) {
    invalid('Unsupported menu package. Export the menu again from Menu Studio.');
  }

  const source = {
    business_name:
      typeof value.source.business_name === 'string' ? value.source.business_name.trim() : '',
    country:
      typeof value.source.country === 'string' ? value.source.country.trim().toUpperCase() : '',
    currency:
      typeof value.source.currency === 'string' ? value.source.currency.trim().toUpperCase() : '',
  };
  if (!source.business_name || !source.country || !source.currency) {
    invalid('The menu package is missing its restaurant identity.', 'source_identity_incomplete');
  }

  const catalog = {} as CatalogPayload;
  for (const key of Object.keys(FIELDS) as (keyof CatalogPayload)[]) {
    const rawRows = value.catalog[key];
    if (!Array.isArray(rawRows) || rawRows.length > MAX_ROWS[key]) {
      invalid('The ' + key + ' collection is missing or exceeds the supported row limit.');
    }
    catalog[key] = rawRows.map((rawRow, index) => {
      if (!isRecord(rawRow)) invalid(key + ' row ' + (index + 1) + ' is invalid.');
      return pickFields(rawRow, FIELDS[key]);
    });
  }

  const ids = (rows: CatalogRow[], key: string) => {
    const result = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const id = requireId(row[key], key + ' in row ' + (index + 1));
      if (result.has(id)) invalid('Duplicate ' + key + ': ' + id);
      result.add(id);
    }
    return result;
  };
  const categoryIds = ids(catalog.categories, 'id');
  const productIds = ids(catalog.products, 'id');
  const groupIds = ids(catalog.addon_groups, 'id');
  ids(catalog.addons, 'id');
  ids(catalog.product_variants, 'id');

  const categoryById = new Map(catalog.categories.map((row) => [String(row.id), row]));
  const siblingNames = new Set<string>();
  for (const [index, row] of catalog.categories.entries()) {
    requireName(row.name, 'Category name in row ' + (index + 1));
    requireBoolean(row.is_active, 'Category availability');
    if (row.parent_id !== null && row.parent_id !== undefined) {
      const parentId = String(row.parent_id);
      const parent = categoryById.get(parentId);
      if (!categoryIds.has(parentId) || !parent || String(parent.parent_id || '') !== '') {
        invalid(
          'Category hierarchy must contain at most two levels and every parent must be a root category.',
        );
      }
      if (parentId === String(row.id)) invalid('A category cannot be its own parent.');
    }
    const siblingKey =
      String(row.parent_id || '') + ':' + String(row.name).trim().toLocaleLowerCase();
    if (siblingNames.has(siblingKey))
      invalid('Category names must be unique within the same parent.');
    siblingNames.add(siblingKey);
    validateImage(row.image_url, 'Category image');
  }

  const validSaleUnits = new Set(['each', 'kg', 'g', 'lb', 'ml', 'cl', 'l', 'fl oz', 'oz']);
  for (const [index, row] of catalog.products.entries()) {
    requireName(row.name, 'Product name in row ' + (index + 1));
    requireBoolean(row.is_active, 'Product availability');
    requireNumber(row.price, 'Product price');
    if (row.cost !== null && row.cost !== undefined) requireNumber(row.cost, 'Product cost');
    if (
      row.category_id !== null &&
      row.category_id !== undefined &&
      !categoryIds.has(String(row.category_id))
    ) {
      invalid('A product refers to a category that is not in this menu package.');
    }
    if (
      row.sale_unit !== null &&
      row.sale_unit !== undefined &&
      !validSaleUnits.has(String(row.sale_unit))
    ) {
      invalid('A product has an unsupported sale unit.');
    }
    requireBoolean(row.allow_fractional_quantity, 'Product fractional-quantity setting');
    if (
      row.tax_behavior !== null &&
      row.tax_behavior !== undefined &&
      !['country_default', 'inclusive', 'exclusive', 'exempt'].includes(String(row.tax_behavior))
    ) {
      invalid('A product has an unsupported tax behavior.');
    }
    if (row.tax_rate !== null && row.tax_rate !== undefined)
      requireNumber(row.tax_rate, 'Product tax rate', 100);
    if (row.cb_percent !== null && row.cb_percent !== undefined)
      requireNumber(row.cb_percent, 'Product cashback percentage', 100);
    if (
      row.sort_order !== null &&
      row.sort_order !== undefined &&
      !Number.isInteger(row.sort_order)
    ) {
      invalid('A product has an invalid sort order.');
    }
    if (
      row.weight_precision !== null &&
      row.weight_precision !== undefined &&
      (!Number.isInteger(row.weight_precision) ||
        Number(row.weight_precision) < 0 ||
        Number(row.weight_precision) > 4)
    ) {
      invalid('A product has an invalid weight precision.');
    }
    validateImage(row.image_url, 'Product image');
  }

  for (const row of catalog.addon_groups) {
    requireName(row.name, 'Add-on group name');
    requireBoolean(row.is_active, 'Add-on group availability');
    requireBoolean(row.is_required, 'Add-on group required flag');
    if (
      !Number.isInteger(row.min_selection) ||
      Number(row.min_selection) < 0 ||
      !Number.isInteger(row.max_selection) ||
      Number(row.max_selection) < Number(row.min_selection)
    ) {
      invalid('An add-on group has invalid selection limits.');
    }
    if (
      row.sort_order !== null &&
      row.sort_order !== undefined &&
      !Number.isInteger(row.sort_order)
    ) {
      invalid('An add-on group has an invalid sort order.');
    }
  }

  for (const row of catalog.addons) {
    requireName(row.name, 'Add-on name');
    requireId(row.addon_group_id, 'Add-on group reference');
    if (!groupIds.has(String(row.addon_group_id))) invalid('An add-on refers to a missing group.');
    requireNumber(row.price, 'Add-on price');
    requireBoolean(row.is_active, 'Add-on availability');
    if (row.inherit_parent_tax_category !== null && row.inherit_parent_tax_category !== undefined) {
      requireBoolean(row.inherit_parent_tax_category, 'Add-on tax inheritance');
    }
    if (
      row.tax_behavior !== null &&
      row.tax_behavior !== undefined &&
      !['country_default', 'inclusive', 'exclusive', 'exempt'].includes(String(row.tax_behavior))
    ) {
      invalid('An add-on has an unsupported tax behavior.');
    }
  }

  for (const group of catalog.addon_groups) {
    const activeCount = catalog.addons.filter(
      (addon) =>
        addon.addon_group_id === group.id && (addon.is_active === true || addon.is_active === 1),
    ).length;
    if (
      (group.is_active === true || group.is_active === 1) &&
      Number(group.min_selection) > activeCount
    ) {
      invalid('An active add-on group requires more selections than its active add-ons provide.');
    }
  }

  for (const row of catalog.product_variants) {
    requireName(row.name, 'Variant name');
    requireId(row.product_id, 'Variant product reference');
    if (!productIds.has(String(row.product_id))) invalid('A variant refers to a missing product.');
    requireNumber(row.price, 'Variant price');
    if (row.online_price !== null && row.online_price !== undefined)
      requireNumber(row.online_price, 'Variant online price');
    if (row.cost_price !== null && row.cost_price !== undefined)
      requireNumber(row.cost_price, 'Variant cost price');
    requireBoolean(row.is_active, 'Variant availability');
  }

  for (const row of catalog.category_addon_groups) {
    requireId(row.category_id, 'Category add-on link');
    requireId(row.addon_group_id, 'Category add-on group link');
    if (!categoryIds.has(String(row.category_id)) || !groupIds.has(String(row.addon_group_id))) {
      invalid('A category add-on assignment refers to a missing record.');
    }
  }

  for (const row of catalog.addon_group_product) {
    requireId(row.product_id, 'Product add-on link');
    requireId(row.addon_group_id, 'Product add-on group link');
    if (!productIds.has(String(row.product_id)) || !groupIds.has(String(row.addon_group_id))) {
      invalid('A product add-on assignment refers to a missing record.');
    }
  }

  const normalized = canonicalCatalog(catalog);
  const computedFingerprint = fingerprintCatalog(normalized);
  if (typeof value.fingerprint !== 'string' || value.fingerprint !== computedFingerprint) {
    invalid('The menu package fingerprint does not match its contents.', 'fingerprint_mismatch');
  }

  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_BUNDLE_BYTES) {
    invalid(
      'The menu package is too large. Reduce the number or size of product images.',
      'bundle_too_large',
    );
  }

  return {
    format_version: 1,
    source,
    catalog: normalized,
    fingerprint: computedFingerprint,
  };
}

function assertSameStore(source: MenuBundle['source']): void {
  const target = currentStoreIdentity();
  if (!target.business_name || !target.country || !target.currency) {
    throw new MenuPublishError(
      'The Windows restaurant identity is incomplete. Complete its setup before publishing.',
      409,
      'target_identity_incomplete',
    );
  }
  if (
    source.business_name.trim().toLowerCase() !== target.business_name.trim().toLowerCase() ||
    source.country !== target.country ||
    source.currency !== target.currency
  ) {
    throw new MenuPublishError(
      'This menu package does not match the Windows restaurant name, country and currency.',
      409,
      'store_mismatch',
    );
  }
}

function assertTaxCategories(catalog: CatalogPayload): void {
  const referenced = new Set<string>();
  for (const row of catalog.products)
    if (row.tax_category_id) referenced.add(String(row.tax_category_id));
  for (const row of catalog.addons)
    if (row.tax_category_id) referenced.add(String(row.tax_category_id));
  if (referenced.size === 0) return;

  try {
    const country = String(getSettingValue('country') || '');
    const businessType = String(getSettingValue('business_type') || 'restaurant');
    const pack = getActiveCountryPack(country);
    if (!hasConfiguredTaxCategories(pack, businessType)) {
      throw new Error('Windows tax categories are not configured.');
    }
    const allowed = new Set(pack.categories.map((category) => category.id));
    for (const id of referenced) {
      if (!allowed.has(id))
        throw new Error('Windows tax pack does not contain category ' + id + '.');
    }
  } catch (error) {
    throw new MenuPublishError(
      error instanceof Error ? error.message : 'Windows tax configuration is incompatible.',
      409,
      'tax_configuration_mismatch',
    );
  }
}

function entitySummary(incoming: CatalogRow[], existing: CatalogRow[], key: string) {
  const current = new Map(existing.map((row) => [String(row[key]), row]));
  const incomingIds = new Set(incoming.map((row) => String(row[key])));
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const row of incoming) {
    const before = current.get(String(row[key]));
    if (!before) created++;
    else if (JSON.stringify(pickFields(before, Object.keys(row))) === JSON.stringify(row))
      unchanged++;
    else updated++;
  }
  return {
    incoming: incoming.length,
    created,
    updated,
    unchanged,
    retained_on_windows: existing.filter((row) => !incomingIds.has(String(row[key]))).length,
  };
}

export function previewMenuPublish(input: unknown, userId: string) {
  const bundle = normalizeAndValidateBundle(input);
  assertSameStore(bundle.source);
  assertTaxCategories(bundle.catalog);

  const currentCatalog = canonicalCatalog(readCatalog());
  const targetFingerprint = fingerprintCatalog(currentCatalog);
  const baseline = String(getSettingValue('menu_publish_baseline_fingerprint') || '');
  if (baseline && baseline !== targetFingerprint) {
    throw new MenuPublishError(
      'The Windows menu has changed since the previous Mac publication. Review the Windows menu before publishing again.',
      409,
      'target_catalog_drift',
    );
  }

  cleanupPreviews();
  const previewId = randomUUID();
  previews.set(previewId, {
    bundleFingerprint: bundle.fingerprint,
    targetFingerprint,
    userId,
    expiresAt: Date.now() + PREVIEW_TTL_MS,
  });

  return {
    preview_id: previewId,
    expires_in_seconds: Math.floor(PREVIEW_TTL_MS / 1000),
    source_fingerprint: bundle.fingerprint,
    target_fingerprint: targetFingerprint,
    summary: {
      categories: entitySummary(bundle.catalog.categories, currentCatalog.categories, 'id'),
      products: entitySummary(bundle.catalog.products, currentCatalog.products, 'id'),
      addon_groups: entitySummary(bundle.catalog.addon_groups, currentCatalog.addon_groups, 'id'),
      addons: entitySummary(bundle.catalog.addons, currentCatalog.addons, 'id'),
      variants: entitySummary(
        bundle.catalog.product_variants,
        currentCatalog.product_variants,
        'id',
      ),
    },
    policy: {
      deletions_applied: false,
      windows_only_records_preserved: true,
      stock_quantities_preserved: true,
      operational_records_changed: false,
    },
  };
}

function upsertRows(
  table: string,
  columns: string[],
  updateColumns: string[],
  rows: CatalogRow[],
): void {
  if (rows.length === 0) return;
  const db = getDatabase();
  const placeholders = columns.map(() => '?').join(', ');
  const updates = updateColumns.map((column) => column + ' = excluded.' + column).join(', ');
  const sql =
    'INSERT INTO ' +
    table +
    ' (' +
    columns.join(', ') +
    ') VALUES (' +
    placeholders +
    ') ON CONFLICT(id) DO UPDATE SET ' +
    updates;
  const statement = db.prepare(sql);
  for (const row of rows) statement.run(...columns.map((column) => row[column] ?? null));
}

function syncRelations(
  table: string,
  ownerColumn: string,
  ownerIds: string[],
  relationRows: CatalogRow[],
  otherColumn: string,
): void {
  if (ownerIds.length === 0) return;
  const db = getDatabase();
  const remove = db.prepare('DELETE FROM ' + table + ' WHERE ' + ownerColumn + ' = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO ' + table + ' (' + ownerColumn + ', ' + otherColumn + ') VALUES (?, ?)',
  );
  for (const ownerId of ownerIds) remove.run(ownerId);
  for (const row of relationRows) insert.run(row[ownerColumn], row[otherColumn]);
}

export function applyMenuPublish(input: unknown, previewId: unknown, userId: string) {
  const bundle = normalizeAndValidateBundle(input);
  if (typeof previewId !== 'string' || !previewId) {
    throw new MenuPublishError(
      'A valid menu preview is required before publishing.',
      400,
      'preview_required',
    );
  }
  const preview = previews.get(previewId);
  if (!preview || preview.expiresAt <= Date.now()) {
    previews.delete(previewId);
    throw new MenuPublishError(
      'The menu preview expired. Generate a new preview.',
      409,
      'preview_expired',
    );
  }
  if (preview.userId !== userId || preview.bundleFingerprint !== bundle.fingerprint) {
    throw new MenuPublishError(
      'The menu package or publishing user changed after preview.',
      409,
      'preview_mismatch',
    );
  }

  assertSameStore(bundle.source);
  assertTaxCategories(bundle.catalog);
  const db = getDatabase();
  const currentFingerprint = fingerprintCatalog(canonicalCatalog(readCatalog()));
  if (currentFingerprint !== preview.targetFingerprint) {
    previews.delete(previewId);
    throw new MenuPublishError(
      'The Windows menu changed after preview. No changes were applied; generate a new preview.',
      409,
      'target_changed_after_preview',
    );
  }
  const baseline = String(getSettingValue('menu_publish_baseline_fingerprint') || '');
  if (baseline && baseline !== currentFingerprint) {
    previews.delete(previewId);
    throw new MenuPublishError(
      'The Windows menu has changed since the previous Mac publication.',
      409,
      'target_catalog_drift',
    );
  }

  let resultFingerprint = '';
  db.transaction(() => {
    const stamp = now();
    const categoryColumns = [
      'id',
      'name',
      'description',
      'image_url',
      'sort_order',
      'is_active',
      'parent_id',
      'slug',
      'color',
      'icon',
      'created_at',
      'updated_at',
    ];
    upsertRows(
      'categories',
      categoryColumns,
      categoryColumns.filter((column) => !['id', 'created_at'].includes(column)),
      [...bundle.catalog.categories]
        .sort((left, right) => Number(Boolean(left.parent_id)) - Number(Boolean(right.parent_id)))
        .map((row) => ({ ...row, created_at: stamp, updated_at: stamp })),
    );
    const clearDeletedCategory = db.prepare('UPDATE categories SET deleted_at = NULL WHERE id = ?');
    for (const row of bundle.catalog.categories) clearDeletedCategory.run(row.id);

    const productColumns = [
      'id',
      'category_id',
      'name',
      'description',
      'price',
      'cost',
      'sku',
      'barcode',
      'sale_unit',
      'allow_fractional_quantity',
      'weight_precision',
      'image_url',
      'is_active',
      'sort_order',
      'tax_type',
      'tax_rate',
      'tax_category_id',
      'tax_behavior',
      'cb_percent',
      'tags',
      'dietary_tags',
      'created_at',
      'updated_at',
    ];
    upsertRows(
      'products',
      productColumns,
      productColumns.filter((column) => !['id', 'created_at'].includes(column)),
      bundle.catalog.products.map((row) => ({ ...row, created_at: stamp, updated_at: stamp })),
    );
    const clearDeletedProduct = db.prepare('UPDATE products SET deleted_at = NULL WHERE id = ?');
    for (const row of bundle.catalog.products) clearDeletedProduct.run(row.id);

    const groupColumns = [
      'id',
      'name',
      'description',
      'is_required',
      'min_selection',
      'max_selection',
      'allow_multiple_quantities',
      'is_active',
      'sort_order',
      'created_at',
      'updated_at',
    ];
    upsertRows(
      'addon_groups',
      groupColumns,
      groupColumns.filter((column) => !['id', 'created_at'].includes(column)),
      bundle.catalog.addon_groups.map((row) => ({ ...row, created_at: stamp, updated_at: stamp })),
    );
    const addonColumns = [
      'id',
      'addon_group_id',
      'name',
      'price',
      'tax_category_id',
      'tax_behavior',
      'inherit_parent_tax_category',
      'is_active',
      'sort_order',
      'created_at',
      'updated_at',
    ];
    upsertRows(
      'addons',
      addonColumns,
      addonColumns.filter((column) => !['id', 'created_at'].includes(column)),
      bundle.catalog.addons.map((row) => ({ ...row, created_at: stamp, updated_at: stamp })),
    );
    const variantColumns = [
      'id',
      'product_id',
      'name',
      'sku',
      'barcode',
      'price',
      'online_price',
      'cost_price',
      'is_active',
      'sort_order',
      'created_at',
      'updated_at',
    ];
    upsertRows(
      'product_variants',
      variantColumns,
      variantColumns.filter((column) => !['id', 'created_at'].includes(column)),
      bundle.catalog.product_variants.map((row) => ({
        ...row,
        created_at: stamp,
        updated_at: stamp,
      })),
    );

    syncRelations(
      'category_addon_groups',
      'category_id',
      bundle.catalog.categories.map((row) => String(row.id)),
      bundle.catalog.category_addon_groups,
      'addon_group_id',
    );
    syncRelations(
      'addon_group_product',
      'product_id',
      bundle.catalog.products.map((row) => String(row.id)),
      bundle.catalog.addon_group_product,
      'addon_group_id',
    );

    resultFingerprint = fingerprintCatalog(canonicalCatalog(readCatalog()));
    const upsertSetting = db.prepare(SETTING_UPSERT_SQL);
    upsertSetting.run('menu_publish_baseline_fingerprint', resultFingerprint, stamp);
    upsertSetting.run('menu_publish_last_source_fingerprint', bundle.fingerprint, stamp);
    upsertSetting.run('menu_publish_last_published_at', stamp, stamp);
    upsertSetting.run('menu_publish_last_published_by', userId, stamp);
    recordAuthAudit(db, {
      userId,
      eventType: 'menu_publish',
      outcome: 'success',
      details: {
        source_fingerprint: bundle.fingerprint,
        applied_fingerprint: resultFingerprint,
        category_count: bundle.catalog.categories.length,
        product_count: bundle.catalog.products.length,
        addon_group_count: bundle.catalog.addon_groups.length,
        addon_count: bundle.catalog.addons.length,
        variant_count: bundle.catalog.product_variants.length,
      },
    });
  })();

  previews.delete(previewId);
  return {
    success: true,
    applied_fingerprint: resultFingerprint,
    published_at: now(),
    counts: {
      categories: bundle.catalog.categories.length,
      products: bundle.catalog.products.length,
      addon_groups: bundle.catalog.addon_groups.length,
      addons: bundle.catalog.addons.length,
      variants: bundle.catalog.product_variants.length,
    },
    policy: {
      deletions_applied: false,
      windows_only_records_preserved: true,
      stock_quantities_preserved: true,
      operational_records_changed: false,
    },
  };
}

/**
 * Creates a recovery backup under the database maintenance lock, then applies
 * the already-previewed catalog package without allowing an intervening write.
 */
export async function applyMenuPublishWithBackup(
  input: unknown,
  previewId: unknown,
  userId: string,
) {
  const bundle = normalizeAndValidateBundle(input);
  if (typeof previewId !== 'string' || !previewId) {
    throw new MenuPublishError(
      'A valid menu preview is required before publishing.',
      400,
      'preview_required',
    );
  }
  const preview = previews.get(previewId);
  if (!preview || preview.expiresAt <= Date.now()) {
    previews.delete(previewId);
    throw new MenuPublishError(
      'The menu preview expired. Generate a new preview.',
      409,
      'preview_expired',
    );
  }
  if (preview.userId !== userId || preview.bundleFingerprint !== bundle.fingerprint) {
    throw new MenuPublishError(
      'The menu package or publishing user changed after preview.',
      409,
      'preview_mismatch',
    );
  }
  assertSameStore(bundle.source);
  assertTaxCategories(bundle.catalog);

  return withDatabaseMaintenanceLock(async (signal) => {
    const currentFingerprint = fingerprintCatalog(canonicalCatalog(readCatalog()));
    if (currentFingerprint !== preview.targetFingerprint) {
      previews.delete(previewId);
      throw new MenuPublishError(
        'The Windows menu changed after preview. No changes were applied; generate a new preview.',
        409,
        'target_changed_after_preview',
      );
    }
    const baseline = String(getSettingValue('menu_publish_baseline_fingerprint') || '');
    if (baseline && baseline !== currentFingerprint) {
      previews.delete(previewId);
      throw new MenuPublishError(
        'The Windows menu has changed since the previous Mac publication.',
        409,
        'target_catalog_drift',
      );
    }

    const backup = await createBackupUnlocked(undefined, signal);
    throwIfDatabaseMaintenanceAborted(signal);
    const result = applyMenuPublish(bundle, previewId, userId);
    return {
      ...result,
      recovery_backup: path.basename(backup.path),
    };
  });
}
