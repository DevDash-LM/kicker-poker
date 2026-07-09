// Drift guards: the client's copy of server-defined numbers must match the
// SQL that actually pays/charges. These parse supabase/schema.sql so a tuning
// change in one place fails loudly instead of silently lying to players.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { DAILY_POOL, DAILY_STREAK_BONUS, DAILY_STREAK_CAP } from "../src/progress.js";
import { CARD_BACKS, CHIP_STYLES, FELTS, slotOfItem } from "../src/cosmetics.js";

const schema = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase/schema.sql"),
  "utf-8"
);

describe("daily reward copy matches claim_daily()", () => {
  it("pool amounts shown in the app equal the SQL payouts", () => {
    // base := case when r = 14 then A when r >= 10 then B else C end;
    const m = schema.match(/base\s*:=\s*case when r = 14 then (\d+) when r >= 10 then (\d+) else (\d+) end/);
    expect(m).toBeTruthy();
    const [ace, face, low] = [Number(m[1]), Number(m[2]), Number(m[3])];
    expect(DAILY_POOL.find(p => p.label === "Ace").amount).toBe(ace);
    expect(DAILY_POOL.find(p => p.label === "10–K").amount).toBe(face);
    expect(DAILY_POOL.find(p => p.label === "2–9").amount).toBe(low);
  });

  it("streak bonus and cap match the SQL", () => {
    const m = schema.match(/bonus\s*:=\s*least\(stk - 1, (\d+)\) \* (\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBe(DAILY_STREAK_CAP);
    expect(Number(m[2])).toBe(DAILY_STREAK_BONUS);
  });
});

describe("cosmetics catalog matches client visuals", () => {
  // Every id seeded into public.cosmetics must have a client-side visual in
  // the right slot table, or the shop would show items that render as the
  // default. (Extra client visuals without catalog rows are fine.)
  const seeded = [...schema.matchAll(/\('((?:cb|ch|ft)-[a-z0-9-]+)',\s*'(cardback|chips|felt)'/g)]
    .map(m => ({ id: m[1], type: m[2] }));

  it("finds the seeded catalog", () => {
    expect(seeded.length).toBeGreaterThanOrEqual(12);
  });

  it("every seeded item has a visual in the matching slot", () => {
    for (const { id, type } of seeded) {
      expect(slotOfItem(id), `${id} should be a ${type} visual`).toBe(type);
    }
  });

  it("defaults exist in each slot's visual table", () => {
    expect(CARD_BACKS["cb-classic"]).toBeDefined();
    expect(CHIP_STYLES["ch-classic"]).toBeDefined();
    expect("ft-classic" in FELTS).toBe(true);
  });
});

describe("economy sanity", () => {
  it("starter chips cover the default table and the cheapest cosmetics", () => {
    const starter = Number(schema.match(/'starter',\s*(\d+)/)[1]);
    const prices = [...schema.matchAll(/\('(?:cb|ch|ft)-[a-z0-9-]+',\s*'(?:cardback|chips|felt)',\s*'[^']+',\s*'(?:default|common|rare|epic)',\s*(\d+)/g)]
      .map(m => Number(m[1])).filter(p => p > 0);
    expect(starter).toBeGreaterThanOrEqual(10000); // default stack buy-in
    expect(Math.min(...prices)).toBeLessThanOrEqual(starter); // something is earnable day one
    expect(Math.max(...prices)).toBeGreaterThan(starter); // rares stay aspirational
  });

  it("no reward or price mentions real money anywhere in the schema", () => {
    expect(schema.toLowerCase()).not.toMatch(/cash.?out to money|usd|dollar|payout to bank/);
  });
});
