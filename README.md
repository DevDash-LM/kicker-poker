# Kicker — Mobile Poker

Clean Texas Hold'em vs friends, or AI players. Live win odds on every street. Installable PWA.

**Cryptographically secure RNG (CSPRNG) with an unbiased Fisher–Yates shuffle, verified by automated tests.**

The app is a PWA: solo play works fully offline after first load and it can be added to the home screen on iOS/Android. Multiplayer degrades gracefully — if the server is unreachable you get a clear error, never a broken table.

## Structure

- `src/game/logic.js` — pure game logic (deck, hand evaluation, equity sim, AI, hand lifecycle)
- `src/App.jsx` — screens + gameplay UI, animation/FX orchestration
- `src/components.jsx` — cards, seats, buttons
- `src/fx/fx.js` — synthesized sound effects (WebAudio) + haptics
- `src/storage.js` — settings, autosave/resume, hand history, lifetime stats (localStorage)
- `src/net.js` — WebSocket client, auto-reconnect, guest identity
- `server/index.js` — authoritative multiplayer server (rooms, turn timers, reconnect)
- `server/protocol.js` — shared protocol constants, per-client state redaction
- `tests/` — engine + protocol + server integration suites

## Accounts (optional)

Kicker supports optional accounts: email confirmation-code sign-in, player
profiles, friends, and friend-to-friend room invites, backed by Supabase. The
game itself is unchanged — with no Supabase env vars set, Kicker runs guest-only
exactly as before. See [docs/ACCOUNTS.md](docs/ACCOUNTS.md) for setup, the
branded confirmation-email hook, environment variables, and test steps.
To try changes on an isolated testing subdomain first, see

## License

Source-available: you're welcome to read and study the code, but it may not be reused, redistributed, or commercialized. See [LICENSE](LICENSE).






# ❗ RNG & Card-Dealing Audit — Kicker ❗

**Date:** 2026-07-06          

**Scope:** Deck generation, shuffling, dealing, card visibility, all game-affecting randomness, and RNG suitability for regulated play.                          

**Files reviewed:** `src/game/logic.js`, `server/index.js`, `server/protocol.js`, `src/App.jsx`, `src/net.js`, `tests/`.          

---

## Verdict

**RNG and card-integrity: PASS.** Every piece of randomness that can affect the outcome of a hand — the deck shuffle, and the initial dealer-button assignment — comes from a CSPRNG (`crypto.getRandomValues`) with rejection sampling to eliminate modulo bias. The shuffle is an unbiased Fisher–Yates, the deck is a single 52-card set dealt by `pop()` (no duplicates possible), and undealt/hidden cards are never sent to clients. Room codes are now CSPRNG-generated over a larger space. All automated fairness and integrity tests pass.

---

## What whis means

- **CSPRNG card shuffle.** `freshDeck()` (logic.js) shuffles with `secureInt()`, backed by `globalThis.crypto.getRandomValues` and rejection sampling. Verified server-side (Node 22) and available identically in-browser.
- **No modulo bias.** `secureInt()` rejects the biased tail of the 32-bit range before reducing. Live test: `secureInt(6)` over 600k draws → chi-square 4.02 (crit ~11.07). Room-code alphabet over 100k codes → chi-square 25.98 (df=23, .1% crit ~49.7). Both well within tolerance.
- **Unbiased shuffle algorithm.** Textbook Fisher–Yates, correct bounds, every permutation equally likely.
- **Single deck, no duplicates.** One `freshDeck()` per hand; hole cards + board via `deck.pop()`. Test proves 52 distinct cards and zero collisions across hole cards + full board over 300 hands.
- **Initial dealer button is CSPRNG.** `server/index.js` and `src/App.jsx` now pick the opening button with `secureInt(players.length)` instead of `Math.random()`. Position advantage is no longer seeded from a predictable PRNG.
- **Server-authoritative dealing (multiplayer).** Server holds the deck; `redactFor()` strips `deck` and replaces opponents' unrevealed hole cards with `{hidden:true}` before every broadcast. Verified by the server integration test.
- **Room codes hardened.** `makeCode()` uses CSPRNG rejection sampling over the 24-letter ambiguity-free alphabet, length raised 4 → 5 (≈7.96M codes). Client validation updated to match. Tests confirm charset, length, uniqueness under load, and full-alphabet coverage.

---

