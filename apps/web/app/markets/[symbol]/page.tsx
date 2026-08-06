'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { CompositeAnalysis, Timeframe, TimeframeAnalysis, Zone } from '../../../vendor/engine/src';
import type { Instrument, TradeIdea } from '../../../vendor/shared/src';
import { fmt } from '../../../vendor/shared/src';
import type { ChartMarker, ChartPriceLine } from '../../../components/CandleChart';

const CandleChart = dynamic(() => import('../../../components/CandleChart'), {
  ssr: false,
  loading: () => <div className="skeleton">Loading chart…</div>,
});

interface MarketPayload {
  instrument: Instrument;
  asOf: number;
  source: 'yahoo' | 'synthetic';
  engineVersion: string;
  analysis: CompositeAnalysis;
  idea: TradeIdea | null;
  alert: { title: string; body: string } | null;
  chart: {
    timeframe: Timeframe;
    candles: { ts: number; open: number; high: number; low: number; close: number; volume?: number | null }[];
    ema20: (number | null)[];
    ema50: (number | null)[];
    ema200: (number | null)[];
  };
}

const TFS: Timeframe[] = ['5m', '15m', '1h', '4h', '1d', '1w'];
const TF_ORDER: Timeframe[] = ['5m', '15m', '1h', '4h', '1d', '1w'];

const ZONE_STYLE: Record<Zone['kind'], { label: string; color: string; badge: string }> = {
  demand: { label: 'Demand', color: '#22c55e', badge: 'bullish' },
  supply: { label: 'Supply', color: '#ef4444', badge: 'bearish' },
  fvg_bull: { label: 'FVG ↑', color: '#3b82f6', badge: 'info' },
  fvg_bear: { label: 'FVG ↓', color: '#8b5cf6', badge: 'info' },
};

const eat = (ts: number) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short',
  }).format(new Date(ts));

function biasOf(score: number) {
  return score >= 60 ? 'bullish' : score <= 40 ? 'bearish' : 'neutral';
}

export default function MarketPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = (params.symbol ?? '').toUpperCase();
  const [tf, setTf] = useState<Timeframe>('15m');
  const [data, setData] = useState<MarketPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (soft = false) => {
      if (!soft) setLoading(true);
      try {
        const res = await fetch(`/api/market/${encodeURIComponent(symbol)}?tf=${tf}`, { cache: 'no-store' });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? `API ${res.status}`);
        setData(j as MarketPayload);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed to load');
      } finally {
        setLoading(false);
      }
    },
    [symbol, tf],
  );

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const a = data?.analysis ?? null;
  const tfa: TimeframeAnalysis | null = data ? (a?.perTimeframe[tf] ?? null) : null;
  const inst = data?.instrument ?? null;
  const d = inst?.decimals ?? 2;

  const markers: ChartMarker[] = useMemo(() => {
    if (!tfa || !data) return [];
    const out: ChartMarker[] = [];
    for (const ev of [tfa.structure.lastBos, tfa.structure.lastChoch]) {
      if (!ev) continue;
      out.push({
        time: ev.ts,
        kind: ev.type === 'BOS' ? 'bos' : 'choch',
        direction: ev.direction,
        text: ev.type,
      });
    }
    for (const s of tfa.swings.slice(-8)) {
      out.push({ time: s.ts, kind: s.kind === 'high' ? 'swing_high' : 'swing_low', text: s.label ?? '' });
    }
    return out;
  }, [tfa, data]);

  const priceLines: ChartPriceLine[] = useMemo(() => {
    if (!tfa) return [];
    const lines: ChartPriceLine[] = [];
    for (const z of tfa.zones.slice(0, 4)) {
      const style = ZONE_STYLE[z.kind];
      lines.push({ price: z.high, color: style.color, title: style.label, dashed: true });
      lines.push({ price: z.low, color: style.color, title: '', dashed: true });
    }
    if (data?.idea) {
      lines.push({ price: data.idea.entry, color: '#3b82f6', title: 'Entry' });
      lines.push({ price: data.idea.stopLoss, color: '#ef4444', title: 'SL' });
      lines.push({ price: data.idea.tp1, color: '#22c55e', title: 'TP1', dashed: true });
      lines.push({ price: data.idea.tp2, color: '#22c55e', title: 'TP2', dashed: true });
    }
    return lines;
  }, [tfa, data]);

  if (error) {
    return (
      <div>
        <Link href="/" style={{ color: 'var(--muted)' }}>← Overview</Link>
        <div className="error-box">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="header-line">
        <Link href="/" style={{ color: 'var(--faint)' }}>←</Link>
        <h1>{symbol}</h1>
        <h2>{inst?.name ?? '…'}</h2>
        {a && (
          <>
            <span className={`badge ${a.bias}`}>{a.bias.toUpperCase()}</span>
            <span className="badge dim">score {a.composite}</span>
            <span className="badge dim">confidence {a.confidence}%</span>
            <span className={`badge ${data?.source === 'yahoo' ? 'info' : 'neutral'}`}>
              {data?.source === 'yahoo' ? 'live · yahoo' : 'simulated feed'}
            </span>
          </>
        )}
        <div className="spacer" />
        <div className="tf-switch">
          {TFS.map((t) => (
            <button key={t} className={t === tf ? 'active' : ''} onClick={() => setTf(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {(loading && !data) ? (
        <div className="skeleton">Running analysis…</div>
      ) : !data || !a ? null : (
        <>
          <div className="market-grid">
            <div className="panel chart-wrap">
              <CandleChart
                candles={data.chart.candles}
                ema20={data.chart.ema20}
                ema50={data.chart.ema50}
                ema200={data.chart.ema200}
                markers={markers}
                priceLines={priceLines}
                decimals={d}
              />
            </div>

            <div className="grid" style={{ gap: 14 }}>
              {/* bias card */}
              <div className="panel panel-pad">
                <h3>Signal — {tf.toUpperCase()}</h3>
                <div className="gauge">
                  <div className={`big num ${a.bias === 'bullish' ? 'up' : a.bias === 'bearish' ? 'down' : ''}`}>
                    {tfa ? tfa.scores.composite : '—'}
                  </div>
                  <div>
                    <span className={`badge ${tfa ? biasOf(tfa.scores.composite) : 'neutral'}`}>
                      {tfa ? biasOf(tfa.scores.composite).toUpperCase() : 'N/A'}
                    </span>
                    <div className="sub" style={{ marginTop: 6 }}>
                      confidence {tfa?.scores.confidence ?? 0}% · regime {tfa?.scores.regime ?? '—'}
                    </div>
                    <div className="sub">composite (all TFs) {a.composite} · engine v{data.engineVersion}</div>
                  </div>
                </div>
                <div className="scorebar bull" style={{ marginTop: 12 }}>
                  <span
                    className={tfa ? biasOf(tfa.scores.composite) : ''}
                    style={{
                      width: `${tfa?.scores.composite ?? 50}%`,
                      background:
                        tfa && biasOf(tfa.scores.composite) === 'bullish'
                          ? 'var(--green)'
                          : tfa && biasOf(tfa.scores.composite) === 'bearish'
                            ? 'var(--red)'
                            : 'var(--amber)',
                    }}
                  />
                </div>
              </div>

              {/* key stats */}
              <div className="panel panel-pad">
                <h3>Indicators</h3>
                <div className="kv num">
                  <span className="k">Price</span>
                  <span className="v">{fmt(a.price, d)}</span>
                  <span className="k">RSI(14)</span>
                  <span className="v">{tfa?.rsi14?.toFixed(1) ?? '—'}</span>
                  <span className="k">MACD hist</span>
                  <span className={`v ${tfa && (tfa.macdHist ?? 0) >= 0 ? 'up' : 'down'}`}>
                    {tfa?.macdHist?.toFixed(tfa && Math.abs(tfa.macdHist) < 1 ? 4 : 2) ?? '—'}
                  </span>
                  <span className="k">ATR(14)</span>
                  <span className="v">{tfa?.atr14?.toFixed(d) ?? '—'}</span>
                  <span className="k">EMA20/50</span>
                  <span className="v">
                    {tfa?.ema20 ? fmt(tfa.ema20, d) : '—'} / {tfa?.ema50 ? fmt(tfa.ema50, d) : '—'}
                  </span>
                  <span className="k">EMA200</span>
                  <span className="v">{tfa?.ema200 ? fmt(tfa.ema200, d) : '—'}</span>
                  <span className="k">Bollinger</span>
                  <span className="v">
                    {tfa?.bbLower ? fmt(tfa.bbLower, d) : '—'} … {tfa?.bbUpper ? fmt(tfa.bbUpper, d) : '—'}
                  </span>
                  <span className="k">Rel volume</span>
                  <span className="v">{tfa?.relVolume ? `${tfa.relVolume.toFixed(2)}×` : 'n/a'}</span>
                  <span className="k">Structure</span>
                  <span className={`v ${tfa?.structure.trend === 'up' ? 'up' : tfa?.structure.trend === 'down' ? 'down' : ''}`}>
                    {tfa?.structure.trend ?? '—'}
                  </span>
                </div>
              </div>

              {/* MTF alignment */}
              <div className="panel panel-pad">
                <h3>Multi-timeframe</h3>
                <div className="mtf-row">
                  {TF_ORDER.filter((t) => a.mtfAlignment[t]).map((t) => (
                    <span key={t} className="mtf-chip">
                      <span className="tf">{t}</span>
                      <span className={`badge ${a.mtfAlignment[t]}`}>{a.mtfAlignment[t]}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 14 }}>
            {/* why this score */}
            <div className="panel panel-pad">
              <h3>Why this score</h3>
              <ul className="reasons">
                {(tfa?.scores.reasons ?? a.reasons).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>

            {/* zones */}
            <div className="panel panel-pad">
              <h3>Zones & liquidity ({tf.toUpperCase()})</h3>
              {tfa?.zones.length ? (
                tfa.zones.map((z, i) => {
                  const s = ZONE_STYLE[z.kind];
                  return (
                    <div className="zone-row" key={i}>
                      <span className={`zone-tag badge ${s.badge}`}>{s.label}</span>
                      <span className="num">{fmt(z.low, d)} – {fmt(z.high, d)}</span>
                      <span className="num" style={{ color: 'var(--faint)' }}>str {z.strength}</span>
                    </div>
                  );
                })
              ) : (
                <div style={{ color: 'var(--faint)' }}>No active zones detected.</div>
              )}
              {!!tfa?.liquidity.length && (
                <>
                  <div className="section-title" style={{ marginTop: 14 }}>Liquidity pools</div>
                  {tfa.liquidity.map((p, i) => (
                    <div className="zone-row" key={i}>
                      <span className={`zone-tag badge ${p.kind === 'buyside' ? 'neutral' : 'dim'}`}>
                        {p.kind === 'buyside' ? 'Buy-side' : 'Sell-side'}
                      </span>
                      <span className="num">{fmt(p.price, d)}</span>
                      <span className="num" style={{ color: 'var(--faint)' }}>×{p.touches}</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* levels */}
            <div className="panel panel-pad">
              <h3>Support / Resistance ({tf.toUpperCase()})</h3>
              <div className="kv num">
                <span className="k">Resistance</span>
                <span className="v down">{tfa?.levels.resistance.map((v) => fmt(v, d)).join('  ·  ') || '—'}</span>
                <span className="k">Support</span>
                <span className="v up">{tfa?.levels.support.map((v) => fmt(v, d)).join('  ·  ') || '—'}</span>
              </div>
              {tfa?.fib && (
                <>
                  <div className="section-title" style={{ marginTop: 14 }}>
                    Fibonacci ({tfa.fib.direction === 'up' ? 'up-leg' : 'down-leg'})
                  </div>
                  <div className="kv num">
                    {Object.entries(tfa.fib.levels).map(([k, v]) => (
                      <FragmentRow key={k} k={k} v={fmt(v as number, d)} />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* trade idea + whatsapp preview */}
            <div className="panel panel-pad">
              <h3>AI trade idea (educational)</h3>
              {data.idea ? (
                <>
                  <div className="row" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className={`badge ${data.idea.direction === 'long' ? 'bullish' : 'bearish'}`}>
                      {data.idea.direction.toUpperCase()}
                    </span>
                    <span className="badge dim">conf {data.idea.confidence}%</span>
                    <span className="badge neutral">{data.idea.riskLabel} risk</span>
                  </div>
                  <div className="kv num" style={{ marginTop: 12 }}>
                    <span className="k">Entry</span><span className="v">{fmt(data.idea.entry, d)}</span>
                    <span className="k">Stop loss</span><span className="v down">{fmt(data.idea.stopLoss, d)}</span>
                    <span className="k">TP1 (1R)</span><span className="v up">{fmt(data.idea.tp1, d)}</span>
                    <span className="k">TP2 (2R)</span><span className="v up">{fmt(data.idea.tp2, d)}</span>
                    <span className="k">ATR basis</span><span className="v">{fmt(data.idea.atr, d)}</span>
                  </div>
                  <ul className="reasons" style={{ marginTop: 10 }}>
                    {data.idea.rationale.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </>
              ) : (
                <div style={{ color: 'var(--faint)' }}>
                  No idea qualifies right now — engine requires composite ≥ 70 (or ≤ 30), 1H & 4H
                  agreement on direction, and a non-volatile regime.
                </div>
              )}
              {data.alert && (
                <>
                  <div className="section-title" style={{ marginTop: 14 }}>WhatsApp alert preview</div>
                  <div className="wa-bubble">{data.alert.body}</div>
                </>
              )}
            </div>
          </div>

          <p className="footer-note">
            Feed: {data.source} · analyzed {eat(data.asOf)} EAT · engine v{data.engineVersion} ·{' '}
            {tf.toUpperCase()} · auto-refresh 60s. Educational analysis only — not financial advice.
            Index data may be delayed by the provider.
          </p>
        </>
      )}
    </div>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </>
  );
}
