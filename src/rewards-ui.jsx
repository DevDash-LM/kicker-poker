// Rewards screen: the daily card draw + daily quests.
// The server picks the card and every amount (claim_daily / claim_quest in
// schema.sql); this screen only animates the reveal and shows the pool odds.
import { useState, useEffect, useCallback } from "react";
import { C, FONT } from "./theme.js";
import { Btn, CardFace, CardBack } from "./components.jsx";
import { S, buzz } from "./fx/fx.js";
import * as rewards from "./rewards.js";
import {
  questProgress, normalizeDaily, DAILY_POOL, DAILY_STREAK_BONUS, DAILY_STREAK_CAP,
  rewardsErrorMessage,
} from "./progress.js";

const fmtChips = n => (typeof n === "number" ? n.toLocaleString("en-US") : "…");

function SectionLabel({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>{children}</div>;
}

export function RewardsScreen({ wide, authUser, walletBal, onBalance, dailyStatus, onDailyStatus, onSignIn, onClose }) {
  const signedIn = !!authUser;
  const [quests, setQuests] = useState(null);
  const [claimedQuests, setClaimedQuests] = useState(() => new Set());
  const [progress, setProgress] = useState(() => normalizeDaily(rewards.loadDailyProgress()));
  const [revealed, setRevealed] = useState(null); // { rank, suit, amount, streak } after a fresh claim
  const [busy, setBusy] = useState(null);         // "daily" | quest id
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const [qs, qc] = await Promise.all([
        rewards.fetchQuests(),
        signedIn ? rewards.fetchQuestClaims() : Promise.resolve(new Set()),
      ]);
      setQuests(qs); setClaimedQuests(qc);
    } catch { setQuests(q => q || []); }
    setProgress(normalizeDaily(rewards.loadDailyProgress()));
  }, [signedIn]);

  useEffect(() => { load(); }, [load]);

  const claimDaily = async () => {
    if (!signedIn) { onSignIn?.(); return; }
    setBusy("daily"); setErr(null);
    try {
      const r = await rewards.claimDaily();
      setRevealed(r);
      onBalance?.(r.balance);
      onDailyStatus?.({ claimedToday: true, streak: r.streak, today: { card_rank: r.rank, card_suit: r.suit, amount: r.amount, streak: r.streak } });
      S.win?.(); buzz([20, 30, 40]);
    } catch (e) {
      setErr(rewardsErrorMessage(e?.code));
      if (e?.code === "claimed") onDailyStatus?.({ ...(dailyStatus || {}), claimedToday: true });
    }
    finally { setBusy(null); }
  };

  const claimQuest = async (q) => {
    if (!signedIn) { onSignIn?.(); return; }
    setBusy(q.id); setErr(null);
    try {
      const r = await rewards.claimQuest(q.id);
      onBalance?.(r.balance);
      setClaimedQuests(prev => new Set(prev).add(q.id));
      S.win?.(); buzz(16);
    } catch (e) {
      setErr(rewardsErrorMessage(e?.code));
      if (e?.code === "claimed") setClaimedQuests(prev => new Set(prev).add(q.id));
    }
    finally { setBusy(null); }
  };

  const claimedToday = revealed != null || !!dailyStatus?.claimedToday;
  const todayCard = revealed
    ? { r: revealed.rank, s: revealed.suit }
    : dailyStatus?.today ? { r: dailyStatus.today.card_rank, s: dailyStatus.today.card_suit } : null;
  const todayAmount = revealed?.amount ?? dailyStatus?.today?.amount ?? null;
  const streak = revealed?.streak ?? dailyStatus?.streak ?? 0;

  return (
    <div className="vh" style={{ background: C.bg, fontFamily: FONT, display: "flex", justifyContent: "center", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: wide ? 720 : 420, display: "flex", flexDirection: "column", padding: "0 20px", paddingTop: "env(safe-area-inset-top)" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "14px 0" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, padding: 0 }}>← Back</button>
          <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 800, color: C.ink }}>Rewards</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, fontVariantNumeric: "tabular-nums", minWidth: 44, textAlign: "right" }}>
            {signedIn ? fmtChips(walletBal) : ""}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24, paddingBottom: "calc(32px + env(safe-area-inset-bottom))" }}>
          {!signedIn && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 }}>
              <span style={{ flex: 1, fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
                Sign in to draw a daily card and earn saved chips from quests.
              </span>
              <Btn kind="accent" onClick={onSignIn} style={{ flex: "0 0 92px", padding: "10px 0", fontSize: 13 }}>Sign in</Btn>
            </div>
          )}

          {/* Daily card draw */}
          <div>
            <SectionLabel>Daily card</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "22px 16px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18 }}>
              {claimedToday && todayCard ? (
                <>
                  <CardFace card={todayCard} w={84} h={118} fs={32} className="flip-in" />
                  {todayAmount != null && (
                    <div style={{ fontSize: 17, fontWeight: 800, color: C.green, fontVariantNumeric: "tabular-nums" }}>
                      +{fmtChips(todayAmount)} chips
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>
                    {streak > 1 ? `🔥 ${streak}-day streak — come back tomorrow to keep it.` : "Come back tomorrow for another draw."}
                  </div>
                </>
              ) : claimedToday ? (
                <div style={{ fontSize: 14, color: C.muted, fontWeight: 600, padding: "18px 0" }}>
                  Today’s card is claimed — come back tomorrow.
                </div>
              ) : (
                <>
                  <CardBack w={84} h={118} className="deal-in" />
                  <Btn kind="accent" disabled={busy === "daily"} onClick={claimDaily} style={{ width: "100%", maxWidth: 260 }}>
                    {busy === "daily" ? "Drawing…" : signedIn ? "Reveal today’s card" : "Sign in to draw"}
                  </Btn>
                  {streak > 0 && (
                    <div style={{ fontSize: 12, color: C.gold, fontWeight: 700 }}>🔥 {streak}-day streak going</div>
                  )}
                </>
              )}
              <div style={{ fontSize: 12, color: C.faint, textAlign: "center", lineHeight: 1.6 }}>
                {DAILY_POOL.map(p => `${p.label} → ${fmtChips(p.amount)}`).join(" · ")}
                <br />+{fmtChips(DAILY_STREAK_BONUS)} per streak day (up to +{fmtChips(DAILY_STREAK_BONUS * DAILY_STREAK_CAP)}). Free, once a day.
              </div>
            </div>
          </div>

          {err && <div style={{ fontSize: 13, color: C.red, fontWeight: 600, textAlign: "center" }}>{err}</div>}

          {/* Daily quests */}
          <div>
            <SectionLabel>Daily quests</SectionLabel>
            {quests === null ? (
              <div style={{ textAlign: "center", color: C.muted, fontSize: 14, fontWeight: 600, padding: "20px 0" }}>
                Loading<span className="dots"><span>.</span><span>.</span><span>.</span></span>
              </div>
            ) : quests.length === 0 ? (
              <div style={{ textAlign: "center", color: C.muted, fontSize: 13, padding: "16px 0" }}>No quests available right now.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {quests.map(q => {
                  const done = claimedQuests.has(q.id);
                  const prog = Math.min(questProgress(q.id, progress), q.goal);
                  const ready = !done && prog >= q.goal;
                  return (
                    <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: C.surface, border: `1.5px solid ${ready ? C.accent : C.line}`, borderRadius: 14 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{q.name}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                          <div style={{ flex: 1, height: 5, borderRadius: 3, background: C.line, overflow: "hidden", maxWidth: 140 }}>
                            <div style={{ width: `${(done ? 1 : prog / q.goal) * 100}%`, height: "100%", background: done ? C.green : C.accent, transition: "width .3s ease" }} />
                          </div>
                          <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                            {done ? "Done" : `${prog}/${q.goal}`}
                          </span>
                        </div>
                      </div>
                      <button className="btn" disabled={done || !ready || busy === q.id}
                        onClick={() => { if (ready) { S.tap(); buzz(8); claimQuest(q); } }}
                        style={{
                          fontFamily: FONT, fontSize: 12, fontWeight: 800, padding: "8px 14px", borderRadius: 10,
                          border: "none", cursor: ready ? "pointer" : "default", minWidth: 86,
                          fontVariantNumeric: "tabular-nums",
                          background: done ? C.surface : ready ? C.accent : C.surface,
                          color: done ? C.green : ready ? "#fff" : C.faint,
                          boxShadow: done || !ready ? `inset 0 0 0 1px ${C.line}` : "none",
                        }}>
                        {busy === q.id ? "…" : done ? "Claimed ✓" : `+${fmtChips(q.reward)}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: 12, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
              Quests reset daily (UTC) and track play on this device. Rewards are play chips — no cash value.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
