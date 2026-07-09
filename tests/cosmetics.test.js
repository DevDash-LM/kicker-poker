import { describe, it, expect } from "vitest";
import {
  CARD_BACKS, CHIP_STYLES, FELTS, SLOTS, DEFAULT_EQUIPPED,
  cardBackDesign, chipDesign, feltBackground, slotOfItem,
  normalizeEquipped, shopErrorMessage, TIER_LABEL,
} from "../src/cosmetics.js";

describe("cosmetic lookups never render blank", () => {
  it("falls back to the default design for unknown ids", () => {
    expect(cardBackDesign("nope")).toBe(CARD_BACKS["cb-classic"]);
    expect(chipDesign(undefined)).toBe(CHIP_STYLES["ch-classic"]);
    expect(feltBackground("nope", true)).toBeNull();
  });

  it("default card back and chips defer to the theme (bg null)", () => {
    expect(CARD_BACKS["cb-classic"].bg).toBeNull();
    expect(CHIP_STYLES["ch-classic"].bg).toBeNull();
    expect(FELTS["ft-classic"]).toBeNull();
  });

  it("every non-default felt has both light and dark variants", () => {
    for (const [id, f] of Object.entries(FELTS)) {
      if (f) { expect(f.light, id).toBeTruthy(); expect(f.dark, id).toBeTruthy(); }
    }
  });
});

describe("slot mapping", () => {
  it("maps every visual id to its slot", () => {
    for (const id of Object.keys(CARD_BACKS)) expect(slotOfItem(id)).toBe("cardback");
    for (const id of Object.keys(CHIP_STYLES)) expect(slotOfItem(id)).toBe("chips");
    for (const id of Object.keys(FELTS)) expect(slotOfItem(id)).toBe("felt");
    expect(slotOfItem("mystery")).toBeNull();
  });

  it("defaults cover every slot", () => {
    for (const slot of SLOTS) expect(slotOfItem(DEFAULT_EQUIPPED[slot])).toBe(slot);
  });
});

describe("normalizeEquipped hardens untrusted input", () => {
  it("keeps valid ids in the right slots", () => {
    const n = normalizeEquipped({ cardback: "cb-royal", chips: "ch-gold", felt: "ft-navy" });
    expect(n).toEqual({ cardback: "cb-royal", chips: "ch-gold", felt: "ft-navy" });
  });

  it("rejects wrong-slot ids, junk, and non-objects", () => {
    expect(normalizeEquipped({ cardback: "ch-gold" })).toEqual(DEFAULT_EQUIPPED);
    expect(normalizeEquipped({ felt: 42, chips: {} })).toEqual(DEFAULT_EQUIPPED);
    expect(normalizeEquipped(null)).toEqual(DEFAULT_EQUIPPED);
    expect(normalizeEquipped("cb-royal")).toEqual(DEFAULT_EQUIPPED);
  });

  it("never returns extra keys", () => {
    const n = normalizeEquipped({ cardback: "cb-royal", deck: "stacked", x: 1 });
    expect(Object.keys(n).sort()).toEqual([...SLOTS].sort());
  });
});

describe("shop copy", () => {
  it("maps every RPC error to friendly, cash-free copy", () => {
    for (const code of ["insufficient", "not_found", "not_owned", "not_for_sale", "bad_slot", "unauthorized", undefined]) {
      const msg = shopErrorMessage(code);
      expect(msg).toBeTruthy();
      expect(msg.toLowerCase()).not.toMatch(/money|cash|\$|usd/);
    }
  });

  it("labels every tier", () => {
    for (const t of ["default", "common", "rare", "epic"]) expect(TIER_LABEL[t]).toBeTruthy();
  });
});
