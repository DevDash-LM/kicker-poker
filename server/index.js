import http from "http";
import { readFileSync, existsSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { startHand, applyAction, decideAI, stepRunout, AI_SEED } from "../src/game/logic.js";
import {
  PROTO, MAX_SEATS, TURN_MS, RECONNECT_GRACE_MS, NEXT_HAND_MS, REACTIONS,
  makeCode, sanitizeName, sanitizeAvatar, mkPlayer, redactFor, validAction, validConfig,
} from "./protocol.js";

export function createServer(port = 8787) {
  const rooms = new Map();
  const memberOf = new Map();

  const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
    ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
    ".json": "application/json", ".ico": "image/x-icon", ".txt": "text/plain", ".map": "application/json",
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
      memberOf.delete(m.id);
      if (notify && m.connected) send(m.ws, { type: "ended" });
    });
    rooms.delete(room.code);
  }

  function removeMember(room, m) {
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
      if (!m.connected && m.lastSeen < cutoff) { m.left = true; memberOf.delete(m.id); }
    });
    const live = liveMembers(room);
    if (live.length === 0) return destroyRoom(room, false);
    if (room.host && !live.some(m => m.id === room.host)) room.host = live[0].id;

    const humans = live.map((m, i) => {
      m.seat = i;
      if (m.chips <= 0) { m.chips = room.config.stack; m.rebuys = (m.rebuys || 0) + 1; }
      return mkPlayer(m.name, m.emoji, false, m.chips);
    });
    let ais = [];
    if (room.config.fillAI) {
      ais = AI_SEED.slice(0, MAX_SEATS - humans.length).map((a, i) => ({
        ...mkPlayer(a.name, a.emoji, true, room.aiChips?.[i] > 0 ? room.aiChips[i] : room.config.stack),
        aggr: a.aggr, loose: a.loose,
      }));
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
      players, dealer: Math.floor(Math.random() * players.length), handNo: 0,
      board: [], deck: [], stage: "hand",
      blinds: { sb: room.config.sb, bb: room.config.bb }, startStack: room.config.stack,
    });
    broadcastRoom(room);
    afterAction(room);
  }

  function dedupeName(room, name) {
    let n = name, k = 2;
    while (liveMembers(room).some(m => m.name === n)) n = `${name} ${k++}`;
    return n.slice(0, 14);
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

    ws.on("message", raw => {
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
        const config = validConfig(m.config);
        const code = makeCode(rooms);
        const room = {
          code, host: deviceId, config, status: "lobby", game: null, aiChips: [],
          members: [], turnTimer: null, dealTimer: null, deadline: null, lastActivity: Date.now(),
        };
        room.members.push({
          id: deviceId, ws, name: sanitizeName(m.profile?.name), emoji: sanitizeAvatar(m.profile?.emoji),
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
        const room = rooms.get(code);
        if (!room) return send(ws, { type: "error", msg: "Room not found." });
        if (room.status === "playing") return send(ws, { type: "error", msg: "Game already in progress." });
        if (liveMembers(room).length >= MAX_SEATS) return send(ws, { type: "error", msg: "Table is full." });
        room.members.push({
          id: deviceId, ws, name: dedupeName(room, sanitizeName(m.profile?.name)), emoji: sanitizeAvatar(m.profile?.emoji),
          ready: false, connected: true, lastSeen: Date.now(), seat: 0, chips: room.config.stack, rebuys: 0, left: false,
        });
        room.lastActivity = Date.now();
        memberOf.set(deviceId, code);
        broadcastRoom(room);
        return;
      }

      const room = myRoom();
      const me = myMember(room);
      if (!room || !me) return;
      room.lastActivity = Date.now();

      if (m.type === "ready") {
        if (room.status !== "lobby") return;
        me.ready = !!m.ready;
        broadcastRoom(room);
      } else if (m.type === "config") {
        if (room.status !== "lobby" || room.host !== deviceId) return;
        room.config = validConfig(m.config);
        broadcastRoom(room);
      } else if (m.type === "start") {
        if (room.status !== "lobby" || room.host !== deviceId || !canStart(room)) return;
        startGame(room);
      } else if (m.type === "act") {
        if (room.status !== "playing" || !room.game) return;
        const g = room.game;
        if (g.stage !== "hand" || g.turn !== me.seat) return;
        const action = validAction(m.action);
        if (!action) return;
        room.game = applyAction(g, me.seat, action);
        afterAction(room);
      } else if (m.type === "reaction") {
        if (!REACTIONS.includes(m.emoji)) return;
        if (me.lastReaction && Date.now() - me.lastReaction < 1500) return;
        me.lastReaction = Date.now();
        liveMembers(room).forEach(o => o.connected && send(o.ws, { type: "reaction", name: me.name, emoji: m.emoji }));
      } else if (m.type === "leave") {
        removeMember(room, me);
        send(ws, { type: "ended" });
      }
    });

    ws.on("close", () => {
      clearInterval(rateTimer);
      const room = myRoom();
      const me = myMember(room);
      if (room && me) {
        me.connected = false;
        me.lastSeen = Date.now();
        if (room.status === "lobby") {
          removeMember(room, me);
        } else {
          broadcastRoom(room);
          broadcastState(room);
        }
      }
    });
  });

  const IDLE_MS = 30 * 60 * 1000;
  const sweep = setInterval(() => {
    const cutoff = Date.now() - IDLE_MS;
    for (const room of [...rooms.values()]) {
      if (room.lastActivity < cutoff) destroyRoom(room, true);
    }
  }, 10 * 60 * 1000);

  httpServer.listen(port);
  return {
    port: () => httpServer.address()?.port,
    rooms,
    close: () => { clearInterval(sweep); rooms.forEach(r => destroyRoom(r, false)); wss.close(); httpServer.close(); },
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env.PORT) || 8787;
  createServer(port);
  console.log(`Kicker server listening on :${port} (ws path /ws)`);
}
