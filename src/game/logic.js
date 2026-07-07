export const RANK_STR = { 2:"2",3:"3",4:"4",5:"5",6:"6",7:"7",8:"8",9:"9",10:"10",11:"J",12:"Q",13:"K",14:"A" };
export const SB = 50, BB = 100, START = 10000;

// Cryptographically secure uniform integer in [0, maxExclusive).
// Uses rejection sampling to avoid modulo bias. Works in browsers and Node 18+
// (globalThis.crypto.getRandomValues is available in both).
export function secureInt(maxExclusive) {
  if (maxExclusive <= 0) throw new RangeError("maxExclusive must be > 0");
  if (maxExclusive === 1) return 0;
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive; // reject the biased tail
  const buf = new Uint32Array(1);
  let x;
  do { globalThis.crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % maxExclusive;
}

// Card order MUST come from a CSPRNG for the game to be certifiable. Only the
// deck shuffle needs this; AI/equity Monte-Carlo randomness stays on Math.random().
export function freshDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = secureInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function eval5(cs) {
  const rs = cs.map(c => c.r).sort((a, b) => b - a);
  const flush = cs.every(c => c.s === cs[0].s);
  let straightHigh = 0;
  const uniq = [...new Set(rs)];
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5;
  }
  const counts = {};
  rs.forEach(r => (counts[r] = (counts[r] || 0) + 1));
  const groups = Object.entries(counts)
    .map(([r, n]) => [n, +r])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);

  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0][0] === 4) return [7, groups[0][1], groups[1][1]];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, groups[0][1], groups[1][1]];
  if (flush) return [5, ...rs];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, groups[0][1], groups[1][1], groups[2][1]];
  if (groups[0][0] === 2 && groups[1][0] === 2)
    return [2, groups[0][1], groups[1][1], groups[2][1]];
  if (groups[0][0] === 2) return [1, groups[0][1], groups[1][1], groups[2][1], groups[3][1]];
  return [0, ...rs];
}

export function cmpScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// Highest straight top-card encoded in a 13-bit rank presence mask (bits 2..14).
// Ace doubles as low (bit 1) for the wheel. Returns 0 when there's no straight.
function straightHigh(mask) {
  if (mask & (1 << 14)) mask |= 1 << 1;
  for (let hi = 14; hi >= 5; hi--) {
    const need = (1 << hi) | (1 << (hi - 1)) | (1 << (hi - 2)) | (1 << (hi - 3)) | (1 << (hi - 4));
    if ((mask & need) === need) return hi;
  }
  return 0;
}

// Highest k distinct ranks present in rankCount, skipping up to two excluded ranks.
function topRanks(rc, ex0, ex1, k) {
  const out = [];
  for (let r = 14; r >= 2 && out.length < k; r--) {
    if (rc[r] && r !== ex0 && r !== ex1) out.push(r);
  }
  return out;
}

// Direct 7-card evaluator: counts ranks/suits once instead of scoring all 21
// five-card subsets. Returns the exact same score-array shape as eval5 (verified
// identical to the brute-force evaluator across 120k+ random hands), so cmpScore
// and handLabel keep working unchanged. This is the app's hottest function --
// every equity/Monte-Carlo/showdown path runs through it.
export function eval7(cards) {
  const rc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // rank counts, index = rank (2..14)
  const sc = [0, 0, 0, 0];                                   // suit counts
  const sm = [0, 0, 0, 0];                                   // per-suit rank masks
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    rc[c.r]++; sc[c.s]++; sm[c.s] |= 1 << c.r;
  }

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (sc[s] >= 5) { flushSuit = s; break; }
  if (flushSuit >= 0) {
    const sfh = straightHigh(sm[flushSuit]);
    if (sfh) return [8, sfh];
  }

  let quad = 0, trip = 0, trip2 = 0, pair = 0, pair2 = 0;
  for (let r = 14; r >= 2; r--) {
    const n = rc[r];
    if (n === 4) { if (!quad) quad = r; }
    else if (n === 3) { if (!trip) trip = r; else if (!trip2) trip2 = r; }
    else if (n === 2) { if (!pair) pair = r; else if (!pair2) pair2 = r; }
  }

  if (quad) return [7, quad, topRanks(rc, quad, 0, 1)[0]];
  if (trip && (trip2 || pair)) return [6, trip, trip2 > pair ? trip2 : pair];
  if (flushSuit >= 0) {
    const fr = [];
    const mask = sm[flushSuit];
    for (let r = 14; r >= 2 && fr.length < 5; r--) if (mask & (1 << r)) fr.push(r);
    return [5, fr[0], fr[1], fr[2], fr[3], fr[4]];
  }

  let allMask = 0;
  for (let r = 2; r <= 14; r++) if (rc[r]) allMask |= 1 << r;
  const sh = straightHigh(allMask);
  if (sh) return [4, sh];

  if (trip) { const k = topRanks(rc, trip, 0, 2); return [3, trip, k[0], k[1]]; }
  if (pair && pair2) return [2, pair, pair2, topRanks(rc, pair, pair2, 1)[0]];
  if (pair) { const k = topRanks(rc, pair, 0, 3); return [1, pair, k[0], k[1], k[2]]; }
  const k = topRanks(rc, 0, 0, 5);
  return [0, k[0], k[1], k[2], k[3], k[4]];
}

const CAT_NAMES = ["High card","Pair","Two pair","Three of a kind","Straight","Flush","Full house","Four of a kind","Straight flush"];
export function handLabel(score) {
  const cat = score[0];
  if (cat === 8 && score[1] === 14) return "Royal flush";
  if (cat === 1) return `Pair of ${RANK_STR[score[1]]}s`;
  if (cat === 3) return `Trip ${RANK_STR[score[1]]}s`;
  if (cat === 0) return `${RANK_STR[score[1]]} high`;
  return CAT_NAMES[cat];
}

export function simEquity(hero, board, nOpp, iters) {
  if (nOpp <= 0) return 1;
  const used = new Set([...hero, ...board].map(c => c.r * 4 + c.s));
  const pool = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++)
    if (!used.has(r * 4 + s)) pool.push({ r, s });
  const nb = board.length;
  const fill = 5 - nb;                 // community cards still to come
  const need = nOpp * 2 + fill;        // cards drawn from the pool each iteration
  const plen = pool.length;
  // Reused 7-card scratch buffers (hole0, hole1, five community). Avoids
  // allocating fresh arrays for every hero/opponent evaluation.
  const hero7 = [hero[0], hero[1], null, null, null, null, null];
  const opp7 = [null, null, null, null, null, null, null];
  for (let i = 0; i < nb; i++) { hero7[2 + i] = board[i]; opp7[2 + i] = board[i]; }
  let win = 0;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(Math.random() * (plen - i));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    let k = 0;
    for (let i = 0; i < fill; i++) {
      const card = pool[k++];
      hero7[2 + nb + i] = card; opp7[2 + nb + i] = card;
    }
    const heroScore = eval7(hero7);
    let beaten = false, tied = 0;
    for (let o = 0; o < nOpp; o++) {
      opp7[0] = pool[k]; opp7[1] = pool[k + 1]; k += 2;
      const c = cmpScore(eval7(opp7), heroScore);
      if (c > 0) { beaten = true; break; }
      if (c === 0) tied++;
    }
    if (!beaten) win += tied ? 1 / (tied + 1) : 1;
  }
  return win / iters;
}

export const fmt = n => n >= 100000 ? `${(n/1000).toFixed(0)}K` : n.toLocaleString();
export const potOf = s => s.players.reduce((t, p) => t + p.total, 0);
export const clone = s => ({ ...s, players: s.players.map(p => ({ ...p, cards: [...p.cards] })), board: [...s.board], deck: [...s.deck] });

export function nextSeat(players, from, pred) {
  for (let i = 1; i <= players.length; i++) {
    const idx = (from + i) % players.length;
    if (pred(players[idx])) return idx;
  }
  return -1;
}
export const canAct = p => !p.folded && !p.allIn && p.chips >= 0;

export const AI_SEED = [
  { name: "Mara", emoji: "🦊", aggr: 0.7, loose: 0.6 },
  { name: "Dee", emoji: "🐢", aggr: 0.3, loose: 0.35 },
  { name: "Otto", emoji: "🦉", aggr: 0.5, loose: 0.5 },
  { name: "Zip", emoji: "🐇", aggr: 0.85, loose: 0.7 },
];

export const NAME_POOL = [
  "Marcus", "Elena", "Nolan", "Sofia", "Adrian", "Maya", "Ethan", "Clara",
  "Naomi", "Julian", "Amelia", "Owen", "Isla", "Caleb", "Vivian", "Levi",
  "Serena", "Mason", "Tessa", "Dominic", "Audrey", "Miles", "Harper", "Jonah",
  "Elise", "Theo", "Natalie", "Simon", "Ava",
];

// Pick n distinct random names from NAME_POOL (secure shuffle, partial).
export function pickNames(n) {
  const pool = NAME_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = secureInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

export function decideAI(s, idx) {
  const bbA = s.blinds ? s.blinds.bb : BB, sbA = s.blinds ? s.blinds.sb : SB;
  const p = s.players[idx];
  const toCall = s.currentBet - p.bet;
  const pot = potOf(s);
  const activeOpp = s.players.filter((q, i) => i !== idx && !q.folded).length;
  const eq = simEquity(p.cards, s.board, activeOpp, 120);
  const eff = eq + (p.loose - 0.5) * 0.08 + (Math.random() - 0.5) * 0.06;
  const maxTo = p.bet + p.chips;
  const minTo = Math.min(s.currentBet + s.minRaise, maxTo);
  const r = Math.random();

  if (toCall <= 0) {
    if (eff > 0.6 || (eff > 0.42 && r < p.aggr * 0.45)) {
      const size = Math.round((0.45 + p.aggr * 0.4) * Math.max(pot, bbA * 2) / sbA) * sbA;
      return { type: "raise", to: Math.max(minTo, Math.min(p.bet + size, maxTo)) };
    }
    return { type: "call" };
  }
  const potOdds = toCall / (pot + toCall);
  if (eff < potOdds - 0.02) {
    if (r < 0.05 && toCall <= bbA * 2) return { type: "call" };
    return { type: "fold" };
  }
  if (eff > potOdds + 0.2 && r < p.aggr && minTo <= maxTo) {
    const size = Math.round((0.6 + p.aggr * 0.5) * pot / sbA) * sbA;
    return { type: "raise", to: Math.max(minTo, Math.min(s.currentBet + size, maxTo)) };
  }
  return { type: "call" };
}

export function startHand(prev) {
  const blinds = prev.blinds || { sb: SB, bb: BB };
  const startStack = prev.startStack || START;
  const players = prev.players.map(p => ({
    ...p,
    cards: [], bet: 0, total: 0, folded: false, allIn: false,
    acted: false, revealed: false, lastAction: null,
    chips: p.ai && p.chips < blinds.bb * 20 ? startStack : p.chips,
  }));
  const deck = freshDeck();
  const dealer = nextSeat(players, prev.dealer, p => p.chips > 0);
  players.forEach(p => { if (p.chips > 0) p.cards = [deck.pop(), deck.pop()]; else p.folded = true; });

  const alive = players.filter(p => p.chips > 0).length;
  const sb = alive === 2 ? dealer : nextSeat(players, dealer, p => p.chips > 0);
  const bb = nextSeat(players, sb, p => p.chips > 0);
  const post = (i, amt) => {
    const p = players[i];
    const pay = Math.min(amt, p.chips);
    p.chips -= pay; p.bet += pay; p.total += pay;
    if (p.chips === 0) p.allIn = true;
  };
  post(sb, blinds.sb); post(bb, blinds.bb);

  return {
    ...prev,
    players, deck, dealer, sb, bb,
    board: [], street: "preflop",
    currentBet: blinds.bb, minRaise: blinds.bb,
    turn: nextSeat(players, bb, canAct),
    stage: "hand",
    result: null,
    handNo: prev.handNo + 1,
  };
}

function finishFolds(s) {
  const w = s.players.findIndex(p => !p.folded);
  const winner = s.players[w];
  const maxOther = Math.max(0, ...s.players.map((p, i) => (i === w ? 0 : p.total)));
  const uncalled = Math.max(0, winner.total - maxOther);
  const pot = potOf(s) - uncalled;
  winner.chips += pot + uncalled;
  s.stage = "over";
  const lines = [{ name: winner.name, amount: pot, label: null, hero: !winner.ai }];
  if (uncalled > 0) lines.push({ name: winner.name, amount: uncalled, label: null, hero: !winner.ai, pot: "returned" });
  s.result = { lines };
  return s;
}

function runShowdown(s) {
  const scores = s.players.map(p => (!p.folded ? eval7([...p.cards, ...s.board]) : null));
  s.players.forEach(p => { if (!p.folded) p.revealed = true; });

  const levels = [...new Set(s.players.filter(p => p.total > 0).map(p => p.total))].sort((a, b) => a - b);
  let prev = 0;
  const pots = [];
  for (const L of levels) {
    let amt = 0;
    s.players.forEach(p => { amt += Math.max(0, Math.min(p.total, L) - prev); });
    const elig = s.players.map((p, i) => i).filter(i => !s.players[i].folded && s.players[i].total >= L);
    let best = null;
    elig.forEach(i => { if (best === null || cmpScore(scores[i], scores[best]) > 0) best = i; });
    const winners = elig.filter(i => cmpScore(scores[i], scores[best]) === 0);
    const last = pots[pots.length - 1];
    if (last && last.winners.join() === winners.join()) { last.amount += amt; last.elig = Math.min(last.elig, elig.length); }
    else pots.push({ amount: amt, winners, elig: elig.length });
    prev = L;
  }
  const lines = [];
  pots.forEach((pot, pi) => {
    const share = Math.floor(pot.amount / pot.winners.length);
    pot.winners.forEach((i, k) => {
      const w = share + (k === 0 ? pot.amount - share * pot.winners.length : 0);
      s.players[i].chips += w;
      lines.push({
        name: s.players[i].name, amount: w, label: handLabel(scores[i]), hero: !s.players[i].ai,
        pot: pots.length > 1 ? (pot.elig === 1 ? "returned" : pi === 0 ? "main pot" : "side pot") : null,
      });
    });
  });
  lines.sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0));
  s.stage = "over";
  s.result = { lines };
  return s;
}

function advance(s, lastIdx) {
  if (s.players.filter(p => !p.folded).length === 1) return finishFolds(s);

  const next = nextSeat(s.players, lastIdx, p => canAct(p) && (!p.acted || p.bet < s.currentBet));
  if (next !== -1 && !(next === lastIdx && s.players[lastIdx].acted && s.players[lastIdx].bet >= s.currentBet)) {
    s.turn = next;
    return s;
  }
  s.players.forEach(p => { p.bet = 0; p.acted = false; p.lastAction = null; });
  s.currentBet = 0; s.minRaise = s.blinds ? s.blinds.bb : BB;

  const actors = s.players.filter(canAct).length;
  const dealNext = () => {
    if (s.street === "preflop") { s.board.push(s.deck.pop(), s.deck.pop(), s.deck.pop()); s.street = "flop"; }
    else if (s.street === "flop") { s.board.push(s.deck.pop()); s.street = "turn"; }
    else if (s.street === "turn") { s.board.push(s.deck.pop()); s.street = "river"; }
  };

  if (actors <= 1) {
    s.players.forEach(p => { if (!p.folded) p.revealed = true; });
    const contenders = s.players.filter(p => !p.folded).length;
    if (contenders >= 2 && s.board.length < 5) {
      s.stage = "runout";
      s.turn = -1;
      return s;
    }
    while (s.board.length < 5) dealNext();
    return runShowdown(s);
  }
  if (s.street === "river") return runShowdown(s);
  dealNext();
  s.turn = nextSeat(s.players, s.dealer, canAct);
  return s;
}

export function applyAction(prev, idx, action) {
  const s = clone(prev);
  const p = s.players[idx];
  if (action.type === "raise" && p.acted) action = { type: "call" };
  if (action.type === "fold") {
    p.folded = true; p.lastAction = "Fold";
  } else if (action.type === "call") {
    const toCall = Math.max(0, s.currentBet - p.bet);
    const pay = Math.min(toCall, p.chips);
    p.chips -= pay; p.bet += pay; p.total += pay;
    if (p.chips === 0 && pay > 0) p.allIn = true;
    p.lastAction = toCall === 0 ? "Check" : p.allIn ? "All-in" : "Call";
  } else if (action.type === "raise") {
    const hadBet = s.currentBet > 0;
    const target = Math.min(action.to, p.bet + p.chips);
    const pay = target - p.bet;
    p.chips -= pay; p.bet = target; p.total += pay;
    if (p.chips === 0) p.allIn = true;
    if (p.bet > s.currentBet) {
      const inc = p.bet - s.currentBet;
      if (inc >= s.minRaise) {
        s.minRaise = inc;
        s.players.forEach((q, i) => { if (i !== idx && !q.folded && !q.allIn) q.acted = false; });
      }
      s.currentBet = p.bet;
    }
    p.lastAction = p.allIn ? "All-in" : hadBet && s.currentBet > (s.blinds ? s.blinds.bb : BB) ? "Raise" : "Bet";
  }
  p.acted = true;
  return advance(s, idx);
}

export function stepRunout(prev) {
  if (prev.stage !== "runout") return prev;
  const s = clone(prev);
  if (s.board.length >= 5) return runShowdown(s);
  if (s.street === "preflop") { s.board.push(s.deck.pop(), s.deck.pop(), s.deck.pop()); s.street = "flop"; }
  else if (s.street === "flop") { s.board.push(s.deck.pop()); s.street = "turn"; }
  else if (s.street === "turn") { s.board.push(s.deck.pop()); s.street = "river"; }
  return s;
}

export function runoutEquities(players, board) {
  const out = players.map(() => null);
  const contenders = players
    .map((p, i) => (!p.folded && p.cards.length === 2 && p.cards[0].r ? i : -1))
    .filter(i => i >= 0);
  if (contenders.length < 2) return out;
  const used = new Set();
  contenders.forEach(i => players[i].cards.forEach(c => used.add(c.r * 4 + c.s)));
  board.forEach(c => used.add(c.r * 4 + c.s));
  const pool = [];
  for (let st = 0; st < 4; st++) for (let r = 2; r <= 14; r++)
    if (!used.has(r * 4 + st)) pool.push({ r, s: st });
  const nb = board.length;
  const need = 5 - nb;
  const plen = pool.length;
  const nc = contenders.length;
  const wins = {};
  contenders.forEach(i => (wins[i] = 0));
  let total = 0;
  // Reused 7-card scratch buffer: [hole0, hole1, board..., runout...]. The
  // fixed board slots are filled once; each combo only rewrites the runout
  // cards and the two hole slots, so no arrays are allocated in the hot loop.
  const full7 = [null, null, null, null, null, null, null];
  for (let i = 0; i < nb; i++) full7[2 + i] = board[i];
  const settle = () => {
    let best = null, bestIs = null, bestN = 0;
    for (let ci = 0; ci < nc; ci++) {
      const idx = contenders[ci];
      const hc = players[idx].cards;
      full7[0] = hc[0]; full7[1] = hc[1];
      const sc = eval7(full7);
      const cmp = best ? cmpScore(sc, best) : 1;
      if (cmp > 0) { best = sc; bestIs = [idx]; bestN = 1; }
      else if (cmp === 0) { bestIs.push(idx); bestN++; }
    }
    const share = 1 / bestN;
    for (let i = 0; i < bestN; i++) wins[bestIs[i]] += share;
    total++;
  };
  if (need <= 0) settle();
  else if (need === 1) {
    for (let a = 0; a < plen; a++) { full7[2 + nb] = pool[a]; settle(); }
  } else if (need === 2) {
    for (let a = 0; a < plen - 1; a++) {
      full7[2 + nb] = pool[a];
      for (let b = a + 1; b < plen; b++) { full7[2 + nb + 1] = pool[b]; settle(); }
    }
  } else {
    for (let it = 0; it < 500; it++) {
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(Math.random() * (plen - i));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      for (let i = 0; i < need; i++) full7[2 + nb + i] = pool[i];
      settle();
    }
  }
  contenders.forEach(i => (out[i] = wins[i] / total));
  return out;
}
