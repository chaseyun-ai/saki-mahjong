// 素材包用的 zip：写的时候不压缩（图片、模型、音频本来就压缩过），读的时候认不压缩和 deflate 两种，
// 所以 Windows 资源管理器“发送到压缩文件夹”、7-Zip 打的包也能直接导入。浏览器和 Node 都能用。

export interface ZipEntry {
  name: string; // 包里的路径，用 / 分隔
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 打包。文件名一律 UTF-8（标志位 11），中文名在哪都不乱码
export function writeZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, e.data);
    centrals.push(central);
    offset += local.length + e.data.length;
  }
  const dirSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + dirSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 没标 UTF-8 的文件名：中文 Windows 打的包是 GBK，先按 UTF-8 试，不行再按 GBK
function decodeName(b: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder().decode(b);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    try {
      return new TextDecoder('gbk').decode(b);
    } catch {
      return new TextDecoder().decode(b);
    }
  }
}

export class ZipError extends Error {}

// 解包。目录和 macOS 的 __MACOSX 垃圾跳过
export async function readZip(zip: Uint8Array): Promise<ZipEntry[]> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError('不是 zip 文件');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new ZipError('zip 目录坏了');
    const flags = v.getUint16(at + 8, true);
    const method = v.getUint16(at + 10, true);
    const csize = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const localAt = v.getUint32(at + 42, true);
    const name = decodeName(zip.subarray(at + 46, at + 46 + nameLen), (flags & 0x0800) !== 0).replace(/\\/g, '/');
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(name)) continue;
    if (flags & 0x0001) throw new ZipError(`${name} 加了密码，解不开`);
    if (csize === 0xffffffff) throw new ZipError('zip 太大了（超过 4 GB）');
    const lNameLen = v.getUint16(localAt + 26, true);
    const lExtraLen = v.getUint16(localAt + 28, true);
    const start = localAt + 30 + lNameLen + lExtraLen;
    const raw = zip.subarray(start, start + csize);
    if (method === 0) out.push({ name, data: raw.slice() });
    else if (method === 8) out.push({ name, data: await inflateRaw(raw) });
    else throw new ZipError(`${name} 用的压缩方式（${method}）认不出，换成普通 zip 再试`);
  }
  return out;
}

export const isZip = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);
