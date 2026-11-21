# Trading Game

Multiplayer LAN trading game for 2-4 players, each on their own laptop, plus one projector view.
Fake companies, a fast simulated market, shared news and cards. Spec: [docs/DESIGN.md](docs/DESIGN.md).
Choices made along the way: [docs/DECISIONS.md](docs/DECISIONS.md).

**Status: milestone 2 (market).** Join by name, lobby, Start, and the phase loop
LOBBY -> [BRIEFING -> TRADING -> EARNINGS -> RESULTS -> SHOP] x N -> FINAL with a live countdown on
`/play` and `/floor`. A seeded market of 50 fake companies in 10 sectors, 10 sector funds and one index fund
moves at 10 ticks per second during TRADING (1 second = 1 trading day = 1 candle, 90 days per quarter).
`/play` shows the sector-grouped symbol list with live prices and a candle chart of the clicked symbol;
`/floor` shows the index fund chart. No orders, news or cards yet; those panels are placeholders.

## Run it

Needs Node 20+ (developed on Node 24) and npm.

```
npm install
npm run dev
```

One command starts the game server (port 8787) and the web client (Vite, port 5173). The server prints
where to connect:

```
[server] this machine:  http://localhost:5173/play   projector: http://localhost:5173/floor
[server] LAN players:   http://<host-ip>:5173/play   projector: http://<host-ip>:5173/floor
```

- Players open the **LAN players** URL on their own laptop, type a name, and anyone presses **Start**.
- The projector opens `/floor` (it joins as a spectator and is not counted as a player).
- Other machines only need port 5173: the page and the websocket (`/ws`, proxied by Vite) share it.
  If they cannot connect, allow Node.js through the host's firewall for private networks.
- Two windows of one browser are two players (the session is kept per tab). Reloading a tab keeps the seat.
- Lost the tab mid-game (closed it, browser crashed, other laptop)? Open `/play` again and type the same name:
  a seat nobody is connected to goes back to whoever asks for it by name.
- A new game needs a server restart (stop `npm run dev` and start it again).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Game server (tsx watch) + Vite dev server, one command |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm test` | vitest unit tests (sim incl. market statistics, server shell, client stores, config) |
| `npm run e2e` | Starts server + Vite on free random ports with short phases, drives two players and the projector in a headless browser through a 2-quarter game (about 90 s), writes screenshots to `.e2e/` |
| `npm run build` | Typecheck + production build of the client |

`npm run e2e` uses the installed Microsoft Edge (or Chrome) through `playwright-core`; nothing is downloaded.
`TG_E2E_HEADED=1` shows the browser windows.

## Headline catalog

The home server generates fictional news templates ahead of play. Run `npm run pull-headlines` to refresh the local catalog from `sbb-server-01`, or see the [generator guide](tools/generate-headlines/README.md) for generation and lookup details.

## Settings

Every tunable number is in [shared/config.ts](shared/config.ts). For a quick run without editing it,
set environment variables before `npm run dev` (read only by `server/src/env.ts` and `client/vite.config.ts`):

| Variable | Meaning | Default |
|---|---|---|
| `PORT` | Game server port (also the target of Vite's `/ws` proxy) | 8787 |
| `TG_CLIENT_PORT` | Vite port | 5173 |
| `TG_SEED` | Sim seed (integer); same seed = same game | from the clock |
| `TG_PHASE_SCALE` | Scales phase lengths and days per quarter, e.g. `0.1` = ten times faster | 1 |
| `TG_CONFIG` | JSON merged over the config, e.g. `{"time":{"quarters":2},"lobby":{"minPlayers":2}}` | - |

`TG_CONFIG` is checked at startup (wrong types, zero-length ticks or phases and the like stop the server with a
message). It cannot move `net.serverPort`, `net.clientPort` or `net.wsPath`; use `PORT` and `TG_CLIENT_PORT`.

PowerShell: `$env:TG_PHASE_SCALE='0.1'; npm run dev`

Market tuning (volatility, correlation, sector character, price ranges) is the `market` block of
`shared/config.ts`; company, CEO and fund names are in `server/src/sim/data/names.ts`.
With the defaults a stock moves about 2.4% a day and the index about 1.2%.

## Layout

```
shared/   @tg/shared  types, wire messages, config.ts (consumed as TypeScript source, no build)
server/   @tg/server  src/sim = pure seeded game rules (no I/O); the rest = ws shell, lobby, 10 Hz clock
client/   @tg/client  React + Vite; /play (player) and /floor (projector); colors and fonts in src/theme.ts
tools/    @tg/tools   e2e/run.ts; the balance harness comes later
docs/     DESIGN.md (spec), DECISIONS.md (one line per choice)
```

Rules of the road: all game rules go in `server/src/sim` (it must stay free of I/O, clocks and
`Math.random`); the server shell only moves messages; clients send intents and render what they receive.
Anything that follows the 10 Hz price ticks in the client subscribes to `client.market`
(`client/src/net/marketStore.ts`) and avoids React state and CSS animations per tick.
