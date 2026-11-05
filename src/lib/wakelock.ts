// Keeps the screen on during workouts and timers (timer alerts can't fire on a locked phone).

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

export const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

async function acquire() {
  if (!wakeLockSupported || sentinel || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    sentinel = null;
  }
}

export function setAwake(on: boolean) {
  wanted = on;
  if (on) void acquire();
  else if (sentinel) {
    void sentinel.release();
    sentinel = null;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') void acquire();
  });
}
