import { useCallback, useRef } from 'react';
import type { Phase, PhaseInfo, ServerMsg } from '@tg/shared';
import { formatMoneyShort, formatShares } from '../../lib/format.ts';
import { useGameClient, useServerMessages } from '../../net/GameProvider.tsx';
import { applyServerMsg } from '../../net/state.ts';
import { popWinningButton, takeOrderButton } from './buttonFx.ts';
import { anchorOf, fx } from './fx.ts';
import { getHype } from './hype.ts';
import { play } from './sound.ts';
import type { SoundName } from './sound.ts';

/** Index move within BIG_MOVE_WINDOW ticks that shakes the screen (fraction). */
const BIG_MOVE = 0.025;
const BIG_MOVE_WINDOW = 20;
const BIG_MOVE_COOLDOWN_MS = 6_000;
/** Largest win effects kick in at a quarter of the starting bankroll. */
const MAX_WIN_CASH_SHARE = 0.25;
const BIG_LOSS_SHARE = 0.02;
/** Balatro-style banner across the table when a phase starts (players only). */
const PHASE_BANNER: Partial<Record<Phase, { text: string; tone: 'up' | 'down' | 'accent' | 'info' | 'warn' }>> = {
  TRADING: { text: 'MARKET OPEN!', tone: 'up' },
  EARNINGS: { text: 'CLOSING BELL', tone: 'warn' },
  SHOP: { text: 'SHOP OPEN', tone: 'accent' },
  FINAL: { text: 'GAME OVER', tone: 'accent' },
};
const PHASE_SOUND: Partial<Record<Phase, SoundName>> = {
  BRIEFING: 'briefing',
  TRADING: 'bell',
  EARNINGS: 'earnings',
  RESULTS: 'pop',
  SHOP: 'shop',
  FINAL: 'final',
};

/**
 * Turns server messages into effects and sounds. Mounted once per page, renders nothing.
 * Event-driven only: on a `tick` it does O(1) work (one price into a ring buffer), never DOM work
 * unless a big move just happened.
 *  - own fill: chip click and a popup at the order panel; a forced sale (margin call) shakes and buzzes
 *  - a fill that closes or cuts a position: realized P&L from the server, with a stronger button
 *    pop and screen shake for larger profits, or a red popup with a thud for a loss.
 *  - a public headline: blip and a puff of paper dust where the papers pile up (NewsPile)
 *  - own fills and wins scale with the bet's size and with how well the player is doing (hype.ts)
 *  - a phase start: a Balatro-style banner across the table
 *  - the index moving BIG_MOVE within ~2 s: shake and whoosh
 *  - phase changes and quick-bet outcomes: distinct cues
 *  - a BREAKING moment: big shake and sting
 */
export function GameFx({ role }: { role: 'player' | 'spectator' }) {
  const client = useGameClient();
  const ring = useRef<number[]>([]);
  const indexSymbol = useRef<string | null>(null);
  const lastBigMove = useRef(0);
  const game = useRef(0);
  const equity = useRef(0);
  /** Hand size, heat and jail as of the last `portfolio` (null = none seen yet this game). */
  const cards = useRef<{ hand: number; heat: number; jailed: boolean } | null>(null);
  const meId = useRef<string | null>(null);
  const phase = useRef<PhaseInfo | null>(null);

  const handler = useCallback(
    (msg: ServerMsg) => {
      switch (msg.t) {
        case 'welcome':
          meId.current = msg.playerId;
          phase.current = msg.phase;
          if ((msg.game ?? 1) !== game.current) {
            game.current = msg.game ?? 1;
            cards.current = null;
          }
          return;
        case 'market':
          indexSymbol.current = msg.universe.symbols.find((s) => s.kind === 'index')?.symbol ?? null;
          ring.current = [];
          return;
        case 'tick': {
          const sym = indexSymbol.current;
          const price = sym ? msg.prices[sym] : undefined;
          if (price === undefined) return;
          const r = ring.current;
          r.push(price);
          if (r.length > BIG_MOVE_WINDOW) r.shift();
          const move = price / r[0]! - 1;
          const now = performance.now();
          if (Math.abs(move) >= BIG_MOVE && now - lastBigMove.current > BIG_MOVE_COOLDOWN_MS) {
            lastBigMove.current = now;
            ring.current = [price];
            fx.shake(2);
            play('whoosh');
            const at = anchorOf(role === 'player' ? '[data-testid=market-panel], .desk__chart' : '[data-testid=net-worth-chart]');
            fx.popup({ text: `${move > 0 ? '▲' : '▼'} MARKET ${(move * 100).toFixed(1)}%`, tone: move > 0 ? 'up' : 'down', ...at, size: 1.6 });
          }
          return;
        }
        case 'fill': {
          // The bet_result carries the outcome for an automatic cash-out.
          if (msg.reason === 'timed') return;
          const button = takeOrderButton(msg.requestId);
          const at = anchorOf('[data-testid=last-fill]', anchorOf('.desk__order'));
          if (msg.reason) {
            fx.shake(2);
            play('loss');
            fx.popup({ text: msg.reason === 'margin_call' ? 'MARGIN CALL!' : 'WIPED OUT', tone: 'down', ...at, size: 1.5 });
            return;
          }
          play('fill', msg.qty > 0 ? 1 : 0.85);
          // Bigger bets (share of net worth) and hotter players get bigger popups.
          const notional = Math.abs(msg.qty * msg.price);
          const weight = Math.min(1, notional / Math.max(1, equity.current));
          fx.popup({ text: `${msg.qty > 0 ? '+' : ''}${formatShares(msg.qty)} ${msg.symbol}`, tone: msg.qty > 0 ? 'up' : 'down', ...at, size: 0.8 + 0.6 * weight + 0.4 * getHype() });
          if (msg.realizedPnl !== undefined) {
            celebrate(msg.realizedPnl, equity.current, client.getState().config.economy.startingCash, button);
          }
          return;
        }
        case 'bet_result':
          if (msg.pnl > 0) play('betWin', 1 + Math.min(msg.streak - 1, 4) * 0.06);
          else if (msg.pnl < 0) play('betLoss');
          else play('pop', 0.9);
          return;
        case 'portfolio': {
          equity.current = msg.equity;
          const now = { hand: msg.hand?.length ?? 0, heat: msg.heat, jailed: msg.jailedUntil !== undefined };
          const before = cards.current;
          cards.current = now;
          if (before) cardMoments(before, now);
          return;
        }
        case 'headline':
          if (msg.early) {
            // Only this player sees it: an insider preview or a mole's note.
            play('secret');
            fx.popup({ text: 'INSIDER TIP', tone: 'info', ...anchorOf('.desk__chart'), size: 1.3 });
            return;
          }
          play('news');
          if (role === 'player') {
            // Paper dust where the papers land (after the drop-in).
            const pile = anchorOf('[data-testid=news-pile]', anchorOf('.desk__hand'));
            window.setTimeout(() => fx.burst({ ...pile, y: pile.y + 60, tone: 'warn', count: 8, power: 3 }), 320);
          }
          return;
        case 'phase': {
          // Clock resyncs resend the phase with a new deadline.
          if (msg.phase === phase.current?.phase && msg.quarter === phase.current.quarter) return;
          phase.current = msg;
          const sound = PHASE_SOUND[msg.phase];
          if (sound) play(sound);
          const banner = PHASE_BANNER[msg.phase];
          if (banner && role === 'player') {
            fx.popup({ ...banner, ...anchorOf('.desk__chart, .desk__stage'), size: 2.2 + getHype() });
            fx.shake(1, 0.5 + getHype());
          }
          return;
        }
        case 'error':
          if (role === 'player') play('reject');
          return;
        case 'moment':
          fx.shake(3);
          play('sting');
          return;
        case 'results': {
          if (msg.final || msg.arrests.length === 0) return;
          const mine = msg.arrests.find((a) => a.playerId === meId.current);
          if (mine && role === 'player') {
            fx.shake(3);
            play('siren');
            fx.popup({ text: `ARRESTED! ${mine.jailDays} DAYS`, tone: 'down', ...anchorOf('[data-testid=arrests]', anchorOf('.desk__stage')), size: 2 });
          } else {
            play('thump');
            fx.shake(1);
          }
          return;
        }
        default:
          return;
      }
    },
    [client, role],
  );
  useServerMessages(handler);
  // Dev only: try effects from the console, e.g. __tgFx.fire({ t: 'moment', kind: 'crash', text: 'x' })
  // plays the effect AND puts the message in the client state as if the server had sent it.
  if (import.meta.env.DEV) {
    (window as unknown as { __tgFx?: unknown }).__tgFx = {
      fx,
      play,
      fire(msg: ServerMsg) {
        const c = client as unknown as { setState(s: unknown): void; getState(): Parameters<typeof applyServerMsg>[0] };
        c.setState(applyServerMsg(c.getState(), msg, Date.now()));
        handler(msg);
      },
    };
  }
  return null;
}

/** A realized gain or loss: popup at the positions panel, coins and an arpeggio for a win. */
function celebrate(pnl: number, equity: number, startingCash: number, button: ReturnType<typeof takeOrderButton>): void {
  if (Math.abs(pnl) < 1) return;
  if (pnl > 0) {
    const at = button ? { x: button.rect.x + button.rect.width / 2, y: button.rect.y + button.rect.height / 2 } : anchorOf('.desk__positions');
    // Scales with the win and with how well the player is doing overall.
    const hype = getHype();
    const strength = Math.min(1, pnl / Math.max(1, startingCash * MAX_WIN_CASH_SHARE));
    if (button) popWinningButton(button, Math.min(1, strength + 0.5 * hype));
    fx.shake(3, Math.min(1.6, strength + 0.6 * hype));
    fx.popup({ text: `+${formatMoneyShort(pnl)}`, tone: 'up', ...at, size: 1.1 + 0.7 * strength + 0.6 * hype });
    play('cash', 1 + 0.12 * strength + 0.08 * hype);
    fx.burst({ ...at, tone: 'accent', count: Math.round(22 + 38 * strength + 40 * hype), power: 6 + 3 * strength + 3 * hype });
    if (strength + hype > 0.8) window.setTimeout(() => fx.burst({ ...at, tone: 'up', count: Math.round(20 + 30 * hype), power: 9 }), 180);
  } else {
    const big = -pnl >= BIG_LOSS_SHARE * Math.max(1, equity);
    const at = button ? { x: button.rect.x + button.rect.width / 2, y: button.rect.y + button.rect.height / 2 } : anchorOf('[data-testid=positions]', anchorOf('.desk__positions'));
    fx.popup({ text: `-${formatMoneyShort(-pnl)}`, tone: 'down', ...at, size: big ? 1.8 : 1.1 });
    play('thump');
    // A sad little puff of red: the money going away.
    fx.burst({ ...at, tone: 'down', count: big ? 18 : 8, power: big ? 4 : 2.5 });
    if (big) fx.shake(1);
  }
}

/** Hand, heat and jail changes between two `portfolio` messages. */
function cardMoments(before: { hand: number; heat: number; jailed: boolean }, now: { hand: number; heat: number; jailed: boolean }): void {
  const hand = anchorOf('[data-testid=hand]', anchorOf('.desk__hand'));
  if (now.hand > before.hand) {
    play('card');
    fx.popup({ text: '+CARD', tone: 'accent', ...hand, size: 1.2 });
    fx.burst({ ...hand, tone: 'accent', count: 14, power: 5 });
  } else if (now.hand < before.hand) {
    play('whoosh');
    fx.shake(1);
    fx.popup({ text: 'PLAYED!', tone: 'warn', ...hand, size: 1.5 });
    fx.burst({ ...hand, tone: 'warn', count: 30, power: 8 });
  }
  if (now.heat > before.heat + 0.5) {
    fx.popup({ text: `HEAT +${Math.round(now.heat - before.heat)}`, tone: 'down', ...anchorOf('[data-testid=heat]', hand), size: 1 });
  }
  if (before.jailed && !now.jailed) {
    play('cash');
    fx.popup({ text: 'FREE!', tone: 'up', ...hand, size: 1.6 });
    fx.burst({ ...hand, tone: 'up', count: 40, power: 8 });
  }
}
