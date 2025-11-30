export const riskEngine = {
  calculateRiskManagement(signal) {
    if (!signal.entry) {
      return null;
    }

    this.checkDailyReset();

    const { price, stopLoss } = signal.entry;
    if (price == null || stopLoss == null) {
      return null;
    }

    const riskDistance = Math.abs(price - stopLoss);
    if (riskDistance === 0) {
      return null;
    }

    const accountBalance = this.config.accountBalance;

    const kellyFraction = this.computeKellyFraction(signal);
    const volatilityAdjustment = this.getVolatilityAdjustment(signal);
    const correlationAdjustment = this.getCorrelationAdjustment(signal.pair, signal.direction);

    const guardrailMultiplier = Math.max(
      0.25,
      Math.min(1.4, volatilityAdjustment * correlationAdjustment)
    );
    let desiredRiskFraction = kellyFraction * guardrailMultiplier;
    desiredRiskFraction = Math.max(
      this.config.minKellyFraction,
      Math.min(desiredRiskFraction, this.config.maxKellyFraction)
    );

    const remainingDailyRisk = Math.max(0, this.config.maxDailyRisk - this.dailyRisk);
    const effectiveRiskFraction = Math.min(desiredRiskFraction, remainingDailyRisk);
    const canTrade =
      effectiveRiskFraction >= this.config.minKellyFraction &&
      remainingDailyRisk >= this.config.minKellyFraction;

    const riskAmount = accountBalance * effectiveRiskFraction;
    const positionSize = riskAmount / riskDistance;

    const exposures = this.calculateCurrencyExposures();
    const exposurePreview = this.previewExposure(
      exposures,
      signal.pair,
      signal.direction,
      positionSize
    );
    const exposureBreached = exposurePreview.breaches.length > 0;
    const currencyLimitResult = this.evaluateCurrencyLimitBreaches
      ? this.evaluateCurrencyLimitBreaches(exposurePreview.current)
      : { allowed: true, breaches: [] };
    const correlationGuard = this.evaluateCorrelationConstraint
      ? this.evaluateCorrelationConstraint(signal.pair, signal.direction)
      : { allowed: true, correlated: [] };
    const valueAtRiskGuard = this.evaluateValueAtRiskGuard
      ? this.evaluateValueAtRiskGuard()
      : { allowed: true };

    if (typeof this.monitorExposure === 'function') {
      this.monitorExposure(signal.pair, exposurePreview);
    }

    const stressTests = this.buildStressTests(signal, positionSize, riskDistance, accountBalance);

    const postTradeDailyRisk = Math.max(0, remainingDailyRisk - effectiveRiskFraction);

    const currencyLimitBreached =
      Array.isArray(currencyLimitResult.breaches) && currencyLimitResult.breaches.length > 0;
    const correlationBlocked = correlationGuard.allowed === false;
    const varBlocked = valueAtRiskGuard.allowed === false;

    return {
      positionSize: Number(positionSize.toFixed(2)),
      riskAmount: Number(riskAmount.toFixed(2)),
      riskFraction: Number(effectiveRiskFraction.toFixed(4)),
      desiredRiskFraction: Number(desiredRiskFraction.toFixed(4)),
      priceRiskPct: Number(((riskDistance / price) * 100).toFixed(2)),
      riskPercentage: Number(((riskDistance / price) * 100).toFixed(2)),
      riskPerTradePct: Number((effectiveRiskFraction * 100).toFixed(2)),
      dailyRiskUsedPct: Number((this.dailyRisk * 100).toFixed(2)),
      remainingDailyRiskPct: Number((postTradeDailyRisk * 100).toFixed(2)),
      dailyRiskUsed: Number(this.dailyRisk.toFixed(4)),
      remainingDailyRisk: Number(remainingDailyRisk.toFixed(4)),
      maxPositionSize: Number(((accountBalance * remainingDailyRisk) / riskDistance).toFixed(2)),
      guardrails: {
        kellyFraction: Number(kellyFraction.toFixed(4)),
        volatilityAdjustment: Number(volatilityAdjustment.toFixed(3)),
        correlationAdjustment: Number(correlationAdjustment.toFixed(3)),
        guardrailMultiplier: Number(guardrailMultiplier.toFixed(3)),
        exposureBreached,
        currencyLimitBreaches: currencyLimitResult.breaches || [],
        correlationBreaches: correlationGuard.correlated || [],
        correlationBlocked,
        valueAtRisk: valueAtRiskGuard,
        correlations: Array.from(this.activeTrades.values()).map((trade) => ({
          id: trade.id,
          pair: trade.pair,
          direction: trade.direction,
          positionSize: trade.positionSize
        }))
      },
      portfolioExposure: {
        current: exposures,
        preview: exposurePreview.current,
        limit: this.config.maxExposurePerCurrency,
        breaches: exposurePreview.breaches,
        currencyLimitBreaches: currencyLimitResult.breaches || []
      },
      stressTests,
      riskCommand: {
        currencyLimitResult,
        correlationGuard,
        valueAtRiskGuard
      },
      canTrade:
        canTrade &&
        !exposureBreached &&
        !currencyLimitBreached &&
        !correlationBlocked &&
        !varBlocked
    };
  },

  computeKellyFraction(signal) {
    const winRate = Math.min(Math.max((signal.estimatedWinRate ?? 75) / 100, 0.05), 0.99);
    const reward = Math.max(signal.entry?.riskReward ?? 1.6, 1.2);
    const edge = winRate * (reward + 1) - 1;
    const rawKelly = edge / reward;
    const adjustedKelly = rawKelly > 0 ? rawKelly : this.config.minKellyFraction * 0.6;
    const blended = adjustedKelly * 0.6 + this.config.riskPerTrade * 0.4;
    return Math.max(
      this.config.minKellyFraction,
      Math.min(blended, this.config.maxKellyFraction * 1.1)
    );
  },

  getVolatilityAdjustment(signal) {
    const technical = signal.components?.technical || {};
    const volatility = technical.volatility || technical.volatilitySummary || {};
    const state = (signal.entry?.volatilityState || volatility.state || 'normal').toLowerCase();
    const multipliers = this.config.volatilityRiskMultipliers || {};
    const base = multipliers[state] ?? multipliers.normal ?? 1;
    const score = Number.isFinite(volatility.averageScore)
      ? volatility.averageScore
      : (volatility.volatilityScore ?? 80);
    const scoreFactor = Math.max(0.55, Math.min(1.25, 1.1 - (score - 60) / 220));
    return Math.max(0.3, Math.min(1.4, base * scoreFactor));
  },

  getCorrelationAdjustment(pair, direction) {
    if (!this.activeTrades || this.activeTrades.size === 0) {
      return 1;
    }

    const [base, quote] = this.splitPair(pair);
    let adjustment = 1;

    for (const trade of this.activeTrades.values()) {
      const [tBase, tQuote] = this.splitPair(trade.pair);
      const samePair = trade.pair === pair;
      const sharesCurrency =
        tBase === base || tBase === quote || tQuote === base || tQuote === quote;

      if (samePair) {
        adjustment *= this.config.correlationPenalty.samePair;
      } else if (sharesCurrency) {
        adjustment *= this.config.correlationPenalty.sharedCurrency;
        if (trade.direction !== direction) {
          adjustment *= 1.05;
        }
      }
    }

    return Math.max(0.3, Math.min(1, adjustment));
  },

  calculateCurrencyExposures() {
    const exposures = {};
    for (const trade of this.activeTrades.values()) {
      const [base, quote] = this.splitPair(trade.pair);
      const dir = trade.direction === 'BUY' ? 1 : -1;
      const size = trade.positionSize ?? 0;
      exposures[base] = (exposures[base] || 0) + dir * size;
      exposures[quote] = (exposures[quote] || 0) - dir * size;
    }
    return Object.fromEntries(
      Object.entries(exposures).map(([currency, exposure]) => [
        currency,
        Number(exposure.toFixed(2))
      ])
    );
  },

  previewExposure(exposures, pair, direction, positionSize) {
    const snapshot = { ...exposures };
    const [base, quote] = this.splitPair(pair);
    const dir = direction === 'BUY' ? 1 : -1;
    snapshot[base] = (snapshot[base] || 0) + dir * positionSize;
    snapshot[quote] = (snapshot[quote] || 0) - dir * positionSize;

    const roundedSnapshot = Object.fromEntries(
      Object.entries(snapshot).map(([currency, exposure]) => [
        currency,
        Number(exposure.toFixed(2))
      ])
    );

    const breaches = Object.entries(snapshot)
      .filter(([, value]) => Math.abs(value) > this.config.maxExposurePerCurrency)
      .map(([currency, exposure]) => ({ currency, exposure: Number(exposure.toFixed(2)) }));

    return { current: roundedSnapshot, breaches };
  },

  buildStressTests(signal, positionSize, riskDistance, accountBalance) {
    const atr = signal.entry?.atr && signal.entry.atr > 0 ? signal.entry.atr : riskDistance * 0.85;
    const pipValue = positionSize;

    const scenarios = [
      {
        scenario: 'atr_retrace',
        description: 'Price retraces by 1 ATR against the position',
        move: atr
      },
      {
        scenario: 'stop_gap_150',
        description: 'Gap against position equals 150% of stop distance',
        move: riskDistance * 1.5
      },
      {
        scenario: 'volatility_spike',
        description: 'Volatility spike pushes price 1.8 ATR beyond entry',
        move: atr * 1.8
      }
    ];

    return scenarios.map(({ scenario, description, move }) => {
      const loss = move * pipValue;
      return {
        scenario,
        description,
        adverseMove: Number(move.toFixed(5)),
        equityImpact: Number((-loss).toFixed(2)),
        equityImpactPct: Number(((-loss / accountBalance) * 100).toFixed(2))
      };
    });
  },

  checkDailyReset() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyRisk = 0;
      this.lastResetDate = today;
    }
  },

  evaluateCurrencyLimitBreaches(exposuresSnapshot = {}) {
    const riskCenter = this.config.riskCommandCenter || {};
    const currencyLimits = riskCenter.currencyLimits || null;
    const parsedDefault = Number(riskCenter.defaultCurrencyLimit);
    const defaultLimit = Number.isFinite(parsedDefault)
      ? Math.abs(parsedDefault)
      : this.config.maxExposurePerCurrency;
    const breaches = [];
    let allowed = true;

    Object.entries(exposuresSnapshot || {}).forEach(([currency, exposure]) => {
      const numericExposure = Number(exposure) || 0;
      const rawLimit = currencyLimits ? currencyLimits[currency] : undefined;
      const parsedLimit = Number(rawLimit);
      const configuredLimit = Number.isFinite(parsedLimit) ? Math.abs(parsedLimit) : defaultLimit;
      if (!Number.isFinite(configuredLimit) || configuredLimit <= 0) {
        return;
      }
      if (Math.abs(numericExposure) > configuredLimit) {
        allowed = false;
        breaches.push({
          currency,
          exposure: Number(numericExposure.toFixed(2)),
          limit: configuredLimit
        });
      }
    });

    return {
      allowed,
      breaches
    };
  },

  evaluateCorrelationConstraint(pair, direction) {
    const correlationConfig = this.config.riskCommandCenter?.correlation;
    if (!correlationConfig || correlationConfig.enabled === false) {
      return {
        allowed: true,
        correlated: []
      };
    }

    const threshold = correlationConfig.threshold ?? 0.8;
    const maxCluster = correlationConfig.maxClusterSize ?? 3;
    const correlated = [];

    if (!this.activeTrades || this.activeTrades.size === 0) {
      return { allowed: true, correlated };
    }

    for (const trade of this.activeTrades.values()) {
      const score = this.getPairCorrelationScore
        ? this.getPairCorrelationScore(pair, trade.pair)
        : 0;
      if (!Number.isFinite(score) || score < threshold) {
        continue;
      }
      correlated.push({
        tradeId: trade.id,
        pair: trade.pair,
        correlation: Number(score.toFixed(3)),
        direction: trade.direction
      });
    }

    return {
      allowed: correlated.length < maxCluster,
      correlated,
      clusterSize: correlated.length,
      threshold,
      maxCluster,
      direction
    };
  },

  evaluateValueAtRiskGuard() {
    const varConfig = this.config.riskCommandCenter?.valueAtRisk;
    if (!varConfig || varConfig.enabled === false) {
      return { allowed: true, ready: false };
    }
    const snapshot = this.riskCommandMetrics?.var;
    if (!snapshot || snapshot.ready === false) {
      return { allowed: true, ready: false };
    }
    const limitPct = Number.isFinite(snapshot.limitPct) ? snapshot.limitPct : varConfig.maxLossPct;
    const valuePct = Number.isFinite(snapshot.valuePct) ? Math.abs(snapshot.valuePct) : 0;
    if (!Number.isFinite(limitPct) || limitPct <= 0) {
      return {
        allowed: true,
        ready: snapshot.ready,
        valuePct,
        limitPct
      };
    }
    const breach = valuePct > limitPct;
    return {
      allowed: !breach,
      ready: true,
      breach,
      valuePct,
      limitPct,
      confidence: snapshot.confidence ?? varConfig.confidence
    };
  }
};
