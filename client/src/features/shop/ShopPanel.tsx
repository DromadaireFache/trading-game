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
      aside={`your cards ${handSize}/${config.cards.handLimit}${live ? ` · your money ${formatMoney(live.equity)}` : ''}`}
      className={`shop${className ? ` ${className}` : ''}`}
    >
      <ReadyUp />
      {shop.length === 0 ? (
        <Placeholder>No cards on offer.</Placeholder>
      ) : (
        <>
        <p className="shop__intro">
          Cards let you make the news. Buy now, play them next quarter while the market is open. Prices grow with your
          money. Everyone gets a different shop. <strong>Illegal</strong> cards add heat: the SEC may fine you and put you in
          jail. Legal cards never land you in jail.
        </p>
        <div className="shop__grid" data-testid="shop">
          {shop.map((offer) => {
            const owned = bought.has(offer.offerId);
            const tooDear = live !== null && live.equity - offer.price < config.economy.eliminationEquity;
            return (
              <CardFace key={offer.offerId} card={offer.card} testId="offer">
                <span className="card__price">{formatMoney(offer.price)}</span>
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
