// 认文件：看文件头几个字节判断到底是什么（不信扩展名），图片顺便读出宽高，模型读出是不是 VRM、作者和许可。
// 浏览器和 Node（命令行导入）都能用，不碰 DOM。

export type Media = 'image' | 'video' | 'model' | 'audio';

export interface ModelInfo {
  vrm: 0 | 1 | null; // VRM 0.x、VRM 1.0，普通 GLB 是 null
  title?: string;
  author?: string;
  license?: string;
  meshes: number;
  skins: number;
  bones: number; // VRM 的人形骨骼数（普通 GLB 是 0）
}

export interface Sniffed {
  media: Media;
  mime: string;
  ext: string; // 存文件时用的扩展名（不带点）
  bytes: Uint8Array; // 文件内容；试玩页的 .glb.txt（base64）会解码成真正的 GLB
  w?: number;
  h?: number;
  animated?: boolean; // GIF、动图 WebP
  model?: ModelInfo;
  decoded?: boolean; // 从 base64 文本解出来的
}

const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

function pngSize(b: Uint8Array): { w: number; h: number; animated: boolean } | null {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
  // 有 acTL 块的是 APNG
  const head = ascii(b, 0, Math.min(b.length, 4096));
  return { w: u32be(b, 16), h: u32be(b, 20), animated: head.includes('acTL') };
}

function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = b[at + 1];
    // SOF0–SOF15（除了 DHT、JPG、DAC）里写着宽高
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: u16be(b, at + 5), w: u16be(b, at + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    at += 2 + u16be(b, at + 2);
  }
  return null;
}

function webpSize(b: Uint8Array): { w: number; h: number; animated: boolean } | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8X' && b.length >= 30) return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1, animated: (b[20] & 0x02) !== 0 };
  if (chunk === 'VP8 ' && b.length >= 30) return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff, animated: false };
  if (chunk === 'VP8L' && b.length >= 25) {
    const v = u32le(b, 21);
    return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, animated: false };
  }
  return null;
}

function gifInfo(b: Uint8Array): { w: number; h: number; animated: boolean } {
  // 不细数帧：有两个以上的图像描述符（0x2C 跟在图形控制扩展后面）就当动图
  let frames = 0;
  for (let i = 13; i < b.length - 1 && frames < 2; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9) frames++;
  return { w: u16le(b, 6), h: u16le(b, 8), animated: frames > 1 };
}

// GLB：读 JSON 块，看用没用 VRM 扩展，读出名字、作者、许可
export function inspectGlb(b: Uint8Array): ModelInfo | null {
  if (b.length < 20 || ascii(b, 0, 4) !== 'glTF' || u32le(b, 4) !== 2) return null;
  const len = u32le(b, 12);
  if (ascii(b, 16, 4) !== 'JSON' || 20 + len > b.length) return null;
  let json: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    json = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + len)));
  } catch {
    return null;
  }
  const used: string[] = json.extensionsUsed ?? [];
  const ext = json.extensions ?? {};
  const info: ModelInfo = { vrm: null, meshes: json.meshes?.length ?? 0, skins: json.skins?.length ?? 0, bones: 0 };
  if (used.includes('VRMC_vrm') || ext.VRMC_vrm) {
    const v = ext.VRMC_vrm ?? {};
    info.vrm = 1;
    info.title = v.meta?.name;
    info.author = Array.isArray(v.meta?.authors) ? v.meta.authors.join('、') : undefined;
    info.license = v.meta?.licenseUrl;
    info.bones = Object.keys(v.humanoid?.humanBones ?? {}).length;
  } else if (used.includes('VRM') || ext.VRM) {
    const v = ext.VRM ?? {};
    info.vrm = 0;
    info.title = v.meta?.title;
    info.author = v.meta?.author;
    info.license = v.meta?.licenseName && v.meta.licenseName !== 'Other' ? v.meta.licenseName : v.meta?.otherLicenseUrl || v.meta?.licenseName;
    info.bones = (v.humanoid?.humanBones ?? []).length;
  }
  return info;
}

// 试玩页的模型是 base64 文本（.glb.txt）：开头是 "glTF" 的 base64
const B64_GLTF = 'Z2xURg';
function decodeBase64(b: Uint8Array): Uint8Array | null {
  const text = new TextDecoder().decode(b).replace(/\s+/g, '');
  if (!text.startsWith(B64_GLTF)) return null;
  try {
    const raw = atob(text);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// 认不出来就是 null
export function sniff(input: Uint8Array): Sniffed | null {
  const b = input;
  if (b.length < 12) return null;
  const four = ascii(b, 0, 4);
  if (b[0] === 0x89 && four.slice(1) === 'PNG') {
    const s = pngSize(b);
    return { media: 'image', mime: 'image/png', ext: 'png', bytes: b, ...s };
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { media: 'image', mime: 'image/jpeg', ext: 'jpg', bytes: b, ...jpegSize(b) };
  if (four === 'GIF8') return { media: 'image', mime: 'image/gif', ext: 'gif', bytes: b, ...gifInfo(b) };
  if (four === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { media: 'image', mime: 'image/webp', ext: 'webp', bytes: b, ...webpSize(b) };
  if (four === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return { media: 'audio', mime: 'audio/wav', ext: 'wav', bytes: b };
  if (four === 'OggS') return { media: 'audio', mime: 'audio/ogg', ext: 'ogg', bytes: b };
  if (four === 'fLaC') return { media: 'audio', mime: 'audio/flac', ext: 'flac', bytes: b };
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return { media: 'audio', mime: 'audio/mpeg', ext: 'mp3', bytes: b };
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'M4A ' || brand === 'M4B ') return { media: 'audio', mime: 'audio/mp4', ext: 'm4a', bytes: b };
    return { media: 'video', mime: 'video/mp4', ext: 'mp4', bytes: b };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { media: 'video', mime: 'video/webm', ext: 'webm', bytes: b };
  if (four === 'glTF') {
    const model = inspectGlb(b);
    if (!model) return null;
    return { media: 'model', mime: 'model/gltf-binary', ext: model.vrm !== null ? 'vrm' : 'glb', bytes: b, model };
  }
  const glb = decodeBase64(b);
  if (glb) {
    const s = sniff(glb);
    return s && s.media === 'model' ? { ...s, decoded: true } : null;
  }
  return null;
}

export const sizeLabel = (n: number): string => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
