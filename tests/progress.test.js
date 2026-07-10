import { describe, it, expect } from "vitest";
import {
  xpFromStats, xpForLevel, levelFromXp,
  ACHIEVEMENTS, unlockedAchievements, newlyUnlocked,
  normalizeDaily, bumpDaily, questProgress, EMPTY_DAILY,
  rewardsErrorMessage, DAILY_POOL,
} from "../src/progress.js";
import { EMPTY_STATS } from "../src/storage.js";

describe("xp & levels", () => {
  it("zero stats = level 1 with zero xp", () => {
    expect(xpFromStats(EMPTY_STATS)).toBe(0);
    expect(levelFromXp(0)).toMatchObject({ level: 1, intoLevel: 0 });
    expect(xpFromStats(null)).toBe(0);
  });

  it("meaningful play earns more than volume alone", () => {
    const folder = xpFromStats({ hands: 100 });
    const winner = xpFromStats({ hands: 100, won: 40, showdowns: 50, tourneys: 2, tourneyWins: 1 });
    expect(winner).toBeGreaterThan(folder * 2);
  });

  it("level thresholds are strictly increasing and levelFromXp is consistent", () => {
    for (let l = 1; l < 30; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    for (const xp of [0, 499, 500, 1500, 4999, 5000, 123456]) {
      const lv = levelFromXp(xp);
      expect(xpForLevel(lv.level)).toBeLessThanOrEqual(xp);
      expect(xpForLevel(lv.level + 1)).toBeGreaterThan(xp);
      expect(lv.frac).toBeGreaterThanOrEqual(0);
      expect(lv.frac).toBeLessThanOrEqual(1);
    }
  });
});

describe("achievements", () => {
  it("nothing unlocked on empty stats, everything unlockable", () => {
    expect(unlockedAchievements(EMPTY_STATS).size).toBe(0);
    const maxed = { hands: 5000, won: 2000, showdowns: 900, biggestPot: 99999,
      fullHouses: 5, quads: 2, straightFlushes: 1, royals: 1, tourneys: 10, tourneyWins: 3 };
    expect(unlockedAchievements(maxed).size).toBe(ACHIEVEMENTS.length);
  });

  it("ids are unique and stable-looking", () => {
    const ids = ACHIEVEMENTS.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("newlyUnlocked reports only the transition", () => {
    const before = { ...EMPTY_STATS, hands: 1 };
    const after = { ...before, won: 1, hands: 2 };
    const fresh = newlyUnlocked(before, after);
    expect(fresh.map(a => a.id)).toEqual(["first-win"]);
    expect(newlyUnlocked(after, after)).toEqual([]);
  });

  it("survives junk stats", () => {
    expect(() => unlockedAchievements(null)).not.toThrow();
    expect(() => unlockedAchievements({ hands: "lots" })).not.toThrow();
  });
});

describe("daily quest progress", () => {
  const today = "2026-07-09";

  it("normalizeDaily resets stale or junk state", () => {
    expect(normalizeDaily(null, today)).toEqual({ ...EMPTY_DAILY, date: today });
    expect(normalizeDaily({ date: "2026-07-08", hands: 9 }, today).hands).toBe(0);
    expect(normalizeDaily({ date: today, hands: -3, wins: "x" }, today)).toMatchObject({ hands: 0, wins: 0 });
  });

  it("bumpDaily counts hands, wins, showdowns and big-hand wins", () => {
    let p = bumpDaily(null, { won: true, showdown: true, category: 6 }, today);
    p = bumpDaily(p, { won: true, showdown: false }, today);
    p = bumpDaily(p, { won: false, showdown: true, category: 1 }, today);
    expect(p).toMatchObject({ hands: 3, wins: 2, showdowns: 2, bigwins: 1 });
  });

  it("two pair is the big-hand floor; a pair win at showdown doesn't count", () => {
    expect(bumpDaily(null, { won: true, showdown: true, category: 2 }, today).bigwins).toBe(1);
    expect(bumpDaily(null, { won: true, showdown: true, category: 1 }, today).bigwins).toBe(0);
    expect(bumpDaily(null, { won: true, showdown: false, category: 6 }, today).bigwins).toBe(0);
  });

  it("questProgress maps quests to counters and unknown ids to 0", () => {
    const p = { date: today, hands: 7, wins: 3, showdowns: 4, bigwins: 2 };
    expect(questProgress("q-hands5", p)).toBe(7);
    expect(questProgress("q-win2", p)).toBe(3);
    expect(questProgress("q-showdown3", p)).toBe(4);
    expect(questProgress("q-bighand", p)).toBe(2);
    expect(questProgress("q-unknown", p)).toBe(0);
  });
});

describe("rewards copy", () => {
  it("maps errors to friendly cash-free copy and shows the pool", () => {
    for (const code of ["claimed", "not_found", "unauthorized", undefined]) {
      const msg = rewardsErrorMessage(code);
      expect(msg).toBeTruthy();
      expect(msg.toLowerCase()).not.toMatch(/money|cash|\$|usd/);
    }
    expect(DAILY_POOL.length).toBeGreaterThan(0);
    for (const p of DAILY_POOL) { expect(p.label).toBeTruthy(); expect(p.amount).toBeGreaterThan(0); }
  });
});
