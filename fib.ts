import type { FibGrid, Swing } from './types';

const FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786] as const;

/**
 * Fibonacci grid over the active leg: from the most recent confirmed swing low
 * to the most recent confirmed swing high (or vice-versa, whichever leg is newer).
 * Includes 1.272 / 1.618 extensions projected past the terminal swing.
 */
export function fibGrid(swings: Swing[]): FibGrid | null {
  const highs = swings.filter((s) => s.kind === 'high');
  const lows = swings.filter((s) => s.kind === 'low');
  if (!highs.length || !lows.length) return null;
  const h = highs[highs.length - 1]!;
  const l = lows[lows.length - 1]!;
  const up = l.index < h.index; // low formed before high → leg is upward
  const swingHigh = up ? h.price : Math.max(h.price, l.price);
  const swingLow = up ? Math.min(h.price, l.price) : l.price;
  if (swingHigh <= swingLow) return null;
  const range = swingHigh - swingLow;

  const levels: FibGrid['levels'] = {} as FibGrid['levels'];
  for (const r of FIB_RATIOS) {
    // retracement levels from the terminal swing back into the leg
    levels[String(r) as keyof FibGrid['levels']] = up ? swingHigh - range * r : swingLow + range * r;
  }
  levels['1.272'] = up ? swingLow + range * 1.272 : swingHigh - range * 1.272;
  levels['1.618'] = up ? swingLow + range * 1.618 : swingHigh - range * 1.618;

  return { swingHigh, swingLow, direction: up ? 'up' : 'down', levels };
}
