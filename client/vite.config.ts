import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
// Relative import on purpose: Vite bundles relative imports into the config, package imports it does not.
import { defaultConfig } from '../shared/config.ts';

// Same env vars as the server shell (see server/src/env.ts):
//   PORT            game server port, target of the /ws proxy
//   TG_CLIENT_PORT  port of this dev server
const serverPort = Number(process.env.PORT) || defaultConfig.net.serverPort;
const clientPort = Number(process.env.TG_CLIENT_PORT) || defaultConfig.net.clientPort;
const wsPath = defaultConfig.net.wsPath;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: clientPort,
    strictPort: true,
    proxy: {
      [wsPath]: { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: clientPort,
    strictPort: true,
    proxy: {
      [wsPath]: { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
});
