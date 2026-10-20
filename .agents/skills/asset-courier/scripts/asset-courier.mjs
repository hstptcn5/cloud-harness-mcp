import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_ASSETS = 64;
const MAX_ASSET_BYTES = 6_000_000;
const MAX_TOTAL_BYTES = 64_000_000;
const MAX_MANIFEST_BYTES = 1_000_000;
const HASH = /^[a-f0-9]{64}$/;
const SAFE_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const JPEG = Buffer.from('ffd8ff', 'hex');
const WEBP = Buffer.from('52494646', 'hex');

export class CourierError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CourierError';
    this.code = code;
  }
}

function fail(code, detail) {
  throw new CourierError(code, detail);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeAssetPath(filename) {
  if (typeof filename !== 'string' || filename.length > 400 || filename.includes('\\') || filename.startsWith('/') || filename.includes('\0')) {
    fail('UNSAFE_PATH', 'Invalid asset path');
  }
  const parts = filename.split('/');
  if (parts.length !== 2 || parts[0] !== 'source_original' || !parts.every((part) => SAFE_PART.test(part) && part !== '.' && part !== '..')) {
    fail('UNSAFE_PATH', 'Assets must be source_original/<safe-filename>');
  }
  if (!/\.(png|jpe?g|webp)$/i.test(parts[1])) fail('UNSAFE_PATH', 'Unsupported image extension');
  return filename;
}

function confined(root, filename) {
  const path = resolve(root, ...filename.split('/'));
  if (!path.startsWith(resolve(root) + sep)) fail('UNSAFE_PATH', 'Asset escapes source root');
  return path;
}

async function regularNoLinks(root, filename) {
  const parts = filename.split('/');
  let cursor = resolve(root);
  const top = await lstat(cursor).catch(() => fail('SOURCE_MISSING', 'Missing source root'));
  if (!top.isDirectory() || top.isSymbolicLink()) fail('UNSAFE_PATH', 'Source root must be a real directory');
  for (let index = 0; index < parts.length; index++) {
    cursor = join(cursor, parts[index]);
    const stat = await lstat(cursor).catch(() => fail('SOURCE_MISSING', 'Missing asset: ' + filename));
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
      fail('UNSAFE_PATH', 'Symlink or unexpected file type: ' + filename);
    }
  }
  return cursor;
}

async function loadBytes(root, filename, limit) {
  const path = await regularNoLinks(root, filename);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > limit) fail('SOURCE_MISSING', 'Invalid byte size: ' + filename);
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size || bytes.length > limit) fail('HASH_MISMATCH', 'Source changed during reading: ' + filename);
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail('HASH_MISMATCH', 'Source changed during reading: ' + filename);
    return bytes;
  } finally {
    await handle.close();
  }
}

function checkSignature(name, bytes) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png') && bytes.subarray(0, 8).equals(PNG)) return 'png';
  if (/\.(jpg|jpeg)$/.test(lower) && bytes.subarray(0, 3).equals(JPEG)) return 'jpeg';
  if (lower.endsWith('.webp') && bytes.subarray(0, 4).equals(WEBP) &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  fail('SOURCE_MISSING', 'Image signature and extension mismatch: ' + name);
}

export async function verify({ root, manifest }) {
  const base = resolve(root);
  const manifestFile = resolve(manifest);
  if (manifestFile !== resolve(base, 'manifest.json')) {
    fail('UNSAFE_PATH', 'Manifest must be root/manifest.json');
  }
  const originalManifest = await loadBytes(base, 'manifest.json', MAX_MANIFEST_BYTES);
  let body;
  try { body = JSON.parse(originalManifest.toString('utf8')); }
  catch { fail('SOURCE_MISSING', 'Malformed manifest JSON'); }
  if (!Array.isArray(body.assets) || body.assets.length < 1 || body.assets.length > MAX_ASSETS) {
    fail('SOURCE_MISSING', 'Manifest must have 1–64 assets');
  }
  const names = new Set();
  const prepared = [];
  let total = 0;
  for (const item of body.assets) {
    const file = safeAssetPath(item.archive_filename);
    if (names.has(file)) fail('UNSAFE_PATH', 'Duplicate asset filename: ' + file);
    names.add(file);
    if (typeof item.asset_name !== 'string' || !item.asset_name.trim() || item.asset_name.length > 180) {
      fail('SOURCE_MISSING', 'Missing asset name');
    }
    if (!HASH.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > MAX_ASSET_BYTES) {
      fail('SOURCE_MISSING', 'Invalid manifest digest or byte count: ' + file);
    }
    const bytes = await loadBytes(base, file, MAX_ASSET_BYTES);
    const actual = digest(bytes);
    if (actual !== item.sha256 || bytes.length !== item.bytes) fail('HASH_MISMATCH', 'SHA-256/size mismatch: ' + file);
    const kind = checkSignature(file, bytes);
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) fail('SOURCE_MISSING', 'Batch too large');
    prepared.push({ asset_name: item.asset_name, archive_filename: file, sha256: actual, bytes: bytes.length, kind, bytesBuffer: bytes });
  }
  return {
    assets: prepared,
    manifestBytes: originalManifest,
    receipt: {
      schema: 'asset-courier.receipt/v1',
      status: 'TRANSPORT_ONLY',
      artisticApproved: false,
      sourceManifestSha256: digest(originalManifest),
      assetCount: prepared.length,
      totalBytes: total,
      assets: prepared.map(({ asset_name, archive_filename, sha256, bytes, kind }) => ({ asset_name, archive_filename, sha256, bytes, kind }))
    }
  };
}

export async function prepare({ root, manifest, out }) {
  const source = resolve(root);
  const destination = resolve(out);
  if (destination === source || destination.startsWith(source + sep) || source.startsWith(destination + sep)) {
    fail('UNSAFE_PATH', 'Inbox cannot contain or be contained by input root');
  }
  const checked = await verify({ root, manifest });
  await mkdir(dirname(destination), { recursive: true });
  try {
    await mkdir(destination);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('DESTINATION_EXISTS', 'Inbox destination already exists');
    throw error;
  }
  try {
    await mkdir(join(destination, 'source_original'));
    for (const asset of checked.assets) {
      const target = confined(destination, asset.archive_filename);
      await writeFile(target, asset.bytesBuffer, { flag: 'wx', mode: 0o600 });
    }
    await writeFile(join(destination, 'manifest.json'), checked.manifestBytes, { flag: 'wx', mode: 0o600 });
    await writeFile(join(destination, 'courier-receipt.json'), JSON.stringify(checked.receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    // Second independent read ensures prepared files match, not only in-memory copies.
    const published = await verify({ root: destination, manifest: join(destination, 'manifest.json') });
    if (published.receipt.sourceManifestSha256 !== checked.receipt.sourceManifestSha256) {
      fail('HASH_MISMATCH', 'Prepared manifest changed');
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
  return checked.receipt;
}

function flags(args) {
  const output = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--root', '--manifest', '--out'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
      fail('INVALID_ARGS', 'Expected --root, --manifest and optionally --out');
    }
    if (output[args[i]]) fail('INVALID_ARGS', 'Duplicate argument');
    output[args[i]] = args[i + 1];
  }
  return output;
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  const opts = flags(args);
  if (!['verify', 'prepare'].includes(action) || !opts['--root'] || !opts['--manifest'] || (action === 'prepare' && !opts['--out'])) {
    fail('INVALID_ARGS', 'Usage: verify|prepare --root DIR --manifest DIR/manifest.json [--out NEW_DIR]');
  }
  const result = action === 'prepare'
    ? await prepare({ root: opts['--root'], manifest: opts['--manifest'], out: opts['--out'] })
    : (await verify({ root: opts['--root'], manifest: opts['--manifest'] })).receipt;
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({ ok: false, code: error.code || 'UNAVAILABLE', message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
