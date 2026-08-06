import { aggregate, MIN_BARS, MTF_WEIGHTS } from './aggregate';
import { fibGrid } from './fib';
import { macd, rsi } from './momentum';
import { ema, sma } from './moving-averages';
import { computeScores } from './score';
import { analyzeStructure } from './structure';
import type {
  Candle,
  CompositeAnalysis,
  Timeframe,
  TimeframeAnalysis,
} from './types';
import { atr, bollinger, relativeVolume } from './volatility';
import { detectFVGs, liquidityPools, srLevels, supplyDemandZones } from './zones';

const last = <T>(arr: (T | null)[]): T | null => arr[arr.length - 1] ?? null;

/** Full single-timeframe analysis over a candle series. */
export function analyzeTimeframe(candles: Candle[], timeframe: Timeframe): TimeframeAnalysis {
  if (candles.length === 0) throw new Error('analyzeTimeframe: no candles');
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e100 = ema(closes, 100);
  const e200 = ema(closes, 200);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const a = atr(candles, 14);
  const rv = relativeVolume(volumes, 20);

  const structure = analyzeStructure(candles, 3);
  const close = closes[closes.length - 1]!;
  const atrNow = last(a);

  const sd = supplyDemandZones(candles, a);
  const fvgs = detectFVGs(candles);
  const levels = srLevels(structure.swings, close, atrNow);
  const liquidity = liquidityPools(structure.swings, atrNow, close);
  const fib = fibGrid(structure.swings);

  const bbMidNow = last(bb.mid);
  const bbSeriesWidths: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const u = bb.upper[i];
    const l = bb.lower[i];
    const mdl = bb.mid[i];
    if (u != null && l != null && mdl) bbSeriesWidths.push((u - l) / mdl);
  }

  const scores = computeScores({
    close,
    emas: { e20: last(e20), e50: last(e50), e100: last(e100), e200: last(e200) },
    emaSeries20: e20,
    rsi: last(r),
    macdHist: m.hist,
    atrNow,
    atrSeries: a,
    relVol: last(rv),
    bbWidth: bbMidNow && last(bb.upper) != null && last(bb.lower) != null
      ? ((last(bb.upper)! - last(bb.lower)!) / bbMidNow)
      : null,
    bbWidthSeries: bbSeriesWidths,
    structure,
  });

  const lastBos = [...structure.events].reverse().find((e) => e.type === 'BOS') ?? null;
  const lastChoch = [...structure.events].reverse().find((e) => e.type === 'CHoCH') ?? null;

  return {
    timeframe,
    ts: candles[candles.length - 1]!.ts,
    close,
    ema20: last(e20),
    ema50: last(e50),
    ema100: last(e100),
    ema200: last(e200),
    sma20: last(s20),
    sma50: last(s50),
    rsi14: last(r),
    macd: last(m.macd),
    macdSignal: last(m.signal),
    macdHist: last(m.hist),
    bbUpper: last(bb.upper),
    bbMid: last(bb.mid),
    bbLower: last(bb.lower),
    atr14: atrNow,
    relVolume: last(rv),
    swings: structure.swings.slice(-12),
    structure: {
      trend: structure.trend,
      lastBos,
      lastChoch,
    },
    zones: [...sd, ...fvgs].slice(0, 10),
    liquidity,
    levels,
    fib,
    scores,
    bars: candles.length,
    sufficient: candles.length >= MIN_BARS,
  };
}

/**
 * Multi-timeframe composite. Input fetches: raw 5m (for LTFs), hourly (for
 * 1h/4h — needing ~3 months of history for a meaningful 4H), and daily
 * (for 1d/1w). Higher TFs are derived by aggregation, keeping every
 * timeframe internally consistent.
 */
export function analyzeMTF(input: {
  candles5m: Candle[];
  candlesHourly: Candle[];
  candlesDaily: Candle[];
}): CompositeAnalysis {
  const tfMap: Partial<Record<Timeframe, Candle[]>> = {
    '5m': input.candles5m,
    '15m': aggregate(input.candles5m, '15m'),
    '1h': input.candlesHourly,
    '4h': aggregate(input.candlesHourly, '4h'),
    '1d': input.candlesDaily,
    '1w': aggregate(input.candlesDaily, '1w'),
  };

  const perTimeframe: Partial<Record<Timeframe, TimeframeAnalysis>> = {};
  for (const tf of Object.keys(tfMap) as Timeframe[]) {
    const cs = tfMap[tf];
    if (cs && cs.length >= 30) perTimeframe[tf] = analyzeTimeframe(cs, tf);
  }

  const price = input.candles5m[input.candles5m.length - 1]?.close
    ?? input.candlesHourly[input.candlesHourly.length - 1]?.close
    ?? input.candlesDaily[input.candlesDaily.length - 1]?.close
    ?? 0;

  let weighted = 0;
  let weightSum = 0;
  const mtfAlignment: CompositeAnalysis['mtfAlignment'] = {};
  for (const tf of Object.keys(perTimeframe) as Timeframe[]) {
    const a = perTimeframe[tf]!;
    if (!a.sufficient) continue;
    const w = MTF_WEIGHTS[tf] ?? 0;
    weighted += a.scores.composite * w;
    weightSum += w;
    mtfAlignment[tf] = a.scores.bias;
  }
  const composite = weightSum > 0 ? weighted / weightSum : 50;
  const bias = composite >= 60 ? 'bullish' : composite <= 40 ? 'bearish' : 'neutral';
  let confidence = Math.min(100, Math.round(Math.abs(composite - 50) * 2));

  // conflicts reduce confidence; alignment increases it (within bounds)
  const dirs = Object.values(mtfAlignment);
  const bulls = dirs.filter((d) => d === 'bullish').length;
  const bears = dirs.filter((d) => d === 'bearish').length;
  if (bulls > 0 && bears > 0) confidence = Math.round(confidence * 0.8);

  const reasons: string[] = [];
  const h4 = perTimeframe['4h'];
  const h1 = perTimeframe['1h'];
  if (h4) reasons.push(`4H: ${h4.scores.bias} (${h4.scores.composite}) — ${h4.scores.reasons[0] ?? ''}`.trim());
  if (h1) reasons.push(`1H: ${h1.scores.bias} (${h1.scores.composite})`);
  if (bulls > 0 && bears > 0) reasons.push('Mixed signals across timeframes — confidence reduced');

  return {
    ts: Date.now(),
    price,
    bias: bias as CompositeAnalysis['bias'],
    confidence,
    composite: Math.round(composite * 10) / 10,
    mtfAlignment,
    perTimeframe,
    reasons,
  };
}

export const ENGINE_VERSION = '0.1.0';
