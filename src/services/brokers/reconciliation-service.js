class BrokerReconciliationService {
  constructor(options = {}) {
    this.brokerRouter = options.brokerRouter;
    this.tradingEngine = options.tradingEngine;
    this.logger = options.logger || console;
    this.intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 60 * 1000;
    this.timer = null;
    this.onSnapshot = options.onSnapshot || null;
  }

  start() {
    if (this.timer || !this.brokerRouter) {
      return;
    }
    this.schedule();
    this.logger?.info?.('Broker reconciliation service started');
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  schedule() {
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.runOnce();
      } catch (error) {
        this.logger?.error?.({ err: error }, 'Broker reconciliation run failed');
      }
      this.schedule();
    }, this.intervalMs);
  }

  async runOnce() {
    if (!this.brokerRouter) {
      return;
    }
    const snapshots = await this.brokerRouter.runReconciliation();
    if (typeof this.onSnapshot === 'function') {
      await this.onSnapshot(snapshots);
    }
    if (!this.tradingEngine) {
      return;
    }
    this.ingestFills(snapshots);
  }

  ingestFills(snapshots) {
    const activeTradesById = this.tradingEngine?.activeTrades || new Map();

    snapshots.forEach((snapshot) => {
      const fills = snapshot.fills || [];
      fills.forEach((fill) => {
        const tradeId = fill.clientOrderId || fill.orderID || fill.comment || null;
        if (!tradeId || !activeTradesById.has(tradeId)) {
          return;
        }
        const trade = activeTradesById.get(tradeId);
        trade.brokerFill = fill;
        trade.status = 'filled';
        trade.fillPrice = Number(
          fill.price || fill.fillPrice || fill.avgPrice || fill.priceAvg || trade.entryPrice
        );
      });
    });
  }
}

export default BrokerReconciliationService;
