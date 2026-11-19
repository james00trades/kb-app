import { describe, expect, it } from 'vitest';
import { barShift } from '../src/lib/viewport';

describe('keeping fixed bars on screen (iOS 26 keyboard bug, James, Nov 19)', () => {
  it('moves bars by the offset iOS leaves behind after the keyboard closes', () => {
    expect(barShift({ offsetTop: 252.4, scale: 1 }, false)).toBe(252);
  });
  it('leaves them alone normally, while typing, when zoomed, or with no viewport info', () => {
    expect(barShift({ offsetTop: 0, scale: 1 }, false)).toBe(0);
    expect(barShift({ offsetTop: 200, scale: 1 }, true)).toBe(0);
    expect(barShift({ offsetTop: 200, scale: 1.5 }, false)).toBe(0);
    expect(barShift({ offsetTop: -8, scale: 1 }, false)).toBe(0);
    expect(barShift(undefined, false)).toBe(0);
  });
});
