import WebSocket from 'ws';

const baseUrl = process.argv[2] || 'http://127.0.0.1:4101';
const wsUrl = `${baseUrl.replace(/^http/i, 'ws').replace(/\/+$/, '')}/ws/trading`;

const wanted = new Set([
  'auto_trade_attempt',
  'auto_trade_rejected',
  'trade_opened',
  'trade_closed'
]);

const counters = {
  auto_trade_attempt: 0,
  auto_trade_rejected: 0,
  trade_opened: 0,
  trade_closed: 0
};

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

console.log(`[watch-auto-trading] Connecting: ${wsUrl}`);
const ws = new WebSocket(wsUrl);

ws.on('open', () => {
  console.log('[watch-auto-trading] Connected');
});

ws.on('message', (data) => {
  let msg;
  try {
    msg = JSON.parse(String(data));
  } catch {
    return;
  }

  const type = msg?.type;
  if (!wanted.has(type)) {
    return;
  }

  counters[type] = (counters[type] || 0) + 1;

  const p = msg?.payload || {};
  const broker = p?.broker || null;
  const pair = p?.pair || p?.symbol || null;
  const source = p?.source || null;
  const reason = p?.reason || null;
  const score = p?.decisionScore ?? null;
  const conf = p?.confidence ?? null;
  const str = p?.strength ?? null;

  const line = {
    type,
    broker,
    pair,
    source,
    score,
    confidence: conf,
    strength: str,
    ...(reason ? { reason } : {})
  };

  console.log(safeJson(line));
});

ws.on('close', () => {
  console.log('[watch-auto-trading] Disconnected');
  console.log('[watch-auto-trading] Totals:', safeJson(counters));
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[watch-auto-trading] Error:', err?.message || String(err));
});

setInterval(() => {
  console.log('[watch-auto-trading] Totals:', safeJson(counters));
}, 30_000).unref();
