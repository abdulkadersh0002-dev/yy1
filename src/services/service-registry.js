/**
 * Service Registry
 * Centralized registry for managing service instances and dependencies
 */

import logger from './logging/logger.js';

/**
 * Service Registry for dependency injection and lifecycle management
 */
class ServiceRegistry {
  constructor() {
    this.services = new Map();
    this.dependencies = new Map();
    this.initialized = new Set();
    this.started = new Set();
  }

  /**
   * Register a service
   * @param {string} name - Service name
   * @param {Object} service - Service instance
   * @param {Array<string>} deps - Array of dependency service names
   */
  register(name, service, deps = []) {
    if (this.services.has(name)) {
      logger.warn({ service: name }, 'Service already registered, overwriting');
    }

    this.services.set(name, service);
    this.dependencies.set(name, deps);

    logger.debug({ service: name, dependencies: deps }, 'Service registered');
  }

  /**
   * Get a service by name
   * @param {string} name - Service name
   * @returns {Object|null} Service instance or null
   */
  get(name) {
    return this.services.get(name) || null;
  }

  /**
   * Check if a service is registered
   * @param {string} name - Service name
   * @returns {boolean} Whether service is registered
   */
  has(name) {
    return this.services.has(name);
  }

  /**
   * Get all registered service names
   * @returns {Array<string>} Array of service names
   */
  getServiceNames() {
    return Array.from(this.services.keys());
  }

  /**
   * Initialize a service and its dependencies
   * @param {string} name - Service name
   * @returns {Promise<void>}
   */
  async initialize(name) {
    if (this.initialized.has(name)) {
      return;
    }

    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service not found: ${name}`);
    }

    // Initialize dependencies first
    const deps = this.dependencies.get(name) || [];
    for (const dep of deps) {
      await this.initialize(dep);
    }

    // Initialize the service
    if (typeof service.init === 'function') {
      logger.debug({ service: name }, 'Initializing service');
      await service.init();
    }

    this.initialized.add(name);
    logger.debug({ service: name }, 'Service initialized');
  }

  /**
   * Initialize all services
   * @returns {Promise<void>}
   */
  async initializeAll() {
    const serviceNames = this.getServiceNames();

    for (const name of serviceNames) {
      try {
        await this.initialize(name);
      } catch (error) {
        logger.error({ err: error, service: name }, 'Failed to initialize service');
        throw error;
      }
    }

    logger.info({ count: serviceNames.length }, 'All services initialized');
  }

  /**
   * Start a service (if it has a start method)
   * @param {string} name - Service name
   * @returns {Promise<void>}
   */
  async start(name) {
    if (this.started.has(name)) {
      return;
    }

    if (!this.initialized.has(name)) {
      await this.initialize(name);
    }

    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service not found: ${name}`);
    }

    if (typeof service.start === 'function') {
      logger.debug({ service: name }, 'Starting service');
      await service.start();
      this.started.add(name);
      logger.debug({ service: name }, 'Service started');
    }
  }

  /**
   * Start all services
   * @returns {Promise<void>}
   */
  async startAll() {
    const serviceNames = this.getServiceNames();

    for (const name of serviceNames) {
      try {
        await this.start(name);
      } catch (error) {
        logger.error({ err: error, service: name }, 'Failed to start service');
        // Continue with other services
      }
    }

    logger.info({ count: this.started.size }, 'Services started');
  }

  /**
   * Stop a service (if it has a stop method)
   * @param {string} name - Service name
   * @returns {Promise<void>}
   */
  async stop(name) {
    if (!this.started.has(name)) {
      return;
    }

    const service = this.services.get(name);
    if (!service) {
      return;
    }

    if (typeof service.stop === 'function') {
      logger.debug({ service: name }, 'Stopping service');
      await service.stop();
      this.started.delete(name);
      logger.debug({ service: name }, 'Service stopped');
    }
  }

  /**
   * Stop all services
   * @returns {Promise<void>}
   */
  async stopAll() {
    const serviceNames = Array.from(this.started);

    // Stop in reverse order
    for (const name of serviceNames.reverse()) {
      try {
        await this.stop(name);
      } catch (error) {
        logger.error({ err: error, service: name }, 'Failed to stop service');
      }
    }

    logger.info('All services stopped');
  }

  /**
   * Get service health status
   * @param {string} name - Service name
   * @returns {Object} Health status
   */
  getHealthStatus(name) {
    const service = this.services.get(name);

    if (!service) {
      return { status: 'unknown', message: 'Service not found' };
    }

    const status = {
      registered: true,
      initialized: this.initialized.has(name),
      started: this.started.has(name)
    };

    // Call service's health check if available
    if (typeof service.healthCheck === 'function') {
      try {
        const healthResult = service.healthCheck();
        Object.assign(status, healthResult);
      } catch (error) {
        status.healthy = false;
        status.error = error.message;
      }
    } else {
      status.healthy = status.initialized;
    }

    return status;
  }

  /**
   * Get health status for all services
   * @returns {Object} Health status map
   */
  getAllHealthStatus() {
    const health = {};

    for (const name of this.services.keys()) {
      health[name] = this.getHealthStatus(name);
    }

    return health;
  }

  /**
   * Inject dependencies into a service
   * @param {string} name - Service name
   * @returns {Object} Object with resolved dependencies
   */
  resolveDependencies(name) {
    const deps = this.dependencies.get(name) || [];
    const resolved = {};

    for (const dep of deps) {
      const service = this.get(dep);
      if (!service) {
        throw new Error(`Dependency not found: ${dep} required by ${name}`);
      }
      resolved[dep] = service;
    }

    return resolved;
  }

  /**
   * Clear the registry
   */
  clear() {
    this.services.clear();
    this.dependencies.clear();
    this.initialized.clear();
    this.started.clear();
    logger.debug('Service registry cleared');
  }

  /**
   * Get registry statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      total: this.services.size,
      initialized: this.initialized.size,
      started: this.started.size,
      services: this.getServiceNames()
    };
  }
}

// Singleton instance
const serviceRegistry = new ServiceRegistry();

export { ServiceRegistry, serviceRegistry };
export default ServiceRegistry;
