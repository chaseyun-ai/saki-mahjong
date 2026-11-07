import { audio } from './sound';
import { RII_CLIPS, RiiClip } from './riiClips';
import { BREAK, GOLD, LOCK, PADLOCK, QUICK_LOCK, SKY, chainPlan, skyStart, vanishTime } from './riiChainPlan';
import { padlockSlam } from './riiPadlock';
import { RiiSfxId, riiLook } from './riiLook';

// 白水哩番缚的声音：效果音ラボ的真实录音（riiClips.ts）按画面的时间排起来放（时间照 riiChainPlan.ts）。
// 两套可以挑（riiLook.sfx）：写实（锁链、铁门、钥匙的金属声）/ 闪亮（更亮、更像动画的光效）。
// 锁上：每条锁链“咻”地射过来、“哗啦”压上手牌；大锁“哐”地锁死、锁扣“咔哒”；锁链消散；锁挂到头像上。
// 结算：拿到钥匙——变金发光、碎成金片、放晴时一阵风铃、钥匙“叮铃”落下；没和成——链子抖、“咔”地裂开、碎掉、消散；
// 番数不够——轻轻往下一沉（这一声是合成的）。

interface Cue {
  clip: RiiClip;
  at: number; // 秒（从 t0 算）。默认这一声最响的那一下对在这个时间上
  align?: 'peak' | 'start'; // start：从声音一起头对齐
  gain?: number;
  rate?: number | [number, number]; // 放快放慢（音高跟着变）；给一个范围就每次随机
  pan?: number;
}

interface Clip {
  buf: AudioBuffer;
  peak: number;
  onset: number;
}

const loaded = new WeakMap<BaseAudioContext, Promise<Map<RiiClip, Clip>>>();
const buses = new WeakMap<BaseAudioContext, AudioNode>();

function loadClips(a: BaseAudioContext): Promise<Map<RiiClip, Clip>> {
  let p = loaded.get(a);
  if (!p) {
    p = Promise.all(
      (Object.keys(RII_CLIPS) as RiiClip[]).map(async (k) => {
        const bin = atob(RII_CLIPS[k]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const buf = await a.decodeAudioData(bytes.buffer);
        return [k, { buf, ...landmarks(buf) }] as const;
      }),
    ).then((list) => new Map(list));
    loaded.set(a, p);
  }
  return p;
}

// 最响的那一下在哪、从哪里起头（解码以后量，mp3 前面补的一点空白也算进去）
function landmarks(buf: AudioBuffer): { peak: number; onset: number } {
  const d = buf.getChannelData(0);
  const w = Math.max(1, Math.round(buf.sampleRate * 0.004));
  let best = 0;
  let at = 0;
  let max = 0;
  for (let i = 0; i < d.length; i += w) {
    let s = 0;
    for (let j = i; j < Math.min(d.length, i + w); j++) s += Math.abs(d[j]);
    if (s > best) {
      best = s;
      at = i;
    }
    max = Math.max(max, s);
  }
  let onset = 0;
  for (let i = 0; i < d.length; i += w) {
    let s = 0;
    for (let j = i; j < Math.min(d.length, i + w); j++) s += Math.abs(d[j]);
    if (s > max * 0.1) {
      onset = i;
      break;
    }
  }
  return { peak: at / buf.sampleRate, onset: onset / buf.sampleRate };
}

// 番缚的声音先过一个压限，七条锁链叠在一起也不炸
function out(a: BaseAudioContext): AudioNode {
  let bus = buses.get(a);
  if (!bus) {
    const comp = a.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.2;
    const g = a.createGain();
    g.gain.value = 0.9;
    g.connect(comp).connect(a.destination);
    buses.set(a, g);
    bus = g;
  }
  return bus;
}

function play(a: BaseAudioContext, clips: Map<RiiClip, Clip>, t0: number, c: Cue): void {
  const clip = clips.get(c.clip);
  if (!clip) return;
  const rate = Array.isArray(c.rate) ? c.rate[0] + Math.random() * (c.rate[1] - c.rate[0]) : (c.rate ?? 1);
  const ref = (c.align === 'start' ? clip.onset : clip.peak) / rate;
  let when = t0 + c.at - ref;
  let offset = 0;
  // 晚了（解码慢了一点、或者对齐点在开头前面）：从中间接着放，和画面对得上
  if (when < a.currentTime) {
    offset = (a.currentTime - when) * rate;
    when = a.currentTime;
    if (offset >= clip.buf.duration) return;
  }
  const src = a.createBufferSource();
  src.buffer = clip.buf;
  src.playbackRate.value = rate;
  const g = a.createGain();
  g.gain.value = c.gain ?? 1;
  let node: AudioNode = src.connect(g);
  if (c.pan && a.createStereoPanner) {
    const p = a.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, c.pan));
    node = node.connect(p);
  }
  node.connect(out(a));
  src.start(when, offset);
}

// 排一串声音：t0 是现在（解码要是还没好，等好了照原来的时间接上）
function schedule(a: BaseAudioContext, t0: number, cues: Cue[]): Promise<void> {
  return loadClips(a)
    .then((clips) => cues.forEach((c) => play(a, clips, t0, c)))
    .catch(() => undefined);
}

const CONTACT = 1 - Math.cbrt(0.5); // 锁链头走到手牌：easeOut(u) = 一半

// 一条锁链射过来压上手牌
function shootCues(set: RiiSfxId, start: number, fly: number, i: number, angle: number, x: number, vol: number): Cue[] {
  const at = start + fly * CONTACT;
  const from = Math.cos(angle) * 0.6;
  if (set === 'bright')
    return [
      { clip: 'whip', at, gain: 0.45 * vol, rate: [1.1, 1.25], pan: from },
      { clip: 'tincane', at, gain: 0.45 * vol, rate: [1.15, 1.3], pan: x * 0.7 },
    ];
  return [
    { clip: 'whip', at, gain: 0.45 * vol, rate: [0.92, 1.08], pan: from },
    { clip: 'tincane', at: at + 0.004, gain: 0.5 * vol, rate: [0.86 - i * 0.02, 1 - i * 0.02], pan: x * 0.7 },
    { clip: i % 2 ? 'keysB' : 'keysA', at: at + 0.03, align: 'start', gain: 0.25 * vol, rate: [0.95, 1.1], pan: x * 0.5 },
  ];
}

function volleyCues(set: RiiSfxId, n: number, quick: boolean): Cue[] {
  const gap = quick ? QUICK_LOCK / Math.max(1, n) / 3 : LOCK.stagger;
  const fly = quick ? QUICK_LOCK * 0.7 : LOCK.fly;
  return chainPlan(n).flatMap((line, i) => shootCues(set, i * gap, fly, i, line.angle, line.x, quick ? 0.8 : 1));
}

function slamCues(set: RiiSfxId, at: number): Cue[] {
  if (set === 'bright')
    return [
      { clip: 'jail', at, gain: 0.85 },
      { clip: 'tincane', at, gain: 0.6, rate: 0.72 },
      { clip: 'kira', at: at + 0.08, gain: 0.35 },
    ];
  return [
    { clip: 'jail', at, gain: 1 },
    { clip: 'keyin', at: at + 0.06, gain: 0.8 },
    { clip: 'keysB', at: at + 0.02, align: 'start', gain: 0.25 },
  ];
}

// 锁链消散、锁挂到头像上
function settleCues(set: RiiSfxId, n: number): Cue[] {
  const v = vanishTime(n);
  const on = v + PADLOCK.fly;
  if (set === 'bright')
    return [
      { clip: 'chimeShort', at: v, align: 'start', gain: 0.35 },
      { clip: 'kira', at: on, gain: 0.45 },
    ];
  return [
    { clip: 'warp', at: v, align: 'start', gain: 0.45 },
    { clip: 'keyin', at: on, gain: 0.55, rate: 1.1 },
  ];
}

function keyCues(set: RiiSfxId, t: number): Cue[] {
  const crack = t + GOLD.show + GOLD.sweep;
  const sky = t + skyStart();
  const land = sky + SKY.clear * 0.6 + SKY.fall;
  if (set === 'bright')
    return [
      { clip: 'kira', at: t + 0.3, gain: 0.55 },
      { clip: 'holy', at: crack, gain: 0.75 },
      { clip: 'glass', at: crack, gain: 0.45, rate: 1.15 },
      { clip: 'chime', at: sky, align: 'start', gain: 0.7 },
      { clip: 'keydrop', at: land, gain: 0.9 },
    ];
  return [
    { clip: 'holy', at: t + 0.45, gain: 0.6 },
    { clip: 'glass', at: crack, gain: 0.8 },
    { clip: 'chime', at: sky, align: 'start', gain: 0.55 },
    { clip: 'keydrop', at: land, gain: 0.9 },
  ];
}

function breakCues(set: RiiSfxId, t: number): Cue[] {
  const snap = t + BREAK.show;
  const fizz = snap + BREAK.crack;
  if (set === 'bright')
    return [
      { clip: 'crack', at: t + 0.12, gain: 0.7 },
      { clip: 'crack', at: t + 0.24, gain: 0.7, rate: 1.25 },
      { clip: 'glass', at: snap, gain: 1 },
      { clip: 'warp', at: fizz - 0.05, align: 'start', gain: 0.6 },
      { clip: 'chimeShort', at: fizz + 0.3, align: 'start', gain: 0.25, rate: 0.8 },
    ];
  return [
    { clip: 'keysA', at: t, align: 'start', gain: 0.25, rate: 1.1 },
    { clip: 'keysB', at: t + 0.15, align: 'start', gain: 0.4, rate: 1.2 },
    { clip: 'crack', at: t + 0.2, gain: 0.75 },
    { clip: 'glass', at: snap, gain: 0.9, rate: 0.8 },
    { clip: 'tincane', at: snap, gain: 0.55, rate: 0.62 },
    { clip: 'warp', at: fizz, align: 'start', gain: 0.5 },
  ];
}

// 有哩的对局一开始就先把音效解码好，按下番缚时马上能响
export function preloadRiiSound(): void {
  const a = audio();
  if (a) void loadClips(a).catch(() => undefined);
}

// 番缚锁上：锁链一条条射过来，锁链消散，锁挂到头像上（大锁砸下来的那一下是 playLockSlam，跟着大锁的动画响）
export function playRiiLock(n: number): void {
  const a = audio();
  if (!a) return;
  void schedule(a, a.currentTime + 0.01, [...volleyCues(riiLook.sfx, n, false), ...settleCues(riiLook.sfx, n)]);
}

// 大锁砸下来锁死。delay 秒后响
export function playLockSlam(delay = 0): void {
  const a = audio();
  if (!a) return;
  void schedule(a, a.currentTime + Math.max(0, delay), slamCues(riiLook.sfx, 0));
}

// 结算。delay 秒后锁链开始变金 / 崩断；fresh：锁链先重新射过来（锁好以后消散了，或者是别人的哩）
export function playRiiOutcome(kind: 'key' | 'broken' | 'fade', n: number, delay: number, fresh: boolean): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime + 0.01;
  if (kind === 'fade') {
    fadeSound(a, now + Math.max(0, delay));
    return;
  }
  const set = riiLook.sfx;
  const t = Math.max(0, delay);
  void schedule(a, now, [...(fresh ? volleyCues(set, n, true) : []), ...(kind === 'key' ? keyCues(set, t) : breakCues(set, t))]);
}

// 试听（选音效的那一排）：锁上的整段（三条锁链），或者结算时拿到钥匙 / 没和成的整段
export function previewRiiSound(scene: 'lock' | 'key' | 'broken' = 'lock'): void {
  const a = audio();
  if (a) void riiSoundScene(a, scene, riiLook.sfx, 3, a.currentTime + 0.01);
}

// 试听文件、测试用：把一整段排在给的 context 上（离线渲染）
export function riiSoundScene(a: BaseAudioContext, scene: 'lock' | 'key' | 'broken' | 'fade', set: RiiSfxId, n: number, t0 = 0.05): Promise<void> {
  if (scene === 'fade') {
    fadeSound(a, t0);
    return Promise.resolve();
  }
  const cues =
    scene === 'lock'
      ? [...volleyCues(set, n, false), ...slamCues(set, padlockSlam(n) / 1000), ...settleCues(set, n)]
      : [...volleyCues(set, n, true), ...(scene === 'key' ? keyCues(set, 0.6) : breakCues(set, 0.6))];
  return schedule(a, t0, cues);
}

// 番数不够：轻轻往下一沉，淡掉（合成的）
function fadeSound(a: BaseAudioContext, t: number): void {
  const osc = a.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(494, t);
  osc.frequency.exponentialRampToValueAtTime(247, t + 0.8);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
  osc.connect(g).connect(out(a));
  osc.start(t);
  osc.stop(t + 0.82);
  const len = Math.floor(a.sampleRate * 0.85);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1400, t);
  f.frequency.exponentialRampToValueAtTime(300, t + 0.8);
  const ng = a.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.05, t + 0.2);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
  src.connect(f).connect(ng).connect(out(a));
  src.start(t);
}
