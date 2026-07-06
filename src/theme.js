const LIGHT = {
  bg: "#EDEFF2",
  surface: "#FFFFFF",
  surface2: "#F7F8FA",
  card: "#FFFFFF",
  ink: "#171A20",
  onPrim: "#FFFFFF",
  bannerBg: "#171A20",
  muted: "#7A8089",
  faint: "#B9BEC6",
  line: "#E1E4E9",
  accent: "#2E5BFF",
  green: "#1F9D5B",
  red: "#E5484D",
  gold: "#B8860B",
  cardBack: "#1E2330",
};
const DARK = {
  bg: "#12151B",
  surface: "#1C2129",
  surface2: "#161A21",
  card: "#FFFFFF",
  ink: "#ECEEF2",
  onPrim: "#15181E",
  bannerBg: "#232936",
  muted: "#9AA2AD",
  faint: "#586070",
  line: "#2A303B",
  accent: "#5B7FFF",
  green: "#34C77B",
  red: "#F2666C",
  gold: "#D9A62B",
  cardBack: "#0D1015",
};
export const C = { ...LIGHT };
export const SUIT_META = [
  { sym: "\u2660", color: "#1B1E24" },
  { sym: "\u2665", color: "#E5484D" },
  { sym: "\u2666", color: "#2871E6" },
  { sym: "\u2663", color: "#1F9D5B" },
];
export const FONT = "-apple-system, 'SF Pro Display', Inter, 'Segoe UI', system-ui, sans-serif";

const KEY = "kicker-dark";
export function isDark() { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } }
export function applyTheme(dark) {
  Object.assign(C, dark ? DARK : LIGHT);
  try { localStorage.setItem(KEY, dark ? "1" : "0"); } catch {}
  if (typeof document !== "undefined") {
    document.body.classList.toggle("dark", dark);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", C.bg);
  }
}
export function initTheme() { applyTheme(isDark()); }
