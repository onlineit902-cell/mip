import type { Candle } from '@mip/engine';
import { syntheticCandles, type Instrument } from '@mip/shared';

/**
 * Dev-mode candle provider (spec §5.1 in miniature):
 *  - primary: Yahoo Finance v8 chart API (no key, server-side fetch)
 *  - fallback: deterministic synthetic feed so the UI is always demonstrable
 * Responses are cached in-process for `ttlMs`.
 */

export type Source = 'yahoo' | 'synthetic';

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MIP-Dev/0.1',
  Accept: 'application/json',
};

interface CacheEntry {
  candles: Candle[];
  source: Source;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

async function yahooFetch(symbol: string, interval: string, range: string): Promise<Candle[]> {
  const url =
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: UA, cache: 'no-store', signal: AbortSignal.timeout(9_000) });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const j = (await res.json()) as any;
  const r = j?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.push({ ts: ts[i]! * 1000, open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? null });
  }
  return out;
}

export interface CandleResult {
  candles: Candle[];
  source: Source;
  fetchedAt: number;
}

export type CandleKind = '5m' | '1h' | '1d';

const KIND_CONF: Record<CandleKind, { interval: string; range: string; ttlMs: number; synth: { intervalMs: number; bars: number } }> = {
  '5m': { interval: '5m', range: '5d', ttlMs: 120_000, synth: { intervalMs: 300_000, bars: 1200 } },
  '1h': { interval: '1h', range: '3mo', ttlMs: 300_000, synth: { intervalMs: 3_600_000, bars: 1500 } },
  '1d': { interval: '1d', range: '1y', ttlMs: 900_000, synth: { intervalMs: 86_400_000, bars: 260 } },
};

export async function getCandles(inst: Instrument, kind: CandleKind): Promise<CandleResult> {
  const conf = KIND_CONF[kind];
  const key = `${inst.symbol}:${kind}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < conf.ttlMs) {
    return { candles: hit.candles, source: hit.source, fetchedAt: hit.fetchedAt };
  }

  try {
    if (!inst.yahoo) throw new Error('no yahoo symbol configured');
    const candles = await yahooFetch(inst.yahoo, conf.interval, conf.range);
    if (candles.length < 30) throw new Error(`thin series (${candles.length} bars)`);
    const entry: CacheEntry = { candles, source: 'yahoo', fetchedAt: Date.now() };
    cache.set(key, entry);
    return { candles, source: 'yahoo', fetchedAt: entry.fetchedAt };
  } catch {
    const synth = syntheticCandles(inst, conf.synth.intervalMs, conf.synth.bars);
    cache.set(key, { candles: synth, source: 'synthetic', fetchedAt: Date.now() });
    return { candles: synth, source: 'synthetic', fetchedAt: Date.now() };
  }
}

/** Simple concurrency pool for the overview fan-out. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length) as R[];
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}
