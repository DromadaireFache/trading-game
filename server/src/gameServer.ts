/**
 * The ws shell around the pure sim. Deliberately thin: it owns sockets, sessions (join /
 * reconnect), the lobby roster and the real-time clock. Every game rule lives in ./sim.
 *
 *   client frame -> parseClientMsg -> session checks -> sim.submit(intent)
 *   clock tick   -> sim.tick()     -> SimEvents      -> ServerMsg broadcast / per player
 *
 * Market on the wire (prices are rounded here, the sim never rounds):
 *   - `market` (universe + all closed candles + latest prices + the partial candle) goes to ONE socket,
 *     right after its `welcome`, on every join and reconnect in any phase. It is never broadcast.
 *   - `tick` (all prices) and `candle` (one closed day) are serialized once and broadcast to everybody.
 *   A join is handled between two sim ticks, so snapshot + the live stream that follows have no gap
 *   and no overlap: the first `tick` after a `market` is the one right after its (day, tickOfDay).
 */
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import { WS_CLOSE_REPLACED, roundOhlc, roundPrice, roundPrices, roundSnapshot } from '@tg/shared';
import type { ClientMsg, ErrorCode, JoinMsg, LobbyState, MarketMsg, PhaseInfo, PlayerId, PortfolioMsg, Role, ServerMsg } from '@tg/shared';
import type { ServerEnv } from './env.ts';
import { lanUrls } from './lan.ts';
import { runTickClock } from './loop.ts';
import { cleanName, nameKey, parseClientMsg } from './protocol.ts';
import { createSim } from './sim/index.ts';
import type { Sim, SimEvent, SimEventOf } from './sim/index.ts';

/** Close code sent to a socket whose session was taken over by a newer connection (same token). */
export const CLOSE_REPLACED = WS_CLOSE_REPLACED;
/** Close code used when the server shuts down. */
export const CLOSE_GOING_AWAY = 1001;
/** Liveness probe for tooling (e2e waits for it). Not part of the game protocol. */
export const HEALTH_PATH = '/health';

const DEFAULT_SPECTATOR_NAME = 'Spectator';
/** The window of net.maxMessagesPerSecond (a unit, not a tunable). */
const RATE_WINDOW_MS = 1000;

interface Session {
  id: PlayerId;
  token: string;
  role: Role;
  name: string;
  socket: WebSocket | null;
  /** Wall-clock time the socket was lost; null while connected. */
  disconnectedAt: number | null;
}

/** Fixed-window frame counter of one connection. */
interface RateWindow {
  startedAt: number;
  frames: number;
}

export interface GameServerOptions {
  /** Wall clock; injectable for tests. */
  now?: () => number;
  /** Interface to bind. Default: all interfaces, so LAN machines and the Vite proxy both reach it. */
  host?: string;
  log?: (line: string) => void;
}

export interface GameServer {
  /** The port actually bound (differs from env.port when that was 0). */
  port: number;
  sim: Sim;
  close(): Promise<void>;
}

type JoinFailure = { code: ErrorCode; message: string };

export function startGameServer(env: ServerEnv, options: GameServerOptions = {}): Promise<GameServer> {
  const { config } = env;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));

  const sim = createSim(env.seed, config);

  /** token -> session. */
  const sessions = new Map<string, Session>();
  /** id -> session, in join order (the roster order). */
  const byId = new Map<PlayerId, Session>();
  const bySocket = new Map<WebSocket, Session>();
  let nextPlayerNumber = 1;
  let nextSpectatorNumber = 1;
  /** A start that will succeed is queued in the sim: the lobby is closed from this moment. */
  let starting = false;
  const rateWindows = new WeakMap<WebSocket, RateWindow>();

  // --- sending -------------------------------------------------------------

  function sendRaw(socket: WebSocket | null, frame: string): void {
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(frame);
    } catch {
      // The close handler cleans up; a failed send must never take the server down.
    }
  }

  function send(socket: WebSocket | null, msg: ServerMsg): void {
    sendRaw(socket, JSON.stringify(msg));
  }

  function broadcast(msg: ServerMsg): void {
    const frame = JSON.stringify(msg);
    for (const socket of bySocket.keys()) sendRaw(socket, frame);
  }

  function sendTo(playerId: PlayerId, msg: ServerMsg): void {
    send(byId.get(playerId)?.socket ?? null, msg);
  }

  function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
    send(socket, { t: 'error', code, message });
  }

  // --- snapshots -----------------------------------------------------------

  function playerSessions(): Session[] {
    // byId keeps join order even when a seat gets a new token (takeover by name).
    return [...byId.values()].filter((s) => s.role === 'player');
  }

  function lobbyState(): LobbyState {
    let spectators = 0;
    for (const s of bySocket.values()) if (s.role === 'spectator') spectators += 1;
    return {
      players: playerSessions().map((s) => ({ id: s.id, name: s.name, connected: s.socket !== null })),
      spectators,
      minPlayers: config.lobby.minPlayers,
      maxPlayers: config.lobby.maxPlayers,
    };
  }

  function phaseInfo(): PhaseInfo {
    const state = sim.getState();
    return {
      phase: state.phase,
      endsAt: state.ticksLeft === null ? null : running.clock.lastTickTime() + state.ticksLeft * config.time.tickMs,
      quarter: state.quarter,
      totalQuarters: config.time.quarters,
      serverTime: now(),
    };
  }

  /** Everything a client needs to draw the market from nothing. Built fresh: joins are rare, ticks are not. */
  function marketMsg(): MarketMsg {
    return { t: 'market', ...roundSnapshot(config, sim.getMarketSnapshot()) };
  }

  /** Dollar amounts to cents, average prices like prices. */
  function portfolioMsg(event: SimEventOf<'portfolio'>): PortfolioMsg {
    const { e: _e, playerId: _p, cash, equity, buyingPower, positions, ...rest } = event;
    const cents = (n: number) => Math.round(n * 100) / 100;
    return {
      t: 'portfolio',
      ...rest,
      cash: cents(cash),
      equity: cents(equity),
      ...(buyingPower === undefined ? {} : { buyingPower: cents(buyingPower) }),
      positions: positions.map((p) => ({
        ...p,
        avgPrice: roundPrice(config, p.avgPrice),
        ...(p.realized === undefined ? {} : { realized: cents(p.realized) }),
      })),
    };
  }

  function newsMsg(event: SimEventOf<'briefing'> | SimEventOf<'earnings'>): ServerMsg {
    if (event.e === 'briefing') {
      const { e: _e, ...rest } = event;
      return { t: 'briefing', ...rest };
    }
    const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
    return { t: 'earnings', quarter: event.quarter, reports: event.reports.map((r) => ({ symbol: r.symbol, surprise: round4(r.surprise), gap: round4(r.gap) })) };
  }

  /** Replays a public news event to one socket (join / reconnect). */
  function dispatchTo(socket: WebSocket, event: SimEventOf<'briefing'> | SimEventOf<'earnings'> | SimEventOf<'headline'>): void {
    if (event.e === 'headline') {
      const { e: _e, to: _to, ...rest } = event;
      return send(socket, { t: 'headline', ...rest });
    }
    send(socket, newsMsg(event));
  }

  function broadcastLobby(): void {
    broadcast({ t: 'lobby', ...lobbyState() });
  }

  // --- sessions ------------------------------------------------------------

  function inLobby(): boolean {
    return sim.getState().phase === 'LOBBY' && !starting;
  }

  function dropSession(session: Session): void {
    sessions.delete(session.token);
    byId.delete(session.id);
    if (session.socket !== null) bySocket.delete(session.socket);
    session.socket = null;
  }

  /** Lobby only: a player who left frees their seat and name. */
  function evictFromLobby(session: Session): void {
    dropSession(session);
    sim.submit({ kind: 'remove_player', playerId: session.id });
  }

  function attach(session: Session, socket: WebSocket): void {
    // Built before the socket joins the broadcast set: if the snapshot fails, the join fails as a whole.
    const market = marketMsg();
    session.socket = socket;
    session.disconnectedAt = null;
    bySocket.set(socket, session);
    send(socket, {
      t: 'welcome',
      playerId: session.id,
      token: session.token,
      role: session.role,
      name: session.name,
      phase: phaseInfo(),
      lobby: lobbyState(),
      config,
      joinUrls: lanUrls(env.clientPort).map((u) => u.play),
    });
    // Same synchronous turn as the welcome, so no tick can slip in between.
    send(socket, market);
    // A player who reconnects mid-game gets cash and positions back at once (none yet in the lobby).
    const portfolio = session.role === 'player' ? sim.getPortfolio(session.id) : undefined;
    if (portfolio !== undefined) send(socket, portfolioMsg(portfolio));
    // In SHOP, the offers this player was shown.
    const shop = session.role === 'player' ? sim.getShop(session.id) : null;
    if (shop !== null) send(socket, { t: 'shop', offers: shop.offers });
    // The news so far: this quarter's briefing, the latest earnings, the recent headlines (oldest first).
    const news = sim.getNewsSnapshot();
    if (news.briefing !== null) dispatchTo(socket, news.briefing);
    if (news.earnings !== null) dispatchTo(socket, news.earnings);
    for (const headline of news.headlines) dispatchTo(socket, headline);
    broadcastLobby();
  }

  function freshJoin(msg: JoinMsg): Session | JoinFailure {
    if (msg.role === 'spectator') {
      if (lobbyState().spectators >= config.lobby.maxSpectators) return { code: 'game_full', message: 'too many spectators' };
      const id = `s${nextSpectatorNumber++}`;
      return { id, token: randomUUID(), role: 'spectator', name: cleanName(msg.name, config) ?? DEFAULT_SPECTATOR_NAME, socket: null, disconnectedAt: null };
    }

    const name = cleanName(msg.name, config);
    if (!inLobby()) {
      // Lost tab, crashed browser, swapped laptop: the token is gone but the seat is still in the game.
      // Typing the same name takes over a seat nobody is connected to, under a fresh token.
      const seat = name === null ? undefined : playerSessions().find((s) => s.socket === null && nameKey(s.name) === nameKey(name));
      if (seat === undefined) return { code: 'game_in_progress', message: 'the game has already started' };
      sessions.delete(seat.token);
      seat.token = randomUUID();
      return seat;
    }
    if (name === null) {
      return {
        code: 'name_invalid',
        message: `name must be ${config.lobby.nameMinLength}-${config.lobby.nameMaxLength} characters`,
      };
    }

    const players = playerSessions();
    const holder = players.find((s) => nameKey(s.name) === nameKey(name));
    if (holder !== undefined && holder.socket !== null) return { code: 'name_taken', message: `"${name}" is already taken` };
    // Seats and names held by players who disconnected in the lobby are up for grabs.
    const seatsTaken = holder !== undefined ? players.length - 1 : players.length;
    const ghost = holder ?? (seatsTaken >= config.lobby.maxPlayers ? players.find((s) => s.socket === null) : undefined);
    if (ghost === undefined && seatsTaken >= config.lobby.maxPlayers) return { code: 'game_full', message: 'the game is full' };
    if (ghost !== undefined) evictFromLobby(ghost);

    const id = `p${nextPlayerNumber++}`;
    sim.submit({ kind: 'add_player', playerId: id, name });
    return { id, token: randomUUID(), role: 'player', name, socket: null, disconnectedAt: null };
  }

  function handleJoin(socket: WebSocket, msg: JoinMsg): void {
    if (bySocket.has(socket)) return sendError(socket, 'not_allowed', 'already joined on this connection');

    const known = msg.token === undefined ? undefined : sessions.get(msg.token);
    if (known !== undefined) {
      const previous = known.socket;
      if (previous !== null && previous !== socket) {
        bySocket.delete(previous);
        previous.close(CLOSE_REPLACED, 'replaced by a newer connection');
      }
      return attach(known, socket);
    }

    const result = freshJoin(msg);
    if ('code' in result) {
      // A stale token that cannot become a fresh join: the client must forget it and ask for a name.
      if (msg.token !== undefined) return sendError(socket, 'bad_token', `unknown session (${result.message})`);
      return sendError(socket, result.code, result.message);
    }
    sessions.set(result.token, result);
    byId.set(result.id, result);
    attach(result, socket);
  }

  function handleStart(socket: WebSocket, session: Session): void {
    if (session.role !== 'player') return sendError(socket, 'not_allowed', 'only players can start the game');
    if (!inLobby()) return sendError(socket, 'not_allowed', 'the game has already started');
    const players = playerSessions();
    const connected = players.filter((s) => s.socket !== null);
    if (connected.length < config.lobby.minPlayers) {
      return sendError(socket, 'not_allowed', `need at least ${config.lobby.minPlayers} player(s) to start`);
    }
    // Players who left the lobby do not get dragged into the game, but one who dropped only a moment
    // ago (reload, Wi-Fi blip) keeps the seat: after the start there is no other way back in.
    const startedAt = now();
    const ghosts = players.filter((s) => s.socket === null && startedAt - (s.disconnectedAt ?? startedAt) >= config.lobby.ghostGraceMs);
    for (const ghost of ghosts) evictFromLobby(ghost);
    starting = true;
    sim.submit({ kind: 'start', playerId: session.id });
    if (ghosts.length > 0) broadcastLobby();
  }

  function handleMessage(socket: WebSocket, msg: ClientMsg): void {
    if (msg.t === 'join') return handleJoin(socket, msg);

    const session = bySocket.get(socket);
    if (session === undefined) return sendError(socket, 'not_joined', 'send a join message first');
    if (msg.t === 'start') return handleStart(socket, session);

    if (session.role !== 'player') return sendError(socket, 'not_allowed', 'spectators cannot do that');
    switch (msg.t) {
      case 'order':
        return sim.submit({ kind: 'order', playerId: session.id, symbol: msg.symbol, qty: msg.qty });
      case 'buy_card':
        return sim.submit({ kind: 'buy_card', playerId: session.id, offerId: msg.offerId });
      case 'play_card':
        return sim.submit({ kind: 'play_card', playerId: session.id, cardId: msg.cardId, target: msg.target, direction: msg.direction });
    }
  }

  /** True when the frame is within the connection's budget; says so once per window when it is not. */
  function withinRate(socket: WebSocket): boolean {
    const at = now();
    let window = rateWindows.get(socket);
    // A clock set backwards also opens a new window.
    if (window === undefined || at - window.startedAt >= RATE_WINDOW_MS || at < window.startedAt) {
      window = { startedAt: at, frames: 0 };
      rateWindows.set(socket, window);
    }
    window.frames += 1;
    if (window.frames <= config.net.maxMessagesPerSecond) return true;
    if (window.frames === config.net.maxMessagesPerSecond + 1) {
      sendError(socket, 'rate_limited', `more than ${config.net.maxMessagesPerSecond} messages per second; the rest were dropped`);
    }
    return false;
  }

  function handleFrame(socket: WebSocket, data: RawData, isBinary: boolean): void {
    if (!withinRate(socket)) return;
    if (isBinary) return sendError(socket, 'bad_message', 'binary frames are not supported');
    const parsed = parseClientMsg(data.toString());
    if (!parsed.ok) return sendError(socket, 'bad_message', parsed.message);
    handleMessage(socket, parsed.msg);
  }

  function handleClose(socket: WebSocket): void {
    const session = bySocket.get(socket);
    if (session === undefined) return;
    bySocket.delete(socket);
    session.socket = null;
    session.disconnectedAt = now();
    // Spectators hold no state worth resuming; players keep their session for a token reconnect.
    if (session.role === 'spectator') dropSession(session);
    broadcastLobby();
  }

  // --- sim events ----------------------------------------------------------

  function dispatch(event: SimEvent, tickTime: number): void {
    switch (event.e) {
      case 'phase': {
        // The sim announces LOBBY on its first tick; every client already has it from `welcome`.
        if (event.phase === 'LOBBY') return;
        starting = false;
        broadcast({
          t: 'phase',
          phase: event.phase,
          endsAt: event.durationTicks === null ? null : tickTime + event.durationTicks * config.time.tickMs,
          quarter: event.quarter,
          totalQuarters: config.time.quarters,
          serverTime: now(),
        });
        return;
      }
      case 'reject': {
        const session = byId.get(event.playerId);
        if (event.intent === 'start') starting = false;
        if (event.intent === 'add_player' && session !== undefined) {
          // The shell let someone in whom the sim refused: undo the join.
          const socket = session.socket;
          dropSession(session);
          send(socket, {
            t: 'error',
            code: event.code === 'game_full' ? 'game_full' : 'game_in_progress',
            message: event.message,
          });
          broadcastLobby();
          return;
        }
        if (event.intent === 'remove_player') return; // housekeeping, nobody to tell
        send(session?.socket ?? null, { t: 'error', code: 'rejected', message: event.message });
        return;
      }
      case 'tick':
        return broadcast({ t: 'tick', day: event.day, tickOfDay: event.tickOfDay, prices: roundPrices(config, event.prices) });
      case 'candle':
        return broadcast({ t: 'candle', day: event.day, ohlc: roundOhlc(config, event.ohlc) });
      case 'headline': {
        const { e: _e, to, ...rest } = event;
        const msg: ServerMsg = { t: 'headline', ...rest };
        return to === undefined ? broadcast(msg) : sendTo(to, msg);
      }
      case 'briefing':
      case 'earnings':
        return broadcast(newsMsg(event));
      case 'fill': {
        const { e: _e, playerId, price, ...rest } = event;
        return sendTo(playerId, { t: 'fill', ...rest, price: roundPrice(config, price) });
      }
      case 'portfolio':
        return sendTo(event.playerId, portfolioMsg(event));
      case 'shop': {
        const { e: _e, playerId, ...rest } = event;
        return sendTo(playerId, { t: 'shop', ...rest });
      }
      case 'results': {
        const { e: _e, ...rest } = event;
        return broadcast({ t: 'results', ...rest });
      }
      case 'moment': {
        const { e: _e, ...rest } = event;
        return broadcast({ t: 'moment', ...rest });
      }
    }
  }

  // --- clock ---------------------------------------------------------------

  const running = runTickClock(
    {
      tickMs: config.time.tickMs,
      maxCatchUpTicks: config.net.maxCatchUpTicks,
      onTick(tickTime) {
        try {
          for (const event of sim.tick()) dispatch(event, tickTime);
        } catch (error) {
          log(`[server] tick failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        }
      },
      onResync() {
        // Ticks were dropped, so the deadline everybody is counting down to has moved.
        const info = phaseInfo();
        if (info.endsAt !== null) broadcast({ t: 'phase', ...info });
      },
    },
    now,
  );

  // --- sockets -------------------------------------------------------------

  const http: HttpServer = createServer((req, res) => {
    if (req.url === HEALTH_PATH) {
      const state = sim.getState();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, phase: state.phase, quarter: state.quarter, players: playerSessions().length }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('trading-game server: connect with a websocket, the web client is served by Vite\n');
  });

  const wss = new WebSocketServer({ server: http, path: config.net.wsPath, maxPayload: config.net.maxMessageBytes });
  wss.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => {
      try {
        handleFrame(socket, data, isBinary);
      } catch (error) {
        log(`[server] message handler failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        sendError(socket, 'bad_message', 'could not process the message');
      }
    });
    socket.on('close', () => handleClose(socket));
    // Oversized frames and protocol violations land here; ws closes the socket itself.
    socket.on('error', () => {});
  });
  wss.on('error', () => {
    // Listen errors are reported through the http server below.
  });

  function close(): Promise<void> {
    running.stop();
    for (const socket of wss.clients) socket.close(CLOSE_GOING_AWAY, 'server shutting down');
    return new Promise((resolve) => {
      wss.close(() => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
      for (const socket of wss.clients) socket.terminate();
    });
  }

  return new Promise((resolve, reject) => {
    http.once('error', (error) => {
      running.stop();
      reject(error);
    });
    http.listen(env.port, options.host, () => {
      resolve({ port: (http.address() as AddressInfo).port, sim, close });
    });
  });
}
