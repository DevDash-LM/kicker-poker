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
  if (msg.includes("credential") || (msg.includes("password") && (msg.includes("match") || msg.includes("incorrect"))))
    return "That email or password didn’t match. Check them, or reset your password.";
  if (msg.includes("password") && (msg.includes("least") || msg.includes("weak") || msg.includes("short") || msg.includes("character")))
    return "Choose a stronger password — at least 8 characters.";
  if (msg.includes("not confirmed") || msg.includes("not been confirmed"))
    return "Confirm your email first — enter the code we sent you.";
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

// Minimum password length. Kept here so the UI and any tests agree.
export const MIN_PASSWORD = 8;

// Returns a friendly problem string if the password is too weak, else null.
export function passwordProblem(pw) {
  const s = String(pw || "");
  if (s.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  return null;
}

// Merge verified tablemates (players with a friend code you shared a table with)
// into the locally-remembered "recent players" list. Dedupes by friend code,
// excludes yourself, stamps each with the merge time, keeps the newest first
// and caps the list. Robust to junk/missing inputs (returns []).
export const RECENT_PLAYERS_CAP = 12;
export function mergeRecentPlayers(existing, members, ts = Date.now()) {
  const byCode = new Map();
  if (Array.isArray(existing)) {
    for (const p of existing) {
      if (p && p.friendCode) {
        byCode.set(p.friendCode, { friendCode: p.friendCode, name: p.name, emoji: p.emoji, ts: p.ts ?? 0 });
      }
    }
  }
  if (Array.isArray(members)) {
    for (const m of members) {
      if (m && m.friendCode && !m.you) {
        byCode.set(m.friendCode, { friendCode: m.friendCode, name: m.name, emoji: m.emoji, ts });
      }
    }
  }
  return [...byCode.values()].sort((a, b) => b.ts - a.ts).slice(0, RECENT_PLAYERS_CAP);
}
