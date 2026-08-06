import {
  aggregate,
  analyzeMTF,
  analyzeTimeframe,
  ema,
  ENGINE_VERSION,
  type Candle,
  type Timeframe,
} from '../vendor/engine/src';
import { buildIdea, ideaAlert, type Instrument } from '../vendor/shared/src';
import { getCandles, type Source } from './candles';

export interface OverviewCard {
  symbol: string;
  name: string;
  assetClass: string;
  decimals: number;
  price: number;
  changePct24h: number | null;
  bias: 'bullish' | 'bearish' | 'neutral';
  composite: number;
  confidence: number;
  regime: string;
  trend4h: string | null;
  updatedAt: number;
  source: Source;
  error?: string;
}

/** Light overview signal: 1H analysis + 24h change. Uses the shared candle cache. */
export async function buildOverviewCard(inst: Instrument): Promise<OverviewCard> {
  try {
    const [h1, d1] = await Promise.all([getCandles(inst, '1h'), getCandles(inst, '1d')]);
    const a = analyzeTimeframe(h1.candles, '1h');

    const closes1d = d1.candles.map((c) => c.close);
    const prev = closes1d[closes1d.length - 2];
    const lastD = closes1d[closes1d.length - 1];
    const changePct24h = prev && lastD ? ((lastD - prev) / prev) * 100 : null;

    return {
      symbol: inst.symbol,
      name: inst.name,
      assetClass: inst.assetClass,
      decimals: inst.decimals,
      price: a.close,
      changePct24h,
      bias: a.scores.bias,
      composite: a.scores.composite,
      confidence: a.scores.confidence,
      regime: a.scores.regime,
      trend4h: null,
      updatedAt: h1.fetchedAt,
      source: h1.source,
    };
  } catch (e) {
    return {
      symbol: inst.symbol,
      name: inst.name,
      assetClass: inst.assetClass,
      decimals: inst.decimals,
      price: 0,
      changePct24h: null,
      bias: 'neutral',
      composite: 50,
      confidence: 0,
      regime: 'ranging',
      trend4h: null,
      updatedAt: Date.now(),
      source: 'synthetic',
      error: e instanceof Error ? e.message : 'unknown',
    };
  }
}

/** Full market-page payload. */
export async function buildMarketAnalysis(inst: Instrument, chartTf: Timeframe) {
  const [m5, h1, d1] = await Promise.all([
    getCandles(inst, '5m'),
    getCandles(inst, '1h'),
    getCandles(inst, '1d'),
  ]);

  const mtf = analyzeMTF({
    candles5m: m5.candles,
    candlesHourly: h1.candles,
    candlesDaily: d1.candles,
  });
  const idea = buildIdea(mtf, inst);
  const alert = idea
    ? ideaAlert(idea, inst, mtf.bias.charAt(0).toUpperCase() + mtf.bias.slice(1))
    : null;

  const chartCandles: Candle[] =
    chartTf === '5m'
      ? m5.candles
      : chartTf === '15m'
        ? aggregate(m5.candles, '15m')
        : chartTf === '1h'
          ? h1.candles
          : chartTf === '4h'
            ? aggregate(h1.candles, '4h')
            : chartTf === '1d'
              ? d1.candles
              : aggregate(d1.candles, '1w');
  const trimmed = chartCandles.slice(-240);

  const closes = trimmed.map((c) => c.close);
  const strip = (arr: (number | null)[]) => arr.slice(-trimmed.length).map((v) => (v == null ? null : v));

  return {
    instrument: inst,
    asOf: Date.now(),
    fetchedAt: Math.min(m5.fetchedAt, h1.fetchedAt, d1.fetchedAt),
    source: m5.source === 'yahoo' && h1.source === 'yahoo' && d1.source === 'yahoo' ? 'yahoo' : 'synthetic',
    engineVersion: ENGINE_VERSION,
    analysis: mtf,
    idea,
    alert,
    chart: {
      timeframe: chartTf,
      candles: trimmed,
      ema20: strip(ema(closes, 20)),
      ema50: strip(ema(closes, 50)),
      ema200: strip(ema(closes, 200)),
    },
  };
}
