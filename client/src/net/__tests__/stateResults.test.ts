import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '@tg/shared';
import { applyServerMsg, initialGameState } from '../state.ts';

const results: ServerMsg = {
  t: 'results',
  leaderboard: [{ rank: 1, playerId: 'p1', name: 'Ada', netWorth: 12e6, pnl: 2e6, eliminated: false, jailed: false }],
  statements: [],
  recap: { quarter: 1, topMoves: [], cardAuthors: [] },
  arrests: [],
};

describe('results and moments in the client state', () => {
  it('keeps the latest results', () => {
    const s = applyServerMsg(initialGameState, results, 1000);
    expect(s.results?.recap.quarter).toBe(1);
    expect(s.results?.leaderboard[0]!.name).toBe('Ada');
    const fin = applyServerMsg(s, { ...results, final: true, awards: [] } as ServerMsg, 2000);
    expect(fin.results?.final).toBe(true);
  });

  it('stamps a moment with its arrival time', () => {
    const s = applyServerMsg(initialGameState, { t: 'moment', kind: 'crash', text: 'MARKET CRASH' }, 5000);
    expect(s.moment).toEqual({ kind: 'crash', text: 'MARKET CRASH', at: 5000 });
  });
});

describe('play again', () => {
  const welcome = (game: number): ServerMsg =>
    ({
      t: 'welcome',
      playerId: 'p1',
      token: 'tok',
      role: 'player',
      name: 'Ada',
      phase: { phase: 'LOBBY', endsAt: null, quarter: 0, totalQuarters: 8, serverTime: 0 },
      lobby: { players: [], spectators: 0, minPlayers: 1, maxPlayers: 4, settings: { quarters: 4, quarterSeconds: 90 } },
      config: initialGameState.config,
      game,
    }) as ServerMsg;

  it('a welcome for another game drops the old game; a reconnect to the same game keeps it', () => {
    let s = applyServerMsg(initialGameState, welcome(1), 0);
    s = applyServerMsg(s, results, 1);
    s = applyServerMsg(s, { t: 'moment', kind: 'crash', text: 'x' }, 2);
    const reconnect = applyServerMsg(s, welcome(1), 3);
    expect(reconnect.results).not.toBeNull();
    const again = applyServerMsg(s, welcome(2), 4);
    expect(again.game).toBe(2);
    expect(again.results).toBeNull();
    expect(again.moment).toBeNull();
    expect(again.headlines).toEqual([]);
    expect(again.me?.playerId).toBe('p1');
  });
});
