import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { executeWorkerRequest } from '../harness-worker.mjs';

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
