import { FloorView } from '../features/floor/FloorView.tsx';
import { GameProvider } from '../net/GameProvider.tsx';

/** /floor: the projector view. Joins as a spectator on its own, no input needed. */
export function FloorRoute() {
  return (
    <GameProvider role="spectator">
      <FloorView />
    </GameProvider>
  );
}
