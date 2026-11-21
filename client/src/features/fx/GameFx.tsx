import { useCallback, useRef } from 'react';
import type { ServerMsg } from '@tg/shared';
import { formatMoneyShort, formatShares } from '../../lib/format.ts';
import { useGameClient, useServerMessages } from '../../net/GameProvider.tsx';
import { applyServerMsg } from '../../net/state.ts';
import { anchorOf, fx } from './fx.ts';
import { play } from './sound.ts';

/** Index move within BIG_MOVE_WINDOW ticks that shakes the screen (fraction). */
const BIG_MOVE = 0.025;
const BIG_MOVE_WINDOW = 20;
const BIG_MOVE_COOLDOWN_MS = 6_000;
/** Realized P&L smaller than this share of equity gets a popup but no fanfare. */
const BIG_WIN_SHARE = 0.02;

/**
 * Turns server messages into effects and sounds. Mounted once per page, renders nothing.
 * Event-driven only: on a `tick` it does O(1) work (one price into a ring buffer), never DOM work
 * unless a big move just happened.
 *  - own fill: chip click and a popup at the order panel; a forced sale (margin call) shakes and buzzes
 *  - a fill that closes or cuts a position: its realized P&L as a +$ popup with coins, or a red -$
 *    with a thud. Computed from the position held before the fill (kept from `portfolio` messages,
 *    which arrive right after each fill), because a closed position leaves the list.
 *  - a public headline: blip and a pulse on the feed
 *  - the index moving BIG_MOVE within ~2 s: shake and whoosh
 *  - TRADING opens: bell; RESULTS / FINAL: pop
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

  const handler = useCallback(
    (msg: ServerMsg) => {
      switch (msg.t) {
        case 'welcome':
          if ((msg.game ?? 1) !== game.current) {
            game.current = msg.game ?? 1;
            held.current.clear();
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
        case 'portfolio':
          held.current = new Map(msg.positions.map((p) => [p.symbol, { qty: p.qty, avgPrice: p.avgPrice }]));
          equity.current = msg.equity;
          return;
        case 'headline':
          if (msg.early) return;
          play('news');
          pulse(document.querySelector('[data-testid=headlines]')?.closest('.panel'));
          return;
        case 'phase':
          if (msg.phase === 'TRADING') play('bell');
          else if (msg.phase === 'RESULTS' || msg.phase === 'FINAL') play('pop');
          return;
        case 'moment':
          fx.shake(3);
          play('sting');
          return;
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

/** One accent pulse on an element (restarts if it is already pulsing). */
function pulse(el: Element | null | undefined): void {
  if (!el) return;
  el.classList.remove('fx-pulse');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('fx-pulse');
  el.addEventListener('animationend', () => el.classList.remove('fx-pulse'), { once: true });
}
