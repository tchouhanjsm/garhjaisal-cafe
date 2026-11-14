'use client';

import { useEffect } from 'react';
import { Lock } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { CashCloseModal } from '@/components/dashboard/CashCloseModal';
import { useCashClose } from '@/hooks/useCashClose';
import { tenantCan } from '@/lib/permissions';
import { useAuthStore } from '@/store/auth';

export default function DayClosePage() {
  const { currentTenant } = useAuthStore();
  const t = useTranslations('dashboard');
  const canCloseDay = tenantCan(currentTenant, 'cash.day-close');
  const cashClose = useCashClose();
  const { openCloseModal } = cashClose;

  useEffect(() => {
    if (canCloseDay) openCloseModal();
  }, [canCloseDay, openCloseModal]);

  if (!canCloseDay) return null;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">{t('closeShift')}</h1>
      </header>
      <button
        type="button"
        onClick={() => openCloseModal()}
        className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-hover"
      >
        <Lock className="size-4" aria-hidden="true" />
        {t('closeShift')}
      </button>
      <CashCloseModal model={cashClose} />
    </main>
  );
}
