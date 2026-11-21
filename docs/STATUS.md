# Status (2026-11-21)

Milestones 1–3 of 7 are done on `impl/mvp`, merged with `main` (card catalog, M2 review). One quarter is playable on the LAN with two players.

## How to run it

```
npm install
npm run dev        # prints the LAN URLs: http://<host-ip>:5173/play (players) and /floor (projector)
```

`npm run typecheck`, `npm test` (172 unit tests) and `npm run e2e` (two headless players plus the projector, 193 checks) all pass on this commit. Settings and env overrides are described in README.md; every choice the spec left open is in docs/DECISIONS.md.

## Done

- **M1 Skeleton.** npm workspaces (`shared`, `server`, `client`, `tools`), shared types for every DESIGN.md §8 message, and all tunables in `shared/config.ts`. There is a pure, seeded phase machine in `server/src/sim` and a ws server shell with lobby, reconnect by token, taking a seat back by name, and a rate limit. The client lets players join by name and shows the phase with a countdown.
- **M2 Market.** 10 sectors × 5 fake companies, plus an index fund and 10 sector funds, all generated from a seed. A correlated price step runs at 10 Hz with 1 candle per second over 90-day quarters. `/play` has a sector-grouped symbol list with live prices and a candle chart; `/floor` shows the index chart.
- **M3 Trading.** `server/src/sim/trading.ts`: market orders in shares, long and short, clipped to the 4× leverage cap; price impact (slippage, permanent, temporary decaying with a 5 s half-life, each capped); arrival order within a tick; daily borrow fee on shorts; margin call liquidates the largest position; elimination below $100k. `/play` has order entry (Buy/Sell, % of buying power, fixed $, Half, Close) and a positions panel with live P&L. A reconnect restores the portfolio.
- **Card catalog (teammate).** `shared/data/cards.json` + `shared/cards.ts`, and `server/src/sim/shop.ts`. Not yet wired into the sim; M5 does that.
- **Headline content (WIP, teammate).** `shared/data/headlines.seed.json` has 158 templates in the §7 schema, and `shared/data/placeholders.json` has the fictional fill lists. `tools/generate-headlines/` holds the generator for a local OpenAI-compatible endpoint (Ollama or LM Studio) and its validator.

## Not verified / known gaps

- **M2 reviewed (2026-11-21).** I read `market.ts` and `universe.ts` and ran probes over 2000 seeds: names and tickers are unique, and no symbol hit the price floor in 20 high-volatility full games. One bug, now fixed: a NaN or infinite `dRate` left the policy rate NaN for the rest of the game, and infinite `volMult`/`corrMult` could floor prices. Non-finite step inputs now fall back to their defaults (`marketInputs.test.ts`). Still open for M4: the rate has no bounds and can go negative.
- **M3 reviewed (2026-11-21).** The order clip, flips, partial closes, borrow fee, liquidation order and elimination are correct. One bug is fixed: the leverage clip ignored the order's own slippage, so with $100M or more a max-size order into a thin stock landed at about 10x at mid, against the 4x cap. The clip now pays for slippage (`tradingReview.test.ts`). Two impact tests and one e2e threshold were moved to match. **Open balance exploit, for the M3 owner:** a player's own price impact is still in the mark when equity is valued. Buying the thinnest stock at the cap on the last tick of the game adds about 11% to final net worth at $10M and about 50% at $100M (`last-tick-pump` bot). Options are to value at mid without the player's own temporary impact, flush temporary impact at the close, or keep `impact.maxPermanent` well below `maxSlippage`.
- **e2e fixed (2026-11-21).** Two bugs in the test itself, not the game. (1) "every phase of every quarter" waited only 15 s for EARNINGS, but could start with up to a whole TRADING phase still to go, so it passed or failed depending on how fast the earlier steps ran. The first wait now covers the rest of TRADING. (2) On macOS/Linux the server was killed with a plain SIGKILL to `tsx`, which left the real server running with its port open, so "server loss shows on the client" failed and stray servers piled up. Children now run in their own process group and are killed as a group. 3 of 3 runs pass all 193 checks with no leftover servers. `package-lock.json` is back in sync, so `npm ci` works again.
- **Generator never run.** It typechecks, but has never run, not even with `--dry-run`. It has no npm script, README or tests yet.
- **No second machine tested.** A connection from another physical machine on the LAN is untested. Only this host was used, with the server bound to all interfaces.
- **No restart.** Starting a new game needs a server restart.

## Next (M4–M7, in order)

1. **M4 Headlines engine.** Shock scheduling, matching-headline lookup with no repeats, slot filling, the global headline queue, and earnings surprise/leaks/gap. The content itself is the teammate's.
2. **M5 Cards and shop.** Wire the catalog into the sim: shop offers, hand, card effects, heat, the SEC catch roll and jail.
3. **M6 Results, final and floor.** Recap with causes, awards, and BREAKING moments.
4. **M7 Balance harness.** `npm run balance` exists (`tools/balance/`): 6 bots (hold-index, levered-index, momentum, yolo, short-index, last-tick-pump) play whole games headless. Quiet-market baseline over 50 games: the median winner is about $15M (p90 $63M), roughly 100x below the $1B–3B target. Headlines, cards, regimes and earnings are not in the sim yet, so this is the floor that M4/M5 add to. Next: run the harness again once they're wired in, then tune toward $1B–3B.

## Suggested split

- **Sim:** M4 shock scheduler, earnings and regimes, then the M7 harness.
- **Server:** M5 shop, hand and card effects, heat and jail.
- **Client:** the headline feed, shop, hand, results and final screens.
- **Design:** headline content and generator runs, `/floor` layout, sounds and effects, and company/fund names (`server/src/sim/data/names.ts`). Colors and fonts are in `client/src/theme.ts`.
