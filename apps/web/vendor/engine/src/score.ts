import { slope } from './moving-averages';
import type { Regime, ScoreSet, StructureResult, TrendDir } from './types';

export interface ScoreInput {
  close: number;
  emas: { e20: number | null; e50: number | null; e100: number | null; e200: number | null };
  emaSeries20: (number | null)[];
  rsi: number | null;
  macdHist: (number | null)[];
  atrNow: number | null;
  atrSeries: (number | null)[];
  relVol: number | null;
  bbWidth: number | null;      // (upper-lower)/mid
  bbWidthSeries: number[];
  structure: StructureResult;
  directionHint?: TrendDir;    // where volume/trend agree, used for volume score
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/**
 * Layer scores, each 0..100 where 50 = neutral. Everything here is a pure
 * function of computed indicator values — no randomness, fully explainable.
 */
export function computeScores(input: ScoreInput): ScoreSet {
  const reasons: string[] = [];

  // Tolerance-based comparisons: exactly-equal values (flat tape) stay neutral
  // instead of resolving to "bearish". One epsilon = 5% of ATR.
  const epsBase = input.atrNow && input.atrNow > 0 ? input.atrNow : input.close * 1e-6;
  const side = (a: number, b: number, mult = 0.05): 1 | -1 | 0 => {
    const d = a - b;
    const eps = epsBase * mult;
    return d > eps ? 1 : d < -eps ? -1 : 0;
  };

  // ── trend (EMA stack + price position + slope) ──────────────────────────
  let trend = 50;
  const { e20, e50, e200 } = input.emas;
  let e20vs50: 1 | -1 | 0 = 0;
  let closeVsE200: 1 | -1 | 0 = 0;
  if (e20 != null && e50 != null) {
    e20vs50 = side(e20, e50);
    closeVsE200 = e200 != null ? side(input.close, e200) : 0;
    trend += 8 * side(input.close, e20);
    trend += 8 * side(input.close, e50);
    trend += 14 * e20vs50;
    if (e200 != null) {
      trend += 8 * closeVsE200;
      trend += 12 * side(e50, e200);
    }
    const s = slope(input.emaSeries20, 10);
    if (s != null && input.atrNow && input.atrNow > 0) {
      const normed = s / input.atrNow; // slope in ATRs per bar
      trend += clamp(normed * 50, -10, 10);
    }
  }
  trend = clamp(trend);
  if (e20 != null && e50 != null) {
    reasons.push(
      e20vs50 === 1
        ? 'EMA20 above EMA50 (bullish stack)'
        : e20vs50 === -1
          ? 'EMA20 below EMA50 (bearish stack)'
          : 'EMA20 ≈ EMA50 (flat stack)',
    );
    if (e200 != null && closeVsE200 !== 0) {
      reasons.push(closeVsE200 === 1 ? 'Price above EMA200' : 'Price below EMA200');
    }
  }

  // ── momentum (RSI + MACD hist + hist delta) ─────────────────────────────
  let momentum = 50;
  if (input.rsi != null) {
    momentum += clamp((input.rsi - 50) * 0.9, -22, 22);
    reasons.push(`RSI(14) at ${input.rsi.toFixed(0)}`);
  }
  const hist = input.macdHist;
  const h1 = hist[hist.length - 1];
  const h0 = hist[hist.length - 2];
  if (h1 != null) {
    momentum += h1 > 0 ? 12 : h1 < 0 ? -12 : 0;
    if (h0 != null) momentum += h1 > h0 ? 6 : h1 < h0 ? -6 : 0;
    reasons.push(h1 > 0 ? 'MACD histogram positive' : h1 < 0 ? 'MACD histogram negative' : 'MACD histogram flat');
  }
  momentum = clamp(momentum);

  // ── structure (trend + last events) ─────────────────────────────────────
  let structure = 50;
  const t = input.structure.trend;
  if (t === 'up') structure += 25;
  if (t === 'down') structure -= 25;
  const evts = input.structure.events;
  const last = evts[evts.length - 1];
  if (last) {
    if (last.type === 'BOS') structure += last.direction === 'up' ? 15 : -15;
    if (last.type === 'CHoCH') structure += last.direction === 'up' ? 10 : -10; // reversal, slightly weaker until confirmed
    reasons.push(
      `${last.type} ${last.direction} @ ${fmt(last.level)}`,
    );
  }
  structure = clamp(structure);
  if (t !== 'range') reasons.unshift(`Market structure trending ${t}`);

  // ── volume (relative volume aligned with direction) ─────────────────────
  let volume = 50;
  if (input.relVol != null) {
    const alignedBull = input.close >= (e20 ?? input.close);
    const strength = clamp((input.relVol - 1) * 40, -20, 20);
    volume = clamp(50 + (alignedBull ? strength : -strength));
    if (input.relVol > 1.5) reasons.push(`Elevated volume (${input.relVol.toFixed(1)}× avg)`);
  }

  // ── regime (ATR ratio + BB width percentile) ────────────────────────────
  let regime: Regime = 'trending';
  if (input.atrNow != null) {
    const atrVals = input.atrSeries.filter((v): v is number => v != null).slice(-60);
    const meanAtr = atrVals.length ? atrVals.reduce((a, b) => a + b, 0) / atrVals.length : input.atrNow;
    const atrRatio = meanAtr > 0 ? input.atrNow / meanAtr : 1;
    const widths = input.bbWidthSeries.slice(-120);
    const narrow = widths.length > 30 && input.bbWidth != null
      ? widths.filter((w) => w <= (input.bbWidth ?? Infinity)).length / widths.length < 0.2
      : false;
    if (atrRatio > 1.5) regime = 'volatile';
    else if (narrow && atrRatio < 0.9) regime = 'ranging';
  }

  // ── composite ───────────────────────────────────────────────────────────
  const composite = clamp(0.25 * trend + 0.25 * momentum + 0.25 * structure + 0.15 * volume + 0.10 * trend);
  const bias = composite >= 60 ? 'bullish' : composite <= 40 ? 'bearish' : 'neutral';
  let confidence = clamp(Math.abs(composite - 50) * 2);
  if (regime === 'ranging') confidence = clamp(confidence * 0.7);
  if (regime === 'volatile') confidence = clamp(confidence * 0.85);

  return {
    trend: Math.round(trend),
    momentum: Math.round(momentum),
    structure: Math.round(structure),
    volume: Math.round(volume),
    regime,
    composite: Math.round(composite * 10) / 10,
    bias: bias as ScoreSet['bias'],
    confidence: Math.round(confidence),
    reasons,
  };
}

function fmt(n: number): string {
  return n >= 1000 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(3);
}
