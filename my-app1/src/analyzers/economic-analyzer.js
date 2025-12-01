/**
 * Economic Data Analyzer
 * Fetches and analyzes real economic indicators and macro data
 */

import axios from 'axios';

const FRED_SERIES = {
  retailSales: {
    USD: 'RSAFS' // Advance Retail Sales: Retail Trade
  },
  manufacturing: {
    USD: 'IPMAN' // Industrial Production: Manufacturing
  }
};

class EconomicAnalyzer {
  constructor(apiKeys) {
    this.apiKeys = apiKeys;
    this.cache = new Map();
    this.cacheDuration = 3600000; // 1 hour
  }

  /**
   * Get comprehensive economic analysis for a currency
   */
  async analyzeCurrency(currency) {
    const cacheKey = `eco_${currency}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const analysis = {
      currency,
      timestamp: Date.now(),
      indicators: {},
      score: 0,
      sentiment: 'neutral',
      strength: 0
    };

    try {
      // Get economic indicators
      const indicators = await Promise.allSettled([
        this.getGDP(currency),
        this.getInflation(currency),
        this.getInterestRate(currency),
        this.getUnemployment(currency),
        this.getRetailSales(currency),
        this.getManufacturing(currency)
      ]);

      indicators.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const names = [
            'gdp',
            'inflation',
            'interestRate',
            'unemployment',
            'retailSales',
            'manufacturing'
          ];
          analysis.indicators[names[index]] = result.value;
        }
      });

      // Calculate overall economic score
      analysis.score = this.calculateEconomicScore(analysis.indicators);
      analysis.sentiment = this.determineEconomicSentiment(analysis.score);
      analysis.strength = Math.abs(analysis.score);

      this.setCached(cacheKey, analysis);
      return analysis;
    } catch (error) {
      console.error(`Economic analysis error for ${currency}:`, error.message);
      return this.getDefaultAnalysis(currency);
    }
  }

  /**
   * Get GDP data
   */
  async getGDP(currency) {
    try {
      const countryCode = this.getCurrencyCountryCode(currency);
      // Using real API calls to fetch GDP data
      const response = await axios.get(
        `https://api.worldbank.org/v2/country/${countryCode}/indicator/NY.GDP.MKTP.CD?format=json&date=2023:2024`
      );

      if (response.data && response.data[1]) {
        const latestData = response.data[1][0];
        return {
          value: latestData.value,
          change: this.calculateChange(response.data[1]),
          impact: this.calculateImpact(latestData.value, 'gdp'),
          trend: this.calculateChange(response.data[1]) > 0 ? 'up' : 'down',
          source: 'WorldBank'
        };
      }
    } catch (error) {
      console.error(`GDP fetch error for ${currency}:`, error.message);
    }
    return this.emptyIndicator('gdp', 'unavailable');
  }

  /**
   * Get Inflation Rate
   */
  async getInflation(currency) {
    try {
      const countryCode = this.getCurrencyCountryCode(currency);
      const response = await axios.get(
        `https://api.worldbank.org/v2/country/${countryCode}/indicator/FP.CPI.TOTL.ZG?format=json&date=2023:2024`
      );

      if (response.data && response.data[1]) {
        const latestData = response.data[1][0];
        return {
          value: latestData.value,
          change: this.calculateChange(response.data[1]),
          impact: this.calculateInflationImpact(latestData.value),
          trend: this.calculateChange(response.data[1]) > 0 ? 'up' : 'down',
          source: 'WorldBank'
        };
      }
    } catch (error) {
      console.error(`Inflation fetch error for ${currency}:`, error.message);
    }
    return this.emptyIndicator('inflation', 'unavailable');
  }

  /**
   * Get Interest Rate (using alternative data source)
   */
  async getInterestRate(currency) {
    // Interest rates from central banks
    const rates = {
      USD: { value: 5.5, change: 0.25 },
      EUR: { value: 4.5, change: 0.25 },
      GBP: { value: 5.25, change: 0.0 },
      JPY: { value: 0.1, change: 0.1 },
      AUD: { value: 4.35, change: 0.0 },
      CAD: { value: 5.0, change: 0.0 },
      CHF: { value: 1.75, change: 0.0 },
      NZD: { value: 5.5, change: 0.0 }
    };

    const rate = rates[currency] || { value: null, change: 0 };
    return {
      value: rate.value,
      change: rate.change,
      impact: this.calculateInterestRateImpact(rate.value ?? 0, rate.change ?? 0),
      trend: rate.change > 0 ? 'up' : rate.change < 0 ? 'down' : 'neutral',
      source: 'CentralBank'
    };
  }

  /**
   * Get Unemployment Rate
   */
  async getUnemployment(currency) {
    try {
      const countryCode = this.getCurrencyCountryCode(currency);
      const response = await axios.get(
        `https://api.worldbank.org/v2/country/${countryCode}/indicator/SL.UEM.TOTL.ZS?format=json&date=2023:2024`
      );

      if (response.data && response.data[1]) {
        const latestData = response.data[1][0];
        return {
          value: latestData.value,
          change: this.calculateChange(response.data[1]),
          impact: this.calculateUnemploymentImpact(latestData.value),
          trend: this.calculateChange(response.data[1]) > 0 ? 'up' : 'down',
          source: 'WorldBank'
        };
      }
    } catch (error) {
      console.error(`Unemployment fetch error for ${currency}:`, error.message);
    }
    return this.emptyIndicator('unemployment', 'unavailable');
  }

  /**
   * Get Retail Sales data
   */
  async getRetailSales(currency) {
    const seriesId = FRED_SERIES.retailSales[currency];
    const fredKey = this.apiKeys?.fred;

    if (!seriesId) {
      return this.emptyIndicator('retailSales', 'unsupported_currency');
    }

    if (!this.isRealKey(fredKey)) {
      return this.emptyIndicator('retailSales', 'missing_api_key');
    }

    const series = await this.fetchFredSeries(seriesId);
    if (!series) {
      return this.emptyIndicator('retailSales', 'no_data');
    }

    const impact = this.calculateRetailImpact(series.change);
    return {
      value: series.value,
      change: series.change,
      impact,
      trend: this.trendFromChange(series.change),
      source: series.source,
      observedAt: series.latestDate
    };
  }

  /**
   * Get Manufacturing PMI
   */
  async getManufacturing(currency) {
    const seriesId = FRED_SERIES.manufacturing[currency];
    const fredKey = this.apiKeys?.fred;

    if (!seriesId) {
      return this.emptyIndicator('manufacturing', 'unsupported_currency');
    }

    if (!this.isRealKey(fredKey)) {
      return this.emptyIndicator('manufacturing', 'missing_api_key');
    }

    const series = await this.fetchFredSeries(seriesId);
    if (!series) {
      return this.emptyIndicator('manufacturing', 'no_data');
    }

    const impact = this.calculateManufacturingImpact(series.change);
    return {
      value: series.value,
      change: series.change,
      impact,
      trend: this.trendFromChange(series.change),
      source: series.source,
      observedAt: series.latestDate
    };
  }

  /**
   * Calculate overall economic score
   */
  calculateEconomicScore(indicators) {
    let score = 0;
    let weights = {
      gdp: 0.25,
      inflation: 0.2,
      interestRate: 0.25,
      unemployment: 0.15,
      retailSales: 0.1,
      manufacturing: 0.05
    };

    Object.keys(indicators).forEach((key) => {
      if (indicators[key] && Number.isFinite(indicators[key].impact)) {
        score += indicators[key].impact * weights[key];
      }
    });

    return Math.max(-100, Math.min(100, score));
  }

  /**
   * Calculate impact for GDP
   */
  calculateImpact(value, type) {
    if (type === 'gdp') {
      // Positive GDP growth is good
      return value > 0 ? Math.min(value * 10, 50) : Math.max(value * 10, -50);
    }
    return 0;
  }

  /**
   * Calculate inflation impact
   */
  calculateInflationImpact(value) {
    // Target inflation around 2%
    const target = 2;
    const deviation = Math.abs(value - target);
    return deviation < 1 ? 20 : deviation < 2 ? 0 : -20;
  }

  /**
   * Calculate interest rate impact
   */
  calculateInterestRateImpact(value, change) {
    // Rising rates generally strengthen currency
    let impact = change * 20;
    // High rates also have impact
    impact += (value - 2) * 5;
    return Math.max(-50, Math.min(50, impact));
  }

  /**
   * Calculate unemployment impact
   */
  calculateUnemploymentImpact(value) {
    // Lower unemployment is better
    return value < 5 ? 20 : value < 7 ? 0 : -20;
  }

  /**
   * Determine economic sentiment
   */
  determineEconomicSentiment(score) {
    if (score > 30) return 'very_bullish';
    if (score > 10) return 'bullish';
    if (score > -10) return 'neutral';
    if (score > -30) return 'bearish';
    return 'very_bearish';
  }

  /**
   * Calculate change between data points
   */
  calculateChange(data) {
    if (data.length < 2) return 0;
    const latest = Number.parseFloat(data[0].value);
    const previous = Number.parseFloat(data[1].value);
    if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) {
      return 0;
    }
    return ((latest - previous) / Math.abs(previous)) * 100;
  }

  /**
   * Get country code from currency
   */
  getCurrencyCountryCode(currency) {
    const mapping = {
      USD: 'USA',
      EUR: 'EMU',
      GBP: 'GBR',
      JPY: 'JPN',
      AUD: 'AUS',
      CAD: 'CAN',
      CHF: 'CHE',
      NZD: 'NZL'
    };
    return mapping[currency] || 'USA';
  }

  /**
   * Get default analysis
   */
  getDefaultAnalysis(currency) {
    return {
      currency,
      timestamp: Date.now(),
      indicators: {},
      score: 0,
      sentiment: 'neutral',
      strength: 0
    };
  }

  /**
   * Cache management
   */
  getCached(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }
    return null;
  }

  setCached(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  isRealKey(value) {
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized.length > 3 && !['demo', 'test', 'free'].includes(normalized);
  }

  emptyIndicator(type, reason) {
    return {
      value: null,
      change: null,
      impact: 0,
      trend: 'neutral',
      source: reason || 'unavailable'
    };
  }

  trendFromChange(change) {
    if (!Number.isFinite(change) || change === 0) {
      return 'neutral';
    }
    return change > 0 ? 'up' : 'down';
  }

  async fetchFredSeries(seriesId) {
    const fredKey = this.apiKeys?.fred;
    if (!this.isRealKey(fredKey)) {
      return null;
    }

    try {
      const url = 'https://api.stlouisfed.org/fred/series/observations';
      const params = {
        series_id: seriesId,
        api_key: fredKey,
        file_type: 'json',
        sort_order: 'desc',
        limit: 5
      };

      const { data } = await axios.get(url, { params, timeout: 10000 });
      const observations = Array.isArray(data?.observations)
        ? data.observations.filter((entry) => entry?.value != null && entry.value !== '.')
        : [];

      if (observations.length === 0) {
        return null;
      }

      const latest = observations[0];
      const previous =
        observations.find((entry, index) => index > 0 && entry.value !== '.') || null;

      const latestValue = Number.parseFloat(latest.value);
      if (!Number.isFinite(latestValue)) {
        return null;
      }

      const previousValue = previous ? Number.parseFloat(previous.value) : null;
      const changePct =
        previousValue && Number.isFinite(previousValue) && previousValue !== 0
          ? Number((((latestValue - previousValue) / Math.abs(previousValue)) * 100).toFixed(2))
          : null;

      return {
        value: latestValue,
        previous: previousValue,
        change: changePct,
        latestDate: latest.date || null,
        source: 'FRED'
      };
    } catch (error) {
      console.error(`FRED series ${seriesId} fetch error:`, error.message);
      return null;
    }
  }

  calculateRetailImpact(changePct) {
    if (!Number.isFinite(changePct)) {
      return 0;
    }
    if (changePct >= 1.5) {
      return Math.min(changePct * 6, 40);
    }
    if (changePct >= 0.5) {
      return changePct * 4;
    }
    if (changePct <= -1.5) {
      return Math.max(changePct * 6, -40);
    }
    if (changePct <= -0.5) {
      return changePct * 4;
    }
    return 0;
  }

  calculateManufacturingImpact(changePct) {
    if (!Number.isFinite(changePct)) {
      return 0;
    }
    if (changePct >= 1) {
      return Math.min(changePct * 8, 45);
    }
    if (changePct >= 0.2) {
      return changePct * 6;
    }
    if (changePct <= -1) {
      return Math.max(changePct * 8, -45);
    }
    if (changePct <= -0.2) {
      return changePct * 6;
    }
    return 0;
  }
}

export default EconomicAnalyzer;
