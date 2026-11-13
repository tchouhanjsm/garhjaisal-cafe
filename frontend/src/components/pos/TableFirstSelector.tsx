'use client';

import { TableTurnoverBadge } from '@/components/tables/TableTurnoverBadge';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { TABLE_STATUS_LABEL_KEYS } from '@/lib/i18n-enums';
import type { Table } from '@/lib/types';
import { useHeldOrdersStore } from '@/store/held-orders';
import { useTranslations } from 'use-intl';

interface Props {
  tables: Table[];
  selectedTableId: string | null;
  onSelectAvailable: (
    tableId: string,
    customer?: { id: string; name: string; phone: string } | null,
  ) => void;
  onSelectOccupied: (table: Table) => void;
  onSelectHeld: (tableId: string) => void;
}

const tableStatusStyles: Record<Table['status'], string> = {
  available: 'border-border hover:border-brand/40',
  occupied: 'border-orange-300 bg-orange-50 dark:border-orange-800/40 dark:bg-orange-950/40',
  reserved: 'border-yellow-300 bg-yellow-50 dark:border-yellow-800/40 dark:bg-yellow-950/40',
  cleaning: 'border-gray-300 bg-muted dark:border-border',
  held: 'border-blue-400 bg-blue-50 dark:border-blue-800/40 dark:bg-blue-950/40',
};

export default function TableFirstSelector({
  tables,
  selectedTableId,
  onSelectAvailable,
  onSelectOccupied,
  onSelectHeld,
}: Props) {
  const heldOrders = useHeldOrdersStore();
  const t = useTranslations('pos');
  const tTables = useTranslations('tables');
  const formatCurrency = useFormatCurrency();

  const handleClick = (table: Table) => {
    if (heldOrders.hasHeldOrder(table.id)) {
      onSelectHeld(table.id);
      return;
    }

    if (table.status === 'occupied') {
      onSelectOccupied(table);
      return;
    }

    if (table.status === 'available' || table.status === 'reserved') {
      const customer =
        table.status === 'reserved' && table.reservation_customer_id
          ? {
              id: table.reservation_customer_id,
              name: table.reservation_customer_name ?? '',
              phone: table.reservation_customer_phone ?? '',
            }
          : null;
      onSelectAvailable(table.id, customer);
    }
  };

  return (
    <section
      data-testid="pos-table-first-picker"
      aria-label={t('selectTable')}
      className="mb-4 w-full rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">{t('selectTable')}</h2>
        <p className="text-xs text-muted-foreground">{tables.length}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tables.map((table) => {
          const isHeld = heldOrders.hasHeldOrder(table.id);
          const isSelected = selectedTableId === table.id;
          const activeOrder = table.current_order || table.activeOrder;
          const isDisabled = table.status === 'cleaning' || (table.status === 'held' && !isHeld);
          const statusLabel = isHeld
            ? t('tableHeld')
            : tTables(TABLE_STATUS_LABEL_KEYS[table.status]);
          const cardStyle = isSelected
            ? 'border-brand bg-brand-light'
            : isHeld
              ? 'border-blue-400 bg-blue-50'
              : tableStatusStyles[table.status];
          const cardClassName = [
            'relative min-h-28 rounded-xl border-2 p-4 text-center transition-colors',
            cardStyle,
            isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          ].join(' ');

          return (
            <button
              key={table.id}
              type="button"
              onClick={() => !isDisabled && handleClick(table)}
              disabled={isDisabled}
              className={cardClassName}
            >
              <span className="block font-bold text-foreground">{table.name}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{statusLabel}</span>
              <span className="block text-xs text-muted-foreground">
                {t('tableSeats', { count: table.capacity })}
              </span>
              {table.status === 'occupied' && activeOrder && (
                <div className="mt-1 space-y-0.5">
                  <p className="text-xs font-medium text-orange-600">
                    #{activeOrder.order_number}
                  </p>
                  {typeof activeOrder.total === 'number' && (
                    <p className="text-xs font-semibold text-foreground">
                      {formatCurrency(activeOrder.total)}
                    </p>
                  )}
                </div>
              )}
              {table.status === 'occupied' && table.seated_at && (
                <div className="mt-1">
                  <TableTurnoverBadge seatedAt={table.seated_at} />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {tables.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">{t('noTablesFound')}</p>
      )}
    </section>
  );
}
