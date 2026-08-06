import type { Candle } from '../../engine/src';
import type { Instrument } from './instruments';

/** Deterministic PRNG (same as engine tests). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Rough plausible base prices so synthetic series look sane per instrument. */
export const BASE_PRICE: Record<string, number> = {
  US500: 6250, NAS100: 22800, US30: 44500, GER40: 24200,
  XAUUSD: 3350, XAGUSD: 38.4, WTI: 71,
  EURUSD: 1.164, GBPUSD: 1.332, USDJPY: 148.6, AUDUSD: 0.652,
  NZDUSD: 0.594, USDCAD: 1.378, USDCHF: 0.877,
  BTC: 118000, ETH: 4150,
};

/**
 * Offline/dev fallback: a deterministic regime-switching random walk with
 * intraday pulls. Always ends at the current bucket so charts look "live".
 */
export function syntheticCandles(instrument: Instrument, intervalMs: number, bars: number): Candle[] {
  const rnd = mulberry32(seedFrom(instrument.symbol));
  const now = Date.now();
  const end = Math.floor(now / intervalMs) * intervalMs;
  let price = BASE_PRICE[instrument.symbol] ?? 100;

  // Volatility scaled to the timeframe: ~0.15% per 5m bar baseline
  const baseVol = 0.0015 * Math.sqrt(intervalMs / 300_000);
  const out: Candle[] = [];
  let regime = rnd() > 0.5 ? 1 : -1;

  for (let i = bars - 1; i >= 0; i--) {
    const ts = end - i * intervalMs;
    if (rnd() < 0.02) regime *= -1; // occasional regime flips
    const drift = regime * 0.00022 * Math.sqrt(intervalMs / 300_000);
    const shock = (rnd() + rnd() + rnd() - 1.5) * baseVol;
    const open = price;
    const close = Math.max(0.00001, price * (1 + drift + shock));
    const spread = (Math.abs(close - open) + price * baseVol * rnd()) * 0.6;
    const high = Math.max(open, close) + spread * rnd();
    const low = Math.min(open, close) - spread * rnd();
    out.push({ ts, open, high, low, close, volume: Math.round(500 + rnd() * 2000) });
    price = close;
  }
  return out;
}
