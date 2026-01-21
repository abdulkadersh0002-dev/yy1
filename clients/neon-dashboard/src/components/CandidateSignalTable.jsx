import React, { useEffect, useMemo, useState } from 'react';
import { formatRelativeTime, formatDirection } from '../utils/format.js';

const MAX_CANDIDATE_TABLE_ROWS = (() => {
  const raw = Number(import.meta?.env?.VITE_CANDIDATE_TABLE_ROWS);
  if (!Number.isFinite(raw)) {
    return 200;
  }
  return Math.max(25, Math.trunc(raw));
})();

const toUpper = (value) =>
  String(value || '')
    .trim()
    .toUpperCase();

const pad = (value) => (value == null ? '—' : String(value));

const formatDecision = (signal) => {
  const decision = signal?.isValid?.decision || null;
  const state = toUpper(decision?.state) || '—';
  const blocked = decision?.blocked === true;
  return blocked ? `${state} (BLOCKED)` : state;
};

const formatBlockers = (signal) => {
  const decision = signal?.isValid?.decision || null;
  const blockers = Array.isArray(decision?.blockers) ? decision.blockers.filter(Boolean) : [];
  const missing = Array.isArray(decision?.missing) ? decision.missing.filter(Boolean) : [];
  const parts = [];
  if (blockers.length) {
    parts.push(`blockers: ${blockers.slice(0, 3).join(', ')}`);
  }
  if (missing.length) {
    parts.push(`missing: ${missing.slice(0, 3).join(', ')}`);
  }
  return parts.length ? parts.join(' · ') : '—';
};

export default function CandidateSignalTable({ signals = [], selectedId, onSelect }) {
  const [ageTick, setAgeTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setAgeTick((v) => (v + 1) % 1000000);
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo(() => {
    void ageTick;
    const list = Array.isArray(signals) ? signals : [];
    return list
      .filter(Boolean)
      .slice(0, MAX_CANDIDATE_TABLE_ROWS)
      .map((signal) => {
        const pair = pad(signal?.pair);
        const timeframe = pad(signal?.timeframe ? toUpper(signal.timeframe) : '—');
        const direction = formatDirection(signal?.direction);
        const ts = signal?.openedAt || signal?.timestamp || signal?.createdAt || null;
        const age = ts ? formatRelativeTime(ts) : '—';
        const conf = Number.isFinite(Number(signal?.confidence))
          ? `${Math.round(Number(signal.confidence))}%`
          : '—';
        const strength = Number.isFinite(Number(signal?.strength))
          ? `${Math.round(Number(signal.strength))}`
          : '—';

        return {
          id: signal?.id || signal?.mergeKey || `${pair}-${timeframe}-${String(ts || '')}`,
          raw: signal,
          pair,
          timeframe,
          age,
          direction,
          decision: formatDecision(signal),
          conf,
          strength,
          details: formatBlockers(signal)
        };
      });
  }, [signals, ageTick]);

  return (
    <div className="signal-candidates">
      <div className="signal-candidates__header">
        <h3>Near / Analyzed candidates</h3>
        <p className="panel__hint">
          These are analyzed signals with full analysis (Layers L1–L18) but not yet strict ENTER +
          trade-valid.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="signal-candidates__empty">No analyzed candidates received yet.</div>
      ) : (
        <div className="signal-candidates__tableWrap" role="region" aria-label="Candidates table">
          <table className="signal-table">
            <thead>
              <tr>
                <th>Pair</th>
                <th>TF</th>
                <th>Age</th>
                <th>Dir</th>
                <th>Decision</th>
                <th>Conf</th>
                <th>Strength</th>
                <th>Why not ENTER</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelected = selectedId && row.id === selectedId;
                return (
                  <tr
                    key={row.id}
                    className={
                      isSelected
                        ? 'signal-table__row signal-table__row--selected'
                        : 'signal-table__row'
                    }
                    onClick={() => onSelect?.(row.raw, row.id)}
                    style={{ cursor: onSelect ? 'pointer' : 'default' }}
                  >
                    <td>{row.pair}</td>
                    <td>{row.timeframe}</td>
                    <td>{row.age}</td>
                    <td>{row.direction}</td>
                    <td>{row.decision}</td>
                    <td>{row.conf}</td>
                    <td>{row.strength}</td>
                    <td title={row.details}>{row.details}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
