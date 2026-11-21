# Status (end of day 1, 2026-11-20)

`main` and `impl/mvp` point at the same commit. Milestones 1–2 of 7 are done.

## How to run it

```
npm install
npm run dev        # prints the LAN URLs: http://<host-ip>:5173/play (players) and /floor (projector)
```

`npm run typecheck`, `npm test` (132 unit tests) and `npm run e2e` (two headless players plus the projector, 174 checks) all pass on this commit. Settings and env overrides are described in README.md; every choice the spec left open is in docs/DECISIONS.md.

## Done

- **M1 Skeleton.** npm workspaces (`shared`, `server`, `client`, `tools`), shared types for every DESIGN.md §8 message, and all tunables in `shared/config.ts`. There is a pure, seeded phase machine in `server/src/sim` and a ws server shell with lobby, reconnect by token, taking a seat back by name, and a rate limit. The client lets players join by name and shows the phase with a countdown.
- **M2 Market.** 10 sectors × 5 fake companies, plus an index fund and 10 sector funds, all generated from a seed. A correlated price step runs at 10 Hz with 1 candle per second over 90-day quarters. `/play` has a sector-grouped symbol list with live prices and a candle chart; `/floor` shows the index chart.
- **Headline content (WIP, handed to a teammate).** `shared/data/headlines.seed.json` has 158 templates in the §7 schema, and `shared/data/placeholders.json` has the fictional fill lists. `tools/generate-headlines/` holds the generator for a local OpenAI-compatible endpoint (Ollama or LM Studio) and its validator.

## Not verified / known gaps

- **M2 reviewed (2026-11-21).** I read `market.ts` and `universe.ts` and ran probes over 2000 seeds: names and tickers are unique, and no symbol hit the price floor in 20 high-volatility full games. One bug, now fixed: a NaN or infinite `dRate` left the policy rate NaN for the rest of the game, and infinite `volMult`/`corrMult` could floor prices. Non-finite step inputs now fall back to their defaults (`marketInputs.test.ts`). Still open for M4: the rate has no bounds and can go negative.
- **Generator never run.** It typechecks, but has never run, not even with `--dry-run`. It has no npm script, README or tests yet.
- **No second machine tested.** A connection from another physical machine on the LAN is untested. Only this host was used, with the server bound to all interfaces.
- **No restart.** Starting a new game needs a server restart.

## Next (M3–M7, in order)

1. **M3 Trading.** Market orders with quick-size buttons, long/short, leverage cap, borrow fee, price impact (permanent plus decaying temporary), margin-call liquidation, elimination, and a positions panel. This is the "one playable quarter" milestone.
2. **M4 Headlines engine.** Shock scheduling, matching-headline lookup with no repeats, slot filling, the global headline queue, and earnings surprise/leaks/gap. The content itself is the teammate's.
3. **M5 Cards and shop.** Insider, fake, event and regime cards, plus heat, the SEC catch roll and jail.
4. **M6 Results, final and floor.** Recap with causes, awards, and BREAKING moments.
5. **M7 Balance harness.** `npm run balance`, tuned toward a median winner of $1B–3B.

## Suggested split

- **Sim:** M3 portfolio math, impact and margin in `server/src/sim`, then the M4 shock scheduler, earnings and regimes, then the M7 harness.
- **Server:** M3 order intents, per-player portfolio messages, then the M5 shop, hand and card effects, heat and jail.
- **Client:** M3 order entry and positions panels, then the headline feed, shop, hand, results and final screens.
- **Design:** headline content and generator runs, the card list with prices, `/floor` layout, sounds and effects, and company/fund names (`server/src/sim/data/names.ts`). Colors and fonts are in `client/src/theme.ts`.
