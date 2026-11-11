import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import { requirePermission } from '../services/authorization';
import {
  decodeQuoteV1Field,
  FLO_CSV_ENCODING_COLUMN,
  FLO_CSV_ENCODING_QUOTE_V1,
  toQuoteV1CsvRow,
} from '../lib/csv';
import { parseCSV, resolveCsvRowEncoding } from './menu-csv';

const router = Router();

type EditableSnapshot = {
  name: string;
  category_id: string | null;
  price: number;
  is_active: boolean;
};

type MenuStudioPatch = Partial<EditableSnapshot>;

type MenuStudioChange = {
  id: string;
  expected_updated_at: string;
  expected: EditableSnapshot;
  patch: MenuStudioPatch;
};

type ProductRow = {
  id: string;
  name: string;
  category_id: string | null;
  price: number;
  is_active: number | null;
  updated_at: string;
  deleted_at: string | null;
};

const EDITABLE_FIELDS = new Set(['name', 'category_id', 'price', 'is_active']);

function getActorUserId(req: Request): string {
  return String((req as Request & { user?: { userId?: string } }).user?.userId || '');
}

function parseExpected(value: unknown): EditableSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const expected = value as Record<string, unknown>;
  if (
    typeof expected.name !== 'string' ||
    !(expected.category_id === null || typeof expected.category_id === 'string') ||
    typeof expected.price !== 'number' ||
    !Number.isFinite(expected.price) ||
    typeof expected.is_active !== 'boolean'
  ) {
    return null;
  }
  return {
    name: expected.name,
    category_id: expected.category_id,
    price: expected.price,
    is_active: expected.is_active,
  };
}

function normalizeChange(value: unknown): MenuStudioChange | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== 'string' ||
    !raw.id.trim() ||
    typeof raw.expected_updated_at !== 'string' ||
    !raw.expected_updated_at.trim() ||
    !raw.patch ||
    typeof raw.patch !== 'object' ||
    Array.isArray(raw.patch)
  ) {
    return null;
  }
  const expected = parseExpected(raw.expected);
  if (!expected) return null;

  const rawPatch = raw.patch as Record<string, unknown>;
  const keys = Object.keys(rawPatch);
  if (keys.length === 0 || keys.some((key) => !EDITABLE_FIELDS.has(key))) return null;

  const patch: MenuStudioPatch = {};
  if (Object.prototype.hasOwnProperty.call(rawPatch, 'name')) {
    if (typeof rawPatch.name !== 'string') return null;
    const name = rawPatch.name.trim();
    if (!name || name.length > 120) return null;
    patch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(rawPatch, 'category_id')) {
    if (!(rawPatch.category_id === null || typeof rawPatch.category_id === 'string')) return null;
    const categoryId =
      typeof rawPatch.category_id === 'string' ? rawPatch.category_id.trim() : null;
    patch.category_id = categoryId || null;
  }
  if (Object.prototype.hasOwnProperty.call(rawPatch, 'price')) {
    if (
      typeof rawPatch.price !== 'number' ||
      !Number.isFinite(rawPatch.price) ||
      rawPatch.price < 0 ||
      rawPatch.price > 1_000_000_000
    ) {
      return null;
    }
    patch.price = rawPatch.price;
  }
  if (Object.prototype.hasOwnProperty.call(rawPatch, 'is_active')) {
    if (typeof rawPatch.is_active !== 'boolean') return null;
    patch.is_active = rawPatch.is_active;
  }

  return {
    id: raw.id.trim(),
    expected_updated_at: raw.expected_updated_at.trim(),
    expected,
    patch,
  };
}

function snapshotProduct(row: ProductRow): EditableSnapshot {
  return {
    name: row.name,
    category_id: row.category_id,
    price: Number(row.price),
    is_active: Number(row.is_active ?? 1) === 1,
  };
}

function sameSnapshot(left: EditableSnapshot, right: EditableSnapshot): boolean {
  return (
    left.name === right.name &&
    left.category_id === right.category_id &&
    Math.abs(left.price - right.price) < 0.0000001 &&
    left.is_active === right.is_active
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

router.post('/updates', requirePermission('catalog.manage'), (req: Request, res: Response) => {
  try {
    const rawChanges = req.body?.changes;
    if (!Array.isArray(rawChanges) || rawChanges.length < 1 || rawChanges.length > 250) {
      return res.status(400).json({
        error: 'changes must contain between 1 and 250 product updates',
        code: 'invalid_changes',
      });
    }

    const changes = rawChanges.map(normalizeChange);
    if (changes.some((change) => change === null)) {
      return res.status(400).json({
        error: 'Each update requires an id, expected snapshot, timestamp and supported fields',
        code: 'invalid_change',
      });
    }

    const normalizedChanges = changes as MenuStudioChange[];
    const ids = normalizedChanges.map((change) => change.id);
    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({
        error: 'A product may appear only once in a Menu Studio update',
        code: 'duplicate_product',
      });
    }

    const db = getDatabase();
    const actorUserId = getActorUserId(req);
    const batchId = randomUUID();

    const applyChanges = db.transaction(() => {
      const selectProduct = db.prepare(
        `SELECT id, name, category_id, price, is_active, updated_at, deleted_at
         FROM products WHERE id = ?`,
      );
      const selectCategory = db.prepare(
        'SELECT id, is_active FROM categories WHERE id = ? AND deleted_at IS NULL',
      );

      const loaded: { change: MenuStudioChange; current: ProductRow }[] = [];
      for (const change of normalizedChanges) {
        const current = selectProduct.get(change.id) as ProductRow | undefined;
        if (!current || current.deleted_at) {
          throw Object.assign(new Error(`Product ${change.id} was not found`), {
            statusCode: 404,
            code: 'product_not_found',
          });
        }
        if (
          current.updated_at !== change.expected_updated_at ||
          !sameSnapshot(snapshotProduct(current), change.expected)
        ) {
          throw Object.assign(
            new Error(
              `${current.name} changed after this Menu Studio view was loaded. Reload and try again.`,
            ),
            { statusCode: 409, code: 'stale_write', product_id: current.id },
          );
        }
        if (change.patch.category_id) {
          const category = selectCategory.get(change.patch.category_id) as
            | { id: string; is_active: number }
            | undefined;
          if (!category || Number(category.is_active) !== 1) {
            throw Object.assign(new Error('Choose an active category'), {
              statusCode: 400,
              code: 'category_unavailable',
            });
          }
        }
        loaded.push({ change, current });
      }

      const updateProduct = db.prepare(
        `UPDATE products
         SET name = ?, category_id = ?, price = ?, is_active = ?, updated_at = ?
         WHERE id = ? AND updated_at = ? AND deleted_at IS NULL
           AND name IS ? AND category_id IS ? AND price = ?
           AND COALESCE(is_active, 1) = ?`,
      );
      const insertAudit = db.prepare(
        `INSERT INTO menu_studio_audit_log
         (batch_id, product_id, actor_user_id, action, before_json, after_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      const updated: {
        id: string;
        name: string;
        category_id: string | null;
        price: number;
        is_active: boolean;
        updated_at: string;
      }[] = [];

      for (const { change, current } of loaded) {
        const before = snapshotProduct(current);
        const after: EditableSnapshot = { ...before, ...change.patch };
        const updatedAt = now();
        const result = updateProduct.run(
          after.name,
          after.category_id,
          after.price,
          after.is_active ? 1 : 0,
          updatedAt,
          current.id,
          change.expected_updated_at,
          before.name,
          before.category_id,
          before.price,
          before.is_active ? 1 : 0,
        );
        if (result.changes !== 1) {
          throw Object.assign(new Error('A product changed while this update was being applied'), {
            statusCode: 409,
            code: 'stale_write',
            product_id: current.id,
          });
        }

        const patchKeys = Object.keys(change.patch);
        const action =
          patchKeys.length === 1 && patchKeys[0] === 'price'
            ? 'price_updated'
            : patchKeys.length === 1 && patchKeys[0] === 'is_active'
              ? 'availability_updated'
              : 'item_updated';
        insertAudit.run(
          batchId,
          current.id,
          actorUserId,
          action,
          JSON.stringify(before),
          JSON.stringify(after),
          updatedAt,
        );

        updated.push({
          id: current.id,
          ...after,
          updated_at: updatedAt,
        });
      }

      return updated;
    });

    const updated = applyChanges();
    res.json({ batch_id: batchId, updated_count: updated.length, products: updated });
  } catch (error: any) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    if (statusCode >= 500) {
      res.locals.postHogError = error;
      console.error('[Menu Studio] Update failed:', error);
    }
    res.status(statusCode).json({
      error: statusCode >= 500 ? 'Internal server error' : error.message,
      ...(error?.code ? { code: error.code } : {}),
      ...(error?.product_id ? { product_id: error.product_id } : {}),
    });
  }
});

router.get('/csv/export', requirePermission('catalog.manage'), (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const products = db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.category_id, c.name AS category_name,
                p.price, p.is_active, p.updated_at
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
         WHERE p.deleted_at IS NULL
         ORDER BY p.name COLLATE NOCASE, p.id`,
      )
      .all() as {
      id: string;
      sku: string | null;
      name: string;
      category_id: string | null;
      category_name: string | null;
      price: number;
      is_active: number | null;
      updated_at: string;
    }[];
    const lines = [
      [
        'id',
        'sku',
        'name',
        'category_id',
        'category_name',
        'price',
        'is_active',
        'updated_at',
        FLO_CSV_ENCODING_COLUMN,
      ].join(','),
    ];
    for (const product of products) {
      lines.push(
        toQuoteV1CsvRow([
          product.id,
          product.sku,
          product.name,
          product.category_id,
          product.category_name,
          Number(product.price),
          Number(product.is_active ?? 1) === 1 ? 'yes' : 'no',
          product.updated_at,
          FLO_CSV_ENCODING_QUOTE_V1,
        ]),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="menu-studio-export.csv"');
    res.send(lines.join('\r\n'));
  } catch (error: any) {
    res.locals.postHogError = error;
    console.error('[Menu Studio] CSV export failed:', error);
    res.status(500).json({ error: 'Could not export the menu catalog' });
  }
});

router.post('/csv/preview', requirePermission('catalog.manage'), (req: Request, res: Response) => {
  try {
    const rawCsv = req.body?.csv;
    if (typeof rawCsv !== 'string' || !rawCsv.trim()) {
      return res.status(400).json({ error: 'Choose a non-empty Menu Studio CSV file' });
    }

    const parsed = parseCSV(rawCsv.replace(/^\uFEFF/, ''));
    if (parsed.length < 2) {
      return res.status(400).json({
        error: 'CSV must include a header and at least one product row',
      });
    }

    const headers = parsed[0].map((header) => header.trim().toLowerCase());
    const allowedHeaders = new Set([
      'id',
      'sku',
      'name',
      'category_id',
      'category_name',
      'price',
      'is_active',
      'updated_at',
      FLO_CSV_ENCODING_COLUMN,
    ]);
    const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
    const requiredHeaders = [
      'id',
      'sku',
      'name',
      'category_id',
      'price',
      'is_active',
      'updated_at',
      FLO_CSV_ENCODING_COLUMN,
    ];
    const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
    const hasCategoryNameColumn = headers.includes('category_name');
    const unsupportedHeaders = headers.filter((header) => !allowedHeaders.has(header));
    if (duplicateHeaders.length || missingHeaders.length || unsupportedHeaders.length) {
      return res.status(400).json({
        error:
          'Use the CSV exported by Menu Studio. Required columns: id, sku, name, category_id, price, is_active, updated_at and flo_csv_encoding.',
        code: 'invalid_csv_headers',
        missing_headers: missingHeaders,
        unsupported_headers: [...new Set(unsupportedHeaders)],
        duplicate_headers: [...new Set(duplicateHeaders)],
      });
    }

    const malformedRowWidths = new Map<number, number>();
    const rows = parsed.slice(1).map((fields, index) => {
      if (fields.length !== headers.length) {
        malformedRowWidths.set(index, fields.length);
      }
      const row: Record<string, string> = {};
      headers.forEach((header, columnIndex) => {
        row[header] = (fields[columnIndex] ?? '').trim();
      });
      return row;
    });
    if (rows.length < 1 || rows.length > 250) {
      return res.status(400).json({
        error: 'Menu Studio CSV import supports between 1 and 250 product rows per batch',
        code: 'invalid_csv_row_count',
      });
    }

    const db = getDatabase();
    const selectProduct = db.prepare(
      `SELECT id, sku, name, category_id, price, is_active, updated_at, deleted_at
         FROM products WHERE id = ?`,
    );
    const selectCategory = db.prepare(
      'SELECT id, name, is_active FROM categories WHERE id = ? AND deleted_at IS NULL',
    );
    const selectCategoryByName = db.prepare(
      'SELECT id, name, is_active FROM categories WHERE lower(trim(name)) = lower(trim(?)) AND deleted_at IS NULL AND is_active = 1',
    );
    const seenIds = new Set<string>();
    const changes: MenuStudioChange[] = [];
    const previewRows: {
      row_number: number;
      product_id: string | null;
      product_name: string;
      status: 'ready' | 'unchanged' | 'error';
      message: string | null;
      before: EditableSnapshot | null;
      after: EditableSnapshot | null;
    }[] = [];
    const errors: string[] = [];
    let unchangedCount = 0;
    let readyCount = 0;

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const encoding = resolveCsvRowEncoding(row);
      const decode = (value: string | undefined): string =>
        encoding.ok && encoding.mode === 'quote-v1'
          ? decodeQuoteV1Field(value ?? '')
          : (value ?? '');
      const id = decode(row.id).trim();
      const name = decode(row.name).trim();
      const fail = (message: string, before: EditableSnapshot | null = null) => {
        errors.push('Row ' + rowNumber + ': ' + message);
        previewRows.push({
          row_number: rowNumber,
          product_id: id || null,
          product_name: name || before?.name || id || 'Unknown item',
          status: 'error',
          message,
          before,
          after: null,
        });
      };

      if (!id) {
        fail('product id is required');
        return;
      }
      if (seenIds.has(id)) {
        fail('duplicate product id in this CSV');
        return;
      }
      // A malformed row is still present in the uploaded file when its stable
      // product ID is readable. Count it as present for reconciliation, while
      // keeping it ineligible for updates.
      seenIds.add(id);
      const actualColumnCount = malformedRowWidths.get(index);
      if (actualColumnCount !== undefined) {
        fail('expected ' + headers.length + ' columns but found ' + actualColumnCount);
        return;
      }
      if (!encoding.ok) {
        fail(encoding.error);
        return;
      }

      const current = selectProduct.get(id) as (ProductRow & { sku: string | null }) | undefined;
      if (!current || current.deleted_at) {
        fail('product id does not exist in the current catalog');
        return;
      }
      const before = snapshotProduct(current);
      const suppliedUpdatedAt = decode(row.updated_at).trim();
      if (!suppliedUpdatedAt || suppliedUpdatedAt !== current.updated_at) {
        fail(
          'product changed after this CSV was exported; export the latest menu and retry',
          before,
        );
        return;
      }
      const suppliedSku = decode(row.sku).trim() || null;
      const currentSku = current.sku?.trim() || null;
      if (suppliedSku !== currentSku) {
        fail('SKU is a reference field and must match the exported product', before);
        return;
      }

      if (!name || name.length > 120) {
        fail('item name must contain 1 to 120 characters', before);
        return;
      }
      const suppliedCategoryId = decode(row.category_id).trim() || null;
      if (suppliedCategoryId !== (current.category_id || null)) {
        fail(
          'category_id is a reference field; keep it unchanged and edit category_name instead',
          before,
        );
        return;
      }
      let categoryId = suppliedCategoryId;
      if (hasCategoryNameColumn) {
        const categoryName = decode(row.category_name).trim();
        if (categoryName) {
          const matches = selectCategoryByName.all(categoryName) as {
            id: string;
            name: string;
            is_active: number;
          }[];
          if (matches.length === 0) {
            fail('category name must match an active category', before);
            return;
          }
          const retainedMatch = matches.find((category) => category.id === suppliedCategoryId);
          if (matches.length > 1 && !retainedMatch) {
            fail('category name is ambiguous; choose a category with a unique active name', before);
            return;
          }
          categoryId = retainedMatch?.id || matches[0].id;
        } else {
          categoryId = null;
        }
      } else if (categoryId) {
        const category = selectCategory.get(categoryId) as
          | { id: string; name: string; is_active: number }
          | undefined;
        if (!category || Number(category.is_active) !== 1) {
          fail('category id must refer to an active category', before);
          return;
        }
      }

      const priceValue = (row.price ?? '').trim();
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(priceValue)) {
        fail('price must be a non-negative number', before);
        return;
      }
      const price = Number(priceValue);
      if (!Number.isFinite(price) || price > 1_000_000_000) {
        fail('price must be a finite value no greater than 1,000,000,000', before);
        return;
      }

      const activeValue = (row.is_active ?? '').trim().toLowerCase();
      const activeValues: Record<string, boolean> = {
        yes: true,
        true: true,
        '1': true,
        no: false,
        false: false,
        '0': false,
      };
      if (!Object.prototype.hasOwnProperty.call(activeValues, activeValue)) {
        fail('availability must be yes/no, true/false or 1/0', before);
        return;
      }

      const patch: MenuStudioPatch = {};
      if (name !== before.name) patch.name = name;
      if (categoryId !== before.category_id) patch.category_id = categoryId;
      if (price !== before.price) patch.price = price;
      if (activeValues[activeValue] !== before.is_active) {
        patch.is_active = activeValues[activeValue];
      }
      const after: EditableSnapshot = { ...before, ...patch };
      if (Object.keys(patch).length) {
        changes.push({
          id,
          expected_updated_at: current.updated_at,
          expected: before,
          patch,
        });
        readyCount++;
        previewRows.push({
          row_number: rowNumber,
          product_id: id,
          product_name: current.name,
          status: 'ready',
          message: null,
          before,
          after,
        });
      } else {
        unchangedCount++;
        previewRows.push({
          row_number: rowNumber,
          product_id: id,
          product_name: current.name,
          status: 'unchanged',
          message: 'No catalog changes detected',
          before,
          after,
        });
      }
    });

    const importedIds = Array.from(seenIds);
    const omittedFilter = importedIds.length
      ? 'p.id NOT IN (' + importedIds.map(() => '?').join(', ') + ')'
      : '1 = 1';
    const omittedCountRow = db
      .prepare(
        'SELECT COUNT(*) AS count FROM products p WHERE p.deleted_at IS NULL AND ' + omittedFilter,
      )
      .get(...importedIds) as { count: number };
    const omittedProducts = db
      .prepare(
        'SELECT p.id, p.sku, p.name, c.name AS category_name, p.price, p.is_active ' +
          'FROM products p ' +
          'LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL ' +
          'WHERE p.deleted_at IS NULL AND ' +
          omittedFilter +
          ' ORDER BY p.name COLLATE NOCASE, p.id LIMIT 50',
      )
      .all(...importedIds) as {
      id: string;
      sku: string | null;
      name: string;
      category_name: string | null;
      price: number;
      is_active: number | null;
    }[];
    const omittedCount = Number(omittedCountRow.count);

    res.json({
      row_count: rows.length,
      ready_count: readyCount,
      unchanged_count: unchangedCount,
      error_count: errors.length,
      omitted_count: omittedCount,
      omitted_products: omittedProducts,
      omitted_preview_truncated: omittedCount > omittedProducts.length,
      can_apply: errors.length === 0 && changes.length > 0,
      changes,
      rows: previewRows,
      errors,
    });
  } catch (error: any) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    if (statusCode >= 500) {
      res.locals.postHogError = error;
      console.error('[Menu Studio] CSV preview failed:', error);
    }
    res.status(statusCode).json({
      error: statusCode >= 500 ? 'Could not preview the menu CSV' : error.message,
      ...(error?.code ? { code: error.code } : {}),
    });
  }
});

router.get('/audit/export', requirePermission('catalog.view'), (req: Request, res: Response) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 5000) : 5000;
    const rawThroughId = req.query.through_id;
    const rawBeforeId = req.query.before_id;
    if (
      (rawThroughId !== undefined &&
        (typeof rawThroughId !== 'string' || !/^(?:0|[1-9]\d*)$/.test(rawThroughId))) ||
      (rawBeforeId !== undefined &&
        (typeof rawBeforeId !== 'string' || !/^[1-9]\d*$/.test(rawBeforeId)))
    ) {
      return res.status(400).json({ error: 'Audit export cursors must be positive integer IDs' });
    }

    const db = getDatabase();
    const maximumId = Number(
      (
        db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM menu_studio_audit_log').get() as {
          id: number;
        }
      ).id,
    );
    const throughId = rawThroughId === undefined ? maximumId : Number(rawThroughId);
    const beforeId = rawBeforeId === undefined ? null : Number(rawBeforeId);
    if (
      !Number.isSafeInteger(throughId) ||
      throughId < 0 ||
      (beforeId !== null &&
        (!Number.isSafeInteger(beforeId) || beforeId <= 0 || beforeId > throughId))
    ) {
      return res.status(400).json({ error: 'Audit export cursor is outside the valid range' });
    }

    const beforeFilter = beforeId === null ? '' : 'AND a.id < ? ';
    const queryParameters =
      beforeId === null ? [throughId, limit + 1] : [throughId, beforeId, limit + 1];
    const rows = db
      .prepare(
        'SELECT a.id, a.batch_id, a.product_id, p.name AS product_name, ' +
          'a.actor_user_id, u.name AS actor_name, a.action, ' +
          'a.before_json, a.after_json, a.created_at ' +
          'FROM menu_studio_audit_log a ' +
          'LEFT JOIN products p ON p.id = a.product_id ' +
          'LEFT JOIN users u ON u.id = a.actor_user_id ' +
          'WHERE a.id <= ? ' +
          beforeFilter +
          'ORDER BY a.id DESC LIMIT ?',
      )
      .all(...queryParameters) as {
      id: number;
      batch_id: string;
      product_id: string;
      product_name: string | null;
      actor_user_id: string;
      actor_name: string | null;
      action: string;
      before_json: string;
      after_json: string;
      created_at: string;
    }[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const totalCount = Number(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM menu_studio_audit_log WHERE id <= ?')
          .get(throughId) as { count: number }
      ).count,
    );
    const lines: string[] = [];
    if (beforeId === null) {
      lines.push(
        [
          'audit_id',
          'batch_id',
          'product_id',
          'product_name',
          'actor_user_id',
          'actor_name',
          'action',
          'before_json',
          'after_json',
          'created_at',
          FLO_CSV_ENCODING_COLUMN,
        ].join(','),
      );
    }
    for (const row of pageRows) {
      lines.push(
        toQuoteV1CsvRow([
          row.id,
          row.batch_id,
          row.product_id,
          row.product_name,
          row.actor_user_id,
          row.actor_name,
          row.action,
          row.before_json,
          row.after_json,
          row.created_at,
          FLO_CSV_ENCODING_QUOTE_V1,
        ]),
      );
    }

    res.setHeader('X-Menu-Studio-Audit-Through-Id', String(throughId));
    res.setHeader('X-Menu-Studio-Audit-Page-Count', String(pageRows.length));
    res.setHeader('X-Menu-Studio-Audit-Total-Count', String(totalCount));
    if (hasMore && pageRows.length > 0) {
      res.setHeader(
        'X-Menu-Studio-Audit-Next-Before-Id',
        String(pageRows[pageRows.length - 1].id),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="menu-studio-audit.csv"');
    res.send(lines.join('\r\n'));
  } catch (error: any) {
    res.locals.postHogError = error;
    console.error('[Menu Studio] Audit export failed:', error);
    res.status(500).json({ error: 'Could not export Menu Studio audit history' });
  }
});

router.get('/audit', requirePermission('catalog.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 30;
    const productId = typeof req.query.product_id === 'string' ? req.query.product_id.trim() : '';
    const rows = productId
      ? db
          .prepare(
            `SELECT a.id, a.batch_id, a.product_id, a.actor_user_id, u.name AS actor_name,
                    a.action, a.before_json, a.after_json, a.created_at
             FROM menu_studio_audit_log a
             LEFT JOIN users u ON u.id = a.actor_user_id
             WHERE a.product_id = ?
             ORDER BY a.id DESC LIMIT ?`,
          )
          .all(productId, limit)
      : db
          .prepare(
            `SELECT a.id, a.batch_id, a.product_id, a.actor_user_id, u.name AS actor_name,
                    a.action, a.before_json, a.after_json, a.created_at
             FROM menu_studio_audit_log a
             LEFT JOIN users u ON u.id = a.actor_user_id
             ORDER BY a.id DESC LIMIT ?`,
          )
          .all(limit);

    res.json({
      entries: (rows as Record<string, unknown>[]).map((row) => ({
        ...row,
        before: parseJson(String(row.before_json || '')),
        after: parseJson(String(row.after_json || '')),
      })),
    });
  } catch (error: any) {
    res.locals.postHogError = error;
    console.error('[Menu Studio] Audit read failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const menuStudioRoutes = router;
