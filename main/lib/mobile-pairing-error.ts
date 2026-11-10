function cloudErrorMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

function isUnregisteredCloudError(error: unknown): boolean {
  return cloudErrorMessage(error)?.includes('is not registered') ?? false;
}

export function mobilePairingErrorStatus(error: unknown): number {
  return isUnregisteredCloudError(error) ? 409 : 502;
}

export function mobilePairingErrorMessage(error: unknown): string {
  if (isUnregisteredCloudError(error)) {
    return 'FloCafe is not registered with FloAdmin yet. Check your internet connection and make sure Cloud Services are enabled, then try again. Registration is automatic; no separate claim step is needed.';
  }
  return cloudErrorMessage(error) || 'Could not reach FloAdmin';
}
