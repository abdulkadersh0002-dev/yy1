// Centralized dev presets for `npm run start:all`
// Keep this as the single source of truth for common env combinations.

const normalizeName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^preset:/, '')
    .replace(/[\s-]+/g, '_');

export const PRESETS = {
  default: {
    label: 'Default (uses env defaults)',
    env: {}
  },

  synthetic: {
    label: 'Synthetic dev (NO DB/NO KEYS)',
    env: {
      ALLOW_SYNTHETIC_DATA: 'true',
      REQUIRE_REALTIME_DATA: 'false',
      NEWS_RSS_ONLY: 'true'
    }
  },

  all_symbols: {
    label: 'Allow ALL symbols',
    env: {
      ALLOW_ALL_SYMBOLS: 'true'
    }
  },

  all_symbols_full_scan: {
    label: 'Allow ALL symbols + Full scan',
    env: {
      ALLOW_ALL_SYMBOLS: 'true',
      EA_FULL_SCAN: 'true',
      EA_BACKGROUND_SIGNALS: 'true',
      EA_RESPECT_DASHBOARD_ACTIVE_SYMBOLS: 'false',
      EA_DASHBOARD_ALLOW_CANDIDATES: 'true',
      EA_SCAN_SYMBOLS_MAX: '2000',
      VITE_ACTIVE_SYMBOLS_SYNC_MAX: '2000',
      WS_MAX_RECENT_CANDIDATE_SIGNALS: '500',
      VITE_MAX_CANDIDATE_ITEMS: '500',
      VITE_CANDIDATE_TABLE_ROWS: '200'
    }
  },

  all_symbols_auto_trading: {
    label: 'Allow ALL symbols + Auto-trading autostart',
    env: {
      ALLOW_ALL_SYMBOLS: 'true',
      AUTO_TRADING_AUTOSTART: 'true'
    }
  },

  smart_strong_mt5_auto: {
    label: 'SMART STRONG MT5 auto',
    env: {
      ALLOW_ALL_SYMBOLS: 'false',
      AUTO_TRADING_ASSET_CLASSES: 'forex,metals',
      AUTO_TRADING_AUTOSTART: 'true',
      AUTO_TRADING_PRESET: 'smart_strong',
      AUTO_TRADING_FORCE_BROKER: 'mt5'
    }
  },

  smart_strong_mt5_more_entries: {
    label: 'SMART STRONG MT5 auto (+ more entries)',
    env: {
      ALLOW_ALL_SYMBOLS: 'false',
      AUTO_TRADING_ASSET_CLASSES: 'forex,metals',
      AUTO_TRADING_AUTOSTART: 'true',
      AUTO_TRADING_PRESET: 'smart_strong',
      AUTO_TRADING_FORCE_BROKER: 'mt5',
      AUTO_TRADING_REALTIME_REQUIRE_LAYERS18: 'false',
      AUTO_TRADING_REALTIME_MIN_CONFIDENCE: '70',
      AUTO_TRADING_REALTIME_MIN_STRENGTH: '55',
      EA_SIGNAL_MIN_CONFIDENCE: '70',
      EA_SIGNAL_MIN_STRENGTH: '55',
      AUTO_TRADING_ENFORCE_HTF_ALIGNMENT: 'false',
      AUTO_TRADING_SMART_STRONG_ENTER_SCORE: '40',
      EA_STRICT_SMART_CHECKLIST: 'false',
      SIGNAL_CONFLUENCE_ADVISORY_SMART_FAILS: 'true',
      SIGNAL_CONFLUENCE_MIN_SCORE: '45',
      SIGNAL_HARD_MIN_CONFIDENCE: '40'
    }
  },

  fx_metals_strong_auto_v2: {
    label: 'FX+Metals STRONG AUTO v2',
    env: {
      ALLOW_ALL_SYMBOLS: 'false',
      AUTO_TRADING_ASSET_CLASSES: 'forex,metals',
      AUTO_TRADING_AUTOSTART: 'true',
      AUTO_TRADING_PRESET: 'smart_strong',
      AUTO_TRADING_FORCE_BROKER: 'mt5',
      AUTO_TRADING_REALTIME_REQUIRE_LAYERS18: 'false',
      AUTO_TRADING_REALTIME_MIN_CONFIDENCE: '70',
      AUTO_TRADING_REALTIME_MIN_STRENGTH: '55',
      EA_SIGNAL_MIN_CONFIDENCE: '70',
      EA_SIGNAL_MIN_STRENGTH: '55',
      AUTO_TRADING_ENFORCE_HTF_ALIGNMENT: 'false',
      AUTO_TRADING_SMART_STRONG_ENTER_SCORE: '40'
    }
  },

  fx_metals_active_auto_more_trades: {
    label: 'FX+Metals ACTIVE AUTO (more trades)',
    env: {
      ALLOW_ALL_SYMBOLS: 'false',
      AUTO_TRADING_ASSET_CLASSES: 'forex,metals',
      AUTO_TRADING_AUTOSTART: 'true',
      AUTO_TRADING_PRESET: 'smart_strong',
      AUTO_TRADING_FORCE_BROKER: 'mt5',
      AUTO_TRADING_REALTIME_REQUIRE_LAYERS18: 'false',
      AUTO_TRADING_REALTIME_MIN_CONFIDENCE: '60',
      AUTO_TRADING_REALTIME_MIN_STRENGTH: '45',
      EA_SIGNAL_MIN_CONFIDENCE: '60',
      EA_SIGNAL_MIN_STRENGTH: '45',
      AUTO_TRADING_ENFORCE_HTF_ALIGNMENT: 'false',
      AUTO_TRADING_SMART_STRONG_ENTER_SCORE: '30',
      EA_STRICT_SMART_CHECKLIST: 'false',
      SIGNAL_CONFLUENCE_ADVISORY_SMART_FAILS: 'true',
      SIGNAL_CONFLUENCE_MIN_SCORE: '40',
      SIGNAL_HARD_MIN_CONFIDENCE: '40'
    }
  },

  fx_metals_smart_auto_strong_trades: {
    label: 'FX+Metals SMART AUTO (strong trades)',
    env: {
      ALLOW_ALL_SYMBOLS: 'false',
      AUTO_TRADING_ASSET_CLASSES: 'forex,metals',
      AUTO_TRADING_AUTOSTART: 'true',
      AUTO_TRADING_PRESET: 'smart_strong',
      AUTO_TRADING_PROFILE: 'aggressive',
      AUTO_TRADING_AGGRESSIVE_ENTER_SCORE: '15',
      AUTO_TRADING_FORCE_BROKER: 'mt5',
      AUTO_TRADING_REALTIME_REQUIRE_LAYERS18: 'false',
      AUTO_TRADING_REALTIME_MIN_CONFIDENCE: '48',
      AUTO_TRADING_REALTIME_MIN_STRENGTH: '45',
      EA_SIGNAL_MIN_CONFIDENCE: '48',
      EA_SIGNAL_MIN_STRENGTH: '45',
      AUTO_TRADING_ENFORCE_HTF_ALIGNMENT: 'false',
      AUTO_TRADING_SMART_STRONG_ENTER_SCORE: '32',
      EA_STRICT_SMART_CHECKLIST: 'false',
      SIGNAL_CONFLUENCE_ADVISORY_SMART_FAILS: 'true',
      SIGNAL_CONFLUENCE_MIN_SCORE: '42',
      SIGNAL_HARD_MIN_CONFIDENCE: '40'
    }
  }
};

const ALIASES = new Map([
  ['no_db_no_keys', 'synthetic'],
  ['all', 'all_symbols'],
  ['all_symbols_fullscan', 'all_symbols_full_scan'],
  ['full_scan', 'all_symbols_full_scan'],
  ['smart_strong_mt5', 'smart_strong_mt5_auto'],
  ['smart_strong', 'smart_strong_mt5_auto']
]);

export function resolvePresetKey(input) {
  const key = normalizeName(input);
  if (!key) {
    return 'default';
  }
  const resolved = ALIASES.get(key) || key;
  return PRESETS[resolved] ? resolved : 'default';
}

export function applyPresetEnv(env, presetKey) {
  const resolvedKey = resolvePresetKey(presetKey);
  const preset = PRESETS[resolvedKey] || PRESETS.default;
  const next = { ...env };

  for (const [k, v] of Object.entries(preset.env || {})) {
    if (v === undefined) {
      continue;
    }
    next[k] = String(v);
  }

  return { presetKey: resolvedKey, preset, env: next };
}

export function formatPresetList() {
  const lines = [];
  for (const [key, value] of Object.entries(PRESETS)) {
    lines.push(`${key} - ${value.label}`);
  }
  return lines.join('\n');
}
