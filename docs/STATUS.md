# Status (2026-11-21)

Milestones 1–4 of 7 are done; `impl/mvp` and `main` are kept in sync. A full game is playable on the LAN with live news.

## How to run it

```
npm install
npm run dev        # prints the LAN URLs: http://<host-ip>:5173/play (players) and /floor (projector)
```

`npm run typecheck`, `npm test` (218 unit tests) and `npm run e2e` (two headless players plus the projector, 204 checks) all pass on this commit. Settings and env overrides are described in README.md; every choice the spec left open is in docs/DECISIONS.md.

## Done

- **M1 Skeleton.** npm workspaces (`shared`, `server`, `client`, `tools`), shared types for every DESIGN.md §8 message, and all tunables in `shared/config.ts`. There is a pure, seeded phase machine in `server/src/sim` and a ws server shell with lobby, reconnect by token, taking a seat back by name, and a rate limit. The client lets players join by name and shows the phase with a countdown.
- **M2 Market.** 10 sectors × 5 fake companies, plus an index fund and 10 sector funds, all generated from a seed. A correlated price step runs at 10 Hz with 1 candle per second over 90-day quarters. `/play` has a sector-grouped symbol list with live prices and a candle chart; `/floor` shows the index chart.
- **M3 Trading.** `server/src/sim/trading.ts`: market orders in shares, long and short, clipped to the 4× leverage cap; price impact (slippage, permanent, temporary decaying with a 5 s half-life, each capped); arrival order within a tick; daily borrow fee on shorts; margin call liquidates the largest position; elimination below $100k. `/play` has order entry (Buy/Sell, % of buying power, fixed $, Half, Close) and a positions panel with live P&L. A reconnect restores the portfolio.
- **M4 Headlines.** `server/src/sim/headlines.ts` (template lookup with no repeats, slot filling) and `news.ts` (quarter plan: random headlines, scheduled beats with the rate decision, earnings leaks; one global queue with a minimum gap) drive julien's `shocks.ts` and `earnings.ts`. The client shows the beats, a live headline feed (tags select the stock or sector fund) and the earnings reports; the gaps land at the next quarter's open.
- **Card catalog (teammate).** `shared/data/cards.json` + `shared/cards.ts`, and `server/src/sim/shop.ts`. Not yet wired into the sim; M5 does that.
- **Headline content (WIP, teammate).** `shared/data/headlines.seed.json` has 158 templates in the §7 schema, and `shared/data/placeholders.json` has the fictional fill lists. `tools/generate-headlines/` holds the generator for a local OpenAI-compatible endpoint (Ollama or LM Studio) and its validator.

## Not verified / known gaps

- **M2 reviewed (2026-11-21).** I read `market.ts` and `universe.ts` and ran probes over 2000 seeds: names and tickers are unique, and no symbol hit the price floor in 20 high-volatility full games. One bug, now fixed: a NaN or infinite `dRate` left the policy rate NaN for the rest of the game, and infinite `volMult`/`corrMult` could floor prices. Non-finite step inputs now fall back to their defaults (`marketInputs.test.ts`). The rate is now bounded by `market.rateMin` / `rateMax` (M4).
- **M3 not independently reviewed.** Unit, websocket and e2e tests cover it; margin call and elimination are tested in the sim only, not seen in a browser. Impact constants are first guesses for M7.
- **Generator never run.** It typechecks, but has never run, not even with `--dry-run`. It has no npm script, README or tests yet.
- **No second machine tested.** A connection from another physical machine on the LAN is untested. Only this host was used, with the server bound to all interfaces.
- **No restart.** Starting a new game needs a server restart.

## Next (M5–M7, in order)

1. **M5 Cards and shop.** Wire the catalog into the sim: shop offers, hand, card effects, heat, the SEC catch roll and jail.
2. **M6 Results, final and floor.** Recap with causes, awards, and BREAKING moments.
3. **M7 Balance harness.** `npm run balance`, tuned toward a median winner of $1B–3B.

## Suggested split

- **Sim:** wire regimes into the market step input and `news.enqueue` (M5), then the M7 harness.
- **Server:** M5 shop, hand and card effects, heat and jail.
- **Client:** the headline feed, shop, hand, results and final screens.
- **Design:** headline content and generator runs, `/floor` layout, sounds and effects, and company/fund names (`server/src/sim/data/names.ts`). Colors and fonts are in `client/src/theme.ts`.
