import { describe, expect, it } from 'vitest';
import { atr, bollinger, macd, relativeVolume, rsi } from '../src/index';
import { flatSeries, tableCandles, trendingSeries } from './helpers';

describe('rsi (Wilder)', () => {
  it('approaches 100 on a steady climb', () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i);
    const r = rsi(up, 14);
    expect(r[13]).toBeNull();
    expect(r[39]!).toBeGreaterThan(99);
  });

  it('approaches 0 on a steady decline', () => {
    const down = Array.from({ length: 40 }, (_, i) => 100 - i);
    const r = rsi(down, 14);
    expect(r[39]!).toBeLessThan(1);
  });

  it('is 50 on a flat tape (not 100)', () => {
    const flat = Array.from({ length: 30 }, () => 50);
    const r = rsi(flat, 14);
    expect(r[29]).toBeCloseTo(50, 6);
  });
});

describe('macd', () => {
  it('arrays align to input length; hist positive in uptrend', () => {
    const closes = trendingSeries(120).map((c) => c.close);
    const m = macd(closes);
    expect(m.macd).toHaveLength(120);
    expect(m.signal).toHaveLength(120);
    expect(m.hist).toHaveLength(120);
    expect(m.macd[119]).not.toBeNull();
    expect(m.macd[119]!).toBeGreaterThan(0);
  });
});

describe('atr', () => {
  it('matches constant true range', () => {
    const rows: [number, number, number][] = Array.from({ length: 30 }, (_, i) => [12, 10, 11]);
    const cs = tableCandles(rows);
    // first candle has no prev close → TR from candle 1..: high-low = 2
    const a = atr(cs, 14);
    expect(a[14]).toBeCloseTo(2, 6);
    expect(a[29]).toBeCloseTo(2, 6);
  });
});

describe('bollinger', () => {
  it('collapses on constant closes', () => {
    const closes = flatSeries(40).map((c) => Math.round(c.close * 1e6) / 1e6);
    const b = bollinger(closes, 20, 2);
    expect(b.upper[39]! - b.lower[39]!).toBeLessThan(0.01);
    expect(b.mid[39]).toBeCloseTo(100, 1);
  });
});

describe('relativeVolume', () => {
  it('flags elevated volume', () => {
    const vols = Array.from({ length: 30 }, () => 1000);
    vols[29] = 2500;
    const rv = relativeVolume(vols, 20);
    expect(rv[29]!).toBeCloseTo(2.5, 5);
  });

  it('returns nulls when the feed has no volume', () => {
    const rv = relativeVolume([null, null, null], 20);
    expect(rv.every((v) => v === null)).toBe(true);
  });
});
