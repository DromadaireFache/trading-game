import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { FloorRoute } from './routes/FloorRoute.tsx';
import { PlayRoute } from './routes/PlayRoute.tsx';

/** /play = player laptop, /floor = projector, anything else -> /play. */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/play" element={<PlayRoute />} />
        <Route path="/floor" element={<FloorRoute />} />
        <Route path="*" element={<Navigate to="/play" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
