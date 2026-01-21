#!/usr/bin/env node

const DEFAULT_BASE_URL = 'http://127.0.0.1:4101';
const DEFAULT_BROKER = 'mt5';

const MIN_CONFIDENCE = 45;
const MIN_STRENGTH = 35;

const parseArgs = (argv) => {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token) {
      continue;
    }
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }

    const [keyRaw, maybeValue] = token.split('=', 2);
    const key = keyRaw.slice(2);
    if (maybeValue !== undefined) {
      out[key] = maybeValue;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
      continue;
    }

    out[key] = true;
  }
  return out;
};

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  // eslint-disable-next-line no-console
  console.log(
    `Usage: node scripts/diagnostics/audit-tape-signals.mjs [options]\n\nOptions:\n  --baseUrl <url>        Base URL (default: ${DEFAULT_BASE_URL})\n  --broker <mt5|mt4>     Broker (default: ${DEFAULT_BROKER})\n  --max <n>              Max active symbols to scan (default: 40)\n  --symbols <csv>        Override symbols list, comma-separated\n  --accountMode <mode>   Optional account mode passed to endpoints\n  --nearDeltaC <n>       Near-strong confidence delta (default: 10)\n  --nearDeltaS <n>       Near-strong strength delta (default: 10)\n`
  );
  process.exit(0);
}

const baseUrl = String(args.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
const broker = String(args.broker || DEFAULT_BROKER)
  .trim()
  .toLowerCase();
const max = Number.isFinite(Number(args.max)) ? Math.max(1, Math.trunc(Number(args.max))) : 40;
const accountMode = args.accountMode ? String(args.accountMode) : null;
const nearDeltaC = Number.isFinite(Number(args.nearDeltaC))
  ? Math.max(0, Number(args.nearDeltaC))
  : 10;
const nearDeltaS = Number.isFinite(Number(args.nearDeltaS))
  ? Math.max(0, Number(args.nearDeltaS))
  : 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchJson = async (url, { timeoutMs = 8000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const message =
        (parsed && (parsed.message || parsed.error)) ||
        (text ? text.slice(0, 200) : '') ||
        `HTTP ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }

    return parsed;
  } finally {
    clearTimeout(timer);
  }
};

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pad = (s, len) => {
  const str = String(s);
  if (str.length >= len) {
    return str;
  }
  return str + ' '.repeat(len - str.length);
};

const fmt = {
  conf: (v) => (v == null ? '—' : `${Math.round(v)}%`),
  str: (v) => (v == null ? '—' : `${Math.round(v)}`)
};

const buildQuery = (params) => {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') {
      return;
    }
    usp.set(k, String(v));
  });
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
};

const getActiveSymbols = async () => {
  if (args.symbols) {
    return String(args.symbols)
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  const url = `${baseUrl}/api/broker/bridge/${broker}/market/active-symbols${buildQuery({
    max
  })}`;
  const data = await fetchJson(url);
  return (Array.isArray(data?.symbols) ? data.symbols : [])
    .map((s) =>
      String(s || '')
        .trim()
        .toUpperCase()
    )
    .filter(Boolean);
};

const getSignalGet = async (symbol) => {
  const url = `${baseUrl}/api/broker/bridge/${broker}/signal/get${buildQuery({
    symbol,
    accountMode
  })}`;
  return fetchJson(url, { timeoutMs: 12000 });
};

const getAnalysis = async (symbol) => {
  const url = `${baseUrl}/api/broker/bridge/${broker}/analysis/get${buildQuery({
    symbol,
    accountMode
  })}`;
  return fetchJson(url, { timeoutMs: 15000 });
};

const describeDecision = (signal) => {
  const decision = signal?.isValid?.decision || null;
  const state = decision?.state || null;
  const blockers = Array.isArray(decision?.blockers) ? decision.blockers.filter(Boolean) : [];
  const missing = Array.isArray(decision?.missing) ? decision.missing.filter(Boolean) : [];

  const parts = [];
  if (state) {
    parts.push(`state=${state}`);
  }
  if (blockers.length) {
    parts.push(`blockers=${blockers.slice(0, 4).join('|')}`);
  }
  if (missing.length) {
    parts.push(`missing=${missing.slice(0, 4).join('|')}`);
  }
  return parts.join(' ');
};

const isNearStrong = ({ confidence, strength } = {}) => {
  const c = Number(confidence) || 0;
  const s = Number(strength) || 0;
  return c >= MIN_CONFIDENCE - nearDeltaC && s >= MIN_STRENGTH - nearDeltaS;
};

const main = async () => {
  // eslint-disable-next-line no-console
  console.log(
    `Audit tape symbols via signal/get + analysis/get (broker=${broker}, baseUrl=${baseUrl})`
  );
  // eslint-disable-next-line no-console
  console.log(
    `Strong thresholds: confidence>=${MIN_CONFIDENCE}, strength>=${MIN_STRENGTH} | near: -${nearDeltaC}/-${nearDeltaS}`
  );

  let symbols;
  try {
    symbols = await getActiveSymbols();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Failed to fetch active symbols: ${err.message}`);
    process.exitCode = 2;
    return;
  }

  if (!symbols.length) {
    // eslint-disable-next-line no-console
    console.log(
      'No active symbols found. (Open the dashboard tape or pass --symbols=EURUSD,BTCUSD)'
    );
    return;
  }

  const header = `${pad('SYMBOL', 12)} ${pad('SGET', 5)} ${pad('EXEC', 5)} ${pad('DIR', 4)} ${pad('CONF', 6)} ${pad('STR', 4)} ${pad('NEAR', 4)} REASON / DETAILS`;
  // eslint-disable-next-line no-console
  console.log(header);
  // eslint-disable-next-line no-console
  console.log('-'.repeat(Math.min(140, header.length + 10)));

  let ok = 0;
  let executable = 0;
  let near = 0;
  let rejected = 0;

  for (const symbol of symbols) {
    const sym = String(symbol || '')
      .trim()
      .toUpperCase();
    if (!sym) {
      continue;
    }

    let sget;
    let analysis;

    try {
      sget = await getSignalGet(sym);
    } catch (err) {
      sget = { success: false, message: err.message, signal: null };
    }

    try {
      analysis = await getAnalysis(sym);
    } catch (err) {
      analysis = { success: false, message: err.message, signal: null };
    }

    const sgetOk = Boolean(sget?.success);
    if (sgetOk) {
      ok += 1;
    }

    const sgetSignal = sget?.signal || null;
    const aSignal = analysis?.signal || null;

    const direction = String(
      sgetSignal?.direction || aSignal?.direction || 'NEUTRAL'
    ).toUpperCase();
    const confidence = toNum(sgetSignal?.confidence ?? aSignal?.confidence);
    const strength = toNum(sgetSignal?.strength ?? aSignal?.strength);

    const nearFlag = isNearStrong({ confidence, strength });

    const shouldExecute = Boolean(sget?.shouldExecute);
    if (sgetOk && shouldExecute) {
      executable += 1;
    }

    if (!sgetOk) {
      rejected += 1;
    }
    if (nearFlag) {
      near += 1;
    }

    const gaps = [];
    if (confidence != null && confidence < MIN_CONFIDENCE) {
      gaps.push(`conf+${Math.max(0, MIN_CONFIDENCE - Math.round(confidence))}`);
    }
    if (strength != null && strength < MIN_STRENGTH) {
      gaps.push(`str+${Math.max(0, MIN_STRENGTH - Math.round(strength))}`);
    }

    const decisionDetails = describeDecision(aSignal);

    const details = sgetOk
      ? `OK (${shouldExecute ? 'execute' : 'trading-disabled'})`
      : `${String(sget?.message || 'rejected').trim()}${gaps.length ? ` (${gaps.join(' ')})` : ''}`;

    const analysisNote =
      analysis?.success && aSignal
        ? ` | analysis: valid=${Boolean(aSignal?.isValid?.isValid)} ${decisionDetails}`
        : analysis?.message
          ? ` | analysis: ${analysis.message}`
          : '';

    // eslint-disable-next-line no-console
    console.log(
      `${pad(sym, 12)} ${pad(sgetOk ? 'yes' : 'no', 5)} ${pad(shouldExecute ? 'yes' : 'no', 5)} ${pad(direction.slice(0, 4), 4)} ${pad(fmt.conf(confidence), 6)} ${pad(fmt.str(strength), 4)} ${pad(nearFlag ? 'yes' : 'no', 4)} ${details}${analysisNote}`
    );

    // Small delay to reduce backend load.
    await sleep(35);
  }

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(
    `Summary: symbols=${symbols.length} signalGetOk=${ok} executable=${executable} nearStrong=${near} rejected=${rejected}`
  );
};

await main();
