-- Kicker — SECURITY FIX: stop leaking every user's friend_code
-- Run this once in the Supabase SQL editor for your project. Safe to re-run.
--
-- Background / incident
-- ---------------------
-- The old profiles SELECT policy was:
--     create policy "profiles readable by authenticated"
--       on public.profiles for select to authenticated using (true);
-- `using (true)` let ANY signed-in account read the ENTIRE profiles table,
-- including every user's friend_code. An attacker signed up, renamed themselves
-- "owner", ran `select * from profiles` to harvest every friend_code, then
-- looped add_friend_by_code() to send everyone a friend request. Friend codes
-- are the private handle the friend system is built on, so they must not be
-- world-readable.
--
-- Fix
-- ---
-- Restrict profile reads to: your own row, plus the rows of people you already
-- have a relationship with (accepted friend, a pending request either way, or a
-- room invite either way). No legitimate client flow needs more:
--   * resolving a friend_code -> user happens in add_friend_by_code()
--     (SECURITY DEFINER, bypasses RLS),
--   * the game server uses the service-role key (bypasses RLS),
--   * listFriends / listRequests / listInvites only read profiles of people the
--     caller is already connected to — all still covered below.

drop policy if exists "profiles readable by authenticated" on public.profiles;
drop policy if exists "profiles readable to self and connections" on public.profiles;

create policy "profiles readable to self and connections"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.friendships f
      where (f.user_low = auth.uid() and f.user_high = profiles.id)
         or (f.user_high = auth.uid() and f.user_low = profiles.id)
    )
    or exists (
      select 1 from public.friend_requests r
      where (r.from_user = auth.uid() and r.to_user = profiles.id)
         or (r.to_user = auth.uid() and r.from_user = profiles.id)
    )
    or exists (
      select 1 from public.room_invites i
      where (i.from_user = auth.uid() and i.to_user = profiles.id)
         or (i.to_user = auth.uid() and i.from_user = profiles.id)
    )
  );

-- Reload the API schema cache immediately.
notify pgrst, 'reload schema';
