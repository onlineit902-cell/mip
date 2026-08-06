import type { Candle, StructureEvent, StructureResult, Swing, TrendDir } from './types';

/**
 * Fractal pivots: candle i is a swing high if its high is strictly greater than
 * the k candles on each side (ties go to the later bar). A pivot is "confirmed"
 * k bars after it forms — only confirmed pivots may drive structure events,
 * which is what keeps BOS/CHoCH signals from repainting.
 */
export function findSwings(candles: Candle[], k = 3): Swing[] {
  const swings: Swing[] = [];
  const n = candles.length;
  for (let i = k; i < n - k; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j]!.high >= c.high) isHigh = false;
      if (candles[j]!.low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) {
      swings.push({ index: i, ts: c.ts, price: c.high, kind: 'high', confirmedAtIndex: i + k });
    }
    if (isLow) {
      swings.push({ index: i, ts: c.ts, price: c.low, kind: 'low', confirmedAtIndex: i + k });
    }
  }
  labelSwings(swings);
  return swings;
}

/** Assign HH / HL / LH / LL by comparing each pivot with the previous pivot of the same kind. */
export function labelSwings(swings: Swing[]): void {
  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  for (const s of swings) {
    if (s.kind === 'high') {
      if (lastHigh) s.label = s.price > lastHigh.price ? 'HH' : 'LH';
      lastHigh = s;
    } else {
      if (lastLow) s.label = s.price > lastLow.price ? 'HL' : 'LL';
      lastLow = s;
    }
  }
}

/**
 * Market structure: trend from the confirmed swing sequence, plus BOS / CHoCH
 * events. Rules (long side, mirrored for shorts):
 *   trend up   = latest confirmed swing sequence prints HH + HL
 *   BOS up     = a close above the most recent confirmed swing high while trend is up
 *   CHoCH down = a close below the most recent confirmed swing low while trend is up
 */
export function analyzeStructure(candles: Candle[], k = 3): StructureResult {
  const swings = findSwings(candles, k);
  const events: StructureEvent[] = [];

  let trend: TrendDir = 'range';
  let refHigh: Swing | null = null; // most recent confirmed swing high
  let refLow: Swing | null = null;  // most recent confirmed swing low
  let brokenHighIdx = -1;           // which refHigh index was last broken (avoid repeat events)
  let brokenLowIdx = -1;

  const confirmed = swings.filter((s) => s.confirmedAtIndex < candles.length);

  for (let i = 0; i < candles.length; i++) {
    // Promote swings that become confirmed at this bar.
    for (const s of confirmed) {
      if (s.confirmedAtIndex === i) {
        if (s.kind === 'high') refHigh = s;
        else refLow = s;

        const highs = confirmed.filter((x) => x.kind === 'high' && x.confirmedAtIndex <= i).slice(-2);
        const lows = confirmed.filter((x) => x.kind === 'low' && x.confirmedAtIndex <= i).slice(-2);
        if (highs.length === 2 && lows.length === 2) {
          const hh = highs[1]!.price > highs[0]!.price;
          const hl = lows[1]!.price > lows[0]!.price;
          if (hh && hl) trend = 'up';
          else if (!hh && !hl) trend = 'down';
          // mixed sequences keep the prior trend (compression)
        }
      }
    }

    const close = candles[i]!.close;
    if (refHigh && brokenHighIdx !== refHigh.index && close > refHigh.price) {
      brokenHighIdx = refHigh.index;
      events.push({
        type: trend === 'down' ? 'CHoCH' : 'BOS',
        direction: 'up',
        index: i,
        ts: candles[i]!.ts,
        level: refHigh.price,
      });
      if (trend === 'down') trend = 'up';
      else if (trend === 'range') trend = 'up';
    }
    if (refLow && brokenLowIdx !== refLow.index && close < refLow.price) {
      brokenLowIdx = refLow.index;
      events.push({
        type: trend === 'up' ? 'CHoCH' : 'BOS',
        direction: 'down',
        index: i,
        ts: candles[i]!.ts,
        level: refLow.price,
      });
      if (trend === 'up') trend = 'down';
      else if (trend === 'range') trend = 'down';
    }
  }

  // keep at most one event per level/direction — protects against whipsaw bars
  const seen = new Set<string>();
  const deduped: StructureEvent[] = [];
  for (const e of events) {
    const key = `${e.direction}:${e.level}:${e.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(e);
    }
  }

  return { swings, trend, events: deduped };
}
