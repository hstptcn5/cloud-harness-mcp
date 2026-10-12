import { spawn } from 'node:child_process';

/**
 * Sandboxed thumbnail builder. ImageMagick is installed only inside the
 * resource-bounded executor. No URL/file input can reach its command parser:
 * stdin is the only source; stdout is the only destination.
 */
export async function makeImagePreview(original, maxEdge = 1024) {
  if (!Number.isInteger(maxEdge) || maxEdge < 128 || maxEdge > 2048) throw new Error('invalid preview edge');
  const args = ['-define', 'registry:temporary-path=/tmp', '-limit', 'memory', '96MiB', '-limit', 'map', '128MiB',
    '-limit', 'disk', '32MiB', '-limit', 'time', '12', '-',
    '-auto-orient', '-thumbnail', `${maxEdge}x${maxEdge}>`,
    '-strip', '-quality', '76', 'jpeg:-'];
  return await new Promise((resolve, reject) => {
    const child = spawn('convert', args, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', MAGICK_CONFIGURE_PATH: '/etc/ImageMagick-6' } });
    const chunks = [];
    let length = 0, stderr = '', settled = false;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err) reject(err); else resolve(result);
    };
    const timeout = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('preview timeout')); }, 15000);
    child.stdout.on('data', (chunk) => {
      length += chunk.length;
      if (length > 500000) { child.kill('SIGKILL'); finish(new Error('preview exceeds transport budget')); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-512); });
    child.on('error', () => finish(new Error('preview converter unavailable')));
    child.on('close', (code) => {
      if (code !== 0) finish(new Error('thumbnail conversion failed'));
      else finish(null, Buffer.concat(chunks));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(original);
  });
}
