'use client';

import { AlertTriangle, CheckCircle2, Loader2, Printer, RotateCcw, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { KotStationPrintOutcome } from '@/hooks/usePrinter';

interface Props {
  open: boolean;
  results: KotStationPrintOutcome[];
  retryingStationKeys: string[];
  onRetry: (station: KotStationPrintOutcome) => void;
  onClose: () => void;
}

function stationKey(station: KotStationPrintOutcome): string {
  return `${station.station_name}::${station.printer_name}`;
}

export function KotDispatchRecoveryModal({
  open,
  results,
  retryingStationKeys,
  onRetry,
  onClose,
}: Props) {
  const submittedCount = results.filter((result) => result.dispatch_state === 'submitted').length;
  const failedCount = results.filter((result) => result.dispatch_state === 'failed').length;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="kot-dispatch-recovery-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="size-5" />
            Kitchen ticket dispatch
          </DialogTitle>
          <DialogDescription>
            Review each kitchen station before retrying. Stations already submitted will not be sent
            again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="text-green-700 dark:text-green-400">
              {submittedCount} submitted
            </span>
            <span className="text-destructive">{failedCount} need attention</span>
          </div>

          {results.map((result) => {
            const key = stationKey(result);
            const retrying = retryingStationKeys.includes(key);
            const submitted = result.dispatch_state === 'submitted';
            const safeToRetry = result.retry_safety === 'safe_to_retry';

            return (
              <section
                key={key}
                className="rounded-xl border border-border p-3"
                data-testid={`kot-station-${result.station_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold">
                      {submitted ? (
                        <CheckCircle2 className="size-4 shrink-0 text-green-600" />
                      ) : (
                        <XCircle className="size-4 shrink-0 text-destructive" />
                      )}
                      <span>{result.station_name}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {result.printer_name} · {result.item_count} item
                      {result.item_count === 1 ? '' : 's'}
                    </p>
                  </div>

                  <span
                    className={
                      submitted
                        ? 'rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300'
                        : 'rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive'
                    }
                  >
                    {submitted ? 'Submitted' : 'Failed'}
                  </span>
                </div>

                {!submitted && (
                  <div className="mt-3 space-y-2">
                    <p className="flex items-start gap-2 text-sm text-muted-foreground">
                      {safeToRetry ? (
                        <RotateCcw className="mt-0.5 size-4 shrink-0" />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                      )}
                      <span>
                        {safeToRetry
                          ? 'No printer connection was established. Retrying this station is safe.'
                          : 'The ticket may have reached the printer. Check the physical ticket before retrying.'}
                      </span>
                    </p>
                    {result.detail && (
                      <p className="break-words text-xs text-muted-foreground">{result.detail}</p>
                    )}
                    {safeToRetry && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onRetry(result)}
                        disabled={retrying}
                        data-testid={`retry-kot-${result.station_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                      >
                        {retrying ? (
                          <Loader2 className="me-2 size-4 animate-spin" />
                        ) : (
                          <RotateCcw className="me-2 size-4" />
                        )}
                        Retry {result.station_name}
                      </Button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
