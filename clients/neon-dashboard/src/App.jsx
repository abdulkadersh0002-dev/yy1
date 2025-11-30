import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveClock } from './hooks/useLiveClock.js';
import { useWebSocketFeed } from './hooks/useWebSocketFeed.js';
import SignalTicker from './components/SignalTicker.jsx';
import SignalEnginePanel from './components/SignalEnginePanel.jsx';
import SignalEngineConsole from './components/SignalEngineConsole.jsx';
import FeatureSnapshotGrid from './components/FeatureSnapshotGrid.jsx';
import LiveEventFeed from './components/LiveEventFeed.jsx';
import TradesTable from './components/TradesTable.jsx';
import SystemHealthSummary from './components/SystemHealthSummary.jsx';
import ProviderAvailabilityTrend from './components/ProviderAvailabilityTrend.jsx';
import { fetchJson } from './utils/api.js';
import { useModuleHealth } from './context/ModuleHealthContext.jsx';

const SESSION_BLUEPRINT = [
  {
    id: 'sydney',
    label: 'Sydney Session',
    city: 'Sydney',
    timeZone: 'Australia/Sydney',
    windowLabel: '22:00 - 07:00 UTC',
    openMinutes: 22 * 60,
    closeMinutes: 7 * 60,
    theme: 'aqua'
  },
  {
    id: 'tokyo',
    label: 'Tokyo Session',
    city: 'Tokyo',
    timeZone: 'Asia/Tokyo',
    windowLabel: '00:00 - 09:00 UTC',
    openMinutes: 0,
    closeMinutes: 9 * 60,
    theme: 'violet'
  },
  {
    id: 'london',
    label: 'London Session',
    city: 'London',
    timeZone: 'Europe/London',
    windowLabel: '08:00 - 17:00 UTC',
    openMinutes: 8 * 60,
    closeMinutes: 17 * 60,
    theme: 'magenta'
  },
  {
    id: 'new-york',
    label: 'New York Session',
    city: 'New York',
    timeZone: 'America/New_York',
    windowLabel: '13:00 - 22:00 UTC',
    openMinutes: 13 * 60,
    closeMinutes: 22 * 60,
    theme: 'amber'
  }
];

const formatDuration = (totalMinutes) => {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hoursPart = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;

  if (hoursPart === 0) {
    return `${minutesPart}m`;
  }

  if (minutesPart === 0) {
    return `${hoursPart}h`;
  }

  return `${hoursPart}h ${minutesPart}m`;
};

const MAX_SIGNAL_ITEMS = 28;
const MAX_EVENT_ITEMS = 28;
const MAX_ACTIVE_TRADES = 12;
const MAX_HISTORY_TRADES = 40;

const toTimestamp = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const toNumber = (value) => {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeSignal = (payload = {}, fallbackTimestamp) => {
  if (!payload) {
    return null;
  }

  const pair = payload.pair || payload.symbol || payload.instrument;
  const direction = String(payload.direction || payload.side || payload.bias || 'NEUTRAL').toUpperCase();

  if (!pair) {
    return null;
  }

  const timestamp = toTimestamp(
    payload.generatedAt || payload.createdAt || payload.timestamp || fallbackTimestamp
  ) || Date.now();

  const id = payload.id || payload.signalId || `${pair}-${direction}-${timestamp}`;
  const primaryTechnical = payload.components?.technical?.signals?.[0] || null;
  const tradeRef = payload.tradeReference || payload.trade || null;
  const entry = payload.entry || payload.entryPlan || payload.orderPlan || tradeRef?.entry || {};

  const entryPrice = toNumber(
    entry.price ?? payload.entryPrice ?? tradeRef?.entryPrice ?? tradeRef?.openPrice ?? tradeRef?.priceOpened
  );
  const stopLoss = toNumber(
    entry.stopLoss ?? payload.stopLoss ?? tradeRef?.stopLoss ?? tradeRef?.risk?.stopLoss
  );
  const takeProfit = toNumber(
    entry.takeProfit ?? payload.takeProfit ?? tradeRef?.takeProfit ?? tradeRef?.targetPrice ?? tradeRef?.targets?.takeProfit
  );
  const riskReward = toNumber(
    entry.riskReward ?? payload.riskReward ?? payload.metrics?.riskReward ?? tradeRef?.riskReward
  );
  const expectedPnl = toNumber(
    payload.expectedPnL ?? payload.expectedPnl ?? payload.performance?.expectedPnL ?? entry.expectedPnL ?? tradeRef?.expectedPnL
  );
  const realizedPnl = toNumber(
    payload.realizedPnL ?? payload.pnl ?? payload.profit ?? tradeRef?.realizedPnl ?? tradeRef?.pnl ?? tradeRef?.profit
  );
  const score = toNumber(
    payload.finalScore ?? payload.score ?? payload.aggregateScore ?? payload.meta?.score
  );
  const winRate = toNumber(
    payload.estimatedWinRate ?? payload.winRate ?? payload.metrics?.winRate
  );
  const statusRaw = payload.status || payload.signalStatus || tradeRef?.status || 'pending';
  const openedAt = toTimestamp(
    payload.openedAt || payload.openTime || tradeRef?.openTime || tradeRef?.openedAt
  );
  const closedAt = toTimestamp(
    payload.closedAt || payload.closeTime || tradeRef?.closeTime || tradeRef?.closedAt
  );

  return {
    id,
    pair,
    direction,
    strength: toNumber(payload.strength ?? primaryTechnical?.strength),
    confidence: toNumber(payload.confidence ?? primaryTechnical?.confidence),
    timeframe: payload.timeframe || primaryTechnical?.timeframe || payload.meta?.timeframe || null,
    strategy: payload.strategy || payload.source || payload.meta?.strategy || null,
    timestamp,
    entryPrice,
    stopLoss,
    takeProfit,
    riskReward,
    expectedPnl,
    realizedPnl,
    score,
    winRate,
    status: statusRaw ? String(statusRaw).toUpperCase() : 'PENDING',
    openedAt,
    closedAt
  };
};

const orderActiveTrades = (trades = []) => {
  return trades
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      const aTime = toTimestamp(a?.openedAt || a?.openTime || a?.createdAt || a?.timestamp) || 0;
      const bTime = toTimestamp(b?.openedAt || b?.openTime || b?.createdAt || b?.timestamp) || 0;
      return bTime - aTime;
    });
};

const orderHistoryTrades = (trades = []) => {
  return trades
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      const aTime = toTimestamp(a?.closedAt || a?.closeTime || a?.completedAt || a?.updatedAt) || 0;
      const bTime = toTimestamp(b?.closedAt || b?.closeTime || b?.completedAt || b?.updatedAt) || 0;
      return bTime - aTime;
    });
};

const buildSessionState = (session, nowUtcMinutes, nowDate, formatter) => {
  const spansMidnight = session.closeMinutes <= session.openMinutes;
  const isOpen = spansMidnight
    ? nowUtcMinutes >= session.openMinutes || nowUtcMinutes < session.closeMinutes
    : nowUtcMinutes >= session.openMinutes && nowUtcMinutes < session.closeMinutes;

  const nextTransitionMinutes = isOpen
    ? ((session.closeMinutes - nowUtcMinutes + 1440) % 1440)
    : ((session.openMinutes - nowUtcMinutes + 1440) % 1440);

  const statusLabel = isOpen ? 'Open' : 'Closed';
  const nextTransitionLabel = isOpen ? 'Closes in' : 'Opens in';
  const timeUntilTransition = nextTransitionMinutes === 0 && isOpen ? 1440 : nextTransitionMinutes;
  const parts = formatter.formatToParts(nowDate);
  const timeDisplay = parts
    .filter((part) => ['hour', 'minute', 'second', 'literal'].includes(part.type))
    .map((part) => part.value)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const zoneDisplay = (parts.find((part) => part.type === 'timeZoneName')?.value || session.city).toUpperCase();

  return {
    id: session.id,
    label: session.label,
    city: session.city,
    timeZone: session.timeZone,
    windowLabel: session.windowLabel,
    timeDisplay,
    zoneDisplay,
    statusLabel,
    isOpen,
    nextTransitionLabel,
    transitionDuration: formatDuration(timeUntilTransition),
    theme: session.theme
  };
};

function App() {
  const headlineClock = useLiveClock();
  const now = useLiveClock(() => new Date());
  const [signals, setSignals] = useState([]);
  const [eventFeed, setEventFeed] = useState([]);
  const [activeTrades, setActiveTrades] = useState([]);
  const [tradeHistory, setTradeHistory] = useState([]);
  const [featureSnapshots, setFeatureSnapshots] = useState([]);
  const [engineSnapshot, setEngineSnapshot] = useState({
    status: null,
    statistics: null,
    updatedAt: null,
    loading: true,
    error: null
  });
  const { refresh: refreshModuleHealth } = useModuleHealth();

  const mergeSignals = useCallback((incomingSignals = []) => {
    if (!Array.isArray(incomingSignals) || incomingSignals.length === 0) {
      return;
    }
    setSignals((current) => {
      const merged = [...incomingSignals.filter(Boolean), ...current];
      const deduped = [];
      const seen = new Set();
      for (const item of merged) {
        const key = item?.id;
        if (!key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        deduped.push(item);
        if (deduped.length >= MAX_SIGNAL_ITEMS) {
          break;
        }
      }
      return deduped;
    });
  }, []);

  const refreshTradingData = useCallback(async () => {
    try {
      const [historyRes, activeRes] = await Promise.allSettled([
        fetchJson('/api/trades/history?limit=40'),
        fetchJson('/api/trades/active')
      ]);

      const collected = [];

      if (historyRes.status === 'fulfilled' && Array.isArray(historyRes.value?.trades)) {
        const orderedHistory = orderHistoryTrades(historyRes.value.trades);
        const cappedHistory = orderedHistory.slice(0, MAX_HISTORY_TRADES);
        setTradeHistory(cappedHistory);
        for (const trade of cappedHistory) {
          const base = trade?.signal || trade?.latestSignal || null;
          if (!base) {
            continue;
          }
          const normalized = normalizeSignal(
            { ...base, tradeReference: trade },
            trade.closedAt || trade.closeTime || trade.openedAt || trade.openTime || base.generatedAt
          );
          if (normalized) {
            collected.push(normalized);
          }
        }
      }

      if (activeRes.status === 'fulfilled' && Array.isArray(activeRes.value?.trades)) {
        const orderedActive = orderActiveTrades(activeRes.value.trades);
        const cappedActive = orderedActive.slice(0, MAX_ACTIVE_TRADES);
        setActiveTrades(cappedActive);
        for (const trade of cappedActive) {
          const base = trade?.signal || trade?.originSignal || null;
          if (!base) {
            continue;
          }
          const normalized = normalizeSignal(
            { ...base, tradeReference: trade },
            trade.openedAt || trade.openTime || base.generatedAt
          );
          if (normalized) {
            collected.push(normalized);
          }
        }
      }

      if (collected.length) {
        mergeSignals(collected);
      }
    } catch (error) {
      console.warn('Failed to refresh trading data', error);
    }
  }, [mergeSignals]);

  const refreshFeatureSnapshots = useCallback(async () => {
    try {
      const response = await fetchJson('/api/features-snapshots?limit=24');
      const snapshots = Array.isArray(response?.snapshots) ? response.snapshots.slice(0, 24) : [];
      setFeatureSnapshots(snapshots);
    } catch (error) {
      console.warn('Failed to load feature snapshots', error);
    }
  }, []);

  const loadEngineSnapshot = useCallback(async () => {
    setEngineSnapshot((prev) => ({ ...prev, loading: true }));
    try {
      const [statusRes, statsRes] = await Promise.all([
        fetchJson('/api/status'),
        fetchJson('/api/statistics')
      ]);

      setEngineSnapshot({
        status: statusRes?.status || null,
        statistics: statsRes?.statistics || null,
        updatedAt: Date.now(),
        loading: false,
        error: null
      });
    } catch (error) {
      setEngineSnapshot((prev) => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to load engine telemetry'
      }));
    }
  }, []);

  useEffect(() => {
    refreshTradingData();
    const timer = setInterval(refreshTradingData, 60000);
    return () => clearInterval(timer);
  }, [refreshTradingData]);

  useEffect(() => {
    refreshFeatureSnapshots();
    const timer = setInterval(refreshFeatureSnapshots, 90000);
    return () => clearInterval(timer);
  }, [refreshFeatureSnapshots]);

  useEffect(() => {
    loadEngineSnapshot();
    const interval = setInterval(loadEngineSnapshot, 45000);
    return () => clearInterval(interval);
  }, [loadEngineSnapshot]);

  const handleEngineEvent = useCallback((event) => {
    if (!event?.type) {
      return;
    }

    const type = String(event.type);
    const normalizedType = type.toLowerCase();
    const payload = event.payload ?? null;

    if (normalizedType !== 'connected') {
      setEventFeed((current) => {
        const combined = [{ ...event, type }, ...current];
        const deduped = [];
        const seen = new Set();
        for (const item of combined) {
          const key = item?.id;
          if (!key || seen.has(key)) {
            continue;
          }
          seen.add(key);
          deduped.push(item);
          if (deduped.length >= MAX_EVENT_ITEMS) {
            break;
          }
        }
        return deduped;
      });
    }

    if (normalizedType.includes('signal')) {
      if (!payload) {
        return;
      }
      const normalized = normalizeSignal(payload, event.timestamp);
      if (normalized?.id) {
        mergeSignals([normalized]);
      }
      return;
    }

    if (normalizedType === 'trade_opened') {
      if (payload) {
        setActiveTrades((current) => {
          const combined = [payload, ...current.filter((item) => item?.id !== payload.id)];
          return orderActiveTrades(combined).slice(0, MAX_ACTIVE_TRADES);
        });
        const baseSignal = payload.signal || payload.originSignal || null;
        if (baseSignal) {
          const normalized = normalizeSignal(
            { ...baseSignal, tradeReference: payload },
            payload.openedAt || payload.openTime || event.timestamp
          );
          if (normalized?.id) {
            mergeSignals([normalized]);
          }
        }
      }
      loadEngineSnapshot();
      return;
    }

    if (normalizedType === 'trade_closed') {
      if (payload) {
        setActiveTrades((current) => current.filter((item) => item?.id !== payload.id));
        setTradeHistory((current) => {
          const combined = [payload, ...current.filter((item) => item?.id !== payload.id)];
          return orderHistoryTrades(combined).slice(0, MAX_HISTORY_TRADES);
        });
        const baseSignal = payload.signal || payload.latestSignal || payload.originSignal || null;
        if (baseSignal) {
          const normalized = normalizeSignal(
            { ...baseSignal, tradeReference: payload },
            payload.closedAt || payload.closeTime || event.timestamp
          );
          if (normalized?.id) {
            mergeSignals([normalized]);
          }
        }
      }
      loadEngineSnapshot();
      refreshModuleHealth?.();
      return;
    }

    if (normalizedType === 'all_trades_closed') {
      if (payload) {
        const closedTrades = Array.isArray(payload.results)
          ? payload.results.filter((item) => item && item.success && item.trade).map((item) => item.trade)
          : Array.isArray(payload.trades)
            ? payload.trades
            : [];
        if (closedTrades.length) {
          setTradeHistory((current) => {
            const combined = [...closedTrades, ...current];
            const deduped = [];
            const seen = new Set();
            for (const trade of combined) {
              if (!trade?.id || seen.has(trade.id)) {
                continue;
              }
              seen.add(trade.id);
              deduped.push(trade);
              if (deduped.length >= MAX_HISTORY_TRADES) {
                break;
              }
            }
            return orderHistoryTrades(deduped);
          });
        }
      }
      setActiveTrades([]);
      loadEngineSnapshot();
      refreshModuleHealth?.();
      return;
    }

    if (normalizedType === 'auto_trading_started' || normalizedType === 'auto_trading_stopped') {
      loadEngineSnapshot();
      refreshModuleHealth?.();
    }
  }, [loadEngineSnapshot, mergeSignals, refreshModuleHealth]);

  useWebSocketFeed(handleEngineEvent);

  const handleSignalGenerated = useCallback((signal) => {
    if (!signal) {
      return;
    }
    const normalized = normalizeSignal(signal, signal.generatedAt || signal.createdAt);
    if (normalized?.id) {
      mergeSignals([normalized]);
    }
    refreshFeatureSnapshots();
    loadEngineSnapshot();
    refreshModuleHealth?.();
  }, [loadEngineSnapshot, mergeSignals, refreshFeatureSnapshots, refreshModuleHealth]);

  const formatters = useMemo(
    () => SESSION_BLUEPRINT.reduce((acc, session) => {
      acc[session.id] = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: session.timeZone,
        timeZoneName: 'short'
      });
      return acc;
    }, {}),
    []
  );

  const sessionCards = useMemo(() => {
    if (!(now instanceof Date)) {
      return [];
    }
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    return SESSION_BLUEPRINT.map((session) =>
      buildSessionState(session, utcMinutes, now, formatters[session.id])
    );
  }, [now, formatters]);

  const engineStatus = engineSnapshot.status || null;
  const endpointLabel = engineStatus?.apiBaseUrl || engineStatus?.environment || engineStatus?.mode || engineStatus?.host || null;
  const buildLabel = engineStatus?.buildVersion || engineStatus?.version || null;
  const trackedPairsLabel = Array.isArray(engineStatus?.pairs) && engineStatus.pairs.length
    ? `${engineStatus.pairs.length} pairs`
    : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1 className="app-title">Signals Strategy</h1>
          <p className="app-subtitle">Neon intelligence control deck</p>
        </div>
        <div className="app-meta">
          <span className="app-clock">{headlineClock}</span>
          {endpointLabel && <span className="app-endpoint">Endpoint · {endpointLabel}</span>}
          {buildLabel && <span className="app-endpoint">Build · {buildLabel}</span>}
          {trackedPairsLabel && <span className="app-endpoint">Coverage · {trackedPairsLabel}</span>}
        </div>
      </header>

      <main className="app-layout">
        <section className="app-section app-section--hero">
          <div className="app-grid app-grid--hero">
            <div className="app-grid__cell app-grid__cell--primary">
              <SignalEnginePanel snapshot={engineSnapshot} />
            </div>
            <div className="app-grid__cell app-grid__cell--health">
              <SystemHealthSummary
                snapshot={engineSnapshot}
                featureSnapshots={featureSnapshots}
                signals={signals}
                events={eventFeed}
              />
            </div>
            <div className="app-grid__cell app-grid__cell--availability">
              <ProviderAvailabilityTrend />
            </div>
            <div className="app-grid__cell app-grid__cell--events">
              <LiveEventFeed events={eventFeed} />
            </div>
          </div>
        </section>

        <section className="app-section app-section--ops">
          <div className="app-section__header">
            <div>
              <h2>Execution Control</h2>
              <p>Trigger live signals and monitor analytic fingerprints</p>
            </div>
          </div>
          <div className="app-grid app-grid--ops">
            <SignalEngineConsole
              pairs={engineSnapshot.status?.pairs || []}
              onSignalGenerated={handleSignalGenerated}
            />
            <FeatureSnapshotGrid snapshots={featureSnapshots} />
          </div>
        </section>

        <section className="app-section app-section--trading">
          <div className="app-section__header">
            <div>
              <h2>Portfolio Pulse</h2>
              <p>Open exposure with the latest performance closes</p>
            </div>
          </div>
          <TradesTable
            activeTrades={activeTrades}
            tradeHistory={tradeHistory}
          />
        </section>

        <section className="app-section app-section--sessions">
          <div className="app-section__header">
            <div>
              <h2>Global Trading Sessions</h2>
              <p>Real-time clocks highlighting market overlap zones</p>
            </div>
          </div>
          <div className="session-grid">
            {sessionCards.map((session) => (
              <article
                key={session.id}
                className={`session-card session-card--${session.theme} ${session.isOpen ? 'session-card--open' : 'session-card--closed'}`}
              >
                <header className="session-card__header">
                  <span className="session-card__badge">{session.city}</span>
                  <span className={`session-card__status ${session.isOpen ? 'session-card__status--open' : 'session-card__status--closed'}`}>
                    {session.statusLabel}
                  </span>
                </header>
                <h2 className="session-card__title">{session.label}</h2>
                <div className="session-card__body">
                  <span className="session-card__time">{session.timeDisplay}</span>
                  <span className="session-card__timezone">{session.zoneDisplay}</span>
                </div>
                <footer className="session-card__footer">
                  <div className="session-card__progress">
                    <span className="session-card__transition">{session.nextTransitionLabel}</span>
                    <span className="session-card__duration">{session.transitionDuration}</span>
                  </div>
                  <span className="session-card__window">{session.windowLabel}</span>
                </footer>
              </article>
            ))}
          </div>
        </section>

        <section className="app-section app-section--ticker">
          <div className="app-section__header">
            <div>
              <h2>Signal Stream</h2>
              <p>Latest opportunities cascading from the engine</p>
            </div>
          </div>
          <SignalTicker signals={signals} />
        </section>
      </main>
    </div>
  );
}

export default App;
