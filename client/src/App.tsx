import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { FloorRoute } from './routes/FloorRoute.tsx';
import { PlayRoute } from './routes/PlayRoute.tsx';

/** /play = player laptop, /floor = projector (online: /play/ABCD, /floor/ABCD), anything else -> /play. */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/play/:room?" element={<PlayRoute />} />
        <Route path="/floor/:room?" element={<FloorRoute />} />
        <Route path="*" element={<Navigate to="/play" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
