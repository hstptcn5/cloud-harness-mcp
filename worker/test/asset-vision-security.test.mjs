import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetImport } from '../asset-vision.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=','base64');
test('binary import rejects mismatched hash and destination extension',async()=>{
 const root=await mkdtemp(join(tmpdir(),'asset-guard-'));
 process.env.HARNESS_WORKSPACE_ROOT=root;
 try {
  const base={path:'out/a.png',kind:'png',contentBase64:png.toString('base64')};
  assert.equal((await assetImport({...base,expectedSha256:'0'.repeat(64)})).ok,false);
  assert.equal((await assetImport({...base,path:'out/a.zip'})).ok,false);
  assert.equal((await assetImport({...base,contentBase64:'!!!'})).ok,false);
  assert.equal((await assetImport({...base,path:'nested/../a.png'})).ok,false);
  await mkdir(join(root,'link'));
  await symlink(join(root,'link'),join(root,'redirect'));
  assert.equal((await assetImport({...base,path:'redirect/escape.png'})).ok,false);
  await mkdir(join(root,'real','nested'),{recursive:true});
  await symlink(join(root,'real'),join(root,'inside-link'));
  assert.equal((await assetImport({...base,path:'inside-link/nested/a.png'})).ok,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('simultaneous no-overwrite imports cannot clobber the first file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'asset-atomic-'));
 process.env.HARNESS_WORKSPACE_ROOT=root;
 try {
  const request={path:'art/mascot.png',kind:'png',contentBase64:png.toString('base64')};
  const outcomes=await Promise.all(Array.from({length:6},()=>assetImport(request)));
  assert.equal(outcomes.filter(result=>result.ok).length,1);
  assert.equal(outcomes.filter(result=>!result.ok && result.message==='target already exists').length,5);
  assert.deepEqual(await readFile(join(root,'art','mascot.png')),png);
 }finally{await rm(root,{recursive:true,force:true});}
});
