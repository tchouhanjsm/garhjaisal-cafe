import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import { requirePermission } from '../services/authorization';

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
        'SELECT id, name, category_id, price, is_active, updated_at, deleted_at FROM products WHERE id = ?',
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
            new Error(`${current.name} changed after this Menu Studio view was loaded. Reload and try again.`),
            { statusCode: 409, code: 'stale_write', product_id: current.id },
          );
        }
        if (
          change.patch.category_id &&
          (!selectCategory.get(change.patch.category_id) ||
            Number((selectCategory.get(change.patch.category_id) as { is_active: number }).is_active) !== 1)
        ) {
          throw Object.assign(new Error('Choose an active category'), {
            statusCode: 400,
            code: 'category_unavailable',
          });
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
