import WebSocket from 'ws';

// Listens to /ws/trading and summarizes both signal + auto-trading events.
// Usage:
//   node scripts/diagnostics/ws-trading-events.mjs [wsUrl] [durationMs]
// Example:
//   node scripts/diagnostics/ws-trading-events.mjs ws://127.0.0.1:4101/ws/trading 60000

const url = process.argv[2] || 'ws://127.0.0.1:4101/ws/trading';
const durationMs = Number(process.argv[3] || 60000);

const ws = new WebSocket(url);

const counts = {
  signal: 0,
  auto_trade_attempt: 0,
  auto_trade_rejected: 0,
  trade_opened: 0,
  trade_closed: 0,
  trade_stop_modified: 0,
  trade_stop_modify_failed: 0,
  other: 0
};

let last = null;
const t0 = Date.now();

const summarizeSignal = (payload) => {
  const decision = payload?.isValid?.decision || null;
  const layers = Array.isArray(payload?.components?.layeredAnalysis?.layers)
    ? payload.components.layeredAnalysis.layers
    : [];
  const l5 = layers.find((l) => Number(l?.layer) === 5 || String(l?.key || '') === 'L5') || null;
  return {
    pair: payload?.pair,
    direction: payload?.direction ?? null,
    state: decision?.state ?? null,
    score: decision?.score ?? null,
    confidence: payload?.confidence ?? null,
    strength: payload?.strength ?? null,
    tradeValid: payload?.isValid?.isValid === true,
    layersCount: layers.length,
    layer5Summary: l5?.summaryEn ?? null
  };
};

ws.on('open', () => {
  console.log('ws open', { url, durationMs });
});

ws.on('message', (buf) => {
  let msg;
  try {
    msg = JSON.parse(buf.toString());
  } catch {
    return;
  }

  const type = String(msg?.type || '').trim();
  const payload = msg?.payload;

  if (!type) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(counts, type)) {
    counts[type] += 1;
  } else {
    counts.other += 1;
  }

  last =
    type === 'signal'
      ? { type, ...summarizeSignal(payload) }
      : type === 'trade_stop_modified' || type === 'trade_stop_modify_failed'
        ? {
            type,
            broker: payload?.broker ?? null,
            pair: payload?.pair ?? null,
            tradeId: payload?.tradeId ?? null,
            reason: payload?.reason ?? null,
            stopLoss: payload?.stopLoss ?? null,
            takeProfit: payload?.takeProfit ?? null,
            error: payload?.error ?? null
          }
        : {
            type,
            broker: payload?.broker ?? null,
            pair: payload?.pair ?? payload?.signal?.pair ?? null,
            reason: payload?.reason ?? null,
            details: payload?.details ?? null
          };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total % 10 === 0) {
    console.log({ counts, last });
  }
});

ws.on('error', (err) => {
  console.error('ws error', err?.message || err);
});

setTimeout(() => {
  console.log('done', {
    ms: Date.now() - t0,
    counts,
    last
  });
  try {
    ws.close();
  } catch {
    // noop
  }
}, durationMs);
