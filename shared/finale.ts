/**
 * The end-of-game cutscene's timeline, shared by the server (which holds "Play again" until it ends)
 * and every screen (which plays it from ResultsMsg.finaleStartsAt, so reveals land everywhere at once).
 *
 *   bell        the market closes: the screen dims and MARKET CLOSED slams in
 *   race        everyone's net worth from the first day to the last, drawn left to right; then the
 *               winner's line lights up
 *   highlights  the game's moments, one card at a time
 *   awards      one award at a time
 *   podium      3rd, 2nd, then 1st rise onto the podium
 *   recap       stays: each player's own game, the full standings and Play again
 */
import type { GameConfig } from './config.ts';

export type FinaleSegment = 'bell' | 'race' | 'highlights' | 'awards' | 'podium' | 'recap';

export const FINALE_MS = {
  bell: 3_000,
  raceDraw: 12_000,
  raceHold: 2_500,
  highlight: 3_200,
  award: 2_000,
  podiumPlace: 1_800,
  podiumHold: 3_500,
} as const;

/** Most highlights and awards the cutscene shows one by one (the rest wait in the recap). */
export const FINALE_MAX_HIGHLIGHTS = 4;
export const FINALE_MAX_AWARDS = 8;

export interface FinaleTimeline {
  /** ms from the finale's start at which each segment begins; recap has no end. */
  starts: Record<FinaleSegment, number>;
  /** When the recap begins (Play again opens). */
  totalMs: number;
  /** Length of one highlight / award / podium place at this scale. */
  highlightMs: number;
  awardMs: number;
  podiumPlaceMs: number;
  raceDrawMs: number;
}

export function finaleTimeline(config: GameConfig, counts: { highlights: number; awards: number; players: number }): FinaleTimeline {
  const k = Math.max(0, config.presentation.finaleScale);
  const highlights = Math.min(counts.highlights, FINALE_MAX_HIGHLIGHTS);
  const awards = Math.min(counts.awards, FINALE_MAX_AWARDS);
  const places = Math.min(3, Math.max(0, counts.players));
  const bell = 0;
  const race = bell + FINALE_MS.bell * k;
  const hl = race + (FINALE_MS.raceDraw + FINALE_MS.raceHold) * k;
  const aw = hl + highlights * FINALE_MS.highlight * k;
  const podium = aw + awards * FINALE_MS.award * k;
  const recap = podium + (places * FINALE_MS.podiumPlace + FINALE_MS.podiumHold) * k;
  return {
    starts: { bell, race, highlights: hl, awards: aw, podium, recap },
    totalMs: recap,
    highlightMs: FINALE_MS.highlight * k,
    awardMs: FINALE_MS.award * k,
    podiumPlaceMs: FINALE_MS.podiumPlace * k,
    raceDrawMs: FINALE_MS.raceDraw * k,
  };
}

/** The segment playing `elapsedMs` into the finale. */
export function finaleSegmentAt(t: FinaleTimeline, elapsedMs: number): FinaleSegment {
  const order: FinaleSegment[] = ['recap', 'podium', 'awards', 'highlights', 'race', 'bell'];
  for (const seg of order) if (elapsedMs >= t.starts[seg]) return seg;
  return 'bell';
}
