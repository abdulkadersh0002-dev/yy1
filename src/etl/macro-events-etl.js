import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import { withClient } from '../storage/database.js';
import { parseTimestamp, toNumber, toStringValue, ensureArray } from './etl-utils.js';

const DEFAULT_CHUNK_SIZE = 250;

export async function ingestMacroEvents(sources = [], options = {}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return [];
  }

  const summaries = [];
  for (const source of sources) {
    try {
      const summary = await processMacroSource(source, options);
      summaries.push(summary);
    } catch (error) {
      summaries.push({
        label: source?.label || source?.path || 'macro-source',
        error: error.message,
        processed: 0,
        persisted: 0,
        skipped: 0
      });
    }
  }
  return summaries;
}

async function processMacroSource(source, options) {
  const { dryRun = false, chunkSize = DEFAULT_CHUNK_SIZE } = options;

  if (!source || !source.path) {
    throw new Error('Macro event source missing file path');
  }

  const filePath = path.resolve(source.path);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Macro event file not found: ${filePath}`);
  }

  const format = (source.format || inferFormat(filePath)).toLowerCase();
  const timezone = (source.timezone || 'UTC').toUpperCase();
  const defaultCurrency = toStringValue(source.currency) || null;
  const defaultRegion = toStringValue(source.region) || null;
  const defaultCountry = toStringValue(source.country) || null;
  const defaultSource = toStringValue(source.source) || source.label || path.basename(filePath);

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
      await insertMacroBatch(client, batch);
    }
    persisted += batch.length;
  }

  await withClient(async (client) => {
    for await (const record of iterateMacroRecords(filePath, format)) {
      processed += 1;
      const mapped = mapMacroRecord(record, {
        columns: source.columns || {},
        timezone,
        defaultCurrency,
        defaultRegion,
        defaultCountry,
        defaultSource,
        defaultImpact: toNumber(source.defaultImpact),
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
    label: source.label || defaultSource,
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

async function* iterateMacroRecords(filePath, format) {
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

  throw new Error(`Unsupported macro event format: ${format}`);
}

function mapMacroRecord(record, context) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const {
    columns,
    timezone,
    defaultCurrency,
    defaultRegion,
    defaultCountry,
    defaultSource,
    defaultImpact,
    sourceMetadata
  } = context;

  const releasedAtValue = selectField(record, columns.releasedAt, [
    'released_at',
    'time',
    'timestamp',
    'date'
  ]);
  const releasedAt = parseTimestamp(releasedAtValue, { timezone });
  if (!releasedAt) {
    return null;
  }

  const indicator = toStringValue(
    selectField(record, columns.indicator, ['indicator', 'event', 'name'])
  );
  if (!indicator) {
    return null;
  }

  const currency =
    toStringValue(selectField(record, columns.currency, ['currency', 'ccy', 'code'])) ||
    defaultCurrency;
  if (!currency) {
    return null;
  }

  const eventId =
    toStringValue(selectField(record, columns.eventId, ['event_id', 'id', 'uid'])) ||
    buildEventId({ indicator, currency, releasedAt });

  const region = toStringValue(selectField(record, columns.region, ['region'])) || defaultRegion;
  const country =
    toStringValue(selectField(record, columns.country, ['country', 'location'])) || defaultCountry;
  const period =
    toStringValue(selectField(record, columns.period, ['period', 'reference_period'])) || null;
  const source =
    toStringValue(selectField(record, columns.source, ['source', 'provider'])) || defaultSource;

  const actual = toNumber(selectField(record, columns.actual, ['actual', 'value']));
  const forecast = toNumber(selectField(record, columns.forecast, ['forecast']));
  const previous = toNumber(selectField(record, columns.previous, ['previous']));
  const surprise = computeSurprise(actual, forecast);

  const impactValues = ensureArray(
    selectField(record, columns.impact, ['impact', 'importance', 'score'])
  );
  const impactScore = deriveImpactScore(impactValues, defaultImpact);

  const metadata = {
    ...sourceMetadata,
    tags: ensureArray(selectField(record, columns.tags, ['tags', 'categories']))
      .map((tag) => toStringValue(tag))
      .filter(Boolean),
    notes: toStringValue(selectField(record, columns.notes, ['notes', 'comment']))
  };

  return {
    eventId,
    region,
    currency,
    country,
    indicator,
    releasedAt,
    period,
    actual,
    forecast,
    previous,
    surprise,
    impactScore,
    source,
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

function computeSurprise(actual, forecast) {
  if (actual == null || forecast == null) {
    return null;
  }
  return Number((actual - forecast).toFixed(6));
}

function deriveImpactScore(values, fallback) {
  const numeric = values
    .map((value) => {
      if (value == null) {
        return null;
      }
      if (typeof value === 'number') {
        return value;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim().toLowerCase();
        if (trimmed === 'high') {
          return 10;
        }
        if (trimmed === 'medium' || trimmed === 'moderate') {
          return 6;
        }
        if (trimmed === 'low') {
          return 3;
        }
        const parsed = Number.parseFloat(trimmed);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      return null;
    })
    .filter((value) => value != null);

  if (numeric.length === 0) {
    return fallback != null ? fallback : null;
  }
  const avg = numeric.reduce((acc, value) => acc + value, 0) / numeric.length;
  return Number(avg.toFixed(3));
}

function buildEventId({ indicator, currency, releasedAt }) {
  return `${currency}-${indicator}-${releasedAt.toISOString()}`.replace(/\s+/g, '-').toLowerCase();
}

async function insertMacroBatch(client, rows) {
  if (!rows || rows.length === 0) {
    return;
  }

  const columns = [
    'event_id',
    'region',
    'currency',
    'country',
    'indicator',
    'released_at',
    'period',
    'actual',
    'forecast',
    'previous',
    'surprise',
    'impact_score',
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
      row.eventId,
      row.region,
      row.currency,
      row.country,
      row.indicator,
      row.releasedAt,
      row.period,
      row.actual,
      row.forecast,
      row.previous,
      row.surprise,
      row.impactScore,
      row.source,
      JSON.stringify(row.metadata || {})
    );
  });

  const sql = `
    INSERT INTO macro_economic_events
      (event_id, region, currency, country, indicator, released_at, period, actual, forecast, previous, surprise, impact_score, source, metadata)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (event_id, released_at)
    DO UPDATE SET
      region = COALESCE(EXCLUDED.region, macro_economic_events.region),
      currency = EXCLUDED.currency,
      country = COALESCE(EXCLUDED.country, macro_economic_events.country),
      indicator = EXCLUDED.indicator,
      period = COALESCE(EXCLUDED.period, macro_economic_events.period),
      actual = EXCLUDED.actual,
      forecast = EXCLUDED.forecast,
      previous = EXCLUDED.previous,
      surprise = EXCLUDED.surprise,
      impact_score = COALESCE(EXCLUDED.impact_score, macro_economic_events.impact_score),
      source = COALESCE(EXCLUDED.source, macro_economic_events.source),
      metadata = COALESCE(macro_economic_events.metadata, '{}'::jsonb) || EXCLUDED.metadata
  `;

  await client.query(sql, values);
}
