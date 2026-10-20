import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verify, prepare } from '../../.agents/skills/asset-courier/scripts/asset-courier.mjs';

const fixtureImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/A4AAAAAASUVORK5CYII=', 'base64');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function withFixture(run, edit) {
  const outer = await mkdtemp(join(tmpdir(), 'asset-courier-test-'));
  const source = join(outer, 'source');
  const asset = join(source, 'source_original', 'demo.png');
  const manifestPath = join(source, 'manifest.json');
  const manifest = { assets: [{ asset_name: 'Demo', archive_filename: 'source_original/demo.png', sha256: sha(fixtureImage), bytes: fixtureImage.length }] };
  await mkdir(join(source, 'source_original'), { recursive: true });
  await writeFile(asset, fixtureImage);
  await writeFile(manifestPath, JSON.stringify(manifest));
  try {
    if (edit) await edit({ outer, source, asset, manifest, manifestPath });
    await run({ outer, source, asset, manifest, manifestPath });
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
}

test('actual prepared bytes are identical to source and manifest, receipt is transport-only', async () => {
  await withFixture(async ({ outer, source, manifestPath }) => {
    const out = join(outer, 'inbox', 'pilot-01');
    const receipt = await prepare({ root: source, manifest: manifestPath, out });
    assert.equal(receipt.status, 'TRANSPORT_ONLY');
    assert.equal(receipt.artisticApproved, false);
    assert.equal(receipt.assets[0].sha256, sha(fixtureImage));
    assert.deepEqual(await readFile(join(out, 'source_original/demo.png')), fixtureImage);
    assert.deepEqual(await readFile(join(out, 'manifest.json')), await readFile(manifestPath));
    const verified = await verify({ root: out, manifest: join(out, 'manifest.json') });
    assert.equal(verified.receipt.assets[0].sha256, receipt.assets[0].sha256);
    assert.equal((await readFile(join(out, 'courier-receipt.json'), 'utf8')).includes('TRANSPORT_ONLY'), true);
  });
});

test('wrong hash fails with no output created', async () => {
  await withFixture(async ({ source, manifestPath, outer }) => {
    const out = join(outer, 'inbox', 'bad');
    await assert.rejects(prepare({ root: source, manifest: manifestPath, out }), { code: 'HASH_MISMATCH' });
    await assert.rejects(readFile(join(out, 'manifest.json')));
  }, async ({ manifest, manifestPath }) => {
    manifest.assets[0].sha256 = '0'.repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest));
  });
});

test('source missing and forged extension fail closed', async () => {
  await withFixture(async ({ source, manifestPath }) => {
    await assert.rejects(verify({ root: source, manifest: manifestPath }), { code: 'SOURCE_MISSING' });
  }, async ({ asset }) => { await rm(asset); });
  await withFixture(async ({ source, manifestPath }) => {
    await assert.rejects(verify({ root: source, manifest: manifestPath }), { code: 'HASH_MISMATCH' });
  }, async ({ asset }) => { await writeFile(asset, Buffer.alloc(fixtureImage.length)); });
});

test('rejects invalid image signature even when manifest SHA-256 matches the forged bytes', async () => {
  await withFixture(async ({ source, manifestPath }) => {
    await assert.rejects(verify({ root: source, manifest: manifestPath }), { code: 'SOURCE_MISSING' });
  }, async ({ asset, manifest, manifestPath }) => {
    const fake = Buffer.alloc(fixtureImage.length);
    await writeFile(asset, fake);
    manifest.assets[0].sha256 = sha(fake);
    await writeFile(manifestPath, JSON.stringify(manifest));
  });
});

test('rejects path escape, duplicate entry and nonstandard path syntax', async () => {
  for (const path of ['source_original/../demo.png', '../source_original/demo.png', 'source_original\\demo.png', '/etc/hosts']) {
    await withFixture(async ({ source, manifestPath }) => {
      await assert.rejects(verify({ root: source, manifest: manifestPath }), { code: 'UNSAFE_PATH' });
    }, async ({ manifest, manifestPath }) => {
      manifest.assets[0].archive_filename = path;
      await writeFile(manifestPath, JSON.stringify(manifest));
    });
  }
  await withFixture(async ({ source, manifestPath }) => {
    await assert.rejects(verify({ root: source, manifest: manifestPath }), { code: 'UNSAFE_PATH' });
  }, async ({ manifest, manifestPath }) => {
    manifest.assets.push({ ...manifest.assets[0] });
    await writeFile(manifestPath, JSON.stringify(manifest));
  });
});

test('rejects symlinked input or symlinked parent directory', async () => {
  await withFixture(async ({ source, manifestPath }) => {
    await assert.rejects(verify({ root: source, manifest: manifestPath }), { code: 'UNSAFE_PATH' });
  }, async ({ outer, asset }) => {
    const alternative = join(outer, 'original.png');
    await writeFile(alternative, fixtureImage);
    await rm(asset);
    await symlink(alternative, asset);
  });
  await withFixture(async ({ source, manifestPath }) => {
    await assert.rejects(verify({ root: source, manifest: manifestPath }), { code: 'UNSAFE_PATH' });
  }, async ({ outer, source }) => {
    await rm(join(source, 'source_original'), { recursive: true });
    const alternative = join(outer, 'alternate');
    await mkdir(alternative);
    await writeFile(join(alternative, 'demo.png'), fixtureImage);
    await symlink(alternative, join(source, 'source_original'));
  });
});

test('never overwrites an existing batch inbox', async () => {
  await withFixture(async ({ outer, source, manifestPath }) => {
    const out = join(outer, 'asset-inbox');
    await mkdir(out);
    await assert.rejects(prepare({ root: source, manifest: manifestPath, out }), { code: 'DESTINATION_EXISTS' });
  });
});

test('packaged asset-courier skill and script stay byte-identical to repository skill', async () => {
  for (const relative of ['SKILL.md', 'scripts/asset-courier.mjs']) {
    const root = new URL('../../.agents/skills/asset-courier/' + relative, import.meta.url);
    const plugin = new URL('../../plugins/cloud-harness/skills/asset-courier/' + relative, import.meta.url);
    assert.deepEqual(await readFile(root), await readFile(plugin));
  }
});

test('wrong manifest location fails closed', async () => {
  await withFixture(async ({ source }) => {
    await assert.rejects(verify({ root: source, manifest: join(source, 'other.json') }), { code: 'UNSAFE_PATH' });
  });
});
