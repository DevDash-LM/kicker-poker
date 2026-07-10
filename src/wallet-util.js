// Pure wallet helpers — no Supabase imports so they are trivially unit-testable
// (same pattern as account-util.js).

// Friendly copy for wallet RPC error codes returned by the SQL functions.
export function walletErrorMessage(code) {
  switch (code) {
    case "insufficient": return "Not enough saved chips for that buy-in.";
    case "bad_stake":    return "That stake isn’t allowed.";
    case "daily_limit":  return "You’ve hit today’s table limit. Come back tomorrow.";
    case "not_found":    return "That table session wasn’t found.";
    case "settled":      return "That table was already cashed out.";
    case "unauthorized": return "Sign in to use saved chips.";
    default:              return "Something went wrong with your wallet. Try again.";
  }
}

// Human label for a ledger row's reason.
export function ledgerLabel(reason) {
  switch (reason) {
    case "starter":      return "Welcome chips";
    case "solo_buyin":   return "Table buy-in";
    case "solo_rebuy":   return "Rebuy";
    case "solo_cashout": return "Cashed out table";
    default:              return reason || "Adjustment";
  }
}

// ---- pending cash-out queue (pure state transitions) -----------------------
// If a cash-out RPC fails (offline, tab closed mid-flight), the settle request
// is queued and retried on next launch. This is safe to keep client-side:
// the server only settles sessions that exist, belong to the caller, and are
// still open — and settling is idempotent — so a tampered queue can't mint
// chips beyond the server's own clamps.

export function addPending(queue, item) {
  const q = Array.isArray(queue) ? queue : [];
  if (!item?.sessionId) return q;
  if (q.some(p => p.sessionId === item.sessionId)) return q;
  return [...q, { sessionId: item.sessionId, chips: Math.max(0, Math.floor(item.chips || 0)), hands: item.hands ?? null }].slice(-20);
}

export function removePending(queue, sessionId) {
  return (Array.isArray(queue) ? queue : []).filter(p => p.sessionId !== sessionId);
}
