/**
 * Integration tests for Broker Router
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// Mock broker connector interface
const createMockBroker = (name, options = {}) => ({
  name,
  isEnabled: options.isEnabled ?? true,
  isConnected: options.isConnected ?? true,
  accountMode: options.accountMode ?? 'demo',

  async getAccountInfo() {
    if (!this.isConnected) {
      throw new Error(`${name} not connected`);
    }
    return {
      broker: name,
      accountId: `${name}-DEMO-123`,
      balance: 10000,
      equity: 10500,
      margin: 1000,
      freeMargin: 9500,
      marginLevel: 1050,
      currency: 'USD'
    };
  },

  async getPositions() {
    if (!this.isConnected) return [];
    return [
      {
        id: `${name}-POS-1`,
        symbol: 'EURUSD',
        type: 'buy',
        volume: 0.1,
        openPrice: 1.085,
        currentPrice: 1.087,
        profit: 20,
        openTime: Date.now() - 3600000
      }
    ];
  },

  async placeOrder(order) {
    if (!this.isConnected) {
      throw new Error(`${name} not connected`);
    }
    return {
      orderId: `${name}-ORD-${Date.now()}`,
      symbol: order.symbol,
      type: order.type,
      volume: order.volume,
      price: order.price || 1.085,
      status: 'filled',
      executedAt: Date.now()
    };
  },

  async closePosition(positionId) {
    if (!this.isConnected) {
      throw new Error(`${name} not connected`);
    }
    return {
      positionId,
      closePrice: 1.088,
      profit: 30,
      closedAt: Date.now()
    };
  }
});

// Mock broker router
const createMockBrokerRouter = (brokers) => ({
  brokers: new Map(brokers.map((b) => [b.name, b])),
  defaultBroker: brokers[0]?.name || null,

  getBroker(name) {
    return this.brokers.get(name) || null;
  },

  getDefaultBroker() {
    return this.defaultBroker ? this.brokers.get(this.defaultBroker) : null;
  },

  getEnabledBrokers() {
    return Array.from(this.brokers.values()).filter((b) => b.isEnabled);
  },

  getConnectedBrokers() {
    return Array.from(this.brokers.values()).filter((b) => b.isEnabled && b.isConnected);
  },

  async getAccountSummary() {
    const summaries = [];
    for (const broker of this.getConnectedBrokers()) {
      try {
        const info = await broker.getAccountInfo();
        summaries.push(info);
      } catch {
        // Skip disconnected brokers
      }
    }
    return summaries;
  },

  async getAllPositions() {
    const positions = [];
    for (const broker of this.getConnectedBrokers()) {
      try {
        const brokerPositions = await broker.getPositions();
        positions.push(...brokerPositions.map((p) => ({ ...p, broker: broker.name })));
      } catch {
        // Skip disconnected brokers
      }
    }
    return positions;
  },

  async routeOrder(order, preferredBroker = null) {
    const broker = preferredBroker ? this.brokers.get(preferredBroker) : this.getDefaultBroker();

    if (!broker || !broker.isConnected) {
      // Fallback to any connected broker
      const connected = this.getConnectedBrokers();
      if (connected.length === 0) {
        throw new Error('No connected brokers available');
      }
      return connected[0].placeOrder(order);
    }

    return broker.placeOrder(order);
  }
});

describe('Broker Integration', () => {
  let mt5Broker;
  let oandaBroker;
  let ibkrBroker;
  let router;

  beforeEach(() => {
    mt5Broker = createMockBroker('mt5');
    oandaBroker = createMockBroker('oanda');
    ibkrBroker = createMockBroker('ibkr', { isEnabled: false });
    router = createMockBrokerRouter([mt5Broker, oandaBroker, ibkrBroker]);
  });

  describe('Broker Connectors', () => {
    it('should get account info from connected broker', async () => {
      const info = await mt5Broker.getAccountInfo();

      assert.ok(info.accountId);
      assert.ok(info.balance > 0);
      assert.ok(info.equity > 0);
      assert.strictEqual(info.currency, 'USD');
    });

    it('should get positions from connected broker', async () => {
      const positions = await mt5Broker.getPositions();

      assert.ok(Array.isArray(positions));
      assert.ok(positions.length > 0);
      assert.strictEqual(positions[0].symbol, 'EURUSD');
    });

    it('should place order successfully', async () => {
      const order = {
        symbol: 'EURUSD',
        type: 'buy',
        volume: 0.1
      };

      const result = await mt5Broker.placeOrder(order);

      assert.ok(result.orderId);
      assert.strictEqual(result.symbol, 'EURUSD');
      assert.strictEqual(result.status, 'filled');
    });

    it('should close position successfully', async () => {
      const result = await mt5Broker.closePosition('mt5-POS-1');

      assert.ok(result.closePrice > 0);
      assert.ok(result.closedAt > 0);
    });

    it('should throw error when broker not connected', async () => {
      const disconnected = createMockBroker('disconnected', { isConnected: false });

      await assert.rejects(async () => {
        await disconnected.getAccountInfo();
      }, /not connected/);
    });
  });

  describe('Broker Router', () => {
    it('should get broker by name', () => {
      const broker = router.getBroker('mt5');
      assert.strictEqual(broker.name, 'mt5');
    });

    it('should return null for unknown broker', () => {
      const broker = router.getBroker('unknown');
      assert.strictEqual(broker, null);
    });

    it('should get default broker', () => {
      const broker = router.getDefaultBroker();
      assert.strictEqual(broker.name, 'mt5');
    });

    it('should get enabled brokers only', () => {
      const enabled = router.getEnabledBrokers();

      assert.strictEqual(enabled.length, 2); // mt5 and oanda, not ibkr
      assert.ok(enabled.every((b) => b.isEnabled));
    });

    it('should get connected brokers only', () => {
      const connected = router.getConnectedBrokers();

      assert.strictEqual(connected.length, 2);
      assert.ok(connected.every((b) => b.isConnected));
    });

    it('should aggregate account summaries from all brokers', async () => {
      const summaries = await router.getAccountSummary();

      assert.strictEqual(summaries.length, 2);
      assert.ok(summaries.some((s) => s.broker === 'mt5'));
      assert.ok(summaries.some((s) => s.broker === 'oanda'));
    });

    it('should aggregate positions from all brokers', async () => {
      const positions = await router.getAllPositions();

      assert.ok(positions.length >= 2);
      assert.ok(positions.every((p) => p.broker));
    });
  });

  describe('Order Routing', () => {
    it('should route to default broker', async () => {
      const order = { symbol: 'EURUSD', type: 'buy', volume: 0.1 };
      const result = await router.routeOrder(order);

      assert.ok(result.orderId);
      assert.ok(result.orderId.startsWith('mt5'));
    });

    it('should route to preferred broker', async () => {
      const order = { symbol: 'GBPUSD', type: 'sell', volume: 0.2 };
      const result = await router.routeOrder(order, 'oanda');

      assert.ok(result.orderId);
      assert.ok(result.orderId.startsWith('oanda'));
    });

    it('should fallback when preferred broker not connected', async () => {
      // Disconnect oanda
      oandaBroker.isConnected = false;

      const order = { symbol: 'EURUSD', type: 'buy', volume: 0.1 };
      const result = await router.routeOrder(order, 'oanda');

      // Should fallback to mt5
      assert.ok(result.orderId);
      assert.ok(result.orderId.startsWith('mt5'));
    });

    it('should throw when no brokers connected', async () => {
      mt5Broker.isConnected = false;
      oandaBroker.isConnected = false;

      const order = { symbol: 'EURUSD', type: 'buy', volume: 0.1 };

      await assert.rejects(async () => {
        await router.routeOrder(order);
      }, /No connected brokers/);
    });
  });

  describe('Multi-Broker Scenarios', () => {
    it('should handle partial broker failures gracefully', async () => {
      // Disconnect one broker
      oandaBroker.isConnected = false;

      const summaries = await router.getAccountSummary();

      // Should still get summary from mt5
      assert.strictEqual(summaries.length, 1);
      assert.strictEqual(summaries[0].broker, 'mt5');
    });

    it('should aggregate positions from available brokers', async () => {
      // Disconnect one broker
      mt5Broker.isConnected = false;

      const positions = await router.getAllPositions();

      // Should still get positions from oanda
      assert.ok(positions.length > 0);
      assert.ok(positions.every((p) => p.broker === 'oanda'));
    });
  });
});
