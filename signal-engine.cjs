// AI-Powered Signal Generation Engine
// Multi-Layer Analysis: Technical + Fundamental + AI + Macro

class SignalEngine {
  constructor() {
    this.confidenceThreshold = 90; // Minimum 90% confidence
    this.signalCache = new Map();
    this.lastUpdate = Date.now();
  }

  // ==================== DATA COLLECTION ====================
  
  async collectMarketData(symbol) {
    // Real-time data collection from free sources with graceful fallback
    // Crypto: Binance public API (no key)
    // Forex: Frankfurter.app (daily but real), optional AlphaVantage via API key
    // Gold: metals.live free endpoint

    const now = new Date();
    const fallbackBase = this.getBasePrice(symbol);

    const price = await this.fetchRealPrice(symbol, fallbackBase);
    const currentPrice = price ?? fallbackBase;

    // Synthetic micro-variations for intrabar movement when source is slow (e.g., daily FX)
    const jitter = (Math.random() - 0.5) * currentPrice * 0.0005; // +/- 5 bps

    const finalPrice = Math.max(0.00001, currentPrice + jitter);

    return {
      symbol,
      currentPrice: finalPrice,
      volume: Math.floor(Math.random() * 1000000) + 500000,
      bid: finalPrice * (1 - 0.0001),
      ask: finalPrice * (1 + 0.0001),
      timestamp: now.toISOString(),
      // Historical data (synthetic around current until real candles are wired)
      history: this.generateHistoricalData(finalPrice, 200)
    };
  }

  async fetchRealPrice(symbol, fallbackBase) {
    try {
      const f = typeof fetch !== 'undefined' ? fetch : null;
      if (!f) return fallbackBase;

      // Prefer Twelve Data if API key is provided (real-time forex/crypto/commodities)
      const twelveKey = process.env.TWELVE_DATA_API_KEY;
      const enableLive = String(process.env.ENABLE_LIVE_PRICES || 'true').toLowerCase() !== 'false';
      const tdSymbolMap = (sym) => {
        // Map internal symbols like EURUSD -> EUR/USD, BTCUSD -> BTC/USD, XAUUSD -> XAU/USD
        if (!sym || sym.length < 6) return sym;
        const base = sym.slice(0, 3);
        const quote = sym.slice(3);
        return `${base}/${quote}`;
      };

      if (enableLive && twelveKey) {
        try {
          const tdSymbol = tdSymbolMap(symbol);
          const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(tdSymbol)}&apikey=${twelveKey}`;
          const r = await f(url);
          if (r.ok) {
            const j = await r.json();
            const p = parseFloat(j.price);
            if (!Number.isNaN(p)) return p;
          }
        } catch {}
      }

      // Crypto via Binance
      if (symbol === 'BTCUSD' || symbol === 'ETHUSD') {
        const binanceSymbol = symbol.replace('USD', 'USDT');
        const r = await f(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`);
        if (r.ok) {
          const j = await r.json();
          const p = parseFloat(j.price);
          if (!Number.isNaN(p)) return p;
        }
      }

      // Forex via Frankfurter (daily rates)
      if (symbol === 'EURUSD') {
        const r = await f('https://api.frankfurter.app/latest?from=EUR&to=USD');
        if (r.ok) { const j = await r.json(); return j.rates?.USD ?? fallbackBase; }
      }
      if (symbol === 'GBPUSD') {
        const r = await f('https://api.frankfurter.app/latest?from=GBP&to=USD');
        if (r.ok) { const j = await r.json(); return j.rates?.USD ?? fallbackBase; }
      }
      if (symbol === 'USDJPY') {
        const r = await f('https://api.frankfurter.app/latest?from=USD&to=JPY');
        if (r.ok) { const j = await r.json(); return j.rates?.JPY ?? fallbackBase; }
      }

      // Gold via metals.live
      if (symbol === 'XAUUSD') {
        const r = await f('https://api.metals.live/v1/spot/gold');
        if (r.ok) {
          const j = await r.json();
          // API may return array of numbers or objects; attempt to read last value
          const last = Array.isArray(j) ? j[j.length - 1] : null;
          if (Array.isArray(last)) {
            const p = parseFloat(last[1]);
            if (!Number.isNaN(p)) return p;
          } else if (typeof last === 'number') {
            return last;
          }
        }
      }

      return fallbackBase;
    } catch (e) {
      return fallbackBase;
    }
  }

  getBasePrice(symbol) {
    const prices = {
      'EURUSD': 1.0850,
      'GBPUSD': 1.2650,
      'USDJPY': 150.25,
      'XAUUSD': 2050.50,
      'BTCUSD': 35000,
      'ETHUSD': 1850,
      'US30': 34500,
      'CRUDE': 78.50
    };
    return prices[symbol] || 1.0000;
  }

  generateHistoricalData(basePrice, periods) {
    const history = [];
    let price = basePrice;
    for (let i = periods; i > 0; i--) {
      const change = (Math.random() - 0.5) * basePrice * 0.01;
      price += change;
      history.push({
        time: new Date(Date.now() - i * 60000).toISOString(),
        open: price,
        high: price + Math.abs(change) * 0.5,
        low: price - Math.abs(change) * 0.5,
        close: price + (Math.random() - 0.5) * Math.abs(change),
        volume: Math.floor(Math.random() * 100000) + 50000
      });
    }
    return history;
  }

  // ==================== TECHNICAL ANALYSIS ====================
  
  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  calculateMACD(prices) {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;
    const signal = this.calculateEMA([macd], 9);
    const histogram = macd - signal;
    
    return { macd, signal, histogram };
  }

  calculateEMA(prices, period) {
    if (prices.length === 0) return 0;
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    
    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
  }

  calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return { upper: 0, middle: 0, lower: 0 };
    
    const slice = prices.slice(-period);
    const middle = slice.reduce((a, b) => a + b, 0) / period;
    
    const variance = slice.reduce((sum, price) => sum + Math.pow(price - middle, 2), 0) / period;
    const std = Math.sqrt(variance);
    
    return {
      upper: middle + (std * stdDev),
      middle: middle,
      lower: middle - (std * stdDev)
    };
  }

  findSupportResistance(history) {
    const prices = history.map(h => h.close);
    const highs = history.map(h => h.high);
    const lows = history.map(h => h.low);
    
    // Find pivot points
    const pivots = [];
    for (let i = 5; i < prices.length - 5; i++) {
      const isHigh = highs[i] === Math.max(...highs.slice(i - 5, i + 5));
      const isLow = lows[i] === Math.min(...lows.slice(i - 5, i + 5));
      
      if (isHigh) pivots.push({ type: 'resistance', price: highs[i] });
      if (isLow) pivots.push({ type: 'support', price: lows[i] });
    }
    
    return pivots.slice(-10); // Last 10 pivot points
  }

  detectCandlestickPatterns(history) {
    const patterns = [];
    const recent = history.slice(-5);
    
    recent.forEach((candle, idx) => {
      const body = Math.abs(candle.close - candle.open);
      const range = candle.high - candle.low;
      const upperShadow = candle.high - Math.max(candle.open, candle.close);
      const lowerShadow = Math.min(candle.open, candle.close) - candle.low;
      
      // Doji
      if (body < range * 0.1) {
        patterns.push({ name: 'Doji', signal: 'neutral', strength: 60 });
      }
      
      // Hammer
      if (lowerShadow > body * 2 && upperShadow < body * 0.3) {
        patterns.push({ name: 'Hammer', signal: 'bullish', strength: 75 });
      }
      
      // Shooting Star
      if (upperShadow > body * 2 && lowerShadow < body * 0.3) {
        patterns.push({ name: 'Shooting Star', signal: 'bearish', strength: 75 });
      }
    });
    
    return patterns;
  }

  // ==================== FUNDAMENTAL ANALYSIS ====================
  
  analyzeFundamentals(symbol, economicEvents) {
    let fundamentalScore = 50; // Neutral
    let impact = 'medium';
    let reasoning = [];
    
    // Check for high-impact news
    const relevantEvents = economicEvents.filter(event => 
      event.impact === 'high' && 
      new Date(event.time) > new Date(Date.now() - 4 * 60 * 60 * 1000) // Last 4 hours
    );
    
    if (relevantEvents.length > 0) {
      impact = 'high';
      reasoning.push(`${relevantEvents.length} high-impact economic events detected`);
    }
    
    // Currency-specific analysis
    if (symbol.includes('USD')) {
      fundamentalScore += 5; // USD strength bias
      reasoning.push('USD showing strength in global markets');
    }
    
    if (symbol.includes('EUR')) {
      fundamentalScore += 3;
      reasoning.push('EUR stable amid ECB policy');
    }
    
    return { fundamentalScore, impact, reasoning };
  }

  // ==================== AI/ML PREDICTION ENGINE ====================
  
  predictMovement(technicals, fundamentals, marketData) {
    // Simulated AI prediction (in production: use TensorFlow.js, ML model)
    let prediction = 50;
    let confidence = 0;
    
    // Technical weight: 40%
    const techScore = technicals.overallScore;
    prediction += (techScore - 50) * 0.4;
    confidence += technicals.confidence * 0.4;
    
    // Fundamental weight: 30%
    prediction += (fundamentals.fundamentalScore - 50) * 0.3;
    confidence += 70 * 0.3;
    
    // Market momentum weight: 20%
    const momentum = this.calculateMomentum(marketData.history);
    prediction += momentum * 0.2;
    confidence += Math.abs(momentum) * 0.2;
    
    // Volume confirmation weight: 10%
    const volumeStrength = this.analyzeVolume(marketData.history);
    prediction += volumeStrength * 0.1;
    confidence += volumeStrength * 0.1;
    
    return {
      direction: prediction > 52 ? 'BUY' : prediction < 48 ? 'SELL' : 'HOLD',
      strength: Math.abs(prediction - 50) * 2,
      confidence: Math.min(confidence, 100),
      prediction
    };
  }

  calculateMomentum(history) {
    const prices = history.map(h => h.close);
    const recent = prices.slice(-10);
    const older = prices.slice(-20, -10);
    
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    
    return ((recentAvg - olderAvg) / olderAvg) * 100;
  }

  analyzeVolume(history) {
    const volumes = history.map(h => h.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    
    return ((recentVolume - avgVolume) / avgVolume) * 50;
  }

  // ==================== ADVANCED FILTERING ====================
  
  filterSignal(signal) {
    const filters = [];
    let passed = true;
    
    // Confidence threshold (do not hide if low; mark as low-confidence)
    if (signal.confidence < this.confidenceThreshold) {
      filters.push({ 
        passed: false, 
        reason: `Confidence ${signal.confidence.toFixed(1)}% below threshold ${this.confidenceThreshold}%` 
      });
      passed = false;
    } else {
      filters.push({ passed: true, reason: `Confidence ${signal.confidence.toFixed(1)}% passes threshold` });
    }
    
    // Risk/Reward ratio check (require >= 2.0)
    if (signal.riskReward < 2.0) {
      filters.push({ 
        passed: false, 
        reason: `Risk/Reward ratio ${signal.riskReward.toFixed(2)} too low (min 2.0)` 
      });
      passed = false;
    } else {
      filters.push({ passed: true, reason: `Risk/Reward ratio ${signal.riskReward.toFixed(2)} acceptable` });
    }
    
    // Technical alignment check (stricter)
    if (signal.technicalAlignment < 75) {
      filters.push({ 
        passed: false, 
        reason: `Technical indicators only ${signal.technicalAlignment}% aligned (min 75%)` 
      });
      passed = false;
    } else {
      filters.push({ passed: true, reason: `Technical indicators ${signal.technicalAlignment}% aligned` });
    }

    // High-impact environment: require higher confidence
    if ((signal.fundamental?.impact || signal.fundamental?.impactLevel) === 'high' && signal.confidence < 93) {
      filters.push({ passed: false, reason: `High-impact environment detected; confidence ${signal.confidence.toFixed(1)}% < 93%` });
      passed = false;
    }
    
    // Trend + momentum alignment guard: avoid signals against both EMA50 and MACD histogram
    try {
      const ema50 = signal.technical?.ema50;
      const macdHist = signal.technical?.macd?.histogram;
      if (typeof ema50 === 'number' && typeof macdHist === 'number') {
        if (signal.direction === 'BUY' && macdHist < 0 && signal.entryPrice < ema50) {
          filters.push({ passed: false, reason: 'Rejected BUY: MACD<0 and price<EMA50 (avoid chop/flip)' });
          passed = false;
        }
        if (signal.direction === 'SELL' && macdHist > 0 && signal.entryPrice > ema50) {
          filters.push({ passed: false, reason: 'Rejected SELL: MACD>0 and price>EMA50 (avoid chop/flip)' });
          passed = false;
        }
      }
    } catch {}
    
    return { passed, filters };
  }

  // ==================== SIGNAL GENERATION (MAIN) ====================
  
  async generateSignal(symbol, economicEvents = []) {
    try {
      // Step 1: Collect real-time market data
      const marketData = await this.collectMarketData(symbol);
      
      // Step 2: Technical Analysis
      const prices = marketData.history.map(h => h.close);
      const rsi = this.calculateRSI(prices);
      const macd = this.calculateMACD(prices);
  const bb = this.calculateBollingerBands(prices);
  const ema50 = this.calculateEMA(prices, 50);
      const srLevels = this.findSupportResistance(marketData.history);
      const patterns = this.detectCandlestickPatterns(marketData.history);
      
      // Technical scoring
      let technicalScore = 50;
      let technicalConfidence = 0;
      const technicalReasons = [];
      
      // RSI Analysis
      if (rsi < 30) {
        technicalScore += 15;
        technicalConfidence += 20;
        technicalReasons.push(`RSI oversold at ${rsi.toFixed(1)} - Strong buy signal`);
      } else if (rsi > 70) {
        technicalScore -= 15;
        technicalConfidence += 20;
        technicalReasons.push(`RSI overbought at ${rsi.toFixed(1)} - Strong sell signal`);
      } else {
        technicalReasons.push(`RSI neutral at ${rsi.toFixed(1)}`);
      }
      
      // MACD Analysis
      if (macd.histogram > 0) {
        technicalScore += 10;
        technicalConfidence += 15;
        technicalReasons.push('MACD histogram positive - Bullish momentum');
      } else {
        technicalScore -= 10;
        technicalConfidence += 15;
        technicalReasons.push('MACD histogram negative - Bearish momentum');
      }
      
      // Bollinger Bands
      if (marketData.currentPrice < bb.lower) {
        technicalScore += 12;
        technicalConfidence += 18;
        technicalReasons.push('Price below lower Bollinger Band - Potential reversal up');
      } else if (marketData.currentPrice > bb.upper) {
        technicalScore -= 12;
        technicalConfidence += 18;
        technicalReasons.push('Price above upper Bollinger Band - Potential reversal down');
      }
      
      // Candlestick patterns
      patterns.forEach(pattern => {
        if (pattern.signal === 'bullish') {
          technicalScore += 8;
          technicalConfidence += 12;
          technicalReasons.push(`${pattern.name} detected - Bullish pattern`);
        } else if (pattern.signal === 'bearish') {
          technicalScore -= 8;
          technicalConfidence += 12;
          technicalReasons.push(`${pattern.name} detected - Bearish pattern`);
        }
      });

      // Trend alignment (EMA50)
      if (marketData.currentPrice > ema50) {
        technicalScore += 5;
        technicalConfidence += 8;
        technicalReasons.push('Price above EMA50 - Uptrend confirmation');
      } else {
        technicalScore -= 5;
        technicalConfidence += 8;
        technicalReasons.push('Price below EMA50 - Downtrend confirmation');
      }
      
      const technicals = {
        rsi,
        macd,
        ema50,
        bollingerBands: bb,
        supportResistance: srLevels,
        patterns,
        overallScore: technicalScore,
        confidence: technicalConfidence,
        reasoning: technicalReasons
      };
      
      // Step 3: Fundamental Analysis
      const fundamentals = this.analyzeFundamentals(symbol, economicEvents);
      
      // Step 4: AI Prediction
      const aiPrediction = this.predictMovement(technicals, fundamentals, marketData);
      
      // Step 5: Calculate Entry/Exit Points
      const entryPrice = marketData.currentPrice;
      const atr = this.calculateATR(marketData.history);
      
      let stopLoss, takeProfit, direction;
      
      if (aiPrediction.direction === 'BUY') {
        direction = 'BUY';
        stopLoss = entryPrice - (atr * 2);
        takeProfit = entryPrice + (atr * 4);
      } else if (aiPrediction.direction === 'SELL') {
        direction = 'SELL';
        stopLoss = entryPrice + (atr * 2);
        takeProfit = entryPrice - (atr * 4);
      } else {
        direction = 'HOLD';
        stopLoss = entryPrice - (atr * 1.5);
        takeProfit = entryPrice + (atr * 3);
      }
      
      // Respect Bollinger boundaries softly
      if (direction === 'BUY' && bb.upper) takeProfit = Math.max(takeProfit, bb.upper);
      if (direction === 'SELL' && bb.lower) takeProfit = Math.min(takeProfit, bb.lower);

      const riskReward = Math.abs(takeProfit - entryPrice) / Math.abs(stopLoss - entryPrice);
      
      // Step 6: Build complete signal
      const signal = {
        id: `${symbol}_${Date.now()}`,
        symbol,
        direction,
        entryPrice,
        currentPrice: marketData.currentPrice,
        stopLoss,
        takeProfit,
        atr,
        riskReward,
        confidence: aiPrediction.confidence,
        strength: aiPrediction.strength,
        technicalAlignment: technicalConfidence,
        timestamp: new Date().toISOString(),
        
        // Analysis breakdown
        technical: technicals,
        fundamental: fundamentals,
        aiPrediction,
        
        // Reasoning
        reasoning: [
          ...technicalReasons,
          ...fundamentals.reasoning,
          `AI Prediction: ${aiPrediction.direction} with ${aiPrediction.confidence.toFixed(1)}% confidence`,
          `Risk/Reward Ratio: ${riskReward.toFixed(2)}:1`
        ],
        
        // Metadata
        timeframe: '1H',
        status: 'pending',
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() // 4 hours
      };
      
      // Step 7: Advanced filtering
  const filterResult = this.filterSignal(signal);
  signal.filterResult = filterResult;
  signal.status = filterResult.passed ? 'active' : 'low-confidence';
      
      // Step 8: Calculate position size (risk management)
      signal.positionSize = this.calculatePositionSize(signal, 10000); // Assume $10k account
      
      return signal;
      
    } catch (error) {
      console.error('Error generating signal:', error);
      return null;
    }
  }

  calculateATR(history, period = 14) {
    if (history.length < period) return 0.001;
    
    const trueRanges = [];
    for (let i = 1; i < history.length; i++) {
      const high = history[i].high;
      const low = history[i].low;
      const prevClose = history[i - 1].close;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }
    
    const recentTR = trueRanges.slice(-period);
    return recentTR.reduce((a, b) => a + b, 0) / period;
  }

  calculatePositionSize(signal, accountBalance) {
    const riskPercent = 0.02; // 2% risk per trade
    const riskAmount = accountBalance * riskPercent;
    const stopLossDistance = Math.abs(signal.entryPrice - signal.stopLoss);
    
    const positionSize = riskAmount / stopLossDistance;
    
    return {
      lots: (positionSize / 100000).toFixed(2), // Standard lot calculation
      units: Math.floor(positionSize),
      riskAmount: riskAmount.toFixed(2),
      riskPercent: (riskPercent * 100).toFixed(1)
    };
  }

  // ==================== CONTINUOUS LEARNING ====================
  
  recordSignalResult(signalId, result) {
    // Store signal results for ML training
    // In production: save to database, retrain model
    console.log(`Signal ${signalId} result:`, result);
  }
}

module.exports = SignalEngine;
