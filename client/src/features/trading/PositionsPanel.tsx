import { Panel, Placeholder } from '../../components/Panel.tsx';

/** PLACEHOLDER (milestone 3): Your portfolio goes here. */
export function PositionsPanel({ className }: { className?: string }) {
  return (
    <Panel title="Positions" aside="cash / equity / P&L" className={className}>
      <Placeholder>Your portfolio goes here.</Placeholder>
    </Panel>
  );
}
