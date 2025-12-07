/**
 * Circuit Breaker Pattern Implementation
 *
 * Protects external API calls by preventing cascading failures.
 * States: CLOSED (normal), OPEN (failing), HALF_OPEN (testing)
 */

const STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

/**
 * Circuit Breaker for protecting external service calls
 */
export class CircuitBreaker {
  /**
   * Create a new circuit breaker
   * @param {Object} options Configuration options
   * @param {string} options.name Name of this circuit breaker
   * @param {number} options.failureThreshold Number of failures before opening circuit (default: 5)
   * @param {number} options.successThreshold Number of successes in HALF_OPEN to close circuit (default: 2)
   * @param {number} options.timeout Time in ms before attempting recovery (default: 30000)
   * @param {Function} options.onStateChange Callback when state changes
   * @param {Function} options.onFailure Callback when failure is recorded
   */
  constructor(options = {}) {
    this.name = options.name || 'default';
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 30000;
    this.onStateChange = options.onStateChange || null;
    this.onFailure = options.onFailure || null;

    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;

    // Statistics
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      rejectedCalls: 0,
      stateChanges: []
    };
  }

  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn The async function to execute
   * @returns {Promise<*>} The result of the function
   * @throws {Error} If circuit is open or function fails
   */
  async execute(fn) {
    this.stats.totalCalls++;

    if (this.state === STATES.OPEN) {
      if (Date.now() >= this.nextAttempt) {
        this._transition(STATES.HALF_OPEN);
      } else {
        this.stats.rejectedCalls++;
        throw new CircuitBreakerError(
          `Circuit breaker '${this.name}' is OPEN. Retry after ${Math.ceil((this.nextAttempt - Date.now()) / 1000)}s`,
          this.state
        );
      }
    }

    try {
      const result = await fn();
      this._recordSuccess();
      return result;
    } catch (error) {
      this._recordFailure(error);
      throw error;
    }
  }

  /**
   * Record a successful call
   */
  _recordSuccess() {
    this.stats.successfulCalls++;
    this.failureCount = 0;

    if (this.state === STATES.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this._transition(STATES.CLOSED);
      }
    }
  }

  /**
   * Record a failed call
   * @param {Error} error The error that occurred
   */
  _recordFailure(error) {
    this.stats.failedCalls++;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.onFailure) {
      this.onFailure(error, this);
    }

    if (this.state === STATES.HALF_OPEN) {
      this._transition(STATES.OPEN);
    } else if (this.state === STATES.CLOSED && this.failureCount >= this.failureThreshold) {
      this._transition(STATES.OPEN);
    }
  }

  /**
   * Transition to a new state
   * @param {string} newState The new state
   */
  _transition(newState) {
    const oldState = this.state;
    this.state = newState;

    this.stats.stateChanges.push({
      from: oldState,
      to: newState,
      timestamp: new Date().toISOString()
    });

    if (newState === STATES.OPEN) {
      this.nextAttempt = Date.now() + this.timeout;
      this.successCount = 0;
    } else if (newState === STATES.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.nextAttempt = null;
    } else if (newState === STATES.HALF_OPEN) {
      this.successCount = 0;
    }

    if (this.onStateChange) {
      this.onStateChange(oldState, newState, this);
    }
  }

  /**
   * Manually reset the circuit breaker to closed state
   */
  reset() {
    this._transition(STATES.CLOSED);
  }

  /**
   * Get current state
   * @returns {string} Current state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if circuit is allowing requests
   * @returns {boolean} True if requests are allowed
   */
  isAllowed() {
    if (this.state === STATES.CLOSED) {
      return true;
    }
    if (this.state === STATES.HALF_OPEN) {
      return true;
    }
    if (this.state === STATES.OPEN && Date.now() >= this.nextAttempt) {
      return true;
    }
    return false;
  }

  /**
   * Get statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
      ...this.stats,
      successRate:
        this.stats.totalCalls > 0
          ? `${((this.stats.successfulCalls / this.stats.totalCalls) * 100).toFixed(2)}%`
          : 'N/A'
    };
  }

  /**
   * Convert to JSON representation
   * @returns {Object} JSON representation
   */
  toJSON() {
    return this.getStats();
  }
}

/**
 * Error thrown when circuit breaker rejects a call
 */
export class CircuitBreakerError extends Error {
  constructor(message, state) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.state = state;
  }
}

/**
 * Circuit Breaker Registry - manages multiple circuit breakers
 */
export class CircuitBreakerRegistry {
  constructor() {
    this.breakers = new Map();
  }

  /**
   * Get or create a circuit breaker
   * @param {string} name Circuit breaker name
   * @param {Object} options Configuration options
   * @returns {CircuitBreaker} Circuit breaker instance
   */
  get(name, options = {}) {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker({ name, ...options }));
    }
    return this.breakers.get(name);
  }

  /**
   * Get all circuit breakers
   * @returns {Object} Map of name to stats
   */
  getAll() {
    const result = {};
    for (const [name, breaker] of this.breakers) {
      result[name] = breaker.getStats();
    }
    return result;
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
   * Get health summary
   * @returns {Object} Health summary
   */
  getHealth() {
    const breakers = this.getAll();
    const openCircuits = Object.values(breakers).filter((b) => b.state === STATES.OPEN);

    return {
      healthy: openCircuits.length === 0,
      totalCircuits: this.breakers.size,
      openCircuits: openCircuits.length,
      circuits: breakers
    };
  }
}

// Singleton registry
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

export default CircuitBreaker;
