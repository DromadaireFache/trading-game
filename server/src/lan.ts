/** LAN addresses and the URLs players type into their browser. */
import { networkInterfaces } from 'node:os';

type Interfaces = ReturnType<typeof networkInterfaces>;

/** Every non-internal IPv4 address of this machine. */
export function lanAddresses(interfaces: Interfaces = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const info of list ?? []) {
      // Node < 18.4 reports family as the number 4.
      const isV4 = info.family === 'IPv4' || (info.family as unknown) === 4;
      if (isV4 && !info.internal && !out.includes(info.address)) out.push(info.address);
    }
  }
  return out;
}

export interface LanUrls {
  host: string;
  play: string;
  floor: string;
}

export function lanUrls(clientPort: number, interfaces?: Interfaces): LanUrls[] {
  return lanAddresses(interfaces).map((host) => ({
    host,
    play: `http://${host}:${clientPort}/play`,
    floor: `http://${host}:${clientPort}/floor`,
  }));
}

/** The startup banner, one line per entry. */
export function startupLines(serverPort: number, clientPort: number, wsPath: string, interfaces?: Interfaces): string[] {
  const urls = lanUrls(clientPort, interfaces);
  const lines = [
    `[server] game server listening on port ${serverPort} (websocket path ${wsPath})`,
    `[server] this machine:  http://localhost:${clientPort}/play   projector: http://localhost:${clientPort}/floor`,
  ];
  if (urls.length === 0) {
    lines.push('[server] no LAN network interface found: other machines cannot connect until this one is on a network');
  }
  for (const url of urls) {
    lines.push(`[server] LAN players:   ${url.play}   projector: ${url.floor}`);
  }
  return lines;
}
