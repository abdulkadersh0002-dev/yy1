/**
 * Enhanced Circuit Breaker
 * Prevents cascading failures by breaking circuits to failing services
 */

import logger from '../services/logging/logger.js';

class EnhancedCircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'circuit-breaker';
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.recoveryTimeout = options.recoveryTimeout || 60000; // 1 minute
    this.monitoringPeriod = options.monitoringPeriod || 10000; // 10 seconds
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0,
      stateChanges: 0
    };

    this.logger = options.logger || logger;
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute(fn, fallback = null) {
    this.stats.totalRequests++;

    // Check if circuit is OPEN
    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      
      if (timeSinceFailure > this.recoveryTimeout) {
        this.transitionTo('HALF_OPEN');
      } else {
        this.stats.rejectedRequests++;
        this.logger.warn({
          circuitBreaker: this.name,
          state: this.state,
          reason: 'Circuit breaker OPEN'
        }, 'Request rejected by circuit breaker');
        
        if (fallback) {
          return fallback();
        }
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      
      if (fallback) {
        return fallback();
      }
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  onSuccess() {
    this.stats.successfulRequests++;
    this.failures = 0;

    if (this.state === 'HALF_OPEN') {
      this.successes++;
      
      if (this.successes >= this.successThreshold) {
        this.transitionTo('CLOSED');
        this.successes = 0;
      }
    }
  }

  /**
   * Handle failed execution
   */
  onFailure(error) {
    this.stats.failedRequests++;
    this.failures++;
    this.lastFailureTime = Date.now();
    this.successes = 0;

    this.logger.warn({
      circuitBreaker: this.name,
      state: this.state,
      failures: this.failures,
      threshold: this.failureThreshold,
      error: error.message
    }, 'Circuit breaker failure recorded');

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
    } else if (this.failures >= this.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  /**
   * Transition to a new state
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    this.stats.stateChanges++;

    this.logger.info({
      circuitBreaker: this.name,
      oldState,
      newState,
      failures: this.failures,
      timestamp: new Date().toISOString()
    }, 'Circuit breaker state changed');

    // Reset counters on state change
    if (newState === 'CLOSED') {
      this.failures = 0;
      this.successes = 0;
    }
  }

  /**
   * Get current circuit breaker status
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      stats: {
        ...this.stats,
        successRate: this.stats.totalRequests > 0
          ? ((this.stats.successfulRequests / this.stats.totalRequests) * 100).toFixed(2)
          : 0,
        rejectionRate: this.stats.totalRequests > 0
          ? ((this.stats.rejectedRequests / this.stats.totalRequests) * 100).toFixed(2)
          : 0
      }
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset() {
    this.transitionTo('CLOSED');
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    
    this.logger.info({
      circuitBreaker: this.name
    }, 'Circuit breaker manually reset');
  }

  /**
   * Check if circuit breaker is healthy
   */
  isHealthy() {
    return this.state !== 'OPEN';
  }
}

/**
 * Circuit Breaker Manager
 * Manages multiple circuit breakers
 */
class CircuitBreakerManager {
  constructor() {
    this.breakers = new Map();
  }

  /**
   * Get or create a circuit breaker
   */
  getBreaker(name, options = {}) {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new EnhancedCircuitBreaker({
        ...options,
        name
      }));
    }
    return this.breakers.get(name);
  }

  /**
   * Execute function with circuit breaker
   */
  async execute(name, fn, options = {}) {
    const breaker = this.getBreaker(name, options);
    return breaker.execute(fn, options.fallback);
  }

  /**
   * Get status of all circuit breakers
   */
  getAllStatus() {
    const status = {};
    for (const [name, breaker] of this.breakers) {
      status[name] = breaker.getStatus();
    }
    return status;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Get health status
   */
  getHealth() {
    const breakers = Array.from(this.breakers.values());
    const healthy = breakers.filter((b) => b.isHealthy()).length;
    const total = breakers.length;

    return {
      healthy,
      total,
      unhealthy: total - healthy,
      percentage: total > 0 ? ((healthy / total) * 100).toFixed(2) : 100
    };
  }
}

// Export singleton instance
export const circuitBreakerManager = new CircuitBreakerManager();

export default EnhancedCircuitBreaker;
