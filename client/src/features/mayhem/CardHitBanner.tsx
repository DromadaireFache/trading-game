import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useGame } from '../../net/GameProvider.tsx';
import type { CardHit } from '../../net/state.ts';
import { rosterPlayerColor } from '../../lib/playerColor.ts';
import './mayhem.css';

/** How long one banner stays up. */
const HOLD_MS = 4_500;
/** At most this many banners at once (a burst of hits keeps the newest). */
const MAX_SHOWN = 3;

/** One line on what the card did to you. */
function effectOf(hit: CardHit): string {
  switch (hit.kind) {
    case 'frozen':
      return 'Frozen: no trading';
    case 'hodl':
      return 'HODL: no selling';
    case 'stolen':
      return `Took your ${hit.cardName}`;
    case 'flashbang':
      return 'Flashbang!';
    case 'reversed':
      return `Flipped your ${hit.symbol ?? ''} bet`;
    case 'freak_out':
      return 'Sold all your bets';
    case 'challenge':
      return 'Prove you are human';
    case 'forced':
      return `All in on ${hit.symbol ?? ''}`;
    case 'bill':
      return 'Bought you random stocks';
  }
}

/**
 * Who played a card on you: a banner per hit at the top of the desk, the attacker's name in their
 * color. Only cards aimed at players send `card_hit` (market cards do not), so only those show here.
 * It sits above the flashbang and the challenge, so you see who did it even while blinded.
 */
export function CardHitBanner() {
  const { cardHits, lobby } = useGame();
  const players = lobby?.players ?? [];
  const [shown, setShown] = useState<CardHit[]>([]);
  // Hits already in the state when the desk mounts (a reload) are old news: never replay them.
  const seen = useRef(cardHits[0]?.seq ?? 0);

  // Each batch of hits has its own timer: a later hit must not cancel an earlier one's removal.
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  useEffect(() => {
    const fresh = cardHits.filter((h) => h.seq > seen.current);
    if (fresh.length === 0) return;
    seen.current = fresh[0]!.seq;
    setShown((current) => [...fresh, ...current].slice(0, MAX_SHOWN));
    const gone = new Set(fresh.map((h) => h.seq));
    timers.current.push(window.setTimeout(() => setShown((current) => current.filter((h) => !gone.has(h.seq))), HOLD_MS));
  }, [cardHits]);

  if (shown.length === 0) return null;
  return (
    <div className="hit-banners" aria-live="assertive" data-testid="card-hits">
      {shown.map((hit, i) => {
        const index = players.findIndex((p) => p.id === hit.by);
        const name = players[index]?.name ?? 'Someone';
        const color = rosterPlayerColor(players, hit.by, Math.max(0, index));
        return (
          <div
            key={hit.seq}
            className="hit-banner"
            style={{ '--hit-color': color, '--hit-tilt': `${i % 2 === 0 ? -2 : 1.5}deg` } as CSSProperties}
            data-testid="card-hit"
            data-by={hit.by}
            data-kind={hit.kind}
          >
            <span className="hit-banner__who">{name}</span>
            <span className="hit-banner__line">
              played <span className="hit-banner__card">{hit.played}</span> on you
            </span>
            <span className="hit-banner__effect">{effectOf(hit)}</span>
          </div>
        );
      })}
    </div>
  );
}
