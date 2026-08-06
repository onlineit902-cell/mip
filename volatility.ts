import { sma } from './moving-averages';
import type { BollingerResult, Candle } from './types';

/** ATR using Wilder's smoothing over true range. */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;

  const trs: number[] = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const pc = candles[i - 1]!.close;
    trs[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trs[i]!;
  let prev = sum / period;
  out[period] = prev;

  for (let i = period + 1; i < candles.length; i++) {
    const next = (prev * (period - 1) + trs[i]!) / period;
    out[i] = next;
    prev = next;
  }
  return out;
}

/** Bollinger Bands (20, 2) — population standard deviation like most platforms. */
export function bollinger(closes: number[], period = 20, mult = 2): BollingerResult {
  const mid = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i]!;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) acc += (closes[j]! - m) ** 2;
    const sd = Math.sqrt(acc / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, mid, lower };
}

/** Rolling VWAP over `period` bars (session-agnostic approximation for dev-mode). */
export function rollingVwap(candles: Candle[], period = 20): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let pv = 0;
  let vv = 0;
  const window: { pv: number; v: number }[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const v = c.volume ?? 0;
    const tp = (c.high + c.low + c.close) / 3;
    window.push({ pv: tp * v, v });
    pv += tp * v;
    vv += v;
    if (window.length > period) {
      const old = window.shift()!;
      pv -= old.pv;
      vv -= old.v;
    }
    if (i >= period - 1) out[i] = vv > 0 ? pv / vv : null;
  }
  return out;
}

/**
 * Volume relative to the mean of the PRIOR `period` bars (current bar excluded,
 * so a spike is measured against what came before it). Null when the feed
 * has no volume (e.g. cash indices).
 */
export function relativeVolume(volumes: (number | null | undefined)[], period = 20): (number | null)[] {
  const out: (number | null)[] = new Array(volumes.length).fill(null);
  let sum = 0;
  const window: number[] = [];
  for (let i = 0; i < volumes.length; i++) {
    const v = volumes[i];
    if (v == null) {
      window.length = 0;
      sum = 0;
      continue;
    }
    if (window.length === period && sum > 0) {
      out[i] = v / (sum / period);
    }
    window.push(v);
    sum += v;
    if (window.length > period) sum -= window.shift()!;
  }
  return out;
}
