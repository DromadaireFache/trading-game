import { Panel, Placeholder } from '../../components/Panel.tsx';

/** PLACEHOLDER (milestone 3): Buy / sell with quick-size buttons goes here. */
export function OrderPanel({ className }: { className?: string }) {
  return (
    <Panel title="Order entry" aside="market orders" className={className}>
      <Placeholder>Buy / sell with quick-size buttons goes here.</Placeholder>
    </Panel>
  );
}
