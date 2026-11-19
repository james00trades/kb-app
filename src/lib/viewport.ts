// iOS 26 bug (James, Nov 19: the tab bar "comes unstuck from the bottom and rises with my scroll" on the
// Library): after the keyboard closes, iOS can leave the visible screen offset from the page's layout
// viewport (visualViewport.offsetTop stays above 0). Fixed bars belong to the layout viewport, so they
// slide with the scroll by up to about a keyboard's height. Reported by many web apps; no fix from Apple
// yet (developer.apple.com/forums/thread/800125, bugs.webkit.org/show_bug.cgi?id=297779).
// Workaround: measure that offset and shift every fixed bar and overlay by it (CSS var --vv-shift).
// Normally the offset is 0, so nothing moves.

interface ViewportLike {
  offsetTop: number;
  scale: number;
}

/** How far to move fixed bars down so they sit on the visible screen again. 0 while typing (iOS moves
 *  the screen to show the field then, as it should) or zoomed in. */
export function barShift(vv: ViewportLike | null | undefined, typing: boolean): number {
  if (!vv || typing || Math.abs(vv.scale - 1) > 0.01) return 0;
  return Math.max(0, Math.round(vv.offsetTop));
}

const TEXT_INPUTS = new Set(['text', 'search', 'number', 'email', 'tel', 'url', 'password', 'date', 'time', 'datetime-local', 'month', 'week']);

function typing(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  if (a.tagName === 'TEXTAREA' || a.isContentEditable) return true;
  return a.tagName === 'INPUT' && TEXT_INPUTS.has((a as HTMLInputElement).type);
}

export function pinFixedBars(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let last = -1;
  const apply = () => {
    const shift = barShift(vv, typing());
    if (shift === last) return;
    last = shift;
    root.style.setProperty('--vv-shift', `${shift}px`);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  window.addEventListener('scroll', apply, { passive: true });
  // The keyboard takes a moment to go away after a field loses focus
  const later = () => {
    apply();
    setTimeout(apply, 100);
    setTimeout(apply, 500);
  };
  document.addEventListener('focusin', later);
  document.addEventListener('focusout', later);
  document.addEventListener('visibilitychange', later);
  apply();
}
