import { Link } from 'react-router-dom';
import { useNetTarget } from '../net/NetTarget.tsx';

/** Switch views while keeping the current online room, if any. */
export function ViewLink({ to }: { to: 'play' | 'floor' }) {
  const { room } = useNetTarget();
  return (
    <Link className="btn btn--ghost view-link" to={`/${to}${room ? `/${room}` : ''}`}>
      {to === 'floor' ? 'Trading floor' : 'Back to play'}
    </Link>
  );
}
