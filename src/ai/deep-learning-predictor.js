/**
 * Deep Learning Predictor for Trading Signals
 * 
 * Advanced AI system using neural networks for market prediction
 * Features:
 * - LSTM-based time series prediction
 * - 50+ feature engineering
 * - Real-time model training
 * - Confidence scoring
 * - Model persistence
 */

import * as tf from '@tensorflow/tfjs-node';
import { logger } from '../utils/logger.js';

export class DeepLearningPredictor {
  constructor(config = {}) {
    this.config = {
      sequenceLength: config.sequenceLength || 60, // 60 candles lookback
      features: config.features || 50,
      hiddenUnits: config.hiddenUnits || 128,
      dropout: config.dropout || 0.2,
      learningRate: config.learningRate || 0.001,
      epochs: config.epochs || 50,
      batchSize: config.batchSize || 32,
      validationSplit: config.validationSplit || 0.2,
      minTrainingSamples: config.minTrainingSamples || 1000,
      ...config
    };

    this.model = null;
    this.isTraining = false;
    this.trainingHistory = [];
    this.predictions = [];
    this.modelVersion = 0;
  }

  /**
   * Initialize and build the LSTM model
   */
  async buildModel() {
    try {
      logger.info('Building Deep Learning model...');

      const model = tf.sequential();

      // Input layer
      model.add(tf.layers.lstm({
        units: this.config.hiddenUnits,
        returnSequences: true,
        inputShape: [this.config.sequenceLength, this.config.features]
      }));

      model.add(tf.layers.dropout({ rate: this.config.dropout }));

      // Hidden LSTM layer
      model.add(tf.layers.lstm({
        units: this.config.hiddenUnits / 2,
        returnSequences: false
      }));

      model.add(tf.layers.dropout({ rate: this.config.dropout }));

      // Dense layers
      model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
      model.add(tf.layers.dropout({ rate: this.config.dropout / 2 }));
      
      model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
      
      // Output layer (3 classes: BUY, SELL, HOLD)
      model.add(tf.layers.dense({ units: 3, activation: 'softmax' }));

      // Compile model
      model.compile({
        optimizer: tf.train.adam(this.config.learningRate),
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
      });

      this.model = model;
      this.modelVersion++;

      logger.info('Deep Learning model built successfully');
      logger.info(`Model summary: ${model.countParams()} parameters`);

      return model;
    } catch (error) {
      logger.error('Error building model:', error);
      throw error;
    }
  }

  /**
   * Extract features from market data
   */
  extractFeatures(candles, technicalIndicators, fundamentalData) {
    const features = [];

    candles.forEach((candle, i) => {
      const featureVector = [
        // Price features (normalized)
        candle.open / candles[0].open,
        candle.high / candles[0].open,
        candle.low / candles[0].open,
        candle.close / candles[0].open,
        
        // Volume features
        candle.volume / candles[0].volume,
        
        // Price changes
        i > 0 ? (candle.close - candles[i-1].close) / candles[i-1].close : 0,
        i > 0 ? (candle.high - candle.low) / candle.close : 0,
        i > 0 ? (candle.close - candle.open) / candle.open : 0,
        
        // Technical indicators (normalized)
        technicalIndicators.rsi[i] / 100,
        technicalIndicators.macd[i] / candle.close,
        technicalIndicators.macdSignal[i] / candle.close,
        technicalIndicators.macdHistogram[i] / candle.close,
        
        // Moving averages
        technicalIndicators.sma20[i] / candle.close,
        technicalIndicators.sma50[i] / candle.close,
        technicalIndicators.sma200[i] / candle.close,
        technicalIndicators.ema12[i] / candle.close,
        technicalIndicators.ema26[i] / candle.close,
        
        // Bollinger Bands
        technicalIndicators.bbUpper[i] / candle.close,
        technicalIndicators.bbMiddle[i] / candle.close,
        technicalIndicators.bbLower[i] / candle.close,
        
        // ATR (normalized)
        technicalIndicators.atr[i] / candle.close,
        
        // Stochastic
        technicalIndicators.stochK[i] / 100,
        technicalIndicators.stochD[i] / 100,
        
        // ADX
        technicalIndicators.adx[i] / 100,
        technicalIndicators.plusDI[i] / 100,
        technicalIndicators.minusDI[i] / 100,
        
        // Volume indicators
        technicalIndicators.obv[i] / 1000000,
        technicalIndicators.volumeSMA[i] / candle.volume,
        
        // Fibonacci levels (distance from current price)
        ...this.calculateFibonacciFeatures(candles.slice(Math.max(0, i-50), i+1)),
        
        // Pivot points
        ...this.calculatePivotFeatures(candle),
        
        // Candlestick patterns (binary)
        ...this.detectCandlestickPatterns(candles.slice(Math.max(0, i-2), i+1)),
        
        // Market regime
        ...this.detectMarketRegime(candles.slice(Math.max(0, i-20), i+1)),
        
        // Fundamental features
        fundamentalData?.gdp || 0,
        fundamentalData?.inflation || 0,
        fundamentalData?.interestRate || 0,
        fundamentalData?.unemployment || 0,
        
        // Time features
        new Date(candle.timestamp).getHours() / 24,
        new Date(candle.timestamp).getDay() / 7,
      ];

      features.push(featureVector);
    });

    return features;
  }

  /**
   * Calculate Fibonacci retracement features
   */
  calculateFibonacciFeatures(candles) {
    if (candles.length < 2) {return [0, 0, 0, 0];}

    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    const current = candles[candles.length - 1].close;
    const range = high - low;

    return [
      (current - (high - 0.236 * range)) / current, // 23.6%
      (current - (high - 0.382 * range)) / current, // 38.2%
      (current - (high - 0.5 * range)) / current,   // 50%
      (current - (high - 0.618 * range)) / current, // 61.8%
    ];
  }

  /**
   * Calculate pivot point features
   */
  calculatePivotFeatures(candle) {
    const pivot = (candle.high + candle.low + candle.close) / 3;
    const r1 = 2 * pivot - candle.low;
    const s1 = 2 * pivot - candle.high;

    return [
      (candle.close - pivot) / candle.close,
      (candle.close - r1) / candle.close,
      (candle.close - s1) / candle.close,
    ];
  }

  /**
   * Detect candlestick patterns (binary features)
   */
  detectCandlestickPatterns(candles) {
    if (candles.length < 2) {return [0, 0, 0, 0, 0];}

    const current = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    const body = Math.abs(current.close - current.open);
    const range = current.high - current.low;
    const upperShadow = current.high - Math.max(current.open, current.close);
    const lowerShadow = Math.min(current.open, current.close) - current.low;

    return [
      body / range > 0.7 ? 1 : 0,  // Strong body
      upperShadow / range > 0.6 ? 1 : 0,  // Shooting star / hammer
      lowerShadow / range > 0.6 ? 1 : 0,  // Inverted hammer
      current.close > current.open ? 1 : 0,  // Bullish
      current.close < current.open ? 1 : 0,  // Bearish
    ];
  }

  /**
   * Detect market regime
   */
  detectMarketRegime(candles) {
    if (candles.length < 10) {return [0, 0, 0];}

    const closes = candles.map(c => c.close);
    const returns = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
    
    const volatility = Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length);
    const trend = (closes[closes.length - 1] - closes[0]) / closes[0];

    // Classify: trending, ranging, volatile
    const isTrending = Math.abs(trend) > 0.02;
    const isVolatile = volatility > 0.015;

    return [
      isTrending && !isVolatile ? 1 : 0,  // Trending
      !isTrending && !isVolatile ? 1 : 0, // Ranging
      isVolatile ? 1 : 0,                  // Volatile
    ];
  }

  /**
   * Prepare training data from historical trades
   */
  prepareTrainingData(historicalData) {
    const sequences = [];
    const labels = [];

    for (let i = this.config.sequenceLength; i < historicalData.length; i++) {
      const sequence = historicalData.slice(i - this.config.sequenceLength, i);
      const nextCandle = historicalData[i];
      
      // Label: 0 = SELL, 1 = HOLD, 2 = BUY
      let label;
      if (nextCandle.outcome === 'WIN' && nextCandle.direction === 'BUY') {
        label = 2; // BUY
      } else if (nextCandle.outcome === 'WIN' && nextCandle.direction === 'SELL') {
        label = 0; // SELL
      } else {
        label = 1; // HOLD
      }

      sequences.push(sequence.map(d => d.features));
      labels.push(label);
    }

    return { sequences, labels };
  }

  /**
   * Train the model with historical data
   */
  async train(historicalData) {
    try {
      if (this.isTraining) {
        logger.warn('Model is already training');
        return;
      }

      if (historicalData.length < this.config.minTrainingSamples) {
        logger.warn(`Insufficient training data: ${historicalData.length} < ${this.config.minTrainingSamples}`);
        return;
      }

      this.isTraining = true;
      logger.info('Starting model training...');

      // Build model if not exists
      if (!this.model) {
        await this.buildModel();
      }

      // Prepare data
      const { sequences, labels } = this.prepareTrainingData(historicalData);

      // Convert to tensors
      const xTrain = tf.tensor3d(sequences);
      const yTrain = tf.oneHot(tf.tensor1d(labels, 'int32'), 3);

      // Train model
      const history = await this.model.fit(xTrain, yTrain, {
        epochs: this.config.epochs,
        batchSize: this.config.batchSize,
        validationSplit: this.config.validationSplit,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            logger.info(`Epoch ${epoch + 1}/${this.config.epochs} - loss: ${logs.loss.toFixed(4)} - accuracy: ${logs.acc.toFixed(4)}`);
          }
        }
      });

      // Clean up tensors
      xTrain.dispose();
      yTrain.dispose();

      this.trainingHistory.push({
        timestamp: Date.now(),
        version: this.modelVersion,
        samples: sequences.length,
        finalLoss: history.history.loss[history.history.loss.length - 1],
        finalAccuracy: history.history.acc[history.history.acc.length - 1],
        valLoss: history.history.val_loss?.[history.history.val_loss.length - 1],
        valAccuracy: history.history.val_acc?.[history.history.val_acc.length - 1],
      });

      this.isTraining = false;
      logger.info('Model training completed');

      return this.trainingHistory[this.trainingHistory.length - 1];
    } catch (error) {
      this.isTraining = false;
      logger.error('Error training model:', error);
      throw error;
    }
  }

  /**
   * Make prediction for a signal
   */
  async predict(signal, marketData) {
    try {
      if (!this.model) {
        logger.warn('Model not trained yet');
        return {
          prediction: 'HOLD',
          confidence: 0,
          probabilities: { BUY: 0, HOLD: 1, SELL: 0 }
        };
      }

      // Extract features
      const features = this.extractFeatures(
        marketData.candles,
        marketData.technicalIndicators,
        marketData.fundamentalData
      );

      // Get last sequence
      const sequence = features.slice(-this.config.sequenceLength);
      
      if (sequence.length < this.config.sequenceLength) {
        logger.warn('Insufficient data for prediction');
        return {
          prediction: 'HOLD',
          confidence: 0,
          probabilities: { BUY: 0, HOLD: 1, SELL: 0 }
        };
      }

      // Make prediction
      const inputTensor = tf.tensor3d([sequence]);
      const prediction = this.model.predict(inputTensor);
      const probabilities = await prediction.data();

      // Clean up
      inputTensor.dispose();
      prediction.dispose();

      const [sellProb, holdProb, buyProb] = probabilities;

      // Determine prediction
      let predictedAction;
      let confidence;

      if (buyProb > sellProb && buyProb > holdProb) {
        predictedAction = 'BUY';
        confidence = buyProb;
      } else if (sellProb > buyProb && sellProb > holdProb) {
        predictedAction = 'SELL';
        confidence = sellProb;
      } else {
        predictedAction = 'HOLD';
        confidence = holdProb;
      }

      const result = {
        prediction: predictedAction,
        confidence: confidence,
        probabilities: {
          BUY: buyProb,
          HOLD: holdProb,
          SELL: sellProb
        },
        modelVersion: this.modelVersion,
        timestamp: Date.now()
      };

      this.predictions.push(result);

      logger.info(`AI Prediction: ${predictedAction} (confidence: ${(confidence * 100).toFixed(1)}%)`);

      return result;
    } catch (error) {
      logger.error('Error making prediction:', error);
      throw error;
    }
  }

  /**
   * Save model to disk
   */
  async saveModel(path) {
    try {
      if (!this.model) {
        throw new Error('No model to save');
      }

      await this.model.save(`file://${path}`);
      logger.info(`Model saved to ${path}`);
    } catch (error) {
      logger.error('Error saving model:', error);
      throw error;
    }
  }

  /**
   * Load model from disk
   */
  async loadModel(path) {
    try {
      this.model = await tf.loadLayersModel(`file://${path}/model.json`);
      this.modelVersion++;
      logger.info(`Model loaded from ${path}`);
    } catch (error) {
      logger.error('Error loading model:', error);
      throw error;
    }
  }

  /**
   * Get model statistics
   */
  getStats() {
    return {
      isTraining: this.isTraining,
      modelVersion: this.modelVersion,
      trainingHistory: this.trainingHistory,
      totalPredictions: this.predictions.length,
      recentPredictions: this.predictions.slice(-10),
      config: this.config
    };
  }
}

export default DeepLearningPredictor;
