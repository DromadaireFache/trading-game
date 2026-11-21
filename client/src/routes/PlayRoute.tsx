import type { Phase } from '@tg/shared';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { PhaseHeader } from '../components/PhaseHeader.tsx';
import { SeatTaken } from '../components/SeatTaken.tsx';
import { EarningsPanel } from '../features/headlines/EarningsPanel.tsx';
import { HandPanel } from '../features/cards/HandPanel.tsx';
import { JoinForm } from '../features/lobby/JoinForm.tsx';
import { LobbyView } from '../features/lobby/LobbyView.tsx';
import { MarketPanel } from '../features/market/MarketPanel.tsx';
import { FinalPanel } from '../features/results/FinalPanel.tsx';
import { ResultsPanel } from '../features/results/ResultsPanel.tsx';
import { ShopPanel } from '../features/shop/ShopPanel.tsx';
import { OrderPanel } from '../features/trading/OrderPanel.tsx';
import { MoneyPanel, PositionsPanel } from '../features/trading/PositionsPanel.tsx';
import { NewsPile } from '../features/news/NewsPile.tsx';
import { RivalsPanel } from '../features/rivals/RivalsPanel.tsx';
import { FxRoot } from '../features/fx/FxLayer.tsx';
import { GameFx } from '../features/fx/GameFx.tsx';
import { GameProvider, useGame } from '../net/GameProvider.tsx';

/** /play: the player's laptop view. */
export function PlayRoute() {
  return (
    <GameProvider role="player">
      <FxRoot>
        <PlayScreen />
        <GameFx role="player" />
      </FxRoot>
    </GameProvider>
  );
}

function PlayScreen() {
  const { me, phase, replaced } = useGame();

  // Another tab holds this seat now: show that and nothing live-looking.
  if (replaced) return <SeatTaken />;

  // Not joined yet (or the stored session was refused): name entry.
  if (!me) return <JoinForm />;

  const current = phase?.phase ?? 'LOBBY';
  return (
    <div className="play" data-testid="play">
      <PhaseHeader />
      {current === 'LOBBY' ? <LobbyView /> : <Desk phase={current} />}
    </div>
  );
}

/** Phases in which the stage slot shows a full panel instead of the market (list + chart). */
const STAGE_PHASES: readonly Phase[] = ['RESULTS', 'SHOP', 'FINAL'];

/**
 * The trading desk grid. The stock list and the chart; on the right your bet buttons, your money and
 * your cards, with the headline papers piled messily over the cards (click one to open its stock).
 * At the bottom: the other players' positions, then yours. Between and after quarters one "stage"
 * panel (results / shop / final) takes the place of everything but the right column.
 */
function Desk({ phase }: { phase: Phase }) {
  const stage = STAGE_PHASES.includes(phase);
  return (
    <main className={`desk${stage ? ' desk--stage' : ''}${phase === 'FINAL' ? ' desk--final' : ''}`}>
      <div className="desk__errors">
        <ErrorBanner />
      </div>
      <Stage phase={phase} />
      <div className="desk__earnings">
        <EarningsPanel />
      </div>
      <div className="desk__side">
        <OrderPanel className="desk__order" />
        <MoneyPanel className="desk__money" />
        <HandPanel className="desk__hand" />
        {!stage && <NewsPile />}
      </div>
      {!stage && <RivalsPanel className="desk__rivals" />}
      {!stage && <PositionsPanel className="desk__positions" />}
    </main>
  );
}

function Stage({ phase }: { phase: Phase }) {
  switch (phase) {
    case 'RESULTS':
      return <ResultsPanel className="desk__stage" />;
    case 'SHOP':
      return <ShopPanel className="desk__stage" />;
    case 'FINAL':
      return <FinalPanel className="desk__stage" />;
    default:
      return <MarketPanel listClassName="desk__list" chartClassName="desk__chart" />;
  }
}
