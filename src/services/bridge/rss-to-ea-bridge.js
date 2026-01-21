import RssFeedAggregator from '../rss-feed-aggregator.js';

const parseBool = (value) => {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw) {
    return null;
  }
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return true;
  }
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }
  return null;
};

const FX_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];

const extractCurrency = (text) => {
  const t = String(text || '');
  for (const cur of FX_CURRENCIES) {
    const re = new RegExp(`\\b${cur}\\b`, 'i');
    if (re.test(t)) {
      return cur;
    }
  }
  return null;
};

const computeImpact = ({ category, headline } = {}) => {
  const cat = String(category || '').toLowerCase();
  const h = String(headline || '').toLowerCase();
  if (cat.includes('economic-calendar')) {
    return 30;
  }
  if (
    h.includes('rate decision') ||
    h.includes('interest rate') ||
    h.includes('central bank') ||
    h.includes('cpi') ||
    h.includes('inflation') ||
    h.includes('gdp') ||
    h.includes('nonfarm') ||
    h.includes('nfp') ||
    h.includes('jobless') ||
    h.includes('unemployment')
  ) {
    return 25;
  }
  return 10;
};

const normalizeId = ({ feedId, url, headline, timestamp } = {}) => {
  const safeFeed = String(feedId || 'feed').trim() || 'feed';
  const safeUrl = String(url || '').trim();
  const safeHeadline = String(headline || '').trim();
  const ts = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now();
  const key = safeUrl || safeHeadline || 'item';
  return `rss:${safeFeed}:${key}:${ts}`;
};

const coerceRecentTimestamp = (value) => {
  const now = Date.now();
  const ts = Number.isFinite(Number(value)) ? Number(value) : now;
  // RSS sources sometimes return very old publication dates; treat anything older than 14d
  // as stale and re-stamp to keep the dashboard focused on current market context.
  const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
  if (ts < now - maxAgeMs) {
    return { timestamp: now, originalTimestamp: ts };
  }
  // Also guard against far-future timestamps.
  const maxFutureMs = 365 * 24 * 60 * 60 * 1000;
  if (ts > now + maxFutureMs) {
    return { timestamp: now, originalTimestamp: ts };
  }
  return { timestamp: ts, originalTimestamp: null };
};

export function startRssToEaBridgeIngestor({ eaBridgeService, brokers, logger } = {}) {
  const log = logger && typeof logger === 'object' ? logger : console;

  const enabledEnv = parseBool(process.env.EA_RSS_NEWS_ENABLED);
  const nodeEnv = String(process.env.NODE_ENV || '')
    .trim()
    .toLowerCase();
  const eaOnlyEnv = String(process.env.EA_ONLY_MODE || '')
    .trim()
    .toLowerCase();

  const enabled =
    enabledEnv != null
      ? enabledEnv
      : nodeEnv !== 'test' && (eaOnlyEnv === '1' || eaOnlyEnv === 'true' || eaOnlyEnv === 'yes');

  if (!enabled) {
    return { started: false, reason: 'EA_RSS_NEWS_ENABLED is disabled' };
  }

  if (!eaBridgeService || typeof eaBridgeService.recordNews !== 'function') {
    return { started: false, reason: 'EA bridge service missing recordNews()' };
  }

  const brokerList = Array.isArray(brokers) && brokers.length ? brokers : ['mt5', 'mt4'];

  const intervalMsEnv = Number(process.env.EA_RSS_POLL_INTERVAL_MS);
  const intervalMs = Number.isFinite(intervalMsEnv) ? Math.max(15_000, intervalMsEnv) : 90_000;

  const maxItemsEnv = Number(process.env.EA_RSS_MAX_ITEMS);
  const maxItems = Number.isFinite(maxItemsEnv) ? Math.max(5, Math.min(200, maxItemsEnv)) : 80;

  const aggregator = new RssFeedAggregator({
    apiKeys: {
      polygon: process.env.POLYGON_API_KEY,
      finnhub: process.env.FINNHUB_API_KEY
    },
    logger: log
  });

  let timer = null;
  let running = false;

  const runOnce = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const results = await aggregator.fetchAll({ maxItems });
      const list = Array.isArray(results) ? results : [];
      if (!list.length) {
        return;
      }

      const items = list.map((it) => {
        const id = normalizeId(it);
        const headline = it?.headline || it?.title || 'RSS Headline';
        const { timestamp, originalTimestamp } = coerceRecentTimestamp(it?.timestamp);
        const category = it?.category || null;
        const currency =
          extractCurrency(headline) || (String(category || '').includes('economic') ? 'USD' : null);
        const impact = computeImpact({ category, headline });
        const isCalendarCategory = String(category || '')
          .toLowerCase()
          .includes('economic-calendar');

        return {
          id,
          title: headline,
          headline,
          timestamp,
          time: timestamp,
          currency,
          impact,
          source: `rss:${it?.feedId || it?.source || 'feed'}`,
          notes: it?.summary || null,
          // IMPORTANT: EaBridgeService.recordNews stores the entire raw item under item.raw.
          // Keep metadata at the top-level so server-side classification can read item.raw.kind.
          // RSS cannot reliably provide a structured economic calendar with future timestamps.
          // Treat everything as a headline; real calendar events come from EconomicCalendarService
          // or directly from MT4/MT5 via the EA bridge.
          kind: 'headline',
          url: it?.url || null,
          link: it?.url || null,
          feedId: it?.feedId || null,
          sourceName: it?.source || null,
          category,
          summary: it?.summary || null,
          originalTimestamp: originalTimestamp,
          topic: isCalendarCategory ? 'economic_calendar' : null
        };
      });

      for (const broker of brokerList) {
        try {
          eaBridgeService.recordNews({ broker, items });
        } catch (_error) {
          // best-effort
        }
      }

      log.info?.(
        { brokers: brokerList, ingested: items.length, intervalMs },
        'RSS→EA bridge ingestor: headlines refreshed'
      );
    } catch (error) {
      log.warn?.({ err: error }, 'RSS→EA bridge ingestor failed');
    } finally {
      running = false;
    }
  };

  // Run immediately, then on interval.
  runOnce().catch(() => {});
  timer = setInterval(() => {
    runOnce().catch(() => {});
  }, intervalMs);

  // Do not keep the process alive if this is the only timer.
  try {
    timer.unref?.();
  } catch (_error) {
    // ignore
  }

  return {
    started: true,
    intervalMs,
    maxItems,
    brokers: brokerList
  };
}
