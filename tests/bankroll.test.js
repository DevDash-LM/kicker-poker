import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { createServer } from "../server/index.js";
import { mergeRecentPlayers } from "../src/account-util.js";

// ---- fake bank + fake account verification --------------------------------
// The wallet ops and verifyAccount are injectable, so these tests exercise
// the whole escrow/settle lifecycle without Supabase.
const accounts = {
  "token-rich-user": { id: "uid-rich", name: "Rich", emoji: "😎", friendCode: "RICHCODE" },
  "token-poor-user": { id: "uid-poor", name: "Poor", emoji: "🤠", friendCode: "POORCODE" },
};
const balances = { "uid-rich": 100000, "uid-poor": 100 };
const sessions = new Map();
let sessionSeq = 0;
const settleCalls = [];

const walletOps = {
  configured: true,
  async buyIn(userId, room, stake) {
    if (balances[userId] == null) return { error: "unauthorized" };
    if (balances[userId] < stake) return { error: "insufficient", balance: balances[userId] };
    balances[userId] -= stake;
    const sid = `sess-${++sessionSeq}`;
    sessions.set(sid, { userId, stake, status: "open" });
    return { sessionId: sid, balance: balances[userId] };
  },
  async settle(sid, chips) {
    settleCalls.push({ sid, chips });
    const s = sessions.get(sid);
    if (!s) return { error: "not_found" };
    if (s.status === "settled") return { payout: s.payout, already_settled: true };
    s.status = "settled"; s.payout = chips;
    balances[s.userId] += chips;
    return { payout: chips, balance: balances[s.userId] };
  },
};

const verifyAccount = async token => accounts[token] || null;

let srv, port;
beforeAll(() => { srv = createServer(0, { verifyAccount, walletOps }); port = srv.port(); });
afterAll(() => srv.close());

class TestClient {
  constructor(id) {
    this.id = id;
    this.msgs = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on("message", d => this.msgs.push(JSON.parse(d)));
  }
  async open() {
    await new Promise(res => this.ws.on("open", res));
    this.send({ type: "hello", proto: 1, deviceId: this.id });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async next(pred, timeout = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const i = this.msgs.findIndex(pred);
      if (i >= 0) return this.msgs.splice(i, 1)[0];
      await new Promise(r => setTimeout(r, 15));
    }
    throw new Error("timeout waiting for message");
  }
  close() { this.ws.close(); }
}

describe("bankroll rooms", () => {
  it("escrows the host's buy-in, exposes friend codes, and settles exactly once on leave", async () => {
    const a = new TestClient("device-bank-0001");
    await a.open(); await a.next(m => m.type === "hello_ok");

    const before = balances["uid-rich"];
    a.send({ type: "create", auth: "token-rich-user", profile: { name: "ignored" },
      config: { sb: 50, bb: 100, stack: 10000, bankroll: true } });
    const room = await a.next(m => m.type === "room");
    expect(room.config.bankroll).toBe(true);
    expect(balances["uid-rich"]).toBe(before - 10000);           // escrowed
    expect(room.members[0].account).toBe(true);
    expect(room.members[0].friendCode).toBe("RICHCODE");         // table social
    expect(room.members[0].name).toBe("Rich");                   // pinned identity

    const callsBefore = settleCalls.length;
    a.send({ type: "leave" });
    await a.next(m => m.type === "ended");
    await new Promise(r => setTimeout(r, 100));
    expect(balances["uid-rich"]).toBe(before);                   // full refund pre-game
    expect(settleCalls.length).toBe(callsBefore + 1);            // settled exactly once
    a.close();
  }, 15000);

  it("rejects guests and insufficient balances with clear errors", async () => {
    const host = new TestClient("device-bank-0002");
    await host.open(); await host.next(m => m.type === "hello_ok");
    host.send({ type: "create", auth: "token-rich-user", config: { stack: 10000, bankroll: true } });
    const room = await host.next(m => m.type === "room");

    const guest = new TestClient("device-bank-0003");
    await guest.open(); await guest.next(m => m.type === "hello_ok");
    guest.send({ type: "join", code: room.code, profile: { name: "Randy" } });
    const err1 = await guest.next(m => m.type === "error");
    expect(err1.msg).toMatch(/sign in/i);

    const poor = new TestClient("device-bank-0004");
    await poor.open(); await poor.next(m => m.type === "hello_ok");
    poor.send({ type: "join", code: room.code, auth: "token-poor-user" });
    const err2 = await poor.next(m => m.type === "error");
    expect(err2.msg).toMatch(/not enough/i);

    host.send({ type: "leave" });
    await host.next(m => m.type === "ended");
    host.close(); guest.close(); poor.close();
  }, 15000);

  it("locks bankroll room config and never flips practice rooms to bankroll", async () => {
    const a = new TestClient("device-bank-0005");
    await a.open(); await a.next(m => m.type === "hello_ok");
    a.send({ type: "create", auth: "token-rich-user", config: { stack: 10000, bankroll: true } });
    const room = await a.next(m => m.type === "room");

    a.send({ type: "config", config: { ...room.config, stack: 500000 } });
    await new Promise(r => setTimeout(r, 150));
    expect(a.msgs.filter(m => m.type === "room" && m.config.stack === 500000).length).toBe(0);
    a.send({ type: "leave" }); await a.next(m => m.type === "ended"); a.close();

    // practice room: config changes work but bankroll stays off
    const b = new TestClient("device-bank-0006");
    await b.open(); await b.next(m => m.type === "hello_ok");
    b.send({ type: "create", profile: { name: "Casual" }, config: { stack: 10000 } });
    const r2 = await b.next(m => m.type === "room");
    expect(r2.config.bankroll).toBe(false);
    b.send({ type: "config", config: { ...r2.config, stack: 25000, bankroll: true } });
    const r3 = await b.next(m => m.type === "room" && m.config.stack === 25000);
    expect(r3.config.bankroll).toBe(false);
    b.send({ type: "leave" }); await b.next(m => m.type === "ended"); b.close();
  }, 15000);

  it("settles both players at their real stacks when a game ends", async () => {
    const a = new TestClient("device-bank-0007");
    const b = new TestClient("device-bank-0008");
    await a.open(); await b.open();
    await a.next(m => m.type === "hello_ok");
    await b.next(m => m.type === "hello_ok");

    const richBefore = balances["uid-rich"];
    balances["uid-poor"] = 50000; // fund the second seat for this test
    const poorBefore = balances["uid-poor"];

    a.send({ type: "create", auth: "token-rich-user", config: { sb: 50, bb: 100, stack: 10000, bankroll: true } });
    const room = await a.next(m => m.type === "room");
    b.send({ type: "join", code: room.code, auth: "token-poor-user" });
    await b.next(m => m.type === "room");
    b.send({ type: "ready", ready: true });
    await a.next(m => m.type === "room" && m.canStart);
    a.send({ type: "start" });

    const st = await a.next(m => m.type === "state");
    // whoever's turn it is folds; the hand ends, then both leave
    const onTurn = st.game.turn === 0 ? a : b;
    onTurn.send({ type: "act", action: { type: "fold" } });
    const over = await a.next(m => m.type === "state" && m.game.stage === "over");
    const stacks = Object.fromEntries(over.game.players.map(p => [p.name, p.chips]));

    a.send({ type: "leave" }); await a.next(m => m.type === "ended");
    b.send({ type: "leave" }); await b.next(m => m.type === "ended");
    await new Promise(r => setTimeout(r, 150));

    // Total chips conserved: what the two wallets gained/lost nets to zero.
    expect(balances["uid-rich"] - richBefore).toBe(stacks["Rich"] - 10000);
    expect(balances["uid-poor"] - poorBefore).toBe(stacks["Poor"] - 10000);
    a.close(); b.close();
  }, 20000);
});

describe("recent players", () => {
  it("dedupes by friend code, excludes you, newest first, capped", () => {
    const members = [
      { name: "Rich", emoji: "😎", account: true, friendCode: "RICHCODE", you: false },
      { name: "Me", emoji: "🙂", account: true, friendCode: "MYCODE", you: true },
      { name: "Guest", emoji: "🤠", account: false, friendCode: null, you: false },
    ];
    let list = mergeRecentPlayers([], members, 1000);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Rich", friendCode: "RICHCODE" });

    // re-seeing the same player updates, not duplicates
    list = mergeRecentPlayers(list, members, 2000);
    expect(list).toHaveLength(1);
    expect(list[0].ts).toBe(2000);

    // cap
    let big = [];
    for (let i = 0; i < 20; i++) {
      big = mergeRecentPlayers(big, [{ name: `P${i}`, emoji: "🙂", account: true, friendCode: `CODE${i}`, you: false }], i);
    }
    expect(big.length).toBeLessThanOrEqual(12);
    expect(big[0].name).toBe("P19"); // newest first

    // junk in storage
    expect(mergeRecentPlayers("junk", members, 1)).toHaveLength(1);
    expect(mergeRecentPlayers(null, null)).toEqual([]);
  });
});
