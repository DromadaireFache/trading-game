# Decisions

One line per choice that DESIGN.md and the milestone briefs left open. Append, do not rewrite.

- Shared package `@tg/shared` is consumed as TypeScript source (no build); files sit at the package root (`shared/config.ts`, `types.ts`, `messages.ts`, `index.ts`) and import each other with explicit `.ts` extensions so tsc, tsx, Vite and plain Node all resolve them.
- TRADING length is derived, not configured: `daysPerQuarter * ticksPerCandle` ticks; the other four phases are `config.phaseMs`. Use `phaseTicks(config, phase)` from shared, never your own arithmetic.
- Dev/e2e config override is env-based and read only by the server shell (`server/src/env.ts`): `TG_PHASE_SCALE` (scales non-trading phase ms and `daysPerQuarter`), `TG_CONFIG` (JSON deep-merge, applied after the scale), `TG_SEED`, `PORT`, `TG_CLIENT_PORT`. Vite reads `PORT` (proxy target) and `TG_CLIENT_PORT` (its own port).
- Wire additions to the DESIGN.md draft: `join` gains `role` and optional `token` (and `name` becomes optional for spectators/reconnects); new client message `start`; new server messages `welcome` (playerId, token, role, name, phase, lobby, full config), `lobby` (roster), `error` (code + message).
- `phase` message gains `totalQuarters` and `serverTime` (server clock at send time, for client clock-offset correction); `endsAt` is null in LOBBY and FINAL; `quarter` is 0 in LOBBY.
- `portfolio` gains optional `buyingPower`, `hand`, `eliminated`; `results` gains optional `final` and `awards`.
- Game-time fields on the wire (`day`, headline `ts`, `jailedUntil`) are trading days since game start (may be fractional), not wall-clock, so the sim stays free of real time.
- The welcome message carries the whole effective `GameConfig`; nothing in it is secret and the client then never disagrees with env overrides.
- New players cannot join after LOBBY (`game_in_progress`); spectators and token reconnects can join at any time.
- `config.lobby.minPlayers` defaults to 1 so a dev can start alone; set it to 2 for real games.
- Sim contract: `submit(intent)` only queues; intents are processed in arrival order at the start of the next `tick()`, including lobby intents (`add_player`, `remove_player`, `start`), so the server keeps ticking the sim at 10 Hz in LOBBY and FINAL (time does not advance there).
- Sector ids are fixed in `shared/types.ts` (`SECTORS`): tech, energy, defense, airlines, tourism, finance, health, consumer, industrials, materials; display names are free to change.
- Other workspaces import the sim as `@tg/server/sim` (package `exports` of the server workspace).
- Root `npm run build` = typecheck everything + `vite build` of the client; the server has no build step (runs with tsx).
- Sim tick accounting: a phase of N ticks whose `phase` event comes from tick() call T ends on call T+N (which returns the next `phase` event); the tick that processes `start` only enters BRIEFING and does not consume a BRIEFING tick.
- Server derives `endsAt` from the tick clock, not from the time of sending: (wall-clock time the tick was due) + durationTicks * tickMs; if more than `net.maxCatchUpTicks` ticks are missed the surplus is dropped and a fresh `phase` message with the moved `endsAt` is broadcast.
- The initial LOBBY `phase` event of the sim is not broadcast (clients get LOBBY from `welcome`); the first `phase` message on the wire is BRIEFING.
- Lobby ghosts: a player who disconnects in LOBBY stays in the roster as `connected: false` and can reconnect by token, but their seat and name go to a newcomer who needs them, and `start` removes all disconnected players and needs `minPlayers` CONNECTED players (else `not_allowed`). After the start, disconnected players stay in the game.
- Spectator sessions are dropped on disconnect (a spectator's stale token just becomes a fresh spectator join); `maxSpectators` counts connected spectators; unnamed spectators are called "Spectator".
- A second connection joining with the same token takes over the session; the older socket is closed with ws close code 4000 (`CLOSE_REPLACED`), on which a client must NOT auto-reconnect.
- Frames over `net.maxMessageBytes` close that connection (ws code 1009) instead of getting an `error` reply; binary frames and anything else malformed get `error` `bad_message` and the connection stays open.
- Player names: control/format characters become spaces, whitespace is collapsed and trimmed, length is counted in code points, uniqueness ignores case. Player ids are `p1..`, spectator ids `s1..`.
- The game server answers `GET /health` (JSON `{ok, phase, quarter, players}`) for tooling such as the e2e script; everything else over plain HTTP is 404.
- Client: one `GameClient` (ws + store, `client/src/net`) per route; it connects eagerly (so name entry shows server reachability) but sends `join` only once it has a name, a stored session or the spectator role; the session (`{token, name}`) lives in sessionStorage under `tg.session.<role>`; any error answer to a join clears it and returns to name entry (a spectator retries once without the token); the lobby has a client-only "Change name" that forgets the token (the server keeps the old seat).
- The "replaced" close code lives in shared as `WS_CLOSE_REPLACED` (4000); on it the client stops (connection `closed`, error "seat was opened in another tab") instead of reconnecting, and a reload takes the seat back.
- `welcome` gains optional `joinUrls` (the host's LAN `/play` URLs, one per IPv4 interface); `/floor` shows the first one as "Join at" when it was itself opened through localhost, otherwise its own origin.
- `npm run e2e` (`tools/e2e/run.ts`) overrides config only through env (`PORT`, `TG_CLIENT_PORT`, `TG_SEED`, `TG_CONFIG`), runs 2 quarters of about 11 s with `minPlayers: 2`, and reads the UI through `data-testid` attributes, which are therefore part of the client's contract.
- `npm test` runs vitest through `tools/vitest.mjs`, which first switches to the real on-disk spelling of the repo path; vitest breaks on the lowercase drive letter Git Bash passes on Windows.
- `mergeConfig` validates its result (`validateConfig` in `shared/config.ts`): every leaf must have the type it has in `defaultConfig`, numbers finite and >= 0, tick/phase/lobby sizes sane; it throws a readable error, so `TG_CONFIG`, tests and the harness fail at startup. `TG_CONFIG` may not set `net.serverPort`, `net.clientPort` or `net.wsPath` (ports go through `PORT` / `TG_CLIENT_PORT`, the path is fixed) because Vite and the browser read the defaults.
- Lost tab: after the lobby, a player `join` without a valid token whose name matches (ignoring case) a player seat with NO live connection takes that seat over under a fresh token (the old token dies). A seat somebody is connected to cannot be taken this way. No password: it is a LAN party game.
- Start-time ghosts (amends the "Lobby ghosts" line): `start` only removes players who have been disconnected for at least `lobby.ghostGraceMs` (10 s); someone who reloads or blips at that moment stays in the game and can reconnect.
- Rate limit: each connection may send `net.maxMessagesPerSecond` (40) frames per fixed 1 s window; the excess is dropped unparsed and answered with ONE `error` `rate_limited` (new error code) per window. The socket is not closed.
- Roster order is join order (`p1`, `p2`, ...) and does not change when a seat is taken over.
- Client state has `replaced`: after ws close 4000 `/play` and `/floor` render only a "seat opened in another tab" screen with a Reload button (`data-testid="seat-taken"`), never a live-looking desk.
- Client timing constants live in `config.presentation` (`countdownUrgentMs`, `countdownRefreshMs`, `errorVisibleMs`); the lobby Start button counts connected players only, like the server.
- Not built in milestone 1: restart without restarting the server (FINAL is terminal; README says to restart `npm run dev`).
