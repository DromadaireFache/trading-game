import { Panel, Placeholder } from '../../components/Panel.tsx';

/** PLACEHOLDER (results milestone): Final standings and awards go here. */
export function FinalPanel({ className }: { className?: string }) {
  return (
    <Panel title="Final" aside="leaderboard / awards" className={className}>
      <Placeholder>Final standings and awards go here.</Placeholder>
    </Panel>
  );
}
