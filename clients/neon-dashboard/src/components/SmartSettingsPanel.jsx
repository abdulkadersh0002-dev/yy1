import React, { useEffect, useMemo, useState } from 'react';
import { fetchJson, postJson } from '../utils/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const defaultPrefs = {
  notifications: {
    telegram: false,
    email: true,
  },
  risk: {
    maxDailyRisk: 6,
    maxConcurrent: 5,
  },
  ui: {
    compactMode: false,
    liveTicker: true,
  },
};

export default function SmartSettingsPanel({ onClose }) {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState(defaultPrefs);
  const [status, setStatus] = useState({ loading: false, error: null, saved: false });

  const headers = useMemo(
    () => (accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    [accessToken]
  );

  useEffect(() => {
    let mounted = true;
    const loadSettings = async () => {
      setStatus((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const response = await fetchJson('/api/config', { headers });
        if (mounted && response?.config) {
          setSettings((prev) => ({ ...prev, ...response.config }));
        }
      } catch (error) {
        if (mounted) {
          setStatus((prev) => ({ ...prev, error: error?.message || 'Failed to load config' }));
        }
      } finally {
        if (mounted) {
          setStatus((prev) => ({ ...prev, loading: false }));
        }
      }
    };
    loadSettings();
    return () => {
      mounted = false;
    };
  }, [headers]);

  const updateSetting = (path, value) => {
    setSettings((prev) => {
      const next = { ...prev };
      const [section, key] = path.split('.');
      if (!next[section]) {
        next[section] = {};
      }
      next[section] = { ...next[section], [key]: value };
      return next;
    });
  };

  const save = async () => {
    setStatus({ loading: true, error: null, saved: false });
    try {
      await postJson('/api/config/update', { config: settings }, { headers });
      setStatus({ loading: false, error: null, saved: true });
    } catch (error) {
      setStatus({ loading: false, error: error?.message || 'Save failed', saved: false });
    }
  };

  return (
    <section className="smart-settings">
      <header className="smart-settings__header">
        <div>
          <h2>Smart Control Center</h2>
          <p>Configure alerts, execution safety, and UI focus without touching strategy logic.</p>
        </div>
        <div className="smart-settings__actions">
          <button className="auth-panel__button auth-panel__button--ghost" onClick={onClose}>
            Close
          </button>
          <button className="auth-panel__button" onClick={save} disabled={status.loading}>
            {status.loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      <div className="smart-settings__grid">
        <div className="smart-settings__card">
          <h3>Notifications</h3>
          <label className="smart-settings__row">
            <input
              type="checkbox"
              checked={settings.notifications?.telegram}
              onChange={(event) => updateSetting('notifications.telegram', event.target.checked)}
            />
            Telegram alerts (admin channel)
          </label>
          <label className="smart-settings__row">
            <input
              type="checkbox"
              checked={settings.notifications?.email}
              onChange={(event) => updateSetting('notifications.email', event.target.checked)}
            />
            Email alerts (executive summary)
          </label>
        </div>

        <div className="smart-settings__card">
          <h3>Risk Safety</h3>
          <label className="smart-settings__row">
            Max daily risk %
            <input
              className="smart-settings__input"
              type="number"
              min="1"
              max="20"
              value={settings.risk?.maxDailyRisk ?? 6}
              onChange={(event) => updateSetting('risk.maxDailyRisk', Number(event.target.value))}
            />
          </label>
          <label className="smart-settings__row">
            Max concurrent trades
            <input
              className="smart-settings__input"
              type="number"
              min="1"
              max="20"
              value={settings.risk?.maxConcurrent ?? 5}
              onChange={(event) => updateSetting('risk.maxConcurrent', Number(event.target.value))}
            />
          </label>
        </div>

        <div className="smart-settings__card">
          <h3>Dashboard UX</h3>
          <label className="smart-settings__row">
            <input
              type="checkbox"
              checked={settings.ui?.compactMode}
              onChange={(event) => updateSetting('ui.compactMode', event.target.checked)}
            />
            Compact mode
          </label>
          <label className="smart-settings__row">
            <input
              type="checkbox"
              checked={settings.ui?.liveTicker}
              onChange={(event) => updateSetting('ui.liveTicker', event.target.checked)}
            />
            Live ticker enabled
          </label>
        </div>
      </div>

      {status.error && <div className="auth-panel__error">{status.error}</div>}
      {status.saved && <div className="smart-settings__saved">Settings updated.</div>}
    </section>
  );
}
