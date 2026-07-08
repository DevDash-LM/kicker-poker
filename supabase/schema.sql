-- Kicker — accounts, profiles, friends & room invites
-- Run this in the Supabase SQL editor (or `supabase db push`) for your project.
-- Security model: Row Level Security is ON for every table. A signed-in user can
-- only read/write rows that belong to them. All "acting as someone else" cases
-- are blocked by policy, and the sensitive multi-row operations (befriend by
-- code, accept a request) run through SECURITY DEFINER functions that re-check
-- ownership internally.

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
  base_name := left(regexp_replace(base_name, '[^a-zA-Z0-9 _.-]', '', 'g'), 14);
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
