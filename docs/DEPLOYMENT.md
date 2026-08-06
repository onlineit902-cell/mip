# Deployment Runbook

Dev-mode (what's running in this workspace) → production (Vercel + Supabase).
Costs per the spec §13: ~$0 in dev, ~$45–100/mo private production.

---

## 1. Supabase (backend)

1. Create project at supabase.com (region: closest to you — `eu-west-1` / `af-south-1` if available).
2. Link and push the schema:

   ```bash
   npm i -g supabase
   supabase login
   supabase link --project-ref <your-ref>
   supabase db push          # applies migrations 0001–0003
   ```

3. Verify: Table Editor shows `plans` (free/pro/elite) and `instruments` (16 rows).
4. **Cron secrets** (required before the pg_cron schedules in 0003 can call functions):

   ```sql
   alter database postgres set app.settings.functions_url = 'https://<ref>.supabase.co/functions/v1';
   alter database postgres set app.settings.cron_secret  = '<openssl rand -hex 32>';
   ```

5. Auth: enable Email + Google OAuth in Authentication → Providers. Toggle TOTP MFA on.
6. Grab keys (Settings → API): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (client) and `SUPABASE_SERVICE_ROLE_KEY` (edge functions only — never the browser).

> Free tier pauses after 7 idle days; upgrade to Pro ($25) before real users.

## 2. Vercel (frontend)

1. Push this repo to GitHub → Vercel → New Project → import.
2. Root directory: `apps/web`. Framework: Next.js (auto-detected).
3. Env vars: the two `NEXT_PUBLIC_SUPABASE_*` keys (M1 wiring introduces the client).
4. Deploy. Hobby plan is fine for personal use; commercial use requires Pro ($20).

## 3. Twilio WhatsApp sandbox (M6, alerts)

1. twilio.com → free account ($15 trial credit included).
2. Console → Messaging → Try it out → WhatsApp sandbox → note the number + join code.
3. On your own WhatsApp: send `join <code>` to the sandbox number.
4. Console → copy **Account SID** + **Auth Token** → Supabase Edge secrets:

   ```bash
   supabase secrets set TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… TWILIO_WA_FROM=whatsapp:+1…
   ```

5. Delivery path: `alert_rules` → `evaluate-alerts` (dedupe keys) → `dispatch-notifications`
   → Twilio REST → WhatsApp. Status callbacks return to the `twilio-webhook` function.
6. **Production upgrade** (when ready for other users): Meta Business verification →
   submit utility templates (`alert_trade_idea`, `alert_indicator`, `briefing`) — their
   variables map 1:1 to the existing `payload` shape from `composeAlert`.

## 4. OpenAI (M7, AI layer)

```bash
supabase secrets set OPENAI_API_KEY=sk-… AI_DAILY_CAP_USD=2.00
```

Routing (spec §7): `gpt-5.4-nano` classify · `gpt-5.4-mini` narratives · `gpt-5.4` briefings.

---

## CI

`.github/workflows/ci.yml` runs on every push: engine golden tests → strict typecheck →
production build → SQL migration lint. Keep it green before `supabase db push`.

## Environments

| env | app | database | notes |
|---|---|---|---|
| dev | this workspace (Next on :3000) | none (live Yahoo + synthetic fallback) | no auth by design |
| staging | Vercel preview deployments | `mip-staging` Supabase project | seeded synthetic candles |
| prod | Vercel production | `mip-prod` Supabase project | RLS + cron + backups on |

## Rollback

- App: Vercel → Deployments → promote previous.
- DB: Supabase → backups → restore to point-in-time (Pro). Migrations are additive-only;
  write a new migration to revert, never edit applied files.
