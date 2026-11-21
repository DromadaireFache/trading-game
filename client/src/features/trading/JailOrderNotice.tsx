import { useEffect, useState } from 'react';
import { useGame } from '../../net/GameProvider.tsx';
import { useLastDay } from '../../net/marketHooks.ts';
import { formatShares } from '../../lib/format.ts';

export function JailOrderNotice() {
  const { pendingOrder, orderCancelled, portfolio, config } = useGame();
  const day = useLastDay();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!pendingOrder) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [pendingOrder]);
  const jailed = portfolio?.jailedUntil !== undefined && Math.max(0, day) < portfolio.jailedUntil;
  if (pendingOrder) {
    const seconds = Math.max(0, (pendingOrder.endsAt - now) / 1000);
    return <div className="order__jail" role="status" data-testid="jail-order-status">
      IN JAIL · {pendingOrder.qty > 0 ? 'Buy' : 'Sell'} {formatShares(Math.abs(pendingOrder.qty))} {pendingOrder.symbol} pending
      <strong> · {seconds.toFixed(1)}s</strong><br />
      Your order fills at the price when the delay ends. Other orders are disabled.
    </div>;
  }
  if (orderCancelled) return <div className="order__jail" role="status">Your delayed order was cancelled because trading closed.</div>;
  if (!jailed) return null;
  return <div className="order__jail" data-testid="jail-order-status">
    IN JAIL · Orders take {config.sec.jailOrderDelayMs / 1000}s to execute. One order at a time.
  </div>;
}
