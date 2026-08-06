# AI Market Intelligence Platform — Architecture Specification

**Version:** 1.0 · **Date:** 2026-08-06 · **Status:** Approved for build
**Decisions locked:** Free data APIs (Yahoo Finance + Binance) · Twilio WhatsApp Sandbox → Production · Vercel + Supabase hosting

---

## 0. Executive Summary

A multi-tenant, AI-assisted market intelligence platform covering indices, commodities, forex, crypto, stocks, and ETFs. A deterministic analysis engine computes the full technical/SMC indicator set every 1–5 minutes; an LLM layer narrates and classifies on top of those computed facts; a rule engine fires alerts; notifications deliver over WhatsApp (Twilio), email, push, and Telegram.

**Core architectural principle — "LLM narrates, never calculates."**
All numbers (EMA, RSI, levels, entries, stops, confidence) are computed deterministically in the pipeline. The LLM receives those computed facts and is constrained to structured output over them. This eliminates hallucinated price levels, makes alerts auditable and reproducible, and keeps AI cost predictable.

---

## 1. Scope

### 1.1 In scope (this architecture)
- Phases 1–7 from the product plan: auth/RBAC, dashboard, watchlists, alert rules, journal, live data, TA + SMC analysis, news intelligence, educational trade ideas, WhatsApp/email/push notifications, admin panel, audit logs.
- Instruments: US500, NAS100, US30, GER40, Gold, Silver, WTI Oil, EUR/USD, GBP/USD, USD/JPY, AUD/USD, NZD/USD, USD/CAD, USD/CHF, BTC, ETH + any stock/ETF ticker the user adds (Yahoo Finance covers ~all liquid tickers).
- Timeframes: M5, M15, H1, H4, D1, W1.

### 1.2 Out of scope (deferred)
- Broker/trade execution, backtesting engine, payment processing (Stripe/M-Pesa), native mobile apps (PWA first), copy-trading.

### 1.3 Known data limitations (explicit, documented to users)
- Yahoo Finance intraday index data can be **delayed up to ~15 minutes**; crypto via Binance is real-time. UI must display data freshness per instrument.
- Yahoo's API is unofficial (see §15 Risks). The ingestion layer is built behind a `DataProvider` interface so it can be swapped for Twelve Data/Polygon/broker feeds without touching anything downstream.

---

## 2. High-Level Architecture

```
                         ┌───────────────────────────── EXTERNAL ─────────────────────────────┐
                         │ Yahoo Finance (indices/fx/commodities/stocks)   Binance (crypto)   │
                         │ RSS: Fed/ECB/BoE/BoJ/general news   FF calendar XML   Twilio/Meta   │
                         │ OpenAI / Anthropic APIs                                                │
                         └───────▲───────────────────▲───────────────────▲──────────▲──────────┘
                                 │ pull (cron)       │ pull (cron)       │ REST     │ status webhooks
┌────────────────────────────────┴──────────────────────────────────────────────────────────────┐
│ SUPABASE PROJECT                                                                              │
│                                                                                               │
│  pg_cron ────► Edge Functions (Deno)              ┌────────────── PostgreSQL ──────────────┐  │
│  schedules ──► ┌─────────────────────────┐        │ instruments, price_candles (Timescale) │  │
│                │ ingest-quotes           │───────►│ indicator_snapshots  analysis_snapshots│  │
│                │ ingest-crypto           │──┐     │ trade_ideas  alert_rules  alerts       │  │
│                │ ingest-news/calendar    │  │     │ news_items  economic_events            │  │
│                │ compute-indicators      │  │     │ journal_entries  profiles  plans       │  │
│                │ analyze-ai (LLM)        │  │     │ subscriptions  audit_logs  api_creds   │  │
│                │ generate-ideas          │  │     └──────────────▲─────────────────────────┘  │
│                │ evaluate-alerts         │  │                    │ RLS enforced, JWT          │
│                │ dispatch-notifications  │──┼────► Twilio/WhatsApp, Resend, Web-Push          │
│                │ briefings (london/ny/   │  │                                                   │
│                │   eod/daily)            │  │     Realtime (broadcast + postgres_changes)      │
│                │ twilio-webhook (status) │  │                    ▲ websocket                    │
│                └─────────────────────────┘  │                    │                             │
│                 Auth (email+OAuth+TOTP MFA) │ Vault (user API keys)  Storage (chart shots)     │
└────────────────────────────────▲─────────────────────────────────────────────────────────────┘
                                 │ HTTPS + WSS (anon JWT, RLS-scoped)
                 ┌───────────────┴────────────────┐
                 │ VERCEL — Next.js 15 frontend    │
                 │ App Router, Tailwind, shadcn/ui │
                 │ lightweight-charts, TanStack    │
                 │ PWA (installable, push-ready)   │
                 └─────────────────────────────────┘
```

### Component responsibilities

| Component | Responsibility | Tech |
|---|---|---|
| Web app | All UX: dashboard, charts, rules builder, journal, admin | Next.js 15 (App Router), React 19, Tailwind 4, shadcn/ui, lightweight-charts v5, TanStack Query |
| Auth & identity | Sign-up/in, OAuth, TOTP MFA, sessions, JWT claims | Supabase Auth |
| Database | System of record for everything | PostgreSQL 17 + TimescaleDB extension |
| Edge Functions | All pipelines, webhooks, privileged ops | Deno (Supabase Edge Functions) |
| Scheduler | Cron for all pipelines | `pg_cron` calling functions via `pg_net` |
| Realtime | Live candles + alerts to clients | Supabase Realtime (broadcast) |
| Notifications | WhatsApp, email, web push, Telegram | Twilio, Resend (or SES), VAPID push, Telegram Bot API |
| AI layer | News classification, market narrative, idea rationale, briefings | OpenAI (primary), Anthropic (optional fallback) |
| Secrets | Provider creds (env), user API keys (Vault) | Edge env vars, Supabase Vault (pgsodium) |
| Storage | Journal screenshots, generated chart images | Supabase Storage (private buckets) |

---

## 3. Technology Decisions & Rationale

| Decision | Choice | Why |
|---|---|---|
| Frontend framework | **Next.js on Vercel** (not plain Vite/SPA) | SSR for auth-gated routes, API routes for webhooks if needed, best Vercel fit, image optimization, PWA support |
| Charting | **lightweight-charts** (TradingView OSS) | Free, ~45 KB, renders our own candles + zone/FVG overlays; TradingView *widget* banned (their data, no overlays of our SMC objects) |
| Data provider | **Yahoo Finance `v8 chart` API + Binance REST klines** | Zero key, zero cost, covers all 18 instruments; behind an interface for swap-out |
| Indicator math | **Deno edge fn with a small TS TA library we own** (~600 LOC, ported formulas; no dependency risk) | Deterministic, testable, versioned (`engine_version` column) |
| SMC structures | **Custom TS module** (swings, BOS/CHoCH, FVG, zones) | No reliable OSS for Deno; spec is well-defined; unit-tested against labeled fixtures |
| LLM | **OpenAI gpt-5.4-mini (classify) / gpt-5.4 (narrative)** with `response_format: json_schema` | Cost tiers below; structured outputs enforce the "never calculates" rule |
| WhatsApp | **Twilio sandbox now → Meta-approved templates later** | Immediate testing with $15 trial credit; migration path documented in §8.4 |
| Email | **Resend** | Simple, good DX; abstracted behind `Notifier` interface anyway |
| n8n | **Not used** | Supabase Edge Functions + pg_cron cover all automation with one fewer system to host/secure |

---

## 4. Data Model (PostgreSQL)

All tables live in `public` with RLS enabled. Timestamps are `timestamptz` (UTC everywhere; UI renders in `profiles.timezone`).

### 4.1 DDL

```sql
-- ─────────────────────────── identity / plans / rbac ───────────────────────────
create type app_role as enum ('admin', 'analyst', 'member');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  timezone text not null default 'Africa/Nairobi',
  default_currency text not null default 'USD',
  theme text not null default 'system' check (theme in ('system','light','dark')),
  phone_e164 text unique,                -- +2547…, used for WhatsApp
  whatsapp_opted_in boolean not null default false,
  telegram_chat_id text,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_roles (                 -- separate table per Supabase RBAC pattern
  user_id uuid references auth.users(id) on delete cascade,
  role app_role not null default 'member',
  primary key (user_id, role)
);

create or replace function has_role(r app_role) returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.user_roles
                  where user_id = auth.uid() and role = r) $$;

create table plans (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,              -- free | pro | elite
  name text not null,
  max_watchlist_items int not null,
  max_alert_rules int not null,
  max_journal_month int not null,
  min_alert_interval_min int not null,    -- 5 free / 1 pro
  whatsapp_enabled boolean not null default false,
  ai_briefs_per_day int not null default 1,
  price_monthly_usd numeric(8,2) not null default 0
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  plan_id uuid not null references plans(id),
  status text not null default 'active'
    check (status in ('trialing','active','past_due','canceled')),
  provider text not null default 'manual' check (provider in ('manual','stripe','mpesa')),
  provider_ref text,
  current_period_start timestamptz, current_period_end timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id)                        -- one active sub per user (MVP)
);

-- ─────────────────────────── market data ───────────────────────────
create type asset_class as enum ('index','commodity','forex','crypto','stock','etf');

create table instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text unique not null,            -- canonical: US500, XAUUSD, BTC…
  name text not null,
  asset_class asset_class not null,
  provider_symbol text,                   -- ^GSPC, GC=F, EURUSD=X, BTCUSDT…
  provider text not null default 'yahoo' check (provider in ('yahoo','binance')),
  base_ccy text, quote_ccy text,
  price_decimals int not null default 2,
  session_open time, session_close time,  -- for session-brief logic
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

-- Seed mapping (provider_symbol):  US500→^GSPC  NAS100→^NDX  US30→^DJI  GER40→^GDAXI
-- XAUUSD→GC=F  XAGUSD→SI=F  WTI→CL=F  EURUSD→EURUSD=X  GBPUSD→GBPUSD=X  USDJPY→USDJPY=X
-- AUDUSD→AUDUSD=X  NZDUSD→NZDUSD=X  USDCAD→USDCAD=X  USDCHF→USDCHF=X
-- BTC→BTCUSDT (binance)  ETH→ETHUSDT (binance)

create table price_candles (              -- TimescaleDB hypertable
  instrument_id uuid not null references instruments(id),
  timeframe text not null check (timeframe in ('1m','5m','15m','1h','4h','1d','1w')),
  ts timestamptz not null,
  open numeric(20,8) not null, high numeric(20,8) not null,
  low numeric(20,8) not null,  close numeric(20,8) not null,
  volume numeric(24,4),
  source text not null default 'yahoo',
  primary key (instrument_id, timeframe, ts)
);
select create_hypertable('price_candles', 'ts', if_not_exists => true);

-- ─────────────────────────── analysis engine outputs ───────────────────────────
create table indicator_snapshots (        -- deterministic, one row per instrument×tf×cycle
  instrument_id uuid not null references instruments(id),
  timeframe text not null,
  ts timestamptz not null,                -- analysis cycle time
  close numeric(20,8) not null,
  ema20 numeric(20,8), ema50 numeric(20,8), ema100 numeric(20,8), ema200 numeric(20,8),
  sma20 numeric(20,8), sma50 numeric(20,8),
  rsi14 numeric(8,3),
  macd numeric(20,8), macd_signal numeric(20,8), macd_hist numeric(20,8),
  bb_upper numeric(20,8), bb_mid numeric(20,8), bb_lower numeric(20,8),
  atr14 numeric(20,8),
  vwap numeric(20,8), rel_volume numeric(10,3),
  swings jsonb,     -- [{ts, price, type:'HH'|'HL'|'LH'|'LL', confirmed}]
  structure jsonb,  -- {trend:'up'|'down'|'range', last_bos:{…}, last_choch:{…}}
  zones jsonb,      -- {demand:[{low,high,ts,strength}], supply:[…], fvgs:[{low,high,dir,ts,filled}], liquidity:[{price,type}]}
  sr_levels jsonb,  -- {support:[…prices], resistance:[…]}
  fib jsonb,        -- {swing_high, swing_low, levels:{'0.236':…, '0.382':…, '0.5':…, '0.618':…, '0.786':…}}
  scores jsonb,     -- {trend:0-100, momentum:0-100, structure:0-100, volume:0-100, regime:'trending'|'ranging'|'volatile'}
  engine_version text not null,
  primary key (instrument_id, timeframe, ts)
);
select create_hypertable('indicator_snapshots', 'ts', if_not_exists => true);

create table analysis_snapshots (         -- LLM layer, composite per instrument
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(id),
  generated_at timestamptz not null default now(),
  bias text not null check (bias in ('bullish','bearish','neutral')),
  confidence int not null check (confidence between 0 and 100),
  composite_score numeric(6,2) not null,  -- computed, NOT from LLM
  key_levels jsonb,                       -- merged S/R/zones across TFs
  mtf_alignment jsonb,                    -- {'5m':'bullish','1h':'bullish','4h':'neutral',…}
  narrative text not null,                -- LLM-written, over computed facts
  news_overlay jsonb,                     -- [{news_id, effect:'tailwind'|'headwind'|'neutral', weight}]
  ai_model text, tokens_in int, tokens_out int, cost_usd numeric(10,6),
  engine_version text not null
);

create table trade_ideas (                -- educational only, disclaimer-bound
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(id),
  analysis_id uuid references analysis_snapshots(id),
  direction text not null check (direction in ('long','short')),
  entry numeric(20,8) not null,
  stop_loss numeric(20,8) not null,
  tp1 numeric(20,8) not null, tp2 numeric(20,8), tp3 numeric(20,8),
  atr_at_entry numeric(20,8) not null,
  risk_label text not null check (risk_label in ('low','medium','high')),
  confidence int not null,
  rationale jsonb not null,               -- [{factor, value}] e.g. [{ema_cross:'20>50'},{rsi:58}]
  ai_commentary text,
  status text not null default 'open'
    check (status in ('open','tp1_hit','tp2_hit','tp3_hit','sl_hit','expired','invalidated')),
  result_r numeric(6,2),                  -- realized R-multiple once resolved
  resolved_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────── user features ───────────────────────────
create table watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null default 'Main',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table watchlist_items (
  watchlist_id uuid not null references watchlists(id) on delete cascade,
  instrument_id uuid not null references instruments(id),
  sort_order int not null default 0,
  primary key (watchlist_id, instrument_id)
);

create type alert_type as enum
  ('price_level','rsi','ema_cross','macd_cross','bollinger','structure',
   'trade_idea','news_impact','session_open','daily_brief','eod_summary');

create table alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  instrument_id uuid references instruments(id),   -- null = whole watchlist
  timeframe text not null default '15m',
  type alert_type not null,
  conditions jsonb not null,              -- e.g. {"rsi":{"op":"<","value":30}}
  channels jsonb not null default '{"inapp":true}'::jsonb,  -- inapp|whatsapp|telegram|email|push
  cooldown_minutes int not null default 60,
  quiet_hours jsonb,                      -- {"start":"22:00","end":"06:00","tz":"Africa/Nairobi"}
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references alert_rules(id) on delete set null,
  user_id uuid not null references profiles(id) on delete cascade,
  instrument_id uuid references instruments(id),
  timeframe text,
  type alert_type not null,
  title text not null,
  body text not null,                     -- final composed message (same text goes to WhatsApp)
  payload jsonb,                          -- structured numbers (entry/sl/tp, indicator values)
  dedupe_key text not null unique,        -- sha256(rule|instrument|time-bucket)
  triggered_at timestamptz not null default now(),
  read_at timestamptz
);

create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references alerts(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','telegram','email','push')),
  destination text not null,
  provider text not null,                 -- twilio | resend | telegram | webpush
  provider_ref text,                      -- Twilio message SID etc.
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','read','failed','suppressed')),
  attempts int not null default 0,
  error jsonb,
  queued_at timestamptz not null default now(),
  sent_at timestamptz, delivered_at timestamptz
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  instrument_id uuid references instruments(id),
  direction text not null check (direction in ('long','short')),
  opened_at timestamptz not null,
  entry_price numeric(20,8) not null, size numeric(16,4) not null,
  stop_loss numeric(20,8), take_profit numeric(20,8),
  closed_at timestamptz, exit_price numeric(20,8), fees numeric(14,4) default 0,
  pnl numeric(16,4) generated always as
    (case when exit_price is null then null
          else (case direction when 'long' then exit_price - entry_price
                               else entry_price - exit_price end) * size - coalesce(fees,0)
     end) stored,
  r_multiple numeric(6,2),
  setup_tags text[] default '{}',
  linked_idea_id uuid references trade_ideas(id),
  pre_trade_notes text, post_trade_notes text,
  screenshots text[] default '{}',        -- Storage paths (private bucket)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────── news & calendar ───────────────────────────
create table news_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,                   -- fed_rss | ecb_rss | boe_rss | boj_rss | cnbc | …
  external_id text not null,
  published_at timestamptz not null,
  title text not null, url text,
  raw_summary text,
  category text check (category in ('central_bank','cpi','nfp','gdp','rates',
                                    'earnings','geopolitical','breaking','other')),
  impact text check (impact in ('high','medium','low')),
  currencies text[] default '{}',
  related_symbols text[] default '{}',    -- canonical symbols affected
  ai_analysis text,                       -- 2-3 sentence market effect, educational framing
  ai_model text,
  fetched_at timestamptz not null default now(),
  unique (source, external_id)
);

create table economic_events (            -- weekly FF calendar XML, upserted
  id uuid primary key default gen_random_uuid(),
  event_time timestamptz not null,
  currency text not null,
  title text not null,
  impact text not null check (impact in ('high','medium','low','holiday')),
  forecast text, previous text, actual text,
  source text not null default 'ff_calendar',
  unique (event_time, currency, title)
);

-- ─────────────────────────── security / ops ───────────────────────────
create table api_credentials (            -- future broker keys; secrets in Vault only
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null,
  label text not null,
  vault_secret_id uuid not null,          -- references vault.secrets
  created_at timestamptz not null default now()
);

create table audit_logs (                 -- append-only
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id),
  action text not null,                   -- role.grant, rule.create, cred.store, login.mfa…
  entity text, entity_id text,
  metadata jsonb,
  ip inet, user_agent text,
  created_at timestamptz not null default now()
);
```

### 4.2 Indexes

```sql
create index on price_candles (instrument_id, timeframe, ts desc);
create index on indicator_snapshots (instrument_id, timeframe, ts desc);
create index on analysis_snapshots (instrument_id, generated_at desc);
create index on alerts (user_id, triggered_at desc);
create index on notification_deliveries (status, queued_at) where status = 'queued';
create index on news_items (published_at desc);
create index on news_items (impact) where impact = 'high';
create index on economic_events (event_time);
create index on journal_entries (user_id, opened_at desc);
create index on audit_logs (created_at desc);
```

### 4.3 RLS policy matrix

| Table | member | analyst | admin | service_role (edge fns) |
|---|---|---|---|---|
| profiles | select/update **own** | same | all | all |
| user_roles | read own | read own | all | all |
| plans / subscriptions | read plans; read own sub | same | all | all |
| instruments / price_candles / indicator_snapshots / analysis_snapshots | read | read | write | all |
| trade_ideas | read | read | write/invalidate | all |
| watchlists / watchlist_items | CRUD own | CRUD own | read all | all |
| alert_rules | CRUD own (+ plan limit trigger) | CRUD own | read all | all |
| alerts | read own, update own (`read_at`) | same | read all | all |
| notification_deliveries | read own (via alert join) | same | read all | all |
| journal_entries | CRUD own | CRUD own | read all | all |
| news_items / economic_events | read | read | all | all |
| api_credentials | read own (no secret), insert own | same | — write via RPC only | vault writes |
| audit_logs | — | — | read | insert only |

Representative policies:

```sql
alter table alerts enable row level security;
create policy "alerts: read own" on alerts
  for select using (auth.uid() = user_id or has_role('admin'));
create policy "alerts: mark read" on alerts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table alert_rules enable row level security;
create policy "rules: crud own" on alert_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "audit: admin read only" on audit_logs
  for select using (has_role('admin'));
-- No INSERT/UPDATE/DELETE policies: only service_role (bypasses RLS) can write.
```

Plan-limit enforcement as a trigger (server-side, cannot be bypassed from client):

```sql
create or replace function enforce_alert_rule_limit() returns trigger
language plpgsql security definer set search_path='' as $$
declare lim int; cnt int;
begin
  select p.max_alert_rules into lim from plans p
    join subscriptions s on s.plan_id = p.id and s.status in ('active','trialing')
   where s.user_id = new.user_id;
  select count(*) into cnt from alert_rules where user_id = new.user_id and is_active;
  if cnt >= coalesce(lim, 3) then
    raise exception 'alert_rule_limit_reached';
  end if;
  return new;
end $$;
```

---

## 5. Data Pipelines

All pipelines are **Edge Functions invoked by `pg_cron` via `pg_net`** (Supabase-native scheduling). Each run writes an execution row to an internal `pipeline_runs` table (status, duration, rows affected) feeding the admin health page.

```sql
-- examples of pg_cron registrations (run during deploy migration)
select cron.schedule('ingest-quotes',  '*/5 * * * *',   $$select net.http_post(url:='…/ingest-quotes', …)$$);
select cron.schedule('ingest-crypto',  '* * * * *',     $$ … $$);
select cron.schedule('compute-h1',     '5,20,35,50 * * * *', $$ … $$);   -- after 15m bars close
select cron.schedule('evaluate-alerts','*/2 * * * *',   $$ … $$);
select cron.schedule('dispatch',       '* * * * *',     $$ … $$);
select cron.schedule('london-brief',   '0 7 * * 1-5',   $$ … $$);        -- 07:00 UTC = 10:00 EAT
select cron.schedule('ny-brief',       '30 13 * * 1-5', $$ … $$);        -- 13:30 UTC = 16:30 EAT
```

### 5.1 `ingest-quotes` — every 5 min (auth hours), every 15 min off-hours
1. Load active instruments where `provider='yahoo'`.
2. Batch-fetch `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=5m&range=1d` (batched, jittered, single-flight with 429 backoff + provider circuit breaker).
3. Validate (non-monotonic ts, extreme gap > 10×ATR ⇒ quarantine payload, alert admin).
4. Upsert `1m/5m` candles `on conflict do update`.
5. Record `data_freshness` per instrument (exposed in UI as "updated 3 min ago", red badge if stale > 2 intervals).

### 5.2 `ingest-crypto` — every 1 min
Binance `GET /api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2` → upsert. Real-time, free, no key.

### 5.3 `aggregate` (on-demand inside compute step)
M15/H1/H4/D1/W1 candles are built from stored 5m bars with `time_bucket()` queries — **no extra provider calls**; higher TFs are always consistent with lower ones.

### 5.4 `compute-indicators` — after each bar close per TF
For each active instrument × timeframe: pull window from `price_candles` (need ≥ 250 bars for EMA200), run the TA+SMC module (§6), write `indicator_snapshots`. Idempotent per `(instrument, tf, ts)` key — safe to re-run.

### 5.5 `analyze-ai` — every 5 min for watchlist instruments; on-demand per user
Builds the fact bundle from `indicator_snapshots` (all 6 TFs) + top 3 fresh relevant `news_items`, calls the LLM with a JSON-schema response (§7), then:
- `composite_score` and `bias` are **recomputed deterministically** from `scores` (LLM never sets them). LLM output that disagrees with computed composite beyond a tolerance is flagged `validation: 'overridden'` and the deterministic value wins.
- Writes `analysis_snapshots`.

### 5.6 `generate-ideas` — after each analyze cycle
Gate: `confidence ≥ 70`, regime ≠ `chaotic`, no high-impact red news within ±30 min for that currency, no already-open idea on the instrument.
Geometry (long example): `entry = close`, `stop = entry − 1.5×ATR14`, `tp1 = entry + 1×risk`, `tp2 = entry + 2×risk`, `tp3` at next opposing zone. Reject if RR(tp1) < 1.5 after spread buffer. Expiry = 24 h.
A `resolve-ideas` cron (*/5 min) walks open ideas against new candles and updates `status`/`result_r` — this powers the performance dashboard with *measured* stats, not claims.

### 5.7 `evaluate-alerts` — every 2 min
Evaluates every active `alert_rule` against latest snapshots; on condition hit, inserts `alerts` with `dedupe_key = sha256(rule_id | instrument | floor(now/cooldown))`. Unique key makes storms impossible; quiet-hours rules insert with a `held_until` flag the dispatcher respects.

### 5.8 `dispatch-notifications` — every 1 min
Selects undelivered alerts × enabled channels → creates `notification_deliveries` rows (`queued`) → sends via provider APIs with exponential backoff (max 5 attempts) → status webhooks (`twilio-webhook`) update delivery status. Per-user daily WhatsApp cap from `plans` enforced here (suppression logged with `status='suppressed'`).

### 5.9 `ingest-news` — every 15 min
RSS feeds: Fed press, ECB press, BoE news, BoJ, plus 2–3 general finance feeds. ForexFactory weekly XML for `economic_events`. New items → cheap-model classification (`category`, `impact`, `currencies`, `related_symbols`) → high-impact items get an `ai_analysis` paragraph → matching users' `news_impact` rules fire.
**Event guard:** every red-folder event creates a ±30 min window during which (a) idea generation on affected instruments is paused and (b) an optional pre-event "NFP in 30 min — expect volatility" alert goes out.

### 5.10 Briefings
- **Daily outlook** (06:00 EAT): regime + key levels across the 14 majors, today's red events.
- **London open** (10:00 EAT DST-aware): overnight Asia recap, EUR/GBP/Gold focus.
- **NY open** (16:30 EAT DST-aware): US data today, US500/NAS100/US30 levels, open ideas status.
- **EOD summary** (23:00 EAT): idea results (R-multiples), journal nudge, tomorrow's calendar.
Cast as the user's plan's "alert types" and delivered like any other alert.

---

## 6. Indicator & SMC Engine (deterministic TS module)

**Package:** `@engine/ta` — zero-dependency, ~100% unit-tested, versioned (semver in `engine_version`).

| Layer | What's computed | Notes |
|---|---|---|
| Moving averages | EMA 20/50/100/200, SMA 20/50 | Wilder-correct seeding |
| Momentum | RSI-14 (Wilder), MACD 12/26/9 (+ cross detection with bar index) | Cross events carry `bars_ago` |
| Volatility | BB 20/2, ATR-14, ATR-regime percentile (90d lookback) | Drives risk labels & idea gating |
| Volume | VWAP (session), relative volume vs 20-bar mean | Forex/crypto volume caveats flagged |
| Swings | Fractal pivots (k=3), labeled HH/HL/LH/LL | Contract: a swing is *confirmed* only after k bars |
| Structure | Trend = f(confirmed swing sequence); **BOS** = close beyond prior swing in trend direction; **CHoCH** = close beyond opposing swing | Only *confirmed* swings feed BOS/CHoCH (no repaint) |
| FVG | 3-candle imbalance; tracked until fully filled; `mitigated` state | Stored as zones with lifecycle |
| Supply/Demand | Base + explosive departure (range ≥ 1.5×ATR); strength = departure strength × freshness × tests | Zones weaken on each test |
| Liquidity | Equal highs/lows clusters (±0.1×ATR), session highs/lows, PDH/PDL | Labeled `buyside`/`sellside` |
| S/R | Swing-cluster levels + round-number proximity merge | Dedup within 0.25×ATR |
| Fibonacci | Retracement/extension grid of the active confirmed leg | `0.382/0.5/0.618/0.786`, ext `1.272/1.618` |
| Correlation | 30-day daily-return Pearson matrix across watchlist | Powers "already exposed to USD" guard |
| MTF score | Per-TF bias → weighted composite (5m 10%, 15m 15%, 1h 20%, 4h 25%, 1d 20%, 1w 10%) | Conflict (HTF bull + LTF bear) visibly shown, never averaged away |

**Composite score → bias/confidence:**
`composite = 0.25·trend + 0.25·momentum + 0.25·structure + 0.15·volume + 0.10·regime` (each 0–100, computed from indicator states; e.g. trend score from EMA stack alignment + price-vs-EMAs).
`bias = bullish if composite ≥ 60, bearish ≤ 40, else neutral`. `confidence = |composite − 50| × 2` adjusted down for regime=`ranging` and pre-news windows. Every input to the score is stored in the snapshot row → fully explainable in the UI ("why 87%?").

---

## 7. AI Layer

### 7.1 Model routing

| Task | Model | Why | Budget |
|---|---|---|---|
| News classification (cat/impact/symbols) | **gpt-5.4-nano** ($0.20/1M in, $1.25/1M out) | trivial task, huge volume | ~$1/mo |
| Per-instrument narrative, idea commentary | **gpt-5.4-mini** ($0.75 / $4.50) | good enough with rich facts | ~$5–15/mo |
| Daily/London/NY/EOD briefings | **gpt-5.4** ($2.50 / $15) | user-facing quality | ~$3–10/mo |
| (Optional) deep research toggle | gpt-5.5 or Claude Sonnet | per-user opt-in, quota-gated | user-level |

All with `response_format: {type:'json_schema', …}` and prompt caching (instrument spec + rubric static prefix cached).

### 7.2 Contracts (examples)

News classification output:
```json
{"category":"cpi","impact":"high","currencies":["USD"],
 "related_symbols":["US500","NAS100","US30","XAUUSD","EURUSD","USDJPY"],
 "effect_hint":"pre_event","headline_clean":"US CPI m/m"}
```
Analysis narrative input is a **fact bundle** (no raw candles): snapshot scores per TF, cross events, zone list, news overlay — output is `{narrative, bull_case, bear_case, invalidation, key_watch}` with each field ≤ 280 chars. The LLM is instructed it may reference only numbers present in the bundle; the function validates that any numeric token in the output exists in the input fact set (cheap regex guard) — violations fall back to a template narrative.

### 7.3 Cost controls
- Hard daily budget env var (`AI_DAILY_CAP_USD`); circuit breaker at 80%.
- Narrative cache: identical fact-bundle hash → skip LLM call (template reuse).
- Mini/nano first; gpt-5.4 only for briefings.
- Every call logs `ai_model, tokens_in/out, cost_usd` in `analysis_snapshots` / `news_items` → cost dashboard in admin panel.

---

## 8. Alerts & Notifications

### 8.1 Message composition (single source)
One `composeAlert()` function renders `title` + `body` (≤ 900 chars for WhatsApp readability) + `payload`. The same body goes to WhatsApp/Telegram/email(preview)/push, so all channels always agree.

Trade-idea alert example (matches the product spec):
```
📊 US500 — LONG (Educational)
Trend: Bullish · Confidence: 87%
Entry: 6240 · SL: 6215
TP1: 6265 · TP2: 6290
Risk: Medium
Why: EMA20>EMA50 · RSI 58 · MACD bullish cross
      · Break above 4H resistance zone
Invalidation: 4H close < 6215
⚠️ Educational analysis, not financial advice.
```

### 8.2 Storm & spam protection
- `dedupe_key` unique constraint (cooldown buckets) — hard guarantee.
- Per-user rate caps: max 20 WhatsApp/day (free), 100 (pro); counters in Redis-free fashion via `notification_deliveries` count query (cheap at our scale).
- Quiet hours honored at dispatch; digests coalesce: >3 alerts for same instrument in 10 min → single rolled-up message.

### 8.3 Twilio sandbox mechanics (Phase 0–1)
- Twilio sandbox: user sends `join <word>` to the shared sandbox number once; then we can message them. Sandbox access is free; messages bill at standard rates after the **$15 trial credit** [1].
- Pricing (2026): **Twilio $0.005/msg** + Meta per-message template fee **$0.0014–$0.0499** depending on country & category (utility cheapest, marketing highest); failed messages $0.001 [1][2].
- Budget reality: 30 alerts/day → ~900 msgs/mo → **~$8–50/mo** depending on KE utility rate. Exact Kenya rate card to be pulled from Meta at template-approval time.

### 8.4 Migration path to production WhatsApp
1. Create Meta Business, verify (business docs; 2–10 days).
2. Get dedicated number (or Twilio-hosted WA sender ~$1.15/mo [3]).
3. Submit **utility templates**: `alert_trade_idea`, `alert_indicator`, `alert_news`, `briefing` (variables map 1:1 to our `payload` keys — designed for this already).
4. Sandbox code stays; environment variable flips sender. Zero code change — channel abstraction pays off.
5. 24-hour customer-service window nuance: proactive alerts **must** be template messages in production; sandbox tolerates freeform. We design template-first from day one.

### 8.5 Inbound
`twilio-webhook` handles STOP/START (toggles `whatsapp_opted_in`, logged to `audit_logs`), delivery receipts, and future commands (`STATUS`, `MUTE US500 2H`) — parser stubbed from day one.

---

## 9. API Surface

Client talks to Supabase directly for reads (RLS does authz) — **no bespoke REST layer for CRUD**. Edge functions exist only where secrets/privilege are needed:

| Function | Trigger | Privilege |
|---|---|---|
| `ingest-quotes`, `ingest-crypto`, `ingest-news` | pg_cron | service_role |
| `compute-indicators`, `analyze-ai`, `generate-ideas`, `resolve-ideas` | pg_cron | service_role |
| `evaluate-alerts`, `dispatch-notifications` | pg_cron | service_role |
| `briefings` | pg_cron | service_role |
| `twilio-webhook` | Twilio → HTTPS (signature-verified) | validates `X-Twilio-Signature` |
| `analyze-now` (manual refresh) | user JWT | member; rate-limited 10/day on plan |
| `admin-users`, `admin-instruments`, `admin-broadcast` | admin JWT | `has_role('admin')` |
| `store-credential`, `rotate-credential` | user JWT | Vault RPC, audit-logged |

Realtime channels: `candles:{instrument_id}:{tf}` (broadcast after ingest), `alerts:{user_id}` (postgres_changes on own rows), `news:high-impact` (broadcast).

---

## 10. Frontend Architecture

### 10.1 Routes
```
/                     marketing/landing (static)
/login  /signup  /forgot-password  /mfa-challenge
/app                  overview: watchlist heat tiles, open alerts, today’s events, quick stats
/app/markets/[symbol] chart + indicators panel + AI analysis + structure overlays + news
/app/watchlists       manager
/app/alerts           inbox (read/unread, filters)
/app/alerts/rules     rule builder (type → conditions → channels → cooldown, plan-aware limits)
/app/ideas            card feed, status filters, measured hit-rate stats, disclaimer header
/app/journal          table + calendar + equity curve + tag analytics, screenshot upload
/app/news             feed + economic calendar (week view, impact filter)
/app/settings         profile, timezone, notification channels, quiet hours, MFA, API keys, plan
/app/admin            users & roles, instruments, pipeline health (pipeline_runs), AI cost, audit log explorer
```

### 10.2 Key components
- `MarketChart` — lightweight-charts v5: candles + EMAs/BB overlays, zone rectangles (FVG/S/D shading via custom primitives), BOS/CHoCH line markers, entry/SL/TP price lines for ideas, crosshair OHLC readout.
- `SignalScore` — radial gauge + expandable "why this score" breakdown fed by `scores` JSON (explainability is a feature).
- `HeatmapGrid` — watchlist tiles colored by composite score, click-through to market page.
- `RuleBuilder` — condition composer with live "would have fired N times in last 7d" backtest preview (cheap count query over `indicator_snapshots`).
- `EcoCalendar` — week strip, currency chips, red-event countdown; currencies map to instruments.
- `JournalEditor` + `JournalStats` — equity curve, win rate, avg R, tag breakdown, expectancy.
- Theme: Tailwind CSS variables, `class="dark"` strategy, persisted to `profiles.theme`.
- PWA: manifest + service worker; installable on Android/iOS; web-push wired in Phase 6.

### 10.3 Data layer
TanStack Query (staleTime 30 s) + Supabase Realtime invalidation (`on candle broadcast → invalidate market query`). Optimistic updates for watchlist/rule CRUD. All tables typed via generated Supabase types (`supabase gen types`).

---

## 11. Security Model

| Area | Implementation |
|---|---|
| Authentication | Supabase Auth: email+password, Google/Apple OAuth; **TOTP MFA** (available now, enrolled per-user in Settings; enforced for `admin` role) |
| Authorization | RLS on every table (§4.3); privileged logic only in service_role functions; admin checks via `has_role()` (JWT-claim hook optional later) |
| Secrets | Provider keys (Twilio/OpenAI/Binance-none) in Edge env vars; **user** future broker keys in Supabase Vault, never returned to client after write |
| Audit | Trigger-based `audit_logs` on: role changes, subscription changes, credential writes, rule create/update, admin actions, auth events from hook; append-only; admin read-only view |
| Rate limiting | Plan quotas in DB triggers (rules, AI calls); edge fns self-throttle per user; Vercel WAF for the app; Twilio webhook signature verification; pg_net cron calls carry a shared cron-secret header |
| Data transport | TLS everywhere; WhatsApp contains your watchlist prices — delivery log stores message hash, not body, beyond 30 days (retention job) |
| Backups | Supabase Pro: daily backups (7-day retention); plus weekly `pg_dump` cron → encrypted to off-Supabase storage; PITR add-on evaluated at launch |
| Account safety | Failed-login lockouts (Supabase Auth built-in), session revocation UI, new-device email notice |
| Compliance copy | Persistent disclaimer footer ("Educational analysis, not financial advice…") + acceptance checkbox at signup stored with timestamp |

---

## 12. Environments & Repo Layout

```
market-intel-platform/
├─ apps/web/                # Next.js 15 → Vercel
├─ supabase/
│  ├─ migrations/           # DDL above, RLS, cron, seeds (instruments, plans)
│  ├─ functions/            # edge functions (one folder each)
│  └─ config.toml
├─ packages/engine/         # @engine/ta (TA + SMC, unit-tested, versioned)
├─ packages/shared/         # types (generated), composeAlert, validators
└─ docs/                    # this spec, runbooks, ADRs
```
- **dev**: local `supabase start` (Docker) + `next dev`; seed script spins 90 days of synthetic candles so the UI is fully testable offline.
- **staging**: Supabase project `mip-staging` + Vercel preview deployments.
- **prod**: Supabase project `mip-prod` + Vercel production. Migrations via `supabase db push` in CI (GitHub Actions) with migration-gate checks.
- CI: `vitest` for engine (+ golden-fixture SMC tests), `tsc --noEmit`, Drizzle-free typegen check, edge-fn integration smoke against staging.

---

## 13. Cost Model (verified August 2026)

| Line item | Dev (now) | Private production | Public SaaS (~100 users) | Source |
|---|---|---|---|---|
| Vercel | $0 (Hobby) | $0 (Hobby, personal use) | $20/user Pro (commercial required) | [4][5] |
| Supabase | $0 (Free; pauses after 7d idle — keep-alive cron) | **$25 Pro** (8 GB DB, no pause, daily backups, 2M edge invocations) | $25 + overages (≈$25–80) | [6][7] |
| Market data | $0 (Yahoo + Binance) | $0 | $0–39 (consider Twelve Data paid for SLA) | — |
| WhatsApp (Twilio) | $15 trial credit | **~$8–50/mo** @30 alerts/day | scales with alerts; KE utility template rate applies | [1][2][3] |
| OpenAI | ~$5 | **~$10–25/mo** (nano+mini, cached) | $40–150 (quota-gated) | [8][9] |
| Domain + email (Resend) | $0–12/yr | ~$12/yr + $0–20 | +$20–50 | — |
| **Total** | **≈ $0–15/mo** | **≈ $45–100/mo** | **≈ $150–350/mo** | |

*Numbers exclude your time. The $25 Supabase Pro upgrade is the single non-negotiable cost at private-production (no pausing + backups).*

---

## 14. Build Roadmap (10 milestones ≈ 10–14 weeks part-time)

| # | Milestone | Scope | Acceptance criteria |
|---|---|---|---|
| M0 | Repo & envs | monorepo, local Supabase, CI, seeds | `pnpm dev` + local stack green |
| M1 | Auth & profiles | email/OAuth signup, profile, theme, TOTP MFA, RLS | sign up → land in /app; RLS penetration tests pass |
| M2 | Instruments & ingestion | seed 18 symbols, `ingest-quotes`, `ingest-crypto`, freshness monitor | 5m candles flowing for all 18; stale-data badge works |
| M3 | Engine v1 | TA set + aggregate TFs, snapshots, chart overlays | indicator values match reference lib within 1e-6; chart renders |
| M4 | Engine v2 (SMC) | swings, BOS/CHoCH, FVG, zones, S/R, fib, MTF composite | golden fixtures pass; "why score" panel populated |
| M5 | Dashboard v1 | overview, markets page, watchlists, heatmap, realtime | live tiles update without refresh; mobile pass |
| M6 | Alerts & WhatsApp | rule builder, evaluate, dispatch, Twilio sandbox, digest/quiet hours | sandbox join → RSI rule → WhatsApp received ≤2 min |
| M7 | AI layer | news ingest + classify, narrative, ideas + resolver | idea card end-to-end; measured hit-rate on /app/ideas |
| M8 | Journal & performance | journal CRUD, stats, idea tracking, briefings | equity curve renders; EOD brief on WhatsApp |
| M9 | Admin & hardening | admin panel, audit explorer, cost dashboard, backups, load test | admin can disable instruments; p95 API < 300 ms |
| M10 | Production launch | prod envs, monitoring, runbooks, WhatsApp production templates submitted | 7-day soak green; templates approved or fallback live |

Future tracks (parked by design): Stripe/M-Pesa subscriptions UI, broker execution, backtesting lab, Telegram channel ingestion, native apps.

---

## 15. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Yahoo unofficial API changes/429s | data gap | Provider interface + circuit breaker + fallback chain (Stooq EOD, Twelve Data free 8 req/min); freshness badge makes degradation visible, not silent |
| Index data delay (~15 min) | misleading alerts | Per-instrument delay label; crypto/Binance real-time; document in onboarding; paid feed is a one-line provider swap later |
| Twilio sandbox limits (shared number, join step) | clunky demo | Telegram channel in parallel (one toggle); production WA templates filed at M6 |
| LLM cost overrun | surprise bill | daily cap env var, model routing down-tiers, bundle-hash cache, per-call cost logging → admin dashboard |
| SMC "signal" quality claims | credibility | Ideas resolved automatically with measured R; UI shows **realized** hit-rate, never marketing numbers |
| WhatsApp template rejection (financial content) | launch delay | Utility-framed templates, disclaimer in each, Telegram/email fallback channels already built |
| pg_cron/edge cold starts miss a minute | late alerts | idempotent pipelines + catchup windows (each run processes gaps), alert latency tracked in `pipeline_runs` |
| Solo maintenance burden | fatigue | everything automated/idempotent; runbooks in docs/; alerting on pipeline failures to your own WhatsApp |

---

## 16. Sources

1. Twilio WhatsApp pricing breakdown — zernio.com/blog/twilio-whatsapp-pricing-breakdown-what-it-really-costs
2. Twilio WhatsApp alternative fee analysis — zernio.com/alternatives/twilio
3. Twilio pricing 2026 — costbench.com/software/sms-marketing/twilio/
4. Vercel pricing (Hobby/Pro 2026) — costbench.com/software/developer-tools/vercel/
5. Vercel Hobby limits 2026 — pandacodegen.com/blog/nextjs-hosting-zero-cost
6. Supabase billing docs — supabase.com/docs/guides/platform/billing-on-supabase
7. Supabase pricing breakdown — designrevision.com/blog/supabase-pricing
8. OpenAI API pricing 2026 — g2.com/articles/openai-api-pricing
9. OpenAI API pricing breakdown — developer.puter.com/tutorials/openai-api-pricing/
