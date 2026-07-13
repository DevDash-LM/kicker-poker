// Shop / locker screen. Dark, premium, no casino clutter: a grid of preview
// tiles per category with a single clear action each (Buy → Equip → Equipped).
// Guests can browse everything; buying/equipping asks them to sign in.
import { useState, useEffect, useCallback } from "react";
import { C, FONT } from "./theme.js";
import { Btn, CardBack, ChipDot } from "./components.jsx";
import { S, buzz } from "./fx/fx.js";
import * as shop from "./shop.js";
import {
  cardBackDesign, chipDesign, feltBackground, applyEquipped,
  TIER_LABEL, shopErrorMessage, DEFAULT_EQUIPPED,
} from "./cosmetics.js";

const fmtChips = n => (typeof n === "number" ? n.toLocaleString("en-US") : "…");

const SECTIONS = [
  { type: "cardback", title: "Card backs", blurb: "Styles every face-down card on your screen." },
  { type: "chips", title: "Chip styles", blurb: "Recolors the flying chips and pot animations." },
  { type: "felt", title: "Table felts", blurb: "Sets the mood behind the table." },
];

const tierColor = tier =>
  tier === "epic" ? C.gold : tier === "rare" ? C.accent : C.muted;

function Preview({ item, dark }) {
  if (item.type === "cardback") return <CardBack w={56} h={78} design={cardBackDesign(item.id)} />;
  if (item.type === "chips") {
    return (
      <div style={{ width: 56, height: 78, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: "scale(2.4)" }}><ChipDot design={chipDesign(item.id)} /></div>
      </div>
    );
  }
  return (
    <div style={{
      width: 56, height: 78, borderRadius: 10, border: `1px solid ${C.line}`,
      background: feltBackground(item.id, dark) || C.bg,
    }} />
  );
}

function ItemTile({ item, dark, owned, equipped, busy, confirm, canAfford, signedIn, onAction }) {
  const free = item.price <= 0;
  const label = busy ? "…"
    : equipped ? "Equipped ✓"
    : owned || free ? "Equip"
    : !signedIn ? "Sign in"
    : confirm ? "Confirm?"
    : `${fmtChips(item.price)}`;
  const disabled = busy || equipped || (!owned && !free && signedIn && !canAfford);
  return (
    <button className="btn" onClick={() => { if (!disabled) { S.tap(); buzz(6); onAction(item); } }}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        padding: "14px 10px 12px", borderRadius: 16, cursor: disabled ? "default" : "pointer",
        background: equipped ? `${C.accent}10` : C.surface,
        border: `1.5px solid ${equipped ? C.accent : confirm ? C.gold : C.line}`,
        fontFamily: FONT, width: "100%",
      }}>
      <Preview item={item} dark={dark} />
      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, textAlign: "center", lineHeight: 1.2 }}>{item.name}</div>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: tierColor(item.tier) }}>
        {TIER_LABEL[item.tier] || item.tier}
      </div>
      <div style={{
        fontSize: 12, fontWeight: 800, borderRadius: 10, padding: "5px 12px", minWidth: 74,
        fontVariantNumeric: "tabular-nums",
        // Buy/price pill: always a dark chip with light text (bannerBg is dark
        // in both themes), so dark mode never flips it to a pale, low-contrast
        // button. Owned/equipped/confirm states keep their own treatment.
        color: equipped ? "#fff" : owned || free ? C.ink : confirm ? C.onPrim : "#fff",
        background: equipped ? C.accent : owned || free ? C.surface : confirm ? C.gold : C.bannerBg,
        border: owned || free ? `1px solid ${C.line}` : "none",
        opacity: disabled && !equipped ? 0.55 : 1,
      }}>
        {label}
      </div>
    </button>
  );
}

export function ShopScreen({ dark, wide, authUser, walletBal, onBalance, onEquippedChange, onSignIn, onClose }) {
  const [catalog, setCatalog] = useState(null);
  const [owned, setOwned] = useState(() => new Set());
  const [equippedMap, setEquippedMap] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [err, setErr] = useState(null);
  const signedIn = !!authUser;

  const load = useCallback(async () => {
    try {
      const [cat, inv, eq] = await Promise.all([
        shop.fetchCatalog(),
        signedIn ? shop.fetchInventory() : Promise.resolve(new Set()),
        signedIn ? shop.fetchEquipped() : Promise.resolve({}),
      ]);
      setCatalog(cat);
      setOwned(inv);
      const full = { ...DEFAULT_EQUIPPED, ...eq };
      setEquippedMap(full);
      if (signedIn) { applyEquipped(full); onEquippedChange?.(full); }
    } catch { setCatalog(c => c || []); setErr("Couldn’t load the shop. Check your connection."); }
  }, [signedIn, onEquippedChange]);

  useEffect(() => { load(); }, [load]);

  const doEquip = async (item) => {
    setBusyId(item.id); setErr(null);
    try {
      await shop.equip(item.type, item.id);
      const next = applyEquipped({ ...equippedMap, [item.type]: item.id });
      setEquippedMap(next);
      onEquippedChange?.(next);
      S.win?.();
    } catch (e) { setErr(shopErrorMessage(e?.code)); }
    finally { setBusyId(null); }
  };

  const doBuy = async (item) => {
    setBusyId(item.id); setErr(null);
    try {
      const r = await shop.purchase(item.id);
      if (typeof r.balance === "number") onBalance?.(r.balance);
      setOwned(prev => new Set(prev).add(item.id));
      setConfirmId(null);
      await doEquip(item); // equip right after buying — the expected flow
      return;
    } catch (e) {
      setErr(shopErrorMessage(e?.code));
      if (typeof e?.balance === "number") onBalance?.(e.balance);
    }
    finally { setBusyId(null); }
  };

  const onAction = (item) => {
    if (!signedIn) { onSignIn?.(); return; }
    const isOwned = owned.has(item.id) || item.price <= 0;
    if (isOwned) { doEquip(item); return; }
    if (confirmId !== item.id) { setConfirmId(item.id); return; } // tap again to confirm
    doBuy(item);
  };

  return (
    <div className="vh" style={{ background: C.bg, fontFamily: FONT, display: "flex", justifyContent: "center", alignItems: "flex-start", height: "100dvh", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: wide ? 720 : 420, display: "flex", flexDirection: "column", padding: "0 20px", paddingTop: "env(safe-area-inset-top)" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "14px 0" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, padding: 0 }}>← Back</button>
          <div style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 800, color: C.ink }}>Shop</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, fontVariantNumeric: "tabular-nums", minWidth: 44, textAlign: "right" }}>
            {signedIn ? fmtChips(walletBal) : ""}
          </div>
        </div>

        {!signedIn && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, marginBottom: 16 }}>
            <span style={{ flex: 1, fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
              You’re browsing as a guest. Sign in to buy items with your saved chips and keep them on every device.
            </span>
            <Btn kind="accent" onClick={onSignIn} style={{ flex: "0 0 92px", padding: "10px 0", fontSize: 13 }}>Sign in</Btn>
          </div>
        )}

        {err && <div style={{ fontSize: 13, color: C.red, fontWeight: 600, textAlign: "center", marginBottom: 12 }}>{err}</div>}

        {catalog === null ? (
          <div style={{ textAlign: "center", color: C.muted, fontSize: 14, fontWeight: 600, padding: "40px 0" }}>
            Loading the shop<span className="dots"><span>.</span><span>.</span><span>.</span></span>
          </div>
        ) : catalog.length === 0 ? (
          <div style={{ textAlign: "center", color: C.muted, fontSize: 14, padding: "40px 0" }}>The shop is empty right now.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 24, paddingBottom: "calc(32px + env(safe-area-inset-bottom))" }}>
            {SECTIONS.map(sec => {
              const items = catalog.filter(i => i.type === sec.type);
              if (items.length === 0) return null;
              return (
                <div key={sec.type}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em" }}>{sec.title}</div>
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 2, marginBottom: 10 }}>{sec.blurb}</div>
                  <div style={{ display: "grid", gridTemplateColumns: wide ? "repeat(4, 1fr)" : "repeat(3, 1fr)", gap: 10 }}>
                    {items.map(item => (
                      <ItemTile key={item.id} item={item} dark={dark}
                        owned={owned.has(item.id)}
                        equipped={equippedMap[item.type] === item.id || (!equippedMap[item.type] && item.price <= 0)}
                        busy={busyId === item.id}
                        confirm={confirmId === item.id}
                        canAfford={walletBal != null && walletBal >= item.price}
                        signedIn={signedIn}
                        onAction={onAction} />
                    ))}
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 12, color: C.faint, textAlign: "center", lineHeight: 1.6 }}>
              Cosmetics are visual only and priced in play chips — no cash value, nothing here affects the odds or your cards.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
