import WebSocket from 'ws';

// Dumps all message types received on the trading WS.
// Usage:
//   node scripts/diagnostics/ws-dump.mjs [wsUrl] [durationMs]

const url = process.argv[2] || 'ws://127.0.0.1:4101/ws/trading';
const durationMs = Number(process.argv[3] || 10000);

const ws = new WebSocket(url);
const t0 = Date.now();

ws.on('open', () => {
  console.log('ws open', { url, durationMs });
});

ws.on('message', (buf) => {
  try {
    const msg = JSON.parse(buf.toString());
    const type = msg?.type ?? null;
    const broker = msg?.payload?.broker ?? msg?.payload?.signal?.broker ?? null;
    console.log('ws msg', { type, broker });
  } catch {
    console.log('ws raw', buf.toString().slice(0, 200));
  }
});

ws.on('error', (err) => {
  console.error('ws error', err?.message || err);
});

setTimeout(() => {
  console.log('done', { ms: Date.now() - t0 });
  try {
    ws.close();
  } catch {
    // noop
  }
}, durationMs);
