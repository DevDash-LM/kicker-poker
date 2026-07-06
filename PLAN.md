# Kicker — Expansion Plan

## Audit of what exists

**Solid:**
- Pure, tested game logic (`src/game/logic.js`): deck, 7-card evaluator, Monte-Carlo equity, side pots with odd-chip handling, uncalled-bet return, personality-driven AI. Chip conservation verified over hundreds of simulated hands.
- Polished mobile UI: deal/flip animations, chip flights, pot count-up, confetti, synth sounds, haptics, dark mode, live equity readout.
- Deployable PWA: offline-capable, installable, pre-built `dist/`.

**Gaps found (correctness):**
1. **Heads-up blinds are wrong.** With 2 players the dealer must post SB and act first preflop. Current code gives SB to the non-dealer. Invisible today (AI stacks auto-reload so heads-up never occurs) but breaks real multiplayer.
2. **Short all-in incorrectly reopens betting.** An all-in below the minimum raise currently resets `acted` for everyone, letting players who already acted raise again. Real rule: an incomplete raise does not reopen action.
3. **No turn timer** — required for multiplayer, nice option for solo.

**Gaps found (product):**
4. Game state lost on refresh/accidental "Leave" (no persistence, no confirm).
5. Fixed table config — blinds 50/100, stack 10K, always 4 AIs.
6. `session.biggest` and `rebuys` are tracked but never shown; no session summary or lifetime stats.
7. No hand history — can't review what just happened.
8. Equity readout can't be hidden (some players want a "real" mode).
9. Raise slider only — no +/- stepper for precise bets.
10. Tests were run ad hoc during development but aren't committed; no test runner in the repo.
11. No error boundary — a render crash white-screens the app.

## Proposed additions & changes

### Phase 1 — Rules correctness (prerequisite for multiplayer) — ✅ DONE
- 1.1 Fix heads-up blind order (dealer = SB, acts first preflop, last postflop)
- 1.2 Fix incomplete-raise rule (short all-in doesn't reopen action)
- 1.3 Commit a Vitest suite: evaluator, side pots, blinds, conservation, the two fixes

### Phase 2 — Single-player upgrades — ✅ DONE
- 2.1 Table setup screen: blinds, starting stack, # of AI opponents (1–4)
- 2.2 Auto-save game to localStorage; resume after refresh; confirm on Leave with session summary (hands, win rate, biggest pot, net, rebuys)
- 2.3 Hand history: last 25 hands (hole cards, board, actions, result), reviewable list
- 2.4 Lifetime stats screen (persisted)
- 2.5 Equity toggle: Learning mode (current) vs Real mode (hidden)
- 2.6 Bet stepper (+/- buttons beside slider) 
- 2.7 Error boundary with "recover table" fallback

### Phase 3 — Multiplayer (online private rooms, Node + WebSocket, guest identity) — ✅ DONE
- 3.1 `server/` — small authoritative Node server (ws), **reusing `logic.js` unchanged**. Server holds the deck; clients only ever receive their own hole cards (opponents' cards redacted until showdown) — cheat-proof by design
- 3.2 Rooms: host creates → 4-letter code + shareable link (`?room=ABCD`), 2–5 seats, host configures blinds/stack, option to fill empty seats with AI
- 3.3 Guest identity: nickname + emoji picker, persistent device ID → reconnect grace (60s: sit-out, then auto-fold)
- 3.4 Server-enforced 30s turn timer with visual countdown ring on the acting seat
- 3.5 Client lobby: Home → "Play online" → create/join screens, seat list, ready-up, connection status indicator
- 3.6 In-game: same table UI + FX (the FX engine already runs off state diffs, so server-pushed states animate identically); emoji quick-reactions between players
- 3.7 Protocol: versioned JSON messages, action rate-limiting, server-side validation of every action

### Phase 4 — Ship — ✅ DONE
- 4.1 Single deployable: server serves the built PWA + WebSocket on one port; Dockerfile + one-command deploy guide (Fly.io / Railway / Render free tier)
- 4.2 Solo mode stays fully offline; multiplayer gracefully unavailable without connection
- 4.3 README + architecture notes updated

## Out of scope (deliberately, for now)
Public matchmaking, accounts/OAuth, real money anything, chat (emoji reactions only), spectating, tournaments/sit-n-gos, tablet/landscape layouts.
