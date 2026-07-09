// Account identity on table-code rooms (server/auth.js + create/join wiring).
// The verifier is injected so no live Supabase project is needed: it resolves
// like a successful (or failed) token check would.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { createServer } from "../server/index.js";

// Tokens our fake verifier accepts. Anything else -> null (invalid/expired).
const TOKENS = {
  "token-alice-000000000000": { id: "uuid-alice", name: "AliceAcct", emoji: "🦄" },
  "token-noprofile-00000000": { id: "uuid-bare", name: null, emoji: null },
};
const verifyAccount = async token => TOKENS[token] || null;

let srv, port;
beforeAll(() => { srv = createServer(0, { verifyAccount }); port = srv.port(); });
afterAll(() => srv.close());

class TestClient {
  constructor(id) {
    this.id = id;
    this.msgs = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on("message", d => this.msgs.push(JSON.parse(d)));
  }
  async open() {
    // The socket may already be open if another client's open() was awaited
    // after this one's constructor ran — don't wait for an event that fired.
    if (this.ws.readyState !== WebSocket.OPEN) await new Promise(res => this.ws.once("open", res));
    this.send({ type: "hello", proto: 1, deviceId: this.id });
    await this.next(m => m.type === "hello_ok");
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

describe("account identity on table codes", () => {
  it("verified creator gets account name/emoji + account flag; spoofed profile is ignored", async () => {
    const a = new TestClient("device-acct-111111");
    await a.open();
    a.send({
      type: "create", auth: "token-alice-000000000000",
      profile: { name: "Impostor", emoji: "🤠" }, // must be ignored
      config: {},
    });
    const room = await a.next(m => m.type === "room");
    expect(room.members[0]).toMatchObject({ name: "AliceAcct", emoji: "🦄", account: true, host: true });
    a.send({ type: "leave" });
    await a.next(m => m.type === "ended");
    a.close();
  });

  it("invalid token falls back to guest; guests join untouched alongside accounts", async () => {
    const host = new TestClient("device-acct-222222");
    const guest = new TestClient("device-guest-33333");
    const forged = new TestClient("device-forge-44444");
    await host.open(); await guest.open(); await forged.open();

    host.send({ type: "create", auth: "token-alice-000000000000", profile: { name: "x" }, config: {} });
    const room = await host.next(m => m.type === "room");

    // Plain guest: no auth field at all — pre-account clients keep working.
    guest.send({ type: "join", code: room.code, profile: { name: "Gary", emoji: "🤠" } });
    const g = await guest.next(m => m.type === "room");
    expect(g.members.find(m => m.you)).toMatchObject({ name: "Gary", emoji: "🤠", account: false });

    // Forged/expired token: verification fails -> guest with typed name.
    forged.send({ type: "join", code: room.code, auth: "token-totally-forged-9999", profile: { name: "Eve", emoji: "😎" } });
    const f = await forged.next(m => m.type === "room");
    expect(f.members.find(m => m.you)).toMatchObject({ name: "Eve", account: false });
    expect(f.members.find(m => m.name === "AliceAcct")).toMatchObject({ account: true });

    host.send({ type: "leave" });
    await host.next(m => m.type === "ended");
    host.close(); guest.close(); forged.close();
  });

  it("verified account without a profile row keeps the typed name but is still marked", async () => {
    const a = new TestClient("device-acct-555555");
    await a.open();
    a.send({ type: "create", auth: "token-noprofile-00000000", profile: { name: "Nia", emoji: "🐸" }, config: {} });
    const room = await a.next(m => m.type === "room");
    expect(room.members[0]).toMatchObject({ name: "Nia", emoji: "🐸", account: true });
    a.send({ type: "leave" });
    await a.next(m => m.type === "ended");
    a.close();
  });

  it("default verifier (unconfigured env) treats any token as guest", async () => {
    const srv2 = createServer(0); // real verifyAccount; SUPABASE env not set in tests
    const p2 = srv2.port();
    const ws = new WebSocket(`ws://127.0.0.1:${p2}/ws`);
    const msgs = [];
    ws.on("message", d => msgs.push(JSON.parse(d)));
    await new Promise(res => ws.on("open", res));
    ws.send(JSON.stringify({ type: "hello", proto: 1, deviceId: "device-cold-666666" }));
    ws.send(JSON.stringify({ type: "create", auth: "some-random-token-value-123", profile: { name: "Solo" }, config: {} }));
    const t0 = Date.now();
    let room;
    while (!room && Date.now() - t0 < 4000) {
      room = msgs.find(m => m.type === "room");
      await new Promise(r => setTimeout(r, 15));
    }
    expect(room.members[0]).toMatchObject({ name: "Solo", account: false });
    ws.close(); srv2.close();
  });
});
