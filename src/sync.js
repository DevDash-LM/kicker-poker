// Cloud sync glue: mirrors the locally-stored game state (lifetime stats,
// theme/prefs, settings, recent hand history) to the signed-in account so it
// follows the player across devices. Reconciliation policy is "cloud wins":
// on sign-in the account's saved state replaces what's on this device. The
// only exception is a brand-new account with no saved row yet, which we seed
// from this device so first-time progress isn't thrown away.
import * as store from "./storage.js";
import { isDark, applyTheme } from "./theme.js";
import { loadUserState, saveUserState } from "./account.js";

// A full snapshot of the on-device state, in the shape the cloud row expects.
export function snapshotLocal() {
  return {
    stats: store.loadStats(),
    prefs: { dark: isDark() },
    settings: store.loadSettings(),
    history: store.loadHistory(),
  };
}

// Write a cloud snapshot down into local storage (+ apply the theme). Missing
// pieces fall back to defaults so a partial row can't corrupt local state.
export function applyToLocal(state) {
  if (!state) return;
  store.saveStats({ ...store.EMPTY_STATS, ...(state.stats || {}) });
  store.saveSettings({ ...store.DEFAULT_SETTINGS, ...(state.settings || {}) });
  store.saveHistory(Array.isArray(state.history) ? state.history : []);
  if (state.prefs && typeof state.prefs.dark === "boolean") applyTheme(state.prefs.dark);
}

// Cloud-wins hydrate. If the account has a saved row, apply it locally and
// return it. If not (first sign-in), seed the account from this device.
// Returns the state now in effect, or null when accounts are off / signed out.
export async function hydrateFromCloud() {
  const cloud = await loadUserState();
  if (cloud) { applyToLocal(cloud); return cloud; }
  const seed = snapshotLocal();
  await saveUserState(seed);
  return seed;
}

// Debounced push of the current on-device state to the cloud. Safe to call
// whenever local state changes — it's a no-op when nobody is signed in.
let timer = null;
export function pushSoon(delay = 800) {
  clearTimeout(timer);
  timer = setTimeout(() => { saveUserState(snapshotLocal()).catch(() => {}); }, delay);
}
