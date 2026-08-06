-- ═══════════════════════════════════════════════════════════════════════════
-- MIP · 0003 cron — pg_cron schedules driving the edge-function pipelines
-- (spec §5). Requires pg_cron + pg_net and two project secrets:
--   app.settings.functions_url  e.g. https://<ref>.supabase.co/functions/v1
--   app.settings.cron_secret    shared header so only cron can call pipelines
-- Set them from the SQL editor before enabling, e.g.:
--   alter database postgres set app.settings.functions_url = 'https://…';
--   alter database postgres set app.settings.cron_secret  = '…random…';
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function call_pipeline(fn text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := current_setting('app.settings.functions_url') || '/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.settings.cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end $$;

-- data ingestion
select cron.schedule('ingest-quotes',    '*/5 * * * *',        $$select call_pipeline('ingest-quotes')$$);
select cron.schedule('ingest-crypto',    '* * * * *',          $$select call_pipeline('ingest-crypto')$$);
select cron.schedule('ingest-news',      '*/15 * * * *',       $$select call_pipeline('ingest-news')$$);

-- analysis chain (runs just after 5m bars close)
select cron.schedule('compute-5m',       '2-59/5 * * * *',     $$select call_pipeline('compute-indicators')$$);
select cron.schedule('analyze-ai',       '4-59/5 * * * *',     $$select call_pipeline('analyze-ai')$$);
select cron.schedule('generate-ideas',   '5-59/5 * * * *',     $$select call_pipeline('generate-ideas')$$);
select cron.schedule('resolve-ideas',    '*/5 * * * *',        $$select call_pipeline('resolve-ideas')$$);

-- alerts & notifications
select cron.schedule('evaluate-alerts',  '*/2 * * * *',        $$select call_pipeline('evaluate-alerts')$$);
select cron.schedule('dispatch',         '* * * * *',          $$select call_pipeline('dispatch-notifications')$$);

-- briefings (UTC; Africa/Nairobi = UTC+3 → 06:00/10:00/16:30/23:00 EAT)
select cron.schedule('daily-brief',      '0 3 * * *',          $$select call_pipeline('briefings?kind=daily')$$);
select cron.schedule('london-brief',     '0 7 * * 1-5',        $$select call_pipeline('briefings?kind=london')$$);
select cron.schedule('ny-brief',         '30 13 * * 1-5',      $$select call_pipeline('briefings?kind=newyork')$$);
select cron.schedule('eod-summary',      '0 20 * * 1-5',       $$select call_pipeline('briefings?kind=eod')$$);

-- housekeeping
select cron.schedule('retention-prune',  '30 2 * * 0',         $$select call_pipeline('retention-prune')$$);
