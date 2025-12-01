import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import { withClient } from '../storage/database.js';
import { parseTimestamp, toNumber, toStringValue, ensureArray } from './etl-utils.js';

const DEFAULT_CHUNK_SIZE = 250;

export async function ingestHistoricalNews(sources = [], options = {}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return [];
  }

  const summaries = [];
  for (const source of sources) {
    try {
      const summary = await processNewsSource(source, options);
      summaries.push(summary);
    } catch (error) {
      summaries.push({
        label: source?.label || source?.path || 'news-source',
        error: error.message,
        processed: 0,
        persisted: 0,
        skipped: 0
      });
    }
  }
  return summaries;
}

async function processNewsSource(source, options) {
  const { dryRun = false, chunkSize = DEFAULT_CHUNK_SIZE } = options;

  if (!source || !source.path) {
    throw new Error('News source missing file path');
  }

  const filePath = path.resolve(source.path);
  if (!fs.existsSync(filePath)) {
    throw new Error(`News file not found: ${filePath}`);
  }

  const format = (source.format || inferFormat(filePath)).toLowerCase();
  const timezone = (source.timezone || 'UTC').toUpperCase();
  const defaultFeedId = toStringValue(source.feedId) || 'historical-news';
  const defaultSource = toStringValue(source.source) || source.label || path.basename(filePath);
  const defaultCategory = toStringValue(source.category) || 'historical';

  let processed = 0;
  let skipped = 0;
  let persisted = 0;

  const rows = [];

  async function flushRows(client) {
    if (rows.length === 0) {
      return;
    }
    const batch = rows.splice(0, rows.length);
    if (!dryRun) {
      await insertNewsBatch(client, batch);
    }
    persisted += batch.length;
  }

  await withClient(async (client) => {
    for await (const record of iterateNewsRecords(filePath, format)) {
      processed += 1;
      const mapped = mapNewsRecord(record, {
        columns: source.columns || {},
        timezone,
        defaultFeedId,
        defaultSource,
        defaultCategory,
        sourceMetadata: source.metadata || {}
      });

      if (!mapped) {
        skipped += 1;
        continue;
      }

      rows.push(mapped);
      if (rows.length >= chunkSize) {
        await flushRows(client);
      }
    }

    await flushRows(client);
  });

  return {
    label: source.label || `${defaultSource}:${defaultFeedId}`,
    processed,
    persisted: dryRun ? 0 : persisted,
    skipped,
    dryRun
  };
}

function inferFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json' || ext === '.ndjson') {
    return ext.slice(1);
  }
  return 'csv';
}

async function* iterateNewsRecords(filePath, format) {
  if (format === 'csv') {
    const stream = fs.createReadStream(filePath);
    const parser = stream.pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true
      })
    );

    for await (const record of parser) {
      yield record;
    }
    return;
  }

  if (format === 'json') {
    const data = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    const items = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
    for (const item of items) {
      yield item;
    }
    return;
  }

  if (format === 'ndjson') {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    let buffer = '';
    for await (const chunk of stream) {
      buffer += chunk;
      let boundary = buffer.indexOf('\n');
      while (boundary !== -1) {
        const line = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 1);
        if (line.length > 0) {
          try {
            yield JSON.parse(line);
          } catch (error) {
            // ignore malformed line
          }
        }
        boundary = buffer.indexOf('\n');
      }
    }
    const remaining = buffer.trim();
    if (remaining.length > 0) {
      try {
        yield JSON.parse(remaining);
      } catch (error) {
        // ignore trailing malformed line
      }
    }
    return;
  }

  throw new Error(`Unsupported news format: ${format}`);
}

function mapNewsRecord(record, context) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const { columns, timezone, defaultFeedId, defaultSource, defaultCategory, sourceMetadata } =
    context;

  const publishedValue = selectField(record, columns.publishedAt, [
    'published_at',
    'published',
    'date',
    'time'
  ]);
  const publishedAt = parseTimestamp(publishedValue, { timezone });
  if (!publishedAt) {
    return null;
  }

  const headline = toStringValue(selectField(record, columns.headline, ['headline', 'title']));
  if (!headline) {
    return null;
  }

  const feedId =
    toStringValue(selectField(record, columns.feedId, ['feed_id', 'feed'])) || defaultFeedId;
  const source =
    toStringValue(selectField(record, columns.source, ['source', 'publisher'])) || defaultSource;
  const category =
    toStringValue(selectField(record, columns.category, ['category', 'section'])) ||
    defaultCategory;
  const summary = toStringValue(
    selectField(record, columns.summary, ['summary', 'description', 'content_snippet'])
  );
  const url = toStringValue(selectField(record, columns.url, ['url', 'link', 'article_url']));
  const sentiment = toNumber(selectField(record, columns.sentiment, ['sentiment', 'score']));
  const impact = toNumber(selectField(record, columns.impact, ['impact']));
  const collected =
    parseTimestamp(selectField(record, columns.collectedAt, ['collected_at', 'ingested_at']), {
      timezone
    }) || new Date();
  const keywordsRaw = ensureArray(
    selectField(record, columns.keywords, ['keywords', 'tags', 'tickers'])
  );

  const keywords = keywordsRaw
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : null))
    .filter(Boolean);

  const metadata = {
    ...sourceMetadata,
    rawId: toStringValue(selectField(record, columns.id, ['id', 'guid'])),
    author: toStringValue(selectField(record, columns.author, ['author', 'byline']))
  };

  return {
    feedId,
    source,
    category,
    headline,
    summary,
    url,
    publishedAt,
    collectedAt: collected,
    keywords,
    sentiment,
    impact,
    metadata
  };
}

function selectField(record, explicitKey, fallbacks = []) {
  if (explicitKey && record[explicitKey] != null) {
    return record[explicitKey];
  }
  for (const key of fallbacks) {
    if (record[key] != null) {
      return record[key];
    }
  }
  return null;
}

async function insertNewsBatch(client, rows) {
  if (!rows || rows.length === 0) {
    return;
  }

  const columns = [
    'feed_id',
    'source',
    'category',
    'headline',
    'summary',
    'url',
    'published_at',
    'collected_at',
    'keywords',
    'sentiment',
    'impact',
    'metadata'
  ];

  const values = [];
  const placeholders = [];

  rows.forEach((row, index) => {
    const baseIndex = index * columns.length;
    placeholders.push(
      `(${columns.map((_, colIndex) => `$${baseIndex + colIndex + 1}`).join(', ')})`
    );
    values.push(
      row.feedId,
      row.source,
      row.category,
      row.headline,
      row.summary,
      row.url,
      row.publishedAt,
      row.collectedAt,
      row.keywords,
      row.sentiment,
      row.impact,
      JSON.stringify(row.metadata || {})
    );
  });

  const sql = `
    INSERT INTO news_events
      (feed_id, source, category, headline, summary, url, published_at, collected_at, keywords, sentiment, impact, metadata)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (feed_id, headline, published_at)
    DO NOTHING
  `;

  await client.query(sql, values);
}
