import { ema } from './moving-averages';
import type { MacdResult } from './types';

/**
 * RSI using Wilder's smoothing (the so-called "RMA"), matching the classic
 * Welles Wilder definition and every major platform.
 */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    if (ch > 0) avgGain += ch; else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = rsiFromAvgs(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFromAvgs(avgGain, avgLoss);
  }
  return out;
}

function rsiFromAvgs(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0 && avgGain === 0) return 50; // flat tape → neutral
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** MACD (12, 26, 9) — EMA based, arrays aligned to input length. */
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const macdLine: (number | null)[] = closes.map((_, i) => {
    const f = fastE[i];
    const s = slowE[i];
    return f == null || s == null ? null : f - s;
  });

  // Signal line: EMA of the macd line over its non-null tail.
  const firstValid = macdLine.findIndex((v) => v != null);
  const signal: (number | null)[] = new Array(closes.length).fill(null);
  if (firstValid >= 0) {
    const tail = macdLine.slice(firstValid) as number[];
    const sig = ema(tail, signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[firstValid + i] = sig[i] ?? null;
  }

  const hist: (number | null)[] = closes.map((_, i) => {
    const m = macdLine[i];
    const s = signal[i];
    return m == null || s == null ? null : m - s;
  });
  return { macd: macdLine, signal, hist };
}

/** Returns the number of bars since the last sign change of a series (histogram), or null. */
export function barsSinceCross(series: (number | null)[]): { bars: number; direction: 'up' | 'down' } | null {
  for (let i = series.length - 1; i > 0; i--) {
    const a = series[i - 1];
    const b = series[i];
    if (a == null || b == null) continue;
    if (a <= 0 && b > 0) return { bars: series.length - 1 - i, direction: 'up' };
    if (a >= 0 && b < 0) return { bars: series.length - 1 - i, direction: 'down' };
  }
  return null;
}
