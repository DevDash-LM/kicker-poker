# Deploying a testing version on its own subdomain

This is a recipe for running an isolated **staging** copy of Kicker (e.g.
`staging.kicker.s4lo.lol`) so you can try a change end-to-end before you merge it
to `main` and push to GitHub. It reuses the existing single-container setup
(the Node server serves the built client + WebSocket on one port) and puts a new
Caddy site in front of a second container.

Staging runs **alongside** production and never touches it: its own subdomain,
its own container/port, and — recommended — its own Supabase project so test
accounts and friend data stay separate.

---

## The workflow at a glance

```
cowork-dev worktree  ──build──►  staging container  ──►  staging.kicker.s4lo.lol
        │                                                        │
        │                                                 you test it
        ▼                                                        │
   merge to main  ◄──────────────── looks good ───────────────── ┘
        │
        ▼
   push to GitHub  ──►  production deploy (kicker.s4lo.lol)
```

How you get the code onto the staging machine depends on where it runs. If
staging is a **different** machine, push the cowork branch to GitHub and
clone/pull it there (Step 2). If it's the **same** machine as the worktree, you
can build straight from the worktree and skip GitHub — see the note in Step 2.

---

## 1. (Recommended) a separate Supabase project for staging

Create a second Supabase project — e.g. **kicker-staging** — and:

1. Run `supabase/schema.sql` in it (same as prod).
2. Deploy the email hook and set its secrets, if you want to test branded email:
   ```
   supabase link --project-ref YOUR_STAGING_REF
   supabase functions deploy send-email --no-verify-jwt
   supabase secrets set RESEND_API_KEY=re_xxx \
     KICKER_EMAIL_FROM="Kicker Staging <login@yourdomain.com>" \
     KICKER_PUBLIC_URL=https://staging.kicker.s4lo.lol \
     SEND_EMAIL_HOOK_SECRET="v1,whsec_xxx"
   ```
3. In **Auth → URL Configuration**, add `https://staging.kicker.s4lo.lol` to the
   Site URL / redirect allow-list.

> You *can* point staging at the production Supabase project instead — just be
> aware that test sign-ins, profiles, and friends will live in prod data. A
> separate project is cleaner and free on the Supabase free tier.

Put the staging keys in a **`.env.staging`** file at the repo root (it's already
git-ignored via `.env.*`):

```
VITE_SUPABASE_URL=https://YOUR-STAGING-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-STAGING-ANON-KEY
```

Leaving `.env.staging` blank/absent still works — staging just runs guest-only.

---

## 2. Get the cowork changes onto the staging host (via GitHub)

The staging container builds from a normal checkout, so the task is just to get
the **cowork worktree's branch** onto the staging machine — in its own directory,
separate from any production checkout.

> A Git *worktree* can't be cloned as a worktree by another machine. The worktree
> simply tracks a branch (e.g. `cowork-dev`); the staging host clones the repo and
> checks out that same branch.

### a. Commit & push the branch (from inside the cowork worktree)

```
git branch --show-current            # confirm the branch, e.g. cowork-dev
git add -A
git commit -m "Accounts: sign-in, profiles, friends, room invites"
git push -u origin cowork-dev         # publishes the branch to GitHub (NOT main)
```

### b. First time: clone that branch into a new directory on the staging host

```
git clone -b cowork-dev https://github.com/DevDash-LM/kicker-poker.git kicker-staging
cd kicker-staging
```

Use an SSH URL + deploy key (or a personal access token) if the repo is private.
You now have a clean directory with exactly the cowork changes. Create
`.env.staging` here (Step 1), then build & run (Step 3).

### c. Later: pull new changes and redeploy

Every time you push more commits to the branch from the worktree:

```
cd kicker-staging
git pull                              # or: git fetch && git reset --hard origin/cowork-dev
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
```

**Same-machine shortcut (no GitHub):** if staging runs on the same box as the
worktree, either build straight from the worktree directory, or add a second
linked worktree so the staging checkout is isolated:

```
git worktree add ../kicker-staging cowork-dev
cd ../kicker-staging
```

---

## 3. Build & run the staging container

A ready-made compose file, `docker-compose.staging.yml`, is included. It builds
from the current directory (your staging checkout), bakes in the staging Supabase
env (Vite inlines
`VITE_*` at build time), and publishes a **different** host port (`8788`) so it
can't collide with production's `8787`:

```
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
```

Rebuild after each change you want to test:

```
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
```

Tear it down when you're done:

```
docker compose -f docker-compose.staging.yml down
```

Sanity check the container is serving:

```
curl -s http://127.0.0.1:8788/health   # -> ok
```

---

## 4. Point the subdomain at it (Caddy)

Add a DNS record for the subdomain (an `A`/`AAAA` record for
`staging.kicker.s4lo.lol` pointing at the same host as prod). Then add a Caddy
site block. Caddy will provision HTTPS automatically.

**Which upstream address to use depends on how your Caddy runs** (mirror what the
production `kicker.s4lo.lol` block does):

- **Caddy runs as a container on the same Docker network** as the app (the prod
  block uses the service name, `reverse_proxy kicker:8787`). Use the staging
  service name and its *internal* port:
  ```
  staging.kicker.s4lo.lol {
      encode gzip
      reverse_proxy kicker-staging:8787
  }
  ```
  (Make sure the staging service is attached to the same external network Caddy
  uses — see the note in `docker-compose.staging.yml`.)

- **Caddy runs on the host** (system service) and reaches prod via published
  ports. Use the published staging port on loopback:
  ```
  staging.kicker.s4lo.lol {
      encode gzip
      reverse_proxy 127.0.0.1:8788
  }
  ```

Either way the same block proxies both HTTP and the `/ws` WebSocket — Caddy
upgrades WebSocket connections automatically, so multiplayer works over
`wss://staging.kicker.s4lo.lol/ws` with no extra config. Reload Caddy:

```
caddy reload --config /etc/caddy/Caddyfile   # or: docker exec <caddy> caddy reload ...
```

---

## 5. Keep the test site out of search engines

The app ships SEO tags and a `robots.txt` that point at the production domain.
For a staging subdomain you don't want indexed, add a header in the Caddy block:

```
staging.kicker.s4lo.lol {
    encode gzip
    header X-Robots-Tag "noindex, nofollow"
    reverse_proxy kicker-staging:8787   # or 127.0.0.1:8788
}
```

Optionally protect it behind HTTP basic auth so only you can reach it:

```
    basic_auth {
        tester JDJhJDE0...   # `caddy hash-password` output
    }
```

---

## 6. Test, then promote

Run through the checklist in [ACCOUNTS.md](ACCOUNTS.md#how-to-test) on the
staging URL (sign-in, wrong code, profile edit, friend request, room invite,
sign-out, mobile layout), plus the core game (guest/solo/multiplayer).

When it looks good, merge the worktree into `main` and push:

```
git checkout main
git merge cowork-dev
git push origin main
```

Your production deploy (`kicker.s4lo.lol`) is rebuilt from `main` as usual —
remember it needs the **production** Supabase build args, exactly like staging:

```
docker compose up -d --build            # if prod compose passes the VITE_* args
# or:
docker build \
  --build-arg VITE_SUPABASE_URL=$PROD_URL \
  --build-arg VITE_SUPABASE_ANON_KEY=$PROD_ANON \
  -t kicker .
```

---

## Notes & gotchas

- **`VITE_*` are build-time.** Changing `.env.staging` requires a `--build`, not
  just a restart.
- **PWA cache.** Staging has its own service worker scope, but after a rebuild do
  a hard refresh (or "Update on reload" in DevTools) to skip a stale cached
  bundle.
- **Port choice.** `8788` is arbitrary; use anything free that isn't prod's
  `8787`. Keep the container published on `127.0.0.1` only, so the internet
  reaches it exclusively through Caddy/TLS.
- **Guest-only staging.** No `.env.staging`? Staging still builds and runs — the
  account UI just stays hidden, which is a valid way to test pure game changes.
