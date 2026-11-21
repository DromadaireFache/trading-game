import { Panel, Placeholder } from '../../components/Panel.tsx';

/** PLACEHOLDER (cards milestone): Your cards go here. */
export function HandPanel({ className }: { className?: string }) {
  return (
    <Panel title="Hand" aside="max 3 cards" className={className}>
      <Placeholder>Your cards go here.</Placeholder>
    </Panel>
  );
}
