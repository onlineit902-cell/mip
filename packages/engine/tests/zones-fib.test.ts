import { describe, expect, it } from 'vitest';
import { detectFVGs, fibGrid, liquidityPools, srLevels, supplyDemandZones } from '../src/index';
import type { Candle } from '../src/index';
import { tableCandles } from './helpers';

const pad = (c: Candle[], n: number, price: number) => {
  // extend a series with quiet bars at `price`
  const lastTs = c[c.length - 1]?.ts ?? 0;
  for (let i = 1; i <= n; i++) {
    c.push({ ts: lastTs + i * 300_000, open: price, high: price * 1.001, low: price * 0.999, close: price, volume: 100 });
  }
  return c;
};

describe('detectFVGs', () => {
  it('detects a bullish imbalance and leaves it open', () => {
    const cs = tableCandles([
      [10.5, 10.0, 10.4],   // 0: prev
      [11.6, 10.8, 11.5],   // 1: impulse candle
      [11.9, 11.3, 11.8],   // 2: next.low 11.3 > prev.high 10.5 → gap (10.5, 11.3)
      [12.2, 11.6, 12.1],   // 3: stays above
    ]);
    const zones = detectFVGs(cs);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ kind: 'fvg_bull', low: 10.5, high: 11.3, filled: false });
  });

  it('drops the gap once price trades fully through it', () => {
    const cs = tableCandles([
      [10.5, 10.0, 10.4],
      [11.6, 10.8, 11.5],
      [11.9, 11.3, 11.8],
      [11.2, 10.9, 11.1],   // not yet through 10.5
      [11.4, 10.2, 11.0],   // low 10.2 <= 10.5 → filled (high stays ≥ 11.3 → no new bear gap)
    ]);
    expect(detectFVGs(cs)).toHaveLength(0);
  });
});

describe('supplyDemandZones', () => {
  it('marks the base before an impulse as demand', () => {
    const cs = pad(
      tableCandles([
        [10.2, 9.9, 10.0],
        [10.3, 9.8, 10.1],  // base candle: (low 9.8, high 10.3)
        [12.1, 9.95, 12.0], // impulse: range 2.15, body 1.9 (open = prev close 10.1)
      ]),
      5,
      12.5,
    );
    const atrArr = cs.map(() => 1.0);
    const zones = supplyDemandZones(cs, atrArr);
    const demand = zones.find((z) => z.kind === 'demand');
    expect(demand).toBeDefined();
    expect(demand!.low).toBeCloseTo(9.8, 10);
    expect(demand!.high).toBeCloseTo(10.3, 10);
    expect(demand!.filled).toBe(false);
  });
});

describe('srLevels', () => {
  it('clusters nearby swing prices into levels', () => {
    const mk = (price: number, i: number, kind: 'high' | 'low') => ({
      index: i, ts: i * 60_000, price, kind, confirmedAtIndex: i + 2,
    });
    const swings = [
      mk(105.0, 0, 'high'), mk(105.1, 5, 'high'), mk(104.9, 10, 'high'), // cluster ~105
      mk(98.0, 2, 'low'), mk(98.05, 7, 'low'),                            // cluster ~98
      mk(112.0, 3, 'high'),
    ];
    const { support, resistance } = srLevels(swings, 100, 1.0);
    expect(support[0]).toBeGreaterThan(97.9);
    expect(support[0]).toBeLessThan(98.2);
    expect(resistance[0]).toBeGreaterThan(104.9);
    expect(resistance[0]).toBeLessThan(105.2);
  });
});

describe('liquidityPools', () => {
  it('flags equal highs as buyside liquidity', () => {
    const mk = (price: number, i: number, kind: 'high' | 'low') => ({
      index: i, ts: i * 60_000, price, kind, confirmedAtIndex: i + 2,
    });
    const swings = [mk(100, 0, 'high'), mk(100.05, 10, 'high'), mk(99.98, 20, 'high'), mk(90, 5, 'low')];
    const pools = liquidityPools(swings, 1.0, 95);
    const buyside = pools.find((p) => p.kind === 'buyside');
    expect(buyside).toBeDefined();
    expect(buyside!.touches).toBe(3);
  });
});

describe('fibGrid', () => {
  it('computes retracements and extensions of the active leg', () => {
    const mk = (price: number, i: number, kind: 'high' | 'low') => ({
      index: i, ts: i * 60_000, price, kind, confirmedAtIndex: i + 2,
    });
    const swings = [mk(100, 0, 'low'), mk(110, 5, 'high')];
    const fib = fibGrid(swings)!;
    expect(fib.direction).toBe('up');
    expect(fib.levels['0.382']).toBeCloseTo(110 - 10 * 0.382, 6);
    expect(fib.levels['0.618']).toBeCloseTo(110 - 10 * 0.618, 6);
    expect(fib.levels['1.272']).toBeCloseTo(100 + 10 * 1.272, 6);
  });
});
