# Kicker Accounts

Optional accounts for Kicker: email confirmation-code sign-in, player profiles,
friends, and friend-to-friend room invites. Built on **Supabase** (Auth +
Postgres + an Edge Function for branded emails). The existing Node WebSocket
server stays **gameplay-only** — it was not touched.

**Accounts are strictly additive.** With no Supabase env vars set, the account
layer stays dormant and Kicker behaves exactly as before: guest play, solo play,
and multiplayer create/join all work with the local device identity. Nothing in
the account layer can crash the game.

---

## What was added

- **Email confirmation-code sign-in** (`signInWithOtp` / `verifyOtp`). New and
  returning users get a 6-digit code by email and type it into the app.
- **Player profiles** — display name, emoji avatar, and a shareable 8-character
  friend code. Auto-created on first sign-in; editable by the owner only.
- **Branded confirmation email** — a Supabase *Send Email* auth hook renders
  Kicker's dark/minimal email (with logo) and sends it via Resend.
- **Friends** — add by friend code, send/accept/decline requests, view friends.
- **Room invites** — a signed-in host can invite accepted friends from the lobby;
  invitees see incoming invites on the *Play online* screen and join with the
  existing room-code flow.
- Signed-in identity (name + emoji) is reused for online play and invites.
- **Verified table identity** — on room create/join the client attaches its
  Supabase access token; the game server verifies it (`server/auth.js`) and
  pins the member's name/emoji to the **account profile**, ignoring whatever
  the client typed. Verified members carry an `account: true` flag in room
  snapshots and show a small ✓ badge in the lobby. Any verification failure
  falls back to guest — guest play is untouched.

### Files

| File | Purpose |
|------|---------|
| `supabase/schema.sql` | Tables, Row Level Security policies, and `SECURITY DEFINER` functions. Run once per project. |
| `supabase/functions/send-email/index.ts` | Send Email auth hook (Deno). Verifies the hook signature, renders the branded email, sends via Resend. |
| `supabase/functions/send-email/email-template.js` | Pure email renderer (HTML + text). Shared with the test suite. |
| `src/authClient.js` | Creates the Supabase client from env; `accountsEnabled` flag. Null when unconfigured. |
| `src/account.js` | Account API: auth, profile, friends, invites. |
| `src/account-util.js` | Pure helpers (friend-code formatting, friendly error messages). Unit-tested. |
| `src/account-ui.jsx` | `SignInModal`, `AccountScreen`, `InviteFriends`, `IncomingInvites`. |
| `src/App.jsx` | Wiring only — home entry, online invites, lobby invite section, auth token on create/join. |
| `server/auth.js` | Game-server-side token verification: confirms the access token with Supabase and reads the account profile. Fail-open to guest. |
| `tests/account.test.js` | Tests for the email template and account utils. |

---

## Setup

### 1. Create a Supabase project
Create a project at <https://supabase.com>. Note the **Project URL** and the
**anon public** key (Project Settings → API).

### 2. Apply the schema
Open the SQL editor and run `supabase/schema.sql` (or `supabase db push` with the
CLI). This creates `profiles`, `friend_requests`, `friendships`, `room_invites`,
all RLS policies, and the friend helper functions.

### 3. Configure the client env
Copy `.env.example` to `.env` (or `.env.local`) and set:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

The anon key is **meant to be public** — Row Level Security is what protects the
data. Never put the `service_role` key in the client env.

### 4. Confirmation-code email (branded)

Supabase can email a 6-digit code out of the box, but to send Kicker-branded
email use the Send Email hook:

1. Get a Resend API key at <https://resend.com> and verify your sending domain.
2. Deploy the function:
   ```
   supabase functions deploy send-email --no-verify-jwt
   ```
3. Set the function secrets:
   ```
   supabase secrets set RESEND_API_KEY=re_xxx
   supabase secrets set KICKER_EMAIL_FROM="Kicker <login@yourdomain.com>"
   supabase secrets set KICKER_PUBLIC_URL=https://kicker.example.com
   ```
4. In the dashboard: **Auth → Hooks → Send Email** → enable. Choose the **HTTPS**
   hook type and set the URL to your deployed function (Supabase sends an HTTPS
   POST here for every auth email):
   ```
   https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/send-email
   ```
   `<YOUR-PROJECT-REF>` is the subdomain of your `VITE_SUPABASE_URL`
   (Project Settings → General → Reference ID). Then copy the generated signing
   secret and store it so the function can verify the request:
   ```
   supabase secrets set SEND_EMAIL_HOOK_SECRET="v1,whsec_xxxxx"
   ```

If `RESEND_API_KEY` is unset the hook logs the code to the function logs instead
of sending — handy for local testing. If `SEND_EMAIL_HOOK_SECRET` is unset the
signature check is skipped (dev only; always set it in production).

> Make sure "Confirm email" / OTP sign-in is enabled and email confirmations are
> on in **Auth → Providers → Email**. Enable "Email OTP" so codes (not just magic
> links) are issued.

### 5. Email deliverability
Kicker's confirmation email is deliberately non-transactional-sales in tone and
contains **no gambling or real-money wording** (no cash, bets, payouts, or
purchases), which keeps it clear of spam heuristics for that category. Keep any
edits to `email-template.js` in the same spirit.

---

## Local development

```
npm install
npm run dev        # client (Vite) on :5173, proxies /ws to the game server
npm run server     # multiplayer game server on :8787 (separate terminal)
```

- Without Supabase env vars: the app runs guest-only. The "Sign in" button and
  account UI simply don't appear.
- With env vars set: sign-in works against your Supabase project. For codes
  without configuring Resend, read them from the Supabase **Auth logs** (or the
  `send-email` function logs if the hook is enabled).

Restart `npm run dev` after changing `.env` (Vite reads env at startup).

---

## Production deployment

The Node server serves the built client, so **the Supabase env must be present at
build time** (Vite inlines `VITE_*`). With Docker:

```
docker build \
  --build-arg VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY \
  -t kicker .
```

The Edge Function and its secrets live in Supabase (deployed via the CLI, step 4)
— they are never part of the container image and never reach the browser.

Add your production origin to **Auth → URL Configuration** (Site URL / redirect
allow-list) in Supabase.

To stand up an isolated **testing** copy on its own subdomain before promoting
a change to production, see [STAGING.md](STAGING.md).

---

## How to test

**Sign-in**
1. Open Kicker → *Sign in to Kicker* → enter your email → *Send me a code*.
2. Read the code from your inbox (or Auth/function logs in dev) → enter it → *Sign in*.
3. A wrong code shows "That code didn't work…" (no raw error). *Resend code* is
   rate-limited with a 30s countdown.

**Profile**
1. Home → *Account*. Change the display name / avatar → *Save profile*.
2. Reload: the change persists. Your friend code is shown and copyable.
3. RLS test (optional): with the anon key, a query updating another user's row
   returns zero rows / is rejected.

**Friends**
1. Sign in as two users (two browsers). Copy user A's friend code.
2. User B: Account → *Add a friend* → paste A's code → "Friend request sent."
3. User A: Account → *Friend requests* → *Accept*. Both now list each other.
4. Decline and duplicate/self-add cases show friendly messages and are blocked
   server-side.

**Room invites**
1. User A (host): *Play online* → *Create a table* → in the lobby, *Invite
   friends* → select B → *Invite*.
2. User B: *Play online* → *Room invites* shows A's invite → *Join* → lands in
   the lobby via the normal room-code flow.

**Sign out**: Account → *Sign out* returns you to guest mode; guest play still works.

**Mobile**: all account screens use the app's responsive layout (max-width
column, safe-area padding, 16px inputs to avoid iOS zoom).

Automated coverage: `npm test` runs `tests/account.test.js` (email template
branding/safety/no-gambling wording, friend-code utils, error-message mapping)
alongside the existing engine/server suites.

---

## Security model

- **RLS on every table.** A user can only read/write rows that reference their own
  `auth.uid()`.
- **Profiles**: readable by any signed-in user (names/emoji/friend codes only —
  nothing sensitive); a user can insert/update only their own row, and triggers
  prevent changing `id`, `friend_code`, or `created_at`.
- **Friend requests**: you can only insert as the sender; only the recipient can
  accept (enforced inside `accept_friend_request`).
- **Friendships**: never written directly — only created by the definer function
  on accept, stored as an ordered pair so duplicates are impossible.
- **Room invites**: you can only insert as yourself AND only for someone you're
  already friends with; only sender/recipient can see or delete them.
- The client only ever holds the **anon** key; secrets (Resend, hook secret) live
  in Supabase Edge Function secrets.
- Guest data stays entirely local (localStorage) as before.

**Game server (table codes)**

- A member is only marked as a signed-in account after the server confirms the
  access token with Supabase (`GET /auth/v1/user`) and reads the profile row.
  The client-typed name/emoji are **ignored** for verified members, so nobody
  can wear another account's identity at the table — the ✓ badge and the name
  behind it always come from the verified profile.
- Verification **fails open to guest**, never to an error: forged/expired
  tokens, timeouts (3.5s), or a server without `SUPABASE_URL` /
  `SUPABASE_ANON_KEY` (see `docker-compose.yml`) all mean "treat as guest".
  Old clients that send no token behave exactly as before.
- The room session itself is still keyed by the local `deviceId` (reconnects,
  turn ownership, host powers). The account layer adds *display identity and
  its verification* on top; it does not replace the device session.

---

## Known limitations / intentionally deferred

- Room invites are delivered by a light 15s poll on the *Play online* screen
  (plus on-open fetch). Real-time push is deferred.
- No unfriend button in the UI yet (the API + RLS `removeFriend` exists).
- Profiles are minimal by design: **no** saved chips, wallet, shop, cosmetics,
  rankings, presence, chat, public profiles, or blocking — deferred to later
  phases as specified.
- The Supabase client (~120 KB gz) is bundled for everyone; lazy-loading it for
  guests is a possible future optimization.
- Email delivery, hook signing, and OTP settings require the external Supabase +
  Resend configuration above; those cannot be exercised by the offline test
  suite and must be verified against a real project.
- Account identity at the table is **display-level only**: game actions, seats,
  and host powers stay keyed to `deviceId`. If accounts ever gate anything
  sensitive (persistent chips, rankings), re-key sessions to the verified
  account id and re-verify tokens on reconnect, not just on create/join.
- The token is verified once at create/join; a session revoked mid-game keeps
  its badge until the room ends. Acceptable for display identity.
- Verification adds one Supabase round-trip to create/join (hard 3.5s cap on
  the game server); the profile is read with the player's own token under RLS,
  so the game server needs no service-role key.
