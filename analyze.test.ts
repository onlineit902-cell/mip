import { describe, expect, it } from 'vitest';
import { aggregate, analyzeMTF, analyzeTimeframe, bucketStart } from '../src/index';
import { flatSeries, tableCandles, trendingSeries } from './helpers';

describe('aggregate', () => {
  it('merges 15m bars into correct 1h buckets', () => {
    const rows: [number, number, number][] = Array.from({ length: 8 }, (_, i) => {
      const c = i + 1;
      return [c + 1, c - 1, c];
    });
    const cs = tableCandles(rows, 900_000); // 8 × 15m (open = prev close)
    const hourly = aggregate(cs, '1h');
    expect(hourly).toHaveLength(2);
    expect(hourly[0]).toMatchObject({ open: 1, close: 4, high: 5, low: 0 });
    expect(hourly[1]).toMatchObject({ open: 4, close: 8, high: 9, low: 4 });
    expect(hourly[0]!.volume).toBe(4000);
  });

  it('anchors weekly buckets to Monday 00:00 UTC', () => {
    const wed = Date.UTC(2026, 0, 7, 13, 30, 0); // Wednesday
    const mon = Date.UTC(2026, 0, 5, 0, 0, 0);
    expect(bucketStart(wed, '1w')).toBe(mon);
  });
});

describe('analyzeTimeframe', () => {
  it('reads a clean uptrend as bullish with high confidence', () => {
    const a = analyzeTimeframe(trendingSeries(400), '5m');
    expect(a.sufficient).toBe(true);
    expect(a.scores.bias).toBe('bullish');
    expect(a.scores.composite).toBeGreaterThanOrEqual(60);
    expect(a.scores.confidence).toBeGreaterThan(40);
    expect(a.ema20!).toBeGreaterThan(a.ema50!);
    expect(a.structure.trend).toBe('up');
    expect(a.rsi14!).toBeGreaterThan(50);
    expect(a.atr14!).toBeGreaterThan(0);
    expect(a.swings.length).toBeGreaterThan(2);
    expect(a.scores.reasons.length).toBeGreaterThan(0);
  });

  it('reads a flat tape as neutral', () => {
    const a = analyzeTimeframe(flatSeries(200), '5m');
    expect(Math.abs(a.scores.composite - 50)).toBeLessThan(8);
    expect(a.scores.bias).toBe('neutral');
    expect(a.rsi14).toBeCloseTo(50, 0);
  });
});

describe('analyzeMTF', () => {
  it('composites timeframes with alignment', () => {
    const res = analyzeMTF({
      candles5m: trendingSeries(1500, 5 * 60_000),
      candlesHourly: trendingSeries(1200, 3_600_000, 5),
      candlesDaily: trendingSeries(120, 86_400_000, 9),
    });
    expect(res.bias).toBe('bullish');
    expect(res.composite).toBeGreaterThanOrEqual(60);
    expect(res.mtfAlignment['4h']).toBeDefined();
    expect(res.perTimeframe['15m']!.bars).toBeGreaterThan(200);
    expect(res.price).toBeGreaterThan(0);
  });
});
