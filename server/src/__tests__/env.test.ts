import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@tg/shared';
import { loadServerEnv } from '../env.ts';

describe('loadServerEnv', () => {
  it('uses the defaults with an empty environment', () => {
    const env = loadServerEnv({}, 1234);
    expect(env).toMatchObject({ port: defaultConfig.net.serverPort, clientPort: defaultConfig.net.clientPort, seed: 1234 });
    expect(env.config).toEqual(defaultConfig);
  });

  it('applies PORT, TG_CLIENT_PORT, TG_SEED, TG_PHASE_SCALE and TG_CONFIG', () => {
    const env = loadServerEnv({
      PORT: '9000',
      TG_CLIENT_PORT: '9001',
      TG_SEED: '7',
      TG_PHASE_SCALE: '0.1',
      TG_CONFIG: '{"time":{"quarters":2},"lobby":{"minPlayers":2}}',
    });
    expect(env).toMatchObject({ port: 9000, clientPort: 9001, seed: 7 });
    expect(env.config.time).toMatchObject({ quarters: 2, daysPerQuarter: 9 });
    expect(env.config.lobby.minPlayers).toBe(2);
  });

  it('fails fast with a readable message on values that would break the game', () => {
    const bad: Array<[Record<string, string>, string]> = [
      [{ TG_CONFIG: '{"time":{"tickMs":0}}' }, 'time.tickMs'],
      [{ TG_CONFIG: '{"time":{"daysPerQuarter":-1}}' }, 'time.daysPerQuarter'],
      [{ TG_CONFIG: '{"time":{"quarters":"x"}}' }, 'time.quarters'],
      [{ TG_CONFIG: '{"phaseMs":null}' }, 'phaseMs'],
      [{ TG_CONFIG: '{"lobby":{"maxPlayers":null}}' }, 'lobby.maxPlayers'],
      [{ TG_CONFIG: '{"net":{"serverPort":9999}}' }, 'net.serverPort'],
      [{ TG_CONFIG: '{"net":{"wsPath":"/game"}}' }, 'net.wsPath'],
      [{ TG_CONFIG: 'not json' }, 'valid JSON'],
      [{ TG_CONFIG: '[1]' }, 'JSON object'],
      [{ TG_PHASE_SCALE: '0' }, 'TG_PHASE_SCALE'],
      [{ PORT: 'abc' }, 'PORT'],
    ];
    for (const [vars, where] of bad) expect(() => loadServerEnv(vars), JSON.stringify(vars)).toThrow(where);
  });
});
