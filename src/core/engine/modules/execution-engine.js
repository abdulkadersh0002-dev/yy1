import { recordExecutionSlippage } from '../../../infrastructure/services/metrics.js';

export const executionEngine = {
  async executeTrade(signal) {
    const auditLogger = this.config?.auditLogger;

    if (!signal.isValid.isValid) {
      auditLogger?.record?.('execution.trade.blocked', {
        reason: signal.isValid.reason,
        pair: signal?.pair || null,
        direction: signal?.direction || null,
        source: signal?.source || null
      });
      return {
        success: false,
        reason: signal.isValid.reason,
        signal
      };
    }

    const now = Date.now();
    const expiresAt = Number(signal?.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > 0 && now > expiresAt) {
      auditLogger?.record?.('execution.trade.blocked', {
        reason: 'signal_expired',
        pair: signal?.pair || null,
        direction: signal?.direction || null,
        expiresAt
      });
      return {
        success: false,
        reason: 'Signal expired',
        signal
      };
    }

    try {
      const rules = this.marketRules || this.dependencies?.marketRules || null;
      if (rules) {
        const validation = rules.validateOrder({
          symbol: signal.pair,
          pair: signal.pair,
          volume: signal?.riskManagement?.positionSize
        });
        if (!validation.allowed) {
          auditLogger?.record?.('execution.trade.blocked', {
            reason: 'market_rules',
            pair: signal?.pair || null,
            direction: signal?.direction || null,
            details: validation.reasons
          });
          return {
            success: false,
            reason: `Market rules blocked execution: ${validation.reasons.join(', ')}`,
            signal
          };
        }
      }

      const entryPrice = Number(signal?.entry?.price);
      const takeProfit = Number(signal?.entry?.takeProfit);
      const targetDistance =
        Number.isFinite(entryPrice) && Number.isFinite(takeProfit)
          ? Math.abs(takeProfit - entryPrice)
          : null;

      const trailingStop = signal?.entry?.trailingStop || { enabled: false };
      const breakevenAtFraction = Number.isFinite(Number(trailingStop?.breakevenAtFraction))
        ? Number(trailingStop.breakevenAtFraction)
        : 0.5;
      const activationAtFraction = Number.isFinite(Number(trailingStop?.activationAtFraction))
        ? Number(trailingStop.activationAtFraction)
        : 0.6;

      const activationLevel = Number.isFinite(Number(trailingStop?.activationLevel))
        ? Number(trailingStop.activationLevel)
        : targetDistance != null
          ? targetDistance * activationAtFraction
          : null;

      const trailingDistance = Number.isFinite(Number(trailingStop?.trailingDistance))
        ? Number(trailingStop.trailingDistance)
        : null;

      const stepDistance = Number.isFinite(Number(trailingStop?.stepDistance))
        ? Number(trailingStop.stepDistance)
        : trailingDistance != null
          ? trailingDistance * 0.25
          : null;

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
        trailingStop: {
          ...trailingStop,
          breakevenAtFraction,
          activationAtFraction,
          activationLevel,
          trailingDistance,
          stepDistance
        },
        signal
      };

      this.activeTrades.set(trade.id, trade);

      if (Number.isFinite(this.config.maxRiskPerSymbol)) {
        const perSymbolRisk = Array.from(this.activeTrades.values()).reduce((sum, t) => {
          if (t?.pair === trade.pair) {
            return sum + (t.riskFraction || this.config.riskPerTrade || 0);
          }
          return sum;
        }, 0);
        if (perSymbolRisk > this.config.maxRiskPerSymbol) {
          this.activeTrades.delete(trade.id);
          auditLogger?.record?.('execution.trade.blocked', {
            reason: 'max_risk_per_symbol',
            tradeId: trade.id,
            pair: trade.pair,
            riskFraction: trade.riskFraction,
            totalRiskFraction: perSymbolRisk
          });
          return {
            success: false,
            reason: 'Max risk per symbol exceeded',
            signal
          };
        }
      }

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

      auditLogger?.record?.('execution.trade.accepted', {
        tradeId: trade.id,
        pair: trade.pair,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        riskFraction: trade.riskFraction,
        source: signal?.source || null
      });

      if (this.brokerRouter) {
        const brokerResult = await this.commitBrokerOrder(trade, signal);
        if (!brokerResult.success) {
          this.activeTrades.delete(trade.id);
          this.dailyRisk -= trade.riskFraction || this.config.riskPerTrade;
          auditLogger?.record?.('execution.trade.broker_failed', {
            tradeId: trade.id,
            pair: trade.pair,
            direction: trade.direction,
            error: brokerResult.error || 'unknown error'
          });
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
      auditLogger?.record?.('execution.trade.error', {
        reason: error?.message || 'unknown error',
        pair: signal?.pair || null,
        direction: signal?.direction || null
      });
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
        const currentPrice = await this.getCurrentPriceForPair(trade.pair, {
          broker: trade.broker || trade.brokerRoute || null
        });
        const pnl = this.calculatePnL(trade, currentPrice);
        trade.currentPnL = pnl;

        const supervision = this.evaluateSmartTradeSupervision(trade, currentPrice);
        if (supervision?.action === 'close') {
          await this.closeTrade(tradeId, currentPrice, supervision.reason);
          continue;
        }
        if (supervision?.action === 'breakeven') {
          const currentStop = Number(trade.stopLoss);
          const entryPrice = Number(trade.entryPrice);
          if (Number.isFinite(entryPrice) && (!Number.isFinite(currentStop) || currentStop !== entryPrice)) {
            trade.stopLoss = entryPrice;
            trade.movedToBreakeven = true;
            this.logger?.info?.(
              { module: 'ExecutionEngine', tradeId, pair: trade.pair, reason: supervision.reason },
              'Smart supervisor moved SL to breakeven'
            );
          }
        }

        const stopLossBefore = Number(trade.stopLoss);

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

        const stopLossAfter = Number(trade.stopLoss);
        if (
          Number.isFinite(stopLossAfter) &&
          (!Number.isFinite(stopLossBefore) || Math.abs(stopLossAfter - stopLossBefore) > 1e-10)
        ) {
          await this.syncBrokerProtection(trade, {
            reason:
              trade.movedToBreakeven && stopLossAfter === Number(trade.entryPrice)
                ? 'breakeven'
                : 'trailing'
          });
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

  emitEvent(type, payload) {
    if (typeof this.emit !== 'function') {
      return;
    }
    try {
      this.emit(type, payload);
    } catch (_error) {
      // best-effort
    }
  },


  evaluateSmartTradeSupervision(trade, currentPrice) {
    const enabled = String(process.env.SMART_TRADE_SUPERVISOR_ENABLED || '')
      .trim()
      .toLowerCase();
    if (!enabled || (enabled !== '1' && enabled !== 'true' && enabled !== 'yes' && enabled !== 'on')) {
      return null;
    }

    const pnlPct = Number.parseFloat(trade?.currentPnL?.percentage);
    const profitPct = Number.isFinite(pnlPct) ? pnlPct : 0;

    const minProfitEnv = Number(process.env.SMART_EXIT_MIN_PROFIT_PCT);
    const minProfitPct = Number.isFinite(minProfitEnv) ? minProfitEnv : 0.35;

    const newsMinutesEnv = Number(process.env.SMART_EXIT_NEWS_MINUTES);
    const newsMinutes = Number.isFinite(newsMinutesEnv) ? newsMinutesEnv : 25;

    const assetClass =
      typeof this.classifyAssetClass === 'function' ? this.classifyAssetClass(trade.pair) : null;

    const newsTelemetry =
      typeof this.computeNewsTelemetry === 'function'
        ? this.computeNewsTelemetry(trade.signal, trade.pair, assetClass, Date.now())
        : null;

    if (newsTelemetry?.nextHighImpactMinutes != null) {
      const minutes = Number(newsTelemetry.nextHighImpactMinutes);
      if (Number.isFinite(minutes) && minutes >= -newsMinutes && minutes <= newsMinutes) {
        if (profitPct >= minProfitPct) {
          return { action: 'close', reason: 'news_blackout_exit' };
        }
        return { action: 'breakeven', reason: 'news_blackout_breakeven' };
      }
    }

    const dq =
      typeof this.getLatestDataQuality === 'function'
        ? this.getLatestDataQuality(trade.pair)
        : null;
    const dqStatus = String(dq?.status || '').toLowerCase();
    const dqRecommendation = String(dq?.recommendation || '').toLowerCase();
    const dqBlocked = dq?.circuitBreaker || dqRecommendation === 'block' || dqStatus === 'critical';

    if (dqBlocked) {
      if (profitPct >= minProfitPct) {
        return { action: 'close', reason: 'data_quality_exit' };
      }
      return { action: 'breakeven', reason: 'data_quality_breakeven' };
    }

    return null;
  },
  async syncBrokerProtection(trade, { reason } = {}) {
    if (!this.brokerRouter?.modifyPosition) {
      return { success: false, skipped: true, reason: 'Broker router modify not available' };
    }

    const broker = trade.broker || trade.brokerRoute || null;
    if (!broker) {
      return { success: false, skipped: true, reason: 'No broker assigned' };
    }

    const ticket = trade.brokerOrder?.id || trade.brokerOrder?.ticket || trade.brokerTicket || null;
    if (!ticket) {
      return { success: false, skipped: true, reason: 'No broker ticket/id on trade' };
    }

    const nextStopLoss = Number(trade.stopLoss);
    const nextTakeProfit = Number(trade.takeProfit);
    if (!Number.isFinite(nextStopLoss) && !Number.isFinite(nextTakeProfit)) {
      return { success: false, skipped: true, reason: 'No SL/TP to modify' };
    }

    const now = Date.now();
    const minIntervalMs = 1500;
    if (trade.lastBrokerModifyAt && now - trade.lastBrokerModifyAt < minIntervalMs) {
      return { success: false, skipped: true, reason: 'Throttled' };
    }

    if (Number.isFinite(trade.lastBrokerStopLossSent) && Number.isFinite(nextStopLoss)) {
      if (Math.abs(Number(trade.lastBrokerStopLossSent) - nextStopLoss) <= 1e-10) {
        return { success: false, skipped: true, reason: 'SL unchanged' };
      }
    }

    const payload = {
      broker,
      ticket,
      symbol: trade.pair,
      stopLoss: Number.isFinite(nextStopLoss) ? nextStopLoss : null,
      takeProfit: Number.isFinite(nextTakeProfit) ? nextTakeProfit : null,
      tradeId: trade.id,
      comment: `modify:${trade.id}`,
      source: 'execution-engine',
      reason
    };

    const result = await this.brokerRouter.modifyPosition(payload);
    trade.lastBrokerModifyAt = now;

    if (result?.success) {
      if (Number.isFinite(nextStopLoss)) {
        trade.lastBrokerStopLossSent = nextStopLoss;
      }
      trade.brokerModifyReceipt = result.result || null;
      trade.brokerModifyError = null;
      this.emitEvent('trade_stop_modified', {
        broker,
        tradeId: trade.id,
        pair: trade.pair,
        reason: reason || null,
        stopLoss: payload.stopLoss,
        takeProfit: payload.takeProfit,
        result: result.result || null
      });
      return { success: true, result };
    }

    trade.brokerModifyError = result?.error || 'Broker modify failed';
    this.emitEvent('trade_stop_modify_failed', {
      broker,
      tradeId: trade.id,
      pair: trade.pair,
      reason: reason || null,
      stopLoss: payload.stopLoss,
      takeProfit: payload.takeProfit,
      error: trade.brokerModifyError
    });
    return { success: false, error: trade.brokerModifyError, result };
  },

  shouldMoveToBreakeven(trade, currentPrice) {
    const distance = Math.abs(currentPrice - trade.entryPrice);
    const targetDistance = Math.abs(trade.takeProfit - trade.entryPrice);
    const fraction = Number.isFinite(Number(trade?.trailingStop?.breakevenAtFraction))
      ? Number(trade.trailingStop.breakevenAtFraction)
      : 0.5;
    return distance >= targetDistance * fraction;
  },

  shouldActivateTrailing(trade, currentPrice) {
    const profit =
      trade.direction === 'BUY' ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice;

    const targetDistance = Math.abs(trade.takeProfit - trade.entryPrice);
    const activationLevel = Number.isFinite(Number(trade?.trailingStop?.activationLevel))
      ? Number(trade.trailingStop.activationLevel)
      : Number.isFinite(Number(trade?.trailingStop?.activationAtFraction))
        ? targetDistance * Number(trade.trailingStop.activationAtFraction)
        : targetDistance * 0.6;

    return profit >= activationLevel;
  },

  updateTrailingStop(trade, currentPrice) {
    const stepDistance = Number.isFinite(Number(trade?.trailingStop?.stepDistance))
      ? Number(trade.trailingStop.stepDistance)
      : null;

    if (trade.direction === 'BUY') {
      const newStopLoss = currentPrice - trade.trailingStop.trailingDistance;
      const improvement = newStopLoss - trade.stopLoss;
      if (newStopLoss > trade.stopLoss && (stepDistance == null || improvement >= stepDistance)) {
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
      const improvement = trade.stopLoss - newStopLoss;
      if (newStopLoss < trade.stopLoss && (stepDistance == null || improvement >= stepDistance)) {
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
      const startedAt = Date.now();
      const result = await this.brokerRouter.placeOrder(payload);
      const latencyMs = Date.now() - startedAt;
      if (!result.success) {
        return { success: false, error: result.error };
      }
      trade.broker = result.broker || payload.broker || routing.defaultBroker || null;
      trade.brokerOrder = result.order || null;
      trade.brokerRoute = payload.broker || routing.defaultBroker || null;

      const filled =
        Number(result.order?.fillPrice) ||
        Number(result.order?.price) ||
        Number(result.order?.avgPrice) ||
        Number(result.order?.averagePrice) ||
        Number(result.order?.executionPrice) ||
        Number(result.order?.executedPrice) ||
        null;
      const requested = Number(payload.price);
      const slippagePips =
        Number.isFinite(filled) && Number.isFinite(requested) &&
        typeof this.calculatePips === 'function'
          ? Number(this.calculatePips(trade.pair, Math.abs(filled - requested)).toFixed(3))
          : null;

      const maxSlippagePips = Number.isFinite(Number(this.config?.execution?.maxSlippagePips))
        ? Number(this.config.execution.maxSlippagePips)
        : Number.isFinite(Number(this.config?.maxSlippagePips))
          ? Number(this.config.maxSlippagePips)
          : null;
      const slippageExceeded =
        slippagePips != null && maxSlippagePips != null ? slippagePips > maxSlippagePips : false;

      trade.execution = {
        requestedPrice: Number.isFinite(requested) ? requested : null,
        filledPrice: Number.isFinite(filled) ? filled : null,
        slippagePips,
        slippageExceeded,
        latencyMs,
        broker: trade.broker,
        orderId: result.order?.id || result.order?.ticket || null
      };

      recordExecutionSlippage({
        broker: trade.broker,
        status: slippageExceeded ? 'high' : 'ok',
        slippagePips
      });

      if (slippageExceeded) {
        this.logger?.warn?.(
          {
            module: 'ExecutionEngine',
            tradeId: trade.id,
            pair: trade.pair,
            requested,
            filled,
            slippagePips,
            maxSlippagePips
          },
          'Execution slippage above threshold'
        );
      }
      return { success: true, order: result.order };
    } catch (error) {
      this.logger?.error?.({ module: 'ExecutionEngine', err: error }, 'Broker order commit failed');
      return { success: false, error: error.message };
    }
  },

  buildBrokerOrderPayload(trade, signal, routing) {
    const preferredBroker = signal?.brokerPreference || trade.broker || routing?.defaultBroker;
    const entryPrice = Number(trade.entryPrice) || Number(signal?.entry?.price) || null;
    const rules = this.marketRules || this.dependencies?.marketRules || null;
    const brokerSymbol = rules?.resolveBrokerSymbol
      ? rules.resolveBrokerSymbol(trade.pair)
      : trade.pair;
    return {
      broker: preferredBroker,
      pair: trade.pair,
      symbol: brokerSymbol,
      direction: trade.direction,
      side: trade.direction === 'BUY' ? 'buy' : 'sell',
      units: Number(trade.positionSize) || Number(signal?.riskManagement?.positionSize) || 0,
      volume: Number(trade.positionSize) || 0,
      price: entryPrice,
      takeProfit: Number(trade.takeProfit) || Number(signal?.entry?.takeProfit) || null,
      stopLoss: Number(trade.stopLoss) || Number(signal?.entry?.stopLoss) || null,
      comment: `trade:${trade.id}`,
      tradeId: trade.id,
      idempotencyKey: trade.id,
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
