# MIP — AI Market Intelligence Platform

Deterministic TA + Smart-Money-Concepts engine with a live web dashboard, built to the
[architecture spec](./ARCHITECTURE.md). This repo currently implements **milestones M0–M5**
of the build roadmap as a fully working dev-mode system (no auth/DB — those land with the
Supabase project in M1-production, migrations already included).

## What works today

| Milestone | Delivered |
|---|---|
| M0 Repo & envs | npm workspaces monorepo, vitest CI-ready, typecheck |
| M2 Instruments & ingestion | 16 instruments seeded, Yahoo Finance live 5m/1h/1d fetch with caching, freshness + simulated-feed fallback badges |
| M3 Engine v1 | EMA/SMA/RSI/MACD/Bollinger/ATR/VWAP/relVWAP, TF aggregation 5m→1w — 29/29 tests green |
| M4 Engine v2 (SMC) | Fractal swings (HH/HL/LH/LL), BOS/CHoCH (no repaint), FVG lifecycle, supply/demand zones, S/R clustering, liquidity pools, Fibonacci grids, MTF composite scoring with explainable reasons |
| M5 Dashboard v1 | Overview heat tiles (bias + score + conf + regime), market page with candle chart, EMA overlays, BOS/CHoCH markers, zone/entry/SL/TP price lines, "why this score" panel, MTF alignment, zones/SR/fib tables, **AI trade idea card + WhatsApp alert preview** |

Not yet: auth/RBAC (M1), alert rules & WhatsApp dispatch (M6), AI narratives/news (M7),
journal (M8), admin panel (M9). Database + cron + RLS for those are already written in
`supabase/migrations/` (0001–0003) and deploy in one `supabase db push`.

## Repo layout

```
apps/web/            Next.js 15 dashboard (dev-mode: live Yahoo data, no auth)
packages/engine/     @mip/engine — deterministic TA + SMC engine (pure TS, unit-tested)
packages/shared/     @mip/shared — instruments, synthetic fallback feed, idea builder, alert composer
supabase/migrations/ Production DDL (tables, RLS, plan limits, cron pipelines)
docs/DEPLOYMENT.md   Production runbook: Supabase → Vercel → Twilio → OpenAI
ARCHITECTURE.md      The full system spec (v1.0)
.github/workflows/   CI: engine tests → typecheck → prod build → SQL lint
```

## Run it

```bash
npm install        # workspaces: engine, shared, web
npm test           # engine golden-fixture suite (29 tests)
npm run typecheck  # strict TS, engine + shared
npm run dev        # Next.js on :3000
```

Dev-mode notes:
- Data comes from Yahoo Finance (unofficial; indices may be delayed ~15 min) with an
  automatic deterministic synthetic fallback if the feed fails — UI marks it `simulated feed`.
- Crypto stays live here via Yahoo `BTC-USD`/`ETH-USD`; production uses Binance (spec §5.2).
- All timestamps analyzed in UTC, rendered Africa/Nairobi; refresh 60s.

## Engine API (packages/engine)

```ts
import { analyzeTimeframe, analyzeMTF, aggregate } from '@mip/engine';

const tf = analyzeTimeframe(candles, '4h');
// → emas, rsi14, macd, bollinger, atr14, relVolume, swings (HH/HL/…),
//   structure { trend, lastBos, lastChoch }, zones (supply/demand/FVG),
//   sr levels, liquidity pools, fib grid, explainable scores

const mtf = analyzeMTF({ candles5m, candlesHourly, candlesDaily });
// → composite 0-100, bias, confidence, per-timeframe analyses, mtfAlignment
```

Scoring is deterministic and every point is traceable (`scores.reasons`), per the
spec's core principle: **the LLM narrates, never calculates.**

## Next up (M6)

Alert rules + evaluation + Twilio WhatsApp sandbox dispatch — the `alerts`,
`notification_deliveries` DDL and `composeAlert` message format are already in place.
