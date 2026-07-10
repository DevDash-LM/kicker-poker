// Progression: XP, levels, achievements, and daily quest progress.
//
// Design note: XP, levels, and achievements are DERIVED from lifetime stats
// (which already sync via user_state) instead of being stored — there is
// nothing to double-award, nothing extra to sync, and they grant no currency.
// Quest progress is a small per-UTC-day counter kept locally; only the claim
// (the part that pays chips) goes through the server.

// ---- XP & levels -----------------------------------------------------------

// Meaningful play earns XP; folding hands instantly earns nearly nothing.
export function xpFromStats(st) {
  if (!st) return 0;
  return Math.max(0, Math.floor(
    (st.hands || 0) * 10 +
    (st.won || 0) * 15 +
    (st.showdowns || 0) * 5 +
    (st.tourneys || 0) * 100 +
    (st.tourneyWins || 0) * 400
  ));
}

// Cumulative XP required to REACH a level: quadratic-ish curve that keeps
// early levels quick and later ones meaningful. Level 1 is the floor.
export function xpForLevel(level) {
  if (level <= 1) return 0;
  const n = level - 1;
  return 250 * n * (n + 1); // L2=500, L3=1500, L4=3000, L5=5000, ...
}

export function levelFromXp(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const cur = xpForLevel(level), next = xpForLevel(level + 1);
  return { level, xp, intoLevel: xp - cur, forNext: next - cur, frac: Math.min(1, (xp - cur) / (next - cur)) };
}

// ---- achievements ----------------------------------------------------------
// Pure predicates over lifetime stats: stable, cross-device (stats sync), and
// impossible to duplicate because they aren't stored at all.
export const ACHIEVEMENTS = [
  { id: "first-hand",     name: "First Hand",          desc: "Play your first hand.",                 test: st => (st.hands || 0) >= 1 },
  { id: "first-win",      name: "First Win",           desc: "Win a hand.",                           test: st => (st.won || 0) >= 1 },
  { id: "first-showdown", name: "First Showdown",      desc: "Take a hand all the way to showdown.",  test: st => (st.showdowns || 0) >= 1 },
  { id: "big-pot",        name: "Big Pot",             desc: "Win a pot of 10,000+ chips.",           test: st => (st.biggestPot || 0) >= 10000 },
  { id: "monster-pot",    name: "Monster Pot",         desc: "Win a pot of 50,000+ chips.",           test: st => (st.biggestPot || 0) >= 50000 },
  { id: "full-house",     name: "Full House",          desc: "Show down a full house.",               test: st => (st.fullHouses || 0) >= 1 },
  { id: "quads",          name: "Four of a Kind",      desc: "Show down four of a kind.",             test: st => (st.quads || 0) >= 1 },
  { id: "straight-flush", name: "Straight Flush",      desc: "Show down a straight flush.",           test: st => (st.straightFlushes || 0) >= 1 },
  { id: "royal",          name: "Royal Flush",         desc: "Show down the royal flush.",            test: st => (st.royals || 0) >= 1 },
  { id: "regular",        name: "Table Regular",       desc: "Play 250 hands.",                       test: st => (st.hands || 0) >= 250 },
  { id: "grinder",        name: "Grinder",             desc: "Play 1,000 hands.",                     test: st => (st.hands || 0) >= 1000 },
  { id: "tourney-champ",  name: "Tournament Champion", desc: "Win a tournament.",                     test: st => (st.tourneyWins || 0) >= 1 },
];

export function unlockedAchievements(st) {
  const s = st || {};
  return new Set(ACHIEVEMENTS.filter(a => { try { return a.test(s); } catch { return false; } }).map(a => a.id));
}

// Which achievements newly unlocked between two stats snapshots (for toasts).
export function newlyUnlocked(before, after) {
  const prev = unlockedAchievements(before), now = unlockedAchievements(after);
  return ACHIEVEMENTS.filter(a => now.has(a.id) && !prev.has(a.id));
}

// ---- daily quest progress (local, per UTC day) ------------------------------

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

export const EMPTY_DAILY = { date: "", hands: 0, wins: 0, showdowns: 0, bigwins: 0 };

// Normalize any stored blob; a stale date resets the counters.
export function normalizeDaily(p, today = utcDay()) {
  if (!p || typeof p !== "object" || p.date !== today) return { ...EMPTY_DAILY, date: today };
  return {
    date: today,
    hands: Math.max(0, p.hands | 0),
    wins: Math.max(0, p.wins | 0),
    showdowns: Math.max(0, p.showdowns | 0),
    bigwins: Math.max(0, p.bigwins | 0),
  };
}

// Fold one finished hand into the day's counters.
// ev: { won, showdown, category } — category is eval7's score[0] (2 = two pair).
export function bumpDaily(p, ev, today = utcDay()) {
  const d = normalizeDaily(p, today);
  d.hands += 1;
  if (ev?.won) d.wins += 1;
  if (ev?.showdown) d.showdowns += 1;
  if (ev?.won && ev?.showdown && (ev.category ?? -1) >= 2) d.bigwins += 1;
  return d;
}

// Progress count for a quest id against the day's counters.
export function questProgress(questId, p) {
  const d = p || EMPTY_DAILY;
  switch (questId) {
    case "q-hands5":    return d.hands;
    case "q-win2":      return d.wins;
    case "q-showdown3": return d.showdowns;
    case "q-bighand":   return d.bigwins;
    default:             return 0;
  }
}

// ---- daily reward pool copy (must match claim_daily() in schema.sql) --------
export const DAILY_POOL = [
  { label: "2–9", amount: 1000 },
  { label: "10–K", amount: 2500 },
  { label: "Ace", amount: 5000 },
];
export const DAILY_STREAK_BONUS = 250;  // per consecutive day, capped:
export const DAILY_STREAK_CAP = 7;      // max +1,750

export function rewardsErrorMessage(code) {
  switch (code) {
    case "claimed":      return "Already claimed today — come back tomorrow.";
    case "not_found":    return "That quest isn’t available.";
    case "unauthorized": return "Sign in to claim rewards.";
    default:              return "Something went wrong. Try again.";
  }
}
