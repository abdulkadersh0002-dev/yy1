import { withClient } from '../storage/database.js';
import { chunkArray } from './etl-utils.js';

const DEFAULT_BATCH_SIZE = 250;

export async function normalizeFeatureSnapshots(options = {}) {
  const { dryRun = false, batchSize = DEFAULT_BATCH_SIZE, since, until } = options;

  return withClient(async (client) => {
    const tableCheck = await client.query(
      "SELECT to_regclass('public.normalized_feature_vectors') AS table_id"
    );
    const exists = tableCheck.rows[0]?.table_id != null;
    if (!exists) {
      return {
        processedSnapshots: 0,
        flattenedFeatures: 0,
        persisted: 0,
        skipped: 0,
        dryRun,
        note: 'normalized_feature_vectors table not present; did you run migrations?'
      };
    }

    const sinceTs = since ? new Date(since) : null;
    const untilTs = until ? new Date(until) : null;

    let lastId = 0;
    let processed = 0;
    let flattened = 0;
    let persisted = 0;
    let skipped = 0;

    let continueLoop = true;
    while (continueLoop) {
      const params = [lastId, batchSize];
      let query = `
        SELECT id, pair, timeframe, captured_at, features
        FROM feature_snapshots
        WHERE id > $1
      `;

      if (sinceTs) {
        params.push(sinceTs);
        query += ` AND captured_at >= $${params.length}`;
      }
      if (untilTs) {
        params.push(untilTs);
        query += ` AND captured_at <= $${params.length}`;
      }

      query += ' ORDER BY id ASC LIMIT $2';

      const { rows } = await client.query(query, params);
      if (!rows || rows.length === 0) {
        continueLoop = false;
        break;
      }

      lastId = rows[rows.length - 1].id;
      processed += rows.length;

      const inserts = [];

      rows.forEach((row) => {
        if (!row.features || typeof row.features !== 'object') {
          skipped += 1;
          return;
        }
        const flattenedRows = flattenFeatureObject(row.features, {
          pair: row.pair,
          timeframe: row.timeframe,
          capturedAt: row.captured_at,
          snapshotId: row.id
        });

        if (flattenedRows.length === 0) {
          skipped += 1;
          return;
        }

        flattened += flattenedRows.length;
        inserts.push(...flattenedRows);
      });

      if (!dryRun && inserts.length > 0) {
        const chunks = chunkArray(inserts, 200);
        // eslint-disable-next-line no-restricted-syntax
        for (const chunk of chunks) {
          await upsertNormalizedFeatures(client, chunk);
          persisted += chunk.length;
        }
      }
    }

    return {
      processedSnapshots: processed,
      flattenedFeatures: flattened,
      persisted: dryRun ? 0 : persisted,
      skippedSnapshots: skipped,
      dryRun
    };
  });
}

function flattenFeatureObject(features, context) {
  const entries = [];

  function walk(current, prefix) {
    if (current == null) {
      return;
    }

    const type = typeof current;
    if (type === 'number') {
      entries.push(buildRow(prefix, 'numeric', current, null, null, context));
      return;
    }
    if (type === 'boolean') {
      entries.push(buildRow(prefix, 'boolean', null, null, current, context));
      return;
    }
    if (type === 'string') {
      entries.push(buildRow(prefix, 'text', null, current, null, context));
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        const nextPrefix = prefix ? `${prefix}[${index}]` : `[${index}]`;
        walk(item, nextPrefix);
      });
      return;
    }
    if (type === 'object') {
      Object.entries(current).forEach(([key, value]) => {
        const sanitizedKey = String(key).trim();
        if (!sanitizedKey) {
          return;
        }
        const nextPrefix = prefix ? `${prefix}.${sanitizedKey}` : sanitizedKey;
        walk(value, nextPrefix);
      });
    }
  }

  walk(features, '');

  return entries.filter((entry) => entry.featureKey && entry.featureKey.length <= 256);
}

function buildRow(featureKey, featureType, numericValue, textValue, boolValue, context) {
  const normalizedKey = featureKey.startsWith('.') ? featureKey.slice(1) : featureKey;
  return {
    snapshotId: context.snapshotId,
    pair: context.pair,
    timeframe: context.timeframe,
    capturedAt: context.capturedAt,
    featureKey: normalizedKey,
    featureType,
    numericValue,
    textValue,
    boolValue,
    metadata: {
      source: 'feature_snapshots',
      path: normalizedKey
    }
  };
}

async function upsertNormalizedFeatures(client, rows) {
  if (!rows || rows.length === 0) {
    return;
  }

  const columns = [
    'snapshot_id',
    'pair',
    'timeframe',
    'captured_at',
    'feature_key',
    'feature_type',
    'numeric_value',
    'text_value',
    'bool_value',
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
      row.snapshotId,
      row.pair,
      row.timeframe,
      row.capturedAt,
      row.featureKey,
      row.featureType,
      row.numericValue,
      row.textValue,
      row.boolValue,
      JSON.stringify(row.metadata || {})
    );
  });

  const sql = `
    INSERT INTO normalized_feature_vectors
      (snapshot_id, pair, timeframe, captured_at, feature_key, feature_type, numeric_value, text_value, bool_value, metadata)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (snapshot_id, feature_key)
    DO UPDATE SET
      feature_type = EXCLUDED.feature_type,
      numeric_value = EXCLUDED.numeric_value,
      text_value = EXCLUDED.text_value,
      bool_value = EXCLUDED.bool_value,
      metadata = COALESCE(normalized_feature_vectors.metadata, '{}'::jsonb) || EXCLUDED.metadata
  `;

  await client.query(sql, values);
}
