import { sb, accountsEnabled } from "./authClient.js";

export { accountsEnabled };

// ---- session --------------------------------------------------------------

export async function getUser() {
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data?.user || null;
}

// Current access token, so the game server can verify signed-in identity on
// room create/join (see server/auth.js). Null when accounts are off or nobody
// is signed in.
export async function getAccessToken() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data?.session?.access_token || null;
}

// Subscribe to sign-in / sign-out. Returns an unsubscribe fn.
export function onAuth(cb) {
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session?.user || null));
  return () => data?.subscription?.unsubscribe?.();
}

// ---- password auth + first-signup email confirmation ----------------------

// Try to sign in with an existing account's password. Returns the auth user on
// success. Throws on bad credentials / unconfirmed email (callers inspect the
// error to decide the next step).
export async function signInWithPassword(email, password) {
  if (!sb) throw new Error("accounts disabled");
  const { data, error } = await sb.auth.signInWithPassword({
    email: String(email).trim(),
    password: String(password),
  });
  if (error) throw error;
  return data.user;
}

// Create a new account with a password. Supabase emails a confirmation code
// (delivered by the send-email hook) that the user enters once to activate.
// Returns { exists } - exists:true means the email already has an account
// (Supabase obfuscates this as a user row with no identities), so no new
// account was made and no code was sent.
export async function signUpWithPassword(email, password) {
  if (!sb) throw new Error("accounts disabled");
  const { data, error } = await sb.auth.signUp({
    email: String(email).trim(),
    password: String(password),
  });
  if (error) throw error;
  const exists = Array.isArray(data?.user?.identities) && data.user.identities.length === 0;
  return { user: data?.user || null, session: data?.session || null, exists };
}

// Re-send the first-signup confirmation code (e.g. it expired or never arrived).
export async function resendSignupCode(email) {
  if (!sb) throw new Error("accounts disabled");
  const { error } = await sb.auth.resend({ type: "signup", email: String(email).trim() });
  if (error) throw error;
  return true;
}

// Verify the first-signup confirmation code and activate + sign in. Returns the
// auth user. `type` defaults to the signup confirmation flow.
export async function verifyCode(email, code, type = "signup") {
  if (!sb) throw new Error("accounts disabled");
  const { data, error } = await sb.auth.verifyOtp({
    email: String(email).trim(),
    token: String(code).trim(),
    type,
  });
  if (error) throw error;
  return data.user;
}

// ---- password reset (same emailed-code hook, "recovery" action) ------------

// Email a recovery code so the user can set a new password.
export async function requestPasswordReset(email) {
  if (!sb) throw new Error("accounts disabled");
  const { error } = await sb.auth.resetPasswordForEmail(String(email).trim());
  if (error) throw error;
  return true;
}

// Verify the recovery code, which opens a short-lived session, then set the new
// password. Returns the auth user (now signed in with the new password).
export async function resetPassword(email, code, newPassword) {
  if (!sb) throw new Error("accounts disabled");
  const { data, error } = await sb.auth.verifyOtp({
    email: String(email).trim(),
    token: String(code).trim(),
    type: "recovery",
  });
  if (error) throw error;
  const { error: upErr } = await sb.auth.updateUser({ password: String(newPassword) });
  if (upErr) throw upErr;
  return data.user;
}

export async function signOut() {
  if (!sb) return;
  await sb.auth.signOut();
}

// ---- profile --------------------------------------------------------------

// Load (and self-heal) the signed-in user's profile.
export async function loadProfile() {
  if (!sb) return null;
  const user = await getUser();
  if (!user) return null;
  let { data, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    // Fallback if the auto-create trigger hasn't run yet.
    const base = (user.email || "player").split("@")[0].slice(0, 21) || "Player";
    const ins = await sb.from("profiles").insert({ id: user.id, display_name: base }).select("*").single();
    if (ins.error) throw ins.error;
    data = ins.data;
  }
  return data;
}

// Update only your own name / emoji. RLS + triggers block editing anyone else
// or changing your friend code.
export async function updateProfile({ display_name, emoji }) {
  if (!sb) throw new Error("accounts disabled");
  const user = await getUser();
  if (!user) throw new Error("not signed in");
  const patch = {};
  if (display_name != null) patch.display_name = String(display_name).slice(0, 21).trim() || "Player";
  if (emoji != null) patch.emoji = emoji;
  const { data, error } = await sb.from("profiles").update(patch).eq("id", user.id).select("*").single();
  if (error) throw error;
  return data;
}

// ---- friends --------------------------------------------------------------

export async function addFriendByCode(code) {
  if (!sb) throw new Error("accounts disabled");
  const { data, error } = await sb.rpc("add_friend_by_code", { code });
  if (error) throw error;
  return data; // status string
}

export async function listFriends() {
  if (!sb) return [];
  const user = await getUser();
  if (!user) return [];
  const { data: rows, error } = await sb
    .from("friendships")
    .select("user_low, user_high")
    .or(`user_low.eq.${user.id},user_high.eq.${user.id}`);
  if (error) throw error;
  const otherIds = rows.map(r => (r.user_low === user.id ? r.user_high : r.user_low));
  if (otherIds.length === 0) return [];
  const { data: profiles, error: e2 } = await sb
    .from("profiles")
    .select("id, display_name, emoji, friend_code")
    .in("id", otherIds);
  if (e2) throw e2;
  return profiles.sort((a, b) => a.display_name.localeCompare(b.display_name));
}

// Pending requests split into incoming / outgoing, each with the other party's
// profile attached.
export async function listRequests() {
  if (!sb) return { incoming: [], outgoing: [] };
  const user = await getUser();
  if (!user) return { incoming: [], outgoing: [] };
  const { data: rows, error } = await sb
    .from("friend_requests")
    .select("id, from_user, to_user, created_at")
    .or(`from_user.eq.${user.id},to_user.eq.${user.id}`);
  if (error) throw error;
  const ids = [...new Set(rows.flatMap(r => [r.from_user, r.to_user]))].filter(id => id !== user.id);
  let byId = {};
  if (ids.length) {
    const { data: profiles } = await sb
      .from("profiles").select("id, display_name, emoji, friend_code").in("id", ids);
    byId = Object.fromEntries((profiles || []).map(p => [p.id, p]));
  }
  const incoming = [], outgoing = [];
  for (const r of rows) {
    if (r.to_user === user.id) incoming.push({ id: r.id, profile: byId[r.from_user] });
    else outgoing.push({ id: r.id, profile: byId[r.to_user] });
  }
  return { incoming, outgoing };
}

export async function acceptRequest(id) {
  if (!sb) throw new Error("accounts disabled");
  const { data, error } = await sb.rpc("accept_friend_request", { request_id: id });
  if (error) throw error;
  return data;
}

export async function declineRequest(id) {
  if (!sb) throw new Error("accounts disabled");
  const { error } = await sb.from("friend_requests").delete().eq("id", id);
  if (error) throw error;
}

export async function removeFriend(otherId) {
  if (!sb) throw new Error("accounts disabled");
  const user = await getUser();
  if (!user) throw new Error("not signed in");
  const lo = user.id < otherId ? user.id : otherId;
  const hi = user.id < otherId ? otherId : user.id;
  const { error } = await sb.from("friendships").delete().eq("user_low", lo).eq("user_high", hi);
  if (error) throw error;
}

// ---- room invites ---------------------------------------------------------

// Host invites accepted friends to a live room code. RLS enforces that you can
// only insert rows where you are the sender AND already friends with each target.
export async function createInvites(roomCode, toUserIds) {
  if (!sb) throw new Error("accounts disabled");
  const user = await getUser();
  if (!user) throw new Error("not signed in");
  const rows = toUserIds.map(to => ({ from_user: user.id, to_user: to, room_code: roomCode }));
  if (rows.length === 0) return [];
  // upsert so re-inviting to the same room is idempotent, not an error.
  const { data, error } = await sb
    .from("room_invites")
    .upsert(rows, { onConflict: "from_user,to_user,room_code" })
    .select("id");
  if (error) throw error;
  return data;
}

export async function listInvites() {
  if (!sb) return [];
  const user = await getUser();
  if (!user) return [];
  const { data: rows, error } = await sb
    .from("room_invites")
    .select("id, from_user, room_code, created_at")
    .eq("to_user", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const ids = [...new Set(rows.map(r => r.from_user))];
  let byId = {};
  if (ids.length) {
    const { data: profiles } = await sb
      .from("profiles").select("id, display_name, emoji").in("id", ids);
    byId = Object.fromEntries((profiles || []).map(p => [p.id, p]));
  }
  return rows.map(r => ({ id: r.id, roomCode: r.room_code, from: byId[r.from_user] || null }));
}

export async function dismissInvite(id) {
  if (!sb) throw new Error("accounts disabled");
  const { error } = await sb.from("room_invites").delete().eq("id", id);
  if (error) throw error;
}

// ---- cloud save (stats / prefs / settings / history) ----------------------

// Read the signed-in user's saved state. Returns null when accounts are off,
// nobody is signed in, or the user has no saved row yet (first sign-in).
export async function loadUserState() {
  if (!sb) return null;
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await sb
    .from("user_state")
    .select("stats, prefs, settings, history")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Upsert the signed-in user's saved state. No-op (returns null) when accounts
// are off or nobody is signed in, so callers can fire it unconditionally.
export async function saveUserState(state) {
  if (!sb) return null;
  const user = await getUser();
  if (!user) return null;
  const row = {
    id: user.id,
    stats: state?.stats ?? {},
    prefs: state?.prefs ?? {},
    settings: state?.settings ?? {},

    history: state?.history ?? [],
  };
  const { data, error } = await sb.from("user_state").upsert(row).select().maybeSingle();
  if (error) throw error;
  return data;
}
