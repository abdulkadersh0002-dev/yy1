import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import CircuitBreaker, {
  CircuitBreakerError,
  CircuitBreakerRegistry,
  circuitBreakerRegistry
} from '../../../src/infrastructure/services/circuit-breaker.js';

describe('Circuit Breaker', () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100 // Short timeout for testing
    });
  });

  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      assert.strictEqual(breaker.getState(), 'CLOSED');
    });

    it('should allow requests when closed', () => {
      assert.strictEqual(breaker.isAllowed(), true);
    });

    it('should have zero failure count', () => {
      const stats = breaker.getStats();
      assert.strictEqual(stats.failureCount, 0);
    });
  });

  describe('Successful Calls', () => {
    it('should execute and return result for successful calls', async () => {
      const result = await breaker.execute(async () => 'success');
      assert.strictEqual(result, 'success');
    });

    it('should track successful calls in stats', async () => {
      await breaker.execute(async () => 'ok');
      await breaker.execute(async () => 'ok');

      const stats = breaker.getStats();
      assert.strictEqual(stats.successfulCalls, 2);
      assert.strictEqual(stats.totalCalls, 2);
    });

    it('should remain closed after successful calls', async () => {
      await breaker.execute(async () => 'ok');
      await breaker.execute(async () => 'ok');

      assert.strictEqual(breaker.getState(), 'CLOSED');
    });
  });

  describe('Failed Calls', () => {
    it('should propagate errors from failed calls', async () => {
      await assert.rejects(
        async () => {
          await breaker.execute(async () => {
            throw new Error('API Error');
          });
        },
        { message: 'API Error' }
      );
    });

    it('should track failed calls in stats', async () => {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // Expected
      }

      const stats = breaker.getStats();
      assert.strictEqual(stats.failedCalls, 1);
    });

    it('should increment failure count', async () => {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // Expected
      }

      assert.strictEqual(breaker.failureCount, 1);
    });
  });

  describe('State Transitions', () => {
    it('should open circuit after reaching failure threshold', async () => {
      // Fail 3 times (threshold)
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // Expected
        }
      }

      assert.strictEqual(breaker.getState(), 'OPEN');
    });

    it('should reject calls when circuit is open', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // Expected
        }
      }

      // Next call should be rejected
      await assert.rejects(
        async () => {
          await breaker.execute(async () => 'should not run');
        },
        (err) => {
          assert.ok(err instanceof CircuitBreakerError);
          assert.strictEqual(err.state, 'OPEN');
          return true;
        }
      );
    });

    it('should track rejected calls in stats', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // Expected
        }
      }

      // Try a rejected call
      try {
        await breaker.execute(async () => 'nope');
      } catch {
        // Expected
      }

      const stats = breaker.getStats();
      assert.strictEqual(stats.rejectedCalls, 1);
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // Expected
        }
      }

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 150));

      // Should be allowed to try
      assert.strictEqual(breaker.isAllowed(), true);

      // Next call will transition to HALF_OPEN
      try {
        await breaker.execute(async () => 'test');
      } catch {
        // May fail, but state should change
      }

      // State should now be HALF_OPEN or CLOSED (if successful)
      assert.ok(['HALF_OPEN', 'CLOSED'].includes(breaker.getState()));
    });

    it('should close circuit after success threshold in HALF_OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // Expected
        }
      }

      // Wait for timeout and transition to HALF_OPEN
      await new Promise((r) => setTimeout(r, 150));

      // Successful calls in HALF_OPEN
      await breaker.execute(async () => 'ok');
      await breaker.execute(async () => 'ok');

      assert.strictEqual(breaker.getState(), 'CLOSED');
    });

    it('should re-open circuit on failure in HALF_OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // Expected
        }
      }

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 150));

      // Transition to HALF_OPEN with a call
      try {
        await breaker.execute(async () => {
          throw new Error('fail again');
        });
      } catch {
        // Expected
      }

      assert.strictEqual(breaker.getState(), 'OPEN');
    });
  });

  describe('Manual Reset', () => {
    it('should reset to closed state', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // Expected
        }
      }

      assert.strictEqual(breaker.getState(), 'OPEN');

      breaker.reset();

      assert.strictEqual(breaker.getState(), 'CLOSED');
      assert.strictEqual(breaker.failureCount, 0);
    });
  });

  describe('Callbacks', () => {
    it('should call onStateChange when state changes', async () => {
      const stateChanges = [];

      breaker = new CircuitBreaker({
        name: 'callback-test',
        failureThreshold: 2,
        onStateChange: (from, to) => {
          stateChanges.push({ from, to });
        }
      });

      // Trigger state change to OPEN
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // Expected
        }
      }

      assert.strictEqual(stateChanges.length, 1);
      assert.strictEqual(stateChanges[0].from, 'CLOSED');
      assert.strictEqual(stateChanges[0].to, 'OPEN');
    });

    it('should call onFailure when failure is recorded', async () => {
      const failures = [];

      breaker = new CircuitBreaker({
        name: 'failure-test',
        onFailure: (err) => {
          failures.push(err.message);
        }
      });

      try {
        await breaker.execute(async () => {
          throw new Error('test error');
        });
      } catch {
        // Expected
      }

      assert.strictEqual(failures.length, 1);
      assert.strictEqual(failures[0], 'test error');
    });
  });

  describe('Statistics', () => {
    it('should calculate success rate correctly', async () => {
      await breaker.execute(async () => 'ok');
      await breaker.execute(async () => 'ok');

      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // Expected
      }

      const stats = breaker.getStats();
      assert.strictEqual(stats.successRate, '66.67%');
    });

    it('should track state changes', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // Expected
        }
      }

      breaker.reset();

      const stats = breaker.getStats();
      assert.strictEqual(stats.stateChanges.length, 2);
    });

    it('should return N/A for success rate with no calls', () => {
      const stats = breaker.getStats();
      assert.strictEqual(stats.successRate, 'N/A');
    });
  });

  describe('toJSON', () => {
    it('should return stats as JSON', () => {
      const json = breaker.toJSON();
      assert.strictEqual(json.name, 'test');
      assert.strictEqual(json.state, 'CLOSED');
    });
  });
});

describe('Circuit Breaker Registry', () => {
  let registry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry();
  });

  describe('get', () => {
    it('should create new circuit breaker if not exists', () => {
      const breaker = registry.get('api');
      assert.ok(breaker instanceof CircuitBreaker);
      assert.strictEqual(breaker.name, 'api');
    });

    it('should return same instance for same name', () => {
      const breaker1 = registry.get('api');
      const breaker2 = registry.get('api');
      assert.strictEqual(breaker1, breaker2);
    });

    it('should apply custom options', () => {
      const breaker = registry.get('custom', { failureThreshold: 10 });
      assert.strictEqual(breaker.failureThreshold, 10);
    });
  });

  describe('getAll', () => {
    it('should return all circuit breakers stats', () => {
      registry.get('api1');
      registry.get('api2');

      const all = registry.getAll();
      assert.ok('api1' in all);
      assert.ok('api2' in all);
    });
  });

  describe('resetAll', () => {
    it('should reset all circuit breakers', async () => {
      const breaker = registry.get('test', { failureThreshold: 1 });

      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // Expected
      }

      assert.strictEqual(breaker.getState(), 'OPEN');

      registry.resetAll();

      assert.strictEqual(breaker.getState(), 'CLOSED');
    });
  });

  describe('getHealth', () => {
    it('should return healthy when all circuits closed', () => {
      registry.get('api1');
      registry.get('api2');

      const health = registry.getHealth();
      assert.strictEqual(health.healthy, true);
      assert.strictEqual(health.openCircuits, 0);
    });

    it('should return unhealthy when circuit is open', async () => {
      const breaker = registry.get('failing', { failureThreshold: 1 });

      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // Expected
      }

      const health = registry.getHealth();
      assert.strictEqual(health.healthy, false);
      assert.strictEqual(health.openCircuits, 1);
    });
  });
});

describe('Singleton Registry', () => {
  it('should be a CircuitBreakerRegistry instance', () => {
    assert.ok(circuitBreakerRegistry instanceof CircuitBreakerRegistry);
  });
});
