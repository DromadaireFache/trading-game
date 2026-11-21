/**
 * Daily candle chart of one symbol (lightweight-charts).
 *
 * Drawn outside React: the component only owns the container; history comes from the MarketStore
 * (so it survives a refresh through the `market` snapshot) and the last candle follows the store's
 * feed at 10 Hz without a single re-render. Colors and fonts come from theme.ts.
 *
 * The time axis shows game time ("Q2", "D31"; crosshair "Q2 D17"), see lib/chartTime.ts.
 * Framing: the chart always starts a quarter with that whole quarter in view (plus a tail of the
 * previous one), so the candles fill the frame from left to right as the quarter plays out.
 * Scrolling and zooming stay free until the next quarter starts.
 */
import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart } from 'lightweight-charts';
import type { CandlestickData, IChartApi, ISeriesApi, Time, UTCTimestamp } from 'lightweight-charts';
import { CANDLE_FIELDS, candleAt, candleCount, dayToQuarter, quarterFirstDay } from '@tg/shared';
import type { GameConfig, OHLC, SymbolId } from '@tg/shared';
import { chartTimeToDay, dayToChartTime, formatAxisDay, formatGameDay } from '../../lib/chartTime.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { useMarketStore } from '../../net/marketHooks.ts';
import type { MarketStore } from '../../net/marketStore.ts';
import { theme } from '../../theme.ts';

/** Share of a quarter shown as context to the left of the current quarter. */
const PREVIOUS_QUARTER_CONTEXT = 1 / 3;
/** Axis font size in px per size variant. */
const FONT_SIZE = { normal: 11, large: 20 } as const;

interface CandleChartProps {
  symbol: SymbolId | null;
  /** large = projector. */
  size?: keyof typeof FONT_SIZE;
  className?: string;
}

interface ChartHandle {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
}

export function CandleChart({ symbol, size = 'normal', className }: CandleChartProps) {
  const market = useMarketStore();
  const { config } = useGame();
  const containerRef = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<ChartHandle | null>(null);
  const { priceDecimals } = config.market;

  // The chart itself: created once per container / config, resizes with the container (autoSize).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const toDay = (time: Time) => chartTimeToDay(config, time as number);
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme.color.bgInset },
        textColor: theme.color.textDim,
        fontFamily: theme.font.mono,
        fontSize: FONT_SIZE[size],
      },
      grid: {
        vertLines: { color: theme.color.border },
        horzLines: { color: theme.color.border },
      },
      crosshair: {
        vertLine: { color: theme.color.borderStrong, labelBackgroundColor: theme.color.panelRaised },
        horzLine: { color: theme.color.borderStrong, labelBackgroundColor: theme.color.panelRaised },
      },
      rightPriceScale: { borderColor: theme.color.border },
      timeScale: {
        borderColor: theme.color.border,
        // We frame the quarter ourselves; new bars must not push the frame along.
        shiftVisibleRangeOnNewBar: false,
        tickMarkFormatter: (time: Time) => formatAxisDay(config, toDay(time)),
      },
      localization: {
        locale: 'en-US',
        timeFormatter: (time: Time) => formatGameDay(config, toDay(time)),
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: theme.color.up,
      downColor: theme.color.down,
      wickUpColor: theme.color.up,
      wickDownColor: theme.color.down,
      borderVisible: false,
      priceLineColor: theme.color.textDim,
      priceFormat: { type: 'price', precision: priceDecimals, minMove: 10 ** -priceDecimals },
    });
    setHandle({ chart, series });
    return () => {
      setHandle(null);
      chart.remove();
    };
  }, [config, size, priceDecimals]);

  // The data: full history on (re)select and on every snapshot, then incremental updates.
  useEffect(() => {
    const container = containerRef.current;
    if (!handle || !container) return;
    const { chart, series } = handle;
    let framedQuarter = -1;

    const publish = () => {
      // For the e2e and for debugging: how much the chart currently shows.
      container.dataset.symbol = symbol ?? '';
      container.dataset.candles = String(symbol === null ? 0 : market.getLastDay() + 1);
    };

    const frame = (force: boolean) => {
      const lastDay = market.getLastDay();
      if (lastDay < 0) return;
      const quarter = dayToQuarter(config, lastDay);
      if (!force && quarter === framedQuarter) return;
      framedQuarter = quarter;
      const first = quarterFirstDay(config, quarter);
      const context = Math.floor(config.time.daysPerQuarter * PREVIOUS_QUARTER_CONTEXT);
      // Logical index == day (history starts at day 0 and has no holes); half a bar of margin each side.
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, first - context) - 0.5,
        to: first + config.time.daysPerQuarter - 0.5,
      });
    };

    const redraw = () => {
      series.setData(symbol === null ? [] : buildData(market, config, symbol));
      frame(true);
      publish();
    };

    const update = (day: number, candle: OHLC | undefined) => {
      if (!candle) return;
      try {
        series.update(toBar(config, day, candle));
      } catch {
        // The library refuses updates older than its last bar; fall back to a full redraw.
        redraw();
        return;
      }
      frame(false);
      publish();
    };

    redraw();
    return market.subscribeFeed((event) => {
      if (event.kind === 'reset' || symbol === null) redraw();
      else if (event.kind === 'tick') update(event.day, market.getLiveCandle(symbol)?.candle);
      else update(event.day, candleAt(market.getClosedCandles(symbol), event.day));
    });
  }, [handle, market, config, symbol]);

  return <div ref={containerRef} className={`chart${className ? ` ${className}` : ''}`} data-testid="chart" />;
}

function toBar(config: GameConfig, day: number, candle: OHLC): CandlestickData<Time> {
  return {
    time: dayToChartTime(config, day) as UTCTimestamp,
    open: candle.o,
    high: candle.h,
    low: candle.l,
    close: candle.c,
  };
}

function buildData(market: MarketStore, config: GameConfig, symbol: SymbolId): CandlestickData<Time>[] {
  const flat = market.getClosedCandles(symbol);
  const count = candleCount(flat);
  const data: CandlestickData<Time>[] = new Array(count);
  for (let day = 0; day < count; day++) {
    const i = day * CANDLE_FIELDS;
    data[day] = {
      time: dayToChartTime(config, day) as UTCTimestamp,
      open: flat[i]!,
      high: flat[i + 1]!,
      low: flat[i + 2]!,
      close: flat[i + 3]!,
    };
  }
  const live = market.getLiveCandle(symbol);
  if (live && live.day >= count) data.push(toBar(config, live.day, live.candle));
  return data;
}
