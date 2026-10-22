#!/usr/bin/env node
// Operator-only localhost broker for opt-in local Docker CI. Never expose on public interfaces.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const launcher = path.join(path.dirname(currentFile), 'local-ci.mjs');
const allowedProfiles = new Set(['node-basic', 'node-build']);
const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const maxRequestBytes = 4096;

export function loadRegistry(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || !data.repositories || typeof data.repositories !== 'object' || Array.isArray(data.repositories)) throw new Error('Invalid repository registry');
  const entries = Object.entries(data.repositories);
  if (!entries.length || entries.length > 30) throw new Error('Registry must contain 1..30 repositories');
  const registry = new Map();
  for (const [id, value] of entries) {
    if (!idPattern.test(id) || !value || typeof value.path !== 'string' || !path.isAbsolute(value.path)) throw new Error('Invalid repository entry');
    const repo = fs.realpathSync(value.path);
    if (!fs.statSync(repo).isDirectory() || !fs.existsSync(path.join(repo, '.git'))) throw new Error('Repository is not a local Git checkout: ' + id);
    const profiles = value.profiles || ['node-basic'];
    if (!Array.isArray(profiles) || !profiles.length || profiles.some(x => !allowedProfiles.has(x))) throw new Error('Invalid repository profile: ' + id);
    registry.set(id, {repo, profiles: new Set(profiles)});
  }
  return registry;
}

export function createBroker({ token, registry, launch = spawn, now = () => Date.now() }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('CI_BROKER_TOKEN must be at least 32 characters');
  let busy = false;
  const jobs = new Map();
  const authorized = req => {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
    const supplied = Buffer.from(header.slice(7));
    const secret = Buffer.from(token);
    return supplied.length === secret.length && crypto.timingSafeEqual(supplied, secret);
  };
  const send = (res, code, body) => {
    res.writeHead(code, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
    res.end(JSON.stringify(body));
  };
  async function handler(req, res) {
    if (!authorized(req)) return send(res, 401, {error:'UNAUTHORIZED'});
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/v1/ci/health') return send(res, 200, {ok:true, busy, jobs:jobs.size});
    if (req.method === 'GET' && /^\/v1\/ci\/runs\/[a-f0-9-]{36}$/.test(url.pathname)) {
      const id = url.pathname.split('/').at(-1);
      const job = jobs.get(id);
      return job ? send(res, 200, job) : send(res, 404, {error:'NOT_FOUND'});
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/ci/runs') return send(res, 404, {error:'NOT_FOUND'});
    if (busy) return send(res, 409, {error:'CI_BUSY'});
    let raw = '';
    try {
      for await (const chunk of req) {
        raw += chunk.toString('utf8');
        if (Buffer.byteLength(raw) > maxRequestBytes) return send(res, 413, {error:'REQUEST_TOO_LARGE'});
      }
    } catch { return send(res, 400, {error:'BAD_REQUEST'}); }
    let payload;
    try { payload = JSON.parse(raw); } catch { return send(res, 400, {error:'BAD_JSON'}); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !idPattern.test(payload.repoId) || !allowedProfiles.has(payload.profile) || Object.keys(payload).some(k=>!['repoId','profile'].includes(k))) {
      return send(res, 400, {error:'INVALID_INPUT'});
    }
    const entry = registry.get(payload.repoId);
    if (!entry || !entry.profiles.has(payload.profile)) return send(res, 403, {error:'REPOSITORY_OR_PROFILE_NOT_ALLOWED'});
    // Fixed executable and allowlisted arguments; repository selection only from operator registry.
    const id = crypto.randomUUID();
    const job = {id, repoId:payload.repoId, profile:payload.profile, state:'RUNNING', startedAt:new Date(now()).toISOString(), exitCode:null};
    jobs.set(id, job);
    busy = true;
    let proc;
    try {
      proc = launch(process.execPath, [launcher, 'run', '--repo', entry.repo, '--profile', payload.profile], {
        cwd:path.dirname(launcher), stdio:['ignore','ignore','ignore'], env:{...process.env}
      });
    } catch (error) {
      job.state='FAILED'; job.error='PROCESS_START_FAILED'; job.finishedAt=new Date(now()).toISOString(); busy=false;
      return send(res, 500, {error:'PROCESS_START_FAILED'});
    }
    let settled = false;
    const finish = (code, signal, error) => {
      if (settled) return;
      settled=true; busy=false; job.exitCode=Number.isInteger(code)?code:1;
      job.state=job.exitCode===0&&!signal&&!error?'SUCCEEDED':'FAILED';
      job.finishedAt=new Date(now()).toISOString();
      if (error) job.error='PROCESS_ERROR';
    };
    proc.once('error', err => finish(1,null,err));
    proc.once('close', (code,signal)=>finish(code,signal));
    return send(res, 202, {id, state:job.state});
  }
  return {handler, jobs};
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  try {
    const registryFile = process.env.CI_BROKER_REGISTRY;
    const token = process.env.CI_BROKER_TOKEN;
    if (!registryFile) throw new Error('CI_BROKER_REGISTRY is required');
    const registry = loadRegistry(path.resolve(registryFile));
    const {handler} = createBroker({token, registry});
    const port = Number(process.env.CI_BROKER_PORT || 4397);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('CI_BROKER_PORT must be 1024..65535');
    const server = http.createServer((req,res)=>{handler(req,res).catch(()=>{if(!res.headersSent) {res.writeHead(500);res.end();}});});
    server.listen(port, '127.0.0.1', ()=>console.log('Local CI broker listening on loopback port ' + port));
  } catch (err) { console.error('BROKER_START_FAILED:',err.message);process.exitCode=1; }
}
