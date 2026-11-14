/** Tri-state tax-registration lifecycle shared by Settings and tax-pack activation. */

export const TAX_REGISTRATION_STATUSES = ['pending', 'registered', 'unregistered'] as const;

export type TaxRegistrationStatus = (typeof TAX_REGISTRATION_STATUSES)[number];

export function isTaxRegistrationStatus(value: unknown): value is TaxRegistrationStatus {
  return TAX_REGISTRATION_STATUSES.includes(value as TaxRegistrationStatus);
}

/** Legacy boolean values remain readable, but pending must never coerce to false. */
export function parseTaxRegistrationStatus(value: unknown): TaxRegistrationStatus {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (normalized === 'pending') return 'pending';
  if (normalized === true || ['true', '1', 'yes', 'on'].includes(String(normalized))) {
    return 'registered';
  }
  return 'unregistered';
}

export function taxRegistrationStatusToStoredValue(status: TaxRegistrationStatus): string {
  if (status === 'pending') return 'pending';
  return status === 'registered' ? 'true' : 'false';
}

export function isTaxRegistrationPending(value: unknown): boolean {
  return parseTaxRegistrationStatus(value) === 'pending';
}

export function taxRegistrationPendingResponse(): {
  error: string;
  code: 'tax_registration_pending';
} {
  return {
    error:
      'Tax registration is still pending accountant confirmation. Confirm the registration status in Business Settings before enabling a tax pack.',
    code: 'tax_registration_pending',
  };
}
