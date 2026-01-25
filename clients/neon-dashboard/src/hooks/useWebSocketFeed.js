import { useEffect, useRef } from 'react';
import { getApiConfig } from '../utils/api.js';

const RECONNECT_DELAY_MS = 5000;
const CLOSE_IF_IDLE_DELAY_MS = 250;

const listeners = new Set();
let socket = null;
let reconnectTimer = null;
let closeIfIdleTimer = null;
let currentConfig = null;

const toEventPayload = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return {
      id: `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'unknown',
      payload: raw,
      timestamp: Date.now()
    };
  }
  const timestamp = raw.timestamp || Date.now();
  const type = raw.type || raw.event || 'unknown';
  return {
    id: raw.id || `${type}-${timestamp}-${Math.random().toString(16).slice(2)}`,
    type,
    payload: raw.payload ?? raw.data ?? null,
    timestamp
  };
};

const notifyListeners = (event) => {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.warn('WebSocket listener error', error);
    }
  }
};

const closeSocket = () => {
  if (closeIfIdleTimer) {
    clearTimeout(closeIfIdleTimer);
    closeIfIdleTimer = null;
  }
  if (socket && typeof globalThis !== 'undefined') {
    try {
      socket.close();
    } catch (_error) {
      // ignore close errors
    }
  }
  socket = null;
};

const scheduleCloseIfIdle = () => {
  if (closeIfIdleTimer || listeners.size > 0) {
    return;
  }

  closeIfIdleTimer = setTimeout(() => {
    closeIfIdleTimer = null;
    if (listeners.size === 0) {
      closeSocket();
    }
  }, CLOSE_IF_IDLE_DELAY_MS);
};

const scheduleReconnect = () => {
  if (reconnectTimer || listeners.size === 0) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureSocket();
  }, RECONNECT_DELAY_MS);
};

const ensureSocket = () => {
  if (socket || listeners.size === 0) {
    return;
  }

  if (closeIfIdleTimer) {
    clearTimeout(closeIfIdleTimer);
    closeIfIdleTimer = null;
  }

  if (typeof globalThis === 'undefined' || typeof globalThis.WebSocket === 'undefined') {
    return;
  }

  if (!currentConfig) {
    currentConfig = getApiConfig();
  }

  const { wsUrl } = currentConfig;
  if (!wsUrl) {
    return;
  }

  try {
    socket = new globalThis.WebSocket(wsUrl);
  } catch (_error) {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    // connection established
  };

  socket.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      notifyListeners(toEventPayload(parsed));
    } catch (error) {
      console.warn('Failed to parse WebSocket payload', error);
    }
  };

  socket.onerror = () => {
    closeSocket();
    scheduleReconnect();
  };

  socket.onclose = () => {
    closeSocket();
    scheduleReconnect();
  };
};

export const useWebSocketFeed = (onEvent) => {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (typeof handlerRef.current !== 'function') {
      return () => undefined;
    }

    const listener = (event) => {
      handlerRef.current?.(event);
    };

    listeners.add(listener);
    ensureSocket();

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        scheduleCloseIfIdle();
        currentConfig = null;
      }
    };
  }, []);
};
