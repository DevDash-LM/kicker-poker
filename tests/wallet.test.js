import { describe, it, expect } from "vitest";
import {
  walletErrorMessage, ledgerLabel, addPending, removePending,
} from "../src/wallet-util.js";

describe("wallet error copy", () => {
  it("maps every RPC error code to friendly copy", () => {
    for (const code of ["insufficient", "bad_stake", "daily_limit", "not_found", "settled", "unauthorized"]) {
      const msg = walletErrorMessage(code);
      expect(msg).toBeTruthy();
      expect(msg).not.toContain(code); // no raw codes shown to players
    }
  });

  it("falls back to a generic message for unknown codes", () => {
    expect(walletErrorMessage("weird")).toMatch(/try again/i);
    expect(walletErrorMessage(undefined)).toMatch(/try again/i);
  });

  it("never promises cash value", () => {
    for (const code of ["insufficient", "bad_stake", "daily_limit", undefined]) {
      expect(walletErrorMessage(code).toLowerCase()).not.toMatch(/money|cash|\$|usd/);
    }
  });
});

describe("ledger labels", () => {
  it("labels the known reasons", () => {
    expect(ledgerLabel("starter")).toBe("Welcome chips");
    expect(ledgerLabel("solo_buyin")).toBe("Table buy-in");
    expect(ledgerLabel("solo_rebuy")).toBe("Rebuy");
    expect(ledgerLabel("solo_cashout")).toBe("Cashed out table");
  });

  it("passes through unknown reasons instead of crashing", () => {
    expect(ledgerLabel("future_reason")).toBe("future_reason");
    expect(ledgerLabel(null)).toBe("Adjustment");
  });
});

describe("pending cash-out queue", () => {
  it("adds a settle request once, keyed by session", () => {
    let q = addPending([], { sessionId: "a", chips: 1200, hands: 7 });
    q = addPending(q, { sessionId: "a", chips: 9999 }); // duplicate ignored
    expect(q).toHaveLength(1);
    expect(q[0]).toEqual({ sessionId: "a", chips: 1200, hands: 7 });
  });

  it("normalizes chip counts to non-negative integers", () => {
    expect(addPending([], { sessionId: "x", chips: -500 })[0].chips).toBe(0);
    expect(addPending([], { sessionId: "y", chips: 10.9 })[0].chips).toBe(10);
    expect(addPending([], { sessionId: "z" })[0].chips).toBe(0);
  });

  it("ignores malformed items and malformed queues", () => {
    expect(addPending(null, { sessionId: "a", chips: 1 })).toHaveLength(1);
    expect(addPending([], {})).toHaveLength(0);
    expect(addPending([], null)).toHaveLength(0);
  });

  it("removes by session id and tolerates junk", () => {
    const q = addPending(addPending([], { sessionId: "a", chips: 1 }), { sessionId: "b", chips: 2 });
    expect(removePending(q, "a").map(p => p.sessionId)).toEqual(["b"]);
    expect(removePending(null, "a")).toEqual([]);
  });

  it("caps the queue so localStorage can't grow unbounded", () => {
    let q = [];
    for (let i = 0; i < 40; i++) q = addPending(q, { sessionId: `s${i}`, chips: i });
    expect(q.length).toBeLessThanOrEqual(20);
  });
});
