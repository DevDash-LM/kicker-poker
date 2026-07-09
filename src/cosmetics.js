// Cosmetic visual definitions + equipped-state helpers. Pure presentation:
// item ids, prices, and ownership are server-authoritative (supabase/schema.sql);
// this module only knows how each id should LOOK. Unknown or missing ids
// always fall back to the default look so the game can never render blank.

// ---- card backs ------------------------------------------------------------
// bg null = use the theme's C.cardBack (keeps the default adapting to
// light/dark exactly as before cosmetics existed).
export const CARD_BACKS = {
  "cb-classic":  { bg: null,      edge: "rgba(255,255,255,.14)", logo: "rgba(255,255,255,.22)" },
  "cb-crimson":  { bg: "#571E26", edge: "rgba(255,255,255,.16)", logo: "rgba(255,255,255,.30)" },
  "cb-emerald":  { bg: "#1B4A38", edge: "rgba(255,255,255,.16)", logo: "rgba(255,255,255,.30)" },
  "cb-royal":    { bg: "#2E2050", edge: "rgba(216,180,90,.40)",  logo: "rgba(216,180,90,.45)" },
  "cb-carbon":   { bg: "#24272C", edge: "rgba(255,255,255,.12)", logo: "rgba(255,255,255,.26)",
                   texture: "repeating-linear-gradient(135deg, rgba(255,255,255,.05) 0 2px, transparent 2px 6px)" },
  "cb-midnight": { bg: "#0B0E14", edge: "rgba(217,166,43,.50)",  logo: "rgba(217,166,43,.60)" },
};

// ---- chip styles -----------------------------------------------------------
// bg null = theme accent (current behavior).
export const CHIP_STYLES = {
  "ch-classic": { bg: null,      ring: "rgba(255,255,255,.8)" },
  "ch-jade":    { bg: "#1F9D6B", ring: "rgba(255,255,255,.8)" },
  "ch-ruby":    { bg: "#C42B48", ring: "rgba(255,255,255,.8)" },
  "ch-gold":    { bg: "#D9A62B", ring: "rgba(255,255,255,.9)" },
  "ch-onyx":    { bg: "#23262E", ring: "rgba(255,255,255,.55)" },
};

// ---- table felts -----------------------------------------------------------
// Subtle full-screen tints behind the game table, per theme. null = plain C.bg.
export const FELTS = {
  "ft-classic":  null,
  "ft-green":    { light: "radial-gradient(130% 100% at 50% 25%, #E2ECE3 0%, #CBDDD1 85%)",
                   dark:  "radial-gradient(130% 100% at 50% 25%, #16261C 0%, #0E1712 85%)" },
  "ft-navy":     { light: "radial-gradient(130% 100% at 50% 25%, #E0E7F2 0%, #C8D5E8 85%)",
                   dark:  "radial-gradient(130% 100% at 50% 25%, #131D30 0%, #0C1220 85%)" },
  "ft-burgundy": { light: "radial-gradient(130% 100% at 50% 25%, #F0E2E4 0%, #E2CBD0 85%)",
                   dark:  "radial-gradient(130% 100% at 50% 25%, #2A141A 0%, #170C0F 85%)" },
  "ft-onyx":     { light: "radial-gradient(130% 100% at 50% 25%, #E4E5E8 0%, #CFD1D6 85%)",
                   dark:  "radial-gradient(130% 100% at 50% 25%, #15171C 0%, #0A0C10 85%)" },
};

export const SLOTS = ["cardback", "chips", "felt"];
export const DEFAULT_EQUIPPED = { cardback: "cb-classic", chips: "ch-classic", felt: "ft-classic" };

// ---- lookups (always safe) -------------------------------------------------
export const cardBackDesign = id => CARD_BACKS[id] || CARD_BACKS["cb-classic"];
export const chipDesign = id => CHIP_STYLES[id] || CHIP_STYLES["ch-classic"];
export function feltBackground(id, dark) {
  const f = FELTS[id];
  return f ? (dark ? f.dark : f.light) : null;
}

// Which slot an item id belongs to, from its visual table (client-side echo of
// the catalog's `type`; used for previews and sanity checks only).
export function slotOfItem(id) {
  if (id in CARD_BACKS) return "cardback";
  if (id in CHIP_STYLES) return "chips";
  if (id in FELTS) return "felt";
  return null;
}

// Sanitize an equipped map from any source (cloud row, localStorage) down to
// known ids in the right slots; anything off falls back to the default.
export function normalizeEquipped(map) {
  const out = { ...DEFAULT_EQUIPPED };
  if (map && typeof map === "object") {
    for (const slot of SLOTS) {
      const id = map[slot];
      if (typeof id === "string" && slotOfItem(id) === slot) out[slot] = id;
    }
  }
  return out;
}

// ---- live equipped state ---------------------------------------------------
// Mutable module object, same pattern as theme.js's C: renderers read it
// directly, App state changes trigger the re-render. Mirrored to localStorage
// so the look survives reloads offline (visual only — ownership is enforced
// server-side, so a tampered mirror can at worst recolor pixels locally).
export const EQUIPPED = { ...DEFAULT_EQUIPPED };

const KEY = "kicker-equipped";

export function loadLocalEquipped() {
  try { return normalizeEquipped(JSON.parse(localStorage.getItem(KEY))); }
  catch { return { ...DEFAULT_EQUIPPED }; }
}

export function applyEquipped(map, { persist = true } = {}) {
  const next = normalizeEquipped(map);
  Object.assign(EQUIPPED, next);
  if (persist) { try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {} }
  return next;
}

// ---- shop copy -------------------------------------------------------------
export const TIER_LABEL = { default: "Default", common: "Common", rare: "Rare", epic: "Epic" };

export function shopErrorMessage(code) {
  switch (code) {
    case "insufficient":  return "Not enough saved chips for that.";
    case "not_found":     return "That item isn’t available.";
    case "not_owned":     return "You don’t own that item yet.";
    case "not_for_sale":  return "That item can’t be bought — it’s already free.";
    case "bad_slot":      return "That item can’t be equipped there.";
    case "unauthorized":  return "Sign in to buy and equip items.";
    default:               return "Something went wrong. Try again.";
  }
}
