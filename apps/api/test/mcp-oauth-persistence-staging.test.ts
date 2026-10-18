import { describe, expect, it } from 'vitest';
import type { RunnerClient } from '../src/runner-client.js';
import { DownstreamOAuthProvider } from '../src/mcp-gateway/oauth-provider.js';

const issuer='https://authorization.staging.test';
const other='https://unauthorized.staging.test';
const serverId='mcps_abcdefghijklmnopqrstuvwx';
type Saved={blob:string,generation:number}|null;
function mockStore(){
  let saved:Saved=null;
  const changes:Array<{issuer:string,refreshed:boolean}>=[];
  const runner={
    callInternal:async (operation:string,input:Record<string,unknown>)=>{
      if(operation==='mcp_oauth_grant_load')return {ok:true,message:'loaded',data:{grant:saved},truncated:false};
      if(operation==='mcp_oauth_grant_save'){
        if(Number(input.expectedGeneration)!==(saved?.generation??0))return {ok:false,message:'version conflict',error:{code:'CONFLICT',message:'version conflict'},truncated:false};
        saved={blob:String(input.blob),generation:(saved?.generation??0)+1};
        changes.push({issuer:String(input.issuer),refreshed:input.refreshed===true});
        return {ok:true,message:'stored',data:{generation:saved.generation},truncated:false};
      }
      throw Error('unexpected mocked runner operation '+operation);
    }
  } as unknown as RunnerClient;
  return {runner,changes,get saved(){return saved;},setSaved(value:Saved){saved=value;}};
}
function provider(runner:RunnerClient){
  return new DownstreamOAuthProvider({
    runner,principal:{kind:'owner',ownerId:'staging-owner'},serverId,scopes:'read',
    manualClient:null,redirectUrl:'https://gateway.staging.test/dashboard/mcp-oauth/callback',
    clientMetadataUrl:null,mode:'background',now:()=>5_000_000
  });
}
describe('staging preflight: S1 persisted OAuth grants',()=>{
  it('persists issuer-bound new tokens, reloads after restart, and refreshes without cross-issuer use',async()=>{
    const store=mockStore();
    const first=provider(store.runner);
    first.saveDiscoveryState({authorizationServerUrl:issuer} as never);
    await first.saveClientInformation({client_id:'staging-client',client_secret:'staging-test-only',issuer} as never);
    await first.saveTokens({access_token:'first',refresh_token:'refresh-one',token_type:'Bearer',expires_in:120,issuer} as never);
    expect(store.saved).not.toBeNull();
    expect(store.changes[0]?.issuer).toBe(issuer);
    const persisted=JSON.parse(store.saved!.blob);
    expect(persisted.clientInformation.issuer).toBe(issuer);
    expect(persisted.tokens.issuer).toBe(issuer);
    const restarted=provider(store.runner);
    expect((await restarted.clientInformation())?.client_id).toBe('staging-client');
    expect((await restarted.tokens())?.access_token).toBe('first');
    await restarted.saveTokens({access_token:'second',token_type:'Bearer',expires_in:120,issuer} as never);
    expect(store.changes[1]).toEqual({issuer,refreshed:true});
    const reloaded=provider(store.runner);
    expect((await reloaded.tokens())?.access_token).toBe('second');
    expect((await reloaded.tokens())?.refresh_token).toBe('refresh-one');
    expect((await reloaded.clientInformation())?.issuer).toBe(issuer);
  });
  it('fails closed for legacy credentials missing issuer and foreign issuer',async()=>{
    for(const credentialIssuer of [undefined,other]){
      const store=mockStore();
      const info={client_id:'legacy-client',client_secret:'secret',...(credentialIssuer?{issuer:credentialIssuer}:{})};
      const tokens={access_token:'legacy',refresh_token:'secret',token_type:'Bearer',...(credentialIssuer?{issuer:credentialIssuer}:{})};
      store.setSaved({generation:1,blob:JSON.stringify({discoveryState:{authorizationServerUrl:issuer},clientInformation:info,tokens})});
      const restart=provider(store.runner);
      expect(await restart.clientInformation()).toBeUndefined();
      expect(await restart.tokens()).toBeUndefined();
      expect(store.changes).toHaveLength(0);
    }
  });
});
