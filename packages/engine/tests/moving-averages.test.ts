import { describe, expect, it } from 'vitest';
import { ema, slope, sma } from '../src/index';

const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('sma', () => {
  it('is null until period is filled, then exact', () => {
    const s = sma(series, 3);
    expect(s[0]).toBeNull();
    expect(s[1]).toBeNull();
    expect(s[2]).toBeCloseTo(2, 10);
    expect(s[9]).toBeCloseTo(9, 10);
  });
});

describe('ema', () => {
  it('seeds with SMA at period-1 and recurses correctly', () => {
    const e = ema(series, 3);
    expect(e[1]).toBeNull();
    expect(e[2]).toBeCloseTo(2, 10); // seed = mean(1,2,3)
    // k = 0.5 → ema[3] = 4*0.5 + 2*0.5 = 3, linear series keeps lag of 1
    expect(e[3]).toBeCloseTo(3, 10);
    expect(e[9]).toBeCloseTo(9, 10);
  });

  it('returns all null when input shorter than period', () => {
    expect(ema([1, 2], 5).every((v) => v === null)).toBe(true);
  });
});

describe('slope', () => {
  it('measures per-bar slope over lookback', () => {
    const e = ema(series, 3); // last: 9, 5 bars back: 4
    const s = slope(e, 5);
    expect(s).toBeCloseTo(1, 10);
  });
});
