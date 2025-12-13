/**
 * Base Repository
 * Provides common database operations for all repositories
 */

import db from '../connection.js';
import logger from '../../services/logging/logger.js';

export class BaseRepository {
  constructor(tableName) {
    this.tableName = tableName;
  }

  /**
   * Find all records with optional filtering
   */
  async findAll(conditions = {}, options = {}) {
    try {
      const { limit = 100, offset = 0, orderBy = 'id', orderDirection = 'DESC' } = options;
      
      let query = `SELECT * FROM ${this.tableName}`;
      const params = [];
      
      // Add WHERE conditions
      if (Object.keys(conditions).length > 0) {
        const whereClause = Object.keys(conditions)
          .map((key, index) => `${key} = $${index + 1}`)
          .join(' AND ');
        query += ` WHERE ${whereClause}`;
        params.push(...Object.values(conditions));
      }
      
      // Add ORDER BY
      query += ` ORDER BY ${orderBy} ${orderDirection}`;
      
      // Add LIMIT and OFFSET
      query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      
      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error(`Error finding all in ${this.tableName}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Find one record by ID
   */
  async findById(id) {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE id = $1`;
      const result = await db.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`Error finding by ID in ${this.tableName}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Find one record by conditions
   */
  async findOne(conditions) {
    try {
      const whereClause = Object.keys(conditions)
        .map((key, index) => `${key} = $${index + 1}`)
        .join(' AND ');
      
      const query = `SELECT * FROM ${this.tableName} WHERE ${whereClause} LIMIT 1`;
      const result = await db.query(query, Object.values(conditions));
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`Error finding one in ${this.tableName}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Insert a new record
   */
  async create(data) {
    try {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');
      
      const query = `
        INSERT INTO ${this.tableName} (${keys.join(', ')})
        VALUES (${placeholders})
        RETURNING *
      `;
      
      const result = await db.query(query, values);
      return result.rows[0];
    } catch (error) {
      logger.error(`Error creating in ${this.tableName}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Update a record by ID
   */
  async update(id, data) {
    try {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const setClause = keys
        .map((key, index) => `${key} = $${index + 1}`)
        .join(', ');
      
      const query = `
        UPDATE ${this.tableName}
        SET ${setClause}
        WHERE id = $${keys.length + 1}
        RETURNING *
      `;
      
      const result = await db.query(query, [...values, id]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`Error updating in ${this.tableName}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Delete a record by ID
   */
  async delete(id) {
    try {
      const query = `DELETE FROM ${this.tableName} WHERE id = $1 RETURNING *`;
      const result = await db.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`Error deleting from ${this.tableName}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Count records
   */
  async count(conditions = {}) {
    try {
      let query = `SELECT COUNT(*) as count FROM ${this.tableName}`;
      const params = [];
      
      if (Object.keys(conditions).length > 0) {
        const whereClause = Object.keys(conditions)
          .map((key, index) => `${key} = $${index + 1}`)
          .join(' AND ');
        query += ` WHERE ${whereClause}`;
        params.push(...Object.values(conditions));
      }
      
      const result = await db.query(query, params);
      return parseInt(result.rows[0].count, 10);
    } catch (error) {
      logger.error(`Error counting in ${this.tableName}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Execute raw query
   */
  async raw(query, params = []) {
    try {
      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error executing raw query', { error: error.message });
      throw error;
    }
  }
}

export default BaseRepository;
