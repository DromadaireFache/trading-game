import { describe, expect, it, vi } from 'vitest';
import { defaultConfig, mergeConfig } from '@tg/shared';
import type { MarketMsg, OHLC, ServerMsg, SymbolInfo } from '@tg/shared';
import { GameClient } from '../gameClient.ts';
import type { SocketLike } from '../gameClient.ts';
import { MarketStore, quoteChange } from '../marketStore.ts';
import type { FeedEvent } from '../marketStore.ts';
import type { SessionStorageLike } from '../session.ts';

/** 3 days per quarter keeps the quarter arithmetic readable. */
const config = mergeConfig(defaultConfig, { time: { daysPerQuarter: 3 } });

const symbols: SymbolInfo[] = [
  { symbol: 'TG50', name: 'Index', kind: 'index', marketCap: 100, members: ['AAA', 'BBB'] },
  { symbol: 'AAA', name: 'Aaa Systems', kind: 'stock', sector: 'tech', marketCap: 60, ceo: 'A' },
  { symbol: 'BBB', name: 'Bbb Energy', kind: 'stock', sector: 'energy', marketCap: 40, ceo: 'B' },
];
const flat = (...candles: OHLC[]) => candles.flatMap((c) => [c.o, c.h, c.l, c.c]);
const bar = (o: number, h: number, l: number, c: number): OHLC => ({ o, h, l, c });

function snapshot(over: Partial<MarketMsg> = {}): MarketMsg {
  return {
    t: 'market',
    universe: { symbols },
    day: 0,
    tickOfDay: 0,
    prices: { TG50: 100, AAA: 50, BBB: 20 },
    candles: { TG50: [], AAA: [], BBB: [] },
    current: null,
    ...over,
  };
}

function memoryStorage(): SessionStorageLike {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function store(storage: SessionStorageLike | null = null) {
  const market = new MarketStore(storage);
  market.setConfig(config);
  return market;
}

describe('MarketStore', () => {
  it('starts empty and takes universe, prices and selection from the snapshot', () => {
    const market = store();
    expect(market.getSymbols()).toEqual([]);
    expect(market.getSelected()).toBeNull();
    expect(market.getLastDay()).toBe(-1);

    market.apply(snapshot());
    expect(market.getSymbols().map((s) => s.symbol)).toEqual(['TG50', 'AAA', 'BBB']);
    expect(market.getSelected()).toBe('TG50');
    expect(market.getInfo('AAA')?.name).toBe('Aaa Systems');
    // No candle yet: the reference is the price itself, so the change is 0.
    expect(market.getQuote('AAA')).toEqual({ price: 50, ref: 50 });
    expect(market.getLastDay()).toBe(-1);
  });

  it('builds the live candle from ticks and replaces it with the server candle', () => {
    const market = store();
    market.apply(snapshot());
    market.apply({ t: 'tick', day: 0, tickOfDay: 1, prices: { TG50: 100, AAA: 51, BBB: 20 } });
    market.apply({ t: 'tick', day: 0, tickOfDay: 2, prices: { TG50: 100, AAA: 49, BBB: 20 } });
    market.apply({ t: 'tick', day: 0, tickOfDay: 3, prices: { TG50: 100, AAA: 50.5, BBB: 20 } });
    expect(market.getLiveCandle('AAA')).toEqual({ day: 0, candle: bar(51, 51, 49, 50.5) });
    expect(market.getLastDay()).toBe(0);
    expect(market.getClosedCandles('AAA')).toEqual([]);

    // The server's candle wins, even where it differs from what the ticks suggested.
    market.apply({ t: 'candle', day: 0, ohlc: { TG50: bar(100, 100, 100, 100), AAA: bar(51, 52, 49, 50.5), BBB: bar(20, 20, 20, 20) } });
    expect(market.getLiveCandle('AAA')).toBeNull();
    expect(market.getClosedCandles('AAA')).toEqual([51, 52, 49, 50.5]);
    expect(market.getLastDay()).toBe(0);

    market.apply({ t: 'tick', day: 1, tickOfDay: 1, prices: { TG50: 101, AAA: 53, BBB: 20 } });
    expect(market.getLiveCandle('AAA')).toEqual({ day: 1, candle: bar(53, 53, 53, 53) });
    expect(market.getLastDay()).toBe(1);
  });

  it('measures the change from the open of the quarter, across the live day, closed days and quarters', () => {
    const market = store();
    market.apply(snapshot());

    // Day 0 in progress: reference = open of the live candle.
    market.apply({ t: 'tick', day: 0, tickOfDay: 1, prices: { AAA: 50 } });
    market.apply({ t: 'tick', day: 0, tickOfDay: 2, prices: { AAA: 55 } });
    expect(market.getQuote('AAA')).toEqual({ price: 55, ref: 50 });
    expect(quoteChange(market.getQuote('AAA')!)).toBeCloseTo(0.1);

    // Days 0..2 close (quarter 1 = days 0..2): still measured from day 0's open, also after the close.
    market.apply({ t: 'candle', day: 0, ohlc: { AAA: bar(50, 55, 50, 55) } });
    for (const day of [1, 2]) {
      market.apply({ t: 'tick', day, tickOfDay: 1, prices: { AAA: 60 } });
      market.apply({ t: 'candle', day, ohlc: { AAA: bar(60, 60, 60, 60) } });
    }
    expect(market.getQuote('AAA')).toEqual({ price: 60, ref: 50 });

    // First tick of quarter 2 (day 3): the reference moves to that day's open.
    market.apply({ t: 'tick', day: 3, tickOfDay: 1, prices: { AAA: 66 } });
    expect(market.getQuote('AAA')).toEqual({ price: 66, ref: 66 });
    market.apply({ t: 'tick', day: 3, tickOfDay: 2, prices: { AAA: 33 } });
    expect(quoteChange(market.getQuote('AAA')!)).toBeCloseTo(-0.5);
  });

  it('restores history, the partial day and the quarter reference from a mid-game snapshot', () => {
    const market = store();
    // Day 4 (quarter 2, second day) is in progress.
    market.apply(
      snapshot({
        day: 4,
        tickOfDay: 2,
        prices: { TG50: 100, AAA: 72, BBB: 20 },
        candles: {
          TG50: flat(bar(100, 100, 100, 100), bar(100, 100, 100, 100), bar(100, 100, 100, 100), bar(100, 100, 100, 100)),
          AAA: flat(bar(50, 55, 50, 55), bar(55, 60, 55, 60), bar(60, 61, 59, 60), bar(64, 70, 64, 70)),
          BBB: flat(bar(20, 20, 20, 20), bar(20, 20, 20, 20), bar(20, 20, 20, 20), bar(20, 20, 20, 20)),
        },
        current: { TG50: bar(100, 100, 100, 100), AAA: bar(70, 73, 70, 72), BBB: bar(20, 20, 20, 20) },
      }),
    );
    expect(market.getLastDay()).toBe(4);
    expect(market.getClosedCandles('AAA')).toHaveLength(16);
    expect(market.getLiveCandle('AAA')).toEqual({ day: 4, candle: bar(70, 73, 70, 72) });
    // Quarter 2 opened on day 3 at 64.
    expect(market.getQuote('AAA')).toEqual({ price: 72, ref: 64 });

    // The live stream continues the partial candle.
    market.apply({ t: 'tick', day: 4, tickOfDay: 3, prices: { AAA: 75 } });
    expect(market.getLiveCandle('AAA')?.candle).toEqual(bar(70, 75, 70, 75));

    // A later snapshot (reconnect) replaces everything, including a stale live candle.
    market.apply(
      snapshot({ day: 1, candles: { TG50: flat(bar(1, 1, 1, 1)), AAA: flat(bar(40, 50, 40, 50)), BBB: flat(bar(2, 2, 2, 2)) } }),
    );
    expect(market.getLiveCandle('AAA')).toBeNull();
    expect(market.getLastDay()).toBe(0);
    expect(market.getQuote('AAA')).toEqual({ price: 50, ref: 40 });
  });

  it('keeps the quarter that just ended as the reference between quarters', () => {
    const market = store();
    // RESULTS after quarter 1: three closed days, nothing in progress.
    market.apply(
      snapshot({
        day: 3,
        prices: { TG50: 100, AAA: 60, BBB: 20 },
        candles: { TG50: [], AAA: flat(bar(50, 55, 50, 55), bar(55, 60, 55, 60), bar(60, 61, 59, 60)), BBB: [] },
      }),
    );
    expect(market.getQuote('AAA')).toEqual({ price: 60, ref: 50 });
  });

  it('notifies only the listeners of symbols whose quote changed', () => {
    const market = store();
    market.apply(snapshot());
    const onAaa = vi.fn();
    const onBbb = vi.fn();
    const onUniverse = vi.fn();
    const offAaa = market.subscribeSymbol('AAA', onAaa);
    market.subscribeSymbol('BBB', onBbb);
    market.subscribeUniverse(onUniverse);

    const before = market.getQuote('BBB');
    market.apply({ t: 'tick', day: 0, tickOfDay: 1, prices: { TG50: 100, AAA: 50, BBB: 20 } });
    // Same prices, and the reference (day 0 open) equals them: nothing to tell anybody.
    expect(onAaa).not.toHaveBeenCalled();
    expect(onBbb).not.toHaveBeenCalled();

    market.apply({ t: 'tick', day: 0, tickOfDay: 2, prices: { TG50: 100, AAA: 51, BBB: 20 } });
    expect(onAaa).toHaveBeenCalledTimes(1);
    expect(onBbb).not.toHaveBeenCalled();
    expect(market.getQuote('BBB')).toBe(before); // same object: useSyncExternalStore will not re-render
    expect(onUniverse).not.toHaveBeenCalled();

    offAaa();
    market.apply({ t: 'tick', day: 0, tickOfDay: 3, prices: { TG50: 100, AAA: 52, BBB: 21 } });
    expect(onAaa).toHaveBeenCalledTimes(1);
    expect(onBbb).toHaveBeenCalledTimes(1);
  });

  it('feeds charts with reset, tick and candle events', () => {
    const market = store();
    const events: FeedEvent[] = [];
    market.subscribeFeed((e) => events.push(e));
    market.apply(snapshot());
    market.apply({ t: 'tick', day: 0, tickOfDay: 1, prices: { AAA: 51 } });
    market.apply({ t: 'candle', day: 0, ohlc: { AAA: bar(51, 51, 51, 51) } });
    expect(events).toEqual([{ kind: 'reset' }, { kind: 'tick', day: 0 }, { kind: 'candle', day: 0 }]);
  });

  it('keeps index == day when a candle is missed', () => {
    const market = store();
    market.apply(snapshot());
    market.apply({ t: 'candle', day: 0, ohlc: { AAA: bar(50, 51, 49, 51) } });
    market.apply({ t: 'candle', day: 2, ohlc: { AAA: bar(60, 61, 59, 60) } });
    expect(market.getClosedCandles('AAA')).toEqual([50, 51, 49, 51, 51, 51, 51, 51, 60, 61, 59, 60]);
    expect(market.getLastDay()).toBe(2);
  });

  it('ignores a stale tick for the candle but not for the price', () => {
    const market = store();
    market.apply(snapshot({ day: 1, candles: { TG50: [], AAA: flat(bar(50, 50, 50, 50)), BBB: [] } }));
    market.apply({ t: 'tick', day: 0, tickOfDay: 10, prices: { AAA: 55 } });
    expect(market.getLiveCandle('AAA')).toBeNull();
    expect(market.getQuote('AAA')?.price).toBe(55);
  });

  it('selects only known symbols and remembers the selection across a refresh', () => {
    const storage = memoryStorage();
    const market = store(storage);
    market.apply(snapshot());
    const onSelection = vi.fn();
    market.subscribeSelection(onSelection);

    market.select('NOPE');
    expect(market.getSelected()).toBe('TG50');
    market.select('BBB');
    expect(market.getSelected()).toBe('BBB');
    expect(onSelection).toHaveBeenCalledTimes(1);

    // A reconnect snapshot keeps the selection.
    market.apply(snapshot());
    expect(market.getSelected()).toBe('BBB');

    // A page refresh = a new store on the same sessionStorage.
    const reloaded = store(storage);
    reloaded.apply(snapshot());
    expect(reloaded.getSelected()).toBe('BBB');
  });
});

describe('GameClient market wiring', () => {
  it('feeds market, tick and candle into client.market without touching the React state', () => {
    const sockets: SocketLike[] = [];
    const client = new GameClient({
      role: 'spectator',
      url: 'ws://test/ws',
      storage: memoryStorage(),
      now: () => 0,
      createSocket: () => {
        const socket: SocketLike = { onopen: null, onmessage: null, onclose: null, onerror: null, send() {}, close() {} };
        sockets.push(socket);
        return socket;
      },
    });
    const receive = (msg: ServerMsg) => sockets[0]!.onmessage?.({ data: JSON.stringify(msg) });
    client.start();
    sockets[0]!.onopen?.({});
    receive({
      t: 'welcome',
      playerId: 's1',
      token: 'tok',
      role: 'spectator',
      name: 'Spectator',
      phase: { phase: 'TRADING', endsAt: 1000, quarter: 1, totalQuarters: 8, serverTime: 0 },
      lobby: { players: [], spectators: 1, minPlayers: 1, maxPlayers: 4 },
      config,
    });
    expect(client.market.getConfig()).toEqual(config);

    receive(snapshot());
    const state = client.getState();
    const onState = vi.fn();
    client.subscribe(onState);
    receive({ t: 'tick', day: 0, tickOfDay: 1, prices: { TG50: 100, AAA: 51, BBB: 20 } });
    receive({ t: 'candle', day: 0, ohlc: { AAA: bar(51, 51, 51, 51) } });

    expect(client.market.getQuote('AAA')?.price).toBe(51);
    expect(client.market.getClosedCandles('AAA')).toEqual([51, 51, 51, 51]);
    expect(client.getState()).toBe(state);
    expect(onState).not.toHaveBeenCalled();
    client.stop();
  });
});
