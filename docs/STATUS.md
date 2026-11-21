# Status (2026-11-21)

Milestones 1–6 are done and M7 has its first tuning pass (M6 and M7 by julien); `impl/mvp` and `main` are kept in sync. A full game is playable on the LAN with live news, cards, results and a final screen.

## How to run it

```
npm install
npm run dev        # prints the LAN URLs: http://<host-ip>:5173/play (players) and /floor (projector)
```

`npm run typecheck`, `npm test` (251 unit tests) and `npm run e2e` (two headless players plus the projector, 229 checks) all pass on this commit. Settings and env overrides are described in README.md; every choice the spec left open is in docs/DECISIONS.md.

## Done

- **M1 Skeleton.** npm workspaces (`shared`, `server`, `client`, `tools`), shared types for every DESIGN.md §8 message, and all tunables in `shared/config.ts`. There is a pure, seeded phase machine in `server/src/sim` and a ws server shell with lobby, reconnect by token, taking a seat back by name, and a rate limit. The client lets players join by name and shows the phase with a countdown.
- **M2 Market.** 10 sectors × 5 fake companies, plus an index fund and 10 sector funds, all generated from a seed. A correlated price step runs at 10 Hz with 1 candle per second over 90-day quarters. `/play` has a sector-grouped symbol list with live prices and a candle chart; `/floor` shows the index chart.
- **M3 Trading.** `server/src/sim/trading.ts`: market orders in shares, long and short, clipped to the 4× leverage cap; price impact (slippage, permanent, temporary decaying with a 5 s half-life, each capped); arrival order within a tick; daily borrow fee on shorts; margin call liquidates the largest position; elimination below $100k. `/play` has order entry (Buy/Sell, % of buying power, fixed $, Half, Close) and a positions panel with live P&L. A reconnect restores the portfolio.
- **M4 Headlines.** `server/src/sim/headlines.ts` (template lookup with no repeats, slot filling) and `news.ts` (quarter plan: random headlines, scheduled beats with the rate decision, earnings leaks; one global queue with a minimum gap) drive julien's `shocks.ts` and `earnings.ts`. The client shows the beats, a live headline feed (tags select the stock or sector fund) and the earnings reports; the gaps land at the next quarter's open.
- **M5 Cards and shop.** `server/src/sim/cardEngine.ts` wires julien's catalog (`shared/data/cards.json`), `shop.ts`, `sec.ts` and `regimes.ts` into the game: shop per quarter priced per player, hand of 3, insider previews, fakes with debunk, events, regimes and lobbying, heat, SEC roll with fines and jail, card authors at RESULTS. `/play` has the shop (SHOP phase) and the hand with play buttons, heat and jail. A basic `results` event is emitted at RESULTS; the screens are M6.
- **Headline content (WIP, teammate).** `shared/data/headlines.seed.json` has 158 templates in the §7 schema, and `shared/data/placeholders.json` has the fictional fill lists. `tools/generate-headlines/` holds the generator for a local OpenAI-compatible endpoint (Ollama or LM Studio) and its validator.

## Not verified / known gaps

- **M2 reviewed (2026-11-21).** I read `market.ts` and `universe.ts` and ran probes over 2000 seeds: names and tickers are unique, and no symbol hit the price floor in 20 high-volatility full games. One bug, now fixed: a NaN or infinite `dRate` left the policy rate NaN for the rest of the game, and infinite `volMult`/`corrMult` could floor prices. Non-finite step inputs now fall back to their defaults (`marketInputs.test.ts`). The rate is now bounded by `market.rateMin` / `rateMax` (M4).
- **M3 reviewed (2026-11-21).** The order clip, flips, partial closes, borrow fee, liquidation order and elimination are correct. One bug is fixed: the leverage clip ignored the order's own slippage, so with $100M or more a max-size order into a thin stock landed at about 10x at mid, against the 4x cap. The clip now pays for slippage (`tradingReview.test.ts`). Two impact tests and one e2e threshold were moved to match. **Last-tick impact exploit, fixed:** a player's own price impact used to count in their net worth, so buying the thinnest stock at the cap on the last tick added about 11% at $10M and about 50% at $100M. Accounts are now valued at the fair price (the mid without the still-decaying temporary impact), and `impact.maxPermanent` dropped from 0.15 to 0.06 so a capped order can't buy a mark-up worth more than its slippage. The `last-tick-pump` bot now finishes below plain levered-index (3 of 30 head-to-head wins at $10M, 0 of 30 at $100M).
- **e2e fixed (2026-11-21).** Two bugs in the test itself, not the game. (1) "every phase of every quarter" waited only 15 s for EARNINGS, but could start with up to a whole TRADING phase still to go, so it passed or failed depending on how fast the earlier steps ran. The first wait now covers the rest of TRADING. (2) On macOS/Linux the server was killed with a plain SIGKILL to `tsx`, which left the real server running with its port open, so "server loss shows on the client" failed and stray servers piled up. Children now run in their own process group and are killed as a group. 3 of 3 runs pass all 193 checks with no leftover servers. `package-lock.json` is back in sync, so `npm ci` works again.
- **Visual effects, first pass (2026-11-21).** `client/src/features/fx/`: synthesized sounds (no files; silent until the first click; SOUND toggle in the header and on /floor), screen shake, floating popups and coin bursts (fills, realized P&L, margin calls, big index moves), a pulse on new headlines, a CRT scanline/vignette layer, and juiced results/final screens (rows dealt in, net worth counting up, flipping recap cards, tilting award cards, a wobbling winner) plus a striped, slam-in BREAKING banner. Event-driven only (e2e: 0 long tasks during TRADING); off under prefers-reduced-motion. Dev builds expose `__tgFx.fire(msg)` in the console to try effects. To iterate on with the design track.
- **LAN check from the host (2026-11-21).** Through the LAN IP (not localhost): /play joined, started and filled an order, /floor showed live prices, both websockets stayed open; the macOS firewall is off. Still untested: a second physical machine (client isolation on the venue Wi-Fi). Note: if the shell has `PORT` set, the game server takes that port and can collide with Vite; set `PORT=8787` explicitly when in doubt.
- **Generator never run.** It typechecks, but has never run, not even with `--dry-run`. It has no npm script, README or tests yet.
- **No second machine tested.** A connection from another physical machine on the LAN is untested. Only this host was used, with the server bound to all interfaces.
- **Play again (2026-11-21).** No server restart needed any more: in FINAL any player can press PLAY AGAIN. The server builds a fresh game on the next seed (`TG_SEED` + game number − 1), keeps connected players' seats, names and tokens, drops players who are gone (they can join again by name), and sends every client a new `welcome` (with `game`) and `market`, back in the lobby. Covered by a server test and an e2e step.

## M6–M7 (julien)

1. **M6 Results, final and floor.** Done (julien), and wired to M5: `server/src/sim/results.ts` builds the leaderboard, per-player statements (best and worst trade), the market recap (top 3 moves in different sectors, each with the headline, earnings gap, card or regime that caused it), the final awards (best trade, best short, bag holder, comeback, most chaos, busiest trader, margin call magnet, longest sentence) and crash moments (at most one per quarter, `presentation.maxMomentsPerGame` per game). /play shows real RESULTS and FINAL screens; /floor shows the standings in RESULTS and FINAL and a full-screen BREAKING banner for `presentation.momentVisibleMs`. A reconnect during RESULTS, SHOP or FINAL gets the latest results. **For M5:** pass arrests, fines, card spend, jail and card names to `closeQuarter` / `final` as their `extra` (see the comment in `createSim`), and call `results.addMoment` for regime starts and the leader's arrest. Not done: sound sting and screen shake (design track).
2. **M7 Balance.** Second pass done with cards (docs/BALANCE.md). Card-using bots (insider-trader, manipulator, event-player) buy and play cards and pay the SEC; the harness reports card spend, fines, arrests and jail. At a realistic table of 4 skilled players the median winner is $1.24B (p10 $390M, p90 $3.81B), inside the $1-3B target, after raising daily volume to 6-24% of market cap. Open: skilled players get eliminated 15-18% of the time when 4 whales pile into one thin stock; insider tips are weak; the top tail runs past $3B.

## Open items (2026-11-21)

- `/floor` has no headline tape yet (M6, julien).
- The final standings do not include the last quarter's earnings gap: there is no market step after the last EARNINGS. `sim.news.pendingGap()` holds it (M6, julien).
- Balance (M7, julien): the target holds in the harness (median winner $1.24B at a 4-skilled-player table with cards), but skilled players get eliminated 15-18% of the time, insider tips are weak, and the top tail runs past $3B. See docs/BALANCE.md; next is a playtest with humans.
- Headline generator: never run against a model, no npm script, README or tests (headline teammate).
- Not tested by a person: a second laptop on the venue Wi-Fi, a margin call or elimination in a browser, a second game through "Play again" with cards in hand.
- Counter cards are out on purpose (first in the cut order).

## Suggested split

- **Sim / balance (julien):** compare a human playtest with the harness (`npm run balance -- --bots news-trader,insider-trader,manipulator,event-player`) and tune from docs/BALANCE.md's open list.
- **Client / design:** polish of the shop, hand, results and floor screens; sounds and effects.
- **Design:** headline content and generator runs, card catalog balance, `/floor` layout, sounds and effects, and company/fund names (`server/src/sim/data/names.ts`). Colors and fonts are in `client/src/theme.ts`.
