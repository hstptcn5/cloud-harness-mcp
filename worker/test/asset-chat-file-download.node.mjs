import test from 'node:test';
import { Buffer } from 'node:buffer';
const { Response } = globalThis;
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  allowedFileUrl, imageKind, downloadChatImage, ChatFileImportError, MAX_CHAT_IMAGE_BYTES
} from '../../apps/api/src/chat-file-download.ts';

const file = { file_id: 'file_0123456789abcdef', download_url: 'https://files.oaiusercontent.com/temporary?token=secret', mime_type: 'image/png', file_name: 'ember.png' };
const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,73,72,68,82]);
const hash = createHash('sha256').update(png).digest('hex');
const mock = (body=png, options={}) => async (_url, request) => {
  assert.equal(request.redirect, 'manual');
  assert.equal(request.credentials, 'omit');
  return new Response(body, { status:options.status??200, headers:options.headers??{} });
};
const rejectsWith = async (promise, code) => assert.rejects(promise, error => error instanceof ChatFileImportError && error.code === code);

test('accepts exact official file host / rejects other origins and URL tricks', () => {
  assert.equal(allowedFileUrl(file.download_url).hostname, 'files.oaiusercontent.com');
  for (const u of [
    'http://files.oaiusercontent.com/p', 'https://files.oaiusercontent.com.evil.test/p',
    'https://127.0.0.1/p', 'https://169.254.169.254/p',
    'https://user:pass@files.oaiusercontent.com/p', 'https://files.oaiusercontent.com:8443/p',
    'file:///etc/passwd', 'https://evil.test/?next=files.oaiusercontent.com'
  ]) assert.throws(() => allowedFileUrl(u));
});
test('downloads original bytes once; SHA-256 and format preserved', async () => {
  const result = await downloadChatImage(file,{expectedSha256:hash,fetchImpl:mock()});
  assert.deepEqual(result.bytes,png);
  assert.equal(result.sha256,hash);
  assert.equal(result.kind,'png');
  assert.equal(result.mimeType,'image/png');
});
test('rejects incorrect SHA, mismatch MIME and arbitrary file ID', async () => {
  await rejectsWith(downloadChatImage(file,{expectedSha256:'0'.repeat(64),fetchImpl:mock()}),'INVALID_INPUT');
  await rejectsWith(downloadChatImage({...file,mime_type:'image/jpeg'},{fetchImpl:mock()}),'INVALID_INPUT');
  await rejectsWith(downloadChatImage({...file,file_id:''},{fetchImpl:mock()}),'INVALID_INPUT');
});
test('does not fetch from unauthorized domain or unsafe redirect', async () => {
  let sent=0;const network=async()=>{sent++;return new Response(png)};
  await rejectsWith(downloadChatImage({...file,download_url:'https://169.254.169.254/latest'},{fetchImpl:network}),'FORBIDDEN');
  assert.equal(sent,0);
  await rejectsWith(downloadChatImage(file,{fetchImpl:mock(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}),'FORBIDDEN');
});
test('rejects oversized header and streamed body and empty response', async () => {
  await rejectsWith(downloadChatImage(file,{fetchImpl:mock(png,{headers:{'content-length':String(MAX_CHAT_IMAGE_BYTES+1)}})}),'LIMIT_EXCEEDED');
  await rejectsWith(downloadChatImage(file,{fetchImpl:mock(Buffer.alloc(100)),maxBytes:32}),'LIMIT_EXCEEDED');
  await rejectsWith(downloadChatImage(file,{fetchImpl:mock(Buffer.alloc(0))}),'INVALID_INPUT');
});
test('rejects JPEG/WebP inconsistencies, HTML and unavailable temporary URL', async () => {
  assert.equal(imageKind(Buffer.from([0xff,0xd8,0xff])),'jpeg');
  assert.equal(imageKind(Buffer.from('RIFF0000WEBP')),'webp');
  await rejectsWith(downloadChatImage(file,{fetchImpl:mock(Buffer.from('<html>error</html>'))}),'INVALID_INPUT');
  await rejectsWith(downloadChatImage(file,{fetchImpl:mock(null,{status:403})}),'UNAVAILABLE');
});
test('never embeds secret URL in failures or messages', async () => {
  const input={...file,download_url:file.download_url+'&private-token=not-for-logs'};
  await assert.rejects(downloadChatImage(input,{fetchImpl:async()=>{throw Error(input.download_url)}}),
    error=>error instanceof ChatFileImportError && !error.message.includes('private-token'));
});
