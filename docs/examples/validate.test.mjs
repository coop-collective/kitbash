// Validates every example in this folder against contract.v1.draft.json.
// Setup once: (cd docs/examples && npm install --ignore-workspace); run: node --test docs/examples/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const dir = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(fs.readFileSync(path.join(dir, 'contract.v1.draft.json'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema, 'contract');
const check = (def, value) => {
  const validate = ajv.getSchema(`contract#/$defs/${def}`);
  assert.ok(validate, `no definition ${def} in the schema`);
  assert.ok(validate(value), `${def}: ${ajv.errorsText(validate.errors)}`);
};

const files = fs.readdirSync(dir).filter((f) => /^\d\d-.*\.json$/.test(f)).sort();
test('examples exist', () => assert.ok(files.length >= 10));
for (const f of files) {
  test(f, () => {
    const ex = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (ex.def) return check(ex.def, ex.value);
    check(`${ex.tool}_input`, ex.request);
    check(ex.response_def ?? `${ex.tool}_output`, ex.response);
  });
}
test('every tool has input and output definitions', () => {
  for (const t of ['search', 'get', 'read_file', 'install', 'verify', 'upgrade', 'diff', 'harvest', 'publish', 'propose', 'whoami'])
    for (const k of ['input', 'output']) assert.ok(schema.$defs[`registry_${t}_${k}`], `registry_${t}_${k}`);
});
test('negative: a bad block id is rejected', () => {
  const v = ajv.getSchema('contract#/$defs/registry_get_input');
  assert.equal(v({ block: 'email-code-auth' }), false);
});
