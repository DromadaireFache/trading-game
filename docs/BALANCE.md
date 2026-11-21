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
| insider-trader | news-trader + insider tips (trades the private preview before anyone sees the news) and the boardroom mole (carries a capped bet through the earnings gap) |
| manipulator | news-trader + fake headlines: positions first, plants the story, sells into the overshoot before the debunk |
| event-player | news-trader + event cards (positions, then makes it happen) and the war / pandemic regimes (2x the sector they lift, for the quarter) |

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
| `market.advFractionOfCapMin` / `Max` | 0.005 / 0.02 | 0.04 / 0.16, then 0.06 / 0.24 in the second pass |

## Second pass, 2026-11-21 (with M5: cards, regimes, SEC)

Card bots buy whatever they can use when the shop offers it (at most half their cash per card) and
ignore the SEC, so heat, fines and jail are part of their result. The realistic table is 4 skilled
players: `--bots news-trader,insider-trader,manipulator,event-player`.

**Harness fix first.** Bots used to submit in a fixed order every tick, so when two bots with the same
reaction rule hit the same headline, the first always got the better fill and the second always ate its
impact. Card bots (all built on the news trader) lost to news-trader for that reason alone. The order
is now shuffled every tick (seeded, still reproducible).

Head to head against news-trader (20 games each, medians): manipulator $707M vs $593M, event-player
$747M vs $660M, insider-trader $285M vs $280M. Cards are worth buying; none dominates. Two identical
news traders in one game make about $255M each: crowded headlines split the impact.

At the realistic table, `market.advFractionOfCap` was the lever left (seeds 2001-2060):

| adv (fraction of cap) | winner p10 | winner median | winner p90 |
|---|---|---|---|
| 0.04-0.16 (first pass) | $338M | $874M | $3.64B |
| 0.05-0.20 | $425M | $1.07B | $4.46B |
| **0.06-0.24 (chosen)** | **$531M** | **$1.27B** | **$5.20B** |
| 0.08-0.32 | $687M | $1.63B | $6.12B |

With the new default, seeds 1-60: **winner median $1.24B** (p10 $390M, p90 $3.81B), inside the
target. Wins split 19 / 12 / 14 / 15 between news-trader, insider-trader, manipulator and
event-player. Per game, the manipulator is arrested about 1.9 times (146 jail days, $201M in fines),
the others about 0.9 times.

Open:
- Skilled players are eliminated 15-18% of the time, sometimes below zero equity. It comes from 4 bots
  piling into the same thin stock at 4x on the same tick; humans are less synchronized. Watch it in
  playtests before tuning (`trading.maintenanceMargin` or `trading.liquidationsPerTick` are the knobs).
- insider-trader barely beats news-trader: a 4 s preview is mostly spent on the bot's own impact.
  Raising `cards.insiderLeadMs` or making tips cheaper would make them feel stronger.
- The p90 winner (about $4-5B) is above the band; the target is about the median, but a long tail of
  runaway winners may want `impact.maxSlippage` or the leverage cap to bite harder at the top.

## Next

- Playtest with humans and compare their results with the bots'. If the median winner overshoots $3B,
  pull `news.shock.huge` back toward 0.4 first; if it falls under $1B, raise adv before touching shocks.
- The bots are single players. Several skilled humans crowding the same headline will share the
  impact, so the real winner may finish a little lower than news-trader does here.
