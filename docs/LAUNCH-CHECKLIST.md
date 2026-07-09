# Kicker — Launch Checklist (Phases 1–6)

Everything the account / wallet / shop / rewards / bankroll expansion needs to
run in production. Do these in order. With **none** of it configured, Kicker
still works fully as a guest/offline poker game — every step below only adds
capability.

---

## 1. Supabase project (accounts, wallet, shop, rewards)

1. Create a project at <https://supabase.com>. Note the **Project URL**,
   **anon public key**, and **service_role key** (Project Settings → API).
2. Open the SQL editor and run **`supabase/schema.sql`** — the whole file, top
   to bottom. It is idempotent: safe to re-run on an existing project after
   every update. This creates:
   - profiles, friends, requests, room invites (Phase 1)
   - `user_state` cloud save, `wallets`, `wallet_ledger`, `solo_sessions` (Phase 2)
   - `cosmetics` catalog (seeded), `cosmetic_inventory`, `cosmetic_equipped` (Phase 3)
   - `daily_claims`, `quests` (seeded), `quest_claims` (Phase 4)
   - `mp_sessions` + service-role-only `mp_buy_in` / `mp_settle` (Phase 5)
3. In **Auth → Providers → Email**: enable Email, turn on **Email OTP** so
   6-digit codes are issued (not just magic links).

## 2. Client environment (the Vite build)

Create `.env` (or set in your build system):

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

The anon key is meant to be public — Row Level Security protects the data.
**Never** put the service_role key here.

## 3. Game server environment (multiplayer)

```
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR-ANON-KEY                 # verified table identity (Phase 1)
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-KEY      # bankroll tables (Phase 5)
```

- Without `SUPABASE_SERVICE_ROLE_KEY`, saved-chips multiplayer tables report
  themselves unavailable; everything else works.
- The service key must live **only** on the game server. `mp_buy_in` /
  `mp_settle` are revoked from browser roles in the schema.

## 4. Branded confirmation email (optional but recommended)

1. Get a Resend API key (<https://resend.com>), verify your sending domain.
2. `supabase functions deploy send-email --no-verify-jwt`
3. `supabase secrets set RESEND_API_KEY=re_xxx`
   `supabase secrets set KICKER_EMAIL_FROM="Kicker <login@yourdomain.com>"`
   `supabase secrets set KICKER_PUBLIC_URL=https://your-kicker-domain`
4. Dashboard → **Auth → Hooks → Send Email** → enable, HTTPS hook, URL
   `https://<PROJECT-REF>.supabase.co/functions/v1/send-email`, then
   `supabase secrets set SEND_EMAIL_HOOK_SECRET="v1,whsec_xxx"`.

Skipped? Supabase sends its default OTP email — everything still works.

## 5. Build & deploy

```
npm install
npm test          # 109 tests: game logic, protocol, server, wallet, shop, rewards, bankroll
npm run build     # Vite + PWA
npm run server    # serves dist/ + WebSocket on :8787 (or PORT)
```

Docker users: the existing `Dockerfile` / `docker-compose.yml` flow is
unchanged — just add the three server env vars above.

## 6. Post-deploy verification (5 minutes)

Guest path (no account):
- [ ] Open the app fresh → solo table plays; settings/history/stats persist.
- [ ] Create + join a practice multiplayer room from two browsers; reconnect works.

Account path:
- [ ] Sign in with an email code; profile loads; second browser gets the same profile.
- [ ] Home shows **Saved chips 25,000** (starter grant, once).
- [ ] Solo table with "Saved chips" → buy-in debits → leave → stack banks back; ledger on the Account screen shows both rows with reasons.
- [ ] Shop: buy a common item → balance drops once (retry the tap: no double charge) → item equips → card back/felt/chips change in game.
- [ ] Rewards: draw the daily card → claim again → friendly "already claimed" (no second credit).
- [ ] Play 5 hands → quest claimable once.
- [ ] Create a **saved-chips** multiplayer table → second signed-in account joins (buy-in escrowed) → play a hand → both leave → wallets reflect exact stacks (chips conserved).
- [ ] A guest trying to join that bankroll room gets a clear "sign in" error.
- [ ] Opponent hole cards stay hidden in every state (spot-check the WebSocket frames if paranoid — `redactFor` tests also cover this).

## 7. Operational notes

- **Chips are play chips.** No cash value, no purchases with real money, no
  cash-out. Keep any copy you edit in that spirit (the tests grep for this).
- **Economy dials** live in one place each: `kicker_wallet_limits()` (starter,
  stake bounds, solo payout cap ×25, 50 solo sessions/day), the `cosmetics`
  seed (prices), the `quests` seed (goals/rewards), and `claim_daily()` (pool
  + streak). `tests/consistency.test.js` fails if client copy drifts from the
  SQL.
- **If the game server dies mid-bankroll-game**: unsettled sessions can be
  reclaimed by players via `mp_reclaim()` (24h delay, refunds buy-in only) —
  chips can never be stranded or minted.
- **Solo cash-outs** are client-reported by necessity (solo poker runs in the
  browser) and are bounded server-side: payout ≤ buy-in × 25, 50 sessions/day,
  idempotent settlement. Multiplayer settlement is fully server-computed.
- `user_state` (stats/settings/theme/history sync) is intentionally
  client-writable: it grants nothing — XP/levels/achievements derive from it
  for display only.
