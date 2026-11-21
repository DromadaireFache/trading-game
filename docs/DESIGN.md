# Trading Game — Design Doc (v0.2, draft)

Multiplayer LAN trading game for **2–4 players** on laptops. Fake companies, a fast simulated market,
shared real-time news, and cards that let players plant fake news, buy insider information and
trigger world events. Fun first, while players also learn how markets react to information, liquidity
and manipulation.

---

## 1. Game structure

| Unit | Real time | Sim time |
|---|---|---|
| 1 tick (internal) | 100 ms | 1/10 day |
| 1 candle | 1 s | 1 trading day |
| 1 round | 90 s | 1 quarter (90 days) |
| 1 game | 8 rounds by default (configurable) | 2 years |

### Phase loop (per quarter)
```
LOBBY → [ BRIEFING → TRADING → EARNINGS → RESULTS → SHOP ] × (N − 1)
      → BRIEFING → TRADING → EARNINGS → FINAL
```

| Phase | Length | What happens |
|---|---|---|
| **BRIEFING** | 5 s | Macro outlook (rates, Fed meeting date), active regimes, earnings consensus, the quarter's **scheduled beats**. Trading is closed. |
| **TRADING** | 90 s | Prices tick live. Headlines drop throughout the quarter (scheduled, random, and from cards). Players trade and play cards. |
| **EARNINGS** | 5 s | Quarter closes. Each company reports EPS against consensus. |
| **RESULTS** | Up to 20 s | Between quarters, show the leaderboard, P&L, statements, market recap, arrests, and card authors. When every player selects **Ready Up**, the shop opens. |
| **SHOP** | Up to 30 s | Buy cards for the next quarter. When every player on the roster selects **Ready Up**, the next briefing starts. |

Positions carry across quarters. Players are ranked by **net worth**.

The player who starts the game can enable **Debug mode** in the lobby. When every player selects **Ready Up** during Trading, the remaining market days are simulated immediately and Earnings begins.

**Elimination:** if equity falls below $100k, the player is **out for good** and becomes a spectator.

---

## 2. Economy and scale

- **Starting capital: $10M.** Target: **the winner finishes at $1B+ almost every game** (about 100× over 8 quarters).
- Companies have market caps of **$5B–$500B**. Price impact is measured against each company's daily
  dollar volume, so a $500M order visibly moves a mid-cap. Whales move markets, and that's a feature.
- How the 100× happens: **leverage** (see §4), large frequent news shocks that players can front-run, and
  cards that pay off for whoever uses them well.
- **Balance harness (must-have):** a headless script plays full games with bot players
  (front-runners, random traders, card users) and reports the distribution of the winner's net worth. Tune
  leverage, shock sizes and volatility until the median winner is about $1–3B. Without this, nobody will know
  whether the 100× target holds until demo day.

---

## 3. Market model

### Universe
- **6 sectors × 5 companies = 30 fake stocks** (tech, energy, defense, airlines, finance, health)
- **7 funds:** 1 index fund + 6 sector funds. A fund's price is the weighted basket of its
  members. For the MVP, trading a fund has its own price impact and does **not** move its members.
- Each company has: `beta_m`, `beta_s`, `sigma_i`, `rate_sensitivity`, `marketCap`, `adv` (daily dollar
  volume), and fundamentals (`revenue`, `margin`, `debt`, `shares`).

### Price step (each 100 ms tick)
```
r_i = beta_m·M + beta_s·S[sector(i)] + sigma_i·ε_i          # correlated noise
    + rate_sensitivity_i · Δrate                             # macro
    + Σ regime.sectorDrift[sector(i)]                        # active regimes (§5)
    + Σ news_drift_k(t)                                      # active headline shocks
vol and correlation are scaled by the active regimes' volMult and corrMult
mid_i *= exp(r_i);  mid_i += impact_i
```
Seeded RNG, so a game is reproducible.

### News shock
A headline carries `{scope, target, direction, magnitude}` and applies its move `m` as a ramp of about 3 s with slight overshoot.

### Price impact
```
fill_price = mid · (1 + sign(q) · λ · notional / adv_i)
permanent  = k_p · notional / adv_i
temporary  = k_t · notional / adv_i      # decays, half-life ~5 s
```
The first buyer gets the best price. Whoever piles in last buys the top.

### Earnings
At BRIEFING each company secretly draws `true_surprise`. Some headlines during the quarter are **leaks**
that hint at it. The earnings report shows the surprise against consensus. The remaining price move,
`g · (true_surprise − priced_in)`, lands 1–5 seconds after trading opens the next quarter. The final
quarter's move settles directly into the final standings.

---

## 4. Trading rules

- Market orders only, with quick-size buttons (% of buying power, or fixed $ amounts).
- **Long and short**, on stocks and funds.
- **Leverage:** max gross exposure = **L × equity**. L is a tuning knob, starting at about 4×. Shorts pay a small borrow fee.
- **Margin call:** if equity < maintenance margin, the server auto-liquidates the largest position.
- Orders are processed in arrival order.

---

## 5. Cards

Cards are **headlines and world events**. You buy them in SHOP, hold them in your **hand** (limit 3), and play
them during TRADING whenever you choose. The shop offers a random selection each quarter. Prices
**scale with the buyer's net worth**.

| Tier | Example | Duration | Legal? |
|---|---|---|---|
| **Insider tip** | You see an upcoming real headline **a few seconds before** everyone else | Seconds | Illegal |
| **Fake headline** | "ACME CFO under investigation". Debunked after 10–20 s, and the move reverts. | Seconds | Illegal |
| **Event** | "Factory swallowed by sinkhole": a permanent shock to one company or sector | One-off | Varies |
| **Regime** | Lobby for a law, start a war, depose a (fictional) head of state, a pandemic | **1–4 quarters** | Varies |

### Regimes
```ts
Regime {
  id, name, ownerId, quartersLeft,
  sectorDrift: Partial<Record<Sector, number>>,
  volMult: number, corrMult: number, rateDelta?: number,
  headlines: string[]          // follow-up headlines it drips out over time
}
```
- **War:** defense and energy up, airlines and tourism down, volatility up, correlation up.
- **Lobbying:** a multi-stage bill that passes with probability *p*. If it passes, the target sector gets a permanent drift.
- **Head of state deposed (fictional country):** rates jump, volatility spikes, then a slow recovery.
- Use fictional countries and leaders for anything political or violent.

### Pacing
With 4 players, overload isn't a real risk. Two light safeguards:
- A **global headline queue** with a minimum gap of about 2 s, so two headlines never land at the same instant.
- **At most 2 active regimes** at once.

### Getting caught: SEC and jail
- Every illegal act (insider tip, fake headline, trading a target you moved with a card, illegal events) adds
  **heat** to the player. So does **self-dealing**: any card (legal ones too, at a reduced share) that moves a
  stock or sector you hold, with more heat when it moves your way. Cards are meant to be played on the other
  players' bets.
- **Only illegal cards can get you jailed:** the SEC rolls only for players who played an illegal card that
  quarter. Heat from legal cards just raises the odds for the day you do.
- At the end of each quarter, `P(caught) = f(heat, net worth rank)`. **Richer players are watched more closely.**
- **If caught:** a fine, plus **jail** for the next quarter. In jail you can't play or buy cards, and every order
  goes through 3 seconds late. **Your positions stay open** and you can still trade, just slower.
- The arrest is announced at RESULTS ("Player 7 arrested for insider trading. 45 days.").

### Counter-cards (stretch goal)
Fact-check (instantly debunks a fake headline), trading halt (freezes a ticker for 5 s), SEC tip-off (adds heat to a rival).

---

## 6. Presentation

- **Visual effects, not multipliers:** price flashes, a screen shake on big moves, sounds on fills, a ticker tape.
- **Projector moments: at most 3–5 per game**, only for regimes starting, market crashes, and
  arrests of the leader. A full-screen "BREAKING" banner and a sound sting.
- **Recap (RESULTS):** **market-level** only. The top 3 sector or stock moves of the quarter and what
  caused each (the engine already knows which headline or regime it applied). Per player:
  best and worst trade only. No attempt to explain why each player gained or lost.
- **Final screen:** leaderboard plus awards ("Most chaos", "Best short", "Longest sentence").

---

## 7. Headline database (offline)

Generated ahead of time with a local model and loaded from the generated catalog plus the bundled seed.
```jsonc
{
  "id": "h_01234",
  "text": "{COMPANY} wins surprise contract with {GOV_AGENCY}",
  "scope": "stock",               // market | sector | stock
  "sector": "industrials",        // required on generated stock/sector entries; omitted for market
  "direction": "up",              // up | down | neutral
  "magnitude": "medium",          // small | medium | large | huge
  "category": "contract",         // earnings_leak | contract | legal | exec | macro | product | absurd | regime_followup
  "kind": "real"                   // real | fake_template | debunk | event
}
```
The engine decides the shock first, then picks an unused headline that matches. The database includes neutral and noise headlines.

---

## 8. Architecture

```
/shared     TS types: messages, state, config, constants
/server     Node + TS + ws — authoritative loop, sim, portfolios, cards, SEC
/client     React + Vite — player UI (/play, laptop) and projector view (/floor)
/tools      Python — headline generation, balance harness (or TS, reusing the sim directly)
```
- The server is authoritative. Clients send intents and render the snapshots they receive.
- 4 players × 61 symbols at 10 Hz is trivial. Broadcast one shared price tick, and send portfolio updates to each player separately.
- Charts: `lightweight-charts`.
- **Write the balance harness in TS against the same `/server/sim` module** so it can't drift out of sync with the game.

### Messages (draft)
```ts
// client → server
{ t: "join", name }
{ t: "order", symbol, qty }                       // qty < 0 = sell/short
{ t: "buy_card", offerId }
{ t: "play_card", cardId, target?, direction? }

// server → client
{ t: "phase", phase, endsAt, quarter }
{ t: "tick", day, prices: Record<symbol, number> }
{ t: "candle", day, ohlc: Record<symbol, OHLC> }
{ t: "headline", id, text, symbol?, sector?, ts, early?: boolean }   // early = insider preview
{ t: "fill", symbol, qty, price }
{ t: "portfolio", cash, positions, equity, heat, jailedUntil? }
{ t: "shop", offers }
{ t: "results", leaderboard, statements, recap, arrests }
{ t: "moment", kind, text }                       // projector moment
```

---

## 9. Two-day build plan (4 people)

S1 = sim/engine, S2 = server/net/portfolio, S3 = client, D = UX/art/mechanics.

| When | S1 Sim | S2 Server | S3 Client | D Design |
|---|---|---|---|---|
| **D1 AM** | Companies, funds, correlated price step | Lock `/shared` types *with everyone*, ws server, phase state machine | Vite app, join, symbol grid, chart | Wireframes, palette, company and fund names, generator prompts |
| **D1 PM** | News shock, price impact, seeded RNG | Orders, leverage, shorts, margin, elimination | Order panel, positions, headline feed | Run headline generation, card list with prices |
| **D1 end** | **Milestone: one playable quarter on the LAN with live prices, headlines and trading.** | | | |
| **D2 AM** | Regimes, earnings, **balance harness** | Shop, hand, card effects, headline queue, heat and jail | Shop UI, hand, results and final screens | `/floor` view, visual effects, sound, projector moments |
| **D2 PM** | Tune for the $1B target | Config, stability, reconnect | Polish | Balance playtests, demo script |
| **D2 −3 h** | **Feature freeze.** | | | |

Cut order if behind: counter-cards → lobbying stages → sector funds → earnings leaks.

---

## 10. Tuning later (not blocking)

Leverage cap, which cards are illegal and how much heat each adds, jail length, joining mid-game, host
controls. Every value is a constant in `/shared/config.ts` so it's easy to tune.
