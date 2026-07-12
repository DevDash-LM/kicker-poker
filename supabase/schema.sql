-- Kicker — accounts, profiles, friends & room invites
-- Run this in the Supabase SQL editor (or `supabase db push`) for your project.
-- Security model: Row Level Security is ON for every table. A signed-in user can
-- only read/write rows that belong to them. All "acting as someone else" cases
-- are blocked by policy, and the sensitive multi-row operations (befriend by
-- code, accept a request) run through SECURITY DEFINER functions that re-check
-- ownership internally.
--
-- Safe to re-run: every statement is idempotent (create-if-not-exists, drop-then-
-- create policies, upsert seeds). The cosmetics RPCs explicitly drop any stale
-- overloads before recreating, so an earlier signature can never linger and make
-- the function call ambiguous to the API layer.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Short, unambiguous friend code (no O/0/I/1/etc). 8 chars over a 30-symbol
-- alphabet ~= 6.5e11 codes.
create or replace function public.kicker_gen_friend_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where friend_code = code);
  end loop;
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player',
  emoji        text not null default '🙂',
  friend_code  text not null unique default public.kicker_gen_friend_code(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone signed in can read profiles (needed to show a friend's name/emoji).
-- Only names, emoji and friend codes live here — nothing sensitive.
drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- A user may create only their own profile row.
drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- A user may edit only their own profile.
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile the first time a user signs in.
create or replace function public.kicker_handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base_name text;
begin
  base_name := split_part(coalesce(new.email, 'player'), '@', 1);
  base_name := left(regexp_replace(base_name, '[^a-zA-Z0-9 _.-]', '', 'g'), 21);
  if base_name = '' then base_name := 'Player'; end if;
  insert into public.profiles (id, display_name)
  values (new.id, base_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.kicker_handle_new_user();

-- Keep updated_at fresh.
create or replace function public.kicker_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.kicker_touch_updated_at();

-- Prevent friend_code / id tampering on update (defence in depth alongside RLS).
create or replace function public.kicker_lock_immutable()
returns trigger language plpgsql as $$
begin
  new.friend_code := old.friend_code;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end;
$$;
drop trigger if exists profiles_lock on public.profiles;
create trigger profiles_lock before update on public.profiles
  for each row execute function public.kicker_lock_immutable();

-- ---------------------------------------------------------------------------
-- friend_requests (pending only — deleted on accept/decline)
-- ---------------------------------------------------------------------------
create table if not exists public.friend_requests (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references public.profiles (id) on delete cascade,
  to_user    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint no_self_request check (from_user <> to_user),
  unique (from_user, to_user)
);

alter table public.friend_requests enable row level security;

drop policy if exists "see own requests" on public.friend_requests;
create policy "see own requests"
  on public.friend_requests for select
  to authenticated
  using (auth.uid() = from_user or auth.uid() = to_user);

drop policy if exists "send as self" on public.friend_requests;
create policy "send as self"
  on public.friend_requests for insert
  to authenticated
  with check (auth.uid() = from_user);

drop policy if exists "delete own request" on public.friend_requests;
create policy "delete own request"
  on public.friend_requests for delete
  to authenticated
  using (auth.uid() = from_user or auth.uid() = to_user);

-- ---------------------------------------------------------------------------
-- friendships (accepted). One row per pair, stored with user_low < user_high
-- so a pair can never be duplicated.
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  user_low   uuid not null references public.profiles (id) on delete cascade,
  user_high  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint ordered_pair check (user_low < user_high)
);

alter table public.friendships enable row level security;

drop policy if exists "see own friendships" on public.friendships;
create policy "see own friendships"
  on public.friendships for select
  to authenticated
  using (auth.uid() = user_low or auth.uid() = user_high);

-- Direct writes are not allowed; friendships are only created via the
-- accept_friend_request() function below (SECURITY DEFINER). Deletion (unfriend)
-- is allowed for either party.
drop policy if exists "delete own friendship" on public.friendships;
create policy "delete own friendship"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = user_low or auth.uid() = user_high);

-- ---------------------------------------------------------------------------
-- room_invites (host invites a friend to a live room code)
-- ---------------------------------------------------------------------------
create table if not exists public.room_invites (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references public.profiles (id) on delete cascade,
  to_user    uuid not null references public.profiles (id) on delete cascade,
  room_code  text not null check (room_code ~ '^[A-Z]{5}$'),
  created_at timestamptz not null default now(),
  constraint no_self_invite check (from_user <> to_user),
  unique (from_user, to_user, room_code)
);

alter table public.room_invites enable row level security;

drop policy if exists "see own invites" on public.room_invites;
create policy "see own invites"
  on public.room_invites for select
  to authenticated
  using (auth.uid() = from_user or auth.uid() = to_user);

-- Only invite people you are already friends with, and only as yourself.
drop policy if exists "invite friends as self" on public.room_invites;
create policy "invite friends as self"
  on public.room_invites for insert
  to authenticated
  with check (
    auth.uid() = from_user
    and exists (
      select 1 from public.friendships f
      where f.user_low = least(from_user, to_user)
        and f.user_high = greatest(from_user, to_user)
    )
  );

drop policy if exists "delete own invite" on public.room_invites;
create policy "delete own invite"
  on public.room_invites for delete
  to authenticated
  using (auth.uid() = from_user or auth.uid() = to_user);

-- ---------------------------------------------------------------------------
-- accept_friend_request(id): only the recipient may accept. Creates the
-- friendship and removes the request atomically.
-- ---------------------------------------------------------------------------
create or replace function public.accept_friend_request(request_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  r public.friend_requests%rowtype;
begin
  if me is null then return 'unauthorized'; end if;
  select * into r from public.friend_requests where id = request_id;
  if not found then return 'not_found'; end if;
  if r.to_user <> me then return 'forbidden'; end if;
  insert into public.friendships (user_low, user_high)
  values (least(r.from_user, r.to_user), greatest(r.from_user, r.to_user))
  on conflict do nothing;
  delete from public.friend_requests where id = request_id;
  return 'accepted';
end;
$$;

-- ---------------------------------------------------------------------------
-- add_friend_by_code(code): send a request to the owner of a friend code.
-- Runs as definer so it can resolve a code without exposing a code->id oracle,
-- but re-checks that the caller acts only as themselves.
-- ---------------------------------------------------------------------------
create or replace function public.add_friend_by_code(code text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  target uuid;
  pending uuid;
begin
  if me is null then return 'unauthorized'; end if;
  code := upper(trim(code));
  select id into target from public.profiles where friend_code = code;
  if target is null then return 'not_found'; end if;
  if target = me then return 'self'; end if;
  if exists (
    select 1 from public.friendships
    where user_low = least(me, target) and user_high = greatest(me, target)
  ) then
    return 'already_friends';
  end if;
  select id into pending from public.friend_requests where from_user = target and to_user = me;
  if pending is not null then
    perform public.accept_friend_request(pending);
    return 'accepted';
  end if;
  if exists (select 1 from public.friend_requests where from_user = me and to_user = target) then
    return 'already_sent';
  end if;
  insert into public.friend_requests (from_user, to_user) values (me, target);
  return 'sent';
end;
$$;

grant execute on function public.add_friend_by_code(text) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- user_state: per-account cloud save for lifetime stats, theme/preferences,
-- game settings and recent hand history. One row per user. This is what makes
-- progress and preferences follow the account across devices. Everything here
-- is private to the owner — no one else can read or write it.
-- ---------------------------------------------------------------------------
create table if not exists public.user_state (
  id         uuid primary key references auth.users (id) on delete cascade,
  stats      jsonb not null default '{}'::jsonb,   -- lifetime stats totals
  prefs      jsonb not null default '{}'::jsonb,   -- { dark: bool, ... }
  settings   jsonb not null default '{}'::jsonb,   -- blinds/stack/ai/etc.
  history    jsonb not null default '[]'::jsonb,   -- recent hand log
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

-- Owner-only read.
drop policy if exists "read own state" on public.user_state;
create policy "read own state"
  on public.user_state for select
  to authenticated
  using (auth.uid() = id);

-- Owner-only insert (id must be yourself).
drop policy if exists "insert own state" on public.user_state;
create policy "insert own state"
  on public.user_state for insert
  to authenticated
  with check (auth.uid() = id);

-- Owner-only update.
drop policy if exists "update own state" on public.user_state;
create policy "update own state"
  on public.user_state for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Keep updated_at fresh on every write.
drop trigger if exists user_state_touch on public.user_state;
create trigger user_state_touch before update on public.user_state
  for each row execute function public.kicker_touch_updated_at();

-- ===========================================================================
-- Wallet: saved play chips for signed-in players (Phase 2)
--
-- Trust model: the browser can NEVER write a balance. There are no insert/
-- update policies on wallets, wallet_ledger, or solo_sessions — every change
-- goes through the SECURITY DEFINER functions below, which validate ownership,
-- clamp amounts, and record a ledger row with a reason. Solo poker is played
-- client-side, so the cash-out amount is client-reported by necessity; the
-- functions bound the damage (payout capped to a multiple of the buy-in,
-- daily session limit, idempotent settlement) rather than pretend the client
-- is trustworthy. Chips are play chips only — no cash value, no cash-out to
-- money of any kind.
-- ===========================================================================

-- Tunables live in one place so limits are easy to audit/adjust.
create or replace function public.kicker_wallet_limits()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'starter',        25000,      -- chips granted once on first wallet use
    'min_stake',      500,        -- matches the app's table stack bounds
    'max_stake',      1000000,
    'payout_cap_x',   25,         -- max cash-out = buy-in total * this
    'daily_sessions', 50          -- max solo buy-ins per user per 24h
  );
$$;

-- ---------------------------------------------------------------------------
-- wallets — one row per user, server-authoritative balance.
-- ---------------------------------------------------------------------------
create table if not exists public.wallets (
  id         uuid primary key references auth.users (id) on delete cascade,
  balance    bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wallets enable row level security;

-- Owner can read their balance. No insert/update/delete policies on purpose:
-- only the definer functions below may write.
drop policy if exists "read own wallet" on public.wallets;
create policy "read own wallet"
  on public.wallets for select
  to authenticated
  using (auth.uid() = id);

drop trigger if exists wallets_touch on public.wallets;
create trigger wallets_touch before update on public.wallets
  for each row execute function public.kicker_touch_updated_at();

-- ---------------------------------------------------------------------------
-- wallet_ledger — every balance change, with a reason and an idempotency ref.
-- unique (user_id, reason, ref) means a retried/duplicated action can never
-- award or debit twice.
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  delta         bigint not null,
  balance_after bigint not null,
  reason        text not null,
  ref           text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, reason, ref)
);

alter table public.wallet_ledger enable row level security;

drop policy if exists "read own ledger" on public.wallet_ledger;
create policy "read own ledger"
  on public.wallet_ledger for select
  to authenticated
  using (auth.uid() = user_id);

create index if not exists wallet_ledger_user_recent
  on public.wallet_ledger (user_id, id desc);

-- ---------------------------------------------------------------------------
-- solo_sessions — one row per bankroll table. Buy-in debits up front (so an
-- abandoned table can only ever cost the player, never mint chips), cash-out
-- settles once, idempotently.
-- ---------------------------------------------------------------------------
create table if not exists public.solo_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  stake       bigint not null,
  buyin_total bigint not null,
  rebuys      int not null default 0,
  status      text not null default 'open' check (status in ('open', 'settled')),
  payout      bigint,
  hands       int,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz
);

alter table public.solo_sessions enable row level security;

drop policy if exists "read own sessions" on public.solo_sessions;
create policy "read own sessions"
  on public.solo_sessions for select
  to authenticated
  using (auth.uid() = user_id);

create index if not exists solo_sessions_user_day
  on public.solo_sessions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- wallet_balance(): read (and lazily create) the caller's wallet. First call
-- grants the starter chips exactly once (ledger ref 'starter' is unique).
-- ---------------------------------------------------------------------------
create or replace function public.wallet_balance()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.kicker_wallet_limits();
  bal bigint;
begin
  if me is null then return jsonb_build_object('error', 'unauthorized'); end if;
  select balance into bal from public.wallets where id = me;
  if bal is null then
    insert into public.wallets (id, balance)
    values (me, (lim->>'starter')::bigint)
    on conflict (id) do nothing;
    select balance into bal from public.wallets where id = me;
    insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref)
    values (me, (lim->>'starter')::bigint, bal, 'starter', 'starter')
    on conflict (user_id, reason, ref) do nothing;
  end if;
  return jsonb_build_object('balance', bal);
end;
$$;

-- ---------------------------------------------------------------------------
-- solo_buy_in(stake): debit the wallet and open a solo session. The debit
-- happens before any cards are dealt, so abandoning a table never profits.
-- ---------------------------------------------------------------------------
create or replace function public.solo_buy_in(stake bigint)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.kicker_wallet_limits();
  bal bigint;
  sid uuid;
  today_count int;
begin
  if me is null then return jsonb_build_object('error', 'unauthorized'); end if;
  if stake is null or stake < (lim->>'min_stake')::bigint or stake > (lim->>'max_stake')::bigint then
    return jsonb_build_object('error', 'bad_stake');
  end if;

  select count(*) into today_count from public.solo_sessions
  where user_id = me and created_at > now() - interval '24 hours';
  if today_count >= (lim->>'daily_sessions')::int then
    return jsonb_build_object('error', 'daily_limit');
  end if;

  -- Ensure the wallet exists, then lock it for the debit.
  perform public.wallet_balance();
  select balance into bal from public.wallets where id = me for update;
  if bal < stake then return jsonb_build_object('error', 'insufficient', 'balance', bal); end if;

  update public.wallets set balance = balance - stake where id = me returning balance into bal;
  insert into public.solo_sessions (user_id, stake, buyin_total)
  values (me, stake, stake) returning id into sid;
  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref)
  values (me, -stake, bal, 'solo_buyin', sid::text);

  return jsonb_build_object('session_id', sid, 'balance', bal);
end;
$$;

-- ---------------------------------------------------------------------------
-- solo_rebuy(session): debit one more stake into an open session (cash-game
-- rebuy after busting). Ledger ref includes the rebuy number so each rebuy is
-- individually idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.solo_rebuy(session_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  s public.solo_sessions%rowtype;
  bal bigint;
begin
  if me is null then return jsonb_build_object('error', 'unauthorized'); end if;
  select * into s from public.solo_sessions where id = session_id for update;
  if not found or s.user_id <> me then return jsonb_build_object('error', 'not_found'); end if;
  if s.status <> 'open' then return jsonb_build_object('error', 'settled'); end if;

  select balance into bal from public.wallets where id = me for update;
  if bal is null or bal < s.stake then return jsonb_build_object('error', 'insufficient', 'balance', coalesce(bal, 0)); end if;

  update public.wallets set balance = balance - s.stake where id = me returning balance into bal;
  update public.solo_sessions
  set buyin_total = buyin_total + s.stake, rebuys = rebuys + 1
  where id = s.id;
  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref)
  values (me, -s.stake, bal, 'solo_rebuy', s.id::text || ':' || (s.rebuys + 1)::text);

  return jsonb_build_object('balance', bal, 'rebuys', s.rebuys + 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- solo_cash_out(session, chips, hands): settle a session exactly once.
-- chips is client-reported (solo poker runs in the browser) and is clamped to
-- [0, buy-in total * payout cap]. Calling again returns the recorded result
-- without moving chips — refresh/retry can never double-award.
-- ---------------------------------------------------------------------------
create or replace function public.solo_cash_out(session_id uuid, chips bigint, hands int default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.kicker_wallet_limits();
  s public.solo_sessions%rowtype;
  bal bigint;
  amount bigint;
begin
  if me is null then return jsonb_build_object('error', 'unauthorized'); end if;
  select * into s from public.solo_sessions where id = session_id for update;
  if not found or s.user_id <> me then return jsonb_build_object('error', 'not_found'); end if;

  if s.status = 'settled' then
    select balance into bal from public.wallets where id = me;
    return jsonb_build_object('balance', coalesce(bal, 0), 'payout', s.payout, 'already_settled', true);
  end if;

  amount := greatest(0, least(coalesce(chips, 0), s.buyin_total * (lim->>'payout_cap_x')::bigint));

  select balance into bal from public.wallets where id = me for update;
  update public.wallets set balance = balance + amount where id = me returning balance into bal;
  update public.solo_sessions
  set status = 'settled', payout = amount, hands = solo_cash_out.hands, settled_at = now()
  where id = s.id;
  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref)
  values (me, amount, bal, 'solo_cashout', s.id::text);

  return jsonb_build_object('balance', bal, 'payout', amount);
end;
$$;

grant execute on function public.wallet_balance() to authenticated;
grant execute on function public.solo_buy_in(bigint) to authenticated;
grant execute on function public.solo_rebuy(uuid) to authenticated;
grant execute on function public.solo_cash_out(uuid, bigint, int) to authenticated;

-- ===========================================================================
-- Cosmetics: catalog, inventory, equipped (Phase 3)
--
-- Same trust model as the wallet: the catalog (ids, prices, availability) is
-- server-defined, ownership rows are only written by shop_purchase(), and
-- equipped slots are only written by equip_cosmetic() after an ownership
-- check. Purchases debit the saved-chips wallet through the same ledger
-- (reason 'shop_purchase', ref = item id → buying twice is impossible).
-- Visual definitions (colors/patterns) live in the client, keyed by item id —
-- they're presentation only, so nothing sensitive depends on them.
-- ===========================================================================

create table if not exists public.cosmetics (
  id     text primary key,
  type   text not null check (type in ('cardback', 'chips', 'felt')),
  name   text not null,
  tier   text not null default 'common' check (tier in ('default', 'common', 'rare', 'epic')),
  price  bigint not null default 0 check (price >= 0),
  active boolean not null default true,
  sort   int not null default 0
);

alter table public.cosmetics enable row level security;

-- Catalog is public (guests may preview the shop before signing in).
drop policy if exists "catalog readable" on public.cosmetics;
create policy "catalog readable"
  on public.cosmetics for select
  to anon, authenticated
  using (active);

-- Seed / upsert the launch catalog. Prices are play chips (starter grant is
-- 25,000). Default items cost 0 and are always equippable without owning.
-- on-conflict also re-activates a row so a previously-hidden item reappears.
insert into public.cosmetics (id, type, name, tier, price, sort) values
  ('cb-classic',  'cardback', 'Kicker Classic', 'default',     0, 0),
  ('cb-crimson',  'cardback', 'Crimson',        'common',   4000, 1),
  ('cb-emerald',  'cardback', 'Emerald',        'common',   4000, 2),
  ('cb-royal',    'cardback', 'Royal',          'rare',    12000, 3),
  ('cb-carbon',   'cardback', 'Carbon',         'rare',    12000, 4),
  ('cb-midnight', 'cardback', 'Midnight Gold',  'epic',    30000, 5),
  ('ch-classic',  'chips',    'Classic Blue',   'default',     0, 0),
  ('ch-jade',     'chips',    'Jade',           'common',   3000, 1),
  ('ch-ruby',     'chips',    'Ruby',           'common',   3000, 2),
  ('ch-gold',     'chips',    'Gold',           'rare',     9000, 3),
  ('ch-onyx',     'chips',    'Onyx',           'epic',    20000, 4),
  ('ft-classic',  'felt',     'Clean Slate',    'default',     0, 0),
  ('ft-green',    'felt',     'Casino Green',   'common',   5000, 1),
  ('ft-navy',     'felt',     'Deep Navy',      'common',   5000, 2),
  ('ft-burgundy', 'felt',     'Burgundy',       'rare',    14000, 3),
  ('ft-onyx',     'felt',     'Onyx',           'epic',    25000, 4)
on conflict (id) do update
  set name = excluded.name, tier = excluded.tier, price = excluded.price,
      sort = excluded.sort, type = excluded.type, active = true;

-- ---------------------------------------------------------------------------
-- cosmetic_inventory — what a user owns. Written only by shop_purchase().
-- ---------------------------------------------------------------------------
create table if not exists public.cosmetic_inventory (
  user_id     uuid not null references auth.users (id) on delete cascade,
  item_id     text not null references public.cosmetics (id),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.cosmetic_inventory enable row level security;

drop policy if exists "read own inventory" on public.cosmetic_inventory;
create policy "read own inventory"
  on public.cosmetic_inventory for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- cosmetic_equipped — one item per slot. Written only by equip_cosmetic().
-- ---------------------------------------------------------------------------
create table if not exists public.cosmetic_equipped (
  user_id uuid not null references auth.users (id) on delete cascade,
  slot    text not null check (slot in ('cardback', 'chips', 'felt')),
  item_id text not null references public.cosmetics (id),
  primary key (user_id, slot)
);

alter table public.cosmetic_equipped enable row level security;

drop policy if exists "read own equipped" on public.cosmetic_equipped;
create policy "read own equipped"
  on public.cosmetic_equipped for select
  to authenticated
  using (auth.uid() = user_id);

-- Drop any stale overloads of the two cosmetics RPCs before recreating them,
-- so the API layer never has two candidates to choose between (which would make
-- every purchase/equip fail). create-or-replace alone does NOT remove overloads.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('equip_cosmetic', 'shop_purchase')
  loop
    execute 'drop function ' || r.sig || ' cascade';
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- shop_purchase(item): debit the wallet, grant the item. Idempotent — owning
-- it already (or the ledger unique key) makes double-buying impossible.
-- ---------------------------------------------------------------------------
create or replace function public.shop_purchase(item text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.cosmetics%rowtype;
  bal bigint;
begin
  if me is null then return jsonb_build_object('error', 'unauthorized'); end if;
  select * into c from public.cosmetics where id = item and active;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if c.price <= 0 then return jsonb_build_object('error', 'not_for_sale'); end if;
  if exists (select 1 from public.cosmetic_inventory where user_id = me and item_id = c.id) then
    select balance into bal from public.wallets where id = me;
    return jsonb_build_object('balance', coalesce(bal, 0), 'already_owned', true);
  end if;

  perform public.wallet_balance();
  select balance into bal from public.wallets where id = me for update;
  if bal < c.price then return jsonb_build_object('error', 'insufficient', 'balance', bal); end if;

  update public.wallets set balance = balance - c.price where id = me returning balance into bal;
  insert into public.cosmetic_inventory (user_id, item_id) values (me, c.id)
  on conflict do nothing;
  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref)
  values (me, -c.price, bal, 'shop_purchase', c.id);

  return jsonb_build_object('balance', bal, 'item_id', c.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- equip_cosmetic(slot, item): equip an owned (or default/free) item, or pass
-- null to clear the slot back to the default look.
--
-- NOTE: the parameter `slot` shares its name with the cosmetic_equipped.slot
-- column. PL/pgSQL runs with variable_conflict = error, so an UNQUALIFIED `slot`
-- (in INSERT ... VALUES and in ON CONFLICT) is rejected as ambiguous (SQLSTATE
-- 42702) and the call 400s. Two things keep this correct: the
-- `#variable_conflict use_column` directive makes the bare `slot` in the ON
-- CONFLICT target resolve to the COLUMN, and every PARAMETER reference is
-- qualified as equip_cosmetic.slot / equip_cosmetic.item.
-- ---------------------------------------------------------------------------
create or replace function public.equip_cosmetic(slot text, item text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  c public.cosmetics%rowtype;
begin
  if me is null then return jsonb_build_object('error', 'unauthorized'); end if;
  if equip_cosmetic.slot not in ('cardback', 'chips', 'felt') then
    return jsonb_build_object('error', 'bad_slot');
  end if;

  -- Clear the slot back to the default look.
  if equip_cosmetic.item is null then
    delete from public.cosmetic_equipped ce
      where ce.user_id = me
        and ce.slot = equip_cosmetic.slot;
    return jsonb_build_object('slot', equip_cosmetic.slot, 'item_id', null);
  end if;

  select * into c
    from public.cosmetics cm
    where cm.id = equip_cosmetic.item
      and cm.active;
  if not found or c.type <> equip_cosmetic.slot then
    return jsonb_build_object('error', 'not_found');
  end if;

  if c.price > 0 and not exists (
    select 1 from public.cosmetic_inventory ci
      where ci.user_id = me
        and ci.item_id = c.id
  ) then
    return jsonb_build_object('error', 'not_owned');
  end if;

  insert into public.cosmetic_equipped as ce (user_id, slot, item_id)
  values (me, equip_cosmetic.slot, c.id)
  on conflict (user_id, slot) do update set item_id = excluded.item_id;

  return jsonb_build_object('slot', equip_cosmetic.slot, 'item_id', c.id);
end;
$$;

grant execute on function public.shop_purchase(text) to authenticated;
grant execute on function public.equip_cosmetic(text, text) to authenticated;

-- ===========================================================================
-- Daily reward + quests (Phase 4)
--
-- Daily reward = "draw a card": the SERVER picks the card and the amount
-- (the client only animates the reveal), records it in daily_claims with a
-- (user, date) primary key, and credits the wallet through the same ledger.
-- Claiming twice on the same UTC day is structurally impossible. Quest
-- rewards are small fixed amounts from a server-defined quest list, claimable
-- once per quest per day (progress is tracked client-side — solo poker runs
-- in the browser — so quests follow the same bounded-trust model as solo
-- cash-outs: tiny rewards, hard once-a-day server cap). XP, levels, and
-- achievements are DERIVED from lifetime stats client-side and grant no
-- currency, so they need no trusted storage at all.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- daily_claims — one row per user per UTC day.
-- ---------------------------------------------------------------------------
create table if not exists public.daily_claims (
  user_id    uuid not null references auth.users (id) on delete cascade,
  claim_date date not null default current_date,
  card_rank  int not null check (card_rank between 2 and 14),
  card_suit  int not null check (card_suit between 0 and 3),
  amount     bigint not null,
  streak     int not null default 1,
  created_at timestamptz not null default now(),
  primary key (user_id, claim_date)
);

alter table public.daily_claims enable row level security;

drop policy if exists "read own daily claims" on public.daily_claims;
create policy "read own daily claims"
  on public.daily_claims for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- claim_daily(): draw today's card, pay chips, exactly once per UTC day.
-- Pool (shown to players in the app): 2–9 → 1,000 · 10–K → 2,500 · A → 5,000,
-- plus 250 per consecutive day already on the streak (capped at +1,750).
-- ---------------------------------------------------------------------------
create or replace function public.claim_daily()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  today date := current_date;
  r int; su int;
  base bigint; bonus bigint; amt bigint;
  stk int;
  bal bigint;
begin
  if me is null then return jsonb_build_object('error', 'unauthorized'); end if;
  if exists (select 1 from public.daily_claims where user_id = me and claim_date = today) then
    return jsonb_build_object('error', 'claimed');
  end if;

  -- Streak: yesterday's claim extends it, otherwise start over at 1.
  select coalesce((select streak from public.daily_claims
                   where user_id = me and claim_date = today - 1), 0) + 1
  into stk;

  r  := 2 + floor(random() * 13)::int;   -- 2..14 (14 = ace)
  su := floor(random() * 4)::int;        -- 0..3
  base  := case when r = 14 then 5000 when r >= 10 then 2500 else 1000 end;
  bonus := least(stk - 1, 7) * 250;
  amt   := base + bonus;

  -- The (user, date) primary key makes a double-claim race impossible; the
  -- ledger's unique ref is the backstop for the credit itself.
  insert into public.daily_claims (user_id, claim_date, card_rank, card_suit, amount, streak)
  values (me, today, r, su, amt, stk);

  perform public.wallet_balance();
  update public.wallets set balance = balance + amt where id = me returning balance into bal;
  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref)
  values (me, amt, bal, 'daily', today::text);

  return jsonb_build_object(
    'card_rank', r, 'card_suit', su, 'amount', amt,
    'streak', stk, 'balance', bal, 'claim_date', today
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- quests — server-defined daily quest list (ids, goals, rewards).
-- ---------------------------------------------------------------------------
create table if not exists public.quests (
  id     text primary key,
  name   text not null,
  goal   int not null check (goal > 0),
  reward bigint not null check (reward > 0),
  active boolean not null default true,
  sort   int not null default 0
);

alter table public.quests enable row level security;

drop policy if exists "quests readable" on public.quests;
create policy "quests readable"
  on public.quests for select
  to anon, authenticated
  using (active);

insert into public.quests (id, name, goal, reward, sort) values
  ('q-hands5',    'Play 5 hands',                      5,  750, 0),
  ('q-win2',      'Win 2 hands',                       2, 1000, 1),
  ('q-showdown3', 'Reach showdown 3 times',            3,  750, 2),
  ('q-bighand',   'Win a showdown with two pair or better', 1, 1000, 3)
on conflict (id) do update
  set name = excluded.name, goal = excluded.goal,
      reward = excluded.reward, sort = excluded.sort;

-- ---------------------------------------------------------------------------
-- quest_claims — one claim per user per quest per UTC day.
-- ---------------------------------------------------------------------------
create table if not exists public.quest_claims (
  user_id    uuid not null references auth.users (id) on delete cascade,
  quest_id   text not null references public.quests (id),
  claim_date date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (user_id, quest_id, claim_date)
);

alter table public.quest_claims enable row level security;

drop policy if exists "read own quest claims" on public.quest_claims;
create policy "read own quest claims"
  on public.quest_claims for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- claim_quest(quest): pay a quest's fixed reward, once per UTC day.
-- ---------------------------------------------------------------------------
create or replace function public.claim_quest(quest text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  q public.quests%rowtype;
  bal bigint;
begin
  if me is null then return jsonb_build_object('error', 'unauthorized'); end if;
  select * into q from public.quests where id = quest and active;
  if not found then return jsonb_build_object('error', 'not_found'); end if;

  begin
    insert into public.quest_claims (user_id, quest_id) values (me, q.id);
  exception when unique_violation then
    return jsonb_build_object('error', 'claimed');
  end;

  perform public.wallet_balance();
  update public.wallets set balance = balance + q.reward where id = me returning balance into bal;
  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref)
  values (me, q.reward, bal, 'quest', q.id || ':' || current_date::text);

  return jsonb_build_object('quest_id', q.id, 'amount', q.reward, 'balance', bal);
end;
$$;

grant execute on function public.claim_daily() to authenticated;
grant execute on function public.claim_quest(text) to authenticated;

-- ===========================================================================
-- Multiplayer bankroll tables (Phase 5)
--
-- Unlike solo tables, multiplayer chips are computed by the GAME SERVER
-- (server-authoritative poker), so settlement here is fully trusted. The game
-- server holds the service-role key and is the only caller of mp_buy_in /
-- mp_settle: both functions are revoked from authenticated/anon, so no
-- browser can ever call them. Buy-ins are escrowed (debited) before the
-- player is seated; settlement is idempotent per session.
-- mp_reclaim() is the one user-callable function: it refunds the BUY-IN of a
-- session left open for 24h+ (a crashed game server), never any winnings —
-- so chips can't be stranded and a refund can never profit.
-- ===========================================================================

create table if not exists public.mp_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  room_code   text not null,
  stake       bigint not null,
  buyin_total bigint not null,
  status      text not null default 'open' check (status in ('open', 'settled')),
  payout      bigint,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz
);

alter table public.mp_sessions enable row level security;

drop policy if exists "read own mp sessions" on public.mp_sessions;
create policy "read own mp sessions"
  on public.mp_sessions for select
  to authenticated
  using (auth.uid() = user_id);

create index if not exists mp_sessions_user
  on public.mp_sessions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- mp_buy_in(uid, room, stake) — SERVICE ROLE ONLY. Escrow a buy-in.
-- ---------------------------------------------------------------------------
create or replace function public.mp_buy_in(uid uuid, room text, stake bigint)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  lim jsonb := public.kicker_wallet_limits();
  bal bigint;
  sid uuid;
begin
  if uid is null then return jsonb_build_object('error', 'unauthorized'); end if;
  if stake is null or stake < (lim->>'min_stake')::bigint or stake > (lim->>'max_stake')::bigint then
    return jsonb_build_object('error', 'bad_stake');
  end if;

  -- Ensure the wallet exists (starter grant), then lock and debit.
  insert into public.wallets (id, balance)
  values (uid, (lim->>'starter')::bigint)
  on conflict (id) do nothing;
  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref)
  select uid, (lim->>'starter')::bigint, (lim->>'starter')::bigint, 'starter', 'starter'
  on conflict (user_id, reason, ref) do nothing;

  select balance into bal from public.wallets where id = uid for update;
  if bal < stake then return jsonb_build_object('error', 'insufficient', 'balance', bal); end if;

  update public.wallets set balance = balance - stake where id = uid returning balance into bal;
  insert into public.mp_sessions (user_id, room_code, stake, buyin_total)
  values (uid, upper(coalesce(room, '?')), stake, stake) returning id into sid;
  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref)
  values (uid, -stake, bal, 'mp_buyin', sid::text);

  return jsonb_build_object('session_id', sid, 'balance', bal);
end;
$$;

-- ---------------------------------------------------------------------------
-- mp_settle(sid, chips) — SERVICE ROLE ONLY. Idempotent settlement at the
-- server-computed chip count.
-- ---------------------------------------------------------------------------
create or replace function public.mp_settle(sid uuid, chips bigint)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.mp_sessions%rowtype;
  bal bigint;
  amount bigint;
begin
  select * into s from public.mp_sessions where id = sid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if s.status = 'settled' then
    return jsonb_build_object('payout', s.payout, 'already_settled', true);
  end if;

  amount := greatest(0, coalesce(chips, 0));

  update public.wallets set balance = balance + amount where id = s.user_id returning balance into bal;
  update public.mp_sessions set status = 'settled', payout = amount, settled_at = now() where id = s.id;
  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref)
  values (s.user_id, amount, bal, 'mp_cashout', s.id::text);

  return jsonb_build_object('payout', amount, 'balance', bal);
end;
$$;

-- Service role only: no grants to authenticated/anon for the escrow pair.
revoke execute on function public.mp_buy_in(uuid, text, bigint) from public, anon, authenticated;
revoke execute on function public.mp_settle(uuid, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- mp_reclaim(sid): user-callable safety valve. If the game server crashed
-- before settling, refund the buy-in (never winnings) after 24 hours.
-- ---------------------------------------------------------------------------
create or replace function public.mp_reclaim(sid uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  s public.mp_sessions%rowtype;
  bal bigint;
begin
  if me is null then return jsonb_build_object('error', 'unauthorized'); end if;
  select * into s from public.mp_sessions where id = sid for update;
  if not found or s.user_id <> me then return jsonb_build_object('error', 'not_found'); end if;
  if s.status = 'settled' then return jsonb_build_object('error', 'settled'); end if;
  if s.created_at > now() - interval '24 hours' then return jsonb_build_object('error', 'too_soon'); end if;

  update public.wallets set balance = balance + s.buyin_total where id = me returning balance into bal;
  update public.mp_sessions set status = 'settled', payout = s.buyin_total, settled_at = now() where id = s.id;
  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref)
  values (me, s.buyin_total, bal, 'mp_reclaim', s.id::text);

  return jsonb_build_object('balance', bal, 'refunded', s.buyin_total);
end;
$$;

grant execute on function public.mp_reclaim(uuid) to authenticated;

-- Make sure the API layer picks up any function/signature changes immediately.
notify pgrst, 'reload schema';
