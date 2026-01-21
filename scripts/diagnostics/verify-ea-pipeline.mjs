// Verifies end-to-end EA feed + signal generation + 18-layer payload.
// Usage:
//   node scripts/diagnostics/verify-ea-pipeline.mjs --baseUrl http://127.0.0.1:4101 --broker mt5 --max 5 --maxAgeMs 600000

const parseArgs = (argv) => {
  const args = new Map();
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.set(key, next);
        i++;
      } else {
        args.set(key, 'true');
      }
    }
  }
  return args;
};

const args = parseArgs(process.argv);
const baseUrl = String(args.get('baseUrl') || 'http://127.0.0.1:4101').replace(/\/$/, '');
const broker = String(args.get('broker') || 'mt5').toLowerCase();
const max = Number(args.get('max') || 5);
const maxAgeMs = Number(args.get('maxAgeMs') || 10 * 60 * 1000);

const mustOk = async (res) => {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text.slice(0, 500)}`);
  }
  return res;
};

const main = async () => {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch() is not available. Use Node 18+ or add a fetch polyfill.');
  }

  const statsRes = await mustOk(await fetch(`${baseUrl}/api/broker/bridge/statistics`));
  const stats = await statsRes.json();
  const qTotal = stats?.marketFeed?.quotes?.total ?? 0;
  const sTotal = stats?.marketFeed?.snapshots?.total ?? 0;
  const bSeries = stats?.marketFeed?.bars?.series ?? 0;

  console.log('bridge.statistics', {
    broker,
    quotesTotal: qTotal,
    snapshotsTotal: sTotal,
    barsSeries: bSeries
  });

  const quotesRes = await mustOk(
    await fetch(
      `${baseUrl}/api/broker/bridge/${broker}/market/quotes?maxAgeMs=${encodeURIComponent(maxAgeMs)}`
    )
  );
  const quotes = await quotesRes.json();
  const list = Array.isArray(quotes?.quotes) ? quotes.quotes : [];

  console.log('quotes', { count: quotes?.count ?? list.length, maxAgeMs });

  if (!list.length) {
    console.log('No live quotes found. EA feed is likely disconnected/stale.');
    process.exitCode = 2;
    return;
  }

  const symbols = list
    .map((q) => String(q?.symbol || '').trim())
    .filter(Boolean)
    .slice(0, Number.isFinite(max) ? Math.max(1, max) : 5);

  for (const symbol of symbols) {
    const body = {
      pair: symbol,
      broker,
      eaOnly: true,
      analysisMode: 'ea',
      broadcast: false
    };

    const genRes = await fetch(`${baseUrl}/api/signal/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!genRes.ok) {
      const text = await genRes.text().catch(() => '');
      console.log('signal.generate.failed', {
        symbol,
        status: genRes.status,
        body: text.slice(0, 200)
      });
      continue;
    }

    const payload = await genRes.json();
    const sig =
      payload?.signal ||
      payload?.data?.signal ||
      payload?.result?.signal ||
      payload?.signalRaw ||
      payload;
    const layers = sig?.components?.layeredAnalysis?.layers;
    const count = Array.isArray(layers) ? layers.length : 0;
    const keys = Array.isArray(layers)
      ? layers
          .map((l) => l?.key)
          .filter(Boolean)
          .slice(0, 3)
      : [];

    const l5 = Array.isArray(layers)
      ? layers.find((l) => Number(l?.layer) === 5 || String(l?.key || '') === 'L5')
      : null;
    const l6 = Array.isArray(layers)
      ? layers.find((l) => Number(l?.layer) === 6 || String(l?.key || '') === 'L6')
      : null;

    console.log('signal.generate', {
      symbol,
      direction: sig?.direction,
      strength: sig?.strength,
      confidence: sig?.confidence,
      decision: sig?.isValid?.decision?.state,
      tradeValid: sig?.isValid?.isValid === true,
      layersCount: count,
      layersKeysSample: keys,
      layer5: l5
        ? {
            nameEn: l5?.nameEn || null,
            summaryEn: l5?.summaryEn || null,
            availability: l5?.availability || null
          }
        : null,
      layer6: l6
        ? {
            nameEn: l6?.nameEn || null,
            summaryEn: l6?.summaryEn || null,
            availability: l6?.availability || null
          }
        : null
    });
  }
};

main().catch((err) => {
  console.error('verify-ea-pipeline.failed', err?.message || err);
  process.exitCode = 1;
});
