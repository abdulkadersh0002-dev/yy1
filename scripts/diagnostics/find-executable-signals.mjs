import { setTimeout as delay } from 'node:timers/promises';

const baseUrl = process.argv[2] || 'http://127.0.0.1:4101';
const broker = (process.argv[3] || 'mt5').toLowerCase();
const max = Number.isFinite(Number(process.argv[4])) ? Number(process.argv[4]) : 40;

const getJson = async (url) => {
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}) from ${url}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
};

const isFxOrMetal = (sym) => {
  const s = String(sym || '')
    .trim()
    .toUpperCase();
  if (!s) {
    return false;
  }
  if (s.startsWith('XAU') || s.startsWith('XAG') || s.startsWith('XPT') || s.startsWith('XPD')) {
    return true;
  }
  // Basic FX heuristic: 6 letters, no leading '#'
  if (s.startsWith('#')) {
    return false;
  }
  return /^[A-Z]{6}$/.test(s);
};

const main = async () => {
  const quotesUrl = `${baseUrl}/api/broker/bridge/${broker}/market/quotes?maxAgeMs=30000`;
  const quotesPayload = await getJson(quotesUrl);
  const quotes = quotesPayload?.data?.quotes || quotesPayload?.quotes || [];
  const symbols = [...new Set(quotes.map((q) => q.symbol).filter(isFxOrMetal))].slice(0, max);

  if (!symbols.length) {
    console.log(
      JSON.stringify({ ok: false, reason: 'no_symbols', quotesCount: quotes.length }, null, 2)
    );
    return;
  }

  const results = [];
  let executable = 0;

  for (const symbol of symbols) {
    const url = `${baseUrl}/api/broker/bridge/${broker}/signal/get?symbol=${encodeURIComponent(symbol)}`;
    const payload = await getJson(url);

    // /signal/get responds as: { success, message, signal, signalSummary, execution, shouldExecute, ... }
    const signal = payload?.signal || null;
    const exec = payload?.execution || null;

    const shouldExecute = Boolean(
      payload?.shouldExecute ?? signal?.shouldExecute ?? exec?.shouldExecute
    );
    const decision = signal?.isValid?.decision || null;
    const state = decision?.state || signal?.finalDecision?.state || null;
    const direction = signal?.direction || null;
    const confidence = signal?.confidence ?? null;
    const strength = signal?.strength ?? null;
    const message = payload?.message || null;

    const hardChecks = signal?.isValid?.checks || signal?.components?.hardChecks || null;
    const validReason = signal?.isValid?.reason || null;
    const decisionScore = decision?.score ?? null;
    const enterScore = decision?.profile?.enterScore ?? null;
    const tradeValid = Boolean(signal?.isValid?.isValid);

    if (shouldExecute) {
      executable += 1;
    }

    results.push({
      symbol,
      shouldExecute,
      state,
      direction,
      confidence,
      strength,
      message,
      validReason,
      hardChecks,
      tradeValid,
      decisionScore,
      enterScore
    });

    // Be gentle.
    await delay(120);
  }

  const summary = {
    ok: true,
    baseUrl,
    broker,
    sampleSize: results.length,
    executable,
    top: results
      .filter((r) => r.shouldExecute)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, 10),
    blockedExample: results.find((r) => !r.shouldExecute) || null
  };

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
