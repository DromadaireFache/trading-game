import { useCallback, useRef } from 'react';
import type { Phase, PhaseInfo, ServerMsg } from '@tg/shared';
import { formatMoneyShort, formatShares } from '../../lib/format.ts';
import { useGameClient, useServerMessages } from '../../net/GameProvider.tsx';
import { applyServerMsg } from '../../net/state.ts';
import { anchorOf, fx } from './fx.ts';
import { play } from './sound.ts';
import type { SoundName } from './sound.ts';

/** Index move within BIG_MOVE_WINDOW ticks that shakes the screen (fraction). */
const BIG_MOVE = 0.025;
const BIG_MOVE_WINDOW = 20;
const BIG_MOVE_COOLDOWN_MS = 6_000;
/** Realized P&L smaller than this share of equity gets a popup but no fanfare. */
const BIG_WIN_SHARE = 0.02;
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
 *  - a fill that closes or cuts a position: its realized P&L as a +$ popup with coins, or a red -$
 *    with a thud. Computed from the position held before the fill (kept from `portfolio` messages,
 *    which arrive right after each fill), because a closed position leaves the list.
 *  - a public headline: blip (the headline itself pops up as a newspaper, see NewsPopups)
 *  - the index moving BIG_MOVE within ~2 s: shake and whoosh
 *  - phase changes and quick-bet outcomes: distinct cues
 *  - a BREAKING moment: big shake and sting
 */
export function GameFx({ role }: { role: 'player' | 'spectator' }) {
  /** symbol -> { qty, avgPrice } as of the last `portfolio`. */
  const held = useRef(new Map<string, { qty: number; avgPrice: number }>());
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
            held.current.clear();
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
            const at = anchorOf(role === 'player' ? '[data-testid=market-panel], .desk__chart' : '[data-testid=floor-market]');
            fx.popup({ text: `${move > 0 ? '▲' : '▼'} MARKET ${(move * 100).toFixed(1)}%`, tone: move > 0 ? 'up' : 'down', ...at, size: 1.6 });
          }
          return;
        }
        case 'fill': {
          // The bet_result carries the outcome for an automatic cash-out.
          if (msg.reason === 'timed') return;
          const at = anchorOf('[data-testid=last-fill]', anchorOf('.desk__order'));
          if (msg.reason) {
            fx.shake(2);
            play('loss');
            fx.popup({ text: msg.reason === 'margin_call' ? 'MARGIN CALL!' : 'WIPED OUT', tone: 'down', ...at, size: 1.5 });
            return;
          }
          play('fill', msg.qty > 0 ? 1 : 0.85);
          fx.popup({ text: `${msg.qty > 0 ? '+' : ''}${formatShares(msg.qty)} ${msg.symbol}`, tone: msg.qty > 0 ? 'up' : 'down', ...at, size: 0.8 });
          // Realized P&L of this fill: the part that closes (some of) the position held before it.
          const before = held.current.get(msg.symbol);
          if (before && before.qty !== 0 && Math.sign(before.qty) !== Math.sign(msg.qty)) {
            const closed = Math.min(Math.abs(msg.qty), Math.abs(before.qty));
            celebrate(closed * (msg.price - before.avgPrice) * Math.sign(before.qty), equity.current);
          }
          return;
        }
        case 'bet_result':
          if (msg.pnl > 0) play('betWin', 1 + Math.min(msg.streak - 1, 4) * 0.06);
          else if (msg.pnl < 0) play('betLoss');
          else play('pop', 0.9);
          return;
        case 'portfolio': {
          held.current = new Map(msg.positions.map((p) => [p.symbol, { qty: p.qty, avgPrice: p.avgPrice }]));
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
          return;
        case 'phase': {
          // Clock resyncs resend the phase with a new deadline.
          if (msg.phase === phase.current?.phase && msg.quarter === phase.current.quarter) return;
          phase.current = msg;
          const sound = PHASE_SOUND[msg.phase];
          if (sound) play(sound);
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
    [role],
  );
  useServerMessages(handler);
  // Dev only: try effects from the console, e.g. __tgFx.fire({ t: 'moment', kind: 'crash', text: 'x' })
  // plays the effect AND puts the message in the client state as if the server had sent it.
  const client = useGameClient();
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
function celebrate(pnl: number, equity: number): void {
  if (Math.abs(pnl) < 1) return;
  const at = anchorOf('[data-testid=positions]', anchorOf('.desk__positions'));
  const big = Math.abs(pnl) >= BIG_WIN_SHARE * Math.max(1, equity);
  fx.popup({ text: `${pnl > 0 ? '+' : '-'}${formatMoneyShort(Math.abs(pnl))}`, tone: pnl > 0 ? 'up' : 'down', ...at, size: big ? 1.8 : 1.1 });
  if (pnl > 0) {
    play('cash', big ? 1.12 : 1);
    fx.burst({ ...at, tone: 'accent', count: big ? 60 : 22, power: big ? 9 : 6 });
  } else {
    play('thump');
  }
  if (big) fx.shake(1);
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
