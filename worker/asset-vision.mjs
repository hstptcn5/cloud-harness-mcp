import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, rm, lstat, realpath } from 'node:fs/promises';
import { basename, dirname, resolve, sep, extname } from 'node:path';

const MAX_ASSET_BYTES = 6_000_000;
const MAX_INLINE_BYTES = 500_000;
const ROOT = () => process.env.HARNESS_WORKSPACE_ROOT || process.env.CH_WORKSPACE_ROOT || '/workspace';
const digest = (b) => createHash('sha256').update(b).digest('hex');
const invalid = (message) => ({ ok: false, message, error: { code: 'INVALID_INPUT', message, retryable: false }, truncated: false });
const success = (message, data) => ({ ok: true, message, data, truncated: false });

export async function safeAssetPath(input, createParent = false) {
  if (typeof input !== 'string' || !input || input === '.') throw new Error('invalid path');
  const normalized = input.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..') || normalized.includes('\0') || /^[a-zA-Z]:/.test(normalized)) throw new Error('path escapes workspace');
  const root = await realpath(ROOT());
  const candidate = resolve(root, normalized);
  if (!candidate.startsWith(root + sep)) throw new Error('path escapes workspace');
  let dir = dirname(candidate);
  while (true) {
    try {
      // Reject symlink components even when they currently resolve inside the root.
      // A later retarget could otherwise redirect a write outside the workspace.
      if ((await lstat(dir)).isSymbolicLink()) throw new Error('symlink parent forbidden');
      const actual = await realpath(dir);
      if (actual !== root && !actual.startsWith(root + sep)) throw new Error('symlink escapes workspace');
      break;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (dir === root) throw e;
      dir = dirname(dir);
    }
  }
  try {
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink()) throw new Error('symlink target forbidden');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!createParent) throw e;
  }
  return candidate;
}

export function imageMetadata(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
    if (buffer.toString('ascii', 12, 16) !== 'IHDR' || !width || !height) throw Error('invalid PNG header');
    return { format: 'png', mimeType: 'image/png', width, height };
  }
  if (buffer.length >= 12 && buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP') {
    let width, height;
    const fourcc=buffer.toString('ascii',12,16);
    if (fourcc==='VP8X' && buffer.length>=30) {
      width=1+buffer.readUIntLE(24,3);height=1+buffer.readUIntLE(27,3);
    } else if (fourcc==='VP8L' && buffer.length>=25 && buffer[20]===0x2f) {
      const packed=buffer.readUInt32LE(21);width=(packed & 0x3fff)+1;height=((packed>>14)&0x3fff)+1;
    } else if (fourcc==='VP8 ' && buffer.length>=30 && buffer[23]===0x9d && buffer[24]===0x01 && buffer[25]===0x2a) {
      width=buffer.readUInt16LE(26)&0x3fff;height=buffer.readUInt16LE(28)&0x3fff;
    }
    if (!width || !height) throw Error('unsupported WebP header');
    return {format:'webp',mimeType:'image/webp',width,height};
  }
  if (buffer.length >= 4 && buffer[0]===0xff && buffer[1]===0xd8) {
    let offset=2;
    while(offset+4<=buffer.length) {
      if(buffer[offset]!==0xff) throw Error('invalid JPEG segment');
      while(buffer[offset]===0xff)offset++;
      const marker=buffer[offset++];
      if(marker===0xd9 || marker===0xda)break;
      if(marker===0x01 || (marker>=0xd0 && marker<=0xd7))continue;
      if(offset+2>buffer.length) break;
      const size=buffer.readUInt16BE(offset); if(size<2 || offset+size>buffer.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if(size<7)break;
        const height=buffer.readUInt16BE(offset+3),width=buffer.readUInt16BE(offset+5);
        if(!width || !height)break;
        return {format:'jpeg',mimeType:'image/jpeg',width,height};
      }
      offset+=size;
    }
    throw Error('unsupported JPEG header');
  }
  throw Error('unsupported image signature');
}

function typeMatches(buffer, kind) {
  if (kind === 'zip') return buffer.length >= 22 && buffer[0]===0x50 && buffer[1]===0x4b && buffer[2]===0x03 && buffer[3]===0x04;
  try { return imageMetadata(buffer).format===kind; } catch { return false; }
}

export async function assetImport(input) {
  const {path,contentBase64,kind,overwrite=false,expectedSha256}=input;
  if(typeof contentBase64!=='string' || contentBase64.length>8_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)) return invalid('invalid canonical base64');
  const bytes=Buffer.from(contentBase64,'base64');
  if(bytes.length===0 || bytes.length>MAX_ASSET_BYTES) return invalid('asset must be 1 to 6000000 bytes');
  if(bytes.toString('base64')!==contentBase64) return invalid('noncanonical base64');
  if(!['png','jpeg','webp','zip'].includes(kind) || !typeMatches(bytes,kind)) return invalid('asset signature does not match declared kind');
  const suffix={png:'.png',jpeg:'.jpg',webp:'.webp',zip:'.zip'}[kind];
  if(extname(path).toLowerCase()!==suffix && !(kind==='jpeg' && extname(path).toLowerCase()==='.jpeg')) return invalid('destination extension mismatch');
  const sha256=digest(bytes);
  if(expectedSha256 && expectedSha256!==sha256) return invalid('SHA-256 does not match');
  let target;
  try {target=await safeAssetPath(path,true);}catch{return invalid('unsafe destination path');}
  const parent=dirname(target);
  await mkdir(parent,{recursive:true,mode:0o700});
  // Re-check after mkdir; never follow a newly introduced symlink.
  try {target=await safeAssetPath(path,true);}catch{return invalid('unsafe destination path');}
  try {await lstat(target); if(!overwrite)return invalid('target already exists');}catch(e){if(e.code!=='ENOENT') {if(e.message==='target already exists')return invalid(e.message);throw e;}}
  const tmp=resolve(parent,`.asset-${process.pid}-${sha256.slice(0,16)}.tmp`);
  try {
    await writeFile(tmp,bytes,{flag:'wx',mode:0o600});
    await rename(tmp,target);
  } finally {await rm(tmp,{force:true});}
  return success('Asset imported',{path,format:kind,sizeBytes:bytes.length,sha256});
}

export async function inspectImage(input) {
  let path;
  try {path=await safeAssetPath(input.path);}catch{return invalid('unsafe or missing image path');}
  const st=await lstat(path);
  if(!st.isFile() || st.size>MAX_ASSET_BYTES)return invalid('image file too large or not a regular file');
  const bytes=await readFile(path);
  let metadata;try {metadata=imageMetadata(bytes);}catch{return invalid('file is not a supported image');}
  if(metadata.width*metadata.height>100_000_000)return invalid('image pixel count exceeds safety limit');
  if(input.includeBase64 && bytes.length>MAX_INLINE_BYTES)return invalid('image too large for inline transfer');
  return success('Image inspected',{path:input.path,...metadata,sizeBytes:bytes.length,sha256:digest(bytes),...(input.includeBase64?{contentBase64:bytes.toString('base64')}:{}),analysis:'Metadata only. Provide contentBase64 to an authorized vision-capable client for semantic analysis.'});
}

export async function compareImages(input) {
  const [a,b]=await Promise.all([inspectImage({path:input.referencePath}),inspectImage({path:input.candidatePath})]);
  if(!a.ok)return a;if(!b.ok)return b;
  const ref=a.data, candidate=b.data;
  return success('Image metadata compared',{reference:ref,candidate,dimensionsMatch:ref.width===candidate.width&&ref.height===candidate.height,formatMatch:ref.format===candidate.format,byteIdentical:ref.sha256===candidate.sha256,perceptualComparisonPerformed:false});
}
