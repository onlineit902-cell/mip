import type { Instrument } from './instruments';
import type { TradeIdea } from './idea';

export const fmt = (v: number, decimals: number): string =>
  v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const DISCLAIMER = '⚠️ Educational analysis, not financial advice.';

/**
 * Single source of truth for alert message bodies — the same text is what
 * would be sent to WhatsApp / Telegram / email. Kept ≤ ~900 chars.
 */
export function ideaAlert(idea: TradeIdea, instrument: Instrument, trend: string): { title: string; body: string } {
  const d = instrument.decimals;
  const dir = idea.direction === 'long' ? 'LONG 🟢' : 'SHORT 🔴';
  const title = `${instrument.symbol} ${idea.direction.toUpperCase()} idea (${idea.confidence}%)`;
  const body = [
    `📊 ${instrument.symbol} — ${dir} (Educational)`,
    `Trend: ${trend} · Confidence: ${idea.confidence}%`,
    `Entry: ${fmt(idea.entry, d)} · SL: ${fmt(idea.stopLoss, d)}`,
    `TP1: ${fmt(idea.tp1, d)} · TP2: ${fmt(idea.tp2, d)}`,
    `Risk: ${idea.riskLabel}`,
    `Why: ${idea.rationale.slice(0, 5).join(' · ')}`,
    `Invalidation: ${idea.invalidation}`,
    DISCLAIMER,
  ].join('\n');
  return { title, body };
}

export function indicatorAlert(opts: {
  instrument: Instrument;
  rule: string;
  value: string;
  price: number;
  timeframe: string;
}): { title: string; body: string } {
  const d = opts.instrument.decimals;
  const title = `${opts.instrument.symbol}: ${opts.rule}`;
  const body = [
    `🔔 ${opts.instrument.symbol} (${opts.timeframe})`,
    `Rule: ${opts.rule}`,
    `Now: ${opts.value} · Price: ${fmt(opts.price, d)}`,
    DISCLAIMER,
  ].join('\n');
  return { title, body };
}

export function briefingAlert(kind: 'daily' | 'london' | 'newyork' | 'eod', lines: string[]): { title: string; body: string } {
  const names = { daily: 'Daily Market Outlook', london: 'London Open', newyork: 'New York Open', eod: 'End-of-Day Summary' };
  const title = names[kind];
  const body = [`🗞️ ${names[kind]}`, ...lines, DISCLAIMER].join('\n');
  return { title, body };
}
