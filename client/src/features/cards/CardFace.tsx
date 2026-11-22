import type { ReactNode } from 'react';
import type { CardDef } from '@tg/shared';
import './cards.css';

const TIER_LABEL: Record<CardDef['tier'], string> = {
  insider: 'Insider',
  fake: 'Fake news',
  event: 'Event',
  regime: 'Regime',
  counter: 'Counter',
  mayhem: 'Mayhem',
};

/** What a card needs when played, in a few words. */
export function targetHint(card: CardDef): string {
  const target = card.targetKind === 'stock' ? 'a stock' : card.targetKind === 'sector' ? 'a sector' : card.targetKind === 'player' ? 'a rival' : '';
  if (card.needsDirection) return target ? `${target}, up or down` : 'up or down';
  return target;
}

/** One card: tier, name, legality, text. `children` = the action row (buy / play). */
export function CardFace({ card, children, testId }: { card: CardDef; children?: ReactNode; testId?: string }) {
  const hint = targetHint(card);
  return (
    <article
      className={`card card--${card.tier}${card.legal ? '' : ' card--illegal'}`}
      data-testid={testId}
      data-def={card.defId}
      title={`${card.name}: ${card.description}${hint ? ` (target: ${hint})` : ''}`}
    >
      <header className="card__head">
        <span className="card__tier">{TIER_LABEL[card.tier]}</span>
        <span className={card.legal ? 'card__legal' : 'card__illegal'} title={card.legal ? 'Legal: it can never get you jailed' : 'Illegal: adds heat; the SEC may catch you this quarter'}>
          {card.legal ? 'legal' : 'ILLEGAL'}
        </span>
      </header>
      <div className="card__name">{card.name}</div>
      <p className="card__text">{card.description}</p>
      {hint && <div className="card__hint">Target: {hint}</div>}
      {children && <div className="card__actions">{children}</div>}
    </article>
  );
}
