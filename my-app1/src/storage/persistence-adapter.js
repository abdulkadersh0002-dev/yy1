import { getPool } from './database.js';

function isConfigured() {
  return Boolean(getPool());
}

function safeJSON(value) {
  if (value == null) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    console.warn('Failed to serialize JSON payload:', error.message);
    return null;
  }
}

export function createPersistenceAdapter() {
  const pool = getPool();
  if (!pool) {
    return null;
  }

  let disabled = false;

  function markDisabled(error) {
    if (disabled) {
      return;
    }
    disabled = true;
    const reason = error?.message || error?.code || 'unknown reason';
    console.warn(`Persistence adapter disabled (database unavailable): ${reason}`);
  }

  function ensureActive() {
    return !disabled;
  }

  async function recordFeatureSnapshot(snapshot) {
    if (!ensureActive()) {
      return false;
    }
    const {
      pair,
      timeframe,
      capturedAt,
      featureHash,
      features,
      strength,
      confidence,
      direction,
      metadata
    } = snapshot;

    const queryText = `
      INSERT INTO feature_snapshots
        (pair, timeframe, captured_at, feature_hash, features, signal_strength, signal_confidence, signal_direction, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb)
    `;

    const params = [
      pair,
      timeframe,
      capturedAt,
      featureHash || null,
      safeJSON(features),
      strength != null ? Number(strength) : null,
      confidence != null ? Number(confidence) : null,
      direction || null,
      safeJSON(metadata) || '{}'
    ];

    try {
      await pool.query(queryText, params);
      return true;
    } catch (error) {
      console.error('Failed to persist feature snapshot:', error?.message || error);
      markDisabled(error);
      return false;
    }
  }

  async function recordProviderMetric(entry) {
    if (!ensureActive()) {
      return false;
    }
    const {
      provider,
      collectedAt,
      latencyMs,
      successCount,
      failureCount,
      rateLimitedCount,
      successRate,
      normalizedQuality,
      confidencePct,
      remainingQuota,
      metadata
    } = entry;

    const queryText = `
      INSERT INTO provider_metrics
        (provider, collected_at, latency_ms, success_count, failure_count, rate_limited_count, success_rate, normalized_quality, confidence_pct, remaining_quota, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    `;

    const params = [
      provider,
      collectedAt,
      latencyMs != null ? Number(latencyMs) : null,
      Number.isInteger(successCount) ? successCount : null,
      Number.isInteger(failureCount) ? failureCount : null,
      Number.isInteger(rateLimitedCount) ? rateLimitedCount : null,
      successRate != null ? Number(successRate) : null,
      normalizedQuality != null ? Number(normalizedQuality) : null,
      confidencePct != null ? Number(confidencePct) : null,
      Number.isInteger(remainingQuota) ? remainingQuota : null,
      safeJSON(metadata) || '{}'
    ];

    try {
      await pool.query(queryText, params);
      return true;
    } catch (error) {
      console.error('Failed to persist provider metric:', error?.message || error);
      markDisabled(error);
      return false;
    }
  }

  async function recordProviderAvailabilitySnapshot(entry) {
    if (!ensureActive()) {
      return false;
    }
    if (!entry) {
      return false;
    }

    const {
      timestamp,
      state,
      severity,
      reason,
      aggregateQuality,
      normalizedQuality,
      unavailableProviders,
      breakerProviders,
      blockedTimeframes,
      blockedProviderRatio,
      blockedTimeframeRatio,
      detail,
      metadata
    } = entry;

    const queryText = `
      INSERT INTO provider_availability_history
        (captured_at, state, severity, reason, aggregate_quality, normalized_quality, unavailable_providers, breaker_providers, blocked_timeframes, blocked_provider_ratio, blocked_timeframe_ratio, detail, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
    `;

    const capturedAt = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
    const unavailable =
      Array.isArray(unavailableProviders) && unavailableProviders.length > 0
        ? unavailableProviders.map((value) => String(value))
        : null;
    const breakers =
      Array.isArray(breakerProviders) && breakerProviders.length > 0
        ? breakerProviders.map((value) => String(value))
        : null;
    const blocked =
      Array.isArray(blockedTimeframes) && blockedTimeframes.length > 0
        ? blockedTimeframes.map((value) => String(value))
        : null;

    const params = [
      capturedAt,
      state || 'unknown',
      severity || 'info',
      reason || null,
      aggregateQuality != null ? Number(aggregateQuality) : null,
      normalizedQuality != null ? Number(normalizedQuality) : null,
      unavailable,
      breakers,
      blocked,
      blockedProviderRatio != null ? Number(blockedProviderRatio) : null,
      blockedTimeframeRatio != null ? Number(blockedTimeframeRatio) : null,
      detail || null,
      safeJSON(metadata) || '{}'
    ];

    try {
      await pool.query(queryText, params);
      return true;
    } catch (error) {
      console.error('Failed to persist provider availability snapshot:', error?.message || error);
      markDisabled(error);
      return false;
    }
  }

  async function getProviderAvailabilityHistory(options = {}) {
    if (!ensureActive()) {
      return [];
    }

    const { since, limit = 288, order = 'desc' } = options;

    const params = [];
    const whereClauses = [];

    if (since) {
      const sinceDate = since instanceof Date ? since : new Date(since);
      params.push(sinceDate);
      whereClauses.push(`captured_at >= $${params.length}`);
    }

    const direction = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    params.push(Math.max(1, Math.min(2000, Number(limit) || 288)));

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const queryText = `
      SELECT captured_at, state, severity, reason, aggregate_quality, normalized_quality,
             unavailable_providers, breaker_providers, blocked_timeframes,
             blocked_provider_ratio, blocked_timeframe_ratio, detail, metadata
      FROM provider_availability_history
      ${whereSql}
      ORDER BY captured_at ${direction}
      LIMIT $${params.length}
    `;

    try {
      const { rows } = await pool.query(queryText, params);
      return rows;
    } catch (error) {
      console.error('Failed to load provider availability history:', error?.message || error);
      markDisabled(error);
      return [];
    }
  }

  async function recordDataQualityMetric(metric) {
    if (!ensureActive()) {
      return false;
    }
    if (!metric || !metric.pair) {
      return false;
    }

    const { pair, assessedAt, score, status, recommendation, issues, timeframeReports } = metric;

    const queryText = `
      INSERT INTO data_quality_metrics
        (pair, assessed_at, score, status, recommendation, issues, timeframe_reports)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `;

    const params = [
      pair,
      assessedAt instanceof Date ? assessedAt : new Date(assessedAt || Date.now()),
      score != null ? Number(score) : null,
      status || null,
      recommendation || null,
      Array.isArray(issues) && issues.length > 0 ? issues.map((value) => String(value)) : null,
      safeJSON(timeframeReports) || '{}'
    ];

    try {
      await pool.query(queryText, params);
      return true;
    } catch (error) {
      console.error('Failed to persist data quality metric:', error?.message || error);
      markDisabled(error);
      return false;
    }
  }

  async function recordNewsItems(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
      return 0;
    }

    if (!ensureActive()) {
      return 0;
    }

    let inserted = 0;

    const queryText = `
      INSERT INTO news_events
        (feed_id, source, category, headline, summary, url, published_at, collected_at, keywords, sentiment, impact, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()), $9, $10, $11, $12::jsonb)
      ON CONFLICT (feed_id, headline, published_at) DO NOTHING
    `;

    for (const item of items) {
      const params = [
        item.feedId || 'unknown',
        item.source || 'Unknown',
        item.category || null,
        item.headline,
        item.summary || null,
        item.url || null,
        item.publishedAt instanceof Date
          ? item.publishedAt
          : new Date(item.publishedAt || Date.now()),
        item.collectedAt instanceof Date ? item.collectedAt : null,
        Array.isArray(item.keywords)
          ? item.keywords
              .map((keyword) => (typeof keyword === 'string' ? keyword.trim().toLowerCase() : null))
              .filter(Boolean)
          : null,
        item.sentiment != null ? Number(item.sentiment) : null,
        item.impact != null ? Number(item.impact) : null,
        safeJSON(item.metadata) || '{}'
      ];

      try {
        const result = await pool.query(queryText, params);
        inserted += result.rowCount || 0;
      } catch (error) {
        console.error('Failed to persist news item:', error?.message || error);
        markDisabled(error);
        break;
      }
    }

    return inserted;
  }

  async function getRecentNews(options = {}) {
    if (!ensureActive()) {
      return [];
    }
    const { since, limit = 120, keywords = [] } = options;

    const params = [];
    const whereClauses = [];

    const sinceDate = since ? new Date(since) : new Date(Date.now() - 12 * 60 * 60 * 1000);
    params.push(sinceDate);
    whereClauses.push(`published_at >= $${params.length}`);

    if (Array.isArray(keywords) && keywords.length > 0) {
      const normalized = keywords
        .map((keyword) => (typeof keyword === 'string' ? keyword.trim().toLowerCase() : null))
        .filter(Boolean);
      if (normalized.length > 0) {
        params.push(normalized);
        whereClauses.push(`keywords && $${params.length}::text[]`);
      }
    }

    params.push(Math.max(limit, 1));

    const queryText = `
      SELECT feed_id, source, category, headline, summary, url, published_at, collected_at, keywords, sentiment, impact, metadata
      FROM news_events
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY published_at DESC
      LIMIT $${params.length}
    `;

    try {
      const { rows } = await pool.query(queryText, params);
      return rows;
    } catch (error) {
      console.error('Failed to load recent news items:', error?.message || error);
      markDisabled(error);
      return [];
    }
  }

  async function getLatestProviderMetrics() {
    if (!ensureActive()) {
      return [];
    }
    try {
      const { rows } = await pool.query('SELECT * FROM latest_provider_metrics');
      return rows;
    } catch (error) {
      console.error('Failed to load provider metrics:', error?.message || error);
      markDisabled(error);
      return [];
    }
  }

  return {
    isConfigured,
    recordFeatureSnapshot,
    recordProviderMetric,
    recordProviderAvailabilitySnapshot,
    getProviderAvailabilityHistory,
    recordDataQualityMetric,
    recordNewsItems,
    getRecentNews,
    getLatestProviderMetrics
  };
}
