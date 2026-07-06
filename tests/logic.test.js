import { describe, it, expect } from "vitest";
import {
  SB, BB, START,
  freshDeck, eval5, eval7, cmpScore, handLabel, simEquity,
  potOf, startHand, applyAction, decideAI, stepRunout, runoutEquities, AI_SEED,
} from "../src/game/logic.js";

const c = (r, s) => ({ r, s });
const mkPlayer = (name, chips, ai = true, extra = {}) => ({
  name, emoji: "x", ai, chips, cards: [], bet: 0, total: 0,
  folded: false, allIn: false, acted: false, revealed: false, lastAction: null,
  aggr: 0.5, loose: 0.5, ...extra,
});
const mkGame = (n = 5, chips = START, dealer = 0) => startHand({
  players: [mkPlayer("You", chips, false), ...Array.from({ length: n - 1 }, (_, i) => mkPlayer("AI" + i, chips))],
  dealer, handNo: 0, board: [], deck: [], stage: "hand",
});

describe("hand evaluator", () => {
  it("ranks every category correctly", () => {
    expect(eval5([c(14,0),c(13,0),c(12,0),c(11,0),c(10,0)])[0]).toBe(8);
    expect(eval5([c(9,1),c(9,2),c(9,3),c(9,0),c(2,0)])[0]).toBe(7);
    expect(eval5([c(9,1),c(9,2),c(9,3),c(2,1),c(2,0)])[0]).toBe(6);
    expect(eval5([c(2,0),c(5,0),c(9,0),c(11,0),c(13,0)])[0]).toBe(5);
    expect(eval5([c(9,0),c(8,1),c(7,2),c(6,3),c(5,0)])[0]).toBe(4);
    expect(eval5([c(7,0),c(7,1),c(7,2),c(4,3),c(5,0)])[0]).toBe(3);
    expect(eval5([c(7,0),c(7,1),c(4,2),c(4,3),c(5,0)])[0]).toBe(2);
    expect(eval5([c(7,0),c(7,1),c(4,2),c(3,3),c(5,0)])[0]).toBe(1);
    expect(eval5([c(7,0),c(9,1),c(4,2),c(3,3),c(14,0)])[0]).toBe(0);
  });
  it("handles the wheel (A-5 straight) as five-high", () => {
    const s = eval5([c(14,0),c(2,1),c(3,2),c(4,3),c(5,0)]);
    expect(s[0]).toBe(4);
    expect(s[1]).toBe(5);
  });
  it("compares kickers", () => {
    const aces9 = eval5([c(14,0),c(14,1),c(13,2),c(9,3),c(2,0)]);
    const acesT = eval5([c(14,2),c(14,3),c(12,2),c(11,3),c(10,0)]);
    expect(cmpScore(aces9, acesT)).toBeGreaterThan(0);
  });
  it("eval7 finds the best five of seven", () => {
    const s = eval7([c(14,0),c(13,0),c(12,0),c(11,0),c(10,0),c(2,1),c(2,2)]);
    expect(s[0]).toBe(8);
    expect(handLabel(s)).toBe("Royal flush");
  });
  it("deck has 52 unique cards", () => {
    const d = freshDeck();
    expect(d.length).toBe(52);
    expect(new Set(d.map(x => x.r * 4 + x.s)).size).toBe(52);
  });
  it("pocket aces have high preflop equity heads-up", () => {
    const eq = simEquity([c(14,0),c(14,1)], [], 1, 300);
    expect(eq).toBeGreaterThan(0.75);
    expect(eq).toBeLessThanOrEqual(1);
  });
});

describe("blinds", () => {
  it("3+ handed: SB is left of dealer, BB next, UTG acts first", () => {
    const g = mkGame(5, START, 0);
    expect(g.dealer).toBe(1);
    expect(g.sb).toBe(2);
    expect(g.bb).toBe(3);
    expect(g.players[2].bet).toBe(SB);
    expect(g.players[3].bet).toBe(BB);
    expect(g.turn).toBe(4);
  });
  it("heads-up: dealer posts SB and acts first preflop", () => {
    const g = mkGame(2, START, 0);
    expect(g.dealer).toBe(1);
    expect(g.sb).toBe(1);
    expect(g.bb).toBe(0);
    expect(g.players[1].bet).toBe(SB);
    expect(g.players[0].bet).toBe(BB);
    expect(g.turn).toBe(1);
  });
  it("heads-up: non-dealer acts first postflop", () => {
    let g = mkGame(2, START, 0);
    g = applyAction(g, 1, { type: "call" });
    g = applyAction(g, 0, { type: "call" });
    expect(g.street).toBe("flop");
    expect(g.turn).toBe(0);
  });
  it("BB gets the option preflop after limps", () => {
    let g = mkGame(3, START, 0);
    g = applyAction(g, g.turn, { type: "call" });
    g = applyAction(g, g.turn, { type: "call" });
    expect(g.street).toBe("preflop");
    expect(g.turn).toBe(g.bb);
  });
});

describe("incomplete (short all-in) raise", () => {
  const setup = () => {
    let g = mkGame(3, START, 0);
    g = applyAction(g, 1, { type: "call" });
    g = applyAction(g, 2, { type: "call" });
    g = applyAction(g, 0, { type: "call" });
    expect(g.street).toBe("flop");
    g.players[0].chips = 1300;
    g = applyAction(g, 2, { type: "raise", to: 1000 });
    g = applyAction(g, 0, { type: "raise", to: 1300 });
    return g;
  };
  it("does not reopen betting for a player who already acted", () => {
    let g = setup();
    expect(g.players[0].allIn).toBe(true);
    expect(g.currentBet).toBe(1300);
    expect(g.minRaise).toBe(1000);
    g = applyAction(g, 1, { type: "fold" });
    expect(g.turn).toBe(2);
    g = applyAction(g, 2, { type: "raise", to: 5000 });
    expect(g.players[2].bet === 0 || g.stage === "over" || g.street !== "flop").toBe(true);
    expect(g.players[2].total).toBe(100 + 1300);
  });
  it("still allows a raise from a player who had not yet acted", () => {
    let g = setup();
    expect(g.turn).toBe(1);
    g = applyAction(g, 1, { type: "raise", to: 2300 });
    expect(g.currentBet).toBe(2300);
    expect(g.minRaise).toBe(1000);
    expect(g.players[2].acted).toBe(false);
  });
  it("a full raise still reopens betting", () => {
    let g = mkGame(3, START, 0);
    g = applyAction(g, 1, { type: "raise", to: 300 });
    g = applyAction(g, 2, { type: "raise", to: 600 });
    expect(g.players[1].acted).toBe(false);
    g = applyAction(g, 0, { type: "fold" });
    g = applyAction(g, 1, { type: "raise", to: 1200 });
    expect(g.players[1].bet).toBe(1200);
  });
});

describe("pots and payouts", () => {
  it("returns the uncalled portion of a bet on a fold-out", () => {
    let g = mkGame(5, START, 0);
    const shover = g.turn;
    g = applyAction(g, g.turn, { type: "raise", to: START });
    while (g.stage === "hand") g = applyAction(g, g.turn, { type: "fold" });
    const main = g.result.lines.find(l => !l.pot);
    const ret = g.result.lines.find(l => l.pot === "returned");
    expect(main.amount).toBe(SB + BB + BB);
    expect(ret.amount).toBe(START - BB);
    expect(g.players[shover].chips).toBe(START + SB + BB);
  });
  it("BB wins blinds when everyone folds", () => {
    let g = mkGame(5, START, 0);
    while (g.stage === "hand") g = applyAction(g, g.turn, { type: "fold" });
    const main = g.result.lines.find(l => !l.pot);
    const ret = g.result.lines.find(l => l.pot === "returned");
    expect(main.amount).toBe(BB);
    expect(ret.amount).toBe(SB);
  });
  it("builds side pots correctly at showdown", () => {
    let g = mkGame(3, START, 0);
    g.players[1].chips = 900;
    g.players[0].cards = [c(14,0), c(14,1)];
    g.players[1].cards = [c(13,0), c(13,1)];
    g.players[2].cards = [c(2,0), c(3,1)];
    g.deck = [c(5,2), c(6,3), c(2,2), c(7,3), c(9,2), c(4,3), c(11,2)];
    g = applyAction(g, 1, { type: "raise", to: 1000 });
    g = applyAction(g, 2, { type: "raise", to: 5000 });
    g = applyAction(g, 0, { type: "call" });
    while (g.stage === "hand" || g.stage === "runout")
      g = g.stage === "runout" ? stepRunout(g) : applyAction(g, g.turn, { type: "call" });
    expect(g.stage).toBe("over");
    const heroLines = g.result.lines.filter(l => l.name === "You");
    const heroWon = heroLines.reduce((t, l) => t + l.amount, 0);
    expect(heroWon).toBe(900 * 3 + (5000 - 900) * 2);
    const total = g.result.lines.reduce((t, l) => t + l.amount, 0);
    expect(total).toBe(900 + 5000 + 5000);
  });
  it("splits ties evenly", () => {
    let g = mkGame(2, START, 0);
    g.players[0].cards = [c(14,0), c(13,0)];
    g.players[1].cards = [c(14,1), c(13,1)];
    g.deck = [c(2,2), c(7,3), c(9,2), c(4,3), c(11,2)];
    g = applyAction(g, g.turn, { type: "call" });
    g = applyAction(g, g.turn, { type: "call" });
    while (g.stage === "hand" || g.stage === "runout")
      g = g.stage === "runout" ? stepRunout(g) : applyAction(g, g.turn, { type: "call" });
    const amounts = g.result.lines.map(l => l.amount);
    expect(amounts[0]).toBe(amounts[1]);
    expect(amounts[0] + amounts[1]).toBe(BB * 2);
  });
});

describe("chip conservation", () => {
  it("total chips never change across 300 random hands", () => {
    let g = mkGame(5, START, 0);
    for (let h = 0; h < 300; h++) {
      const before = g.players.reduce((t, p) => t + p.chips + p.total, 0);
      let guard = 0;
      while ((g.stage === "hand" || g.stage === "runout") && guard++ < 300) {
        if (g.stage === "runout") { g = stepRunout(g); continue; }
        const i = g.turn;
        const acts = [
          { type: "call" }, { type: "fold" },
          { type: "raise", to: Math.min(g.currentBet + g.minRaise, g.players[i].bet + g.players[i].chips) },
        ];
        const a = g.players[i].ai ? decideAI(g, i) : acts[Math.floor(Math.random() * 3)];
        g = applyAction(g, i, a);
      }
      expect(guard).toBeLessThan(300);
      expect(g.players.reduce((t, p) => t + p.chips, 0)).toBe(before);
      expect(g.result.lines.length).toBeGreaterThan(0);
      g = startHand(g);
    }
  });
});

describe("configurable table", () => {
  const mk = (blinds, stack) => startHand({
    players: [
      { name: "You", emoji: "x", ai: false, chips: stack, cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, revealed: false, lastAction: null },
      { name: "A", emoji: "x", ai: true, aggr: .5, loose: .5, chips: stack, cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, revealed: false, lastAction: null },
      { name: "B", emoji: "x", ai: true, aggr: .5, loose: .5, chips: stack, cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, revealed: false, lastAction: null },
    ],
    dealer: 0, handNo: 0, board: [], deck: [], stage: "hand", blinds, startStack: stack,
  });
  it("posts configured blinds and sets min raise from them", () => {
    const g = mk({ sb: 100, bb: 200 }, 20000);
    expect(g.players[g.sb].bet).toBe(100);
    expect(g.players[g.bb].bet).toBe(200);
    expect(g.currentBet).toBe(200);
    expect(g.minRaise).toBe(200);
  });
  it("resets min raise to the configured big blind on new streets", () => {
    let g = mk({ sb: 250, bb: 500 }, 50000);
    while (g.street === "preflop" && g.stage === "hand") g = applyAction(g, g.turn, { type: "call" });
    expect(g.street).toBe("flop");
    expect(g.minRaise).toBe(500);
  });
  it("falls back to default blinds when none configured", () => {
    const g = mkGame(3, START, 0);
    expect(g.players[g.sb].bet).toBe(SB);
    expect(g.players[g.bb].bet).toBe(BB);
  });
});

describe("all-in runout", () => {
  const shoveCall = () => {
    let g = mkGame(2, START, 0);
    g = applyAction(g, g.turn, { type: "raise", to: START });
    g = applyAction(g, g.turn, { type: "call" });
    return g;
  };
  it("enters a staged runout instead of settling instantly", () => {
    let g = shoveCall();
    expect(g.stage).toBe("runout");
    expect(g.board.length).toBe(0);
    expect(g.players.every(p => p.folded || p.revealed)).toBe(true);
    g = stepRunout(g); expect(g.board.length).toBe(3); expect(g.stage).toBe("runout");
    g = stepRunout(g); expect(g.board.length).toBe(4); expect(g.stage).toBe("runout");
    g = stepRunout(g); expect(g.board.length).toBe(5); expect(g.stage).toBe("runout");
    g = stepRunout(g);
    expect(g.stage).toBe("over");
    expect(g.result.lines.length).toBeGreaterThan(0);
    expect(g.players.reduce((t, p) => t + p.chips, 0)).toBe(START * 2);
  });
  it("does not stagger when betting can continue", () => {
    let g = mkGame(2, START, 0);
    g = applyAction(g, g.turn, { type: "call" });
    g = applyAction(g, g.turn, { type: "call" });
    expect(g.stage).toBe("hand");
    expect(g.street).toBe("flop");
  });
  it("computes exact live equities that sum to 1", () => {
    let g = shoveCall();
    g.players[0].cards = [c(14, 0), c(14, 1)];
    g.players[1].cards = [c(13, 0), c(13, 1)];
    g.deck = [c(2, 2), c(7, 3), c(9, 2), c(4, 3), c(11, 2)];
    let eq = runoutEquities(g.players, g.board);
    expect(eq[0] + eq[1]).toBeCloseTo(1, 6);
    expect(eq[0]).toBeGreaterThan(0.6);
    g = stepRunout(g);
    eq = runoutEquities(g.players, g.board);
    expect(eq[0] + eq[1]).toBeCloseTo(1, 9);
    expect(eq[0]).toBeGreaterThan(0.85);
    g = stepRunout(g); g = stepRunout(g);
    eq = runoutEquities(g.players, g.board);
    expect(eq[0]).toBe(1);
    expect(eq[1]).toBe(0);
  });
  it("returns null for folded players and skips them", () => {
    let g = mkGame(3, START, 0);
    g = applyAction(g, g.turn, { type: "fold" });
    g = applyAction(g, g.turn, { type: "raise", to: START });
    g = applyAction(g, g.turn, { type: "call" });
    expect(g.stage).toBe("runout");
    const eq = runoutEquities(g.players, g.board);
    const folded = g.players.findIndex(p => p.folded);
    expect(eq[folded]).toBeNull();
    const live = eq.filter(x => x !== null);
    expect(live.length).toBe(2);
    expect(live[0] + live[1]).toBeCloseTo(1, 6);
  });
});
