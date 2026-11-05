// Offline install + updates. A new version waits until the user taps "Update" (never mid-workout).
import { signal } from '@preact/signals';
import { registerSW } from 'virtual:pwa-register';

export const updateReady = signal(false);
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

export function initPWA() {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateReady.value = true;
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // Check for a new version when the app comes back to the foreground
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) void reg.update();
      });
    },
  });
}

export function applyUpdate() {
  void updateSW?.(true);
}
