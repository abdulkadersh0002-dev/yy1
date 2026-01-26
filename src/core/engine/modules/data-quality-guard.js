import { allowSyntheticData } from '../../../config/runtime-flags.js';
import { getPairMetadata } from '../../../config/pair-catalog.js';

const TIMEFRAME_SECONDS = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H2: 7200,
  H4: 14400,
  H6: 21600,
  H12: 43200,
  D1: 86400
};

const SPIKE_THRESHOLDS = {
  M1: 2.4,
  M5: 2.0,
  M15: 1.6,
  M30: 1.4,
  H1: 1.2,
  H4: 0.9,
  D1: 0.6
};

const SPREAD_THRESHOLDS = {
  majors: { warn: 2.2, block: 3.8 },
  yen: { warn: 2.6, block: 4.2 },
  minors: { warn: 2.8, block: 5.0 },
  crosses: { warn: 3.4, block: 6.2 }
};

const AUTO_REENABLE_DEFAULTS = {
  enabled: true,
  minScore: 78,
  minHealthyCount: 2,
  windowMs: 4 * 60 * 1000
};

function normalizePairCategory(pair) {
  const value = (pair || '').toUpperCase();
  const majors = new Set(['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF', 'USDCAD', 'NZDUSD']);
  if (majors.has(value)) {
    return 'majors';
  }
  if (value.endsWith('JPY')) {
    return 'yen';
  }
  if (value.startsWith('EUR') || value.startsWith('GBP') || value.startsWith('AUD')) {
    return 'minors';
  }
  return 'crosses';
}

function normalizeTimeframe(tf) {
  if (!tf) {
    return 'M15';
  }
  return String(tf).trim().toUpperCase();
}

function getSpreadThresholds(pair) {
  const metadata = getPairMetadata(pair);
  if (metadata?.assetClass && metadata.assetClass !== 'forex') {
    return null;
  }
  const category = normalizePairCategory(pair);
  return SPREAD_THRESHOLDS[category] || SPREAD_THRESHOLDS.crosses;
}

function timeframeToSeconds(tf) {
  const normalized = normalizeTimeframe(tf);
  return TIMEFRAME_SECONDS[normalized] || 3600;
}

function spikeThreshold(tf) {
  const normalized = normalizeTimeframe(tf);
  return SPIKE_THRESHOLDS[normalized] || 2.0;
}

function calculatePercentChange(prev, next) {
  if (!Number.isFinite(prev) || !Number.isFinite(next) || prev === 0) {
    return 0;
  }
  return Math.abs(((next - prev) / prev) * 100);
}

function priceToPips(pair, priceDiff) {
  if (!Number.isFinite(priceDiff)) {
    return 0;
  }
  const metadata = getPairMetadata(pair);
  const pipSize = Number.isFinite(metadata?.pipSize)
    ? Number(metadata.pipSize)
    : String(pair || '')
        .toUpperCase()
        .endsWith('JPY')
      ? 0.01
      : 0.0001;

  if (!Number.isFinite(pipSize) || pipSize <= 0) {
    return 0;
  }

  return Number((priceDiff / pipSize).toFixed(3));
}

export const dataQualityGuard = {
  resolveAutoReenableConfig() {
    const raw = this?.config?.dataQualityGuard || {};
    return {
      enabled:
        typeof raw.autoReenable === 'boolean' ? raw.autoReenable : AUTO_REENABLE_DEFAULTS.enabled,
      minScore: Number.isFinite(raw.autoReenableMinScore)
        ? raw.autoReenableMinScore
        : AUTO_REENABLE_DEFAULTS.minScore,
      minHealthyCount: Number.isFinite(raw.autoReenableMinHealthyCount)
        ? raw.autoReenableMinHealthyCount
        : AUTO_REENABLE_DEFAULTS.minHealthyCount,
      windowMs: Number.isFinite(raw.autoReenableWindowMs)
        ? raw.autoReenableWindowMs
        : AUTO_REENABLE_DEFAULTS.windowMs
    };
  },

  async assessMarketData(pair, options = {}) {
    if (!this.priceDataFetcher) {
      return null;
    }

    const assessedAt = Date.now();
    const relaxForSynthetic =
      options?.relaxForSynthetic !== undefined
        ? Boolean(options.relaxForSynthetic)
        : allowSyntheticData();
    const timeframes =
      Array.isArray(options.timeframes) && options.timeframes.length > 0
        ? Array.from(new Set(options.timeframes.map(normalizeTimeframe)))
        : ['M15', 'H1', 'H4'];

    const bars = Number.isInteger(options.bars) && options.bars > 10 ? options.bars : 240;
    const timeframeReports = {};
    let issues = [];
    const suppressedIssues = [];
    let aggregateScore = 0;
    let assessedCount = 0;

    const activeBreaker = this.getPairCircuitBreaker?.(pair) || null;
    if (activeBreaker && activeBreaker.expiresAt <= assessedAt) {
      this.clearPairCircuitBreaker?.(pair);
    }

    let spreadSnapshot = null;
    if (typeof this.priceDataFetcher.getBidAskSnapshot === 'function') {
      try {
        spreadSnapshot = await this.priceDataFetcher.getBidAskSnapshot(pair, { cacheTtlMs: 7000 });
      } catch (error) {
        console.error('Spread snapshot failed:', error.message);
      }
    }

    let worstWeekendGapSeverity = 'none';
    let maxWeekendGapPips = 0;

    for (const timeframe of timeframes) {
      try {
        const priceBars = await this.priceDataFetcher.fetchPriceData(pair, timeframe, bars, {
          purpose: 'quality-check'
        });
        const report = await this.evaluateTimeframeQuality(pair, priceBars, timeframe, {
          relaxForSynthetic
        });
        timeframeReports[timeframe] = report;
        aggregateScore += report.score;
        assessedCount++;
        if (relaxForSynthetic && Array.isArray(report.suppressedIssues)) {
          report.suppressedIssues
            .filter(Boolean)
            .forEach((issue) => suppressedIssues.push(`${timeframe}:${issue}`));
        }
        if (Array.isArray(report.issues) && report.issues.length > 0) {
          report.issues.forEach((issue) => issues.push(`${timeframe}:${issue}`));
        }

        if (report.weekendGap && report.weekendGap.severity) {
          const currentSeverity = report.weekendGap.severity;
          if (currentSeverity === 'critical') {
            worstWeekendGapSeverity = 'critical';
          } else if (currentSeverity === 'elevated' && worstWeekendGapSeverity !== 'critical') {
            worstWeekendGapSeverity = 'elevated';
          }
          if (
            Number.isFinite(report.weekendGap.pips) &&
            report.weekendGap.pips > maxWeekendGapPips
          ) {
            maxWeekendGapPips = report.weekendGap.pips;
          }
        }
      } catch (error) {
        timeframeReports[timeframe] = {
          timeframe,
          score: 40,
          barsEvaluated: 0,
          issues: ['fetch_failed'],
          error: error.message
        };
        aggregateScore += 40;
        assessedCount++;
        issues.push(`${timeframe}:fetch_failed`);
        console.error(`Data quality assessment failed for ${pair} ${timeframe}:`, error.message);
      }
    }

    const score = assessedCount > 0 ? Number((aggregateScore / assessedCount).toFixed(1)) : 0;

    const spreadThresholds = getSpreadThresholds(pair);
    let spreadStatus = 'unknown';
    let spreadPenalty = 0;
    let spreadPips = null;
    if (spreadSnapshot && Number.isFinite(spreadSnapshot.spreadPips)) {
      spreadPips = Number(spreadSnapshot.spreadPips.toFixed(3));
      if (spreadThresholds && Number.isFinite(spreadThresholds.block)) {
        if (spreadPips >= spreadThresholds.block) {
          spreadStatus = 'critical';
          spreadPenalty = 18;
          issues.push('spread:critical');
        } else if (spreadPips >= spreadThresholds.warn) {
          spreadStatus = 'elevated';
          spreadPenalty = 8;
          issues.push('spread:elevated');
        } else {
          spreadStatus = 'normal';
        }
      } else {
        spreadStatus = 'normal';
      }
    }

    let adjustedScore = Math.max(0, Number((score - spreadPenalty).toFixed(1)));
    if (relaxForSynthetic && spreadStatus !== 'critical' && adjustedScore < 82) {
      adjustedScore = Math.min(95, adjustedScore + 8);
    }

    let status = 'healthy';
    if (
      adjustedScore < 60 ||
      issues.some((issue) => issue.includes('stale') || issue.includes('gap_rate_high')) ||
      spreadStatus === 'critical' ||
      worstWeekendGapSeverity === 'critical'
    ) {
      status = 'critical';
    } else if (
      adjustedScore < 80 ||
      issues.length > 0 ||
      spreadStatus === 'elevated' ||
      worstWeekendGapSeverity === 'elevated'
    ) {
      status = 'degraded';
    }

    if (relaxForSynthetic && status === 'critical' && spreadStatus !== 'critical') {
      status = 'degraded';
    }

    let recommendation =
      status === 'critical' ? 'block' : status === 'degraded' ? 'caution' : 'proceed';
    if (relaxForSynthetic) {
      recommendation =
        recommendation === 'block'
          ? 'caution'
          : recommendation === 'caution'
            ? 'monitor'
            : recommendation;
    }

    issues = issues.filter(Boolean);

    const report = {
      pair,
      assessedAt,
      score: adjustedScore,
      status,
      recommendation,
      issues,
      timeframeReports,
      spread: {
        status: spreadStatus,
        pips: spreadPips,
        provider: spreadSnapshot?.provider || null,
        timestamp: spreadSnapshot?.timestamp || null
      },
      weekendGap: {
        severity: worstWeekendGapSeverity,
        maxPips: maxWeekendGapPips
      },
      syntheticRelaxed: relaxForSynthetic,
      syntheticContext: relaxForSynthetic
        ? {
            suppressedIssues,
            notes: spreadStatus === 'critical' ? ['spread_status_critical'] : []
          }
        : null
    };

    if (!this.dataQualityAssessments) {
      this.dataQualityAssessments = new Map();
    }
    this.dataQualityAssessments.set(pair, report);

    let confidenceFloor = null;
    if (spreadStatus === 'critical') {
      confidenceFloor = 65;
    } else if (spreadStatus === 'elevated') {
      confidenceFloor = 55;
    }
    if (worstWeekendGapSeverity === 'critical') {
      confidenceFloor = Math.max(confidenceFloor ?? 0, 62);
    } else if (worstWeekendGapSeverity === 'elevated') {
      confidenceFloor = Math.max(confidenceFloor ?? 0, 52);
    }
    if (status === 'critical') {
      confidenceFloor = Math.max(confidenceFloor ?? 0, 60);
    } else if (status === 'degraded') {
      confidenceFloor = Math.max(confidenceFloor ?? 0, 50);
    }
    if (confidenceFloor != null) {
      report.confidenceFloor = confidenceFloor;
    }

    if (relaxForSynthetic) {
      delete report.confidenceFloor;
    }

    if (
      !relaxForSynthetic &&
      ((status === 'critical' && adjustedScore < 55) ||
        spreadStatus === 'critical' ||
        worstWeekendGapSeverity === 'critical')
    ) {
      const breakerEntry = this.activatePairCircuitBreaker?.(pair, {
        reason:
          spreadStatus === 'critical'
            ? 'wide_spread'
            : worstWeekendGapSeverity === 'critical'
              ? 'weekend_gap'
              : 'quality_score',
        score: adjustedScore,
        spreadPips,
        weekendGapPips: maxWeekendGapPips
      });
      this.config?.auditLogger?.record?.('data_quality.circuit_breaker.activated', {
        pair,
        reason: breakerEntry?.reason || null,
        score: adjustedScore,
        spreadPips,
        weekendGapPips: maxWeekendGapPips,
        expiresAt: breakerEntry?.expiresAt || null
      });
      report.recommendation = 'block';
      if (!issues.includes('pair:circuit_breaker_triggered')) {
        issues.push('pair:circuit_breaker_triggered');
      }
    }

    let breakerAfter = this.getPairCircuitBreaker?.(pair) || activeBreaker;

    const reenableConfig = this.resolveAutoReenableConfig();
    const streak = this.updatePairQualityStreak(pair, {
      assessedAt,
      status,
      score: adjustedScore
    });

    if (
      breakerAfter &&
      !relaxForSynthetic &&
      reenableConfig.enabled &&
      status === 'healthy' &&
      adjustedScore >= reenableConfig.minScore &&
      streak?.healthyCount >= reenableConfig.minHealthyCount &&
      assessedAt - (streak.healthySince || assessedAt) <= reenableConfig.windowMs
    ) {
      this.clearPairCircuitBreaker?.(pair);
      breakerAfter = null;
      report.circuitBreakerCleared = {
        at: assessedAt,
        reason: 'auto_reenable',
        healthyCount: streak.healthyCount,
        healthySince: streak.healthySince
      };
      this.config?.auditLogger?.record?.('data_quality.circuit_breaker.cleared', {
        pair,
        reason: 'auto_reenable',
        healthyCount: streak.healthyCount,
        healthySince: streak.healthySince,
        score: adjustedScore
      });
    }

    if (breakerAfter && !relaxForSynthetic) {
      report.circuitBreaker = breakerAfter;
      report.recommendation = 'block';
      if (!issues.includes('pair:circuit_breaker_active')) {
        issues.push('pair:circuit_breaker_active');
      }
    }

    if (this.persistence && typeof this.persistence.recordDataQualityMetric === 'function') {
      try {
        await this.persistence.recordDataQualityMetric({
          pair,
          assessedAt: new Date(assessedAt),
          score: report.score,
          status,
          recommendation,
          issues,
          timeframeReports
        });
      } catch (error) {
        console.error('Failed to persist data quality metric:', error.message);
      }
    }

    return report;
  },

  async evaluateTimeframeQuality(pair, bars, timeframe, options = {}) {
    const normalizedTf = normalizeTimeframe(timeframe);
    const relaxForSynthetic = options.relaxForSynthetic === true;
    const expectedSeconds = timeframeToSeconds(normalizedTf);
    const expectedIntervalMs = expectedSeconds * 1000;
    const report = {
      timeframe: normalizedTf,
      barsEvaluated: Array.isArray(bars) ? bars.length : 0,
      spikeCount: 0,
      maxSpikePct: 0,
      gapCount: 0,
      gapRate: 0,
      timezoneMisalignMs: 0,
      stale: false,
      sanityIssues: [],
      issues: [],
      score: 100,
      avgIntervalMs: 0,
      latestTimestamp: null,
      weekendGap: {
        detected: false,
        pips: 0,
        severity: 'none'
      },
      suppressedIssues: []
    };

    if (!Array.isArray(bars) || bars.length < 5) {
      report.score = 45;
      report.issues.push('insufficient_bars');
      return report;
    }

    let lastTimestamp = null;
    let totalDelta = 0;
    let misalignmentCount = 0;
    let minPrice = Number.POSITIVE_INFINITY;
    let maxPrice = 0;

    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1];
      const curr = bars[i];
      const prevClose = Number(prev?.close);
      const currClose = Number(curr?.close);

      if (Number.isFinite(prevClose) && Number.isFinite(currClose)) {
        const pctMove = calculatePercentChange(prevClose, currClose);
        if (pctMove > report.maxSpikePct) {
          report.maxSpikePct = Number(pctMove.toFixed(3));
        }
        if (pctMove > spikeThreshold(normalizedTf)) {
          report.spikeCount++;
        }
        if (currClose > maxPrice) {
          maxPrice = currClose;
        }
        if (currClose < minPrice) {
          minPrice = currClose;
        }
      }

      const prevTs = Number(prev?.timestamp ?? prev?.time ?? prev?.datetime ?? prev?.date);
      const currTs = Number(curr?.timestamp ?? curr?.time ?? curr?.datetime ?? curr?.date);
      if (Number.isFinite(prevTs) && Number.isFinite(currTs)) {
        const delta = currTs - prevTs;
        if (delta > expectedIntervalMs * 1.75) {
          report.gapCount++;
        }
        const misalignment = Math.abs(delta - expectedIntervalMs);
        if (misalignment > expectedIntervalMs * 0.2) {
          misalignmentCount++;
          report.timezoneMisalignMs = Math.max(report.timezoneMisalignMs, misalignment);
        }
        totalDelta += delta;
        lastTimestamp = currTs;

        const isWeekendGap =
          delta >= expectedIntervalMs * 6 && this.isLikelyWeekend?.(prevTs, currTs);
        if (isWeekendGap) {
          const prevClosePrice = Number(prev?.close);
          const nextOpenPrice = Number(curr?.open ?? curr?.close);
          const gapPrice =
            Number.isFinite(prevClosePrice) && Number.isFinite(nextOpenPrice)
              ? nextOpenPrice - prevClosePrice
              : null;
          const gapPips = priceToPips(pair, Math.abs(gapPrice ?? 0));
          if (gapPips > report.weekendGap.pips) {
            report.weekendGap.detected = true;
            report.weekendGap.pips = gapPips;
            report.weekendGap.severity =
              gapPips >= 20 ? 'critical' : gapPips >= 10 ? 'elevated' : 'minor';
          }
        }
      }
    }

    report.gapRate = Number((report.gapCount / report.barsEvaluated).toFixed(4));
    if (report.barsEvaluated > 1) {
      const average = totalDelta / (report.barsEvaluated - 1);
      report.avgIntervalMs = Number.isFinite(average) ? Number(average.toFixed(2)) : 0;
    }
    if (Number.isFinite(lastTimestamp)) {
      report.latestTimestamp = lastTimestamp;
    }

    const lastBar = bars[bars.length - 1];
    const lastTs = Number(
      lastBar?.timestamp ?? lastBar?.time ?? lastBar?.datetime ?? lastBar?.date
    );
    if (Number.isFinite(lastTs)) {
      const freshnessMs = Date.now() - lastTs;
      if (freshnessMs > expectedIntervalMs * 3) {
        report.stale = true;
        report.issues.push('stale_bars');
      }
    }

    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice <= 0) {
      report.sanityIssues.push('invalid_price_range');
    } else {
      if (minPrice < 0.00005) {
        report.sanityIssues.push('price_too_low');
      }
      if (maxPrice > 1200) {
        report.sanityIssues.push('price_too_high');
      }
    }

    if (relaxForSynthetic && report.weekendGap.detected) {
      report.suppressedIssues.push('weekend_gap_adjusted');
      if (report.weekendGap.severity === 'critical') {
        report.weekendGap.severity = 'elevated';
      } else if (report.weekendGap.severity === 'elevated') {
        report.weekendGap.severity = 'minor';
      }
    }

    const spikePenalty = Math.min(report.spikeCount * 4, 35);
    const gapPenaltyBase = Math.min(report.gapCount * 5, 40);
    const gapPenalty = relaxForSynthetic ? Math.round(gapPenaltyBase * 0.35) : gapPenaltyBase;
    const misalignPenaltyBase = misalignmentCount > 0 ? Math.min(misalignmentCount * 3, 15) : 0;
    const misalignPenalty = relaxForSynthetic
      ? Math.round(misalignPenaltyBase * 0.3)
      : misalignPenaltyBase;
    const stalePenalty = report.stale ? (relaxForSynthetic ? 8 : 20) : 0;
    const sanityPenalty = report.sanityIssues.length > 0 ? 15 : 0;

    let score = 100 - spikePenalty - gapPenalty - misalignPenalty - stalePenalty - sanityPenalty;
    if (score < 0) {
      score = 0;
    }
    report.score = Number(score.toFixed(1));

    if (report.spikeCount > 0) {
      report.issues.push('spike_detected');
    }
    if (report.gapCount > 0) {
      report.issues.push(report.gapRate > 0.05 ? 'gap_rate_high' : 'gap_detected');
    }
    if (misalignmentCount > 0) {
      report.issues.push('timezone_misalignment');
    }
    if (report.sanityIssues.length > 0) {
      report.issues.push('sanity_check_failed');
    }
    if (report.weekendGap.detected) {
      report.issues.push(
        report.weekendGap.severity === 'critical' ? 'weekend_gap_extreme' : 'weekend_gap'
      );
    }

    return report;
  },
  isLikelyWeekend(prevTs, currTs) {
    if (!Number.isFinite(prevTs) || !Number.isFinite(currTs)) {
      return false;
    }
    const diffHours = (currTs - prevTs) / 3600000;
    if (diffHours >= 36) {
      return true;
    }
    const prevDay = new Date(prevTs).getUTCDay();
    const currDay = new Date(currTs).getUTCDay();
    if (prevDay === 5 && (currDay === 6 || currDay === 0 || currDay === 1)) {
      return true;
    }
    if (prevDay === 6 && (currDay === 0 || currDay === 1)) {
      return true;
    }
    return false;
  },

  ensurePairCircuitBreakerMap() {
    if (!this.marketDataCircuitBreakers) {
      this.marketDataCircuitBreakers = new Map();
    }
    return this.marketDataCircuitBreakers;
  },

  ensurePairQualityStreakMap() {
    if (!this.marketDataQualityStreaks) {
      this.marketDataQualityStreaks = new Map();
    }
    return this.marketDataQualityStreaks;
  },

  updatePairQualityStreak(pair, { assessedAt, status, score } = {}) {
    const map = this.ensurePairQualityStreakMap();
    const entry = map.get(pair) || {
      healthyCount: 0,
      healthySince: 0,
      lastAssessmentAt: 0,
      lastScore: null,
      lastStatus: null
    };

    const isHealthy = status === 'healthy' && Number.isFinite(score);
    if (isHealthy) {
      if (entry.healthyCount === 0) {
        entry.healthySince = assessedAt;
      }
      entry.healthyCount += 1;
    } else {
      entry.healthyCount = 0;
      entry.healthySince = 0;
    }

    entry.lastAssessmentAt = assessedAt;
    entry.lastScore = Number.isFinite(score) ? score : null;
    entry.lastStatus = status || null;
    map.set(pair, entry);
    return entry;
  },

  getPairCircuitBreaker(pair) {
    const map = this.ensurePairCircuitBreakerMap();
    const entry = map.get(pair);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      map.delete(pair);
      return null;
    }
    return entry;
  },

  clearPairCircuitBreaker(pair) {
    const map = this.ensurePairCircuitBreakerMap();
    map.delete(pair);
  },

  activatePairCircuitBreaker(pair, details = {}) {
    const map = this.ensurePairCircuitBreakerMap();
    const now = Date.now();
    const durationMs = Number.isFinite(details.durationMs)
      ? Math.max(details.durationMs, 120000)
      : 10 * 60 * 1000;
    const entry = {
      reason: details.reason || 'market_data_quality',
      activatedAt: now,
      expiresAt: now + durationMs,
      context: {
        score: details.score ?? null,
        spreadPips: details.spreadPips ?? null,
        weekendGapPips: details.weekendGapPips ?? null
      }
    };
    map.set(pair, entry);
    return entry;
  }
};
