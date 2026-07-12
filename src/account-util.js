// Pure, dependency-free helpers for the account layer. Kept separate from
// account.js (which talks to Supabase) so they can be unit-tested in Node.

// Friend-code alphabet mirrors supabase/schema.sql: no I, O, 0 or 1.
export const FRIEND_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

export function normalizeFriendCode(s) {
  return String(s || "").toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 8);
}
export function isValidFriendCode(s) {
  return FRIEND_CODE_RE.test(normalizeFriendCode(s));
}

// Display a code as 4-4 for readability without changing its value.
export function prettyFriendCode(s) {
  const c = normalizeFriendCode(s);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

// Turn a raw Supabase/auth error into player-friendly copy. We never surface
// raw provider text to the player.
export function authErrorMessage(err) {
  if (!err) return "Something went wrong. Please try again.";
  const msg = String(err.message || err.error_description || err.msg || "").toLowerCase();
  const status = err.status || err.code;
  if (msg.includes("rate") || status === 429 || msg.includes("too many") || msg.includes("only request"))
    return "Too many attempts. Please wait a minute and try again.";
  if (msg.includes("expired"))
    return "That code has expired. Tap “Resend code” for a fresh one.";
  if (msg.includes("invalid") || msg.includes("otp") || msg.includes("token") || status === 401 || status === 403)
    return "That code didn’t work. Double-check it and try again.";
  if (msg.includes("email") && (msg.includes("invalid") || msg.includes("valid")))
    return "That email doesn’t look right. Please check it.";
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed to"))
    return "Can’t reach the sign-in service. Check your connection.";
  return "Something went wrong. Please try again.";
}

// Map add_friend_by_code() status codes to friendly copy + success flag.
const ADD_FRIEND = {
  sent:           { ok: true,  message: "Friend request sent." },
  accepted:       { ok: true,  message: "You’re now friends!" },
  self:           { ok: false, message: "That’s your own friend code." },
  not_found:      { ok: false, message: "No player found with that code." },
  already_friends:{ ok: false, message: "You’re already friends." },
  already_sent:   { ok: false, message: "You’ve already sent them a request." },
  unauthorized:   { ok: false, message: "Please sign in first." },
};
export function addFriendMessage(status) {
  return ADD_FRIEND[status] || { ok: false, message: "Couldn’t add that friend. Try again." };
}

// Basic email shape check (client-side friendliness only; real validation is
// done by the auth provider).
export function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

// ---- recent players ---------------------------------------------------------
// Verified tablemates seen in multiplayer rooms, kept locally so you can add
// them as friends later. Pure merge so it's easy to test: dedupes by friend
// code, excludes yourself, newest first, capped.

export const RECENT_PLAYERS_MAX = 12;

export function mergeRecentPlayers(existing, members, now = Date.now()) {
  const base = Array.isArray(existing) ? existing.filter(p => p && p.friendCode) : [];
  const seen = (Array.isArray(members) ? members : [])
    .filter(m => m && m.friendCode && m.account && !m.you)
    .map(m => ({ name: String(m.name || "Player").slice(0, 14), emoji: m.emoji || "🙂", friendCode: m.friendCode, ts: now }));
  const byCode = new Map();
  for (const p of [...seen, ...base]) {
    if (!byCode.has(p.friendCode)) byCode.set(p.friendCode, p);
  }
  return [...byCode.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, RECENT_PLAYERS_MAX);
}
