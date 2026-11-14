/** Safe rollout policy for packaged Windows NSIS self-updates. */

export const WINDOWS_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface WindowsUpdateRuntime {
  platform: string;
  packaged: boolean;
  storeManaged: boolean;
  developmentArtifact: boolean;
}

/** Only the direct-download Windows installer is eligible for automatic delivery. */
export function supportsAutomaticWindowsUpdates(input: WindowsUpdateRuntime): boolean {
  return (
    input.platform === 'win32' &&
    input.packaged &&
    !input.storeManaged &&
    !input.developmentArtifact
  );
}

export interface ScheduledWindowsUpdateCheckInput extends WindowsUpdateRuntime {
  automaticChecksEnabled: boolean;
  offlineMode: boolean;
  installReady: boolean;
  checkOrDownloadInFlight: boolean;
}

/** A periodic check must never run offline, during a download, or over a staged update. */
export function shouldRunScheduledWindowsUpdateCheck(
  input: ScheduledWindowsUpdateCheckInput,
): boolean {
  return (
    supportsAutomaticWindowsUpdates(input) &&
    input.automaticChecksEnabled &&
    !input.offlineMode &&
    !input.installReady &&
    !input.checkOrDownloadInFlight
  );
}
