import { Panel, Placeholder } from '../../components/Panel.tsx';
import { formatMoneyShort } from '../../lib/format.ts';
import { STAKE_LABELS, setStake, useQuickBet, useStake } from '../../lib/quickBet.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { useMarketStore, useQuote, useSelectedSymbol } from '../../net/marketHooks.ts';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import { LastFill } from './OrderPanel.tsx';
import { JailOrderNotice } from './JailOrderNotice.tsx';
import './trading.css';

/**
 * Simple mode's way to bet: choose how big, then UP or DOWN on the selected company. The bet stays open
 * until you cash it out (or a margin call does).
 */
export function QuickBetPanel({ className }: { className?: string }) {
  const { phase, config, fills, pendingOrder } = useGame();
  const client = useGameClient();
  const market = useMarketStore();
  const symbol = useSelectedSymbol();
  const quote = useQuote(symbol);
  const live = useLivePortfolio();
  const stake = useStake();
  const { bet } = useQuickBet();

  if (live === null || symbol === null) {
    return (
      <Panel title="Quick bet" className={`order${className ? ` ${className}` : ''}`}>
        <Placeholder>Betting opens when the game starts.</Placeholder>
      </Panel>
    );
  }

  const open = phase?.phase === 'TRADING' && !live.portfolio.eliminated && (quote?.price ?? 0) > 0;
  const name = market.getInfo(symbol)?.name ?? symbol;
  const held = live.portfolio.positions.find((p) => p.symbol === symbol)?.qty ?? 0;
  const canBet = open && live.buyingPower > 0 && pendingOrder === null;

  return (
    <Panel title="Quick bet" aside={<span className="order__on">{name}</span>} className={`order quick${className ? ` ${className}` : ''}`}>
      <JailOrderNotice />
      <div className="quick__stakes" role="radiogroup" aria-label="How big">
        {STAKE_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={i === stake}
            className={`quick__stake${i === stake ? ' quick__stake--on' : ''}`}
            onClick={() => setStake(i)}
            data-testid={`stake-${i}`}
          >
            <span className="quick__stake-label">{label}</span>
            <span className="quick__stake-usd">{formatMoneyShort(live.buyingPower * (config.trading.quickBetStakes[i] ?? 0))}</span>
          </button>
        ))}
      </div>
      <div className="quick__dirs">
        <button type="button" className="quick__dir quick__dir--up" disabled={!canBet} onClick={() => bet(symbol, true)} data-testid="quick-up">
          ▲ Going up
        </button>
        <button type="button" className="quick__dir quick__dir--down" disabled={!canBet} onClick={() => bet(symbol, false)} data-testid="quick-down">
          ▼ Going down
        </button>
      </div>
      <div className="quick__note">
        {open
          ? 'Your bet stays open until you cash it out.'
          : live.portfolio.eliminated
            ? 'You are out of the game.'
            : 'Betting opens when the market opens.'}
      </div>
      {held !== 0 && (
        <div className="order__held-row">
          <span className={`order__held order__held--${held > 0 ? 'up' : 'down'}`} data-testid="order-held">
            {held > 0 ? '▲ UP' : '▼ DOWN'} · {formatMoneyShort(Math.abs(held) * (quote?.price ?? 0))}
          </span>
          <span />
          <button type="button" className="order__cash" disabled={!open || pendingOrder !== null} onClick={() => client.send({ t: 'order', symbol, qty: -held })} data-testid="order-close">
            Cash out now
          </button>
        </div>
      )}
      {fills[0] !== undefined && <LastFill key={fills[0].seq} fill={fills[0]} decimals={config.market.priceDecimals} />}
    </Panel>
  );
}
