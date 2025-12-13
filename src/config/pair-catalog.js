const FX_BASE_PRICES = {
  EURUSD: 1.085,
  GBPUSD: 1.265,
  USDJPY: 149.5,
  AUDUSD: 0.655,
  USDCAD: 1.365,
  NZDUSD: 0.605,
  USDCHF: 0.885,
  EURGBP: 0.858,
  EURJPY: 162.2,
  GBPJPY: 189.1,
  AUDJPY: 97.9,
  CADJPY: 109.5,
  EURCHF: 0.96,
  EURAUD: 1.656,
  EURCAD: 1.481,
  GBPAUD: 1.932,
  GBPCAD: 1.726,
  AUDCAD: 0.894,
  AUDNZD: 1.082
};

const FX_VOLATILITY = {
  EURUSD: 0.0008,
  GBPUSD: 0.0012,
  USDJPY: 0.15,
  AUDUSD: 0.001,
  USDCAD: 0.0009,
  NZDUSD: 0.0011,
  USDCHF: 0.0008,
  EURGBP: 0.0006,
  EURJPY: 0.18,
  GBPJPY: 0.22,
  AUDJPY: 0.14,
  CADJPY: 0.16
};

function createFxInstrument(config) {
  const pair = config.pair.toUpperCase();
  const base = config.base || pair.substring(0, 3);
  const quote = config.quote || pair.substring(3, 6);
  const isYen = quote === 'JPY';

  return {
    pair,
    assetClass: 'forex',
    base,
    quote,
    displayName: config.displayName || `${base}/${quote}`,
    pricePrecision: config.pricePrecision ?? (isYen ? 3 : 5),
    pipSize: config.pipSize ?? (isYen ? 0.001 : 0.0001),
    contractSize: config.contractSize ?? 100000,
    region: config.region,
    volatilityTier: config.volatilityTier,
    liquidityNotes: config.liquidityNotes,
    sessions: config.sessions || [],
    timeframes: config.timeframes || ['M15', 'H1', 'H4', 'D1'],
    aliases: config.aliases || [pair, `${base}/${quote}`],
    providers: {
      twelveData: config.providers?.twelveData || `${base}/${quote}`,
      finnhub: config.providers?.finnhub || `OANDA:${pair}`,
      polygon: config.providers?.polygon || `C:${pair}`,
      alphaVantage: config.providers?.alphaVantage || { from: base, to: quote }
    },
    syntheticBasePrice: config.syntheticBasePrice ?? FX_BASE_PRICES[pair] ?? 1,
    syntheticVolatility: config.syntheticVolatility ?? FX_VOLATILITY[pair] ?? 0.001,
    enabled: config.enabled !== false,
    notes: config.notes || null
  };
}

function createIndexInstrument(config) {
  const pair = config.pair.toUpperCase();
  return {
    pair,
    assetClass: 'index',
    base: config.base,
    quote: config.quote || 'USD',
    displayName: config.displayName || config.base,
    pricePrecision: config.pricePrecision ?? 1,
    pipSize: config.pipSize ?? 0.5,
    contractSize: config.contractSize ?? 1,
    region: config.region,
    volatilityTier: config.volatilityTier || 'high',
    liquidityNotes: config.liquidityNotes,
    sessions: config.sessions || [],
    timeframes: config.timeframes || ['M15', 'H1', 'H4', 'D1'],
    aliases: config.aliases || [config.base, pair],
    providers: {
      twelveData: config.providers?.twelveData || config.base,
      finnhub: config.providers?.finnhub,
      polygon: config.providers?.polygon,
      alphaVantage: config.providers?.alphaVantage || null
    },
    syntheticBasePrice: config.syntheticBasePrice ?? 4000,
    syntheticVolatility: config.syntheticVolatility ?? 25,
    enabled: config.enabled !== false,
    notes: config.notes || null
  };
}

function createCommodityInstrument(config) {
  const pair = config.pair.toUpperCase();
  return {
    pair,
    assetClass: 'commodity',
    base: config.base,
    quote: config.quote || 'USD',
    displayName: config.displayName || config.base,
    pricePrecision: config.pricePrecision ?? 2,
    pipSize: config.pipSize ?? 0.1,
    contractSize: config.contractSize ?? 100,
    region: config.region || 'Global',
    volatilityTier: config.volatilityTier || 'medium',
    liquidityNotes: config.liquidityNotes,
    sessions: config.sessions || [],
    timeframes: config.timeframes || ['M15', 'H1', 'H4', 'D1'],
    aliases: config.aliases || [config.base, pair],
    providers: {
      twelveData: config.providers?.twelveData || `${config.base}/${config.quote || 'USD'}`,
      finnhub: config.providers?.finnhub,
      polygon: config.providers?.polygon,
      alphaVantage: config.providers?.alphaVantage || null
    },
    syntheticBasePrice: config.syntheticBasePrice ?? 100,
    syntheticVolatility: config.syntheticVolatility ?? 2.5,
    enabled: config.enabled !== false,
    notes: config.notes || null
  };
}

function createCryptoInstrument(config) {
  const pair = config.pair.toUpperCase();
  return {
    pair,
    assetClass: 'crypto',
    base: config.base,
    quote: config.quote || 'USD',
    displayName: config.displayName || `${config.base}/${config.quote || 'USD'}`,
    pricePrecision: config.pricePrecision ?? 2,
    pipSize: config.pipSize ?? 1,
    contractSize: config.contractSize ?? 1,
    region: config.region || 'Global',
    volatilityTier: config.volatilityTier || 'high',
    liquidityNotes: config.liquidityNotes,
    sessions: config.sessions || [],
    timeframes: config.timeframes || ['M15', 'H1', 'H4', 'D1'],
    aliases: config.aliases || [config.base, pair, `${config.base}/${config.quote || 'USD'}`],
    providers: {
      twelveData: config.providers?.twelveData || `${config.base}/${config.quote || 'USD'}`,
      finnhub: config.providers?.finnhub,
      polygon: config.providers?.polygon,
      alphaVantage: config.providers?.alphaVantage || null
    },
    syntheticBasePrice: config.syntheticBasePrice ?? 30000,
    syntheticVolatility: config.syntheticVolatility ?? 400,
    enabled: config.enabled !== false,
    notes: config.notes || null
  };
}

const forexInstruments = [
  createFxInstrument({
    pair: 'EURUSD',
    region: 'Europe/US',
    volatilityTier: 'medium',
    liquidityNotes: 'High liquidity during London and New York overlap',
    sessions: [
      { label: 'London', start: '06:00', end: '15:00', weight: 1.4 },
      { label: 'New York', start: '12:00', end: '21:00', weight: 1.5 }
    ]
  }),
  createFxInstrument({
    pair: 'GBPUSD',
    region: 'UK/US',
    volatilityTier: 'high',
    liquidityNotes: 'Volatile during UK data releases and NY open',
    sessions: [
      { label: 'London', start: '07:00', end: '16:00', weight: 1.5 },
      { label: 'New York', start: '12:00', end: '21:00', weight: 1.4 }
    ]
  }),
  createFxInstrument({
    pair: 'USDJPY',
    region: 'US/Japan',
    volatilityTier: 'medium',
    liquidityNotes: 'Liquid during Tokyo and New York sessions',
    sessions: [
      { label: 'Tokyo', start: '23:00', end: '07:00', weight: 1.4 },
      { label: 'New York', start: '12:00', end: '21:00', weight: 1.2 }
    ]
  }),
  createFxInstrument({
    pair: 'AUDUSD',
    region: 'Australia/US',
    volatilityTier: 'medium',
    liquidityNotes: 'Active during Sydney open and NY crossover',
    sessions: [
      { label: 'Sydney', start: '21:00', end: '05:00', weight: 1.4 },
      { label: 'New York', start: '13:00', end: '21:00', weight: 1.2 }
    ]
  }),
  createFxInstrument({
    pair: 'USDCAD',
    region: 'US/Canada',
    volatilityTier: 'medium',
    liquidityNotes: 'Sensitive to oil releases during NY session',
    sessions: [{ label: 'New York', start: '12:00', end: '21:00', weight: 1.5 }]
  }),
  createFxInstrument({
    pair: 'NZDUSD',
    region: 'New Zealand/US',
    volatilityTier: 'low',
    liquidityNotes: 'Thinner liquidity outside Asia-Pacific hours',
    sessions: [{ label: 'Wellington', start: '21:00', end: '04:00', weight: 1.3 }]
  }),
  createFxInstrument({
    pair: 'USDCHF',
    region: 'US/Switzerland',
    volatilityTier: 'low',
    liquidityNotes: 'Safe haven activity during European hours',
    sessions: [{ label: 'Zurich', start: '07:00', end: '15:00', weight: 1.3 }]
  }),
  createFxInstrument({
    pair: 'EURGBP',
    region: 'Eurozone/UK',
    volatilityTier: 'medium',
    liquidityNotes: 'Most active during European data releases',
    sessions: [{ label: 'London', start: '07:00', end: '16:00', weight: 1.5 }],
    timeframes: ['M15', 'H1', 'H4'],
    enabled: false
  }),
  createFxInstrument({
    pair: 'EURJPY',
    region: 'Eurozone/Japan',
    volatilityTier: 'high',
    liquidityNotes: 'Reactive to BOJ and ECB policy windows',
    sessions: [
      { label: 'Tokyo', start: '23:00', end: '07:00', weight: 1.5 },
      { label: 'London', start: '06:00', end: '15:00', weight: 1.4 }
    ],
    timeframes: ['M15', 'H1', 'H4'],
    enabled: false
  }),
  createFxInstrument({
    pair: 'GBPJPY',
    region: 'UK/Japan',
    volatilityTier: 'high',
    liquidityNotes: 'One of the most volatile crosses, needs tighter cadence',
    sessions: [
      { label: 'Tokyo', start: '23:00', end: '07:00', weight: 1.4 },
      { label: 'London', start: '07:00', end: '16:00', weight: 1.6 }
    ],
    timeframes: ['M15', 'H1', 'H4'],
    enabled: false
  }),
  createFxInstrument({
    pair: 'AUDJPY',
    region: 'Australia/Japan',
    volatilityTier: 'medium',
    liquidityNotes: 'Asia-Pacific cross, elevated activity in Tokyo',
    sessions: [
      { label: 'Tokyo', start: '23:00', end: '07:00', weight: 1.4 },
      { label: 'Sydney', start: '21:00', end: '05:00', weight: 1.2 }
    ],
    timeframes: ['M15', 'H1', 'H4'],
    enabled: false
  }),
  createFxInstrument({
    pair: 'CADJPY',
    region: 'Canada/Japan',
    volatilityTier: 'medium',
    liquidityNotes: 'Oil-sensitive cross with Asia/North America overlap',
    sessions: [
      { label: 'Tokyo', start: '23:00', end: '07:00', weight: 1.3 },
      { label: 'New York', start: '12:00', end: '21:00', weight: 1.3 }
    ],
    timeframes: ['M15', 'H1', 'H4'],
    enabled: false
  })
];

const indexInstruments = [
  createIndexInstrument({
    pair: 'SPX500USD',
    base: 'SPX500',
    quote: 'USD',
    displayName: 'S&P 500 Index CFD',
    region: 'US',
    volatilityTier: 'high',
    liquidityNotes: 'US cash session most active; monitor earnings season.',
    sessions: [
      { label: 'North America', start: '13:30', end: '20:00', weight: 1.6 },
      { label: 'Globex', start: '23:00', end: '05:00', weight: 1.1 }
    ],
    aliases: ['S&P 500', 'US500', 'SPX', 'SP500', 'SPX500'],
    providers: {
      twelveData: 'SPX',
      finnhub: 'OANDA:SPX500_USD',
      polygon: 'I:SPX'
    },
    syntheticBasePrice: 4400,
    syntheticVolatility: 22,
    enabled: false
  }),
  createIndexInstrument({
    pair: 'NAS100USD',
    base: 'NAS100',
    quote: 'USD',
    displayName: 'NASDAQ 100 Index CFD',
    region: 'US',
    volatilityTier: 'very_high',
    liquidityNotes: 'Tech-weighted; reacts strongly to growth sentiment and yields.',
    sessions: [
      { label: 'North America', start: '13:30', end: '20:00', weight: 1.7 },
      { label: 'Globex', start: '23:00', end: '05:00', weight: 1.1 }
    ],
    aliases: ['NASDAQ 100', 'NAS100', 'US100', 'NDX'],
    providers: {
      twelveData: 'NDX',
      finnhub: 'OANDA:NAS100_USD',
      polygon: 'I:NDX'
    },
    syntheticBasePrice: 15500,
    syntheticVolatility: 35,
    enabled: false
  }),
  createIndexInstrument({
    pair: 'GER40EUR',
    base: 'GER40',
    quote: 'EUR',
    displayName: 'DAX 40 Index CFD',
    region: 'Europe',
    volatilityTier: 'medium',
    liquidityNotes: 'Concentrated liquidity during Frankfurt cash hours.',
    sessions: [
      { label: 'Frankfurt', start: '07:00', end: '15:30', weight: 1.5 },
      { label: 'Overnight', start: '22:00', end: '03:00', weight: 1.1 }
    ],
    aliases: ['DAX', 'DAX40', 'GER40', 'DE40'],
    providers: {
      twelveData: 'DAX',
      finnhub: 'OANDA:DE30_EUR',
      polygon: 'I:DAX'
    },
    syntheticBasePrice: 16000,
    syntheticVolatility: 28,
    enabled: false
  })
];

const commodityInstruments = [
  createCommodityInstrument({
    pair: 'XAUUSD',
    base: 'XAU',
    quote: 'USD',
    displayName: 'Gold Spot',
    pricePrecision: 2,
    pipSize: 0.1,
    volatilityTier: 'medium',
    liquidityNotes: 'Active during NY/London overlap; safe haven flows.',
    sessions: [
      { label: 'London Bullion', start: '08:00', end: '16:00', weight: 1.5 },
      { label: 'Comex', start: '13:20', end: '18:30', weight: 1.4 }
    ],
    aliases: ['Gold', 'XAU', 'Gold Spot'],
    providers: {
      twelveData: 'XAU/USD',
      finnhub: 'OANDA:XAUUSD',
      polygon: 'C:XAUUSD'
    },
    syntheticBasePrice: 1950,
    syntheticVolatility: 4.5,
    enabled: false
  }),
  createCommodityInstrument({
    pair: 'XAGUSD',
    base: 'XAG',
    quote: 'USD',
    displayName: 'Silver Spot',
    pricePrecision: 3,
    pipSize: 0.01,
    volatilityTier: 'high',
    liquidityNotes: 'Higher volatility than gold; industrial demand sensitive.',
    sessions: [
      { label: 'London Bullion', start: '08:00', end: '16:00', weight: 1.4 },
      { label: 'Comex', start: '13:25', end: '18:25', weight: 1.3 }
    ],
    aliases: ['Silver', 'XAG'],
    providers: {
      twelveData: 'XAG/USD',
      finnhub: 'OANDA:XAGUSD',
      polygon: 'C:XAGUSD'
    },
    syntheticBasePrice: 24,
    syntheticVolatility: 0.6,
    enabled: false
  }),
  createCommodityInstrument({
    pair: 'USOILUSD',
    base: 'USOIL',
    quote: 'USD',
    displayName: 'WTI Crude Oil',
    pricePrecision: 2,
    pipSize: 0.01,
    volatilityTier: 'high',
    liquidityNotes: 'Watch DOE/EIA releases; significant geopolitical sensitivity.',
    sessions: [
      { label: 'NYMEX', start: '13:00', end: '18:30', weight: 1.5 },
      { label: 'Globex', start: '23:00', end: '05:00', weight: 1.2 }
    ],
    aliases: ['WTI', 'Crude Oil', 'Oil'],
    providers: {
      twelveData: 'WTI/USD',
      finnhub: 'OANDA:WTICO_USD',
      polygon: 'C:CL1'
    },
    syntheticBasePrice: 75,
    syntheticVolatility: 1.8,
    enabled: false
  })
];

const cryptoInstruments = [
  createCryptoInstrument({
    pair: 'BTCUSD',
    base: 'BTC',
    quote: 'USD',
    displayName: 'Bitcoin',
    pricePrecision: 2,
    pipSize: 1,
    liquidityNotes: '24/7 trading; highest liquidity during US afternoon.',
    aliases: ['Bitcoin', 'BTC', 'XBT'],
    providers: {
      twelveData: 'BTC/USD',
      finnhub: 'BINANCE:BTCUSDT',
      polygon: 'X:BTCUSD'
    },
    syntheticBasePrice: 36000,
    syntheticVolatility: 450,
    enabled: false
  }),
  createCryptoInstrument({
    pair: 'ETHUSD',
    base: 'ETH',
    quote: 'USD',
    displayName: 'Ethereum',
    pricePrecision: 2,
    pipSize: 0.5,
    liquidityNotes: '24/7 trading; correlated with risk-on sentiment in crypto.',
    aliases: ['Ethereum', 'ETH'],
    providers: {
      twelveData: 'ETH/USD',
      finnhub: 'BINANCE:ETHUSDT',
      polygon: 'X:ETHUSD'
    },
    syntheticBasePrice: 2200,
    syntheticVolatility: 65,
    enabled: false
  })
];

export const pairCatalog = [
  ...forexInstruments,
  ...indexInstruments,
  ...commodityInstruments,
  ...cryptoInstruments
];

const instrumentIndex = new Map(
  pairCatalog.map((instrument) => [instrument.pair.toUpperCase(), instrument])
);

export function getPairMetadata(pair) {
  if (!pair) {
    return null;
  }
  return instrumentIndex.get(String(pair).toUpperCase()) || null;
}

export function listTargetPairs() {
  return pairCatalog
    .filter((instrument) => instrument.enabled !== false)
    .map((instrument) => instrument.pair);
}

export function listInstrumentsByAssetClass(assetClass) {
  return pairCatalog
    .filter((instrument) => instrument.assetClass === assetClass && instrument.enabled !== false)
    .map((instrument) => instrument.pair);
}

export function getProviderSymbol(pair, provider) {
  const metadata = getPairMetadata(pair);
  if (!metadata) {
    return null;
  }
  if (!provider) {
    return null;
  }
  const normalized = String(provider).toLowerCase();
  const providers = metadata.providers || {};
  const direct = providers[normalized] ?? providers[provider];
  if (typeof direct === 'string') {
    return direct;
  }
  if (direct && typeof direct === 'object') {
    return direct.symbol || null;
  }
  if (metadata.assetClass === 'forex') {
    if (normalized === 'twelvedata') {
      return `${metadata.base}/${metadata.quote}`;
    }
    if (normalized === 'finnhub') {
      return `OANDA:${metadata.pair}`;
    }
    if (normalized === 'polygon') {
      return `C:${metadata.pair}`;
    }
  }
  return null;
}

export function getPipSize(pair) {
  const metadata = getPairMetadata(pair);
  if (!metadata) {
    return pair && pair.endsWith('JPY') ? 0.001 : 0.0001;
  }
  return (
    metadata.pipSize ??
    (metadata.assetClass === 'forex' && metadata.quote === 'JPY' ? 0.001 : 0.0001)
  );
}

export function getPricePrecision(pair) {
  const metadata = getPairMetadata(pair);
  if (!metadata) {
    return pair && pair.endsWith('JPY') ? 3 : 5;
  }
  return (
    metadata.pricePrecision ?? (metadata.assetClass === 'forex' && metadata.quote === 'JPY' ? 3 : 5)
  );
}

// Synthetic functions removed - use real data only from MT4/MT5 EA or APIs

export default pairCatalog;
