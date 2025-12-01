import TradingEngine from '../src/engine/trading-engine.js';

const pair = (process.argv[2] || 'EURUSD').toUpperCase();

const engine = new TradingEngine({
  apiKeys: {
    twelveData: process.env.TWELVE_DATA_API_KEY || null,
    alphaVantage: process.env.ALPHA_VANTAGE_API_KEY || null,
    finnhub: process.env.FINNHUB_API_KEY || null,
    polygon: process.env.POLYGON_API_KEY || null,
    newsApi: process.env.NEWSAPI_KEY || null
  }
});

async function main() {
  try {
    const signal = await engine.generateSignal(pair);
    const winRate = signal?.estimatedWinRate ?? null;

    console.log(
      JSON.stringify(
        {
          pair: signal?.pair || pair,
          direction: signal?.direction || 'UNKNOWN',
          estimatedWinRate: winRate,
          confidence: signal?.confidence ?? null,
          strength: signal?.strength ?? null,
          riskReward: signal?.entry?.riskReward ?? null,
          valid: signal?.isValid?.isValid ?? false,
          reason: signal?.isValid?.reason ?? null
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('Failed to compute win rate:', error.message);
    process.exitCode = 1;
  }
}

main();
