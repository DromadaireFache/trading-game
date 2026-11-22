import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { GameConfig } from '@tg/shared';
import { Panel } from '../../components/Panel.tsx';
import { formatMoney } from '../../lib/format.ts';
import { useGame } from '../../net/GameProvider.tsx';
import bet from './tutorial/01-bet.webp';
import cashOut from './tutorial/02-cash-out.webp';
import desk from './tutorial/03-desk.webp';
import headline from './tutorial/04-headline.webp';
import earnings from './tutorial/05-earnings.webp';
import cards from './tutorial/06-cards.webp';
import jail from './tutorial/07-jail.webp';
import risk from './tutorial/08-risk.webp';
import './tutorial.css';

interface Slide {
  title: string;
  image: string;
  alt: string;
  lines: readonly ReactNode[];
}

function tutorialSlides(config: GameConfig): readonly Slide[] {
  const { gapDelayMinMs, gapDelayMaxMs } = config.earnings;
  const gapDelay = gapDelayMaxMs === 0
    ? 'on the first tick'
    : gapDelayMinMs === gapDelayMaxMs
      ? `about ${gapDelayMaxMs / 1000}s after the open`
      : `${gapDelayMinMs / 1000}–${gapDelayMaxMs / 1000}s after the open`;
  return [
    {
      title: 'Place your first bet',
      image: bet,
      alt: 'Place a bet panel with three green up buttons and three red down buttons.',
      lines: [
        <>You start with <strong>{formatMoney(config.economy.startingCash)}</strong>. Pick a stock and tap an amount.</>,
        <><strong>▲ Up</strong> buys a position that gains if the price rises.</>,
        <><strong>▼ Down</strong> opens a short that gains if the price falls.</>,
      ],
    },
    {
      title: 'Cash out',
      image: cashOut,
      alt: 'Your Positions table with live profit and a Cash out button on each row.',
      lines: [
        <><strong>Your Positions</strong> shows what each bet is worth and its live profit or loss.</>,
        <>A bet stays open until you close it or the game forces it closed.</>,
        <>Click <strong>Cash out</strong> to close that position at the going price.</>,
      ],
    },
    {
      title: 'Read the trading desk',
      image: desk,
      alt: 'Stock tickers grouped under sector funds beside the candlestick chart, with money and rival positions on the desk.',
      lines: [
        <>Click a <strong>ticker</strong> to open its chart. Each candle shows one day. Green closed up, red closed down.</>,
        <>Sector funds track a group of companies. <strong>Total Market</strong> tracks the whole exchange.</>,
        <><strong>Your Money</strong> shows net worth. <strong>The Other Players</strong> shows rivals and their bets.</>,
      ],
    },
    {
      title: 'React to headlines',
      image: headline,
      alt: 'A newspaper clipping with a clickable ticker at the bottom.',
      lines: [
        <>Click a newspaper’s <strong>ticker</strong> to open the affected stock, sector fund, or total market.</>,
        <>News can take time to move prices. Even good news can push a price down.</>,
        <>Drag a clipping aside or click its <strong>×</strong> to dismiss it.</>,
      ],
    },
    {
      title: 'Read earnings',
      image: earnings,
      alt: 'Quarterly earnings report with clickable tickers and green beats and red misses.',
      lines: [
        <>A <strong>beat</strong> means profits topped expectations. A <strong>miss</strong> means they fell short.</>,
        <>Click a ticker during <strong>Briefing</strong> to line up your trade.</>,
        <>Place your bet once trading opens. Prices can react {gapDelay}.</>,
      ],
    },
    {
      title: 'Cards',
      image: cards,
      alt: 'Your Cards panel showing Up and Down choices and a list of rival buttons.',
      lines: [
        <>Click <strong>Buy</strong> in the shop between quarters to add a card to your hand.</>,
        <>Play it during <strong>Trading</strong>. Pick a stock or sector in the market list, or click a rival on the card.</>,
        <>Read the card to see what it does and whether it asks for <strong>▲ Up</strong> or <strong>▼ Down</strong>.</>,
      ],
    },
    {
      title: 'Understand SEC heat',
      image: jail,
      alt: 'SEC catch meter, jail banner, and a pending order countdown in the trading panel.',
      lines: [
        <>Illegal cards and moving stocks you hold can raise <strong>SEC heat</strong>.</>,
        <>If you played an illegal card, the meter shows your chance of a fine and jail at quarter-end.</>,
        <>In jail, you can hold {config.sec.jailHandLimit} {config.sec.jailHandLimit === 1 ? 'card' : 'cards'}. Orders wait {config.sec.jailOrderDelayMs / 1000}s and go through one at a time.</>,
      ],
    },
    {
      title: 'Manage risk',
      image: risk,
      alt: 'Your Money and a positions table showing a large losing bet and an open short.',
      lines: [
        <>Borrowed buying power lets you bet up to <strong>{config.trading.leverageCap}×</strong> net worth. It magnifies gains and losses.</>,
        <>Shorts cost a daily fee. In a <strong>margin call</strong>, the bank can close a position.</>,
        <>If net worth drops below <strong>{formatMoney(config.economy.eliminationEquity)}</strong>, you’re out.</>,
      ],
    },
  ];
}

export function HowToPlay() {
  const { config } = useGame();
  const slides = tutorialSlides(config);
  const [index, setIndex] = useState(0);
  const slide = slides[index]!;

  function move(offset: -1 | 1) {
    setIndex((current) => (current + offset + slides.length) % slides.length);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    move(event.key === 'ArrowLeft' ? -1 : 1);
  }

  return (
    <Panel title="How to play" className="lobby__panel tutorial">
      <div className="tutorial__deck" role="group" aria-label="Tutorial slides" tabIndex={0} onKeyDown={onKeyDown} data-testid="tutorial">
        <h3 className="tutorial__title" aria-live="polite">{slide.title}</h3>
        <div className="tutorial__image">
          <img src={slide.image} alt={slide.alt} width={840} height={472} draggable={false} />
        </div>
        <ul className="tutorial__lines">
          {slide.lines.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
        <nav className="tutorial__nav" aria-label="Tutorial slide navigation">
          <button className="game-button" type="button" onClick={() => move(-1)}>Back</button>
          <span aria-label={`Slide ${index + 1} of ${slides.length}`}>{index + 1} / {slides.length}</span>
          <button className="game-button tutorial__next" type="button" onClick={() => move(1)}>Next</button>
        </nav>
      </div>
    </Panel>
  );
}
