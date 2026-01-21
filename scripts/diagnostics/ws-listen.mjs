import WebSocket from 'ws';

const url = process.argv[2] || 'ws://127.0.0.1:4101/ws/trading';
const durationMs = Number(process.argv[3] || 30000);

const ws = new WebSocket(url);

let n = 0;
let enter = 0;
let wait = 0;
let blocked = 0;
let min = Number.POSITIVE_INFINITY;
let max = Number.NEGATIVE_INFINITY;
let last = null;

const t0 = Date.now();

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
  if (msg?.type !== 'signal') {
    return;
  }

  const payload = msg.payload || null;
  const decision = payload?.isValid?.decision || null;

  const score = Number(decision?.score);
  if (Number.isFinite(score)) {
    min = Math.min(min, score);
    max = Math.max(max, score);
  }

  const state = String(decision?.state || '');
  n += 1;
  if (state === 'ENTER') {
    enter += 1;
  } else if (state === 'WAIT_MONITOR') {
    wait += 1;
  } else if (state === 'NO_TRADE_BLOCKED') {
    blocked += 1;
  }

  last = {
    pair: payload?.pair,
    direction: payload?.direction ?? null,
    state,
    score: Number.isFinite(score) ? score : null,
    confidence: payload?.confidence ?? null,
    strength: payload?.strength ?? null,
    receivedAt: payload?.receivedAt ?? null
  };

  if (n % 10 === 0) {
    console.log({ n, enter, wait, blocked, min, max, last });
  }
});

ws.on('close', () => {
  // noop
});

ws.on('error', (err) => {
  console.error('ws error', err?.message || err);
});

setTimeout(() => {
  console.log('done', {
    ms: Date.now() - t0,
    n,
    enter,
    wait,
    blocked,
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
    last
  });
  try {
    ws.close();
  } catch {
    // noop
  }
}, durationMs);
