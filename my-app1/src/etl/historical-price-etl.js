import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import { withClient } from '../storage/database.js';
import {
  parseTimestamp,
  toNumber,
  normalizePair,
  normalizeTimeframe,
  toStringValue
} from './etl-utils.js';

const DEFAULT_CHUNK_SIZE = 500;

export async function ingestHistoricalPrices(sources = [], options = {}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return [];
  }

  const summaries = [];
  for (const source of sources) {
    try {
      const summary = await processPriceSource(source, options);
      summaries.push(summary);
    } catch (error) {
      summaries.push({
        label: source?.label || source?.path || 'unknown-source',
        error: error.message,
        processed: 0,
        persisted: 0,
        skipped: 0
      });
    }
  }

  return summaries;
}

async function processPriceSource(source, options) {
  const { dryRun = false, chunkSize = DEFAULT_CHUNK_SIZE } = options;

  if (!source || !source.path) {
    throw new Error('Historical price source missing file path');
  }

  const filePath = path.resolve(source.path);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Historical price file not found: ${filePath}`);
  }

  const format = (source.format || inferFormat(filePath)).toLowerCase();
  const timezone = (source.timezone || 'UTC').toUpperCase();
  const basePair = normalizePair(source.pair, null);
  const baseTimeframe = normalizeTimeframe(source.timeframe, 'M15');
  const provider = toStringValue(source.provider) || 'historical-import';
  const ingestSource = toStringValue(source.source) || source.label || path.basename(filePath);

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
      await insertPriceBatch(client, batch, { provider, ingestSource });
    }
    persisted += batch.length;
  }

  await withClient(async (client) => {
    for await (const record of iteratePriceRecords(filePath, format)) {
      processed += 1;
      const mapped = mapPriceRecord(record, {
        columns: source.columns || {},
        basePair,
        baseTimeframe,
        provider,
        ingestSource,
        timezone,
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
    label: source.label || ingestSource,
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

async function* iteratePriceRecords(filePath, format) {
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
            // swallow malformed line
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

  throw new Error(`Unsupported historical price format: ${format}`);
}

function mapPriceRecord(record, context) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const { columns, basePair, baseTimeframe, provider, ingestSource, timezone, sourceMetadata } =
    context;

  const timestampValue = selectField(record, columns.timestamp, ['timestamp', 'time', 'date']);
  const bucketTime = parseTimestamp(timestampValue, { timezone });
  if (!bucketTime) {
    return null;
  }

  const pair = normalizePair(selectField(record, columns.pair, ['pair', 'symbol']), basePair);
  if (!pair) {
    return null;
  }

  const timeframe = normalizeTimeframe(
    selectField(record, columns.timeframe, ['timeframe', 'resolution']),
    baseTimeframe
  );
  const open = toNumber(selectField(record, columns.open, ['open', 'o']));
  const high = toNumber(selectField(record, columns.high, ['high', 'h']));
  const low = toNumber(selectField(record, columns.low, ['low', 'l']));
  const close = toNumber(selectField(record, columns.close, ['close', 'c']));
  const volume = toNumber(selectField(record, columns.volume, ['volume', 'v']));
  const rowProvider =
    toStringValue(selectField(record, columns.provider, ['provider', 'source'])) || provider;

  const metadata = {
    ...sourceMetadata,
    ingestSource,
    recordProvider: rowProvider,
    rawProvider: toStringValue(record.provider) || null
  };

  if (record.quality != null) {
    metadata.quality = toNumber(record.quality);
  }
  if (record.liquidity != null) {
    metadata.liquidity = toNumber(record.liquidity);
  }

  return {
    pair,
    timeframe,
    bucketTime,
    open,
    high,
    low,
    close,
    volume,
    provider: rowProvider,
    source: ingestSource,
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

async function insertPriceBatch(client, rows, options) {
  if (!rows || rows.length === 0) {
    return;
  }

  const columns = [
    'pair',
    'timeframe',
    'bucket_time',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'provider',
    'source',
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
      row.pair,
      row.timeframe,
      row.bucketTime,
      row.open,
      row.high,
      row.low,
      row.close,
      row.volume,
      row.provider,
      options.ingestSource || row.source,
      JSON.stringify(row.metadata || {})
    );
  });

  const sql = `
    INSERT INTO historical_price_bars
      (pair, timeframe, bucket_time, open, high, low, close, volume, provider, source, metadata)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (pair, timeframe, bucket_time)
    DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = COALESCE(EXCLUDED.volume, historical_price_bars.volume),
      provider = COALESCE(EXCLUDED.provider, historical_price_bars.provider),
      source = COALESCE(EXCLUDED.source, historical_price_bars.source),
      metadata = COALESCE(historical_price_bars.metadata, '{}'::jsonb) || EXCLUDED.metadata
  `;

  await client.query(sql, values);
}
