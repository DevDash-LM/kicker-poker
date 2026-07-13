-- Kicker — self-serve account deletion
-- Run this once in the Supabase SQL editor for your project.
--
-- Adds delete_own_account(): a signed-in user permanently deletes their own
-- account. Deleting the auth.users row cascades to EVERY table keyed on the
-- user id — profiles (and through it friend_requests / friendships /
-- room_invites), user_state, wallets, wallet_ledger, solo_sessions,
-- cosmetic_inventory, cosmetic_equipped, daily_claims, quest_claims and
-- mp_sessions all have `on delete cascade` — so this one delete removes the
-- whole account and all of its data.
--
-- SECURITY DEFINER so it runs as the function owner (which can touch the auth
-- schema); it re-checks auth.uid() internally and only ever deletes the caller,
-- so a browser can never delete anyone else. Revoked from anon: you must be
-- signed in. Safe to re-run.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- Make sure the API layer picks up the new function immediately.
notify pgrst, 'reload schema';
