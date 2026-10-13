import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderFileList } from '../../apps/api/dashboard/dashboard-render.js';

test('Files tab exposes local image/ZIP upload with destination and status', () => {
  const html = renderFileList('ws_' + 'a'.repeat(24), { path: 'assets', entries: [] });
  for (const required of [
    'id="asset-upload-form"', 'data-directory="assets"', 'id="asset-upload-file"',
    'type="file"', 'id="asset-upload-path"', 'id="asset-upload-submit"',
    'id="asset-upload-status"', 'aria-live="polite"', '6 MB', 'not fetched automatically'
  ]) assert.ok(html.includes(required), required);
});

test('Files tab escapes untrusted directory names in attributes', () => {
  const html = renderFileList('ws_' + 'a'.repeat(24), { path: 'a" onmouseover="alert(1)', entries: [] });
  assert.ok(html.includes('data-directory="a&quot; onmouseover=&quot;alert(1)"'));
  assert.ok(!html.includes('data-directory="a" onmouseover='));
});

test('upload handler sends raw bytes through authenticated dashboard API', () => {
  const script = readFileSync(new URL('../../apps/api/dashboard/dashboard.js', import.meta.url), 'utf8');
  assert.ok(script.includes("const WORKSPACE_ASSET_MAX_BYTES = 6_000_000;"));
  assert.ok(script.includes("selected.arrayBuffer()"));
  assert.ok(script.includes("'content-type': mimeType"));
  assert.ok(script.includes("/assets/upload?path="));
  assert.ok(!script.includes('fetch(selected.name)'));
});
