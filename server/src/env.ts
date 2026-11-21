/**
 * Server-shell settings from the environment. The ONLY place env vars are read on the server;
 * the sim never sees env, it gets the resulting GameConfig object.
 *
 *   PORT             game server port            (default config.net.serverPort = 8787)
 *   TG_CLIENT_PORT   Vite port, for the LAN URLs (default config.net.clientPort = 5173)
 *   TG_SEED          sim seed, integer           (default: derived from the clock at startup)
 *   TG_PHASE_SCALE   e.g. 0.1 = phases ten times shorter (scalePhaseLengths)
 *   TG_CONFIG        JSON DeepPartial<GameConfig>, deep-merged last, e.g. {"time":{"quarters":2}}
 */
import { defaultConfig, mergeConfig, scalePhaseLengths } from '@tg/shared';
import type { DeepPartial, GameConfig } from '@tg/shared';

export interface ServerEnv {
  port: number;
  clientPort: number;
  seed: number;
  config: GameConfig;
}

type EnvVars = Record<string, string | undefined>;

/** `net` settings that Vite and the browser read from the defaults, so TG_CONFIG must not move them. */
const ENV_ONLY_NET_KEYS = ['serverPort', 'clientPort', 'wsPath'] as const;

function intVar(env: EnvVars, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return n;
}

/** Throws with a readable message on malformed values (fail fast at startup, never mid-game). */
export function loadServerEnv(env: EnvVars = process.env, now: number = Date.now()): ServerEnv {
  let config = defaultConfig;

  const scaleRaw = env.TG_PHASE_SCALE;
  if (scaleRaw !== undefined && scaleRaw !== '') {
    const scale = Number(scaleRaw);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error(`TG_PHASE_SCALE must be a positive number, got "${scaleRaw}"`);
    config = scalePhaseLengths(config, scale);
  }

  const jsonRaw = env.TG_CONFIG;
  if (jsonRaw !== undefined && jsonRaw !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonRaw);
    } catch {
      throw new Error('TG_CONFIG must be valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('TG_CONFIG must be a JSON object');
    // Vite (the /ws proxy) and the browser use the default ports and path; only PORT and
    // TG_CLIENT_PORT reach all three processes, so moving these through TG_CONFIG would split them.
    const net = (parsed as { net?: unknown }).net;
    if (typeof net === 'object' && net !== null) {
      for (const key of ENV_ONLY_NET_KEYS) {
        if (key in net) throw new Error(`TG_CONFIG cannot set net.${key}: use PORT / TG_CLIENT_PORT (net.wsPath is fixed)`);
      }
    }
    try {
      config = mergeConfig(config, parsed as DeepPartial<GameConfig>);
    } catch (error) {
      throw new Error(`TG_CONFIG: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    port: intVar(env, 'PORT', config.net.serverPort),
    clientPort: intVar(env, 'TG_CLIENT_PORT', config.net.clientPort),
    seed: intVar(env, 'TG_SEED', now >>> 0),
    config,
  };
}
