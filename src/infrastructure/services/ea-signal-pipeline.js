import { buildLayeredAnalysis } from '../../core/analyzers/layered-analysis.js';
import { getPairMetadata } from '../../config/pair-catalog.js';

const toNumberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const getBarsCoverage = ({ eaBridgeService, broker, symbol, now } = {}) => {
  if (!eaBridgeService || typeof eaBridgeService.getMarketBars !== 'function') {
    return null;
  }
  const nowMs = toNumberOrNull(now) ?? Date.now();
  const timeframes = ['M1', 'M15', 'H1', 'H4', 'D1'];
  const coverage = {};

  for (const timeframe of timeframes) {
    try {
      const bars = eaBridgeService.getMarketBars({
        broker,
        symbol,
        timeframe,
        limit: 3,
        maxAgeMs: 0,
      });
      const list = Array.isArray(bars) ? bars : [];
      const latest = list[0] || null;
      const latestTime = toNumberOrNull(latest?.time ?? latest?.timestamp ?? latest?.t);
      const receivedAt = toNumberOrNull(latest?.receivedAt);

      coverage[timeframe] = {
        count: list.length,
        latestTime,
        receivedAt,
        ageMs: latestTime != null ? Math.max(0, nowMs - latestTime) : null,
        receivedAgeMs: receivedAt != null ? Math.max(0, nowMs - receivedAt) : null,
        source: latest?.source ?? null,
      };
    } catch (_error) {
      // best-effort
    }
  }

  return Object.keys(coverage).length ? coverage : null;
};

export const normalizeLayeredAnalysis = (layers) => ({
  layers: Array.isArray(layers) ? layers : [],
});

export const getBestEffortQuote = ({
  eaBridgeService,
  broker,
  symbol,
  quoteMaxAgeMs,
  barFallback,
  now,
} = {}) => {
  const nowMs = toNumberOrNull(now) ?? Date.now();

  try {
    const quotes = eaBridgeService?.getQuotes
      ? eaBridgeService.getQuotes({
          broker,
          symbols: [symbol],
          maxAgeMs: quoteMaxAgeMs,
        })
      : [];
    const quote = Array.isArray(quotes) && quotes.length ? quotes[0] : null;

    if (quote && typeof quote === 'object') {
      return { quote, source: 'quotes' };
    }

    if (barFallback && typeof barFallback === 'object') {
      return {
        quote: {
          symbol,
          last: barFallback.price,
          source: `ea.bars.${barFallback.timeframe}`,
          receivedAt: barFallback.timeMs || nowMs,
        },
        source: 'bars',
      };
    }

    return { quote: null, source: null };
  } catch (_error) {
    return { quote: null, source: null };
  }
};

export const buildScenarioForLayeredAnalysis = ({
  rawSignal,
  symbol,
  effectiveQuote,
  barFallback,
  barsCoverage,
  now,
} = {}) => {
  const nowMs = toNumberOrNull(now) ?? Date.now();

  const receivedAt =
    effectiveQuote && typeof effectiveQuote === 'object'
      ? (effectiveQuote.receivedAt ?? effectiveQuote.timestamp ?? null)
      : null;

  const receivedAtMs = toNumberOrNull(receivedAt);
  const ageMs = receivedAtMs != null ? Math.max(0, nowMs - receivedAtMs) : null;

  const bid = effectiveQuote?.bid != null ? Number(effectiveQuote.bid) : null;
  const ask = effectiveQuote?.ask != null ? Number(effectiveQuote.ask) : null;
  const mid =
    effectiveQuote?.mid != null
      ? Number(effectiveQuote.mid)
      : Number.isFinite(bid) && Number.isFinite(ask)
        ? (bid + ask) / 2
        : effectiveQuote?.last != null
          ? Number(effectiveQuote.last)
          : null;
  const spread =
    Number.isFinite(bid) && Number.isFinite(ask) ? Number((ask - bid).toFixed(8)) : null;
  const spreadPct =
    spread != null && mid != null && mid !== 0 ? Number(((spread / mid) * 100).toFixed(6)) : null;

  const spreadPoints =
    effectiveQuote?.spreadPoints != null
      ? Number(effectiveQuote.spreadPoints)
      : spread != null && effectiveQuote?.point != null
        ? Number((spread / Number(effectiveQuote.point)).toFixed(2))
        : null;

  const liquidityHint = (() => {
    if (spreadPct == null && spreadPoints == null) {
      return null;
    }
    const wide =
      (spreadPct != null && spreadPct >= 0.15) || (spreadPoints != null && spreadPoints >= 60);
    return wide ? 'thin' : 'normal';
  })();

  const bar = barFallback && typeof barFallback === 'object' ? barFallback : null;
  const barClose = bar?.price != null ? Number(bar.price) : null;
  const barOpen = bar?.open != null ? Number(bar.open) : null;
  const barPrevClose = bar?.prevClose != null ? Number(bar.prevClose) : null;
  const barVolume = bar?.volume != null ? Number(bar.volume) : null;

  const gapToMid = mid != null && barClose != null ? Number((mid - barClose).toFixed(8)) : null;
  const gapOpen =
    barOpen != null && barPrevClose != null ? Number((barOpen - barPrevClose).toFixed(8)) : null;

  const telemetry =
    rawSignal?.components?.telemetry && typeof rawSignal.components.telemetry === 'object'
      ? rawSignal.components.telemetry
      : null;

  return {
    pair: rawSignal?.pair || symbol,
    primary: {
      direction: rawSignal?.direction,
      confidence: rawSignal?.confidence,
      finalScore: rawSignal?.finalScore,
    },
    intermarket:
      rawSignal?.components?.intermarket && typeof rawSignal.components.intermarket === 'object'
        ? rawSignal.components.intermarket
        : null,
    market: {
      quote:
        effectiveQuote && typeof effectiveQuote === 'object'
          ? {
              ...effectiveQuote,
              ageMs,
              bid,
              ask,
              mid,
              spread,
              spreadPct,
              spreadPoints,
              liquidityHint,
              volume: barVolume,
              gapToMid,
              gapOpen,
              midVelocityPerSec:
                telemetry?.quote?.midVelocityPerSec ?? telemetry?.quote?.velocityPerSec ?? null,
              midAccelerationPerSec2:
                telemetry?.quote?.midAccelerationPerSec2 ??
                telemetry?.quote?.accelerationPerSec2 ??
                null,
              midDelta: telemetry?.quote?.midDelta ?? null,
            }
          : { ageMs, pending: true },
      barsCoverage: barsCoverage && typeof barsCoverage === 'object' ? barsCoverage : null,
    },
    telemetry,
    factors: {
      economic: rawSignal?.components?.economic?.details || rawSignal?.components?.economic || null,
      news: rawSignal?.components?.news || null,
      technical: rawSignal?.components?.technical || null,
      candles: rawSignal?.components?.technical?.candlesSummary || null,
    },
    decision: {
      state: rawSignal?.isValid?.decision?.state || null,
      blocked: Boolean(rawSignal?.isValid?.decision?.blocked),
      score: rawSignal?.isValid?.decision?.score ?? null,
      reason: rawSignal?.isValid?.reason || null,
      checks: rawSignal?.isValid?.checks || null,
      isTradeValid: rawSignal?.isValid?.isValid === true,
      missing: rawSignal?.isValid?.decision?.missing || null,
      whatWouldChange: rawSignal?.isValid?.decision?.whatWouldChange || null,
    },
  };
};

export const attachLayeredAnalysisToSignal = ({
  rawSignal,
  broker,
  symbol,
  eaBridgeService,
  quoteMaxAgeMs,
  barFallback,
  now,
} = {}) => {
  if (!rawSignal || typeof rawSignal !== 'object') {
    return rawSignal;
  }

  try {
    const { quote: effectiveQuote } = getBestEffortQuote({
      eaBridgeService,
      broker,
      symbol,
      quoteMaxAgeMs,
      barFallback,
      now,
    });

    const barsCoverage = getBarsCoverage({ eaBridgeService, broker, symbol, now });

    const scenario = buildScenarioForLayeredAnalysis({
      rawSignal,
      symbol,
      effectiveQuote,
      barFallback,
      barsCoverage,
      now,
    });
    const layers = buildLayeredAnalysis({ scenario, signal: rawSignal });
    const normalizedLayers = normalizeLayeredAnalysis(layers);

    rawSignal.components =
      rawSignal.components && typeof rawSignal.components === 'object' ? rawSignal.components : {};

    rawSignal.components.layeredAnalysis = normalizedLayers;

    const layerList = Array.isArray(normalizedLayers?.layers) ? normalizedLayers.layers : [];
    const getLayer = (key) =>
      layerList.find((layer) => String(layer?.key || '').toUpperCase() === key) || null;
    const layer1 = getLayer('L1');
    const layer2 = getLayer('L2');
    const layer7 = getLayer('L7');
    const layer8 = getLayer('L8');
    const layer12 = getLayer('L12');
    const layer17 = getLayer('L17');
    const layer18 = getLayer('L18');

    const pair = rawSignal?.pair || symbol || null;
    const metadata = pair ? getPairMetadata(pair) : null;
    const cleanedPair = String(pair || '').toUpperCase();
    const fallbackBase = cleanedPair.length >= 6 ? cleanedPair.slice(0, 3) : null;
    const fallbackQuote = cleanedPair.length >= 6 ? cleanedPair.slice(3, 6) : null;

    rawSignal.components.pairContext = {
      pair: metadata?.pair || pair || null,
      base: metadata?.base || fallbackBase,
      quote: metadata?.quote || fallbackQuote,
      assetClass: metadata?.assetClass || null,
      displayName: metadata?.displayName || null,
      pipSize: metadata?.pipSize ?? null,
      pricePrecision: metadata?.pricePrecision ?? null,
      contractSize: metadata?.contractSize ?? null,
      sessions: metadata?.sessions ?? null,
      liquidityNotes: metadata?.liquidityNotes ?? null,
    };

    const generatedAt = toNumberOrNull(rawSignal?.generatedAt ?? now) ?? Date.now();
    const confluenceScore =
      Number(layer17?.metrics?.confluenceWeighting?.weightedScore ?? layer17?.confidence) || null;
    const decisionState =
      layer18?.metrics?.decision?.state || rawSignal?.isValid?.decision?.state || null;
    const spreadPoints = toNumberOrNull(layer1?.metrics?.spreadPoints);
    const newsImpact =
      toNumberOrNull(layer12?.metrics?.news?.impact ?? layer12?.metrics?.newsImpactScore) ??
      toNumberOrNull(layer12?.score);
    const entryContext = {
      generatedAt,
      direction: rawSignal?.direction || null,
      timeframe:
        layer2?.metrics?.timeframeFocus ||
        layer1?.metrics?.timeframeFocus ||
        rawSignal?.components?.technical?.timeframe ||
        null,
      marketPhase: layer2?.metrics?.marketPhase || null,
      volatilityState: layer7?.metrics?.volatility?.state || null,
      session: layer8?.metrics?.session || null,
      confluenceScore,
      decisionState,
      spreadPoints,
      newsImpact,
    };
    rawSignal.components.entryContext = entryContext;

    const phaseLabel = entryContext.marketPhase || 'current';
    const volLabel = entryContext.volatilityState || 'current';
    rawSignal.components.expectedMarketBehavior = {
      summary: `Maintain ${phaseLabel} phase with ${volLabel} volatility; monitor confluence and spreads.`,
      expectations: {
        marketPhase: entryContext.marketPhase,
        volatilityState: entryContext.volatilityState,
        confluenceScore,
        spreadPoints,
        newsImpact,
      },
    };

    const invalidationRules = [
      confluenceScore != null
        ? `Confluence drops below ${Math.max(40, Math.round(confluenceScore) - 15)}`
        : 'Confluence drops below threshold',
      entryContext.volatilityState
        ? `Volatility shifts out of ${entryContext.volatilityState} regime`
        : 'Volatility shock or regime change',
      spreadPoints != null
        ? `Spread spikes above ${Math.max(30, Math.round(spreadPoints * 1.5))} pts`
        : 'Spread spike beyond acceptable range',
      entryContext.session ? `Session changes away from ${entryContext.session}` : null,
      newsImpact != null
        ? `High news impact (>=${Math.max(3, Math.round(newsImpact) + 1)})`
        : 'High-impact news event detected',
    ].filter(Boolean);
    rawSignal.components.invalidationRules = invalidationRules;
  } catch (_error) {
    // best-effort
  }

  return rawSignal;
};

const evaluateStrongOverride = ({
  allowStrongOverride,
  signal,
  decisionStateFallback,
  gateOk = false,
} = {}) => {
  if (!allowStrongOverride || gateOk) {
    return { ok: false, reason: null };
  }
  const direction = String(signal?.direction || '').toUpperCase();
  if (direction !== 'BUY' && direction !== 'SELL') {
    return { ok: false, reason: 'direction_neutral' };
  }
  const decisionState = String(
    signal?.isValid?.decision?.state || decisionStateFallback || ''
  ).toUpperCase();
  if (decisionState !== 'ENTER') {
    return { ok: false, reason: 'decision_not_enter' };
  }
  if (signal?.isValid?.isValid !== true) {
    return { ok: false, reason: 'trade_invalid' };
  }
  const confidence = Number(signal?.confidence);
  const strength = Number(signal?.strength);
  if (!Number.isFinite(confidence) || !Number.isFinite(strength)) {
    return { ok: false, reason: 'missing_strength' };
  }
  const minConfidence = Number(process.env.EA_SIGNAL_STRONG_OVERRIDE_MIN_CONFIDENCE);
  const minStrength = Number(process.env.EA_SIGNAL_STRONG_OVERRIDE_MIN_STRENGTH);
  const confFloor = Number.isFinite(minConfidence) ? minConfidence : 85;
  const strengthFloor = Number.isFinite(minStrength) ? minStrength : 70;
  if (confidence < confFloor || strength < strengthFloor) {
    return { ok: false, reason: 'below_strong_floor' };
  }
  const entry = signal?.entry || {};
  const entryPrice = Number(entry?.price ?? signal?.entryPrice);
  const stopLoss = Number(entry?.stopLoss ?? signal?.stopLoss);
  const takeProfit = Number(entry?.takeProfit ?? signal?.takeProfit);
  if (!Number.isFinite(entryPrice) || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)) {
    return { ok: false, reason: 'missing_entry_levels' };
  }
  return { ok: true, reason: 'strong_override' };
};

export const evaluateLayers18Readiness = ({
  layeredAnalysis,
  minConfluence,
  decisionStateFallback,
  allowStrongOverride = false,
  signal,
} = {}) => {
  const min = Number.isFinite(Number(minConfluence)) ? Number(minConfluence) : 60;
  const layers = Array.isArray(layeredAnalysis?.layers) ? layeredAnalysis.layers : [];

  if (layers.length !== 18) {
    const strongOverride = evaluateStrongOverride({
      allowStrongOverride,
      signal,
      decisionStateFallback,
    });
    return {
      ok: strongOverride.ok,
      layersCount: layers.length,
      layer16Pass: false,
      layer17Ok: false,
      layer18State: decisionStateFallback ? String(decisionStateFallback).toUpperCase() : 'UNKNOWN',
      strongOverride,
    };
  }

  const layer16 = layers.find((l) => String(l?.key || '') === 'L16') || null;
  const layer17 = layers.find((l) => String(l?.key || '') === 'L17') || null;
  const layer18 = layers.find((l) => String(l?.key || '') === 'L18') || null;

  const layer16Pass =
    Boolean(layer16?.metrics?.isTradeValid) ||
    String(layer16?.metrics?.verdict || '').toUpperCase() === 'PASS';

  const layer17Conf = Number(layer17?.confidence);
  const layer17Ok = Number.isFinite(layer17Conf) ? layer17Conf >= min : false;

  const layer18State = String(
    layer18?.metrics?.decision?.state || decisionStateFallback || ''
  ).toUpperCase();

  const ok = layer16Pass && layer17Ok && layer18State === 'ENTER';
  const strongOverride = evaluateStrongOverride({
    allowStrongOverride,
    signal,
    decisionStateFallback: layer18State,
    gateOk: ok,
  });

  return {
    ok: ok || strongOverride.ok,
    layersCount: layers.length,
    layer16Pass,
    layer17Ok,
    layer18State,
    strongOverride,
  };
};
