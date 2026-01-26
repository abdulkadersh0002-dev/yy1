const toFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const TF_TO_MS = {
  M1: 60 * 1000,
  M15: 15 * 60 * 1000,
  H1: 60 * 60 * 1000,
  H4: 4 * 60 * 60 * 1000,
  D1: 24 * 60 * 60 * 1000
};

const normalizeSymbol = (value) =>
  String(value || '')
    .trim()
    .toUpperCase();

const canonicalSymbol = (value) => normalizeSymbol(value).replace(/[^A-Z0-9]/g, '');

const parseFxPair = (value) => {
  const sym = canonicalSymbol(value);
  if (!/^[A-Z]{6}$/.test(sym)) {
    return null;
  }
  return { base: sym.slice(0, 3), quote: sym.slice(3, 6) };
};

const scoreSymbolMatch = (requestedSymbol, candidateSymbol) => {
  const requested = normalizeSymbol(requestedSymbol);
  const candidate = normalizeSymbol(candidateSymbol);
  if (!requested || !candidate) {
    return 0;
  }

  if (candidate === requested) {
    return 1000;
  }

  const reqCanon = canonicalSymbol(requested);
  const candCanon = canonicalSymbol(candidate);

  if (reqCanon && candCanon && candCanon === reqCanon) {
    return 900;
  }

  if (candidate.startsWith(requested)) {
    return 800;
  }
  if (requested.startsWith(candidate)) {
    return 750;
  }
  if (reqCanon && candCanon && candCanon.startsWith(reqCanon)) {
    return 700;
  }
  if (reqCanon && candCanon && reqCanon.startsWith(candCanon)) {
    return 650;
  }

  return 0;
};

const resolveBestSymbolMatch = ({ eaBridgeService, broker, requestedSymbol, availableSymbols }) => {
  const requested = normalizeSymbol(requestedSymbol);
  if (!requested) {
    return null;
  }

  const set = availableSymbols instanceof Set ? availableSymbols : new Set();
  if (set.has(requested)) {
    return requested;
  }

  // Prefer EA bridge resolution (it knows broker-specific matching rules).
  try {
    if (eaBridgeService && typeof eaBridgeService.resolveSymbolFromQuotes === 'function') {
      const resolved = eaBridgeService.resolveSymbolFromQuotes(broker, requested, {
        maxAgeMs: 5 * 60 * 1000
      });
      const normalizedResolved = normalizeSymbol(resolved);
      if (normalizedResolved) {
        return normalizedResolved;
      }
    }
  } catch (_error) {
    // best-effort
  }

  // Fallback: match against the available symbol set using the same scoring heuristics.
  let best = null;
  let bestScore = 0;
  for (const candidate of set) {
    const score = scoreSymbolMatch(requested, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
      continue;
    }
    if (score === bestScore && best) {
      if (String(candidate).length < String(best).length) {
        best = candidate;
      }
    }
  }

  return bestScore > 0 ? best : requested;
};

const toEpochMs = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  // Accept seconds or milliseconds.
  return numeric > 10_000_000_000 ? numeric : numeric * 1000;
};

const pearsonCorrelation = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length < 3) {
    return null;
  }

  const n = a.length;
  let sumA = 0;
  let sumB = 0;

  for (let i = 0; i < n; i += 1) {
    sumA += a[i];
    sumB += b[i];
  }

  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;

  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  if (varA <= 0 || varB <= 0) {
    return null;
  }

  return cov / Math.sqrt(varA * varB);
};

const buildCloseSeries = (bars) => {
  const list = Array.isArray(bars) ? bars : [];
  const mapped = list
    .map((bar) => {
      if (!bar || typeof bar !== 'object') {
        return null;
      }
      const t = toEpochMs(bar.time ?? bar.timestamp ?? bar.t);
      const close = toFiniteNumber(bar.close ?? bar.c);
      if (t == null || close == null || close <= 0) {
        return null;
      }
      return { t, close };
    })
    .filter(Boolean);

  // Backend returns newest-first.
  mapped.sort((a, b) => Number(a.t) - Number(b.t));

  // De-dup by timestamp (keep last).
  const dedup = [];
  const seen = new Set();
  for (let i = mapped.length - 1; i >= 0; i -= 1) {
    const item = mapped[i];
    if (!seen.has(item.t)) {
      seen.add(item.t);
      dedup.push(item);
    }
  }
  dedup.sort((a, b) => Number(a.t) - Number(b.t));
  return dedup;
};

const alignLogReturns = (seriesA, seriesB) => {
  const a = Array.isArray(seriesA) ? seriesA : [];
  const b = Array.isArray(seriesB) ? seriesB : [];
  if (a.length < 4 || b.length < 4) {
    return { aReturns: [], bReturns: [], sampleSize: 0 };
  }

  const bByTime = new Map(b.map((p) => [p.t, p.close]));

  const aReturns = [];
  const bReturns = [];

  for (let i = 1; i < a.length; i += 1) {
    const t = a[i].t;
    const tPrev = a[i - 1].t;

    const bClose = bByTime.get(t);
    const bPrevClose = bByTime.get(tPrev);
    if (bClose == null || bPrevClose == null) {
      continue;
    }

    const aClose = a[i].close;
    const aPrevClose = a[i - 1].close;

    if (aPrevClose <= 0 || bPrevClose <= 0) {
      continue;
    }

    aReturns.push(Math.log(aClose / aPrevClose));
    bReturns.push(Math.log(bClose / bPrevClose));
  }

  return { aReturns, bReturns, sampleSize: aReturns.length };
};

const sliceTail = (arr, count) => {
  if (!Array.isArray(arr) || count <= 0) {
    return [];
  }
  return arr.slice(Math.max(0, arr.length - count));
};

const sliceWindowBeforeTail = (arr, tailCount, windowCount) => {
  if (!Array.isArray(arr) || tailCount <= 0 || windowCount <= 0) {
    return [];
  }
  const end = Math.max(0, arr.length - tailCount);
  const start = Math.max(0, end - windowCount);
  return arr.slice(start, end);
};

const mean = (arr) => {
  const xs = Array.isArray(arr) ? arr.filter((v) => Number.isFinite(Number(v))) : [];
  if (!xs.length) {
    return null;
  }
  return xs.reduce((acc, x) => acc + Number(x), 0) / xs.length;
};

const stddev = (arr) => {
  const m = mean(arr);
  if (m == null) {
    return null;
  }
  const xs = Array.isArray(arr) ? arr.filter((v) => Number.isFinite(Number(v))) : [];
  if (xs.length < 2) {
    return null;
  }
  const variance = xs.reduce((acc, x) => acc + (Number(x) - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
};

const computeWindowStability = ({ nowA, nowB, segments = 4 }) => {
  if (!Array.isArray(nowA) || !Array.isArray(nowB) || nowA.length !== nowB.length) {
    return { segments: 0, corrStd: null };
  }

  const n = nowA.length;
  const segN = Math.max(10, Math.floor(n / Math.max(2, segments)));
  if (segN < 10) {
    return { segments: 0, corrStd: null };
  }

  const corrs = [];
  for (let i = 0; i + segN <= n; i += segN) {
    const a = nowA.slice(i, i + segN);
    const b = nowB.slice(i, i + segN);
    const c = pearsonCorrelation(a, b);
    if (c != null) {
      corrs.push(c);
    }
  }

  return {
    segments: corrs.length,
    corrStd: corrs.length >= 2 ? Number(stddev(corrs).toFixed(3)) : null
  };
};

const expectedCorrelationSign = ({ pair, peer }) => {
  const p = canonicalSymbol(pair);
  const q = canonicalSymbol(peer);

  // High-confidence, commonly traded relationships.
  const usdIndexSymbols = new Set(['USDX', 'DXY', 'USDIDX']);
  const nasdaqSymbols = new Set(['NAS100', 'US100', 'USTEC', 'NASDAQ']);

  if (p === 'XAUUSD' && usdIndexSymbols.has(q)) {
    return -1;
  }
  if (usdIndexSymbols.has(p) && q === 'XAUUSD') {
    return -1;
  }

  if (p === 'EURUSD' && usdIndexSymbols.has(q)) {
    return -1;
  }
  if (usdIndexSymbols.has(p) && q === 'EURUSD') {
    return -1;
  }

  if ((p === 'BTCUSD' || p === 'BTCUSDT') && nasdaqSymbols.has(q)) {
    return 1;
  }
  if (nasdaqSymbols.has(p) && (q === 'BTCUSD' || q === 'BTCUSDT')) {
    return 1;
  }

  // FX heuristics (high-confidence): relate USD-quoted vs USD-based pairs.
  const fxA = parseFxPair(p);
  const fxB = parseFxPair(q);
  if (fxA && fxB) {
    const aUsdQuote = fxA.quote === 'USD';
    const aUsdBase = fxA.base === 'USD';
    const bUsdQuote = fxB.quote === 'USD';
    const bUsdBase = fxB.base === 'USD';

    // Both USD-quoted (EURUSD, GBPUSD, AUDUSD...) tend to co-move.
    if (aUsdQuote && bUsdQuote) {
      return 1;
    }

    // Both USD-based (USDJPY, USDCHF, USDCAD...) tend to co-move.
    if (aUsdBase && bUsdBase) {
      return 1;
    }

    // USD-quoted vs USD-based tends to be inverse (USD strength flips one up and the other down).
    if ((aUsdQuote && bUsdBase) || (aUsdBase && bUsdQuote)) {
      return -1;
    }
  }

  return null;
};

const pickFirstAvailable = (availableSymbols, candidates) => {
  const set = availableSymbols instanceof Set ? availableSymbols : new Set();
  for (const c of candidates) {
    const sym = normalizeSymbol(c);
    if (!sym) {
      continue;
    }

    if (set.has(sym)) {
      return sym;
    }

    // Suffix/alias match: EURUSD -> EURUSDm, XAUUSD -> XAUUSD#, etc.
    let best = null;
    let bestScore = 0;
    for (const candidate of set) {
      const score = scoreSymbolMatch(sym, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
        continue;
      }
      if (score === bestScore && best) {
        if (String(candidate).length < String(best).length) {
          best = candidate;
        }
      }
    }

    if (bestScore > 0 && best) {
      return best;
    }
  }
  return null;
};

const buildPeerList = ({ pair, assetClass, availableSymbols }) => {
  const p = normalizeSymbol(pair);
  const cls = String(assetClass || '').toLowerCase();
  const fx = cls === 'forex' ? parseFxPair(p) : null;

  const usdIndex =
    pickFirstAvailable(availableSymbols, ['USDX', 'DXY', 'USDIDX']) ||
    (availableSymbols?.size ? null : 'USDX');

  const gold =
    pickFirstAvailable(availableSymbols, ['XAUUSD', 'GOLD']) ||
    (availableSymbols?.size ? null : 'XAUUSD');

  const btc =
    pickFirstAvailable(availableSymbols, ['BTCUSD', 'BTCUSDT', 'BITCOIN']) ||
    (availableSymbols?.size ? null : 'BTCUSD');

  const eth =
    pickFirstAvailable(availableSymbols, ['ETHUSD', 'ETHUSDT', 'ETHEREUM']) ||
    (availableSymbols?.size ? null : 'ETHUSD');

  const nasdaq =
    pickFirstAvailable(availableSymbols, ['NAS100', 'US100', 'USTEC', 'NASDAQ']) ||
    (availableSymbols?.size ? null : 'NAS100');

  const spx =
    pickFirstAvailable(availableSymbols, ['US500', 'SPX500', 'SP500']) ||
    (availableSymbols?.size ? null : 'US500');

  const allowCryptoPeersForFx =
    String(process.env.INCLUDE_CRYPTO_PEERS_FOR_FX || '')
      .trim()
      .toLowerCase() === 'true';

  const peers = [];
  const push = (symbol, role, core = true) => {
    const s = normalizeSymbol(symbol);
    if (!s || s === p) {
      return;
    }
    peers.push({ symbol: s, role, core: core !== false });
  };

  // Core macro anchors.
  push(usdIndex, 'macro.usd_index', true);
  push(gold, 'macro.gold', true);

  // Risk proxies: helpful context; non-core for FX to avoid over-vetoing.
  push(nasdaq, 'risk.nasdaq', cls !== 'forex');
  push(spx, 'risk.spx', cls !== 'forex');

  if (cls === 'crypto') {
    push(p === btc ? eth : btc, 'crypto.peer', true);
    push(p === eth ? btc : eth, 'crypto.peer', true);
  } else if (cls !== 'forex' || allowCryptoPeersForFx) {
    push(btc, 'crypto.anchor', false);
  }

  if (cls === 'forex') {
    // Always include a few majors.
    push('EURUSD', 'fx.major', true);
    push('GBPUSD', 'fx.major', true);
    push('USDJPY', 'fx.major', true);

    if (fx) {
      const { base, quote } = fx;

      // Crosses: include synthetic legs where possible.
      if (base !== 'USD' && quote !== 'USD') {
        push(`${base}USD`, 'fx.leg', true);
        push(`USD${quote}`, 'fx.leg', true);
      }

      // USD-complex basket to detect broad USD moves.
      push('AUDUSD', 'fx.usd_complex', true);
      push('USDCAD', 'fx.usd_complex', true);
      push('USDCHF', 'fx.usd_complex', true);
    }
  }

  // De-dup while preserving order.
  const seen = new Set();
  const unique = [];
  for (const item of peers) {
    const sym = normalizeSymbol(item?.symbol);
    if (!sym || sym === p || seen.has(sym)) {
      continue;
    }
    seen.add(sym);
    unique.push({ symbol: sym, role: item?.role || null, core: item?.core !== false });
  }

  return unique;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function computeIntermarketCorrelation({
  eaBridgeService,
  broker,
  pair,
  assetClass,
  timeframe = 'M15',
  window = 96,
  maxAgeMs = 0
} = {}) {
  const brokerId = String(broker || '')
    .trim()
    .toLowerCase();
  const requestedTarget = normalizeSymbol(pair);
  const tf = normalizeSymbol(timeframe);
  const windowN = Math.max(20, Math.min(600, Number(window) || 96));

  if (!eaBridgeService || typeof eaBridgeService.getMarketBars !== 'function') {
    return {
      available: false,
      target: requestedTarget,
      timeframe: tf,
      window: windowN,
      source: 'ea-bars',
      peers: [],
      warnings: ['EA bars API is not available in this runtime.'],
      updatedAt: Date.now()
    };
  }

  if (!brokerId || !requestedTarget) {
    return {
      available: false,
      target: requestedTarget,
      timeframe: tf,
      window: windowN,
      source: 'ea-bars',
      peers: [],
      warnings: ['broker and pair are required for intermarket correlation.'],
      updatedAt: Date.now()
    };
  }

  const warnings = [];

  const availableSymbols = (() => {
    try {
      if (typeof eaBridgeService.getQuotes !== 'function') {
        return new Set();
      }
      const quotes = eaBridgeService.getQuotes({ broker: brokerId, maxAgeMs: 5 * 60 * 1000 });
      const symbols = (Array.isArray(quotes) ? quotes : [])
        .map((q) => normalizeSymbol(q?.symbol || q?.pair))
        .filter(Boolean);
      return new Set(symbols);
    } catch (_error) {
      return new Set();
    }
  })();

  const target = resolveBestSymbolMatch({
    eaBridgeService,
    broker: brokerId,
    requestedSymbol: requestedTarget,
    availableSymbols
  });

  const peersRequested = buildPeerList({ pair: target, assetClass, availableSymbols });
  const peers = (() => {
    const out = [];
    const seen = new Set();
    for (const peer of Array.isArray(peersRequested) ? peersRequested : []) {
      const resolved = resolveBestSymbolMatch({
        eaBridgeService,
        broker: brokerId,
        requestedSymbol: peer?.symbol,
        availableSymbols
      });
      const sym = normalizeSymbol(resolved);
      if (!sym || sym === target || seen.has(sym)) {
        continue;
      }
      seen.add(sym);
      out.push({ symbol: sym, role: peer?.role || null, core: peer?.core !== false });
    }
    return out;
  })();

  // Ask the EA/bridge to keep these symbols hot (best-effort).
  try {
    if (typeof eaBridgeService.touchActiveSymbol === 'function') {
      eaBridgeService.touchActiveSymbol({
        broker: brokerId,
        symbol: target,
        ttlMs: 15 * 60 * 1000
      });
      for (const peer of peers.slice(0, 10)) {
        eaBridgeService.touchActiveSymbol({
          broker: brokerId,
          symbol: peer.symbol,
          ttlMs: 10 * 60 * 1000
        });
      }
    }
  } catch (_error) {
    // ignore
  }

  const limit = Math.max(windowN * 2 + 5, 80);

  const targetBars = eaBridgeService.getMarketBars({
    broker: brokerId,
    symbol: target,
    timeframe: tf,
    limit,
    maxAgeMs
  });

  const targetSeries = buildCloseSeries(targetBars);
  if (targetSeries.length < windowN + 3) {
    return {
      available: false,
      target,
      timeframe: tf,
      window: windowN,
      source: 'ea-bars',
      peers: [],
      warnings: [`Not enough EA bars for ${target} (${targetSeries.length} < ${windowN + 3}).`],
      requestedTarget,
      updatedAt: Date.now()
    };
  }

  const tfMs = TF_TO_MS[tf] || null;
  const latestTarget = targetSeries[targetSeries.length - 1];
  if (tfMs && latestTarget?.t) {
    const ageMs = Math.max(0, Date.now() - latestTarget.t);
    if (ageMs > tfMs * 3) {
      warnings.push(`Target bars appear stale (age ~${Math.round(ageMs / 1000)}s).`);
    }
  }

  const peerResults = [];

  for (const peerMeta of peers) {
    const peer = peerMeta?.symbol;
    let peerSeries = [];
    try {
      const bars = eaBridgeService.getMarketBars({
        broker: brokerId,
        symbol: peer,
        timeframe: tf,
        limit,
        maxAgeMs
      });
      peerSeries = buildCloseSeries(bars);
    } catch (_error) {
      peerSeries = [];
    }

    if (peerSeries.length < windowN + 3) {
      peerResults.push({
        peer,
        role: peerMeta?.role || null,
        core: peerMeta?.core !== false,
        available: false,
        sampleSize: 0,
        corr: null,
        corrPrev: null,
        delta: null,
        break: null,
        expectedSign: expectedCorrelationSign({ pair: target, peer }),
        stability: { corrStd: null, segments: 0 },
        note: `Not enough bars (${peerSeries.length}).`
      });
      continue;
    }

    const { aReturns, bReturns, sampleSize } = alignLogReturns(targetSeries, peerSeries);
    if (sampleSize < windowN) {
      peerResults.push({
        peer,
        role: peerMeta?.role || null,
        core: peerMeta?.core !== false,
        available: false,
        sampleSize,
        corr: null,
        corrPrev: null,
        delta: null,
        break: null,
        expectedSign: expectedCorrelationSign({ pair: target, peer }),
        stability: { corrStd: null, segments: 0 },
        note: 'Insufficient aligned bars between symbols.'
      });
      continue;
    }

    const nowA = sliceTail(aReturns, windowN);
    const nowB = sliceTail(bReturns, windowN);
    const corrNow = pearsonCorrelation(nowA, nowB);

    const prevA = sliceWindowBeforeTail(aReturns, windowN, windowN);
    const prevB = sliceWindowBeforeTail(bReturns, windowN, windowN);
    const corrPrev =
      prevA.length === windowN && prevB.length === windowN
        ? pearsonCorrelation(prevA, prevB)
        : null;

    const delta =
      corrNow != null && corrPrev != null ? Number((corrNow - corrPrev).toFixed(3)) : null;

    const stability = computeWindowStability({ nowA, nowB, segments: 4 });

    const breakFlag = (() => {
      if (corrNow == null || corrPrev == null) {
        return null;
      }
      const absNow = Math.abs(corrNow);
      const absPrev = Math.abs(corrPrev);
      const absDelta = Math.abs(corrNow - corrPrev);
      const signFlip = corrNow * corrPrev < 0 && absNow > 0.35 && absPrev > 0.35;

      // Ignore low-correlation noise shifts.
      if (absNow < 0.2 && absPrev < 0.2) {
        return false;
      }

      return absDelta >= 0.35 || signFlip;
    })();

    const expected = expectedCorrelationSign({ pair: target, peer });
    const alignment =
      expected == null || corrNow == null
        ? null
        : expected > 0
          ? corrNow >= 0.15
          : corrNow <= -0.15;

    peerResults.push({
      peer,
      role: peerMeta?.role || null,
      core: peerMeta?.core !== false,
      available: corrNow != null,
      sampleSize,
      corr: corrNow != null ? Number(corrNow.toFixed(3)) : null,
      corrPrev: corrPrev != null ? Number(corrPrev.toFixed(3)) : null,
      delta,
      break: breakFlag,
      expectedSign: expected,
      alignedWithExpectation: alignment,
      stability,
      note: null
    });
  }

  const usable = peerResults.filter((p) => p.available && typeof p.corr === 'number');
  usable.sort((a, b) => Math.abs(Number(b.corr)) - Math.abs(Number(a.corr)));

  const breaks = usable.filter((p) => p.break === true);

  const usableCore = usable.filter((p) => p.core !== false);
  const breaksCore = usableCore.filter((p) => p.break === true);
  const conflictsCore = usableCore.filter((p) => p.alignedWithExpectation === false);

  const avgStd = (() => {
    const xs = usableCore
      .map((p) => toFiniteNumber(p?.stability?.corrStd))
      .filter((v) => v != null);
    const m = mean(xs);
    return m != null ? Number(m.toFixed(3)) : null;
  })();

  const requestedCorePeers = peers.filter((p) => p.core !== false).length;
  const coverage = requestedCorePeers > 0 ? usableCore.length / requestedCorePeers : 0;
  const instabilityPenalty =
    (breaksCore.length ? 0.35 : 0) +
    (conflictsCore.length ? 0.25 : 0) +
    (avgStd != null ? Math.min(0.35, avgStd * 2.5) : 0);

  const confidence = clamp(Math.round(coverage * (1 - instabilityPenalty) * 100), 0, 100);

  const stabilityScore = clamp(
    Math.round(
      100 -
        breaksCore.length * 25 -
        conflictsCore.length * 20 -
        (avgStd != null ? Math.min(40, avgStd * 120) : 0)
    ),
    0,
    100
  );

  return {
    available: usable.length > 0,
    target,
    timeframe: tf,
    window: windowN,
    source: 'ea-bars',
    peers: peerResults,
    top: usable.slice(0, 6),
    breaks: breaks.map((b) => ({ peer: b.peer, corr: b.corr, delta: b.delta })),
    confidence,
    stability: {
      usablePeers: usable.length,
      usableCorePeers: usableCore.length,
      requestedPeers: peers.length,
      requestedCorePeers,
      breaksCore: breaksCore.length,
      conflictsCore: conflictsCore.length,
      avgCorrStd: avgStd,
      stabilityScore
    },
    warnings,
    requestedTarget,
    updatedAt: Date.now()
  };
}
