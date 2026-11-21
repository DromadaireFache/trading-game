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

/** One line telling a newcomer what to do right now. */
export const PHASE_HINT: Record<Phase, string> = {
  LOBBY: 'Waiting for players. Read how to play while you wait.',
  BRIEFING: 'Get ready: see what news is coming. Trading opens soon.',
  TRADING: 'Market open! Pick a stock, bet UP or DOWN, watch the news.',
  EARNINGS: 'Companies report their profits. Prices jump at the next open.',
  RESULTS: 'Who made the most money this quarter?',
  SHOP: 'Buy cards to bend the market next quarter.',
  FINAL: 'Game over! Richest player wins.',
};
