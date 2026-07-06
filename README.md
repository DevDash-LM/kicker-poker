# Kicker — Mobile Poker

Clean Texas Hold'em vs friends, or AI players. Live win odds on every street. Installable PWA.

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

## License

Source-available: you're welcome to read and study the code, but it may not be reused, redistributed, or commercialized. See [LICENSE](LICENSE).
