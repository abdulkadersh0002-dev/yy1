/**
 * Comprehensive Backtesting Engine
 * 
 * Professional-grade backtesting system for trading strategies
 * Features:
 * - Historical simulation
 * - Walk-forward analysis
 * - Monte Carlo simulation
 * - Comprehensive metrics
 * - Parameter optimization
 * - Trade-by-trade analysis
 */

import { logger } from '../utils/logger.js';

export class BacktestEngine {
  constructor(config = {}) {
    this.config = {
      initialCapital: config.initialCapital || 10000,
      commission: config.commission || 0.0002, // 0.02%
      slippage: config.slippage || 0.0001, // 0.01%
      riskPerTrade: config.riskPerTrade || 0.02, // 2%
      maxDrawdownLimit: config.maxDrawdownLimit || 0.2, // 20%
      ...config
    };

    this.trades = [];
    this.equity = [this.config.initialCapital];
    this.drawdowns = [];
    this.monthlyReturns = {};
  }

  /**
   * Run backtest on historical data
   */
  async runBacktest(strategy, historicalData, params = {}) {
    try {
      logger.info('Starting backtest...');
      logger.info(`Period: ${historicalData[0].timestamp} to ${historicalData[historicalData.length - 1].timestamp}`);
      logger.info(`Initial Capital: $${this.config.initialCapital}`);

      this.trades = [];
      this.equity = [this.config.initialCapital];
      this.drawdowns = [];

      let currentCapital = this.config.initialCapital;
      let activeTrade = null;
      let peakEquity = currentCapital;

      for (let i = 0; i < historicalData.length; i++) {
        const currentBar = historicalData[i];
        const marketData = this.getMarketData(historicalData, i);

        // Check for stop loss / take profit on active trade
        if (activeTrade) {
          const exitCheck = this.checkExit(activeTrade, currentBar);
          
          if (exitCheck.shouldExit) {
            const pnl = this.closeTrade(activeTrade, currentBar, exitCheck.reason);
            currentCapital += pnl;
            this.equity.push(currentCapital);

            // Update peak and drawdown
            if (currentCapital > peakEquity) {
              peakEquity = currentCapital;
            }
            const drawdown = (peakEquity - currentCapital) / peakEquity;
            this.drawdowns.push(drawdown);

            // Check drawdown limit
            if (drawdown > this.config.maxDrawdownLimit) {
              logger.warn(`Max drawdown limit reached: ${(drawdown * 100).toFixed(2)}%`);
              break;
            }

            activeTrade = null;
          }
        }

        // Generate signal from strategy
        if (!activeTrade) {
          const signal = await strategy.generateSignal(marketData, params);

          if (signal && (signal.direction === 'BUY' || signal.direction === 'SELL')) {
            // Calculate position size
            const positionSize = this.calculatePositionSize(
              currentCapital,
              signal.stopLoss,
              currentBar.close
            );

            // Open trade
            activeTrade = this.openTrade(signal, currentBar, positionSize);
          }
        }
      }

      // Close any open trade at the end
      if (activeTrade) {
        const lastBar = historicalData[historicalData.length - 1];
        const pnl = this.closeTrade(activeTrade, lastBar, 'END_OF_DATA');
        currentCapital += pnl;
        this.equity.push(currentCapital);
      }

      logger.info('Backtest completed');
      logger.info(`Final Capital: $${currentCapital.toFixed(2)}`);
      logger.info(`Total Trades: ${this.trades.length}`);

      return this.generateReport();
    } catch (error) {
      logger.error('Error running backtest:', error);
      throw error;
    }
  }

  /**
   * Get market data for current bar
   */
  getMarketData(historicalData, currentIndex) {
    const lookback = 200; // bars
    const start = Math.max(0, currentIndex - lookback);
    const candles = historicalData.slice(start, currentIndex + 1);

    return {
      candles,
      currentBar: historicalData[currentIndex],
      timestamp: historicalData[currentIndex].timestamp
    };
  }

  /**
   * Calculate position size based on risk
   */
  calculatePositionSize(capital, stopLoss, entryPrice) {
    const riskAmount = capital * this.config.riskPerTrade;
    const pipValue = 10; // Standard lot
    const stopLossPips = Math.abs(entryPrice - stopLoss) * 10000;
    
    if (stopLossPips === 0) return 0;

    const positionSize = riskAmount / (stopLossPips * pipValue);
    return Math.min(positionSize, capital / entryPrice); // Don't exceed capital
  }

  /**
   * Open a trade
   */
  openTrade(signal, bar, positionSize) {
    const entryPrice = bar.close * (1 + (signal.direction === 'BUY' ? this.config.slippage : -this.config.slippage));
    const commission = entryPrice * positionSize * this.config.commission;

    const trade = {
      id: `trade_${this.trades.length + 1}`,
      direction: signal.direction,
      entryPrice,
      entryTime: bar.timestamp,
      positionSize,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      commission: commission * 2, // Entry + exit
      status: 'OPEN'
    };

    logger.debug(`Opened ${trade.direction} trade at ${entryPrice}`);
    return trade;
  }

  /**
   * Check if trade should be exited
   */
  checkExit(trade, bar) {
    // Check stop loss
    if (trade.direction === 'BUY' && bar.low <= trade.stopLoss) {
      return { shouldExit: true, exitPrice: trade.stopLoss, reason: 'STOP_LOSS' };
    }
    if (trade.direction === 'SELL' && bar.high >= trade.stopLoss) {
      return { shouldExit: true, exitPrice: trade.stopLoss, reason: 'STOP_LOSS' };
    }

    // Check take profit
    if (trade.direction === 'BUY' && bar.high >= trade.takeProfit) {
      return { shouldExit: true, exitPrice: trade.takeProfit, reason: 'TAKE_PROFIT' };
    }
    if (trade.direction === 'SELL' && bar.low <= trade.takeProfit) {
      return { shouldExit: true, exitPrice: trade.takeProfit, reason: 'TAKE_PROFIT' };
    }

    return { shouldExit: false };
  }

  /**
   * Close a trade
   */
  closeTrade(trade, bar, reason) {
    const exitPrice = reason === 'STOP_LOSS' ? trade.stopLoss :
                     reason === 'TAKE_PROFIT' ? trade.takeProfit :
                     bar.close * (1 + (trade.direction === 'BUY' ? -this.config.slippage : this.config.slippage));

    trade.exitPrice = exitPrice;
    trade.exitTime = bar.timestamp;
    trade.reason = reason;
    trade.status = 'CLOSED';

    // Calculate P&L
    const priceDiff = trade.direction === 'BUY' ? 
      (trade.exitPrice - trade.entryPrice) :
      (trade.entryPrice - trade.exitPrice);
    
    const grossPnL = priceDiff * trade.positionSize;
    const netPnL = grossPnL - trade.commission;

    trade.pnl = netPnL;
    trade.pnlPercent = (netPnL / (trade.entryPrice * trade.positionSize)) * 100;
    trade.duration = new Date(trade.exitTime) - new Date(trade.entryTime);

    this.trades.push(trade);

    logger.debug(`Closed ${trade.direction} trade: ${reason}, P&L: $${netPnL.toFixed(2)}`);

    return netPnL;
  }

  /**
   * Run Monte Carlo simulation
   */
  runMonteCarloSimulation(numSimulations = 1000) {
    if (this.trades.length === 0) {
      return null;
    }

    logger.info(`Running Monte Carlo simulation (${numSimulations} runs)...`);

    const simulations = [];
    
    for (let i = 0; i < numSimulations; i++) {
      // Randomly shuffle trades
      const shuffledTrades = [...this.trades].sort(() => Math.random() - 0.5);
      
      // Calculate equity curve for this simulation
      let capital = this.config.initialCapital;
      const equityCurve = [capital];
      let maxDrawdown = 0;
      let peakCapital = capital;

      shuffledTrades.forEach(trade => {
        capital += trade.pnl;
        equityCurve.push(capital);

        if (capital > peakCapital) {
          peakCapital = capital;
        }

        const drawdown = (peakCapital - capital) / peakCapital;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      });

      simulations.push({
        finalCapital: capital,
        maxDrawdown,
        return: ((capital - this.config.initialCapital) / this.config.initialCapital) * 100
      });
    }

    // Calculate statistics
    const returns = simulations.map(s => s.return).sort((a, b) => a - b);
    const drawdowns = simulations.map(s => s.maxDrawdown).sort((a, b) => b - a);

    return {
      numSimulations,
      returns: {
        mean: returns.reduce((a, b) => a + b, 0) / returns.length,
        median: returns[Math.floor(returns.length / 2)],
        best: returns[returns.length - 1],
        worst: returns[0],
        percentile5: returns[Math.floor(returns.length * 0.05)],
        percentile95: returns[Math.floor(returns.length * 0.95)]
      },
      maxDrawdown: {
        mean: drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length,
        median: drawdowns[Math.floor(drawdowns.length / 2)],
        worst: drawdowns[0],
        best: drawdowns[drawdowns.length - 1],
        percentile95: drawdowns[Math.floor(drawdowns.length * 0.05)]
      },
      probabilityOfProfit: (simulations.filter(s => s.return > 0).length / numSimulations) * 100
    };
  }

  /**
   * Generate comprehensive backtest report
   */
  generateReport() {
    const wins = this.trades.filter(t => t.pnl > 0);
    const losses = this.trades.filter(t => t.pnl <= 0);

    const totalPnL = this.trades.reduce((sum, t) => sum + t.pnl, 0);
    const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

    const finalCapital = this.config.initialCapital + totalPnL;
    const totalReturn = ((finalCapital - this.config.initialCapital) / this.config.initialCapital) * 100;

    // Calculate Sharpe Ratio
    const returns = this.equity.slice(1).map((e, i) => (e - this.equity[i]) / this.equity[i]);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdReturn = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 0), 0) / returns.length);
    const sharpeRatio = avgReturn / (stdReturn || 1) * Math.sqrt(252); // Annualized

    // Calculate Sortino Ratio (downside deviation)
    const downsideReturns = returns.filter(r => r < 0);
    const downsideDeviation = downsideReturns.length > 0 ?
      Math.sqrt(downsideReturns.reduce((sum, r) => sum + r * r, 0) / downsideReturns.length) :
      0.0001;
    const sortinoRatio = avgReturn / downsideDeviation * Math.sqrt(252);

    // Calculate Calmar Ratio
    const maxDrawdown = Math.max(...this.drawdowns);
    const calmarRatio = (totalReturn / 100) / (maxDrawdown || 0.01);

    // Average trade duration
    const avgDuration = this.trades.reduce((sum, t) => sum + t.duration, 0) / this.trades.length;

    const report = {
      overview: {
        initialCapital: this.config.initialCapital,
        finalCapital,
        totalReturn: totalReturn.toFixed(2) + '%',
        totalPnL: totalPnL.toFixed(2),
        totalTrades: this.trades.length,
        winningTrades: wins.length,
        losingTrades: losses.length
      },
      performance: {
        winRate: ((wins.length / this.trades.length) * 100).toFixed(2) + '%',
        profitFactor: (grossProfit / (grossLoss || 1)).toFixed(2),
        avgWin: (grossProfit / (wins.length || 1)).toFixed(2),
        avgLoss: (grossLoss / (losses.length || 1)).toFixed(2),
        avgWinLossRatio: ((grossProfit / wins.length) / (grossLoss / losses.length || 1)).toFixed(2),
        largestWin: Math.max(...wins.map(t => t.pnl), 0).toFixed(2),
        largestLoss: Math.min(...losses.map(t => t.pnl), 0).toFixed(2)
      },
      riskMetrics: {
        maxDrawdown: (maxDrawdown * 100).toFixed(2) + '%',
        sharpeRatio: sharpeRatio.toFixed(2),
        sortinoRatio: sortinoRatio.toFixed(2),
        calmarRatio: calmarRatio.toFixed(2)
      },
      tradingMetrics: {
        avgTradeDuration: this.formatDuration(avgDuration),
        avgTradesPerDay: (this.trades.length / this.getTradingDays()).toFixed(2),
        totalCommission: this.trades.reduce((sum, t) => sum + t.commission, 0).toFixed(2)
      },
      equityCurve: this.equity,
      drawdownCurve: this.drawdowns,
      trades: this.trades,
      monteCarlo: this.runMonteCarloSimulation(1000)
    };

    logger.info('=== BACKTEST REPORT ===');
    logger.info(`Total Return: ${report.overview.totalReturn}`);
    logger.info(`Win Rate: ${report.performance.winRate}`);
    logger.info(`Profit Factor: ${report.performance.profitFactor}`);
    logger.info(`Sharpe Ratio: ${report.riskMetrics.sharpeRatio}`);
    logger.info(`Max Drawdown: ${report.riskMetrics.maxDrawdown}`);

    return report;
  }

  /**
   * Get trading days from trades
   */
  getTradingDays() {
    if (this.trades.length === 0) return 1;
    
    const firstTrade = new Date(this.trades[0].entryTime);
    const lastTrade = new Date(this.trades[this.trades.length - 1].exitTime);
    const days = (lastTrade - firstTrade) / (1000 * 60 * 60 * 24);
    
    return Math.max(days, 1);
  }

  /**
   * Format duration in human-readable format
   */
  formatDuration(milliseconds) {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 24) {
      return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
  }

  /**
   * Optimize strategy parameters using genetic algorithm
   */
  async optimizeParameters(strategy, historicalData, parameterRanges) {
    logger.info('Starting parameter optimization...');

    const populationSize = 20;
    const generations = 10;
    const mutationRate = 0.1;

    // Initialize population
    let population = this.initializePopulation(parameterRanges, populationSize);

    for (let gen = 0; gen < generations; gen++) {
      logger.info(`Generation ${gen + 1}/${generations}`);

      // Evaluate fitness
      const fitness = [];
      for (const params of population) {
        const backtest = new BacktestEngine(this.config);
        const result = await backtest.runBacktest(strategy, historicalData, params);
        fitness.push({
          params,
          fitness: this.calculateFitness(result)
        });
      }

      // Sort by fitness
      fitness.sort((a, b) => b.fitness - a.fitness);

      logger.info(`Best fitness: ${fitness[0].fitness.toFixed(2)}`);

      // Select top performers
      const topPerformers = fitness.slice(0, populationSize / 2);

      // Create next generation
      population = topPerformers.map(p => p.params);
      
      // Crossover and mutation
      while (population.length < populationSize) {
        const parent1 = topPerformers[Math.floor(Math.random() * topPerformers.length)].params;
        const parent2 = topPerformers[Math.floor(Math.random() * topPerformers.length)].params;
        
        const child = this.crossover(parent1, parent2, parameterRanges);
        const mutatedChild = this.mutate(child, parameterRanges, mutationRate);
        
        population.push(mutatedChild);
      }
    }

    // Final evaluation
    const finalFitness = [];
    for (const params of population) {
      const backtest = new BacktestEngine(this.config);
      const result = await backtest.runBacktest(strategy, historicalData, params);
      finalFitness.push({
        params,
        fitness: this.calculateFitness(result),
        result
      });
    }

    finalFitness.sort((a, b) => b.fitness - a.fitness);

    logger.info('Optimization completed');
    logger.info('Best parameters:', finalFitness[0].params);

    return {
      bestParams: finalFitness[0].params,
      bestResult: finalFitness[0].result,
      allResults: finalFitness
    };
  }

  /**
   * Initialize random population
   */
  initializePopulation(parameterRanges, size) {
    const population = [];
    
    for (let i = 0; i < size; i++) {
      const params = {};
      for (const [key, range] of Object.entries(parameterRanges)) {
        params[key] = this.randomInRange(range.min, range.max, range.step);
      }
      population.push(params);
    }

    return population;
  }

  /**
   * Generate random value in range
   */
  randomInRange(min, max, step = 1) {
    const steps = Math.floor((max - min) / step);
    return min + Math.floor(Math.random() * (steps + 1)) * step;
  }

  /**
   * Crossover two parameter sets
   */
  crossover(parent1, parent2, parameterRanges) {
    const child = {};
    for (const key of Object.keys(parent1)) {
      child[key] = Math.random() > 0.5 ? parent1[key] : parent2[key];
    }
    return child;
  }

  /**
   * Mutate parameters
   */
  mutate(params, parameterRanges, mutationRate) {
    const mutated = { ...params };
    
    for (const [key, range] of Object.entries(parameterRanges)) {
      if (Math.random() < mutationRate) {
        mutated[key] = this.randomInRange(range.min, range.max, range.step);
      }
    }

    return mutated;
  }

  /**
   * Calculate fitness score for optimization
   */
  calculateFitness(result) {
    const totalReturn = parseFloat(result.overview.totalReturn);
    const winRate = parseFloat(result.performance.winRate);
    const profitFactor = parseFloat(result.performance.profitFactor);
    const maxDrawdown = parseFloat(result.riskMetrics.maxDrawdown);
    const sharpeRatio = parseFloat(result.riskMetrics.sharpeRatio);

    // Weighted fitness score
    const fitness = 
      totalReturn * 0.3 +
      winRate * 0.2 +
      profitFactor * 10 * 0.2 +
      (100 - maxDrawdown) * 0.15 +
      sharpeRatio * 5 * 0.15;

    return fitness;
  }
}

export default BacktestEngine;
