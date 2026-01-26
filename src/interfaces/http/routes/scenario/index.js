import { Router } from 'express';
import { z } from 'zod';
import { ok, badRequest, serverError } from '../../../utils/http-response.js';
import { parseRequestQuery } from '../../../utils/validation.js';
import { buildEaNotConnectedResponse } from '../../../utils/ea-bridge-diagnostics.js';
import { createTradingSignalDTO, validateTradingSignalDTO } from '../../../../contracts/dtos.js';
import { eaOnlyMode } from '../../../config/runtime-flags.js';
import { getPairMetadata } from '../../../config/pair-catalog.js';
import { buildLayeredAnalysis } from '../../../core/analyzers/layered-analysis.js';
import { computeIntermarketCorrelation } from '../../../infrastructure/services/analysis/intermarket-correlation.js';

const querySchema = z.object({
  pair: z.string().min(3).max(32).optional(),
  symbol: z.string().min(3).max(32).optional(),
  broker: z.string().min(2).max(20).optional(),
  analysisMode: z.string().min(1).max(20).optional(),
  eaOnly: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'yes';
      }
      return undefined;
    })
});

const normalizeDirection = (value) => {
  const dir = String(value || '').toUpperCase();
  if (dir === 'BUY' || dir === 'SELL') {
    return dir;
  }
  return 'NEUTRAL';
};

const oppositeDirection = (direction) => {
  const dir = normalizeDirection(direction);
  if (dir === 'BUY') {
    return 'SELL';
  }
  if (dir === 'SELL') {
    return 'BUY';
  }
  return 'NEUTRAL';
};

const toFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const clampPct = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const impactWeight = (impact) => {
  if (impact == null) {
    return 0;
  }
  const numeric = Number(impact);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(5, numeric));
  }
  const label = String(impact).trim().toUpperCase();
  if (label === 'HIGH' || label === 'RED') {
    return 3;
  }
  if (label === 'MEDIUM' || label === 'ORANGE') {
    return 2;
  }
  if (label === 'LOW' || label === 'YELLOW') {
    return 1;
  }
  return 1;
};

const computeDecisionProbabilities = (signal, market) => {
  const direction = normalizeDirection(signal?.direction);
  const confidence = toFiniteNumber(signal?.confidence) ?? 0;
  const strength = toFiniteNumber(signal?.strength) ?? 0;
  const isValid = Boolean(signal?.isValid?.isValid);

  // Convert signal outputs into a conservative probability distribution.
  // This is NOT a guarantee of outcomes; it is a confidence-weighted decision heuristic.
  const tradeIntent = clampPct(confidence * 0.7 + strength * 0.3);
  const invalidPenalty = isValid ? 0 : 35;
  const spreadPoints = toFiniteNumber(market?.quote?.spreadPoints);
  const quoteAgeMs = toFiniteNumber(market?.quote?.ageMs);
  const newsImpact = toFiniteNumber(market?.news?.impactScore);

  // Market/context penalties push toward no-trade (execution + event risk).
  const spreadPenalty =
    spreadPoints == null
      ? 0
      : spreadPoints > 35
        ? 18
        : spreadPoints > 25
          ? 12
          : spreadPoints > 18
            ? 7
            : 0;
  const stalePenalty =
    quoteAgeMs == null ? 0 : quoteAgeMs > 60_000 ? 10 : quoteAgeMs > 20_000 ? 5 : 0;
  const newsPenalty = newsImpact == null ? 0 : Math.min(20, Math.round(newsImpact * 3));

  const marketPenalty = spreadPenalty + stalePenalty + newsPenalty;
  const tradePct = clampPct(tradeIntent - invalidPenalty - marketPenalty);

  if (direction === 'BUY') {
    const buyPct = tradePct;
    const sellPct = clampPct((100 - buyPct) * 0.15);
    const noTradePct = clampPct(100 - buyPct - sellPct);
    return { buyPct, sellPct, noTradePct, tradePct };
  }

  if (direction === 'SELL') {
    const sellPct = tradePct;
    const buyPct = clampPct((100 - sellPct) * 0.15);
    const noTradePct = clampPct(100 - buyPct - sellPct);
    return { buyPct, sellPct, noTradePct, tradePct };
  }

  // Neutral / abstain: bias toward no-trade.
  const noTradePct = clampPct(Math.max(60, 100 - confidence));
  const remainder = clampPct(100 - noTradePct);
  const buyPct = clampPct(remainder / 2);
  const sellPct = clampPct(100 - noTradePct - buyPct);
  return { buyPct, sellPct, noTradePct, tradePct: clampPct(100 - noTradePct) };
};

const FIAT_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD']);

const withTimeout = async (promise, timeoutMs) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutHandle;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ __timeout: true }), timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const getPairCurrencies = (pair) => {
  const normalized = String(pair || '')
    .trim()
    .toUpperCase();
  if (!normalized) {
    return { base: null, quote: null, assetClass: null, source: 'none' };
  }

  const meta = getPairMetadata(normalized);
  if (meta?.base && meta?.quote) {
    return {
      base: String(meta.base).toUpperCase(),
      quote: String(meta.quote).toUpperCase(),
      assetClass: meta.assetClass || null,
      source: 'catalog'
    };
  }

  if (normalized.length >= 6) {
    return {
      base: normalized.slice(0, 3),
      quote: normalized.slice(3, 6),
      assetClass: null,
      source: 'heuristic'
    };
  }

  return { base: null, quote: null, assetClass: null, source: 'unknown' };
};

const summarizeCurrencyAnalysis = (analysis) => {
  if (!analysis || typeof analysis !== 'object') {
    return null;
  }

  const indicators =
    analysis.indicators && typeof analysis.indicators === 'object' ? analysis.indicators : {};
  const indicatorKeys = [
    'gdp',
    'inflation',
    'interestRate',
    'unemployment',
    'retailSales',
    'manufacturing'
  ];
  const available = indicatorKeys.filter((key) => indicators?.[key]?.value != null);

  return {
    currency: analysis.currency || null,
    timestamp: toFiniteNumber(analysis.timestamp),
    score: toFiniteNumber(analysis.score),
    strength: toFiniteNumber(analysis.strength),
    sentiment: analysis.sentiment || 'neutral',
    coveragePct: Math.round((available.length / indicatorKeys.length) * 100),
    indicators: indicators
  };
};

const computeRelativeMacro = (baseSummary, quoteSummary, pair) => {
  const baseScore = toFiniteNumber(baseSummary?.score);
  const quoteScore = toFiniteNumber(quoteSummary?.score);
  const baseCoverage = toFiniteNumber(baseSummary?.coveragePct);
  const quoteCoverage = toFiniteNumber(quoteSummary?.coveragePct);

  if (baseScore == null || quoteScore == null) {
    return {
      baseScore,
      quoteScore,
      differential: null,
      direction: 'NEUTRAL',
      confidence: 0,
      note: 'Insufficient fundamentals coverage to compute macro bias.'
    };
  }

  const differential = Number((baseScore - quoteScore).toFixed(2));
  const direction = differential > 5 ? 'BUY' : differential < -5 ? 'SELL' : 'NEUTRAL';
  const confidence = Math.max(
    0,
    Math.min(100, Math.round(((baseCoverage ?? 0) + (quoteCoverage ?? 0)) / 2))
  );

  return {
    pair: pair || null,
    baseScore,
    quoteScore,
    differential,
    direction,
    confidence,
    note:
      direction === 'BUY'
        ? 'Macro fundamentals favor the base currency (bullish bias on the pair).'
        : direction === 'SELL'
          ? 'Macro fundamentals favor the quote currency (bearish bias on the pair).'
          : 'Macro fundamentals are mixed/neutral relative to each other.'
  };
};

export default function scenarioRoutes({
  tradingEngine,
  eaBridgeService,
  logger,
  requireSignalsGenerate
}) {
  const router = Router();

  router.get('/scenario/analyze', requireSignalsGenerate, async (req, res) => {
    const parsed = parseRequestQuery(querySchema, req, res, {
      errorMessage: 'Invalid scenario request'
    });
    if (!parsed) {
      return null;
    }

    const { pair, symbol, broker, analysisMode, eaOnly } = parsed;
    const requestedPair = String(pair || symbol || '')
      .trim()
      .toUpperCase();

    if (!requestedPair) {
      return badRequest(res, 'pair (or symbol) is required');
    }

    const startTime = process.hrtime.bigint();

    try {
      const forceEaOnly = eaOnlyMode(process.env);

      const brokerId = broker ? String(broker).trim().toLowerCase() : null;
      const brokerRequested = Boolean(brokerId);
      const effectiveBroker = String(
        brokerId || tradingEngine?.brokerRouter?.defaultBroker || 'mt5'
      ).toLowerCase();
      const brokerIsEa = effectiveBroker === 'mt4' || effectiveBroker === 'mt5';

      const wantsEaOnly =
        forceEaOnly ||
        brokerIsEa ||
        eaOnly === true ||
        String(analysisMode || '').toLowerCase() === 'ea';

      if (forceEaOnly && brokerRequested && !brokerIsEa) {
        return badRequest(
          res,
          'EA-only mode is enabled. Use MT4/MT5 broker mode and connect the EA bridge first.'
        );
      }

      // If user is analyzing against MT4/MT5, require that the EA is connected
      // and that a fresh quote exists for the requested pair. This prevents
      // "analysis" from running on missing/placeholder prices.
      if (brokerIsEa && wantsEaOnly) {
        const connected = eaBridgeService?.isBrokerConnected
          ? eaBridgeService.isBrokerConnected({ broker: effectiveBroker, maxAgeMs: 2 * 60 * 1000 })
          : false;
        if (!connected) {
          return res.status(409).json(
            buildEaNotConnectedResponse({
              broker: effectiveBroker,
              symbol: requestedPair,
              eaBridgeService,
              maxAgeMs: 2 * 60 * 1000,
              now: Date.now()
            })
          );
        }

        if (eaBridgeService && typeof eaBridgeService.getQuotes === 'function') {
          const extractPriceFromSnapshot = (snapshot) => {
            if (!snapshot || typeof snapshot !== 'object') {
              return null;
            }
            const frames =
              snapshot.timeframes && typeof snapshot.timeframes === 'object'
                ? snapshot.timeframes
                : null;
            if (!frames) {
              return null;
            }
            const tfs = ['M15', 'H1', 'H4', 'D1'];
            for (const tf of tfs) {
              const frame = frames[tf] || frames[String(tf).toLowerCase()] || null;
              if (!frame || typeof frame !== 'object') {
                continue;
              }
              const lp = Number(frame.lastPrice);
              if (Number.isFinite(lp) && lp > 0) {
                return lp;
              }
              const close = Number(frame?.latestCandle?.close);
              if (Number.isFinite(close) && close > 0) {
                return close;
              }
            }
            return null;
          };

          // MT terminals may not emit ticks continuously; use a slightly larger freshness window
          // to avoid intermittent "waiting" flapping in the dashboard.
          const maxAgeMs = 2 * 60 * 1000;
          const freshQuotes = eaBridgeService.getQuotes({ broker: effectiveBroker, maxAgeMs });
          const candidateSymbols = Array.isArray(freshQuotes)
            ? freshQuotes.map((q) => q?.symbol).filter(Boolean)
            : [];

          const resolvedSymbol =
            typeof eaBridgeService.bestSymbolMatch === 'function'
              ? eaBridgeService.bestSymbolMatch(requestedPair, candidateSymbols)
              : typeof eaBridgeService.resolveSymbolFromQuotes === 'function'
                ? eaBridgeService.resolveSymbolFromQuotes(effectiveBroker, requestedPair, { maxAgeMs })
                : requestedPair;

          const hasQuoteForPair =
            Array.isArray(freshQuotes) && freshQuotes.some((q) => q?.symbol === resolvedSymbol);
          if (!hasQuoteForPair) {
            // Snapshot fallback (still MT/EA-provided, not synthetic):
            // If a fresh snapshot exists, inject a quote derived from snapshot lastPrice so
            // scenario analysis can proceed without flapping on missing tick batches.
            try {
              const snapshot =
                typeof eaBridgeService.getMarketSnapshot === 'function'
                  ? eaBridgeService.getMarketSnapshot({
                      broker: effectiveBroker,
                      symbol: resolvedSymbol || requestedPair,
                      maxAgeMs
                    })
                  : null;

              const snapshotPrice = extractPriceFromSnapshot(snapshot);
              if (
                snapshot &&
                Number.isFinite(Number(snapshotPrice)) &&
                Number(snapshotPrice) > 0 &&
                typeof eaBridgeService.recordQuote === 'function'
              ) {
                eaBridgeService.recordQuote({
                  broker: effectiveBroker,
                  symbol: snapshot.symbol || resolvedSymbol || requestedPair,
                  bid: snapshotPrice,
                  ask: snapshotPrice,
                  last: snapshotPrice,
                  timestamp: snapshot.timestamp || Date.now(),
                  source: 'ea-snapshot'
                });
              } else {
                // Best-effort: request a snapshot so the EA prioritizes this symbol.
                if (typeof eaBridgeService.requestMarketSnapshot === 'function') {
                  eaBridgeService.requestMarketSnapshot({
                    broker: effectiveBroker,
                    symbol: requestedPair,
                    ttlMs: maxAgeMs
                  });
                }
                return res.status(409).json({
                  success: false,
                  error: `Waiting for live ${effectiveBroker.toUpperCase()} price for ${requestedPair}`,
                  broker: effectiveBroker,
                  pair: requestedPair,
                  resolvedSymbol
                });
              }
            } catch (_error) {
              // Fall back to strict waiting if snapshot lookup fails.
              return res.status(409).json({
                success: false,
                error: `Waiting for live ${effectiveBroker.toUpperCase()} price for ${requestedPair}`,
                broker: effectiveBroker,
                pair: requestedPair,
                resolvedSymbol
              });
            }
          }

          // Re-check in case we injected a snapshot-derived quote above.
          const refreshedQuotes = eaBridgeService.getQuotes({ broker: effectiveBroker, maxAgeMs });
          const hasQuoteAfterFallback =
            Array.isArray(refreshedQuotes) &&
            refreshedQuotes.some(
              (q) => q?.symbol === resolvedSymbol || q?.symbol === requestedPair
            );
          if (!hasQuoteAfterFallback) {
            return res.status(409).json({
              success: false,
              error: `Waiting for live ${effectiveBroker.toUpperCase()} price for ${requestedPair}`,
              broker: effectiveBroker,
              pair: requestedPair,
              resolvedSymbol
            });
          }
        } else if (wantsEaOnly) {
          return res.status(409).json({
            success: false,
            error: `EA quotes unavailable for broker ${effectiveBroker.toUpperCase()}`,
            broker: effectiveBroker
          });
        }
      }

      const effectiveAnalysisMode = wantsEaOnly ? 'ea' : analysisMode || null;

      const options = wantsEaOnly
        ? { broker: effectiveBroker, eaOnly: true, analysisMode: 'ea' }
        : {
            ...(broker ? { broker } : null),
            ...(effectiveAnalysisMode ? { analysisMode: effectiveAnalysisMode } : null)
          };

      const rawSignal = await tradingEngine.generateSignal(requestedPair, options);
      const signal = validateTradingSignalDTO(createTradingSignalDTO(rawSignal));

      const direction = normalizeDirection(signal.direction);

      const entry = signal.entry || null;
      const entryPrice = toFiniteNumber(entry?.price ?? signal.entryPrice);
      const stopLoss = toFiniteNumber(entry?.stopLoss ?? signal.stopLoss);
      const takeProfit = toFiniteNumber(entry?.takeProfit ?? signal.takeProfit);
      const riskReward = toFiniteNumber(entry?.riskReward ?? signal.riskReward);
      const atr = toFiniteNumber(entry?.atr ?? signal.atr);

      const economic = signal.components?.economic || {};
      const news = signal.components?.news || {};
      const technical = signal.components?.technical || {};

      const scenario = {
        pair: signal.pair,
        broker: broker || null,
        mode: {
          analysisMode: effectiveAnalysisMode || null,
          eaOnly: Boolean(wantsEaOnly)
        },
        generatedAt: signal.generatedAt || signal.createdAt || signal.timestamp || Date.now(),
        sources: {
          quote: null,
          news: {
            sources: signal.components?.news?.newsSources || {},
            base: Array.isArray(signal.components?.news?.evidence?.base)
              ? signal.components.news.evidence.base.slice(0, 8)
              : [],
            quote: Array.isArray(signal.components?.news?.evidence?.quote)
              ? signal.components.news.evidence.quote.slice(0, 8)
              : [],
            external: Array.isArray(signal.components?.news?.evidence?.external)
              ? signal.components.news.evidence.external.slice(0, 8)
              : []
          },
          calendar: Array.isArray(signal.components?.news?.calendarEvents)
            ? signal.components.news.calendarEvents.slice(0, 12).map((evt) => ({
                title: evt?.title || evt?.event || evt?.name || null,
                currency: evt?.currency || null,
                impact: evt?.impact ?? null,
                time: evt?.time ?? evt?.timestamp ?? evt?.date ?? null,
                source: evt?.source || null,
                url: evt?.url || evt?.sourceUrl || evt?.link || null
              }))
            : []
        },
        decision: {
          isTradeValid: Boolean(signal.isValid?.isValid),
          reason: signal.isValid?.reason || null,
          checks: signal.isValid?.checks || {},
          state: signal.isValid?.decision?.state || null,
          blocked: Boolean(signal.isValid?.decision?.blocked),
          score: signal.isValid?.decision?.score ?? null,
          assetClass: signal.isValid?.decision?.assetClass || null,
          missing: Array.isArray(signal.isValid?.decision?.missing)
            ? signal.isValid.decision.missing.slice(0, 10)
            : [],
          whatWouldChange: Array.isArray(signal.isValid?.decision?.whatWouldChange)
            ? signal.isValid.decision.whatWouldChange.slice(0, 10)
            : [],
          context: signal.isValid?.decision?.context || null,
          contributors: signal.isValid?.decision?.contributors || null,
          modifiers: signal.isValid?.decision?.modifiers || null
        },
        primary: {
          direction,
          confidence: toFiniteNumber(signal.confidence),
          strength: toFiniteNumber(signal.strength),
          finalScore: toFiniteNumber(signal.finalScore),
          entry: {
            price: entryPrice,
            stopLoss,
            takeProfit,
            riskReward,
            atr,
            trailingStop: entry?.trailingStop ?? null,
            volatilityState: entry?.volatilityState ?? null
          }
        },
        alternative: {
          direction: oppositeDirection(direction),
          note: 'Alternative scenario is the opposite bias and should be considered only if the primary scenario invalidates.'
        },
        factors: {
          economic: {
            relativeSentiment: toFiniteNumber(economic.relativeSentiment),
            direction: economic.direction || null,
            confidence: toFiniteNumber(economic.confidence)
          },
          news: {
            sentiment: toFiniteNumber(news.sentiment),
            direction: news.direction || null,
            impact: toFiniteNumber(news.impact),
            confidence: toFiniteNumber(news.confidence),
            upcomingEvents: toFiniteNumber(news.upcomingEvents),
            quality: news.quality || null
          },
          candles: signal.components?.technical?.candlesSummary || null,
          technical: {
            score: toFiniteNumber(technical.score),
            direction: technical.direction || null,
            strength: toFiniteNumber(technical.strength),
            regime: technical.regime || technical.regimeSummary || null,
            volatility: technical.volatility || technical.volatilitySummary || null
          },
          marketData: signal.components?.marketData || null
        },
        reasoning: Array.isArray(signal.reasoning) ? signal.reasoning.slice(0, 10) : []
      };

      // Attach real-time market context from the EA bridge (best-effort).
      try {
        const brokerId = broker ? String(broker).trim().toLowerCase() : null;
        const market = { quote: null, news: null };

        if (eaBridgeService && brokerId && typeof eaBridgeService.getQuotes === 'function') {
          const quotes = eaBridgeService.getQuotes({ broker: brokerId, maxAgeMs: 5 * 60 * 1000 });
          const requestedUpper = String(requestedPair || '')
            .trim()
            .toUpperCase();
          const candidates = Array.isArray(quotes) ? quotes : [];

          let best = null;
          for (const quote of candidates) {
            const sym = String(quote?.symbol || quote?.pair || '')
              .trim()
              .toUpperCase();
            if (!sym) {
              continue;
            }
            if (sym === requestedUpper) {
              best = quote;
              break;
            }
            if (!best && (sym.startsWith(requestedUpper) || requestedUpper.startsWith(sym))) {
              best = quote;
            } else if (
              best &&
              sym.startsWith(requestedUpper) &&
              String(best?.symbol || best?.pair || '').trim().length > sym.length
            ) {
              best = quote;
            }
          }

          if (best) {
            const receivedAt = toFiniteNumber(best?.receivedAt) ?? toFiniteNumber(best?.timestamp);
            const nowMs = Date.now();
            const ageMs = receivedAt != null ? Math.max(0, nowMs - receivedAt) : null;
            market.quote = {
              symbol: best?.symbol || best?.pair || requestedUpper,
              bid: toFiniteNumber(best?.bid),
              ask: toFiniteNumber(best?.ask),
              last: toFiniteNumber(best?.last),
              mid: toFiniteNumber(best?.mid),
              midDelta: toFiniteNumber(best?.midDelta),
              midVelocityPerSec: toFiniteNumber(best?.midVelocityPerSec),
              spreadPoints: toFiniteNumber(best?.spreadPoints),
              source: best?.source || null,
              receivedAt: receivedAt != null ? receivedAt : null,
              ageMs
            };
          } else if (
            eaBridgeService &&
            brokerId &&
            typeof eaBridgeService.requestMarketSnapshot === 'function'
          ) {
            // Best-effort: prompt EA to publish a fresh snapshot/quote for this symbol.
            eaBridgeService.requestMarketSnapshot({
              broker: brokerId,
              symbol: requestedUpper,
              ttlMs: 2 * 60 * 1000
            });
            market.quote = {
              symbol: requestedUpper,
              pending: true,
              source: 'ea',
              receivedAt: null,
              ageMs: null
            };
          }
        }

        if (eaBridgeService && brokerId && typeof eaBridgeService.getNews === 'function') {
          const lookbackMs = 12 * 60 * 60 * 1000;
          const nowMs = Date.now();
          const requestedUpper = String(requestedPair || '')
            .trim()
            .toUpperCase();
          const meta = getPairCurrencies(requestedUpper);
          const base = meta?.base;
          const quote = meta?.quote;

          const newsItems = eaBridgeService.getNews({ broker: brokerId, limit: 200 });
          let impactScore = 0;
          let matched = 0;
          for (const item of Array.isArray(newsItems) ? newsItems : []) {
            const time =
              toFiniteNumber(item?.time) ??
              toFiniteNumber(item?.timestamp) ??
              toFiniteNumber(item?.receivedAt);
            if (!time || nowMs - time > lookbackMs) {
              continue;
            }
            const w = impactWeight(item?.impact);
            if (w <= 0) {
              continue;
            }
            const sym = String(item?.symbol || '')
              .trim()
              .toUpperCase();
            const cur = String(item?.currency || '')
              .trim()
              .toUpperCase();

            const matchesSymbol = sym && (sym === requestedUpper || sym.startsWith(requestedUpper));
            const matchesCurrency = cur && ((base && cur === base) || (quote && cur === quote));

            if (matchesSymbol || matchesCurrency) {
              impactScore += w;
              matched += 1;
            }
          }

          if (matched > 0) {
            market.news = {
              impactScore: Number(impactScore.toFixed(1)),
              matchedItems: matched,
              lookbackHours: 12
            };
          }
        }

        if (market.quote || market.news) {
          scenario.market = market;
        }

        if (market.quote) {
          scenario.sources.quote = {
            broker: brokerId || null,
            symbol: market.quote.symbol || requestedPair,
            receivedAt: market.quote.receivedAt ?? null,
            ageMs: market.quote.ageMs ?? null,
            pending: Boolean(market.quote.pending)
          };
        }

        // Attach EA-only intermarket correlation (best-effort, bars-only).
        try {
          const brokerIsEa = brokerId === 'mt4' || brokerId === 'mt5';
          if (brokerIsEa && wantsEaOnly) {
            const meta = getPairMetadata(requestedPair);
            scenario.intermarket = {
              correlation: computeIntermarketCorrelation({
                eaBridgeService,
                broker: brokerId,
                pair: requestedPair,
                assetClass: meta?.assetClass || null,
                timeframe: 'M15',
                window: 96,
                maxAgeMs: 0
              })
            };
          }
        } catch (_error) {
          // best-effort
        }
      } catch (error) {
        logger?.warn?.(
          { err: error, pair: requestedPair, broker },
          'Scenario market context failed'
        );
      }

      scenario.probabilities = computeDecisionProbabilities(signal, scenario.market || null);

      // Attach per-currency macro fundamentals (best-effort, numeric, non-random).
      try {
        if (wantsEaOnly) {
          scenario.fundamentals = {
            note: 'EA-only mode is enabled: external macro fundamentals are disabled for this analysis.'
          };
        } else {
          const { base, quote, assetClass, source } = getPairCurrencies(requestedPair);
          const econ = tradingEngine?.economicAnalyzer || null;
          const analyze = async (currency) => {
            if (!econ || typeof econ.analyzeCurrency !== 'function') {
              return null;
            }
            const result = await withTimeout(econ.analyzeCurrency(currency), 4500);
            if (result && result.__timeout) {
              return {
                currency,
                timestamp: Date.now(),
                indicators: {},
                score: 0,
                sentiment: 'neutral',
                strength: 0,
                note: 'Fundamentals fetch timed out.'
              };
            }
            return result;
          };

          const baseIsFiat = base && FIAT_CURRENCIES.has(base);
          const quoteIsFiat = quote && FIAT_CURRENCIES.has(quote);

          const baseAnalysisPromise = baseIsFiat ? analyze(base) : Promise.resolve(null);
          const quoteAnalysisPromise = quoteIsFiat ? analyze(quote) : Promise.resolve(null);

          const [baseAnalysis, quoteAnalysis] = await Promise.all([
            baseAnalysisPromise,
            quoteAnalysisPromise
          ]);
          const baseSummary = summarizeCurrencyAnalysis(baseAnalysis);
          const quoteSummary = summarizeCurrencyAnalysis(quoteAnalysis);

          scenario.fundamentals = {
            source,
            assetClass: assetClass || null,
            base: {
              currency: base,
              supported: Boolean(baseIsFiat),
              analysis: baseSummary,
              note: baseIsFiat
                ? null
                : base
                  ? 'Non-fiat or unsupported base currency.'
                  : 'Unknown base currency.'
            },
            quote: {
              currency: quote,
              supported: Boolean(quoteIsFiat),
              analysis: quoteSummary,
              note: quoteIsFiat
                ? null
                : quote
                  ? 'Non-fiat or unsupported quote currency.'
                  : 'Unknown quote currency.'
            },
            relative: computeRelativeMacro(baseSummary, quoteSummary, requestedPair)
          };

          // For non-FX instruments, the quote currency macro is usually the main driver.
          if (assetClass && assetClass !== 'forex') {
            scenario.fundamentals.note =
              'For non-FX symbols, macro fundamentals are computed for the quote currency only when applicable.';
          }
        }
      } catch (error) {
        logger?.warn?.(
          { err: error, pair: requestedPair },
          'Scenario fundamentals attachment failed'
        );
        // Do not fail the scenario response if fundamentals fail.
      }

      // Attach multi-layer analysis (18 layers) for MT-style explainability.
      try {
        scenario.layers = buildLayeredAnalysis({ scenario, signal });
      } catch (error) {
        logger?.warn?.({ err: error, pair: requestedPair }, 'Scenario layered analysis failed');
        scenario.layers = [];
      }

      const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;

      return ok(res, {
        scenario,
        signal,
        durationMs: Number(durationMs.toFixed(1))
      });
    } catch (error) {
      logger?.error?.({ err: error, pair: requestedPair }, 'Scenario analysis failed');
      return serverError(res, error);
    }
  });

  return router;
}
