/**
 * Typed websocket client + store. One instance per page (see GameProvider).
 *
 * - Connects to the page's own origin at config.net.wsPath (Vite proxies it to the game server).
 * - First frame on every socket is `join`; with a stored token it resumes the session.
 * - Reconnects forever with exponential backoff (config.net.reconnectMinMs .. reconnectMaxMs).
 * - State is exposed for React through subscribe/getState (useSyncExternalStore).
 * - Raw messages are available through onMessage for high-frequency consumers (sounds, effects).
 * - Market data (universe, prices, candles) is NOT in GameState: it lives in `market` (MarketStore),
 *   which has per-symbol subscriptions so 10 Hz ticks do not re-render the app.
 *
 * Everything environment-specific (socket, storage, clock) is injectable so this runs in vitest.
 */
import { defaultConfig, WS_CLOSE_REPLACED } from '@tg/shared';
import type { ClientMsg, JoinMsg, PlayerColor, Role, ServerMsg } from '@tg/shared';
import { MarketStore } from './marketStore.ts';
import { NetWorthStore } from './netWorthStore.ts';
import { browserSessionStorage, clearSession, loadSession, saveSession } from './session.ts';
import type { SessionStorageLike } from './session.ts';
import { applyServerMsg, initialGameState, parseServerMsg } from './state.ts';
import type { GameState } from './state.ts';

/** The part of the browser WebSocket we use. */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface GameClientOptions {
  role: Role;
  /** Defaults to ws(s)://<page host><config.net.wsPath>. */
  url?: string;
  createSocket?: (url: string) => SocketLike;
  storage?: SessionStorageLike | null;
  now?: () => number;
}

/** Messages a view may send after joining; `join` is handled by the client itself. */
export type GameIntent = Exclude<ClientMsg, JoinMsg>;

export function defaultWsUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}${defaultConfig.net.wsPath}`;
}

/** Delay before reconnect attempt number `attempt` (0-based): min, 2*min, 4*min, ... capped at max. */
export function reconnectDelayMs(attempt: number, minMs: number, maxMs: number): number {
  return Math.min(maxMs, minMs * 2 ** Math.min(attempt, 30));
}

export class GameClient {
  readonly role: Role;
  private readonly url: string | undefined;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly storage: SessionStorageLike | null;
  private readonly now: () => number;
  /** Universe, prices and candles; fed by `market`, `tick` and `candle` messages. */
  readonly market: MarketStore;
  readonly netWorth = new NetWorthStore();

  private state: GameState = initialGameState;
  private readonly stateListeners = new Set<() => void>();
  private readonly msgListeners = new Set<(msg: ServerMsg) => void>();

  private socket: SocketLike | null = null;
  private socketOpen = false;
  private running = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Name typed by the player, waiting for a socket / a welcome. */
  private pendingName: string | null = null;
  /** True when the join in flight used a stored token (so a failure means the token is stale). */
  private joinUsedToken = false;

  constructor(options: GameClientOptions) {
    this.role = options.role;
    this.url = options.url;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.storage = options.storage === undefined ? browserSessionStorage() : options.storage;
    this.now = options.now ?? (() => Date.now());
    this.market = new MarketStore(this.storage, this.role);
  }

  // --- store ---------------------------------------------------------------

  getState = (): GameState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  /** Every parsed server message, after it was folded into the state. */
  onMessage = (listener: (msg: ServerMsg) => void): (() => void) => {
    this.msgListeners.add(listener);
    return () => this.msgListeners.delete(listener);
  };

  private setState(next: GameState): void {
    if (next === this.state) return;
    this.state = next;
    for (const listener of [...this.stateListeners]) listener();
  }

  private patch(partial: Partial<GameState>): void {
    this.setState({ ...this.state, ...partial });
  }

  // --- lifecycle -----------------------------------------------------------

  /** Opens the connection (idempotent). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    this.patch({ connection: 'connecting', replaced: false });
    this.open();
  }

  /** Closes the connection and stops reconnecting (idempotent). The session token is kept. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.dropSocket();
    this.patch({ connection: 'closed', join: this.state.join === 'joining' ? 'none' : this.state.join });
  }

  // --- intents -------------------------------------------------------------

  /** Player name entry. Queued until the socket is open. */
  join(name: string): void {
    this.pendingName = name.trim();
    this.patch({ join: 'joining', error: null });
    if (this.socketOpen) this.sendJoin();
  }

  /** Forget the stored session and go back to name entry (the server keeps the old seat). */
  forget(): void {
    clearSession(this.storage, this.role);
    this.pendingName = null;
    this.patch({ me: null, join: 'none', error: null });
    if (this.running) {
      // A new socket = a clean, unjoined connection.
      this.dropSocket();
      this.attempt = 0;
      this.patch({ connection: 'connecting' });
      this.open();
    }
  }

  /** Sends an intent. Returns false (and sends nothing) when not connected and joined. */
  send(msg: GameIntent): boolean {
    if (!this.socket || !this.socketOpen || this.state.join !== 'joined') return false;
    if (msg.t === 'order') {
      if (this.state.pendingOrder) return false;
      const until = this.state.portfolio?.jailedUntil;
      const jailed = until !== undefined && Math.max(0, this.market.getLastDay()) < until;
      if (jailed) {
        this.patch({ pendingOrder: { symbol: msg.symbol, qty: msg.qty, endsAt: this.now() + this.state.config.sec.jailOrderDelayMs, confirmed: false }, orderCancelled: false });
        if (!this.sendRaw(msg)) {
          this.patch({ pendingOrder: null });
          return false;
        }
        return true;
      }
    }
    return this.sendRaw(msg);
  }

  startGame(debugMode = false): boolean {
    return this.send(debugMode ? { t: 'start', debugMode } : { t: 'start' });
  }

  /** LOBBY only: change the game's length for everyone in the lobby. */
  setSettings(settings: { quarters?: number; quarterSeconds?: number }): boolean {
    return this.send({ t: 'set_settings', ...settings });
  }

  setColor(color: PlayerColor): boolean {
    return this.send({ t: 'set_color', color });
  }

  /** FINAL only: everyone back to the lobby for a fresh game. */
  newGame(): boolean {
    return this.send({ t: 'new_game' });
  }

  dismissError(): void {
    if (this.state.error) this.patch({ error: null });
  }

  // --- internals -----------------------------------------------------------

  private open(): void {
    let socket: SocketLike;
    try {
      socket = this.createSocket(this.url ?? defaultWsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.socketOpen = false;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.socketOpen = true;
      this.attempt = 0;
      this.patch({ connection: 'open' });
      this.sendJoin();
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      const msg = parseServerMsg(ev.data);
      if (msg) this.handle(msg);
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.socketOpen = false;
      if (!this.running) return;
      if ((ev as { code?: unknown } | null)?.code === WS_CLOSE_REPLACED) {
        // Another tab took over this seat (a duplicated tab copies sessionStorage). Reconnecting
        // would kick that tab out in turn, so stop here; a reload takes the seat back.
        this.running = false;
        this.patch({
          connection: 'closed',
          join: 'none',
          replaced: true,
          error: { code: 'not_allowed', message: 'This seat was opened in another tab. Reload to take it back.', at: this.now() },
        });
        return;
      }
      this.scheduleReconnect();
    };
    // An error is always followed by close; nothing to do here.
    socket.onerror = () => {};
  }

  private dropSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.socketOpen = false;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close();
    } catch {
      // already closed
    }
  }

  private scheduleReconnect(): void {
    const { reconnectMinMs, reconnectMaxMs } = this.state.config.net;
    const delay = reconnectDelayMs(this.attempt, reconnectMinMs, reconnectMaxMs);
    this.attempt += 1;
    // `join` drops back to 'none' until the new socket has sent its join; `me` stays so the UI holds.
    this.patch({ connection: 'reconnecting', join: 'none' });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running) this.open();
    }, delay);
  }

  /** Sends `join` if there is something to join with: a stored token, a typed name, or the spectator role. */
  private sendJoin(): void {
    const session = loadSession(this.storage, this.role);
    const name = this.pendingName ?? session?.name ?? undefined;
    if (!session && this.role === 'player' && !this.pendingName) {
      // Nothing to join with yet: wait for name entry.
      return;
    }
    const msg: JoinMsg = { t: 'join', role: this.role };
    if (name) msg.name = name;
    if (session) msg.token = session.token;
    this.joinUsedToken = session !== null;
    this.patch({ join: 'joining' });
    this.sendRaw(msg);
  }

  private sendRaw(msg: ClientMsg): boolean {
    try {
      this.socket?.send(JSON.stringify(msg));
      return this.socket !== null;
    } catch {
      return false;
    }
  }

  private handle(msg: ServerMsg): void {
    const wasJoining = this.state.join === 'joining';

    if (msg.t === 'welcome') {
      this.pendingName = null;
      saveSession(this.storage, this.role, { token: msg.token, name: msg.name });
      this.market.setConfig(msg.config);
    } else if (msg.t === 'market' || msg.t === 'tick' || msg.t === 'candle') {
      this.market.apply(msg);
    } else if (msg.t === 'net_worth') {
      this.netWorth.apply(msg);
    }

    let next = applyServerMsg(this.state, msg, this.now());

    if (msg.t === 'error' && wasJoining) {
      // The join failed. Whatever we joined with is no good: drop it and fall back to a clean slate.
      const hadToken = this.joinUsedToken;
      clearSession(this.storage, this.role);
      this.pendingName = null;
      this.joinUsedToken = false;
      next = { ...next, join: 'none', me: null };
      this.setState(next);
      // The projector has no name entry to fall back to: retry once without the stale token.
      if (this.role === 'spectator' && hadToken && this.socketOpen) this.sendJoin();
    } else {
      this.setState(next);
    }

    for (const listener of [...this.msgListeners]) listener(msg);
  }
}
