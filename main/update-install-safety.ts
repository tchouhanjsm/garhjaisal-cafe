import {
  getDatabase,
  getSettingValue,
  isDatabaseMaintenanceActive,
  localDateInTimezone,
  parseDbTimestamp,
  tenantBusinessDayStartTime,
} from './db';
import { resolveRegionalSnapshot } from './countries';
import { listOpenSessions } from './services/shift-session-gate';

export type UpdateInstallSafetyResult =
  | { ok: true }
  | { ok: false; code: string; error: string };

function blocked(code: string, error: string): UpdateInstallSafetyResult {
  return { ok: false, code, error };
}

function countRows(db: ReturnType<typeof getDatabase>, sql: string): number {
  const row = db.prepare(sql).get() as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

/**
 * The updater is a main-process operation. It must independently prove that
 * the restaurant is idle before it is allowed to close the POS runtime.
 * Missing tables, unreadable state, and an active maintenance lock all fail
 * closed so an update cannot interrupt an unknown operational state.
 */
export function getUpdateInstallSafety(at = new Date()): UpdateInstallSafetyResult {
  try {
    if (isDatabaseMaintenanceActive()) {
      return blocked(
        'database-maintenance',
        'Database backup, restore, or maintenance is in progress. ' +
          'Wait for it to finish before installing the update.',
      );
    }

    const db = getDatabase();

    if (listOpenSessions(db).length > 0) {
      return blocked(
        'open-cash-shift',
        'An open cash shift remains. Close the shift before installing the update.',
      );
    }

    if (
      countRows(
        db,
        `SELECT COUNT(*) AS count
         FROM orders
         WHERE status IN ('pending', 'preparing', 'ready', 'served')`,
      ) > 0
    ) {
      return blocked(
        'active-orders',
        'Active restaurant orders remain. Complete or cancel them before installing the update.',
      );
    }

    if (
      countRows(
        db,
        `SELECT COUNT(*) AS count
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status != 'cancelled'
           AND oi.status IN ('pending', 'preparing', 'ready')`,
      ) > 0
    ) {
      return blocked(
        'pending-kitchen-work',
        'Pending kitchen or KOT work remains. ' +
          'Finish the outstanding items before installing the update.',
      );
    }

    if (countRows(db, 'SELECT COUNT(*) AS count FROM held_orders') > 0) {
      return blocked(
        'held-orders',
        'A held order is waiting. Resume or clear it before installing the update.',
      );
    }

    if (
      countRows(
        db,
        `
          SELECT COUNT(*) AS count
          FROM bills b
          JOIN orders o ON o.id = b.order_id
          WHERE b.payment_status NOT IN ('paid', 'refunded', 'partially_refunded')
            AND COALESCE(b.balance, b.total, 0) > 0
            AND o.status != 'cancelled'
        `,
      ) > 0
    ) {
      return blocked(
        'unsettled-bills',
        'Unsettled bills remain. Settle or resolve them before installing the update.',
      );
    }

    const regional = resolveRegionalSnapshot({
      country: getSettingValue('country') ?? undefined,
      currency: getSettingValue('currency') ?? undefined,
      timezone: getSettingValue('timezone') ?? undefined,
    });
    const businessDayStart = tenantBusinessDayStartTime(db);
    const businessDate = localDateInTimezone(at, regional.timezone, businessDayStart);
    const dayClose = db
      .prepare(
        "SELECT created_at FROM cash_closures WHERE scope = 'day' AND business_date = ?",
      )
      .get(businessDate) as { created_at: string } | undefined;

    // A business day may span midnight in UTC. Looking back 48 hours covers
    // every valid tenant-local business day without scanning the full history.
    const activityCutoff = new Date(at.getTime() - 48 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    const latestActivity = db
      .prepare(
        `
          SELECT MAX(activity_at) AS activity_at
          FROM (
            SELECT created_at AS activity_at FROM orders WHERE created_at >= ?
            UNION ALL
            SELECT updated_at AS activity_at FROM orders WHERE updated_at >= ?
            UNION ALL
            SELECT created_at AS activity_at FROM bills WHERE created_at >= ?
            UNION ALL
            SELECT paid_at AS activity_at FROM bills WHERE paid_at >= ? AND paid_at IS NOT NULL
            UNION ALL
            SELECT created_at AS activity_at FROM refunds WHERE created_at >= ?
            UNION ALL
            SELECT created_at AS activity_at FROM cash_drawer_movements WHERE created_at >= ?
          )
        `,
      )
      .get(
        activityCutoff,
        activityCutoff,
        activityCutoff,
        activityCutoff,
        activityCutoff,
        activityCutoff,
      ) as { activity_at: string | null } | undefined;

    if (latestActivity?.activity_at) {
      const activityAt = parseDbTimestamp(latestActivity.activity_at);
      const activityBusinessDate = localDateInTimezone(
        activityAt,
        regional.timezone,
        businessDayStart,
      );
      const activityIsAfterDayClose =
        !dayClose || activityAt.getTime() > parseDbTimestamp(dayClose.created_at).getTime();

      if (activityBusinessDate === businessDate && activityIsAfterDayClose) {
        return blocked(
          'business-day-open',
          'The current business day has activity that has not been closed. ' +
            'Complete day-close before installing the update.',
        );
      }
    }

    return { ok: true };
  } catch (error) {
    console.error('[Update] Could not verify restaurant install safety:', error);
    return blocked(
      'status-unavailable',
      'Restaurant operating status could not be verified. ' +
        'Keep the app running and retry after checking the database.',
    );
  }
}
