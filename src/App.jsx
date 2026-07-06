import { useState, useEffect, useRef, useMemo } from "react";
import { C, FONT, isDark, applyTheme } from "./theme.js";
import {
  RANK_STR, fmt, potOf, clone, eval7, handLabel, simEquity,
  AI_SEED, decideAI, startHand, applyAction, stepRunout, runoutEquities, secureInt,
} from "./game/logic.js";
import { CardFace, Seat, Btn, ChipDot, TimerBar } from "./components.jsx";
import { S, buzz, fx, setMuted, unlockAudio } from "./fx/fx.js";
import * as store from "./storage.js";
import { Net, loadProfile, saveProfile } from "./net.js";
import { REACTIONS, AVATARS } from "../server/protocol.js";

const BLIND_PRESETS = [[25, 50], [50, 100], [100, 200], [250, 500]];
const STACK_PRESETS = [5000, 10000, 25000, 50000];

function useMedia(query) {
  const [match, setMatch] = useState(() => typeof matchMedia !== "undefined" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia(query);
    const h = e => setMatch(e.matches);
    mq.addEventListener("change", h);
    setMatch(mq.matches);
    return () => mq.removeEventListener("change", h);
  }, [query]);
  return match;
}

function useCountUp(value, dur = 380) {
  const [disp, setDisp] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current, to = value;
    if (from === to) return;
    const t0 = performance.now();
    let raf;
    const tick = now => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(from + (to - from) * e);
      setDisp(v); fromRef.current = v;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, dur]);
  return disp;
}

function ChipFlyer({ from, to, delay }) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGo(true), delay + 20);
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <div style={{
      position: "absolute", left: from.x, top: from.y, zIndex: 50, pointerEvents: "none",
      transform: go ? `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(.55)` : "translate(-50%, -50%)",
      marginLeft: go ? -8 : 0, marginTop: go ? -8 : 0,
      opacity: go ? 0.1 : 1,
      transition: "transform .55s cubic-bezier(.4,-.05,.3,1), opacity .55s ease",
    }}>
      <ChipDot />
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 28 }, () => ({
    dx: (Math.random() * 2 - 1) * 170,
    dy: -30 + Math.random() * 190,
    rot: (Math.random() * 2 - 1) * 560,
    delay: Math.random() * 0.18,
    color: [C.accent, C.green, C.red, C.gold, "#7EF0B0"][Math.floor(Math.random() * 5)],
  })), []);
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 60 }}>
      {pieces.map((p, i) => (
        <div key={i} className="confetti-piece" style={{
          "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--rot": `${p.rot}deg`,
          background: p.color, animationDelay: `${p.delay}s`,
        }} />
      ))}
    </div>
  );
}

function Modal({ children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,16,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
      <div className="banner-up" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, padding: 22, width: "100%", maxWidth: 340 }}>
        {children}
      </div>
    </div>
  );
}

function OptionRow({ options, value, onChange, render }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {options.map((o, i) => {
        const sel = JSON.stringify(o) === JSON.stringify(value);
        return (
          <button key={i} className="btn" onClick={() => { S.tap(); buzz(6); onChange(o); }}
            style={{
              flex: 1, fontFamily: FONT, fontSize: 13, fontWeight: 700, padding: "10px 0", borderRadius: 12,
              border: `1px solid ${sel ? C.ink : C.line}`, background: sel ? C.ink : C.surface,
              color: sel ? C.onPrim : C.ink, cursor: "pointer", fontVariantNumeric: "tabular-nums",
            }}>
            {render(o)}
          </button>
        );
      })}
    </div>
  );
}

function SetupLabel({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>{children}</div>;
}

function StatRow({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "13px 16px", background: C.surface, borderRadius: 14, border: `1px solid ${C.line}` }}>
      <span style={{ color: C.muted, fontSize: 14, fontWeight: 600 }}>{label}</span>
      <span style={{ color: color || C.ink, fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

const netColor = n => (n > 0 ? C.green : n < 0 ? C.red : C.muted);
const netStr = n => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : "0");

export default function App() {
  const [screen, setScreen] = useState("home");
  const [game, setGame] = useState(null);
  const [equity, setEquity] = useState(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [session, setSession] = useState({ hands: 0, won: 0, biggest: 0, rebuys: 0 });
  const [muted, setMutedUI] = useState(fx.muted);
  const [flights, setFlights] = useState([]);
  const [confettiKey, setConfettiKey] = useState(-1);
  const [dark, setDark] = useState(isDark());
  const [settings, setSettings] = useState(store.loadSettings);
  const [saved, setSaved] = useState(() => store.loadSave());
  const [history, setHistory] = useState(store.loadHistory);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [expandedHand, setExpandedHand] = useState(null);
  const [mode, setMode] = useState("solo");
  const [conn, setConn] = useState("off");
  const [room, setRoom] = useState(null);
  const [profile, setProfile] = useState(loadProfile);
  const [joinCode, setJoinCode] = useState(() => { try { return new URLSearchParams(location.search).get("room")?.toUpperCase().replace(/[^A-Z]/g, "") || ""; } catch { return ""; } });
  const [netErr, setNetErr] = useState(null);
  const [reactions, setReactions] = useState([]);
  const [deadlineMs, setDeadlineMs] = useState(null);
  const [connList, setConnList] = useState([]);
  const [copied, setCopied] = useState(false);
  const wide = useMedia("(min-width: 700px)");
  const short = useMedia("(max-height: 500px)");

  const gameRef = useRef(game);
  gameRef.current = game;
  const containerRef = useRef(null);
  const potRef = useRef(null);
  const seatEls = useRef({});
  const prevRef = useRef(null);
  const flightId = useRef(0);
  const lastTick = useRef(0);
  const handStartRef = useRef(0);
  const actionsRef = useRef([]);
  const histFrom = useRef("home");
  const netRef = useRef(null);
  const msgRef = useRef(() => {});
  const pendingRef = useRef(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    const h = () => unlockAudio();
    window.addEventListener("pointerdown", h, { once: true });
    return () => window.removeEventListener("pointerdown", h);
  }, []);

  useEffect(() => { if (joinCode) setScreen("online"); }, []);

  const toggleDark = () => { const d = !dark; setDark(d); applyTheme(d); S.tap(); buzz(6); };
  const toggleMute = () => {
    const m = !muted;
    setMutedUI(m); setMuted(m);
    if (!m) S.tap();
  };

  const leaveCleanup = () => {
    netRef.current?.close();
    netRef.current = null;
    setConn("off"); setMode("solo"); setRoom(null); setGame(null);
    setDeadlineMs(null); setConnList([]); setLeaveOpen(false); setScreen("home");
  };

  const spawnReaction = (name, emoji) => {
    const g = gameRef.current;
    const cont = containerRef.current;
    if (!g || !cont) return;
    const idx = g.players.findIndex(p => p.name === name);
    const el = seatEls.current[idx];
    if (!el) return;
    const cr = cont.getBoundingClientRect(), r = el.getBoundingClientRect();
    const id = ++flightId.current;
    setReactions(rs => [...rs, { id, x: r.left + r.width / 2 - cr.left, y: r.top - cr.top - 4, emoji }]);
    setTimeout(() => setReactions(rs => rs.filter(x => x.id !== id)), 1900);
  };

  msgRef.current = m => {
    if (m.type === "room") {
      setRoom(m);
      if (m.status === "lobby") {
        setMode("mp"); setGame(null); setDeadlineMs(null);
        if (screenRef.current !== "lobby") setScreen("lobby");
      }
    } else if (m.type === "state") {
      setMode("mp");
      if (screenRef.current === "lobby") setSession({ hands: 0, won: 0, biggest: 0, rebuys: 0 });
      setDeadlineMs(m.deadline || null);
      setConnList(m.conn || []);
      setGame(m.game);
      if (!["game", "history", "stats"].includes(screenRef.current)) setScreen("game");
    } else if (m.type === "reaction") {
      spawnReaction(m.name, m.emoji);
    } else if (m.type === "error") {
      setNetErr(m.msg);
    } else if (m.type === "ended") {
      leaveCleanup();
    }
  };

  const ensureNet = () => {
    if (netRef.current) return netRef.current;
    const n = new Net();
    n.onMessage = m => msgRef.current(m);
    n.onStatus = setConn;
    n.onOpen = () => { if (pendingRef.current) { n.send(pendingRef.current); pendingRef.current = null; } };
    n.connect();
    netRef.current = n;
    return n;
  };
  const sendWhenReady = msg => {
    const n = ensureNet();
    if (n.status === "on") { n.send(msg); return; }
    pendingRef.current = msg;
    setTimeout(() => {
      if (pendingRef.current === msg) {
        pendingRef.current = null;
        setNetErr("Can't reach the game server. Check your connection and try again.");
      }
    }, 7000);
  };
  const createRoom = () => {
    setNetErr(null); saveProfile(profile);
    sendWhenReady({ type: "create", profile, config: { sb: settings.sb, bb: settings.bb, stack: settings.stack, fillAI: false } });
  };
  const joinRoom = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 5) { setNetErr("Room codes are 5 letters."); return; }
    setNetErr(null); saveProfile(profile);
    sendWhenReady({ type: "join", code, profile });
  };

  const recordAction = (g, idx, a) => {
    const p = g.players[idx];
    let label;
    if (a.type === "fold") label = "folds";
    else if (a.type === "call" || (a.type === "raise" && p.acted)) {
      const tc = Math.max(0, g.currentBet - p.bet);
      label = tc === 0 ? "checks" : `calls ${fmt(Math.min(tc, p.chips))}`;
    } else {
      const to = Math.min(a.to, p.bet + p.chips);
      label = `${g.currentBet > 0 ? "raises to" : "bets"} ${fmt(to)}`;
    }
    actionsRef.current.push({ st: g.street, n: p.name, l: label });
  };
  const doAction = (g, idx, a) => { recordAction(g, idx, a); return applyAction(g, idx, a); };

  const newTable = (cfg) => {
    const players = [
      { name: "You", emoji: "🙂", ai: false, chips: cfg.stack, cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, revealed: false, lastAction: null },
      ...AI_SEED.slice(0, cfg.ai).map(a => ({ ...a, ai: true, chips: cfg.stack, cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, revealed: false, lastAction: null })),
    ];
    const base = {
      players, dealer: secureInt(players.length), handNo: 0, board: [], deck: [], stage: "hand",
      blinds: { sb: cfg.sb, bb: cfg.bb }, startStack: cfg.stack,
    };
    setSession({ hands: 0, won: 0, biggest: 0, rebuys: 0 });
    setGame(startHand(base));
    setScreen("game");
    setRaiseOpen(false);
    setConfettiKey(-1);
    setSaved(null);
  };

  const resumeTable = () => {
    const sv = store.loadSave();
    if (!sv?.game) return;
    setGame(sv.game);
    setSession(sv.session || { hands: 0, won: 0, biggest: 0, rebuys: 0 });
    setScreen("game");
    setRaiseOpen(false);
    setConfettiKey(-1);
  };

  const leaveTable = () => {
    if (mode === "mp") { netRef.current?.send({ type: "leave" }); leaveCleanup(); return; }
    const st = store.loadStats();
    st.tables += 1;
    st.rebuys += session.rebuys;
    store.saveStats(st);
    store.clearSave();
    setSaved(null);
    setGame(null);
    setLeaveOpen(false);
    setScreen("home");
  };

  const hero = game?.players[0];
  const pot = game ? potOf(game) : 0;
  const potDisp = useCountUp(pot);
  const isHeroTurn = game?.stage === "hand" && game.turn === 0;
  const toCall = game ? Math.max(0, game.currentBet - (hero?.bet || 0)) : 0;
  const eqDisp = useCountUp(equity === null ? 0 : Math.round(equity * 100), 300);
  const runPcts = useMemo(
    () => (game && game.stage === "runout" ? runoutEquities(game.players, game.board) : null),
    [game?.stage, game?.board.length, game?.handNo]
  );
  const sbAmt = game?.blinds?.sb ?? settings.sb;
  const bbAmt = game?.blinds?.bb ?? settings.bb;

  useEffect(() => {
    if (mode === "solo" && game && (screen === "game" || screen === "history" || screen === "stats")) store.saveGame(game, session);
  }, [game, session, screen, mode]);

  useEffect(() => {
    if (!game) return;
    handStartRef.current = game.players[0].chips + game.players[0].total;
    actionsRef.current = [];
  }, [game?.handNo]);

  const fly = (fromEl, toEl, count = 3, baseDelay = 0) => {
    const cont = containerRef.current;
    if (!cont || !fromEl || !toEl) return;
    const cr = cont.getBoundingClientRect(), f = fromEl.getBoundingClientRect(), t = toEl.getBoundingClientRect();
    const from = { x: f.left + f.width / 2 - cr.left, y: f.top + f.height / 2 - cr.top };
    const to = { x: t.left + t.width / 2 - cr.left, y: t.top + t.height / 2 - cr.top };
    const items = Array.from({ length: count }, (_, k) => ({ id: ++flightId.current, from, to, delay: baseDelay + k * 70 }));
    setFlights(fs => [...fs, ...items]);
    const ids = new Set(items.map(i => i.id));
    setTimeout(() => setFlights(fs => fs.filter(x => !ids.has(x.id))), 1100 + baseDelay + count * 70);
  };

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = game;
    if (!game || !prev || screen !== "game") return;
    if (game.handNo !== prev.handNo) { S.deal(); buzz(12); return; }

    if (game.board.length > prev.board.length) { S.flip(); buzz(6); }

    game.players.forEach((p, i) => {
      const q = prev.players[i];
      if (!q || !p.lastAction || p.lastAction === q.lastAction) return;
      if (p.lastAction === "Fold") S.fold();
      else if (p.lastAction === "Check") S.check();
      else if (p.lastAction === "All-in") { S.allin(); buzz([10, 30, 20]); }
      else if (p.lastAction === "Raise" || p.lastAction === "Bet") S.chips();
      else if (p.lastAction === "Call") S.chip();
    });

    const streetChanged = game.street !== prev.street;
    const ended = game.stage === "over" && prev.stage !== "over";
    const runoutStarted = game.stage === "runout" && prev.stage === "hand";
    if (streetChanged || ended || runoutStarted) {
      prev.players.forEach((p, i) => {
        if (p.bet > 0) fly(seatEls.current[i], potRef.current, Math.min(3, 1 + Math.floor(p.bet / (bbAmt * 3))), i * 40);
      });
    }
    if (ended && game.result) {
      setTimeout(() => {
        const g = gameRef.current;
        if (!g || g.stage !== "over") return;
        g.result.lines.forEach(l => {
          if (l.pot === "returned") return;
          const wi = g.players.findIndex(pl => pl.name === l.name);
          if (wi >= 0) fly(potRef.current, seatEls.current[wi], 4, 0);
        });
      }, 380);
      const heroWon = game.result.lines.some(l => l.hero && l.pot !== "returned");
      if (heroWon) { S.win(); buzz([25, 40, 25, 40, 60]); setConfettiKey(game.handNo); }
      else if (!game.players[0].folded) S.lose();
    }
  }, [game, screen]);

  useEffect(() => {
    if (mode !== "solo" || !game || game.stage !== "hand" || screen !== "game") return;
    const p = game.players[game.turn];
    if (!p?.ai) return;
    const turnAt = game.turn, handAt = game.handNo, streetAt = game.street;
    const t = setTimeout(() => {
      setGame(g => {
        if (!g || g.stage !== "hand" || g.turn !== turnAt || g.handNo !== handAt || g.street !== streetAt) return g;
        return doAction(g, g.turn, decideAI(g, g.turn));
      });
    }, 650 + Math.random() * 850);
    return () => clearTimeout(t);
  }, [game, screen, mode]);

  useEffect(() => {
    if (mode !== "solo" || !game || game.stage !== "runout" || screen !== "game") return;
    const t = setTimeout(() => {
      setGame(g => (g && g.stage === "runout" ? stepRunout(g) : g));
    }, game.board.length === 0 ? 1500 : 1300);
    return () => clearTimeout(t);
  }, [game, screen, mode]);

  useEffect(() => {
    if (!settings.showEquity) { setEquity(null); return; }
    if (!game || !hero || hero.folded || !hero.cards.length) { setEquity(null); return; }
    if (game.stage !== "hand") return;
    const nOpp = game.players.filter((p, i) => i !== 0 && !p.folded).length;
    const t = setTimeout(() => {
      const g = gameRef.current;
      if (!g) return;
      setEquity(simEquity(g.players[0].cards, g.board, nOpp, 260));
    }, 60);
    return () => clearTimeout(t);
  }, [game?.handNo, game?.street, game?.players.filter(p => !p.folded).length, settings.showEquity]);

  useEffect(() => {
    if (game?.stage !== "over" || !game.result) return;
    const heroWin = game.result.lines.find(l => l.hero && l.pot !== "returned");
    const net = game.players[0].chips - handStartRef.current;
    setSession(s => ({
      ...s,
      hands: s.hands + 1,
      won: s.won + (heroWin ? 1 : 0),
      biggest: Math.max(s.biggest, heroWin ? heroWin.amount : 0),
    }));
    const entry = {
      hand: game.handNo, hero: game.players[0].cards, board: game.board,
      lines: game.result.lines, net, actions: actionsRef.current.slice(), ts: Date.now(),
    };
    setHistory(h => { const nh = [entry, ...h].slice(0, 25); store.saveHistory(nh); return nh; });
    const st = store.loadStats();
    st.hands += 1;
    st.won += heroWin ? 1 : 0;
    st.net += net;
    st.biggestPot = Math.max(st.biggestPot, heroWin ? heroWin.amount : 0);
    store.saveStats(st);
  }, [game?.stage]);

  const skipRef = useRef(false);
  const skipHand = () => {
    S.tap(); buzz(8);
    skipRef.current = true;
    setGame(g => {
      if (!g || !g.players[0].folded || g.stage === "over") return g;
      let n = g, guard = 0;
      while ((n.stage === "hand" || n.stage === "runout") && guard++ < 300) {
        n = n.stage === "runout" ? stepRunout(n) : applyAction(n, n.turn, decideAI(n, n.turn));
      }
      return n;
    });
  };
  useEffect(() => {
    if (game?.stage !== "over" || !skipRef.current || mode !== "solo") return;
    skipRef.current = false;
    const t = setTimeout(() => setGame(g => (g && g.stage === "over" && g.players[0].chips > 0 ? startHand(g) : g)), 650);
    return () => clearTimeout(t);
  }, [game?.stage]);

  const act = a => {
    setRaiseOpen(false);
    if (mode === "mp") { netRef.current?.send({ type: "act", action: a }); return; }
    setGame(g => doAction(g, 0, a));
  };
  const openRaise = () => {
    const minTo = Math.min(game.currentBet + game.minRaise, hero.bet + hero.chips);
    setRaiseTo(minTo);
    setRaiseOpen(true);
  };

  const heroHandText = useMemo(() => {
    if (!hero?.cards.length || hero.folded) return "";
    if (game.board.length >= 3) return handLabel(eval7([...hero.cards, ...game.board]));
    const [a, b] = hero.cards;
    if (a.r === b.r) return `Pocket ${RANK_STR[a.r]}s`;
    return `${RANK_STR[Math.max(a.r, b.r)]} high${a.s === b.s ? " · suited" : ""}`;
  }, [game?.board.length, game?.handNo, hero?.folded]);

  const openHistory = from => { histFrom.current = from; setExpandedHand(null); setScreen("history"); };

  if (screen === "home") {
    return (
      <div className="vh" style={{ background: C.bg, fontFamily: FONT, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: wide ? 920 : 420, display: "flex", flexDirection: wide ? "row" : "column", alignItems: wide ? "center" : "stretch", gap: wide ? 56 : 0, padding: "0 24px", paddingTop: "env(safe-area-inset-top)", position: "relative" }}>
          <button onClick={toggleDark} aria-label="Toggle dark mode"
            style={{ position: "absolute", top: 18, right: 20, background: "none", border: "none", cursor: "pointer", fontSize: 17, color: C.muted, padding: 4, fontFamily: FONT }}>
            {dark ? "☀︎" : "☾"}
          </button>
          <img src="/logo-mark.png" alt="Kicker" className="brand-mark"
            style={{ position: "absolute", top: 16, left: 22, height: 30, width: "auto" }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 10, minHeight: wide ? "auto" : "56vh" }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              {[{ r: 14, s: 0 }, { r: 13, s: 2 }].map((c, i) => (
                <div key={i} className="float-card" style={{ "--tilt": `${i ? 7 : -7}deg`, animationDelay: `${i * 0.4}s` }}>
                  <CardFace card={c} w={52} h={72} fs={20} />
                </div>
              ))}
            </div>
            <h1 className="rise-in" style={{ fontSize: 42, fontWeight: 800, letterSpacing: "-0.04em", color: C.ink, margin: 0 }}>Kicker</h1>
            <p className="rise-in" style={{ color: C.muted, fontSize: 16, lineHeight: 1.5, margin: 0, maxWidth: 300, animationDelay: ".08s" }}>
              Clean Texas Hold'em against AI players. Live win odds on every street — learn as you play.
            </p>
          </div>
          <div className="rise-in" style={{ width: wide ? 360 : "auto", flexShrink: 0, paddingBottom: wide ? 0 : "calc(32px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 10, animationDelay: ".16s" }}>
            {saved?.game ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", background: C.surface, borderRadius: 16, border: `1px solid ${C.line}` }}>
                  <span style={{ color: C.muted, fontSize: 14 }}>Table in progress · Hand #{saved.game.handNo}</span>
                  <span style={{ color: C.ink, fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(saved.game.players[0].chips)} chips</span>
                </div>
                <Btn kind="primary" onClick={resumeTable} style={{ padding: "17px 0", fontSize: 16 }}>Resume table</Btn>
                <Btn onClick={() => setScreen("setup")}>New table</Btn>
              </>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", background: C.surface, borderRadius: 16, border: `1px solid ${C.line}` }}>
                  <span style={{ color: C.muted, fontSize: 14 }}>Cash game · {settings.ai + 1}-handed</span>
                  <span style={{ color: C.ink, fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>Blinds {settings.sb}/{settings.bb}</span>
                </div>
                <Btn kind="primary" onClick={() => setScreen("setup")} style={{ padding: "17px 0", fontSize: 16 }}>Take a seat</Btn>
              </>
            )}
            <Btn kind="accent" onClick={() => { setNetErr(null); setScreen("online"); }}>Play online</Btn>
            <div style={{ display: "flex", gap: 10 }}>
              <Btn onClick={() => openHistory("home")} style={{ fontSize: 14, padding: "12px 0" }}>Hand history</Btn>
              <Btn onClick={() => setScreen("stats")} style={{ fontSize: 14, padding: "12px 0" }}>Stats</Btn>
            </div>
            <a href="https://github.com/DevDash-LM/mobile-poker-main" target="_blank" rel="noopener noreferrer"
              style={{ color: C.muted, fontSize: 12, textAlign: "center", textDecoration: "none", opacity: 0.7, padding: "6px 0", fontFamily: FONT }}>
              View source
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "setup") {
    const cfg = settings;
    const upd = patch => { const n = { ...cfg, ...patch }; setSettings(n); store.saveSettings(n); };
    return (
      <div className="vh" style={{ background: C.bg, fontFamily: FONT, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: wide ? 720 : 420, display: "flex", flexDirection: "column", padding: "0 20px", paddingTop: "env(safe-area-inset-top)" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "14px 0" }}>
            <button onClick={() => setScreen("home")} style={{ background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, padding: 0 }}>← Back</button>
            <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 800, color: C.ink, marginRight: 44 }}>Table setup</div>
          </div>
          <div style={{ flex: 1, display: wide ? "grid" : "flex", gridTemplateColumns: wide ? "1fr 1fr" : "none", alignContent: "start", flexDirection: "column", gap: 22, paddingTop: 12 }}>
            <div>
              <SetupLabel>Blinds</SetupLabel>
              <OptionRow options={BLIND_PRESETS} value={[cfg.sb, cfg.bb]}
                onChange={([sb, bb]) => upd({ sb, bb })} render={([sb, bb]) => `${sb}/${bb}`} />
            </div>
            <div>
              <SetupLabel>Starting stack</SetupLabel>
              <OptionRow options={STACK_PRESETS} value={cfg.stack}
                onChange={stack => upd({ stack })} render={v => fmt(v)} />
              <div style={{ fontSize: 12, color: C.faint, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                {Math.round(cfg.stack / cfg.bb)} big blinds deep
              </div>
            </div>
            <div>
              <SetupLabel>Opponents</SetupLabel>
              <OptionRow options={[1, 2, 3, 4]} value={cfg.ai}
                onChange={ai => upd({ ai })} render={v => `${v} AI`} />
            </div>
            <div>
              <SetupLabel>Live win odds</SetupLabel>
              <OptionRow options={[true, false]} value={cfg.showEquity}
                onChange={showEquity => upd({ showEquity })}
                render={v => (v ? "Learning · shown" : "Real · hidden")} />
              <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>
                Hide the odds readout for a more realistic game.
              </div>
            </div>
          </div>
          <div style={{ paddingBottom: "calc(32px + env(safe-area-inset-bottom))", width: "100%", maxWidth: wide ? 440 : "none", margin: wide ? "0 auto" : undefined }}>
            <Btn kind="primary" onClick={() => newTable(cfg)} style={{ padding: "17px 0", fontSize: 16, width: "100%" }}>Deal me in</Btn>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "online") {
    return (
      <div className="vh" style={{ background: C.bg, fontFamily: FONT, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: wide ? 720 : 420, display: "flex", flexDirection: "column", padding: "0 20px", paddingTop: "env(safe-area-inset-top)" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "14px 0" }}>
            <button onClick={() => setScreen("home")} style={{ background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, padding: 0 }}>← Back</button>
            <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 800, color: C.ink, marginRight: 44 }}>Play online</div>
          </div>
          <div style={{ flex: 1, display: wide ? "grid" : "flex", gridTemplateColumns: wide ? "1fr 1fr" : "none", alignContent: "start", flexDirection: "column", gap: 22, paddingTop: 12 }}>
            <div>
              <SetupLabel>Your name</SetupLabel>
              <input className="txt" value={profile.name} maxLength={14} placeholder="Guest"
                onChange={e => setProfile(pr => ({ ...pr, name: e.target.value }))}
                style={{ background: C.surface, border: `1.5px solid ${C.line}`, color: C.ink }} />
            </div>
            <div>
              <SetupLabel>Avatar</SetupLabel>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {AVATARS.map(e => (
                  <button key={e} className="btn" onClick={() => { S.tap(); setProfile(pr => ({ ...pr, emoji: e })); }}
                    style={{ width: 44, height: 44, borderRadius: 22, fontSize: 20, cursor: "pointer", border: `2px solid ${profile.emoji === e ? C.accent : C.line}`, background: C.surface }}>{e}</button>
                ))}
              </div>
            </div>
            <div>
              <SetupLabel>Join a table</SetupLabel>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="txt" value={joinCode} maxLength={5} placeholder="CODE" autoCapitalize="characters" autoCorrect="off"
                  onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                  style={{ background: C.surface, border: `1.5px solid ${C.line}`, color: C.ink, letterSpacing: ".25em", fontWeight: 800, flex: 1, minWidth: 0 }} />
                <Btn kind="primary" onClick={joinRoom} disabled={joinCode.length !== 5} style={{ flex: "0 0 100px" }}>Join</Btn>
              </div>
            </div>
            <div>
              <SetupLabel>Or start one</SetupLabel>
              <Btn kind="accent" onClick={createRoom} style={{ width: "100%" }}>Create a table</Btn>
              <div style={{ fontSize: 12, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>
                You'll get a 4-letter code and a link to share. Blinds, stacks, and AI fill can be changed in the lobby.
              </div>
            </div>
            {netErr && <div style={{ gridColumn: "1 / -1", color: C.red, fontSize: 13, fontWeight: 600, textAlign: "center" }}>{netErr}</div>}
            {conn === "connecting" && <div style={{ gridColumn: "1 / -1", color: C.muted, fontSize: 13, textAlign: "center" }}>Connecting…</div>}
          </div>
        </div>
      </div>
    );
  }

  if (screen === "lobby") {
    if (!room) {
      return (
        <div className="vh" style={{ background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: C.muted, fontSize: 14, fontWeight: 600 }}>Connecting<span className="dots"><span>.</span><span>.</span><span>.</span></span></div>
        </div>
      );
    }
    const me = room.members.find(mm => mm.you);
    const isHost = !!me?.host;
    const sendCfg = patch => netRef.current?.send({ type: "config", config: { ...room.config, ...patch } });
    const copyLink = async () => {
      S.tap();
      const url = (() => { try { return `${location.origin}${location.pathname}?room=${room.code}`; } catch { return room.code; } })();
      try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); }
      catch { setNetErr(`Copy failed — share the code ${room.code}`); }
    };
    return (
      <div className="vh" style={{ background: C.bg, fontFamily: FONT, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: wide ? 720 : 420, display: "flex", flexDirection: "column", padding: "0 20px", paddingTop: "env(safe-area-inset-top)" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "14px 0" }}>
            <button onClick={leaveTable} style={{ background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, padding: 0 }}>← Leave</button>
            <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 800, color: C.ink }}>Private table</div>
            <span className="conn-dot" style={{ background: conn === "on" ? C.green : C.gold, marginLeft: 30 }} />
          </div>
          <div style={{ flex: 1, overflowY: "auto", display: wide ? "grid" : "flex", gridTemplateColumns: wide ? "1fr 1fr" : "none", alignContent: "start", flexDirection: "column", gap: 18, paddingTop: 8 }}>
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "18px 0 6px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>Room code</div>
              <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: ".3em", color: C.ink, fontVariantNumeric: "tabular-nums", marginLeft: ".3em" }}>{room.code}</div>
              <button className="btn" onClick={copyLink}
                style={{ marginTop: 10, fontFamily: FONT, fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.surface, color: copied ? C.green : C.ink, cursor: "pointer" }}>
                {copied ? "Link copied ✓" : "Copy invite link"}
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {room.members.map((mm, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 }}>
                  <span style={{ fontSize: 20 }}>{mm.emoji}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.ink, flex: 1 }}>
                    {mm.name}{mm.you ? " (you)" : ""}
                    {mm.host && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, background: C.ink, color: C.onPrim, borderRadius: 7, padding: "1px 6px", verticalAlign: "1px" }}>HOST</span>}
                  </span>
                  <span className="conn-dot" style={{ background: mm.connected ? C.green : C.gold }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: mm.ready ? C.green : C.faint, width: 44, textAlign: "right" }}>{mm.ready ? "Ready" : "…"}</span>
                </div>
              ))}
              {room.members.length < 2 && !room.config.fillAI && (
                <div style={{ fontSize: 12, color: C.faint, textAlign: "center", padding: "4px 0" }}>Waiting for players — share the code above.</div>
              )}
              {room.config.fillAI && (
                <div style={{ fontSize: 12, color: C.faint, textAlign: "center", padding: "4px 0" }}>Empty seats will be filled with AI players.</div>
              )}
            </div>
            {isHost ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <SetupLabel>Blinds</SetupLabel>
                  <OptionRow options={BLIND_PRESETS} value={[room.config.sb, room.config.bb]}
                    onChange={([sb, bb]) => sendCfg({ sb, bb })} render={([a, b]) => `${a}/${b}`} />
                </div>
                <div>
                  <SetupLabel>Starting stack</SetupLabel>
                  <OptionRow options={STACK_PRESETS} value={room.config.stack}
                    onChange={stack => sendCfg({ stack })} render={v => fmt(v)} />
                </div>
                <div>
                  <SetupLabel>Fill empty seats with AI</SetupLabel>
                  <OptionRow options={[true, false]} value={room.config.fillAI}
                    onChange={fillAI => sendCfg({ fillAI })} render={v => (v ? "Yes" : "No")} />
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: C.muted, textAlign: "center" }}>
                Blinds {room.config.sb}/{room.config.bb} · Stack {fmt(room.config.stack)} · {room.config.fillAI ? "AI fill on" : "humans only"}
              </div>
            )}
            {netErr && <div style={{ gridColumn: "1 / -1", color: C.red, fontSize: 13, fontWeight: 600, textAlign: "center" }}>{netErr}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, padding: "12px 0", paddingBottom: "calc(28px + env(safe-area-inset-bottom))", width: "100%", maxWidth: wide ? 480 : "none", margin: wide ? "0 auto" : undefined }}>
            <Btn onClick={() => { netRef.current?.send({ type: "ready", ready: !me?.ready }); }}>{me?.ready ? "Not ready" : "I'm ready"}</Btn>
            {isHost && <Btn kind="accent" disabled={!room.canStart} onClick={() => netRef.current?.send({ type: "start" })} style={{ flex: 2 }}>Start game</Btn>}
          </div>
        </div>
      </div>
    );
  }

  if (screen === "history") {
    return (
      <div className="vh" style={{ background: C.bg, fontFamily: FONT, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: wide ? 720 : 420, display: "flex", flexDirection: "column", padding: "0 20px", paddingTop: "env(safe-area-inset-top)" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "14px 0" }}>
            <button onClick={() => setScreen(histFrom.current)} style={{ background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, padding: 0 }}>← Back</button>
            <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 800, color: C.ink, marginRight: 44 }}>Hand history</div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", display: wide ? "grid" : "flex", gridTemplateColumns: wide ? "1fr 1fr" : "none", alignContent: "start", flexDirection: "column", gap: 10, paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }}>
            {history.length === 0 && (
              <div style={{ gridColumn: "1 / -1", textAlign: "center", color: C.muted, fontSize: 14, padding: "60px 20px", lineHeight: 1.6 }}>
                No hands yet.<br />Finished hands land here — the last 25 are kept.
              </div>
            )}
            {history.map((e, i) => {
              const open = expandedHand === i;
              const streets = ["preflop", "flop", "turn", "river"];
              return (
                <div key={`${e.ts}-${i}`} onClick={() => { S.tap(); setExpandedHand(open ? null : i); }}
                  style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "12px 14px", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>Hand #{e.hand}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: netColor(e.net), fontVariantNumeric: "tabular-nums" }}>{netStr(e.net)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ display: "flex", gap: 3 }}>
                      {e.hero.map((c, k) => <CardFace key={k} card={c} w={26} h={36} fs={11} />)}
                    </div>
                    <div style={{ width: 1, height: 30, background: C.line }} />
                    <div style={{ display: "flex", gap: 3 }}>
                      {e.board.length
                        ? e.board.map((c, k) => <CardFace key={k} card={c} w={26} h={36} fs={11} />)
                        : <span style={{ fontSize: 12, color: C.faint, alignSelf: "center" }}>no flop</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
                    {e.lines.filter(l => l.pot !== "returned").map((l, k) => (
                      <span key={k}>{k > 0 && " · "}{l.name} won {fmt(l.amount)}{l.label ? ` (${l.label})` : ""}</span>
                    ))}
                  </div>
                  {open && e.actions?.length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
                      {streets.filter(st => e.actions.some(a => a.st === st)).map(st => (
                        <div key={st} style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: C.faint, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 }}>{st}</div>
                          {e.actions.filter(a => a.st === st).map((a, k) => (
                            <div key={k} style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
                              <span style={{ fontWeight: 700, color: C.ink }}>{a.n}</span> {a.l}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (screen === "stats") {
    const st = store.loadStats();
    const from = game ? "game" : "home";
    return (
      <div className="vh" style={{ background: C.bg, fontFamily: FONT, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: wide ? 720 : 420, display: "flex", flexDirection: "column", padding: "0 20px", paddingTop: "env(safe-area-inset-top)" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "14px 0" }}>
            <button onClick={() => setScreen(from)} style={{ background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, padding: 0 }}>← Back</button>
            <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 800, color: C.ink, marginRight: 44 }}>Lifetime stats</div>
          </div>
          <div style={{ flex: 1, display: wide ? "grid" : "flex", gridTemplateColumns: wide ? "1fr 1fr" : "none", alignContent: "start", flexDirection: "column", gap: 10, paddingTop: 8 }}>
            <StatRow label="Tables played" value={st.tables} />
            <StatRow label="Hands played" value={st.hands} />
            <StatRow label="Hands won" value={`${st.won}${st.hands ? ` (${Math.round((st.won / st.hands) * 100)}%)` : ""}`} />
            <StatRow label="Net chips" value={netStr(st.net)} color={netColor(st.net)} />
            <StatRow label="Biggest pot won" value={fmt(st.biggestPot)} />
            <StatRow label="Rebuys" value={st.rebuys} />
          </div>
          <div style={{ paddingBottom: "calc(32px + env(safe-area-inset-bottom))", width: "100%", maxWidth: wide ? 440 : "none", margin: wide ? "0 auto" : undefined }}>
            <Btn kind="danger" onClick={() => { store.resetStats(); setScreen("home"); setTimeout(() => setScreen("stats"), 0); }} style={{ width: "100%" }}>Reset stats</Btn>
          </div>
        </div>
      </div>
    );
  }

  if (!game) return null;
  const streetName = { preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River" }[game.street];
  const maxTo = hero.bet + hero.chips;
  const minTo = Math.min(game.currentBet + game.minRaise, maxTo);
  const heroBusted = game.stage === "over" && hero.chips === 0;
  const buyIn = (game.startStack || 10000) * (1 + session.rebuys);
  const sessionNet = hero.chips + hero.total - buyIn;
  const stepRaise = d => {
    setRaiseTo(v => Math.max(minTo, Math.min(maxTo, v + d * sbAmt)));
    S.tick(); buzz(4);
  };
  const heroCardW = wide ? (short ? 46 : 74) : 62;
  const heroCardH = Math.round(heroCardW * 88 / 62);
  const heroCardFs = Math.round(heroCardW * 25 / 62);
  const boardW = wide ? (short ? 50 : 70) : 47;
  const boardH = Math.round(boardW * 66 / 47);
  const infoAlign = wide ? "flex-start" : "flex-end";
  const tileStyle = {
    background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20,
    boxShadow: "0 12px 32px rgba(20,24,33,.14)", padding: "14px 18px",
  };

  const heroPct =
    game.stage === "runout" && runPcts && runPcts[0] != null
      ? { val: Math.round(runPcts[0] * 100), win: runPcts[0] >= 0.5 }
      : (!hero.folded && equity !== null && game.stage === "hand" && settings.showEquity)
      ? { val: eqDisp, win: equity > 0.5 }
      : null;

  const heroInfo = (
    <div style={{ textAlign: wide ? "left" : "right", paddingBottom: 4 }}>
      <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 3 }}>
        {hero.folded ? "Folded" : heroHandText}
        {game.dealer === 0 && <span style={{ marginLeft: 6, background: C.ink, color: C.onPrim, borderRadius: 8, padding: "1px 6px", fontSize: 10, fontWeight: 800 }}>D</span>}
      </div>
      {game.stage === "runout" && runPcts && runPcts[0] != null && (
        <div key={Math.round(runPcts[0] * 100)} className="bet-pop" style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", color: runPcts[0] >= 0.5 ? C.green : runPcts[0] === 0 ? C.red : C.ink, fontVariantNumeric: "tabular-nums" }}>
        {Math.round(runPcts[0] * 100)}<span style={{ fontSize: 14, color: C.muted, fontWeight: 700 }}>% to win</span>
        </div>
      )}
      {!hero.folded && equity !== null && game.stage === "hand" && settings.showEquity && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: infoAlign, gap: 4 }}>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", color: equity > 0.5 ? C.green : C.ink, fontVariantNumeric: "tabular-nums", transition: "color .3s" }}>
            {eqDisp}<span style={{ fontSize: 14, color: C.muted, fontWeight: 700 }}>% to win</span>
          </div>
          <div style={{ width: 110, height: 5, borderRadius: 3, background: C.line, overflow: "hidden" }}>
            <div className="eq-bar-fill" style={{ width: `${equity * 100}%`, height: "100%", background: equity > 0.5 ? C.green : C.accent }} />
          </div>
        </div>
      )}
      <div style={{ fontSize: 13, color: C.ink, fontWeight: 700, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
        {fmt(hero.chips)} <span style={{ color: C.muted, fontWeight: 600 }}>chips</span>
        {hero.bet > 0 && <span style={{ color: C.accent }}> · {fmt(hero.bet)} in</span>}
      </div>
    </div>
  );

  const actionContent = (
    <>
      {mode === "mp" && isHeroTurn && deadlineMs ? (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}><TimerBar deadline={deadlineMs} width={220} /></div>
      ) : null}
      {mode === "mp" && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8, justifyContent: "center" }}>
          {REACTIONS.map(e => (
            <button key={e} className="btn" onClick={() => { netRef.current?.send({ type: "reaction", emoji: e }); buzz(6); }}
              style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, fontSize: 15, padding: "3px 10px", cursor: "pointer" }}>{e}</button>
          ))}
        </div>
      )}
      {game.stage === "over" ? (
        mode === "mp" ? (
          <div style={{ textAlign: "center", color: C.muted, fontSize: 14, fontWeight: 600, padding: "14px 0" }}>
            Next hand is on the way…
          </div>
        ) : heroBusted ? (
          <div style={{ display: "flex" }}>
            <Btn kind="accent" onClick={() => {
              setSession(sn => ({ ...sn, rebuys: sn.rebuys + 1 }));
              setGame(g => { const n = clone(g); n.players[0].chips = g.startStack || 10000; return startHand(n); });
            }}>Rebuy {fmt(game.startStack || 10000)} & deal</Btn>
          </div>
        ) : (
          <div style={{ display: "flex" }}>
            <Btn kind="primary" onClick={() => setGame(g => startHand(g))}>Next hand</Btn>
          </div>
        )
      ) : game.stage === "runout" ? (
        mode === "solo" && hero.folded ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, textAlign: "center", color: C.muted, fontSize: 14, fontWeight: 600 }}>
              Running it out<span className="dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
            <Btn onClick={skipHand} style={{ flex: 1, padding: "12px 0", fontSize: 14 }}>Skip</Btn>
          </div>
        ) : (
          <div style={{ textAlign: "center", color: C.muted, fontSize: 14, fontWeight: 600, padding: "14px 0" }}>
            Running it out<span className="dots"><span>.</span><span>.</span><span>.</span></span>
          </div>
        )
      ) : !isHeroTurn ? (
        mode === "solo" && hero.folded ? (
          <div style={{ display: "flex" }}>
            <Btn onClick={skipHand}>Skip to next hand</Btn>
          </div>
        ) : (
          <div style={{ textAlign: "center", color: C.muted, fontSize: 14, fontWeight: 600, padding: "14px 0" }}>
            {hero.folded ? "Waiting for the hand to finish…" : (
              <>{game.players[game.turn].name} is thinking<span className="dots"><span>.</span><span>.</span><span>.</span></span></>
            )}
          </div>
        )
      ) : raiseOpen ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>{game.currentBet > 0 ? "Raise to" : "Bet"}</span>
            <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: C.ink }}>{fmt(raiseTo)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn" onClick={() => stepRaise(-1)} disabled={raiseTo <= minTo}
              style={{ width: 40, height: 40, borderRadius: 12, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontSize: 20, fontWeight: 700, cursor: "pointer", opacity: raiseTo <= minTo ? 0.4 : 1, fontFamily: FONT, flexShrink: 0 }}>−</button>
            <input type="range" min={minTo} max={maxTo} step={sbAmt} value={raiseTo}
              onChange={e => {
                setRaiseTo(+e.target.value);
                const now = Date.now();
                if (now - lastTick.current > 50) { S.tick(); buzz(4); lastTick.current = now; }
              }}
              style={{ width: "100%", flex: 1 }} />
            <button className="btn" onClick={() => stepRaise(1)} disabled={raiseTo >= maxTo}
              style={{ width: 40, height: 40, borderRadius: 12, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontSize: 20, fontWeight: 700, cursor: "pointer", opacity: raiseTo >= maxTo ? 0.4 : 1, fontFamily: FONT, flexShrink: 0 }}>+</button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              ["Min", minTo],
              ["½ pot", Math.min(maxTo, game.currentBet + Math.round((pot * 0.5) / sbAmt) * sbAmt)],
              ["Pot", Math.min(maxTo, game.currentBet + Math.round(pot / sbAmt) * sbAmt)],
              ["All-in", maxTo],
            ].map(([lab, v]) => (
              <button key={lab} className="btn" onClick={() => { S.tap(); buzz(6); setRaiseTo(Math.max(minTo, v)); }}
                style={{ flex: 1, fontFamily: FONT, fontSize: 12, fontWeight: 700, padding: "8px 0", borderRadius: 10, border: `1px solid ${C.line}`, background: raiseTo === Math.max(minTo, v) ? C.ink : C.surface, color: raiseTo === Math.max(minTo, v) ? C.onPrim : C.ink, cursor: "pointer" }}>
                {lab}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={() => setRaiseOpen(false)}>Back</Btn>
            <Btn kind="accent" onClick={() => act({ type: "raise", to: raiseTo })} style={{ flex: 2 }}>
              {raiseTo >= maxTo ? "All-in" : game.currentBet > 0 ? `Raise to ${fmt(raiseTo)}` : `Bet ${fmt(raiseTo)}`}
            </Btn>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="danger" onClick={() => act({ type: "fold" })}>Fold</Btn>
          <Btn kind="ghost" onClick={() => act({ type: "call" })}>
            {toCall === 0 ? "Check" : `Call ${fmt(Math.min(toCall, hero.chips))}`}
          </Btn>
          <Btn kind="accent" onClick={openRaise} disabled={hero.chips <= toCall || hero.acted}>
            {game.currentBet > 0 ? "Raise" : "Bet"}
          </Btn>
        </div>
      )}
    </>
  );

  return (
    <div className="vh" style={{ background: C.bg, fontFamily: FONT, display: "flex", justifyContent: "center" }}>
      <div ref={containerRef} className="vh" style={{ width: "100%", maxWidth: wide ? "none" : 420, display: "flex", flexDirection: "column", position: "relative", paddingTop: "env(safe-area-inset-top)" }}>

        {flights.map(f => <ChipFlyer key={f.id} from={f.from} to={f.to} delay={f.delay} />)}
        {reactions.map(r => <div key={r.id} className="reaction-float" style={{ left: r.x - 12, top: r.y }}>{r.emoji}</div>)}
        {game.stage === "over" && confettiKey === game.handNo && <Confetti key={confettiKey} />}
        {mode === "mp" && conn !== "on" && (
          <Modal>
            <div style={{ textAlign: "center", color: C.ink, fontWeight: 800, fontSize: 16, padding: "6px 0" }}>Reconnecting<span className="dots"><span>.</span><span>.</span><span>.</span></span></div>
            <div style={{ textAlign: "center", color: C.muted, fontSize: 13, marginTop: 4 }}>Hang tight — your seat is held for 60 seconds.</div>
          </Modal>
        )}
        {leaveOpen && (
          <Modal>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, marginBottom: 4 }}>Leave the table?</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Session summary</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
              <StatRow label="Hands won" value={`${session.won}/${session.hands}`} />
              <StatRow label="Net chips" value={netStr(sessionNet)} color={netColor(sessionNet)} />
              <StatRow label="Biggest pot" value={fmt(session.biggest)} />
              {session.rebuys > 0 && <StatRow label="Rebuys" value={session.rebuys} />}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={() => setLeaveOpen(false)}>Keep playing</Btn>
              <Btn kind="danger" onClick={leaveTable}>Leave table</Btn>
            </div>
          </Modal>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: wide ? "14px 24px" : "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => { S.tap(); setLeaveOpen(true); }} style={{ background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, padding: 0 }}>← Leave</button>
            {mode === "mp" && <span className="conn-dot" style={{ background: conn === "on" ? C.green : C.gold }} />}
          </div>
          <button onClick={() => openHistory("game")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 13, fontWeight: 700, color: C.ink, padding: 0 }}>
            Hand #{game.handNo} <span style={{ color: C.faint }}>·</span> <span style={{ color: C.muted, fontWeight: 600 }}>{streetName}</span>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{session.won}/{session.hands} won</div>
            <button onClick={toggleDark} aria-label="Toggle dark mode"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, padding: 0, color: C.muted, fontFamily: FONT }}>
              {dark ? "☀︎" : "☾"}
            </button>
            <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, padding: 0, opacity: muted ? 0.45 : 1 }}>
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-around", padding: wide ? "4px 24px 0" : "4px 8px 0", width: "100%", maxWidth: wide ? 860 : "none", margin: "0 auto" }}>
          {game.players.slice(1).map((p, i) => (
            <Seat key={p.name} p={p} folded={p.folded}
              isTurn={game.stage === "hand" && game.turn === i + 1}
              isDealer={game.dealer === i + 1}
              dealKey={game.handNo} seatIdx={i}
              pct={runPcts ? runPcts[i + 1] : null}
              deadline={deadlineMs}
              dimmed={mode === "mp" && connList.some(cn => cn.name === p.name && !cn.connected)}
              innerRef={el => (seatEls.current[i + 1] = el)} />
          ))}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: wide && short ? 8 : 14, padding: "8px 16px", minHeight: 0 }}>
          <div ref={potRef} key={pot} className="pot-pop" style={{ fontSize: 13, fontWeight: 700, color: C.ink, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, padding: "6px 16px", fontVariantNumeric: "tabular-nums" }}>
            Pot {fmt(potDisp)}
          </div>
          <div style={{ display: "flex", gap: 7, height: boardH }}>
            {[0, 1, 2, 3, 4].map(i =>
              game.board[i]
                ? <CardFace key={`${game.handNo}-${i}`} card={game.board[i]} w={boardW} h={boardH} fs={Math.round(boardW * 18 / 47)}
                    className="flip-in" style={{ animationDelay: `${(i < 3 ? i : 0) * 110}ms` }} />
                : <div key={i} style={{ width: boardW, height: boardH, borderRadius: 8, border: `1.5px dashed ${C.faint}`, opacity: 0.5 }} />
            )}
          </div>
          {game.stage === "over" && game.result && (
            <div className="banner-up" style={{ background: C.bannerBg, color: "#fff", borderRadius: 16, padding: "12px 20px", textAlign: "center", boxShadow: "0 8px 24px rgba(20,24,33,.25)", zIndex: 55 }}>
              {game.result.lines.map((l, i) => (
                <div key={i} style={{ fontSize: 14, fontWeight: 600 }}>
                  <span style={{ color: l.hero ? "#7EF0B0" : "#fff" }}>{l.name}</span>
                  {l.pot === "returned" ? " gets " : " wins "}
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{fmt(l.amount)}</span>
                  {l.pot === "returned" ? (
                    <span style={{ color: "rgba(255,255,255,.6)" }}> back (uncalled bet)</span>
                  ) : (
                    <>
                      {l.label && <span style={{ color: "rgba(255,255,255,.6)" }}> · {l.label}</span>}
                      {l.pot && <span style={{ color: "rgba(255,255,255,.6)" }}> ({l.pot})</span>}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {!wide ? (
          <>
            <div style={{ padding: "0 16px 8px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
              <div ref={el => (seatEls.current[0] = el)}>
                <div style={{ display: "flex", gap: 8, opacity: hero.folded ? 0.35 : 1, transition: "opacity .35s" }}>
                  {hero.cards.map((c, i) => (
                    <CardFace key={`${game.handNo}-${i}`} card={c} w={heroCardW} h={heroCardH} fs={heroCardFs}
                      className="deal-in" style={{ animationDelay: `${(i * 5 + 4) * 55}ms` }} />
                  ))}
                </div>
              </div>
              {heroInfo}
            </div>
            <div style={{ padding: "10px 16px", paddingBottom: "calc(26px + env(safe-area-inset-bottom))", borderTop: `1px solid ${C.line}`, background: C.surface2 }}>
              {actionContent}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 20, padding: "0 24px", paddingBottom: short ? "calc(24px + env(safe-area-inset-bottom))" : "calc(12vh + env(safe-area-inset-bottom))" }}>
            <div style={{ flex: 1, display: "flex", justifyContent: "flex-start" }}>
              <div key={`info-${game.handNo}-${game.street}`} className="tile-in" style={{ ...tileStyle, minWidth: 210 }}>
                {heroInfo}
              </div>
            </div>
            <div ref={el => (seatEls.current[0] = el)} style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ display: "flex", opacity: hero.folded ? 0.35 : 1, transition: "opacity .35s" }}>
                {hero.cards.map((c, i) => (
                  <div key={`${game.handNo}-${i}`} className="deal-in" style={{ animationDelay: `${(i * 5 + 4) * 55}ms`, marginLeft: i ? -18 : 0, zIndex: i }}>
                    <div style={{ transform: `rotate(${i ? 6 : -6}deg) translateY(${i ? 3 : 0}px)` }}>
                      <CardFace card={c} w={heroCardW} h={heroCardH} fs={heroCardFs} style={{ boxShadow: "0 4px 14px rgba(20,24,33,.22)" }} />
                    </div>
                  </div>
                ))}
              </div>
              {heroPct && (
                <div key={heroPct.val} className="bet-pop" style={{ marginTop: 10, fontSize: 13, fontWeight: 800, color: heroPct.win ? C.green : C.ink, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "3px 11px", fontVariantNumeric: "tabular-nums", boxShadow: "0 4px 12px rgba(20,24,33,.12)" }}>
                  {heroPct.val}<span style={{ color: C.muted, fontWeight: 700 }}>% win</span>
                </div>
              )}
            </div>
            <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
              <div key={`act-${game.handNo}-${game.street}-${game.stage}-${isHeroTurn ? 1 : 0}`} className="tile-in" style={{ ...tileStyle, width: "min(440px, 40vw)" }}>
                {actionContent}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
