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
/** A realized gain or loss this share of the starting bankroll gets the full treatment. */
const HUGE_PNL_SHARE = 0.1;
/** A rival trade this share of their net worth is a "big" one: their column flares and the screen bumps. */
const RIVAL_BIG_SHARE = 0.15;
/** Balatro-style banner across the table when a phase starts (players only). */
const PHASE_BANNER: Partial<Record<Phase, { text: string; tone: 'up' | 'down' | 'accent' | 'info' | 'warn' }>> = {
  TRADING: { text: 'MARKET OPEN!', tone: 'up' },
  RESULTS: { text: 'CLOSING BELL', tone: 'warn' },
  SHOP: { text: 'SHOP OPEN', tone: 'accent' },
  FINAL: { text: 'GAME OVER', tone: 'accent' },
};
const PHASE_SOUND: Partial<Record<Phase, SoundName>> = {
  BRIEFING: 'briefing',
  TRADING: 'bell',
  RESULTS: 'earnings',
  SHOP: 'shop',
  FINAL: 'final',
};

/**
 * Turns server messages into effects and sounds. Mounted once per page, renders nothing.
 * Event-driven only: on a `tick` it does O(1) work (one price into a ring buffer), never DOM work
 * unless a big move just happened.
 *  - own fill: chip click and a popup at the order panel; a forced sale (margin call) shakes and buzzes
 *  - every own fill: a small shake
 *  - a fill that closes or cuts a position: realized P&L from the server, scaled by size: a green or
 *    red edge glow (a full wash for big ones), shake, chromatic split, hit-stop at the top; winning
 *    closes in a row build a combo
 *  - another player's trade: their column flares; a big one bumps the screen
 *  - a public headline: blip and a light shake as the paper lands
 *  - a public headline also puffs paper dust where the papers land (NewsPile)
 *  - fills and wins scale with how well the player is doing (hype.ts)
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
  /** Hand size, heat and jail as of the last `portfolio` (null = none seen yet this game). */
  const cards = useRef<{ hand: number; heat: number; jailed: boolean } | null>(null);
  const meId = useRef<string | null>(null);
  const phase = useRef<PhaseInfo | null>(null);
  /** Winning closes in a row (a losing close resets it). */
  const combo = useRef(0);
  /** Each rival's positions as of their last `holdings`, to spot their trades. */
  const rivals = useRef(new Map<string, Map<string, { qty: number; avgPrice: number }>>());

  const handler = useCallback(
    (msg: ServerMsg) => {
      switch (msg.t) {
        case 'welcome':
          meId.current = msg.playerId;
          phase.current = msg.phase;
          if ((msg.game ?? 1) !== game.current) {
            game.current = msg.game ?? 1;
            cards.current = null;
            combo.current = 0;
            rivals.current.clear();
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
            fx.chroma(0.5);
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
            combo.current = 0;
            fx.shake(3);
            fx.flash({ tone: 'down', strength: 1 });
            fx.chroma(1);
            play('loss');
            fx.popup({ text: msg.reason === 'margin_call' ? 'MARGIN CALL!' : 'WIPED OUT', tone: 'down', ...at, size: 1.8 });
            return;
          }
          play('fill', msg.qty > 0 ? 1 : 0.85);
          fx.popup({ text: `${msg.qty > 0 ? '+' : ''}${formatShares(msg.qty)} ${msg.symbol}`, tone: msg.qty > 0 ? 'up' : 'down', ...at, size: 0.8 + 0.5 * getHype() });
          if (msg.realizedPnl !== undefined && Math.abs(msg.realizedPnl) >= 1) {
            const startingCash = client.getState().config.economy.startingCash;
            if (msg.realizedPnl > 0) combo.current++;
            else combo.current = 0;
            celebrate(msg.realizedPnl, startingCash, button, combo.current);
          } else {
            // Opening or adding: a small kick so every trade feels like it landed.
            fx.shake(1, 0.6 + 0.6 * getHype());
          }
          return;
        }
        case 'bet_result':
          if (msg.pnl > 0) play('betWin', 1 + Math.min(msg.streak - 1, 4) * 0.06);
          else if (msg.pnl < 0) play('betLoss');
          else play('pop', 0.9);
          return;
        case 'portfolio': {
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
          fx.shake(1, 0.8);
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
        case 'holdings': {
          if (msg.playerId === meId.current) return;
          const now = new Map(msg.positions.map((p) => [p.symbol, { qty: p.qty, avgPrice: p.avgPrice }]));
          const before = rivals.current.get(msg.playerId);
          rivals.current.set(msg.playerId, now);
          if (before === undefined || role !== 'player') return;
          rivalTrade(msg.playerId, before, now, msg.equity);
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

/**
 * A realized gain or loss, scaled by its size against the starting bankroll (strength 0..1, full at
 * HUGE_PNL_SHARE): an edge glow (green or red) that turns into a full-screen wash, a shake, a popup at
 * the order button or the positions panel, and for the bigger ones a chromatic split and, at the top,
 * a hit-stop. Wins also throw coins and count the combo.
 */
function celebrate(pnl: number, startingCash: number, button: ReturnType<typeof takeOrderButton>, combo: number): void {
  const strength = Math.min(1, Math.abs(pnl) / Math.max(1, startingCash * HUGE_PNL_SHARE)) ** 0.6;
  const tone = pnl > 0 ? 'up' : 'down';
  fx.flash({ tone, strength: 0.15 + 0.85 * strength });
  const tier = strength >= 0.75 ? 3 : strength >= 0.4 ? 2 : 1;
  fx.shake(tier, tier === 1 ? 0.6 + strength : 0.7 + 0.3 * strength);
  if (strength >= 0.4) fx.chroma(strength);
  if (strength >= 0.9) fx.punch(strength);
  if (pnl > 0) {
    const at = button ? { x: button.rect.x + button.rect.width / 2, y: button.rect.y + button.rect.height / 2 } : anchorOf('.desk__positions');
    // Wins also scale with how well the player is doing overall (hype.ts).
    const hype = getHype();
    if (button) popWinningButton(button, Math.min(1, strength + 0.5 * hype));
    fx.popup({ text: `+${formatMoneyShort(pnl)}`, tone: 'up', ...at, size: 1.1 + 1.1 * strength + 0.6 * hype });
    play('cash', 1 + 0.12 * strength + 0.08 * hype);
    fx.burst({ ...at, tone: 'accent', count: Math.round(22 + 60 * strength + 40 * hype), power: 6 + 4 * strength + 3 * hype });
    if (strength + hype > 0.9) window.setTimeout(() => fx.burst({ ...at, tone: 'up', count: Math.round(20 + 30 * hype), power: 9 }), 180);
    if (combo >= 2) {
      const c = Math.min(combo, 8);
      fx.popup({ text: `COMBO x${combo}`, tone: 'accent', ...anchorOf('.desk__order'), size: 1 + 0.15 * c });
      fx.burst({ ...anchorOf('.desk__order'), tone: 'warn', count: 10 + 6 * c, power: 5 + c / 2 });
      play('betWin', 1 + Math.min(combo - 1, 6) * 0.07);
    }
  } else {
    const at = button ? { x: button.rect.x + button.rect.width / 2, y: button.rect.y + button.rect.height / 2 } : anchorOf('[data-testid=positions]', anchorOf('.desk__positions'));
    fx.popup({ text: `-${formatMoneyShort(-pnl)}`, tone: 'down', ...at, size: 1.1 + 1.1 * strength });
    // A sad little puff of red: the money going away.
    fx.burst({ ...at, tone: 'down', count: Math.round(8 + 14 * strength), power: 2.5 + 2 * strength });
    play(strength >= 0.4 ? 'loss' : 'thump');
  }
}

/** A rival's position changed: their column flares, and a big trade bumps the screen. */
function rivalTrade(
  playerId: string,
  before: Map<string, { qty: number; avgPrice: number }>,
  now: Map<string, { qty: number; avgPrice: number }>,
  equity: number,
): void {
  let moved = 0;
  let biggest: { symbol: string; dq: number; notional: number } | null = null;
  for (const symbol of new Set([...before.keys(), ...now.keys()])) {
    const a = before.get(symbol);
    const b = now.get(symbol);
    const dq = (b?.qty ?? 0) - (a?.qty ?? 0);
    if (dq === 0) continue;
    const notional = Math.abs(dq) * (b?.avgPrice || a?.avgPrice || 0);
    moved += notional;
    if (biggest === null || notional > biggest.notional) biggest = { symbol, dq, notional };
  }
  if (biggest === null) return;
  const el = document.querySelector<HTMLElement>(`[data-testid=rival][data-player="${CSS.escape(playerId)}"]`);
  const big = moved >= RIVAL_BIG_SHARE * Math.max(1, equity);
  if (el) {
    el.classList.remove('rival--traded', 'rival--traded-big');
    void el.offsetWidth; // restart the animation
    el.classList.add(big ? 'rival--traded-big' : 'rival--traded');
  }
  if (big) {
    const r = el?.getBoundingClientRect();
    const at = r ? { x: r.left + r.width / 2, y: r.top + 24 } : anchorOf('.desk__rivals');
    fx.shake(1, 0.7);
    fx.popup({ text: `${biggest.dq > 0 ? '▲' : '▼'} ${biggest.symbol}`, tone: biggest.dq > 0 ? 'up' : 'down', ...at, size: 0.9 });
    play('pop', 0.8);
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
