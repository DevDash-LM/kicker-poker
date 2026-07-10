const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const del = k => { try { localStorage.removeItem(k); } catch {} };

export const DEFAULT_SETTINGS = { sb: 50, bb: 100, stack: 10000, ai: 4, showEquity: true, tournament: false };
export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...get("kicker-settings", {}) });
export const saveSettings = s => set("kicker-settings", s);

export const loadSave = () => get("kicker-save", null);
export const saveGame = (game, session) => set("kicker-save", { v: 1, game, session });
export const clearSave = () => del("kicker-save");

export const loadHistory = () => get("kicker-history", []);
export const saveHistory = h => set("kicker-history", h);

export const EMPTY_STATS = { hands: 0, won: 0, net: 0, biggestPot: 0, tables: 0, rebuys: 0, tourneys: 0, tourneyWins: 0, bestFinish: 0, showdowns: 0, fullHouses: 0, quads: 0, straightFlushes: 0, royals: 0 };
export const loadStats = () => ({ ...EMPTY_STATS, ...get("kicker-stats", {}) });
export const saveStats = s => set("kicker-stats", s);
export const resetStats = () => del("kicker-stats");
