# Balance (M7)

Target (DESIGN.md §2): start with $10M; the winner finishes with $1B–3B in almost every game.

Run `npm run balance` (see `tools/balance/`). Each game seats 7 bots that trade through the real sim:

| bot | plays like |
|---|---|
| hold-index | buys the index fund once and holds |
| levered-index | holds the index at the 4× cap, rebalanced daily |
| momentum | holds the best sector fund by 5-day return, at 2× |
| yolo | bets the cap on one random stock per quarter, long or short |
| short-index | shorts the index at 1× |
| last-tick-pump | levered-index, plus an all-in buy of the thinnest stock on the last tick (exploit probe) |
| news-trader | a fast, news-reading human: reacts 1 s after a headline, trades its target at the cap, exits when the shock settles |

`news-trader` stands for the skilled human who should win. Its result is what the target is about.

## Tuning, 2026-11-21 (after M4, before M5)

Cards, regimes and the SEC are not in the sim yet. Cards are meant to carry the winner the rest of
the way (insider tips alone give a news trader a 4 s head start). So the base economy was tuned to a
winner median in the upper hundreds of millions, short of $1B on purpose.

Sweeps, 30–40 games each, one change at a time from the M4 defaults. "levered elim" is the share of
levered-index bots eliminated, a proxy for "the market wipes out ordinary players":

| change | winner median | news-trader median | levered elim |
|---|---|---|---|
| M4 defaults | $69M | $57M | 17% |
| 2× random headlines per quarter | $51M | $33M | 27% |
| leverage cap 6 (maintenance 0.12) | $49M | $42M | 43% |
| leverage cap 8 (maintenance 0.09) | $34M | $28M | 67% |
| market and sector vol ×1.5 | $38M | $29M | 23% |
| all shocks ×2 | $264M | $224M | 57% |
| all shocks ×3 | $844M | $829M | 77% |
| daily volume (adv) ×10 | $236M | $236M | 15% |
| all shocks ×1.5, adv ×10 | $805M | $722M | 45% |
| **huge 0.5, huge weight 0.2, market scope 5%, adv ×8 (chosen)** | **$691M** | **$650M** | **9%** |

The chosen row ran 80 games on seeds 1001–1080. With the new defaults, 50 games on seeds 1–50 give a
winner median of $631M (p10 $199M, p90 $2.84B), news-trader winning 44 of 50.

What the sweeps showed:
- **Shock size is the lever that makes skill pay.** But scaling every shock also scales the 3
  scheduled market-wide beats per quarter (medium/large), and ±30% index moves wipe out anyone
  levered on the market. So only `huge` grew, huge news became more common, and market-wide random
  headlines became rare. Big tradable news lands on stocks and sectors.
- **Price impact caps how far a winner can compound.** At $200M+ the 4× orders hit the slippage cap. 8×
  more daily volume keeps a whale's trades workable, while a $500M order still moves a mid-cap.
- More headlines, more leverage and more volatility all made the game *worse* for skilled play:
  overlapping shocks are harder to read, and leverage mostly adds margin calls.

Changed in `shared/config.ts`:

| setting | before | after |
|---|---|---|
| `news.shock.huge` | 0.25 | 0.5 |
| `news.magnitudeWeights` | 0.35 / 0.35 / 0.22 / 0.08 | 0.3 / 0.3 / 0.2 / 0.2 |
| `news.scopeWeights` (market / sector / stock) | 0.2 / 0.3 / 0.5 | 0.05 / 0.3 / 0.65 |
| `market.advFractionOfCapMin` / `Max` | 0.005 / 0.02 | 0.04 / 0.16 |

## Next

- After M5 wires cards, regimes and the SEC in, add card-using bots (an insider-tip news trader, a
  fake-headline manipulator) and run again. If the winner median overshoots $3B, pull `huge` back
  toward 0.4 first; if it is still under $1B, raise adv before touching shocks.
- The bots are single players. Several skilled humans crowding the same headline will share the
  impact, so the real winner may finish a little lower than news-trader does here.
