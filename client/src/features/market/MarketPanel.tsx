import { useLayoutEffect, useRef } from 'react';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { useSelectedSymbol, useSymbols } from '../../net/marketHooks.ts';
import { reducedMotion } from '../fx/fx.ts';
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
  return (
    <Panel
      title="Pick a company"
      className={`market-list${className ? ` ${className}` : ''}`}
    >
      {symbols.length > 0 ? <SymbolList /> : <Placeholder>Waiting for market data...</Placeholder>}
    </Panel>
  );
}

function ChartPanel({ className }: { className?: string }) {
  const selected = useSelectedSymbol();
  const selectionRef = useRef<HTMLDivElement>(null);
  const previous = useRef(selected);

  useLayoutEffect(() => {
    const changed = previous.current !== null && previous.current !== selected;
    previous.current = selected;
    const selection = selectionRef.current;
    if (!changed || !selection || reducedMotion()) return;

    const chart = selection.querySelector('.chart');
    const name = selection.querySelector('.sym-head__id');
    const timing = { duration: 220, easing: 'ease-out' };
    const chartPop = chart?.animate([{ scale: '0.99' }, { scale: '1.018', offset: 0.35 }, { scale: '1' }], timing);
    const namePop = name?.animate([
      { scale: '0.98', transformOrigin: 'left center' },
      { scale: '1.08', offset: 0.35, transformOrigin: 'left center' },
      { scale: '1', transformOrigin: 'left center' },
    ], timing);
    return () => {
      chartPop?.cancel();
      namePop?.cancel();
    };
  }, [selected]);

  return (
    <Panel title="Price" className={`market-chart${className ? ` ${className}` : ''}`}>
      {selected === null ? (
        <Placeholder>Waiting for market data...</Placeholder>
      ) : (
        <div className="market-chart__selection" ref={selectionRef}>
          <SymbolHeader symbol={selected} />
          <CandleChart symbol={selected} />
        </div>
      )}
    </Panel>
  );
}
