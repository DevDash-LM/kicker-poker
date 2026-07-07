export const PROTO = 1;
export const MAX_SEATS = 5;
export const TURN_MS = 30000;
export const RECONNECT_GRACE_MS = 60000;
export const NEXT_HAND_MS = 5200;
export const REACTIONS = ["👍", "😂", "😮", "🔥", "👏"];
export const AVATARS = ["🙂", "😎", "🤠", "👽", "🐙", "🦄", "🐸", "🤖"];

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LEN = 5; // 24^5 ~= 7.96M codes: harder to guess/enumerate than 4-char

// Cryptographically secure uniform index in [0, n), rejection-sampled (no modulo bias).
function secureIndex(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  let x;
  do { globalThis.crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % n;
}

export function makeCode(taken) {
  let code;
  do {
    code = Array.from({ length: CODE_LEN }, () => ALPHA[secureIndex(ALPHA.length)]).join("");
  } while (taken.has(code));
  return code;
}

export function sanitizeName(s) {
  return String(s || "").replace(/[^\w\s\-'.]/g, "").trim().slice(0, 14) || "Guest";
}

export function sanitizeAvatar(e) {
  return AVATARS.includes(e) ? e : AVATARS[0];
}

export function mkPlayer(name, emoji, ai, chips) {
  return {
    name, emoji, ai, chips,
    cards: [], bet: 0, total: 0, folded: false, allIn: false,
    acted: false, revealed: false, lastAction: null,
  };
}

export function redactFor(game, seat) {
  const n = game.players.length;
  const rot = i => (typeof i === "number" && i >= 0 ? (i - seat + n) % n : i);
  const players = [];
  for (let k = 0; k < n; k++) {
    const i = (seat + k) % n;
    const p = game.players[i];
    const visible = i === seat || (p.revealed && !p.folded);
    players.push({
      ...p,
      aggr: undefined, loose: undefined,
      cards: visible ? p.cards : p.cards.length ? [{ hidden: true }, { hidden: true }] : [],
    });
  }
  return {
    ...game,
    deck: [],
    players,
    turn: rot(game.turn),
    dealer: rot(game.dealer),
    sb: rot(game.sb),
    bb: rot(game.bb),
  };
}

export function validAction(a) {
  if (!a || typeof a !== "object") return null;
  if (a.type === "fold" || a.type === "call") return { type: a.type };
  if (a.type === "raise" && Number.isFinite(a.to) && a.to > 0) return { type: "raise", to: Math.floor(a.to) };
  return null;
}

export function validConfig(c) {
  const BLINDS = [[25, 50], [50, 100], [100, 200], [250, 500]];
  const STACKS = [5000, 10000, 25000, 50000];
  const def = { sb: 50, bb: 100, stack: 10000, fillAI: false, tournament: false };
  if (!c || typeof c !== "object") return def;
  const pair = BLINDS.find(([sb, bb]) => sb === c.sb && bb === c.bb) || [def.sb, def.bb];
  return {
    sb: pair[0], bb: pair[1],
    stack: STACKS.includes(c.stack) ? c.stack : def.stack,
    fillAI: !!c.fillAI,
    tournament: !!c.tournament,
  };
}
