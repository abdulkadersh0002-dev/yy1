import axios from 'axios';
import RSSParser from 'rss-parser';
import { assertRealTimeDataAvailability } from '../config/runtime-flags.js';
import { getPairMetadata } from '../config/pair-catalog.js';

const DEFAULT_CALENDAR_RSS_URL =
  process.env.CALENDAR_RSS_URL || 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
const DEFAULT_CALENDAR_JSON_URL =
  process.env.CALENDAR_JSON_URL || 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const DEFAULT_CALENDAR_RSS_TTL_MS = 10 * 60 * 1000;

class EconomicCalendarService {
  constructor(apiKeys = {}) {
    this.apiKeys = apiKeys;
    this.cache = new Map();
    this.cacheDurationMs = 5 * 60 * 1000; // 5 minutes to avoid hammering providers
    this.backoffUntil = new Map();
    this.calendarRssUrl = DEFAULT_CALENDAR_RSS_URL;
    this.calendarJsonUrl = DEFAULT_CALENDAR_JSON_URL;
    this.calendarRssTtlMs = DEFAULT_CALENDAR_RSS_TTL_MS;
    this.calendarFeedCache = { timestamp: 0, items: [] };
    this.rssParser = new RSSParser({ timeout: 10000 });
  }

  async getEventsForPair(pair, options = {}) {
    const { daysAhead = 2, includeHistorical = false } = options;
    const metadata = getPairMetadata(pair);
    const [base, quote] = this.splitPair(pair, metadata);

    const targetCurrencies = [];
    if (base && base.length === 3) {
      targetCurrencies.push(base);
    }
    if (quote && quote.length === 3 && quote !== base) {
      targetCurrencies.push(quote);
    }

    if (targetCurrencies.length === 0) {
      return [];
    }

    const cacheKey = `${pair}_${daysAhead}_${includeHistorical}_${targetCurrencies.join('-')}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    const eventGroups = await Promise.all(
      targetCurrencies.map((currency) =>
        this.getEventsForCurrency(currency, { daysAhead, includeHistorical })
      )
    );

    const merged = eventGroups
      .flat()
      .filter(Boolean)
      .sort((a, b) => new Date(a.time) - new Date(b.time));

    this.setCached(cacheKey, merged);
    return merged;
  }

  async getEventsForCurrency(currency, options = {}) {
    const { daysAhead = 2, includeHistorical = false } = options;
    const { from, to } = this.buildDateWindow(daysAhead, includeHistorical);

    const rssEvents = await this.fetchFromRss(currency, from, to);
    if (rssEvents.length > 0) {
      return rssEvents;
    }

    const realEvents = await this.fetchFromFinnhub(currency, from, to);
    if (realEvents.length > 0) {
      return realEvents;
    }

    assertRealTimeDataAvailability(
      'EconomicCalendar',
      `Finnhub returned no events for ${currency}`
    );
    return this.buildSyntheticEvents(currency, daysAhead);
  }

  async fetchFromFinnhub(currency, from, to) {
    const key = this.apiKeys.finnhub;
    if (!this.isRealKey(key)) {
      assertRealTimeDataAvailability('EconomicCalendar', 'Finnhub API key missing or invalid');
      return [];
    }
    if (this.isInBackoff('finnhub-calendar')) {
      assertRealTimeDataAvailability(
        'EconomicCalendar',
        'Finnhub calendar provider in backoff state'
      );
      return [];
    }

    try {
      const url = 'https://finnhub.io/api/v1/calendar/economic';
      const params = { from, to, token: key };
      const response = await axios.get(url, { params, timeout: 10000 });
      const items = response.data?.economicCalendar || response.data?.data || [];
      return items
        .filter((item) => this.matchesCurrency(item, currency))
        .map((item) => this.normalizeFinnhubEvent(item, currency))
        .filter(Boolean);
    } catch (error) {
      this.handleFinnhubError(error, currency);
      this.applyBackoff('finnhub-calendar', error);
      assertRealTimeDataAvailability(
        'EconomicCalendar',
        error?.message || `Finnhub calendar request failed for ${currency}`
      );
      return [];
    }
  }

  async fetchFromRss(currency, from, to) {
    if (!this.calendarRssUrl) {
      return [];
    }
    const items = await this.loadCalendarFeed();
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const windowBounds = this.buildWindowBounds(from, to);
    return items
      .map((item) => this.normalizeRssEvent(item))
      .filter(
        (event) =>
          event && event.currency === currency && this.isWithinWindow(event.time, windowBounds)
      );
  }

  async loadCalendarFeed() {
    if (
      this.calendarFeedCache.items.length > 0 &&
      Date.now() - this.calendarFeedCache.timestamp < this.calendarRssTtlMs
    ) {
      return this.calendarFeedCache.items;
    }

    let items = [];
    if (this.calendarRssUrl) {
      try {
        const feed = await this.rssParser.parseURL(this.calendarRssUrl);
        items = Array.isArray(feed?.items) ? feed.items : [];
      } catch (error) {
        console.error('Economic calendar RSS fetch failed:', error.message);
      }
    }

    if ((!items || items.length === 0) && this.calendarJsonUrl) {
      items = await this.fetchCalendarJson();
    }

    this.calendarFeedCache = { timestamp: Date.now(), items };
    return items;
  }

  async fetchCalendarJson() {
    try {
      const { data } = await axios.get(this.calendarJsonUrl, { timeout: 10000 });
      if (!Array.isArray(data)) {
        return [];
      }
      return data.map((entry) => ({
        title: entry.title,
        'ff:currency': entry.country,
        isoDate: entry.date,
        impact: entry.impact,
        actual: entry.actual ?? entry.actualValue ?? null,
        forecast: entry.forecast ?? null,
        previous: entry.previous ?? null
      }));
    } catch (error) {
      console.error('Economic calendar JSON fetch failed:', error.message);
      return [];
    }
  }

  normalizeRssEvent(item) {
    if (!item) {
      return null;
    }
    const currency = this.extractCurrency(item);
    if (!currency) {
      return null;
    }
    const timeValue = item.isoDate || item.pubDate || this.extractField(item, 'time');
    const timestamp = timeValue ? Date.parse(timeValue) : Number.NaN;
    if (!Number.isFinite(timestamp)) {
      return null;
    }
    const eventName = this.extractEventName(item);
    const impactLabel = this.extractImpactLabel(item);
    const impact = this.normalizeImpactLabel(impactLabel);

    return {
      currency,
      event: eventName,
      impact,
      time: new Date(timestamp).toISOString(),
      actual: this.extractField(item, 'actual'),
      forecast: this.extractField(item, 'forecast'),
      previous: this.extractField(item, 'previous'),
      source: 'RSS'
    };
  }

  extractCurrency(item) {
    const explicit = this.extractField(item, 'currency') || this.extractField(item, 'country');
    if (explicit && explicit.length === 3) {
      return explicit.toUpperCase();
    }
    const title = item.title || '';
    const match = title.match(/\b([A-Z]{3})[:-\s]/);
    if (match) {
      return match[1].toUpperCase();
    }
    return null;
  }

  extractEventName(item) {
    const title = item.title || this.extractField(item, 'event');
    if (title) {
      return title.replace(/^[A-Z]{3}\s*[:-]\s*/, '').trim();
    }
    return 'Economic Event';
  }

  extractImpactLabel(item) {
    return this.extractField(item, 'impact') || this.extractFromContent(item, 'Impact') || 'medium';
  }

  extractField(item, key) {
    if (!item) {
      return null;
    }
    const variations = [key, key?.toLowerCase(), key?.toUpperCase(), `ff:${key}`];
    for (const variant of variations) {
      if (variant && item[variant]) {
        return String(item[variant]).trim();
      }
    }
    return null;
  }

  extractFromContent(item, label) {
    const content = `${item.contentSnippet || ''} ${item.content || ''}`;
    const regex = new RegExp(`${label}\\s*:?\\s*([^|\\n]+)`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : null;
  }

  normalizeImpactLabel(label) {
    if (!label) {
      return 7;
    }
    const normalized = label.toString().toLowerCase();
    if (['high', 'very high', 'red', 'strong'].includes(normalized)) {
      return 10;
    }
    if (['medium', 'moderate', 'yellow'].includes(normalized)) {
      return 8;
    }
    if (['low', 'minor', 'weak', 'green'].includes(normalized)) {
      return 7;
    }
    return 7;
  }

  buildWindowBounds(from, to) {
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T23:59:59Z`);
    return { start, end };
  }

  isWithinWindow(timeIso, bounds) {
    if (!timeIso || !bounds) {
      return false;
    }
    const timestamp = Date.parse(timeIso);
    if (!Number.isFinite(timestamp)) {
      return false;
    }
    return timestamp >= bounds.start && timestamp <= bounds.end;
  }

  matchesCurrency(item, currency) {
    if (!item) {
      return false;
    }
    const country = (item.country || item.countryCode || '').toUpperCase();
    if (!country) {
      return false;
    }
    const expected = this.countryToCurrency(country);
    return expected === currency;
  }

  normalizeFinnhubEvent(item, currency) {
    if (!item?.time) {
      return null;
    }

    const importance = Number(item.importance || item.impact || 0);
    const impactScore = this.normalizeImpact(importance);

    return {
      currency,
      event: item.event || item.title || 'Economic Event',
      impact: impactScore,
      time: new Date(item.time).toISOString(),
      actual: item.actual ?? null,
      forecast: item.forecast ?? null,
      previous: item.previous ?? null,
      source: 'Finnhub'
    };
  }

  buildSyntheticEvents(currency, daysAhead) {
    const template = [
      { event: 'Interest Rate Decision', impact: 10 },
      { event: 'Employment Report', impact: 8 },
      { event: 'Inflation Release', impact: 7 },
      { event: 'GDP Growth', impact: 6 },
      { event: 'Retail Sales', impact: 5 }
    ];

    const events = [];
    const now = Date.now();
    const maxHours = Math.max(24, daysAhead * 24);

    template.forEach((baseEvent) => {
      const hoursAhead = Math.random() * maxHours;
      events.push({
        currency,
        event: baseEvent.event,
        impact: baseEvent.impact,
        time: new Date(now + hoursAhead * 3600000).toISOString(),
        forecast: null,
        previous: null,
        actual: null,
        source: 'Synthetic'
      });
    });

    return events;
  }

  normalizeImpact(importance) {
    if (!Number.isFinite(importance)) {
      return 5;
    }
    if (importance >= 3) {
      return 10;
    }
    if (importance >= 2) {
      return 7;
    }
    if (importance >= 1) {
      return 5;
    }
    return 3;
  }

  countryToCurrency(country) {
    const mapping = {
      US: 'USD',
      USA: 'USD',
      CN: 'CNY',
      JP: 'JPY',
      JPN: 'JPY',
      GB: 'GBP',
      UK: 'GBP',
      DE: 'EUR',
      FR: 'EUR',
      IT: 'EUR',
      ES: 'EUR',
      EA: 'EUR',
      EZ: 'EUR',
      EU: 'EUR',
      CA: 'CAD',
      AU: 'AUD',
      NZ: 'NZD',
      CH: 'CHF'
    };
    return mapping[country] || country;
  }

  buildDateWindow(daysAhead, includeHistorical) {
    const now = new Date();
    const future = new Date(now.getTime() + daysAhead * 24 * 3600000);
    const past = includeHistorical ? new Date(now.getTime() - 24 * 3600000) : now;

    return {
      from: past.toISOString().split('T')[0],
      to: future.toISOString().split('T')[0]
    };
  }

  splitPair(pair, metadata = null) {
    const resolved = metadata || getPairMetadata(pair);
    if (resolved?.base && resolved?.quote) {
      return [resolved.base, resolved.quote];
    }
    const normalized = String(pair || '').toUpperCase();
    if (normalized.includes('/')) {
      const parts = normalized.split(/[:/-]/).filter(Boolean);
      if (parts.length >= 2) {
        return [parts[0], parts[1]];
      }
    }
    if (normalized.length >= 6) {
      return [normalized.substring(0, 3), normalized.substring(3, 6)];
    }
    return [normalized, 'USD'];
  }

  isRealKey(value) {
    if (!value) {
      return false;
    }
    const normalized = String(value).toLowerCase();
    if (normalized === 'demo' || normalized === 'free') {
      return false;
    }
    return !normalized.startsWith('test_');
  }

  getCached(key) {
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }
    if (Date.now() - cached.timestamp < this.cacheDurationMs) {
      return cached.value;
    }
    this.cache.delete(key);
    return null;
  }

  setCached(key, value) {
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  handleFinnhubError(error, currency) {
    if (!error || typeof error !== 'object') {
      console.warn(`Economic calendar Finnhub fetch error for ${currency}: unexpected error`);
      return;
    }
    const status = error.response?.status;
    const retryAfter = error.response?.headers?.['retry-after'];
    if (status === 403) {
      console.warn(
        `Economic calendar Finnhub fetch error for ${currency}: access denied (403). Using synthetic schedule.`
      );
    } else if (status === 429) {
      console.warn(
        `Economic calendar Finnhub fetch error for ${currency}: rate limit hit${retryAfter ? `, retry after ${retryAfter}s` : ''}.`
      );
    } else {
      console.error(`Economic calendar Finnhub fetch error for ${currency}:`, error.message);
    }
  }

  applyBackoff(key, error) {
    const status = error?.response?.status;
    if (!status) {
      return;
    }
    let ttlMs = 0;
    if (status === 429) {
      const retryAfter = Number(error.response?.headers?.['retry-after']);
      ttlMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 5 * 60 * 1000;
    } else if (status === 403) {
      ttlMs = 30 * 60 * 1000;
    }
    if (ttlMs > 0) {
      this.backoffUntil.set(key, Date.now() + ttlMs);
    }
  }

  isInBackoff(key) {
    const until = this.backoffUntil.get(key);
    if (!until) {
      return false;
    }
    if (Date.now() < until) {
      return true;
    }
    this.backoffUntil.delete(key);
    return false;
  }
}

export default EconomicCalendarService;
