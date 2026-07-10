// Game-server-side wallet operations for bankroll (saved-chips) tables.
//
// Uses the Supabase SERVICE ROLE key — set SUPABASE_SERVICE_ROLE_KEY in the
// server env (never in the client). mp_buy_in / mp_settle are revoked from
// authenticated/anon in the schema, so this server is the only thing that can
// escrow or settle multiplayer chips. If the key isn't configured, bankroll
// tables are simply unavailable and everything else works as before.

const URL_BASE =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const bankrollConfigured = Boolean(URL_BASE && SERVICE_KEY);

const TIMEOUT_MS = 5000;

async function rpc(name, args) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
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

// Escrow a buy-in. Resolves { sessionId, balance } on success,
// { error } on a wallet rejection, or null on network failure.
export async function mpBuyIn(userId, roomCode, stake) {
  if (!bankrollConfigured) return { error: "unavailable" };
  const d = await rpc("mp_buy_in", { uid: userId, room: roomCode, stake });
  if (!d) return null;
  if (d.error) return { error: d.error, balance: d.balance };
  return { sessionId: d.session_id, balance: d.balance };
}

// Settle a session at the server-computed chip count. Idempotent.
// Resolves truthy on success (or already settled), null on network failure.
export async function mpSettle(sessionId, chips) {
  if (!bankrollConfigured) return { error: "unavailable" };
  const d = await rpc("mp_settle", { sid: sessionId, chips: Math.max(0, Math.floor(chips || 0)) });
  if (!d) return null;
  return d;
}
