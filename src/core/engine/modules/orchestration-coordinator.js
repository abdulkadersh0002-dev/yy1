import {
  analyzeCandleSeries,
  aggregateCandleAnalyses
} from '../../analyzers/candle-analysis-lite.js';
import { computeIntermarketCorrelation } from '../../../infrastructure/services/analysis/intermarket-correlation.js';

export const orchestrationCoordinator = {
  async generateSignal(pair, options = {}) {
    const { autoExecute = false } = options;
    const broker = options?.broker || null;
    const analysisMode = String(options?.analysisMode || '')
      .trim()
      .toLowerCase();
    const eaOnly = options?.eaOnly === true || analysisMode === 'ea';
    const brokerId = String(broker || '')
      .trim()
      .toLowerCase();
    const brokerIsEa = brokerId === 'mt4' || brokerId === 'mt5';
    const eaHybrid = !eaOnly && (analysisMode === 'ea_hybrid' || analysisMode === 'hybrid');

    try {
      this.logger?.debug?.({ module: 'OrchestrationCoordinator', pair }, 'Generating signal');

      let external = null;
      if (typeof this.externalMarketContextProvider === 'function') {
        try {
          external = await this.externalMarketContextProvider({ pair, broker });
        } catch (error) {
          this.logger?.warn?.(
            { module: 'OrchestrationCoordinator', pair, broker, err: error },
            'External market context provider failed'
          );
          external = null;
        }
      }

      // EA-only: ensure we always have an EA quote available for execution/spread gates.
      // Some providers may omit `external.quote` even when EA quotes are streaming.
      if (eaOnly && brokerIsEa) {
        try {
          const eaBridgeService = options?.eaBridgeService || null;
          if (
            eaBridgeService &&
            (!external || !external.quote) &&
            typeof eaBridgeService.getLatestQuoteForSymbolMatch === 'function'
          ) {
            const fallbackQuote = eaBridgeService.getLatestQuoteForSymbolMatch(brokerId, pair);
            if (fallbackQuote) {
              external = {
                ...(external && typeof external === 'object' ? external : {}),
                quote: fallbackQuote
              };
            }
          }
        } catch (_error) {
          // best-effort
        }
      }

      if (this.featureStore && typeof this.featureStore.purgeExpired === 'function') {
        this.featureStore.purgeExpired();
      }

      let economicAnalysis;
      let newsAnalysis;
      let technicalAnalysis;

      const buildEaTechnical = async ({ external, pair } = {}) => {
        const now = Date.now();
        const normalizeDirection = (value) => {
          const raw = String(value || '').toUpperCase();
          if (raw === 'BUY' || raw === 'SELL' || raw === 'NEUTRAL') {
            return raw;
          }
          if (raw === 'BULLISH') {
            return 'BUY';
          }
          if (raw === 'BEARISH') {
            return 'SELL';
          }
          return 'NEUTRAL';
        };

        // Keep local clamp for legacy logic.
        const clampLocal = (value, min, max) => Math.min(max, Math.max(min, value));

        const externalQuote = external?.quote || null;
        const midPrice =
          externalQuote &&
          (Number.isFinite(Number(externalQuote.bid)) || Number.isFinite(Number(externalQuote.ask)))
            ? (Number(externalQuote.bid || 0) + Number(externalQuote.ask || 0)) /
              (Number.isFinite(Number(externalQuote.bid)) &&
              Number.isFinite(Number(externalQuote.ask))
                ? 2
                : 1)
            : Number.isFinite(Number(externalQuote?.last))
              ? Number(externalQuote.last)
              : null;

        const timeframes = ['M1', 'M15', 'H1', 'H4', 'D1'];

        const barsByTimeframe =
          external?.barsByTimeframe && typeof external.barsByTimeframe === 'object'
            ? external.barsByTimeframe
            : null;

        // Prefer rich technical analysis computed from EA bars when available.
        // This yields full indicators/patterns/support-resistance rather than a neutral placeholder.
        let technicalAnalysis = null;
        if (
          barsByTimeframe &&
          this.technicalAnalyzer &&
          typeof this.technicalAnalyzer.analyzeTechnicalFromCandles === 'function'
        ) {
          try {
            technicalAnalysis = await this.technicalAnalyzer.analyzeTechnicalFromCandles(
              pair,
              barsByTimeframe,
              timeframes
            );
          } catch (_error) {
            technicalAnalysis = null;
          }
        }

        // Ensure we always have the expected EA-technical structure.
        const timeframeMap =
          technicalAnalysis && typeof technicalAnalysis === 'object' && technicalAnalysis.timeframes
            ? technicalAnalysis.timeframes
            : {};

        if (!timeframeMap || typeof timeframeMap !== 'object') {
          // Fallback: build minimal frames.
          const map = {};
          timeframes.forEach((tf) => {
            map[tf] = {
              timeframe: tf,
              indicators: {},
              patterns: [],
              supportResistance: {},
              ranges: null,
              pivotPoints: null,
              score: 0,
              lastPrice: Number.isFinite(midPrice) ? midPrice : null,
              latestCandle: null,
              priceChangePercent: 0,
              direction: 'NEUTRAL',
              dataAvailability: {
                timeframe: tf,
                inspectedAt: now,
                viable: true,
                reasons: ['ea_bridge'],
                normalizedQuality: 1,
                availableProviders: ['eaBridge'],
                blockedProviders: [],
                availabilityDetails: []
              },
              availabilityStatus: 'available',
              availabilityReasons: []
            };
          });
          technicalAnalysis = {
            pair,
            timestamp: now,
            score: 0,
            trend: 'neutral',
            strength: 0,
            signals: [],
            timeframes: map,
            direction: 'NEUTRAL',
            latestPrice: Number.isFinite(midPrice) ? midPrice : null,
            directionSummary: { BUY: 0, SELL: 0, NEUTRAL: timeframes.length },
            regimeSummary: null,
            volatilitySummary: null,
            divergenceSummary: null,
            volumePressureSummary: null,
            dataAvailability: {
              pair,
              inspectedAt: now,
              viable: true,
              totalTimeframes: timeframes.length,
              availableTimeframes: [...timeframes],
              blockedTimeframes: [],
              reasons: ['ea_bridge'],
              normalizedQuality: 1,
              timeframes: timeframes.reduce((acc, tf) => {
                acc[tf] = { ...map[tf].dataAvailability, timeframe: tf };
                return acc;
              }, {})
            }
          };
        } else {
          // If the technical analyzer didn't include midPrice yet (or series were empty), preserve it.
          if (technicalAnalysis.latestPrice == null && Number.isFinite(midPrice)) {
            technicalAnalysis.latestPrice = midPrice;
          }
        }

        // Hydrate technical snapshot if available.
        const snapshotFrames = (() => {
          if (!external?.snapshot || typeof external.snapshot !== 'object') {
            return null;
          }
          // Support both shapes:
          // - { timeframes: { M15: {...}, H1: {...} } }
          // - { M15: {...}, H1: {...} }
          return external.snapshot.timeframes || external.snapshot.frames || external.snapshot;
        })();

        if (snapshotFrames && typeof snapshotFrames === 'object') {
          const normalizeFrameDirection = (value) => {
            const raw = String(value || '').toUpperCase();
            if (
              raw === 'BUY' ||
              raw === 'LONG' ||
              raw === 'BULL' ||
              raw === 'BULLISH' ||
              raw === 'UP'
            ) {
              return 'BUY';
            }
            if (
              raw === 'SELL' ||
              raw === 'SHORT' ||
              raw === 'BEAR' ||
              raw === 'BEARISH' ||
              raw === 'DOWN'
            ) {
              return 'SELL';
            }
            if (raw === '1' || raw === '+1' || raw === '+') {
              return 'BUY';
            }
            if (raw === '-1' || raw === '-') {
              return 'SELL';
            }
            return 'NEUTRAL';
          };

          for (const tf of timeframes) {
            const frame = snapshotFrames[tf] || snapshotFrames[tf.toLowerCase()] || null;
            if (!frame || typeof frame !== 'object') {
              continue;
            }

            const current = timeframeMap[tf] || { timeframe: tf };
            const direction = String(frame.direction || '').toUpperCase();
            const score = Number.isFinite(Number(frame.score)) ? Number(frame.score) : null;

            timeframeMap[tf] = {
              ...current,
              direction: normalizeFrameDirection(direction) || current.direction,
              score: score != null ? score : current.score,
              indicators:
                frame.indicators && typeof frame.indicators === 'object'
                  ? frame.indicators
                  : current.indicators,
              lastPrice: Number.isFinite(Number(frame.lastPrice))
                ? Number(frame.lastPrice)
                : current.lastPrice,
              latestCandle:
                frame.latestCandle && typeof frame.latestCandle === 'object'
                  ? frame.latestCandle
                  : current.latestCandle,
              ranges:
                frame.ranges && typeof frame.ranges === 'object' ? frame.ranges : current.ranges,
              pivotPoints:
                frame.pivotPoints && typeof frame.pivotPoints === 'object'
                  ? frame.pivotPoints
                  : current.pivotPoints
            };
          }

          let buyVotes = 0;
          let sellVotes = 0;
          let neutralVotes = 0;
          let signedScoreSum = 0;
          let scoreSamples = 0;
          const snapshotSignals = [];

          for (const tf of timeframes) {
            const frame = snapshotFrames[tf] || snapshotFrames[tf.toLowerCase()] || null;
            const direction = normalizeFrameDirection(timeframeMap?.[tf]?.direction);
            const absScore = Number.isFinite(Number(timeframeMap?.[tf]?.score))
              ? Math.max(0, Math.min(100, Number(timeframeMap[tf].score)))
              : 0;

            if (direction === 'BUY') {
              buyVotes += 1;
              signedScoreSum += absScore;
              scoreSamples += 1;
            } else if (direction === 'SELL') {
              sellVotes += 1;
              signedScoreSum -= absScore;
              scoreSamples += 1;
            } else {
              neutralVotes += 1;
            }

            if (direction === 'BUY' || direction === 'SELL') {
              snapshotSignals.push({
                type: 'EA_SNAPSHOT',
                timeframe: tf,
                bias: direction,
                strength: absScore,
                score: direction === 'BUY' ? absScore : -absScore,
                confidence: Number.isFinite(Number(frame?.confidence))
                  ? Number(frame.confidence)
                  : null
              });
            }
          }

          const avgSignedScore = scoreSamples ? signedScoreSum / scoreSamples : 0;
          const aggregateDirection =
            buyVotes > sellVotes ? 'BUY' : sellVotes > buyVotes ? 'SELL' : 'NEUTRAL';

          technicalAnalysis.score = Number(avgSignedScore.toFixed(2));
          technicalAnalysis.direction = aggregateDirection;
          technicalAnalysis.strength = Number(Math.min(100, Math.abs(avgSignedScore)).toFixed(1));
          technicalAnalysis.trend =
            aggregateDirection === 'BUY'
              ? 'bullish'
              : aggregateDirection === 'SELL'
                ? 'bearish'
                : 'neutral';
          technicalAnalysis.directionSummary = {
            BUY: buyVotes,
            SELL: sellVotes,
            NEUTRAL: neutralVotes
          };
          technicalAnalysis.signals = snapshotSignals.sort(
            (a, b) => Number(b.strength || 0) - Number(a.strength || 0)
          );
        }

        // Candle-derived momentum/volatility/structure is additionally handled by candle-analysis-lite.

        const defaultBars = Array.isArray(external?.bars) ? external.bars : null;
        const defaultTimeframe = String(external?.barsTimeframe || 'M1').toUpperCase();

        const tfOrder = ['D1', 'H4', 'H1', 'M15', 'M1'];
        const tfWeights = { D1: 1.0, H4: 0.85, H1: 0.7, M15: 0.55, M1: 0.35 };

        const tfSeries = [];
        if (barsByTimeframe) {
          for (const tf of tfOrder) {
            const series = barsByTimeframe[tf] || barsByTimeframe[tf.toLowerCase()] || null;
            if (Array.isArray(series) && series.length >= 3) {
              tfSeries.push({ tf, series });
            }
          }
        } else if (Array.isArray(defaultBars) && defaultBars.length >= 3) {
          tfSeries.push({ tf: defaultTimeframe, series: defaultBars });
        }

        if (tfSeries.length) {
          let totalDelta = 0;
          const deltaCap = 25;
          const candleSignals = [];
          const analysesByTimeframe = {};

          for (const { tf, series } of tfSeries) {
            const analysis = analyzeCandleSeries(series, { timeframe: tf });
            if (!analysis) {
              continue;
            }
            analysesByTimeframe[tf] = analysis;

            const weight = Number.isFinite(Number(tfWeights[tf])) ? Number(tfWeights[tf]) : 0.5;
            const weightedDelta = clampLocal((analysis.scoreDelta || 0) * weight, -18, 18);
            totalDelta = clampLocal(totalDelta + weightedDelta, -deltaCap, deltaCap);

            if (!Number.isFinite(Number(technicalAnalysis.latestPrice))) {
              technicalAnalysis.latestPrice = analysis.newestClose;
            }

            const regimeConfidence = Number(analysis?.regime?.confidence);
            const existingRegimeConfidence = Number(technicalAnalysis?.regimeSummary?.confidence);
            if (
              Number.isFinite(regimeConfidence) &&
              (!Number.isFinite(existingRegimeConfidence) ||
                regimeConfidence > existingRegimeConfidence)
            ) {
              technicalAnalysis.regimeSummary = {
                state: analysis?.regime?.state || null,
                confidence: regimeConfidence,
                averageSlope: analysis?.regime?.slope ?? null
              };
            }

            const atrPct = Number(analysis?.volatility?.atrPct);
            const existingVolScore = Number(technicalAnalysis?.volatilitySummary?.averageScore);
            if (
              Number.isFinite(atrPct) &&
              (!Number.isFinite(existingVolScore) || atrPct > existingVolScore)
            ) {
              technicalAnalysis.volatilitySummary = {
                state: analysis?.volatility?.state || null,
                averageScore: Number(atrPct.toFixed(3))
              };
            }

            candleSignals.push({
              type: 'EA_CANDLES',
              timeframe: tf,
              bias: analysis.direction,
              strength: analysis.strength,
              score: Number(weightedDelta.toFixed(2)),
              confidence: analysis.confidence,
              regime: analysis?.regime?.state || null,
              r2: analysis?.regime?.r2 ?? null,
              volatility: analysis?.volatility?.state || null,
              atrPct: analysis?.volatility?.atrPct ?? null,
              trendPct: analysis?.trendPct ?? null,
              patterns: Array.isArray(analysis.patterns)
                ? analysis.patterns
                    .map((p) => p?.name)
                    .filter(Boolean)
                    .slice(0, 4)
                : []
            });
          }

          const aggregate = aggregateCandleAnalyses(analysesByTimeframe);
          if (aggregate) {
            technicalAnalysis.candlesByTimeframe = analysesByTimeframe;
            technicalAnalysis.candlesSummary = aggregate;
          }

          if (candleSignals.length) {
            technicalAnalysis.score = Number(
              clampLocal((technicalAnalysis.score || 0) + totalDelta, -100, 100).toFixed(2)
            );

            if (!Array.isArray(technicalAnalysis.signals)) {
              technicalAnalysis.signals = [];
            }
            technicalAnalysis.signals = [...candleSignals, ...technicalAnalysis.signals].slice(
              0,
              20
            );
          }
        }

        // If we only have a quote-derived candle (e.g. just 1 bar so far), keep the technical view
        // neutral but still expose lastPrice so the UI can display the market state.
        if (technicalAnalysis.latestPrice == null && Number.isFinite(midPrice)) {
          technicalAnalysis.latestPrice = midPrice;
        }

        // Light direction hint (non-authoritative) when snapshot missing.
        if (!technicalAnalysis.direction || technicalAnalysis.direction === 'NEUTRAL') {
          technicalAnalysis.direction =
            normalizeDirection(external?.snapshotDirection) || 'NEUTRAL';
        }

        return technicalAnalysis;
      };

      if (eaOnly || (brokerIsEa && eaHybrid)) {
        const now = Date.now();
        const normalizeDirection = (value) => {
          const raw = String(value || '').toUpperCase();
          if (raw === 'BUY' || raw === 'SELL' || raw === 'NEUTRAL') {
            return raw;
          }
          if (raw === 'BULLISH') {
            return 'BUY';
          }
          if (raw === 'BEARISH') {
            return 'SELL';
          }
          return 'NEUTRAL';
        };

        const [baseCurrency, quoteCurrency] =
          typeof this.splitPair === 'function'
            ? this.splitPair(pair)
            : [pair?.slice(0, 3), pair?.slice(3, 6)];

        if (eaHybrid) {
          // Hybrid: keep EA market data but run full macro/news analyzers.
          try {
            economicAnalysis = await this.analyzeEconomics(pair);
          } catch (_error) {
            economicAnalysis = {
              base: {
                currency: baseCurrency || 'BASE',
                timestamp: now,
                indicators: {},
                score: 0,
                sentiment: 'neutral',
                strength: 0
              },
              quote: {
                currency: quoteCurrency || 'QUOTE',
                timestamp: now,
                indicators: {},
                score: 0,
                sentiment: 'neutral',
                strength: 0
              },
              relativeSentiment: 0,
              direction: 'NEUTRAL',
              strength: 0,
              confidence: 0
            };
          }
        } else {
          // EA-only: macro baseline is neutral (unless EA calendar/news bias is present).
          economicAnalysis = {
            base: {
              currency: baseCurrency || 'BASE',
              timestamp: now,
              indicators: {},
              score: 0,
              sentiment: 'neutral',
              strength: 0
            },
            quote: {
              currency: quoteCurrency || 'QUOTE',
              timestamp: now,
              indicators: {},
              score: 0,
              sentiment: 'neutral',
              strength: 0
            },
            relativeSentiment: 0,
            direction: 'NEUTRAL',
            strength: 0,
            confidence: 0
          };
        }

        const externalEvents = Array.isArray(external?.events) ? external.events : [];
        const externalNewsItems = Array.isArray(external?.news) ? external.news : [];
        const calendarEvents = externalEvents
          .filter(Boolean)
          .slice(0, 50)
          .map((event) => ({
            ...event,
            source: event?.source || 'ea'
          }));

        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

        const parseMaybeNumber = (value) => {
          if (value == null) {
            return null;
          }
          if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
          }
          const raw = String(value).trim().replace(/,/g, '');
          if (!raw || raw === '-' || raw.toLowerCase() === 'n/a') {
            return null;
          }

          const multiplier = /[kmb]$/i.test(raw)
            ? raw.toLowerCase().endsWith('k')
              ? 1_000
              : raw.toLowerCase().endsWith('m')
                ? 1_000_000
                : 1_000_000_000
            : 1;

          const numeric = Number(raw.replace(/[%kmb]$/gi, ''));
          if (!Number.isFinite(numeric)) {
            return null;
          }
          return numeric * multiplier;
        };

        const isLowerBetterEvent = (name) => {
          const text = String(name || '').toLowerCase();
          return (
            text.includes('unemployment') ||
            text.includes('jobless') ||
            text.includes('claims') ||
            text.includes('unemploy')
          );
        };

        const computeEventBias = (events) => {
          const nowMs = Date.now();
          let biasScore = 0;
          let riskScore = 0;

          const scored = [];
          for (const event of events) {
            if (!event) {
              continue;
            }
            const currency = String(event.currency || '').toUpperCase();
            if (!currency || (currency !== baseCurrency && currency !== quoteCurrency)) {
              continue;
            }
            const impact = Number(event.impact);
            if (!Number.isFinite(impact)) {
              continue;
            }
            const t = Date.parse(event.time);
            if (!Number.isFinite(t)) {
              continue;
            }
            const minutesFromNow = (t - nowMs) / 60000;

            // Risk: upcoming events (future) weighted by proximity.
            if (minutesFromNow >= 0) {
              const proximity =
                minutesFromNow <= 120
                  ? 1
                  : minutesFromNow <= 360
                    ? 0.6
                    : minutesFromNow <= 1440
                      ? 0.35
                      : 0.15;
              riskScore += impact * proximity;
            }

            // Bias: released events with actual/forecast compare (recent only).
            const actual = parseMaybeNumber(event.actual);
            const forecast = parseMaybeNumber(event.forecast);
            if (actual == null || forecast == null) {
              continue;
            }
            const minutesSince = (nowMs - t) / 60000;
            if (minutesSince < 0 || minutesSince > 24 * 60) {
              continue;
            }

            const diff = actual - forecast;
            if (!Number.isFinite(diff) || diff === 0) {
              continue;
            }

            const lowerBetter = isLowerBetterEvent(event.event);
            const signRaw = diff > 0 ? 1 : -1;
            const signForCurrency = lowerBetter ? -signRaw : signRaw;
            const signForPair = currency === baseCurrency ? signForCurrency : -signForCurrency;
            const recency =
              minutesSince <= 90
                ? 1
                : minutesSince <= 240
                  ? 0.75
                  : minutesSince <= 720
                    ? 0.45
                    : 0.25;
            const eventScore = signForPair * impact * recency;
            biasScore += eventScore;

            scored.push({
              currency,
              event: event.event || event.title || 'Event',
              impact,
              time: event.time,
              actual: event.actual ?? null,
              forecast: event.forecast ?? null,
              score: Number(eventScore.toFixed(2))
            });
          }

          scored.sort((a, b) => Math.abs(Number(b.score || 0)) - Math.abs(Number(a.score || 0)));

          return {
            biasScore: Number(clamp(biasScore / 4, -25, 25).toFixed(2)),
            riskScore: Number(clamp(riskScore, 0, 100).toFixed(1)),
            topEvents: scored.slice(0, 5)
          };
        };

        const macro = computeEventBias(calendarEvents);

        const projectEvidenceItem = (item) => {
          if (!item) {
            return null;
          }
          const timestamp = Number.isFinite(Number(item.timestamp))
            ? Number(item.timestamp)
            : Number.isFinite(Number(item.publishedAt))
              ? Number(item.publishedAt)
              : null;
          return {
            headline: item.headline || item.title || 'Untitled',
            source: item.source || item.feedId || 'Unknown',
            timestamp,
            url: item.url || item.link || null,
            impact: Number.isFinite(Number(item.impact)) ? Number(item.impact) : null,
            score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
            sentimentLabel: item.sentimentLabel || null
          };
        };

        const externalEvidence = externalNewsItems
          .slice(0, 8)
          .map(projectEvidenceItem)
          .filter(Boolean);

        if (eaHybrid) {
          try {
            newsAnalysis = await this.analyzeNews(pair, { external });
          } catch (_error) {
            newsAnalysis = {
              sentiment: macro.biasScore,
              direction:
                macro.biasScore > 1.25
                  ? 'BUY'
                  : macro.biasScore < -1.25
                    ? 'SELL'
                    : normalizeDirection(external?.newsDirection) || 'neutral',
              impact: Math.max(Math.min(100, calendarEvents.length * 8), macro.riskScore),
              confidence: calendarEvents.length || externalNewsItems.length ? 100 : 0,
              upcomingEvents: calendarEvents.length,
              newsCount: externalNewsItems.length,
              sentimentFeeds: null,
              calendarEvents,
              eventBias: macro,
              newsSources: {
                eaBridge: true
              }
            };
          }
        } else {
          newsAnalysis = {
            sentiment: macro.biasScore,
            direction:
              macro.biasScore > 1.25
                ? 'BUY'
                : macro.biasScore < -1.25
                  ? 'SELL'
                  : normalizeDirection(external?.newsDirection) || 'neutral',
            impact: Math.max(Math.min(100, calendarEvents.length * 8), macro.riskScore),
            // In EA-only mode, calendar/headline presence is useful for *risk/blackout*
            // but is not reliable directional confidence.
            confidence: calendarEvents.length || externalNewsItems.length ? 20 : 0,
            upcomingEvents: calendarEvents.length,
            newsCount: externalNewsItems.length,
            sentimentFeeds: null,
            calendarEvents,
            eventBias: macro,
            newsSources: {
              eaBridge: true
            },
            evidence: {
              base: [],
              quote: [],
              external: externalEvidence
            }
          };
        }

        technicalAnalysis = await buildEaTechnical({ external, pair });
      } else {
        [economicAnalysis, newsAnalysis, technicalAnalysis] = await Promise.all([
          this.analyzeEconomics(pair),
          this.analyzeNews(pair, { external }),
          this.analyzeTechnical(pair)
        ]);
      }

      const externalQuote = external?.quote || null;
      const externalMidPrice =
        externalQuote &&
        (Number.isFinite(Number(externalQuote.bid)) || Number.isFinite(Number(externalQuote.ask)))
          ? (Number(externalQuote.bid || 0) + Number(externalQuote.ask || 0)) /
            (Number.isFinite(Number(externalQuote.bid)) &&
            Number.isFinite(Number(externalQuote.ask))
              ? 2
              : 1)
          : Number.isFinite(Number(externalQuote?.last))
            ? Number(externalQuote.last)
            : null;

      let marketPrice =
        (Number.isFinite(externalMidPrice) ? externalMidPrice : null) ??
        technicalAnalysis.latestPrice ??
        null;

      if (marketPrice == null) {
        try {
          marketPrice = await this.priceDataFetcher.getCurrentPrice(pair);
        } catch (_error) {
          marketPrice = null;
        }
      }
      technicalAnalysis.marketPrice = marketPrice;

      let dataQualityReport = null;

      // In EA-hybrid / EA-only mode we treat the EA bridge as the market-data source of truth.
      // The external data-quality guard uses priceDataFetcher providers that may not support
      // symbols (or require API keys), and should not hard-block EA-driven analysis.
      const skipExternalDataQuality = Boolean(brokerIsEa && (eaHybrid || eaOnly));

      if (skipExternalDataQuality) {
        // Provide a minimal "healthy" data-quality report so analysis-core won't fall back to
        // cached external assessments that can be stale/blocked for unsupported symbols.
        dataQualityReport = {
          pair,
          assessedAt: Date.now(),
          score: 92,
          status: 'healthy',
          recommendation: 'proceed',
          issues: ['ea_bridge_source', eaOnly ? 'ea_only_mode' : 'ea_hybrid_mode'],
          timeframeReports: null,
          spread: {
            status: null,
            pips: null,
            provider: brokerId || null,
            timestamp: externalQuote?.timestamp || null
          },
          weekendGap: { severity: 'none', maxPips: 0 },
          syntheticRelaxed: false,
          syntheticContext: null
        };
      } else if (
        !eaOnly &&
        (typeof this.assessMarketData === 'function' ||
          typeof this.getLatestDataQuality === 'function')
      ) {
        let existingAssessment = null;
        if (typeof this.getLatestDataQuality === 'function') {
          existingAssessment = this.getLatestDataQuality(pair);
        } else if (this.dataQualityAssessments instanceof Map) {
          existingAssessment = this.dataQualityAssessments.get(pair) || null;
        }

        const assessedAtValue =
          existingAssessment?.assessedAt instanceof Date
            ? existingAssessment.assessedAt.getTime()
            : Number(existingAssessment?.assessedAt);
        const freshnessMs = Number.isFinite(assessedAtValue)
          ? Date.now() - assessedAtValue
          : Infinity;
        const ttlMs = options?.dataQualityTtlMs ?? 5 * 60 * 1000;
        const needsRefresh = !existingAssessment || freshnessMs > ttlMs;

        if (needsRefresh && typeof this.assessMarketData === 'function') {
          try {
            dataQualityReport = await this.assessMarketData(pair, {
              timeframes: ['M15', 'H1', 'H4', 'D1'],
              bars: 240
            });
          } catch (error) {
            this.logger?.error?.(
              { module: 'OrchestrationCoordinator', pair, err: error },
              'Data quality guard failed'
            );
            dataQualityReport = existingAssessment || null;
          }
        } else {
          dataQualityReport = existingAssessment || null;
        }
      }

      const signal = this.combineAnalyses(
        pair,
        {
          economic: economicAnalysis,
          news: newsAnalysis,
          technical: technicalAnalysis
        },
        marketPrice,
        dataQualityReport
      );

      // EA-only execution data: use EA quote (bid/ask) to populate spreadPips so
      // validateSignal() can enforce execution/spread gates even when external
      // data-quality providers are skipped.
      if (
        signal &&
        typeof signal === 'object' &&
        external?.quote &&
        typeof external.quote === 'object'
      ) {
        const bid = Number(external.quote.bid);
        const ask = Number(external.quote.ask);
        const spreadPrice =
          Number.isFinite(bid) && Number.isFinite(ask) && ask > 0 && bid > 0 ? ask - bid : null;

        const spreadPips =
          spreadPrice != null && typeof this.calculatePips === 'function'
            ? Number(this.calculatePips(pair || '', Math.abs(spreadPrice)).toFixed(3))
            : null;

        if (!signal.components || typeof signal.components !== 'object') {
          signal.components = {};
        }
        const marketData =
          signal.components.marketData && typeof signal.components.marketData === 'object'
            ? signal.components.marketData
            : {};

        // Prefer EA spread when available; otherwise keep existing spreadPips.
        if (spreadPips != null && !Number.isNaN(spreadPips)) {
          marketData.spreadPips = spreadPips;
          if (!marketData.spreadStatus) {
            const maxSpreadPips = Number.isFinite(this.config?.maxSpreadPips)
              ? Number(this.config.maxSpreadPips)
              : 2.4;
            marketData.spreadStatus = spreadPips > maxSpreadPips ? 'critical' : 'healthy';
          }
        }

        // Minimal quote hints for liquidity/execution heuristics.
        marketData.eaQuote = {
          bid: Number.isFinite(bid) ? bid : null,
          ask: Number.isFinite(ask) ? ask : null,
          spreadPoints: Number.isFinite(Number(external.quote.spreadPoints))
            ? Number(external.quote.spreadPoints)
            : null,
          liquidityHint: external.quote.liquidityHint ?? null,
          volume: Number.isFinite(Number(external.quote.volume))
            ? Number(external.quote.volume)
            : null,
          // Use receipt time for freshness gates; EA timestamps can be missing/misaligned.
          timestamp: external.quote.receivedAt ?? external.quote.timestamp ?? null,
          receivedAt: external.quote.receivedAt ?? null,
          rawTimestamp: external.quote.timestamp ?? null,
          source: external.quote.source ?? null
        };

        signal.components.marketData = marketData;
      }

      // EA-only: attach intermarket correlation snapshot (bars-only, best-effort).
      try {
        const eaBridgeService = options?.eaBridgeService || null;
        if (eaOnly && brokerIsEa && eaBridgeService && signal && typeof signal === 'object') {
          const meta =
            typeof this.getInstrumentMetadata === 'function'
              ? this.getInstrumentMetadata(pair)
              : null;
          const correlation = computeIntermarketCorrelation({
            eaBridgeService,
            broker: brokerId,
            pair,
            assetClass: meta?.assetClass || null,
            timeframe: 'M15',
            window: 96,
            maxAgeMs: 0
          });

          if (!signal.components || typeof signal.components !== 'object') {
            signal.components = {};
          }
          signal.components.intermarket = {
            correlation
          };
        }
      } catch (_error) {
        // best-effort
      }

      // EA-only: attach compact telemetry for explainability + replay (best-effort).
      try {
        // Attach telemetry whenever the data source is MetaTrader (MT4/MT5), regardless of EA_ONLY_MODE.
        // This ensures explainability + the execution/news/liquidity gates work the same for MT4 and MT5.
        if (brokerIsEa && signal && typeof signal === 'object') {
          const pairKey = String(pair || signal.pair || '').trim();
          const assetClass =
            typeof this.classifyAssetClass === 'function' ? this.classifyAssetClass(pairKey) : null;

          if (!signal.components || typeof signal.components !== 'object') {
            signal.components = {};
          }

          const marketData = signal.components.marketData || {};
          const eaQuote =
            marketData?.eaQuote && typeof marketData.eaQuote === 'object'
              ? marketData.eaQuote
              : null;

          const quoteTelemetry =
            eaQuote && typeof this.recordQuoteTelemetry === 'function'
              ? this.recordQuoteTelemetry(pairKey, {
                  ...eaQuote,
                  spreadPips: marketData?.spreadPips ?? null
                })
              : { available: false, current: null, recent: [] };

          const sessionTelemetry =
            typeof this.computeSessionContext === 'function'
              ? this.computeSessionContext(assetClass, Date.now())
              : null;

          const newsTelemetry =
            typeof this.computeNewsTelemetry === 'function'
              ? this.computeNewsTelemetry(signal, pairKey, assetClass, Date.now())
              : null;

          signal.components.telemetry = {
            quote: quoteTelemetry?.current || null,
            quoteRecent: Array.isArray(quoteTelemetry?.recent) ? quoteTelemetry.recent : [],
            session: sessionTelemetry,
            news: newsTelemetry
          };
        }
      } catch (_error) {
        // best-effort
      }

      signal.riskManagement = this.calculateRiskManagement(signal);
      signal.isValid = this.validateSignal(signal);

      // If the signal is hard-blocked (invalid market / risk / blackout), convert into strict NEUTRAL.
      // If it's merely WAIT/MONITOR, keep the directional bias for explainability (but do not auto-execute).
      const decisionState = signal?.isValid?.decision?.state || null;
      const isBlocked =
        decisionState === 'NO_TRADE_BLOCKED' || Boolean(signal?.isValid?.decision?.blocked);
      if (signal?.isValid && signal.isValid.isValid === false && isBlocked) {
        signal.direction = 'NEUTRAL';
        signal.finalScore = 0;
        signal.strength = 0;
        signal.entry = null;
        signal.riskManagement = null;
        signal.tradePlan = this.buildTradePlan(pair, 'NEUTRAL', null, signal.estimatedWinRate, 0);

        const existingReasoning = Array.isArray(signal.reasoning) ? signal.reasoning : [];
        const gateReason = `Abstain: ${signal.isValid.reason || 'signal did not meet quality gates'}`;
        signal.reasoning = [...existingReasoning, gateReason].slice(0, 20);
      }

      // Live historical validation (recent bars) to reduce false positives.
      if (
        signal &&
        typeof signal === 'object' &&
        this.liveBacktestValidator &&
        typeof this.liveBacktestValidator.validateSignal === 'function'
      ) {
        try {
          const liveBacktest = await this.liveBacktestValidator.validateSignal(signal, pair);
          signal.components = signal.components || {};
          signal.components.liveBacktest = liveBacktest;

          if (liveBacktest && liveBacktest.passed === false) {
            const existingReasoning = Array.isArray(signal.reasoning) ? signal.reasoning : [];
            const filterReason = 'Live backtest validation failed';
            signal.reasoning = [...existingReasoning, `Filter: ${filterReason}`].slice(0, 20);

            const currentDecision =
              signal.isValid?.decision && typeof signal.isValid.decision === 'object'
                ? signal.isValid.decision
                : {};
            const currentState = currentDecision.state || null;
            const nextState = currentState === 'NO_TRADE_BLOCKED' ? currentState : 'WAIT_MONITOR';

            signal.isValid = {
              ...(signal.isValid || {}),
              isValid: false,
              reason: `Filtered: ${filterReason}`,
              checks: {
                ...(signal.isValid && typeof signal.isValid.checks === 'object'
                  ? signal.isValid.checks
                  : {}),
                liveBacktest: false
              },
              decision: {
                ...currentDecision,
                state: nextState,
                blocked: false,
                blockers: Array.isArray(currentDecision.blockers)
                  ? [...currentDecision.blockers, 'live_backtest']
                  : ['live_backtest']
              }
            };
          } else if (liveBacktest && liveBacktest.passed === true) {
            if (signal?.isValid && typeof signal.isValid === 'object') {
              signal.isValid.checks = {
                ...(signal.isValid.checks && typeof signal.isValid.checks === 'object'
                  ? signal.isValid.checks
                  : {}),
                liveBacktest: true
              };
            }
          }
        } catch (error) {
          this.logger?.warn?.(
            { module: 'OrchestrationCoordinator', pair, err: error },
            'Live backtest validation failed'
          );
        }
      }

      // Optional multi-layer filter to reduce false positives.
      // Enabled via ADVANCED_SIGNAL_FILTER_ENABLED=true (or dependency injection).
      if (
        signal &&
        typeof signal === 'object' &&
        this.advancedSignalFilter &&
        typeof this.advancedSignalFilter.filterSignal === 'function'
      ) {
        try {
          const marketData = signal.components?.marketData || {};
          const filterResult = await this.advancedSignalFilter.filterSignal(
            signal,
            pair,
            marketData
          );
          signal.components = signal.components || {};
          signal.components.advancedFilter = filterResult;

          if (filterResult && filterResult.passed === false) {
            const filterReason =
              Array.isArray(filterResult.reasons) && filterResult.reasons.length
                ? String(filterResult.reasons[0])
                : 'Advanced filter rejected signal';

            const existingReasoning = Array.isArray(signal.reasoning) ? signal.reasoning : [];
            const filterReasons = Array.isArray(filterResult.reasons)
              ? filterResult.reasons.map((r) => `Filter: ${String(r)}`)
              : [`Filter: ${filterReason}`];
            signal.reasoning = [...existingReasoning, ...filterReasons].slice(0, 20);

            // Downgrade to non-tradeable (but keep direction for explainability).
            const currentDecision =
              signal.isValid?.decision && typeof signal.isValid.decision === 'object'
                ? signal.isValid.decision
                : {};
            const currentState = currentDecision.state || null;
            const nextState = currentState === 'NO_TRADE_BLOCKED' ? currentState : 'WAIT_MONITOR';

            signal.isValid = {
              ...(signal.isValid || {}),
              isValid: false,
              reason: `Filtered: ${filterReason}`,
              checks: {
                ...(signal.isValid && typeof signal.isValid.checks === 'object'
                  ? signal.isValid.checks
                  : {}),
                advancedFilter: false
              },
              decision: {
                ...currentDecision,
                state: nextState,
                blocked: false,
                blockers: Array.isArray(currentDecision.blockers)
                  ? [...currentDecision.blockers, 'advanced_filter']
                  : ['advanced_filter']
              }
            };
          } else if (filterResult && filterResult.passed === true) {
            if (signal?.isValid && typeof signal.isValid === 'object') {
              signal.isValid.checks = {
                ...(signal.isValid.checks && typeof signal.isValid.checks === 'object'
                  ? signal.isValid.checks
                  : {}),
                advancedFilter: true
              };
            }
          }
        } catch (error) {
          this.logger?.warn?.(
            { module: 'OrchestrationCoordinator', pair, err: error },
            'Advanced signal filter failed'
          );
        }
      }

      if (signal && typeof signal === 'object') {
        const bucketize = (value, step = 10, max = 100) => {
          const n = Number(value);
          if (!Number.isFinite(n)) {
            return null;
          }
          const clamped = Math.max(0, Math.min(max, n));
          const low = Math.floor(clamped / step) * step;
          const high = Math.min(max, low + step);
          return `${low}-${high}`;
        };

        if (!signal.components || typeof signal.components !== 'object') {
          signal.components = {};
        }

        signal.components.calibration = {
          scoreBucket: bucketize(signal.finalScore, 10, 100),
          strengthBucket: bucketize(signal.strength, 10, 100),
          confidenceBucket: bucketize(signal.confidence, 10, 100),
          winRateBucket: bucketize(signal.estimatedWinRate, 5, 100)
        };
      }

      if (signal && typeof signal === 'object') {
        const reasons = Array.isArray(signal.reasoning) ? signal.reasoning : [];
        signal.finalDecision = {
          ...(signal.finalDecision && typeof signal.finalDecision === 'object'
            ? signal.finalDecision
            : {}),
          action: signal.direction,
          tradeValid: Boolean(signal.isValid?.isValid),
          state: signal?.isValid?.decision?.state || null,
          score: signal?.isValid?.decision?.score ?? null,
          blocked: Boolean(signal?.isValid?.decision?.blocked),
          reason: reasons.length ? reasons[0] : signal.isValid?.reason || null,
          reasons: reasons.slice(0, 4)
        };
      }

      // Signal validity lifecycle: compute an expiry so clients can show whether the signal
      // is still actionable, and execution logic can avoid acting on stale signals.
      if (signal && typeof signal === 'object') {
        const now = Date.now();
        const normalizeTf = (value) =>
          String(value || '')
            .trim()
            .toUpperCase();
        const tfToMinutes = (tf) => {
          const normalized = normalizeTf(tf);
          const map = {
            M1: 1,
            M2: 2,
            M3: 3,
            M5: 5,
            M10: 10,
            M15: 15,
            M30: 30,
            H1: 60,
            H2: 120,
            H3: 180,
            H4: 240,
            H6: 360,
            H8: 480,
            H12: 720,
            D1: 1440,
            W1: 10080
          };
          return map[normalized] || null;
        };

        const technical = signal.components?.technical || null;
        const primaryTfFromSignal = normalizeTf(technical?.signals?.[0]?.timeframe);
        const timeframes =
          technical?.timeframes && typeof technical.timeframes === 'object'
            ? Object.keys(technical.timeframes)
            : [];

        const tfCandidates = [primaryTfFromSignal, ...timeframes]
          .map((v) => normalizeTf(v))
          .filter(Boolean);
        const tfMinutes = tfCandidates
          .map((tf) => tfToMinutes(tf))
          .filter((v) => Number.isFinite(v) && v > 0)
          .sort((a, b) => a - b)[0];

        const baseMinutes = Number.isFinite(tfMinutes) ? tfMinutes : 15;
        const baseTtlMs = baseMinutes * 60 * 1000 * 3;

        const envMultiplier = Number(process.env.SIGNAL_VALIDITY_MULTIPLIER);
        const globalMultiplier =
          Number.isFinite(envMultiplier) && envMultiplier > 0 ? envMultiplier : 1;
        const minTtlMsEnv = Number(process.env.SIGNAL_MIN_VALIDITY_MS);
        const maxTtlMsEnv = Number(process.env.SIGNAL_MAX_VALIDITY_MS);
        const minTtlMs = Number.isFinite(minTtlMsEnv) && minTtlMsEnv > 0 ? minTtlMsEnv : 30 * 1000;
        const maxTtlMs =
          Number.isFinite(maxTtlMsEnv) && maxTtlMsEnv > 0 ? maxTtlMsEnv : 24 * 60 * 60 * 1000;

        const decisionState = signal?.isValid?.decision?.state || null;
        const isBlocked =
          decisionState === 'NO_TRADE_BLOCKED' || Boolean(signal?.isValid?.decision?.blocked);
        const tradeValid = Boolean(signal?.isValid?.isValid);
        const direction = normalizeTf(signal.direction);

        const decisionMultiplier = (() => {
          if (isBlocked) {
            return 0.2;
          }
          if (decisionState === 'WAIT_MONITOR') {
            return 0.6;
          }
          if (decisionState === 'ENTER' && tradeValid) {
            return 1;
          }
          if (direction === 'NEUTRAL') {
            return 0.2;
          }
          return 0.5;
        })();

        const ttlMs = Math.max(
          minTtlMs,
          Math.min(maxTtlMs, Math.round(baseTtlMs * globalMultiplier * decisionMultiplier))
        );
        const expiresAt = now + ttlMs;

        const signalStatus = (() => {
          if (now >= expiresAt) {
            return 'EXPIRED';
          }
          if (isBlocked) {
            return 'BLOCKED';
          }
          if (decisionState === 'WAIT_MONITOR') {
            return 'WATCH';
          }
          if (decisionState === 'ENTER' && tradeValid) {
            return 'ACTIVE';
          }
          if (direction === 'NEUTRAL') {
            return 'NEUTRAL';
          }
          return 'PENDING';
        })();

        signal.expiresAt = expiresAt;
        signal.signalStatus = signalStatus;
        signal.validity = {
          state: signalStatus,
          expiresAt,
          ttlMs,
          evaluatedAt: now,
          reason: signal?.isValid?.reason || null
        };
      }

      if (autoExecute) {
        const execution = await this.executeTrade(signal);
        return { signal, execution };
      }

      return signal;
    } catch (error) {
      const classified = this.classifyError?.(error, { scope: 'generateSignal', pair }) || {
        type: 'unknown',
        category: 'Unknown engine error',
        context: { scope: 'generateSignal', pair }
      };
      this.logger?.error?.(
        { module: 'OrchestrationCoordinator', pair, err: error, errorType: classified.type },
        'Signal generation error'
      );
      const fallback = this.getDefaultSignal(pair);
      if (fallback?.isValid && typeof fallback.isValid === 'object') {
        const message = String(error?.message || '').trim();
        if (message) {
          fallback.isValid.reason = `Error generating signal: ${message}`;
        }
      }
      if (autoExecute) {
        return {
          signal: fallback,
          execution: {
            success: false,
            reason: error.message,
            errorType: classified.type,
            signal: fallback
          }
        };
      }
      return fallback;
    }
  },

  async generateAndExecute(pair) {
    try {
      const result = await this.generateSignal(pair, { autoExecute: true });
      if (result && typeof result === 'object' && 'signal' in result) {
        return result;
      }
      return { signal: result, execution: null };
    } catch (error) {
      const classified = this.classifyError?.(error, { scope: 'generateAndExecute', pair }) || {
        type: 'unknown',
        category: 'Unknown engine error',
        context: { scope: 'generateAndExecute', pair }
      };
      this.logger?.error?.(
        { module: 'OrchestrationCoordinator', pair, err: error, errorType: classified.type },
        'Error in generateAndExecute'
      );
      const fallback = this.getDefaultSignal(pair);
      return {
        signal: fallback,
        execution: {
          success: false,
          reason: error.message,
          errorType: classified.type,
          signal: fallback
        }
      };
    }
  }
};
