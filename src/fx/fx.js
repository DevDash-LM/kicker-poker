const KEY = "kicker-muted";
let ctx = null;
export const fx = { muted: false };
try { fx.muted = localStorage.getItem(KEY) === "1"; } catch {}
export function setMuted(m) { fx.muted = m; try { localStorage.setItem(KEY, m ? "1" : "0"); } catch {} }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
export function unlockAudio() { ac(); }

function tone(freq, at = 0, dur = 0.08, type = "sine", vol = 0.1, glideTo = null) {
  if (fx.muted) return;
  const a = ac(); if (!a) return;
  const t0 = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(at = 0, dur = 0.05, vol = 0.08, freq = 1800, type = "highpass") {
  if (fx.muted) return;
  const a = ac(); if (!a) return;
  const t0 = a.currentTime + at;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t0);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

export const S = {
  tap: () => tone(1500, 0, 0.035, "sine", 0.05),
  tick: () => tone(2100, 0, 0.02, "sine", 0.03),
  deal: () => { for (let i = 0; i < 6; i++) noise(i * 0.065, 0.03, 0.07, 2600); },
  flip: () => { noise(0, 0.04, 0.08, 1600); tone(500, 0.01, 0.09, "triangle", 0.05, 900); },
  chip: () => { tone(2500, 0, 0.028, "square", 0.04); tone(2000, 0.05, 0.028, "square", 0.04); },
  chips: () => { for (let i = 0; i < 4; i++) tone(2300 - i * 150, i * 0.04, 0.025, "square", 0.035); },
  check: () => { tone(150, 0, 0.05, "sine", 0.16); tone(150, 0.09, 0.05, "sine", 0.12); },
  fold: () => noise(0, 0.16, 0.06, 650, "lowpass"),
  allin: () => { tone(220, 0, 0.28, "sawtooth", 0.06, 660); tone(220, 0.02, 0.28, "square", 0.03, 655); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.085, 0.22, "triangle", 0.08)),
  lose: () => tone(240, 0, 0.22, "sine", 0.05, 180),
};

export function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
}
