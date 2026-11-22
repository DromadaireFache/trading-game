import type { HoldingsMsg, PlayerId } from '@tg/shared';

export type Holdings = Omit<HoldingsMsg, 't' | 'playerId'>;

/**
 * What every player holds (from `holdings`). Kept OUT of GameState on purpose: with 4 players these
 * arrive several times a second (each trade and each day's close, for every player), and in GameState
 * every useGame() consumer (the whole desk) would re-render on each one. Only the panels that show
 * the others' positions subscribe here.
 */
export class HoldingsStore {
  private byPlayer: Readonly<Record<PlayerId, Holdings>> = {};
  private readonly listeners = new Set<() => void>();

  apply(msg: HoldingsMsg): void {
    const { t: _t, playerId, ...held } = msg;
    this.byPlayer = { ...this.byPlayer, [playerId]: held };
    this.emit();
  }

  /** A new game: nothing of the old one stays. */
  reset(): void {
    if (Object.keys(this.byPlayer).length === 0) return;
    this.byPlayer = {};
    this.emit();
  }

  get = (): Readonly<Record<PlayerId, Holdings>> => this.byPlayer;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}
