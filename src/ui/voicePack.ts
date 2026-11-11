// 一个角色的语音包：她所有台词的音频装在一个 JSON 里，存成试玩页的一个素材（assets）。
// 试玩页的素材存储不收音频格式，JSON 收，所以把音频的原始字节用 base64 包进去；
// 一个角色一个文件，开局只取桌上四个人的四个文件。
//   { v: 1, clips: { riichi: { type: 'audio/mpeg', data: '<base64>' }, pon: {...}, ... } }
// 这个文件只管包的格式（不碰浏览器的声音接口），测试里直接跑。

export interface VoiceClip {
  type: string; // 音频的类型（audio/mpeg、audio/wav……），只是记一下，解码时浏览器自己认
  data: string; // 原始字节的 base64
}

export interface VoicePack {
  v: 1;
  clips: Record<string, VoiceClip>;
}

// 素材记录（db 的 skins/<角色 id> 里的 voice）：包在哪、里面有哪几句。有哪几句写在记录里，素材页和牌局不用先把包取下来
export interface VoiceRef {
  id: string;
  lines: string[];
}

export const emptyPack = (): VoicePack => ({ v: 1, clips: {} });

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 读回一个包：格式不对的、空的片段都丢掉，读不出来就是空包（不抛错：别人传坏了一个包不该让牌局出错）
export function parsePack(text: string): VoicePack {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyPack();
  }
  const clips = (raw as { clips?: unknown } | null)?.clips;
  const out = emptyPack();
  if (!clips || typeof clips !== 'object') return out;
  for (const [key, c] of Object.entries(clips as Record<string, Partial<VoiceClip> | null>)) {
    if (c && typeof c.data === 'string' && c.data) out.clips[key] = { type: typeof c.type === 'string' ? c.type : '', data: c.data };
  }
  return out;
}

// 放进一句（clip）或拿掉一句（null），返回新的包，原来的不动
export function withClip(pack: VoicePack, key: string, clip: VoiceClip | null): VoicePack {
  const clips = { ...pack.clips };
  if (clip) clips[key] = clip;
  else delete clips[key];
  return { v: 1, clips };
}

export const packLines = (pack: VoicePack): string[] => Object.keys(pack.clips).sort();

export const packText = (pack: VoicePack): string => JSON.stringify(pack);

// 单声道 16 位 WAV。太大的音频（比如没压缩的长录音）在素材页里先转成这个再存
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return out;
}

// 一段声音里真正有声的那一截：前后的空白不算（阈值是最响处的 4%），两头各留一点点。全是静音时返回 null
export function soundSpan(data: Float32Array, sampleRate: number): { start: number; end: number; peak: number } | null {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak < 0.001) return null;
  const floor = peak * 0.04;
  let first = 0;
  while (first < data.length && Math.abs(data[first]) < floor) first++;
  let last = data.length - 1;
  while (last > first && Math.abs(data[last]) < floor) last--;
  const pad = Math.round(sampleRate * 0.012);
  const tail = Math.round(sampleRate * 0.06);
  return { start: Math.max(0, first - pad) / sampleRate, end: Math.min(data.length, last + tail) / sampleRate, peak };
}
