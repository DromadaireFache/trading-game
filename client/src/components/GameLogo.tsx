import fullLogo from '../assets/logo/oligopoly.png';
import wordLogo from '../assets/logo/oligopoly-word.png';

/**
 * The game's logo: OLIGOPOLY spelled in green and red candlesticks. `word` is the word alone (header,
 * projector bar); `full` adds the "THE STOCK TRADING GAME" line (join screen, lobby, projector lobby).
 */
export function GameLogo({ variant = 'word' }: { variant?: 'word' | 'full' }) {
  return (
    <span className={`game-logo game-logo--${variant}`}>
      <img className="game-logo__img" src={variant === 'full' ? fullLogo : wordLogo} alt="Oligopoly" draggable={false} />
    </span>
  );
}
