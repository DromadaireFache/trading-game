import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, WS_CLOSE_KICKED, WS_CLOSE_REPLACED } from '@tg/shared';
import type { ClientMsg, LobbyState, PhaseInfo, ServerMsg, WelcomeMsg } from '@tg/shared';
import { GameClient, reconnectDelayMs } from '../gameClient.ts';
import type { SocketLike } from '../gameClient.ts';
import type { SessionStorageLike } from '../session.ts';

class FakeSocket implements SocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: ClientMsg[] = [];
  closed = false;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMsg);
  }
  close(): void {
    this.closed = true;
  }
  // test helpers
  open(): void {
    this.onopen?.({});
  }
  receive(msg: ServerMsg | string): void {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  }
  drop(): void {
    this.onclose?.({});
  }
}

function memoryStorage(): SessionStorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const lobby: LobbyState = { players: [{ id: 'p1', name: 'Ann', connected: true }], spectators: 0, minPlayers: 1, maxPlayers: 4, settings: { quarters: 4, quarterSeconds: 90 } };
const phaseAt = (serverTime: number, over: Partial<PhaseInfo> = {}): PhaseInfo => ({
  phase: 'LOBBY',
  endsAt: null,
  quarter: 0,
  totalQuarters: 8,
  serverTime,
  ...over,
});
const welcome = (over: Partial<WelcomeMsg> = {}): WelcomeMsg => ({
  t: 'welcome',
  playerId: 'p1',
  token: 'tok-1',
  role: 'player',
  name: 'Ann',
  phase: phaseAt(1_000),
  lobby,
  config: defaultConfig,
  ...over,
});

function setup(role: 'player' | 'spectator' = 'player', storage = memoryStorage()) {
  const sockets: FakeSocket[] = [];
  let now = 0;
  const client = new GameClient({
    role,
    url: 'ws://test/ws',
    storage,
    now: () => now,
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
  });
  return { client, sockets, storage, setNow: (t: number) => (now = t), last: () => sockets[sockets.length - 1]! };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('reconnectDelayMs', () => {
  it('doubles from min and caps at max', () => {
    expect([0, 1, 2, 3, 4, 10].map((a) => reconnectDelayMs(a, 500, 5000))).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
  });
});

describe('GameClient', () => {
  it('returns to name entry after a lobby kick and reconnects without rejoining', () => {
    const { client, last, storage } = setup();
    client.start();
    last().open();
    client.join('Ann');
    last().receive(welcome());
    last().onclose?.({ code: WS_CLOSE_KICKED });
    expect(client.getState()).toMatchObject({ me: null, join: 'none', error: { message: 'The lobby host removed you.' } });
    expect(storage.data.size).toBe(0);
    last().open();
    expect(last().sent).toEqual([]);
    client.join('Ann');
    expect(last().sent).toEqual([{ t: 'join', role: 'player', name: 'Ann' }]);
  });

  it('blocks repeated jailed orders immediately and restores server pending status', () => {
    const { client, last } = setup();
    client.start();
    last().open();
    client.join('Ann');
    last().receive(welcome());
    last().receive({ t: 'portfolio', cash: 1000, positions: [], equity: 1000, heat: 0, jailedUntil: 90 });
    expect(client.send({ t: 'order', symbol: 'AAA', qty: 5 })).toBe(true);
    expect(client.send({ t: 'order', symbol: 'BBB', qty: -5 })).toBe(false);
    expect(last().sent.filter((msg) => msg.t === 'order')).toHaveLength(1);
    last().receive({ t: 'pending_order', order: { symbol: 'AAA', qty: 5, remainingMs: 2000 } });
    expect(client.getState().pendingOrder).toEqual({ symbol: 'AAA', qty: 5, endsAt: 2000, confirmed: true });
    last().receive({ t: 'error', code: 'rejected', message: 'Previous order pending' });
    expect(client.getState().pendingOrder?.symbol).toBe('AAA');
    last().receive({ t: 'pending_order', order: null, cancelled: true });
    expect(client.getState().pendingOrder).toBeNull();
    expect(client.getState().orderCancelled).toBe(true);
    expect(client.send({ t: 'order', symbol: 'BBB', qty: -5 })).toBe(true);
  });
  it('a player sends nothing until a name is entered, then joins and stores the token', () => {
    const { client, last, storage } = setup();
    client.start();
    expect(client.getState().connection).toBe('connecting');
    last().open();
    expect(client.getState().connection).toBe('open');
    expect(last().sent).toEqual([]);

    client.join('  Ann ');
    expect(last().sent).toEqual([{ t: 'join', role: 'player', name: 'Ann' }]);
    expect(client.getState().join).toBe('joining');

    last().receive(welcome());
    const s = client.getState();
    expect(s.join).toBe('joined');
    expect(s.me).toEqual({ playerId: 'p1', name: 'Ann', role: 'player' });
    expect(s.lobby).toEqual(lobby);
    expect(JSON.parse(storage.data.get('tg.session.player')!)).toEqual({ token: 'tok-1', name: 'Ann' });
  });

  it('queues a join made before the socket is open', () => {
    const { client, last } = setup();
    client.start();
    client.join('Ann');
    expect(last().sent).toEqual([]);
    last().open();
    expect(last().sent).toEqual([{ t: 'join', role: 'player', name: 'Ann' }]);
  });

  it('a spectator joins on its own as soon as the socket opens', () => {
    const { client, last } = setup('spectator');
    client.start();
    last().open();
    expect(last().sent).toEqual([{ t: 'join', role: 'spectator' }]);
  });

  it('computes the clock offset from serverTime', () => {
    const { client, last, setNow } = setup();
    client.start();
    last().open();
    client.join('Ann');
    setNow(10_000);
    last().receive(welcome({ phase: phaseAt(12_500) }));
    expect(client.getState().clockOffsetMs).toBe(2_500);
    setNow(20_000);
    last().receive({ t: 'phase', ...phaseAt(19_000, { phase: 'BRIEFING', quarter: 1, endsAt: 34_000 }) });
    expect(client.getState().clockOffsetMs).toBe(-1_000);
    expect(client.getState().phase).toMatchObject({ phase: 'BRIEFING', quarter: 1, endsAt: 34_000 });
  });

  it('reconnects with backoff and rejoins with the stored token', () => {
    const { client, sockets, last } = setup();
    client.start();
    last().open();
    client.join('Ann');
    last().receive(welcome());

    last().drop();
    expect(client.getState().connection).toBe('reconnecting');
    expect(client.getState().me).not.toBeNull(); // UI holds its place
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(defaultConfig.net.reconnectMinMs - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    // Second attempt fails too: next delay is doubled.
    last().drop();
    vi.advanceTimersByTime(defaultConfig.net.reconnectMinMs * 2 - 1);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);

    last().open();
    expect(last().sent).toEqual([{ t: 'join', role: 'player', name: 'Ann', token: 'tok-1' }]);
    last().receive(welcome({ token: 'tok-1' }));
    expect(client.getState()).toMatchObject({ connection: 'open', join: 'joined' });
  });

  it('resumes from sessionStorage on a fresh page load', () => {
    const storage = memoryStorage();
    storage.setItem('tg.session.player', JSON.stringify({ token: 'tok-9', name: 'Bob' }));
    const { client, last } = setup('player', storage);
    client.start();
    last().open();
    expect(last().sent).toEqual([{ t: 'join', role: 'player', name: 'Bob', token: 'tok-9' }]);
  });

  it('a refused token join clears the session and returns to name entry', () => {
    const storage = memoryStorage();
    storage.setItem('tg.session.player', JSON.stringify({ token: 'stale', name: 'Bob' }));
    const { client, last } = setup('player', storage);
    client.start();
    last().open();
    last().receive({ t: 'error', code: 'bad_token', message: 'Unknown session' });
    const s = client.getState();
    expect(s.me).toBeNull();
    expect(s.join).toBe('none');
    expect(s.error?.code).toBe('bad_token');
    expect(storage.data.size).toBe(0);
    expect(last().sent).toHaveLength(1); // no automatic retry for players

    // After a reconnect it must not rejoin on its own either.
    last().drop();
    vi.advanceTimersByTime(defaultConfig.net.reconnectMaxMs);
    last().open();
    expect(last().sent).toEqual([]);
  });

  it('a spectator with a stale token retries once without it', () => {
    const storage = memoryStorage();
    storage.setItem('tg.session.spectator', JSON.stringify({ token: 'stale', name: '' }));
    const { client, last } = setup('spectator', storage);
    client.start();
    last().open();
    last().receive({ t: 'error', code: 'bad_token', message: 'Unknown session' });
    expect(last().sent).toEqual([
      { t: 'join', role: 'spectator', token: 'stale' },
      { t: 'join', role: 'spectator' },
    ]);
    last().receive({ t: 'error', code: 'game_full', message: 'Too many spectators' });
    expect(last().sent).toHaveLength(2); // no loop
    expect(client.getState().error?.code).toBe('game_full');
  });

  it('name_taken keeps the player on name entry with the error', () => {
    const { client, last, storage } = setup();
    client.start();
    last().open();
    client.join('Ann');
    last().receive({ t: 'error', code: 'name_taken', message: 'Name taken' });
    expect(client.getState()).toMatchObject({ join: 'none', me: null, error: { code: 'name_taken' } });
    expect(storage.data.size).toBe(0);
    client.join('Ann2');
    expect(last().sent[1]).toEqual({ t: 'join', role: 'player', name: 'Ann2' });
  });

  it('an error after joining does not drop the session', () => {
    const { client, last, storage } = setup();
    client.start();
    last().open();
    client.join('Ann');
    last().receive(welcome());
    last().receive({ t: 'error', code: 'not_allowed', message: 'Not enough players' });
    expect(client.getState()).toMatchObject({ join: 'joined', error: { code: 'not_allowed' } });
    expect(client.getState().me).not.toBeNull();
    expect(storage.data.size).toBe(1);
    client.dismissError();
    expect(client.getState().error).toBeNull();
  });

  it('only sends intents once joined', () => {
    const { client, last } = setup();
    client.start();
    last().open();
    expect(client.startGame()).toBe(false);
    client.join('Ann');
    last().receive(welcome());
    expect(client.startGame()).toBe(true);
    expect(last().sent[1]).toEqual({ t: 'start' });
    last().drop();
    expect(client.startGame()).toBe(false);
  });

  it('ignores garbage frames and notifies raw-message listeners', () => {
    const { client, last } = setup();
    const seen: string[] = [];
    client.onMessage((m) => seen.push(m.t));
    client.start();
    last().open();
    const before = client.getState();
    last().receive('not json');
    last().receive('42');
    last().receive('{"no":"tag"}');
    expect(client.getState()).toBe(before);
    last().receive({ t: 'tick', day: 1, tickOfDay: 1, prices: {} });
    expect(seen).toEqual(['tick']);
  });

  it('stop() closes the socket and cancels reconnects; start() works again (StrictMode)', () => {
    const { client, sockets, last } = setup();
    client.start();
    const first = last();
    client.stop();
    expect(first.closed).toBe(true);
    expect(client.getState().connection).toBe('closed');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    first.open(); // late event from the dead socket is ignored
    expect(client.getState().connection).toBe('closed');

    client.start();
    expect(sockets).toHaveLength(2);
    last().drop();
    client.stop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
  });

  it('does not reconnect when the server says another tab took the seat', () => {
    const { client, sockets, last, storage } = setup();
    client.start();
    last().open();
    client.join('Ann');
    last().receive(welcome());
    last().onclose?.({ code: WS_CLOSE_REPLACED });
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(client.getState()).toMatchObject({ connection: 'closed', replaced: true, error: { code: 'not_allowed' } });
    expect(storage.data.size).toBe(1); // a reload takes the seat back
  });

  it('forget() clears the session and opens a clean connection', () => {
    const { client, sockets, last, storage } = setup();
    client.start();
    last().open();
    client.join('Ann');
    last().receive(welcome());
    client.forget();
    expect(storage.data.size).toBe(0);
    expect(client.getState()).toMatchObject({ me: null, join: 'none' });
    expect(sockets).toHaveLength(2);
    expect(sockets[0]!.closed).toBe(true);
    last().open();
    expect(last().sent).toEqual([]);
  });
});
