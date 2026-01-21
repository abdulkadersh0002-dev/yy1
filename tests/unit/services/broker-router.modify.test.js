/**
 * Unit tests for BrokerRouter.modifyPosition normalization + kill switch.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import BrokerRouter from '../../../src/services/brokers/broker-router.js';

const createRouterWithConnector = (connector) => {
  const router = new BrokerRouter({
    logger: console,
    // Avoid initializing real connectors in unit tests.
    mt4: false,
    mt5: false,
    oanda: false,
    ibkr: false,
    defaultBroker: connector.id
  });

  router.registerConnector(connector);
  return router;
};

describe('BrokerRouter.modifyPosition', () => {
  it('normalizes common aliases (id/ticket, pair/symbol, sl/tp) and calls connector', async () => {
    const calls = [];
    const connector = {
      id: 'mt5',
      async modifyPosition(payload) {
        calls.push(payload);
        return { success: true, result: { ok: true } };
      }
    };

    const router = createRouterWithConnector(connector);

    const result = await router.modifyPosition({
      broker: 'mt5',
      id: '12345',
      pair: 'EURUSD',
      sl: '1.2345',
      tp: 1.3456,
      source: 'execution-engine',
      tradeId: 'T-1',
      reason: 'trailing_stop'
    });

    assert.equal(result.success, true);
    assert.equal(result.broker, 'mt5');
    assert.equal(calls.length, 1);

    assert.deepEqual(calls[0], {
      broker: 'mt5',
      ticket: '12345',
      symbol: 'EURUSD',
      stopLoss: 1.2345,
      takeProfit: 1.3456,
      accountNumber: null,
      comment: 'modify',
      routerMeta: {
        source: 'execution-engine',
        tradeId: 'T-1',
        reason: 'trailing_stop'
      }
    });
  });

  it('rejects modifications when kill switch is engaged', async () => {
    const connector = {
      id: 'mt5',
      async modifyPosition() {
        throw new Error('should not be called');
      }
    };

    const router = createRouterWithConnector(connector);
    router.setKillSwitch(true, 'maintenance');

    const result = await router.modifyPosition({
      broker: 'mt5',
      ticket: '999',
      symbol: 'EURUSD',
      stopLoss: 1.2
    });

    assert.equal(result.success, false);
    assert.match(result.error, /Kill switch engaged/);
    assert.match(result.error, /maintenance/);
  });
});
