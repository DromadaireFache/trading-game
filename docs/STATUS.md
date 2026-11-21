# Status (2026-11-21)

Milestones 1–5 of 7 are done (M6 and M7 belong to teammates); `impl/mvp` and `main` are kept in sync. A full game is playable on the LAN with live news and cards.

## How to run it

```
npm install
npm run dev        # prints the LAN URLs: http://<host-ip>:5173/play (players) and /floor (projector)
```

`npm run typecheck`, `npm test` (240 unit tests) and `npm run e2e` (two headless players plus the projector, 212 checks) all pass on this commit. Settings and env overrides are described in README.md; every choice the spec left open is in docs/DECISIONS.md.

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
- **Generator never run.** It typechecks, but has never run, not even with `--dry-run`. It has no npm script, README or tests yet.
- **No second machine tested.** A connection from another physical machine on the LAN is untested. Only this host was used, with the server bound to all interfaces.
- **No restart.** Starting a new game needs a server restart.

## Next (M6–M7, teammates)

1. **M6 Results, final and floor.** Recap with causes, awards, and BREAKING moments.
2. **M7 Balance.** First tuning pass done (see docs/BALANCE.md). A news-trader bot (a fast, news-reading human) was added, and huge shocks, magnitude/scope weights and daily volume were retuned. Over 50 games the median winner is $631M (p10 $199M, p90 $2.84B), short of $1B on purpose because cards are not in yet. Next: card-using bots and another pass once M5 lands.

## Suggested split

- **Sim / balance (julien):** M7 tuning with the harness, now with headlines, earnings, cards and regimes in the sim. Bots could start buying and playing cards (`buy_card` / `play_card` intents).
- **Server + client (M6 owner):** the RESULTS screen (leaderboard, statements, arrests, card authors are already in the `results` event; `recap.topMoves` needs filling from `sim.news.log()`, which records the cause of every move), the FINAL screen with awards, and `/floor` (index chart, headline tape, leaderboard, BREAKING banners from `moment` events). After the last quarter, mark the final leaderboard with `sim.news.pendingGap()`.
- **Design:** headline content and generator runs, card catalog balance, `/floor` layout, sounds and effects, and company/fund names (`server/src/sim/data/names.ts`). Colors and fonts are in `client/src/theme.ts`.
