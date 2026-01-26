import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true
});

const schemaPaths = {
  priceBar: 'config/data-contracts/price-bar.schema.json',
  economicIndicator: 'config/data-contracts/economic-indicator.schema.json',
  newsAnalysis: 'config/data-contracts/news-analysis.schema.json',
  upcomingEvent: 'config/data-contracts/upcoming-event.schema.json'
};

const cachedSchemas = new Map();
const validators = new Map();

function loadSchema(relativePath) {
  if (cachedSchemas.has(relativePath)) {
    return cachedSchemas.get(relativePath);
  }

  const fullPath = path.join(rootDir, relativePath);
  const content = readFileSync(fullPath, 'utf8');
  const schema = JSON.parse(content);

  cachedSchemas.set(relativePath, schema);
  return schema;
}

function primeSchema(relativePath) {
  const schema = loadSchema(relativePath);
  const key = schema.$id || relativePath;

  if (!ajv.getSchema(key)) {
    ajv.addSchema(schema, key);
  }

  return { schema, key };
}

// Pre-register base schemas so cross references resolve correctly
Object.values(schemaPaths).forEach((relativePath) => {
  primeSchema(relativePath);
});

function compileValidator(name, relativePath) {
  if (validators.has(name)) {
    return validators.get(name);
  }

  const { schema, key } = primeSchema(relativePath);
  const validator = ajv.getSchema(key) || ajv.compile(schema);
  validators.set(name, validator);
  return validator;
}

export function validateSchema(name, data) {
  const relativePath = schemaPaths[name];
  if (!relativePath) {
    throw new Error(`Unknown schema name: ${name}`);
  }

  const validator = compileValidator(name, relativePath);
  const valid = validator(data);

  return {
    valid,
    errors: valid ? null : validator.errors
  };
}

export function assertSchema(name, data, context = '') {
  const result = validateSchema(name, data);
  if (!result.valid) {
    const details = ajv.errorsText(result.errors, { separator: '\n' });
    const prefix = context ? `[${context}] ` : '';
    throw new Error(`${prefix}Schema validation failed for ${name}:\n${details}`);
  }
  return true;
}
