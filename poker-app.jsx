import { useState, useEffect, useRef, useMemo } from "react";

// ---------- palette ----------
const C = {
  bg: "#EDEFF2",
  surface: "#FFFFFF",
  ink: "#171A20",
  muted: "#7A8089",
  faint: "#B9BEC6",
  line: "#E1E4E9",
  accent: "#2E5BFF",
  green: "#1F9D5B",
  red: "#E5484D",
  gold: "#B8860B",
  cardBack: "#1E2330",
};
const SUIT_META = [
  { sym: "♠", color: "#1B1E24" },
  { sym: "♥", color: "#E5484D" },
  { sym: "♦", color: "#2871E6" },
  { sym: "♣", color: "#1F9D5B" },
];
const RANK_STR = { 2:"2",3:"3",4:"4",5:"5",6:"6",7:"7",8:"8",9:"9",10:"10",11:"J",12:"Q",13:"K",14:"A" };
const FONT = "-apple-system, 'SF Pro Display', Inter, 'Segoe UI', system-ui, sans-serif";

const SB = 50, BB = 100, START = 10000;

// ---------- cards & evaluation ----------
function freshDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function eval5(cs) {
  const rs = cs.map(c => c.r).sort((a, b) => b - a);
  const flush = cs.every(c => c.s === cs[0].s);
  // straight
  let straightHigh = 0;
  const uniq = [...new Set(rs)];
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // wheel
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

function cmpScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function eval7(cards) {
  let best = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const s = eval5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || cmpScore(s, best) > 0) best = s;
          }
  return best;
}

const CAT_NAMES = ["High card","Pair","Two pair","Three of a kind","Straight","Flush","Full house","Four of a kind","Straight flush"];
function handLabel(score) {
  const cat = score[0];
  if (cat === 8 && score[1] === 14) return "Royal flush";
  if (cat === 1) return `Pair of ${RANK_STR[score[1]]}s`;
  if (cat === 3) return `Trip ${RANK_STR[score[1]]}s`;
  if (cat === 0) return `${RANK_STR[score[1]]} high`;
  return CAT_NAMES[cat];
}

function simEquity(hero, board, nOpp, iters) {
  if (nOpp <= 0) return 1;
  const used = new Set([...hero, ...board].map(c => c.r * 4 + c.s));
  const pool = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++)
    if (!used.has(r * 4 + s)) pool.push({ r, s });
  const need = nOpp * 2 + (5 - board.length);
  let win = 0;
  for (let it = 0; it < iters; it++) {
    // partial shuffle
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let k = 0;
    const fullBoard = [...board];
    while (fullBoard.length < 5) fullBoard.push(pool[k++]);
    const heroScore = eval7([...hero, ...fullBoard]);
    let beaten = false, tied = 0;
    for (let o = 0; o < nOpp; o++) {
      const os = eval7([pool[k], pool[k + 1], ...fullBoard]);
      k += 2;
      const c = cmpScore(os, heroScore);
      if (c > 0) { beaten = true; break; }
      if (c === 0) tied++;
    }
    if (!beaten) win += tied ? 1 / (tied + 1) : 1;
  }
  return win / iters;
}

// ---------- helpers ----------
const fmt = n => n >= 100000 ? `${(n/1000).toFixed(0)}K` : n.toLocaleString();
const potOf = s => s.players.reduce((t, p) => t + p.total, 0);
const clone = s => ({ ...s, players: s.players.map(p => ({ ...p, cards: [...p.cards] })), board: [...s.board], deck: [...s.deck] });

function nextSeat(players, from, pred) {
  for (let i = 1; i <= players.length; i++) {
    const idx = (from + i) % players.length;
    if (pred(players[idx])) return idx;
  }
  return -1;
}
const canAct = p => !p.folded && !p.allIn && p.chips >= 0;

// ---------- AI ----------
const AI_SEED = [
  { name: "Mara", emoji: "🦊", aggr: 0.7, loose: 0.6 },
  { name: "Dee", emoji: "🐢", aggr: 0.3, loose: 0.35 },
  { name: "Otto", emoji: "🦉", aggr: 0.5, loose: 0.5 },
  { name: "Zip", emoji: "🐇", aggr: 0.85, loose: 0.7 },
];

function decideAI(s, idx) {
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
      const size = Math.round((0.45 + p.aggr * 0.4) * Math.max(pot, BB * 2) / SB) * SB;
      return { type: "raise", to: Math.max(minTo, Math.min(p.bet + size, maxTo)) };
    }
    return { type: "call" }; // check
  }
  const potOdds = toCall / (pot + toCall);
  if (eff < potOdds - 0.02) {
    if (r < 0.05 && toCall <= BB * 2) return { type: "call" };
    return { type: "fold" };
  }
  if (eff > potOdds + 0.2 && r < p.aggr && minTo <= maxTo) {
    const size = Math.round((0.6 + p.aggr * 0.5) * pot / SB) * SB;
    return { type: "raise", to: Math.max(minTo, Math.min(s.currentBet + size, maxTo)) };
  }
  return { type: "call" };
}

// ---------- hand lifecycle ----------
function startHand(prev) {
  const players = prev.players.map(p => ({
    ...p,
    cards: [], bet: 0, total: 0, folded: false, allIn: false,
    acted: false, revealed: false, lastAction: null,
    chips: p.ai && p.chips < BB * 20 ? START : p.chips,
  }));
  const deck = freshDeck();
  const dealer = nextSeat(players, prev.dealer, p => p.chips > 0);
  players.forEach(p => { if (p.chips > 0) p.cards = [deck.pop(), deck.pop()]; else p.folded = true; });

  const sb = nextSeat(players, dealer, p => p.chips > 0);
  const bb = nextSeat(players, sb, p => p.chips > 0);
  const post = (i, amt) => {
    const p = players[i];
    const pay = Math.min(amt, p.chips);
    p.chips -= pay; p.bet += pay; p.total += pay;
    if (p.chips === 0) p.allIn = true;
  };
  post(sb, SB); post(bb, BB);

  return {
    ...prev,
    players, deck, dealer, sb, bb,
    board: [], street: "preflop",
    currentBet: BB, minRaise: BB,
    turn: nextSeat(players, bb, canAct),
    stage: "hand",
    result: null,
    handNo: prev.handNo + 1,
  };
}

function finishFolds(s) {
  const alive = s.players.filter(p => !p.folded);
  const w = s.players.findIndex(p => !p.folded);
  const pot = potOf(s);
  s.players[w].chips += pot;
  s.stage = "over";
  s.result = { lines: [{ name: s.players[w].name, amount: pot, label: null, hero: !s.players[w].ai }] };
  return s;
}

function runShowdown(s) {
  // reveal + score
  const scores = s.players.map(p => (!p.folded ? eval7([...p.cards, ...s.board]) : null));
  s.players.forEach(p => { if (!p.folded) p.revealed = true; });

  // side pots
  const levels = [...new Set(s.players.filter(p => p.total > 0).map(p => p.total))].sort((a, b) => a - b);
  let prev = 0;
  const pots = []; // { amount, winners: [seat indices], elig: eligible count }
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
  // street complete
  s.players.forEach(p => { p.bet = 0; p.acted = false; p.lastAction = null; });
  s.currentBet = 0; s.minRaise = BB;

  const actors = s.players.filter(canAct).length;
  const dealNext = () => {
    if (s.street === "preflop") { s.board.push(s.deck.pop(), s.deck.pop(), s.deck.pop()); s.street = "flop"; }
    else if (s.street === "flop") { s.board.push(s.deck.pop()); s.street = "turn"; }
    else if (s.street === "turn") { s.board.push(s.deck.pop()); s.street = "river"; }
  };

  if (actors <= 1) {
    s.players.forEach(p => { if (!p.folded) p.revealed = true; });
    while (s.board.length < 5) dealNext();
    return runShowdown(s);
  }
  if (s.street === "river") return runShowdown(s);
  dealNext();
  s.turn = nextSeat(s.players, s.dealer, canAct);
  return s;
}

function applyAction(prev, idx, action) {
  const s = clone(prev);
  const p = s.players[idx];
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
      s.minRaise = Math.max(s.minRaise, p.bet - s.currentBet);
      s.currentBet = p.bet;
      s.players.forEach((q, i) => { if (i !== idx && !q.folded && !q.allIn) q.acted = false; });
    }
    p.lastAction = p.allIn ? "All-in" : hadBet && s.currentBet > BB ? "Raise" : "Bet";
  }
  p.acted = true;
  return advance(s, idx);
}

// ---------- UI pieces ----------
function CardFace({ card, w = 44, h = 62, fs = 17 }) {
  const m = SUIT_META[card.s];
  return (
    <div style={{
      width: w, height: h, background: C.surface, borderRadius: w * 0.16,
      border: `1px solid ${C.line}`, boxShadow: "0 1px 3px rgba(20,24,33,.10)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      color: m.color, fontFamily: FONT, flexShrink: 0,
    }}>
      <div style={{ fontSize: fs, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em" }}>{RANK_STR[card.r]}</div>
      <div style={{ fontSize: fs * 0.85, lineHeight: 1.2 }}>{m.sym}</div>
    </div>
  );
}

function CardBack({ w = 30, h = 42 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: w * 0.18, background: C.cardBack,
      boxShadow: "0 1px 2px rgba(20,24,33,.2)", position: "relative", flexShrink: 0,
    }}>
      <div style={{
        position: "absolute", inset: 4, borderRadius: w * 0.12,
        border: "1px solid rgba(255,255,255,.14)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "rgba(255,255,255,.35)", fontSize: w * 0.32,
      }}>♠</div>
    </div>
  );
}

function Seat({ p, isTurn, isDealer, folded }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 78, opacity: folded ? 0.38 : 1, transition: "opacity .3s" }}>
      <div style={{ height: 44, display: "flex", alignItems: "flex-end", gap: 3 }}>
        {p.revealed && !p.folded
          ? p.cards.map((c, i) => <CardFace key={i} card={c} w={30} h={42} fs={12} />)
          : !p.folded && p.cards.length
            ? [0, 1].map(i => <CardBack key={i} />)
            : <div style={{ height: 42 }} />}
      </div>
      <div style={{ position: "relative" }}>
        <div style={{
          width: 44, height: 44, borderRadius: 22, background: C.surface,
          border: `2px solid ${isTurn ? C.accent : C.line}`,
          boxShadow: isTurn ? `0 0 0 3px ${C.accent}22` : "none",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21,
          transition: "border-color .2s, box-shadow .2s",
        }}>{p.emoji}</div>
        {isDealer && (
          <div style={{
            position: "absolute", right: -6, bottom: -2, width: 17, height: 17, borderRadius: 9,
            background: C.ink, color: "#fff", fontSize: 9, fontWeight: 800,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>D</div>
        )}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.ink }}>{p.name}</div>
      <div style={{ fontSize: 11, color: C.muted, fontVariantNumeric: "tabular-nums", marginTop: -3 }}>{fmt(p.chips)}</div>
      <div style={{ height: 18 }}>
        {p.bet > 0 ? (
          <div style={{ fontSize: 10, fontWeight: 700, color: C.accent, background: `${C.accent}14`, borderRadius: 9, padding: "2px 8px", fontVariantNumeric: "tabular-nums" }}>
            {fmt(p.bet)}
          </div>
        ) : p.lastAction ? (
          <div style={{ fontSize: 10, fontWeight: 600, color: p.lastAction === "Fold" ? C.faint : C.muted, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 9, padding: "1px 8px" }}>
            {p.lastAction}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Btn({ children, onClick, kind = "ghost", disabled, style }) {
  const base = {
    fontFamily: FONT, fontWeight: 700, fontSize: 15, borderRadius: 14,
    padding: "14px 0", flex: 1, border: "none", cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1, transition: "transform .06s", letterSpacing: "-0.01em",
  };
  const kinds = {
    ghost: { background: "#fff", color: C.ink, border: `1px solid ${C.line}` },
    primary: { background: C.ink, color: "#fff" },
    accent: { background: C.accent, color: "#fff" },
    danger: { background: "#fff", color: C.red, border: `1px solid ${C.line}` },
  };
  return (
    <button disabled={disabled} onClick={onClick}
      onMouseDown={e => !disabled && (e.currentTarget.style.transform = "scale(.97)")}
      onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
      style={{ ...base, ...kinds[kind], ...style }}>
      {children}
    </button>
  );
}

// ---------- App ----------
export default function App() {
  const [screen, setScreen] = useState("home");
  const [game, setGame] = useState(null);
  const [equity, setEquity] = useState(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [session, setSession] = useState({ hands: 0, won: 0, biggest: 0, rebuys: 0 });
  const gameRef = useRef(game);
  gameRef.current = game;

  const newTable = () => {
    const players = [
      { name: "You", emoji: "🙂", ai: false, chips: START, cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, revealed: false, lastAction: null },
      ...AI_SEED.map(a => ({ ...a, ai: true, chips: START, cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, revealed: false, lastAction: null })),
    ];
    const base = { players, dealer: Math.floor(Math.random() * 5), handNo: 0, board: [], deck: [], stage: "hand" };
    setSession({ hands: 0, won: 0, biggest: 0, rebuys: 0 });
    setGame(startHand(base));
    setScreen("game");
    setRaiseOpen(false);
  };

  const hero = game?.players[0];
  const pot = game ? potOf(game) : 0;
  const isHeroTurn = game?.stage === "hand" && game.turn === 0;
  const toCall = game ? Math.max(0, game.currentBet - (hero?.bet || 0)) : 0;

  // AI turns
  useEffect(() => {
    if (!game || game.stage !== "hand") return;
    const p = game.players[game.turn];
    if (!p?.ai) return;
    const turnAt = game.turn, handAt = game.handNo, streetAt = game.street;
    const t = setTimeout(() => {
      setGame(g => {
        if (!g || g.stage !== "hand" || g.turn !== turnAt || g.handNo !== handAt || g.street !== streetAt) return g;
        return applyAction(g, g.turn, decideAI(g, g.turn));
      });
    }, 650 + Math.random() * 850);
    return () => clearTimeout(t);
  }, [game]);

  // hero equity (the learning readout)
  useEffect(() => {
    if (!game || !hero || hero.folded || !hero.cards.length) { setEquity(null); return; }
    if (game.stage === "over") return;
    const nOpp = game.players.filter((p, i) => i !== 0 && !p.folded).length;
    const t = setTimeout(() => {
      const g = gameRef.current;
      if (!g) return;
      setEquity(simEquity(g.players[0].cards, g.board, nOpp, 260));
    }, 60);
    return () => clearTimeout(t);
  }, [game?.handNo, game?.street, game?.players.filter(p => !p.folded).length]);

  // session tracking on hand end
  useEffect(() => {
    if (game?.stage !== "over" || !game.result) return;
    const heroWin = game.result.lines.find(l => l.hero);
    setSession(s => ({
      ...s,
      hands: s.hands + 1,
      won: s.won + (heroWin ? 1 : 0),
      biggest: Math.max(s.biggest, heroWin ? heroWin.amount : 0),
    }));
  }, [game?.stage]);

  const act = a => { setRaiseOpen(false); setGame(g => applyAction(g, 0, a)); };
  const openRaise = () => {
    const minTo = Math.min(game.currentBet + game.minRaise, hero.bet + hero.chips);
    setRaiseTo(minTo);
    setRaiseOpen(true);
  };

  const heroHandText = useMemo(() => {
    if (!hero?.cards.length || hero.folded) return "";
    if (game.board.length >= 3) return handLabel(eval7([...hero.cards, ...game.board]));
    const [a, b] = hero.cards;
    if (a.r === b.r) return `Pocket ${RANK_STR[a.r]}s`;
    return `${RANK_STR[Math.max(a.r, b.r)]} high${a.s === b.s ? " · suited" : ""}`;
  }, [game?.board.length, game?.handNo, hero?.folded]);

  // ---------- screens ----------
  if (screen === "home") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", padding: "0 24px" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 10, minHeight: "60vh" }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              {[{ r: 14, s: 0 }, { r: 13, s: 2 }].map((c, i) => (
                <div key={i} style={{ transform: `rotate(${i ? 7 : -7}deg)` }}><CardFace card={c} w={52} h={72} fs={20} /></div>
              ))}
            </div>
            <h1 style={{ fontSize: 42, fontWeight: 800, letterSpacing: "-0.04em", color: C.ink, margin: 0 }}>Kicker</h1>
            <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.5, margin: 0, maxWidth: 300 }}>
              Clean Texas Hold'em against four AI players. Live win odds on every street — learn as you play.
            </p>
          </div>
          <div style={{ paddingBottom: 40, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", background: "#fff", borderRadius: 16, border: `1px solid ${C.line}` }}>
              <span style={{ color: C.muted, fontSize: 14 }}>Cash game · 5-handed</span>
              <span style={{ color: C.ink, fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>Blinds {SB}/{BB}</span>
            </div>
            <Btn kind="primary" onClick={newTable} style={{ padding: "17px 0", fontSize: 16 }}>Take a seat</Btn>
          </div>
        </div>
      </div>
    );
  }

  if (!game) return null;
  const streetName = { preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River" }[game.street];
  const maxTo = hero.bet + hero.chips;
  const minTo = Math.min(game.currentBet + game.minRaise, maxTo);
  const heroBusted = game.stage === "over" && hero.chips === 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", minHeight: "100vh" }}>

        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px" }}>
          <button onClick={() => setScreen("home")} style={{ background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>← Leave</button>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Hand #{game.handNo} <span style={{ color: C.faint }}>·</span> <span style={{ color: C.muted, fontWeight: 600 }}>{streetName}</span></div>
          <div style={{ fontSize: 12, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{session.won}/{session.hands} won</div>
        </div>

        {/* opponents */}
        <div style={{ display: "flex", justifyContent: "space-around", padding: "4px 8px 0" }}>
          {game.players.slice(1).map((p, i) => (
            <Seat key={p.name} p={p} folded={p.folded} isTurn={game.stage === "hand" && game.turn === i + 1} isDealer={game.dealer === i + 1} />
          ))}
        </div>

        {/* board */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "8px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 20, padding: "6px 16px", fontVariantNumeric: "tabular-nums" }}>
            Pot {fmt(pot)}
          </div>
          <div style={{ display: "flex", gap: 7, height: 66 }}>
            {[0, 1, 2, 3, 4].map(i =>
              game.board[i]
                ? <CardFace key={i} card={game.board[i]} w={47} h={66} fs={18} />
                : <div key={i} style={{ width: 47, height: 66, borderRadius: 8, border: `1.5px dashed ${C.faint}`, opacity: 0.5 }} />
            )}
          </div>

          {/* result banner */}
          {game.stage === "over" && game.result && (
            <div style={{ background: C.ink, color: "#fff", borderRadius: 16, padding: "12px 20px", textAlign: "center", boxShadow: "0 8px 24px rgba(20,24,33,.25)" }}>
              {game.result.lines.map((l, i) => (
                <div key={i} style={{ fontSize: 14, fontWeight: 600 }}>
                  <span style={{ color: l.hero ? "#7EF0B0" : "#fff" }}>{l.name}</span>
                  {l.pot === "returned" ? " gets " : " wins "}
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{fmt(l.amount)}</span>
                  {l.pot === "returned" ? (
                    <span style={{ color: "rgba(255,255,255,.6)" }}> back (uncalled bet)</span>
                  ) : (
                    <>
                      {l.label && <span style={{ color: "rgba(255,255,255,.6)" }}> · {l.label}</span>}
                      {l.pot && <span style={{ color: "rgba(255,255,255,.6)" }}> ({l.pot})</span>}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* hero */}
        <div style={{ padding: "0 16px 8px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", gap: 8, opacity: hero.folded ? 0.35 : 1 }}>
              {hero.cards.map((c, i) => <CardFace key={i} card={c} w={62} h={88} fs={25} />)}
            </div>
          </div>
          <div style={{ textAlign: "right", paddingBottom: 4 }}>
            <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 3 }}>
              {hero.folded ? "Folded" : heroHandText}
              {game.dealer === 0 && <span style={{ marginLeft: 6, background: C.ink, color: "#fff", borderRadius: 8, padding: "1px 6px", fontSize: 10, fontWeight: 800 }}>D</span>}
            </div>
            {/* equity readout — the signature */}
            {!hero.folded && equity !== null && game.stage === "hand" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", color: equity > 0.5 ? C.green : C.ink, fontVariantNumeric: "tabular-nums" }}>
                  {(equity * 100).toFixed(0)}<span style={{ fontSize: 14, color: C.muted, fontWeight: 700 }}>% to win</span>
                </div>
                <div style={{ width: 110, height: 5, borderRadius: 3, background: C.line, overflow: "hidden" }}>
                  <div style={{ width: `${equity * 100}%`, height: "100%", background: equity > 0.5 ? C.green : C.accent, transition: "width .5s ease" }} />
                </div>
              </div>
            )}
            <div style={{ fontSize: 13, color: C.ink, fontWeight: 700, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
              {fmt(hero.chips)} <span style={{ color: C.muted, fontWeight: 600 }}>chips</span>
              {hero.bet > 0 && <span style={{ color: C.accent }}> · {fmt(hero.bet)} in</span>}
            </div>
          </div>
        </div>

        {/* action bar */}
        <div style={{ padding: "10px 16px 26px", borderTop: `1px solid ${C.line}`, background: "#F7F8FA" }}>
          {game.stage === "over" ? (
            heroBusted ? (
              <Btn kind="accent" onClick={() => {
                setSession(s => ({ ...s, rebuys: s.rebuys + 1 }));
                setGame(g => { const n = clone(g); n.players[0].chips = START; return startHand(n); });
              }}>Rebuy {fmt(START)} & deal</Btn>
            ) : (
              <Btn kind="primary" onClick={() => setGame(g => startHand(g))}>Next hand</Btn>
            )
          ) : !isHeroTurn ? (
            <div style={{ textAlign: "center", color: C.muted, fontSize: 14, fontWeight: 600, padding: "14px 0" }}>
              {hero.folded ? "Waiting for the hand to finish…" : `${game.players[game.turn].name} is thinking…`}
            </div>
          ) : raiseOpen ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>Raise to</span>
                <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: C.ink }}>{fmt(raiseTo)}</span>
              </div>
              <input type="range" min={minTo} max={maxTo} step={SB} value={raiseTo}
                onChange={e => setRaiseTo(+e.target.value)}
                style={{ width: "100%", accentColor: C.accent }} />
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  ["Min", minTo],
                  ["½ pot", Math.min(maxTo, game.currentBet + Math.round((pot * 0.5) / SB) * SB)],
                  ["Pot", Math.min(maxTo, game.currentBet + Math.round(pot / SB) * SB)],
                  ["All-in", maxTo],
                ].map(([lab, v]) => (
                  <button key={lab} onClick={() => setRaiseTo(Math.max(minTo, v))}
                    style={{ flex: 1, fontFamily: FONT, fontSize: 12, fontWeight: 700, padding: "8px 0", borderRadius: 10, border: `1px solid ${C.line}`, background: raiseTo === Math.max(minTo, v) ? C.ink : "#fff", color: raiseTo === Math.max(minTo, v) ? "#fff" : C.ink, cursor: "pointer" }}>
                    {lab}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn onClick={() => setRaiseOpen(false)}>Back</Btn>
                <Btn kind="accent" onClick={() => act({ type: "raise", to: raiseTo })} style={{ flex: 2 }}>
                  {raiseTo >= maxTo ? "All-in" : `Raise to ${fmt(raiseTo)}`}
                </Btn>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <Btn kind="danger" onClick={() => act({ type: "fold" })}>Fold</Btn>
              <Btn kind="ghost" onClick={() => act({ type: "call" })}>
                {toCall === 0 ? "Check" : `Call ${fmt(Math.min(toCall, hero.chips))}`}
              </Btn>
              <Btn kind="accent" onClick={openRaise} disabled={hero.chips <= toCall}>
                {game.currentBet > 0 ? "Raise" : "Bet"}
              </Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
