import { getPairMetadata } from '../../../config/pair-catalog.js';

export const analysisCore = {
  async analyzeEconomics(pair) {
    const metadata = this.getInstrumentMetadata?.(pair) || getPairMetadata(pair);

    if (!metadata || metadata.assetClass === 'forex') {
      const [baseCurrency, quoteCurrency] = this.splitPair(pair);

      const [baseAnalysis, quoteAnalysis] = await Promise.all([
        this.economicAnalyzer.analyzeCurrency(baseCurrency),
        this.economicAnalyzer.analyzeCurrency(quoteCurrency),
      ]);

      const relativeSentiment = (baseAnalysis.score ?? 0) - (quoteAnalysis.score ?? 0);

      return {
        base: baseAnalysis,
        quote: quoteAnalysis,
        relativeSentiment,
        direction: relativeSentiment > 10 ? 'BUY' : relativeSentiment < -10 ? 'SELL' : 'NEUTRAL',
        strength: Math.abs(relativeSentiment),
        confidence: Math.min((baseAnalysis.strength + quoteAnalysis.strength) / 2, 100),
      };
    }

    return await this.buildCrossAssetEconomicAssessment(pair, metadata);
  },

  async analyzeNews(pair, options = {}) {
    const analysis = await this.newsAnalyzer.analyzeNews(pair);

    const external = options?.external || null;
    const externalEvents = Array.isArray(external?.events) ? external.events : [];
    const externalNewsItems = Array.isArray(external?.news) ? external.news : [];
    const mergedCalendarEvents = Array.isArray(analysis.calendar) ? [...analysis.calendar] : [];

    if (externalEvents.length) {
      for (const event of externalEvents) {
        if (!event) {
          continue;
        }
        mergedCalendarEvents.push({
          ...event,
          source: event.source || 'ea',
        });
      }
    }

    const sources = {
      ...(analysis.sources || {}),
    };
    if (externalEvents.length || externalNewsItems.length) {
      sources.eaBridge = true;
    }

    const extraNewsCount = externalNewsItems.length;

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
        sentimentLabel: item.sentimentLabel || null,
      };
    };

    const evidenceBase = Array.isArray(analysis.baseNews) ? analysis.baseNews.slice(0, 8) : [];
    const evidenceQuote = Array.isArray(analysis.quoteNews) ? analysis.quoteNews.slice(0, 8) : [];
    const evidenceExternal = Array.isArray(externalNewsItems)
      ? externalNewsItems.slice(0, 8).map(projectEvidenceItem).filter(Boolean)
      : [];

    return {
      sentiment: analysis.sentiment.overall,
      direction: analysis.direction,
      impact: analysis.impact,
      confidence: analysis.confidence,
      upcomingEvents: mergedCalendarEvents.length,
      newsCount: analysis.baseNews.length + analysis.quoteNews.length + extraNewsCount,
      sentimentFeeds: analysis.sentimentFeeds || null,
      calendarEvents: mergedCalendarEvents,
      newsSources: sources,
      evidence: {
        base: evidenceBase.map(projectEvidenceItem).filter(Boolean),
        quote: evidenceQuote.map(projectEvidenceItem).filter(Boolean),
        external: evidenceExternal,
      },
    };
  },

  async analyzeTechnical(pair) {
    const analysis = await this.technicalAnalyzer.analyzeTechnical(pair, ['M15', 'H1', 'H4', 'D1']);

    return {
      score: analysis.overallScore,
      trend: analysis.trend,
      strength: analysis.strength,
      signals: analysis.signals,
      timeframes: analysis.timeframes,
      direction:
        analysis.overallScore > 15 ? 'BUY' : analysis.overallScore < -15 ? 'SELL' : 'NEUTRAL',
      latestPrice: analysis.latestPrice,
      directionSummary: analysis.directionSummary,
      regimeSummary: analysis.regimeSummary,
      volatilitySummary: analysis.volatilitySummary,
      divergenceSummary: analysis.divergenceSummary,
      volumePressureSummary: analysis.volumePressureSummary,
    };
  },

  combineAnalyses(pair, analyses, marketPrice, dataQualityReport = null) {
    const { economic, news, technical } = analyses;
    const dataConfidence = this.priceDataFetcher?.getAggregateDataConfidence?.() ?? null;

    let resolvedDataQuality = dataQualityReport;
    if (!resolvedDataQuality) {
      if (typeof this.getLatestDataQuality === 'function') {
        resolvedDataQuality = this.getLatestDataQuality(pair);
      } else if (this.dataQualityAssessments instanceof Map) {
        resolvedDataQuality = this.dataQualityAssessments.get(pair) || null;
      }
    }
    const availabilityReport = this.buildAvailabilityDataQualityReport(technical?.dataAvailability);
    if (availabilityReport) {
      resolvedDataQuality = resolvedDataQuality
        ? this.mergeDataQualityReports(resolvedDataQuality, availabilityReport)
        : availabilityReport;
    }

    const dataQualityContext = this.deriveDataQualityContext(resolvedDataQuality);

    const economicScore = this.normalizeScore(economic.relativeSentiment, -100, 100) * 100;
    const newsScore = this.normalizeScore(news.sentiment, -50, 50) * 100;
    const technicalScore = technical.score;

    const newsQuality = this.computeNewsQuality(news);
    const componentWeights = this.computeComponentWeights({
      economic,
      news,
      technical,
      dataConfidence,
      newsQuality,
      dataQualityContext,
    });

    // Optional ML scoring is intentionally disabled (EA+RSS-only architecture).

    const weightedComposite =
      economicScore * componentWeights.weights.economic +
      newsScore * componentWeights.weights.news +
      technicalScore * componentWeights.weights.technical;

    const amplifiedComposite = Math.max(
      -100,
      Math.min(100, weightedComposite * this.config.signalAmplifier)
    );

    let finalScore = amplifiedComposite;

    const directionPreQuality = this.determineDirection(finalScore, economic, news, technical);

    if (dataQualityContext.modifier !== 1) {
      const adjustedScore = Number((finalScore * dataQualityContext.modifier).toFixed(2));
      if (Number.isFinite(adjustedScore)) {
        finalScore = adjustedScore;
      }
    }
    finalScore = Math.max(-100, Math.min(100, finalScore));

    let direction = dataQualityContext.shouldBlock
      ? 'NEUTRAL'
      : this.determineDirection(finalScore, economic, news, technical);

    if (dataQualityContext.shouldBlock) {
      finalScore = 0;
    }

    const baseConfidence = this.calculateConfidence(economic, news, technical, dataConfidence, {
      newsQuality,
      componentWeights,
    });

    let confidence = baseConfidence;

    if (dataQualityContext.modifier !== 1) {
      const confidenceModifier = Math.min(1, 0.65 + dataQualityContext.modifier * 0.35);
      confidence *= confidenceModifier;
    }

    confidence -= dataQualityContext.confidencePenalty;
    if (dataQualityContext.stale) {
      confidence -= 4;
    }
    if (dataQualityContext.shouldBlock) {
      confidence = Math.min(confidence, 35);
    }

    if (
      !dataQualityContext.shouldBlock &&
      Number.isFinite(dataQualityContext.confidenceFloor) &&
      confidence < dataQualityContext.confidenceFloor &&
      !dataQualityContext.syntheticRelaxed
    ) {
      dataQualityContext.shouldBlock = true;
      dataQualityContext.confidenceFloorBreached = true;
      dataQualityContext.recommendation = dataQualityContext.recommendation || 'block';
      const issueList = Array.isArray(dataQualityContext.issues) ? dataQualityContext.issues : [];
      if (!issueList.includes('confidence_floor')) {
        issueList.push('confidence_floor');
      }
      dataQualityContext.issues = issueList;
      direction = 'NEUTRAL';
      finalScore = 0;
      confidence = Math.min(confidence, dataQualityContext.confidenceFloor - 3);
    }

    confidence = Math.max(0, Math.min(100, Number(confidence.toFixed(1))));

    let strength = Math.min(Math.abs(finalScore), 100);
    if (dataQualityContext.modifier !== 1) {
      const strengthModifier = Math.min(1, 0.5 + dataQualityContext.modifier * 0.5);
      strength *= strengthModifier;
    }
    if (dataQualityContext.shouldBlock) {
      strength = 0;
    }
    strength = Number(strength.toFixed(1));

    const entryParams = this.calculateEntryParameters(pair, direction, technical, marketPrice);

    const explainability = this.buildExplainability({
      pair,
      economic,
      news,
      technical,
      direction,
      confidence,
      strength,
      finalScore,
      dataQuality: resolvedDataQuality,
      dataQualityContext,
      directionPreQuality,
    });

    const reasoning = this.generateReasoning(explainability);
    const finalDecision = {
      action: direction,
      reason: Array.isArray(reasoning) && reasoning.length ? reasoning[0] : null,
      reasons: Array.isArray(reasoning) ? reasoning.slice(0, 4) : [],
      tradeValid: null,
    };

    let estimatedWinRate = this.estimateWinRate({
      direction,
      strength,
      confidence,
      entry: entryParams,
      components: { economic, news, technical },
    });

    if (resolvedDataQuality) {
      const modifier = Math.min(1, 0.6 + dataQualityContext.modifier * 0.4);
      const statusPenalty = dataQualityContext.shouldBlock
        ? 18
        : dataQualityContext.status === 'critical'
          ? 10
          : dataQualityContext.status === 'degraded'
            ? 5
            : 0;
      const issuePenalty = Math.min(12, dataQualityContext.issues.length * 1.5);
      estimatedWinRate = estimatedWinRate * modifier - statusPenalty - issuePenalty;
      if (dataQualityContext.shouldBlock) {
        estimatedWinRate = Math.min(estimatedWinRate, 45);
      }
      estimatedWinRate = Math.max(35, Math.min(95, estimatedWinRate));
    }
    estimatedWinRate = Number(estimatedWinRate.toFixed(1));

    const tradePlan = this.buildTradePlan(
      pair,
      direction,
      entryParams,
      estimatedWinRate,
      confidence
    );

    if (typeof this.evaluateVolatilityAlert === 'function') {
      const volatilitySnapshot = technical?.volatilitySummary || technical?.volatility || null;
      try {
        this.evaluateVolatilityAlert(pair, volatilitySnapshot, {
          strength,
          confidence,
          volatilityState: entryParams?.volatilityState || volatilitySnapshot?.state || null,
        });
      } catch (error) {
        console.warn(`Volatility alert evaluation failed for ${pair}:`, error.message);
      }
    }

    return {
      pair,
      timestamp: Date.now(),
      direction,
      strength,
      confidence,
      finalScore,
      estimatedWinRate,
      tradePlan,
      finalDecision,
      components: {
        economic: {
          score: economicScore,
          direction: economic.direction,
          confidence: economic.confidence,
          weight: Number(componentWeights.weights.economic.toFixed(3)),
          quality: {
            confidence: Number(Math.min(Math.max(economic.confidence || 0, 0), 100).toFixed(1)),
            normalized: Number((componentWeights.economicQuality ?? 0).toFixed(3)),
          },
          details: economic,
        },
        news: {
          score: newsScore,
          direction: news.direction,
          confidence: news.confidence,
          impact: news.impact,
          upcomingEvents: news.upcomingEvents,
          calendarEvents: Array.isArray(news.calendarEvents)
            ? news.calendarEvents.slice(0, 25)
            : [],
          newsSources: news.newsSources || null,
          evidence: news.evidence || null,
          newsCount: Number.isFinite(news.newsCount) ? news.newsCount : null,
          weight: Number(componentWeights.weights.news.toFixed(3)),
          quality: {
            reliability: Number(newsQuality.reliability.toFixed(3)),
            source: Number(newsQuality.sourceScore.toFixed(3)),
            coverage: Number(newsQuality.coverageScore.toFixed(3)),
            sentiment: Number(newsQuality.sentimentFeedScore.toFixed(3)),
            calendar: Number(newsQuality.calendarScore.toFixed(3)),
            syntheticSentimentSources: newsQuality.syntheticSentimentSources,
            syntheticNewsSources: newsQuality.syntheticNewsSources,
          },
        },
        technical: {
          score: technicalScore,
          direction: technical.direction,
          strength: technical.strength,
          signals: technical.signals,
          timeframes: technical.timeframes,
          latestPrice: technical.latestPrice,
          marketPrice,
          weight: Number(componentWeights.weights.technical.toFixed(3)),
          candlesSummary: technical.candlesSummary || null,
          candlesByTimeframe: technical.candlesByTimeframe || null,
          directionSummary: technical.directionSummary,
          regime: technical.regimeSummary ? { ...technical.regimeSummary } : null,
          volatility: technical.volatilitySummary ? { ...technical.volatilitySummary } : null,
          divergences: technical.divergenceSummary
            ? {
                bullish: Array.isArray(technical.divergenceSummary.bullish)
                  ? [...technical.divergenceSummary.bullish]
                  : [],
                bearish: Array.isArray(technical.divergenceSummary.bearish)
                  ? [...technical.divergenceSummary.bearish]
                  : [],
                total: technical.divergenceSummary.total ?? 0,
              }
            : { bullish: [], bearish: [], total: 0 },
          volumePressure: technical.volumePressureSummary
            ? { ...technical.volumePressureSummary }
            : null,
          dataConfidence,
          availability: technical.dataAvailability ? { ...technical.dataAvailability } : null,
          quality: {
            normalizedDataConfidence: Number(
              (Number.isFinite(dataConfidence)
                ? Math.max(0, Math.min(100, dataConfidence)) / 100
                : 0.7
              ).toFixed(3)
            ),
            technicalFactor: Number((componentWeights.technicalQuality ?? 0).toFixed(3)),
            dataQualityWeightFactor: Number(
              (componentWeights.dataQualityWeightFactor ?? 1).toFixed(3)
            ),
          },
        },
        marketData: resolvedDataQuality
          ? {
              score:
                dataQualityContext.score != null
                  ? Number(dataQualityContext.score.toFixed(1))
                  : null,
              status: dataQualityContext.status,
              recommendation: dataQualityContext.recommendation,
              modifier: Number(dataQualityContext.modifier.toFixed(3)),
              confidencePenalty: dataQualityContext.confidencePenalty,
              issues: dataQualityContext.issues.slice(0, 12),
              assessedAt: dataQualityContext.assessedAt,
              stale: dataQualityContext.stale,
              timeframeReports: resolvedDataQuality.timeframeReports || null,
              directionPreQuality,
              spreadStatus: dataQualityContext.spreadStatus || null,
              spreadPips: dataQualityContext.spreadPips,
              confidenceFloor: dataQualityContext.confidenceFloor ?? null,
              confidenceFloorBreached: dataQualityContext.confidenceFloorBreached,
              circuitBreaker: dataQualityContext.circuitBreaker || null,
              syntheticRelaxed: dataQualityContext.syntheticRelaxed,
              syntheticContext:
                resolvedDataQuality.syntheticContext || dataQualityContext.syntheticContext || null,
            }
          : null,
      },
      meta: {
        componentWeights: {
          economic: Number(componentWeights.weights.economic.toFixed(3)),
          news: Number(componentWeights.weights.news.toFixed(3)),
          technical: Number(componentWeights.weights.technical.toFixed(3)),
        },
        newsQuality,
        weightingDiagnostics: {
          economicQuality: Number((componentWeights.economicQuality ?? 0).toFixed(3)),
          newsReliability: Number(
            (componentWeights.newsReliability ?? newsQuality.reliability).toFixed(3)
          ),
          technicalQuality: Number((componentWeights.technicalQuality ?? 0).toFixed(3)),
          dataQualityWeightFactor: Number(
            (componentWeights.dataQualityWeightFactor ?? 1).toFixed(3)
          ),
          availabilityPenalty: Number((componentWeights.availabilityPenalty ?? 1).toFixed(3)),
          availabilitySeverity: componentWeights.availabilityPenaltyMeta?.severity ?? 'none',
          availabilityBlockedRatio: Number(
            (componentWeights.availabilityPenaltyMeta?.blockedRatio ?? 0).toFixed(3)
          ),
          availabilityBlockedTimeframes:
            componentWeights.availabilityPenaltyMeta?.blockedTimeframes || [],
          availabilityReasons: componentWeights.availabilityPenaltyMeta?.reasons || [],
          availabilityNormalizedQuality:
            componentWeights.availabilityPenaltyMeta?.normalizedQuality != null
              ? Number(componentWeights.availabilityPenaltyMeta.normalizedQuality.toFixed(3))
              : null,
          availabilityViable: componentWeights.availabilityPenaltyMeta?.viable ?? true,
        },
        dataQuality: resolvedDataQuality
          ? {
              score:
                dataQualityContext.score != null
                  ? Number(dataQualityContext.score.toFixed(1))
                  : null,
              status: dataQualityContext.status,
              recommendation: dataQualityContext.recommendation,
              modifier: Number(dataQualityContext.modifier.toFixed(3)),
              confidencePenalty: dataQualityContext.confidencePenalty,
              issues: dataQualityContext.issues.slice(0, 12),
              assessedAt: dataQualityContext.assessedAt,
              stale: dataQualityContext.stale,
              timeframeReports: resolvedDataQuality.timeframeReports || null,
              directionPreQuality,
              spreadStatus: dataQualityContext.spreadStatus || null,
              spreadPips: dataQualityContext.spreadPips,
              confidenceFloor: dataQualityContext.confidenceFloor ?? null,
              confidenceFloorBreached: dataQualityContext.confidenceFloorBreached,
              circuitBreaker: dataQualityContext.circuitBreaker || null,
              syntheticRelaxed: dataQualityContext.syntheticRelaxed,
              syntheticContext:
                resolvedDataQuality.syntheticContext || dataQualityContext.syntheticContext || null,
            }
          : null,
      },
      entry: entryParams,
      explainability,
      reasoning,
    };
  },

  determineDirection(finalScore, economic, news, technical) {
    const votes = [];

    if (economic.direction && economic.direction !== 'NEUTRAL') {
      votes.push(economic.direction);
    }

    const newsDirection = this.normalizeNewsDirection(news.direction);
    if (newsDirection) {
      votes.push(newsDirection);
    }

    if (technical.direction && technical.direction !== 'NEUTRAL') {
      votes.push(technical.direction);
    }

    if (technical.directionSummary) {
      Object.entries(technical.directionSummary).forEach(([dir, count]) => {
        if (dir === 'BUY' || dir === 'SELL') {
          for (let i = 0; i < count; i++) {
            votes.push(dir);
          }
        }
      });
    }

    const buyVotes = votes.filter((v) => v === 'BUY').length;
    const sellVotes = votes.filter((v) => v === 'SELL').length;

    const threshold = this.config.directionThreshold;

    if (finalScore >= threshold) {
      if (buyVotes >= sellVotes || finalScore >= threshold * 1.5) {
        return 'BUY';
      }
    }

    if (finalScore <= -threshold) {
      if (sellVotes >= buyVotes || finalScore <= -threshold * 1.5) {
        return 'SELL';
      }
    }

    if (finalScore >= threshold * 0.75 && buyVotes > sellVotes + 1) {
      return 'BUY';
    }

    if (finalScore <= -threshold * 0.75 && sellVotes > buyVotes + 1) {
      return 'SELL';
    }

    return 'NEUTRAL';
  },

  calculateConfidence(economic, news, technical, dataConfidence = null, qualityMeta = {}) {
    const economicConf = Math.min(Math.max(economic.confidence || 0, 0), 100);
    const newsConf = Math.min(Math.max(news.confidence || 0, 0), 100);
    const technicalConf = Math.min(Math.max(technical.strength || 0, 0), 100);
    const normalizedDataConfidence = Number.isFinite(dataConfidence)
      ? Math.max(0, Math.min(100, dataConfidence)) / 100
      : 0.7;

    const { newsQuality = null, componentWeights = null } = qualityMeta || {};
    const newsReliability = newsQuality?.reliability ?? componentWeights?.newsReliability ?? null;
    const technicalQuality =
      componentWeights?.technicalQuality ?? 0.5 + normalizedDataConfidence * 0.5;
    const economicQuality = componentWeights?.economicQuality ?? 0.5 + (economicConf / 100) * 0.5;

    const technicalWeightAdjustment = Math.max(0.35, Math.min(1.15, technicalQuality));
    const technicalContribution = technicalConf * 0.45 * technicalWeightAdjustment;

    const economicContribution =
      economicConf * 0.25 * Math.max(0.35, Math.min(1.1, economicQuality));

    const newsQualityBoost = newsReliability != null ? 0.3 + newsReliability * 0.7 : 0.6;
    const newsContribution = newsConf * 0.25 * Math.max(0.3, Math.min(1.1, newsQualityBoost));

    const weightedBlend = technicalContribution + economicContribution + newsContribution;

    const directionalVotes = [
      economic.direction,
      this.normalizeNewsDirection(news.direction),
      technical.direction,
    ].filter((dir) => dir && dir !== 'NEUTRAL');

    let alignmentBoost = 0;
    if (directionalVotes.length >= 3 && new Set(directionalVotes).size === 1) {
      alignmentBoost = 12;
    } else if (directionalVotes.length >= 2 && new Set(directionalVotes).size === 1) {
      alignmentBoost = 7;
    } else if (directionalVotes.length >= 1) {
      alignmentBoost = 3;
    }

    const trendMomentum = Math.min(Math.abs(technical.score || 0) / 2, 18);
    const newsImpactBoost = news.impact > 60 ? 6 : news.impact > 40 ? 4 : news.impact > 25 ? 2 : 0;
    const reliabilityBonus = newsReliability != null ? newsReliability * 8 : 0;

    const baseLift = 25;
    const confidence = Math.min(
      100,
      baseLift + weightedBlend + alignmentBoost + trendMomentum + newsImpactBoost + reliabilityBonus
    );
    return parseFloat(confidence.toFixed(1));
  },

  computeNewsQuality(news = {}) {
    const sources = news.newsSources || {};
    const activeMajorSources = ['aggregator', 'polygon', 'finnhub'].filter((key) =>
      Boolean(sources[key])
    ).length;
    const supplementalSources = ['rss', 'persistence'].filter((key) =>
      Boolean(sources[key])
    ).length;

    const sourceScore = Math.min(
      1,
      Math.max(0, activeMajorSources * 0.45 + supplementalSources * 0.2)
    );

    const coverageScore = Math.min(1, Math.max(0, (news.newsCount || 0) / 18));
    const calendarScore = Math.min(1, Math.max(0, (news.upcomingEvents || 0) / 6));
    const confidenceScore = Math.max(0, Math.min(1, (news.confidence || 0) / 100));

    const sentimentFeeds = news.sentimentFeeds || null;
    let sentimentFeedScore = 0.4;
    const syntheticSentimentSources = {};

    if (sentimentFeeds) {
      if (sentimentFeeds.sources && typeof sentimentFeeds.sources === 'object') {
        const entries = Object.entries(sentimentFeeds.sources);
        const realSources = entries.filter(([, isReal]) => Boolean(isReal)).length;
        const totalSources = entries.length || 1;
        sentimentFeedScore = Math.min(1, Math.max(0, realSources / totalSources + 0.2));
        entries.forEach(([key, isReal]) => {
          syntheticSentimentSources[key] = !Boolean(isReal);
        });
      }

      ['social', 'commitmentOfTraders', 'optionsFlow'].forEach((key) => {
        const detail = sentimentFeeds[key];
        if (detail && detail.source && !(key in syntheticSentimentSources)) {
          syntheticSentimentSources[key] = this.isSyntheticSource(detail.source);
        }
      });

      if (typeof sentimentFeeds.confidence === 'number') {
        sentimentFeedScore = Math.min(
          1,
          Math.max(sentimentFeedScore, sentimentFeeds.confidence / 100)
        );
      }
    }

    const syntheticNewsSourcesMap = Object.keys(sources).reduce((acc, key) => {
      acc[key] = !Boolean(sources[key]);
      return acc;
    }, {});

    const syntheticSentimentSummary =
      Object.keys(syntheticSentimentSources).length > 0 ? syntheticSentimentSources : null;
    const syntheticNewsSummary =
      Object.keys(syntheticNewsSourcesMap).length > 0 ? syntheticNewsSourcesMap : null;

    const reliability = Math.max(
      0.1,
      Math.min(
        1,
        sourceScore * 0.35 +
          coverageScore * 0.2 +
          sentimentFeedScore * 0.2 +
          confidenceScore * 0.2 +
          calendarScore * 0.05
      )
    );

    return {
      reliability,
      sourceScore,
      coverageScore,
      sentimentFeedScore,
      confidenceScore,
      calendarScore,
      syntheticSentimentSources: syntheticSentimentSummary,
      syntheticNewsSources: syntheticNewsSummary,
    };
  },

  computeComponentWeights({
    economic = {},
    news = {},
    technical = {},
    dataConfidence = null,
    newsQuality = null,
    dataQualityContext = null,
  }) {
    const baseWeights = { economic: 0.28, news: 0.32, technical: 0.4 };

    const economicQuality = Math.max(
      0.2,
      Math.min(1.2, (Math.min(Math.max(economic.confidence || 0, 0), 100) || 0) / 80)
    );
    const newsReliability = Math.max(
      0.15,
      Math.min(
        1.15,
        newsQuality?.reliability ?? (Math.min(Math.max(news.confidence || 0, 0), 100) || 0) / 110
      )
    );

    const technicalStrength = Math.min(Math.max(technical.strength || 0, 0), 100) / 100;
    const normalizedDataConfidence = Number.isFinite(dataConfidence)
      ? Math.max(0.2, Math.min(1.1, dataConfidence / 100))
      : 0.7;
    const baseTechnicalQuality = Math.max(
      0.2,
      Math.min(1.25, technicalStrength * 0.6 + normalizedDataConfidence * 0.6)
    );
    let technicalQuality = baseTechnicalQuality;

    let dataQualityWeightFactor = 1;
    if (dataQualityContext) {
      const candidate = Math.min(1, 0.55 + dataQualityContext.modifier * 0.45);
      dataQualityWeightFactor = Math.max(0.4, candidate);
      technicalQuality = Math.max(0.2, Math.min(1.25, technicalQuality * dataQualityWeightFactor));
    }

    const availabilityPenalty = this.deriveAvailabilityWeightPenalty(technical?.dataAvailability);
    technicalQuality = Math.max(0.2, Math.min(1.25, technicalQuality * availabilityPenalty.factor));
    const availabilityAdjustment = Math.max(0.35, Math.min(1, availabilityPenalty.factor));
    dataQualityWeightFactor = Math.max(
      0.35,
      Math.min(1, dataQualityWeightFactor * availabilityAdjustment)
    );

    const weighted = {
      economic: baseWeights.economic * economicQuality,
      news: baseWeights.news * newsReliability,
      technical: baseWeights.technical * technicalQuality,
    };

    const total = weighted.economic + weighted.news + weighted.technical;
    const weights =
      total > 0
        ? {
            economic: weighted.economic / total,
            news: weighted.news / total,
            technical: weighted.technical / total,
          }
        : { ...baseWeights };

    return {
      weights,
      economicQuality,
      newsReliability,
      technicalQuality,
      dataQualityWeightFactor,
      availabilityPenalty: availabilityPenalty.factor,
      availabilityPenaltyMeta: availabilityPenalty.meta,
      baseTechnicalQuality,
    };
  },

  deriveAvailabilityWeightPenalty(availability) {
    if (!availability) {
      return {
        factor: 1,
        meta: {
          severity: 'none',
          blockedRatio: 0,
          blockedTimeframes: [],
          reasons: [],
          normalizedQuality: null,
          viable: true,
        },
      };
    }

    const blockedFromList = Array.isArray(availability.blockedTimeframes)
      ? availability.blockedTimeframes
      : [];
    const blockedFromMap = Object.entries(availability.timeframes || {})
      .filter(([, detail]) => detail && detail.viable === false)
      .map(([timeframe]) => timeframe);
    const blockedSet = new Set([...blockedFromList, ...blockedFromMap]);
    const blockedTimeframes = Array.from(blockedSet);

    const totalTimeframes = Number.isFinite(availability.totalTimeframes)
      ? Math.max(0, availability.totalTimeframes)
      : Math.max(
          blockedSet.size,
          Object.keys(availability.timeframes || {}).length,
          (availability.availableTimeframes || []).length + blockedSet.size
        );
    const safeTotal = totalTimeframes > 0 ? totalTimeframes : Math.max(1, blockedSet.size || 1);
    const blockedRatio = Math.min(1, blockedTimeframes.length / safeTotal);

    let factor = 1 - blockedRatio * 0.65;
    if (availability.viable === false) {
      factor = Math.min(factor, 0.45);
    }

    if (Number.isFinite(availability.normalizedQuality)) {
      factor = Math.min(factor, Math.max(0.25, availability.normalizedQuality * 1.05));
    }

    const severity =
      availability.viable === false && blockedRatio >= 0.5
        ? 'critical'
        : blockedRatio >= 0.75
          ? 'critical'
          : blockedRatio >= 0.5
            ? 'high'
            : blockedRatio >= 0.25
              ? 'moderate'
              : blockedRatio > 0
                ? 'low'
                : 'none';

    factor = Math.max(0.25, Math.min(1, factor));

    return {
      factor,
      meta: {
        severity,
        blockedRatio,
        blockedTimeframes,
        reasons: Array.isArray(availability.reasons) ? [...availability.reasons] : [],
        normalizedQuality: Number.isFinite(availability.normalizedQuality)
          ? availability.normalizedQuality
          : null,
        viable: availability.viable !== false,
      },
    };
  },

  buildAvailabilityDataQualityReport(availability) {
    if (!availability || availability.viable !== false) {
      return null;
    }
    const totalTimeframes = Number.isFinite(availability.totalTimeframes)
      ? availability.totalTimeframes
      : Object.keys(availability.timeframes || {}).length;
    const safeTotal = totalTimeframes > 0 ? totalTimeframes : 1;
    const availableCount = Array.isArray(availability.availableTimeframes)
      ? availability.availableTimeframes.length
      : 0;
    const scoreBase = Math.round((availableCount / safeTotal) * 100);
    const issueReasons = Array.isArray(availability.reasons) ? availability.reasons : [];
    const issues = [
      'availability:providers_unavailable',
      ...new Set(issueReasons.map((reason) => `availability:${reason}`)),
    ];

    return {
      source: 'availability',
      assessedAt: availability.inspectedAt ?? Date.now(),
      status: 'critical',
      recommendation: 'block',
      score: Math.max(0, Math.min(100, scoreBase)),
      issues,
    };
  },

  mergeDataQualityReports(primary, addition) {
    if (!primary && !addition) {
      return null;
    }
    if (!primary) {
      return addition ? { ...addition } : null;
    }
    if (!addition) {
      return { ...primary };
    }

    const merged = { ...primary };
    const primaryIssues = Array.isArray(primary.issues) ? primary.issues : [];
    const additionIssues = Array.isArray(addition.issues) ? addition.issues : [];
    merged.issues = Array.from(new Set([...primaryIssues, ...additionIssues]));

    const assessedCandidates = [primary.assessedAt, addition.assessedAt]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (assessedCandidates.length > 0) {
      merged.assessedAt = Math.max(...assessedCandidates);
    }

    const statusPriority = (status) => {
      if (status === 'critical') {
        return 3;
      }
      if (status === 'degraded') {
        return 2;
      }
      if (status === 'healthy') {
        return 1;
      }
      return 0;
    };
    const additionStatusPriority = statusPriority(addition.status);
    const primaryStatusPriority = statusPriority(primary.status);
    merged.status =
      additionStatusPriority >= primaryStatusPriority
        ? (addition.status ?? primary.status ?? null)
        : (primary.status ?? addition.status ?? null);

    const recommendationPriority = (value) => {
      if (value === 'block') {
        return 3;
      }
      if (value === 'caution') {
        return 2;
      }
      if (value === 'monitor') {
        return 1;
      }
      return 0;
    };
    const additionRecommendationPriority = recommendationPriority(addition.recommendation);
    const primaryRecommendationPriority = recommendationPriority(primary.recommendation);
    merged.recommendation =
      additionRecommendationPriority >= primaryRecommendationPriority
        ? (addition.recommendation ?? primary.recommendation ?? null)
        : (primary.recommendation ?? addition.recommendation ?? null);

    if (Number.isFinite(primary.score) && Number.isFinite(addition.score)) {
      merged.score = Math.min(primary.score, addition.score);
    } else if (Number.isFinite(addition.score)) {
      merged.score = addition.score;
    } else if (Number.isFinite(primary.score)) {
      merged.score = primary.score;
    }

    if (addition.spread != null && merged.spread == null) {
      merged.spread = addition.spread;
    }

    if (primary.syntheticRelaxed || addition.syntheticRelaxed) {
      merged.syntheticRelaxed = Boolean(primary.syntheticRelaxed || addition.syntheticRelaxed);
      const suppressed = new Set();
      const notes = new Set();
      const primaryContext = primary.syntheticContext || {};
      const additionContext = addition.syntheticContext || {};
      (primaryContext.suppressedIssues || []).forEach((value) => suppressed.add(value));
      (additionContext.suppressedIssues || []).forEach((value) => suppressed.add(value));
      (primaryContext.notes || []).forEach((value) => notes.add(value));
      (additionContext.notes || []).forEach((value) => notes.add(value));
      merged.syntheticContext = {
        suppressedIssues: Array.from(suppressed),
        notes: Array.from(notes),
      };
    }

    return merged;
  },

  deriveDataQualityContext(report) {
    if (!report) {
      return {
        modifier: 1,
        confidencePenalty: 0,
        shouldBlock: false,
        score: null,
        status: null,
        recommendation: null,
        issues: [],
        assessedAt: null,
        stale: false,
        spreadStatus: null,
        spreadPips: null,
        confidenceFloor: null,
        confidenceFloorBreached: false,
        circuitBreaker: null,
      };
    }

    const assessedAtValue =
      report.assessedAt instanceof Date ? report.assessedAt.getTime() : Number(report.assessedAt);
    const assessedAt = Number.isFinite(assessedAtValue) ? assessedAtValue : null;

    const scoreValue = Number(report.score);
    const clampedScore = Number.isFinite(scoreValue)
      ? Math.max(0, Math.min(100, scoreValue))
      : null;

    let modifier = clampedScore != null ? Math.max(0.35, clampedScore / 100) : 1;

    if (report.status === 'critical') {
      modifier = Math.min(modifier, 0.55);
    } else if (report.status === 'degraded') {
      modifier = Math.min(modifier, 0.75);
    }

    if (report.recommendation === 'block') {
      modifier = Math.min(modifier, 0.35);
    } else if (report.recommendation === 'caution') {
      modifier = Math.min(modifier, 0.65);
    }

    const spreadStatus = report.spread?.status || null;
    if (spreadStatus === 'critical') {
      modifier = Math.min(modifier, 0.45);
    } else if (spreadStatus === 'elevated') {
      modifier = Math.min(modifier, 0.6);
    }

    const issues = Array.isArray(report.issues) ? report.issues.map((issue) => String(issue)) : [];
    const informationalIssues = new Set(['ea_bridge_source', 'ea_only_mode', 'ea_hybrid_mode']);
    const penalizedIssues = issues.filter((issue) => !informationalIssues.has(issue));
    const syntheticRelaxed = Boolean(report.syntheticRelaxed);
    const issuePenalty = Math.min(0.2, penalizedIssues.length * 0.03);
    if (syntheticRelaxed) {
      modifier = Math.max(0.5, modifier - issuePenalty * 0.3);
    } else {
      modifier = Math.max(0.3, modifier - issuePenalty);
    }

    const confidencePenaltyBase =
      report.status === 'critical' ? 18 : report.status === 'degraded' ? 10 : 0;
    let confidencePenalty = Math.max(
      0,
      Math.round(confidencePenaltyBase + penalizedIssues.length * 2.5)
    );
    if (spreadStatus === 'critical') {
      confidencePenalty += 12;
    } else if (spreadStatus === 'elevated') {
      confidencePenalty += 6;
    }

    if (report.weekendGap?.severity === 'critical') {
      confidencePenalty += 10;
    } else if (report.weekendGap?.severity === 'elevated') {
      confidencePenalty += 4;
    }

    if (syntheticRelaxed) {
      const relaxationFactor = spreadStatus === 'critical' ? 0.55 : 0.45;
      confidencePenalty = Math.max(0, Math.round(confidencePenalty * relaxationFactor));
    }

    const freshnessMs = assessedAt != null ? Date.now() - assessedAt : null;
    const stale = Number.isFinite(freshnessMs) && freshnessMs > 10 * 60 * 1000;

    const confidenceFloor = Number.isFinite(report.confidenceFloor)
      ? Number(report.confidenceFloor)
      : null;

    const circuitBreaker = report.circuitBreaker || null;

    let normalizedConfidenceFloor = confidenceFloor;
    if (syntheticRelaxed && normalizedConfidenceFloor != null) {
      normalizedConfidenceFloor = Math.max(35, normalizedConfidenceFloor - 10);
    }

    return {
      modifier: Number(modifier.toFixed(3)),
      confidencePenalty,
      shouldBlock: report.recommendation === 'block',
      score: clampedScore,
      status: report.status ?? null,
      recommendation: report.recommendation ?? null,
      issues,
      assessedAt,
      stale,
      spreadStatus,
      spreadPips: Number.isFinite(report.spread?.pips) ? Number(report.spread.pips) : null,
      confidenceFloor: normalizedConfidenceFloor,
      confidenceFloorBreached: false,
      circuitBreaker,
      syntheticRelaxed,
      syntheticContext: report.syntheticContext || null,
    };
  },

  async buildCrossAssetEconomicAssessment(pair, metadata) {
    const baseProfile = await this.buildAssetMacroProfile(metadata);
    const quoteProfile = await this.resolveQuoteMacroProfile(metadata);

    const baseScore = baseProfile?.score ?? 0;
    const quoteScore = quoteProfile?.score ?? 0;
    const relativeSentiment = baseScore - quoteScore;
    const absolute = Math.abs(relativeSentiment);

    const direction = relativeSentiment > 8 ? 'BUY' : relativeSentiment < -8 ? 'SELL' : 'NEUTRAL';
    const strength = Math.min(Math.round(absolute), 100);
    const baseConfidence =
      25 + Math.min(absolute * 1.2, metadata.assetClass === 'crypto' ? 28 : 35);
    const confidence = Math.max(
      20,
      Math.min(metadata.assetClass === 'crypto' ? 55 : 65, baseConfidence)
    );

    return {
      base: baseProfile,
      quote: quoteProfile,
      relativeSentiment,
      direction,
      strength,
      confidence,
    };
  },

  async resolveQuoteMacroProfile(metadata) {
    const quote = metadata?.quote || 'USD';
    if (quote && quote.length === 3 && this.economicAnalyzer?.analyzeCurrency) {
      try {
        return await this.economicAnalyzer.analyzeCurrency(quote);
      } catch (error) {
        console.warn(
          `Quote macro profile fallback for ${metadata?.pair || 'instrument'}: ${error.message}`
        );
      }
    }

    if (this.economicAnalyzer?.getDefaultAnalysis) {
      return {
        ...this.economicAnalyzer.getDefaultAnalysis(quote),
        assetClass: metadata?.assetClass || 'multi',
      };
    }

    return this.buildNeutralMacroProfile(quote, metadata?.assetClass);
  },

  async buildAssetMacroProfile(metadata) {
    const base = metadata?.base || metadata?.pair || 'ASSET';
    const assetClass = metadata?.assetClass || 'multi';
    const now = Date.now();

    const score = await this.estimateAssetMacroScore(metadata);
    const sentiment = score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral';
    const strength = Math.min(Math.abs(score), 100);

    const structuralIndicator = {
      value: score,
      impact: score,
      trend: sentiment,
      source: 'CrossAssetModel',
    };

    return {
      currency: base,
      assetClass,
      timestamp: now,
      indicators: { structural: structuralIndicator },
      score,
      sentiment,
      strength,
    };
  },

  async estimateAssetMacroScore(metadata) {
    const assetClass = metadata?.assetClass;
    const base = metadata?.base || metadata?.pair;

    const featureAccessor = this.featureStore?.getMetric?.bind(this.featureStore);
    const macroSourceKey = assetClass ? `${assetClass.toLowerCase()}_sentiment` : null;

    if (featureAccessor && macroSourceKey) {
      try {
        const metric = await featureAccessor('macro', macroSourceKey);
        if (metric && Number.isFinite(metric?.value)) {
          return Number(metric.value);
        }
      } catch (error) {
        console.warn(
          `Feature store macro metric unavailable for ${macroSourceKey}: ${error.message}`
        );
      }
    }

    if (this.newsInsights instanceof Map && this.newsInsights.size > 0 && base) {
      const insight = this.newsInsights.get(base) || this.newsInsights.get(metadata?.pair);
      if (insight && Number.isFinite(insight.sentiment)) {
        return Number(insight.sentiment) * 0.8;
      }
    }

    return 0;
  },

  buildNeutralMacroProfile(identifier, assetClass = 'multi') {
    return {
      currency: identifier,
      assetClass,
      timestamp: Date.now(),
      indicators: {},
      score: 0,
      sentiment: 'neutral',
      strength: 0,
    };
  },

  isSyntheticSource(value) {
    if (value === null || value === undefined) {
      return true;
    }
    if (typeof value === 'boolean') {
      return !value;
    }
    return String(value).toLowerCase().startsWith('synthetic');
  },

  normalizeNewsDirection(direction) {
    if (!direction) {
      return null;
    }

    const map = {
      strong_buy: 'BUY',
      buy: 'BUY',
      bullish: 'BUY',
      strong_sell: 'SELL',
      sell: 'SELL',
      bearish: 'SELL',
    };

    return map[direction] || null;
  },
};
