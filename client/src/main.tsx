/**
 * Client entry point.
 *
 * Folder map (keep to it so parallel work does not collide):
 *   theme.ts        ALL colors and fonts -> CSS variables
 *   styles/         global CSS (variables only, no literal colors)
 *   net/            websocket client, store, session token, React provider/hooks
 *   lib/, hooks/    pure helpers and shared hooks
 *   components/     generic building blocks (Panel, PhaseHeader, Roster, ...)
 *   features/<x>/   one folder per game feature (lobby, market, trading, headlines, cards, shop, results, floor)
 *   routes/         /play and /floor screens: layout only, they compose features
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyTheme } from './theme.ts';
import './styles/fonts.css';
import './styles/global.css';
import './styles/look.css';

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
