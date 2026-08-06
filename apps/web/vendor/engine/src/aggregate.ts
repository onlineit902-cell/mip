import type { Candle, Timeframe } from './types';
import { TF_MINUTES } from './types';

const MIN = 60_000;

/** Bucket start (ms) for a timestamp in the given timeframe. Weeks start Monday 00:00 UTC. */
export function bucketStart(ts: number, tf: Timeframe): number {
  if (tf === '1w') {
    const d = new Date(ts);
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 86_400_000;
    return monday;
  }
  const size = TF_MINUTES[tf] * MIN;
  return Math.floor(ts / size) * size;
}

/**
 * Aggregate candles into a higher timeframe. Correctness guarantees:
 * buckets aligned to the timeframe grid, OHLCV merged in arrival order,
 * volume summed only when the source feed actually has volume.
 */
export function aggregate(candles: Candle[], tf: Timeframe): Candle[] {
  if (candles.length === 0) return [];
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curBucket = -1;
  let volSum = 0;
  let anyVol = false;

  const flush = () => {
    if (cur) {
      cur.volume = anyVol ? volSum : null;
      out.push(cur);
    }
  };

  for (const c of candles) {
    const b = bucketStart(c.ts, tf);
    if (b !== curBucket) {
      flush();
      curBucket = b;
      cur = { ts: b, open: c.open, high: c.high, low: c.low, close: c.close };
      volSum = 0;
      anyVol = false;
    }
    cur!.high = Math.max(cur!.high, c.high);
    cur!.low = Math.min(cur!.low, c.low);
    cur!.close = c.close;
    if (c.volume != null) {
      volSum += c.volume;
      anyVol = true;
    }
  }
  flush();
  return out;
}

/** Weights for multi-timeframe composite scoring. */
export const MTF_WEIGHTS: Partial<Record<Timeframe, number>> = {
  '5m': 0.10,
  '15m': 0.15,
  '1h': 0.20,
  '4h': 0.25,
  '1d': 0.20,
  '1w': 0.10,
};

export const MIN_BARS = 30; // below this a timeframe is reported but marked insufficient
