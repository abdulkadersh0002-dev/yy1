import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const configDir = path.join(repoRoot, 'config');
const schemaDir = path.join(configDir, 'schemas');

const configs = [
  {
    name: 'backtest.config.json',
    file: path.join(configDir, 'backtest.config.json'),
    schema: path.join(schemaDir, 'backtest.schema.json')
  },
  {
    name: 'data-refresh.config.json',
    file: path.join(configDir, 'data-refresh.config.json'),
    schema: path.join(schemaDir, 'data-refresh.schema.json')
  },
  {
    name: 'historical-warehouse.config.json',
    file: path.join(configDir, 'historical-warehouse.config.json'),
    schema: path.join(schemaDir, 'historical-warehouse.schema.json')
  }
];

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });

const loadJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const formatErrors = (errors = []) =>
  errors
    .map((err) => {
      const dataPath = err.instancePath || '/';
      const detail = err.message || 'invalid';
      return `- ${dataPath} ${detail}`;
    })
    .join('\n');

async function main() {
  let failures = 0;

  for (const entry of configs) {
    const [schema, data] = await Promise.all([
      loadJson(entry.schema),
      loadJson(entry.file)
    ]);

    const validate = ajv.compile(schema);
    const valid = validate(data);

    if (!valid) {
      failures += 1;
      console.error(`\n${entry.name} failed validation:`);
      console.error(formatErrors(validate.errors));
    } else {
      console.log(`${entry.name} ✓`);
    }
  }

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Config validation failed:', error.message);
  process.exit(1);
});
