import OandaConnector from './oanda-connector.js';
import Mt4Connector from './mt4-connector.js';
import Mt5Connector from './mt5-connector.js';
import IbkrConnector from './ibkr-connector.js';

class BrokerRouter {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.auditLogger = options.auditLogger || null;
    this.marketRules = options.marketRules || null;
    this.defaultBroker = options.defaultBroker || 'mt5';
    this.killSwitchEnabled = false;
    this.killSwitchReason = null;
    this.orderLog = [];
    this.auditLimit = options.auditLimit || 200;
    this.connectors = new Map();
    this.lastSyncAt = null;
    this.idempotencyTtlMs = Number.isFinite(Number(options.idempotencyTtlMs))
      ? Math.max(60 * 1000, Number(options.idempotencyTtlMs))
      : 10 * 60 * 1000;
    this.idempotencyCache = new Map();
    this.brokerBreakers = new Map();
    this.brokerRetryAttempts = Number.isFinite(Number(options.retryAttempts))
      ? Math.max(0, Number(options.retryAttempts))
      : 1;
    this.brokerRetryBaseMs = Number.isFinite(Number(options.retryBaseMs))
      ? Math.max(100, Number(options.retryBaseMs))
      : 400;
    this.brokerBreakerThreshold = Number.isFinite(Number(options.breakerThreshold))
      ? Math.max(1, Number(options.breakerThreshold))
      : 3;
    this.brokerBreakerCooldownMs = Number.isFinite(Number(options.breakerCooldownMs))
      ? Math.max(5_000, Number(options.breakerCooldownMs))
      : 60_000;

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
    const validation = this.marketRules?.validateOrder
      ? this.marketRules.validateOrder(normalized, Date.now())
      : { allowed: true, reasons: [] };
    if (!validation.allowed) {
      return { success: false, error: `Market rules blocked: ${validation.reasons.join(', ')}` };
    }
    const idempotencyKey =
      normalized?.routerMeta?.idempotencyKey || normalized?.routerMeta?.tradeId || null;
    if (idempotencyKey) {
      const cached = this.getIdempotentResult(idempotencyKey);
      if (cached) {
        return { ...cached, broker: cached.broker || connector.id, idempotentReplay: true };
      }
    }
    if (this.isBrokerBreakerActive(connector.id)) {
      return { success: false, error: `Broker ${connector.id} temporarily disabled (circuit)` };
    }

    const result = await this.retryBrokerCall(
      () => connector.placeOrder(normalized),
      connector.id,
      'placeOrder'
    );

    this.recordOrder({
      broker: connector.id,
      request: normalized,
      result,
      timestamp: new Date().toISOString()
    });

    if (idempotencyKey) {
      this.storeIdempotentResult(idempotencyKey, { ...result, broker: connector.id });
    }

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
        tradeId: request.tradeId || null,
        idempotencyKey: request.idempotencyKey || request.idempotency || null
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
    try {
      this.auditLogger?.record?.('broker.order', {
        broker: entry?.broker || null,
        type: entry?.type || 'place',
        success: Boolean(entry?.result?.success ?? entry?.result?.order ?? entry?.result?.orderId),
        tradeId: entry?.request?.routerMeta?.tradeId || null,
        idempotencyKey: entry?.request?.routerMeta?.idempotencyKey || null,
        symbol: entry?.request?.symbol || entry?.request?.pair || null,
        source: entry?.request?.routerMeta?.source || null
      });
    } catch (_error) {
      // best-effort
    }
    if (this.orderLog.length > this.auditLimit) {
      this.orderLog.splice(0, this.orderLog.length - this.auditLimit);
    }
  }

  isBrokerBreakerActive(brokerId) {
    const entry = this.brokerBreakers.get(brokerId);
    if (!entry) {
      return false;
    }
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.brokerBreakers.delete(brokerId);
      return false;
    }
    return Boolean(entry.active);
  }

  recordBrokerSuccess(brokerId) {
    const entry = this.brokerBreakers.get(brokerId);
    if (!entry) {
      return;
    }
    entry.failures = 0;
    entry.active = false;
    entry.expiresAt = 0;
    this.brokerBreakers.set(brokerId, entry);
  }

  recordBrokerFailure(brokerId) {
    const now = Date.now();
    const entry = this.brokerBreakers.get(brokerId) || {
      failures: 0,
      active: false,
      expiresAt: 0
    };
    entry.failures += 1;
    if (entry.failures >= this.brokerBreakerThreshold) {
      entry.active = true;
      entry.expiresAt = now + this.brokerBreakerCooldownMs;
      this.logger?.warn?.(
        { broker: brokerId, cooldownMs: this.brokerBreakerCooldownMs },
        'Broker circuit breaker activated'
      );
    }
    this.brokerBreakers.set(brokerId, entry);
  }

  async retryBrokerCall(fn, brokerId, label) {
    let lastError = null;
    const attempts = Math.max(1, this.brokerRetryAttempts + 1);
    for (let i = 0; i < attempts; i += 1) {
      try {
        const result = await fn();
        if (result?.success === false) {
          lastError = new Error(result?.error || `${label} failed`);
          this.recordBrokerFailure(brokerId);
        } else {
          this.recordBrokerSuccess(brokerId);
          return result;
        }
      } catch (error) {
        lastError = error;
        this.recordBrokerFailure(brokerId);
      }
      if (i < attempts - 1) {
        const delay = this.brokerRetryBaseMs * Math.pow(2, i);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    return { success: false, error: lastError?.message || `${label} failed` };
  }

  getIdempotentResult(key) {
    if (!key) {
      return null;
    }
    const entry = this.idempotencyCache.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.idempotencyCache.delete(key);
      return null;
    }
    return entry.result || null;
  }

  storeIdempotentResult(key, result) {
    if (!key) {
      return;
    }
    const expiresAt = Date.now() + this.idempotencyTtlMs;
    this.idempotencyCache.set(key, { result, expiresAt });
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
    const validation = this.marketRules?.validateOrder
      ? this.marketRules.validateOrder(normalized, Date.now())
      : { allowed: true, reasons: [] };
    if (!validation.allowed) {
      return { success: false, error: `Market rules blocked: ${validation.reasons.join(', ')}` };
    }
    const idempotencyKey =
      normalized?.routerMeta?.idempotencyKey || normalized?.routerMeta?.tradeId || null;
    if (idempotencyKey) {
      const cached = this.getIdempotentResult(idempotencyKey);
      if (cached) {
        return { ...cached, broker: cached.broker || connector.id, idempotentReplay: true };
      }
    }
    if (this.isBrokerBreakerActive(connector.id)) {
      return { success: false, error: `Broker ${connector.id} temporarily disabled (circuit)` };
    }

    const result = await this.retryBrokerCall(
      () => connector.placeOrder(normalized),
      connector.id,
      'placeOrder'
    );
    this.recordOrder({
      broker: connector.id,
      request: normalized,
      result,
      timestamp: new Date().toISOString(),
      type: 'manual'
    });
    if (idempotencyKey) {
      this.storeIdempotentResult(idempotencyKey, { ...result, broker: connector.id });
    }
    return {
      ...result,
      broker: connector.id
    };
  }
}

export default BrokerRouter;
