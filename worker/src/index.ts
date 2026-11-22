/**
 * Entry point of the online game. The page itself is served from static assets (see wrangler.jsonc), so
 * this only sees the websocket (`/ws?room=ABCD[&create=1]`), which it hands to that room's Durable Object,
 * and a liveness probe.
 */
import { WS_CLOSE_NO_ROOM, defaultConfig, normalizeRoomCode } from '@tg/shared';
import type { Env } from './env.ts';

export { Room } from './room.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === defaultConfig.net.wsPath) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a websocket', { status: 426 });
      const code = normalizeRoomCode(url.searchParams.get('room'));
      if (code === null) {
        // A browser cannot read an HTTP error of a failed upgrade, so say it with a close code.
        const pair = new WebSocketPair();
        pair[1].accept();
        pair[1].close(WS_CLOSE_NO_ROOM, 'not a room code');
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }

    if (url.pathname === '/health') return Response.json({ ok: true });
    return env.ASSETS.fetch(request);
  },
};
