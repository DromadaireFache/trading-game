import { Panel, Placeholder } from '../../components/Panel.tsx';

/** PLACEHOLDER (results milestone): Quarter results go here. */
export function ResultsPanel({ className }: { className?: string }) {
  return (
    <Panel title="Results" aside="leaderboard / recap / arrests" className={className}>
      <Placeholder>Quarter results go here.</Placeholder>
    </Panel>
  );
}
