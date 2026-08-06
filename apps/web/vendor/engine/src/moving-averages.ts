/**
 * Moving averages with conventional seeding behaviour:
 *  - SMA: null until `period` values exist.
 *  - EMA: null until `period` values exist, seeded with the SMA at that point,
 *    then the standard 2/(n+1) recursion. This matches TradingView/ta-lib closely.
 */

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) throw new Error('period must be > 0');
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) throw new Error('period must be > 0');
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    const next = values[i]! * k + prev * (1 - k);
    out[i] = next;
    prev = next;
  }
  return out;
}

/** Simple slope over `lookback` bars expressed per-bar. */
export function slope(series: (number | null)[], lookback = 5): number | null {
  const n = series.length;
  if (n < lookback + 1) return null;
  const a = series[n - 1 - lookback];
  const b = series[n - 1];
  if (a == null || b == null) return null;
  return (b - a) / lookback;
}
