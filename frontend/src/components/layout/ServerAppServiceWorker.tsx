'use client';

import { useEffect } from 'react';

/**
 * The Server App is served from its own standalone root layout. Register its
 * worker explicitly instead of relying on the desktop/dashboard root layout.
 */
export function ServerAppServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  return null;
}
