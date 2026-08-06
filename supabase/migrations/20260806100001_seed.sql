-- ═══════════════════════════════════════════════════════════════════════════
-- MIP · 0002 seed — plans + the 18 core instruments (spec §4.1)
-- ═══════════════════════════════════════════════════════════════════════════

insert into plans (code, name, max_watchlist_items, max_alert_rules, max_journal_month, min_alert_interval_min, whatsapp_enabled, ai_briefs_per_day, price_monthly_usd)
values
  ('free',  'Free',  10,  3,   30,  5, false, 1, 0),
  ('pro',   'Pro',   50,  25,  365, 1, true,  4, 19),
  ('elite', 'Elite', 200, 100, 3650,1, true,  12, 49)
on conflict (code) do nothing;

insert into instruments (symbol, name, asset_class, provider_symbol, provider, base_ccy, quote_ccy, price_decimals, sort_order)
values
  ('US500',  'S&P 500',                 'index',     '^GSPC',    'yahoo', 'USD', 'USD', 2, 10),
  ('NAS100', 'Nasdaq 100',              'index',     '^NDX',     'yahoo', 'USD', 'USD', 2, 20),
  ('US30',   'Dow Jones',               'index',     '^DJI',     'yahoo', 'USD', 'USD', 2, 30),
  ('GER40',  'DAX 40',                  'index',     '^GDAXI',   'yahoo', 'EUR', 'EUR', 2, 40),
  ('XAUUSD', 'Gold',                    'commodity', 'GC=F',     'yahoo', 'XAU', 'USD', 2, 50),
  ('XAGUSD', 'Silver',                  'commodity', 'SI=F',     'yahoo', 'XAG', 'USD', 3, 60),
  ('WTI',    'Crude Oil WTI',           'commodity', 'CL=F',     'yahoo', 'WTI', 'USD', 2, 70),
  ('EURUSD', 'Euro / US Dollar',        'forex',     'EURUSD=X', 'yahoo', 'EUR', 'USD', 5, 80),
  ('GBPUSD', 'Pound / US Dollar',       'forex',     'GBPUSD=X', 'yahoo', 'GBP', 'USD', 5, 90),
  ('USDJPY', 'US Dollar / Yen',         'forex',     'USDJPY=X', 'yahoo', 'USD', 'JPY', 3, 100),
  ('AUDUSD', 'Aussie / US Dollar',      'forex',     'AUDUSD=X', 'yahoo', 'AUD', 'USD', 5, 110),
  ('NZDUSD', 'Kiwi / US Dollar',        'forex',     'NZDUSD=X', 'yahoo', 'NZD', 'USD', 5, 120),
  ('USDCAD', 'US Dollar / Canadian',    'forex',     'USDCAD=X', 'yahoo', 'USD', 'CAD', 5, 130),
  ('USDCHF', 'US Dollar / Swiss Franc', 'forex',     'USDCHF=X', 'yahoo', 'USD', 'CHF', 5, 140),
  ('BTC',    'Bitcoin',                 'crypto',    'BTCUSDT',  'binance','BTC','USD', 0, 150),
  ('ETH',    'Ethereum',                'crypto',    'ETHUSDT',  'binance','ETH','USD', 1, 160)
on conflict (symbol) do nothing;
