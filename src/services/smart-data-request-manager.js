/**
 * Smart Data Request Manager
 * Optimizes API usage within TwelveData 55 credits/minute limit
 * Implements priority-based queueing and intelligent caching
 */

import logger from '../services/logging/logger.js';

class SmartDataRequestManager {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    
    // Credit allocation per priority
    this.creditAllocation = {
      critical: 20,  // 36% - Active trades
      high: 25,      // 45% - Signal generation
      medium: 8,     // 15% - Background refresh
      low: 2         // 4% - Analytics
    };
    
    // Request queues by priority
    this.queues = {
      critical: [],
      high: [],
      medium: [],
      low: []
    };
    
    // Usage tracking
    this.usage = {
      currentMinute: this.getCurrentMinute(),
      creditsUsed: 0,
      creditLimit: options.creditLimit || 55,
      requestsByPriority: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      }
    };
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      cachedRequests: 0,
      rateLimitHits: 0,
      queuedRequests: 0
    };
    
    // Start processing queue
    this.startQueueProcessor();
    
    // Reset usage counter every minute
    this.startUsageReset();
  }

  /**
   * Get current minute timestamp
   */
  getCurrentMinute() {
    return Math.floor(Date.now() / 60000);
  }

  /**
   * Schedule a data request with priority
   */
  async scheduleRequest(request) {
    const { priority = 'medium', fn, key } = request;
    
    // Validate priority
    if (!['critical', 'high', 'medium', 'low'].includes(priority)) {
      throw new Error(`Invalid priority: ${priority}`);
    }

    // Check if we can execute immediately
    if (this.canExecuteNow(priority)) {
      return this.executeRequest(request);
    }

    // Queue the request
    return new Promise((resolve, reject) => {
      this.queues[priority].push({
        ...request,
        resolve,
        reject,
        timestamp: Date.now()
      });
      this.stats.queuedRequests += 1;
    });
  }

  /**
   * Check if request can execute now
   */
  canExecuteNow(priority) {
    // Check if we've exceeded the limit
    if (this.usage.creditsUsed >= this.usage.creditLimit) {
      return false;
    }

    // Check priority-specific allocation
    const priorityUsed = this.usage.requestsByPriority[priority];
    const priorityLimit = this.creditAllocation[priority];
    
    if (priorityUsed >= priorityLimit) {
      // Can borrow from unused capacity
      const totalAllocated = Object.values(this.creditAllocation).reduce((a, b) => a + b, 0);
      const totalUsed = this.usage.creditsUsed;
      return totalUsed < totalAllocated;
    }

    return true;
  }

  /**
   * Execute a request
   */
  async executeRequest(request) {
    const { fn, key, priority } = request;
    const currentMinute = this.getCurrentMinute();
    
    // Reset if new minute
    if (currentMinute !== this.usage.currentMinute) {
      this.resetUsage();
    }

    try {
      this.stats.totalRequests += 1;
      this.usage.creditsUsed += 1;
      this.usage.requestsByPriority[priority] += 1;

      const result = await fn();
      
      this.stats.successfulRequests += 1;
      
      this.logger.debug({
        priority,
        key,
        creditsUsed: this.usage.creditsUsed,
        creditLimit: this.usage.creditLimit
      }, 'Request executed');

      return result;
    } catch (error) {
      if (error.response?.status === 429 || error.message?.includes('rate limit')) {
        this.stats.rateLimitHits += 1;
        this.logger.warn({ priority, key }, 'Rate limit hit');
      }
      throw error;
    }
  }

  /**
   * Process queued requests
   */
  async processQueue() {
    // Process in priority order
    const priorities = ['critical', 'high', 'medium', 'low'];
    
    for (const priority of priorities) {
      const queue = this.queues[priority];
      
      while (queue.length > 0 && this.canExecuteNow(priority)) {
        const request = queue.shift();
        
        try {
          const result = await this.executeRequest(request);
          request.resolve(result);
        } catch (error) {
          request.reject(error);
        }
      }
    }
  }

  /**
   * Start queue processor
   */
  startQueueProcessor() {
    this.queueInterval = setInterval(() => {
      this.processQueue().catch((error) => {
        this.logger.error({ err: error }, 'Queue processing error');
      });
    }, 1000); // Process every second
  }

  /**
   * Start usage reset timer
   */
  startUsageReset() {
    this.resetInterval = setInterval(() => {
      const currentMinute = this.getCurrentMinute();
      if (currentMinute !== this.usage.currentMinute) {
        this.resetUsage();
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Reset usage counters
   */
  resetUsage() {
    this.usage.currentMinute = this.getCurrentMinute();
    this.usage.creditsUsed = 0;
    this.usage.requestsByPriority = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    };
    
    this.logger.info({
      queueSizes: {
        critical: this.queues.critical.length,
        high: this.queues.high.length,
        medium: this.queues.medium.length,
        low: this.queues.low.length
      }
    }, 'Usage reset for new minute');
  }

  /**
   * Get current statistics
   */
  getStatistics() {
    return {
      usage: {
        ...this.usage,
        percentUsed: ((this.usage.creditsUsed / this.usage.creditLimit) * 100).toFixed(1),
        remaining: this.usage.creditLimit - this.usage.creditsUsed
      },
      queues: {
        critical: this.queues.critical.length,
        high: this.queues.high.length,
        medium: this.queues.medium.length,
        low: this.queues.low.length,
        total: Object.values(this.queues).reduce((sum, q) => sum + q.length, 0)
      },
      stats: {
        ...this.stats,
        successRate: this.stats.totalRequests > 0 
          ? ((this.stats.successfulRequests / this.stats.totalRequests) * 100).toFixed(1) 
          : 0,
        cacheHitRate: this.stats.totalRequests > 0
          ? ((this.stats.cachedRequests / this.stats.totalRequests) * 100).toFixed(1)
          : 0
      }
    };
  }

  /**
   * Record cache hit
   */
  recordCacheHit() {
    this.stats.cachedRequests += 1;
  }

  /**
   * Shutdown manager
   */
  shutdown() {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
    }
    if (this.resetInterval) {
      clearInterval(this.resetInterval);
    }
  }
}

export default SmartDataRequestManager;
