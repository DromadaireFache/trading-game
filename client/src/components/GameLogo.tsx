import letterO from '../assets/logo/O_oligopoly.png';
import letterL from '../assets/logo/L_oligopoly.png';
import letterI from '../assets/logo/I_oligopoly.png';
import letterG from '../assets/logo/G_oligopoly.png';
import letterP from '../assets/logo/P_oligopoly.png';
import letterY from '../assets/logo/Y_oligopoly.png';

const letters = [letterO, letterL, letterI, letterG, letterO, letterP, letterO, letterL, letterY];

/** The game's candlestick wordmark. */
export function GameLogo() {
  return (
    <span className="game-logo" role="img" aria-label="Oligopoly">
      <span className="game-logo__word">
        {letters.map((src, index) => (
          <img className="game-logo__letter" key={index} src={src} alt="" draggable={false} />
        ))}
      </span>
    </span>
  );
}
