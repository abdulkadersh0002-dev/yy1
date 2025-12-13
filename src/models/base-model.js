/**
 * Base Model Class
 * Provides common functionality for all domain models
 */

import { z } from 'zod';

/**
 * Base class for all domain models with validation and serialization
 */
class BaseModel {
  /**
   * @param {Object} data - Raw data for the model
   * @param {z.ZodSchema} schema - Zod schema for validation
   */
  constructor(data = {}, schema = null) {
    this._data = data;
    this._schema = schema;
    this._errors = [];
    this._validated = false;
  }

  /**
   * Validate the model data against its schema
   * @returns {boolean} Whether validation passed
   */
  validate() {
    if (!this._schema) {
      this._validated = true;
      return true;
    }

    try {
      this._schema.parse(this._data);
      this._validated = true;
      this._errors = [];
      return true;
    } catch (error) {
      this._validated = false;
      if (error instanceof z.ZodError) {
        this._errors = error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
          code: e.code
        }));
      } else {
        this._errors = [{ message: error.message }];
      }
      return false;
    }
  }

  /**
   * Get validation errors
   * @returns {Array<Object>} Array of validation errors
   */
  getErrors() {
    return this._errors;
  }

  /**
   * Check if model is valid
   * @returns {boolean} Whether model is valid
   */
  isValid() {
    if (!this._validated) {
      this.validate();
    }
    return this._errors.length === 0;
  }

  /**
   * Convert model to plain object
   * @returns {Object} Plain object representation
   */
  toObject() {
    return { ...this._data };
  }

  /**
   * Convert model to JSON string
   * @returns {string} JSON representation
   */
  toJSON() {
    return JSON.stringify(this.toObject());
  }

  /**
   * Get a specific property value
   * @param {string} key - Property key
   * @returns {*} Property value
   */
  get(key) {
    return this._data[key];
  }

  /**
   * Set a specific property value
   * @param {string} key - Property key
   * @param {*} value - Property value
   */
  set(key, value) {
    this._data[key] = value;
    this._validated = false;
  }

  /**
   * Update multiple properties
   * @param {Object} updates - Object with property updates
   */
  update(updates) {
    Object.assign(this._data, updates);
    this._validated = false;
  }

  /**
   * Clone the model
   * @returns {BaseModel} Cloned instance
   */
  clone() {
    const Constructor = this.constructor;
    // Use structuredClone if available (Node 17+), fallback to JSON for compatibility
    const clonedData =
      typeof structuredClone !== 'undefined'
        ? structuredClone(this._data)
        : JSON.parse(JSON.stringify(this._data));
    return new Constructor(clonedData);
  }
}

export { BaseModel };
export default BaseModel;
