// Server-side account verification for table-code rooms.
//
// The client may attach its Supabase access token to `create` / `join`. We
// confirm the token with Supabase (GET /auth/v1/user) and, if valid, read the
// account's profile row — so the name/emoji shown at the table for a signed-in
// player comes from their *verified* account, not from whatever the client
// typed. A member is only marked as an account when this round-trip succeeds.
//
// Fail-open to guest, never to error: a missing/expired/forged token, a
// network hiccup, or an unconfigured server all just mean "treat this player
// as a guest". Guest play must keep working exactly as before.
//
// Env: SUPABASE_URL / SUPABASE_ANON_KEY (falls back to the VITE_-prefixed
// client vars for local dev, where both live in the same .env).

const URL_BASE =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

export const accountsConfigured = Boolean(URL_BASE && ANON_KEY);

const TIMEOUT_MS = 3500;

async function supaGet(path, token) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${URL_BASE}${path}`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Verify a Supabase access token. Resolves to { id, name, emoji, friendCode }
// for a valid signed-in user (profile fields may be null if the row is
// missing), or null for anything else. Never throws.
// friendCode is included so tablemates can add each other as friends straight
// from the room — it's a shareable invite code by design, not a secret.
export async function verifyAccount(token) {
  if (!accountsConfigured) return null;
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) return null;
  const user = await supaGet("/auth/v1/user", token);
  const id = user?.id;
  if (typeof id !== "string" || !id) return null;
  // Read the profile with the user's own token — RLS allows any authenticated
  // user to read profiles (names/emoji/friend codes, nothing sensitive).
  const rows = await supaGet(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=display_name,emoji,friend_code`,
    token
  );
  const p = Array.isArray(rows) ? rows[0] : null;
  return { id, name: p?.display_name ?? null, emoji: p?.emoji ?? null, friendCode: p?.friend_code ?? null };
}
