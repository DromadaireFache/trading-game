/** Display text per phase. Colors come from the theme through CSS (.phase--<PHASE> classes). */
import type { Phase } from '@tg/shared';

export const PHASE_LABEL: Record<Phase, string> = {
  LOBBY: 'Lobby',
  BRIEFING: 'Briefing',
  TRADING: 'Trading',
  RESULTS: 'Results',
  SHOP: 'Shop',
  FINAL: 'Final',
};

/** One line telling a newcomer what to do right now. */
