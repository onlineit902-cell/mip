'use client';

import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../vendor/engine/src';

export interface ChartMarker {
  time: number; // ms
  kind: 'bos' | 'choch' | 'swing_high' | 'swing_low';
  direction?: 'up' | 'down';
  text: string;
}

export interface ChartPriceLine {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
}

interface Props {
  candles: Candle[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  ema200: (number | null)[];
  markers: ChartMarker[];
  priceLines: ChartPriceLine[];
  decimals: number;
}

const toTs = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

function themeColors() {
  const light = document.documentElement.dataset.theme === 'light';
  return {
    text: light ? '#5c6a82' : '#8d99ae',
    grid: light ? 'rgba(20,28,43,0.06)' : 'rgba(230,234,242,0.05)',
    border: light ? '#d9e0ec' : '#223047',
    up: '#22c55e',
    down: '#ef4444',
  };
}

export default function CandleChart({ candles, ema20, ema50, ema200, markers, priceLines, decimals }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const priceLineRefs = useRef<{ price: number }[]>([]);
  const markersRef = useRef<{ setMarkers: (m: any[]) => void } | null>(null);

  // create once
  useEffect(() => {
    if (!ref.current) return;
    const c = themeColors();
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: c.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: c.grid },
        horzLines: { color: c.grid },
      },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const minMove = Math.pow(10, -decimals);
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down,
      borderVisible: false,
      priceFormat: { type: 'price', precision: decimals, minMove },
    });
    candleSeriesRef.current = cs;

    const mkLine = (color: string, width: 1 | 2) =>
      chart.addSeries(LineSeries, {
        color, lineWidth: width, priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: { type: 'price', precision: decimals, minMove },
      });
    lineRefs.current = [mkLine('#3b82f6', 1), mkLine('#f59e0b', 1), mkLine('#8b5cf6', 2)];

    markersRef.current = createSeriesMarkers(cs, []);

    const mo = new MutationObserver(() => {
      const t = themeColors();
      chart.applyOptions({
        layout: { textColor: t.text },
        grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
        rightPriceScale: { borderColor: t.border },
        timeScale: { borderColor: t.border },
      });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      mo.disconnect();
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decimals]);

  // update data
  useEffect(() => {
    const cs = candleSeriesRef.current;
    if (!cs || !chartRef.current) return;

    cs.setData(
      candles.map((k) => ({ time: toTs(k.ts), open: k.open, high: k.high, low: k.low, close: k.close })),
    );

    const setLine = (series: ISeriesApi<'Line'> | undefined, values: (number | null)[]) => {
      if (!series) return;
      const data = values
        .map((v, i) => (v == null ? null : { time: toTs(candles[i]!.ts), value: v }))
        .filter((x): x is NonNullable<typeof x> => x != null);
      series.setData(data);
    };
    setLine(lineRefs.current[0], ema20);
    setLine(lineRefs.current[1], ema50);
    setLine(lineRefs.current[2], ema200);

    // markers
    const ms = markers
      .map((m) => {
        const base = { time: toTs(m.time), text: m.text };
        if (m.kind === 'bos' || m.kind === 'choch') {
          const up = m.direction === 'up';
          return {
            ...base,
            position: (up ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
            color: m.kind === 'bos' ? (up ? '#22c55e' : '#ef4444') : '#f59e0b',
            shape: (up ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
            size: 1,
          };
        }
        const isHigh = m.kind === 'swing_high';
        return {
          ...base,
          position: (isHigh ? 'aboveBar' : 'belowBar') as 'belowBar' | 'aboveBar',
          color: '#5c6a82',
          shape: (isHigh ? 'circle' : 'circle') as 'circle',
          size: 0,
        };
      })
      .sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current?.setMarkers(ms);

    // price lines
    for (const pl of priceLineRefs.current) cs.removePriceLine(pl as any);
    priceLineRefs.current = priceLines.slice(0, 12).map((pl) =>
      cs.createPriceLine({
        price: pl.price,
        color: pl.color,
        lineWidth: 1,
        lineStyle: pl.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: pl.title,
      }) as unknown as { price: number },
    );

    chartRef.current.timeScale().fitContent();
  }, [candles, ema20, ema50, ema200, markers, priceLines]);

  return <div ref={ref} style={{ position: 'absolute', inset: 0 }} />;
}
