/**
 * Shell tests over real websockets on a free port, with phases a few ticks long.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { QUARTER_PHASES, defaultConfig, mergeConfig, phaseTicks, quarterTicks } from '@tg/shared';
import type { DeepPartial, GameConfig, MsgOf, ServerMsg, ServerMsgType } from '@tg/shared';
import { CLOSE_REPLACED, HEALTH_PATH, startGameServer } from '../gameServer.ts';
import type { GameServer } from '../gameServer.ts';

const TICK_MS = 20;
const WAIT_MS = 5_000;

const fastConfig: GameConfig = mergeConfig(defaultConfig, {
  time: { tickMs: TICK_MS, ticksPerCandle: 2, daysPerQuarter: 3, quarters: 2 },
  phaseMs: { BRIEFING: 3 * TICK_MS, EARNINGS: 2 * TICK_MS, RESULTS: 3 * TICK_MS, SHOP: 2 * TICK_MS },
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

    const expected = [1, 2].flatMap((quarter) => QUARTER_PHASES.map((phase) => ({ phase, quarter })));
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
    const gameMs = quarterTicks(s.sim.config) * 2 * TICK_MS;
    expect(elapsed).toBeGreaterThanOrEqual(gameMs - TICK_MS);
    expect(elapsed).toBeLessThan(gameMs + 25 * TICK_MS);

    // The projector saw the same thing.
    const floorPhases: string[] = [];
    for (let i = 0; i < expected.length + 1; i++) floorPhases.push((await floor.next('phase')).phase);
    expect(floorPhases).toEqual(seen.map((m) => m.phase));
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
