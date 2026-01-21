import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickSeries, createChart } from 'lightweight-charts';
import { fetchJson } from '../utils/api.js';

const TIMEFRAMES = ['M1', 'M15', 'H1', 'H4', 'D1'];

const timeframeToMs = (tf) => {
  const label = String(tf || '')
    .trim()
    .toUpperCase();
  switch (label) {
    case 'M1':
      return 60 * 1000;
    case 'M15':
      return 15 * 60 * 1000;
    case 'H1':
      return 60 * 60 * 1000;
    case 'H4':
      return 4 * 60 * 60 * 1000;
    case 'D1':
      return 24 * 60 * 60 * 1000;
    default:
      return null;
  }
};

const quoteToPrice = (quote) => {
  if (!quote || typeof quote !== 'object') {
    return null;
  }
  const bid = Number(quote.bid);
  const ask = Number(quote.ask);
  const last = Number(quote.last);
  if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }
  if (Number.isFinite(last) && last > 0) {
    return last;
  }
  if (Number.isFinite(bid) && bid > 0) {
    return bid;
  }
  if (Number.isFinite(ask) && ask > 0) {
    return ask;
  }
  return null;
};

const toSeconds = (epochMs) => {
  const value = Number(epochMs);
  if (!Number.isFinite(value)) {
    return null;
  }
  // Accept seconds or milliseconds.
  return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
};

const normalizeBars = (bars) => {
  const list = Array.isArray(bars) ? bars : [];
  const mapped = list
    .map((bar) => {
      if (!bar || typeof bar !== 'object') {
        return null;
      }
      const time = toSeconds(bar.time ?? bar.timestamp ?? bar.t);
      const open = Number(bar.open ?? bar.o);
      const high = Number(bar.high ?? bar.h);
      const low = Number(bar.low ?? bar.l);
      const close = Number(bar.close ?? bar.c);

      if (
        time == null ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        return null;
      }
      return { time, open, high, low, close };
    })
    .filter(Boolean);

  // Backend returns newest-first; chart expects ascending.
  mapped.sort((a, b) => Number(a.time) - Number(b.time));
  return mapped;
};

export default function CandleHistoryChart({
  brokerId,
  symbol,
  refreshKey,
  liveQuote,
  height = 240
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const liveCandleRef = useRef(null);
  const inflightRef = useRef(null); // { key, controller }
  const lastFetchStartedAtRef = useRef(0);

  const [timeframe, setTimeframe] = useState('M15');
  const [status, setStatus] = useState({ loading: false, error: null, count: 0 });

  const symbolUpper = useMemo(
    () =>
      String(symbol || '')
        .trim()
        .toUpperCase(),
    [symbol]
  );

  const makeLoadKey = useCallback(() => {
    const broker = String(brokerId || '').trim();
    const sym = String(symbolUpper || '')
      .trim()
      .toUpperCase();
    const tf = String(timeframe || '')
      .trim()
      .toUpperCase();
    if (!broker || !sym || !tf) {
      return null;
    }
    return `${broker}|${sym}|${tf}`;
  }, [brokerId, symbolUpper, timeframe]);

  const abortInflight = useCallback(() => {
    try {
      inflightRef.current?.controller?.abort?.();
    } catch (_error) {
      // ignore
    }
    inflightRef.current = null;
  }, []);

  const loadCandles = useCallback(
    async ({ reason } = {}) => {
      const series = seriesRef.current;
      if (!series) {
        return;
      }

      const key = makeLoadKey();
      if (!key) {
        series.setData([]);
        setStatus({ loading: false, error: null, count: 0 });
        return;
      }

      const url = `/api/broker/bridge/${brokerId}/market/candles?symbol=${encodeURIComponent(
        symbolUpper
      )}&timeframe=${encodeURIComponent(timeframe)}&limit=300&maxAgeMs=0`;

      // Avoid spamming the backend (and triggering lots of aborts) when refreshKey changes rapidly.
      const now = Date.now();
      const minReloadMs = 2500;
      const inflight = inflightRef.current;
      if (inflight?.key === key) {
        // Already fetching this exact symbol/timeframe.
        return;
      }
      if (reason === 'refresh' && now - lastFetchStartedAtRef.current < minReloadMs) {
        return;
      }

      const controller = new AbortController();
      inflightRef.current = { key, controller };
      lastFetchStartedAtRef.current = now;

      setStatus((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const response = await fetchJson(url, { signal: controller.signal });

        const bars =
          response?.candles ||
          response?.data?.candles ||
          response?.payload?.candles ||
          response?.result?.candles ||
          [];

        const normalized = normalizeBars(bars);
        series.setData(normalized);
        setStatus({ loading: false, error: null, count: normalized.length });

        liveCandleRef.current = normalized.length ? normalized[normalized.length - 1] : null;

        try {
          chartRef.current?.timeScale?.().fitContent?.();
        } catch (_error) {
          // ignore
        }
      } catch (error) {
        // Ignore aborts (common in React dev/StrictMode and fast navigation).
        const aborted =
          controller.signal.aborted ||
          String(error?.name || '').toLowerCase() === 'aborterror' ||
          String(error?.message || '')
            .toLowerCase()
            .includes('aborted');
        if (aborted) {
          return;
        }

        series.setData([]);
        setStatus({ loading: false, error: error?.message || 'Failed to load bars', count: 0 });
      } finally {
        if (inflightRef.current?.controller === controller) {
          inflightRef.current = null;
        }
      }
    },
    [brokerId, symbolUpper, timeframe, makeLoadKey]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const chart = createChart(container, {
      width: container.clientWidth || 320,
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: '#e5e7eb'
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.06)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' }
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.12)' },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.12)',
        timeVisible: true,
        secondsVisible: false
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.2)' },
        horzLine: { color: 'rgba(255,255,255,0.2)' }
      }
    });

    const seriesOptions = {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444'
    };

    // lightweight-charts v5 uses addSeries(CandlestickSeries, options)
    // Older versions used addCandlestickSeries(options)
    const series =
      typeof chart.addSeries === 'function'
        ? chart.addSeries(CandlestickSeries, seriesOptions)
        : chart.addCandlestickSeries(seriesOptions);

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      try {
        chart.applyOptions({ width: container.clientWidth || 320 });
      } catch (_error) {
        // ignore
      }
    });
    ro.observe(container);
    resizeObserverRef.current = ro;

    return () => {
      try {
        ro.disconnect();
      } catch (_error) {
        // ignore
      }
      resizeObserverRef.current = null;

      try {
        chart.remove();
      } catch (_error) {
        // ignore
      }
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    // When symbol/timeframe changes, cancel any in-flight request and fetch fresh candles.
    abortInflight();
    void loadCandles({ reason: 'params' });
    return () => {
      abortInflight();
    };
  }, [abortInflight, loadCandles]);

  useEffect(() => {
    // refreshKey may tick frequently (e.g., live quotes). Throttle refresh fetches.
    if (refreshKey == null) {
      return;
    }
    void loadCandles({ reason: 'refresh' });
  }, [refreshKey, loadCandles]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) {
      return;
    }
    if (!brokerId || !symbolUpper) {
      return;
    }
    if (!liveQuote || typeof liveQuote !== 'object') {
      return;
    }

    const price = quoteToPrice(liveQuote);
    if (price == null) {
      return;
    }

    const tfMs = timeframeToMs(timeframe);
    if (!tfMs) {
      return;
    }

    const tsSeconds =
      toSeconds(liveQuote.timestamp ?? liveQuote.time ?? liveQuote.receivedAt ?? Date.now()) ??
      Math.floor(Date.now() / 1000);
    const tfSeconds = Math.max(1, Math.floor(tfMs / 1000));
    const startSeconds = Math.floor(tsSeconds / tfSeconds) * tfSeconds;
    const t = startSeconds;

    const current = liveCandleRef.current;
    const sameBucket = current && Number(current.time) === Number(t);

    const next = {
      time: t,
      open: sameBucket ? Number(current.open) : price,
      high: sameBucket ? Math.max(Number(current.high), price) : price,
      low: sameBucket ? Math.min(Number(current.low), price) : price,
      close: price
    };

    liveCandleRef.current = next;
    try {
      series.update(next);
      setStatus((prev) => ({
        loading: false,
        error: null,
        count: Math.max(1, Number(prev?.count || 0))
      }));
    } catch (_error) {
      // ignore
    }
  }, [brokerId, symbolUpper, timeframe, liveQuote]);

  return (
    <div className="candle-history">
      <div className="candle-history__toolbar">
        <div className="candle-history__title">
          Candle History{symbolUpper ? ` · ${symbolUpper}` : ''}
        </div>
        <div className="candle-history__controls">
          <label className="candle-history__label">
            TF
            <select
              id="candle-history-timeframe"
              name="candleHistoryTimeframe"
              className="candle-history__select"
              value={timeframe}
              onChange={(e) => setTimeframe(String(e.target.value || 'M15').toUpperCase())}
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </label>
          <div className="candle-history__meta">
            {status.loading
              ? 'Loading…'
              : status.error
                ? status.error
                : status.count
                  ? `${status.count} bars`
                  : 'No bars yet'}
          </div>
        </div>
      </div>
      <div className="candle-history__chart" ref={containerRef} style={{ height }} />
    </div>
  );
}
