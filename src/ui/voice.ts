import { audio, audioSettings, bus, duckMusic } from './audioBus';
import { VoiceClip, VoiceRef, base64ToBytes, bytesToBase64, encodeWav, parsePack, soundSpan } from './voicePack';
import { isCallKey } from './voiceLines';

// 角色语音：立直、吃碰杠、和牌、能力发动时说一句。
// 游戏本身不带语音：音频是页面主人在素材页里一句句放进去的（src/ui/skins.ts 的语音格子），
// 一个角色一个语音包（voicePack.ts）。没放的角色、没放的那一句就不出声，别的照旧。
// 开局、每局开始时把桌上四个人的包取下来解码好；说话时不等：还没解码好的这一次就不说。

interface Clip {
  buf: AudioBuffer;
  start: number; // 从第几秒开始放（跳过开头的空白，喊牌才跟得上画面）
  dur: number;
  gain: number; // 各人给的音频响度不一样，照最响处拉齐
}

// 语音从三层来，同一句前面的盖过后面的：
//   mine 玩家用素材导入存在浏览器里的、playtest 试玩页素材页放的语音包（素材记录推过来的）、project 项目里 public/custom 的。
// 后两层以外每一句一个文件（src/assets/layers.ts 推过来）。一个角色这几层合起来是哪几句、各从哪来，
// 拼成一个签名：解码好的照签名记，换了哪一句签名就变，自然重新取
let refs: Record<string, VoiceRef> = {};
export type LineSource = { sig: string; load: () => Promise<Uint8Array | null> };
const lineLayers: { mine: Record<string, Record<string, LineSource>>; project: Record<string, Record<string, LineSource>> } = { mine: {}, project: {} };
const packs = new Map<string, Promise<Map<string, Clip>>>();
const ready = new Map<string, Map<string, Clip>>();
// 试玩页的语音包取下来的样子（照包的 id 记），里面每一句都从这里拿
const packTexts = new Map<string, Promise<Record<string, Uint8Array>>>();

export function setVoiceRefs(next: Record<string, VoiceRef>): void {
  refs = next;
}

export function setCustomVoices(layer: 'mine' | 'project', next: Record<string, Record<string, LineSource>>): void {
  lineLayers[layer] = next;
  // 换了素材很少见：解码好的全扔掉，下次要说时照新的重新取
  packs.clear();
  ready.clear();
}

function packClips(id: string): Promise<Record<string, Uint8Array>> {
  let p = packTexts.get(id);
  if (!p) {
    p = (async () => {
      const res = await fetch('/_blob/' + id);
      if (!res.ok) return {};
      const pack = parsePack(await res.text());
      return Object.fromEntries(Object.entries(pack.clips).map(([k, c]) => [k, base64ToBytes(c.data)]));
    })().catch(() => ({}));
    packTexts.set(id, p);
  }
  return p;
}

// 这个角色每一句从哪来
function sourcesOf(charId: string): Map<string, LineSource> {
  const out = new Map<string, LineSource>();
  for (const [k, src] of Object.entries(lineLayers.project[charId] ?? {})) out.set(k, src);
  const ref = refs[charId];
  if (ref) for (const k of ref.lines) out.set(k, { sig: `pack:${ref.id}`, load: () => packClips(ref.id).then((c) => c[k] ?? null) });
  for (const [k, src] of Object.entries(lineLayers.mine[charId] ?? {})) out.set(k, src);
  return out;
}

const sigOf = (sources: Map<string, LineSource>): string =>
  [...sources]
    .map(([k, s]) => `${k}=${s.sig}`)
    .sort()
    .join('|');

// 这个角色放了哪几句（三层合起来）
export const voiceLinesOf = (charId: string): string[] => [...sourcesOf(charId).keys()].sort();

const TARGET_PEAK = 0.85;

async function decodeClip(a: AudioContext, bytes: Uint8Array): Promise<Clip | null> {
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const buf = await a.decodeAudioData(copy);
    const span = soundSpan(buf.getChannelData(0), buf.sampleRate);
    if (!span) return null;
    return { buf, start: span.start, dur: span.end - span.start, gain: Math.min(4, TARGET_PEAK / span.peak) };
  } catch {
    return null;
  }
}

// 把一个角色的每一句取下来解码好。取不到、坏了的那句就没有；返回签名（没有语音是空字符串）
function loadVoices(charId: string): string {
  const sources = sourcesOf(charId);
  const sig = sigOf(sources);
  if (!sig || packs.has(sig)) return sig;
  const p = (async () => {
    const out = new Map<string, Clip>();
    const a = audio();
    if (!a) return out;
    await Promise.all(
      [...sources].map(async ([key, src]) => {
        const bytes = await src.load().catch(() => null);
        const clip = bytes ? await decodeClip(a, bytes) : null;
        if (clip) out.set(key, clip);
      }),
    );
    ready.set(sig, out);
    return out;
  })();
  packs.set(sig, p);
  return sig;
}

// 开局、每局开始：桌上这几个人的语音先解码好
export function preloadVoices(charIds: (string | undefined)[]): void {
  if (audioSettings.voiceMode === 'off') return;
  for (const id of charIds) if (id) loadVoices(id);
}

interface Speaking {
  src: AudioBufferSourceNode;
  gain: GainNode;
  until: number; // AudioContext 的时间
}

// 每个座位正在说的那一句
const speaking = new Map<number, Speaking>();

export interface SayOptions {
  seat?: number; // 哪个座位（同一个座位的新台词打断上一句）
  pan?: number; // 左右声道，和落桌声一样
  delay?: number; // 晚这么多秒再说（一炮多响时错开）
  polite?: boolean; // 她上一句还没说完就不说了（刚喊完“岭上开花”不再补一声“自摸”）
}

// 说一句：keys 是照先后顺序找的台词（先找这个能力单独的那句，没有再找通用的）。
// 说了（或者她正说着上一句、这一句让掉了）返回 true，调用的地方据此把提示音压低一点
export function sayVoice(charId: string, keys: string[], opts: SayOptions = {}): boolean {
  const mode = audioSettings.voiceMode;
  if (mode === 'off') return false;
  // 还没解码好：这一次不说（loadVoices 顺便开始取）
  const sig = loadVoices(charId);
  const clips = sig ? ready.get(sig) : undefined;
  if (!clips) return false;
  const key = keys.find((k) => clips.has(k) && (mode === 'on' || isCallKey(k)));
  if (!key) return false;
  const a = audio();
  if (!a) return false;
  const seat = opts.seat ?? -1;
  const now = a.currentTime;
  const cur = speaking.get(seat);
  if (cur && cur.until > now) {
    if (opts.polite) return true;
    // 打断上一句：很快地收掉，不“啪”一声
    cur.gain.gain.cancelScheduledValues(now);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, now);
    cur.gain.gain.linearRampToValueAtTime(0, now + 0.04);
    cur.src.stop(now + 0.05);
  }
  const clip = clips.get(key)!;
  const at = now + Math.max(0, opts.delay ?? 0);
  const src = a.createBufferSource();
  src.buffer = clip.buf;
  const gain = a.createGain();
  gain.gain.setValueAtTime(clip.gain, at);
  // 收尾淡一下，免得截在波形中间
  gain.gain.setValueAtTime(clip.gain, at + Math.max(0, clip.dur - 0.03));
  gain.gain.linearRampToValueAtTime(0, at + clip.dur);
  let out: AudioNode = src.connect(gain);
  if (opts.pan) {
    const panner = a.createStereoPanner?.();
    if (panner) {
      panner.pan.value = opts.pan;
      out = out.connect(panner);
    }
  }
  out.connect(bus('voice', a));
  src.start(at, clip.start, clip.dur);
  const me: Speaking = { src, gain, until: at + clip.dur };
  speaking.set(seat, me);
  src.onended = () => {
    if (speaking.get(seat) === me) speaking.delete(seat);
  };
  duckMusic(at - now + clip.dur + 0.25);
  return true;
}

// 所有人都停下（离开牌局时）
export function stopVoices(): void {
  for (const s of speaking.values()) {
    try {
      s.src.stop();
    } catch {
      // 已经停了
    }
  }
  speaking.clear();
}

// 素材页里试听：直接放这段字节（刚选的文件、包里已有的都走这里），返回有声的那一截多长（秒）；放不了返回 null
export async function previewVoiceBytes(bytes: Uint8Array): Promise<number | null> {
  const a = audio();
  if (!a) return null;
  const clip = await decodeClip(a, bytes);
  if (!clip) return null;
  stopVoices();
  const src = a.createBufferSource();
  src.buffer = clip.buf;
  const gain = a.createGain();
  gain.gain.value = clip.gain;
  src.connect(gain).connect(bus('voice', a));
  src.start(a.currentTime, clip.start, clip.dur);
  const me: Speaking = { src, gain, until: a.currentTime + clip.dur };
  speaking.set(-1, me);
  src.onended = () => {
    if (speaking.get(-1) === me) speaking.delete(-1);
  };
  return clip.dur;
}

// 声音设置里拖完语音那条滑杆：拿已经解码好的随便一句（优先立直）响一下，听听现在多大。还没有解码好的语音就不出声
export function sampleVoice(): boolean {
  const a = audio();
  if (!a || audioSettings.voiceMode === 'off') return false;
  for (const clips of ready.values()) {
    const clip = clips.get('riichi') ?? clips.values().next().value;
    if (!clip) continue;
    stopVoices();
    const src = a.createBufferSource();
    src.buffer = clip.buf;
    const gain = a.createGain();
    gain.gain.value = clip.gain;
    src.connect(gain).connect(bus('voice', a));
    src.start(a.currentTime, clip.start, clip.dur);
    const me: Speaking = { src, gain, until: a.currentTime + clip.dur };
    speaking.set(-1, me);
    src.onended = () => {
      if (speaking.get(-1) === me) speaking.delete(-1);
    };
    return true;
  }
  return false;
}

// 换了包以后，旧包解码好的那份不用留着
export function forgetVoicePack(id: string): void {
  packTexts.delete(id);
  for (const sig of [...packs.keys()]) {
    if (!sig.includes(`=pack:${id}`)) continue;
    packs.delete(sig);
    ready.delete(sig);
  }
}

// ---------- 素材页里放进一句 ----------

// 一句最长这么多秒（有声的那一截）
export const VOICE_MAX_SECONDS = 12;
// 这么大以内的文件原样存；再大的（没压缩的录音）裁掉前后的空白、转成单声道 WAV 再存
const KEEP_BYTES = 400 * 1024;
const WAV_RATE = 32000;

export type VoiceFileError = 'no_audio' | 'undecodable' | 'silent' | 'too_long';

// 把选的音频文件变成语音包里的一句。放不了时抛 VoiceFileError
export async function clipFromFile(file: Blob): Promise<VoiceClip> {
  const a = audio();
  if (!a) throw 'no_audio' satisfies VoiceFileError;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let buf: AudioBuffer;
  try {
    buf = await a.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
  } catch {
    throw 'undecodable' satisfies VoiceFileError;
  }
  const span = soundSpan(buf.getChannelData(0), buf.sampleRate);
  if (!span) throw 'silent' satisfies VoiceFileError;
  const dur = span.end - span.start;
  if (dur > VOICE_MAX_SECONDS) throw 'too_long' satisfies VoiceFileError;
  if (bytes.length <= KEEP_BYTES) return { type: file.type, data: bytesToBase64(bytes) };
  const off = new OfflineAudioContext(1, Math.ceil(dur * WAV_RATE), WAV_RATE);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start(0, span.start, dur);
  const out = await off.startRendering();
  return { type: 'audio/wav', data: bytesToBase64(encodeWav(out.getChannelData(0), WAV_RATE)) };
}
