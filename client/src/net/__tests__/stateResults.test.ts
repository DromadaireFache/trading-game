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
