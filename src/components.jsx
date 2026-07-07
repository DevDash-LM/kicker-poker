import { Component, useState, useEffect } from "react";
import { C, SUIT_META, FONT } from "./theme.js";
import { RANK_STR, fmt } from "./game/logic.js";
import { S, buzz } from "./fx/fx.js";

export function CardFace({ card, w = 44, h = 62, fs = 17, className = "", style }) {
  const m = SUIT_META[card.s];
  return (
    <div className={className} style={{
      width: w, height: h, background: C.card, borderRadius: w * 0.16,
      border: `1px solid ${C.line}`, boxShadow: "0 1px 3px rgba(20,24,33,.10)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      color: m.color, fontFamily: FONT, flexShrink: 0, ...style,
    }}>
      <div style={{ fontSize: fs, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em" }}>{RANK_STR[card.r]}</div>
      <div style={{ fontSize: fs * 0.85, lineHeight: 1.2 }}>{m.sym}</div>
    </div>
  );
}

export function CardBack({ w = 30, h = 42, className = "", style }) {
  return (
    <div className={className} style={{
      width: w, height: h, borderRadius: w * 0.18, background: C.cardBack,
      boxShadow: "0 1px 2px rgba(20,24,33,.2)", position: "relative", flexShrink: 0, ...style,
    }}>
      <div style={{
        position: "absolute", inset: 4, borderRadius: w * 0.12,
        border: "1px solid rgba(255,255,255,.14)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div aria-hidden="true" style={{
          width: w * 0.52, height: w * 0.52,
          background: "rgba(255,255,255,.22)",
          WebkitMaskImage: "url(/logo-mark.png)", maskImage: "url(/logo-mark.png)",
          WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
          WebkitMaskPosition: "center", maskPosition: "center",
          WebkitMaskSize: "contain", maskSize: "contain",
        }} />
      </div>
    </div>
  );
}

export function TimerBar({ deadline, total = 30000, width = 110 }) {
  const [frac, setFrac] = useState(1);
  useEffect(() => {
    let raf;
    const tick = () => {
      const rem = Math.max(0, deadline - Date.now());
      setFrac(Math.min(1, rem / total));
      if (rem > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deadline, total]);
  return (
    <div style={{ width, height: 4, borderRadius: 2, background: C.line, overflow: "hidden" }}>
      <div style={{ width: `${frac * 100}%`, height: "100%", background: frac < 0.25 ? C.red : C.accent }} />
    </div>
  );
}

export function Seat({ p, isTurn, isDealer, folded, dealKey, seatIdx, innerRef, deadline, dimmed, pct, big }) {
  const cw = big ? 44 : 30, ch = big ? 62 : 42, cfs = big ? 17 : 12;
  const av = big ? 58 : 44, avFs = big ? 27 : 21;
  const nameFs = big ? 13 : 11, chipFs = big ? 13 : 11, badgeFs = big ? 12 : 10;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: big ? 5 : 4, width: big ? "min(120px, 16vw)" : "min(78px, 23vw)", opacity: folded ? 0.38 : 1, filter: folded ? "grayscale(.7)" : "none", transition: "opacity .35s, filter .35s" }}>
      <div style={{ height: big ? 64 : 44, display: "flex", alignItems: "flex-end", gap: big ? 4 : 3 }}>
        {p.revealed && !p.folded
          ? p.cards.map((c, i) => <CardFace key={`r${dealKey}-${i}`} card={c} w={cw} h={ch} fs={cfs} className="flip-in" style={{ animationDelay: `${i * 90}ms` }} />)
          : !p.folded && p.cards.length
            ? [0, 1].map(i => <CardBack key={`${dealKey}-${i}`} w={cw} h={ch} className="deal-in" style={{ animationDelay: `${(i * 5 + seatIdx) * 55}ms` }} />)
            : <div style={{ height: ch }} />}
      </div>
      <div style={{ position: "relative" }} ref={innerRef}>
        <div className={isTurn ? "turn-pulse" : ""} style={{
          width: av, height: av, borderRadius: av / 2, background: C.surface,
          border: `2px solid ${isTurn ? C.accent : C.line}`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: avFs,
          transition: "border-color .2s",
        }}>{p.emoji}</div>
        {isDealer && (
          <div style={{
            position: "absolute", right: -6, bottom: -2, width: big ? 20 : 17, height: big ? 20 : 17, borderRadius: big ? 10 : 9,
            background: C.ink, color: C.onPrim, fontSize: big ? 11 : 9, fontWeight: 800,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>D</div>
        )}
      </div>
      {isTurn && deadline ? <TimerBar deadline={deadline} width={av} /> : null}
      <div style={{ fontSize: nameFs, fontWeight: 700, color: dimmed ? C.faint : C.ink }}>{p.name}{dimmed ? " ⚡" : ""}</div>
      <div style={{ fontSize: chipFs, color: C.muted, fontVariantNumeric: "tabular-nums", marginTop: -3 }}>{fmt(p.chips)}</div>
      <div style={{ height: big ? 22 : 18 }}>
        {pct != null ? (
          <div key={Math.round(pct * 100)} className="bet-pop" style={{ fontSize: badgeFs, fontWeight: 800, borderRadius: 9, padding: "2px 8px", fontVariantNumeric: "tabular-nums", color: pct >= 0.5 ? "#fff" : pct === 0 ? C.faint : C.ink, background: pct >= 0.5 ? C.green : C.surface, border: `1px solid ${pct >= 0.5 ? C.green : C.line}` }}>
            {Math.round(pct * 100)}%
          </div>
        ) : p.bet > 0 ? (
          <div key={p.bet} className="bet-pop" style={{ fontSize: badgeFs, fontWeight: 700, color: C.accent, background: `${C.accent}14`, borderRadius: 9, padding: "2px 8px", fontVariantNumeric: "tabular-nums" }}>
            {fmt(p.bet)}
          </div>
        ) : p.lastAction ? (
          <div className="fade-in" style={{ fontSize: badgeFs, fontWeight: 600, color: p.lastAction === "Fold" ? C.faint : C.muted, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, padding: "1px 8px" }}>
            {p.lastAction}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Btn({ children, onClick, kind = "ghost", disabled, style }) {
  const base = {
    fontFamily: FONT, fontWeight: 700, fontSize: 15, borderRadius: 14,
    padding: "14px 0", flex: 1, border: "none", cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1, letterSpacing: "-0.01em", touchAction: "manipulation",
  };
  const kinds = {
    ghost: { background: C.surface, color: C.ink, border: `1px solid ${C.line}` },
    primary: { background: C.ink, color: C.onPrim },
    accent: { background: C.accent, color: "#fff" },
    danger: { background: C.surface, color: C.red, border: `1px solid ${C.line}` },
  };
  return (
    <button disabled={disabled} className="btn"
      onClick={e => { if (!disabled) { S.tap(); buzz(8); onClick && onClick(e); } }}
      style={{ ...base, ...kinds[kind], ...style }}>
      {children}
    </button>
  );
}

export function ChipDot() {
  const sz = 16;
  return (
    <div style={{
      width: sz, height: sz, borderRadius: "50%", background: C.accent,
      border: "2.5px dashed rgba(255,255,255,.8)", boxSizing: "border-box",
      boxShadow: "0 1px 3px rgba(20,24,33,.3)",
    }} />
  );
}

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="vh" style={{ background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, padding: 24, maxWidth: 340, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>&#x1F0CF;</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, marginBottom: 6 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 18 }}>Your table is saved. Reload to pick up where you left off, or reset if it keeps happening.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={() => { try { localStorage.removeItem("kicker-save"); } catch {} location.reload(); }}>Reset table</Btn>
            <Btn kind="primary" onClick={() => location.reload()}>Recover table</Btn>
          </div>
        </div>
      </div>
    );
  }
}
