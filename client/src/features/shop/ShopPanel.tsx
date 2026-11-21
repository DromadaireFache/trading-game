import { Panel, Placeholder } from '../../components/Panel.tsx';

/** PLACEHOLDER (cards milestone): Card offers go here. */
export function ShopPanel({ className }: { className?: string }) {
  return (
    <Panel title="Shop" aside="cards for next quarter" className={className}>
      <Placeholder>Card offers go here.</Placeholder>
    </Panel>
  );
}
