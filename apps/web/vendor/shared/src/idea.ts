import type { CompositeAnalysis } from '../../engine/src';
import type { Instrument } from './instruments';

export interface TradeIdea {
  instrument: string;
  direction: 'long' | 'short';
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  riskLabel: 'low' | 'medium' | 'high';
  confidence: number;
  rationale: string[];
  invalidation: string;
  createdAt: number;
  atr: number;
}

const round = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

/**
 * Educational idea construction. Gates (per spec):
 *  - composite >= 70 (long) or <= 30 (short)
 *  - 4H and 1H timeframes present and agreeing with the bias
 *  - regime not 'volatile'
 * Geometry: SL = 1.5×ATR(4H), TP1 = 1R, TP2 = 2R. Rejects RR < 1.5 on TP1.
 */
export function buildIdea(mtf: CompositeAnalysis, instrument: Instrument): TradeIdea | null {
  const h4 = mtf.perTimeframe['4h'];
  const h1 = mtf.perTimeframe['1h'];
  if (!h4 || !h1) return null;
  if (!mtf.bias || mtf.bias === 'neutral') return null;
  if (mtf.confidence < 40) return null;

  const long = mtf.bias === 'bullish';
  const compositeGate = long ? mtf.composite >= 70 : mtf.composite <= 30;
  if (!compositeGate) return null;
  if (h4.scores.bias !== mtf.bias || h1.scores.bias !== mtf.bias) return null;

  const atr = h4.atr14 ?? h1.atr14;
  if (atr == null || atr <= 0) return null;

  const d = instrument.decimals;
  const entry = round(mtf.price, d);
  const sl = round(long ? entry - 1.5 * atr : entry + 1.5 * atr, d);
  const risk = Math.abs(entry - sl);
  const tp1 = round(long ? entry + risk : entry - risk, d);
  const tp2 = round(long ? entry + 2 * risk : entry - 2 * risk, d);

  const rationale: string[] = [];
  rationale.push(long ? 'EMA20 above EMA50 on 4H' : 'EMA20 below EMA50 on 4H');
  if (h4.rsi14 != null) rationale.push(`4H RSI at ${h4.rsi14.toFixed(0)}`);
  if (h4.structure.lastBos) {
    rationale.push(`4H break of structure ${h4.structure.lastBos.direction} @ ${round(h4.structure.lastBos.level, d)}`);
  } else if (h4.structure.trend !== 'range') {
    rationale.push(`4H market structure trending ${h4.structure.trend}`);
  }
  if (h1.scores.regime === 'trending') rationale.push('1H regime: trending');
  if (h1.macdHist != null) {
    rationale.push(long && h1.macdHist > 0 ? '1H MACD histogram positive' : !long && h1.macdHist < 0 ? '1H MACD histogram negative' : `1H MACD histogram ${h1.macdHist > 0 ? '+' : '−'}`);
  }

  const riskLabel: TradeIdea['riskLabel'] = h4.scores.regime === 'volatile' ? 'high' : 'medium';

  return {
    instrument: instrument.symbol,
    direction: long ? 'long' : 'short',
    entry,
    stopLoss: sl,
    tp1,
    tp2,
    riskLabel,
    confidence: mtf.confidence,
    rationale,
    invalidation: long ? `4H close below ${sl}` : `4H close above ${sl}`,
    createdAt: mtf.ts,
    atr: round(atr, d),
  };
}
