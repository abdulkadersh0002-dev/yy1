/**
 * Trading Signal Model Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TradingSignal } from '../../../src/models/trading-signal.js';

describe('TradingSignal', () => {
  describe('Constructor', () => {
    it('should create signal with defaults', () => {
      const signal = new TradingSignal({});
      assert.equal(signal.get('direction'), 'NEUTRAL');
      assert.equal(signal.get('strength'), 0);
      assert.equal(signal.get('confidence'), 0);
    });

    it('should create signal with provided data', () => {
      const signal = new TradingSignal({
        pair: 'EURUSD',
        direction: 'BUY',
        strength: 75,
        confidence: 80,
        finalScore: 77.5
      });
      assert.equal(signal.get('pair'), 'EURUSD');
      assert.equal(signal.get('direction'), 'BUY');
      assert.equal(signal.get('strength'), 75);
      assert.equal(signal.get('confidence'), 80);
    });
  });

  describe('Business Logic', () => {
    it('should check if signal is actionable', () => {
      const signal1 = new TradingSignal({
        pair: 'EURUSD',
        direction: 'BUY',
        strength: 50,
        confidence: 70
      });
      signal1.markValid();
      assert.equal(signal1.isActionable(35), true);

      const signal2 = new TradingSignal({
        pair: 'EURUSD',
        direction: 'BUY',
        strength: 30,
        confidence: 70
      });
      signal2.markValid();
      assert.equal(signal2.isActionable(35), false);

      const signal3 = new TradingSignal({
        pair: 'EURUSD',
        direction: 'NEUTRAL',
        strength: 50,
        confidence: 70
      });
      signal3.markValid();
      assert.equal(signal3.isActionable(35), false);
    });

    it('should calculate risk-reward ratio for BUY signal', () => {
      const signal = new TradingSignal({
        pair: 'EURUSD',
        direction: 'BUY',
        entry: {
          price: 1.1,
          stopLoss: 1.095,
          takeProfit: 1.11
        }
      });
      const rrRatio = signal.getRiskRewardRatio();
      assert.ok(rrRatio !== null);
      assert.ok(rrRatio > 1.9 && rrRatio < 2.1); // Should be about 2
    });

    it('should calculate risk-reward ratio for SELL signal', () => {
      const signal = new TradingSignal({
        pair: 'EURUSD',
        direction: 'SELL',
        entry: {
          price: 1.1,
          stopLoss: 1.105,
          takeProfit: 1.09
        }
      });
      const rrRatio = signal.getRiskRewardRatio();
      assert.ok(rrRatio !== null);
      assert.ok(rrRatio > 1.9 && rrRatio < 2.1); // Should be about 2
    });

    it('should calculate quality score', () => {
      const signal = new TradingSignal({
        pair: 'EURUSD',
        direction: 'BUY',
        strength: 70,
        confidence: 80
      });
      signal.markValid();
      const quality = signal.getQualityScore();
      assert.ok(quality > 0 && quality <= 100);
      assert.ok(quality > 70); // Should be high
    });

    it('should return zero quality for invalid signal', () => {
      const signal = new TradingSignal({
        pair: 'EURUSD',
        direction: 'BUY',
        strength: 70,
        confidence: 80
      });
      signal.invalidate('Test invalidation');
      assert.equal(signal.getQualityScore(), 0);
    });

    it('should generate description', () => {
      const signal = new TradingSignal({
        pair: 'EURUSD',
        direction: 'BUY',
        strength: 75.5,
        confidence: 82.3
      });
      const desc = signal.getDescription();
      assert.ok(desc.includes('EURUSD'));
      assert.ok(desc.includes('BUY'));
      assert.ok(desc.includes('75.5'));
      assert.ok(desc.includes('82.3'));
    });

    it('should check risk management completeness', () => {
      const signal1 = new TradingSignal({
        pair: 'EURUSD',
        riskManagement: {
          positionSize: 10000,
          riskAmount: 100
        }
      });
      assert.equal(signal1.hasRiskManagement(), true);

      const signal2 = new TradingSignal({
        pair: 'EURUSD',
        riskManagement: {}
      });
      assert.equal(signal2.hasRiskManagement(), false);
    });
  });

  describe('Validation Operations', () => {
    it('should add reasoning', () => {
      const signal = new TradingSignal({ pair: 'EURUSD' });
      signal.addReasoning('Strong trend detected');
      signal.addReasoning('Momentum confirming');
      const reasoning = signal.get('reasoning');
      assert.ok(Array.isArray(reasoning));
      assert.equal(reasoning.length, 2);
      assert.equal(reasoning[0], 'Strong trend detected');
    });

    it('should invalidate signal', () => {
      const signal = new TradingSignal({ pair: 'EURUSD' });
      signal.invalidate('Insufficient data', { dataQuality: false });
      const isValid = signal.get('isValid');
      assert.equal(isValid.isValid, false);
      assert.equal(isValid.reason, 'Insufficient data');
      assert.equal(isValid.checks.dataQuality, false);
    });

    it('should mark signal as valid', () => {
      const signal = new TradingSignal({ pair: 'EURUSD' });
      signal.markValid({ strength: true, confidence: true });
      const isValid = signal.get('isValid');
      assert.equal(isValid.isValid, true);
      assert.equal(isValid.checks.strength, true);
      assert.equal(isValid.checks.confidence, true);
    });
  });
});
