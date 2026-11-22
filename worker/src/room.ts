/**
 * One Durable Object per room code. It holds the whole game in memory (the same room as the LAN server,
 * server/src/room.ts) and the sockets of the players and the projector.
 *
 * - The game is only in memory and the sockets use the plain accept() API (not hibernation), so the
 *   object stays alive while anybody is connected and the 10 Hz clock is a plain setTimeout loop.
 *   No alarms: each one would count as a billed request.
 * - A room is created by a socket that asks for it (`create=1`; repeated within seconds while still empty, it
 *   joins the same room, so a retrying host works); anyone else asking for a code nobody
 *   created gets close code WS_CLOSE_NO_ROOM, so typos never spawn empty rooms.
 * - A room with nobody connected is dropped after IDLE_MS, and every room after MAX_AGE_MS.
 */
import { CLOSE_GOING_AWAY, createGameRoom } from '@tg/server/room';
import type { GameRoom } from '@tg/server/room';
import { WS_CLOSE_CODE_IN_USE, WS_CLOSE_NO_ROOM, defaultConfig, normalizeRoomCode } from '@tg/shared';
import { headlineTemplates } from './headlines.ts';

/** How long an empty room is kept, for a lost Wi-Fi or a reloaded tab. */
const IDLE_MS = 5 * 60_000;
/** No game runs longer than this, so a forgotten tab cannot keep an object (and its bill) alive. */
const MAX_AGE_MS = 8 * 60 * 60_000;
const CLOSE_TOO_BIG = 1009;
/** A create for a room that exists but is this young and still empty is the same host retrying. */
const CREATE_RETRY_MS = 15_000;

export class Room {
  private game: GameRoom | null = null;
  private readonly sockets = new Set<WebSocket>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private ageTimer: ReturnType<typeof setTimeout> | null = null;
  private createdAt = 0;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a websocket', { status: 426 });
    const url = new URL(request.url);
    const code = normalizeRoomCode(url.searchParams.get('room'));
    const create = url.searchParams.get('create') === '1';

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();

    if (code === null || (this.game === null && !create)) {
      server.close(WS_CLOSE_NO_ROOM, 'no game with that code');
    } else if (this.game !== null && create && !this.isFreshAndEmpty()) {
      server.close(WS_CLOSE_CODE_IN_USE, 'that code is taken');
    } else {
      if (this.game === null) this.open(code);
      this.attach(server);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private open(code: string): void {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    this.game = createGameRoom(
      { seed, config: defaultConfig },
      { headlines: headlineTemplates(), roomCode: code, log: (line) => console.log(`[${code}] ${line}`) },
    );
    this.createdAt = Date.now();
    this.ageTimer = setTimeout(() => this.stop(), MAX_AGE_MS);
    // Nobody may ever connect after the create: the idle timer covers that too.
    this.armIdle();
  }

  private isFreshAndEmpty(): boolean {
    return this.game !== null && this.game.health().players === 0 && Date.now() - this.createdAt < CREATE_RETRY_MS;
  }

  private attach(socket: WebSocket): void {
    this.sockets.add(socket);
    this.disarmIdle();
    socket.addEventListener('message', (event) => {
      const data = event.data;
      const binary = typeof data !== 'string';
      if (!binary && data.length > defaultConfig.net.maxMessageBytes) return void socket.close(CLOSE_TOO_BIG, 'message too large');
      this.game?.message(socket, binary ? '' : data, binary);
    });
    const gone = () => this.detach(socket);
    socket.addEventListener('close', gone);
    socket.addEventListener('error', gone);
  }

  private detach(socket: WebSocket): void {
    if (!this.sockets.delete(socket)) return;
    this.game?.closed(socket);
    if (this.sockets.size === 0) this.armIdle();
  }

  private armIdle(): void {
    this.disarmIdle();
    this.idleTimer = setTimeout(() => this.stop(), IDLE_MS);
  }

  private disarmIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /** Ends the game: stops the clock, closes the sockets. The object then has nothing left to do. */
  private stop(): void {
    this.disarmIdle();
    if (this.ageTimer !== null) clearTimeout(this.ageTimer);
    this.ageTimer = null;
    this.game?.shutdown();
    this.game = null;
    for (const socket of [...this.sockets]) {
      this.sockets.delete(socket);
      try {
        socket.close(CLOSE_GOING_AWAY, 'game ended');
      } catch {
        // already closed
      }
    }
  }
}
