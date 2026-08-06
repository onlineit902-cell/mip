import type { Candle, Levels, LiquidityPool, Swing, Zone } from './types';

/**
 * Fair Value Gaps: a 3-candle imbalance. Bullish FVG at bar i when
 * low[i+1] > high[i-1]; the zone is (high[i-1], low[i+1]). Tracked until the
 * gap is fully traded through ("filled").
 */
export function detectFVGs(candles: Candle[], maxActive = 6): Zone[] {
  const zones: Zone[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1]!;
    const next = candles[i + 1]!;
    let z: Zone | null = null;
    if (next.low > prev.high) {
      z = { kind: 'fvg_bull', low: prev.high, high: next.low, ts: candles[i]!.ts, strength: 60, filled: false };
    } else if (next.high < prev.low) {
      z = { kind: 'fvg_bear', low: next.high, high: prev.low, ts: candles[i]!.ts, strength: 60, filled: false };
    }
    if (z) {
      // walk forward: filled once price trades completely through the zone
      for (let j = i + 2; j < candles.length; j++) {
        if (z.kind === 'fvg_bull' && candles[j]!.low <= z.low) { z.filled = true; break; }
        if (z.kind === 'fvg_bear' && candles[j]!.high >= z.high) { z.filled = true; break; }
      }
      zones.push(z);
    }
  }
  // freshest unfilled first, capped
  const open = zones.filter((z) => !z.filled);
  return open.slice(-maxActive);
}

/**
 * Supply & Demand, pragmatic definition:
 * an "impulse" candle (range >= 1.8*ATR and body >= 55% of range) marks a
 * departure; the candle immediately before it is the "base" whose range forms
 * the zone. Strength = impulse size, freshness and whether price has retested.
 */
export function supplyDemandZones(candles: Candle[], atrSeries: (number | null)[], maxPerSide = 3): Zone[] {
  const zones: Zone[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = atrSeries[i];
    if (a == null || a <= 0) continue;
    const c = candles[i]!;
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    if (range < 1.8 * a || body < 0.55 * range) continue;

    const base = candles[i - 1]!;
    const bullish = c.close > c.open;
    const z: Zone = {
      kind: bullish ? 'demand' : 'supply',
      low: base.low,
      high: base.high,
      ts: base.ts,
      strength: Math.min(100, Math.round(((range / a) / 4) * 100)),
      filled: false,
    };
    // subsequent tests weaken the zone; fully trading through kills it
    let tests = 0;
    for (let j = i + 1; j < candles.length; j++) {
      const t = candles[j]!;
      if (t.low <= z.high && t.high >= z.low) tests++;
      if (z.kind === 'demand' && t.close < z.low) { z.filled = true; }
      if (z.kind === 'supply' && t.close > z.high) { z.filled = true; }
      if (z.filled) break;
    }
    z.strength = Math.max(0, z.strength - tests * 15);
    if (!z.filled && z.strength > 10) zones.push(z);
  }
  const close = candles[candles.length - 1]!.close;
  const below = zones.filter((z) => z.high <= close).sort((a, b) => b.high - a.high).slice(0, maxPerSide);
  const above = zones.filter((z) => z.low >= close).sort((a, b) => a.low - b.low).slice(0, maxPerSide);
  return [...below, ...above];
}

/** Support/resistance by clustering confirmed swing prices within 0.25*ATR. */
export function srLevels(swings: Swing[], close: number, atr: number | null, maxPerSide = 3): Levels {
  const tol = (atr ?? close * 0.002) * 0.25 || close * 0.001;
  const prices = swings.map((s) => s.price).sort((a, b) => a - b);
  const clusters: { center: number; touches: number }[] = [];
  for (const p of prices) {
    const c = clusters[clusters.length - 1];
    if (c && Math.abs(p - c.center) <= tol) {
      c.center = (c.center * c.touches + p) / (c.touches + 1);
      c.touches++;
    } else {
      clusters.push({ center: p, touches: 1 });
    }
  }
  clusters.sort((a, b) => b.touches - a.touches);
  const support = clusters
    .filter((c) => c.center < close)
    .sort((a, b) => b.center - a.center)
    .slice(0, maxPerSide)
    .map((c) => c.center);
  const resistance = clusters
    .filter((c) => c.center > close)
    .sort((a, b) => a.center - b.center)
    .slice(0, maxPerSide)
    .map((c) => c.center);
  return { support, resistance };
}

/** Liquidity pools: clusters of near-equal highs (buyside) / lows (sellside). */
export function liquidityPools(swings: Swing[], atr: number | null, close: number): LiquidityPool[] {
  const tol = (atr ?? close * 0.002) * 0.1 || close * 0.0005;
  const pools: LiquidityPool[] = [];
  const groupBy = (kind: 'high' | 'low') => {
    const same = swings.filter((s) => s.kind === kind);
    const used = new Set<number>();
    for (let i = 0; i < same.length; i++) {
      if (used.has(i)) continue;
      const group = [same[i]!];
      for (let j = i + 1; j < same.length; j++) {
        if (!used.has(j) && Math.abs(same[j]!.price - same[i]!.price) <= tol) {
          group.push(same[j]!);
          used.add(j);
        }
      }
      if (group.length >= 2) {
        const avg = group.reduce((a, s) => a + s.price, 0) / group.length;
        pools.push({
          price: avg,
          kind: kind === 'high' ? 'buyside' : 'sellside',
          touches: group.length,
          ts: group[group.length - 1]!.ts,
        });
        used.add(i);
      }
    }
  };
  groupBy('high');
  groupBy('low');
  return pools.sort((a, b) => Math.abs(a.price - close) - Math.abs(b.price - close)).slice(0, 6);
}
