import React, {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useLiveClock } from './hooks/useLiveClock.js';
import { useWebSocketFeed } from './hooks/useWebSocketFeed.js';
import { SystemHealthHeaderIndicator } from './components/SystemHealthSummary.jsx';
import MetaTraderBridgePanel from './components/MetaTraderBridgePanel.jsx';
import TradesTable from './components/TradesTable.jsx';
import MetricCard from './components/MetricCard.jsx';
import CandleHistoryChart from './components/CandleHistoryChart.jsx';
import SignalDashboardTable from './components/SignalDashboardTable.jsx';
import CandidateSignalTable from './components/CandidateSignalTable.jsx';
import { fetchJson, getApiConfig, postJson } from './utils/api.js';
import { useModuleHealth } from './context/ModuleHealthContext.jsx';
import { formatDateTime, formatNumber, formatRelativeTime } from './utils/format.js';
import {
  ACTIVE_SYMBOLS_SYNC_MAX,
  EA_ONLY_UI_MODE,
  MAX_ACTIVE_TRADES,
  MAX_CANDIDATE_ITEMS,
  MAX_EVENT_ITEMS,
  MAX_HISTORY_TRADES,
  MAX_SIGNAL_ITEMS,
  MAX_TICKER_RENDER,
  MAX_TICKER_SEARCH_RESULTS,
  TICKER_CATALOG_SYMBOLS,
  SESSION_BLUEPRINT,
  TICKER_ADVANCE_STEP,
  TICKER_CATEGORIES,
  TICKER_WINDOW_SIZE,
  classifyTickerSymbol,
  extractFxCurrencies,
  formatDuration,
  isCryptoSymbol,
  isFxSymbol,
  isMetalSymbol,
  normalizeBrokerId,
  normalizeTickerSymbol,
  toNumber,
  toTimestamp
} from './app/app-constants.js';

const SHOW_AUTOTRADING_UI = false;
const DASHBOARD_AUTOTRADING_AUTOSTART = true;

const matchesTickerCategory = (symbolUpper, categoryId) => {
  const allowed = isFxSymbol(symbolUpper) || isMetalSymbol(symbolUpper) || isCryptoSymbol(symbolUpper);
  if (!allowed) {
    return false;
  }
  const category = String(categoryId || 'ALL').toUpperCase();
  if (category === 'ALL') {
    return true;
  }
  return classifyTickerSymbol(symbolUpper) === category;
};

const normalizeSignal = (payload = {}, fallbackTimestamp) => {
  if (!payload) {
    return null;
  }

  const pair = payload.pair || payload.symbol || payload.instrument;
  const direction = String(
    payload.direction || payload.side || payload.bias || 'NEUTRAL'
  ).toUpperCase();

  if (!pair) {
    return null;
  }

  const timestamp =
    toTimestamp(
      payload.generatedAt || payload.createdAt || payload.timestamp || fallbackTimestamp
    ) || Date.now();

  const id = payload.id || payload.signalId || `${pair}-${direction}-${timestamp}`;
  const primaryTechnical = payload.components?.technical?.signals?.[0] || null;
  const tradeRef = payload.tradeReference || payload.trade || null;
  const entry = payload.entry || payload.entryPlan || payload.orderPlan || tradeRef?.entry || {};

  const entryPrice = toNumber(
    entry.price ??
      payload.entryPrice ??
      tradeRef?.entryPrice ??
      tradeRef?.openPrice ??
      tradeRef?.priceOpened
  );
  const stopLoss = toNumber(
    entry.stopLoss ?? payload.stopLoss ?? tradeRef?.stopLoss ?? tradeRef?.risk?.stopLoss
  );
  const takeProfit = toNumber(
    entry.takeProfit ??
      payload.takeProfit ??
      tradeRef?.takeProfit ??
      tradeRef?.targetPrice ??
      tradeRef?.targets?.takeProfit
  );
  const riskReward = toNumber(
    entry.riskReward ?? payload.riskReward ?? payload.metrics?.riskReward ?? tradeRef?.riskReward
  );
  const expectedPnl = toNumber(
    payload.expectedPnL ??
      payload.expectedPnl ??
      payload.performance?.expectedPnL ??
      entry.expectedPnL ??
      tradeRef?.expectedPnL
  );
  const realizedPnl = toNumber(
    payload.realizedPnL ??
      payload.pnl ??
      payload.profit ??
      tradeRef?.realizedPnl ??
      tradeRef?.pnl ??
      tradeRef?.profit
  );
  const score = toNumber(
    payload.finalScore ?? payload.score ?? payload.aggregateScore ?? payload.meta?.score
  );
  const winRate = toNumber(payload.estimatedWinRate ?? payload.winRate ?? payload.metrics?.winRate);
  const statusRaw = payload.status || payload.signalStatus || tradeRef?.status || 'pending';
  const expiresAt =
    toTimestamp(payload.expiresAt || payload.validity?.expiresAt || payload.expiryAt) || null;
  const statusUpper = statusRaw ? String(statusRaw).toUpperCase() : 'PENDING';
  const resolvedStatus = expiresAt && Date.now() > expiresAt ? 'EXPIRED' : statusUpper || 'PENDING';
  const openedAt = toTimestamp(
    payload.openedAt || payload.openTime || tradeRef?.openTime || tradeRef?.openedAt
  );
  const closedAt = toTimestamp(
    payload.closedAt || payload.closeTime || tradeRef?.closeTime || tradeRef?.closedAt
  );

  const mergeKey = (() => {
    // Trade-linked signals should remain unique so history/active trades don't overwrite each other.
    if (openedAt || closedAt) {
      return id;
    }
    const timeframeKey = String(
      payload.timeframe || primaryTechnical?.timeframe || ''
    ).toUpperCase();
    const strategyKey = String(
      payload.strategy || payload.source || payload.meta?.strategy || ''
    ).toUpperCase();
    return `${pair}:${direction}:${timeframeKey}:${strategyKey}`;
  })();

  return {
    id,
    mergeKey,
    pair,
    direction,
    strength: toNumber(payload.strength ?? primaryTechnical?.strength),
    confidence: toNumber(payload.confidence ?? primaryTechnical?.confidence),
    timeframe: payload.timeframe || primaryTechnical?.timeframe || payload.meta?.timeframe || null,
    strategy: payload.strategy || payload.source || payload.meta?.strategy || null,
    // Preserve decision metadata so the Signal Dashboard can distinguish ENTER vs WAIT_MONITOR.
    isValid: payload.isValid || null,
    timestamp,
    expiresAt,
    signalStatus: payload.signalStatus || payload.validity?.state || null,
    entry: payload.entry || null,
    riskManagement: payload.riskManagement || null,
    entryPrice,
    stopLoss,
    takeProfit,
    riskReward,
    expectedPnl,
    realizedPnl,
    score,
    winRate,
    status: resolvedStatus,
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
    ? (session.closeMinutes - nowUtcMinutes + 1440) % 1440
    : (session.openMinutes - nowUtcMinutes + 1440) % 1440;

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
  const zoneDisplay = (
    parts.find((part) => part.type === 'timeZoneName')?.value || session.city
  ).toUpperCase();

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
  const nowFormatter = useCallback(() => new Date(), []);
  const now = useLiveClock(nowFormatter);
  const [metaTraderBridgeOpen, setMetaTraderBridgeOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState('MT5');
  const [marketFeed, setMarketFeed] = useState({
    quotes: [],
    news: [],
    loading: false,
    error: null,
    updatedAt: null
  });
  const quotesBySymbolRef = useRef(new Map());
  const quoteSymbolsRef = useRef([]);
  const quoteIndexBySymbolRef = useRef(new Map());
  const lastQuoteUpdateSymbolsRef = useRef([]);
  const lastMidCleanupRef = useRef(0);
  const tickerMeasureRef = useRef({ viewportWidth: 0, trackWidth: 0, duration: 0 });
  const [tickerSearch, setTickerSearch] = useState('');
  const [tickerCategory, setTickerCategory] = useState('ALL');
  const [tickerOffset, setTickerOffset] = useState(0);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [pairAnalysisOpen, setPairAnalysisOpen] = useState(false);
  const [newsEventsScope, setNewsEventsScope] = useState('PAIR');
  const [newsEventsHorizonHours, setNewsEventsHorizonHours] = useState(72);
  const [showSystemHeadlines, setShowSystemHeadlines] = useState(false);
  const [analyzerSymbol, setAnalyzerSymbol] = useState(null);
  const [analyzerSnapshot, setAnalyzerSnapshot] = useState({
    signal: null,
    barsContext: null,
    loading: false,
    error: null,
    updatedAt: null
  });
  const [scenarioSnapshot, setScenarioSnapshot] = useState({
    scenario: null,
    signal: null,
    loading: false,
    error: null,
    retry: null,
    updatedAt: null
  });
  const lastMidBySymbolRef = useRef(new Map());
  const tickerViewportRef = useRef(null);
  const tickerTrackRef = useRef(null);
  const [eaBridgeSessions, setEaBridgeSessions] = useState([]);
  const [eaBridgeStatsError, setEaBridgeStatsError] = useState(null);
  const [autoTradingAction, setAutoTradingAction] = useState({ loading: false, error: null });
  const [autoTradingPanelOpen, setAutoTradingPanelOpen] = useState(false);
  const [lastAutoTradingChangeAt, setLastAutoTradingChangeAt] = useState(null);
  const [lastAutoTradingMessage, setLastAutoTradingMessage] = useState(null);
  const [signals, setSignals] = useState([]);
  const [candidateSignals, setCandidateSignals] = useState([]);
  const [entryReadySelectedId, setEntryReadySelectedId] = useState(null);
  const [candidateSelectedId, setCandidateSelectedId] = useState(null);
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
  const [brokerStatus, setBrokerStatus] = useState({
    connectors: [],
    health: [],
    lastSyncAt: null
  });
  const { refresh: refreshModuleHealth } = useModuleHealth();

  const publishedAnalysisSignalRef = useRef({ key: null });
  const publishedAnalyzerSignalRef = useRef({ key: null });

  const mergeSignals = useCallback((incomingSignals = []) => {
    if (!Array.isArray(incomingSignals) || incomingSignals.length === 0) {
      return;
    }
    setSignals((current) => {
      const merged = [...incomingSignals.filter(Boolean), ...current.filter(Boolean)];
      const byKey = new Map();

      for (const item of merged) {
        const key = item?.mergeKey || item?.id;
        if (!key) {
          continue;
        }

        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, item);
          continue;
        }

        const existingTs = toTimestamp(existing?.openedAt || existing?.timestamp) || 0;
        const itemTs = toTimestamp(item?.openedAt || item?.timestamp) || 0;
        if (itemTs >= existingTs) {
          byKey.set(key, item);
        }
      }

      return Array.from(byKey.values())
        .slice()
        .sort((a, b) => {
          const aTs = toTimestamp(a?.openedAt || a?.timestamp) || 0;
          const bTs = toTimestamp(b?.openedAt || b?.timestamp) || 0;
          return bTs - aTs;
        })
        .slice(0, MAX_CANDIDATE_ITEMS);
    });
  }, []);

  const mergeCandidateSignals = useCallback((incomingSignals = []) => {
    if (!Array.isArray(incomingSignals) || incomingSignals.length === 0) {
      return;
    }
    setCandidateSignals((current) => {
      const merged = [...incomingSignals.filter(Boolean), ...current.filter(Boolean)];
      const byKey = new Map();

      for (const item of merged) {
        const key = item?.mergeKey || item?.id;
        if (!key) {
          continue;
        }

        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, item);
          continue;
        }

        const existingTs = toTimestamp(existing?.openedAt || existing?.timestamp) || 0;
        const itemTs = toTimestamp(item?.openedAt || item?.timestamp) || 0;
        if (itemTs >= existingTs) {
          byKey.set(key, item);
        }
      }

      return Array.from(byKey.values())
        .slice()
        .sort((a, b) => {
          const aTs = toTimestamp(a?.openedAt || a?.timestamp) || 0;
          const bTs = toTimestamp(b?.openedAt || b?.timestamp) || 0;
          return bTs - aTs;
        })
        .slice(0, MAX_CANDIDATE_ITEMS);
    });
  }, []);

  const entryReadySignalsMeta = useMemo(() => {
    const primary = Array.isArray(signals) ? signals : [];
    const fallbackCandidates = Array.isArray(candidateSignals) ? candidateSignals : [];
    const usingCandidatesFallback = primary.length === 0 && fallbackCandidates.length > 0;
    const pool = primary.length > 0 ? primary : fallbackCandidates;

    // Keep UI in sync with backend "strong" publish policy defaults.
    const STRICT_MIN_CONFIDENCE = 75;
    const STRICT_MIN_STRENGTH = 60;

    // Relaxed fallback so the dashboard can still surface actionable ENTER decisions
    // when the engine is conservative (common in EA-only / early-snapshot conditions).
    const RELAXED_MIN_CONFIDENCE = Number(import.meta.env.VITE_ENTRY_READY_RELAXED_MIN_CONFIDENCE);
    const RELAXED_MIN_STRENGTH = Number(import.meta.env.VITE_ENTRY_READY_RELAXED_MIN_STRENGTH);

    const relaxedMinConfidence = Number.isFinite(RELAXED_MIN_CONFIDENCE)
      ? Math.max(0, Math.min(100, RELAXED_MIN_CONFIDENCE))
      : 45;
    const relaxedMinStrength = Number.isFinite(RELAXED_MIN_STRENGTH)
      ? Math.max(0, Math.min(100, RELAXED_MIN_STRENGTH))
      : 55;

    const isEnterDecision = (signal) => {
      const state = String(signal?.isValid?.decision?.state || '').toUpperCase();
      return state === 'ENTER' || state === 'ENTER_STRONG' || state === 'ENTER_TRADE';
    };

    const isTradeable = (signal) => {
      const entryPrice = signal?.entryPrice;
      const stopLoss = signal?.stopLoss;
      const takeProfit = signal?.takeProfit;
      if (!Number.isFinite(Number(entryPrice))) {
        return false;
      }
      if (!Number.isFinite(Number(stopLoss))) {
        return false;
      }
      if (!Number.isFinite(Number(takeProfit))) {
        return false;
      }
      return true;
    };

    const buildEnterList = ({ minConfidence, minStrength } = {}) =>
      pool
        .filter(Boolean)
        .filter((signal) => {
          const direction = String(signal?.direction || '').toUpperCase();
          if (direction !== 'BUY' && direction !== 'SELL') {
            return false;
          }

          const blocked = signal?.isValid?.decision?.blocked === true;
          if (blocked) {
            return false;
          }

          if (!isEnterDecision(signal)) {
            return false;
          }

          // Strict: only show fully trade-valid signals.
          if (signal?.isValid?.isValid !== true) {
            return false;
          }

          // Entry-ready must include usable levels.
          if (!isTradeable(signal)) {
            return false;
          }

          const confidence = Number(signal?.confidence) || 0;
          const strength = Number(signal?.strength) || 0;
          if (confidence < minConfidence || strength < minStrength) {
            return false;
          }

          return true;
        })
        .slice(0, 50);

    const buildWatchList = () =>
      pool
        .filter(Boolean)
        .filter((signal) => {
          const direction = String(signal?.direction || '').toUpperCase();
          if (direction !== 'BUY' && direction !== 'SELL') {
            return false;
          }

          const blocked = signal?.isValid?.decision?.blocked === true;
          if (blocked) {
            return false;
          }

          const state = String(signal?.isValid?.decision?.state || '').toUpperCase();
          if (state !== 'WAIT_MONITOR') {
            return false;
          }

          // For the main table, require usable levels (even in WATCH mode).
          if (!isTradeable(signal)) {
            return false;
          }

          // Filter out extremely weak/noisy candidates.
          const confidence = Number(signal?.confidence) || 0;
          const strength = Number(signal?.strength) || 0;
          if (confidence < 20 || strength < 10) {
            return false;
          }

          return true;
        })
        .slice()
        .sort((a, b) => {
          const aStrength = Number(a?.strength) || 0;
          const bStrength = Number(b?.strength) || 0;
          if (bStrength !== aStrength) {
            return bStrength - aStrength;
          }
          const aConf = Number(a?.confidence) || 0;
          const bConf = Number(b?.confidence) || 0;
          if (bConf !== aConf) {
            return bConf - aConf;
          }
          const aTs = toTimestamp(a?.openedAt || a?.timestamp) || 0;
          const bTs = toTimestamp(b?.openedAt || b?.timestamp) || 0;
          return bTs - aTs;
        })
        .slice(0, 50);

    const strict = buildEnterList({
      minConfidence: STRICT_MIN_CONFIDENCE,
      minStrength: STRICT_MIN_STRENGTH
    });

    if (strict.length > 0) {
      return {
        signals: strict,
        modeLabel: usingCandidatesFallback
          ? 'ENTER only (strict · candidates)'
          : 'ENTER only (strict)'
      };
    }

    const relaxed = buildEnterList({
      minConfidence: relaxedMinConfidence,
      minStrength: relaxedMinStrength
    });

    if (relaxed.length > 0) {
      return {
        signals: relaxed,
        modeLabel: usingCandidatesFallback
          ? `ENTER only (relaxed · candidates ${relaxedMinConfidence}/${relaxedMinStrength})`
          : `ENTER only (relaxed ${relaxedMinConfidence}/${relaxedMinStrength})`
      };
    }

    const watch = buildWatchList();
    return {
      signals: watch,
      modeLabel: usingCandidatesFallback
        ? 'WATCH (WAIT_MONITOR · candidates)'
        : 'WATCH (WAIT_MONITOR)'
    };
  }, [signals, candidateSignals]);

  const entryReadySignals = entryReadySignalsMeta.signals;

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
            trade.closedAt ||
              trade.closeTime ||
              trade.openedAt ||
              trade.openTime ||
              base.generatedAt
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

  const refreshBrokerStatus = useCallback(async () => {
    try {
      const response = await fetchJson('/api/broker/status');
      const connectorIds = Array.isArray(response?.status?.connectors)
        ? response.status.connectors
        : [];
      const healthSnapshots = Array.isArray(response?.health) ? response.health : [];
      setBrokerStatus({
        connectors: connectorIds,
        health: healthSnapshots,
        lastSyncAt: response?.status?.lastSyncAt || null
      });
    } catch (error) {
      console.warn('Failed to refresh broker status', error);
    }
  }, []);

  const loadEngineSnapshot = useCallback(async () => {
    setEngineSnapshot((prev) => ({ ...prev, loading: true }));
    try {
      const results = await Promise.allSettled([
        fetchJson('/api/status'),
        fetchJson('/api/statistics')
      ]);

      const statusRes = results[0]?.status === 'fulfilled' ? results[0].value : null;
      const statsRes = results[1]?.status === 'fulfilled' ? results[1].value : null;

      const status = statusRes?.status || null;
      const statistics = statsRes?.statistics || null;

      const statusError =
        results[0]?.status === 'rejected'
          ? results[0]?.reason?.message || 'Failed to load engine status'
          : null;
      const statsError =
        results[1]?.status === 'rejected'
          ? results[1]?.reason?.message || 'Failed to load engine statistics'
          : null;

      setEngineSnapshot((prev) => ({
        status: status ?? prev.status ?? null,
        statistics: statistics ?? prev.statistics ?? null,
        updatedAt: Date.now(),
        loading: false,
        error: statusError || statsError || null
      }));
    } catch (error) {
      setEngineSnapshot((prev) => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to load engine telemetry'
      }));
    }
  }, []);

  const refreshEaBridgeStats = useCallback(async () => {
    setEaBridgeStatsError(null);
    try {
      // Sessions endpoint is the source of truth for EA heartbeats.
      const response = await fetchJson('/api/broker/bridge/sessions');
      const sessions = Array.isArray(response?.sessions) ? response.sessions : [];
      setEaBridgeSessions(sessions);
    } catch (error) {
      // Best-effort: don't wipe previously-known sessions on transient API issues.
      setEaBridgeStatsError(error?.message || 'Failed to load MetaTrader Bridge status');
    }
  }, []);

  const selectedPlatformId = useMemo(
    () => normalizeBrokerId(selectedPlatform || ''),
    [selectedPlatform]
  );

  const forcedBrokerId = useMemo(() => {
    const broker =
      engineSnapshot?.status?.autoTrading?.forcedBroker ??
      engineSnapshot?.status?.forcedBroker ??
      null;
    const normalized = normalizeBrokerId(broker || '');
    return normalized || null;
  }, [engineSnapshot?.status]);

  const effectivePlatformId = useMemo(
    () => normalizeBrokerId(forcedBrokerId || selectedPlatformId || ''),
    [forcedBrokerId, selectedPlatformId]
  );

  const refreshMarketFeed = useCallback(
    async (options = {}) => {
      const includeNews = options.includeNews !== false;
      setMarketFeed((prev) => ({ ...prev, loading: prev.updatedAt == null, error: null }));
      try {
        const requests = [
          fetchJson(
            `/api/broker/bridge/${effectivePlatformId}/market/quotes?maxAgeMs=900000&orderBy=symbol`
          )
        ];
        if (includeNews) {
          requests.push(
            fetchJson(`/api/broker/bridge/${effectivePlatformId}/market/news?limit=200`)
          );
        }

        const results = await Promise.allSettled(requests);
        const quotesRes = results[0];
        const newsRes = includeNews ? results[1] : null;

        const quotesSucceeded = quotesRes?.status === 'fulfilled';
        const quotes =
          quotesSucceeded && Array.isArray(quotesRes.value?.quotes) ? quotesRes.value.quotes : [];

        const news =
          includeNews && newsRes?.status === 'fulfilled' && Array.isArray(newsRes.value?.news)
            ? newsRes.value.news
            : null;

        const errorMessage =
          quotesRes?.status === 'rejected'
            ? quotesRes.reason?.message || 'Failed to load EA quotes'
            : includeNews && newsRes?.status === 'rejected'
              ? newsRes.reason?.message || 'Failed to load EA news'
              : null;

        setMarketFeed((prev) => {
          const nextQuotes = quotesSucceeded
            ? quotes
            : Array.isArray(prev?.quotes)
              ? prev.quotes
              : [];
          const nextNews = includeNews ? news || [] : prev.news;
          const hasData =
            (Array.isArray(nextQuotes) && nextQuotes.length > 0) ||
            (Array.isArray(nextNews) && nextNews.length > 0);

          if (quotesSucceeded) {
            const bySymbol = new Map();
            const symbols = [];
            const indexBySymbol = new Map();

            const normalizedQuotes = Array.isArray(nextQuotes)
              ? nextQuotes
                  .filter(Boolean)
                  .map((q) => {
                    const symbol = String(q?.symbol || '')
                      .trim()
                      .toUpperCase();
                    if (!symbol) {
                      return null;
                    }
                    return { ...q, symbol };
                  })
                  .filter(Boolean)
              : [];

            for (let i = 0; i < normalizedQuotes.length; i += 1) {
              const quote = normalizedQuotes[i];
              const symbol = String(quote?.symbol || '').toUpperCase();
              if (!symbol) {
                continue;
              }
              if (!bySymbol.has(symbol)) {
                symbols.push(symbol);
                indexBySymbol.set(symbol, symbols.length - 1);
              }
              bySymbol.set(symbol, quote);
            }

            quotesBySymbolRef.current = bySymbol;
            quoteSymbolsRef.current = symbols;
            quoteIndexBySymbolRef.current = indexBySymbol;

            return {
              quotes: symbols.map((s) => bySymbol.get(s)).filter(Boolean),
              news: nextNews,
              loading: false,
              error: errorMessage,
              updatedAt: hasData ? Date.now() : prev.updatedAt || null
            };
          }

          return {
            quotes: nextQuotes,
            news: nextNews,
            loading: false,
            error: errorMessage,
            updatedAt: hasData ? Date.now() : prev.updatedAt || null
          };
        });
      } catch (error) {
        setMarketFeed((prev) => ({
          ...prev,
          loading: false,
          error: error?.message || 'Failed to load EA market feed'
        }));
      }
    },
    [effectivePlatformId]
  );

  // Defer search filtering so keystrokes never freeze the UI.
  const tickerSearchDeferred = useDeferredValue(tickerSearch);
  const tickerSearchNormalized = useMemo(
    () => normalizeTickerSymbol(tickerSearchDeferred),
    [tickerSearchDeferred]
  );

  const preserveScrollPosition = useCallback((fn) => {
    const x = window.scrollX || 0;
    const y = window.scrollY || 0;
    fn();
    requestAnimationFrame(() => {
      try {
        window.scrollTo(x, y);
      } catch (_error) {
        // best-effort
      }
    });
  }, []);

  const openAnalyzerForSymbol = useCallback((symbolValue) => {
    const raw = String(symbolValue || '').trim();
    const normalized = normalizeTickerSymbol(raw);
    if (!normalized) {
      return;
    }
    setAnalyzerSymbol(raw);
    setAnalyzerOpen(true);
  }, []);

  const selectedEaBridgeSessions = useMemo(() => {
    if (!Array.isArray(eaBridgeSessions) || eaBridgeSessions.length === 0) {
      return [];
    }
    return eaBridgeSessions.filter(
      (session) => String(session?.broker || '').toLowerCase() === effectivePlatformId
    );
  }, [eaBridgeSessions, effectivePlatformId]);

  const bridgeIsConnected = useMemo(() => {
    const sessions = selectedEaBridgeSessions;
    const nowMs = Date.now();

    if (Array.isArray(sessions) && sessions.length > 0) {
      return sessions.some((session) => {
        const heartbeat = Number(session?.lastHeartbeat || 0);
        return heartbeat > 0 && nowMs - heartbeat <= 2 * 60 * 1000;
      });
    }

    // Fallback: if quotes are actively streaming, treat the bridge as connected
    // even if sessions haven't loaded yet (or the endpoint is temporarily failing).
    const quotes = Array.isArray(marketFeed?.quotes) ? marketFeed.quotes : [];
    const updatedAt = Number(marketFeed?.updatedAt || 0);
    if (quotes.length > 0 && updatedAt > 0 && nowMs - updatedAt <= 2 * 60 * 1000) {
      return true;
    }

    return false;
  }, [selectedEaBridgeSessions, marketFeed?.quotes, marketFeed?.updatedAt]);

  const entryReadyPanelMeta = useMemo(() => {
    const quotes = Array.isArray(marketFeed?.quotes) ? marketFeed.quotes : [];
    const quoteCount = quotes.length;
    const uniqueSymbols = new Set(
      quotes
        .map((q) =>
          String(q?.symbol || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
    );

    const latestSignal = Array.isArray(entryReadySignals) ? entryReadySignals[0] : null;
    const latestCandidate = Array.isArray(candidateSignals) ? candidateSignals[0] : null;
    const latestSignalTs = toTimestamp(latestSignal?.openedAt || latestSignal?.timestamp) || null;
    const latestCandidateTs =
      toTimestamp(latestCandidate?.openedAt || latestCandidate?.timestamp) || null;
    const latestTs =
      latestSignalTs && latestCandidateTs
        ? Math.max(latestSignalTs, latestCandidateTs)
        : latestSignalTs || latestCandidateTs || null;

    const retained = Array.isArray(entryReadySignals) ? entryReadySignals.length : 0;
    const candidateCount = Array.isArray(candidateSignals) ? candidateSignals.length : 0;
    const eaStatus = bridgeIsConnected ? 'Connected' : 'Disconnected';
    const modeLabel = entryReadySignalsMeta?.modeLabel || 'ENTER only';

    const isWatchMode = String(modeLabel || '')
      .trim()
      .toUpperCase()
      .startsWith('WATCH');

    const headline =
      retained > 0
        ? isWatchMode
          ? 'Live watchlist signals'
          : 'Live entry-ready signals'
        : 'Signal Dashboard';

    const emptyDetails = (() => {
      if (!bridgeIsConnected) {
        return candidateCount > 0
          ? `MetaTrader Bridge is offline (or idle). Showing the last ${candidateCount} analyzed candidates received (may be stale). Connect MT4/MT5 + EA to resume live entry-ready signals.`
          : 'MetaTrader Bridge is offline. Connect MT4/MT5 + EA to start receiving entry-ready signals.';
      }
      if (quoteCount <= 0) {
        return 'EA is connected, but no quotes are streaming yet. Ensure the EA is publishing quotes and the bridge is receiving ticks.';
      }
      const candidatesHint =
        candidateCount > 0
          ? ` No strict ENTER signals yet, but ${candidateCount} analyzed candidates are available below (with reasons).`
          : '';

      if (isWatchMode) {
        return `EA is connected and streaming quotes for ${uniqueSymbols.size || quoteCount} symbols. Showing WATCH signals (WAIT_MONITOR) — these are not entry-ready yet.${candidatesHint}`;
      }

      return `EA is connected and streaming quotes for ${uniqueSymbols.size || quoteCount} symbols. Scanning for strict ENTER setups…${candidatesHint}`;
    })();

    return {
      headline,
      eaStatus,
      quoteCount,
      symbolCount: uniqueSymbols.size || 0,
      retained,
      latestTs,
      modeLabel,
      emptyDetails,
      candidateCount
    };
  }, [
    bridgeIsConnected,
    entryReadySignals,
    entryReadySignalsMeta,
    candidateSignals,
    marketFeed?.quotes
  ]);

  const [wsMarketConnected, setWsMarketConnected] = useState(false);
  const wsQuoteBufferRef = useRef(new Map());
  const wsFlushTimerRef = useRef(null);

  // Smart active-symbols sync: keep the EA focused on the live ticker strip (no manual Analyze click).
  // Throttled + best-effort to avoid overwhelming the bridge.
  const activeSymbolsSyncRef = useRef({
    lastSentAt: 0,
    pending: new Set(),
    timer: null
  });

  const scheduleActiveSymbolsSync = useCallback(
    (symbols = []) => {
      if (!bridgeIsConnected) {
        return;
      }

      const ref = activeSymbolsSyncRef.current;
      const list = Array.isArray(symbols) ? symbols : [];
      for (const raw of list) {
        const normalized = normalizeTickerSymbol(raw);
        if (normalized) {
          ref.pending.add(normalized);
        }
      }

      if (ref.timer) {
        return;
      }

      const now = Date.now();
      const ttlMs = 3 * 60 * 1000;
      const minIntervalMs = 60 * 1000;
      const delayMs = Math.max(0, minIntervalMs - (now - (ref.lastSentAt || 0)));

      ref.timer = setTimeout(async () => {
        ref.timer = null;
        if (!bridgeIsConnected) {
          ref.pending.clear();
          return;
        }

        const toSend = Array.from(ref.pending).slice(0, ACTIVE_SYMBOLS_SYNC_MAX);
        if (toSend.length === 0) {
          return;
        }

        try {
          await postJson(`/api/broker/bridge/${effectivePlatformId}/market/active-symbols`, {
            symbols: toSend,
            ttlMs
          });
          for (const s of toSend) {
            ref.pending.delete(s);
          }
          ref.lastSentAt = Date.now();
        } catch (_error) {
          // best-effort: keep pending symbols, but avoid tight retry loops
          ref.lastSentAt = Date.now();
        }
      }, delayMs);
    },
    [bridgeIsConnected, effectivePlatformId]
  );

  useEffect(() => {
    if (!bridgeIsConnected) {
      setWsMarketConnected(false);
      return undefined;
    }

    let ws;
    let stopped = false;
    let retry = 0;
    let retryTimer;

    const scheduleFlush = () => {
      if (wsFlushTimerRef.current) {
        return;
      }
      wsFlushTimerRef.current = setTimeout(() => {
        wsFlushTimerRef.current = null;

        const updates = wsQuoteBufferRef.current;
        if (!updates || updates.size === 0) {
          return;
        }
        wsQuoteBufferRef.current = new Map();

        // Keep EA snapshot/bars streaming for the symbols moving on the tape.
        scheduleActiveSymbolsSync(Array.from(updates.keys()));

        lastQuoteUpdateSymbolsRef.current = Array.from(updates.keys());

        startTransition(() => {
          setMarketFeed((prev) => {
            const prevQuotes = Array.isArray(prev?.quotes) ? prev.quotes.filter(Boolean) : [];
            const bySymbol = quotesBySymbolRef.current;
            let symbols = quoteSymbolsRef.current;
            let indexBySymbol = quoteIndexBySymbolRef.current;

            // One-time lazy init if the app bootstrapped quotes before refs were populated.
            if ((!symbols || symbols.length === 0) && prevQuotes.length > 0) {
              const nextBySymbol = new Map();
              const nextSymbols = [];
              const nextIndex = new Map();
              for (const q of prevQuotes) {
                const sym = String(q?.symbol || '')
                  .trim()
                  .toUpperCase();
                if (!sym || nextBySymbol.has(sym)) {
                  continue;
                }
                nextSymbols.push(sym);
                nextIndex.set(sym, nextSymbols.length - 1);
                nextBySymbol.set(sym, { ...q, symbol: sym });
              }
              quotesBySymbolRef.current = nextBySymbol;
              quoteSymbolsRef.current = nextSymbols;
              quoteIndexBySymbolRef.current = nextIndex;
              symbols = nextSymbols;
              indexBySymbol = nextIndex;
            }

            const nextQuotes = prevQuotes.slice();
            const newlySeen = [];
            const newlySeenSet = new Set();

            for (const [symbolRaw, quote] of updates.entries()) {
              const symbol = String(symbolRaw || quote?.symbol || '')
                .trim()
                .toUpperCase();
              if (!symbol) {
                continue;
              }

              const merged = { ...(bySymbol.get(symbol) || {}), ...(quote || {}), symbol };
              bySymbol.set(symbol, merged);

              const idx = indexBySymbol?.get?.(symbol);
              if (Number.isInteger(idx) && idx >= 0 && idx < nextQuotes.length) {
                nextQuotes[idx] = merged;
              } else if (!newlySeenSet.has(symbol)) {
                newlySeenSet.add(symbol);
                newlySeen.push(symbol);
              }
            }

            if (newlySeen.length > 0) {
              const mergedSymbols = Array.isArray(symbols) ? symbols.slice() : [];
              for (const s of newlySeen) {
                mergedSymbols.push(s);
              }
              const uniqueSorted = Array.from(new Set(mergedSymbols)).sort((a, b) =>
                String(a || '').localeCompare(String(b || ''))
              );

              const rebuiltQuotes = uniqueSorted.map((s) => bySymbol.get(s)).filter(Boolean);
              const rebuiltIndex = new Map();
              for (let i = 0; i < uniqueSorted.length; i += 1) {
                rebuiltIndex.set(uniqueSorted[i], i);
              }

              quoteSymbolsRef.current = uniqueSorted;
              quoteIndexBySymbolRef.current = rebuiltIndex;

              return {
                ...prev,
                quotes: rebuiltQuotes,
                loading: false,
                error: null,
                updatedAt: Date.now()
              };
            }

            return {
              ...prev,
              quotes: nextQuotes,
              loading: false,
              error: null,
              updatedAt: Date.now()
            };
          });
        });
      }, 650);
    };

    const connect = () => {
      if (stopped) {
        return;
      }

      const { wsUrl, apiKey } = getApiConfig();
      let url = wsUrl;
      if (!url) {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        url = `${proto}://${window.location.host}/ws/trading`;
      }

      if (apiKey && url) {
        try {
          const withKey = new URL(url);
          if (!withKey.searchParams.get('api_key')) {
            withKey.searchParams.set('api_key', apiKey);
          }
          url = withKey.toString();
        } catch (_error) {
          // ignore URL parse errors
        }
      }

      ws = new WebSocket(url);

      ws.addEventListener('open', () => {
        retry = 0;
        setWsMarketConnected(true);
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event?.data || ''));
          if (!msg || typeof msg !== 'object') {
            return;
          }

          if (msg.type === 'ea.market.quotes') {
            const payload = msg.payload || {};
            const broker = normalizeBrokerId(payload?.broker || '');
            if (broker !== effectivePlatformId) {
              return;
            }
            const items = Array.isArray(payload?.items) ? payload.items : [];
            for (const q of items) {
              const symbol = String(q?.symbol || '')
                .trim()
                .toUpperCase();
              if (!symbol) {
                continue;
              }
              wsQuoteBufferRef.current.set(symbol, {
                symbol,
                bid: q?.bid ?? null,
                ask: q?.ask ?? null,
                last: q?.last ?? null,
                digits: q?.digits ?? null,
                point: q?.point ?? null,
                spreadPoints: q?.spreadPoints ?? null,
                timestamp: q?.timestamp ?? null
              });
            }
            scheduleFlush();
            return;
          }

          if (msg.type === 'signal') {
            const payloadBroker = normalizeBrokerId(msg.payload?.broker || '');
            if (payloadBroker && payloadBroker !== effectivePlatformId) {
              return;
            }
            const normalized = normalizeSignal(msg.payload || {}, msg.timestamp);
            if (normalized) {
              startTransition(() => mergeSignals([normalized]));
            }
            return;
          }

          if (msg.type === 'signal_candidate') {
            const payloadBroker = normalizeBrokerId(msg.payload?.broker || '');
            if (payloadBroker && payloadBroker !== effectivePlatformId) {
              return;
            }
            const normalized = normalizeSignal(msg.payload || {}, msg.timestamp);
            if (normalized) {
              startTransition(() => mergeCandidateSignals([normalized]));
            }
            return;
          }

          if (msg.type === 'signal_candidates') {
            const payload = msg.payload || {};
            const items = Array.isArray(payload?.items)
              ? payload.items
              : Array.isArray(payload)
                ? payload
                : [];
            const normalized = items
              .filter((s) => {
                const b = normalizeBrokerId(s?.broker || '');
                return !b || b === effectivePlatformId;
              })
              .map((s) => normalizeSignal(s, msg.timestamp))
              .filter(Boolean);
            if (normalized.length) {
              startTransition(() => mergeCandidateSignals(normalized));
            }
            return;
          }

          if (msg.type === 'signals') {
            const payload = msg.payload || {};
            const items = Array.isArray(payload?.items)
              ? payload.items
              : Array.isArray(payload)
                ? payload
                : [];
            const normalized = items
              .filter((s) => {
                const b = normalizeBrokerId(s?.broker || '');
                return !b || b === effectivePlatformId;
              })
              .map((s) => normalizeSignal(s, msg.timestamp))
              .filter(Boolean);
            if (normalized.length) {
              startTransition(() => mergeSignals(normalized));
            }
            return;
          }
        } catch (_error) {
          // ignore
        }
      });

      ws.addEventListener('close', () => {
        setWsMarketConnected(false);
        if (stopped) {
          return;
        }
        const backoffMs = Math.min(10000, 500 + retry * 1000);
        retry = Math.min(10, retry + 1);
        retryTimer = setTimeout(connect, backoffMs);
      });

      ws.addEventListener('error', () => {
        // allow close handler to trigger reconnect
      });
    };

    connect();

    return () => {
      stopped = true;
      setWsMarketConnected(false);
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      if (wsFlushTimerRef.current) {
        clearTimeout(wsFlushTimerRef.current);
        wsFlushTimerRef.current = null;
      }
      if (activeSymbolsSyncRef.current?.timer) {
        clearTimeout(activeSymbolsSyncRef.current.timer);
        activeSymbolsSyncRef.current.timer = null;
        activeSymbolsSyncRef.current.pending?.clear?.();
      }
      try {
        ws?.close();
      } catch (_error) {
        // ignore
      }
    };
  }, [bridgeIsConnected, effectivePlatformId]);

  useEffect(() => {
    if (bridgeIsConnected) {
      setTickerCategory('ALL');
    }
  }, [bridgeIsConnected]);

  const requestSnapshotForSymbol = useCallback(
    async (symbolValue) => {
      const normalized = normalizeTickerSymbol(symbolValue);
      if (!normalized || !bridgeIsConnected) {
        return;
      }
      try {
        // Hint the server/EA to focus on this symbol only (lazy loading).
        await postJson(`/api/broker/bridge/${effectivePlatformId}/market/active-symbols`, {
          symbols: [normalized],
          ttlMs: 15 * 60 * 1000
        });

        await postJson(`/api/broker/bridge/${effectivePlatformId}/market/snapshot/request`, {
          symbol: normalized,
          ttlMs: 2 * 60 * 1000
        });
      } catch (_error) {
        // Best-effort: EA may be offline or auth may block.
      }
    },
    [bridgeIsConnected, effectivePlatformId]
  );

  const openAnalyzerForSymbolAndRequestSnapshot = useCallback(
    (symbolValue) => {
      const raw = String(symbolValue || '').trim();
      const normalized = normalizeTickerSymbol(raw);
      if (!normalized) {
        return;
      }
      void requestSnapshotForSymbol(normalized);
      preserveScrollPosition(() => {
        setAnalyzerSymbol(raw);
        setAnalyzerOpen(true);
        setPairAnalysisOpen(false);
      });
    },
    [preserveScrollPosition, requestSnapshotForSymbol]
  );

  const openPairAnalysisForSymbolAndRequestSnapshot = useCallback(
    (symbolValue) => {
      const raw = String(symbolValue || '').trim();
      const normalized = normalizeTickerSymbol(raw);
      if (!normalized) {
        return;
      }
      void requestSnapshotForSymbol(normalized);
      preserveScrollPosition(() => {
        setAnalyzerSymbol(raw);
        setAnalyzerOpen(false);
        setPairAnalysisOpen(true);
      });
    },
    [preserveScrollPosition, requestSnapshotForSymbol]
  );

  const closeAnalyzer = useCallback(() => {
    if (pairAnalysisOpen) {
      setPairAnalysisOpen(false);
      setAnalyzerOpen(true);
      return;
    }
    setAnalyzerOpen(false);
    setPairAnalysisOpen(false);
  }, [pairAnalysisOpen]);

  const analyzerSymbolNormalized = useMemo(
    () => (analyzerSymbol ? normalizeTickerSymbol(analyzerSymbol) : null),
    [analyzerSymbol]
  );

  const analyzerLiveQuote = useMemo(() => {
    const target = String(analyzerSymbolNormalized || '')
      .trim()
      .toUpperCase();
    if (!target) {
      return null;
    }
    const quotes = Array.isArray(marketFeed?.quotes) ? marketFeed.quotes : [];

    let best = null;
    let bestScore = 0;
    for (const q of quotes) {
      const sym = String(q?.symbol || '')
        .trim()
        .toUpperCase();
      if (!sym) {
        continue;
      }
      let score = 0;
      if (sym === target) {
        score = 1000;
      } else if (sym.startsWith(target)) {
        score = 800;
      } else if (target.startsWith(sym)) {
        score = 750;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { ...q, symbol: sym };
      }
    }
    return best;
  }, [analyzerSymbolNormalized, marketFeed?.quotes]);

  const analysisIsOpen = analyzerOpen || pairAnalysisOpen;

  useEffect(() => {
    // EA-only UI mode: the canonical analyzer is /api/broker/bridge/:broker/analysis/get.
    // Disable the scenario analyzer pipeline entirely.
    if (EA_ONLY_UI_MODE) {
      if (analyzerOpen) {
        setAnalyzerOpen(false);
      }
      setScenarioSnapshot({
        scenario: null,
        signal: null,
        loading: false,
        error: null,
        retry: null,
        updatedAt: null
      });
      return;
    }

    if (!analysisIsOpen) {
      setScenarioSnapshot({
        scenario: null,
        signal: null,
        loading: false,
        error: null,
        retry: null,
        updatedAt: null
      });
      return;
    }

    const symbol = analyzerSymbolNormalized;
    if (!symbol) {
      setScenarioSnapshot({
        scenario: null,
        signal: null,
        loading: false,
        error: 'Enter a valid symbol to analyze.',
        retry: null,
        updatedAt: null
      });
      return;
    }

    const brokerIsEa = effectivePlatformId === 'mt4' || effectivePlatformId === 'mt5';
    if (brokerIsEa && !bridgeIsConnected) {
      setScenarioSnapshot({
        scenario: null,
        signal: null,
        loading: false,
        error: 'MetaTrader is not connected yet. Wait for live prices, then retry analysis.',
        retry: null,
        updatedAt: null
      });
      return;
    }

    let cancelled = false;
    let retryTimer = null;
    let pollTimer = null;
    let retryCount = 0;
    let inflight = false;
    const maxRetries = 10;
    const run = async () => {
      if (inflight) {
        return;
      }
      inflight = true;
      setScenarioSnapshot((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const qs = new URLSearchParams({
          pair: symbol,
          broker: effectivePlatformId
        });

        // Pair Analysis is EA-first and should not mix in external providers.
        if (pairAnalysisOpen) {
          qs.set('eaOnly', 'true');
          qs.set('analysisMode', 'ea');
        }
        const response = await fetchJson(`/api/scenario/analyze?${qs.toString()}`);
        const scenario = response?.scenario || null;
        const signal = response?.signal || null;
        if (cancelled) {
          return;
        }
        setScenarioSnapshot({
          scenario,
          signal,
          loading: false,
          error: scenario ? null : 'No scenario returned for this symbol yet.',
          retry: null,
          updatedAt: Date.now()
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = String(error?.message || 'Failed to load scenario');
        const shouldRetry =
          message.includes('Waiting for live') ||
          message.toLowerCase().includes('not connected yet') ||
          message.toLowerCase().includes('quotes unavailable');

        const nextRetry = shouldRetry && retryCount < maxRetries ? retryCount + 1 : null;
        setScenarioSnapshot((prev) => ({
          // Keep the previous scenario visible while we wait/retry,
          // to avoid UI flicker ("disappear and come back") in MT mode.
          scenario: shouldRetry ? prev?.scenario || null : null,
          signal: shouldRetry ? prev?.signal || null : null,
          loading: false,
          error: message,
          retry: nextRetry != null ? { attempt: nextRetry, max: maxRetries } : null,
          updatedAt: Date.now()
        }));

        if (shouldRetry && retryCount < maxRetries) {
          retryCount = nextRetry;
          retryTimer = setTimeout(() => {
            if (!cancelled) {
              run();
            }
          }, 2000);
        }
      } finally {
        inflight = false;
      }
    };

    run();
    // Keep analysis fresh while the workspace is open.
    // Pair Analysis wants near-live refresh; the regular analyzer can be slower.
    const pollEveryMs = pairAnalysisOpen ? 20_000 : 60_000;
    pollTimer = setInterval(() => {
      if (!cancelled) {
        run();
      }
    }, pollEveryMs);
    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    };
  }, [
    analysisIsOpen,
    analyzerSymbolNormalized,
    bridgeIsConnected,
    pairAnalysisOpen,
    effectivePlatformId
  ]);

  useEffect(() => {
    const rawSignal = analyzerSnapshot?.signal || null;
    if (!rawSignal) {
      return;
    }

    const normalized = normalizeSignal(rawSignal, analyzerSnapshot.updatedAt);
    if (!normalized) {
      return;
    }

    const decisionState = normalized?.isValid?.decision?.state || null;
    if (decisionState !== 'ENTER') {
      return;
    }

    const minPublishStrength = 80;
    const minPublishConfidence = 80;

    if (
      !Number.isFinite(Number(normalized.strength)) ||
      Number(normalized.strength) < minPublishStrength
    ) {
      return;
    }
    if (
      !Number.isFinite(Number(normalized.confidence)) ||
      Number(normalized.confidence) < minPublishConfidence
    ) {
      return;
    }
    if (normalized.winRate != null && Number.isFinite(Number(normalized.winRate))) {
      if (Number(normalized.winRate) < 80) {
        return;
      }
    }

    const direction = String(normalized.direction || '').toUpperCase();
    if (direction !== 'BUY' && direction !== 'SELL') {
      return;
    }

    const entry = rawSignal.entry || {};
    const entryPrice = entry.price ?? rawSignal.entryPrice;
    const stopLoss = entry.stopLoss ?? rawSignal.stopLoss;
    const takeProfit = entry.takeProfit ?? rawSignal.takeProfit;

    if (
      !Number.isFinite(Number(entryPrice)) ||
      !Number.isFinite(Number(stopLoss)) ||
      !Number.isFinite(Number(takeProfit))
    ) {
      return;
    }

    const publishKey = `${String(normalized.pair || '').toUpperCase()}|${
      normalized.generatedAt || normalized.timestamp || analyzerSnapshot.updatedAt || ''
    }|${direction}`;
    if (publishedAnalyzerSignalRef.current.key === publishKey) {
      return;
    }

    publishedAnalyzerSignalRef.current.key = publishKey;
    mergeSignals([normalized]);
  }, [analyzerSnapshot, mergeSignals]);

  useEffect(() => {
    if (EA_ONLY_UI_MODE) {
      return;
    }
    const scenario = scenarioSnapshot?.scenario || null;
    const rawSignal = scenarioSnapshot?.signal || null;
    if (!scenario || !rawSignal) {
      return;
    }

    const isTradeValid = Boolean(scenario?.decision?.isTradeValid);
    if (!isTradeValid) {
      return;
    }

    const normalized = normalizeSignal(rawSignal, scenario.generatedAt || scenario.updatedAt);
    if (!normalized) {
      return;
    }

    const minPublishStrength = 80;
    const minPublishConfidence = 80;

    if (
      !Number.isFinite(Number(normalized.strength)) ||
      Number(normalized.strength) < minPublishStrength
    ) {
      return;
    }
    if (
      !Number.isFinite(Number(normalized.confidence)) ||
      Number(normalized.confidence) < minPublishConfidence
    ) {
      return;
    }
    if (normalized.winRate != null && Number.isFinite(Number(normalized.winRate))) {
      if (Number(normalized.winRate) < 80) {
        return;
      }
    }

    const direction = String(normalized.direction || '').toUpperCase();
    if (direction !== 'BUY' && direction !== 'SELL') {
      return;
    }

    const entry = normalized.entry || {};
    const entryPrice = entry.price ?? normalized.entryPrice;
    const stopLoss = entry.stopLoss ?? normalized.stopLoss;
    const takeProfit = entry.takeProfit ?? normalized.takeProfit;
    if (
      !Number.isFinite(Number(entryPrice)) ||
      !Number.isFinite(Number(stopLoss)) ||
      !Number.isFinite(Number(takeProfit))
    ) {
      return;
    }

    const publishKey = `${String(normalized.pair || '').toUpperCase()}|${
      normalized.generatedAt ||
      normalized.timestamp ||
      scenario.generatedAt ||
      scenarioSnapshot.updatedAt ||
      ''
    }|${direction}`;
    if (publishedAnalysisSignalRef.current.key === publishKey) {
      return;
    }

    publishedAnalysisSignalRef.current.key = publishKey;
    mergeSignals([normalized]);
  }, [mergeSignals, scenarioSnapshot]);

  const eaPairsFromQuotes = useMemo(() => {
    const quotes = Array.isArray(marketFeed?.quotes) ? marketFeed.quotes : [];
    const seen = new Set();
    const pairs = [];
    for (const q of quotes) {
      const sym = normalizeTickerSymbol(q?.symbol || q?.pair);
      if (!sym || seen.has(sym)) {
        continue;
      }
      seen.add(sym);
      pairs.push(sym);
    }
    return pairs;
  }, [marketFeed?.quotes]);

  const autoTradingEnabled = useMemo(() => {
    const status = engineSnapshot?.status || null;
    const enabledByBroker = status?.enabledByBroker || null;
    if (enabledByBroker && typeof enabledByBroker === 'object') {
      return Boolean(enabledByBroker[effectivePlatformId]);
    }
    return Boolean(status?.enabled);
  }, [engineSnapshot?.status, effectivePlatformId]);

  const visibleActiveTrades = useMemo(() => {
    if (!Array.isArray(activeTrades)) {
      return [];
    }
    return activeTrades.filter((trade) => {
      const broker = String(trade?.broker || trade?.brokerRoute || '').toLowerCase();
      return !broker || broker === effectivePlatformId;
    });
  }, [activeTrades, effectivePlatformId]);

  const visibleTradeHistory = useMemo(() => {
    if (!Array.isArray(tradeHistory)) {
      return [];
    }
    return tradeHistory.filter((trade) => {
      const broker = String(trade?.broker || trade?.brokerRoute || '').toLowerCase();
      return !broker || broker === effectivePlatformId;
    });
  }, [tradeHistory, effectivePlatformId]);

  const primaryEaSession = useMemo(() => {
    const sessions = selectedEaBridgeSessions;
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return null;
    }
    return [...sessions].sort(
      (a, b) => Number(b?.lastHeartbeat || 0) - Number(a?.lastHeartbeat || 0)
    )[0];
  }, [selectedEaBridgeSessions]);

  const toggleAutoTrading = useCallback(async () => {
    setAutoTradingPanelOpen(true);
    setAutoTradingAction({ loading: true, error: null });
    try {
      if (autoTradingEnabled) {
        const payload = await postJson('/api/auto-trading/stop', { broker: effectivePlatformId });
        setLastAutoTradingMessage(payload?.message || null);
      } else {
        const payload = await postJson('/api/auto-trading/start', { broker: effectivePlatformId });
        setLastAutoTradingMessage(payload?.message || null);
      }
      setLastAutoTradingChangeAt(Date.now());
      await loadEngineSnapshot();
      await refreshTradingData();
    } catch (error) {
      setAutoTradingAction({
        loading: false,
        error: error?.message || 'Failed to toggle auto trading'
      });
      return;
    }
    setAutoTradingAction({ loading: false, error: null });
  }, [autoTradingEnabled, effectivePlatformId, loadEngineSnapshot, refreshTradingData]);

  const autoTradingAutostartRef = useRef({ broker: null, startedAt: 0 });
  useEffect(() => {
    if (!DASHBOARD_AUTOTRADING_AUTOSTART) {
      return;
    }
    if (!EA_ONLY_UI_MODE) {
      return;
    }
    if (!bridgeIsConnected) {
      return;
    }
    if (autoTradingEnabled) {
      return;
    }
    if (autoTradingAction.loading) {
      return;
    }

    const nowMs = Date.now();
    const ref = autoTradingAutostartRef.current;
    const sameBroker = ref.broker === effectivePlatformId;
    if (sameBroker && ref.startedAt && nowMs - ref.startedAt < 30_000) {
      return;
    }
    ref.broker = effectivePlatformId;
    ref.startedAt = nowMs;

    (async () => {
      try {
        setAutoTradingAction({ loading: true, error: null });
        const payload = await postJson('/api/auto-trading/start', { broker: effectivePlatformId });
        setLastAutoTradingMessage(payload?.message || null);
        setLastAutoTradingChangeAt(Date.now());
        await loadEngineSnapshot();
        await refreshTradingData();
      } catch (error) {
        setAutoTradingAction({
          loading: false,
          error: error?.message || 'Failed to auto-start auto trading'
        });
        return;
      }
      setAutoTradingAction({ loading: false, error: null });
    })();
  }, [
    bridgeIsConnected,
    autoTradingEnabled,
    autoTradingAction.loading,
    effectivePlatformId,
    loadEngineSnapshot,
    refreshTradingData
  ]);

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
    refreshBrokerStatus();
    const timer = setInterval(refreshBrokerStatus, 120000);
    return () => clearInterval(timer);
  }, [refreshBrokerStatus]);

  useEffect(() => {
    refreshEaBridgeStats();
    const timer = setInterval(refreshEaBridgeStats, 60000);
    return () => clearInterval(timer);
  }, [refreshEaBridgeStats]);

  useEffect(() => {
    if (!bridgeIsConnected) {
      setMarketFeed({ quotes: [], news: [], loading: false, error: null, updatedAt: null });
      setTickerOffset(0);
      return;
    }

    // Quotes need to be near-live; news does not. Poll quotes frequently and refresh news less often.
    refreshMarketFeed({ includeNews: true });

    const quotesPollIntervalMs = wsMarketConnected ? 120000 : 15000;
    const quotesTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      refreshMarketFeed({ includeNews: false });
    }, quotesPollIntervalMs);

    const newsTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      refreshMarketFeed({ includeNews: true });
    }, 600000);

    return () => {
      clearInterval(quotesTimer);
      clearInterval(newsTimer);
    };
  }, [bridgeIsConnected, refreshMarketFeed, wsMarketConnected]);

  useEffect(() => {
    if (!analysisIsOpen) {
      return;
    }

    if (!bridgeIsConnected) {
      setAnalyzerSnapshot({
        signal: null,
        loading: false,
        error: 'Bridge offline. Connect MT4/MT5 first.',
        updatedAt: null
      });
      return;
    }

    const symbol = analyzerSymbolNormalized;
    if (!symbol) {
      setAnalyzerSnapshot({
        signal: null,
        loading: false,
        error: 'Enter a valid symbol to analyze.',
        updatedAt: null
      });
      return;
    }

    let cancelled = false;
    let timer = null;
    let fastAttempts = 0;

    const hasTechnicalSnapshot = (signal) => {
      const frames =
        signal?.components?.technical?.timeframes ||
        signal?.components?.technical?.details?.timeframes ||
        null;
      if (!frames || typeof frames !== 'object') {
        return false;
      }
      const tfs = ['M15', 'H1', 'H4', 'D1'];
      return tfs.some((tf) => {
        const frame = frames[tf] || frames[tf.toLowerCase()] || null;
        const rsi = frame?.indicators?.rsi?.value;
        const macd = frame?.indicators?.macd?.histogram;
        const atr = frame?.indicators?.atr?.value;
        return (
          Number.isFinite(Number(rsi)) ||
          Number.isFinite(Number(macd)) ||
          Number.isFinite(Number(atr)) ||
          (frame?.ranges && typeof frame.ranges === 'object') ||
          (frame?.pivotPoints && typeof frame.pivotPoints === 'object')
        );
      });
    };

    const schedule = (delayMs) => {
      if (cancelled) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(loadAnalyzer, delayMs);
    };

    const loadAnalyzer = async () => {
      setAnalyzerSnapshot((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const response = await fetchJson(
          `/api/broker/bridge/${effectivePlatformId}/analysis/get?symbol=${encodeURIComponent(symbol)}&timeframe=M1&timeframes=M1,M15,H1,H4,D1`
        );

        const signal =
          response?.signal ||
          response?.data?.signal ||
          response?.payload?.signal ||
          response?.result?.signal ||
          null;

        const barsContext =
          response?.barsContext ||
          response?.data?.barsContext ||
          response?.payload?.barsContext ||
          response?.result?.barsContext ||
          null;

        const barsContextByTimeframe =
          response?.barsContextByTimeframe ||
          response?.data?.barsContextByTimeframe ||
          response?.payload?.barsContextByTimeframe ||
          response?.result?.barsContextByTimeframe ||
          null;

        if (cancelled) {
          return;
        }

        if (!signal) {
          setAnalyzerSnapshot({
            signal: null,
            barsContext,
            barsContextByTimeframe,
            loading: false,
            error:
              response?.message || response?.error || 'No analysis returned for this symbol yet.',
            updatedAt: Date.now()
          });
          void requestSnapshotForSymbol(symbol);
          schedule(3000);
          return;
        }

        const hydrated = hasTechnicalSnapshot(signal);
        setAnalyzerSnapshot({
          signal,
          barsContext,
          barsContextByTimeframe,
          loading: false,
          error: hydrated ? null : 'Waiting for MT snapshot (RSI/MACD/ATR/levels)…',
          updatedAt: Date.now()
        });

        if (!hydrated && fastAttempts < 20) {
          fastAttempts += 1;
          void requestSnapshotForSymbol(symbol);
          schedule(3000);
          return;
        }

        schedule(5000);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setAnalyzerSnapshot({
          signal: null,
          barsContext: null,
          barsContextByTimeframe: null,
          loading: false,
          error: error?.message || 'Failed to load analysis',
          updatedAt: Date.now()
        });
        schedule(6000);
      }
    };

    void requestSnapshotForSymbol(symbol);
    loadAnalyzer();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [analysisIsOpen, analyzerSymbolNormalized, bridgeIsConnected, effectivePlatformId]);

  const sortedQuotes = useMemo(() => {
    if (!Array.isArray(marketFeed.quotes) || marketFeed.quotes.length === 0) {
      return [];
    }
    // Quotes are already ordered by the backend (orderBy=symbol).
    return marketFeed.quotes;
  }, [marketFeed.quotes]);

  const tickerCatalogQuotes = useMemo(() => {
    const bySymbol = quotesBySymbolRef.current || new Map();
    const list = Array.isArray(TICKER_CATALOG_SYMBOLS) ? TICKER_CATALOG_SYMBOLS : [];
    if (list.length === 0) {
      return [];
    }

    return list.map((symbol) => {
      const normalized = normalizeTickerSymbol(symbol);
      if (!normalized) {
        return null;
      }
      return bySymbol.get(normalized) || { symbol: normalized };
    }).filter(Boolean);
  }, [marketFeed.updatedAt]);

  const tickerFilteredQuotes = useMemo(() => {
    const list = tickerCatalogQuotes;
    if (!Array.isArray(list) || list.length === 0) {
      return [];
    }
    const category = String(tickerCategory || 'ALL').toUpperCase();
    return list.filter((quote) => {
      const symbolUpper = normalizeTickerSymbol(quote?.symbol || quote?.pair);
      return matchesTickerCategory(symbolUpper, category);
    });
  }, [tickerCatalogQuotes, tickerCategory]);

  const analyzerQuote = useMemo(() => {
    if (!analyzerSymbolNormalized) {
      return null;
    }
    return (
      sortedQuotes.find(
        (quote) => normalizeTickerSymbol(quote?.symbol || quote?.pair) === analyzerSymbolNormalized
      ) || null
    );
  }, [analyzerSymbolNormalized, sortedQuotes]);

  const tickerSearchMatches = useMemo(() => {
    if (!tickerSearchNormalized) {
      return [];
    }
    const needle = String(tickerSearchNormalized || '')
      .trim()
      .toUpperCase();
    if (!needle) {
      return [];
    }

    // For very short queries, "startsWith" cuts down accidental matches.
    const shortQuery = needle.length <= 2;
    const results = [];
    for (const quote of tickerFilteredQuotes) {
      const symbol = normalizeTickerSymbol(quote?.symbol || quote?.pair);
      if (!symbol) {
        continue;
      }

      const exact = symbol === needle;
      const starts = shortQuery ? symbol.startsWith(needle) : symbol.startsWith(needle);
      const includes = shortQuery ? symbol.startsWith(needle) : symbol.includes(needle);
      if (!exact && !starts && !includes) {
        continue;
      }

      const hasQuote =
        Number.isFinite(Number(quote?.bid)) ||
        Number.isFinite(Number(quote?.ask)) ||
        Number.isFinite(Number(quote?.last));
      const score = (exact ? 3 : starts ? 2 : 1) + (hasQuote ? 0.5 : 0);
      results.push({ quote, symbol, score });
    }

    return results
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, MAX_TICKER_SEARCH_RESULTS)
      .map((item) => item.quote);
  }, [tickerFilteredQuotes, tickerSearchNormalized]);

  const tickerMatchesCount = useMemo(() => {
    if (!tickerSearchNormalized) {
      return 0;
    }
    return Array.isArray(tickerSearchMatches) ? tickerSearchMatches.length : 0;
  }, [tickerSearchMatches, tickerSearchNormalized]);

  const tickerSearchFocused = useMemo(() => {
    if (!tickerSearchNormalized) {
      return null;
    }
    if (!Array.isArray(tickerSearchMatches) || tickerSearchMatches.length === 0) {
      return null;
    }
    const exact = tickerSearchMatches.find(
      (quote) => normalizeTickerSymbol(quote?.symbol || quote?.pair) === tickerSearchNormalized
    );
    return exact || tickerSearchMatches[0] || null;
  }, [tickerSearchMatches, tickerSearchNormalized]);

  const tickerQuotes = useMemo(() => {
    const list = tickerFilteredQuotes;
    if (list.length === 0) {
      return [];
    }

    if (tickerSearchNormalized) {
      if (!Array.isArray(tickerSearchMatches) || tickerSearchMatches.length === 0) {
        return [];
      }
      if (tickerSearchFocused) {
        return [tickerSearchFocused];
      }
      return tickerSearchMatches.slice(0, 20);
    }

    const windowSize = Math.min(TICKER_WINDOW_SIZE, list.length);
    const start = ((tickerOffset % list.length) + list.length) % list.length;
    const end = start + windowSize;
    if (end <= list.length) {
      return list.slice(start, end);
    }
    return [...list.slice(start), ...list.slice(0, end - list.length)];
  }, [
    tickerFilteredQuotes,
    tickerOffset,
    tickerSearchFocused,
    tickerSearchMatches,
    tickerSearchNormalized
  ]);

  const tickerLoopQuotes = useMemo(() => {
    if (!Array.isArray(tickerQuotes) || tickerQuotes.length === 0) {
      return [];
    }
    const cap = Math.min(tickerQuotes.length, MAX_TICKER_RENDER / 2);
    const base = tickerQuotes.slice(0, Math.max(1, cap));
    return [...base, ...base];
  }, [tickerQuotes]);

  const tickerRenderQuotes = useMemo(() => {
    const list = tickerSearchNormalized ? tickerQuotes : tickerLoopQuotes;
    if (!Array.isArray(list) || list.length === 0) {
      return [];
    }
    if (tickerSearchNormalized) {
      return list;
    }
    return list.slice(0, Math.min(list.length, MAX_TICKER_RENDER));
  }, [tickerLoopQuotes, tickerQuotes, tickerSearchNormalized]);

  const tickerRenderModels = useMemo(() => {
    const list = Array.isArray(tickerRenderQuotes) ? tickerRenderQuotes : [];
    if (list.length === 0) {
      return [];
    }

    return list.map((quote, index) => {
      const symbolValue = quote?.symbol || quote?.pair;
      const symbolText = String(symbolValue ?? '').trim();
      const symbolUpper = symbolText.toUpperCase();

      const looksLikeFxPair = /^[A-Z]{6}$/.test(symbolUpper);
      const digits = Number.isFinite(Number(quote?.digits))
        ? Math.max(0, Math.min(8, Math.trunc(Number(quote.digits))))
        : null;
      const displayDigits = digits != null ? digits : looksLikeFxPair ? 5 : 3;

      const bid = Number.isFinite(Number(quote?.bid)) ? Number(quote.bid) : null;
      const ask = Number.isFinite(Number(quote?.ask)) ? Number(quote.ask) : null;
      const last = Number.isFinite(Number(quote?.last)) ? Number(quote.last) : null;

      const mid =
        bid != null && ask != null
          ? (bid + ask) / 2
          : bid != null
            ? bid
            : ask != null
              ? ask
              : last;

      const broker = normalizeBrokerId(quote?.broker || effectivePlatformId || '');
      const symbolNormalized = normalizeTickerSymbol(symbolValue);
      const deltaKey = `${broker}:${symbolNormalized}`;
      const prevMid = lastMidBySymbolRef.current.get(deltaKey);
      const delta =
        mid != null && prevMid != null && Number.isFinite(prevMid) ? mid - prevMid : null;

      const pointRaw = Number(quote?.point);
      const point =
        Number.isFinite(pointRaw) && pointRaw > 0
          ? pointRaw
          : Number.isFinite(displayDigits)
            ? Math.pow(10, -displayDigits)
            : null;

      const deltaPointsInt =
        delta != null && point != null && Number.isFinite(delta) ? Math.round(delta / point) : null;
      const deltaValue = deltaPointsInt != null && deltaPointsInt !== 0 ? deltaPointsInt : null;
      const deltaPointsAbs = deltaValue != null ? Math.abs(deltaValue) : null;

      const arrowClass =
        deltaValue != null && deltaValue > 0
          ? 'market-ticker__arrow--up'
          : deltaValue != null && deltaValue < 0
            ? 'market-ticker__arrow--down'
            : '';

      const deltaClass =
        deltaValue != null && deltaValue > 0
          ? 'market-ticker__delta--up'
          : deltaValue != null && deltaValue < 0
            ? 'market-ticker__delta--down'
            : '';

      const priceClass =
        deltaValue != null && deltaValue > 0
          ? 'market-ticker__price--up'
          : deltaValue != null && deltaValue < 0
            ? 'market-ticker__price--down'
            : '';

      const details =
        bid != null && ask != null
          ? `${formatNumber(bid, displayDigits)} / ${formatNumber(ask, displayDigits)}`
          : bid != null
            ? `Bid ${formatNumber(bid, displayDigits)}`
            : ask != null
              ? `Ask ${formatNumber(ask, displayDigits)}`
              : mid != null
                ? `Mid ${formatNumber(mid, displayDigits)}`
                : last != null
                  ? `Last ${formatNumber(last, displayDigits)}`
                  : '';

      const loopTag = tickerSearchNormalized
        ? 's'
        : index < tickerQuotes.length
          ? 'a'
          : 'b';

      const selected = String(symbolUpper || symbolText || symbolValue || '').trim();

      return {
        key: `${quote?.broker || effectivePlatformId}:${symbolUpper || symbolValue}:${loopTag}:${index}`,
        selected,
        symbolLabel: symbolUpper || symbolText || symbolValue,
        midLabel: mid != null ? formatNumber(mid, displayDigits) : '—',
        detailsLabel: details || '—',
        detailsEmpty: !details,
        deltaLabel: deltaPointsAbs != null ? `${deltaPointsAbs}p` : '',
        deltaEmpty: deltaValue == null,
        arrow: deltaValue != null ? (deltaValue > 0 ? '▲' : deltaValue < 0 ? '▼' : '•') : '•',
        arrowClass,
        priceClass,
        deltaClass
      };
    });
  }, [effectivePlatformId, tickerQuotes.length, tickerRenderQuotes, tickerSearchNormalized]);

  const onTickerItemClick = useCallback(
    (event) => {
      const rawSelected = event?.currentTarget?.getAttribute?.('data-symbol');
      const selected = String(rawSelected || '').trim();
      if (!selected) {
        return;
      }
      setTickerSearch(selected);
      if (EA_ONLY_UI_MODE) {
        openPairAnalysisForSymbolAndRequestSnapshot(selected);
      } else {
        openAnalyzerForSymbolAndRequestSnapshot(selected);
      }
    },
    [openAnalyzerForSymbolAndRequestSnapshot, openPairAnalysisForSymbolAndRequestSnapshot]
  );

  const tickerListRows = useMemo(() => {
    if (!tickerSearchNormalized) {
      return [];
    }

    const list = Array.isArray(tickerSearchMatches) ? tickerSearchMatches.slice(0, 60) : [];
    const now = Date.now();

    return list
      .map((quote) => {
        const symbolValue = quote?.symbol || quote?.pair;
        const symbol = String(symbolValue ?? '').trim().toUpperCase();
        if (!symbol) {
          return null;
        }

        const looksLikeFxPair = /^[A-Z]{6}$/.test(symbol);
        const digits = Number.isFinite(Number(quote?.digits))
          ? Math.max(0, Math.min(8, Math.trunc(Number(quote.digits))))
          : null;
        const displayDigits = digits != null ? digits : looksLikeFxPair ? 5 : 3;

        const bid = Number.isFinite(Number(quote?.bid)) ? Number(quote.bid) : null;
        const ask = Number.isFinite(Number(quote?.ask)) ? Number(quote.ask) : null;
        const spreadPoints = Number.isFinite(Number(quote?.spreadPoints))
          ? Number(quote.spreadPoints)
          : null;

        const ts = toTimestamp(quote?.timestamp);
        const ageSec = ts != null ? Math.max(0, Math.round((now - ts) / 1000)) : null;

        return {
          key: symbol,
          selected: symbol,
          symbol,
          bidLabel: bid != null ? formatNumber(bid, displayDigits) : '—',
          askLabel: ask != null ? formatNumber(ask, displayDigits) : '—',
          spreadLabel: spreadPoints != null ? `${formatNumber(spreadPoints, 0)}p` : '—',
          ageLabel: ageSec != null ? `${ageSec}s` : '—',
          assetClass: classifyTickerSymbol(symbol)
        };
      })
      .filter(Boolean);
  }, [tickerSearchMatches, tickerSearchNormalized]);

  useEffect(() => {
    if (!bridgeIsConnected) {
      return;
    }

    if (tickerSearchNormalized) {
      return;
    }

    const viewport = tickerViewportRef.current;
    const track = tickerTrackRef.current;
    if (!viewport || !track) {
      return;
    }

    let rafId = null;
    let resizeRaf = null;

    const updateDuration = () => {
      const viewportWidth = viewport.clientWidth || 0;
      const trackWidth = track.scrollWidth || 0;
      if (!viewportWidth || !trackWidth) {
        return;
      }

      const prev = tickerMeasureRef.current;
      if (prev.viewportWidth === viewportWidth && prev.trackWidth === trackWidth) {
        return;
      }

      // Animation travels 50% of the duplicated track width.
      const travelPx = trackWidth / 2;
      // Keep a slow, readable speed regardless of the number of items.
      const pixelsPerSecond = 18;
      const rawSeconds = travelPx / pixelsPerSecond;
      const durationSeconds = Math.max(240, Math.min(1800, Math.round(rawSeconds)));

      if (prev.duration !== durationSeconds) {
        track.style.setProperty('--market-ticker-duration', `${durationSeconds}s`);
      }

      tickerMeasureRef.current = {
        viewportWidth,
        trackWidth,
        duration: durationSeconds
      };
    };

    const scheduleMeasure = () => {
      if (resizeRaf != null) {
        return;
      }
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        updateDuration();
      });
    };

    rafId = requestAnimationFrame(updateDuration);
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(viewport);
    resizeObserver.observe(track);
    window.addEventListener('resize', scheduleMeasure);
    return () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
      }
      if (resizeRaf != null) {
        cancelAnimationFrame(resizeRaf);
      }
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [bridgeIsConnected, tickerLoopQuotes.length, tickerSearchNormalized]);

  const tickerNewsItems = useMemo(() => {
    const news = Array.isArray(marketFeed.news) ? marketFeed.news : [];
    if (!tickerSearchNormalized) {
      return news.slice(0, 8);
    }

    const focusSymbol = tickerSearchFocused
      ? normalizeTickerSymbol(tickerSearchFocused?.symbol || tickerSearchFocused?.pair)
      : tickerSearchNormalized;

    const currencies = extractFxCurrencies(focusSymbol);

    return news.filter((item) => {
      const itemSymbol = normalizeTickerSymbol(item?.symbol);
      if (itemSymbol && itemSymbol === focusSymbol) {
        return true;
      }
      const currency = String(item?.currency || '').toUpperCase();
      if (currency && currencies && currencies.includes(currency)) {
        return true;
      }
      return false;
    });
  }, [marketFeed.news, tickerSearchFocused, tickerSearchNormalized]);

  useEffect(() => {
    if (!bridgeIsConnected) {
      lastMidBySymbolRef.current.clear();
      return;
    }

    if (!Array.isArray(sortedQuotes) || sortedQuotes.length === 0) {
      return;
    }

    const map = lastMidBySymbolRef.current;
    const updates = Array.isArray(lastQuoteUpdateSymbolsRef.current)
      ? lastQuoteUpdateSymbolsRef.current
      : [];

    const now = Date.now();
    const shouldFullScan =
      updates.length === 0 || now - (lastMidCleanupRef.current || 0) > 5 * 60 * 1000;

    if (!shouldFullScan) {
      for (const symbolUpper of updates) {
        const quote = quotesBySymbolRef.current?.get?.(symbolUpper) || null;
        if (!quote) {
          continue;
        }
        const broker = String(quote?.broker || effectivePlatformId || '').toLowerCase();
        const symbolNormalized = normalizeTickerSymbol(quote?.symbol || quote?.pair);
        if (!symbolNormalized) {
          continue;
        }
        const key = `${broker}:${symbolNormalized}`;
        const bid = Number.isFinite(Number(quote?.bid)) ? Number(quote.bid) : null;
        const ask = Number.isFinite(Number(quote?.ask)) ? Number(quote.ask) : null;
        const last = Number.isFinite(Number(quote?.last)) ? Number(quote.last) : null;
        const mid =
          bid != null && ask != null
            ? (bid + ask) / 2
            : bid != null
              ? bid
              : ask != null
                ? ask
                : last;
        if (mid == null) {
          continue;
        }
        map.set(key, mid);
      }
      lastQuoteUpdateSymbolsRef.current = [];
      return;
    }

    const keep = new Set();
    for (const quote of sortedQuotes) {
      const broker = String(quote?.broker || effectivePlatformId || '').toLowerCase();
      const symbolNormalized = normalizeTickerSymbol(quote?.symbol || quote?.pair);
      if (!symbolNormalized) {
        continue;
      }
      const key = `${broker}:${symbolNormalized}`;
      keep.add(key);

      const bid = Number.isFinite(Number(quote?.bid)) ? Number(quote.bid) : null;
      const ask = Number.isFinite(Number(quote?.ask)) ? Number(quote.ask) : null;
      const last = Number.isFinite(Number(quote?.last)) ? Number(quote.last) : null;
      const mid =
        bid != null && ask != null ? (bid + ask) / 2 : bid != null ? bid : ask != null ? ask : last;
      if (mid == null) {
        continue;
      }
      map.set(key, mid);
    }

    if (map.size > 6000) {
      for (const key of map.keys()) {
        if (!keep.has(key)) {
          map.delete(key);
        }
      }
    }

    lastMidCleanupRef.current = now;
  }, [bridgeIsConnected, marketFeed.updatedAt, effectivePlatformId, sortedQuotes]);

  const handleTickerCycle = useCallback(() => {
    if (!bridgeIsConnected) {
      return;
    }

    if (analyzerOpen) {
      return;
    }

    if (tickerSearchNormalized) {
      return;
    }

    const count = tickerFilteredQuotes.length;
    if (!Number.isFinite(count) || count <= 0) {
      setTickerOffset(0);
      return;
    }

    if (count <= TICKER_WINDOW_SIZE) {
      setTickerOffset(0);
      return;
    }

    setTickerOffset((prev) => (prev + TICKER_ADVANCE_STEP) % count);
  }, [analyzerOpen, bridgeIsConnected, tickerFilteredQuotes.length, tickerSearchNormalized]);

  useEffect(() => {
    loadEngineSnapshot();
    const interval = setInterval(loadEngineSnapshot, 45000);
    return () => clearInterval(interval);
  }, [loadEngineSnapshot]);

  const handleEngineEvent = useCallback(
    (event) => {
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
            ? payload.results
                .filter((item) => item && item.success && item.trade)
                .map((item) => item.trade)
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
        const broker = payload?.broker ? String(payload.broker).toLowerCase() : null;
        if (!broker || broker === effectivePlatformId) {
          const message =
            payload?.message ||
            (normalizedType === 'auto_trading_started'
              ? `Auto trading started for ${String(effectivePlatformId).toUpperCase()}`
              : `Auto trading stopped for ${String(effectivePlatformId).toUpperCase()}`);
          setLastAutoTradingMessage(String(message));
          setLastAutoTradingChangeAt(Date.now());
        }

        loadEngineSnapshot();
        refreshModuleHealth?.();
      }
    },
    [effectivePlatformId, loadEngineSnapshot, mergeSignals, refreshModuleHealth]
  );

  useWebSocketFeed(handleEngineEvent);

  const handleSignalGenerated = useCallback(
    (signal) => {
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
    },
    [loadEngineSnapshot, mergeSignals, refreshFeatureSnapshots, refreshModuleHealth]
  );

  const formatters = useMemo(
    () =>
      SESSION_BLUEPRINT.reduce((acc, session) => {
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

  const currentSessionLabel = useMemo(() => {
    if (!Array.isArray(sessionCards) || sessionCards.length === 0) {
      return '—';
    }
    const open = sessionCards.filter((session) => session.isOpen);
    if (open.length === 0) {
      return 'Closed';
    }
    return open
      .map((session) => session.label || session.city || session.id)
      .filter(Boolean)
      .join(' + ');
  }, [sessionCards]);

  const analyzerTechnicalTimeframes = useMemo(() => {
    const signal = EA_ONLY_UI_MODE
      ? analyzerSnapshot?.signal || null
      : scenarioSnapshot?.signal || analyzerSnapshot?.signal || null;
    return (
      signal?.components?.technical?.timeframes ||
      signal?.components?.technical?.details?.timeframes ||
      null
    );
  }, [scenarioSnapshot?.signal, analyzerSnapshot?.signal]);

  const analysisWorkspaceSignal = useMemo(() => {
    return EA_ONLY_UI_MODE
      ? analyzerSnapshot?.signal || null
      : scenarioSnapshot?.signal || analyzerSnapshot?.signal || null;
  }, [scenarioSnapshot?.signal, analyzerSnapshot?.signal]);

  const analysisWorkspaceSignalTimestamp = useMemo(() => {
    if (EA_ONLY_UI_MODE) {
      return analyzerSnapshot?.updatedAt || Date.now();
    }
    return (
      scenarioSnapshot?.scenario?.generatedAt ||
      scenarioSnapshot?.scenario?.updatedAt ||
      scenarioSnapshot?.updatedAt ||
      analyzerSnapshot?.updatedAt ||
      Date.now()
    );
  }, [
    scenarioSnapshot?.scenario?.generatedAt,
    scenarioSnapshot?.scenario?.updatedAt,
    scenarioSnapshot?.updatedAt,
    analyzerSnapshot?.updatedAt
  ]);

  const analyzerNormalizedSignal = useMemo(() => {
    return normalizeSignal(analysisWorkspaceSignal, analysisWorkspaceSignalTimestamp);
  }, [analysisWorkspaceSignal, analysisWorkspaceSignalTimestamp]);

  const analyzerD1 = useMemo(() => {
    const frames = analyzerTechnicalTimeframes;
    if (!frames || typeof frames !== 'object') {
      return null;
    }
    return frames.D1 || frames.d1 || null;
  }, [analyzerTechnicalTimeframes]);

  const engineStatus = engineSnapshot.status || null;
  const endpointLabel =
    engineStatus?.apiBaseUrl ||
    engineStatus?.environment ||
    engineStatus?.mode ||
    engineStatus?.host ||
    null;
  const buildLabel = engineStatus?.buildVersion || engineStatus?.version || null;

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <div className="dashboard__brand"></div>
        <div className="dashboard__meta">
          {endpointLabel && <span className="dashboard__tag">Endpoint · {endpointLabel}</span>}
          {buildLabel && <span className="dashboard__tag">Build · {buildLabel}</span>}
        </div>
      </header>

      <main className="dashboard__main">
        <section className="dashboard__section dashboard__section--sessions">
          {!pairAnalysisOpen && (
            <>
              <header className="section-header">
                <div>
                  <h2 className="section-header__title">Global Sessions</h2>
                  <p className="section-header__subtitle">
                    Live clocks and overlap windows for major markets
                  </p>
                </div>
                <div className="section-header__actions">
                  <label className="engine-console__bridge-select">
                    <span>Platform</span>
                    <select
                      id="platform"
                      name="platform"
                      value={selectedPlatform}
                      onChange={(event) => setSelectedPlatform(event.target.value)}
                    >
                      <option value="MT4">MT4</option>
                      <option value="MT5">MT5</option>
                    </select>
                  </label>
                  <SystemHealthHeaderIndicator
                    snapshot={engineSnapshot}
                    featureSnapshots={featureSnapshots}
                    signals={signals}
                    events={eventFeed}
                    eaOnly={EA_ONLY_UI_MODE}
                    eaBridgeConnected={bridgeIsConnected}
                    eaQuotes={marketFeed?.quotes || []}
                  />
                  {SHOW_AUTOTRADING_UI && (
                    <button
                      type="button"
                      className="engine-console__bridge-refresh engine-console__bridge-refresh--compact"
                      onClick={toggleAutoTrading}
                      disabled={!bridgeIsConnected || autoTradingAction.loading}
                      title={
                        bridgeIsConnected
                          ? 'Start/stop automated trading'
                          : 'Connect MT4/MT5 via MetaTrader Bridge first'
                      }
                    >
                      {autoTradingAction.loading
                        ? 'Working…'
                        : autoTradingEnabled
                          ? `Auto Trading (${selectedPlatform}): On`
                          : `Auto Trading (${selectedPlatform}): Off`}
                    </button>
                  )}
                  <button
                    type="button"
                    className="engine-console__bridge-refresh"
                    onClick={() => setMetaTraderBridgeOpen((current) => !current)}
                  >
                    MetaTrader Bridge
                  </button>
                </div>
              </header>

              {SHOW_AUTOTRADING_UI && autoTradingAction.error && (
                <div className="engine-console__warning">{autoTradingAction.error}</div>
              )}
              {eaBridgeStatsError && (
                <div className="engine-console__warning">{eaBridgeStatsError}</div>
              )}
            </>
          )}

          {analysisIsOpen && (
            <div
              className="market-analyzer"
              role="region"
              aria-label={pairAnalysisOpen ? 'Pair analysis page' : 'Market analyzer'}
            >
              <div className="market-analyzer__header">
                <div>
                  <div className="market-analyzer__title">
                    {String(analyzerSymbolNormalized || analyzerSymbol || '').toUpperCase() || '—'}{' '}
                    · {selectedPlatform}
                  </div>
                  <div className="market-analyzer__subtitle">
                    Session: {currentSessionLabel}
                    {analyzerSnapshot?.updatedAt
                      ? ` · updated ${formatRelativeTime(analyzerSnapshot.updatedAt)}`
                      : ''}
                  </div>
                </div>
                <div className="market-analyzer__actions">
                  <button
                    type="button"
                    className="engine-console__bridge-refresh engine-console__bridge-refresh--compact"
                    onClick={closeAnalyzer}
                  >
                    {pairAnalysisOpen ? 'Back' : 'Close'}
                  </button>
                </div>
              </div>

              {pairAnalysisOpen &&
                (analyzerSnapshot.loading || (!EA_ONLY_UI_MODE && scenarioSnapshot.loading)) && (
                  <div className="market-analyzer__loading">
                    Syncing data… (live price · history · economics · high impact news)
                  </div>
                )}

              {analyzerSnapshot.loading && (
                <div className="market-analyzer__loading">Loading analysis…</div>
              )}
              {analyzerSnapshot.error && (
                <div className="engine-console__warning">{analyzerSnapshot.error}</div>
              )}

              {!EA_ONLY_UI_MODE && scenarioSnapshot.error && (
                <div className="engine-console__warning">{scenarioSnapshot.error}</div>
              )}

              {!analyzerSnapshot.loading &&
                !analyzerSnapshot.error &&
                (!pairAnalysisOpen || EA_ONLY_UI_MODE || !scenarioSnapshot.loading) && (
                  <div className="market-analyzer__grid">
                    {pairAnalysisOpen && (
                      <div className="market-analyzer__card">
                        <div className="market-analyzer__card-title">Analysis Workspace</div>
                        <div className="market-analyzer__card-body">
                          {(() => {
                            const quote = analyzerQuote || null;
                            const scenario = scenarioSnapshot?.scenario || null;
                            const sources = scenario?.sources || null;

                            const quoteReceived = Number.isFinite(Number(quote?.receivedAt))
                              ? Number(quote.receivedAt)
                              : Number.isFinite(Number(quote?.timestamp))
                                ? Number(quote.timestamp)
                                : null;
                            const quoteAgeSec =
                              quoteReceived != null
                                ? Math.max(0, Math.round((Date.now() - quoteReceived) / 1000))
                                : null;

                            const layeredAnalysis =
                              analyzerSnapshot?.signal?.components?.layeredAnalysis ||
                              analyzerSnapshot?.signal?.layeredAnalysis ||
                              scenarioSnapshot?.signal?.components?.layeredAnalysis ||
                              scenarioSnapshot?.signal?.layeredAnalysis ||
                              null;
                            const layers = Array.isArray(layeredAnalysis?.layers)
                              ? layeredAnalysis.layers
                              : null;
                            const layer18 = layers
                              ? layers.find(
                                  (layer) =>
                                    String(layer?.key || '') === 'L18' ||
                                    Number(layer?.layer) === 18
                                )
                              : null;
                            const layer18Metrics = layer18?.metrics || null;
                            const killSwitch =
                              layer18Metrics?.decision?.killSwitch ||
                              layer18Metrics?.isValid?.decision?.killSwitch ||
                              null;
                            const killSwitchEnabled = killSwitch?.enabled === true;
                            const killSwitchBlocked = killSwitch?.blocked === true;
                            const killSwitchCount = Array.isArray(killSwitch?.items)
                              ? killSwitch.items.length
                              : Array.isArray(killSwitch?.ids)
                                ? killSwitch.ids.length
                                : null;
                            const killSwitchPreview = Array.isArray(killSwitch?.items)
                              ? killSwitch.items
                                  .slice(0, 3)
                                  .map((item) => String(item?.label || item?.id || '').trim())
                                  .filter(Boolean)
                                  .join(' · ')
                              : Array.isArray(killSwitch?.ids)
                                ? killSwitch.ids
                                    .slice(0, 3)
                                    .map((id) => String(id || '').trim())
                                    .filter(Boolean)
                                    .join(' · ')
                                : null;

                            const l18Decision = layer18Metrics?.decision || null;
                            const missingInputs =
                              l18Decision?.missingInputs &&
                              typeof l18Decision.missingInputs === 'object'
                                ? l18Decision.missingInputs
                                : null;
                            const missingInputsList = Array.isArray(missingInputs?.missing)
                              ? missingInputs.missing
                              : [];
                            const nextSteps = Array.isArray(l18Decision?.nextSteps)
                              ? l18Decision.nextSteps
                              : [];
                            const layer1 = Array.isArray(layeredAnalysis?.layers)
                              ? layeredAnalysis.layers.find(
                                  (layer) =>
                                    String(layer?.key || '') === 'L1' || Number(layer?.layer) === 1
                                )
                              : null;
                            const layer1Metrics = layer1?.metrics || null;
                            const formatNum = (value, digits = 6) => {
                              if (value == null || value === '') {
                                return '—';
                              }
                              const n = Number(value);
                              if (!Number.isFinite(n)) {
                                return '—';
                              }
                              const d = Math.max(0, Math.min(10, Number(digits) || 0));
                              return d === 0 ? String(Math.round(n)) : n.toFixed(d);
                            };
                            const formatBool = (value) =>
                              value === true ? 'yes' : value === false ? 'no' : '—';

                            const layer1Derived = (() => {
                              if (!layer1Metrics) {
                                return null;
                              }

                              const symbolUpper = String(layer1Metrics?.symbol || '').toUpperCase();
                              const inferDigits = (sym) => {
                                if (/^[A-Z]{6}$/.test(sym)) {
                                  const quote = sym.slice(3, 6);
                                  return quote === 'JPY' ? 3 : 5;
                                }
                                if (/^(XAU|XAG|XPT|XPD)[A-Z]{3}(\.[A-Z0-9]{1,6})?$/.test(sym)) {
                                  return 2;
                                }
                                return 3;
                              };

                              const digits =
                                layer1Metrics?.digits != null && Number.isFinite(Number(layer1Metrics.digits))
                                  ? Math.max(0, Math.min(8, Math.trunc(Number(layer1Metrics.digits))))
                                  : inferDigits(symbolUpper);

                              const point = (() => {
                                const p = Number(layer1Metrics?.point);
                                if (Number.isFinite(p) && p > 0) {
                                  return p;
                                }
                                return Math.pow(10, -digits);
                              })();

                              const bidRaw = layer1Metrics?.bid;
                              const askRaw = layer1Metrics?.ask;
                              const midRaw = layer1Metrics?.mid;
                              const lastRaw = layer1Metrics?.last;

                              const bidFallback =
                                bidRaw != null && bidRaw !== '' ? bidRaw : midRaw ?? lastRaw;
                              const askFallback =
                                askRaw != null && askRaw !== '' ? askRaw : midRaw ?? lastRaw;

                              const bid = Number.isFinite(Number(bidFallback)) ? Number(bidFallback) : null;
                              const ask = Number.isFinite(Number(askFallback)) ? Number(askFallback) : null;
                              const mid = Number.isFinite(Number(midRaw))
                                ? Number(midRaw)
                                : bid != null && ask != null
                                  ? (bid + ask) / 2
                                  : bid != null
                                    ? bid
                                    : ask != null
                                      ? ask
                                      : null;

                              const spread = bid != null && ask != null ? ask - bid : null;
                              const spreadPoints =
                                spread != null && Number.isFinite(point) && point > 0 ? spread / point : null;
                              const spreadPct =
                                spread != null && mid != null && mid !== 0 ? (spread / mid) * 100 : null;

                              return {
                                symbolUpper,
                                digits,
                                point,
                                bid,
                                ask,
                                mid,
                                spread,
                                spreadPoints,
                                spreadPct
                              };
                            })();

                            const scenarioAt = toTimestamp(scenario?.generatedAt);
                            const analyzerAt = toTimestamp(analyzerSnapshot?.updatedAt);
                            const syncDeltaSec =
                              scenarioAt != null && analyzerAt != null
                                ? Math.round(Math.abs(scenarioAt - analyzerAt) / 1000)
                                : null;

                            const retry = scenarioSnapshot?.retry || null;

                            return (
                              <>
                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Sync rule</span>
                                  <span className="market-analyzer__val">
                                    {EA_ONLY_UI_MODE
                                      ? 'EA-only: analysis + decisions come from the EA real-time feed.'
                                      : 'No decision is computed before data is ready.'}
                                  </span>
                                </div>
                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Live price</span>
                                  <span className="market-analyzer__val">
                                    {layer1Metrics?.quoteAgeMs != null
                                      ? `Quote age ${Math.max(
                                          0,
                                          Math.round(Number(layer1Metrics.quoteAgeMs) / 1000)
                                        )}s`
                                      : quoteReceived != null
                                        ? `Quote age ${quoteAgeSec != null ? `${quoteAgeSec}s` : '—'}`
                                        : 'Waiting for live quote…'}
                                  </span>
                                </div>

                                <div
                                  style={{
                                    marginTop: 12,
                                    paddingTop: 12,
                                    borderTop: '1px solid var(--border, rgba(255,255,255,0.12))'
                                  }}
                                >
                                  <div
                                    style={{
                                      fontWeight: 700,
                                      fontSize: 13,
                                      marginBottom: 8
                                    }}
                                  >
                                    Layer 1 — Raw Market Data (EA)
                                  </div>

                                  {layer1Metrics ? (
                                    <div
                                      style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                        gap: 8,
                                        fontSize: 12
                                      }}
                                    >
                                      {(() => {
                                        const bidFallback =
                                          layer1Derived?.bid != null ? layer1Derived.bid : layer1Metrics?.bid;
                                        const askFallback =
                                          layer1Derived?.ask != null ? layer1Derived.ask : layer1Metrics?.ask;

                                        return (
                                          <>
                                      <div>
                                        <strong>Symbol</strong>:{' '}
                                        {String(layer1Metrics.symbol || '—')}
                                      </div>
                                      <div style={{ textAlign: 'right' }}>
                                        <strong>Broker</strong>:{' '}
                                        {String(layer1Metrics.broker || '—')}
                                      </div>

                                      <div>
                                        <strong>Bid</strong>: {formatNum(bidFallback, 6)}
                                      </div>
                                      <div style={{ textAlign: 'right' }}>
                                        <strong>Ask</strong>: {formatNum(askFallback, 6)}
                                      </div>
                                          </>
                                        );
                                      })()}

                                      <div>
                                        <strong>Mid</strong>: {formatNum(layer1Metrics.mid, 6)}
                                      </div>
                                      <div style={{ textAlign: 'right' }}>
                                        <strong>Last</strong>: {formatNum(layer1Metrics.last, 6)}
                                      </div>

                                      <div>
                                        <strong>Spread</strong>:{' '}
                                        {layer1Metrics.spread != null && layer1Metrics.spread !== ''
                                          ? formatNum(layer1Metrics.spread, 6)
                                          : layer1Derived?.spread != null
                                            ? formatNum(layer1Derived.spread, 6)
                                            : '—'}
                                      </div>
                                      <div style={{ textAlign: 'right' }}>
                                        <strong>Spread pts</strong>:{' '}
                                        {layer1Metrics.spreadPoints != null &&
                                        layer1Metrics.spreadPoints !== ''
                                          ? formatNum(layer1Metrics.spreadPoints, 2)
                                          : layer1Derived?.spreadPoints != null
                                            ? formatNum(layer1Derived.spreadPoints, 2)
                                            : '—'}
                                      </div>

                                      <div>
                                        <strong>Spread %</strong>:{' '}
                                        {layer1Metrics.spreadPct != null && layer1Metrics.spreadPct !== ''
                                          ? formatNum(layer1Metrics.spreadPct, 4)
                                          : layer1Derived?.spreadPct != null
                                            ? formatNum(layer1Derived.spreadPct, 4)
                                            : '—'}
                                      </div>
                                      <div style={{ textAlign: 'right' }}>
                                        <strong>Liquidity</strong>:{' '}
                                        {String(layer1Metrics.liquidityHint || 'N/A')}
                                      </div>

                                      <div>
                                        <strong>Velocity</strong>:{' '}
                                        {formatNum(
                                          layer1Metrics.midVelocityPerSec != null
                                            ? layer1Metrics.midVelocityPerSec
                                            : 0,
                                          8
                                        )}/s
                                      </div>
                                      <div style={{ textAlign: 'right' }}>
                                        <strong>Mid Δ</strong>:{' '}
                                        {formatNum(layer1Metrics.midDelta != null ? layer1Metrics.midDelta : 0, 8)}
                                      </div>

                                      <div>
                                        <strong>Acceleration</strong>{' '}
                                        {formatNum(
                                          layer1Metrics.midAccelerationPerSec2 != null
                                            ? layer1Metrics.midAccelerationPerSec2
                                            : 0,
                                          8
                                        )}/s²
                                      </div>

                                      <div>
                                        <strong>Gap→M1 close</strong>:{' '}
                                        {formatNum(layer1Metrics.gapToMid, 8)}
                                      </div>
                                      <div style={{ textAlign: 'right' }}>
                                        <strong>Gap open</strong>:{' '}
                                        {formatNum(layer1Metrics.gapOpen, 8)}
                                      </div>

                                      <div>
                                        <strong>Volume (M1)</strong>:{' '}
                                        {formatNum(layer1Metrics.volume, 0)}
                                      </div>
                                      <div style={{ textAlign: 'right' }}>
                                        <strong>Quote age</strong>:{' '}
                                        {layer1Metrics.quoteAgeMs != null
                                          ? `${formatNum(layer1Metrics.quoteAgeMs, 0)}ms`
                                          : '—'}
                                      </div>

                                      <div>
                                        <strong>Bars (M15/H1)</strong>:{' '}
                                        {formatNum(layer1Metrics?.barsCoverage?.M15?.count, 0)}/
                                        {formatNum(layer1Metrics?.barsCoverage?.H1?.count, 0)}
                                      </div>

                                      <div>
                                        <strong>Pending</strong>:{' '}
                                        {formatBool(layer1Metrics.pending)}
                                      </div>
                                      <div style={{ textAlign: 'right' }}>
                                        <strong>Source</strong>:{' '}
                                        {String(layer1Metrics.quoteSource || '—')}
                                      </div>

                                      <div>
                                        <strong>TF focus</strong>:{' '}
                                        {String(layer1Metrics.timeframeFocus || '—')}
                                      </div>
                                      <div style={{ textAlign: 'right' }} />
                                    </div>
                                  ) : (
                                    <div style={{ opacity: 0.8, fontSize: 12 }}>
                                      Layer 1 not available yet.
                                    </div>
                                  )}
                                </div>
                                {!EA_ONLY_UI_MODE && (
                                  <div className="market-analyzer__row">
                                    <span className="market-analyzer__key">Economics + news</span>
                                    <span className="market-analyzer__val">
                                      {scenarioAt != null
                                        ? `Scenario generated ${formatRelativeTime(scenarioAt)}`
                                        : 'Waiting for scenario…'}
                                      {syncDeltaSec != null ? ` · sync Δ ${syncDeltaSec}s` : ''}
                                      {retry && scenarioAt == null
                                        ? ` · retry ${retry.attempt}/${retry.max}`
                                        : ''}
                                    </span>
                                  </div>
                                )}

                                {EA_ONLY_UI_MODE && (
                                  <div className="market-analyzer__row">
                                    <span className="market-analyzer__key">EA snapshot</span>
                                    <span className="market-analyzer__val">
                                      {analyzerAt != null
                                        ? `Updated ${formatRelativeTime(analyzerAt)}`
                                        : 'Waiting for EA snapshot…'}
                                    </span>
                                  </div>
                                )}

                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Explainability</span>
                                  <span className="market-analyzer__val">
                                    {layers
                                      ? `${layers.length} layers${layers.length === 18 ? ' (L1–L18)' : ''}`
                                      : 'Waiting for layered analysis…'}
                                  </span>
                                </div>

                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">L18 kill-switch</span>
                                  <span className="market-analyzer__val">
                                    {killSwitchEnabled
                                      ? killSwitchBlocked
                                        ? `BLOCKED${killSwitchCount != null ? ` · ${killSwitchCount} reason(s)` : ''}${killSwitchPreview ? ` · ${killSwitchPreview}` : ''}`
                                        : `OK${killSwitchCount != null ? ` · ${killSwitchCount} check(s)` : ''}`
                                      : layers
                                        ? 'Not reported in L18 yet.'
                                        : '—'}
                                  </span>
                                </div>

                                {missingInputsList.length > 0 && (
                                  <div className="market-analyzer__row">
                                    <span className="market-analyzer__key">Missing inputs</span>
                                    <span className="market-analyzer__val">
                                      {missingInputsList.slice(0, 6).join(' · ')}
                                      {missingInputsList.length > 6
                                        ? ` (+${missingInputsList.length - 6})`
                                        : ''}
                                    </span>
                                  </div>
                                )}

                                {nextSteps.length > 0 && (
                                  <div className="market-analyzer__row">
                                    <span className="market-analyzer__key">Next steps</span>
                                    <span className="market-analyzer__val">
                                      {nextSteps.slice(0, 2).join(' · ')}
                                      {nextSteps.length > 2 ? ` (+${nextSteps.length - 2})` : ''}
                                    </span>
                                  </div>
                                )}

                                {!EA_ONLY_UI_MODE && sources && (
                                  <div className="market-analyzer__row">
                                    <span className="market-analyzer__key">Sources</span>
                                    <span className="market-analyzer__val">
                                      {(() => {
                                        const news = sources?.news || {};
                                        const calendar = Array.isArray(sources?.calendar)
                                          ? sources.calendar
                                          : [];

                                        const allNews = [
                                          ...(Array.isArray(news?.base) ? news.base : []),
                                          ...(Array.isArray(news?.quote) ? news.quote : []),
                                          ...(Array.isArray(news?.external) ? news.external : [])
                                        ]
                                          .filter(Boolean)
                                          .slice(0, 8);

                                        const items = [];
                                        if (sources?.quote?.broker && sources?.quote?.symbol) {
                                          const ageMs = Number.isFinite(Number(sources.quote.ageMs))
                                            ? Number(sources.quote.ageMs)
                                            : null;
                                          items.push({
                                            kind: 'quote',
                                            label: `Live quote: ${String(sources.quote.broker).toUpperCase()} ${String(
                                              sources.quote.symbol
                                            ).toUpperCase()}${
                                              ageMs != null ? ` (${Math.round(ageMs / 1000)}s)` : ''
                                            }`
                                          });
                                        }

                                        for (const entry of allNews) {
                                          const headline = String(entry?.headline || '').trim();
                                          const url = entry?.url ? String(entry.url) : null;
                                          const sourceLabel = entry?.source
                                            ? String(entry.source).trim()
                                            : 'Unknown';
                                          if (!headline) {
                                            continue;
                                          }
                                          items.push({
                                            kind: 'news',
                                            label: `${sourceLabel}: ${headline}`,
                                            url
                                          });
                                        }

                                        for (const evt of calendar.slice(0, 6)) {
                                          const title = String(evt?.title || '').trim();
                                          if (!title) {
                                            continue;
                                          }
                                          const currency = evt?.currency
                                            ? String(evt.currency).toUpperCase()
                                            : null;
                                          const impact = Number.isFinite(Number(evt?.impact))
                                            ? Number(evt.impact)
                                            : null;
                                          const url = evt?.url ? String(evt.url) : null;
                                          items.push({
                                            kind: 'event',
                                            label: `${currency ? `${currency} ` : ''}${title}${
                                              impact != null ? ` (impact ${impact})` : ''
                                            }`,
                                            url
                                          });
                                        }

                                        if (items.length === 0) {
                                          return '—';
                                        }

                                        return (
                                          <div style={{ display: 'grid', gap: 6 }}>
                                            {items.slice(0, 10).map((item, idx) => {
                                              if (item.url) {
                                                return (
                                                  <a
                                                    key={`${item.kind}-${idx}`}
                                                    href={item.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                  >
                                                    {item.label}
                                                  </a>
                                                );
                                              }
                                              return (
                                                <div key={`${item.kind}-${idx}`}>{item.label}</div>
                                              );
                                            })}
                                          </div>
                                        );
                                      })()}
                                    </span>
                                  </div>
                                )}

                                {EA_ONLY_UI_MODE && (
                                  <div className="market-analyzer__row">
                                    <span className="market-analyzer__key">EA source</span>
                                    <span className="market-analyzer__val">
                                      {layer1Metrics?.quoteSource
                                        ? String(layer1Metrics.quoteSource)
                                        : '—'}
                                    </span>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {!EA_ONLY_UI_MODE && pairAnalysisOpen && (
                      <div className="market-analyzer__card">
                        <div className="market-analyzer__card-title">Asset DNA</div>
                        <div className="market-analyzer__card-body">
                          {(() => {
                            const signal = scenarioSnapshot?.signal || null;
                            const scenario = scenarioSnapshot?.scenario || null;
                            const fundamentals = scenario?.fundamentals || null;
                            const base =
                              fundamentals?.base?.currency ||
                              (analyzerSymbolNormalized && analyzerSymbolNormalized.length >= 6
                                ? analyzerSymbolNormalized.slice(0, 3)
                                : null);
                            const quote =
                              fundamentals?.quote?.currency ||
                              (analyzerSymbolNormalized && analyzerSymbolNormalized.length >= 6
                                ? analyzerSymbolNormalized.slice(3, 6)
                                : null);

                            const currencyProfiles = {
                              USD: {
                                country: 'United States',
                                centralBank: 'Federal Reserve (Fed)'
                              },
                              EUR: {
                                country: 'Eurozone',
                                centralBank: 'European Central Bank (ECB)'
                              },
                              GBP: {
                                country: 'United Kingdom',
                                centralBank: 'Bank of England (BoE)'
                              },
                              JPY: { country: 'Japan', centralBank: 'Bank of Japan (BoJ)' },
                              CHF: {
                                country: 'Switzerland',
                                centralBank: 'Swiss National Bank (SNB)'
                              },
                              CAD: { country: 'Canada', centralBank: 'Bank of Canada (BoC)' },
                              AUD: {
                                country: 'Australia',
                                centralBank: 'Reserve Bank of Australia (RBA)'
                              },
                              NZD: {
                                country: 'New Zealand',
                                centralBank: 'Reserve Bank of New Zealand (RBNZ)'
                              }
                            };

                            const baseProfile = base
                              ? currencyProfiles[String(base).toUpperCase()]
                              : null;
                            const quoteProfile = quote
                              ? currencyProfiles[String(quote).toUpperCase()]
                              : null;

                            const calendar =
                              signal?.components?.news?.calendarEvents ||
                              signal?.components?.news?.details?.calendarEvents ||
                              analyzerSnapshot?.signal?.components?.news?.calendarEvents ||
                              analyzerSnapshot?.signal?.components?.news?.details?.calendarEvents ||
                              [];
                            const calendarList = Array.isArray(calendar) ? calendar : [];

                            const baseUpper = base ? String(base).toUpperCase() : null;
                            const quoteUpper = quote ? String(quote).toUpperCase() : null;
                            const relevant = calendarList.filter((evt) => {
                              const cur = String(evt?.currency || '')
                                .trim()
                                .toUpperCase();
                              return (
                                (baseUpper && cur === baseUpper) ||
                                (quoteUpper && cur === quoteUpper)
                              );
                            });
                            const highImpactCount = relevant.filter((evt) => {
                              const impact = Number(evt?.impact);
                              return Number.isFinite(impact) && impact >= 25;
                            }).length;

                            return (
                              <>
                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Base</span>
                                  <span className="market-analyzer__val">
                                    {baseUpper || '—'}
                                    {baseProfile?.country ? ` · ${baseProfile.country}` : ''}
                                    {baseProfile?.centralBank
                                      ? ` · ${baseProfile.centralBank}`
                                      : ''}
                                  </span>
                                </div>
                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Quote</span>
                                  <span className="market-analyzer__val">
                                    {quoteUpper || '—'}
                                    {quoteProfile?.country ? ` · ${quoteProfile.country}` : ''}
                                    {quoteProfile?.centralBank
                                      ? ` · ${quoteProfile.centralBank}`
                                      : ''}
                                  </span>
                                </div>
                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">News sensitivity</span>
                                  <span className="market-analyzer__val">
                                    High impact events (next 72h window):{' '}
                                    {formatNumber(highImpactCount, 0)}
                                  </span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {!EA_ONLY_UI_MODE && pairAnalysisOpen && (
                      <div className="market-analyzer__card">
                        <div className="market-analyzer__card-title">
                          High Impact Events (Daily + Live)
                        </div>
                        <div className="market-analyzer__card-body">
                          {(() => {
                            const signal = scenarioSnapshot?.signal || null;
                            const scenario = scenarioSnapshot?.scenario || null;
                            const fundamentals = scenario?.fundamentals || null;
                            const base = fundamentals?.base?.currency || null;
                            const quote = fundamentals?.quote?.currency || null;
                            const baseUpper = base ? String(base).toUpperCase() : null;
                            const quoteUpper = quote ? String(quote).toUpperCase() : null;

                            const calendar =
                              signal?.components?.news?.calendarEvents ||
                              signal?.components?.news?.details?.calendarEvents ||
                              analyzerSnapshot?.signal?.components?.news?.calendarEvents ||
                              analyzerSnapshot?.signal?.components?.news?.details?.calendarEvents ||
                              [];
                            const calendarList = Array.isArray(calendar) ? calendar : [];
                            const nowMs = Date.now();

                            const normalized = calendarList
                              .map((evt) => {
                                const timeRaw = evt?.time || evt?.datetime || evt?.dateTime || null;
                                const timeMs =
                                  typeof timeRaw === 'number' && Number.isFinite(timeRaw)
                                    ? timeRaw
                                    : timeRaw instanceof Date
                                      ? timeRaw.getTime()
                                      : timeRaw
                                        ? Date.parse(String(timeRaw))
                                        : NaN;
                                const impact = Number(evt?.impact);
                                const currency = String(evt?.currency || '')
                                  .trim()
                                  .toUpperCase();
                                const title = evt?.event || evt?.title || evt?.name || 'Event';
                                const source = evt?.source ? String(evt.source).trim() : '';
                                if (!Number.isFinite(timeMs) || !Number.isFinite(impact)) {
                                  return null;
                                }

                                const hoursAhead = (timeMs - nowMs) / 3600000;
                                const horizonFactor =
                                  hoursAhead < 0
                                    ? 0.35
                                    : hoursAhead <= 6
                                      ? 1
                                      : hoursAhead <= 24
                                        ? 0.75
                                        : hoursAhead <= 48
                                          ? 0.55
                                          : 0.4;
                                const impactFactor = Math.max(0, Math.min(1, impact / 100));
                                const impactProbability = Math.round(
                                  100 * impactFactor * horizonFactor
                                );

                                const level =
                                  impact >= 25 ? 'HIGH' : impact >= 15 ? 'MEDIUM' : 'LOW';

                                const externalId = evt?.id != null ? String(evt.id) : '';
                                const fallbackId = `${timeMs}:${currency || 'NA'}:${String(title).slice(0, 64)}:${impact}:${source}`;
                                const id = externalId ? `${externalId}|${fallbackId}` : fallbackId;

                                return {
                                  id,
                                  timeMs,
                                  currency,
                                  title,
                                  impact,
                                  level,
                                  impactProbability,
                                  actual: evt?.actual ?? null,
                                  forecast: evt?.forecast ?? null,
                                  previous: evt?.previous ?? null
                                };
                              })
                              .filter(Boolean)
                              .filter((evt) => {
                                if (!evt.currency) {
                                  return false;
                                }
                                return (
                                  (baseUpper && evt.currency === baseUpper) ||
                                  (quoteUpper && evt.currency === quoteUpper)
                                );
                              })
                              .filter((evt) => evt.timeMs >= nowMs - 60 * 60 * 1000)
                              .filter((evt) => evt.timeMs <= nowMs + 48 * 60 * 60 * 1000)
                              .sort((a, b) => a.timeMs - b.timeMs);

                            const highOnly = normalized.filter((evt) => evt.level === 'HIGH');

                            if (!normalized.length) {
                              return (
                                <div className="market-analyzer__muted">
                                  No upcoming events found.
                                </div>
                              );
                            }

                            const display = highOnly.length ? highOnly : normalized.slice(0, 8);

                            return display.map((evt) => (
                              <div key={evt.id} className="market-analyzer__event">
                                <span className="market-analyzer__event-title">
                                  {evt.currency ? `${evt.currency} · ` : ''}
                                  {evt.title}
                                </span>
                                <span className="market-analyzer__event-meta">
                                  {evt.level} · Impact {formatNumber(evt.impact, 0)} · P{' '}
                                  {formatNumber(evt.impactProbability, 0)}% ·{' '}
                                  {formatDateTime(evt.timeMs)}
                                </span>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    )}

                    {!EA_ONLY_UI_MODE && pairAnalysisOpen && (
                      <div className="market-analyzer__card">
                        <div className="market-analyzer__card-title">
                          Signal Generation · Quality Gates
                        </div>
                        <div className="market-analyzer__card-body">
                          {(() => {
                            const scenario = scenarioSnapshot?.scenario || null;
                            const decision = scenario?.decision || null;
                            const isTradeValid = Boolean(decision?.isTradeValid);
                            const reason = decision?.reason || null;
                            const checks =
                              decision?.checks && typeof decision.checks === 'object'
                                ? decision.checks
                                : null;

                            const checkEntries = checks ? Object.entries(checks).slice(0, 18) : [];

                            return (
                              <>
                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Gate result</span>
                                  <span className="market-analyzer__val">
                                    {isTradeValid ? 'PASS (trade allowed)' : 'FAIL (no-trade)'}
                                  </span>
                                </div>
                                {reason && (
                                  <div className="market-analyzer__row">
                                    <span className="market-analyzer__key">Reason</span>
                                    <span className="market-analyzer__val">{String(reason)}</span>
                                  </div>
                                )}
                                {checkEntries.length > 0 && (
                                  <div className="market-analyzer__row">
                                    <span className="market-analyzer__key">Checks</span>
                                    <span className="market-analyzer__val">
                                      {checkEntries
                                        .map(([key, ok]) => `${ok ? 'OK' : 'NO'}:${key}`)
                                        .join(' · ')}
                                    </span>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {!EA_ONLY_UI_MODE && (
                      <div className="market-analyzer__card">
                        <div className="market-analyzer__card-title">Scenario (Numeric)</div>
                        <div className="market-analyzer__card-body">
                          {(() => {
                            const scenario = scenarioSnapshot?.scenario || null;
                            const primary = scenario?.primary || null;
                            const factors = scenario?.factors || null;
                            const fundamentals = scenario?.fundamentals || null;
                            const market = scenario?.market || null;
                            const probabilities = scenario?.probabilities || null;
                            const direction = String(primary?.direction || 'NEUTRAL').toUpperCase();
                            const arrow =
                              direction === 'BUY' ? '▲' : direction === 'SELL' ? '▼' : '•';

                            if (scenarioSnapshot.loading && !scenario) {
                              return (
                                <div className="market-analyzer__muted">Loading scenario…</div>
                              );
                            }

                            if (!scenario || !primary) {
                              return (
                                <div className="market-analyzer__muted">
                                  No scenario available yet.
                                </div>
                              );
                            }

                            const conf = toNumber(primary?.confidence);
                            const strength = toNumber(primary?.strength);
                            const finalScore = toNumber(primary?.finalScore);

                            const entry = primary?.entry || {};
                            const entryPrice = toNumber(entry?.price);
                            const sl = toNumber(entry?.stopLoss);
                            const tp = toNumber(entry?.takeProfit);
                            const rr = toNumber(entry?.riskReward);

                            const econ = factors?.economic || {};
                            const news = factors?.news || {};
                            const candles = factors?.candles || {};
                            const tech = factors?.technical || {};
                            const macro = fundamentals?.relative || null;
                            const baseEco = fundamentals?.base?.analysis || null;
                            const quoteEco = fundamentals?.quote?.analysis || null;
                            const baseRate = toNumber(baseEco?.indicators?.interestRate?.value);
                            const quoteRate = toNumber(quoteEco?.indicators?.interestRate?.value);
                            const baseInflation = toNumber(baseEco?.indicators?.inflation?.value);
                            const quoteInflation = toNumber(quoteEco?.indicators?.inflation?.value);

                            const spreadPoints = toNumber(market?.quote?.spreadPoints);
                            const quoteAgeMs = toNumber(market?.quote?.ageMs);
                            const newsImpactScore = toNumber(market?.news?.impactScore);
                            const newsMatchedItems = toNumber(market?.news?.matchedItems);
                            const quoteAgeLabel =
                              quoteAgeMs == null
                                ? null
                                : quoteAgeMs < 1000
                                  ? `${formatNumber(quoteAgeMs, 0)}ms`
                                  : quoteAgeMs < 60_000
                                    ? `${formatNumber(quoteAgeMs / 1000, 0)}s`
                                    : `${formatNumber(quoteAgeMs / 60_000, 0)}m`;

                            return (
                              <>
                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Primary</span>
                                  <span className="market-analyzer__val">
                                    {arrow} {direction}
                                    {conf != null ? ` · ${formatNumber(conf, 0)}%` : ''}
                                  </span>
                                </div>

                                {probabilities && (
                                  <div className="market-analyzer__row">
                                    <span className="market-analyzer__key">Probabilities</span>
                                    <span className="market-analyzer__val">
                                      Buy{' '}
                                      {toNumber(probabilities?.buyPct) != null
                                        ? `${formatNumber(toNumber(probabilities.buyPct), 0)}%`
                                        : '—'}
                                      {' · '}Sell{' '}
                                      {toNumber(probabilities?.sellPct) != null
                                        ? `${formatNumber(toNumber(probabilities.sellPct), 0)}%`
                                        : '—'}
                                      {' · '}No-trade{' '}
                                      {toNumber(probabilities?.noTradePct) != null
                                        ? `${formatNumber(toNumber(probabilities.noTradePct), 0)}%`
                                        : '—'}
                                    </span>
                                  </div>
                                )}

                                {(market?.quote || market?.news) && (
                                  <div className="market-analyzer__row">
                                    <span className="market-analyzer__key">Market context</span>
                                    <span className="market-analyzer__val">
                                      Spread{' '}
                                      {spreadPoints != null
                                        ? `${formatNumber(spreadPoints, 0)} pts`
                                        : '—'}
                                      {' · '}Quote age {quoteAgeLabel || '—'}
                                      {' · '}News impact{' '}
                                      {newsImpactScore != null
                                        ? `${formatNumber(newsImpactScore, 1)}${newsMatchedItems != null ? ` (${formatNumber(newsMatchedItems, 0)} items)` : ''}`
                                        : '—'}
                                    </span>
                                  </div>
                                )}

                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Score</span>
                                  <span className="market-analyzer__val">
                                    {finalScore != null ? formatNumber(finalScore, 1) : '—'}
                                    {strength != null
                                      ? ` · Strength ${formatNumber(strength, 0)}`
                                      : ''}
                                  </span>
                                </div>

                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Plan</span>
                                  <span className="market-analyzer__val">
                                    Entry {entryPrice != null ? formatNumber(entryPrice, 5) : '—'} ·
                                    SL {sl != null ? formatNumber(sl, 5) : '—'} · TP{' '}
                                    {tp != null ? formatNumber(tp, 5) : '—'}
                                    {rr != null ? ` · R:R ${formatNumber(rr, 2)}` : ''}
                                  </span>
                                </div>

                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Economic</span>
                                  <span className="market-analyzer__val">
                                    {econ?.direction || '—'}
                                    {toNumber(econ?.relativeSentiment) != null
                                      ? ` · ${formatNumber(toNumber(econ.relativeSentiment), 1)}`
                                      : ''}
                                    {toNumber(econ?.confidence) != null
                                      ? ` · ${formatNumber(toNumber(econ.confidence), 0)}%`
                                      : ''}
                                  </span>
                                </div>

                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Fundamentals</span>
                                  <span className="market-analyzer__val">
                                    {macro?.direction || '—'}
                                    {toNumber(macro?.differential) != null
                                      ? ` · Δ ${formatNumber(toNumber(macro.differential), 1)}`
                                      : ''}
                                    {toNumber(macro?.confidence) != null
                                      ? ` · ${formatNumber(toNumber(macro.confidence), 0)}%`
                                      : ''}
                                    {baseRate != null && quoteRate != null
                                      ? ` · Rates ${formatNumber(baseRate, 2)}% / ${formatNumber(quoteRate, 2)}%`
                                      : ''}
                                    {baseInflation != null && quoteInflation != null
                                      ? ` · CPI ${formatNumber(baseInflation, 2)}% / ${formatNumber(quoteInflation, 2)}%`
                                      : ''}
                                  </span>
                                </div>

                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">News</span>
                                  <span className="market-analyzer__val">
                                    {news?.direction || '—'}
                                    {toNumber(news?.sentiment) != null
                                      ? ` · Sent ${formatNumber(toNumber(news.sentiment), 1)}`
                                      : ''}
                                    {toNumber(news?.impact) != null
                                      ? ` · Impact ${formatNumber(toNumber(news.impact), 0)}`
                                      : ''}
                                    {toNumber(news?.upcomingEvents) != null
                                      ? ` · Events ${formatNumber(toNumber(news.upcomingEvents), 0)}`
                                      : ''}
                                  </span>
                                </div>

                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Candles</span>
                                  <span className="market-analyzer__val">
                                    {candles?.direction || '—'}
                                    {toNumber(candles?.strength) != null
                                      ? ` · Strength ${formatNumber(toNumber(candles.strength), 0)}`
                                      : ''}
                                    {toNumber(candles?.confidence) != null
                                      ? ` · ${formatNumber(toNumber(candles.confidence), 0)}%`
                                      : ''}
                                    {toNumber(candles?.scoreDelta) != null
                                      ? ` · Δ ${formatNumber(toNumber(candles.scoreDelta), 2)}`
                                      : ''}
                                  </span>
                                </div>

                                <div className="market-analyzer__row">
                                  <span className="market-analyzer__key">Technical</span>
                                  <span className="market-analyzer__val">
                                    {tech?.direction || '—'}
                                    {toNumber(tech?.score) != null
                                      ? ` · Score ${formatNumber(toNumber(tech.score), 1)}`
                                      : ''}
                                    {toNumber(tech?.strength) != null
                                      ? ` · Strength ${formatNumber(toNumber(tech.strength), 0)}`
                                      : ''}
                                  </span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    <div className="market-analyzer__card">
                      <div className="market-analyzer__card-title">Correlation Analysis (Live)</div>
                      <div className="market-analyzer__card-body">
                        {(() => {
                          const l18 = (() => {
                            const layered = analyzerSnapshot?.signal?.components?.layeredAnalysis;
                            const layers = Array.isArray(layered?.layers) ? layered.layers : [];
                            return (
                              layers.find(
                                (layer) =>
                                  String(layer?.key || '') === 'L18' || Number(layer?.layer) === 18
                              ) || null
                            );
                          })();

                          const missingReason =
                            l18?.metrics?.decision?.missingInputs?.details?.correlation?.reason ||
                            null;

                          const correlation = EA_ONLY_UI_MODE
                            ? analyzerSnapshot?.signal?.components?.intermarket?.correlation || null
                            : scenarioSnapshot?.scenario?.intermarket?.correlation || null;

                          if (scenarioSnapshot.loading && !correlation) {
                            return (
                              <div className="market-analyzer__muted">Loading correlation…</div>
                            );
                          }

                          if (!correlation) {
                            return (
                              <div className="market-analyzer__muted">
                                {EA_ONLY_UI_MODE
                                  ? missingReason ||
                                    'Correlation snapshot is not available in EA-only mode yet.'
                                  : 'No correlation snapshot available yet.'}
                              </div>
                            );
                          }

                          const warnings = Array.isArray(correlation.warnings)
                            ? correlation.warnings.filter(Boolean)
                            : [];

                          if (!correlation.available) {
                            return (
                              <div className="market-analyzer__muted">
                                {warnings[0] ||
                                  'Correlation is unavailable (EA bars required for peer symbols).'}
                              </div>
                            );
                          }

                          const peersRaw = Array.isArray(correlation.peers)
                            ? correlation.peers
                            : [];
                          const peers = peersRaw
                            .filter((p) => p && p.peer)
                            .slice()
                            .sort(
                              (a, b) =>
                                Math.abs(Number(b.corr) || 0) - Math.abs(Number(a.corr) || 0)
                            )
                            .slice(0, 10);

                          const formatSigned = (value, digits = 3) => {
                            const n = Number(value);
                            if (!Number.isFinite(n)) {
                              return '—';
                            }
                            const fixed = n.toFixed(digits);
                            return n > 0 ? `+${fixed}` : fixed;
                          };

                          const expectedLabel = (sign) => {
                            if (sign === 1) {
                              return 'Positive';
                            }
                            if (sign === -1) {
                              return 'Inverse';
                            }
                            return '—';
                          };

                          return (
                            <>
                              <div className="market-analyzer__muted">
                                Source: {String(correlation.source || 'EA')} · TF{' '}
                                {String(correlation.timeframe || '—')} · Window{' '}
                                {String(correlation.window || '—')}
                                {correlation?.stability?.stabilityScore != null
                                  ? ` · Stability ${String(correlation.stability.stabilityScore)}/100`
                                  : ''}
                                {correlation.updatedAt
                                  ? ` · Updated ${formatRelativeTime(correlation.updatedAt)}`
                                  : ''}
                              </div>

                              {warnings.length > 0 ? (
                                <div className="market-analyzer__muted">
                                  {warnings.slice(0, 2).map((w, idx) => (
                                    <div key={idx}>• {String(w)}</div>
                                  ))}
                                </div>
                              ) : null}

                              <table>
                                <thead>
                                  <tr>
                                    <th>Peer</th>
                                    <th>Core</th>
                                    <th>Role</th>
                                    <th>Corr</th>
                                    <th>Prev</th>
                                    <th>Δ</th>
                                    <th>Status</th>
                                    <th>Expected</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {peers.length === 0 ? (
                                    <tr>
                                      <td colSpan={8}>No usable correlations yet.</td>
                                    </tr>
                                  ) : (
                                    peers.map((row) => (
                                      <tr key={row.peer}>
                                        <td>{row.peer}</td>
                                        <td>{row.core === false ? 'No' : 'Yes'}</td>
                                        <td>{row.role != null ? String(row.role) : '—'}</td>
                                        <td>{formatSigned(row.corr)}</td>
                                        <td>
                                          {row.corrPrev != null ? formatSigned(row.corrPrev) : '—'}
                                        </td>
                                        <td>{row.delta != null ? formatSigned(row.delta) : '—'}</td>
                                        <td>
                                          {row.break === true
                                            ? 'BREAK'
                                            : row.break === false
                                              ? 'Normal'
                                              : '—'}
                                        </td>
                                        <td>{expectedLabel(row.expectedSign)}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="market-analyzer__card">
                      <div className="market-analyzer__card-title">Analysis Layers</div>
                      <div className="market-analyzer__card-body">
                        {(() => {
                          const sourceSignal = EA_ONLY_UI_MODE
                            ? analyzerSnapshot?.signal || null
                            : scenarioSnapshot?.signal || analyzerSnapshot?.signal || null;

                          const scenario = scenarioSnapshot?.scenario || null;
                          const layeredAnalysis =
                            sourceSignal?.components?.layeredAnalysis ||
                            sourceSignal?.layeredAnalysis ||
                            null;

                          const layers = EA_ONLY_UI_MODE
                            ? Array.isArray(layeredAnalysis?.layers)
                              ? layeredAnalysis.layers
                              : null
                            : Array.isArray(scenario?.layers)
                              ? scenario.layers
                              : null;

                          if (EA_ONLY_UI_MODE) {
                            if (analyzerSnapshot.loading && !sourceSignal) {
                              return <div className="market-analyzer__muted">Loading layers…</div>;
                            }
                            if (!sourceSignal) {
                              return (
                                <div className="market-analyzer__muted">
                                  Waiting for EA analysis signal…
                                </div>
                              );
                            }
                            if (!layers) {
                              return (
                                <div className="market-analyzer__muted">
                                  Waiting for 18-layer explainability payload…
                                </div>
                              );
                            }
                          } else {
                            if (scenarioSnapshot.loading && !scenario) {
                              return <div className="market-analyzer__muted">Loading layers…</div>;
                            }

                            if (!scenario) {
                              return (
                                <div className="market-analyzer__muted">
                                  No scenario available yet.
                                </div>
                              );
                            }
                          }

                          if (!layers || layers.length === 0) {
                            return (
                              <div className="market-analyzer__muted">
                                No layered analysis available.
                              </div>
                            );
                          }

                          const formatLayerValue = (value) => {
                            if (value == null) {
                              return '—';
                            }
                            if (typeof value === 'number') {
                              return Number.isFinite(value) ? String(value) : '—';
                            }
                            if (typeof value === 'string') {
                              return value;
                            }
                            if (typeof value === 'boolean') {
                              return value ? 'true' : 'false';
                            }
                            if (Array.isArray(value)) {
                              const preview = value
                                .slice(0, 4)
                                .map((v) => (typeof v === 'string' ? v : null))
                                .filter(Boolean)
                                .join(', ');
                              return preview ? `${preview}${value.length > 4 ? '…' : ''}` : '…';
                            }
                            if (typeof value === 'object') {
                              return '…';
                            }
                            return String(value);
                          };

                          const isPlainObject = (value) =>
                            Boolean(value) &&
                            typeof value === 'object' &&
                            !Array.isArray(value) &&
                            Object.prototype.toString.call(value) === '[object Object]';

                          const renderNestedMetrics = (value, depth = 1) => {
                            if (!value) {
                              return null;
                            }

                            if (Array.isArray(value)) {
                              const items = value.slice(0, 8);
                              return (
                                <div className="market-analyzer__layer-grid">
                                  {items.map((item, idx) => (
                                    <div className="market-analyzer__layer-kv" key={idx}>
                                      <span className="market-analyzer__layer-k">{idx}</span>
                                      <span className="market-analyzer__layer-v">
                                        {formatLayerValue(item)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              );
                            }

                            if (!isPlainObject(value)) {
                              return null;
                            }

                            if (depth > 2) {
                              return null;
                            }

                            const entries = Object.entries(value)
                              .filter(
                                ([key]) =>
                                  key && !String(key).toLowerCase().includes('fundamentals')
                              )
                              .slice(0, 12);

                            if (!entries.length) {
                              return null;
                            }

                            return (
                              <div className="market-analyzer__layer-grid">
                                {entries.map(([key, val]) => {
                                  const expandable = isPlainObject(val) || Array.isArray(val);
                                  return (
                                    <div className="market-analyzer__layer-kv" key={key}>
                                      <span className="market-analyzer__layer-k">{key}</span>
                                      <span className="market-analyzer__layer-v">
                                        {expandable ? (
                                          <details>
                                            <summary>{formatLayerValue(val)}</summary>
                                            {renderNestedMetrics(val, depth + 1)}
                                          </details>
                                        ) : (
                                          formatLayerValue(val)
                                        )}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          };

                          const renderMetrics = (metrics) => {
                            if (!metrics || typeof metrics !== 'object') {
                              return null;
                            }
                            const entries = Object.entries(metrics)
                              .filter(
                                ([key]) =>
                                  key && !String(key).toLowerCase().includes('fundamentals')
                              )
                              .slice(0, 12);
                            if (!entries.length) {
                              return null;
                            }
                            return (
                              <div className="market-analyzer__layer-grid">
                                {entries.map(([key, value]) => {
                                  const expandable = isPlainObject(value) || Array.isArray(value);
                                  return (
                                    <div className="market-analyzer__layer-kv" key={key}>
                                      <span className="market-analyzer__layer-k">{key}</span>
                                      <span className="market-analyzer__layer-v">
                                        {expandable ? (
                                          <details>
                                            <summary>{formatLayerValue(value)}</summary>
                                            {renderNestedMetrics(value, 1)}
                                          </details>
                                        ) : (
                                          formatLayerValue(value)
                                        )}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          };

                          return (
                            <div className="market-analyzer__layers">
                              {layers.map((layer) => {
                                const nameEn = layer?.nameEn || '—';
                                const arrow = layer?.arrow || '•';
                                const direction = String(
                                  layer?.direction || 'NEUTRAL'
                                ).toUpperCase();
                                const confidence = toNumber(layer?.confidence);
                                const score = toNumber(layer?.score);
                                const summaryEn = layer?.summaryEn || null;
                                const warnings = Array.isArray(layer?.warnings)
                                  ? layer.warnings.filter(Boolean)
                                  : [];

                                const isL18 =
                                  String(layer?.key || '') === 'L18' || Number(layer?.layer) === 18;
                                const killSwitch = isL18
                                  ? layer?.metrics?.decision?.killSwitch ||
                                    layer?.metrics?.isValid?.decision?.killSwitch ||
                                    null
                                  : null;
                                const killSwitchEnabled = killSwitch?.enabled === true;
                                const killSwitchBlocked = killSwitch?.blocked === true;
                                const killSwitchCount = killSwitchEnabled
                                  ? Array.isArray(killSwitch?.items)
                                    ? killSwitch.items.length
                                    : Array.isArray(killSwitch?.ids)
                                      ? killSwitch.ids.length
                                      : null
                                  : null;

                                const killSwitchBadge =
                                  isL18 && killSwitchEnabled
                                    ? ` · KILL-SWITCH ${
                                        killSwitchBlocked ? 'BLOCKED' : 'OK'
                                      }${killSwitchCount != null ? ` (${killSwitchCount})` : ''}`
                                    : '';

                                return (
                                  <details
                                    className="market-analyzer__layer"
                                    key={layer?.key || String(layer?.layer || nameEn)}
                                  >
                                    <summary className="market-analyzer__layer-summary">
                                      <span className="market-analyzer__layer-title">
                                        L{layer?.layer || '—'} · {nameEn}
                                      </span>
                                      <span className="market-analyzer__layer-meta">
                                        {arrow} {direction}
                                        {confidence != null
                                          ? ` · ${formatNumber(confidence, 0)}%`
                                          : ''}
                                        {score != null ? ` · ${formatNumber(score, 2)}` : ''}
                                        {killSwitchBadge}
                                      </span>
                                    </summary>

                                    <div className="market-analyzer__layer-body">
                                      {summaryEn && (
                                        <div className="market-analyzer__layer-text">
                                          <div className="market-analyzer__muted">{summaryEn}</div>
                                        </div>
                                      )}

                                      {renderMetrics(layer?.metrics)}

                                      {warnings.length > 0 && (
                                        <div className="market-analyzer__layer-warnings">
                                          {warnings.slice(0, 4).map((w, idx) => (
                                            <div className="market-analyzer__muted" key={idx}>
                                              • {String(w)}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </details>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="market-analyzer__card">
                      <div className="market-analyzer__card-title">Signal</div>
                      <div className="market-analyzer__card-body">
                        {(() => {
                          const normalized = analyzerNormalizedSignal;
                          const direction = String(
                            normalized?.direction || 'NEUTRAL'
                          ).toUpperCase();
                          const strength = toNumber(normalized?.strength);
                          const confidence = toNumber(normalized?.confidence);
                          const score = toNumber(normalized?.score);
                          const timeframe = normalized?.timeframe || '—';
                          const timestamp = toTimestamp(normalized?.timestamp);

                          const arrow =
                            direction === 'BUY' ? '▲' : direction === 'SELL' ? '▼' : '•';

                          return (
                            <>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Direction</span>
                                <span className="market-analyzer__val">
                                  {arrow} {direction}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Strength</span>
                                <span className="market-analyzer__val">
                                  {strength != null ? formatNumber(strength, 1) : '—'}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Confidence</span>
                                <span className="market-analyzer__val">
                                  {confidence != null ? formatNumber(confidence, 1) : '—'}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Score</span>
                                <span className="market-analyzer__val">
                                  {score != null ? formatNumber(score, 1) : '—'}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Timeframe</span>
                                <span className="market-analyzer__val">{timeframe}</span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Generated</span>
                                <span className="market-analyzer__val">
                                  {timestamp != null ? formatDateTime(timestamp) : '—'}
                                </span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="market-analyzer__card">
                      <div className="market-analyzer__card-title">Market</div>
                      <div className="market-analyzer__card-body">
                        {(() => {
                          const quote = analyzerQuote;
                          const bid = Number.isFinite(Number(quote?.bid))
                            ? Number(quote.bid)
                            : null;
                          const ask = Number.isFinite(Number(quote?.ask))
                            ? Number(quote.ask)
                            : null;
                          const last = Number.isFinite(Number(quote?.last))
                            ? Number(quote.last)
                            : null;
                          const mid =
                            bid != null && ask != null
                              ? (bid + ask) / 2
                              : bid != null
                                ? bid
                                : ask != null
                                  ? ask
                                  : last;

                          const digits = Number.isFinite(Number(quote?.digits))
                            ? Math.max(0, Math.min(8, Math.trunc(Number(quote.digits))))
                            : null;
                          const displayDigits = digits != null ? digits : 5;

                          const spreadPoints = Number.isFinite(Number(quote?.spreadPoints))
                            ? Number(quote.spreadPoints)
                            : bid != null &&
                                ask != null &&
                                Number.isFinite(Number(quote?.point)) &&
                                Number(quote.point) > 0
                              ? (ask - bid) / Number(quote.point)
                              : null;

                          const receivedAt = Number.isFinite(Number(quote?.receivedAt))
                            ? Number(quote.receivedAt)
                            : Number.isFinite(Number(quote?.timestamp))
                              ? Number(quote.timestamp)
                              : null;
                          const ageSec =
                            receivedAt != null
                              ? Math.max(0, Math.round((Date.now() - receivedAt) / 1000))
                              : null;

                          const snapshotM15 =
                            analyzerTechnicalTimeframes?.M15 ||
                            analyzerTechnicalTimeframes?.m15 ||
                            null;
                          const snapshotD1 =
                            analyzerTechnicalTimeframes?.D1 ||
                            analyzerTechnicalTimeframes?.d1 ||
                            null;
                          const snapLastPrice = Number.isFinite(Number(snapshotM15?.lastPrice))
                            ? Number(snapshotM15.lastPrice)
                            : Number.isFinite(Number(snapshotD1?.lastPrice))
                              ? Number(snapshotD1.lastPrice)
                              : null;
                          const snapCandle =
                            (snapshotM15?.latestCandle &&
                            typeof snapshotM15.latestCandle === 'object'
                              ? snapshotM15.latestCandle
                              : null) ||
                            (snapshotD1?.latestCandle && typeof snapshotD1.latestCandle === 'object'
                              ? snapshotD1.latestCandle
                              : null);
                          const candleClose = Number.isFinite(Number(snapCandle?.close))
                            ? Number(snapCandle.close)
                            : null;
                          const candleTime = Number.isFinite(Number(snapCandle?.time))
                            ? Number(snapCandle.time)
                            : null;

                          const barContext =
                            analyzerSnapshot?.barsContext &&
                            typeof analyzerSnapshot.barsContext === 'object'
                              ? analyzerSnapshot.barsContext
                              : null;
                          const bar =
                            barContext?.bar && typeof barContext.bar === 'object'
                              ? barContext.bar
                              : null;
                          const barTime = Number.isFinite(Number(bar?.time))
                            ? Number(bar.time)
                            : null;
                          const barO = Number.isFinite(Number(bar?.open)) ? Number(bar.open) : null;
                          const barH = Number.isFinite(Number(bar?.high)) ? Number(bar.high) : null;
                          const barL = Number.isFinite(Number(bar?.low)) ? Number(bar.low) : null;
                          const barC = Number.isFinite(Number(bar?.close))
                            ? Number(bar.close)
                            : null;
                          const barTf =
                            typeof barContext?.timeframe === 'string' && barContext.timeframe.trim()
                              ? barContext.timeframe.trim().toUpperCase()
                              : 'M1';

                          const barsContextByTimeframe =
                            analyzerSnapshot?.barsContextByTimeframe &&
                            typeof analyzerSnapshot.barsContextByTimeframe === 'object'
                              ? analyzerSnapshot.barsContextByTimeframe
                              : null;

                          const getBarForTf = (tf) => {
                            const ctx =
                              barsContextByTimeframe?.[tf] ||
                              barsContextByTimeframe?.[String(tf || '').toLowerCase()] ||
                              null;
                            const b = ctx?.bar && typeof ctx.bar === 'object' ? ctx.bar : null;
                            return b;
                          };

                          return (
                            <>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Bid</span>
                                <span className="market-analyzer__val">
                                  {bid != null ? formatNumber(bid, displayDigits) : '—'}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Ask</span>
                                <span className="market-analyzer__val">
                                  {ask != null ? formatNumber(ask, displayDigits) : '—'}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Mid</span>
                                <span className="market-analyzer__val">
                                  {mid != null ? formatNumber(mid, displayDigits) : '—'}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Spread</span>
                                <span className="market-analyzer__val">
                                  {spreadPoints != null ? `${formatNumber(spreadPoints, 0)}p` : '—'}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Age</span>
                                <span className="market-analyzer__val">
                                  {ageSec != null ? `${ageSec}s` : '—'}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">MT Last</span>
                                <span className="market-analyzer__val">
                                  {snapLastPrice != null
                                    ? formatNumber(snapLastPrice, displayDigits)
                                    : '—'}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">MT Candle</span>
                                <span className="market-analyzer__val">
                                  C{' '}
                                  {candleClose != null
                                    ? formatNumber(candleClose, displayDigits)
                                    : '—'}
                                  {(() => {
                                    const ts = toTimestamp(candleTime);
                                    return ts != null ? ` · ${formatDateTime(ts)}` : '';
                                  })()}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">EA Bar {barTf}</span>
                                <span className="market-analyzer__val">
                                  {barC != null
                                    ? `O ${formatNumber(barO ?? barC, displayDigits)} · H ${formatNumber(
                                        barH ?? barC,
                                        displayDigits
                                      )} · L ${formatNumber(barL ?? barC, displayDigits)} · C ${formatNumber(
                                        barC,
                                        displayDigits
                                      )}`
                                    : '—'}
                                  {(() => {
                                    const ts = toTimestamp(barTime);
                                    return ts != null ? ` · ${formatDateTime(ts)}` : '';
                                  })()}
                                </span>
                              </div>

                              {['M15', 'H1', 'H4', 'D1'].map((tf) => {
                                const b = getBarForTf(tf);
                                const t = Number.isFinite(Number(b?.time)) ? Number(b.time) : null;
                                const o = Number.isFinite(Number(b?.open)) ? Number(b.open) : null;
                                const h = Number.isFinite(Number(b?.high)) ? Number(b.high) : null;
                                const l = Number.isFinite(Number(b?.low)) ? Number(b.low) : null;
                                const c = Number.isFinite(Number(b?.close))
                                  ? Number(b.close)
                                  : null;

                                return (
                                  <div key={tf} className="market-analyzer__row">
                                    <span className="market-analyzer__key">EA Closed {tf}</span>
                                    <span className="market-analyzer__val">
                                      {c != null
                                        ? `O ${formatNumber(o ?? c, displayDigits)} · H ${formatNumber(
                                            h ?? c,
                                            displayDigits
                                          )} · L ${formatNumber(l ?? c, displayDigits)} · C ${formatNumber(
                                            c,
                                            displayDigits
                                          )}`
                                        : '—'}
                                      {(() => {
                                        const ts = toTimestamp(t);
                                        return ts != null ? ` · ${formatDateTime(ts)}` : '';
                                      })()}
                                    </span>
                                  </div>
                                );
                              })}
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="market-analyzer__card">
                      <div className="market-analyzer__card-title">Candles (EA History)</div>
                      <div className="market-analyzer__card-body">
                        <CandleHistoryChart
                          brokerId={effectivePlatformId}
                          symbol={analyzerSymbolNormalized || analyzerSymbol}
                          refreshKey={analyzerSnapshot?.updatedAt}
                          liveQuote={analyzerLiveQuote}
                          height={260}
                        />
                      </div>
                    </div>

                    <div className="market-analyzer__card">
                      <div className="market-analyzer__card-title">Trend · M15 / H1 / H4 / D1</div>
                      <div className="market-analyzer__card-body">
                        {['M15', 'H1', 'H4', 'D1'].map((tf) => {
                          const frame =
                            analyzerTechnicalTimeframes?.[tf] ||
                            analyzerTechnicalTimeframes?.[tf.toLowerCase()] ||
                            null;
                          const score = Number.isFinite(Number(frame?.score))
                            ? Number(frame.score)
                            : null;
                          const direction =
                            String(frame?.direction || '').toUpperCase() || 'NEUTRAL';
                          const dir =
                            direction === 'BUY' ? 'up' : direction === 'SELL' ? 'down' : 'flat';

                          const rsiValue =
                            frame?.indicators?.rsi && typeof frame.indicators.rsi === 'object'
                              ? frame.indicators.rsi.value
                              : Number.isFinite(Number(frame?.indicators?.rsi))
                                ? Number(frame.indicators.rsi)
                                : null;

                          const macdHistogram =
                            frame?.indicators?.macd && typeof frame.indicators.macd === 'object'
                              ? frame.indicators.macd.histogram
                              : null;

                          const atrValue =
                            frame?.indicators?.atr && typeof frame.indicators.atr === 'object'
                              ? frame.indicators.atr.value
                              : Number.isFinite(Number(frame?.indicators?.atr))
                                ? Number(frame.indicators.atr)
                                : null;

                          return (
                            <div key={tf} className="market-analyzer__tf">
                              <div className="market-analyzer__tf-left">
                                <span className="market-analyzer__tf-name">{tf}</span>
                                <span
                                  className={`market-analyzer__tag market-analyzer__tag--${dir}`}
                                >
                                  {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'} {direction}
                                  {score != null ? ` · ${formatNumber(score, 0)}` : ''}
                                </span>
                              </div>
                              <div className="market-analyzer__tf-right">
                                <span className="market-analyzer__mini">
                                  RSI{' '}
                                  {rsiValue != null && Number.isFinite(Number(rsiValue))
                                    ? formatNumber(rsiValue, 1)
                                    : '—'}
                                </span>
                                <span className="market-analyzer__mini">
                                  MACD{' '}
                                  {macdHistogram != null && Number.isFinite(Number(macdHistogram))
                                    ? formatNumber(macdHistogram, 4)
                                    : '—'}
                                </span>
                                <span className="market-analyzer__mini">
                                  ATR{' '}
                                  {atrValue != null && Number.isFinite(Number(atrValue))
                                    ? formatNumber(atrValue, 5)
                                    : '—'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="market-analyzer__card">
                      <div className="market-analyzer__card-title">High / Low · Pivot</div>
                      <div className="market-analyzer__card-body">
                        {(() => {
                          const quote = analyzerQuote;
                          const digits = Number.isFinite(Number(quote?.digits))
                            ? Math.max(0, Math.min(8, Math.trunc(Number(quote.digits))))
                            : null;
                          const displayDigits = digits != null ? digits : 5;

                          const ranges = analyzerD1?.ranges || null;
                          const pivot = analyzerD1?.pivotPoints || null;
                          const today = ranges?.day || null;
                          const week = ranges?.week || null;
                          const month = ranges?.month || null;

                          return (
                            <>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Today</span>
                                <span className="market-analyzer__val">
                                  H{' '}
                                  {today?.high != null
                                    ? formatNumber(today.high, displayDigits)
                                    : '—'}{' '}
                                  · L{' '}
                                  {today?.low != null
                                    ? formatNumber(today.low, displayDigits)
                                    : '—'}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Week</span>
                                <span className="market-analyzer__val">
                                  H{' '}
                                  {week?.high != null
                                    ? formatNumber(week.high, displayDigits)
                                    : '—'}{' '}
                                  · L{' '}
                                  {week?.low != null ? formatNumber(week.low, displayDigits) : '—'}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Month</span>
                                <span className="market-analyzer__val">
                                  H{' '}
                                  {month?.high != null
                                    ? formatNumber(month.high, displayDigits)
                                    : '—'}{' '}
                                  · L{' '}
                                  {month?.low != null
                                    ? formatNumber(month.low, displayDigits)
                                    : '—'}
                                </span>
                              </div>
                              <div className="market-analyzer__row">
                                <span className="market-analyzer__key">Pivot</span>
                                <span className="market-analyzer__val">
                                  P{' '}
                                  {pivot?.pivot != null
                                    ? formatNumber(pivot.pivot, displayDigits)
                                    : '—'}{' '}
                                  · R1{' '}
                                  {pivot?.r1 != null ? formatNumber(pivot.r1, displayDigits) : '—'}{' '}
                                  · S1{' '}
                                  {pivot?.s1 != null ? formatNumber(pivot.s1, displayDigits) : '—'}
                                </span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    {pairAnalysisOpen ? (
                      <div className="market-analyzer__card">
                        <div className="market-analyzer__card-title">News / Events</div>
                        <div className="market-analyzer__card-body">
                          {(() => {
                            const scenario = scenarioSnapshot?.scenario || null;
                            const fundamentals = scenario?.fundamentals || null;
                            const base = fundamentals?.base?.currency || null;
                            const quote = fundamentals?.quote?.currency || null;
                            const fallbackSymbol = String(
                              analyzerSymbolNormalized || analyzerSymbol || ''
                            ).toUpperCase();
                            const fallbackCurrencies = extractFxCurrencies(fallbackSymbol);
                            const baseUpper = base
                              ? String(base).toUpperCase()
                              : fallbackCurrencies
                                ? fallbackCurrencies[0]
                                : null;
                            const quoteUpper = quote
                              ? String(quote).toUpperCase()
                              : fallbackCurrencies
                                ? fallbackCurrencies[1]
                                : null;

                            const sourceSignal = EA_ONLY_UI_MODE
                              ? analyzerSnapshot?.signal || null
                              : scenarioSnapshot?.signal || analyzerSnapshot?.signal || null;
                            const news = sourceSignal?.components?.news || null;
                            const evidence = news?.evidence || news?.details?.evidence || null;

                            const calendar =
                              news?.calendarEvents ||
                              news?.details?.calendarEvents ||
                              analyzerSnapshot?.signal?.components?.news?.calendarEvents ||
                              analyzerSnapshot?.signal?.components?.news?.details?.calendarEvents ||
                              [];
                            const calendarList = Array.isArray(calendar) ? calendar : [];

                            const nowMs = Date.now();
                            const horizonMs =
                              Math.max(1, Number(newsEventsHorizonHours) || 72) * 60 * 60 * 1000;

                            const normalizeTimeMs = (timeRaw) => {
                              if (typeof timeRaw === 'number' && Number.isFinite(timeRaw)) {
                                // Accept both epoch seconds and epoch milliseconds.
                                return timeRaw < 2_000_000_000 ? timeRaw * 1000 : timeRaw;
                              }
                              if (timeRaw instanceof Date) {
                                return timeRaw.getTime();
                              }
                              if (!timeRaw) {
                                return NaN;
                              }
                              const parsed = Date.parse(String(timeRaw));
                              return Number.isFinite(parsed) ? parsed : NaN;
                            };

                            const formatCountdown = (deltaMs) => {
                              const sign = deltaMs >= 0 ? 1 : -1;
                              const absMinutes = Math.round(Math.abs(deltaMs) / 60000);
                              const hours = Math.floor(absMinutes / 60);
                              const minutes = absMinutes % 60;
                              const text = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
                              return sign >= 0 ? `in ${text}` : `${text} ago`;
                            };

                            const normalizedEvents = calendarList
                              .map((evt) => {
                                const timeRaw = evt?.time || evt?.datetime || evt?.dateTime || null;
                                const timeMs = normalizeTimeMs(timeRaw);
                                if (!Number.isFinite(timeMs)) {
                                  return null;
                                }
                                const currency = String(evt?.currency || '')
                                  .trim()
                                  .toUpperCase();
                                const title = evt?.event || evt?.title || evt?.name || 'Event';
                                const impact = Number(evt?.impact);
                                const source = evt?.source ? String(evt.source).trim() : '';
                                const level =
                                  Number.isFinite(impact) && impact >= 25
                                    ? 'HIGH'
                                    : Number.isFinite(impact) && impact >= 15
                                      ? 'MEDIUM'
                                      : 'LOW';

                                const externalId = evt?.id != null ? String(evt.id) : '';
                                const fallbackId = `${timeMs}:${currency || 'NA'}:${String(title).slice(0, 64)}:${Number.isFinite(impact) ? impact : ''}:${source}`;
                                const id = externalId ? `${externalId}|${fallbackId}` : fallbackId;

                                return {
                                  id,
                                  timeMs,
                                  currency,
                                  title,
                                  impact: Number.isFinite(impact) ? impact : null,
                                  level,
                                  source: source || null,
                                  actual: evt?.actual ?? null,
                                  forecast: evt?.forecast ?? null,
                                  previous: evt?.previous ?? null
                                };
                              })
                              .filter(Boolean)
                              .filter((evt) => evt.timeMs >= nowMs - 60 * 60 * 1000)
                              .filter((evt) => evt.timeMs <= nowMs + horizonMs);

                            const scopedEventsRaw = normalizedEvents
                              .filter((evt) => {
                                if (newsEventsScope !== 'PAIR') {
                                  return true;
                                }
                                if (!evt.currency) {
                                  return false;
                                }
                                return (
                                  (baseUpper && evt.currency === baseUpper) ||
                                  (quoteUpper && evt.currency === quoteUpper)
                                );
                              })
                              .sort((a, b) => a.timeMs - b.timeMs);

                            // Merge repeated items (same time/title/source) into one row with combined currencies.
                            const mergedMap = new Map();
                            for (const evt of scopedEventsRaw) {
                              const key = `${evt.timeMs}:${evt.title}:${evt.impact ?? ''}:${evt.source ?? ''}`;
                              const existing = mergedMap.get(key);
                              if (existing) {
                                if (evt.currency) {
                                  existing.currencies.add(evt.currency);
                                }
                                continue;
                              }
                              const currencies = new Set();
                              if (evt.currency) {
                                currencies.add(evt.currency);
                              }
                              mergedMap.set(key, { ...evt, currencies });
                            }
                            const scopedEvents = Array.from(mergedMap.values())
                              .map((evt) => {
                                const currencies = Array.from(evt.currencies || []).sort();
                                const currencyLabel = currencies.length
                                  ? currencies.length <= 2
                                    ? currencies.join('/')
                                    : currencies.join(', ')
                                  : '';
                                return { ...evt, currencies, currencyLabel };
                              })
                              .sort((a, b) => a.timeMs - b.timeMs)
                              .slice(0, 18);

                            const dayFormatter = new Intl.DateTimeFormat(undefined, {
                              weekday: 'short',
                              month: 'short',
                              day: '2-digit'
                            });
                            const timeFormatter = new Intl.DateTimeFormat(undefined, {
                              hour: '2-digit',
                              minute: '2-digit'
                            });

                            const eventsByDay = new Map();
                            for (const evt of scopedEvents) {
                              const dayKey = dayFormatter.format(new Date(evt.timeMs));
                              const bucket = eventsByDay.get(dayKey) || [];
                              bucket.push(evt);
                              eventsByDay.set(dayKey, bucket);
                            }

                            const flattenEvidence = (items) => (Array.isArray(items) ? items : []);
                            const headlinesRaw = [
                              ...flattenEvidence(evidence?.base),
                              ...flattenEvidence(evidence?.quote),
                              ...flattenEvidence(evidence?.external)
                            ];
                            const seenHeadlines = new Set();
                            const allHeadlines = headlinesRaw
                              .map((item) => {
                                const headline = item?.headline || item?.title || null;
                                if (!headline) {
                                  return null;
                                }
                                const url = item?.url || null;
                                const key = url || headline;
                                if (seenHeadlines.has(key)) {
                                  return null;
                                }
                                seenHeadlines.add(key);
                                const ts = normalizeTimeMs(item?.timestamp);
                                return {
                                  headline,
                                  url,
                                  source: item?.source || null,
                                  sentiment: item?.sentimentLabel || null,
                                  impact: Number.isFinite(Number(item?.impact))
                                    ? Number(item.impact)
                                    : null,
                                  timestampMs: Number.isFinite(ts) ? ts : null
                                };
                              })
                              .filter(Boolean)
                              .sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0))
                              .slice(0, 16);

                            const isSystemHeadline = (item) => {
                              const src = String(item?.source || '')
                                .trim()
                                .toLowerCase();
                              if (src === 'ea' || src === 'system' || src === 'bridge') {
                                return true;
                              }
                              const text = String(item?.headline || '').toLowerCase();
                              return text.includes('connected') || text.includes('disconnected');
                            };

                            const headlines = allHeadlines
                              .filter((item) =>
                                showSystemHeadlines ? true : !isSystemHeadline(item)
                              )
                              .slice(0, 10);

                            const emptyReason = (() => {
                              if (calendarList.length === 0) {
                                return 'No EA events received yet (EA-only mode).';
                              }
                              if (normalizedEvents.length === 0) {
                                return `No events within the next ${formatNumber(newsEventsHorizonHours, 0)}h window.`;
                              }
                              if (scopedEvents.length === 0) {
                                return baseUpper || quoteUpper
                                  ? `No events found for ${[baseUpper, quoteUpper].filter(Boolean).join('/')} in the next ${formatNumber(newsEventsHorizonHours, 0)}h.`
                                  : 'No relevant events found.';
                              }
                              return null;
                            })();

                            const nextEvent = scopedEvents.length ? scopedEvents[0] : null;
                            const lastScenarioUpdate = EA_ONLY_UI_MODE
                              ? analyzerSnapshot?.updatedAt || null
                              : scenarioSnapshot?.updatedAt || null;

                            return (
                              <div className="market-analyzer__news-events">
                                <div className="market-analyzer__news-events-toolbar">
                                  <div className="market-analyzer__news-events-summary">
                                    <span className="market-analyzer__badge market-analyzer__badge--subtle">
                                      {formatNumber(scopedEvents.length, 0)} events
                                    </span>
                                    {lastScenarioUpdate ? (
                                      <span className="market-analyzer__news-events-next">
                                        Updated {formatCountdown(lastScenarioUpdate - nowMs)}
                                      </span>
                                    ) : null}
                                    {nextEvent ? (
                                      <span className="market-analyzer__news-events-next">
                                        Next:{' '}
                                        {nextEvent.currencyLabel
                                          ? `${nextEvent.currencyLabel} · `
                                          : ''}
                                        {nextEvent.title} ·{' '}
                                        {formatCountdown(nextEvent.timeMs - nowMs)}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="market-analyzer__news-events-controls">
                                    <label className="market-analyzer__toggle">
                                      <input
                                        id="news-events-show-system"
                                        name="newsEventsShowSystem"
                                        type="checkbox"
                                        checked={showSystemHeadlines}
                                        onChange={(e) => setShowSystemHeadlines(e.target.checked)}
                                      />
                                      Show system
                                    </label>
                                    <label className="market-analyzer__select-label">
                                      Scope
                                      <select
                                        className="market-analyzer__select"
                                        value={newsEventsScope}
                                        onChange={(e) => setNewsEventsScope(e.target.value)}
                                      >
                                        <option value="PAIR">Pair currencies</option>
                                        <option value="ALL">All</option>
                                      </select>
                                    </label>
                                    <label className="market-analyzer__select-label">
                                      Window
                                      <select
                                        className="market-analyzer__select"
                                        value={newsEventsHorizonHours}
                                        onChange={(e) =>
                                          setNewsEventsHorizonHours(Number(e.target.value) || 72)
                                        }
                                      >
                                        <option value={24}>24h</option>
                                        <option value={72}>72h</option>
                                        <option value={168}>7d</option>
                                      </select>
                                    </label>
                                  </div>
                                </div>

                                <div className="market-analyzer__news-events-grid">
                                  <div className="market-analyzer__news-events-col">
                                    <div className="market-analyzer__section-title">
                                      Upcoming events
                                    </div>
                                    {scopedEvents.length === 0 ? (
                                      <div className="market-analyzer__muted">{emptyReason}</div>
                                    ) : (
                                      Array.from(eventsByDay.entries()).map(
                                        ([dayKey, dayEvents]) => (
                                          <div
                                            key={dayKey}
                                            className="market-analyzer__event-group"
                                          >
                                            <div className="market-analyzer__event-group-title">
                                              {dayKey}
                                            </div>
                                            {dayEvents.map((evt) => (
                                              <div
                                                key={evt.id}
                                                className="market-analyzer__event-row"
                                              >
                                                <div className="market-analyzer__event-row-main">
                                                  <span className="market-analyzer__badge market-analyzer__badge--mono">
                                                    {timeFormatter.format(new Date(evt.timeMs))}
                                                  </span>
                                                  {evt.currencyLabel ? (
                                                    <span className="market-analyzer__badge market-analyzer__badge--subtle">
                                                      {evt.currencyLabel}
                                                    </span>
                                                  ) : null}
                                                  <span className="market-analyzer__event-row-title">
                                                    {evt.title}
                                                  </span>
                                                </div>
                                                <div className="market-analyzer__event-row-meta">
                                                  <span
                                                    className={`market-analyzer__badge market-analyzer__badge--${String(
                                                      evt.level || 'LOW'
                                                    ).toLowerCase()}`}
                                                  >
                                                    {evt.level}
                                                  </span>
                                                  {evt.impact != null ? (
                                                    <span className="market-analyzer__badge market-analyzer__badge--subtle">
                                                      Impact {formatNumber(evt.impact, 0)}
                                                    </span>
                                                  ) : null}
                                                  <span className="market-analyzer__badge market-analyzer__badge--subtle">
                                                    {formatCountdown(evt.timeMs - nowMs)}
                                                  </span>
                                                  {evt.source ? (
                                                    <span className="market-analyzer__badge market-analyzer__badge--subtle">
                                                      {String(evt.source)}
                                                    </span>
                                                  ) : null}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )
                                      )
                                    )}
                                  </div>

                                  <div className="market-analyzer__news-events-col">
                                    <div className="market-analyzer__section-title">
                                      Top headlines
                                    </div>
                                    {headlines.length === 0 ? (
                                      <div className="market-analyzer__muted">
                                        No headlines available yet.
                                      </div>
                                    ) : (
                                      headlines.map((item) => (
                                        <a
                                          key={item.url || item.headline}
                                          className="market-analyzer__headline"
                                          href={item.url || '#'}
                                          target={item.url ? '_blank' : undefined}
                                          rel={item.url ? 'noreferrer' : undefined}
                                          onClick={(e) => {
                                            if (!item.url) {
                                              e.preventDefault();
                                            }
                                          }}
                                        >
                                          <div className="market-analyzer__headline-title">
                                            {item.headline}
                                          </div>
                                          <div className="market-analyzer__headline-meta">
                                            {item.source ? <span>{item.source}</span> : null}
                                            {item.sentiment ? (
                                              <span>· {String(item.sentiment)}</span>
                                            ) : null}
                                            {item.timestampMs ? (
                                              <span>· {formatDateTime(item.timestampMs)}</span>
                                            ) : null}
                                          </div>
                                        </a>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    ) : (
                      <div className="market-analyzer__card">
                        <div className="market-analyzer__card-title">Pair Analysis</div>
                        <div className="market-analyzer__card-body">
                          <button
                            type="button"
                            className="engine-console__bridge-refresh"
                            onClick={() =>
                              openPairAnalysisForSymbolAndRequestSnapshot(
                                analyzerSymbolNormalized || analyzerSymbol
                              )
                            }
                            disabled={!analyzerSymbolNormalized}
                          >
                            Analyze Pair
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
            </div>
          )}

          {marketFeed.error && <div className="engine-console__warning">{marketFeed.error}</div>}

          {SHOW_AUTOTRADING_UI && autoTradingPanelOpen && (
            <div className="dashboard__autotrading-panel">
              <header className="section-header">
                <div>
                  <h2 className="section-header__title">Auto Trading · {selectedPlatform}</h2>
                  <p className="section-header__subtitle">
                    Live status, positions, and recent closures
                  </p>
                </div>
                <div className="section-header__actions">
                  <button
                    type="button"
                    className="engine-console__bridge-refresh engine-console__bridge-refresh--compact"
                    onClick={() => setAutoTradingPanelOpen(false)}
                  >
                    Hide
                  </button>
                </div>
              </header>

              <div className="metrics-grid dashboard__autotrading-panel-grid">
                <MetricCard
                  title="Auto Trading"
                  value={autoTradingEnabled ? 'ON' : 'OFF'}
                  accent={autoTradingEnabled ? 'primary' : undefined}
                  subtitle={`${bridgeIsConnected ? 'Bridge connected' : 'Bridge offline'}${
                    lastAutoTradingChangeAt
                      ? ` · changed ${formatRelativeTime(lastAutoTradingChangeAt)}`
                      : ''
                  }`}
                />
                <MetricCard
                  title="Active Trades"
                  value={String(visibleActiveTrades.length)}
                  subtitle="Open positions"
                />
                <MetricCard
                  title="Tracked Pairs"
                  value={
                    Array.isArray(engineSnapshot?.status?.pairs)
                      ? String(engineSnapshot.status.pairs.length)
                      : '0'
                  }
                  subtitle="Signal universe"
                />
                <MetricCard
                  title="EA Sessions"
                  value={Array.isArray(eaBridgeSessions) ? String(eaBridgeSessions.length) : '0'}
                  subtitle="MT4/MT5 connections"
                />
              </div>

              <div className="engine-console__narrative dashboard__autotrading-panel-note">
                {primaryEaSession ? (
                  <>
                    Connected: {String(primaryEaSession?.broker || '').toUpperCase() || 'MT'} ·
                    Account {primaryEaSession?.accountNumber ?? '—'} · Server{' '}
                    {primaryEaSession?.server ?? '—'} · Currency {primaryEaSession?.currency ?? '—'}{' '}
                    · Balance {formatNumber(primaryEaSession?.balance, 2)} · Equity{' '}
                    {formatNumber(primaryEaSession?.equity, 2)}
                    {'\n'}
                    Last heartbeat: {formatRelativeTime(primaryEaSession?.lastHeartbeat)} (
                    {formatDateTime(primaryEaSession?.lastHeartbeat)})
                  </>
                ) : (
                  <>
                    No active EA session detected yet. Connect MT4/MT5 via MetaTrader Bridge to
                    enable real execution.
                  </>
                )}

                {lastAutoTradingMessage ? `\nLast action: ${lastAutoTradingMessage}` : ''}

                {autoTradingEnabled && visibleActiveTrades.length === 0
                  ? `\nAuto trading is ON. No trades yet — this usually means signals are not valid/strong enough right now, or execution was rejected by risk checks.`
                  : ''}

                {Array.isArray(engineSnapshot?.status?.pairs) && engineSnapshot.status.pairs.length
                  ? `\nPairs: ${engineSnapshot.status.pairs.join(', ')}`
                  : ''}
              </div>

              <div className="dashboard__autotrading-panel-table">
                <TradesTable
                  activeTrades={visibleActiveTrades}
                  tradeHistory={visibleTradeHistory}
                />
              </div>
            </div>
          )}

          {bridgeIsConnected && !pairAnalysisOpen && (
            <div
              className={`market-ticker ${tickerSearchNormalized ? 'market-ticker--list' : 'market-ticker--strip'} ${analysisIsOpen ? 'market-ticker--paused' : ''}`}
            >
              <div className="market-ticker__search">
                <select
                  className="market-ticker__search-select"
                  value={tickerCategory}
                  onChange={(e) => setTickerCategory(e.target.value)}
                  aria-label="Ticker category"
                  title="Filter symbols"
                >
                  {Array.isArray(TICKER_CATEGORIES)
                    ? TICKER_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))
                    : null}
                </select>
                <input
                  id="ticker-search"
                  name="tickerSearch"
                  className="market-ticker__search-input"
                  type="text"
                  value={tickerSearch}
                  onChange={(event) => setTickerSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      // Open quick analyzer on Enter for typed symbol.
                      const focused = tickerSearchFocused?.symbol || tickerSearchFocused?.pair;
                      const candidate = String(focused || tickerSearch || '').trim();
                      if (candidate) {
                        setTickerSearch(candidate);
                        if (EA_ONLY_UI_MODE) {
                          openPairAnalysisForSymbolAndRequestSnapshot(candidate);
                        } else {
                          openAnalyzerForSymbolAndRequestSnapshot(candidate);
                        }
                      }
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setTickerSearch('');
                      closeAnalyzer();
                    }
                  }}
                  placeholder="Search symbol (EURUSD, BTCUSD, XAUUSD, SP500…)"
                  aria-label="Search ticker symbol"
                />
              </div>

              {tickerSearchNormalized ? (
                <span className="market-ticker__meta">
                  {tickerMatchesCount > 0
                    ? `${tickerMatchesCount} match${tickerMatchesCount === 1 ? '' : 'es'} · ${tickerCategory}`
                    : `No matches · ${tickerCategory}`}
                </span>
              ) : null}

              <div
                className="market-ticker__viewport"
                title="EA quotes feed"
                ref={tickerViewportRef}
              >
                <div
                  className={`market-ticker__track ${tickerSearchNormalized ? 'market-ticker__track--static' : ''}`}
                  ref={tickerTrackRef}
                >
                  {tickerSearchNormalized ? (
                    tickerListRows.length ? (
                      <>
                        <div className="market-ticker__row market-ticker__row--head">
                          <div className="market-ticker__col market-ticker__col--symbol">Symbol</div>
                          <div className="market-ticker__col market-ticker__col--price">Bid</div>
                          <div className="market-ticker__col market-ticker__col--price">Ask</div>
                          <div className="market-ticker__col market-ticker__col--meta">Spread</div>
                          <div className="market-ticker__col market-ticker__col--meta">Age</div>
                        </div>
                        {tickerListRows.map((row) => (
                          <div
                            key={row.key}
                            role="button"
                            tabIndex={0}
                            className="market-ticker__row"
                            data-symbol={row.selected}
                            onClick={onTickerItemClick}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                onTickerItemClick(e);
                              }
                            }}
                            title={`${row.assetClass} · Click to analyze`}
                          >
                            <div className="market-ticker__col market-ticker__col--symbol">{row.symbol}</div>
                            <div className="market-ticker__col market-ticker__col--price">{row.bidLabel}</div>
                            <div className="market-ticker__col market-ticker__col--price">{row.askLabel}</div>
                            <div className="market-ticker__col market-ticker__col--meta">{row.spreadLabel}</div>
                            <div className="market-ticker__col market-ticker__col--meta">{row.ageLabel}</div>
                          </div>
                        ))}
                      </>
                    ) : (
                      <span className="market-ticker__meta">No matches.</span>
                    )
                  ) : tickerRenderModels.length ? (
                    tickerRenderModels.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className="market-ticker__item"
                        title="Click to select"
                        data-symbol={item.selected}
                        onClick={onTickerItemClick}
                      >
                        <span className={`market-ticker__arrow ${item.arrowClass}`} aria-hidden="true">
                          {item.arrow}
                        </span>
                        <span className="market-ticker__symbol">{item.symbolLabel}</span>
                        <span className={`market-ticker__price ${item.priceClass}`}>{item.midLabel}</span>
                        <span
                          className={`market-ticker__delta ${item.deltaClass} ${item.deltaEmpty ? 'market-ticker__delta--empty' : ''}`}
                        >
                          {item.deltaLabel}
                        </span>
                        <span
                          className={`market-ticker__details ${item.detailsEmpty ? 'market-ticker__details--empty' : ''}`}
                        >
                          {item.detailsLabel}
                        </span>
                      </button>
                    ))
                  ) : (
                    <span className="market-ticker__meta">Waiting for EA price feed…</span>
                  )}
                </div>
              </div>

              {tickerSearchNormalized && tickerNewsItems.length ? (
                <span className="market-ticker__meta">
                  News: {String(tickerNewsItems[0]?.headline || tickerNewsItems[0]?.title || '').slice(0, 110)}
                </span>
              ) : null}
            </div>
          )}

          {!pairAnalysisOpen && (
            <div className="session-row">
              {sessionCards.map((session) => (
                <article
                  key={session.id}
                  className={`session-pill session-pill--${session.theme} ${session.isOpen ? 'session-pill--open' : 'session-pill--closed'}`}
                >
                  <header className="session-pill__header">
                    <span className="session-pill__city">{session.city}</span>
                    <span
                      className={`session-pill__status ${session.isOpen ? 'session-pill__status--open' : 'session-pill__status--closed'}`}
                    >
                      {session.statusLabel}
                    </span>
                  </header>
                  <div className="session-pill__body">
                    <span className="session-pill__time">{session.timeDisplay}</span>
                    <span className="session-pill__timezone">{session.zoneDisplay}</span>
                  </div>
                  <footer className="session-pill__footer">
                    <span className="session-pill__window">{session.windowLabel}</span>
                    <span className="session-pill__transition">
                      {session.nextTransitionLabel} · {session.transitionDuration}
                    </span>
                  </footer>
                </article>
              ))}
            </div>
          )}

          {!pairAnalysisOpen && (
            <div className="dashboard__row dashboard__row--hero">
              <div className="dashboard__col dashboard__col--span-12">
                <section
                  className="panel panel--stretch signal-dashboard-panel"
                  aria-label="Signal dashboard"
                >
                  <div className="signal-dashboard-panel__top">
                    <div className="signal-dashboard-panel__title">
                      <h2>{entryReadyPanelMeta.headline}</h2>
                      <p className="panel__hint">
                        EA entry-ready signals ({entryReadyPanelMeta.modeLabel})
                      </p>
                    </div>
                    <div className="signal-dashboard-panel__tags">
                      <span className="dashboard__tag">EA · {entryReadyPanelMeta.eaStatus}</span>
                      <span className="dashboard__tag">
                        Quotes · {entryReadyPanelMeta.quoteCount}
                      </span>
                      <span className="dashboard__tag">
                        Signals · {entryReadyPanelMeta.retained}
                      </span>
                      <span className="dashboard__tag">
                        Candidates · {entryReadyPanelMeta.candidateCount}
                      </span>
                      {entryReadyPanelMeta.latestTs ? (
                        <span className="dashboard__tag">
                          Updated · {formatRelativeTime(entryReadyPanelMeta.latestTs)}
                        </span>
                      ) : (
                        <span className="dashboard__tag">Updated · —</span>
                      )}
                    </div>
                  </div>

                  <div
                    className="signal-dashboard-panel__table"
                    role="region"
                    aria-label="Signals table"
                  >
                    <SignalDashboardTable
                      signals={entryReadySignals}
                      snapshots={featureSnapshots}
                      selectedId={entryReadySelectedId}
                      mode="strong"
                      emptyTitle="No entry-ready EA signals right now."
                      emptyDetails={entryReadyPanelMeta.emptyDetails}
                      onSelect={(signal, id) => {
                        setEntryReadySelectedId(id || null);
                        if (signal?.pair) {
                          if (EA_ONLY_UI_MODE) {
                            openPairAnalysisForSymbolAndRequestSnapshot(signal.pair);
                          } else {
                            openAnalyzerForSymbolAndRequestSnapshot(signal.pair);
                          }
                        }
                      }}
                    />
                  </div>

                  {entryReadySignals.length === 0 && (
                    <div className="signal-dashboard-panel__candidates">
                      <CandidateSignalTable
                        signals={candidateSignals}
                        selectedId={candidateSelectedId}
                        onSelect={(signal, id) => {
                          setCandidateSelectedId(id || null);
                          if (signal?.pair) {
                            if (EA_ONLY_UI_MODE) {
                              openPairAnalysisForSymbolAndRequestSnapshot(signal.pair);
                            } else {
                              openAnalyzerForSymbolAndRequestSnapshot(signal.pair);
                            }
                          }
                        }}
                      />
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
        </section>

        {!pairAnalysisOpen && metaTraderBridgeOpen && (
          <section className="dashboard__section">
            <MetaTraderBridgePanel
              brokerConnectors={brokerStatus.connectors}
              brokerHealth={brokerStatus.health}
              onRefreshBrokers={refreshBrokerStatus}
              selectedPlatform={selectedPlatform}
              onSelectedPlatformChange={setSelectedPlatform}
              showAutoTradingControls={false}
            />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
