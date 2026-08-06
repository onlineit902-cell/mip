/** Core public types for the analysis engine. All timestamps are ms since epoch (UTC). */

export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export const TF_MINUTES: Record<Timeframe, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

export type Bias = 'bullish' | 'bearish' | 'neutral';
export type TrendDir = 'up' | 'down' | 'range';

export interface Swing {
  index: number;        // candle index of the pivot
  ts: number;
  price: number;
  kind: 'high' | 'low';
  label?: 'HH' | 'HL' | 'LH' | 'LL';
  /** a swing is only trustworthy once `k` bars have passed after it */
  confirmedAtIndex: number;
}

export interface StructureEvent {
  type: 'BOS' | 'CHoCH';
  direction: 'up' | 'down';
  index: number;         // candle that closed through the level
  ts: number;
  level: number;         // swing price that was broken
}

export interface Zone {
  low: number;
  high: number;
  kind: 'demand' | 'supply' | 'fvg_bull' | 'fvg_bear';
  ts: number;
  strength: number;      // 0..100
  filled: boolean;
}

export interface LiquidityPool {
  price: number;
  kind: 'buyside' | 'sellside'; // buyside liquidity rests above equal highs
  touches: number;
  ts: number;
}

export interface Levels {
  support: number[];
  resistance: number[];
}

export interface FibGrid {
  swingHigh: number;
  swingLow: number;
  direction: 'up' | 'down'; // direction of the measured leg
  levels: Record<'0.236' | '0.382' | '0.5' | '0.618' | '0.786' | '1.272' | '1.618', number>;
}

export type Regime = 'trending' | 'ranging' | 'volatile';

export interface ScoreSet {
  trend: number;      // 0..100
  momentum: number;   // 0..100
  structure: number;  // 0..100
  volume: number;     // 0..100
  regime: Regime;
  composite: number;  // 0..100 weighted
  bias: Bias;
  confidence: number; // 0..100
  reasons: string[];  // human-readable "why"
}

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
}

export interface BollingerResult {
  upper: (number | null)[];
  mid: (number | null)[];
  lower: (number | null)[];
}

export interface StructureResult {
  swings: Swing[];
  trend: TrendDir;
  events: StructureEvent[];
}

export interface TimeframeAnalysis {
  timeframe: Timeframe;
  ts: number;               // analysis timestamp
  close: number;
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  bbUpper: number | null;
  bbMid: number | null;
  bbLower: number | null;
  atr14: number | null;
  relVolume: number | null;
  swings: Swing[];
  structure: { trend: TrendDir; lastBos: StructureEvent | null; lastChoch: StructureEvent | null };
  zones: Zone[];
  liquidity: LiquidityPool[];
  levels: Levels;
  fib: FibGrid | null;
  scores: ScoreSet;
  bars: number;             // how many candles were available
  sufficient: boolean;      // enough bars for ema200 etc.
}

export interface CompositeAnalysis {
  ts: number;
  price: number;
  bias: Bias;
  confidence: number;
  composite: number;
  mtfAlignment: Partial<Record<Timeframe, Bias>>;
  perTimeframe: Partial<Record<Timeframe, TimeframeAnalysis>>;
  reasons: string[];
}
