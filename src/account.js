import { sb, accountsEnabled } from "./authClient.js";

export { accountsEnabled };

// ---- session --------------------------------------------------------------

export async function getUser() {
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data?.user || null;
}

// Subscribe to sign-in / sign-out. Returns an unsubscribe fn.
export function onAuth(cb) {
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session?.user || null));
  return () => data?.subscription?.unsubscribe?.();
}

// ---- email confirmation-code auth -----------------------------------------

// Send a confirmation code to the email. Works for new and returning users.
export async function requestCode(email) {
  if (!sb) throw new Error("accounts disabled");
  const { error } = await sb.auth.signInWithOtp({
    email: String(email).trim(),
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
  return true;
}

// Verify the code and sign the user in. Returns the auth user.
export async function verifyCode(email, code) {
  if (!sb) throw new Error("accounts disabled");
  const { data, error } = await sb.auth.verifyOtp({
    email: String(email).trim(),
    token: String(code).trim(),
    type: "email",
  });
  if (error) throw error;
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
    const base = (user.email || "player").split("@")[0].slice(0, 14) || "Player";
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
  if (display_name != null) patch.display_name = String(display_name).slice(0, 14).trim() || "Player";
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
