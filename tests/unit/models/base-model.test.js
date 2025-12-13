/**
 * Base Model Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { BaseModel } from '../../../src/models/base-model.js';

describe('BaseModel', () => {
  describe('Constructor and Basic Operations', () => {
    it('should create a model with default data', () => {
      const model = new BaseModel();
      assert.ok(model instanceof BaseModel);
      assert.deepEqual(model.toObject(), {});
    });

    it('should create a model with initial data', () => {
      const data = { name: 'Test', value: 42 };
      const model = new BaseModel(data);
      assert.deepEqual(model.toObject(), data);
    });

    it('should get property values', () => {
      const model = new BaseModel({ name: 'Test', value: 42 });
      assert.equal(model.get('name'), 'Test');
      assert.equal(model.get('value'), 42);
    });

    it('should set property values', () => {
      const model = new BaseModel({ name: 'Test' });
      model.set('name', 'Updated');
      assert.equal(model.get('name'), 'Updated');
    });

    it('should update multiple properties', () => {
      const model = new BaseModel({ name: 'Test', value: 42 });
      model.update({ name: 'Updated', value: 100 });
      assert.equal(model.get('name'), 'Updated');
      assert.equal(model.get('value'), 100);
    });
  });

  describe('Validation', () => {
    it('should validate without schema', () => {
      const model = new BaseModel({ name: 'Test' });
      assert.equal(model.validate(), true);
      assert.equal(model.isValid(), true);
    });

    it('should validate with schema', () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const model = new BaseModel({ name: 'Test', age: 30 }, schema);
      assert.equal(model.validate(), true);
      assert.equal(model.isValid(), true);
    });

    it('should fail validation with invalid data', () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const model = new BaseModel({ name: 'Test', age: 'invalid' }, schema);
      assert.equal(model.validate(), false);
      assert.equal(model.isValid(), false);
      assert.ok(model.getErrors().length > 0);
    });

    it('should return validation errors', () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const model = new BaseModel({ name: 123, age: 'invalid' }, schema);
      model.validate();
      const errors = model.getErrors();
      assert.ok(errors.length > 0);
      assert.ok(errors[0].path);
      assert.ok(errors[0].message);
    });
  });

  describe('Serialization', () => {
    it('should convert to plain object', () => {
      const data = { name: 'Test', value: 42 };
      const model = new BaseModel(data);
      const obj = model.toObject();
      assert.deepEqual(obj, data);
      assert.notStrictEqual(obj, data); // Should be a copy
    });

    it('should convert to JSON string', () => {
      const data = { name: 'Test', value: 42 };
      const model = new BaseModel(data);
      const json = model.toJSON();
      assert.equal(typeof json, 'string');
      assert.deepEqual(JSON.parse(json), data);
    });
  });

  describe('Cloning', () => {
    it('should clone the model', () => {
      const data = { name: 'Test', value: 42 };
      const model = new BaseModel(data);
      const clone = model.clone();
      assert.ok(clone instanceof BaseModel);
      assert.deepEqual(clone.toObject(), model.toObject());
      assert.notStrictEqual(clone, model);
    });

    it('should create independent clone', () => {
      const model = new BaseModel({ name: 'Test', value: 42 });
      const clone = model.clone();
      clone.set('name', 'Modified');
      assert.equal(model.get('name'), 'Test');
      assert.equal(clone.get('name'), 'Modified');
    });
  });
});
