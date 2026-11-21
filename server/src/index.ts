/**
 * Game server entry point (`npm run dev -w @tg/server`, or `npm run dev` at the root).
 * Reads the environment, starts the ws shell (./gameServer.ts) and prints where to connect.
 */
import { loadServerEnv } from './env.ts';
import type { ServerEnv } from './env.ts';
import { startGameServer } from './gameServer.ts';
import { startupLines } from './lan.ts';

function fail(message: string): never {
  console.error(`[server] ${message}`);
  process.exit(1);
}

let env: ServerEnv;
try {
  env = loadServerEnv();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

try {
  const server = await startGameServer(env);
  const { config } = env;
  for (const line of startupLines(server.port, env.clientPort, config.net.wsPath)) console.log(line);
  console.log(
    `[server] seed ${env.seed}, ${config.time.quarters} quarters, ${config.lobby.minPlayers}-${config.lobby.maxPlayers} players, tick ${config.time.tickMs} ms`,
  );

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') fail(`port ${env.port} is already in use: stop the other server or set PORT`);
  fail(error instanceof Error ? error.message : String(error));
}
