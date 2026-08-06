import { describe, expect, it } from 'vitest';
import { analyzeStructure, findSwings } from '../src/index';
import { tableCandles } from './helpers';

/**
 * Hand-built zigzag, k=2 expectations:
 *  swing highs: 12.6 @4, 13.4 @9 (HH), 14.2 @14 (HH), 15.0 @21 (HH)
 *  swing lows : 11.2 @6, 11.8 @11 (HL), 12.4 @17 (HL)
 *  events     : BOS up @8 (through 12.6), BOS up @13 (through 13.4),
 *               BOS up @20 (close 14.3 through 14.2), CHoCH down @25 (through 12.4)
 */
const ROWS: [number, number, number][] = [
  [10.5, 9.5, 10.0],   // 0
  [11.0, 10.2, 10.8],  // 1
  [11.4, 10.8, 11.2],  // 2
  [11.9, 11.2, 11.7],  // 3
  [12.6, 11.9, 12.4],  // 4  swing HIGH 12.6
  [12.0, 11.4, 11.7],  // 5
  [11.9, 11.2, 11.5],  // 6  swing LOW 11.2
  [12.3, 11.6, 12.1],  // 7
  [12.9, 12.0, 12.7],  // 8  close 12.7 > 12.6 → BOS up
  [13.4, 12.6, 13.2],  // 9  swing HIGH 13.4 (HH)
  [12.9, 12.2, 12.4],  // 10
  [12.4, 11.8, 12.0],  // 11 swing LOW 11.8 (HL)
  [12.9, 12.2, 12.7],  // 12
  [13.8, 12.6, 13.6],  // 13 close 13.6 > 13.4 → BOS up
  [14.2, 13.2, 14.0],  // 14 swing HIGH 14.2 (HH)
  [13.9, 13.0, 13.3],  // 15
  [13.4, 12.8, 13.0],  // 16
  [13.0, 12.4, 12.6],  // 17 swing LOW 12.4 (HL)
  [13.3, 12.9, 13.1],  // 18
  [13.9, 13.2, 13.7],  // 19
  [14.5, 13.6, 14.3],  // 20
  [15.0, 14.0, 14.8],  // 21 swing HIGH 15.0 (HH)
  [14.4, 13.4, 13.6],  // 22
  [13.8, 13.0, 13.2],  // 23
  [13.2, 12.2, 12.4],  // 24
  [12.6, 11.8, 12.0],  // 25 close 12.0 < 12.4 → CHoCH down
];

const candles = tableCandles(ROWS);

describe('findSwings (k=2)', () => {
  const swings = findSwings(candles, 2);

  it('finds the expected pivots', () => {
    const highs = swings.filter((s) => s.kind === 'high').map((s) => [s.price, s.index]);
    const lows = swings.filter((s) => s.kind === 'low').map((s) => [s.price, s.index]);
    expect(highs).toContainEqual([12.6, 4]);
    expect(highs).toContainEqual([13.4, 9]);
    expect(highs).toContainEqual([14.2, 14]);
    expect(highs).toContainEqual([15.0, 21]);
    expect(lows).toContainEqual([11.2, 6]);
    expect(lows).toContainEqual([11.8, 11]);
    expect(lows).toContainEqual([12.4, 17]);
  });

  it('labels HH/HL correctly', () => {
    const byIdx = new Map(swings.map((s) => [s.index, s]));
    expect(byIdx.get(9)!.label).toBe('HH');
    expect(byIdx.get(14)!.label).toBe('HH');
    expect(byIdx.get(11)!.label).toBe('HL');
    expect(byIdx.get(17)!.label).toBe('HL');
    expect(byIdx.get(4)!.label).toBeUndefined(); // first of its kind
  });

  it('respects the k-bar confirmation delay', () => {
    for (const s of swings) expect(s.confirmedAtIndex).toBe(s.index + 2);
  });
});

describe('analyzeStructure', () => {
  const res = analyzeStructure(candles, 2);

  it('emits BOS/BOS/BOS/CHoCH in order', () => {
    const kinds = res.events.map((e) => `${e.type}:${e.direction}@${e.index}`);
    expect(kinds).toEqual(['BOS:up@8', 'BOS:up@13', 'BOS:up@20', 'CHoCH:down@25']);
  });

  it('records the broken level on each event', () => {
    expect(res.events[0]!.level).toBe(12.6);
    expect(res.events[1]!.level).toBe(13.4);
    expect(res.events[2]!.level).toBe(14.2);
    expect(res.events[3]!.level).toBe(12.4);
  });

  it('flips trend to down after the CHoCH', () => {
    expect(res.trend).toBe('down');
  });
});
