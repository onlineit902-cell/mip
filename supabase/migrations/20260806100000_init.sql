-- ═══════════════════════════════════════════════════════════════════════════
-- MIP · 0001 init — extensions, enums, tables, indexes, RLS, triggers
-- AI Market Intelligence Platform · spec v1.0 §4
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists timescaledb;
create extension if not exists pg_net;
create extension if not exists pgsodium;

-- ─────────────────────────── enums ───────────────────────────
do $$ begin create type app_role as enum ('admin','analyst','member'); exception when duplicate_object then null; end $$;
do $$ begin create type asset_class as enum ('index','commodity','forex','crypto','stock','etf'); exception when duplicate_object then null; end $$;
do $$ begin create type alert_type as enum ('price_level','rsi','ema_cross','macd_cross','bollinger','structure','trade_idea','news_impact','session_open','daily_brief','eod_summary'); exception when duplicate_object then null; end $$;

-- ─────────────────────────── identity / plans / rbac ───────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  timezone text not null default 'Africa/Nairobi',
  default_currency text not null default 'USD',
  theme text not null default 'system' check (theme in ('system','light','dark')),
  phone_e164 text unique,
  whatsapp_opted_in boolean not null default false,
  telegram_chat_id text,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_roles (
  user_id uuid references auth.users(id) on delete cascade,
  role app_role not null default 'member',
  primary key (user_id, role)
);

create or replace function has_role(r app_role) returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.user_roles where user_id = auth.uid() and role = r) $$;

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  max_watchlist_items int not null,
  max_alert_rules int not null,
  max_journal_month int not null,
  min_alert_interval_min int not null,
  whatsapp_enabled boolean not null default false,
  ai_briefs_per_day int not null default 1,
  price_monthly_usd numeric(8,2) not null default 0
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  plan_id uuid not null references plans(id),
  status text not null default 'active' check (status in ('trialing','active','past_due','canceled')),
  provider text not null default 'manual' check (provider in ('manual','stripe','mpesa')),
  provider_ref text,
  current_period_start timestamptz, current_period_end timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id)
);

-- ─────────────────────────── market data ───────────────────────────
create table if not exists instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text unique not null,
  name text not null,
  asset_class asset_class not null,
  provider_symbol text,
  provider text not null default 'yahoo' check (provider in ('yahoo','binance')),
  base_ccy text, quote_ccy text,
  price_decimals int not null default 2,
  session_open time, session_close time,
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists price_candles (
  instrument_id uuid not null references instruments(id),
  timeframe text not null check (timeframe in ('1m','5m','15m','1h','4h','1d','1w')),
  ts timestamptz not null,
  open numeric(20,8) not null, high numeric(20,8) not null,
  low numeric(20,8) not null,  close numeric(20,8) not null,
  volume numeric(24,4),
  source text not null default 'yahoo',
  primary key (instrument_id, timeframe, ts)
);
select create_hypertable('public.price_candles', 'ts', if_not_exists => true);

-- ─────────────────────────── analysis outputs ───────────────────────────
create table if not exists indicator_snapshots (
  instrument_id uuid not null references instruments(id),
  timeframe text not null,
  ts timestamptz not null,
  close numeric(20,8) not null,
  ema20 numeric(20,8), ema50 numeric(20,8), ema100 numeric(20,8), ema200 numeric(20,8),
  sma20 numeric(20,8), sma50 numeric(20,8),
  rsi14 numeric(8,3),
  macd numeric(20,8), macd_signal numeric(20,8), macd_hist numeric(20,8),
  bb_upper numeric(20,8), bb_mid numeric(20,8), bb_lower numeric(20,8),
  atr14 numeric(20,8),
  vwap numeric(20,8), rel_volume numeric(10,3),
  swings jsonb, structure jsonb, zones jsonb, sr_levels jsonb, fib jsonb,
  scores jsonb,
  engine_version text not null,
  primary key (instrument_id, timeframe, ts)
);
select create_hypertable('public.indicator_snapshots', 'ts', if_not_exists => true);

create table if not exists analysis_snapshots (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(id),
  generated_at timestamptz not null default now(),
  bias text not null check (bias in ('bullish','bearish','neutral')),
  confidence int not null check (confidence between 0 and 100),
  composite_score numeric(6,2) not null,
  key_levels jsonb, mtf_alignment jsonb,
  narrative text not null,
  news_overlay jsonb,
  ai_model text, tokens_in int, tokens_out int, cost_usd numeric(10,6),
  engine_version text not null
);

create table if not exists trade_ideas (
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
  rationale jsonb not null,
  ai_commentary text,
  status text not null default 'open'
    check (status in ('open','tp1_hit','tp2_hit','tp3_hit','sl_hit','expired','invalidated')),
  result_r numeric(6,2),
  resolved_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────── user features ───────────────────────────
create table if not exists watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null default 'Main',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists watchlist_items (
  watchlist_id uuid not null references watchlists(id) on delete cascade,
  instrument_id uuid not null references instruments(id),
  sort_order int not null default 0,
  primary key (watchlist_id, instrument_id)
);

create table if not exists alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  instrument_id uuid references instruments(id),
  timeframe text not null default '15m',
  type alert_type not null,
  conditions jsonb not null,
  channels jsonb not null default '{"inapp":true}'::jsonb,
  cooldown_minutes int not null default 60,
  quiet_hours jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references alert_rules(id) on delete set null,
  user_id uuid not null references profiles(id) on delete cascade,
  instrument_id uuid references instruments(id),
  timeframe text,
  type alert_type not null,
  title text not null,
  body text not null,
  payload jsonb,
  dedupe_key text not null unique,
  triggered_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references alerts(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','telegram','email','push')),
  destination text not null,
  provider text not null,
  provider_ref text,
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','read','failed','suppressed')),
  attempts int not null default 0,
  error jsonb,
  queued_at timestamptz not null default now(),
  sent_at timestamptz, delivered_at timestamptz
);

create table if not exists journal_entries (
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
  screenshots text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────── news & calendar ───────────────────────────
create table if not exists news_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  published_at timestamptz not null,
  title text not null, url text,
  raw_summary text,
  category text check (category in ('central_bank','cpi','nfp','gdp','rates','earnings','geopolitical','breaking','other')),
  impact text check (impact in ('high','medium','low')),
  currencies text[] default '{}',
  related_symbols text[] default '{}',
  ai_analysis text,
  ai_model text,
  fetched_at timestamptz not null default now(),
  unique (source, external_id)
);

create table if not exists economic_events (
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
create table if not exists api_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null,
  label text not null,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id),
  action text not null,
  entity text, entity_id text,
  metadata jsonb,
  ip inet, user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists pipeline_runs (
  id bigint generated always as identity primary key,
  function_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text check (status in ('ok','error')),
  details jsonb
);

-- ─────────────────────────── indexes ───────────────────────────
create index if not exists candles_lookup on price_candles (instrument_id, timeframe, ts desc);
create index if not exists snaps_lookup on indicator_snapshots (instrument_id, timeframe, ts desc);
create index if not exists analysis_lookup on analysis_snapshots (instrument_id, generated_at desc);
create index if not exists alerts_user on alerts (user_id, triggered_at desc);
create index if not exists deliveries_queue on notification_deliveries (status, queued_at) where status = 'queued';
create index if not exists news_time on news_items (published_at desc);
create index if not exists news_red on news_items (impact) where impact = 'high';
create index if not exists events_time on economic_events (event_time);
create index if not exists journal_user on journal_entries (user_id, opened_at desc);
create index if not exists audit_time on audit_logs (created_at desc);

-- ─────────────────────────── updated_at maintenance ───────────────────────────
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','alert_rules','journal_entries'] loop
    execute format('drop trigger if exists touch_%I on %I', t, t);
    execute format('create trigger touch_%I before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- ─────────────────────────── new user bootstrap ───────────────────────────
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare free_plan uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role) values (new.id, 'member')
  on conflict do nothing;

  select id into free_plan from public.plans where code = 'free' limit 1;
  if free_plan is not null then
    insert into public.subscriptions (user_id, plan_id) values (new.id, free_plan)
    on conflict (user_id) do nothing;
  end if;

  insert into public.watchlists (user_id, name) values (new.id, 'Main')
  on conflict (user_id, name) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ─────────────────────────── plan limits ───────────────────────────
create or replace function enforce_alert_rule_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int; cnt int;
begin
  select p.max_alert_rules into lim
    from public.plans p
    join public.subscriptions s on s.plan_id = p.id and s.status in ('active','trialing')
   where s.user_id = new.user_id;
  select count(*) into cnt from public.alert_rules where user_id = new.user_id and is_active;
  if new.is_active and cnt >= coalesce(lim, 3) then
    raise exception 'alert_rule_limit_reached';
  end if;
  return new;
end $$;

drop trigger if exists limit_rules on alert_rules;
create trigger limit_rules before insert or update on alert_rules
  for each row execute function enforce_alert_rule_limit();

-- ─────────────────────────── RLS ───────────────────────────
alter table profiles enable row level security;
alter table user_roles enable row level security;
alter table plans enable row level security;
alter table subscriptions enable row level security;
alter table instruments enable row level security;
alter table price_candles enable row level security;
alter table indicator_snapshots enable row level security;
alter table analysis_snapshots enable row level security;
alter table trade_ideas enable row level security;
alter table watchlists enable row level security;
alter table watchlist_items enable row level security;
alter table alert_rules enable row level security;
alter table alerts enable row level security;
alter table notification_deliveries enable row level security;
alter table journal_entries enable row level security;
alter table news_items enable row level security;
alter table economic_events enable row level security;
alter table api_credentials enable row level security;
alter table audit_logs enable row level security;

-- profiles
create policy "profiles: read own or admin" on profiles for select using (auth.uid() = id or has_role('admin'));
create policy "profiles: update own" on profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- roles
create policy "roles: read own or admin" on user_roles for select using (auth.uid() = user_id or has_role('admin'));
-- (granting/revoking roles happens only via service role / admin RPC)

-- plans & subscriptions
create policy "plans: readable" on plans for select using (true);
create policy "subs: read own or admin" on subscriptions for select using (auth.uid() = user_id or has_role('admin'));

-- public market data (read for any authenticated user)
create policy "instruments: read" on instruments for select using (true);
create policy "candles: read" on price_candles for select using (true);
create policy "snaps: read" on indicator_snapshots for select using (true);
create policy "analysis: read" on analysis_snapshots for select using (true);
create policy "ideas: read" on trade_ideas for select using (true);
create policy "news: read" on news_items for select using (true);
create policy "events: read" on economic_events for select using (true);

-- admin write on reference data
create policy "instruments: admin write" on instruments for all using (has_role('admin')) with check (has_role('admin'));
create policy "ideas: admin moderate" on trade_ideas for update using (has_role('admin')) with check (has_role('admin'));

-- user-owned data
create policy "watchlists: crud own" on watchlists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "watchlist_items: crud own" on watchlist_items for all
  using (exists (select 1 from watchlists w where w.id = watchlist_id and w.user_id = auth.uid()))
  with check (exists (select 1 from watchlists w where w.id = watchlist_id and w.user_id = auth.uid()));
create policy "rules: crud own" on alert_rules for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "journal: crud own" on journal_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- alerts
create policy "alerts: read own" on alerts for select using (auth.uid() = user_id or has_role('admin'));
create policy "alerts: mark read" on alerts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- deliveries (read via parent alert)
create policy "deliveries: read own" on notification_deliveries for select
  using (exists (select 1 from alerts a where a.id = alert_id and a.user_id = auth.uid()) or has_role('admin'));

-- credentials: owner can see metadata, never the secret
create policy "creds: read own" on api_credentials for select using (auth.uid() = user_id);
-- inserts only via security-definer RPC that writes the secret to Vault

-- audit: admin read-only; writes only from service role (bypasses RLS)
create policy "audit: admin read" on audit_logs for select using (has_role('admin'));
