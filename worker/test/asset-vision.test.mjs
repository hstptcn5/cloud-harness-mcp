import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetImport, imageMetadata, inspectImage, compareImages } from '../asset-vision.mjs';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4QgAAAABJRU5ErkJggg==','base64');
test('metadata parses PNG dimensions',()=>assert.deepEqual(imageMetadata(png),{format:'png',mimeType:'image/png',width:1,height:1}));
test('import inspect compare rejects traversal and wrong signature',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vision-tools-'));
 process.env.HARNESS_WORKSPACE_ROOT=root;
 try {
 const good=await assetImport({path:'assets/one.png',contentBase64:png.toString('base64'),kind:'png'});assert.equal(good.ok,true);
 assert.deepEqual(await readFile(join(root,'assets','one.png')),png);
 const inspected=await inspectImage({path:'assets/one.png',includeBase64:true});assert.equal(inspected.data.width,1);assert.equal(inspected.data.contentBase64,png.toString('base64'));
 const bad=await assetImport({path:'../oops.png',contentBase64:png.toString('base64'),kind:'png'});assert.equal(bad.ok,false);
 const wrong=await assetImport({path:'assets/wrong.jpg',contentBase64:png.toString('base64'),kind:'jpeg'});assert.equal(wrong.ok,false);
 const existing=await assetImport({path:'assets/one.png',contentBase64:png.toString('base64'),kind:'png'});assert.equal(existing.ok,false);
 const result=await compareImages({referencePath:'assets/one.png',candidatePath:'assets/one.png'});assert.equal(result.data.byteIdentical,true);
 }finally {await rm(root,{recursive:true,force:true});}
});
