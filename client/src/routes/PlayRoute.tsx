import type { Phase } from '@tg/shared';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { Panel } from '../components/Panel.tsx';
import { PhaseHeader } from '../components/PhaseHeader.tsx';
import { Roster } from '../components/Roster.tsx';
import { SeatTaken } from '../components/SeatTaken.tsx';
import { HandPanel } from '../features/cards/HandPanel.tsx';
import { HeadlinesPanel } from '../features/headlines/HeadlinesPanel.tsx';
import { JoinForm } from '../features/lobby/JoinForm.tsx';
import { LobbyView } from '../features/lobby/LobbyView.tsx';
import { MarketPanel } from '../features/market/MarketPanel.tsx';
import { FinalPanel } from '../features/results/FinalPanel.tsx';
import { ResultsPanel } from '../features/results/ResultsPanel.tsx';
import { ShopPanel } from '../features/shop/ShopPanel.tsx';
import { OrderPanel } from '../features/trading/OrderPanel.tsx';
import { PositionsPanel } from '../features/trading/PositionsPanel.tsx';
import { GameProvider, useGame } from '../net/GameProvider.tsx';

/** /play: the player's laptop view. */
export function PlayRoute() {
  return (
    <GameProvider role="player">
      <PlayScreen />
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

/**
 * The trading desk grid. The big "stage" slot follows the phase: market during the quarter,
 * results / shop / final between and after quarters. The side panels stay put.
 */
function Desk({ phase }: { phase: Phase }) {
  const { lobby, me } = useGame();
  return (
    <main className="desk">
      <div className="desk__errors">
        <ErrorBanner />
      </div>
      <Stage phase={phase} />
      <HeadlinesPanel className="desk__headlines" />
      <OrderPanel className="desk__order" />
      <PositionsPanel className="desk__positions" />
      <HandPanel className="desk__hand" />
      <Panel title="Players" className="desk__players">
        <Roster lobby={lobby} meId={me?.playerId} />
      </Panel>
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
      return <MarketPanel className="desk__stage" />;
  }
}
