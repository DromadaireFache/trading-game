import { Panel, Placeholder } from '../../components/Panel.tsx';

/** PLACEHOLDER (milestone 2): Symbol grid and candle chart go here. */
export function MarketPanel({ className }: { className?: string }) {
  return (
    <Panel title="Market" aside="50 stocks / 11 funds" className={className}>
      <Placeholder>Symbol grid and candle chart go here.</Placeholder>
    </Panel>
  );
}
