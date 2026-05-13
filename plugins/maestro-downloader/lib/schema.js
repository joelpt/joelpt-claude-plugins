import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', 'schema', 'index.schema.json');

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  // Category mutex (videos XOR subcategories) uses `required` in oneOf branches
  // that share the parent's `properties`; strictRequired's "must redefine
  // properties in each branch" rule fights that idiom. The mutex is enforced
  // by oneOf semantics regardless.
  strictRequired: false,
});
// ajv-formats ships dual CJS/ESM. Under Node ESM importing a CJS module's
// `module.exports = fn` surfaces as `{ default: fn }`; under native-ESM
// resolution `addFormats` is the function directly. Handle both.
(typeof addFormats === 'function' ? addFormats : addFormats.default)(ajv);

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const validate = ajv.compile(schema);

export class IndexValidationError extends Error {
  constructor(errors) {
    super(`index.json validation failed:\n${formatErrors(errors)}`);
    this.name = 'IndexValidationError';
    this.errors = errors;
  }
}

function formatErrors(errors) {
  return (errors ?? []).map((e) => `  ${e.instancePath || '/'}: ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`).join('\n');
}

export function validateIndex(data) {
  const ok = validate(data);
  if (!ok) throw new IndexValidationError(validate.errors);
  return data;
}

export function indexErrors(data) {
  return validate(data) ? null : validate.errors;
}
