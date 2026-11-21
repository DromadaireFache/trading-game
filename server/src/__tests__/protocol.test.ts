import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@tg/shared';
import { lanAddresses, lanUrls, startupLines } from '../lan.ts';
import { cleanName, nameKey, parseClientMsg } from '../protocol.ts';

describe('parseClientMsg', () => {
  it('accepts every client message and drops unknown fields', () => {
    expect(parseClientMsg('{"t":"join","role":"player","name":"Ann","admin":true}')).toEqual({
      ok: true,
      msg: { t: 'join', role: 'player', name: 'Ann', token: undefined },
    });
    expect(parseClientMsg('{"t":"join","role":"spectator"}').ok).toBe(true);
    expect(parseClientMsg('{"t":"start"}')).toEqual({ ok: true, msg: { t: 'start' } });
    expect(parseClientMsg('{"t":"start","debugMode":true}')).toEqual({ ok: true, msg: { t: 'start', debugMode: true } });
    expect(parseClientMsg('{"t":"order","symbol":"ACME","qty":-5}')).toEqual({ ok: true, msg: { t: 'order', symbol: 'ACME', qty: -5 } });
    expect(parseClientMsg('{"t":"buy_card","offerId":"o1"}').ok).toBe(true);
    expect(parseClientMsg('{"t":"ready_up","quarter":1,"phase":"RESULTS"}')).toEqual({ ok: true, msg: { t: 'ready_up', quarter: 1, phase: 'RESULTS' } });
    expect(parseClientMsg('{"t":"ready_up","quarter":1}')).toEqual({ ok: true, msg: { t: 'ready_up', quarter: 1, phase: 'SHOP' } });
    expect(parseClientMsg('{"t":"play_card","cardId":"c1","target":"tech","direction":"down"}').ok).toBe(true);
  });

  it('rejects garbage without throwing', () => {
    const garbage = [
      '',
      'hello',
      'null',
      '42',
      '[]',
      '"join"',
      '{}',
      '{"t":5}',
      '{"t":"nope"}',
      '{"t":"__proto__"}',
      '{"t":"join"}',
      '{"t":"join","role":"admin"}',
      '{"t":"join","role":"player","name":5}',
      '{"t":"join","role":"player","token":{}}',
      '{"t":"order","symbol":"","qty":1}',
      '{"t":"order","symbol":"ACME","qty":"1"}',
      '{"t":"order","symbol":"ACME","qty":0}',
      '{"t":"order","symbol":"ACME","qty":1e999}',
      '{"t":"order","symbol":"ACME","qty":null}',
      '{"t":"buy_card"}',
      '{"t":"start","debugMode":"true"}',
      '{"t":"ready_up"}',
      '{"t":"ready_up","quarter":1.5}',
      '{"t":"ready_up","quarter":1,"phase":"EARNINGS"}',
      '{"t":"play_card","cardId":"c1","direction":"sideways"}',
      '{"t":"play_card","cardId":"c1","target":7}',
      '{"t":"join","role":"player"',
    ];
    for (const text of garbage) {
      const result = parseClientMsg(text);
      expect(result.ok, text).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

describe('cleanName', () => {
  it('trims, collapses whitespace and strips control characters', () => {
    expect(cleanName('  Ann   Lee \n', defaultConfig)).toBe('Ann Lee');
    expect(cleanName('A' + String.fromCharCode(0) + 'n' + String.fromCharCode(0x200b) + 'n', defaultConfig)).toBe('A n n');
  });

  it('enforces the configured length', () => {
    expect(cleanName(undefined, defaultConfig)).toBeNull();
    expect(cleanName('   ', defaultConfig)).toBeNull();
    expect(cleanName('x'.repeat(defaultConfig.lobby.nameMaxLength), defaultConfig)).not.toBeNull();
    expect(cleanName('x'.repeat(defaultConfig.lobby.nameMaxLength + 1), defaultConfig)).toBeNull();
  });

  it('compares names ignoring case', () => {
    expect(nameKey('ANN')).toBe(nameKey('ann'));
  });
});

describe('LAN urls', () => {
  const interfaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    wifi: [
      { address: 'fe80::1', family: 'IPv6', internal: false },
      { address: '192.168.1.20', family: 'IPv4', internal: false },
    ],
    eth: [{ address: '10.0.0.5', family: 'IPv4', internal: false }],
  } as unknown as NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>;

  it('lists every non-internal IPv4 address', () => {
    expect(lanAddresses(interfaces)).toEqual(['192.168.1.20', '10.0.0.5']);
    expect(lanUrls(5173, interfaces)).toEqual([
      { host: '192.168.1.20', play: 'http://192.168.1.20:5173/play', floor: 'http://192.168.1.20:5173/floor' },
      { host: '10.0.0.5', play: 'http://10.0.0.5:5173/play', floor: 'http://10.0.0.5:5173/floor' },
    ]);
  });

  it('prints /play and /floor for each of them', () => {
    const text = startupLines(8787, 5173, '/ws', interfaces).join('\n');
    expect(text).toContain('http://192.168.1.20:5173/play');
    expect(text).toContain('http://192.168.1.20:5173/floor');
    expect(text).toContain('http://10.0.0.5:5173/play');
    expect(text).toContain('http://10.0.0.5:5173/floor');
    expect(startupLines(8787, 5173, '/ws', {}).join('\n')).toContain('no LAN network interface');
  });
});
