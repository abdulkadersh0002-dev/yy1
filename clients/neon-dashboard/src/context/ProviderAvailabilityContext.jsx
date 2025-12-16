import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { fetchJson } from '../utils/api.js';
import { useWebSocketFeed } from '../hooks/useWebSocketFeed.js';

const defaultState = {
  snapshot: null,
  providers: [],
  timeframes: [],
  aggregateQuality: null,
  normalizedQuality: null,
  defaultAvailability: null,
  lastUpdated: null,
  classification: null,
  latestClassification: null,
  history: [],
  historyStats: null,
  historyLimit: null,
  historyStorage: { inMemorySamples: 0, persistenceEnabled: false },
  loading: true,
  error: null,
  refresh: async () => undefined
};

const ProviderAvailabilityContext = createContext(defaultState);

function normalizeSnapshot(snapshot, previousState) {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      snapshot: null,
      providers: [],
      timeframes: [],
      aggregateQuality: null,
      normalizedQuality: null,
      defaultAvailability: null,
      lastUpdated: null,
      classification: null,
      latestClassification: previousState?.latestClassification ?? null,
      history: previousState?.history ?? [],
      historyStats: previousState?.historyStats ?? null,
      historyLimit: previousState?.historyLimit ?? null,
      historyStorage: previousState?.historyStorage ?? { inMemorySamples: 0, persistenceEnabled: false }
    };
  }

  const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];
  const timeframes = Array.isArray(snapshot.timeframes) ? snapshot.timeframes : [];
  const aggregateQuality = Number.isFinite(snapshot.aggregateQuality)
    ? snapshot.aggregateQuality
    : Number.isFinite(snapshot.dataConfidence?.aggregate)
      ? snapshot.dataConfidence.aggregate
      : null;
  const normalizedQuality = Number.isFinite(snapshot.normalizedQuality)
    ? snapshot.normalizedQuality
    : Number.isFinite(snapshot.dataConfidence?.normalized)
      ? snapshot.dataConfidence.normalized
      : null;

  const timestamp = Number.isFinite(snapshot.timestamp)
    ? snapshot.timestamp
    : Number.isFinite(snapshot.defaultAvailability?.inspectedAt)
      ? snapshot.defaultAvailability.inspectedAt
      : Date.now();

  const classification = snapshot && typeof snapshot.classification === 'object'
    ? snapshot.classification
    : Array.isArray(snapshot.history) && snapshot.history.length > 0
      ? previousState?.classification ?? null
      : null;

  const latestClassification = (() => {
    if (snapshot && typeof snapshot.latestClassification === 'object') {
      return snapshot.latestClassification;
    }
    if (classification) {
      return classification;
    }
    if (previousState?.latestClassification) {
      return previousState.latestClassification;
    }
    return null;
  })();

  const history = Array.isArray(snapshot.history)
    ? snapshot.history.map((entry) => ({
      ...entry,
      unavailableProviders: Array.isArray(entry?.unavailableProviders) ? [...entry.unavailableProviders] : entry?.unavailableProviders,
      breakerProviders: Array.isArray(entry?.breakerProviders) ? [...entry.breakerProviders] : entry?.breakerProviders,
      blockedTimeframes: Array.isArray(entry?.blockedTimeframes) ? [...entry.blockedTimeframes] : entry?.blockedTimeframes
    }))
    : previousState?.history ?? [];

  const historyStats = snapshot.historyStats || previousState?.historyStats || null;
  const historyLimit = Number.isFinite(snapshot.historyLimit)
    ? snapshot.historyLimit
    : previousState?.historyLimit ?? null;
  const historyStorage = snapshot.historyStorage
    ? { ...snapshot.historyStorage }
    : previousState?.historyStorage
      ? { ...previousState.historyStorage }
      : { inMemorySamples: 0, persistenceEnabled: false };

  return {
    snapshot,
    providers,
    timeframes,
    aggregateQuality,
    normalizedQuality,
    defaultAvailability: snapshot.defaultAvailability ?? null,
    lastUpdated: timestamp,
    classification,
    latestClassification,
    history,
    historyStats,
    historyLimit,
    historyStorage
  };
}

export function ProviderAvailabilityProvider({ children, pollIntervalMs = 120000 }) {
  const [state, setState] = useState({
    snapshot: null,
    providers: [],
    timeframes: [],
    aggregateQuality: null,
    normalizedQuality: null,
    defaultAvailability: null,
    lastUpdated: null,
    classification: null,
    latestClassification: null,
    history: [],
    historyStats: null,
    historyLimit: null,
    historyStorage: { inMemorySamples: 0, persistenceEnabled: false },
    loading: true,
    error: null
  });
  const mountedRef = useRef(false);

  const applySnapshot = useCallback((nextSnapshot) => {
    setState((prev) => {
      const normalized = normalizeSnapshot(nextSnapshot, prev);
      const previousTs = Number.isFinite(prev.lastUpdated) ? prev.lastUpdated : -Infinity;
      const nextTs = Number.isFinite(normalized.lastUpdated) ? normalized.lastUpdated : Date.now();
      if (nextTs < previousTs) {
        return prev;
      }
      return {
        ...prev,
        ...normalized,
        loading: false,
        error: null
      };
    });
  }, []);

  const refresh = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      loading: true,
      error: prev.snapshot ? prev.error : null
    }));

    try {
      const response = await fetchJson('/api/health/providers');
      if (!mountedRef.current) {
        return undefined;
      }
      applySnapshot(response);
    } catch (error) {
      if (!mountedRef.current) {
        return undefined;
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error?.message || 'Failed to load provider availability'
      }));
    }

    return undefined;
  }, [applySnapshot]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();

    let intervalId;
    if (pollIntervalMs > 0) {
      intervalId = setInterval(() => {
        refresh();
      }, pollIntervalMs);
    }

    return () => {
      mountedRef.current = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [pollIntervalMs, refresh]);

  useWebSocketFeed((event) => {
    if (!event || event.type !== 'provider_availability') {
      return;
    }
    const payload = event.payload;
    if (!payload || typeof payload !== 'object') {
      return;
    }
    applySnapshot(payload);
  });

  const value = useMemo(() => ({
    ...state,
    refresh
  }), [state, refresh]);

  return (
    <ProviderAvailabilityContext.Provider value={value}>
      {children}
    </ProviderAvailabilityContext.Provider>
  );
}

export function useProviderAvailability() {
  return useContext(ProviderAvailabilityContext);
}
