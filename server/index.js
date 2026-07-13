import http from "http";
import { readFileSync, existsSync, statSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { WebSocketServer } from "ws";
import { startHand, applyAction, decideAI, stepRunout, AI_SEED, secureInt, aliveCount } from "../src/game/logic.js";
import {
  PROTO, MAX_SEATS, TURN_MS, RECONNECT_GRACE_MS, NEXT_HAND_MS, REACTIONS,
  makeCode, sanitizeName, sanitizeAvatar, mkPlayer, redactFor, validAction, validConfig,
} from "./protocol.js";
import { verifyAccount as defaultVerifyAccount } from "./auth.js";
import { mpBuyIn as defaultMpBuyIn, mpSettle as defaultMpSettle, bankrollConfigured as defaultBankrollConfigured } from "./wallet.js";

// `verifyAccount` / `walletOps` are injectable so tests can exercise the
// account and bankroll paths without a live Supabase project.
export function createServer(port = 8787, {
  verifyAccount = defaultVerifyAccount,
  walletOps = { buyIn: defaultMpBuyIn, settle: defaultMpSettle, configured: defaultBankrollConfigured },
} = {}) {
  const rooms = new Map();
  const memberOf = new Map();

  // ---- bankroll settlement --------------------------------------------------
  // Settlement must never be lost or doubled: the per-member `bankrollSettled`
  // flag stops repeats locally, mp_settle() is idempotent server-side, and a
  // failed call is queued and retried until the bank answers.
  const pendingSettles = [];
  const settleTimer = setInterval(async () => {
    for (const p of pendingSettles.splice(0)) {
      const r = await walletOps.settle(p.sid, p.amt).catch(() => null);
      if (!r) pendingSettles.push(p);
    }
  }, 30000);

  function settleMember(room, m, chips) {
    if (!m.bankrollSession || m.bankrollSettled) return;
    m.bankrollSettled = true;
    const sid = m.bankrollSession;
    // Prefer the live in-hand stack (committed bets are forfeited, as in any
    // cash game); fall back to the last hand-end sync.
    let amt = chips;
    if (amt == null) {
      const seatChips = room.status === "playing" && room.game?.players?.[m.seat] && !room.game.players[m.seat].ai
        ? room.game.players[m.seat].chips : null;
      amt = seatChips ?? m.chips ?? 0;
    }
    amt = Math.max(0, Math.floor(amt));
    walletOps.settle(sid, amt)
      .then(r => { if (!r) pendingSettles.push({ sid, amt }); })
      .catch(() => pendingSettles.push({ sid, amt }));
  }

  const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
    ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
    ".json": "application/json", ".ico": "image/x-icon", ".txt": "text/plain", ".map": "application/json",
    ".xml": "application/xml; charset=utf-8", ".webp": "image/webp",
  };
  const httpServer = http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400); res.end(); return; }
    if (rel === "/") rel = "/index.html";
    let file = path.join(DIST, rel);
    if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    if (!(existsSync(file) && statSync(file).isFile())) {
      file = path.join(DIST, "index.html");
      if (!existsSync(file)) { res.writeHead(404); res.end("not found — build the client first (npm run build)"); return; }
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  });
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const send = (ws, obj) => { try { ws.readyState === 1 && ws.send(JSON.stringify(obj)); } catch {} };

  const liveMembers = room => room.members.filter(m => !m.left);

  const roomSnapshot = (room, forId) => ({
    type: "room",
    code: room.code,
    status: room.status,
    config: room.config,
    members: liveMembers(room).map(m => ({
      name: m.name, emoji: m.emoji, ready: m.ready,
      host: m.id === room.host, connected: m.connected, you: m.id === forId,
      account: !!m.accountId, // verified signed-in account (see server/auth.js)
      // Shareable by design — lets tablemates add each other as friends.
      friendCode: m.friendCode || null,
    })),
    canStart: canStart(room),
  });

  function canStart(room) {
    const live = liveMembers(room);
    return live.length >= 1 && live.every(m => m.ready) && (live.length >= 2 || room.config.fillAI);
  }

  function broadcastRoom(room) {
    liveMembers(room).forEach(m => m.connected && send(m.ws, roomSnapshot(room, m.id)));
  }

  function broadcastState(room) {
    if (!room.game) return;
    const conn = liveMembers(room).map(m => ({ name: m.name, connected: m.connected }));
    liveMembers(room).forEach(m => {
      if (!m.connected) return;
      send(m.ws, { type: "state", game: redactFor(room.game, m.seat), deadline: room.deadline, conn });
    });
  }

  function destroyRoom(room, notify = true) {
    clearTimeout(room.turnTimer); clearTimeout(room.dealTimer);
    room.members.forEach(m => {
      if (!m.left) settleMember(room, m);
      memberOf.delete(m.id);
      if (notify && m.connected) send(m.ws, { type: "ended" });
    });
    rooms.delete(room.code);
  }

  function removeMember(room, m) {
    settleMember(room, m);
    m.left = true;
    memberOf.delete(m.id);
    if (room.host === m.id) {
      const next = liveMembers(room)[0];
      if (next) room.host = next.id;
    }
    if (liveMembers(room).length === 0) return destroyRoom(room, false);
    if (room.status === "playing" && room.game) {
      const g = room.game;
      const p = g.players[m.seat];
      if (p && !p.ai && !p.folded && g.stage === "hand") {
        room.game = applyAction(g, m.seat, { type: "fold" });
        afterAction(room);
        return;
      }
      broadcastState(room);
    }
    broadcastRoom(room);
  }

  function syncChips(room) {
    const g = room.game;
    liveMembers(room).forEach(m => { if (g.players[m.seat]) m.chips = g.players[m.seat].chips; });
    room.aiChips = g.players.filter(p => p.ai).map(p => p.chips);
  }

  function scheduleTurn(room) {
    const g = room.game;
    const p = g.players[g.turn];
    if (!p) return;
    const turnAt = g.turn, handAt = g.handNo, streetAt = g.street;
    const stale = () => {
      const gg = room.game;
      return !gg || gg.stage !== "hand" || gg.turn !== turnAt || gg.handNo !== handAt || gg.street !== streetAt;
    };
    if (p.ai) {
      room.deadline = null;
      broadcastState(room);
      room.turnTimer = setTimeout(() => {
        if (stale()) return;
        room.game = applyAction(room.game, room.game.turn, decideAI(room.game, room.game.turn));
        afterAction(room);
      }, 700 + Math.random() * 900);
    } else {
      room.deadline = Date.now() + TURN_MS;
      broadcastState(room);
      room.turnTimer = setTimeout(() => {
        if (stale()) return;
        const gg = room.game;
        const toCall = gg.currentBet - gg.players[gg.turn].bet;
        room.game = applyAction(gg, gg.turn, { type: toCall > 0 ? "fold" : "call" });
        afterAction(room);
      }, TURN_MS + 200);
    }
  }

  function afterAction(room) {
    room.lastActivity = Date.now();
    clearTimeout(room.turnTimer);
    const g = room.game;
    if (g.stage === "runout") {
      room.deadline = null;
      broadcastState(room);
      room.turnTimer = setTimeout(() => {
        if (room.game?.stage !== "runout") return;
        room.game = stepRunout(room.game);
        afterAction(room);
      }, g.board.length === 0 ? 1500 : 1300);
      return;
    }
    if (g.stage === "over") {
      room.deadline = null;
      syncChips(room);
      broadcastState(room);
      room.dealTimer = setTimeout(() => dealNext(room), NEXT_HAND_MS);
    } else {
      scheduleTurn(room);
    }
  }

  function dealNext(room) {
    if (!rooms.has(room.code)) return;
    const cutoff = Date.now() - RECONNECT_GRACE_MS;
    liveMembers(room).forEach(m => {
      if (!m.connected && m.lastSeen < cutoff) { settleMember(room, m, m.chips); m.left = true; memberOf.delete(m.id); }
    });
    // Bankroll cash games never auto-rebuy: a busted player is settled at 0
    // and released (their chips were real saved chips — new ones can't appear
    // from nowhere). Tournaments keep them seated as sat-out, like today.
    if (room.config.bankroll && !room.config.tournament) {
      liveMembers(room).forEach(m => {
        if (m.chips <= 0) {
          settleMember(room, m, 0);
          if (m.connected) send(m.ws, { type: "error", msg: "You're out of chips — your table result was settled to your wallet." });
          m.left = true; memberOf.delete(m.id);
          if (m.connected) send(m.ws, { type: "ended" });
        }
      });
    }
    const live = liveMembers(room);
    if (live.length === 0) return destroyRoom(room, false);
    if (room.host && !live.some(m => m.id === room.host)) room.host = live[0].id;

    const tournament = room.config.tournament;
    // Tournaments end when only one stack remains across humans and AI. Freeze the
    // finished hand on screen with the champion named instead of dealing again.
    if (tournament && room.game) {
      const humanSurv = live.filter(m => m.chips > 0).length;
      const aiSurv = (room.aiChips || []).filter(c => c > 0).length;
      if (humanSurv + aiSurv <= 1) {
        const g = room.game;
        const champ = g.players.find(p => p.chips > 0);
        g.champion = champ ? champ.name : null;
        g.stage = "over";
        room.deadline = null;
        broadcastState(room);
        return;
      }
    }

    const humans = live.map((m, i) => {
      m.seat = i;
      // Cash games rebuy busted players (practice-chip rooms only); tournaments
      // and bankroll rooms leave them out.
      if (!tournament && !room.config.bankroll && m.chips <= 0) { m.chips = room.config.stack; m.rebuys = (m.rebuys || 0) + 1; }
      return mkPlayer(m.name, m.emoji, false, m.chips);
    });
    let ais = [];
    if (room.config.fillAI) {
      ais = AI_SEED.slice(0, MAX_SEATS - humans.length).map((a, i) => {
        const prevChips = room.aiChips?.[i];
        const chips = tournament
          ? (prevChips ?? room.config.stack)
          : (prevChips > 0 ? prevChips : room.config.stack);
        return { ...mkPlayer(a.name, a.emoji, true, chips), aggr: a.aggr, loose: a.loose };
      });
    }
    const players = [...humans, ...ais];
    if (players.length < 2) {
      room.status = "lobby";
      room.game = null;
      liveMembers(room).forEach(m => (m.ready = false));
      broadcastRoom(room);
      return;
    }
    room.game = startHand({ ...room.game, players, dealer: room.game.dealer % players.length });
    afterAction(room);
  }

  function startGame(room) {
    const live = liveMembers(room);
    const humans = live.map((m, i) => {
      m.seat = i; m.chips = room.config.stack; m.rebuys = 0;
      return mkPlayer(m.name, m.emoji, false, room.config.stack);
    });
    let ais = [];
    if (room.config.fillAI) {
      ais = AI_SEED.slice(0, MAX_SEATS - humans.length).map(a => ({
        ...mkPlayer(a.name, a.emoji, true, room.config.stack), aggr: a.aggr, loose: a.loose,
      }));
    }
    const players = [...humans, ...ais];
    room.aiChips = ais.map(p => p.chips);
    room.status = "playing";
    room.game = startHand({
      players, dealer: secureInt(players.length), handNo: 0,
      board: [], deck: [], stage: "hand",
      blinds: { sb: room.config.sb, bb: room.config.bb }, startStack: room.config.stack,
      tournament: room.config.tournament,
    });
    broadcastRoom(room);
    afterAction(room);
  }

  function dedupeName(room, name) {
    let n = name, k = 2;
    while (liveMembers(room).some(m => m.name === n)) n = `${name} ${k++}`;
    return n.slice(0, 21);
  }

  wss.on("connection", ws => {
    let deviceId = null;
    let msgCount = 0;
    const rateTimer = setInterval(() => { msgCount = 0; }, 1000);

    const myRoom = () => {
      const code = deviceId && memberOf.get(deviceId);
      return code ? rooms.get(code) : null;
    };
    const myMember = room => room?.members.find(m => m.id === deviceId && !m.left) || null;

    ws.on("message", async raw => {
      if (++msgCount > 20) { if (msgCount > 60) ws.close(); return; }
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.type !== "string") return;

      if (m.type === "hello") {
        if (m.proto !== PROTO) return send(ws, { type: "error", msg: "Please update the app to play online." });
        if (typeof m.deviceId !== "string" || m.deviceId.length < 8 || m.deviceId.length > 64) return;
        deviceId = m.deviceId;
        const room = myRoom();
        const me = myMember(room);
        if (room && me) {
          me.ws = ws; me.connected = true; me.lastSeen = Date.now();
          room.lastActivity = Date.now();
          send(ws, roomSnapshot(room, deviceId));
          if (room.status === "playing" && room.game) broadcastState(room);
          broadcastRoom(room);
        } else {
          send(ws, { type: "hello_ok" });
        }
        return;
      }
      if (!deviceId) return;

      if (m.type === "create") {
        if (myRoom()) return send(ws, { type: "error", msg: "Already in a room." });
        // Signed-in players attach their Supabase access token; a verified
        // account pins the member's identity (account id + profile name/emoji),
        // ignoring the client-typed profile. Any failure falls back to guest.
        const account = m.auth ? await verifyAccount(m.auth) : null;
        if (ws.readyState !== 1 || myRoom()) return; // re-check after await
        const config = validConfig(m.config);

        // Saved-chips table: escrow the host's buy-in before the room exists.
        let bankrollSession = null;
        if (config.bankroll) {
          if (!walletOps.configured) return send(ws, { type: "error", msg: "Saved-chips tables aren't enabled on this server." });
          if (!account) return send(ws, { type: "error", msg: "Sign in to host a saved-chips table." });
          const esc = await walletOps.buyIn(account.id, "NEW", config.stack);
          if (ws.readyState !== 1 || myRoom()) { if (esc?.sessionId) walletOps.settle(esc.sessionId, config.stack).catch(() => {}); return; }
          if (!esc) return send(ws, { type: "error", msg: "Couldn't reach the bank. Try again." });
          if (esc.error) return send(ws, { type: "error", msg: esc.error === "insufficient" ? "Not enough saved chips for the buy-in." : "Buy-in failed. Try again." });
          bankrollSession = esc.sessionId;
        }

        const code = makeCode(rooms);
        const room = {
          code, host: deviceId, config, status: "lobby", game: null, aiChips: [],
          members: [], turnTimer: null, dealTimer: null, deadline: null, lastActivity: Date.now(),
        };
        room.members.push({
          id: deviceId, ws,
          name: sanitizeName(account?.name ?? m.profile?.name),
          emoji: sanitizeAvatar(account?.emoji ?? m.profile?.emoji),
          accountId: account?.id || null,
          friendCode: account?.friendCode || null,
          bankrollSession, bankrollSettled: false,
          ready: true, connected: true, lastSeen: Date.now(), seat: 0, chips: config.stack, rebuys: 0, left: false,
        });
        rooms.set(code, room);
        memberOf.set(deviceId, code);
        broadcastRoom(room);
        return;
      }

      if (m.type === "join") {
        if (myRoom()) return send(ws, { type: "error", msg: "Already in a room." });
        const code = String(m.code || "").toUpperCase().trim();
        if (!rooms.has(code)) return send(ws, { type: "error", msg: "Room not found." });
        const room = rooms.get(code);
        if (room.status !== "lobby") return send(ws, { type: "error", msg: "That table is already in progress." });
        if (liveMembers(room).length >= MAX_SEATS) return send(ws, { type: "error", msg: "That table is full." });

        // Mirror `create`: a verified token pins the joiner's identity; any
        // failure falls back to the client-typed guest profile.
        const account = m.auth ? await verifyAccount(m.auth) : null;
        if (ws.readyState !== 1 || myRoom()) return; // re-check after await
        if (!rooms.has(code) || room.status !== "lobby") return send(ws, { type: "error", msg: "That table is no longer open." });
        if (liveMembers(room).length >= MAX_SEATS) return send(ws, { type: "error", msg: "That table is full." });

        // Saved-chips tables: escrow the joiner's buy-in before they take a seat.
        let bankrollSession = null;
        if (room.config.bankroll) {
          if (!walletOps.configured) return send(ws, { type: "error", msg: "Saved-chips tables aren't enabled on this server." });
          if (!account) return send(ws, { type: "error", msg: "Sign in to join a saved-chips table." });
          const esc = await walletOps.buyIn(account.id, code, room.config.stack);
          if (ws.readyState !== 1 || myRoom() || !rooms.has(code)) { if (esc?.sessionId) walletOps.settle(esc.sessionId, room.config.stack).catch(() => {}); return; }
          if (!esc) return send(ws, { type: "error", msg: "Couldn't reach the bank. Try again." });
          if (esc.error) return send(ws, { type: "error", msg: esc.error === "insufficient" ? "Not enough saved chips for the buy-in." : "Buy-in failed. Try again." });
          bankrollSession = esc.sessionId;
        }

        room.members.push({
          id: deviceId, ws,
          name: dedupeName(room, sanitizeName(account?.name ?? m.profile?.name)),
          emoji: sanitizeAvatar(account?.emoji ?? m.profile?.emoji),
          accountId: account?.id || null,
          friendCode: account?.friendCode || null,
          bankrollSession, bankrollSettled: false,
          ready: false, connected: true, lastSeen: Date.now(), seat: liveMembers(room).length, chips: room.config.stack, rebuys: 0, left: false,
        });
        memberOf.set(deviceId, code);
        room.lastActivity = Date.now();
        broadcastRoom(room);
        return;
      }

      if (m.type === "config") {
        const room = myRoom();
        if (!room || room.host !== deviceId || room.status !== "lobby") return;
        // A saved-chips room is locked once created: buy-ins were escrowed
        // against config.stack, so its config must not change afterward.
        if (room.config.bankroll) return;
        const next = validConfig(m.config);
        next.bankroll = false; // a practice room can never be flipped to saved-chips mid-lobby
        room.config = next;
        room.lastActivity = Date.now();
        broadcastRoom(room);
        return;
      }

      if (m.type === "ready") {
        const room = myRoom();
        const me = myMember(room);
        if (!room || !me || room.status !== "lobby") return;
        me.ready = !!m.ready;
        room.lastActivity = Date.now();
        broadcastRoom(room);
        return;
      }

      if (m.type === "start") {
        const room = myRoom();
        const me = myMember(room);
        if (!room || !me || room.host !== deviceId || room.status !== "lobby") return;
        if (!canStart(room)) return;
        startGame(room); // startGame() broadcasts the room and kicks off the first turn
        return;
      }

      if (m.type === "act") {
        const room = myRoom();
        const me = myMember(room);
        if (!room || !me || room.status !== "playing" || !room.game) return;
        const g = room.game;
        if (g.stage !== "hand" || g.turn !== me.seat) return; // ignore out-of-turn / stale input
        const action = validAction(m.action);
        if (!action) return;
        room.game = applyAction(g, me.seat, action);
        afterAction(room);
        return;
      }

      if (m.type === "reaction") {
        const room = myRoom();
        const me = myMember(room);
        if (!room || !me || !REACTIONS.includes(m.emoji)) return;
        liveMembers(room).forEach(x => x.connected && send(x.ws, { type: "reaction", name: me.name, emoji: m.emoji }));
        return;
      }

      if (m.type === "leave") {
        const room = myRoom();
        const me = myMember(room);
        if (room && me) { send(ws, { type: "ended" }); removeMember(room, me); }
        return;
      }
    });

    ws.on("close", () => {
      clearInterval(rateTimer);
      const room = myRoom();
      const me = myMember(room);
      if (!room || !me) return;
      me.connected = false;
      me.lastSeen = Date.now();
      room.lastActivity = Date.now();
      // Keep the seat: a returning device reclaims it within the reconnect
      // grace window (dealNext() settles and releases seats that stay dark).
      if (room.status === "playing" && room.game) broadcastState(room);
      broadcastRoom(room);
    });
  });

  // Backstop cleanup: reap rooms that have seen no activity for a long time
  // (e.g. a lobby everyone walked away from). Playing rooms whose seats have
  // all gone dark are also released by the reconnect grace in dealNext().
  const IDLE_ROOM_MS = 30 * 60 * 1000;
  const gcTimer = setInterval(() => {
    const cutoff = Date.now() - IDLE_ROOM_MS;
    for (const room of [...rooms.values()]) {
      if (room.lastActivity < cutoff) destroyRoom(room);
    }
  }, 60000);

  httpServer.listen(port);

  return {
    port: () => httpServer.address().port,
    close: () => {
      clearInterval(settleTimer);
      clearInterval(gcTimer);
      for (const room of rooms.values()) { clearTimeout(room.turnTimer); clearTimeout(room.dealTimer); }
      try { wss.close(); } catch {}
      try { httpServer.close(); } catch {}
    },
  };
}

// Start directly when run as a script (Docker CMD / `npm run server`); tests
// import createServer() and start their own instance instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 8787;
  createServer(port);
  console.log(`Kicker server listening on :${port} (ws path /ws)`);
}
