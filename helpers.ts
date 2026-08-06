import type { Candle } from '../src/index';

export const MIN = 60_000;

/** Deterministic PRNG so fixtures never change between runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Candles from an explicit [high, low, close][] table (open = prev close). */
export function tableCandles(rows: [number, number, number][], intervalMs = 5 * MIN): Candle[] {
  const start = Date.UTC(2026, 0, 5, 0, 0, 0); // a Monday
  let prevClose = rows[0]![2];
  return rows.map(([h, l, c], i) => {
    const candle: Candle = { ts: start + i * intervalMs, open: prevClose, high: h, low: l, close: c, volume: 1000 };
    prevClose = c;
    return candle;
  });
}

/**
 * Deterministic staircase uptrend: 8-bar impulse (+0.6%/bar) then a 4-bar
 * pullback (−0.25%/bar). Every 12-bar cycle prints a clear higher high and
 * higher low, so structure is unambiguous while still having real pivots.
 */
export function trendingSeries(n: number, intervalMs = 5 * MIN, seed = 42): Candle[] {
  const rnd = mulberry32(seed);
  const start = Date.UTC(2026, 0, 5, 0, 0, 0);
  let price = 100;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const phase = i % 12;
    const step = phase < 8 ? 1.006 : 0.9975;
    const open = price;
    const close = price * step;
    const wobble = 1 + (rnd() - 0.5) * 0.0002;
    const high = Math.max(open, close) * 1.0005 * wobble;
    const low = Math.min(open, close) * 0.9995 * wobble;
    out.push({ ts: start + i * intervalMs, open, high, low, close, volume: 800 + rnd() * 800 });
    price = close;
  }
  return out;
}

/** Dead-flat tape at exactly 100 — should score perfectly neutral. */
export function flatSeries(n: number, intervalMs = 5 * MIN): Candle[] {
  const start = Date.UTC(2026, 0, 5, 0, 0, 0);
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ ts: start + i * intervalMs, open: 100, high: 100, low: 100, close: 100, volume: 1000 });
  }
  return out;
}
