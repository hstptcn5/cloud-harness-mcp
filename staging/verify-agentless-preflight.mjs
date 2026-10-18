// CI-only preflight. No Docker containers are started; 'docker compose config' only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadRunnerConfig } from '../apps/runner/dist/config.js';
import { WorkspaceService } from '../apps/runner/dist/workspace-service.js';
import { StateStore } from '../apps/runner/dist/state-store.js';
import { TOOL_SPECS } from '@cloud-harness/contracts';

const commit = process.env.STAGING_REVISION;
assert.match(commit ?? '', /^[0-9a-f]{40}$/);
const fixtureRoot='/srv/orion-m1-preflight-fixture';
const env={...process.env, STAGING_REVISION:commit,STAGING_ROOT:fixtureRoot,
  STAGING_PUBLIC_HOST:'orion-staging.example.invalid',
  STAGING_ALLOWED_ORIGIN:'https://orion-staging.example.invalid',
  STAGING_INGRESS_PORT:'39333'};
const raw=execFileSync('docker',['compose','-f','staging/compose.orion-m1-agentless.yaml','config','--format','json'],{env,encoding:'utf8'});
const config=JSON.parse(raw);
assert.equal(config.name,'orion-m1-s1-isolated-staging');
assert.deepEqual(Object.keys(config.services).sort(),['api','ingress','runner']);
for(const [name,service] of Object.entries(config.services)){
  assert.equal(service.env_file,undefined,name+' inherits a runtime .env file');
  assert(!Object.keys(service.environment??{}).some(k=>k.startsWith('AGENT_')),name+' injects Agent');
  assert(!String(service.image).includes('agent'),name+' uses Agent image');
  assert.equal(service.pull_policy,'never',name+' may pull/rebuild an unreviewed image');
  if(name!=='runner') {
    assert.equal(service.read_only,true,name+' root must be read-only');
    assert(service.cap_drop.includes('ALL'));
    assert(service.security_opt.includes('no-new-privileges:true'));
  }
  for(const volume of service.volumes??[]){
    assert.equal(volume.type,'bind');
    if(volume.target==='/var/run/docker.sock'){
      assert.equal(name,'runner');
      assert.equal(volume.source,'/var/run/docker.sock');
    }else{
      assert(volume.source.startsWith(fixtureRoot+'/'),name+' has non-staging bind mount');
    }
  }
}
assert.equal(config.services.api.environment.AUTH_MODE,'owner-bearer');
assert.equal(config.services.runner.environment.AUTH_MODE,'owner-bearer');
assert.equal(config.services.runner.environment.WORKSPACE_NETWORK_PROFILE,'network-none');
assert(!config.services.runner.depends_on?.['model-gateway']);
assert.deepEqual(Object.keys(config.services.runner.environment).filter(k=>k.startsWith('AGENT_')),[]);
const ports=config.services.ingress.ports??[];
assert.equal(ports.length,1);
assert.equal(ports[0].host_ip,'127.0.0.1');
assert.equal(String(ports[0].published),'39333');
assert(config.services.api.networks['image-egress']);
assert(config.services.runner.networks['git-egress']);

// Verify the ACTUAL Runner config loader, not just Compose text. Use no real secrets.
const prev={...process.env};
try{
  for(const key of Object.keys(process.env)) delete process.env[key];
  for(const [key,value] of Object.entries(config.services.runner.environment)) process.env[key]=String(value);
  delete process.env.RUNNER_TOKEN_FILE;
  process.env.RUNNER_TOKEN='s'.repeat(48);
  const loaded=loadRunnerConfig();
  assert.equal(loaded.agents,undefined,'AgentManager must not be initialized');
  assert.equal(loaded.executorImage,'orion-m1-s1-executor:'+commit);
  assert.equal(loaded.networkProfile,'network-none');
  const dir=await mkdtemp(join(tmpdir(),'orion-m1-agentless-'));
  let store;
  try{
    store=new StateStore(join(dir,'state.db'));
    const service=new WorkspaceService(loaded,store);
    assert(TOOL_SPECS.some(t=>t.name==='agent_spawn'),'Agent tool remains discoverable upstream');
    const workspaceId='ws_'+ 'a'.repeat(24);
    for(const [op,input] of [
      ['agent_spawn',{workspaceId,prompt:'no execution',idempotencyKey:'agentless-key',profileId:'default',proxyOperations:['files_read'],ttlSeconds:30,maxOutputBytes:262144,maxInputTokens:10000,maxOutputTokens:2000,maxCostMicros:1000000}],
      ['agent_message',{workspaceId,agentId:'agent_'+'a'.repeat(24),idempotencyKey:'message-key',mode:'steer',message:'no execution'}],
      ['agent_cancel',{workspaceId,agentId:'agent_'+'a'.repeat(24)}],
      ['agent_status',{workspaceId,agentId:'agent_'+'a'.repeat(24)}],
      ['agent_list',{workspaceId}],
      ['agent_logs',{workspaceId,agentId:'agent_'+'a'.repeat(24)}]
    ]){
      try{await service.execute('owner',op,input);assert.fail(op+' unexpectedly succeeded');}
      catch(error){
        assert.equal(error.code,'UNAVAILABLE',op+' must be fail-closed, got '+error.code+': '+error.message);
      }
    }
  }finally{store?.close();await rm(dir,{recursive:true,force:true});}
}finally{
  for(const k of Object.keys(process.env))delete process.env[k];
  Object.assign(process.env,prev);
}
console.log(JSON.stringify({check:'PASS',candidate:commit,services:Object.keys(config.services),agentsEnabled:false,
  agentOperationFailures:6,publishedPorts:ports.length,ingressBind:'loopback-only',
  imageTags:[config.services.api.image,config.services.runner.image,config.services.runner.environment.EXECUTOR_IMAGE]}));
