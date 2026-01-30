const normalizeDirection = (value) => {
  const dir = String(value || '').toUpperCase();
  if (dir === 'BUY' || dir === 'SELL') {
    return dir;
  }
  return 'NEUTRAL';
};

const toFiniteNumber = (value) => {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const pct = (value) => {
  const n = toFiniteNumber(value);
  if (n == null) {
    return null;
  }
  return clamp(Math.round(n), 0, 100);
};

const formatDirection = (direction) => {
  const dir = normalizeDirection(direction);
  if (dir === 'BUY') {
    return { dir, arrow: '▲' };
  }
  if (dir === 'SELL') {
    return { dir, arrow: '▼' };
  }
  return { dir: 'NEUTRAL', arrow: '•' };
};

const safeObj = (value) => (value && typeof value === 'object' ? value : null);

const safeArray = (value) => (Array.isArray(value) ? value : []);

const confluenceIndex = (confluence) => {
  const layers = safeArray(confluence?.layers);
  const byId = new Map();
  for (const l of layers) {
    const id = l?.id != null ? String(l.id) : null;
    if (id) {
      byId.set(id, l);
    }
  }
  return { layers, byId };
};

const marketPhaseLabel = (phase) => {
  const p = String(phase || '').toLowerCase();
  if (p === 'accumulation') {
    return { phase: 'accumulation', en: 'Accumulation', ar: 'تجميع' };
  }
  if (p === 'expansion') {
    return { phase: 'expansion', en: 'Expansion', ar: 'تمدد/اندفاع' };
  }
  if (p === 'distribution') {
    return { phase: 'distribution', en: 'Distribution', ar: 'تصريف' };
  }
  if (p === 'retracement') {
    return { phase: 'retracement', en: 'Retracement', ar: 'تصحيح/ارتداد' };
  }
  return { phase: 'unknown', en: 'Unknown', ar: 'غير معروف' };
};

const inferMarketPhase = ({ regime, volatility, structure, smcAccDist, trendPct, candleDir }) => {
  const ad = String(smcAccDist?.state || '').toLowerCase();
  if (ad.includes('accum')) {
    return 'accumulation';
  }
  if (ad.includes('dist')) {
    return 'distribution';
  }

  const reg = String(regime?.state || '').toLowerCase();
  const vol = String(volatility?.state || '').toLowerCase();
  const sBias = String(structure?.bias || '').toUpperCase();
  const cDir = normalizeDirection(candleDir);
  const t = Number.isFinite(Number(trendPct)) ? Number(trendPct) : null;

  // Retracement heuristic: candle bias goes against structure bias while overall trend magnitude is not extreme.
  if ((sBias === 'BUY' || sBias === 'SELL') && (cDir === 'BUY' || cDir === 'SELL')) {
    const against = sBias !== cDir;
    if (against && (t == null || Math.abs(t) <= 0.12)) {
      return 'retracement';
    }
  }

  // Expansion heuristic: trending/non-range + tradeable vol.
  if (reg && reg !== 'range' && (vol === 'normal' || vol === 'high')) {
    return 'expansion';
  }

  // Range + low vol defaults to accumulation (neutral bucket).
  if (reg === 'range' || vol === 'low') {
    return 'accumulation';
  }

  return 'unknown';
};

const inferLiquidityQuality = ({ liquidityHint, spreadPoints, quoteVolume, smcVolumeSpike }) => {
  const hint = String(liquidityHint || '').toLowerCase();
  const sp = Number.isFinite(Number(spreadPoints)) ? Number(spreadPoints) : null;
  const vol = Number.isFinite(Number(quoteVolume)) ? Number(quoteVolume) : null;
  const spike = Boolean(smcVolumeSpike?.isSpike);

  let score = 60;
  if (hint.includes('deep') || hint.includes('real') || hint.includes('good')) {
    score += 18;
  }
  if (
    hint.includes('thin') ||
    hint.includes('fake') ||
    hint.includes('poor') ||
    hint.includes('low')
  ) {
    score -= 22;
  }
  if (sp != null) {
    if (sp <= 15) {
      score += 12;
    } else if (sp >= 35) {
      score -= 20;
    } else if (sp >= 25) {
      score -= 10;
    }
  }
  if (vol != null) {
    if (vol >= 150) {
      score += 10;
    } else if (vol <= 40) {
      score -= 10;
    }
  }
  if (spike) {
    score += 8;
  }
  score = clamp(Math.round(score), 0, 100);

  const quality = score >= 70 ? 'real' : score <= 45 ? 'thin_or_fake' : 'mixed';
  return { quality, score };
};

const pipFactorFromPair = (pair) => {
  const p = String(pair || '').toUpperCase();
  if (!p) {
    return null;
  }
  if (p.includes('JPY')) {
    return 100; // 0.01
  }
  if (p.includes('XAU') || p.includes('XAG')) {
    return 10; // metals (rough)
  }
  return 10000; // 0.0001
};

const estimateFailureCost = ({ pair, entry, quoteMidVelocityPerSec }) => {
  const pipFactor = pipFactorFromPair(pair);
  const ep = toFiniteNumber(entry?.price);
  const sl = toFiniteNumber(entry?.stopLoss);
  const vel = toFiniteNumber(quoteMidVelocityPerSec);
  if (pipFactor == null || ep == null || sl == null) {
    return { available: false };
  }
  const dist = Math.abs(ep - sl);
  const distPips = dist * pipFactor;
  const timeToStopSec = vel != null && Math.abs(vel) > 1e-12 ? dist / Math.abs(vel) : null;
  return {
    available: true,
    invalidationDistancePips: Number(distPips.toFixed(1)),
    timeToInvalidationSec: timeToStopSec != null ? Math.round(timeToStopSec) : null,
  };
};

const sessionFromUtc = (utcHour) => {
  const h = Number(utcHour);
  if (!Number.isFinite(h)) {
    return { session: 'unknown', labelEn: 'Unknown', labelAr: 'غير معروف' };
  }

  // Rough UTC session blocks.
  // Asia: 00-08, London: 07-16, New York: 12-21.
  const asia = h >= 0 && h <= 8;
  const london = h >= 7 && h <= 16;
  const ny = h >= 12 && h <= 21;

  if (london && ny) {
    return {
      session: 'london_ny_overlap',
      labelEn: 'London/NY overlap',
      labelAr: 'تداخل لندن/نيويورك',
    };
  }
  if (asia && london) {
    return {
      session: 'asia_london_overlap',
      labelEn: 'Asia/London overlap',
      labelAr: 'تداخل آسيا/لندن',
    };
  }
  if (ny) {
    return { session: 'new_york', labelEn: 'New York', labelAr: 'نيويورك' };
  }
  if (london) {
    return { session: 'london', labelEn: 'London', labelAr: 'لندن' };
  }
  if (asia) {
    return { session: 'asia', labelEn: 'Asia', labelAr: 'آسيا' };
  }
  return { session: 'off_hours', labelEn: 'Off-hours', labelAr: 'خارج الجلسات' };
};

const pickTimeframe = (candlesByTimeframe) => {
  const map = safeObj(candlesByTimeframe) || {};
  const order = ['H1', 'M15', 'H4', 'D1', 'M1'];
  for (const tf of order) {
    const a = map[tf] || map[String(tf).toLowerCase()];
    if (a && typeof a === 'object') {
      return { tf, analysis: a };
    }
  }
  const entries = Object.entries(map);
  if (entries.length) {
    const [tf, analysis] = entries[0];
    if (analysis && typeof analysis === 'object') {
      return { tf, analysis };
    }
  }
  return { tf: null, analysis: null };
};

const buildLayer = ({
  number,
  nameEn,
  nameAr,
  direction,
  confidence,
  score,
  summaryEn,
  summaryAr,
  metrics,
  evidence,
  warnings,
  availability,
}) => {
  const { dir, arrow } = formatDirection(direction);
  return {
    layer: number,
    key: `L${number}`,
    nameEn,
    nameAr,
    direction: dir,
    arrow,
    confidence: pct(confidence),
    score: toFiniteNumber(score),
    availability: availability || 'best_effort',
    summaryEn: summaryEn || null,
    summaryAr: summaryAr || null,
    metrics: safeObj(metrics) || {},
    evidence: safeArray(evidence),
    warnings: safeArray(warnings),
  };
};

export function buildLayeredAnalysis({ scenario, signal } = {}) {
  const scn = safeObj(scenario) || {};
  const sig = safeObj(signal) || {};

  const pair = scn.pair || sig.pair || null;
  const market = safeObj(scn.market) || {};
  const quote = safeObj(market.quote) || {};

  const factors = safeObj(scn.factors) || {};
  const econ = safeObj(factors.economic) || {};
  const news = safeObj(factors.news) || {};
  const technical = safeObj(factors.technical) || {};
  const candlesSummary =
    safeObj(factors.candles) || safeObj(sig?.components?.technical?.candlesSummary) || null;

  const candlesByTimeframe =
    safeObj(sig?.components?.technical?.candlesByTimeframe) ||
    safeObj(sig?.components?.technical?.candlesByTimeframe) ||
    null;

  const { tf: pickTf, analysis: pickAnalysis } = pickTimeframe(candlesByTimeframe);

  const primary = safeObj(scn.primary) || {};
  const finalDirection = normalizeDirection(primary.direction || sig.direction);
  const finalConfidence = toFiniteNumber(primary.confidence ?? sig.confidence);
  const finalScore = toFiniteNumber(primary.finalScore ?? sig.finalScore);

  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDow = now.getUTCDay();
  const session = sessionFromUtc(utcHour);

  const quoteDigits = toFiniteNumber(quote.digits);
  const quotePoint = toFiniteNumber(quote.point);

  let spreadPoints = toFiniteNumber(quote.spreadPoints);
  let spread = toFiniteNumber(quote.spread);
  let spreadPct = toFiniteNumber(quote.spreadPct);
  const quoteAgeMs = toFiniteNumber(quote.ageMs);

  const quoteSource = String(quote?.source || '').toLowerCase();
  const barsOnlySource =
    quoteSource.includes('ea') &&
    (quoteSource.includes('bars') || quoteSource.includes('snapshot'));

  let quoteBid = toFiniteNumber(quote.bid);
  let quoteAsk = toFiniteNumber(quote.ask);
  const quoteLast = toFiniteNumber(quote.last);
  let quoteMid = toFiniteNumber(quote.mid);

  // If the EA feed is operating in "bars-only" mode (or broker blocks tick access),
  // we may have a valid mid/last but bid/ask = 0. Synthesize bid/ask so the dashboard
  // doesn't render zeros for otherwise-usable market data.
  const fallbackPrice = quoteLast != null ? quoteLast : quoteMid;
  if (!barsOnlySource && fallbackPrice != null) {
    if (!(quoteBid > 0)) {
      quoteBid = fallbackPrice;
    }
    if (!(quoteAsk > 0)) {
      quoteAsk = fallbackPrice;
    }
    if (quoteMid == null) {
      quoteMid = (quoteBid + quoteAsk) / 2;
    }
  }
  const inferredSpread =
    quoteBid != null && quoteAsk != null && quoteAsk > quoteBid
      ? Number((quoteAsk - quoteBid).toFixed(8))
      : null;
  if (spread == null) {
    spread = inferredSpread;
  }
  if (spreadPct == null && spread != null && quoteMid != null && quoteMid > 0) {
    spreadPct = Number(((spread / quoteMid) * 100).toFixed(4));
  }
  if (spreadPoints == null && spread != null) {
    const point =
      quotePoint != null && quotePoint > 0
        ? quotePoint
        : quoteDigits != null && quoteDigits >= 0
          ? 1 / 10 ** quoteDigits
          : null;
    if (point != null && point > 0) {
      spreadPoints = Number((spread / point).toFixed(2));
    }
  }

  if (barsOnlySource && inferredSpread == null) {
    if (spread === 0) {
      spread = null;
    }
    if (spreadPoints === 0) {
      spreadPoints = null;
    }
    if (spreadPct === 0) {
      spreadPct = null;
    }
  }
  const quoteMidDelta = toFiniteNumber(quote.midDelta);
  const quoteMidVelocityPerSec = toFiniteNumber(quote.midVelocityPerSec);
  const quoteMidAccelerationPerSec2 = toFiniteNumber(quote.midAccelerationPerSec2);
  const liquidityHint = quote?.liquidityHint || null;
  const quoteVolume = toFiniteNumber(quote.volume);
  const gapToMid = toFiniteNumber(quote.gapToMid);
  const gapOpen = toFiniteNumber(quote.gapOpen);
  const quotePending = Boolean(quote.pending);
  const barsCoverage = safeObj(market?.barsCoverage) || null;
  const m15Bars = safeObj(barsCoverage?.M15) || null;
  const h1Bars = safeObj(barsCoverage?.H1) || null;

  const regime = safeObj(pickAnalysis?.regime) || safeObj(candlesSummary?.regime) || null;
  const volatility =
    safeObj(pickAnalysis?.volatility) || safeObj(candlesSummary?.volatility) || null;
  const structure = safeObj(pickAnalysis?.structure) || safeObj(candlesSummary?.structure) || null;
  const patterns = safeArray(pickAnalysis?.patterns || candlesSummary?.patterns);

  const smc = safeObj(pickAnalysis?.smc) || null;
  const smcSweep = safeObj(smc?.liquiditySweep) || null;
  const smcOrderBlock = safeObj(smc?.orderBlock) || null;
  const smcPriceImbalance = safeObj(smc?.priceImbalance) || null;
  const smcVolumeSpike = safeObj(smc?.volumeSpike) || null;
  const smcVolumeImbalance = safeObj(smc?.volumeImbalance) || null;
  const smcAccDist = safeObj(smc?.accumulationDistribution) || null;
  const memoryFlags = safeArray(smcAccDist?.tags || smcAccDist?.flags || []);
  const memoryScore = clamp(
    (memoryFlags.includes('sweep') ? 30 : 0) +
      (memoryFlags.includes('rejection') ? 30 : 0) +
      (memoryFlags.includes('volume_spike') ? 25 : 0) +
      (memoryFlags.length ? 15 : 0),
    0,
    100
  );

  const liquidityDefenseScore = clamp(
    (smcSweep?.detected ? 35 : 0) +
      (smcPriceImbalance?.detected ? 25 : 0) +
      (smcOrderBlock?.detected ? 25 : 0) +
      (smcVolumeImbalance?.detected ? 15 : 0),
    0,
    100
  );

  const rsi = toFiniteNumber(pickAnalysis?.rsi ?? candlesSummary?.rsi);
  const trendPct = toFiniteNumber(pickAnalysis?.trendPct ?? candlesSummary?.trendPct);
  const atrPct = toFiniteNumber(volatility?.atrPct);

  const trendScore =
    trendPct != null ? clamp(Math.min(100, Math.abs(trendPct) * 700), 0, 100) : null;

  const newsImpactScore = toFiniteNumber(market?.news?.impactScore);
  const newsUpcoming = toFiniteNumber(news?.upcomingEvents);

  const fundamentals = safeObj(scn.fundamentals) || {};
  const macroRelative = safeObj(fundamentals.relative) || {};

  const intermarket = safeObj(scn.intermarket) || {};
  const intermarketCorrelation = safeObj(intermarket.correlation) || null;

  const decisionState =
    scn?.decision?.state || sig?.finalDecision?.state || sig?.isValid?.decision?.state || null;
  const isTradeValid =
    decisionState === 'ENTER'
      ? true
      : Boolean(scn?.decision?.isTradeValid ?? sig?.isValid?.isValid);
  const isBlocked =
    decisionState === 'NO_TRADE_BLOCKED' ||
    Boolean(scn?.decision?.blocked ?? sig?.isValid?.decision?.blocked);
  const checks = safeObj(scn?.decision?.checks ?? sig?.isValid?.checks) || {};
  const decisionScore = toFiniteNumber(
    scn?.decision?.score ?? sig?.finalDecision?.score ?? sig?.isValid?.decision?.score
  );
  const missing = safeArray(scn?.decision?.missing ?? sig?.isValid?.decision?.missing).slice(0, 10);
  const whatWouldChange = safeArray(
    scn?.decision?.whatWouldChange ?? sig?.isValid?.decision?.whatWouldChange
  ).slice(0, 10);

  const killSwitch =
    safeObj(scn?.decision?.killSwitch ?? sig?.isValid?.decision?.killSwitch) || null;
  const killSwitchIds = safeArray(killSwitch?.ids)
    .map((v) => String(v || ''))
    .filter(Boolean);
  const killSwitchItems = safeArray(killSwitch?.items)
    .map((it) => ({
      id: it?.id != null ? String(it.id) : null,
      reason: it?.reason != null ? String(it.reason) : null,
      label: it?.label != null ? String(it.label) : null,
    }))
    .filter((it) => Boolean(it.id));

  const confluence = safeObj(sig?.components?.confluence) || null;
  const { layers: confluenceLayers, byId: confluenceById } = confluenceIndex(confluence);
  const marketMemory = safeObj(sig?.components?.marketMemory) || null;

  const layers = [];

  // 1) Raw market data
  const rawWarnings = [];
  if (quotePending) {
    rawWarnings.push('EA quote/snapshot requested (pending).');
  }
  if (quoteAgeMs != null && quoteAgeMs > 60_000) {
    rawWarnings.push('Quote is stale (>60s).');
  }
  if (spreadPoints != null && spreadPoints > 30) {
    rawWarnings.push('Spread is wide (execution risk).');
  }
  if (!barsCoverage || Object.keys(barsCoverage).length === 0) {
    rawWarnings.push('EA bars missing (no timeframe coverage).');
  }
  if (m15Bars?.count != null && m15Bars.count < 30) {
    rawWarnings.push('M15 bars insufficient (<30).');
  }
  if (m15Bars?.ageMs != null && m15Bars.ageMs > 30 * 60 * 1000) {
    rawWarnings.push('M15 bars stale (>30m).');
  }
  if (h1Bars?.count != null && h1Bars.count < 10) {
    rawWarnings.push('H1 bars insufficient (<10).');
  }

  layers.push(
    buildLayer({
      number: 1,
      nameEn: 'Raw Market Data',
      nameAr: 'بيانات السوق الخام',
      direction: finalDirection,
      confidence: finalConfidence,
      score: null,
      summaryEn: `Quote ${quoteLast != null ? `last=${quoteLast}` : 'unavailable'} · spread=${spreadPoints ?? '—'} pts · age=${quoteAgeMs ?? '—'}ms · v=${quoteMidVelocityPerSec ?? '—'}/s · a=${quoteMidAccelerationPerSec2 ?? '—'}/s² · gap=${gapToMid ?? '—'} · vol=${quoteVolume ?? '—'} · source=${String(quote?.source || scn?.sources?.quote?.broker || '—')}`,
      summaryAr: `سعر ${quoteLast != null ? `آخر=${quoteLast}` : 'غير متوفر'} · السبريد=${spreadPoints ?? '—'} نقطة · عمر السعر=${quoteAgeMs ?? '—'}ms · السرعة=${quoteMidVelocityPerSec ?? '—'}/ث · التسارع=${quoteMidAccelerationPerSec2 ?? '—'}/ث² · الفجوة=${gapToMid ?? '—'} · الحجم=${quoteVolume ?? '—'} · المصدر=${String(quote?.source || scn?.sources?.quote?.broker || '—')}`,
      metrics: {
        pair,
        bid: quoteBid,
        ask: quoteAsk,
        last: quoteLast,
        mid: quoteMid,
        midDelta: quoteMidDelta,
        midVelocityPerSec: quoteMidVelocityPerSec,
        midAccelerationPerSec2: quoteMidAccelerationPerSec2,
        spread,
        spreadPct,
        spreadPoints,
        liquidityHint,
        volume: quoteVolume,
        gapToMid,
        gapOpen,
        barsCoverage,
        quoteAgeMs,
        pending: quotePending,
        quoteSource: quote?.source || null,
        broker: scn?.sources?.quote?.broker || quote?.broker || scn?.broker || null,
        symbol: scn?.sources?.quote?.symbol || quote?.symbol || null,
        timeframeFocus: pickTf,
      },
      evidence: [
        quoteAgeMs != null ? `Quote freshness: ${quoteAgeMs}ms` : null,
        spreadPoints != null ? `Spread points: ${spreadPoints}` : null,
        spreadPct != null ? `Spread %: ${spreadPct}%` : null,
        liquidityHint ? `Liquidity: ${liquidityHint}` : null,
        quoteVolume != null ? `M1 volume: ${quoteVolume}` : null,
        gapToMid != null ? `Gap to M1 close: ${gapToMid}` : null,
        scn?.sources?.quote?.broker ? `Broker source: ${scn.sources.quote.broker}` : null,
        pickTf ? `Candle focus timeframe: ${pickTf}` : null,
      ].filter(Boolean),
      warnings: rawWarnings,
      availability: quoteLast != null || quoteBid != null ? 'available' : 'partial',
    })
  );

  layers.push(
    buildLayer({
      number: 9,
      nameEn: 'Market Memory Zones',
      nameAr: 'ذاكرة السوق',
      direction: finalDirection,
      confidence: toFiniteNumber(structure?.confidence ?? candlesSummary?.confidence),
      score: memoryScore,
      summaryEn: memoryFlags.length
        ? `Memory flags: ${memoryFlags.slice(0, 4).join(', ')} · score=${memoryScore}`
        : 'No dominant memory zones detected.',
      summaryAr: memoryFlags.length
        ? `إشارات الذاكرة: ${memoryFlags.slice(0, 4).join(', ')} · التقييم=${memoryScore}`
        : 'لا توجد مناطق ذاكرة بارزة حالياً.',
      metrics: {
        memoryScore,
        memoryFlags,
        marketMemory,
        trendScore,
        volatilityState: volatility?.state || null,
      },
      evidence: memoryFlags.slice(0, 6).map((f) => `Memory flag: ${f}`),
      warnings: memoryScore >= 70 ? [] : ['Memory zone not confirmed (weak).'],
      availability: memoryFlags.length ? 'available' : 'partial',
    })
  );

  layers.push(
    buildLayer({
      number: 10,
      nameEn: 'Silent Liquidity Map',
      nameAr: 'خريطة السيولة الصامتة',
      direction: finalDirection,
      confidence: toFiniteNumber(structure?.confidence ?? candlesSummary?.confidence),
      score: liquidityDefenseScore,
      summaryEn:
        liquidityDefenseScore > 0
          ? `Defense score=${liquidityDefenseScore} · sweep=${
              smcSweep?.detected ? 'yes' : 'no'
            } · orderBlock=${smcOrderBlock?.detected ? 'yes' : 'no'}`
          : 'No liquidity defense zones confirmed.',
      summaryAr:
        liquidityDefenseScore > 0
          ? `تقييم الدفاع=${liquidityDefenseScore} · اجتياح=${
              smcSweep?.detected ? 'نعم' : 'لا'
            } · كتلة أوامر=${smcOrderBlock?.detected ? 'نعم' : 'لا'}`
          : 'لا توجد مناطق دفاع سيولة مؤكدة.',
      metrics: {
        liquidityDefenseScore,
        liquiditySweep: smcSweep,
        orderBlock: smcOrderBlock,
        priceImbalance: smcPriceImbalance,
        volumeImbalance: smcVolumeImbalance,
      },
      evidence: [
        smcSweep?.detected ? 'Liquidity sweep detected' : null,
        smcOrderBlock?.detected ? 'Order block reaction' : null,
        smcPriceImbalance?.detected ? 'Price imbalance zone' : null,
        smcVolumeImbalance?.detected ? 'Volume imbalance spike' : null,
      ].filter(Boolean),
      warnings: liquidityDefenseScore >= 65 ? [] : ['Liquidity defense weak/unclear'],
      availability: liquidityDefenseScore > 0 ? 'available' : 'partial',
    })
  );

  // 2) Digital candlestick analysis
  const candleDir = normalizeDirection(candlesSummary?.direction || pickAnalysis?.direction);
  const phase = inferMarketPhase({
    regime,
    volatility,
    structure,
    smcAccDist,
    trendPct,
    candleDir,
  });
  const phaseLabel = marketPhaseLabel(phase);
  layers.push(
    buildLayer({
      number: 2,
      nameEn: 'Digital Candlestick (Numeric) Analysis',
      nameAr: 'تحليل الشموع الرقمي (أرقام)',
      direction: candleDir,
      confidence: toFiniteNumber(candlesSummary?.confidence ?? pickAnalysis?.confidence),
      score: toFiniteNumber(candlesSummary?.scoreDelta ?? pickAnalysis?.scoreDelta),
      summaryEn: candlesSummary
        ? `Bias ${candleDir} · strength=${candlesSummary.strength ?? '—'} · Δ=${candlesSummary.scoreDelta ?? '—'}`
        : 'No candle analysis available.',
      summaryAr: candlesSummary
        ? `الاتجاه ${candleDir} · القوة=${candlesSummary.strength ?? '—'} · Δ=${candlesSummary.scoreDelta ?? '—'}`
        : 'لا يوجد تحليل شموع متاح.',
      metrics: {
        timeframeFocus: pickTf,
        marketPhase: phaseLabel.phase,
        trendPct,
        rsi,
        atrPct,
        regime: regime
          ? {
              state: regime.state || null,
              confidence: toFiniteNumber(regime.confidence),
              r2: toFiniteNumber(regime.r2),
            }
          : null,
        patterns: patterns.map((p) => p?.name).filter(Boolean),
      },
      evidence: patterns.map((p) => p?.name).filter(Boolean),
      warnings: candlesSummary ? [] : ['Missing candle series/analysis from broker.'],
      availability: candlesSummary ? 'available' : 'missing',
    })
  );

  // 3) Market structure
  const d1Analysis = safeObj(candlesByTimeframe?.D1 || candlesByTimeframe?.d1) || null;
  const h4Analysis = safeObj(candlesByTimeframe?.H4 || candlesByTimeframe?.h4) || null;
  const d1Dir = normalizeDirection(d1Analysis?.direction || d1Analysis?.structure?.bias);
  const h4Dir = normalizeDirection(h4Analysis?.direction || h4Analysis?.structure?.bias);
  const htfConflict =
    (finalDirection === 'BUY' || finalDirection === 'SELL') &&
    ((d1Dir !== 'NEUTRAL' && d1Dir !== finalDirection) ||
      (h4Dir !== 'NEUTRAL' && h4Dir !== finalDirection));

  layers.push(
    buildLayer({
      number: 3,
      nameEn: 'Market Structure',
      nameAr: 'الهيكل السعري (Structure)',
      direction: normalizeDirection(structure?.bias || candleDir),
      confidence: toFiniteNumber(structure?.confidence),
      score: null,
      summaryEn: structure
        ? `Structure=${structure.state || '—'} · bias=${structure.bias || '—'} · conf=${structure.confidence ?? '—'}% · phase=${phaseLabel.en}`
        : 'Structure unavailable (needs candle series).',
      summaryAr: structure
        ? `الهيكل=${structure.state || '—'} · الاتجاه=${structure.bias || '—'} · الثقة=${structure.confidence ?? '—'}% · المرحلة=${phaseLabel.ar}`
        : 'الهيكل غير متوفر (يحتاج سلسلة شموع).',
      metrics: {
        timeframeFocus: pickTf,
        marketPhase: phaseLabel.phase,
        htf: {
          D1: d1Dir,
          H4: h4Dir,
          conflictWithSignal: Boolean(htfConflict),
        },
        marketMemory,
        structure,
      },
      evidence: structure
        ? [
            `State: ${structure.state}`,
            `Bias: ${structure.bias}`,
            `Phase: ${phaseLabel.en}`,
            d1Dir ? `D1: ${d1Dir}` : null,
            h4Dir ? `H4: ${h4Dir}` : null,
          ].filter(Boolean)
        : [],
      warnings: [
        ...(structure ? [] : ['No BOS/HH-HL proxy (insufficient candles).']),
        ...(htfConflict ? ['HTF conflict: avoid entries against D1/H4.'] : []),
      ],
      availability: structure ? 'available' : 'partial',
    })
  );

  // 4) Trend & momentum
  const momentumDir = normalizeDirection(
    trendPct != null && Math.abs(trendPct) > 0.03 ? (trendPct > 0 ? 'BUY' : 'SELL') : candleDir
  );

  const rsiExtreme =
    (finalDirection === 'BUY' && rsi != null && rsi >= 78) ||
    (finalDirection === 'SELL' && rsi != null && rsi <= 22);
  const timeIntelLayer = confluenceById.get('smart_time_intelligence') || null;
  const spreadLayer = confluenceById.get('spread_ok') || null;
  const momentumRsiLayer = confluenceById.get('momentum_rsi') || null;
  const isLateSession =
    timeIntelLayer?.status === 'FAIL' &&
    /close|late|last minutes/i.test(String(timeIntelLayer?.reason || ''))
      ? true
      : false;

  const momentumQualityScore = clamp(
    Math.round(
      (regime?.confidence != null ? clamp(Number(regime.confidence), 0, 100) * 0.45 : 35) +
        (trendPct != null ? Math.min(35, Math.abs(trendPct) * 250) : 10) +
        (rsi != null ? (rsiExtreme ? -20 : 10) : 0)
    ),
    0,
    100
  );

  const falseStrengthFlags = [
    spreadLayer?.status === 'FAIL' ? 'execution_spread' : null,
    liquidityHint && String(liquidityHint).toLowerCase().includes('thin') ? 'thin_liquidity' : null,
    smcVolumeSpike && smcVolumeSpike.isSpike === false ? 'low_volume' : null,
    isLateSession ? 'late_session' : null,
  ].filter(Boolean);

  const fomoRisk = Boolean(rsiExtreme || isLateSession);

  layers.push(
    buildLayer({
      number: 4,
      nameEn: 'Trend & Momentum',
      nameAr: 'الاتجاه والزخم',
      direction: momentumDir,
      confidence: toFiniteNumber(regime?.confidence ?? candlesSummary?.confidence),
      score: null,
      summaryEn:
        trendPct != null
          ? `Trend=${trendPct.toFixed(3)}% · RSI=${rsi ?? '—'} · Regime=${regime?.state || '—'} · momentumQ=${momentumQualityScore}/100${fomoRisk ? ' · FOMO-risk' : ''}`
          : 'Trend unavailable.',
      summaryAr:
        trendPct != null
          ? `الاتجاه=${trendPct.toFixed(3)}% · RSI=${rsi ?? '—'} · النظام=${regime?.state || '—'} · جودة الزخم=${momentumQualityScore}/100${fomoRisk ? ' · خطر FOMO' : ''}`
          : 'الاتجاه غير متوفر.',
      metrics: {
        timeframeFocus: pickTf,
        trendPct,
        rsi,
        regime,
      },
      evidence: [
        trendPct != null ? `TrendPct: ${trendPct.toFixed(4)}%` : null,
        rsi != null ? `RSI: ${rsi.toFixed(1)}` : null,
        regime?.state ? `Regime: ${regime.state}` : null,
        `MomentumQuality: ${momentumQualityScore}/100`,
        fomoRisk ? 'FOMO risk detected' : null,
        falseStrengthFlags.length ? `FalseStrengthFlags: ${falseStrengthFlags.join(',')}` : null,
      ].filter(Boolean),
      warnings: [
        ...(trendPct == null ? ['Missing trend features (no candles).'] : []),
        ...(rsiExtreme ? ['RSI extreme: auto-confidence should be reduced.'] : []),
        ...(falseStrengthFlags.length
          ? ['Possible false strength (thin liquidity/low volume/late expansion).']
          : []),
      ],
      availability: trendPct != null ? 'available' : 'partial',
    })
  );

  // 5) Liquidity logic (SMC-style, best-effort)
  const hasPinbar = patterns.some((p) => String(p?.name || '').includes('PINBAR'));
  const hasEngulf = patterns.some((p) => String(p?.name || '').includes('ENGULF'));

  const liquidityAvailability =
    smcSweep || smcOrderBlock ? 'available' : patterns.length ? 'partial' : 'missing';
  const liquidityDir =
    smcSweep?.bias || smcOrderBlock?.direction || normalizeDirection(structure?.bias || candleDir);
  const liquidityConfidence = pct(
    (smcSweep?.confidence ?? 0) * 0.65 +
      (smcOrderBlock?.confidence ?? 0) * 0.35 +
      (hasPinbar ? 10 : 0) +
      (hasEngulf ? 8 : 0)
  );

  const liquiditySummaryEn = (() => {
    const parts = [];
    if (smcSweep) {
      parts.push(
        `Sweep=${smcSweep.type} @${smcSweep.level} → ${smcSweep.bias} (conf=${smcSweep.confidence ?? '—'}%)`
      );
    }
    if (smcOrderBlock) {
      parts.push(
        `OB=${smcOrderBlock.direction} zone=[${smcOrderBlock.zoneLow},${smcOrderBlock.zoneHigh}] near=${smcOrderBlock.near ?? '—'} (conf=${smcOrderBlock.confidence ?? '—'}%)`
      );
    }
    if (smcPriceImbalance && smcPriceImbalance.state && smcPriceImbalance.state !== 'none') {
      const nearest = safeObj(smcPriceImbalance.nearest) || null;
      if (nearest) {
        parts.push(
          `FVG=${smcPriceImbalance.state} zone=[${nearest.zoneLow},${nearest.zoneHigh}] fill=${nearest.fillPct ?? '—'}% age=${nearest.ageBars ?? '—'} (conf=${smcPriceImbalance.confidence ?? '—'}%)`
        );
      } else {
        parts.push(`FVG=${smcPriceImbalance.state} (conf=${smcPriceImbalance.confidence ?? '—'}%)`);
      }
    }
    if (!parts.length && (hasPinbar || hasEngulf)) {
      parts.push(
        `Pattern proxy: ${[hasPinbar ? 'pinbar' : null, hasEngulf ? 'engulfing' : null]
          .filter(Boolean)
          .join(', ')}`
      );
    }
    return parts.length
      ? parts.join(' · ')
      : 'No liquidity sweep/order-block detected (best-effort).';
  })();

  const liquiditySummaryAr = (() => {
    const parts = [];
    if (smcSweep) {
      parts.push(
        `Sweep=${smcSweep.type} عند ${smcSweep.level} → ${smcSweep.bias} (ثقة=${smcSweep.confidence ?? '—'}%)`
      );
    }
    if (smcOrderBlock) {
      parts.push(
        `منطقة OB=${smcOrderBlock.direction} [${smcOrderBlock.zoneLow},${smcOrderBlock.zoneHigh}] قريب=${smcOrderBlock.near ?? '—'} (ثقة=${smcOrderBlock.confidence ?? '—'}%)`
      );
    }
    if (smcPriceImbalance && smcPriceImbalance.state && smcPriceImbalance.state !== 'none') {
      const nearest = safeObj(smcPriceImbalance.nearest) || null;
      if (nearest) {
        parts.push(
          `FVG=${smcPriceImbalance.state} [${nearest.zoneLow},${nearest.zoneHigh}] امتلاء=${nearest.fillPct ?? '—'}% عمر=${nearest.ageBars ?? '—'} (ثقة=${smcPriceImbalance.confidence ?? '—'}%)`
        );
      } else {
        parts.push(`FVG=${smcPriceImbalance.state} (ثقة=${smcPriceImbalance.confidence ?? '—'}%)`);
      }
    }
    if (!parts.length && (hasPinbar || hasEngulf)) {
      parts.push(
        `تقريب بالنماذج: ${[hasPinbar ? 'pinbar' : null, hasEngulf ? 'engulfing' : null]
          .filter(Boolean)
          .join('، ')}`
      );
    }
    return parts.length ? parts.join(' · ') : 'لا توجد إشارة Sweep/Order-Block (حسب المتاح).';
  })();

  const liquidityQuality = inferLiquidityQuality({
    liquidityHint,
    spreadPoints,
    quoteVolume,
    smcVolumeSpike,
  });

  layers.push(
    buildLayer({
      number: 5,
      nameEn: 'Liquidity Logic (Sweeps / Order Blocks)',
      nameAr: 'سيولة السوق (Sweeps / Order Blocks)',
      direction: liquidityDir,
      confidence: liquidityConfidence,
      score: null,
      summaryEn: `${liquiditySummaryEn} · quality=${liquidityQuality.quality} (${liquidityQuality.score}/100)`,
      summaryAr: `${liquiditySummaryAr} · الجودة=${liquidityQuality.quality} (${liquidityQuality.score}/100)`,
      metrics: {
        timeframeFocus: pickTf,
        liquidityQuality,
        sweep: smcSweep,
        orderBlock: smcOrderBlock,
        priceImbalance: smcPriceImbalance,
        patterns: patterns.map((p) => p?.name).filter(Boolean),
        structure,
      },
      evidence: [
        smcSweep ? `sweep:${smcSweep.type}` : null,
        smcOrderBlock ? `ob:${smcOrderBlock.direction}` : null,
        smcPriceImbalance && smcPriceImbalance.state ? `fvg:${smcPriceImbalance.state}` : null,
        liquidityHint ? `liquidityHint:${String(liquidityHint)}` : null,
        spreadPoints != null ? `spreadPts:${spreadPoints}` : null,
        quoteVolume != null ? `tickVol:${quoteVolume}` : null,
        ...patterns.map((p) => p?.name).filter(Boolean),
      ].filter(Boolean),
      warnings:
        liquidityAvailability === 'missing'
          ? ['SMC liquidity needs enough candle history from EA.']
          : [
              'Liquidity/SMC is best-effort without full order-book.',
              ...(liquidityQuality.quality === 'thin_or_fake'
                ? ['Thin/fake liquidity risk: require stronger confirmations.']
                : []),
            ],
      availability: liquidityAvailability,
    })
  );

  // 6) Volume & order flow (best-effort)
  const volume = safeObj(pickAnalysis?.volume || candlesSummary?.volume) || null;
  const volumeAvail =
    volume && (toFiniteNumber(volume.newest) != null || toFiniteNumber(volume.average) != null);

  const volumeDir = (() => {
    if (smcVolumeImbalance?.state === 'buying') {
      return 'BUY';
    }
    if (smcVolumeImbalance?.state === 'selling') {
      return 'SELL';
    }
    return candleDir;
  })();

  const volumeConfidence = pct(
    (smcVolumeSpike?.isSpike ? 55 : 0) +
      (smcVolumeImbalance?.pressurePct != null
        ? Math.min(35, Math.abs(smcVolumeImbalance.pressurePct))
        : 0) +
      (volumeAvail ? 10 : 0)
  );

  const volumeAvailability =
    smcVolumeSpike || smcVolumeImbalance || volumeAvail
      ? volumeAvail
        ? 'partial'
        : 'partial'
      : 'missing';

  layers.push(
    buildLayer({
      number: 6,
      nameEn: 'Volume & Order Flow (Spike/Imbalance)',
      nameAr: 'الحجم وتدفق الأوامر (Spike/Imbalance)',
      direction: volumeDir,
      confidence: volumeConfidence,
      score: null,
      summaryEn: (() => {
        const parts = [];
        if (smcVolumeSpike) {
          parts.push(
            `VolSpike=${smcVolumeSpike.isSpike ? 'YES' : 'no'} (ratio=${smcVolumeSpike.ratio ?? '—'} z=${smcVolumeSpike.zScore ?? '—'})`
          );
        }
        if (smcVolumeImbalance) {
          parts.push(
            `VolImb=${smcVolumeImbalance.state} (${smcVolumeImbalance.pressurePct ?? '—'}%)`
          );
        }
        if (smcAccDist) {
          parts.push(`A/D=${smcAccDist.state} (conf=${smcAccDist.confidence ?? '—'}%)`);
        }
        if (volumeAvail) {
          parts.push(`TickVol newest=${volume.newest ?? '—'} avg=${volume.average ?? '—'}`);
        }
        return parts.length
          ? parts.join(' · ')
          : 'Volume/order-flow unavailable from broker (or not provided).';
      })(),
      summaryAr: (() => {
        const parts = [];
        if (smcVolumeSpike) {
          parts.push(
            `VolSpike=${smcVolumeSpike.isSpike ? 'نعم' : 'لا'} (نسبة=${smcVolumeSpike.ratio ?? '—'} z=${smcVolumeSpike.zScore ?? '—'})`
          );
        }
        if (smcVolumeImbalance) {
          parts.push(
            `VolImb=${smcVolumeImbalance.state} (${smcVolumeImbalance.pressurePct ?? '—'}%)`
          );
        }
        if (smcAccDist) {
          parts.push(`A/D=${smcAccDist.state} (ثقة=${smcAccDist.confidence ?? '—'}%)`);
        }
        if (volumeAvail) {
          parts.push(`TickVol آخر=${volume.newest ?? '—'} متوسط=${volume.average ?? '—'}`);
        }
        return parts.length ? parts.join(' · ') : 'الحجم/تدفق الأوامر غير متوفر (أو غير مرسل).';
      })(),
      metrics: {
        timeframeFocus: pickTf,
        volume,
        volumeSpike: smcVolumeSpike,
        volumeImbalance: smcVolumeImbalance,
        accumulationDistribution: smcAccDist,
      },
      evidence: [
        smcVolumeSpike ? `volSpike:${smcVolumeSpike.isSpike ? '1' : '0'}` : null,
        smcVolumeImbalance ? `volImb:${smcVolumeImbalance.state}` : null,
        smcAccDist ? `accDist:${smcAccDist.state}` : null,
      ].filter(Boolean),
      warnings: ['True order-flow requires L2/order-book; this is best-effort from candle volume.'],
      availability: volumeAvailability,
    })
  );

  // 7) Volatility regime
  layers.push(
    buildLayer({
      number: 7,
      nameEn: 'Volatility Regime',
      nameAr: 'نظام التذبذب (Volatility)',
      direction: candleDir,
      confidence: toFiniteNumber(regime?.confidence ?? candlesSummary?.confidence),
      score: null,
      summaryEn: volatility
        ? `ATR%=${atrPct ?? '—'} · state=${volatility.state || '—'}`
        : 'Volatility unavailable.',
      summaryAr: volatility
        ? `ATR%=${atrPct ?? '—'} · الحالة=${volatility.state || '—'}`
        : 'التذبذب غير متوفر.',
      metrics: {
        timeframeFocus: pickTf,
        volatility,
      },
      evidence: volatility ? [`ATR%: ${atrPct ?? '—'}`, `State: ${volatility.state || '—'}`] : [],
      warnings: [],
      availability: volatility ? 'available' : 'partial',
    })
  );

  // 8) Time intelligence
  const timeAuthority = (() => {
    const smart = confluenceById.get('smart_time_intelligence') || null;
    const hard = confluenceById.get('trading_window_hard') || null;
    const sess = confluenceById.get('session_window') || null;
    return {
      smart: smart
        ? {
            status: smart.status || null,
            score: toFiniteNumber(smart?.metrics?.score),
            reason: smart.reason || null,
          }
        : null,
      session: sess ? { status: sess.status || null, reason: sess.reason || null } : null,
      hard: hard ? { status: hard.status || null, reason: hard.reason || null } : null,
    };
  })();

  layers.push(
    buildLayer({
      number: 8,
      nameEn: 'Time Intelligence (Sessions/Cycles)',
      nameAr: 'ذكاء الوقت (جلسات/دورات)',
      direction: finalDirection,
      confidence: 40,
      score: null,
      summaryEn: `UTC hour=${utcHour} · session=${session.labelEn} · day=${utcDow} · authority=${timeAuthority.smart?.status || timeAuthority.session?.status || '—'}`,
      summaryAr: `الوقت UTC=${utcHour} · الجلسة=${session.labelAr} · اليوم=${utcDow} · الصلاحية=${timeAuthority.smart?.status || timeAuthority.session?.status || '—'}`,
      metrics: {
        utcHour,
        utcDayOfWeek: utcDow,
        session: session.session,
        timeWindowAuthority: timeAuthority,
      },
      evidence: ['Session is heuristic (UTC-based).'],
      warnings: [
        'Time intelligence improves with broker timezone + session stats.',
        ...(timeAuthority.smart?.status === 'FAIL' || timeAuthority.session?.status === 'FAIL'
          ? ['Time-window authority failed: wait for opening drive or valid re-entry.']
          : []),
      ],
      availability: 'best_effort',
    })
  );

  // 9) Relative strength
  const relSent = toFiniteNumber(econ?.relativeSentiment);
  const macroDiff = toFiniteNumber(macroRelative?.differential);
  const relBias = normalizeDirection(
    econ?.direction ||
      (macroDiff != null
        ? macroDiff > 5
          ? 'BUY'
          : macroDiff < -5
            ? 'SELL'
            : 'NEUTRAL'
        : 'NEUTRAL')
  );
  layers.push(
    buildLayer({
      number: 9,
      nameEn: 'Relative Strength (Base vs Quote)',
      nameAr: 'القوة النسبية (العملة الأساسية مقابل المقابلة)',
      direction: relBias,
      confidence: clamp(
        (pct(macroRelative?.confidence) ?? 0) * 0.55 + (pct(econ?.confidence) ?? 0) * 0.45,
        0,
        100
      ),
      score: macroDiff,
      summaryEn: `Econ dir=${econ?.direction || '—'} · macroΔ=${macroDiff ?? '—'} · relSent=${relSent ?? '—'}`,
      summaryAr: `اقتصاد=${econ?.direction || '—'} · فرق الماكرو=${macroDiff ?? '—'} · شعور نسبي=${relSent ?? '—'}`,
      metrics: {
        economic: econ,
        macroRelative: macroRelative || null,
      },
      evidence: [
        macroDiff != null ? `Macro differential: ${macroDiff}` : null,
        relSent != null ? `Relative sentiment: ${relSent}` : null,
      ].filter(Boolean),
      warnings:
        macroDiff == null && relSent == null ? ['No relative-strength drivers available.'] : [],
      availability: macroDiff != null || relSent != null ? 'partial' : 'missing',
    })
  );

  // 10) Intermarket
  if (intermarketCorrelation?.available) {
    const top = safeArray(intermarketCorrelation.top).filter(Boolean).slice(0, 6);
    const breaks = safeArray(intermarketCorrelation.breaks).filter(Boolean);
    const tf = intermarketCorrelation.timeframe || '—';
    const windowN = toFiniteNumber(intermarketCorrelation.window);
    const stability = safeObj(intermarketCorrelation.stability) || null;
    const stabilityScore = toFiniteNumber(stability?.stabilityScore);
    const breaksCore = toFiniteNumber(stability?.breaksCore);
    const conflictsCore = toFiniteNumber(stability?.conflictsCore);

    const topSummary = top
      .map((item) => {
        const peer = item?.peer || item?.symbol || null;
        const corr = toFiniteNumber(item?.corr);
        const broken = item?.break === true;
        if (!peer || corr == null) {
          return null;
        }
        return `${peer}=${corr}${broken ? ' (BREAK)' : ''}`;
      })
      .filter(Boolean)
      .join(' · ');

    const warningList = [];
    if (breaks.length) {
      warningList.push(`Correlation break detected (${breaks.length} relationship(s)).`);
    }
    if (Array.isArray(intermarketCorrelation.warnings)) {
      warningList.push(...intermarketCorrelation.warnings.filter(Boolean).slice(0, 3));
    }

    layers.push(
      buildLayer({
        number: 10,
        nameEn: 'Intermarket Correlation (Live)',
        nameAr: 'ترابط الأسواق (Intermarket)',
        direction: 'NEUTRAL',
        confidence: toFiniteNumber(intermarketCorrelation.confidence) ?? 0,
        score: breaks.length ? -breaks.length : null,
        summaryEn:
          topSummary ||
          `Live correlation computed from EA bars (${tf}${windowN != null ? `, window=${windowN}` : ''})${
            stabilityScore != null ? ` · stability=${stabilityScore}/100` : ''
          }${
            breaksCore != null || conflictsCore != null
              ? ` · core breaks=${breaksCore ?? 0} · core conflicts=${conflictsCore ?? 0}`
              : ''
          }.`,
        summaryAr: null,
        metrics: {
          available: true,
          source: intermarketCorrelation.source || 'ea-bars',
          target: intermarketCorrelation.target || pair,
          timeframe: tf,
          window: windowN,
          breaksCount: breaks.length,
          peers: safeArray(intermarketCorrelation.peers),
          stability,
        },
        evidence: [
          intermarketCorrelation.source ? `Source: ${intermarketCorrelation.source}` : null,
          tf ? `Timeframe: ${tf}` : null,
          windowN != null ? `Window: ${windowN}` : null,
        ].filter(Boolean),
        warnings: warningList,
        availability: 'available',
      })
    );
  } else {
    layers.push(
      buildLayer({
        number: 10,
        nameEn: 'Intermarket Correlation (Live)',
        nameAr: 'ترابط الأسواق (Intermarket)',
        direction: 'NEUTRAL',
        confidence: 0,
        score: null,
        summaryEn:
          intermarketCorrelation?.warnings?.[0] ||
          'Intermarket correlation is unavailable (requires EA bars for multiple symbols).',
        summaryAr: null,
        metrics: { available: false },
        evidence: [],
        warnings: ['Make sure MT4/MT5 is connected and EA is publishing bars for peer symbols.'],
        availability: 'missing',
      })
    );
  }

  // 11) Macroeconomics
  layers.push(
    buildLayer({
      number: 11,
      nameEn: 'Macroeconomics',
      nameAr: 'الاقتصاد الكلي (Macro)',
      direction: normalizeDirection(macroRelative?.direction),
      confidence: toFiniteNumber(macroRelative?.confidence),
      score: macroDiff,
      summaryEn: macroRelative?.note || 'Macro fundamentals unavailable.',
      summaryAr: macroRelative?.direction
        ? `اتجاه الماكرو: ${macroRelative.direction} · فرق=${macroDiff ?? '—'}`
        : 'بيانات الماكرو غير متوفرة.',
      metrics: {
        fundamentals: fundamentals || null,
        macroRelative: macroRelative || null,
      },
      evidence: [macroDiff != null ? `Δ macro: ${macroDiff}` : null].filter(Boolean),
      warnings: macroDiff == null ? ['Macro layer depends on fundamentals coverage.'] : [],
      availability: macroDiff != null ? 'partial' : 'missing',
    })
  );

  // 12) News impact
  const newsDir = normalizeDirection(news?.direction);
  layers.push(
    buildLayer({
      number: 12,
      nameEn: 'News Impact',
      nameAr: 'تأثير الأخبار',
      direction: newsDir,
      confidence: toFiniteNumber(news?.confidence),
      score: toFiniteNumber(news?.impact ?? newsImpactScore),
      summaryEn: `News dir=${news?.direction || '—'} · impact=${news?.impact ?? newsImpactScore ?? '—'} · upcoming=${newsUpcoming ?? '—'}`,
      summaryAr: `الأخبار=${news?.direction || '—'} · التأثير=${news?.impact ?? newsImpactScore ?? '—'} · أحداث قادمة=${newsUpcoming ?? '—'}`,
      metrics: {
        news,
        realtime: market?.news || null,
      },
      evidence: [
        newsImpactScore != null ? `EA-news impactScore: ${newsImpactScore}` : null,
        newsUpcoming != null ? `Upcoming events: ${newsUpcoming}` : null,
      ].filter(Boolean),
      warnings:
        newsImpactScore != null && newsImpactScore >= 4
          ? ['High event risk. Consider no-trade.']
          : [],
      availability: news?.direction || newsImpactScore != null ? 'partial' : 'missing',
    })
  );

  // 13) Market psychology
  const doji = patterns.some((p) => String(p?.name || '').includes('DOJI'));
  const psychDir = doji ? 'NEUTRAL' : candleDir;
  layers.push(
    buildLayer({
      number: 13,
      nameEn: 'Market Psychology',
      nameAr: 'سيكولوجية السوق',
      direction: psychDir,
      confidence: doji ? 55 : 35,
      score: null,
      summaryEn: doji
        ? 'Indecision detected (doji).'
        : atrPct != null && atrPct >= 0.75
          ? 'High volatility suggests fear/urgency.'
          : 'No strong psychology marker detected.',
      summaryAr: doji
        ? 'تردد/حيرة (Doji).'
        : atrPct != null && atrPct >= 0.75
          ? 'تذبذب عالي يشير إلى خوف/استعجال.'
          : 'لا توجد علامة نفسية قوية.',
      metrics: { doji, atrPct, patterns: patterns.map((p) => p?.name).filter(Boolean) },
      evidence: patterns.map((p) => p?.name).filter(Boolean),
      warnings: [],
      availability: patterns.length ? 'partial' : 'best_effort',
    })
  );

  // 14) Risk environment
  const riskScore = clamp(
    100 -
      (spreadPoints != null ? clamp((spreadPoints - 10) * 2.5, 0, 35) : 0) -
      (newsImpactScore != null ? clamp(newsImpactScore * 8, 0, 35) : 0) -
      (atrPct != null ? clamp((atrPct - 0.2) * 45, 0, 35) : 0),
    0,
    100
  );

  const executionQualityScore = clamp(
    Math.round(
      100 -
        (spreadPoints != null ? clamp((spreadPoints - 10) * 2.8, 0, 45) : 0) -
        (quoteAgeMs != null ? clamp((quoteAgeMs - 3_000) / 1_000, 0, 25) : 0) -
        (quotePending ? 15 : 0)
    ),
    0,
    100
  );

  const failureCost = estimateFailureCost({
    pair,
    entry: safeObj(primary?.entry) || safeObj(sig?.entry) || null,
    quoteMidVelocityPerSec,
  });

  layers.push(
    buildLayer({
      number: 14,
      nameEn: 'Risk Environment (Risk-on/off + Execution)',
      nameAr: 'بيئة المخاطر (Risk-on/off + تنفيذ)',
      direction: finalDirection,
      confidence: 60,
      score: Number(riskScore.toFixed(0)),
      summaryEn: `Risk score=${Math.round(riskScore)}/100 · execQ=${executionQualityScore}/100`,
      summaryAr: `درجة المخاطر=${Math.round(riskScore)}/100 · جودة التنفيذ=${executionQualityScore}/100`,
      metrics: {
        riskScore,
        executionQualityScore,
        spreadPoints,
        newsImpactScore,
        atrPct,
        failureCostEstimator: failureCost,
      },
      evidence: [
        spreadPoints != null ? `Spread penalty source: ${spreadPoints} pts` : null,
        newsImpactScore != null ? `News penalty source: ${newsImpactScore}` : null,
        atrPct != null ? `Vol penalty source: ATR%=${atrPct}` : null,
        failureCost.available
          ? `FailureCost: invalidation≈${failureCost.invalidationDistancePips} pips${
              failureCost.timeToInvalidationSec != null
                ? ` (~${failureCost.timeToInvalidationSec}s @ current velocity)`
                : ''
            }`
          : 'FailureCost: unavailable',
      ].filter(Boolean),
      warnings:
        riskScore < 55 ? ['Risk environment is unfavorable; tighten rules or no-trade.'] : [],
      availability: 'best_effort',
    })
  );

  // 15) Statistical logic
  const r2 = toFiniteNumber(regime?.r2);
  const stdevReturns = toFiniteNumber(volatility?.stdevReturns);
  layers.push(
    buildLayer({
      number: 15,
      nameEn: 'Statistical Logic',
      nameAr: 'المنطق الإحصائي',
      direction: candleDir,
      confidence: r2 != null ? clamp(r2, 0, 100) : 20,
      score: r2,
      summaryEn:
        r2 != null
          ? `Trend-fit R²=${r2}% · stdev=${stdevReturns ?? '—'}`
          : 'Statistical diagnostics unavailable.',
      summaryAr:
        r2 != null
          ? `جودة الاتجاه R²=${r2}% · الانحراف=${stdevReturns ?? '—'}`
          : 'مؤشرات إحصائية غير متوفرة.',
      metrics: { timeframeFocus: pickTf, r2, stdevReturns, regime, volatility },
      evidence: r2 != null ? [`R²=${r2}%`] : [],
      warnings:
        r2 != null && r2 < 55 ? ['Low trend-fit; prefer range tactics or reduce size.'] : [],
      availability: r2 != null ? 'available' : 'partial',
    })
  );

  // 16) Signal validation
  const failedChecks = Object.entries(checks).filter(([, ok]) => ok === false);
  layers.push(
    buildLayer({
      number: 16,
      nameEn: 'Signal Validation (Final Guard)',
      nameAr: 'تحقق الإشارة (الحارس الأخير)',
      direction: isTradeValid ? finalDirection : 'NEUTRAL',
      confidence: isTradeValid ? 85 : 95,
      score: null,
      summaryEn: isTradeValid
        ? 'Signal passed validity checks.'
        : `Signal blocked: ${scn?.decision?.reason || sig?.isValid?.reason || 'invalid'}`,
      summaryAr: isTradeValid
        ? 'الإشارة اجتازت التحقق.'
        : `تم رفض الإشارة: ${scn?.decision?.reason || sig?.isValid?.reason || 'غير صالح'}`,
      metrics: {
        verdict: isTradeValid ? 'PASS' : 'FAIL',
        isTradeValid,
        failedChecks: failedChecks.map(([key]) => key),
      },
      evidence: failedChecks.map(([key]) => `FAILED:${key}`),
      warnings: !isTradeValid ? ['Do not trade until constraints are satisfied.'] : [],
      availability: 'available',
    })
  );

  // 17) Context awareness (alignment)
  const votes = [
    normalizeDirection(technical?.direction),
    normalizeDirection(candlesSummary?.direction),
    normalizeDirection(econ?.direction),
    normalizeDirection(news?.direction),
    normalizeDirection(macroRelative?.direction),
  ].filter(Boolean);

  const buyVotes = votes.filter((v) => v === 'BUY').length;
  const sellVotes = votes.filter((v) => v === 'SELL').length;
  const neutralVotes = votes.filter((v) => v === 'NEUTRAL').length;
  const alignedDir = buyVotes > sellVotes ? 'BUY' : sellVotes > buyVotes ? 'SELL' : 'NEUTRAL';
  const alignmentScore = clamp(
    Math.round(
      ((Math.max(buyVotes, sellVotes) + neutralVotes * 0.25) / Math.max(1, votes.length)) * 100
    ),
    0,
    100
  );

  layers.push(
    buildLayer({
      number: 17,
      nameEn: 'Context Awareness (Confluence)',
      nameAr: 'وعي السياق (توافق/Confluence)',
      direction: alignedDir,
      confidence: alignmentScore,
      score: alignmentScore,
      summaryEn: `Alignment=${alignmentScore}% · votes: BUY=${buyVotes} SELL=${sellVotes} NEUTRAL=${neutralVotes} · confluenceW=${toFiniteNumber(confluence?.score) ?? '—'}/${toFiniteNumber(confluence?.minScore) ?? '—'}`,
      summaryAr: `التوافق=${alignmentScore}% · الأصوات: شراء=${buyVotes} بيع=${sellVotes} حياد=${neutralVotes} · وزن التوافق=${toFiniteNumber(confluence?.score) ?? '—'}/${toFiniteNumber(confluence?.minScore) ?? '—'}`,
      metrics: {
        alignmentScore,
        votes: {
          technical: normalizeDirection(technical?.direction),
          candles: normalizeDirection(candlesSummary?.direction),
          economic: normalizeDirection(econ?.direction),
          news: normalizeDirection(news?.direction),
          macro: normalizeDirection(macroRelative?.direction),
        },
        htfPriority: {
          D1: d1Dir,
          H4: h4Dir,
          blockedIfOpposed: true,
          conflictWithSignal: Boolean(htfConflict),
        },
        premiumDiscount: (() => {
          const loc = confluenceById.get('smart_price_location') || null;
          return loc
            ? {
                status: loc.status || null,
                reason: loc.reason || null,
                metrics: safeObj(loc.metrics),
              }
            : null;
        })(),
        confluenceWeighting: confluence
          ? {
              strictSmartChecklist: Boolean(confluence.strictSmartChecklist),
              weightedScore: toFiniteNumber(confluence.score),
              minScore: toFiniteNumber(confluence.minScore),
              passed: Boolean(confluence.passed),
              hardFails: safeArray(confluence.hardFails),
              topWeightedFails: confluenceLayers
                .filter((l) => l?.status === 'FAIL')
                .slice()
                .sort((a, b) => (Number(b?.weight) || 0) - (Number(a?.weight) || 0))
                .slice(0, 6)
                .map((l) => ({ id: l.id, weight: l.weight, reason: l.reason, label: l.label })),
            }
          : null,
      },
      evidence: [
        ...votes.map((v) => `vote:${v}`),
        d1Dir ? `D1:${d1Dir}` : null,
        h4Dir ? `H4:${h4Dir}` : null,
        confluence?.score != null ? `ConfluenceWeighted:${confluence.score}/100` : null,
        confluence?.strictSmartChecklist ? 'StrictSmartChecklist:ON' : null,
      ].filter(Boolean),
      warnings: [
        ...(alignmentScore < 55 ? ['Low confluence; reduce risk or wait.'] : []),
        ...(htfConflict ? ['HTF priority rule: do NOT enter against D1/H4.'] : []),
      ],
      availability: votes.length ? 'available' : 'partial',
    })
  );

  // 18) Decision engine
  const entry = safeObj(primary?.entry) || safeObj(sig?.entry) || {};
  const rr = toFiniteNumber(entry?.riskReward ?? sig?.riskReward);

  const adaptiveConfidence = (() => {
    const base = toFiniteNumber(finalConfidence);
    if (base == null) {
      return null;
    }
    let penalty = 0;
    if (rsiExtreme) {
      penalty += 18;
    }
    if (spreadLayer?.status === 'FAIL') {
      penalty += 15;
    }
    if (momentumRsiLayer?.status === 'FAIL') {
      penalty += 12;
    }
    if (timeIntelLayer?.status === 'FAIL') {
      penalty += 10;
    }
    if (confluence?.strictSmartChecklist && confluence?.hardFails?.length) {
      penalty += Math.min(25, confluence.hardFails.length * 4);
    }
    return clamp(Math.round(base - penalty), 0, 100);
  })();

  const keyGates = (() => {
    const keys = [
      'smart_d1_rsi_lock',
      'smart_d1_macd_lock',
      'smart_htf_rsi_buy_overbought',
      'smart_market_phase_authority',
      'smart_htf_narrative',
      'smart_phase_timing',
      'smart_session_authority',
      'smart_monthly_price_location',
      'smart_price_location',
      'smart_next_liquidity_pool',
      'smart_htf_memory_layer',
      'smart_divergence_guard',
      'smart_breakout_confirmation',
      'smc_liquidity_sweep',
      'smart_liquidity_event_required',
      'smart_smc_entry_zone',
      'smart_confirmed_discount_zone',
      'smart_volume_confirm',
      'smart_failure_cost_check',
      'smart_decisive_candle',
      'smart_time_intelligence',
      'smart_entry_trigger',
      'smart_atr_rr_2to1',
      'smart_structure_clean',
      'smart_volatility_state',
      'smart_liquidity_execution_risk',
      'smart_execution_slippage_risk',
      'smart_distribution_filter',
      'smart_false_continuation_detector',
      'smart_execution_edge_filter',
      'smart_signal_validation',
      'smart_context_awareness',
      'smart_killer_question',
    ];
    const out = [];
    for (const id of keys) {
      const l = confluenceById.get(id);
      if (!l) {
        continue;
      }
      out.push({
        id,
        status: l.status || null,
        reason: l.reason || null,
        weight: l.weight || null,
      });
    }
    return out;
  })();

  const sizingHint = clamp(
    Math.round(((finalConfidence ?? 0) * 0.6 + alignmentScore * 0.4) / 10),
    0,
    10
  );

  const missingInputs = (() => {
    const missing = [];
    const details = {};

    const news = sig?.components?.news || null;
    const evidence = safeObj(news?.evidence) || safeObj(news?.details?.evidence) || null;
    const calendar =
      safeArray(news?.calendarEvents).length > 0
        ? safeArray(news?.calendarEvents)
        : safeArray(news?.details?.calendarEvents);

    const headlinesRaw =
      evidence && typeof evidence === 'object'
        ? [
            ...safeArray(evidence.base),
            ...safeArray(evidence.quote),
            ...safeArray(evidence.external),
          ]
        : [];
    const headlinesCount = headlinesRaw.filter(
      (item) => item && (item.headline || item.title)
    ).length;

    if (!calendar.length) {
      missing.push('news:calendarEvents');
      details.newsCalendarEvents = {
        available: false,
        reason: 'No EA calendar events received yet.',
      };
    } else {
      details.newsCalendarEvents = { available: true, count: calendar.length };
    }

    if (!headlinesCount) {
      missing.push('news:headlines');
      details.newsHeadlines = {
        available: false,
        reason: 'No headlines evidence received yet.',
      };
    } else {
      details.newsHeadlines = { available: true, count: headlinesCount };
    }

    const correlation =
      sig?.components?.intermarket?.correlation ||
      sig?.components?.correlation ||
      sig?.correlation ||
      null;
    if (!correlation) {
      missing.push('intermarket:correlation');
      details.correlation = {
        available: false,
        reason: 'Correlation snapshot not provided in EA-only payload.',
      };
    } else {
      details.correlation = { available: true };
    }

    const frames = safeObj(sig?.components?.technical?.timeframes) || {};
    const frameList = Object.values(frames).filter((f) => f && typeof f === 'object');
    const hasAnyIndicators = frameList.some((f) => {
      const ind = safeObj(f.indicators) || {};
      return Boolean(ind.rsi || ind.macd || ind.atr);
    });
    if (!hasAnyIndicators) {
      missing.push('technical:indicators');
      details.technicalIndicators = {
        available: false,
        reason: 'Waiting for MT snapshot (RSI/MACD/ATR/levels).',
      };
    } else {
      details.technicalIndicators = { available: true };
    }

    const eaQuote = sig?.components?.marketData?.eaQuote || null;
    if (!eaQuote) {
      missing.push('market:eaQuote');
      details.eaQuote = {
        available: false,
        reason: 'EA quote missing (bid/ask/spread/volume).',
      };
    } else {
      details.eaQuote = {
        available: true,
        liquidityHint: eaQuote.liquidityHint ?? null,
        spreadPoints: Number.isFinite(Number(eaQuote.spreadPoints))
          ? Number(eaQuote.spreadPoints)
          : null,
        volume: Number.isFinite(Number(eaQuote.volume)) ? Number(eaQuote.volume) : null,
      };
    }

    return { missing, details };
  })();

  const nextSteps = (() => {
    const steps = [];
    const seen = new Set();
    const push = (text) => {
      const t = String(text || '').trim();
      if (!t || seen.has(t)) {
        return;
      }
      seen.add(t);
      steps.push(t);
    };

    // 1) Hard blockers first (kill-switch)
    if (Array.isArray(killSwitchItems) && killSwitchItems.length) {
      killSwitchItems
        .slice()
        .sort((a, b) => (Number(b?.weight) || 0) - (Number(a?.weight) || 0))
        .slice(0, 6)
        .forEach((it) => {
          const label = it?.label || it?.id;
          if (it?.reason) {
            push(`${label}: ${it.reason}`);
            return;
          }
          push(`${label}: needs PASS`);
        });
    }

    // 2) Missing inputs
    if (Array.isArray(missingInputs?.missing) && missingInputs.missing.length) {
      missingInputs.missing.slice(0, 6).forEach((key) => {
        if (key === 'intermarket:correlation') {
          push('Correlation: enable/stream peer symbols (EA-only currently missing).');
          return;
        }
        if (key === 'news:calendarEvents') {
          push('Events: ensure EA is sending calendar events (or switch to scenario mode).');
          return;
        }
        if (key === 'news:headlines') {
          push('Headlines: connect a news provider or enable system headlines evidence.');
          return;
        }
        if (key === 'technical:indicators') {
          push('Technical snapshot: wait for MT indicators (RSI/MACD/ATR) to hydrate.');
          return;
        }
        if (key === 'market:eaQuote') {
          push('Quote: wait for EA bid/ask/spread/volume feed.');
          return;
        }
        push(`Missing input: ${key}`);
      });
    }

    // 3) Engine-provided whatWouldChange
    if (Array.isArray(whatWouldChange) && whatWouldChange.length) {
      whatWouldChange.slice(0, 10).forEach((line) => push(line));
    }

    return steps.slice(0, 10);
  })();

  layers.push(
    buildLayer({
      number: 18,
      nameEn: 'Decision Engine (ENTER / WAIT / BLOCKED)',
      nameAr: 'محرك القرار (دخول / انتظار / محجوب)',
      direction: isBlocked ? 'NEUTRAL' : finalDirection,
      confidence: isTradeValid
        ? finalConfidence
        : isBlocked
          ? 95
          : Math.max(55, Math.min(95, finalConfidence ?? 70)),
      score: finalScore,
      summaryEn:
        decisionState === 'ENTER'
          ? `Decision=ENTER ${finalDirection} · score=${decisionScore ?? '—'}/100 · sizeHint=${sizingHint}/10`
          : decisionState === 'WAIT_MONITOR'
            ? `Decision=WAIT/MONITOR · score=${decisionScore ?? '—'}/100 · missing=${missing.join(',') || '—'}`
            : killSwitchIds.length
              ? `Decision=BLOCKED (kill-switch) · ${
                  killSwitchItems
                    .slice(0, 4)
                    .map((it) => it?.label || it?.id)
                    .filter(Boolean)
                    .join(' · ') || killSwitchIds.slice(0, 6).join(',')
                }`
              : `Decision=BLOCKED · blockers=${
                  Object.entries(checks)
                    .filter(([, v]) => v === false)
                    .map(([k]) => k)
                    .join(',') || '—'
                }`,
      summaryAr:
        decisionState === 'ENTER'
          ? `القرار=دخول ${finalDirection} · الدرجة=${decisionScore ?? '—'}/100 · حجم=${sizingHint}/10`
          : decisionState === 'WAIT_MONITOR'
            ? `القرار=انتظار/مراقبة · الدرجة=${decisionScore ?? '—'}/100 · الناقص=${missing.join(',') || '—'}`
            : `القرار=محجوب · العوائق=${
                Object.entries(checks)
                  .filter(([, v]) => v === false)
                  .map(([k]) => k)
                  .join(',') || '—'
              }`,
      metrics: {
        direction: finalDirection,
        confidence: finalConfidence,
        adaptiveConfidence,
        finalScore,
        decision: {
          state: decisionState,
          score: decisionScore,
          blocked: isBlocked,
          missing,
          whatWouldChange,
          missingInputs,
          nextSteps,
          killSwitch: killSwitch
            ? {
                enabled: Boolean(killSwitch.enabled),
                blocked: Boolean(killSwitch.blocked),
                ids: killSwitchIds,
                items: killSwitchItems,
              }
            : null,
        },
        confluence: confluence
          ? {
              weightedScore: toFiniteNumber(confluence.score),
              minScore: toFiniteNumber(confluence.minScore),
              passed: Boolean(confluence.passed),
              strictSmartChecklist: Boolean(confluence.strictSmartChecklist),
              hardFails: safeArray(confluence.hardFails),
              keyGates,
            }
          : null,
        entry: {
          price: toFiniteNumber(entry?.price ?? sig?.entryPrice),
          stopLoss: toFiniteNumber(entry?.stopLoss ?? sig?.stopLoss),
          takeProfit: toFiniteNumber(entry?.takeProfit ?? sig?.takeProfit),
          riskReward: rr,
        },
        risk: {
          riskScore: Math.round(riskScore),
          sizingHint,
        },
      },
      evidence: [
        rr != null ? `R:R=${rr}` : null,
        `Alignment=${alignmentScore}%`,
        `RiskScore=${Math.round(riskScore)}`,
        adaptiveConfidence != null ? `AdaptiveConfidence=${adaptiveConfidence}%` : null,
        decisionScore != null ? `DecisionScore=${decisionScore}/100` : null,
      ].filter(Boolean),
      warnings: [
        ...(killSwitchItems.length
          ? killSwitchItems
              .slice(0, 4)
              .map((it) =>
                it.reason
                  ? `KILL-SWITCH: ${it.reason}`
                  : it.label
                    ? `KILL-SWITCH: ${it.label}`
                    : `KILL-SWITCH: ${it.id}`
              )
          : []),
        ...(missingInputs?.missing?.length
          ? [`MISSING INPUTS: ${missingInputs.missing.slice(0, 6).join(', ')}`]
          : []),
        ...(riskScore < 55 ? ['Consider smaller size or wait.'] : []),
      ],
      availability: 'available',
    })
  );

  return layers;
}
