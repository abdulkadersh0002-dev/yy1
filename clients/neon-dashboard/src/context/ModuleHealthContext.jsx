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

const defaultValue = {
  modules: [],
  modulesById: Object.create(null),
  overall: null,
  heartbeat: null,
  loading: true,
  error: null,
  refresh: async () => undefined
};

const ModuleHealthContext = createContext(defaultValue);

export function ModuleHealthProvider({ children, pollIntervalMs = 45000 }) {
  const [state, setState] = useState({
    modules: [],
    overall: null,
    heartbeat: null,
    loading: true,
    error: null
  });
  const mountedRef = useRef(false);

  const refresh = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      loading: true,
      error: prev.modules.length ? prev.error : null
    }));

    try {
      const response = await fetchJson('/api/health/modules');
      if (!mountedRef.current) {
        return undefined;
      }
      setState({
        modules: Array.isArray(response?.modules) ? response.modules : [],
        overall: response?.overall || null,
        heartbeat: response?.heartbeat || null,
        loading: false,
        error: null
      });
    } catch (error) {
      if (!mountedRef.current) {
        return undefined;
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error?.message || 'Failed to load module health'
      }));
    }

    return undefined;
  }, []);

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

  const modulesById = useMemo(() => {
    const dictionary = Object.create(null);
    for (const module of state.modules) {
      if (module && module.id) {
        dictionary[module.id] = module;
      }
    }
    return dictionary;
  }, [state.modules]);

  const value = useMemo(() => ({
    ...state,
    modulesById,
    refresh
  }), [state, modulesById, refresh]);

  return (
    <ModuleHealthContext.Provider value={value}>
      {children}
    </ModuleHealthContext.Provider>
  );
}

export function useModuleHealth() {
  return useContext(ModuleHealthContext);
}
