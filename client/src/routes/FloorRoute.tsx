import { FloorView } from '../features/floor/FloorView.tsx';
import { FxRoot } from '../features/fx/FxLayer.tsx';
import { GameFx } from '../features/fx/GameFx.tsx';
import { ConnectGate } from './ConnectGate.tsx';

/** /floor: the projector view. Joins as a spectator on its own (online: /floor/ABCD, or type the code). */
export function FloorRoute() {
  return (
    <ConnectGate role="spectator" path="/floor">
      <FxRoot>
        <FloorView />
        <GameFx role="spectator" />
      </FxRoot>
    </ConnectGate>
  );
}
