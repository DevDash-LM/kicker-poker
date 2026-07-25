-- Kicker — verified badge + admin approval
-- Run this once in the Supabase SQL editor for your project. Safe to re-run.
--
-- Adds a verified badge that ONLY an admin can grant. Trust model matches the
-- rest of the app (wallets/cosmetics): the badge table has no insert/update/
-- delete policies, so no browser can write it — every change goes through the
-- admin-gated set_verified() SECURITY DEFINER function. Admins themselves are
-- added only from here / the SQL editor, never through the app.
--
-- This migration also (re)creates the profiles read policy to add an admin
-- bypass, so it is consistent whether or not you already ran
-- 2026-07-24_lock_down_profiles_read.sql.

-- ---------------------------------------------------------------------------
-- admins — who may grant/revoke verification. No write policies (SQL editor /
-- service role only). A user may read only their own admin row.
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id  uuid primary key references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;

drop policy if exists "read own admin row" on public.admins;
create policy "read own admin row"
  on public.admins for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- verified_users — the badge. Written only by set_verified(). Read open to any
-- signed-in user (a badge is meant to be seen).
-- ---------------------------------------------------------------------------
create table if not exists public.verified_users (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz not null default now()
);
alter table public.verified_users enable row level security;

drop policy if exists "verified badges readable" on public.verified_users;
create policy "verified badges readable"
  on public.verified_users for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- profiles read policy — self + relationships + admin bypass (so the admin
-- tools can look up who to verify). Supersedes the earlier lock-down policy.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles readable by authenticated" on public.profiles;
drop policy if exists "profiles readable to self and connections" on public.profiles;
create policy "profiles readable to self and connections"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (select 1 from public.friendships f
               where (f.user_low = auth.uid() and f.user_high = profiles.id)
                  or (f.user_high = auth.uid() and f.user_low = profiles.id))
    or exists (select 1 from public.friend_requests r
               where (r.from_user = auth.uid() and r.to_user = profiles.id)
                  or (r.to_user = auth.uid() and r.from_user = profiles.id))
    or exists (select 1 from public.room_invites i
               where (i.from_user = auth.uid() and i.to_user = profiles.id)
                  or (i.to_user = auth.uid() and i.from_user = profiles.id))
    or exists (select 1 from public.admins a where a.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- set_verified(target, value): ADMIN ONLY. Grant/revoke the badge by user id.
-- ---------------------------------------------------------------------------
create or replace function public.set_verified(target uuid, value boolean default true)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return 'unauthorized'; end if;
  if not exists (select 1 from public.admins where user_id = me) then return 'forbidden'; end if;
  if not exists (select 1 from public.profiles where id = target) then return 'not_found'; end if;
  if coalesce(value, true) then
    insert into public.verified_users (user_id, verified_by)
    values (target, me)
    on conflict (user_id) do nothing;
    return 'verified';
  else
    delete from public.verified_users where user_id = target;
    return 'unverified';
  end if;
end;
$$;

-- set_verified_by_code(code, value): ADMIN ONLY. Resolve the target by friend
-- code so you can verify someone from the code they share with you.
create or replace function public.set_verified_by_code(code text, value boolean default true)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  target uuid;
begin
  if me is null then return 'unauthorized'; end if;
  if not exists (select 1 from public.admins where user_id = me) then return 'forbidden'; end if;
  select id into target from public.profiles where friend_code = upper(trim(code));
  if target is null then return 'not_found'; end if;
  return public.set_verified(target, value);
end;
$$;

revoke execute on function public.set_verified(uuid, boolean) from public, anon;
revoke execute on function public.set_verified_by_code(text, boolean) from public, anon;
grant execute on function public.set_verified(uuid, boolean) to authenticated;
grant execute on function public.set_verified_by_code(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed YOU as the first admin and mark you verified. Change the email if your
-- account uses a different one. (Requires that you have signed in at least once
-- so the auth.users + profiles rows exist.)
-- ---------------------------------------------------------------------------
insert into public.admins (user_id)
select id from auth.users where email = 'lucamargani1234@gmail.com'
on conflict do nothing;

insert into public.verified_users (user_id, verified_by)
select id, id from auth.users where email = 'lucamargani1234@gmail.com'
on conflict (user_id) do nothing;

-- Reload the API schema cache immediately.
notify pgrst, 'reload schema';
