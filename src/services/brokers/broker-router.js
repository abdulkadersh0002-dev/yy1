import OandaConnector from './oanda-connector.js';
import Mt4Connector from './mt4-connector.js';
import Mt5Connector from './mt5-connector.js';
import IbkrConnector from './ibkr-connector.js';

class BrokerRouter {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.defaultBroker = options.defaultBroker || 'mt5';
    this.killSwitchEnabled = false;
    this.killSwitchReason = null;
    this.orderLog = [];
    this.auditLimit = options.auditLimit || 200;
    this.connectors = new Map();
    this.lastSyncAt = null;

    this.initializeConnectors(options);
  }

  initializeConnectors(options) {
    const cfg = options || {};

    if (cfg.oanda !== false) {
      const oanda =
        cfg.oanda instanceof OandaConnector
          ? cfg.oanda
          : new OandaConnector({ ...cfg.oanda, logger: this.logger });
      this.registerConnector(oanda);
    }

    if (cfg.mt4 !== false) {
      const mt4 =
        cfg.mt4 instanceof Mt4Connector
          ? cfg.mt4
          : new Mt4Connector({ ...cfg.mt4, logger: this.logger });
      this.registerConnector(mt4);
    }

    if (cfg.mt5 !== false) {
      const mt5 =
        cfg.mt5 instanceof Mt5Connector
          ? cfg.mt5
          : new Mt5Connector({ ...cfg.mt5, logger: this.logger });
      this.registerConnector(mt5);
    }

    if (cfg.ibkr !== false) {
      const ibkr =
        cfg.ibkr instanceof IbkrConnector
          ? cfg.ibkr
          : new IbkrConnector({ ...cfg.ibkr, logger: this.logger });
      this.registerConnector(ibkr);
    }
  }

  registerConnector(connector) {
    if (!connector?.id) {
      return;
    }
    this.connectors.set(connector.id, connector);
  }

  getConnector(name) {
    if (!name) {
      return this.connectors.get(this.defaultBroker) || null;
    }
    return this.connectors.get(name) || null;
  }

  setKillSwitch(enabled, reason) {
    this.killSwitchEnabled = Boolean(enabled);
    this.killSwitchReason = enabled ? reason || 'Manual kill switch engaged' : null;
    if (this.killSwitchEnabled) {
      this.logger?.warn?.({ reason: this.killSwitchReason }, 'BrokerRouter kill switch engaged');
    } else {
      this.logger?.info?.('BrokerRouter kill switch disengaged');
    }
    return {
      enabled: this.killSwitchEnabled,
      reason: this.killSwitchReason
    };
  }

  getStatus() {
    return {
      killSwitchEnabled: this.killSwitchEnabled,
      killSwitchReason: this.killSwitchReason,
      connectors: this.listConnectorIds(),
      defaultBroker: this.defaultBroker,
      lastSyncAt: this.lastSyncAt,
      recentOrders: this.orderLog.slice(-10)
    };
  }

  listConnectorIds() {
    return Array.from(this.connectors.keys());
  }

  listConnectors() {
    return Array.from(this.connectors.values());
  }

  async probeConnector(name, options = {}) {
    if (!name) {
      const error = new Error('Connector id is required');
      error.code = 'INVALID_CONNECTOR_ID';
      throw error;
    }

    const connector = this.getConnector(name);
    if (!connector) {
      const error = new Error(`Unknown broker connector: ${name}`);
      error.code = 'UNKNOWN_CONNECTOR';
      throw error;
    }

    const action = (options.action || 'probe').toLowerCase();
    const params = options.params || {};

    try {
      if (action === 'connect' && typeof connector.connect === 'function') {
        await connector.connect(params);
      } else if (action === 'disconnect' && typeof connector.disconnect === 'function') {
        await connector.disconnect(params);
      } else if (action === 'restart' && typeof connector.restart === 'function') {
        await connector.restart(params);
      } else if (action !== 'probe') {
        const error = new Error(`Unsupported broker connector action: ${action}`);
        error.code = 'UNSUPPORTED_ACTION';
        throw error;
      }
    } catch (error) {
      this.logger?.warn?.(
        { err: error, broker: connector.id, action },
        'Broker connector action failed'
      );
      error.code = error.code || 'CONNECTOR_ACTION_FAILED';
      throw error;
    }

    const health = await connector.healthCheck();
    if (health?.connected) {
      this.lastSyncAt = new Date().toISOString();
    }

    return {
      broker: connector.id,
      action,
      health
    };
  }

  async getHealthSnapshots() {
    const snapshots = await Promise.all(
      this.listConnectors().map(async (connector) => {
        try {
          const health = await connector.healthCheck();
          return health;
        } catch (error) {
          this.logger?.warn?.({ err: error, broker: connector.id }, 'Broker health check failed');
          return {
            broker: connector.id,
            connected: false,
            error: error.message
          };
        }
      })
    );
    return snapshots;
  }

  async placeOrder(request) {
    if (this.killSwitchEnabled) {
      return {
        success: false,
        error: `Kill switch engaged${this.killSwitchReason ? `: ${this.killSwitchReason}` : ''}`
      };
    }

    const connector = this.getConnector(request.broker || this.defaultBroker);
    if (!connector) {
      return { success: false, error: `Unknown broker: ${request.broker || this.defaultBroker}` };
    }

    const normalized = this.normalizeOrderRequest(request);
    const result = await connector.placeOrder(normalized);

    this.recordOrder({
      broker: connector.id,
      request: normalized,
      result,
      timestamp: new Date().toISOString()
    });

    return {
      ...result,
      broker: connector.id
    };
  }

  async closePosition(request) {
    const connector = this.getConnector(request.broker || this.defaultBroker);
    if (!connector) {
      return { success: false, error: `Unknown broker: ${request.broker || this.defaultBroker}` };
    }
    const result = await connector.closePosition(request);
    this.recordOrder({
      broker: connector.id,
      request,
      result,
      timestamp: new Date().toISOString(),
      type: 'close'
    });
    return {
      ...result,
      broker: connector.id
    };
  }

  async modifyPosition(request = {}) {
    if (this.killSwitchEnabled) {
      return {
        success: false,
        error: `Kill switch engaged${this.killSwitchReason ? `: ${this.killSwitchReason}` : ''}`
      };
    }

    const connector = this.getConnector(request.broker || this.defaultBroker);
    if (!connector) {
      return { success: false, error: `Unknown broker: ${request.broker || this.defaultBroker}` };
    }

    const normalized = this.normalizeModifyRequest(request);

    if (typeof connector.modifyPosition !== 'function') {
      return {
        success: false,
        error: `Broker ${connector.id} does not support position modification`
      };
    }

    const result = await connector.modifyPosition(normalized);

    this.recordOrder({
      broker: connector.id,
      request: normalized,
      result,
      timestamp: new Date().toISOString(),
      type: 'modify'
    });

    return {
      ...result,
      broker: connector.id
    };
  }

  normalizeOrderRequest(request = {}) {
    const side = request.side || (request.direction === 'SELL' ? 'sell' : 'buy');
    const volume = Number(request.volume || request.units || request.quantity || 0);
    return {
      symbol: request.symbol || request.pair,
      type: request.type || 'MARKET',
      side,
      units: volume,
      volume,
      quantity: volume,
      takeProfit: request.takeProfit || null,
      stopLoss: request.stopLoss || null,
      timeInForce: request.timeInForce || 'GTC',
      comment: request.comment || 'auto-trade',
      accountNumber: request.accountNumber || null,
      routerMeta: {
        source: request.source || 'trading-engine',
        tradeId: request.tradeId || null
      }
    };
  }

  normalizeModifyRequest(request = {}) {
    const stopLoss = request.stopLoss ?? request.sl ?? null;
    const takeProfit = request.takeProfit ?? request.tp ?? null;

    return {
      broker: request.broker || this.defaultBroker,
      ticket: request.ticket || request.id || request.positionId || null,
      symbol: request.symbol || request.pair || null,
      stopLoss: stopLoss != null ? Number(stopLoss) : null,
      takeProfit: takeProfit != null ? Number(takeProfit) : null,
      accountNumber: request.accountNumber || null,
      comment: request.comment || 'modify',
      routerMeta: {
        source: request.source || 'trading-engine',
        tradeId: request.tradeId || null,
        reason: request.reason || null
      }
    };
  }

  recordOrder(entry) {
    this.orderLog.push(entry);
    if (this.orderLog.length > this.auditLimit) {
      this.orderLog.splice(0, this.orderLog.length - this.auditLimit);
    }
  }

  async runReconciliation() {
    const snapshots = [];

    for (const connector of this.connectors.values()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const [positions, fills, account] = await Promise.all([
          connector.fetchOpenPositions(),
          connector.fetchRecentFills(),
          connector.fetchAccountSummary()
        ]);
        snapshots.push({
          broker: connector.id,
          positions,
          fills,
          account
        });
      } catch (error) {
        this.logger?.warn?.(
          { err: error, broker: connector.id },
          'Broker reconciliation snapshot failed'
        );
        snapshots.push({
          broker: connector.id,
          positions: [],
          fills: [],
          account: null,
          error: error.message
        });
      }
    }

    this.lastSyncAt = new Date().toISOString();
    return snapshots;
  }

  async manualOrder(request) {
    const { bypassKillSwitch } = request;
    if (this.killSwitchEnabled && !bypassKillSwitch) {
      return {
        success: false,
        error: `Kill switch engaged${this.killSwitchReason ? `: ${this.killSwitchReason}` : ''}`
      };
    }
    const connector = this.getConnector(request.broker || this.defaultBroker);
    if (!connector) {
      return { success: false, error: `Unknown broker: ${request.broker || this.defaultBroker}` };
    }
    const normalized = this.normalizeOrderRequest(request);
    const result = await connector.placeOrder(normalized);
    this.recordOrder({
      broker: connector.id,
      request: normalized,
      result,
      timestamp: new Date().toISOString(),
      type: 'manual'
    });
    return {
      ...result,
      broker: connector.id
    };
  }
}

export default BrokerRouter;
