import { useState, useEffect, useRef, useCallback } from "react";
import { C, FONT } from "./theme.js";
import { Btn } from "./components.jsx";
import { S, buzz } from "./fx/fx.js";
import { AVATARS } from "../server/protocol.js";
import * as acct from "./account.js";
import {
  authErrorMessage, addFriendMessage, looksLikeEmail,
  normalizeFriendCode, isValidFriendCode, prettyFriendCode,
  passwordProblem, MIN_PASSWORD,
} from "./account-util.js";

// Small self-contained "add friend by code" button, used next to verified
// players in the room lobby and in the recent-players list.
export function AddFriendButton({ friendCode, compact }) {
  const [state, setState] = useState("idle"); // idle | busy | done | err
  const [msg, setMsg] = useState(null);
  const add = async () => {
    if (state === "busy" || state === "done") return;
    setState("busy");
    try {
      const status = await acct.addFriendByCode(friendCode);
      const m = addFriendMessage(status);
      setMsg(m.message);
      setState(m.ok || status === "already_friends" || status === "already_sent" ? "done" : "err");
    } catch { setMsg("Couldn’t add. Try again."); setState("err"); }
  };
  return (
    <button className="btn" onClick={() => { S.tap(); buzz(6); add(); }} title={msg || "Add friend"}
      disabled={state === "busy" || state === "done"}
      style={{
        fontFamily: FONT, fontSize: compact ? 11 : 12, fontWeight: 800, padding: compact ? "5px 10px" : "7px 12px",
        borderRadius: 9, border: `1px solid ${state === "done" ? C.green : C.line}`,
        background: C.surface, color: state === "done" ? C.green : state === "err" ? C.red : C.accent,
        cursor: state === "busy" || state === "done" ? "default" : "pointer", whiteSpace: "nowrap",
      }}>
      {state === "busy" ? "…" : state === "done" ? "✓" : state === "err" ? "Retry" : "+ Add"}
    </button>
  );
}

// Verified players you've recently shared a table with (stored locally).
export function RecentPlayers({ players }) {
  if (!players || players.length === 0) return null;
  return (
    <div>
      <Label>Recent players</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {players.slice(0, 6).map(p => (
          <div key={p.friendCode} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 }}>
            <span style={{ fontSize: 18 }}>{p.emoji}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.ink }}>{p.name}</span>
            <AddFriendButton friendCode={p.friendCode} compact />
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>Players with a ✓ you’ve shared a table with recently.</div>
    </div>
  );
}
import * as wallet from "./wallet.js";
import { ledgerLabel } from "./wallet-util.js";

const fmtChips = n => (typeof n === "number" ? n.toLocaleString("en-US") : "…");
const fmtDelta = n => (n > 0 ? `+${fmtChips(n)}` : fmtChips(n));

// Saved-chips balance + recent activity. Read-only: the balance can only be
// changed by the server-side wallet functions, never from here.
function WalletSection() {
  const [bal, setBal] = useState(null);
  const [ledger, setLedger] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [b, l] = await Promise.all([wallet.getBalance(), wallet.listLedger(8)]);
        if (live) { setBal(b); setLedger(l); }
      } catch { if (live) setLedger([]); }
    })();
    return () => { live = false; };
  }, []);

  return (
    <div>
      <Label>Saved chips</Label>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "14px 16px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 }}>
        <span style={{ fontSize: 26, fontWeight: 800, color: C.ink, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{fmtChips(bal)}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>chips</span>
      </div>
      {ledger && ledger.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {ledger.map(e => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12 }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.ink }}>{ledgerLabel(e.reason)}</span>
              <span style={{ fontSize: 12, color: C.faint }}>{new Date(e.created_at).toLocaleDateString()}</span>
              <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: e.delta > 0 ? C.green : e.delta < 0 ? C.red : C.muted }}>{fmtDelta(e.delta)}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>
        Play chips only — they have no cash value and can't be bought or cashed out for money.
        Use them at solo tables by picking “Saved chips” in table setup.
      </div>
    </div>
  );
}

const RESEND_COOLDOWN = 30; // seconds
// Supabase email OTP length is configurable (6–10 digits). Accept the full
// range so a longer emailed code is not silently truncated on input.
const CODE_MIN = 6;
const CODE_MAX = 10;

function Overlay({ children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,16,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
      <div className="banner-up" style={{ position: "relative", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 22, padding: 22, width: "100%", maxWidth: 360, maxHeight: "92vh", overflowY: "auto" }}>
        {onClose && (
          <button onClick={onClose} aria-label="Close"
            style={{ position: "absolute", top: 12, right: 12, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: 16, color: C.muted, fontSize: 24, lineHeight: 1, cursor: "pointer", fontFamily: FONT, padding: 0 }}>&times;</button>
        )}
        {children}
      </div>
    </div>
  );
}

function Label({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>{children}</div>;
}

function Field(props) {
  return <input className="txt" {...props}
    style={{ background: C.surface, border: `1.5px solid ${C.line}`, color: C.ink, ...(props.style || {}) }} />;
}

function Logo({ height = 30 }) {
  return <img src="/logo-lockup.png" alt="Kicker" className="brand-mark" style={{ height, width: "auto", display: "block", margin: "0 auto" }} />;
}

function Note({ color, children }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: color || C.muted, textAlign: "center", lineHeight: 1.5 }}>{children}</div>;
}

// --------------------------------------------------------------------------
// Auth: one smart email + password screen.
//   - Existing account + right password -> straight in.
//   - New email -> creates the account and emails a one-time confirmation code
//     (used only on this first sign-up). After verifying, the password works
//     everywhere.
//   - "Forgot password?" emails a reset code (same send-email hook) to set a
//     new password.
// --------------------------------------------------------------------------
export function SignInModal({ onClose, onSignedIn }) {
  const [step, setStep] = useState("auth"); // auth | verify | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const em = () => email.trim();

  // Continue: sign in if the account exists, otherwise create it + send a code.
  const submit = async () => {
    if (!looksLikeEmail(em())) { setErr("That email doesn’t look right. Please check it."); return; }
    const pw = passwordProblem(password);
    if (pw) { setErr(pw); return; }
    setBusy(true); setErr(null); setOk(null);
    try {
      const user = await acct.signInWithPassword(em(), password);
      setOk("Signed in!"); S.win?.(); onSignedIn?.(user); return;
    } catch (e) {
      const m = String(e?.message || e?.msg || "").toLowerCase();
      if (m.includes("not confirmed") || m.includes("not been confirmed")) {
        try { await acct.resendSignupCode(em()); } catch { /* code may already be valid */ }
        setStep("verify"); setCooldown(RESEND_COOLDOWN);
        setOk(`Confirm your email — we sent a code to ${em()}.`);
        setBusy(false); return;
      }
      // Bad credentials: either a brand-new email, or a wrong password on an
      // existing account. signUp tells them apart.
      try {
        const { exists } = await acct.signUpWithPassword(em(), password);
        if (exists) {
          setErr("That email or password didn’t match. Reset your password if you’ve forgotten it.");
          setBusy(false); return;
        }
        setStep("verify"); setCooldown(RESEND_COOLDOWN);
        setOk(`We sent a confirmation code to ${em()}.`);
        setBusy(false); return;
      } catch (e2) { setErr(authErrorMessage(e2)); setBusy(false); }
    }
  };

  const verify = async () => {
    const c = code.trim();
    if (c.length < CODE_MIN) { setErr(`Enter the ${CODE_MIN}-digit code from your email.`); return; }
    setBusy(true); setErr(null);
    try {
      let user;
      try { user = await acct.verifyCode(em(), c, "signup"); }
      catch { user = await acct.verifyCode(em(), c, "email"); }
      setOk("You’re in!"); S.win?.(); onSignedIn?.(user);
    } catch (e) { setErr(authErrorMessage(e)); setBusy(false); }
  };

  const resendSignup = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true); setErr(null);
    try { await acct.resendSignupCode(em()); setCooldown(RESEND_COOLDOWN); setOk("New code sent."); }
    catch (e) { setErr(authErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const sendReset = async () => {
    if (!looksLikeEmail(em())) { setErr("That email doesn’t look right. Please check it."); return; }
    setBusy(true); setErr(null); setOk(null);
    try {
      await acct.requestPasswordReset(em());
      setResetSent(true); setCooldown(RESEND_COOLDOWN);
      setOk(`We sent a reset code to ${em()}.`);
    } catch (e) { setErr(authErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const doReset = async () => {
    const c = code.trim();
    if (c.length < CODE_MIN) { setErr(`Enter the ${CODE_MIN}-digit code from your email.`); return; }
    const pw = passwordProblem(newPassword);
    if (pw) { setErr(pw); return; }
    setBusy(true); setErr(null);
    try {
      const user = await acct.resetPassword(em(), c, newPassword);
      setOk("Password updated!"); S.win?.(); onSignedIn?.(user);
    } catch (e) { setErr(authErrorMessage(e)); setBusy(false); }
  };

  const goAuth = () => { setStep("auth"); setErr(null); setOk(null); setCode(""); setResetSent(false); };

  const PwToggle = () => (
    <button type="button" onClick={() => setShowPw(v => !v)}
      style={{ position: "absolute", top: "50%", right: 12, transform: "translateY(-50%)", background: "none", border: "none", color: C.muted, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT, padding: 4 }}>
      {showPw ? "Hide" : "Show"}
    </button>
  );

  return (
    <Overlay onClose={busy ? undefined : onClose}>
      <div style={{ marginBottom: 16 }}><Logo height={30} /></div>

      {step === "auth" && (
        <>
          <div style={{ textAlign: "center", fontSize: 19, fontWeight: 800, color: C.ink, marginBottom: 4 }}>Sign in to Kicker</div>
          <Note>Sign in, or enter a new email to create an account.</Note>
          <div style={{ marginTop: 18 }}>
            <Label>Email</Label>
            <Field type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
              value={email} autoCapitalize="off" autoCorrect="off"
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()} />
          </div>
          <div style={{ marginTop: 12 }}>
            <Label>Password</Label>
            <div style={{ position: "relative" }}>
              <Field type={showPw ? "text" : "password"} autoComplete="current-password" placeholder="Your password"
                value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submit()} style={{ paddingRight: 56 }} />
              <PwToggle />
            </div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>New here? Pick a password ({MIN_PASSWORD}+ characters) and we’ll email a one-time code to confirm.</div>
          </div>
          {ok && !err && <div style={{ marginTop: 12 }}><Note color={C.green}>{ok}</Note></div>}
          {err && <div style={{ marginTop: 12 }}><Note color={C.red}>{err}</Note></div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
            <Btn kind="accent" onClick={submit} disabled={busy}>{busy ? "Please wait…" : "Continue"}</Btn>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <button type="button" onClick={() => { setStep("reset"); setErr(null); setOk(null); setCode(""); setResetSent(false); }}
                style={{ background: "none", border: "none", color: C.accent, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT, padding: "6px 0" }}>
                Forgot password?
              </button>
              <button type="button" onClick={onClose} disabled={busy}
                style={{ background: "none", border: "none", color: C.muted, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT, padding: "6px 0" }}>
                Play as guest
              </button>
            </div>
          </div>
        </>
      )}

      {step === "verify" && (
        <>
          <div style={{ textAlign: "center", fontSize: 19, fontWeight: 800, color: C.ink, marginBottom: 4 }}>Confirm your email</div>
          <Note>Enter the code we sent to {em()}. You’ll only need this once.</Note>
          <div style={{ marginTop: 18 }}>
            <Label>Confirmation code</Label>
            <Field type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
              value={code} maxLength={CODE_MAX}
              onChange={e => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, CODE_MAX))}
              onKeyDown={e => e.key === "Enter" && verify()}
              style={{ letterSpacing: ".4em", fontWeight: 800, textAlign: "center", fontSize: 22 }} />
          </div>
          {ok && !err && <div style={{ marginTop: 10 }}><Note color={C.green}>{ok}</Note></div>}
          {err && <div style={{ marginTop: 10 }}><Note color={C.red}>{err}</Note></div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
            <Btn kind="accent" onClick={verify} disabled={busy || code.length < CODE_MIN}>{busy ? "Confirming…" : "Confirm & sign in"}</Btn>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={goAuth} disabled={busy} style={{ fontSize: 13, padding: "11px 0" }}>Back</Btn>
              <Btn onClick={resendSignup} disabled={busy || cooldown > 0} style={{ fontSize: 13, padding: "11px 0" }}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </Btn>
            </div>
          </div>
        </>
      )}

      {step === "reset" && (
        <>
          <div style={{ textAlign: "center", fontSize: 19, fontWeight: 800, color: C.ink, marginBottom: 4 }}>Reset your password</div>
          <Note>{resetSent ? `Enter the code we sent to ${em()} and choose a new password.` : "We’ll email you a code to set a new password."}</Note>
          {!resetSent ? (
            <div style={{ marginTop: 18 }}>
              <Label>Email</Label>
              <Field type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
                value={email} autoCapitalize="off" autoCorrect="off"
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendReset()} />
            </div>
          ) : (
            <>
              <div style={{ marginTop: 18 }}>
                <Label>Reset code</Label>
                <Field type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
                  value={code} maxLength={CODE_MAX}
                  onChange={e => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, CODE_MAX))}
                  style={{ letterSpacing: ".4em", fontWeight: 800, textAlign: "center", fontSize: 22 }} />
              </div>
              <div style={{ marginTop: 12 }}>
                <Label>New password</Label>
                <div style={{ position: "relative" }}>
                  <Field type={showPw ? "text" : "password"} autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`}
                    value={newPassword} onChange={e => setNewPassword(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && doReset()} style={{ paddingRight: 56 }} />
                  <PwToggle />
                </div>
              </div>
            </>
          )}
          {ok && !err && <div style={{ marginTop: 12 }}><Note color={C.green}>{ok}</Note></div>}
          {err && <div style={{ marginTop: 12 }}><Note color={C.red}>{err}</Note></div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
            {!resetSent ? (
              <Btn kind="accent" onClick={sendReset} disabled={busy}>{busy ? "Sending…" : "Send reset code"}</Btn>
            ) : (
              <Btn kind="accent" onClick={doReset} disabled={busy || code.length < CODE_MIN}>{busy ? "Updating…" : "Set new password"}</Btn>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={goAuth} disabled={busy} style={{ fontSize: 13, padding: "11px 0" }}>Back to sign in</Btn>
              {resetSent && (
                <Btn onClick={sendReset} disabled={busy || cooldown > 0} style={{ fontSize: 13, padding: "11px 0" }}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </Btn>
              )}
            </div>
          </div>
        </>
      )}
    </Overlay>
  );
}

// --------------------------------------------------------------------------
// Account screen: profile + friends + requests
// --------------------------------------------------------------------------
export function AccountScreen({ profile, onClose, onProfileChange, onSignedOut }) {
  const [name, setName] = useState(profile?.display_name || "");
  const [emoji, setEmoji] = useState(profile?.emoji || "🙂");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loadingFriends, setLoadingFriends] = useState(true);

  const [addCode, setAddCode] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState(null);

  const refresh = useCallback(async () => {
    setLoadingFriends(true);
    try {
      const [fr, rq] = await Promise.all([acct.listFriends(), acct.listRequests()]);
      setFriends(fr); setIncoming(rq.incoming); setOutgoing(rq.outgoing);
    } catch { /* leave lists as-is; network hiccup */ }
    finally { setLoadingFriends(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const dirty = name.trim() !== (profile?.display_name || "") || emoji !== (profile?.emoji || "🙂");
  const saveProfile = async () => {
    setSavingProfile(true); setProfileMsg(null);
    try {
      const p = await acct.updateProfile({ display_name: name, emoji });
      onProfileChange?.(p);
      setProfileMsg({ ok: true, text: "Saved." });
    } catch { setProfileMsg({ ok: false, text: "Couldn’t save. Try again." }); }
    finally { setSavingProfile(false); }
  };

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(profile.friend_code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  const addFriend = async () => {
    if (!isValidFriendCode(addCode)) { setAddMsg({ ok: false, text: "That code doesn’t look right." }); return; }
    setAddBusy(true); setAddMsg(null);
    try {
      const status = await acct.addFriendByCode(normalizeFriendCode(addCode));
      const m = addFriendMessage(status);
      setAddMsg({ ok: m.ok, text: m.message });
      if (m.ok) { setAddCode(""); refresh(); }
    } catch { setAddMsg({ ok: false, text: "Couldn’t add that friend. Try again." }); }
    finally { setAddBusy(false); }
  };

  const respond = async (id, accept) => {
    try {
      if (accept) await acct.acceptRequest(id); else await acct.declineRequest(id);
      refresh();
    } catch { /* ignore */ }
  };

  const signOut = async () => { await acct.signOut(); onSignedOut?.(); };

  return (
    <div className="vh" style={{ background: C.bg, fontFamily: FONT, display: "flex", justifyContent: "center", position: "fixed", inset: 0, zIndex: 150, overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", padding: "0 20px", paddingTop: "env(safe-area-inset-top)" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "14px 0" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, padding: 0 }}>← Back</button>
          <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 800, color: C.ink, marginRight: 44 }}>Account</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22, paddingTop: 6, paddingBottom: "calc(28px + env(safe-area-inset-bottom))" }}>
          {/* Profile */}
          <div>
            <Label>Your profile</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {AVATARS.map(e => (
                <button key={e} className="btn" onClick={() => { S.tap(); setEmoji(e); }}
                  style={{ flex: "1 1 38px", minWidth: 38, maxWidth: 48, aspectRatio: "1 / 1", borderRadius: "50%", fontSize: 19, cursor: "pointer", border: `2px solid ${emoji === e ? C.accent : C.line}`, background: C.surface }}>{e}</button>
              ))}
            </div>
            <Field value={name} maxLength={21} placeholder="Display name"
              onChange={e => setName(e.target.value)} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <Btn kind="primary" onClick={saveProfile} disabled={!dirty || savingProfile} style={{ flex: 1 }}>
                {savingProfile ? "Saving…" : "Save profile"}
              </Btn>
              {profileMsg && <span style={{ fontSize: 13, fontWeight: 700, color: profileMsg.ok ? C.green : C.red }}>{profileMsg.text}</span>}
            </div>
          </div>

          {/* Saved chips wallet */}
          <WalletSection />

          {/* Friend code */}
          <div>
            <Label>Your friend code</Label>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 }}>
              <span style={{ flex: 1, fontSize: 20, fontWeight: 800, letterSpacing: ".14em", color: C.ink, fontVariantNumeric: "tabular-nums" }}>{prettyFriendCode(profile.friend_code)}</span>
              <button className="btn" onClick={copyCode}
                style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, padding: "8px 14px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.surface, color: copied ? C.green : C.ink, cursor: "pointer" }}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>Share this code so friends can add you.</div>
          </div>

          {/* Add a friend */}
          <div>
            <Label>Add a friend</Label>
            <div style={{ display: "flex", gap: 8 }}>
              <Field value={addCode} placeholder="Friend code" autoCapitalize="characters" autoCorrect="off"
                onChange={e => setAddCode(normalizeFriendCode(e.target.value))}
                onKeyDown={e => e.key === "Enter" && addFriend()}
                style={{ letterSpacing: ".14em", fontWeight: 700, flex: 1, minWidth: 0 }} />
              <Btn kind="accent" onClick={addFriend} disabled={addBusy || !addCode} style={{ flex: "0 0 92px" }}>{addBusy ? "…" : "Add"}</Btn>
            </div>
            {addMsg && <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: addMsg.ok ? C.green : C.red }}>{addMsg.text}</div>}
          </div>

          {/* Incoming requests */}
          {incoming.length > 0 && (
            <div>
              <Label>Friend requests</Label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {incoming.map(r => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 }}>
                    <span style={{ fontSize: 20 }}>{r.profile?.emoji || "🙂"}</span>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.ink }}>{r.profile?.display_name || "Player"}</span>
                    <button className="btn" onClick={() => respond(r.id, true)} style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, padding: "7px 12px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", cursor: "pointer" }}>Accept</button>
                    <button className="btn" onClick={() => respond(r.id, false)} style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, padding: "7px 12px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.surface, color: C.muted, cursor: "pointer" }}>Decline</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Friends list */}
          <div>
            <Label>Friends</Label>
            {loadingFriends ? (
              <Note>Loading…</Note>
            ) : friends.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 16px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }}>
                <img src="/logo-mark.png" alt="" className="brand-mark" style={{ height: 30, opacity: 0.5, margin: "0 auto 10px" }} />
                <Note>No friends yet. Share your friend code to connect.</Note>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {friends.map(f => (
                  <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 }}>
                    <span style={{ fontSize: 20 }}>{f.emoji}</span>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.ink }}>{f.display_name}</span>
                  </div>
                ))}
              </div>
            )}
            {outgoing.length > 0 && (
              <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>
                {outgoing.length} pending request{outgoing.length > 1 ? "s" : ""} sent.
              </div>
            )}
          </div>

          <Btn kind="danger" onClick={signOut}>Sign out</Btn>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Room invites: invite accepted friends to a live room, and show the invites
// friends have sent you.
// --------------------------------------------------------------------------

// Host tool shown in the room lobby: invite your accepted friends to this room
// by its code. Collapsed by default so it doesn't crowd the lobby.
export function InviteFriends({ roomCode }) {
  const [friends, setFriends] = useState(null);
  const [open, setOpen] = useState(false);
  const [invited, setInvited] = useState({}); // friendId -> "busy" | "done"

  useEffect(() => {
    let live = true;
    (async () => {
      try { const f = await acct.listFriends(); if (live) setFriends(f); }
      catch { if (live) setFriends([]); }
    })();
    return () => { live = false; };
  }, []);

  const invite = async (id) => {
    if (invited[id]) return;
    setInvited(m => ({ ...m, [id]: "busy" }));
    try { await acct.createInvites(roomCode, [id]); setInvited(m => ({ ...m, [id]: "done" })); }
    catch { setInvited(m => { const n = { ...m }; delete n[id]; return n; }); }
  };

  if (!friends || friends.length === 0) return null;
  return (
    <div>
      <button className="btn" onClick={() => { S.tap(); buzz(6); setOpen(o => !o); }}
        style={{ width: "100%", fontFamily: FONT, fontSize: 13, fontWeight: 700, padding: "10px 0", borderRadius: 12, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, cursor: "pointer" }}>
        {open ? "Hide friends" : "Invite friends"}
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {friends.map(f => {
            const st = invited[f.id];
            return (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 }}>
                <span style={{ fontSize: 18 }}>{f.emoji}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.display_name}</span>
                <button className="btn" onClick={() => { S.tap(); buzz(6); invite(f.id); }} disabled={!!st}
                  style={{ fontFamily: FONT, fontSize: 12, fontWeight: 800, padding: "6px 12px", borderRadius: 9, border: `1px solid ${st === "done" ? C.green : C.line}`, background: C.surface, color: st === "done" ? C.green : C.accent, cursor: st ? "default" : "pointer", whiteSpace: "nowrap" }}>
                  {st === "busy" ? "…" : st === "done" ? "Invited ✓" : "Invite"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Pending room invites friends have sent you. Tap Join to jump straight into
// their table; dismiss to clear one. Renders nothing when there are none.
export function IncomingInvites({ onJoin }) {
  const [invites, setInvites] = useState(null);

  const refresh = useCallback(async () => {
    try { setInvites(await acct.listInvites()); } catch { setInvites([]); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const dismiss = async (id) => {
    setInvites(list => (list || []).filter(i => i.id !== id));
    try { await acct.dismissInvite(id); } catch { refresh(); }
  };

  if (!invites || invites.length === 0) return null;
  return (
    <div>
      <Label>Table invites</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {invites.map(inv => (
          <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 }}>
            <span style={{ fontSize: 20 }}>{inv.from?.emoji || "🙂"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.from?.display_name || "A friend"}</div>
              <div style={{ fontSize: 12, color: C.faint, letterSpacing: ".08em", fontVariantNumeric: "tabular-nums" }}>Table {inv.roomCode}</div>
            </div>
            <button className="btn" onClick={() => { S.tap(); buzz(6); onJoin?.(inv.roomCode); }}
              style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, padding: "7px 14px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", cursor: "pointer" }}>Join</button>
            <button className="btn" onClick={() => { S.tap(); dismiss(inv.id); }} aria-label="Dismiss"
              style={{ fontFamily: FONT, fontSize: 18, lineHeight: 1, padding: "4px 8px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.surface, color: C.muted, cursor: "pointer" }}>&times;</button>
          </div>
        ))}
      </div>
    </div>
  );
}
