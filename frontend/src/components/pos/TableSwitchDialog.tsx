'use client';

import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  currentTableName: string | null;
  targetTableName: string;
  itemCount: number;
  hasExistingOrder: boolean;
  canHold: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onHold: () => void;
}

export default function TableSwitchDialog({
  open,
  currentTableName,
  targetTableName,
  itemCount,
  hasExistingOrder,
  canHold,
  onCancel,
  onDiscard,
  onHold,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      data-testid="pos-table-switch-dialog"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-table-switch-title"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            <AlertTriangle size={20} />
          </span>
          <div className="min-w-0">
            <h2 id="pos-table-switch-title" className="text-lg font-bold text-foreground">
              Switch tables?
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {hasExistingOrder
                ? `You are adding items to ${currentTableName || 'the current order'}.`
                : `You have ${itemCount} unsent ${itemCount === 1 ? 'item' : 'items'}${currentTableName ? ` for ${currentTableName}` : ' in the cart'}.`}
              {' '}Switching to {targetTableName} will not move those items automatically.
            </p>
            {hasExistingOrder && (
              <p className="mt-2 text-xs text-muted-foreground">
                Leaving this mode does not cancel or change the existing submitted order.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {canHold && (
            <button
              type="button"
              onClick={onHold}
              className="min-h-11 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Hold current order and switch
            </button>
          )}
          <button
            type="button"
            data-testid="pos-table-switch-discard"
            onClick={onDiscard}
            className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700"
          >
            {hasExistingOrder ? 'Discard unsent additions and switch' : 'Discard unsent items and switch'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg px-4 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Stay on current table
          </button>
        </div>
      </div>
    </div>
  );
}
