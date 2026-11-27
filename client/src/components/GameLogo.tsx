import wordLogo from '../assets/logo/oligopoly-word.png';

/** The game's candlestick wordmark. */
export function GameLogo() {
  return (
    <span className="game-logo">
      <img className="game-logo__img" src={wordLogo} alt="Oligopoly" draggable={false} />
    </span>
  );
}
