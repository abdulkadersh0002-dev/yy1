import { getPairMetadata } from '../../../config/pair-catalog.js';

export const persistenceHub = {
  recordNewsInsights(pair, analysis) {
    if (!pair || !analysis) {
      return;
    }

    const now = Date.now();
    const metadata = this.getInstrumentMetadata?.(pair) || getPairMetadata(pair);
    const [baseCurrency, quoteCurrency] =
      typeof this.splitPair === 'function'
        ? this.splitPair(pair)
        : [metadata?.base || pair.substring(0, 3), metadata?.quote || pair.substring(3, 6)];

    const calendar = Array.isArray(analysis.calendar)
      ? analysis.calendar.slice(0, 20).map((event) => ({
          pair,
          currency: event.currency || baseCurrency,
          event: event.event || event.title || 'Economic Event',
          impact: Number.isFinite(event.impact) ? Number(event.impact) : 0,
          time: event.time || event.datetime || event.dateTime || null,
          source: event.source || 'Unknown',
          actual: event.actual ?? null,
          forecast: event.forecast ?? null,
          previous: event.previous ?? null
        }))
      : [];

    const sentimentFeeds = analysis.sentimentFeeds
      ? {
          compositeScore: Number(analysis.sentimentFeeds.compositeScore ?? 0),
          confidence: Number(analysis.sentimentFeeds.confidence ?? 0),
          social: analysis.sentimentFeeds.social || null,
          commitmentOfTraders: analysis.sentimentFeeds.commitmentOfTraders || null,
          optionsFlow: analysis.sentimentFeeds.optionsFlow || null,
          sources: analysis.sentimentFeeds.sources || analysis.sources || {}
        }
      : null;

    const entry = {
      pair,
      storedAt: now,
      sentiment: analysis.sentiment?.overall ?? 0,
      impact: analysis.impact ?? 0,
      direction: analysis.direction || 'neutral',
      confidence: analysis.confidence ?? 0,
      newsCount: (analysis.baseNews?.length || 0) + (analysis.quoteNews?.length || 0),
      sources: analysis.sources || {},
      assetClass: metadata?.assetClass || null,
      baseCurrency,
      quoteCurrency,
      calendar,
      sentimentFeeds
    };

    this.newsInsights.set(pair, entry);

    if (this.newsInsights.size > 64) {
      const oldest = Array.from(this.newsInsights.entries()).sort(
        (a, b) => a[1].storedAt - b[1].storedAt
      )[0];
      if (oldest) {
        this.newsInsights.delete(oldest[0]);
      }
    }
  },

  getMarketInsights(options = {}) {
    const limitPairs = options.limitPairs ?? 8;
    const limitEvents = options.limitEvents ?? 12;
    const now = Date.now();

    if (!this.newsInsights || this.newsInsights.size === 0) {
      return {
        updatedAt: now,
        pairs: [],
        upcomingEvents: [],
        sentiment: []
      };
    }

    const entries = Array.from(this.newsInsights.values()).sort((a, b) => b.storedAt - a.storedAt);

    const pairs = entries.slice(0, limitPairs).map((entry) => ({
      pair: entry.pair,
      storedAt: entry.storedAt,
      direction: entry.direction,
      sentiment: Number(entry.sentiment || 0),
      impact: Number(entry.impact || 0),
      confidence: Number(entry.confidence || 0),
      newsCount: entry.newsCount || 0,
      calendarEvents: entry.calendar.length,
      sources: entry.sources || {}
    }));

    const upcomingEvents = [];
    entries.forEach((entry) => {
      entry.calendar.forEach((event) => {
        if (!event.time) {
          return;
        }
        const eventTime = new Date(event.time).getTime();
        if (!Number.isFinite(eventTime)) {
          return;
        }
        if (eventTime >= now - 3600000 && eventTime <= now + 72 * 3600000) {
          upcomingEvents.push({
            pair: entry.pair,
            time: new Date(eventTime).toISOString(),
            impact: event.impact,
            event: event.event,
            source: event.source,
            currency: event.currency,
            forecast: event.forecast,
            previous: event.previous,
            actual: event.actual,
            storedAt: entry.storedAt
          });
        }
      });
    });

    upcomingEvents.sort((a, b) => {
      if (b.storedAt !== a.storedAt) {
        return b.storedAt - a.storedAt;
      }
      return new Date(a.time) - new Date(b.time);
    });

    const sentiment = entries
      .filter((entry) => entry.sentimentFeeds)
      .map((entry) => ({
        pair: entry.pair,
        storedAt: entry.storedAt,
        compositeScore: Number(entry.sentimentFeeds.compositeScore || 0),
        confidence: Number(entry.sentimentFeeds.confidence || 0),
        social: entry.sentimentFeeds.social || null,
        commitmentOfTraders: entry.sentimentFeeds.commitmentOfTraders || null,
        optionsFlow: entry.sentimentFeeds.optionsFlow || null,
        sources: entry.sentimentFeeds.sources || {}
      }));

    return {
      updatedAt: now,
      pairs,
      upcomingEvents: upcomingEvents.slice(0, limitEvents),
      sentiment
    };
  },

  getLatestFeatures(pair, timeframe) {
    if (!this.featureStore) {
      return null;
    }
    return this.featureStore.getLatest(pair, timeframe);
  },

  getFeatureRange(pair, timeframe, options = {}) {
    if (!this.featureStore) {
      return [];
    }
    return this.featureStore.getRange(pair, timeframe, options);
  },

  getFeatureSnapshot(pair, options = {}) {
    if (!this.featureStore) {
      return { pair, timeframes: {}, updatedAt: Date.now() };
    }
    return this.featureStore.getSnapshot(pair, options);
  },

  getFeatureSnapshots(limit = 100) {
    if (!this.featureStore) {
      return [];
    }
    return this.featureStore.getAllLatest(limit);
  },

  getDataQualityDiagnostics(limit = 20) {
    if (!this.dataQualityAssessments) {
      return [];
    }
    const entries = Array.from(this.dataQualityAssessments.values()).sort(
      (a, b) => (b.assessedAt || 0) - (a.assessedAt || 0)
    );
    return entries.slice(0, Math.max(Number(limit) || 0, 0));
  },

  getLatestDataQuality(pair) {
    if (!this.dataQualityAssessments) {
      return null;
    }
    return this.dataQualityAssessments.get(pair) || null;
  },

  getStatistics() {
    const closed = this.tradingHistory;
    const wins = closed.filter((t) => parseFloat(t.finalPnL.percentage) > 0);
    const losses = closed.filter((t) => parseFloat(t.finalPnL.percentage) < 0);

    const totalPnL = closed.reduce((sum, t) => sum + parseFloat(t.finalPnL.percentage), 0);
    const avgWin =
      wins.length > 0
        ? wins.reduce((sum, t) => sum + parseFloat(t.finalPnL.percentage), 0) / wins.length
        : 0;
    const avgLoss =
      losses.length > 0
        ? losses.reduce((sum, t) => sum + parseFloat(t.finalPnL.percentage), 0) / losses.length
        : 0;

    return {
      totalTrades: closed.length,
      activeTrades: this.activeTrades.size,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(2) : 0,
      totalPnL: totalPnL.toFixed(2),
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      profitFactor: avgLoss !== 0 ? Math.abs(avgWin / avgLoss).toFixed(2) : 0,
      dailyRiskUsed: (this.dailyRisk * 100).toFixed(2)
    };
  }
};
