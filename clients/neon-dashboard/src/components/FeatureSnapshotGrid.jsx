import React from 'react';
import { formatDateTime } from '../utils/format.js';

const extractDetails = (snapshot) => {
  const features = snapshot.features || {};
  const direction = features.direction ?? features.signal ?? features.bias;
  const score = features.score ?? features.strength ?? features.confidence;
  const regime = features.regime?.state ?? features.regimeState ?? features.marketState;
  const volatility = features.volatility?.state ?? features.volatilityState;
  return {
    direction,
    score,
    regime,
    volatility
  };
};

const FeatureSnapshotGrid = ({ snapshots = [] }) => (
  <section className="panel panel--snapshots">
    <div className="panel__header">
      <h2>Feature Store Signals</h2>
      <p className="panel__hint">Latest analytical fingerprints across monitored pairs</p>
    </div>
    <div className="snapshot-grid">
      {snapshots.length === 0 && (
        <div className="snapshot-grid__empty">Feature snapshots unavailable</div>
      )}
      {snapshots.slice(0, 8).map((snapshot) => {
        const details = extractDetails(snapshot);
        return (
          <article key={`${snapshot.pair}-${snapshot.timeframe}-${snapshot.ts}`} className="snapshot-card">
            <header>
              <h3>{snapshot.pair} · {snapshot.timeframe}</h3>
              <span className="snapshot-card__time">{formatDateTime(snapshot.ts)}</span>
            </header>
            <dl>
              <div>
                <dt>Direction</dt>
                <dd>{details.direction ? String(details.direction).toUpperCase() : 'N/A'}</dd>
              </div>
              <div>
                <dt>Score</dt>
                <dd>{details.score !== undefined && details.score !== null ? Number(details.score).toFixed(2) : 'N/A'}</dd>
              </div>
              <div>
                <dt>Regime</dt>
                <dd>{details.regime ? String(details.regime).toUpperCase() : 'N/A'}</dd>
              </div>
              <div>
                <dt>Volatility</dt>
                <dd>{details.volatility ? String(details.volatility).toUpperCase() : 'N/A'}</dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  </section>
);

export default FeatureSnapshotGrid;
