import { Panel, Placeholder } from '../../components/Panel.tsx';
import { useSelectedSymbol, useSymbols } from '../../net/marketHooks.ts';
import { CandleChart } from './CandleChart.tsx';
import { SymbolHeader } from './SymbolHeader.tsx';
import { SymbolList } from './SymbolList.tsx';
import './market.css';

interface MarketPanelProps {
  /** Grid-area classes of the two panels in the desk layout. */
  listClassName?: string;
  chartClassName?: string;
}

/** The market on /play: the symbol list panel and the chart panel of the selected symbol. */
export function MarketPanel({ listClassName, chartClassName }: MarketPanelProps) {
  return (
    <>
      <SymbolListPanel className={listClassName} />
      <ChartPanel className={chartClassName} />
    </>
  );
}

function SymbolListPanel({ className }: { className?: string }) {
  const symbols = useSymbols();
  const stocks = symbols.filter((s) => s.kind === 'stock').length;
  return (
    <Panel
      title="Pick a stock"
      aside={symbols.length > 0 ? `${stocks} companies, ${symbols.length - stocks} funds · % = change this quarter` : undefined}
      className={`market-list${className ? ` ${className}` : ''}`}
    >
      {symbols.length > 0 ? <SymbolList /> : <Placeholder>Waiting for market data...</Placeholder>}
    </Panel>
  );
}

function ChartPanel({ className }: { className?: string }) {
  const selected = useSelectedSymbol();
  return (
    <Panel title="Price" aside="1 candle = 1 day: green went up, red went down" className={`market-chart${className ? ` ${className}` : ''}`}>
      {selected === null ? (
        <Placeholder>Waiting for market data...</Placeholder>
      ) : (
        <>
          <SymbolHeader symbol={selected} />
          <CandleChart symbol={selected} />
        </>
      )}
    </Panel>
  );
}
