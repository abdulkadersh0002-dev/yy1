import { ingestHistoricalPrices } from './historical-price-etl.js';
import { ingestMacroEvents } from './macro-events-etl.js';
import { ingestHistoricalNews } from './news-etl.js';
import { normalizeFeatureSnapshots } from './feature-normalizer.js';

export class HistoricalWarehouseRunner {
  constructor(config = {}) {
    this.config = config;
  }

  async run(options = {}) {
    const dryRun = options.dryRun ?? this.config.dryRun ?? false;
    const sharedOptions = {
      dryRun
    };

    const summary = {
      dryRun,
      priceSources: 0,
      macroSources: 0,
      newsSources: 0,
      priceResults: [],
      macroResults: [],
      newsResults: [],
      featureNormalization: null
    };

    if (Array.isArray(this.config.prices) && this.config.prices.length > 0) {
      summary.priceSources = this.config.prices.length;
      summary.priceResults = await ingestHistoricalPrices(this.config.prices, {
        ...sharedOptions,
        chunkSize: this.config.priceChunkSize || options.priceChunkSize
      });
    }

    if (Array.isArray(this.config.macro) && this.config.macro.length > 0) {
      summary.macroSources = this.config.macro.length;
      summary.macroResults = await ingestMacroEvents(this.config.macro, {
        ...sharedOptions,
        chunkSize: this.config.macroChunkSize || options.macroChunkSize
      });
    }

    if (Array.isArray(this.config.news) && this.config.news.length > 0) {
      summary.newsSources = this.config.news.length;
      summary.newsResults = await ingestHistoricalNews(this.config.news, {
        ...sharedOptions,
        chunkSize: this.config.newsChunkSize || options.newsChunkSize
      });
    }

    if (this.shouldNormalizeFeatures()) {
      summary.featureNormalization = await normalizeFeatureSnapshots({
        dryRun,
        batchSize: this.config.normalizeFeatureStore?.batchSize || options.normalizeBatchSize,
        since: this.config.normalizeFeatureStore?.since || options.normalizeSince,
        until: this.config.normalizeFeatureStore?.until || options.normalizeUntil
      });
    }

    return summary;
  }

  shouldNormalizeFeatures() {
    if (this.config.normalizeFeatureStore == null) {
      return false;
    }
    if (typeof this.config.normalizeFeatureStore === 'boolean') {
      return this.config.normalizeFeatureStore === true;
    }
    return this.config.normalizeFeatureStore.enabled !== false;
  }
}

export default HistoricalWarehouseRunner;
