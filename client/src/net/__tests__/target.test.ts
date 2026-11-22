import { describe, expect, it } from 'vitest';
import { ONLINE_HOST, loadMode, onlinePageHost, onlineWsUrl, saveMode } from '../target.ts';

describe('online target (default build)', () => {
  it('connects the LAN build to the online host over wss', () => {
    expect(onlineWsUrl('ABCD', false, { protocol: 'http:', host: '192.168.1.5:5173' })).toBe(`wss://${ONLINE_HOST}/ws?room=ABCD`);
    expect(onlineWsUrl('ABCD', true, { protocol: 'http:', host: 'x' })).toBe(`wss://${ONLINE_HOST}/ws?room=ABCD&create=1`);
    expect(onlinePageHost({ host: '192.168.1.5:5173' })).toBe(ONLINE_HOST);
  });

  it('remembers the mode per tab and defaults to the LAN', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
    expect(loadMode(storage)).toBe('lan');
    saveMode(storage, 'online');
    expect(loadMode(storage)).toBe('online');
    expect(loadMode(null)).toBe('lan');
  });
});
