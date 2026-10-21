#!/usr/bin/env node
// Operator-side launcher. Never run inside an untrusted workspace/executor.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const config = path.join(root, 'compose.ci.yaml');
const usage = 'Usage: node scripts/local-ci.mjs <doctor|run> --repo <trusted-checkout> [--profile node-basic|node-build] [--cache <path>] [--reports <path>]';
export function parseArgs(args) {
  const command = args.shift();
  if (!['doctor', 'run'].includes(command)) throw new Error(usage);
  const parsed = { command, profile: 'node-basic' };
  const supplied = new Set();
  while (args.length) {
    const key = args.shift();
    if (!['--repo', '--profile', '--cache', '--reports'].includes(key) || !args.length) throw new Error(usage);
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new Error(usage);
    const field = key.slice(2);
    if (supplied.has(field)) throw new Error('Duplicate flag: ' + key);
    supplied.add(field);
    parsed[field] = value;
  }
  if (!parsed.repo) throw new Error('--repo is required');
  if (!['node-basic', 'node-build'].includes(parsed.profile)) throw new Error('Invalid profile');
  return parsed;
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export function resolveOptions(options, { home = os.homedir() } = {}) {
  const repo = fs.realpathSync(path.resolve(options.repo));
  if (!fs.statSync(repo).isDirectory() || !fs.existsSync(path.join(repo, '.git'))) {
    throw new Error('Source must be a Git checkout directory');
  }
  if (!fs.existsSync(path.join(repo, 'package.json'))) throw new Error('Expected a Node project (package.json)');
  const base = path.resolve(home, '.cloudharness-local-ci');
  const cache = path.resolve(options.cache || path.join(base, 'cache'));
  const reports = path.resolve(options.reports || path.join(base, 'reports'));
  for (const [name, dir] of [['cache', cache], ['reports', reports]]) {
    if (inside(repo, dir) || inside(dir, repo)) throw new Error(name + ' must be outside the checkout');
    fs.mkdirSync(dir, { recursive: true });
  }
  const realCache = fs.realpathSync(cache);
  const realReports = fs.realpathSync(reports);
  if (inside(repo, realCache) || inside(realCache, repo) || inside(repo, realReports) || inside(realReports, repo)) {
    throw new Error('Cache and reports must resolve outside the checkout');
  }
  if (inside(realCache, realReports) || inside(realReports, realCache)) throw new Error('Cache and reports must be separate');
  return { repo, cache: realCache, reports: realReports, profile: options.profile,
    hasLockfile: fs.existsSync(path.join(repo, 'package-lock.json')) || fs.existsSync(path.join(repo, 'npm-shrinkwrap.json')) };
}

export function dockerArgs(action, profile) {
  const base = ['compose', '-f', config, '--profile', 'ci'];
  if (action === 'config') return [...base, 'config', '--quiet'];
  if (action === 'build') return [...base, 'build', 'ci-worker'];
  if (action === 'run') return [...base, 'run', '--rm', '--no-deps', '-T', 'ci-worker', profile];
  throw new Error('Unsupported action');
}

export function launch(action, profile, env) {
  const result = spawnSync('docker', dockerArgs(action, profile), { env, stdio: 'inherit', shell: false });
  if (result.error) throw new Error('Docker unavailable: ' + result.error.message);
  return result.status ?? 1;
}

export function main(argv) {
  const parsed = parseArgs([...argv]);
  const options = resolveOptions(parsed);
  const env = {
    ...process.env, CI_WORKTREE_HOST: options.repo, CI_CACHE_HOST: options.cache,
    CI_REPORT_HOST: options.reports
  };
  const configStatus = launch('config', options.profile, env);
  if (configStatus !== 0) return configStatus;
  if (parsed.command === 'doctor') {
    console.log('CI_COMPOSE_CONFIG_PASS; repo=' + options.repo);
    console.log('CACHE=' + options.cache + '; REPORTS=' + options.reports);
    console.log('INSTALL_MODE=' + (options.hasLockfile ? 'npm ci (lockfile)' : 'npm install --no-package-lock --no-save (non-reproducible: no lockfile)'));
    return 0;
  }
  const buildStatus = launch('build', options.profile, env);
  if (buildStatus !== 0) return buildStatus;
  return launch('run', options.profile, env);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error('LOCAL_CI_ERROR:', error.message); process.exitCode = 1; }
}
