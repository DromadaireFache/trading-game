import { useEffect, useState } from 'react';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { ReadyUp } from '../../components/ReadyUp.tsx';
import { formatMoney } from '../../lib/format.ts';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import { CardFace } from '../cards/CardFace.tsx';
import '../cards/cards.css';

/**
 * SHOP: this quarter's offers, priced for this player's net worth. One click buys; the card goes to
 * the hand (limit config.cards.handLimit) and is played in a later TRADING phase.
 */
export function ShopPanel({ className }: { className?: string }) {
  const { shop, config } = useGame();
  const client = useGameClient();
  const live = useLivePortfolio();
  // Offers this player clicked (the server refuses a second buy; this just greys the button).
  const [bought, setBought] = useState<Set<string>>(new Set());
  const shopKey = shop.map((o) => o.offerId).join(',');
  useEffect(() => setBought(new Set()), [shopKey]);

  const handSize = live?.portfolio.hand?.length ?? 0;
  const full = handSize >= config.cards.handLimit;

  return (
    <Panel
      title="Card shop"
      aside={`${handSize}/${config.cards.handLimit}`}
      className={`shop${className ? ` ${className}` : ''}`}
    >
      <ReadyUp />
      {shop.length === 0 ? (
        <Placeholder>No cards on offer.</Placeholder>
      ) : (
        <>
        {shop[0]?.discount ? (
          <p className="shop__underdog" data-testid="underdog">
            <span>Underdog deal</span>
            <strong>{Math.round(shop[0].discount * 100)}% off</strong>
          </p>
        ) : null}
        <div className="shop__grid" data-testid="shop">
          {shop.map((offer) => {
            const owned = bought.has(offer.offerId);
            const tooDear = live !== null && live.equity - offer.price < config.economy.eliminationEquity;
            return (
              <CardFace key={offer.offerId} card={offer.card} testId="offer">
                <span className="card__price">
                  {formatMoney(offer.price)}
                  {offer.discount ? <span className="card__discount">-{Math.round(offer.discount * 100)}%</span> : null}
                </span>
                <button
                  type="button"
                  className="card__btn"
                  disabled={owned || full || tooDear}
                  title={owned ? 'Bought' : full ? 'Your hand is full' : tooDear ? 'You cannot afford it' : `Buy ${offer.card.name}`}
                  onClick={() => {
                    if (client.send({ t: 'buy_card', offerId: offer.offerId })) setBought((b) => new Set(b).add(offer.offerId));
                  }}
                  data-testid="buy"
                >
                  {owned ? 'Bought' : 'Buy'}
                </button>
              </CardFace>
            );
          })}
        </div>
        </>
      )}
    </Panel>
  );
}
