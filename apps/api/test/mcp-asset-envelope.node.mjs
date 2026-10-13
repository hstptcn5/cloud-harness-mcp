import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptMcpBodyBytes, MAX_ASSET_MCP_BODY_BYTES } from '../src/mcp-asset-envelope.ts';

const call = (name = 'asset_import') => ({
  jsonrpc: '2.0', method: 'tools/call', id: 11,
  params: { name, arguments: { kind: 'png', path: 'assets/source.png', contentBase64: 'AA==' } }
});

test('asset_import over ordinary limit and inside hard limit accepted for subsequent schema validation', () => {
  assert.equal(acceptMcpBodyBytes(call(), 8_000_100, 1_048_576), true);
  assert.equal(acceptMcpBodyBytes(call(), MAX_ASSET_MCP_BODY_BYTES, 1_048_576), true);
});
test('no call can cross the outer hard parser limit', () => {
  assert.equal(acceptMcpBodyBytes(call(), MAX_ASSET_MCP_BODY_BYTES + 1, 1_048_576), false);
});
test('normal-size calls are unaffected', () => {
  assert.equal(acceptMcpBodyBytes(call('exec_run'), 100, 1_048_576), true);
});
test('large unrelated or spoofed calls are rejected', () => {
  assert.equal(acceptMcpBodyBytes(call('exec_run'), 1_048_577, 1_048_576), false);
  assert.equal(acceptMcpBodyBytes({ ...call(), method: 'resources/read' }, 1_048_577, 1_048_576), false);
  assert.equal(acceptMcpBodyBytes([call()], 1_048_577, 1_048_576), false);
  assert.equal(acceptMcpBodyBytes({ ...call(), params: { name: 'asset_import', arguments: {} } }, 1_048_577, 1_048_576), false);
});
test('malformed or overflowing contents cannot use large allowance', () => {
  const malformed = call();
  malformed.params.arguments.contentBase64 = 'A'.repeat(8_000_001);
  assert.equal(acceptMcpBodyBytes(malformed, 8_300_000, 1_048_576), false);
  assert.equal(acceptMcpBodyBytes(null, Number.NaN, 1_048_576), false);
  assert.equal(acceptMcpBodyBytes(call(), -1, 1_048_576), false);
  assert.equal(acceptMcpBodyBytes(call(), 1000, 0), false);
});
