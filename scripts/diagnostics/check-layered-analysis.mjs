import { buildLayeredAnalysis } from '../../src/core/analyzers/layered-analysis.js';

const res = await fetch('http://127.0.0.1:4101/api/signal/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pair: 'EURNZD', broker: 'mt5', analysisMode: 'ea', eaOnly: true })
});

const json = await res.json();
if (!json?.success) {
  console.error('generate failed', json);
  process.exit(1);
}

const rawSignal = json.signal;
const pair = rawSignal && rawSignal.pair ? rawSignal.pair : 'EURNZD';

const scenario = {
  pair,
  primary: {
    direction: rawSignal?.direction,
    confidence: rawSignal?.confidence,
    finalScore: rawSignal?.finalScore
  },
  market: {
    quote: { ageMs: null, pending: true }
  },
  factors: {
    economic: rawSignal?.components?.economic?.details ?? rawSignal?.components?.economic ?? null,
    news: rawSignal?.components?.news ?? null,
    technical: rawSignal?.components?.technical ?? null,
    candles: rawSignal?.components?.technical?.candlesSummary ?? null
  },
  decision: {
    state: rawSignal?.isValid?.decision?.state ?? null,
    blocked: Boolean(rawSignal?.isValid?.decision?.blocked),
    score: rawSignal?.isValid?.decision?.score ?? null,
    reason: rawSignal?.isValid?.reason ?? null,
    checks: rawSignal?.isValid?.checks ?? null,
    isTradeValid: rawSignal?.isValid?.isValid === true,
    missing: rawSignal?.isValid?.decision?.missing ?? null,
    whatWouldChange: rawSignal?.isValid?.decision?.whatWouldChange ?? null
  }
};

const layered = buildLayeredAnalysis({ scenario, signal: rawSignal });
const layers = Array.isArray(layered)
  ? layered
  : Array.isArray(layered?.layers)
    ? layered.layers
    : [];
console.log('layersCount', layers.length);
console.log('keys', layers.map((l) => l.key).join(','));
