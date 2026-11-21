/**
 * Shell tests over real websockets on a free port, with phases a few ticks long.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { QUARTER_PHASES, SECTORS, defaultConfig, mergeConfig, packCandle, phaseTicks, quarterTicks, roundPrice, totalTradingDays } from '@tg/shared';
import type { DeepPartial, GameConfig, MsgOf, OHLC, Phase, ServerMsg, ServerMsgType, SymbolId } from '@tg/shared';
import { CLOSE_REPLACED, HEALTH_PATH, startGameServer } from '../gameServer.ts';
import type { GameServer } from '../gameServer.ts';

const TICK_MS = 20;
const WAIT_MS = 5_000;

const fastConfig: GameConfig = mergeConfig(defaultConfig, {
  time: { tickMs: TICK_MS, ticksPerCandle: 2, daysPerQuarter: 3, quarters: 2 },
  phaseMs: { BRIEFING: 3 * TICK_MS, RESULTS: 3 * TICK_MS, SHOP: 2 * TICK_MS },
  lobby: { minPlayers: 1, maxPlayers: 2, maxSpectators: 1 },
});

class Client {
  readonly received: ServerMsg[] = [];
  private cursor = 0;
  private waiters: Array<() => void> = [];
  closeCode: number | null = null;

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      this.received.push(JSON.parse(data.toString()) as ServerMsg);
      this.wake();
    });
    socket.on('close', (code) => {
      this.closeCode = code;
      this.wake();
    });
    socket.on('error', () => {});
  }

  static open(server: GameServer, path = fastConfig.net.wsPath): Promise<Client> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}${path}`);
      const client = new Client(socket);
      socket.once('open', () => resolve(client));
      socket.once('error', reject);
    });
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  private async until<T>(what: string, check: () => T | undefined): Promise<T> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const found = check();
      if (found !== undefined) return found;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for ${what}; got ${JSON.stringify(this.received.slice(-5))}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  sendRaw(data: string | Buffer): void {
    this.socket.send(data);
  }

  send(msg: unknown): void {
    this.sendRaw(JSON.stringify(msg));
  }

  /** Next not-yet-consumed message of type `t` (optionally matching `match`); skips others. */
  next<T extends ServerMsgType>(t: T, match: (m: MsgOf<ServerMsg, T>) => boolean = () => true): Promise<MsgOf<ServerMsg, T>> {
    return this.until(`"${t}"`, () => {
      while (this.cursor < this.received.length) {
        const msg = this.received[this.cursor++]!;
        if (msg.t === t && match(msg as MsgOf<ServerMsg, T>)) return msg as MsgOf<ServerMsg, T>;
      }
      return undefined;
    });
  }

  closed(): Promise<number> {
    return this.until('close', () => this.closeCode ?? undefined);
  }

  async join(role: 'player' | 'spectator', name?: string, token?: string): Promise<MsgOf<ServerMsg, 'welcome'>> {
    this.send({ t: 'join', role, name, token });
    return this.next('welcome');
  }

  close(): void {
    this.socket.close();
  }
}

let server: GameServer | null = null;
const clients: Client[] = [];

async function start(overrides: DeepPartial<GameConfig> = {}): Promise<GameServer> {
  const config = mergeConfig(fastConfig, overrides);
  server = await startGameServer({ port: 0, clientPort: 5173, seed: 1, config }, { host: '127.0.0.1', log: () => {} });
  return server;
}

async function open(s: GameServer): Promise<Client> {
  const client = await Client.open(s);
  clients.push(client);
  return client;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.terminate();
  await server?.close();
  server = null;
});

describe('join and lobby', () => {
  it('welcomes a player with token, phase, roster and the effective config', async () => {
    const s = await start();
    const ann = await open(s);
    const welcome = await ann.join('player', '  Ann  ');
    expect(welcome).toMatchObject({
      role: 'player',
      name: 'Ann',
      phase: { phase: 'LOBBY', endsAt: null, quarter: 0, totalQuarters: 2 },
      lobby: { players: [{ id: welcome.playerId, name: 'Ann', connected: true }], spectators: 0, minPlayers: 1, maxPlayers: 2 },
    });
    expect(welcome.token.length).toBeGreaterThan(10);
    expect(welcome.config).toEqual(s.sim.config);
    expect(Math.abs(welcome.phase.serverTime - Date.now())).toBeLessThan(2_000);
  });

  it('broadcasts the roster on join, spectator join and disconnect', async () => {
    const s = await start();
    const ann = await open(s);
    await ann.join('player', 'Ann');
    const bob = await open(s);
    await bob.join('player', 'Bob');
    expect((await ann.next('lobby', (m) => m.players.length === 2)).players.map((p) => p.name)).toEqual(['Ann', 'Bob']);

    const floor = await open(s);
    const welcome = await floor.join('spectator');
    expect(welcome).toMatchObject({ role: 'spectator', lobby: { spectators: 1 } });
    expect(welcome.lobby.players).toHaveLength(2);
    await ann.next('lobby', (m) => m.spectators === 1);

    bob.close();
    const after = await ann.next('lobby', (m) => m.players.some((p) => !p.connected));
    expect(after.players).toEqual([
      { id: expect.any(String), name: 'Ann', connected: true },
      { id: expect.any(String), name: 'Bob', connected: false },
    ]);
    floor.close();
    await ann.next('lobby', (m) => m.spectators === 0);
  });

  it('enforces unique names, valid names, the player cap and the spectator cap', async () => {
    const s = await start();
    const ann = await open(s);
    await ann.join('player', 'Ann');

    const other = await open(s);
    other.send({ t: 'join', role: 'player', name: 'ANN' });
    expect((await other.next('error')).code).toBe('name_taken');
    other.send({ t: 'join', role: 'player', name: '   ' });
    expect((await other.next('error')).code).toBe('name_invalid');
    other.send({ t: 'join', role: 'player' });
    expect((await other.next('error')).code).toBe('name_invalid');
    other.send({ t: 'join', role: 'player', name: 'x'.repeat(fastConfig.lobby.nameMaxLength + 1) });
    expect((await other.next('error')).code).toBe('name_invalid');
    await other.join('player', 'Bob'); // the same socket can still join after errors

    const third = await open(s);
    third.send({ t: 'join', role: 'player', name: 'Cy' });
    expect((await third.next('error')).code).toBe('game_full');

    await third.join('spectator');
    const fourth = await open(s);
    fourth.send({ t: 'join', role: 'spectator' });
    expect((await fourth.next('error')).code).toBe('game_full');
  });

  it('gives the seat and name of a player who left the lobby to a newcomer', async () => {
    const s = await start();
    const ann = await open(s);
    await ann.join('player', 'Ann');
    const bob = await open(s);
    const bobWelcome = await bob.join('player', 'Bob');
    bob.close();
    await ann.next('lobby', (m) => m.players.some((p) => !p.connected));

    const cy = await open(s);
    const cyWelcome = await cy.join('player', 'Cy');
    expect(cyWelcome.lobby.players.map((p) => p.name)).toEqual(['Ann', 'Cy']);

    // Bob's old token is gone now; with the lobby full it cannot become a fresh join either.
    const late = await open(s);
    late.send({ t: 'join', role: 'player', name: 'Bob', token: bobWelcome.token });
    expect((await late.next('error')).code).toBe('bad_token');
  });
});

describe('reconnect', () => {
  it('resumes a session by token, ignoring name and role', async () => {
    const s = await start();
    const ann = await open(s);
    const first = await ann.join('player', 'Ann');
    const watcher = await open(s);
    await watcher.join('player', 'Bob');

    ann.close();
    await watcher.next('lobby', (m) => m.players[0]?.connected === false);

    const again = await open(s);
    const second = await again.join('spectator', 'Somebody else', first.token);
    expect(second).toMatchObject({ playerId: first.playerId, token: first.token, role: 'player', name: 'Ann' });
    const roster = await watcher.next('lobby', (m) => m.players[0]?.connected === true);
    expect(roster.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
  });

  it('replaces the old connection when the same token joins twice', async () => {
    const s = await start();
    const ann = await open(s);
    const first = await ann.join('player', 'Ann');
    const twin = await open(s);
    const second = await twin.join('player', undefined, first.token);
    expect(second.playerId).toBe(first.playerId);
    expect(await ann.closed()).toBe(CLOSE_REPLACED);
    expect(second.lobby.players).toEqual([{ id: first.playerId, name: 'Ann', connected: true }]);
  });

  it('falls back to a fresh join for an unknown token in the lobby', async () => {
    const s = await start();
    const ann = await open(s);
    const welcome = await ann.join('player', 'Ann', 'stale-token-from-an-older-server');
    expect(welcome.name).toBe('Ann');
    expect(welcome.token).not.toBe('stale-token-from-an-older-server');
  });

  it('keeps a player in the game across a mid-game reconnect and refuses new players', async () => {
    const s = await start({ time: { quarters: 50 } });
    const ann = await open(s);
    const first = await ann.join('player', 'Ann');
    ann.send({ t: 'start' });
    await ann.next('phase', (m) => m.phase === 'BRIEFING');
    ann.close();

    const again = await open(s);
    const second = await again.join('player', 'Ann', first.token);
    expect(second.playerId).toBe(first.playerId);
    expect(second.phase.phase).not.toBe('LOBBY');
    expect(second.phase.quarter).toBeGreaterThanOrEqual(1);
    expect(second.phase.endsAt).not.toBeNull();
    expect(second.phase.endsAt! - second.phase.serverTime).toBeGreaterThan(-TICK_MS);
    expect(second.phase.endsAt! - second.phase.serverTime).toBeLessThanOrEqual(phaseTicks(s.sim.config, 'TRADING') * TICK_MS);

    const late = await open(s);
    late.send({ t: 'join', role: 'player', name: 'Late' });
    expect((await late.next('error')).code).toBe('game_in_progress');
    late.send({ t: 'join', role: 'player', name: 'Late', token: 'nope' });
    expect((await late.next('error')).code).toBe('bad_token');
    const spectate = await late.join('spectator');
    expect(spectate.phase.phase).not.toBe('LOBBY');
  });

  it('lets a player who lost the token take a disconnected seat back by name, mid-game', async () => {
    const s = await start({ time: { quarters: 50 } });
    const ann = await open(s);
    const first = await ann.join('player', 'Ann');
    const bob = await open(s);
    await bob.join('player', 'Bob');
    ann.send({ t: 'start' });
    await bob.next('phase', (m) => m.phase === 'BRIEFING');

    // Ann is still connected: her name is not up for grabs.
    const thief = await open(s);
    thief.send({ t: 'join', role: 'player', name: 'ann' });
    expect((await thief.next('error')).code).toBe('game_in_progress');

    ann.close();
    await bob.next('lobby', (m) => m.players[0]?.connected === false);

    // New tab: no token (or a stale one), same name, any casing.
    const again = await open(s);
    const second = await again.join('player', ' ANN ', 'token-from-a-closed-tab');
    expect(second).toMatchObject({ playerId: first.playerId, name: 'Ann', role: 'player' });
    expect(second.token).not.toBe(first.token);
    expect(second.lobby.players).toEqual([
      { id: first.playerId, name: 'Ann', connected: true },
      { id: expect.any(String), name: 'Bob', connected: true },
    ]);
    expect(s.sim.getState().players).toHaveLength(2);

    // The old token died with the takeover.
    const old = await open(s);
    old.send({ t: 'join', role: 'player', token: first.token });
    expect((await old.next('error')).code).toBe('bad_token');
  });
});

describe('start and phases', () => {
  it('only lets a joined player start, and only with enough players', async () => {
    const s = await start({ lobby: { minPlayers: 2 } });
    const floor = await open(s);
    floor.send({ t: 'start' });
    expect((await floor.next('error')).code).toBe('not_joined');
    await floor.join('spectator');
    floor.send({ t: 'start' });
    expect((await floor.next('error')).code).toBe('not_allowed');

    const ann = await open(s);
    await ann.join('player', 'Ann');
    ann.send({ t: 'start' });
    expect((await ann.next('error')).code).toBe('not_allowed');
    expect(s.sim.getState().phase).toBe('LOBBY');

    const bob = await open(s);
    await bob.join('player', 'Bob');
    bob.send({ t: 'start' });
    expect(await ann.next('phase')).toMatchObject({ phase: 'BRIEFING', quarter: 1, totalQuarters: 2 });
    ann.send({ t: 'start' });
    expect((await ann.next('error')).code).toBe('not_allowed');
  });

  it('keeps a player who dropped just before Start, and evicts one who has been gone longer than the grace', async () => {
    for (const [ghostGraceMs, kept] of [[60_000, true], [0, false]] as const) {
      const s = await start({ time: { quarters: 50 }, lobby: { ghostGraceMs } });
      const ann = await open(s);
      await ann.join('player', 'Ann');
      const bob = await open(s);
      const bobWelcome = await bob.join('player', 'Bob');
      bob.close();
      await ann.next('lobby', (m) => m.players.some((p) => !p.connected));

      ann.send({ t: 'start' });
      await ann.next('phase', (m) => m.phase === 'BRIEFING');
      expect(s.sim.getState().players.map((p) => p.name)).toEqual(kept ? ['Ann', 'Bob'] : ['Ann']);

      const back = await open(s);
      back.send({ t: 'join', role: 'player', name: 'Bob', token: bobWelcome.token });
      if (kept) expect((await back.next('welcome')).playerId).toBe(bobWelcome.playerId);
      else expect((await back.next('error')).code).toBe('bad_token');

      for (const client of clients.splice(0)) client.socket.terminate();
      await s.close();
      server = null;
    }
  });

  it('broadcasts every phase in order with wall-clock endsAt, through to FINAL', async () => {
    const s = await start();
    const ann = await open(s);
    await ann.join('player', 'Ann');
    const floor = await open(s);
    await floor.join('spectator');

    const startedAt = Date.now();
    ann.send({ t: 'start' });

    const expected = [1, 2].flatMap((quarter) => QUARTER_PHASES.filter((phase) => quarter < 2 || (phase !== 'RESULTS' && phase !== 'SHOP')).map((phase) => ({ phase, quarter })));
    const seen: Array<MsgOf<ServerMsg, 'phase'>> = [];
    for (let i = 0; i < expected.length + 1; i++) seen.push(await ann.next('phase'));
    const elapsed = Date.now() - startedAt;

    expect(seen.map(({ phase, quarter }) => ({ phase, quarter }))).toEqual([...expected, { phase: 'FINAL', quarter: 2 }]);
    expect(seen.at(-1)!.endsAt).toBeNull();

    // endsAt of each phase = start of the phase + its length, and phases follow each other exactly.
    for (let i = 0; i < expected.length; i++) {
      const msg = seen[i]!;
      const lengthMs = phaseTicks(s.sim.config, expected[i]!.phase) * TICK_MS;
      expect(msg.endsAt).not.toBeNull();
      expect(msg.endsAt! - msg.serverTime).toBeLessThanOrEqual(lengthMs);
      expect(msg.endsAt! - msg.serverTime).toBeGreaterThan(lengthMs - 10 * TICK_MS);
      if (i > 0) expect(msg.endsAt! - seen[i - 1]!.endsAt!).toBe(lengthMs);
    }

    // Real time matches tick time: no drift over the whole game.
    const gameMs = (quarterTicks(s.sim.config) * 2 - phaseTicks(s.sim.config, 'RESULTS') - phaseTicks(s.sim.config, 'SHOP')) * TICK_MS;
    expect(elapsed).toBeGreaterThanOrEqual(gameMs - TICK_MS);
    expect(elapsed).toBeLessThan(gameMs + 25 * TICK_MS);

    // The projector saw the same thing.
    const floorPhases: string[] = [];
    for (let i = 0; i < expected.length + 1; i++) floorPhases.push((await floor.next('phase')).phase);
    expect(floorPhases).toEqual(seen.map((m) => m.phase));
  });

  it('advances Results and Shop when every player is ready, with scoped and reconnectable readiness', async () => {
    const s = await start({ time: { quarters: 3 }, phaseMs: { RESULTS: 1_000, SHOP: 3_000 } });
    const ann = await open(s);
    const annSeat = await ann.join('player', 'Ann');
    const bob = await open(s);
    const bobSeat = await bob.join('player', 'Bob');
    const floor = await open(s);
    await floor.join('spectator');

    ann.send({ t: 'start' });
    const results = await ann.next('phase', (m) => m.phase === 'RESULTS');
    ann.send({ t: 'ready_up', quarter: 1, phase: 'RESULTS' });
    expect((await bob.next('phase_ready')).readyPlayerIds).toEqual([annSeat.playerId]);
    expect(s.sim.getState().phase).toBe('RESULTS');
    bob.send({ t: 'ready_up', quarter: 1, phase: 'RESULTS' });
    const shop = await ann.next('phase', (m) => m.phase === 'SHOP');
    expect(shop.endsAt! - s.sim.config.phaseMs.SHOP).toBeLessThan(results.endsAt!);
    expect(s.sim.getPhaseReady()?.readyPlayerIds).toEqual([]);
    ann.send({ t: 'ready_up', quarter: 1, phase: 'RESULTS' });
    expect(await ann.next('error')).toMatchObject({ code: 'rejected' });

    floor.send({ t: 'ready_up', quarter: 1 });
    expect(await floor.next('error')).toMatchObject({ code: 'not_allowed' });
    ann.send({ t: 'ready_up', quarter: 1 });
    ann.send({ t: 'ready_up', quarter: 1 });
    expect((await bob.next('phase_ready', (m) => m.readyPlayerIds.length === 1)).readyPlayerIds).toEqual([annSeat.playerId]);
    expect(s.sim.getState().phase).toBe('SHOP');

    const back = await open(s);
    expect((await back.join('player', 'Ann', annSeat.token)).phase.phase).toBe('SHOP');
    expect((await back.next('phase_ready')).readyPlayerIds).toEqual([annSeat.playerId]);

    bob.send({ t: 'ready_up', quarter: 1 });
    expect((await back.next('phase_ready')).readyPlayerIds).toEqual([annSeat.playerId, bobSeat.playerId]);
    const briefing = await back.next('phase');
    expect(briefing).toMatchObject({ phase: 'BRIEFING', quarter: 2 });
    expect(briefing.endsAt! - s.sim.config.phaseMs.BRIEFING).toBeLessThan(shop.endsAt!);

    await back.next('phase', (m) => m.phase === 'SHOP' && m.quarter === 2);
    expect(s.sim.getPhaseReady()?.readyPlayerIds).toEqual([]);
    back.send({ t: 'ready_up', quarter: 1 });
    expect(await back.next('error')).toMatchObject({ code: 'rejected' });
    expect(s.sim.getPhaseReady()?.readyPlayerIds).toEqual([]);
  });

  it('lets one player skip in debug mode and resets debug mode on Play Again', async () => {
    const s = await start({ time: { quarters: 1, daysPerQuarter: 60 }, phaseMs: { RESULTS: 1_000 } });
    const ann = await open(s);
    await ann.join('player', 'Ann');
    const bob = await open(s);
    await bob.join('player', 'Bob');
    ann.send({ t: 'start', debugMode: true });
    const trading = await ann.next('phase', (m) => m.phase === 'TRADING');
    expect(trading.debugMode).toBe(true);

    await bob.next('phase', (m) => m.phase === 'TRADING');
    bob.send({ t: 'ready_up', quarter: 1, phase: 'TRADING' });
    // Ready in the last TRADING ends the game at once (the earnings come out with the close).
    const final0 = await ann.next('phase');
    expect(final0.phase).toBe('FINAL');
    expect(Date.now()).toBeLessThan(trading.endsAt!);
    const final = await ann.next('results');
    expect(final.final).toBe(true);
    expect(final.leaderboard).toHaveLength(2);

    ann.send({ t: 'new_game' });
    expect((await ann.next('welcome')).phase.debugMode).toBeUndefined();
  });

  it('lets any player set the game length in the lobby: quarters keep their days, days change length', async () => {
    const s = await start({ time: { quarters: 3, daysPerQuarter: 60 } });
    const base = s.sim.config.time;
    const baseSeconds = Math.round((base.daysPerQuarter * base.ticksPerCandle * base.tickMs) / 1000);
    const ann = await open(s);
    const first = await ann.join('player', 'Ann');
    const bob = await open(s);
    await bob.join('player', 'Bob');
    expect((await ann.next('lobby', (m) => m.players.length === 2)).settings).toEqual({ quarters: 3, quarterSeconds: baseSeconds });

    // Not an option (and not the server's own value): refused, nothing changes.
    bob.send({ t: 'set_settings', quarters: 5 });
    expect(await bob.next('error')).toMatchObject({ code: 'bad_message' });
    bob.send({ t: 'set_settings', quarterSeconds: 45 });
    expect(await bob.next('error')).toMatchObject({ code: 'bad_message' });

    bob.send({ t: 'set_settings', quarters: 2, quarterSeconds: 30 });
    for (const client of [ann, bob]) {
      const welcome = await client.next('welcome');
      expect(welcome).toMatchObject({ game: first.game, phase: { phase: 'LOBBY', totalQuarters: 2 } });
      const t = welcome.config.time;
      expect(t.quarters).toBe(2);
      expect(t.daysPerQuarter).toBe(60);
      expect(t.daysPerQuarter * t.ticksPerCandle * t.tickMs).toBeCloseTo(30_000, 6);
      expect(welcome.lobby.settings).toEqual({ quarters: 2, quarterSeconds: 30 });
      expect(welcome.lobby.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    }
    // The server's own length stays a choice and brings the server's tick back.
    ann.send({ t: 'set_settings', quarters: 3, quarterSeconds: baseSeconds });
    expect((await ann.next('welcome')).config.time).toEqual(base);

    bob.send({ t: 'set_settings', quarterSeconds: 60 });
    await ann.next('welcome');
    ann.send({ t: 'start' });
    const trading = await bob.next('phase', (m) => m.phase === 'TRADING');
    expect(trading).toMatchObject({ quarter: 1, totalQuarters: 3 });
    expect(s.sim.config.time.daysPerQuarter * s.sim.config.time.ticksPerCandle * s.sim.config.time.tickMs).toBeCloseTo(60_000, 6);
    bob.send({ t: 'set_settings', quarters: 4 });
    expect(await bob.next('error')).toMatchObject({ code: 'not_allowed' });
  });

  it.each([false, true])('ends an active match from a player’s request (debug = %s)', async (debugMode) => {
    const s = await start({ time: { quarters: 3, daysPerQuarter: 60 } });
    const ann = await open(s);
    const { game } = await ann.join('player', 'Ann');
    const bob = await open(s);
    await bob.join('player', 'Bob');
    const floor = await open(s);
    await floor.join('spectator');

    ann.send({ t: 'end_game', game });
    expect(await ann.next('error')).toMatchObject({ code: 'rejected' });
    ann.send({ t: 'start', debugMode });
    await Promise.all([ann, bob, floor].map((client) => client.next('phase', (m) => m.phase === 'TRADING')));
    floor.send({ t: 'end_game', game });
    expect(await floor.next('error')).toMatchObject({ code: 'not_allowed' });
    bob.send({ t: 'end_game', game: game! + 1 });
    expect(await bob.next('error')).toMatchObject({ code: 'not_allowed' });

    bob.send({ t: 'end_game', game });
    for (const client of [ann, bob, floor]) {
      expect(await client.next('phase')).toMatchObject({ phase: 'FINAL', quarter: 1, endsAt: null });
      expect(await client.next('results')).toMatchObject({ final: true, recap: { quarter: 1 } });
    }
    bob.send({ t: 'end_game', game });
    expect(await bob.next('error')).toMatchObject({ code: 'rejected' });
    bob.send({ t: 'new_game' });
    expect(await bob.next('welcome')).toMatchObject({ game: game! + 1, phase: { phase: 'LOBBY' } });
  });

  it('forwards sim rejections to the player only', async () => {
    const s = await start({ time: { quarters: 50 } });
    const ann = await open(s);
    await ann.join('player', 'Ann');
    const bob = await open(s);
    await bob.join('player', 'Bob');
    ann.send({ t: 'order', symbol: 'ACME', qty: 10 });
    expect(await ann.next('error')).toMatchObject({ code: 'rejected' });
    const floor = await open(s);
    await floor.join('spectator');
    floor.send({ t: 'order', symbol: 'ACME', qty: 10 });
    expect((await floor.next('error')).code).toBe('not_allowed');
    expect(bob.received.some((m) => m.t === 'error')).toBe(false);
  });
});

// --- market ------------------------------------------------------------------

type TickMsg = MsgOf<ServerMsg, 'tick'>;
type MarketMsg = MsgOf<ServerMsg, 'market'>;
type MarketState = Pick<MarketMsg, 'day' | 'tickOfDay' | 'prices' | 'candles' | 'current'>;

/** Keys a client may see of a symbol; everything else of Company / Fund is hidden sim state. */
const PUBLIC_SYMBOL_KEYS = ['symbol', 'name', 'kind', 'sector', 'marketCap', 'ceo', 'members'];

function isWirePrice(config: GameConfig, price: unknown): boolean {
  return typeof price === 'number' && Number.isFinite(price) && price > 0 && roundPrice(config, price) === price;
}

/** The candle history a client holds: its `market` snapshot plus every `candle` message after it. */
function historyOf(client: Client): Record<SymbolId, number[]> {
  const from = client.received.findIndex((m) => m.t === 'market');
  if (from < 0) throw new Error('client never got a market snapshot');
  const snapshot = client.received[from] as MarketMsg;
  const flat: Record<SymbolId, number[]> = {};
  for (const symbol in snapshot.candles) flat[symbol] = [...snapshot.candles[symbol]!];
  let day = snapshot.day;
  for (const msg of client.received.slice(from + 1)) {
    if (msg.t !== 'candle') continue;
    if (msg.day !== day) throw new Error(`candle of day ${msg.day} arrived where day ${day} was due`);
    day += 1;
    for (const symbol in msg.ohlc) packCandle(flat[symbol]!, msg.ohlc[symbol]!);
  }
  return flat;
}

/**
 * What a client that was there all along knew at the moment a `market` snapshot was taken, i.e. just
 * before it received `firstTickAfter` (the first tick the snapshot's owner got after the snapshot).
 */
function knownBefore(witness: Client, firstTickAfter: TickMsg): MarketState {
  const at = witness.received.findIndex((m) => m.t === 'tick' && m.day === firstTickAfter.day && m.tickOfDay === firstTickAfter.tickOfDay);
  if (at < 0) throw new Error('the witness has not received that tick');
  const before = witness.received.slice(0, at);
  const own = before.find((m) => m.t === 'market') as MarketMsg;
  const ticks = before.filter((m): m is TickMsg => m.t === 'tick');
  const candles: Record<SymbolId, number[]> = {};
  for (const symbol in own.candles) candles[symbol] = [...own.candles[symbol]!];
  let closedDays = own.day;
  for (const msg of before) {
    if (msg.t !== 'candle') continue;
    closedDays += 1;
    for (const symbol in msg.ohlc) packCandle(candles[symbol]!, msg.ohlc[symbol]!);
  }
  const open = ticks.filter((m) => m.day === closedDays);
  let current: Record<SymbolId, OHLC> | null = null;
  if (open.length > 0) {
    current = {};
    for (const symbol in open[0]!.prices) {
      const path = open.map((m) => m.prices[symbol]!);
      current[symbol] = { o: path[0]!, h: Math.max(...path), l: Math.min(...path), c: path.at(-1)! };
    }
  }
  return { day: closedDays, tickOfDay: open.length, prices: ticks.at(-1)?.prices ?? own.prices, candles, current };
}

describe('market', () => {
  it('sends the public universe and an empty history right after welcome, to players and spectators, in the lobby', async () => {
    const s = await start();
    const ann = await open(s);
    await ann.join('player', 'Ann');
    const floor = await open(s);
    await floor.join('spectator');

    const market = await ann.next('market');
    expect(ann.received.slice(0, 2).map((m) => m.t)).toEqual(['welcome', 'market']);
    const symbols = market.universe.symbols;
    const perSector = s.sim.config.market.companiesPerSector;
    expect(symbols.map((x) => x.kind)).toEqual([
      'index',
      ...SECTORS.map(() => 'sector'),
      ...SECTORS.flatMap(() => Array.from({ length: perSector }, () => 'stock')),
    ]);
    expect(symbols.slice(1 + SECTORS.length).map((x) => x.sector)).toEqual(SECTORS.flatMap((sector) => Array.from({ length: perSector }, () => sector)));
    const ids = symbols.map((x) => x.symbol);
    expect(new Set(ids).size).toBe(ids.length);
    for (const info of symbols) {
      expect(PUBLIC_SYMBOL_KEYS).toEqual(expect.arrayContaining(Object.keys(info)));
      expect(info.name.length).toBeGreaterThan(0);
    }

    expect(market).toMatchObject({ day: 0, tickOfDay: 0, current: null });
    expect(Object.keys(market.prices).sort()).toEqual([...ids].sort());
    expect(Object.keys(market.candles).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(isWirePrice(s.sim.config, market.prices[id])).toBe(true);
      expect(market.candles[id]).toEqual([]);
    }

    // The projector gets the very same picture, and nobody gets it twice or by broadcast.
    const floorMarket = await floor.next('market');
    expect(floorMarket).toEqual(market);
    expect(floor.received.slice(0, 2).map((m) => m.t)).toEqual(['welcome', 'market']);
    await ann.next('lobby', (m) => m.spectators === 1);
    expect(ann.received.filter((m) => m.t === 'market')).toHaveLength(1);
    expect(ann.received.some((m) => m.t === 'tick' || m.t === 'candle')).toBe(false);
  });

  it('broadcasts rounded ticks only during TRADING and numbers candles consecutively across quarters', async () => {
    const s = await start();
    const config = s.sim.config;
    const ann = await open(s);
    await ann.join('player', 'Ann');
    const floor = await open(s);
    await floor.join('spectator');
    const { universe } = await ann.next('market');
    const ids = universe.symbols.map((x) => x.symbol).sort();

    ann.send({ t: 'start' });
    await ann.next('phase', (m) => m.phase === 'FINAL');
    await floor.next('phase', (m) => m.phase === 'FINAL');

    const { ticksPerCandle, daysPerQuarter } = config.time;
    const days = totalTradingDays(config);
    let phase: Phase = 'LOBBY';
    let quarter = 0;
    let expectedDay = 0;
    let expectedTickOfDay = 1;
    let ticks = 0;
    const candleDays: number[] = [];
    for (const msg of ann.received) {
      if (msg.t === 'phase') {
        // A phase never ends in the middle of a day.
        expect(expectedTickOfDay).toBe(1);
        phase = msg.phase;
        quarter = msg.quarter;
      } else if (msg.t === 'tick') {
        ticks += 1;
        expect(phase).toBe('TRADING');
        expect({ day: msg.day, tickOfDay: msg.tickOfDay }).toEqual({ day: expectedDay, tickOfDay: expectedTickOfDay });
        expect(Math.floor(msg.day / daysPerQuarter) + 1).toBe(quarter);
        expect(Object.keys(msg).sort()).toEqual(['day', 'prices', 't', 'tickOfDay']);
        expect(Object.keys(msg.prices).sort()).toEqual(ids);
        for (const id of ids) expect(isWirePrice(config, msg.prices[id])).toBe(true);
        expectedTickOfDay += 1;
      } else if (msg.t === 'candle') {
        // Right after the last tick of its day.
        expect(phase).toBe('TRADING');
        expect(expectedTickOfDay).toBe(ticksPerCandle + 1);
        expect(msg.day).toBe(expectedDay);
        expect(Object.keys(msg.ohlc).sort()).toEqual(ids);
        for (const id of ids) {
          const { o, h, l, c } = msg.ohlc[id]!;
          for (const price of [o, h, l, c]) expect(isWirePrice(config, price)).toBe(true);
          expect(h).toBeGreaterThanOrEqual(Math.max(o, c));
          expect(l).toBeLessThanOrEqual(Math.min(o, c));
        }
        candleDays.push(msg.day);
        expectedDay += 1;
        expectedTickOfDay = 1;
      }
    }
    expect(ticks).toBe(days * ticksPerCandle);
    expect(candleDays).toEqual(Array.from({ length: days }, (_, i) => i));

    // One shared stream: the projector got exactly the same market messages.
    const marketStream = (c: Client) => c.received.filter((m) => m.t === 'tick' || m.t === 'candle');
    expect(marketStream(floor)).toEqual(marketStream(ann));
  });

  it('gives a late spectator and a reconnecting player the same history as a client that never left', async () => {
    // Long days, so "join right after the first tick of a day" lands inside that day.
    const s = await start({ time: { ticksPerCandle: 10, daysPerQuarter: 4, quarters: 2 }, lobby: { maxSpectators: 3 } });
    const config = s.sim.config;
    const { daysPerQuarter } = config.time;
    const days = totalTradingDays(config);

    const ann = await open(s);
    await ann.join('player', 'Ann');
    const bob = await open(s);
    const bobWelcome = await bob.join('player', 'Bob');
    const lateFloor = await open(s);
    const bobAgain = await open(s);
    ann.send({ t: 'start' });

    /** Joins in the middle of a day and checks the snapshot against what Ann knew at that moment. */
    async function joinMidDay(client: Client, day: number, role: 'player' | 'spectator', token?: string): Promise<MarketMsg> {
      await ann.next('tick', (m) => m.day === day && m.tickOfDay === 1);
      await client.join(role, undefined, token);
      const snapshot = await client.next('market');
      const firstTick = await client.next('tick');
      // No gap and no overlap between the snapshot and the live stream.
      expect(snapshot.current).not.toBeNull();
      expect(snapshot.day).toBe(day);
      expect({ day: firstTick.day, tickOfDay: firstTick.tickOfDay }).toEqual({ day: snapshot.day, tickOfDay: snapshot.tickOfDay + 1 });
      await ann.next('tick', (m) => m.day === firstTick.day && m.tickOfDay === firstTick.tickOfDay);
      const { t: _t, universe, ...state } = snapshot;
      expect(state).toEqual(knownBefore(ann, firstTick));
      expect(universe).toEqual((ann.received[1] as MarketMsg).universe);
      for (const id in snapshot.candles) expect(snapshot.candles[id]).toHaveLength(4 * day);
      return snapshot;
    }

    // Quarter 1, day 1: the projector is switched on late. Bob's laptop goes away.
    await joinMidDay(lateFloor, 1, 'spectator');
    bob.close();

    // Quarter 2, second day: Bob comes back with his token and gets both quarters of history.
    await joinMidDay(bobAgain, daysPerQuarter + 1, 'player', bobWelcome.token);

    for (const client of [ann, lateFloor, bobAgain]) await client.next('phase', (m) => m.phase === 'FINAL');

    // After the game: a brand-new spectator gets the whole game in one snapshot.
    const afterwards = await open(s);
    await afterwards.join('spectator');
    const final = await afterwards.next('market');
    expect(final).toMatchObject({ day: days, tickOfDay: 0, current: null });
    expect(final.prices).toEqual(ann.received.filter((m): m is TickMsg => m.t === 'tick').at(-1)!.prices);

    const full = historyOf(ann);
    for (const id in full) expect(full[id]).toHaveLength(4 * days);
    expect(historyOf(lateFloor)).toEqual(full);
    expect(historyOf(bobAgain)).toEqual(full);
    expect(final.candles).toEqual(full);
  });

  it('sends a consistent snapshot between quarters, when no day is in progress', async () => {
    const s = await start({ time: { daysPerQuarter: 10 }, phaseMs: { RESULTS: 40 * TICK_MS } });
    const { daysPerQuarter } = s.sim.config.time;
    const ann = await open(s);
    await ann.join('player', 'Ann');
    const floor = await open(s);
    ann.send({ t: 'start' });
    await ann.next('phase', (m) => m.phase === 'RESULTS' && m.quarter === 1);
    const report = await ann.next('earnings');
    expect(report.quarter).toBe(1);
    expect(report.reports).toHaveLength(s.sim.getUniverse().companies.length);
    for (const row of report.reports) expect(Object.keys(row).sort()).toEqual(['surprise', 'symbol']);

    const welcome = await floor.join('spectator');
    expect(welcome.phase.phase).toBe('RESULTS');
    const snapshot = await floor.next('market');
    expect(snapshot).toMatchObject({ day: daysPerQuarter, tickOfDay: 0, current: null });
    for (const id in snapshot.candles) expect(snapshot.candles[id]).toHaveLength(4 * daysPerQuarter);
    // Prices are frozen at the last close.
    const lastClose = Object.fromEntries(Object.entries(snapshot.candles).map(([id, flat]) => [id, flat.at(-1)]));
    expect(snapshot.prices).toEqual(lastClose);
    expect(await floor.next('earnings')).toEqual(report);

    // The next quarter continues the day count right where the snapshot ends.
    const next = await floor.next('tick');
    expect({ day: next.day, tickOfDay: next.tickOfDay }).toEqual({ day: daysPerQuarter, tickOfDay: 1 });

    const reconnected = await open(s);
    const reopened = await reconnected.join('spectator', undefined, welcome.token);
    expect(reopened.phase).toMatchObject({ phase: 'TRADING', quarter: 2 });
    expect(await reconnected.next('earnings')).toEqual(report);
  });
});

describe('hostile input', () => {
  it('answers bad frames with bad_message and keeps serving', async () => {
    const s = await start();
    const client = await open(s);
    const frames: Array<string | Buffer> = [
      'not json',
      '{}',
      '[1,2,3]',
      'null',
      '{"t":"nope"}',
      '{"t":"join","role":"root"}',
      '{"t":"order","symbol":7,"qty":"lots"}',
      Buffer.from([0, 1, 2, 255]),
    ];
    for (const frame of frames) {
      client.sendRaw(frame);
      expect((await client.next('error')).code).toBe('bad_message');
    }
    client.send({ t: 'order', symbol: 'ACME', qty: 1 });
    expect((await client.next('error')).code).toBe('not_joined');

    const welcome = await client.join('player', 'Ann');
    expect(welcome.name).toBe('Ann');
    client.send({ t: 'join', role: 'player', name: 'Ann2' });
    expect((await client.next('error')).code).toBe('not_allowed');
  });

  it('drops frames over the per-second budget with one error, and recovers in the next second', async () => {
    const limit = 5;
    const s = await start({ time: { quarters: 50 }, net: { maxMessagesPerSecond: limit } });
    const ann = await open(s);
    await ann.join('player', 'Ann'); // frame 1
    const bob = await open(s);
    await bob.join('player', 'Bob');
    for (let i = 0; i < 50; i++) ann.send({ t: 'order', symbol: 'ACME', qty: 1 });
    await ann.next('error', (m) => m.code === 'rate_limited');
    await new Promise((r) => setTimeout(r, 1100));
    const errors = ann.received.filter((m) => m.t === 'error');
    expect(errors.filter((m) => m.code === 'rate_limited')).toHaveLength(1);
    expect(errors.filter((m) => m.code === 'rejected')).toHaveLength(limit - 1);
    expect(bob.received.some((m) => m.t === 'error')).toBe(false);

    ann.send({ t: 'start' });
    expect((await ann.next('phase')).phase).toBe('BRIEFING');
  });

  it('drops a connection that sends an oversized frame, without affecting others', async () => {
    const s = await start();
    const ann = await open(s);
    await ann.join('player', 'Ann');
    const bully = await open(s);
    bully.sendRaw(JSON.stringify({ t: 'join', role: 'player', name: 'x'.repeat(fastConfig.net.maxMessageBytes) }));
    expect(await bully.closed()).toBe(1009);

    ann.send({ t: 'start' });
    expect((await ann.next('phase')).phase).toBe('BRIEFING');
  });

  it('only accepts websockets on the configured path and answers the health probe', async () => {
    const s = await start();
    await expect(Client.open(s, '/elsewhere')).rejects.toThrow();
    const res = await fetch(`http://127.0.0.1:${s.port}${HEALTH_PATH}`);
    expect(await res.json()).toMatchObject({ ok: true, phase: 'LOBBY' });
    expect((await fetch(`http://127.0.0.1:${s.port}/`)).status).toBe(404);
  });
});

describe('trading', () => {
  it('streams each player’s equity to the projector and restores the full series for a late join', async () => {
    const s = await start({
      time: { ticksPerCandle: 5, daysPerQuarter: 20 },
      phaseMs: { SHOP: WAIT_MS },
      lobby: { maxSpectators: 2 },
    });
    const ann = await open(s);
    const { playerId: annId } = await ann.join('player', 'Ann');
    const bob = await open(s);
    const { playerId: bobId } = await bob.join('player', 'Bob');
    const floor = await open(s);
    const spectator = await floor.join('spectator');
    expect(await floor.next('net_worth')).toMatchObject({ reset: true, samples: [] });

    ann.send({ t: 'start', debugMode: true });
    const startingCash = s.sim.config.economy.startingCash;
    expect((await floor.next('net_worth')).samples).toEqual([{ tick: 0, equity: { [annId]: startingCash, [bobId]: startingCash } }]);
    await ann.next('phase', (m) => m.phase === 'TRADING');
    const symbol = s.sim.getUniverse().companies[0]!.symbol;
    ann.send({ t: 'order', symbol, qty: 10_000 });
    const live = await floor.next('net_worth', (m) => m.samples.at(-1)?.equity[annId] !== startingCash);
    expect(live.samples).toHaveLength(1);
    expect(live.samples.at(-1)!.equity[bobId]).toBe(startingCash);
    const next = await floor.next('net_worth');
    expect(next.samples.map((sample) => sample.tick)).toEqual([live.samples[0]!.tick + 1]);

    ann.send({ t: 'ready_up', phase: 'TRADING', quarter: 1 });
    const lastTick = s.sim.config.time.daysPerQuarter * s.sim.config.time.ticksPerCandle;
    // The close sends the quarter's results first (same tick, no earnings phase in between), then the last sample.
    const replay = await floor.next('results');
    const close = await floor.next('net_worth', (m) => m.samples.at(-1)?.tick === lastTick);
    expect(close.samples.length).toBeGreaterThan(1);
    const late = await open(s);
    await late.join('spectator');
    const history = await late.next('net_worth');
    expect(history.reset).toBe(true);
    expect(history.samples.map((sample) => sample.tick)).toEqual(Array.from({ length: lastTick + 1 }, (_, i) => i));
    expect(history.samples.slice(close.samples[0]!.tick, lastTick)).toEqual(close.samples.slice(0, -1));
    expect((await ann.next('results')).netWorthHistory).toEqual(replay.netWorthHistory);
    expect(replay.netWorthHistory?.map(({ tick }) => tick)).toEqual(history.samples.map(({ tick }) => tick));
    for (const { playerId, startEquity, endEquity } of replay.statements) {
      expect(replay.netWorthHistory?.[0]?.equity[playerId]).toBe(startEquity);
      expect(replay.netWorthHistory?.at(-1)?.equity[playerId]).toBe(endEquity);
    }
    const offer = (await bob.next('shop')).offers[0]!;
    bob.send({ t: 'buy_card', offerId: offer.offerId });
    const correction = await floor.next('net_worth', (m) => m.samples.at(-1)?.equity[bobId] === startingCash - offer.price);
    expect(correction.samples.map((sample) => sample.tick)).toEqual([lastTick]);
    expect((await late.next('net_worth', (m) => m.samples.at(-1)?.equity[bobId] === startingCash - offer.price)).samples)
      .toEqual(correction.samples);
    // A reconnect in Shop gets the frozen quarter close, even after a purchase changed live equity.
    const rejoined = await open(s);
    await rejoined.join('spectator', undefined, spectator.token);
    expect((await rejoined.next('results')).netWorthHistory).toEqual(replay.netWorthHistory);
    expect(ann.received.some((m) => m.t === 'net_worth')).toBe(false);
  });

  it('fills an order in TRADING, sends fill + portfolio to that player only, and restores the portfolio on reconnect', async () => {
    const s = await start({ time: { daysPerQuarter: 40, quarters: 2 } });
    const ann = await open(s);
    const welcome = await ann.join('player', 'Ann');
    const floor = await open(s);
    await floor.join('spectator');
    ann.send({ t: 'start' });
    const opening = await ann.next('portfolio');
    expect(opening).toMatchObject({ cash: defaultConfig.economy.startingCash, equity: defaultConfig.economy.startingCash, positions: [] });

    ann.send({ t: 'order', symbol: 'TG30', qty: 100 });
    expect((await ann.next('error')).message).toMatch(/closed/);

    await ann.next('phase', (m) => m.phase === 'TRADING');
    const symbol = s.sim.getUniverse().companies[0]!.symbol;
    ann.send({ t: 'order', symbol, qty: 1000.7 });
    const fill = await ann.next('fill');
    expect(fill).toMatchObject({ symbol, qty: 1000 });
    expect(isWirePrice(s.sim.config, fill.price)).toBe(true);
    const after = await ann.next('portfolio', (m) => m.positions.length === 1);
    expect(after.positions[0]).toMatchObject({ symbol, qty: 1000 });
    // Cash is booked at the unrounded fill price; the wire price is rounded to cents.
    expect(Math.abs(after.cash - (defaultConfig.economy.startingCash - 1000 * fill.price))).toBeLessThanOrEqual(1000 * 0.005 + 0.01);
    expect(floor.received.some((m) => m.t === 'fill' || m.t === 'portfolio')).toBe(false);

    ann.close();
    const back = await open(s);
    await back.join('player', undefined, welcome.token);
    const restored = await back.next('portfolio');
    expect(restored.positions).toEqual([expect.objectContaining({ symbol, qty: 1000 })]);
    back.send({ t: 'order', symbol, qty: -250, requestId: 42 });
    const sale = await back.next('fill');
    expect(sale).toMatchObject({ symbol, qty: -250, requestId: 42, realizedPnl: expect.any(Number) });
    const reduced = await back.next('portfolio', (m) => m.positions[0]?.qty === 750);
    expect(sale.realizedPnl).toBe(reduced.positions[0]!.realized);
  });
});

describe('play again', () => {
  it('starts a fresh game from FINAL with the connected players back in the lobby', async () => {
    const s = await start();
    const ann = await open(s);
    const annWelcome = await ann.join('player', 'Ann');
    expect(annWelcome.game).toBe(1);
    const bob = await open(s);
    const bobWelcome = await bob.join('player', 'Bob');
    const floor = await open(s);
    await floor.join('spectator');

    // Too early: only after the final results.
    ann.send({ t: 'new_game' });
    expect((await ann.next('error')).code).toBe('not_allowed');

    ann.send({ t: 'start' });
    await ann.next('phase', (m) => m.phase === 'FINAL');
    await ann.next('results', (m) => m.final === true);
    const oldUniverse = (await floor.next('market')).universe.symbols.map((x) => x.symbol).join();

    // Bob leaves: he loses his seat in the next game.
    bob.close();
    await ann.next('lobby', (m) => m.players.some((p) => p.name === 'Bob' && !p.connected));

    // A spectator cannot, a player can.
    floor.send({ t: 'new_game' });
    expect((await floor.next('error')).code).toBe('not_allowed');
    ann.send({ t: 'new_game' });

    const again = await ann.next('welcome', (m) => m.game === 2);
    expect(again.playerId).toBe(annWelcome.playerId);
    expect(again.token).toBe(annWelcome.token);
    expect(again.phase.phase).toBe('LOBBY');
    expect(again.lobby.players.map((p) => p.name)).toEqual(['Ann']);
    const market = await ann.next('market');
    expect(market.day).toBe(0);
    expect(Object.values(market.candles).every((c) => c.length === 0)).toBe(true);
    // Next seed: another universe.
    expect(market.universe.symbols.map((x) => x.symbol).join()).not.toBe(oldUniverse);
    expect((await floor.next('welcome', (m) => m.game === 2)).role).toBe('spectator');

    // Bob's old token no longer works mid-lobby as a seat; he joins again like anyone else.
    const bob2 = await open(s);
    const bobAgain = await bob2.join('player', 'Bob', bobWelcome.token);
    expect(bobAgain.game).toBe(2);
    expect(bobAgain.playerId).not.toBe(bobWelcome.playerId);

    // The new game plays: start, trade, through to its own FINAL.
    ann.send({ t: 'start' });
    await ann.next('phase', (m) => m.phase === 'BRIEFING' && m.quarter === 1);
    await ann.next('portfolio');
    const health = (await (await fetch(`http://127.0.0.1:${s.port}${HEALTH_PATH}`)).json()) as { game: number; players: number };
    expect(health).toMatchObject({ game: 2, players: 2 });
    await ann.next('phase', (m) => m.phase === 'FINAL');
  });
});
