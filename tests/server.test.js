import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { createServer } from "../server/index.js";

let srv, port;
beforeAll(() => { srv = createServer(0); port = srv.port(); });
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

describe("multiplayer server", () => {
  it("runs a two-player hand with redacted, rotated state and auto-deals the next", async () => {
    const a = new TestClient("device-aaaa-1111");
    const b = new TestClient("device-bbbb-2222");
    await a.open(); await b.open();
    await a.next(m => m.type === "hello_ok");
    await b.next(m => m.type === "hello_ok");

    a.send({ type: "create", profile: { name: "Alice", emoji: "😎" }, config: { sb: 50, bb: 100, stack: 10000, fillAI: false } });
    const roomA = await a.next(m => m.type === "room");
    expect(roomA.code).toMatch(/^[A-Z]{5}$/);
    expect(roomA.members[0].host).toBe(true);

    b.send({ type: "join", code: roomA.code, profile: { name: "Bob", emoji: "🤠" } });
    await b.next(m => m.type === "room");
    b.send({ type: "ready", ready: true });
    await a.next(m => m.type === "room" && m.canStart);
    a.send({ type: "start" });

    const stA = await a.next(m => m.type === "state");
    const stB = await b.next(m => m.type === "state");
    expect(stA.game.players[0].name).toBe("Alice");
    expect(stB.game.players[0].name).toBe("Bob");
    expect(stA.game.players[0].cards[0].r).toBeDefined();
    expect(stA.game.players[1].cards[0].hidden).toBe(true);
    expect(stB.game.players[1].cards[0].hidden).toBe(true);
    expect(stA.game.deck).toEqual([]);
    expect(stA.game.sb).toBe(stA.game.dealer);
    expect(stA.deadline).toBeGreaterThan(Date.now());

    const offTurn = stA.game.turn === 0 ? b : a;
    const potBefore = stA.game.players.reduce((t, p) => t + p.total, 0);
    offTurn.send({ type: "act", action: { type: "raise", to: 999999 } });
    await new Promise(r => setTimeout(r, 200));
    expect(a.msgs.filter(m => m.type === "state").length).toBe(0);

    const onTurn = stA.game.turn === 0 ? a : b;
    onTurn.send({ type: "act", action: { type: "fold" } });
    const overA = await a.next(m => m.type === "state" && m.game.stage === "over");
    const winner = overA.game.result.lines.find(l => !l.pot);
    expect(["Alice", "Bob"]).toContain(winner.name);
    const chipsTotal = overA.game.players.reduce((t, p) => t + p.chips, 0);
    expect(chipsTotal).toBe(20000);

    const next = await a.next(m => m.type === "state" && m.game.stage === "hand" && m.game.handNo === 2, 8000);
    expect(next.game.players[0].cards.length).toBe(2);

    a.send({ type: "reaction", emoji: "🔥" });
    const rx = await b.next(m => m.type === "reaction");
    expect(rx).toMatchObject({ name: "Alice", emoji: "🔥" });

    a.close(); b.close();
  }, 20000);

  it("rejects unknown rooms and joining a running game", async () => {
    const a = new TestClient("device-cccc-3333");
    const c = new TestClient("device-dddd-4444");
    await a.open(); await c.open();
    await a.next(m => m.type === "hello_ok");
    await c.next(m => m.type === "hello_ok");

    c.send({ type: "join", code: "ZZZZ", profile: { name: "Eve" } });
    const err = await c.next(m => m.type === "error");
    expect(err.msg).toMatch(/not found/i);

    a.send({ type: "create", profile: { name: "Ann" }, config: { fillAI: true } });
    const room = await a.next(m => m.type === "room");
    a.send({ type: "start" });
    const st = await a.next(m => m.type === "state");
    expect(st.game.players.length).toBe(5);

    c.send({ type: "join", code: room.code, profile: { name: "Eve" } });
    const err2 = await c.next(m => m.type === "error");
    expect(err2.msg).toMatch(/in progress/i);

    a.send({ type: "leave" });
    await a.next(m => m.type === "ended");
    a.close(); c.close();
  }, 15000);

  it("reconnects a returning device to its seat", async () => {
    const a = new TestClient("device-eeee-5555");
    const b = new TestClient("device-ffff-6666");
    await a.open(); await b.open();
    await a.next(m => m.type === "hello_ok");
    await b.next(m => m.type === "hello_ok");
    a.send({ type: "create", profile: { name: "Ray" }, config: {} });
    const room = await a.next(m => m.type === "room");
    b.send({ type: "join", code: room.code, profile: { name: "Kim" } });
    await b.next(m => m.type === "room");
    b.send({ type: "ready", ready: true });
    await a.next(m => m.type === "room" && m.canStart);
    a.send({ type: "start" });
    await b.next(m => m.type === "state");

    b.close();
    await a.next(m => m.type === "state" && m.conn?.some(x => x.name === "Kim" && !x.connected), 5000);
    const b2 = new TestClient("device-ffff-6666");
    await b2.open();
    const st = await b2.next(m => m.type === "state", 5000);
    expect(st.game.players[0].name).toBe("Kim");
    expect(st.game.players[0].cards.length).toBe(2);
    a.close(); b2.close();
  }, 15000);
});
