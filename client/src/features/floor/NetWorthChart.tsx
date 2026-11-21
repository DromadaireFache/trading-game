import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ColorType, LineSeries, LineStyle, createChart } from 'lightweight-charts';
import type { IPrimitivePaneRenderer, Logical, Time, UTCTimestamp } from 'lightweight-charts';
import type { GameConfig, LobbyPlayer, NetWorthMsg, NetWorthSample, PlayerId } from '@tg/shared';
import { chartTimeToDay, dayToChartTime, formatAxisDay, formatGameDay } from '../../lib/chartTime.ts';
import { formatMoney } from '../../lib/format.ts';
import { useGameClient } from '../../net/GameProvider.tsx';
import { theme } from '../../theme.ts';
import { reducedMotion } from '../fx/fx.ts';

const VISIBLE_DAYS = 30;
const SECONDS_PER_DAY = 86_400;
const COLORS = [theme.color.accent, theme.color.info, theme.color.up, theme.color.sectorHealth, theme.color.sectorFinance, theme.color.warn] as const;
const playerColor = (index: number) => COLORS[index % COLORS.length]!;
const interpolate = (from: number, to: number, progress: number) => from + (to - from) * progress;

interface WorthRange {
  from: number;
  to: number;
}

function fitWorthRange(samples: readonly NetWorthSample[]): WorthRange | null {
  let min = Infinity;
  let max = -Infinity;
  for (const sample of samples) {
    for (const value of Object.values(sample.equity)) {
      if (!Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  if (min > max) return null;
  // Fit the recent paths and every current balance. Keep a little room when balances tie.
  const padding = Math.max(1, (max - min) * 0.12, Math.max(Math.abs(min), Math.abs(max)) * 0.001);
  return { from: min - padding, to: max + padding };
}

export function NetWorthChart({ players, config }: { players: readonly LobbyPlayer[]; config: GameConfig }) {
  const { netWorth } = useGameClient();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ticksPerDay = config.time.ticksPerCandle;
    const openingTime = dayToChartTime(config, 0) - SECONDS_PER_DAY;
    const timeOf = (tick: number): UTCTimestamp => {
      if (tick === 0) return openingTime as UTCTimestamp;
      const day = Math.floor((tick - 1) / ticksPerDay);
      const ticksUntilClose = (day + 1) * ticksPerDay - tick;
      return (dayToChartTime(config, day) - SECONDS_PER_DAY * (ticksUntilClose / ticksPerDay)) as UTCTimestamp;
    };
    const label = (time: Time, formatter: typeof formatGameDay) => {
      if (time === openingTime) return 'Start';
      const closeTime = Math.ceil(Number(time) / SECONDS_PER_DAY) * SECONDS_PER_DAY;
      return formatter(config, chartTimeToDay(config, closeTime));
    };
    const chart = createChart(container, {
      autoSize: true,
      handleScroll: false,
      handleScale: false,
      layout: {
        background: { type: ColorType.Solid, color: theme.color.bgInset },
        textColor: theme.color.textDim,
        fontFamily: theme.font.mono,
        fontSize: 18,
      },
      grid: { vertLines: { color: theme.color.border }, horzLines: { color: theme.color.border } },
      rightPriceScale: { borderColor: theme.color.border, scaleMargins: { top: 0.06, bottom: 0.06 } },
      timeScale: {
        borderColor: theme.color.border,
        shiftVisibleRangeOnNewBar: false,
        lockVisibleTimeRangeOnResize: true,
        minBarSpacing: 0.01,
        tickMarkFormatter: (time: Time) => Number(time) % SECONDS_PER_DAY === 0 ? label(time, formatAxisDay) : '',
      },
      localization: { timeFormatter: (time: Time) => label(time, formatGameDay) },
    });
    const timeScale = chart.timeScale();
    const finalTick = config.time.quarters * config.time.daysPerQuarter * ticksPerDay;
    const openingWindow = Math.min(5 * ticksPerDay, finalTick);
    const historyTicks = VISIBLE_DAYS * ticksPerDay;
    // Reserve the opening days on the axis so a flat balance visibly travels from the opening bell.
    const timeline = chart.addSeries(LineSeries, { priceScaleId: '', lastValueVisible: false, priceLineVisible: false });
    timeline.setData(Array.from({ length: openingWindow + 1 }, (_, tick) => ({ time: timeOf(tick) })));
    const series = players.map(({ id }, i) => {
      const color = playerColor(i);
      const line = chart.addSeries(LineSeries, {
        color,
        lineWidth: 3,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: 'custom', formatter: (value: number) => formatMoney(value), minMove: 1 },
      });
      return { id, line, color };
    });
    const priceScale = chart.priceScale('right');
    let lastSample: NetWorthSample | undefined;
    let settledTick = -1;
    let shownTick = 0;
    let shownValues: NetWorthSample['equity'] = {};
    let shownRange: WorthRange | null = null;
    let shownWindow: { from: number; to: number } | undefined;
    let frame: number | null = null;
    let redrawTip = () => {};

    // The chart spaces observations at whole logical indices. Draw just the unfinished segment
    // between neighboring tick coordinates; the native line takes it over as soon as the tick lands.
    const tipRenderer: IPrimitivePaneRenderer = {
      draw(target) {
        const anchor = netWorth.getSamples()[settledTick];
        if (!anchor) return;
        const left = timeScale.logicalToCoordinate(settledTick as Logical);
        const right = timeScale.logicalToCoordinate((settledTick + 1) as Logical);
        if (left === null || right === null) return;
        const x = interpolate(left, right, shownTick - settledTick);
        target.useMediaCoordinateSpace(({ context }) => {
          context.setLineDash([]);
          for (const { id, line, color } of series) {
            const value = shownValues[id];
            const base = anchor.equity[id];
            if (value === undefined || base === undefined) continue;
            const y = line.priceToCoordinate(value);
            const baseY = line.priceToCoordinate(base);
            if (y === null || baseY === null) continue;
            context.strokeStyle = context.fillStyle = color;
            context.lineWidth = 3;
            if (shownTick > settledTick) {
              context.beginPath();
              context.moveTo(left, baseY);
              context.lineTo(x, y);
              context.stroke();
            }
            context.beginPath();
            context.arc(x, y, 2, 0, 2 * Math.PI);
            context.fill();
          }
        });
      },
    };
    const tipViews = [{ renderer: () => tipRenderer }];
    // Attach to the last series so its neighbors' paths cannot cover their live tips.
    series.at(-1)?.line.attachPrimitive({
      attached: ({ requestUpdate }) => { redrawTip = requestUpdate; },
      paneViews: () => tipViews,
    });

    const draw = (msg?: NetWorthMsg) => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const samples = netWorth.getSamples();
      const latest = samples.at(-1);
      const previous = lastSample;
      lastSample = latest;
      const rebuild = !previous || !latest || msg?.reset || msg?.samples.length !== 1 || latest.tick > previous.tick + 1;
      if (rebuild) {
        for (const { id, line } of series) {
          line.setData(samples.map(({ tick, equity }) => {
            const value = equity[id];
            return value === undefined ? { time: timeOf(tick) } : { time: timeOf(tick), value };
          }));
        }
        settledTick = latest?.tick ?? -1;
      }
      container.dataset.day = String(latest ? Math.ceil(latest.tick / ticksPerDay) : 0);
      const targetRange = fitWorthRange(samples.slice(-(historyTicks + 1)));
      if (!latest || !targetRange) return;

      if (!rebuild && previous && previous.tick === settledTick && latest.tick > settledTick) {
        // A new trading tick can interrupt an animation of a purchase at the preceding close.
        for (const { id, line } of series) {
          const value = previous.equity[id];
          if (value !== undefined && value !== shownValues[id]) line.update({ time: timeOf(settledTick), value });
        }
      }
      const startTick = shownTick;
      const startRange = shownRange ?? targetRange;
      const correction = !rebuild && startTick === latest.tick;
      const startValues = shownValues;
      const paint = (progress: number) => {
        shownTick = progress === 1 ? latest.tick : interpolate(startTick, latest.tick, progress);
        const anchor = samples[Math.floor(shownTick)]!;
        while (settledTick < anchor.tick) {
          const sample = samples[++settledTick]!;
          for (const { id, line } of series) {
            const value = sample.equity[id];
            if (value !== undefined) line.update({ time: timeOf(sample.tick), value });
          }
        }
        const next = samples[Math.ceil(shownTick)]!;
        const values: Record<PlayerId, number> = {};
        for (const { id, line } of series) {
          const to = next.equity[id];
          if (to === undefined) continue;
          if (correction) {
            values[id] = progress === 1 ? to : interpolate(startValues[id] ?? to, to, progress);
            line.update({ time: timeOf(latest.tick), value: values[id] });
          } else {
            values[id] = interpolate(anchor.equity[id] ?? to, to, shownTick - anchor.tick);
          }
        }
        shownValues = values;
        const range = progress === 1 ? targetRange : {
          from: interpolate(startRange.from, targetRange.from, progress),
          to: interpolate(startRange.to, targetRange.to, progress),
        };
        if (range.from !== shownRange?.from || range.to !== shownRange?.to) {
          priceScale.setVisibleRange(range);
          shownRange = range;
        }
        const from = Math.max(0, shownTick - historyTicks) - 0.5;
        const to = Math.max(openingWindow, Math.min(finalTick, shownTick + ticksPerDay / 2)) + 0.5;
        if (rebuild || shownWindow?.from !== from || shownWindow.to !== to) {
          shownWindow = { from, to };
          timeScale.setVisibleLogicalRange(shownWindow);
        }
        redrawTip();
      };

      if (!rebuild && !reducedMotion()) {
        const startedAt = performance.now();
        const animate = (now: number) => {
          const progress = Math.min(1, Math.max(0, (now - startedAt) / config.time.tickMs));
          paint(progress);
          frame = progress < 1 ? requestAnimationFrame(animate) : null;
        };
        frame = requestAnimationFrame(animate);
      } else {
        paint(1);
      }
    };
    draw();
    const unsubscribe = netWorth.subscribe(draw);
    return () => {
      unsubscribe();
      if (frame !== null) cancelAnimationFrame(frame);
      chart.remove();
    };
  }, [config, netWorth, players]);

  return (
    <section className="floor__net-worth" aria-label="Player net worth">
      <h2 className="floor__net-worth-title">Player net worth</h2>
      <div ref={containerRef} className="floor__net-worth-chart" role="img" aria-label="Net worth by trading day" data-testid="net-worth-chart" />
    </section>
  );
}

export function NetWorthStandings({ players }: { players: readonly LobbyPlayer[] }) {
  const { netWorth } = useGameClient();
  const latest = useSyncExternalStore(netWorth.subscribe, () => netWorth.getSamples().at(-1));
  const ranked = players.map((player, index) => ({ ...player, color: playerColor(index), equity: latest?.equity[player.id] }));
  ranked.sort((a, b) => (b.equity ?? -Infinity) - (a.equity ?? -Infinity));
  return (
    <ol className="floor-worth" aria-label="Current player standings">
      {ranked.map(({ id, name, connected, color, equity }) => (
        <li className="floor-worth__player" key={id} data-testid="net-worth-player" data-player={id}>
          <div className="floor-worth__name">
            <span className="floor-worth__swatch" style={{ backgroundColor: color }} aria-hidden="true" />
            <span>{name}</span>
            {!connected && <small className="floor-worth__offline">Offline</small>}
          </div>
          <strong className="floor-worth__value" data-testid="net-worth-value">{equity === undefined ? '—' : formatMoney(equity)}</strong>
        </li>
      ))}
    </ol>
  );
}
