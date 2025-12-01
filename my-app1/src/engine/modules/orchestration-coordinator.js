export const orchestrationCoordinator = {
  async generateSignal(pair, options = {}) {
    const { autoExecute = false } = options;

    try {
      this.logger?.debug?.({ module: 'OrchestrationCoordinator', pair }, 'Generating signal');

      if (this.featureStore && typeof this.featureStore.purgeExpired === 'function') {
        this.featureStore.purgeExpired();
      }

      const [economicAnalysis, newsAnalysis, technicalAnalysis] = await Promise.all([
        this.analyzeEconomics(pair),
        this.analyzeNews(pair),
        this.analyzeTechnical(pair)
      ]);

      const marketPrice =
        technicalAnalysis.latestPrice ?? (await this.priceDataFetcher.getCurrentPrice(pair));
      technicalAnalysis.marketPrice = marketPrice;

      let dataQualityReport = null;
      if (
        typeof this.assessMarketData === 'function' ||
        typeof this.getLatestDataQuality === 'function'
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
              timeframes: ['M15', 'H1', 'H4'],
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

      signal.riskManagement = this.calculateRiskManagement(signal);
      signal.isValid = this.validateSignal(signal);

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
