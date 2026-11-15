'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
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

type TableFilter = 'all' | 'available' | 'occupied' | 'held' | 'reserved' | 'cleaning';

const tableStatusStyles: Record<Table['status'] | 'held', string> = {
  available: 'border-border hover:border-brand/50 hover:bg-brand/5',
  occupied: 'border-orange-300 bg-orange-50/70 dark:border-orange-800/50 dark:bg-orange-950/30',
  reserved: 'border-yellow-300 bg-yellow-50/70 dark:border-yellow-800/50 dark:bg-yellow-950/30',
  cleaning: 'border-border bg-muted/60',
  held: 'border-blue-300 bg-blue-50/70 dark:border-blue-800/50 dark:bg-blue-950/30',
};

const filters: { id: TableFilter; label: string }[] = [
  { id: 'all', label: 'All tables' },
  { id: 'available', label: 'Available' },
  { id: 'occupied', label: 'Occupied' },
  { id: 'held', label: 'Held' },
  { id: 'reserved', label: 'Reserved' },
  { id: 'cleaning', label: 'Cleaning' },
];

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
  const [activeFilter, setActiveFilter] = useState<TableFilter>('all');
  const [search, setSearch] = useState('');
  const [activeSection, setActiveSection] = useState<string>('all');

  const sections = useMemo(
    () =>
      Array.from(
        new Set(
          tables
            .map((table) => table.section?.trim() || table.floor?.trim())
            .filter((section): section is string => Boolean(section)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [tables],
  );

  const getEffectiveStatus = (table: Table): TableFilter => {
    if (heldOrders.hasHeldOrder(table.id)) return 'held';
    return table.status;
  };

  const counts = useMemo(() => {
    const result: Record<TableFilter, number> = {
      all: tables.length,
      available: 0,
      occupied: 0,
      held: 0,
      reserved: 0,
      cleaning: 0,
    };
    for (const table of tables) result[getEffectiveStatus(table)] += 1;
    return result;
  }, [tables, heldOrders.orders]);

  const visibleTables = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return tables.filter((table) => {
      const matchesStatus = activeFilter === 'all' || getEffectiveStatus(table) === activeFilter;
      const section = table.section?.trim() || table.floor?.trim() || '';
      const matchesSection = activeSection === 'all' || section === activeSection;
      const matchesSearch = !query || table.name.toLocaleLowerCase().includes(query);
      return matchesStatus && matchesSection && matchesSearch;
    });
  }, [tables, activeFilter, activeSection, search, heldOrders.orders]);

  const handleClick = (table: Table) => {
    const isHeld = heldOrders.hasHeldOrder(table.id);
    if (isHeld) {
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
      aria-label="All restaurant tables"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">All Tables</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a table to start an order or open its current activity.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg bg-green-50 px-2.5 py-1.5 font-medium text-green-700 dark:bg-green-950/30 dark:text-green-300">
            {counts.available} available
          </span>
          <span className="rounded-lg bg-orange-50 px-2.5 py-1.5 font-medium text-orange-700 dark:bg-orange-950/30 dark:text-orange-300">
            {counts.occupied} occupied
          </span>
          <span className="rounded-lg bg-blue-50 px-2.5 py-1.5 font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
            {counts.held} held
          </span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search table..."
            aria-label="Search tables"
            className="h-10 w-full rounded-lg border border-border bg-background ps-9 pe-3 text-sm outline-none transition-colors focus:border-brand"
          />
        </div>
        <div className="flex max-w-full flex-wrap gap-1.5" aria-label="Filter tables by status">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={activeFilter === filter.id}
              onClick={() => setActiveFilter(filter.id)}
              className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
                activeFilter === filter.id
                  ? 'border-brand bg-brand text-white'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {filter.label}
              <span className="ms-1 opacity-75">{counts[filter.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {sections.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5" aria-label="Filter tables by section">
          <button
            type="button"
            aria-pressed={activeSection === 'all'}
            onClick={() => setActiveSection('all')}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              activeSection === 'all'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/70'
            }`}
          >
            All sections
          </button>
          {sections.map((section) => (
            <button
              key={section}
              type="button"
              aria-pressed={activeSection === section}
              onClick={() => setActiveSection(section)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                activeSection === section
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {section}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-1">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {visibleTables.map((table) => {
            const isHeld = heldOrders.hasHeldOrder(table.id);
            const isSelected = selectedTableId === table.id;
            const activeOrder = table.current_order || table.activeOrder;
            const status = getEffectiveStatus(table);
            const isDisabled = table.status === 'cleaning' || (table.status === 'held' && !isHeld);
            const statusLabel = isHeld
              ? t('tableHeld')
              : tTables(TABLE_STATUS_LABEL_KEYS[table.status]);
            const cardStyle = isSelected
              ? 'border-brand bg-brand-light ring-2 ring-brand/20'
              : tableStatusStyles[status];
            const section = table.section?.trim() || table.floor?.trim();

            return (
              <button
                key={table.id}
                type="button"
                data-testid="pos-table-card"
                aria-label={`${table.name}, ${statusLabel}, ${t('tableSeats', { count: table.capacity })}`}
                onClick={() => !isDisabled && handleClick(table)}
                disabled={isDisabled}
                className={`relative flex min-h-32 flex-col items-start justify-between rounded-xl border-2 p-3 text-start transition-all hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50 sm:p-4 ${cardStyle}`}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <span className="text-xl font-bold text-foreground">{table.name}</span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                    status === 'available'
                      ? 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300'
                      : status === 'occupied'
                        ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300'
                        : status === 'held'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                          : status === 'reserved'
                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-300'
                            : 'bg-muted text-muted-foreground'
                  }`}>
                    {statusLabel}
                  </span>
                </div>
                <div className="mt-2 w-full">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{t('tableSeats', { count: table.capacity })}</span>
                    {section && <span className="truncate">{section}</span>}
                  </div>
                  {table.status === 'occupied' && activeOrder && (
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-current/10 pt-2">
                      <span className="text-xs font-medium text-orange-700 dark:text-orange-300">
                        #{activeOrder.order_number}
                      </span>
                      {typeof activeOrder.total === 'number' && (
                        <span className="text-xs font-semibold text-foreground">
                          {formatCurrency(activeOrder.total)}
                        </span>
                      )}
                    </div>
                  )}
                  {table.status === 'occupied' && table.seated_at && (
                    <div className="mt-1">
                      <TableTurnoverBadge seatedAt={table.seated_at} />
                    </div>
                  )}
                  {isHeld && (
                    <p className="mt-2 text-xs font-medium text-blue-700 dark:text-blue-300">
                      Held order ready to restore
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {visibleTables.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No tables match these filters.
          </p>
        )}

        {tables.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">{t('noTablesFound')}</p>
        )}
      </div>
    </section>
  );
}
