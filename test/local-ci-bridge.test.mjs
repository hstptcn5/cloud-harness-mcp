import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LocalCiBridge} from '../apps/runner/src/local-ci-bridge.ts';

const endpoint='http://local-ci-broker:4397';
test('local CI is fail-closed unless explicitly enabled and pinned to trusted Docker network',()=>{
  assert.equal(LocalCiBridge.fromEnvironment({}),undefined);
  assert.throws(()=>LocalCiBridge.fromEnvironment({CI_BROKER_ENABLED:'true',CI_BROKER_URL:'http://host.docker.internal:4397',CI_BROKER_TOKEN_FILE:'/nope'}),/trusted internal service/);
  assert.throws(()=>LocalCiBridge.fromEnvironment({CI_BROKER_ENABLED:'true',CI_BROKER_URL:endpoint}),/TOKEN_FILE/);
});
test('bridge calls authenticated, fixed broker route without exposing token in result',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ci-bridge-'));
  try {
    const secret='ci-test-only-secret-1234567890abcdef1234567890';
    const file=path.join(dir,'token');
    fs.writeFileSync(file,secret);
    const captures=[];
    const transport=async(url,options)=>{
      captures.push({url,options});
      return new Response(JSON.stringify({id:'123e4567-e89b-42d3-a456-426614174000',state:'RUNNING'}),{status:202,headers:{'content-type':'application/json'}});
    };
    const bridge=LocalCiBridge.fromEnvironment({CI_BROKER_ENABLED:'true',CI_BROKER_URL:endpoint,CI_BROKER_TOKEN_FILE:file},transport);
    const r=await bridge.execute('ci_run',{repoId:'command-center',profile:'node-basic',idempotencyKey:'ci-test-1234567'});
    assert.equal(r.ok,true);
    assert.equal(r.data.state,'RUNNING');
    assert.equal(captures[0].url,endpoint+'/v1/ci/runs');
    assert.equal(captures[0].options.headers.authorization,'Bearer '+secret);
    assert.deepEqual(JSON.parse(captures[0].options.body),{repoId:'command-center',profile:'node-basic',idempotencyKey:'ci-test-1234567'});
    assert.doesNotMatch(JSON.stringify(r),new RegExp(secret));
    await bridge.execute('ci_status',{runId:'123e4567-e89b-42d3-a456-426614174000'});
    await bridge.execute('ci_report',{runId:'123e4567-e89b-42d3-a456-426614174000'});
    assert.equal(captures[1].url,endpoint+'/v1/ci/runs/123e4567-e89b-42d3-a456-426614174000');
    assert.equal(captures[2].url,endpoint+'/v1/ci/runs/123e4567-e89b-42d3-a456-426614174000/report');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('broker network errors and invalid payload fail closed',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ci-bridge-fail-'));
  try {
    const file=path.join(dir,'token');
    fs.writeFileSync(file,'ci-test-only-secret-1234567890abcdef1234567890');
    const env={CI_BROKER_ENABLED:'true',CI_BROKER_URL:endpoint,CI_BROKER_TOKEN_FILE:file};
    const unavailable=LocalCiBridge.fromEnvironment(env,async()=>{throw new Error('network unreachable')});
    const r=await unavailable.execute('ci_status',{runId:'123e4567-e89b-42d3-a456-426614174000'});
    assert.equal(r.ok,false);
    assert.equal(r.error.code,'UNAVAILABLE');
    const malformed=LocalCiBridge.fromEnvironment(env,async()=>new Response('not-json',{status:200}));
    assert.equal((await malformed.execute('ci_status',{runId:'123e4567-e89b-42d3-a456-426614174000'})).ok,false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
