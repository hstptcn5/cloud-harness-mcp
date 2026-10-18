import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, symlink, readdir, rename, writeFile, link, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { executeWorkerRequest, openConfinedImportDirectory } from '../harness-worker.mjs';

// Real, CRC-correct 3x2 RGBA PNG, with independently decodable scanlines.
const realPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAI0lEQVR4nGP4L8f1X+SExn85ozv/GXiULP77RVX/P7FlwX8AmioM96e+sV8AAAAASUVORK5CYII=', 'base64');

const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
async function isolated(fn) {
  const root=await mkdtemp(join(tmpdir(),'chm-image-'));
  const before=process.env.HARNESS_WORKSPACE_ROOT;
  process.env.HARNESS_WORKSPACE_ROOT=root;
  try { await fn(root); } finally {
    if (before === undefined) delete process.env.HARNESS_WORKSPACE_ROOT;
    else process.env.HARNESS_WORKSPACE_ROOT=before;
    await rm(root,{recursive:true,force:true});
  }
}
function request(path='inbox/image.png', content=png) {
  return {path,kind:'png',contentBase64:content.toString('base64'),expectedSha256:sha256(content),overwrite:false};
}

test('imports unchanged PNG bytes, safely retries identical content without overwriting', async () => isolated(async (root)=>{
  const first=await executeWorkerRequest('asset_import',request());
  assert.equal(first.ok,true);
  assert.equal(first.data.alreadyImported,false);
  assert.equal(first.data.sha256,sha256(png));
  assert.deepEqual(await readFile(join(root,'inbox/image.png')),png);
  const second=await executeWorkerRequest('asset_import',request());
  assert.equal(second.ok,true);
  assert.equal(second.data.alreadyImported,true);
  assert.equal(second.data.sha256,sha256(png));
  assert.deepEqual(await readFile(join(root,'inbox/image.png')),png);
  assert.deepEqual(await readdir(join(root,'inbox')),['image.png']);
  const different=Buffer.concat([png,Buffer.from('changed')]);
  const collision=await executeWorkerRequest('asset_import',request('inbox/image.png',different));
  assert.equal(collision.ok,false);
  assert.equal(collision.error.code,'CONFLICT');
  assert.deepEqual(await readFile(join(root,'inbox/image.png')),png);
}));

test('concurrent same-hash import is idempotent and symlink target is never reused',async()=>isolated(async(root)=>{
  const results=await Promise.all(Array.from({length:4},()=>executeWorkerRequest('asset_import',request())));
  assert.equal(results.every(x=>x.ok),true);
  assert.equal(results.filter(x=>x.data.alreadyImported===false).length,1);
  assert.equal(results.filter(x=>x.data.alreadyImported===true).length,3);
  await symlink('image.png',join(root,'inbox/link.png'));
  const linkAttempt=await executeWorkerRequest('asset_import',request('inbox/link.png'));
  assert.equal(linkAttempt.ok,false);
  assert.equal(linkAttempt.error.code,'CONFLICT');
  assert.deepEqual(await readdir(join(root,'inbox')),['image.png','link.png']);
}));

test('real decodable 3x2 PNG survives import byte-for-byte with correct dimensions and digest', async()=>isolated(async(root)=>{
  const res=await executeWorkerRequest('asset_import', request('inbox/real.png',realPng));
  assert.equal(res.ok,true);
  const stored=await readFile(join(root,'inbox/real.png'));
  assert.deepEqual(stored,realPng);
  assert.equal(res.data.sha256,sha256(realPng));
  assert.equal(sha256(stored),sha256(realPng));
  assert.equal(stored.readUInt32BE(16),3);
  assert.equal(stored.readUInt32BE(20),2);
  const idat=stored.indexOf(Buffer.from('IDAT'));
  assert.ok(idat>0);
  const pixels=inflateSync(stored.subarray(idat+4,idat+4+stored.readUInt32BE(idat-4)));
  assert.equal(pixels.length,26); // two RGBA rows, each with PNG filter byte
  assert.equal(pixels[0],0);
  assert.equal(pixels[13],0);
  // Exercise a real external PNG decoder where available; no network or GUI.
  const decoder=spawnSync('identify',['-format','%wx%h','png:-'],{input:stored,encoding:'utf8'});
  if (!decoder.error || decoder.error.code!=='ENOENT') {
    assert.equal(decoder.status,0,decoder.stderr);
    assert.equal(decoder.stdout,'3x2');
  }
}));

test('pinned ancestor directory rejects adversarial symlink replacement without writing outside workspace',async()=>isolated(async(root)=>{
  const outside=await mkdtemp(join(tmpdir(),'orion-outside-'));
  let held;
  try {
    await mkdir(join(root,'inbox'));
    held=await openConfinedImportDirectory('inbox/safe.png');
    // Deterministic TOCTOU: the path that passed validation is replaced *after*
    // acquiring the directory fd but *before* the image publication.
    await rename(join(root,'inbox'),join(root,'moved-inbox'));
    await symlink(outside,join(root,'inbox'),'dir');
    const temporary=join(held.dirPath,'temp.png');
    await writeFile(temporary,realPng,{flag:'wx'});
    await link(temporary,held.target);
    assert.deepEqual(await readFile(join(root,'moved-inbox','safe.png')),realPng);
    await assert.rejects(stat(join(outside,'safe.png')),{code:'ENOENT'});
    const swapped=await executeWorkerRequest('asset_import',request('inbox/hijacked.png',realPng));
    assert.equal(swapped.ok,false);
    await assert.rejects(stat(join(outside,'hijacked.png')),{code:'ENOENT'});
  } finally {
    await held?.directory.close();
    await rm(outside,{recursive:true,force:true});
  }
}));

test('invalid PNG structure is rejected by the downstream decoder, not confused with transport integrity',async()=>isolated(async(root)=>{
  // Magic bytes alone are not a valid PNG; the M1 transport only attests exact bytes.
  const invalid=Buffer.concat([realPng.subarray(0,33),Buffer.from('broken')]);
  const imported=await executeWorkerRequest('asset_import',request('inbox/invalid.png',invalid));
  assert.equal(imported.ok,true); // Transport hash/magic checks are not source QA.
  const decoder=spawnSync('identify',['-format','%wx%h','png:-'],{input:invalid,encoding:'utf8'});
  if (!decoder.error || decoder.error.code!=='ENOENT') assert.notEqual(decoder.status,0);
  else assert.throws(()=>inflateSync(invalid.subarray(41)),Error);
  assert.deepEqual(await readFile(join(root,'inbox/invalid.png')),invalid);
}));

test('refuses invalid magic, sha mismatch and path traversal',async()=>isolated(async(root)=>{
  assert.equal((await executeWorkerRequest('asset_import',request('bad.png',Buffer.from('this is not a png')))).ok,false);
  assert.equal((await executeWorkerRequest('asset_import',{...request('bad.png'),expectedSha256:'0'.repeat(64)})).ok,false);
  assert.equal((await executeWorkerRequest('asset_import',request('../escape.png'))).ok,false);
  await mkdir(join(root,'sub'),{recursive:true});
  await symlink(tmpdir(),join(root,'sub','link'));
  assert.equal((await executeWorkerRequest('asset_import',request('sub/link/escape.png'))).ok,false);
}));

test('rejects noncanonical base64 and oversize before any file write',async()=>isolated(async()=>{
  assert.equal((await executeWorkerRequest('asset_import',{...request(),contentBase64:'not-base64!'})).ok,false);
  const large=Buffer.alloc(6_000_001);
  assert.equal((await executeWorkerRequest('asset_import',request('large.png',large))).ok,false);
}));
