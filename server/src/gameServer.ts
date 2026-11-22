/**
 * The LAN game server: node http + `ws` around one game room (./room.ts). It owns the listening port,
 * the /health probe and the websocket upgrade; the room owns everything about the game.
 */
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { ServerEnv } from './env.ts';
import { loadHeadlineTemplates } from './headlineCatalog.ts';
import { lanUrls } from './lan.ts';
import { CLOSE_GOING_AWAY, CLOSE_REPLACED, createGameRoom } from './room.ts';
import type { Sim } from './sim/index.ts';

export { CLOSE_REPLACED };
/** Liveness probe for tooling (e2e waits for it). Not part of the game protocol. */
export const HEALTH_PATH = '/health';

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

export function startGameServer(env: ServerEnv, options: GameServerOptions = {}): Promise<GameServer> {
  const log = options.log ?? ((line: string) => console.log(line));
  const room = createGameRoom(env, {
    headlines: loadHeadlineTemplates(env.headlinesPath),
    now: options.now,
    log,
    joinUrls: () => lanUrls(env.clientPort).map((u) => u.play),
  });
  const { config } = env;

  const http: HttpServer = createServer((req, res) => {
    if (req.url === HEALTH_PATH) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(room.health()));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('trading-game server: connect with a websocket, the web client is served by Vite\n');
  });

  const wss = new WebSocketServer({ server: http, path: config.net.wsPath, maxPayload: config.net.maxMessageBytes });
  wss.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => room.message(socket, isBinary ? '' : data.toString(), isBinary));
    socket.on('close', () => room.closed(socket));
    // Oversized frames and protocol violations land here; ws closes the socket itself.
    socket.on('error', () => {});
  });
  wss.on('error', () => {
    // Listen errors are reported through the http server below.
  });

  function close(): Promise<void> {
    room.shutdown();
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
      room.shutdown();
      reject(error);
    });
    http.listen(env.port, options.host, () => {
      resolve({
        port: (http.address() as AddressInfo).port,
        // A getter: "play again" swaps the sim.
        get sim() {
          return room.sim;
        },
        close,
      });
    });
  });
}
