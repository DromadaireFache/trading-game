/** Display text per phase. Colors come from the theme through CSS (.phase--<PHASE> classes). */
import type { Phase } from '@tg/shared';

export const PHASE_LABEL: Record<Phase, string> = {
  LOBBY: 'Lobby',
  BRIEFING: 'Briefing',
  TRADING: 'Trading',
  EARNINGS: 'Earnings',
  RESULTS: 'Results',
  SHOP: 'Shop',
  FINAL: 'Final',
};

export const PHASE_HINT: Record<Phase, string> = {
  LOBBY: 'Waiting for players',
  BRIEFING: 'Read the outlook. Trading is closed.',
  TRADING: 'Market is open.',
  EARNINGS: 'Quarter closed. Companies are reporting.',
  RESULTS: 'Leaderboard and recap.',
  SHOP: 'Buy cards for the next quarter.',
  FINAL: 'Game over.',
};
