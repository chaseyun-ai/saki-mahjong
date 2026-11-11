import { bus, liveAudio } from './audioBus';
import { customTrack, onMusicStore, slotMeta } from './musicStore';
import { BUILTIN, MusicSlot, RESUMES, TrackInfo, builtinUrl } from './musicTracks';

// 背景音乐的播放：一次只放一首，循环着放，换曲子时一边淡出一边淡入。
// 放哪一首由场景那边说（soundtrack.ts）；这里只管把它放出来，接在音乐总线上（音量、压低都归 audioBus 管）。
//
// 曲子整首解码进内存再循环（AudioBufferSourceNode）：这样循环点接得上，不会像 <audio> 那样每圈空一下。
// 一首三分钟的曲子解码以后几十 MB，所以只留正在放的和上一首，别的用完就放掉。

// 换曲子的交叉淡化（秒）
export const FADE = 1.5;
// 留在内存里的解码好的曲子
const KEEP_BUFFERS = 2;

interface Voice {
  slot: MusicSlot;
  key: string;
  info: TrackInfo | null;
  buf: AudioBuffer;
  src: AudioBufferSourceNode;
  gain: GainNode;
  // 从曲子的 offset 秒处、在出口的 t0 时刻开始放的
  t0: number;
  offset: number;
}

// 场景要放的格子：按先后试，第一个有曲子的放出来；都没有就不放
let want: MusicSlot[] = [];
// 声音设置里的试听：盖在场景上面，停了回到场景的
let preview: MusicSlot | null = null;
let playing: Voice | null = null;
// 浏览器要等玩家点过、按过键才让出声：在那之前只记着要放什么
let unlocked = false;
let token = 0;
// 试过、放不出来的曲子（文件不在、解码不了）：这一次打开页面不再试
const missing = new Set<string>();
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
// 每首曲子上次放到哪了（秒）
const resumeAt = new Map<string, number>();
const listeners = new Set<() => void>();

// 曲子的钥匙：换了文件就是另一首
const trackKey = (slot: MusicSlot): string => {
  const m = slotMeta(slot);
  return m.custom ? `custom:${slot}:${m.stamp}` : `builtin:${slot}`;
};

// 循环着放了 t 秒以后停在曲子的哪里。没给循环点就是整首循环
export function loopPosition(t: number, duration: number, loopStart?: number, loopEnd?: number): number {
  const looped = loopEnd !== undefined && loopEnd > (loopStart ?? 0) && loopEnd <= duration;
  const start = looped ? (loopStart ?? 0) : 0;
  const end = looped ? loopEnd : duration;
  if (!(end > start) || t < 0) return 0;
  return t < end ? t : start + ((t - start) % (end - start));
}

async function builtinBytes(slot: MusicSlot): Promise<ArrayBuffer | null> {
  try {
    const r = await fetch(builtinUrl(slot));
    // 开发服务器对不存在的文件会回一页 HTML
    if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return null;
    return await r.arrayBuffer();
  } catch {
    return null;
  }
}

function load(slot: MusicSlot, key: string, a: AudioContext): Promise<AudioBuffer | null> {
  const have = buffers.get(key);
  if (have) return Promise.resolve(have);
  let p = loading.get(key);
  if (!p) {
    p = (async () => {
      try {
        // 换上的文件被浏览器清掉了：退回内置的
        const own = await customTrack(slot);
        // 解码会把传进去的那块内存拿走，自己的曲子留着原件，传一份拷贝
        const bytes = own ? own.slice(0) : await builtinBytes(slot);
        if (!bytes) return null;
        return await a.decodeAudioData(bytes);
      } catch {
        return null;
      }
    })();
    loading.set(key, p);
    void p.then((buf) => {
      loading.delete(key);
      if (buf) remember(key, buf);
      else missing.add(key);
    });
  }
  return p;
}

function remember(key: string, buf: AudioBuffer): void {
  buffers.delete(key);
  buffers.set(key, buf);
  for (const k of [...buffers.keys()]) {
    if (buffers.size <= KEEP_BUFFERS) break;
    if (k !== key && k !== playing?.key) buffers.delete(k);
  }
}

const levelOf = (slot: MusicSlot, info: TrackInfo | null) => (info?.gain ?? 1) * slotMeta(slot).vol;

function fadeOut(a: AudioContext, v: Voice, fade: number): void {
  const now = a.currentTime;
  if (RESUMES.has(v.slot)) resumeAt.set(v.key, loopPosition(v.offset + now - v.t0, v.buf.duration, v.info?.loopStart, v.info?.loopEnd));
  try {
    v.gain.gain.cancelScheduledValues(now);
    if (fade > 0) {
      v.gain.gain.setTargetAtTime(0, now, fade / 3);
      v.src.stop(now + fade * 2);
    } else {
      v.src.stop();
    }
  } catch {
    // 已经停了
  }
}

function start(a: AudioContext, slot: MusicSlot, key: string, buf: AudioBuffer, fade: number): void {
  const out = bus('music');
  if (!out) return;
  if (playing) fadeOut(a, playing, fade);
  // 自己的曲子没有循环点：整首循环
  const info = key.startsWith('builtin:') ? (BUILTIN[slot] ?? null) : null;
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  if (info?.loopEnd !== undefined && info.loopEnd <= buf.duration) {
    src.loopStart = info.loopStart ?? 0;
    src.loopEnd = info.loopEnd;
  }
  const gain = a.createGain();
  const now = a.currentTime;
  const level = levelOf(slot, info);
  if (fade > 0) {
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(level, now, fade / 3);
  } else {
    gain.gain.value = level;
  }
  src.connect(gain).connect(out);
  const offset = RESUMES.has(slot) ? loopPosition(resumeAt.get(key) ?? 0, buf.duration, info?.loopStart, info?.loopEnd) : 0;
  src.start(now, offset);
  playing = { slot, key, info, buf, src, gain, t0: now, offset };
  remember(key, buf);
}

function stop(a: AudioContext, fade: number): void {
  if (!playing) return;
  fadeOut(a, playing, fade);
  playing = null;
}

async function sync(fade = FADE): Promise<void> {
  const my = ++token;
  if (!unlocked) return;
  const a = liveAudio();
  if (!a) return;
  for (const slot of preview ? [preview] : want) {
    const key = trackKey(slot);
    if (missing.has(key)) continue;
    // 已经在放这一首：接着放
    if (playing?.key === key) return notify();
    const buf = await load(slot, key, a);
    if (my !== token) return;
    if (!buf) continue;
    start(a, slot, key, buf, fade);
    return notify();
  }
  stop(a, fade);
  notify();
}

function notify(): void {
  for (const f of [...listeners]) f();
}

// 场景要放的曲子：一个格子，或者几个格子按先后（前面的没有曲子就放后面的），null 是不放
export function playMusic(slots: MusicSlot | MusicSlot[] | null, fade = FADE): void {
  const next = slots === null ? [] : Array.isArray(slots) ? slots : [slots];
  if (next.length === want.length && next.every((s, i) => s === want[i])) return;
  want = next;
  if (!preview) void sync(fade);
}

// 试听一个格子；null 停掉试听，回到场景本来在放的
export function previewMusic(slot: MusicSlot | null): void {
  if (preview === slot) return;
  preview = slot;
  notify();
  void sync(0.4);
}

// 现在要放的和真的在放的（声音设置、测试用）
export const musicState = () => ({ want: [...want], preview, playing: playing?.slot ?? null });

// 在放的曲子变了就叫一声；返回的函数用来取消
export function onMusic(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const builtinProbe = new Map<MusicSlot, Promise<boolean>>();

// 这个格子内置的曲子文件在不在（只问一下，不下载）
export function hasBuiltin(slot: MusicSlot): Promise<boolean> {
  let p = builtinProbe.get(slot);
  if (!p) {
    p = (async () => {
      if (buffers.has(`builtin:${slot}`)) return true;
      if (missing.has(`builtin:${slot}`)) return false;
      try {
        const r = await fetch(builtinUrl(slot), { method: 'HEAD' });
        // 有的地方不让 HEAD：当它在，放的时候不在再说
        if (r.status === 405 || r.status === 501) return true;
        return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
      } catch {
        return false;
      }
    })();
    builtinProbe.set(slot, p);
  }
  return p;
}

let installed = false;

// 等玩家第一次点、按键以后开始放（整页只接一次）。main.ts 启动时叫
export function installMusic(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // 手指点的时候，浏览器认的是抬起来那一下（pointerup、touchend、click），不是按下去
  const gestures = ['pointerup', 'touchend', 'click', 'keydown'] as const;
  const unlock = () => {
    const a = liveAudio();
    if (!unlocked) {
      unlocked = true;
      void sync(FADE);
    }
    // 出口真的开了才不用再等：有的按键（Esc、组合键）浏览器不算数，下一次再试
    if (a?.state === 'running') for (const g of gestures) window.removeEventListener(g, unlock, true);
  };
  for (const g of gestures) window.addEventListener(g, unlock, true);
  onMusicStore((slot) => {
    const a = liveAudio(false);
    // 只改了正在放的这首的单曲音量：音量跟过去
    if (a && playing && playing.slot === slot && playing.key === trackKey(slot)) {
      playing.gain.gain.cancelScheduledValues(a.currentTime);
      playing.gain.gain.setTargetAtTime(levelOf(slot, playing.info), a.currentTime, 0.05);
      return;
    }
    // 换了曲子、清了曲子：重新看该放哪首
    void sync(0.4);
  });
}
