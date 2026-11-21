export function GameLogo() {
  return (
    <span className="game-logo">
      <svg className="game-logo__mark" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M5 33.5h30" />
        <rect x="7" y="22" width="6" height="9.5" rx="1" />
        <rect x="17" y="15" width="6" height="16.5" rx="1" />
        <rect x="27" y="7" width="6" height="24.5" rx="1" />
        <path d="m8 18 9-7 7 4 9-9" />
      </svg>
      <span>OLIGOPOLY</span>
    </span>
  );
}
