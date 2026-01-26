import { getPairMetadata } from '../../config/pair-catalog.js';

const DEFAULTS = {
  minWinRate: 62,
  minRiskReward: 1.6,
  minConfidence: 55,
  minStrength: 30,
  minDataQualityScore: 70,
  maxSpreadPipsFx: 4.2,
  maxSpreadPipsMetals: 6,
  maxSpreadPipsCrypto: 25,
  maxSpreadRelative: 0.003,
  maxNewsImpact: 70
};

const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

const resolveBoolean = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return false;
  }
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};

export class AdvancedSignalFilter {
  constructor(options = {}) {
    this.options = {
      ...DEFAULTS,
      ...(options || {})
    };
  }

  resolveThresholds({ assetClass, marketData }) {
    const maxSpreadPips = Number.isFinite(Number(marketData?.maxSpreadPips))
      ? Number(marketData.maxSpreadPips)
      : assetClass === 'crypto'
        ? this.options.maxSpreadPipsCrypto
        : assetClass === 'metals'
          ? this.options.maxSpreadPipsMetals
          : this.options.maxSpreadPipsFx;

    const maxSpreadRelative = Number.isFinite(Number(marketData?.maxSpreadRelative))
      ? Number(marketData.maxSpreadRelative)
      : this.options.maxSpreadRelative;

    return {
      maxSpreadPips,
      maxSpreadRelative,
      minWinRate: this.options.minWinRate,
      minRiskReward: this.options.minRiskReward,
      minConfidence: this.options.minConfidence,
      minStrength: this.options.minStrength,
      minDataQualityScore: this.options.minDataQualityScore,
      maxNewsImpact: this.options.maxNewsImpact
    };
  }

  async filterSignal(signal, pair, marketData = {}) {
    const reasons = [];
    const metadata = getPairMetadata(pair);
    const assetClass = metadata?.assetClass || null;
    const thresholds = this.resolveThresholds({ assetClass, marketData });

    const strength = toNumber(signal?.strength) ?? 0;
    const confidence = toNumber(signal?.confidence) ?? 0;
    const winRate = toNumber(signal?.estimatedWinRate) ?? 0;
    const riskReward = toNumber(signal?.entry?.riskReward);

    if (winRate < thresholds.minWinRate) {
      reasons.push(`win_rate_below_${thresholds.minWinRate}`);
    }

    if (riskReward != null && riskReward < thresholds.minRiskReward) {
      reasons.push(`risk_reward_below_${thresholds.minRiskReward}`);
    }

    if (confidence < thresholds.minConfidence) {
      reasons.push(`confidence_below_${thresholds.minConfidence}`);
    }

    if (strength < thresholds.minStrength) {
      reasons.push(`strength_below_${thresholds.minStrength}`);
    }

    const spreadPips = toNumber(marketData?.spreadPips);
    const bid = toNumber(marketData?.eaQuote?.bid);
    const ask = toNumber(marketData?.eaQuote?.ask);
    const mid = Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
    const spreadRelative = Number.isFinite(mid) && mid > 0 && Number.isFinite(bid) && Number.isFinite(ask)
      ? Math.abs(ask - bid) / mid
      : null;

    const isFxLike = assetClass === 'forex' || assetClass === 'metals' || assetClass === 'crypto';
    if (isFxLike) {
      if (spreadPips != null && spreadPips > thresholds.maxSpreadPips) {
        reasons.push('spread_too_wide');
      }
    } else if (spreadRelative != null && spreadRelative > thresholds.maxSpreadRelative) {
      reasons.push('spread_relative_too_wide');
    }

    const dqScore = toNumber(marketData?.score);
    if (dqScore != null && dqScore < thresholds.minDataQualityScore) {
      reasons.push(`data_quality_below_${thresholds.minDataQualityScore}`);
    }

    const dqStatus = String(marketData?.status || '').toLowerCase();
    const dqRecommendation = String(marketData?.recommendation || '').toLowerCase();
    if (marketData?.circuitBreaker || dqRecommendation === 'block' || dqStatus === 'critical') {
      reasons.push('data_quality_blocked');
    }

    if (marketData?.stale === true) {
      reasons.push('market_data_stale');
    }

    const newsImpact = toNumber(signal?.components?.news?.impact) ?? 0;
    const upcomingEvents = toNumber(signal?.components?.news?.upcomingEvents) ?? 0;
    if (newsImpact >= thresholds.maxNewsImpact && upcomingEvents > 0) {
      reasons.push('high_impact_news_near');
    }

    const enabled = resolveBoolean(process.env.ADVANCED_SIGNAL_FILTER_ENABLED);

    return {
      passed: enabled ? reasons.length === 0 : true,
      reasons,
      metrics: {
        strength,
        confidence,
        winRate,
        riskReward,
        spreadPips,
        spreadRelative,
        dataQualityScore: dqScore,
        dataQualityStatus: dqStatus || null,
        dataQualityRecommendation: dqRecommendation || null,
        newsImpact,
        upcomingEvents,
        assetClass
      }
    };
  }
}
