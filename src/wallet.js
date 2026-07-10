// Saved-chips wallet for signed-in players. Every balance change happens in
// SECURITY DEFINER functions on Supabase (see supabase/schema.sql) — this
// module only calls them and reads results. Nothing here (or in localStorage)
// can grant chips: the server validates ownership, clamps payouts, and keeps
// an idempotent ledger.
import { sb } from "./authClient.js";
import { addPending, removePending } from "./wallet-util.js";

const PENDING_KEY = "kicker-pending-settle";
const loadPending = () => { try { const v = JSON.parse(localStorage.getItem(PENDING_KEY)); return Array.isArray(v) ? v : []; } catch { return []; } };
const savePending = q => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(q)); } catch {} };

// Wallet-level rejection codes that make a settle attempt permanently
// unretryable. Anything else (network failure, signed out, transient
// PostgREST errors) keeps the request queued for a later retry.
const FINAL_CODES = new Set(["not_found", "settled"]);

async function rpc(name, args) {
  if (!sb) throw new Error("accounts disabled");
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  if (data?.error) { const e = new Error(data.error); e.walletCode = data.error; e.code = data.error; e.balance = data.balance; throw e; }
  return data;
}

// Current balance (creates the wallet with starter chips on first use).
// Returns a number, or null when accounts are off / signed out.
export async function getBalance() {
  if (!sb) return null;
  try {
    const d = await rpc("wallet_balance");
    return typeof d?.balance === "number" ? d.balance : null;
  } catch { return null; }
}

// Debit the wallet and open a solo bankroll session.
// Returns { sessionId, balance }. Throws with .code on failure.
export async function buyIn(stake) {
  const d = await rpc("solo_buy_in", { stake });
  return { sessionId: d.session_id, balance: d.balance };
}

// Debit one more stake into an open session (cash-game rebuy after busting).
export async function rebuy(sessionId) {
  const d = await rpc("solo_rebuy", { session_id: sessionId });
  return { balance: d.balance, rebuys: d.rebuys };
}

// Settle a session at the reported chip count. Idempotent server-side. On
// network failure the request is queued and retried by flushPending().
export async function cashOut(sessionId, chips, hands) {
  try {
    const d = await rpc("solo_cash_out", { session_id: sessionId, chips: Math.max(0, Math.floor(chips || 0)), hands: hands ?? null });
    savePending(removePending(loadPending(), sessionId));
    return { balance: d.balance, payout: d.payout };
  } catch (e) {
    // Final wallet rejections (not_found, already settled) — don't queue.
    if (FINAL_CODES.has(e?.walletCode)) { savePending(removePending(loadPending(), sessionId)); throw e; }
    savePending(addPending(loadPending(), { sessionId, chips, hands }));
    throw e;
  }
}

// Retry any cash-outs that failed to reach the server. Call on app start /
// sign-in. Returns the latest balance if anything settled, else null.
export async function flushPending() {
  if (!sb) return null;
  let queue = loadPending();
  if (queue.length === 0) return null;
  let balance = null;
  for (const p of queue.slice()) {
    try {
      const d = await rpc("solo_cash_out", { session_id: p.sessionId, chips: p.chips, hands: p.hands });
      balance = d.balance;
      queue = removePending(queue, p.sessionId);
    } catch (e) {
      if (FINAL_CODES.has(e?.walletCode)) queue = removePending(queue, p.sessionId); // final: drop it
      // anything else: keep queued for next launch
    }
  }
  savePending(queue);
  return balance;
}

// Recent wallet activity for the account screen (read-only via RLS).
export async function listLedger(limit = 12) {
  if (!sb) return [];
  const { data, error } = await sb
    .from("wallet_ledger")
    .select("id, delta, balance_after, reason, created_at")
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
