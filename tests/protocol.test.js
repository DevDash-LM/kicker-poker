import { describe, it, expect } from "vitest";
import { redactFor, makeCode, sanitizeName, validAction, validConfig, mkPlayer } from "../server/protocol.js";
import { startHand } from "../src/game/logic.js";

const mkGame = (n = 3) => startHand({
  players: Array.from({ length: n }, (_, i) => mkPlayer(`P${i}`, "🙂", false, 10000)),
  dealer: 0, handNo: 0, board: [], deck: [], stage: "hand",
  blinds: { sb: 50, bb: 100 }, startStack: 10000,
});

describe("redaction & rotation", () => {
  it("puts the viewer at index 0 and remaps seat indexes", () => {
    const g = mkGame(3);
    for (let seat = 0; seat < 3; seat++) {
      const v = redactFor(g, seat);
      expect(v.players[0].name).toBe(`P${seat}`);
      expect(v.players[v.turn].name).toBe(g.players[g.turn].name);
      expect(v.players[v.dealer].name).toBe(g.players[g.dealer].name);
      expect(v.players[v.sb].name).toBe(g.players[g.sb].name);
      expect(v.players[v.bb].name).toBe(g.players[g.bb].name);
    }
  });
  it("hides everyone else's hole cards and the deck", () => {
    const g = mkGame(3);
    const v = redactFor(g, 1);
    expect(v.deck).toEqual([]);
    expect(v.players[0].cards[0].r).toBeDefined();
    expect(v.players[1].cards[0].hidden).toBe(true);
    expect(v.players[2].cards[0].hidden).toBe(true);
  });
  it("reveals cards at showdown", () => {
    const g = mkGame(3);
    g.players[2].revealed = true;
    const v = redactFor(g, 0);
    const shown = v.players.find(p => p.name === "P2");
    expect(shown.cards[0].r).toBeDefined();
  });
  it("does not mutate the source game", () => {
    const g = mkGame(3);
    const before = JSON.stringify(g);
    redactFor(g, 1);
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe("input validation", () => {
  it("room codes are 4 unambiguous letters", () => {
    const code = makeCode(new Map());
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
  });
  it("sanitizes names", () => {
    expect(sanitizeName("")).toBe("Guest");
    expect(sanitizeName("x".repeat(40)).length).toBe(14);
    expect(sanitizeName("Bob<>&\"'!")).toBe("Bob'");
  });
  it("rejects malformed actions", () => {
    expect(validAction({ type: "raise", to: NaN })).toBeNull();
    expect(validAction({ type: "raise", to: -5 })).toBeNull();
    expect(validAction({ type: "nuke" })).toBeNull();
    expect(validAction({ type: "raise", to: 500.9 })).toEqual({ type: "raise", to: 500 });
    expect(validAction({ type: "fold", extra: 1 })).toEqual({ type: "fold" });
  });
  it("clamps configs to known presets", () => {
    expect(validConfig({ sb: 1, bb: 7, stack: 123, fillAI: "yes" })).toEqual({ sb: 50, bb: 100, stack: 10000, fillAI: true });
    expect(validConfig({ sb: 250, bb: 500, stack: 50000, fillAI: false })).toEqual({ sb: 250, bb: 500, stack: 50000, fillAI: false });
  });
});
