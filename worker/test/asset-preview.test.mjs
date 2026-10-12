import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { makeImagePreview } from '../asset-preview.mjs';
import { imageMetadata } from '../asset-vision.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64');

test('preview edge is bounded before spawning a converter', async () => {
  await assert.rejects(makeImagePreview(png, 127), /invalid preview edge/);
  await assert.rejects(makeImagePreview(png, 2049), /invalid preview edge/);
  await assert.rejects(makeImagePreview(png, 512.5), /invalid preview edge/);
});

test('ImageMagick converts PNG input to bounded JPEG preview', { skip: !existsSync('/usr/bin/convert') }, async () => {
  const jpeg = await makeImagePreview(png, 512);
  assert.ok(jpeg.length < 500_000);
  assert.equal(imageMetadata(jpeg).format, 'jpeg');
  assert.deepEqual({ width: imageMetadata(jpeg).width, height: imageMetadata(jpeg).height }, { width: 1, height: 1 });
});
