import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {createBroker} from '../scripts/local-ci-broker.mjs';

const token = 'test-only-token-value-at-least-32-characters';
async function setup(launch) {
  const broker=createBroker({token, registry:new Map([['demo',{repo:'/opt/trusted-repo',profiles:new Set(['node-basic'])}]]), launch});
  const server=http.createServer(broker.handler);
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const address=server.address();
  let sequence=0;
  const request=async (url, {method='GET',body, authorization='Bearer '+token}={})=>{
    if (method==='POST' && url === '/v1/ci/runs' && body && !body.idempotencyKey) body = {...body,idempotencyKey:'test-request-'+String(++sequence).padStart(6,'0')};
    const response=await fetch('http://127.0.0.1:'+address.port+url,{method,headers:{Authorization:authorization,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status, json:await response.json()};
  };
  return {server, request};
}
test('rejects missing and incorrect token, invalid repo/profile and arbitrary commands', async()=>{
  let calls=0;
  const a=await setup(()=>{calls++; return new EventEmitter();});
  try {
    assert.equal((await a.request('/v1/ci/health',{authorization:''})).status,401);
    assert.equal((await a.request('/v1/ci/health',{authorization:'Bearer wrong'})).status,401);
    assert.equal((await a.request('/v1/ci/runs',{method:'POST',body:{repoId:'nope',profile:'node-basic'}})).status,403);
    assert.equal((await a.request('/v1/ci/runs',{method:'POST',body:{repoId:'demo',profile:'node-build'}})).status,403);
    assert.equal((await a.request('/v1/ci/runs',{method:'POST',body:{repoId:'demo',profile:'node-basic',command:'rm -rf /'}})).status,400);
    assert.equal(calls,0);
  } finally {a.server.close();}
});
test('launches only registered repo and profile, reports state, serializes jobs',async()=>{
  const children=[];
  const a=await setup((bin,args,opts)=>{
    assert.equal(bin,process.execPath);
    assert.deepEqual(args.slice(-4),['--repo','/opt/trusted-repo','--profile','node-basic']);
    assert.ok(!args.includes('shell'));
    const child=new EventEmitter();
    children.push(child);
    return child;
  });
  try {
    const started=await a.request('/v1/ci/runs',{method:'POST',body:{repoId:'demo',profile:'node-basic'}});
    assert.equal(started.status,202);
    assert.match(started.json.id,/^[a-f0-9-]{36}$/);
    const id=started.json.id;
    assert.equal((await a.request('/v1/ci/runs',{method:'POST',body:{repoId:'demo',profile:'node-basic'}})).status,409);
    assert.equal((await a.request('/v1/ci/runs/'+id)).json.state,'RUNNING');
    children[0].emit('close',0,null);
    assert.equal((await a.request('/v1/ci/runs/'+id)).json.state,'SUCCEEDED');
    assert.equal((await a.request('/v1/ci/runs/nope')).status,404);
    const second=await a.request('/v1/ci/runs',{method:'POST',body:{repoId:'demo',profile:'node-basic'}});
    children[1].emit('close',1,null);
    assert.equal((await a.request('/v1/ci/runs/'+second.json.id)).json.state,'FAILED');
  } finally {a.server.close();}
});
test('direct-worker broker: idempotent replay, finish state and bounded report', async()=>{
  let resolveJob;
  let called=0;
  const a=await setup();
  a.server.close();
  const broker=createBroker({
    token, registry:new Map([['demo',{repo:'/opt/trusted-repo',profiles:new Set(['node-basic'])}]]),
    runJob:async()=>{called++;return await new Promise(resolve=>{resolveJob=resolve;});}
  });
  const server=http.createServer(broker.handler);
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const port=server.address().port;
  const headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'};
  const start=async (body)=>{
    const r=await fetch('http://127.0.0.1:'+port+'/v1/ci/runs',{method:'POST',headers,body:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  };
  const query=async path=>{
    const r=await fetch('http://127.0.0.1:'+port+path,{headers});
    return {status:r.status,body:await r.json()};
  };
  try {
    const input={repoId:'demo',profile:'node-basic',idempotencyKey:'same-request-123'};
    const first=await start(input);
    assert.equal(first.status,202);
    const duplicate=await start(input);
    assert.equal(duplicate.status,200);
    assert.equal(duplicate.body.id,first.body.id);
    assert.equal(duplicate.body.replayed,true);
    assert.equal((await start({...input,profile:'node-build'})).status,403);
    assert.equal((await query('/v1/ci/runs/'+first.body.id+'/report')).status,409);
    // Queue a microtask; the broker is already executing the injected worker.
    await new Promise(ok=>setImmediate(ok));
    assert.equal(called,1);
    resolveJob({schema:'cloudharness-local-ci/v1',profile:'node-basic',commitSha:'a'.repeat(40),
      status:'PASS',steps:[{name:'test',status:'PASS',exitCode:0}], warnings:[]});
    await new Promise(ok=>setImmediate(ok));
    assert.equal((await query('/v1/ci/runs/'+first.body.id)).body.state,'SUCCEEDED');
    const report=await query('/v1/ci/runs/'+first.body.id+'/report');
    assert.equal(report.status,200);
    assert.equal(report.body.report.steps[0].status,'PASS');
    assert.equal(Object.hasOwn(report.body.report,'reportPath'),false);
  } finally {server.close();}
});
test('rejects short credentials',()=>assert.throws(()=>createBroker({token:'short',registry:new Map()}),/32/));
