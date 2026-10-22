import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const base=path.resolve(import.meta.dirname,'..');
test('CI tools are present in Runner operation/schema/title/description and no workspace path is required',()=>{
  const ops=fs.readFileSync(path.join(base,'packages/contracts/src/runner-api.ts'),'utf8');
  const schema=fs.readFileSync(path.join(base,'packages/contracts/src/tool-schemas.ts'),'utf8');
  const service=fs.readFileSync(path.join(base,'apps/runner/src/workspace-service.ts'),'utf8');
  for(const name of ['ci_run','ci_status','ci_report']){
    assert.match(ops,new RegExp("'"+name+"'"));
    assert.match(schema,new RegExp('\\b'+name+': z\\.object'));
    assert.match(service,new RegExp("operation === '"+name+"'"));
  }
  assert.match(schema,/ci_run: z\.object\(\{repoId:/);
  assert.match(schema,/idempotencyKey:IdempotencyKeySchema/);
});
test('Compose keeps broker off host port and without Docker socket; Runner alone receives credential',()=>{
  const composed=fs.readFileSync(path.join(base,'compose.ci.integrated.yaml'),'utf8');
  const runner=fs.readFileSync(path.join(base,'compose.ci.runner.override.yaml'),'utf8');
  assert.doesNotMatch(composed,/ports:\s*\n/);
  assert.doesNotMatch(composed,/docker\.sock/);
  assert.match(composed,/cloud-harness-mcp_control/);
  assert.match(runner,/CI_BROKER_TOKEN_FILE/);
});
