import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../../lib/format.ts';

/** A change of net worth at least this big (share) flashes the number. */
const FLASH_SHARE = 0.002;

/**
 * Net worth as the big score: it flashes green or red when it jumps, wobbles and burns (Balatro's
 * score on fire) harder the better the player is doing (--hype, see fx/hype.ts). Only the number moves.
 */
export function MoneyScore({ equity }: { equity: number }) {
  const before = useRef(equity);
  const [flash, setFlash] = useState<{ up: boolean; n: number } | null>(null);
  useEffect(() => {
    const change = (equity - before.current) / Math.max(1, Math.abs(before.current));
    before.current = equity;
    if (Math.abs(change) >= FLASH_SHARE) setFlash((f) => ({ up: change > 0, n: (f?.n ?? 0) + 1 }));
  }, [equity]);
  return (
    <span className="positions__worth money-score" data-testid="equity">
      <span key={flash?.n ?? 0} className={`money-score__value${flash ? ` money-score__value--${flash.up ? 'up' : 'down'}` : ''}`}>
        {formatMoney(equity)}
      </span>
    </span>
  );
}
