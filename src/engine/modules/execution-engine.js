export const executionEngine = {
  async executeTrade(signal) {
    if (!signal.isValid.isValid) {
      return {
        success: false,
        reason: signal.isValid.reason,
        signal
      };
    }

    try {
      const trade = {
        id: this.generateTradeId(),
        pair: signal.pair,
        direction: signal.direction,
        entryPrice: signal.entry.price,
        stopLoss: signal.entry.stopLoss,
        takeProfit: signal.entry.takeProfit,
        positionSize: signal.riskManagement.positionSize,
        riskFraction: signal.riskManagement.riskFraction,
        stressTests: signal.riskManagement.stressTests,
        guardrails: signal.riskManagement.guardrails,
        openTime: Date.now(),
        status: 'open',
        trailingStop: signal.entry.trailingStop,
        signal
      };

      this.activeTrades.set(trade.id, trade);
      this.dailyRisk += trade.riskFraction || this.config.riskPerTrade;
      this.logger?.info?.(
        {
          module: 'ExecutionEngine',
          tradeId: trade.id,
          pair: trade.pair,
          direction: trade.direction,
          entryPrice: trade.entryPrice
        },
        'Trade executed'
      );

      if (this.brokerRouter) {
        const brokerResult = await this.commitBrokerOrder(trade, signal);
        if (!brokerResult.success) {
          this.activeTrades.delete(trade.id);
          this.dailyRisk -= trade.riskFraction || this.config.riskPerTrade;
          return {
            success: false,
            reason: `Broker execution failed: ${brokerResult.error || 'unknown error'}`,
            signal
          };
        }
      }

      if (typeof this.refreshRiskCommandSnapshot === 'function') {
        this.refreshRiskCommandSnapshot();
      }

      return {
        success: true,
        trade,
        signal
      };
    } catch (error) {
      this.logger?.error?.({ module: 'ExecutionEngine', err: error }, 'Trade execution error');
      return {
        success: false,
        reason: error.message,
        signal
      };
    }
  },

  async manageActiveTrades() {
    for (const [tradeId, trade] of this.activeTrades) {
      try {
        const currentPrice = await this.getCurrentPriceForPair(trade.pair);
        const pnl = this.calculatePnL(trade, currentPrice);
        trade.currentPnL = pnl;

        if (!trade.movedToBreakeven && this.shouldMoveToBreakeven(trade, currentPrice)) {
          trade.stopLoss = trade.entryPrice;
          trade.movedToBreakeven = true;
          this.logger?.info?.(
            { module: 'ExecutionEngine', tradeId, pair: trade.pair },
            'Moved SL to breakeven'
          );
        }

        if (trade.trailingStop.enabled && this.shouldActivateTrailing(trade, currentPrice)) {
          this.updateTrailingStop(trade, currentPrice);
        }

        if (this.shouldCloseTrade(trade, currentPrice)) {
          await this.closeTrade(tradeId, currentPrice, 'target_hit');
        }
      } catch (error) {
        console.error(`Error managing trade ${tradeId}:`, error.message);
      }
    }

    if (this.brokerRouter?.runReconciliation) {
      const now = Date.now();
      if (!this.lastBrokerSync || now - this.lastBrokerSync > 60000) {
        try {
          await this.syncBrokerFills();
          this.lastBrokerSync = now;
        } catch (error) {
          this.logger?.error?.(
            { module: 'ExecutionEngine', err: error },
            'Broker reconciliation sync failed'
          );
        }
      }
    }

    if (typeof this.refreshRiskCommandSnapshot === 'function') {
      this.refreshRiskCommandSnapshot();
    }
  },

  shouldMoveToBreakeven(trade, currentPrice) {
    const distance = Math.abs(currentPrice - trade.entryPrice);
    const targetDistance = Math.abs(trade.takeProfit - trade.entryPrice);
    return distance >= targetDistance * 0.3;
  },

  shouldActivateTrailing(trade, currentPrice) {
    const profit =
      trade.direction === 'BUY' ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice;
    return profit >= trade.trailingStop.activationLevel;
  },

  updateTrailingStop(trade, currentPrice) {
    if (trade.direction === 'BUY') {
      const newStopLoss = currentPrice - trade.trailingStop.trailingDistance;
      if (newStopLoss > trade.stopLoss) {
        trade.stopLoss = newStopLoss;
        this.logger?.info?.(
          {
            module: 'ExecutionEngine',
            tradeId: trade.id,
            pair: trade.pair,
            newStopLoss: Number(newStopLoss.toFixed(5))
          },
          'Updated trailing SL'
        );
      }
    } else {
      const newStopLoss = currentPrice + trade.trailingStop.trailingDistance;
      if (newStopLoss < trade.stopLoss) {
        trade.stopLoss = newStopLoss;
        this.logger?.info?.(
          {
            module: 'ExecutionEngine',
            tradeId: trade.id,
            pair: trade.pair,
            newStopLoss: Number(newStopLoss.toFixed(5))
          },
          'Updated trailing SL'
        );
      }
    }
  },

  shouldCloseTrade(trade, currentPrice) {
    if (trade.direction === 'BUY') {
      return currentPrice <= trade.stopLoss || currentPrice >= trade.takeProfit;
    }
    return currentPrice >= trade.stopLoss || currentPrice <= trade.takeProfit;
  },

  async closeTrade(tradeId, closePrice, reason) {
    const trade = this.activeTrades.get(tradeId);
    if (!trade) {
      return;
    }

    if (this.brokerRouter && !trade.manualCloseAcknowledged) {
      const brokerResult = await this.closeBrokerPosition(trade, closePrice, reason);
      if (!brokerResult.success) {
        trade.brokerCloseError = brokerResult.error || 'Broker close failed';
      } else {
        trade.brokerCloseAcknowledged = true;
        trade.brokerCloseReceipt = brokerResult.result || brokerResult.order || null;
      }
    }

    trade.closePrice = closePrice;
    trade.closeTime = Date.now();
    trade.status = 'closed';
    trade.closeReason = reason;
    trade.finalPnL = this.calculatePnL(trade, closePrice);
    trade.duration = trade.closeTime - trade.openTime;

    this.tradingHistory.push(trade);
    this.activeTrades.delete(tradeId);

    if (typeof this.handleTradeClosed === 'function') {
      this.handleTradeClosed(trade);
    }

    this.logger?.info?.(
      {
        module: 'ExecutionEngine',
        tradeId: trade.id,
        pair: trade.pair,
        direction: trade.direction,
        pnlPercentage: trade.finalPnL?.percentage,
        reason
      },
      'Trade closed'
    );

    return trade;
  },

  calculatePnL(trade, currentPrice) {
    const priceDiff =
      trade.direction === 'BUY' ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice;

    const pips = priceDiff * 10000;
    const amount = priceDiff * trade.positionSize;
    const percentage = (priceDiff / trade.entryPrice) * 100;

    return {
      pips: pips.toFixed(1),
      amount: amount.toFixed(2),
      percentage: percentage.toFixed(2)
    };
  },

  async commitBrokerOrder(trade, signal) {
    try {
      const routing = this.config.brokerRouting || {};
      const payload = this.buildBrokerOrderPayload(trade, signal, routing);
      const result = await this.brokerRouter.placeOrder(payload);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      trade.broker = result.broker || payload.broker || routing.defaultBroker || null;
      trade.brokerOrder = result.order || null;
      trade.brokerRoute = payload.broker || routing.defaultBroker || null;
      return { success: true, order: result.order };
    } catch (error) {
      this.logger?.error?.({ module: 'ExecutionEngine', err: error }, 'Broker order commit failed');
      return { success: false, error: error.message };
    }
  },

  buildBrokerOrderPayload(trade, signal, routing) {
    const preferredBroker = signal?.brokerPreference || trade.broker || routing?.defaultBroker;
    const entryPrice = Number(trade.entryPrice) || Number(signal?.entry?.price) || null;
    return {
      broker: preferredBroker,
      pair: trade.pair,
      symbol: trade.pair,
      direction: trade.direction,
      side: trade.direction === 'BUY' ? 'buy' : 'sell',
      units: Number(trade.positionSize) || Number(signal?.riskManagement?.positionSize) || 0,
      volume: Number(trade.positionSize) || 0,
      price: entryPrice,
      takeProfit: Number(trade.takeProfit) || Number(signal?.entry?.takeProfit) || null,
      stopLoss: Number(trade.stopLoss) || Number(signal?.entry?.stopLoss) || null,
      comment: `trade:${trade.id}`,
      tradeId: trade.id,
      source: 'trading-engine',
      timeInForce: routing?.timeInForce || 'GTC'
    };
  },

  async closeBrokerPosition(trade, closePrice, reason) {
    try {
      const payload = {
        broker: trade.broker || trade.brokerRoute || null,
        symbol: trade.pair,
        tradeId: trade.id,
        ticket: trade.brokerOrder?.id || trade.brokerOrder?.ticket || null,
        price: closePrice,
        reason,
        side: trade.direction,
        units: Number(trade.positionSize) || 0,
        comment: `close:${trade.id}`
      };
      if (!payload.broker) {
        return { success: true };
      }
      return this.brokerRouter.closePosition(payload);
    } catch (error) {
      this.logger?.error?.({ module: 'ExecutionEngine', err: error }, 'Broker close failed');
      return { success: false, error: error.message };
    }
  }
};
