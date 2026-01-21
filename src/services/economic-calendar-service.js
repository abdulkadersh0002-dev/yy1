import axios from 'axios';
import RSSParser from 'rss-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPairMetadata } from '../config/pair-catalog.js';
import { appConfig } from '../app/config.js';
import { requireRealTimeData } from '../config/runtime-flags.js';

const calendarConfig = appConfig?.services?.economicCalendar || {};

const DEFAULT_CALENDAR_RSS_URL =
  calendarConfig.rssUrl || 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
const DEFAULT_CALENDAR_JSON_URL =
  calendarConfig.jsonUrl || 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
// Provider notes: calendar export is updated about once per hour; fetching more often risks blocks.
const DEFAULT_CALENDAR_RSS_TTL_MS = 60 * 60 * 1000;
const DEFAULT_DISK_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_DISK_CACHE_PATH = path.join(
  process.cwd(),
  'data',
  'cache',
  'economic-calendar-feed.json'
);

class EconomicCalendarService {
  constructor(apiKeys = {}) {
    this.apiKeys = apiKeys;
    this.cache = new Map();
    this.cacheDurationMs = 5 * 60 * 1000; // 5 minutes to avoid hammering providers
    this.backoffUntil = new Map();
    this.logCooldownMs = 60 * 1000;
    this.lastErrorLogAt = new Map();
    this.calendarRssUrl = DEFAULT_CALENDAR_RSS_URL;
    this.calendarJsonUrl = DEFAULT_CALENDAR_JSON_URL;
    this.calendarRssTtlMs = DEFAULT_CALENDAR_RSS_TTL_MS;
    this.calendarFeedCache = { timestamp: 0, items: [] };
    this.rssParser = new RSSParser({ timeout: 10000 });

    // Persist last known good calendar feed to disk so restarts (or 429s) don't force synthetic events.
    this.diskCachePath = DEFAULT_DISK_CACHE_PATH;
    this.diskCacheTtlMs = DEFAULT_DISK_CACHE_TTL_MS;
  }

  async readDiskCache() {
    try {
      const raw = await fs.readFile(this.diskCachePath, 'utf8');
      const parsed = JSON.parse(raw);
      const timestamp = Number(parsed?.timestamp);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return null;
      }
      if (Date.now() - timestamp > this.diskCacheTtlMs) {
        return null;
      }
      if (!items.length) {
        return null;
      }
      return { timestamp, items };
    } catch {
      return null;
    }
  }

  async writeDiskCache(items) {
    try {
      const dir = path.dirname(this.diskCachePath);
      await fs.mkdir(dir, { recursive: true });
      const payload = { timestamp: Date.now(), items: Array.isArray(items) ? items : [] };
      await fs.writeFile(this.diskCachePath, JSON.stringify(payload), 'utf8');
    } catch {
      // Best-effort cache; ignore failures.
    }
  }

  isProbablyHtmlBody(bodyText, contentType = '') {
    const type = String(contentType || '').toLowerCase();
    if (type.includes('text/html')) {
      return true;
    }
    const head = String(bodyText || '')
      .trimStart()
      .slice(0, 300)
      .toLowerCase();
    return (
      head.startsWith('<!doctype html') ||
      head.startsWith('<html') ||
      (head.includes('<head') && head.includes('<body'))
    );
  }

  isProbablyRssOrAtom(bodyText, contentType = '') {
    const type = String(contentType || '').toLowerCase();
    const text = String(bodyText || '').trimStart();
    if (!text.startsWith('<')) {
      return false;
    }
    if (type.includes('application/rss+xml') || type.includes('application/atom+xml')) {
      return true;
    }
    if (type.includes('xml')) {
      return /<rss\b|<rdf:RDF\b|<feed\b/i.test(text);
    }
    return /<rss\b|<rdf:RDF\b|<feed\b/i.test(text);
  }

  looksLikeForexFactoryCalendarXml(bodyText) {
    const text = String(bodyText || '').trimStart();
    if (!text.startsWith('<')) {
      return false;
    }
    // The ForexFactory calendar export is XML but not RSS/Atom.
    return /<weeklyevents\b|<event\b/i.test(text);
  }

  decodeXmlText(value) {
    if (value == null) {
      return '';
    }
    return String(value)
      .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  extractXmlTag(block, tagName) {
    if (!block) {
      return '';
    }
    const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = String(block).match(re);
    return match ? this.decodeXmlText(match[1]) : '';
  }

  parseForexFactoryCalendarXml(xmlText) {
    const xml = String(xmlText || '');
    const events = [];
    const eventRe = /<event\b[^>]*>([\s\S]*?)<\/event>/gi;
    let match;
    while ((match = eventRe.exec(xml))) {
      const block = match[1];
      const title = this.extractXmlTag(block, 'title') || this.extractXmlTag(block, 'event');
      const currency =
        this.extractXmlTag(block, 'country') ||
        this.extractXmlTag(block, 'currency') ||
        this.extractXmlTag(block, 'ff:currency');
      const date = this.extractXmlTag(block, 'date');
      const time = this.extractXmlTag(block, 'time');
      const impact = this.extractXmlTag(block, 'impact');
      const actual = this.extractXmlTag(block, 'actual');
      const forecast = this.extractXmlTag(block, 'forecast');
      const previous = this.extractXmlTag(block, 'previous');

      const isoDate = this.coerceForexFactoryDateTime(date, time);
      if (!currency || !isoDate) {
        continue;
      }

      events.push({
        title: title || 'Economic Event',
        'ff:currency': currency,
        isoDate,
        impact,
        actual: actual || null,
        forecast: forecast || null,
        previous: previous || null
      });
    }
    return events;
  }

  coerceForexFactoryDateTime(dateValue, timeValue) {
    const date = String(dateValue || '').trim();
    if (!date) {
      return null;
    }
    const time = String(timeValue || '').trim();

    // Common FF forms include "All Day" or empty time.
    const timePart = !time || /all\s*day/i.test(time) ? '00:00' : time;

    // Try a few reasonable interpretations. Provider time zone can vary, but ISO is required.
    const candidates = [
      `${date} ${timePart} UTC`,
      `${date} ${timePart} GMT`,
      `${date} ${timePart}`,
      date
    ];

    for (const candidate of candidates) {
      const ts = Date.parse(candidate);
      if (Number.isFinite(ts)) {
        return new Date(ts).toISOString();
      }
    }
    return null;
  }

  async fetchCalendarRssItems() {
    if (!this.calendarRssUrl) {
      return [];
    }

    if (this.isInBackoff('calendar:feed')) {
      return [];
    }

    try {
      const response = await axios.get(this.calendarRssUrl, {
        timeout: 10000,
        responseType: 'text',
        validateStatus: () => true,
        headers: {
          Accept:
            'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
          'Accept-Language': 'en-US,en;q=0.8',
          'User-Agent': 'SignalsGateway/1.0 (+https://localhost)'
        }
      });

      const status = response?.status;
      if (!Number.isFinite(status) || status < 200 || status >= 300) {
        this.applyBackoff('calendar:feed', { response });
        this.logErrorWithCooldown(
          'calendar:rss',
          `Economic calendar feed fetch failed: HTTP ${status || 'unknown'}`
        );
        return [];
      }

      const contentType = response?.headers?.['content-type'] || '';
      const bodyText = typeof response?.data === 'string' ? response.data : '';
      if (!bodyText) {
        this.logErrorWithCooldown('calendar:rss', 'Economic calendar RSS fetch failed: empty body');
        return [];
      }

      if (this.isProbablyHtmlBody(bodyText, contentType)) {
        this.logErrorWithCooldown(
          'calendar:rss',
          `Economic calendar feed fetch failed: received HTML (${String(contentType) || 'unknown content-type'})`
        );
        return [];
      }

      if (this.isProbablyRssOrAtom(bodyText, contentType)) {
        const feed = await this.rssParser.parseString(bodyText);
        return Array.isArray(feed?.items) ? feed.items : [];
      }

      if (this.looksLikeForexFactoryCalendarXml(bodyText)) {
        return this.parseForexFactoryCalendarXml(bodyText);
      }

      // Unknown XML/text response; fall back to JSON/Finnhub without noise.
      return [];
    } catch (error) {
      this.applyBackoff('calendar:feed', error);
      this.logErrorWithCooldown(
        'calendar:rss',
        `Economic calendar feed fetch failed: ${error?.message || 'unknown error'}`
      );
      return [];
    }
  }

  logErrorWithCooldown(key, message) {
    const now = Date.now();
    const lastLogAt = this.lastErrorLogAt.get(key) || 0;
    if (now - lastLogAt < this.logCooldownMs) {
      return;
    }
    this.lastErrorLogAt.set(key, now);
    console.warn(message);
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

    // In strict real-time mode, never fabricate economic events.
    // If providers are unavailable, return empty and let higher-level strict gating block trading.
    if (requireRealTimeData()) {
      return [];
    }

    return this.buildSyntheticEvents(currency, daysAhead);
  }

  async fetchFromFinnhub(currency, from, to) {
    const key = this.apiKeys.finnhub;
    if (!this.isRealKey(key)) {
      return [];
    }
    if (this.isInBackoff('finnhub-calendar')) {
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
    const now = Date.now();
    const cachedTimestamp = Number(this.calendarFeedCache.timestamp || 0);
    const cachedItems = Array.isArray(this.calendarFeedCache.items)
      ? this.calendarFeedCache.items
      : [];
    const cacheAgeMs = cachedTimestamp > 0 ? now - cachedTimestamp : Number.POSITIVE_INFINITY;

    // If we have a non-empty feed, respect the full provider TTL.
    if (cachedTimestamp && cachedItems.length > 0 && cacheAgeMs < this.calendarRssTtlMs) {
      return cachedItems;
    }

    // If the feed is empty, retry more frequently so we recover quickly after transient failures.
    const EMPTY_FEED_RETRY_MS = 60 * 1000;
    if (cachedTimestamp && cachedItems.length === 0 && cacheAgeMs < EMPTY_FEED_RETRY_MS) {
      return cachedItems;
    }

    // On restarts, warm from disk before any network fetch to avoid repeated requests (and 429s).
    // Treat disk warm as fresh for one TTL window; the provider updates about hourly anyway.
    const existingItems = Array.isArray(this.calendarFeedCache.items)
      ? this.calendarFeedCache.items
      : [];
    if (existingItems.length === 0) {
      const diskWarm = await this.readDiskCache();
      if (diskWarm?.items?.length) {
        this.calendarFeedCache = { timestamp: Date.now(), items: diskWarm.items };
        return this.calendarFeedCache.items;
      }
    }

    let items = existingItems;
    let fetchedItems = [];
    if (this.calendarRssUrl) {
      fetchedItems = await this.fetchCalendarRssItems();
    }

    if ((!fetchedItems || fetchedItems.length === 0) && this.calendarJsonUrl) {
      fetchedItems = await this.fetchCalendarJson();
    }

    if (Array.isArray(fetchedItems) && fetchedItems.length > 0) {
      items = fetchedItems;
      await this.writeDiskCache(items);
    } else {
      const disk = await this.readDiskCache();
      if (disk?.items?.length) {
        items = disk.items;
      }
    }

    this.calendarFeedCache = { timestamp: now, items };
    return this.calendarFeedCache.items;
  }

  async fetchCalendarJson() {
    try {
      if (this.isInBackoff('calendar:feed')) {
        return [];
      }

      const response = await axios.get(this.calendarJsonUrl, {
        timeout: 10000,
        responseType: 'text',
        validateStatus: () => true,
        headers: {
          Accept: 'application/json, */*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.8',
          'User-Agent': 'SignalsGateway/1.0 (+https://localhost)'
        }
      });

      const status = response?.status;
      if (!Number.isFinite(status) || status < 200 || status >= 300) {
        this.applyBackoff('calendar:feed', { response });
        this.logErrorWithCooldown(
          'calendar:json',
          `Economic calendar JSON fetch failed: HTTP ${status || 'unknown'}`
        );
        return [];
      }

      const contentType = response?.headers?.['content-type'] || '';
      const bodyText = typeof response?.data === 'string' ? response.data : '';
      if (!bodyText) {
        return [];
      }
      if (this.isProbablyHtmlBody(bodyText, contentType)) {
        this.logErrorWithCooldown(
          'calendar:json',
          'Economic calendar JSON fetch failed: received HTML'
        );
        return [];
      }

      let data;
      try {
        data = JSON.parse(bodyText);
      } catch {
        this.logErrorWithCooldown(
          'calendar:json',
          `Economic calendar JSON fetch failed: invalid JSON (${String(contentType) || 'unknown content-type'})`
        );
        return [];
      }

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
      this.applyBackoff('calendar:feed', error);
      this.logErrorWithCooldown(
        'calendar:json',
        `Economic calendar JSON fetch failed: ${error.message}`
      );
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
      source: 'ForexFactory'
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
    const numeric = Number(label);
    if (Number.isFinite(numeric)) {
      // Some providers encode impact as a numeric importance score.
      // Normalize to our standard 3/5/7/10 scale.
      return this.normalizeImpact(numeric);
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

    // Deterministic schedule (no randomness): spread events across the requested window.
    const offsets = [6, 18, 30, 48, 66].map((h) => Math.min(h, maxHours));

    template.forEach((baseEvent, index) => {
      const hoursAhead = offsets[index % offsets.length];
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
