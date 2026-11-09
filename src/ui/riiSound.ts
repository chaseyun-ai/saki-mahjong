import { audio } from './sound';
import { RII_CLIPS, RiiClip } from './riiClips';
import { BREAK, GOLD, LOCK, PADLOCK, QUICK_LOCK, SKY, chainPlan, skyStart, vanishTime } from './riiChainPlan';
import { padlockSlam } from './riiPadlock';
import { RiiSfxId, riiLook } from './riiLook';

// 白水哩番缚的声音：效果音ラボ的真实录音（riiClips.ts）按画面的时间排起来放（时间照 riiChainPlan.ts）。
// 只用干净的几段（锁链甩过来、锡杖的金属环、锁扣、钥匙落地、闪光、风铃、消散），宽频沙沙的那种都不用；
// 光、粒子是把闪光和风铃切成一颗颗很短的“叮”，按画面上粒子出现的时间撒开、音高跟着往上冲。
// 两套可以挑（riiLook.sfx）：写实（金属声多一点）/ 闪亮（更亮、更像动画的光效）。
// 锁上：每条锁链甩过来“锵”地压上手牌；大锁落下“哐”一声、锁扣“咔哒”；锁链化开；锁挂到头像上。
// 结算：拿到钥匙——变金时一股往上收的光、“叮”地碎成金片、一串金色的小叮往天上冲、放晴时风铃、钥匙“叮当”落下；
// 没和成——锁链抖着哗啦作响、“锵”地崩断、碎片叮叮落开、一节节碎成细碎的光点慢慢散掉；
// 番数不够——轻轻往下一沉（这一声是合成的）。

interface Cue {
  clip: RiiClip;
  at: number; // 秒（从 t0 算）。默认这一声最响的那一下对在这个时间上
  align?: 'peak' | 'start'; // start：从声音一起头（给了 from 就是 from）对齐
  from?: number; // 从录音的第几秒开始放（切一小颗用）
  dur?: number; // 只放这么长（录音里的秒），尾巴淡掉
  swell?: number; // 倒着放这么多秒、越来越响，最响的那一下（原来的起音）正好落在 at 上
  gain?: number;
  rate?: number | [number, number]; // 放快放慢（音高跟着变）；给一个范围就每次随机
  pan?: number;
  lp?: number; // 低通（Hz），去掉刺耳的高频
  hp?: number; // 高通（Hz），去掉闷的低频
}

interface Clip {
  buf: AudioBuffer;
  peak: number;
  onset: number;
}

const loaded = new WeakMap<BaseAudioContext, Promise<Map<RiiClip, Clip>>>();
const buses = new WeakMap<BaseAudioContext, AudioNode>();
const reversed = new WeakMap<AudioBuffer, AudioBuffer>();

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
  for (let i = 0; i < d.length; i += w) {
    let s = 0;
    for (let j = i; j < Math.min(d.length, i + w); j++) s += Math.abs(d[j]);
    if (s > best) {
      best = s;
      at = i;
    }
  }
  let onset = 0;
  for (let i = 0; i < d.length; i += w) {
    let s = 0;
    for (let j = i; j < Math.min(d.length, i + w); j++) s += Math.abs(d[j]);
    if (s > best * 0.1) {
      onset = i;
      break;
    }
  }
  return { peak: at / buf.sampleRate, onset: onset / buf.sampleRate };
}

function reverse(a: BaseAudioContext, buf: AudioBuffer): AudioBuffer {
  let r = reversed.get(buf);
  if (!r) {
    r = a.createBuffer(1, buf.length, buf.sampleRate);
    const src = buf.getChannelData(0);
    const dst = r.getChannelData(0);
    for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
    reversed.set(buf, r);
  }
  return r;
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
  const len = clip.buf.duration;
  let buf = clip.buf;
  let start: number;
  let end: number;
  let ref: number;
  if (c.swell) {
    buf = reverse(a, clip.buf);
    end = len - clip.peak;
    start = Math.max(0, end - c.swell * rate);
    ref = end;
  } else {
    start = Math.min(len, c.from ?? 0);
    end = c.dur !== undefined ? Math.min(len, start + c.dur) : len;
    ref = c.align === 'start' ? (c.from ?? clip.onset) : Math.min(end, Math.max(start, clip.peak));
  }
  let when = t0 + c.at - (ref - start) / rate;
  let offset = start;
  // 晚了（解码慢了一点、或者对齐点在开头前面）：从中间接着放，和画面对得上
  if (when < a.currentTime) {
    offset += (a.currentTime - when) * rate;
    when = a.currentTime;
  }
  if (offset >= end - 0.005) return;
  const stop = when + (end - offset) / rate;
  const src = a.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const gain = c.gain ?? 1;
  const g = a.createGain();
  // 从中间切出来的要淡入淡出，不然会“啪”一下
  const fadeIn = c.swell ? (stop - when) * 0.5 : offset > 0.002 ? 0.004 : 0;
  const fadeOut = c.swell ? 0.012 : c.dur !== undefined ? Math.min(0.05, (stop - when) * 0.4) : 0;
  if (fadeIn > 0) {
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + fadeIn);
  } else g.gain.setValueAtTime(gain, when);
  if (fadeOut > 0) {
    g.gain.setValueAtTime(gain, Math.max(when + fadeIn, stop - fadeOut));
    g.gain.linearRampToValueAtTime(0, stop);
  }
  let node: AudioNode = src;
  if (c.hp) node = node.connect(filter(a, 'highpass', c.hp));
  if (c.lp) node = node.connect(filter(a, 'lowpass', c.lp));
  node = node.connect(g);
  if (c.pan && a.createStereoPanner) {
    const p = a.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, c.pan));
    node = node.connect(p);
  }
  node.connect(out(a));
  src.start(when, offset);
  src.stop(stop + 0.01);
}

function filter(a: BaseAudioContext, type: BiquadFilterType, hz: number): BiquadFilterNode {
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = 0.7;
  return f;
}

// 排一串声音：t0 是现在（解码要是还没好，等好了照原来的时间接上）
function schedule(a: BaseAudioContext, t0: number, cues: Cue[]): Promise<void> {
  return loadClips(a)
    .then((clips) => cues.forEach((c) => play(a, clips, t0, c)))
    .catch(() => undefined);
}

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

// 录音里干净的“叮”在哪：闪光一起头、风铃里敲得清楚的几下、钥匙落地弹的几下、锡杖上的环
const KIRA_TING = [0.1, 0.16, 0.24];
const CHIME_TING = [0.74, 0.99, 1.48, 2.85, 3.0];
const KEY_TING = [0, 0.3, 0.5];
const RING = [0.1, 0.16, 0.22, 0.3, 0.36, 0.42, 0.5];

// 一团粒子：count 颗很短的叮均匀地撒在 [at, at+span] 里。rise：先响后轻、音高越来越高（往上冲）；even：音高随机；grow：越来越密越来越响；fade：越来越轻（散掉）
interface Sparks {
  clip: RiiClip;
  from: number[];
  dur: [number, number];
  at: number;
  span: number;
  count: number;
  rate: [number, number];
  gain: number;
  shape: 'rise' | 'even' | 'grow' | 'fade';
  spread?: number;
  lp?: number;
  hp?: number;
}

function sparks(s: Sparks): Cue[] {
  return Array.from({ length: s.count }, (_, i) => {
    const u = (i + Math.random()) / s.count;
    const env = s.shape === 'rise' ? Math.sin(Math.PI * Math.min(0.97, 0.18 + u * 0.85)) : s.shape === 'grow' ? 0.3 + 0.7 * u : s.shape === 'fade' ? 1 - 0.85 * u : 1;
    const r = s.rate[0] + (s.rate[1] - s.rate[0]) * (s.shape === 'even' || s.shape === 'fade' ? Math.random() : u);
    return {
      clip: s.clip,
      at: s.at + s.span * (s.shape === 'grow' ? Math.sqrt(u) : u),
      align: 'start' as const,
      from: pick(s.from) + rnd(0, 0.01),
      dur: rnd(s.dur[0], s.dur[1]),
      rate: r * rnd(0.95, 1.05),
      gain: s.gain * env * rnd(0.7, 1),
      pan: rnd(-1, 1) * (s.spread ?? 0.6),
      lp: s.lp,
      hp: s.hp,
    };
  });
}

const CONTACT = 1 - Math.cbrt(0.5); // 锁链头走到手牌：easeOut(u) = 一半

// 一条锁链甩过来压上手牌：甩过来的风声，压上时锡杖那一下金属声（只要前面一小段，不要后面的沙沙）
function shootCues(set: RiiSfxId, start: number, fly: number, i: number, angle: number, x: number, vol: number): Cue[] {
  const at = start + fly * CONTACT;
  const from = Math.cos(angle) * 0.6;
  if (set === 'bright')
    return [
      { clip: 'whip', at: at - 0.015, gain: 0.28 * vol, rate: [1.1, 1.25], pan: from, hp: 250, lp: 7000 },
      { clip: 'tincane', at, dur: 0.22, gain: 0.36 * vol, rate: [1.2, 1.35], pan: x * 0.6, lp: 9000 },
      { clip: 'kira', at: at + 0.01, align: 'start', from: 0.035, dur: 0.2, gain: 0.16 * vol, rate: [1.3, 1.6], pan: x * 0.6 },
    ];
  return [
    { clip: 'whip', at: at - 0.015, gain: 0.34 * vol, rate: [0.92, 1.08], pan: from, hp: 200, lp: 5500 },
    { clip: 'tincane', at, dur: 0.26, gain: 0.5 * vol, rate: [0.9 - i * 0.015, 1.02 - i * 0.015], pan: x * 0.6, lp: 6000 },
  ];
}

function volleyCues(set: RiiSfxId, n: number, quick: boolean): Cue[] {
  const gap = quick ? QUICK_LOCK / Math.max(1, n) / 3 : LOCK.stagger;
  const fly = quick ? QUICK_LOCK * 0.7 : LOCK.fly;
  const vol = (quick ? 0.8 : 1) / Math.sqrt(1 + 0.3 * (Math.max(1, n) - 1));
  return chainPlan(n).flatMap((line, i) => shootCues(set, i * gap, fly, i, line.angle, line.x, vol));
}

// 大锁落下锁死：落下来的风声，“哐”（锡杖放慢，沉一点），锁扣“咔哒”
function slamCues(set: RiiSfxId, at: number): Cue[] {
  if (set === 'bright')
    return [
      { clip: 'whip', at: at - 0.03, gain: 0.22, rate: 0.9, hp: 200, lp: 6000 },
      { clip: 'tincane', at, dur: 0.45, gain: 0.7, rate: 0.72, lp: 6000 },
      { clip: 'keyin', at: at + 0.06, gain: 0.4, rate: 1.1 },
      { clip: 'kira', at: at + 0.08, gain: 0.32 },
    ];
  return [
    { clip: 'whip', at: at - 0.03, gain: 0.28, rate: 0.75, hp: 150, lp: 4500 },
    { clip: 'tincane', at, dur: 0.42, gain: 0.85, rate: 0.6, lp: 3500 },
    { clip: 'keyin', at: at + 0.07, gain: 0.65 },
  ];
}

// 锁链化开、锁挂到头像上
function settleCues(set: RiiSfxId, n: number): Cue[] {
  const v = vanishTime(n);
  const on = v + PADLOCK.fly;
  if (set === 'bright')
    return [
      ...sparks({ clip: 'chime', from: CHIME_TING, dur: [0.1, 0.18], at: v, span: 0.5, count: 9, rate: [1.3, 1.8], gain: 0.1, shape: 'even', hp: 2000 }),
      { clip: 'kira', at: on, gain: 0.32, rate: 1.2 },
    ];
  return [
    { clip: 'warp', at: v, align: 'start', gain: 0.2, lp: 5000 },
    ...sparks({ clip: 'kira', from: KIRA_TING, dur: [0.05, 0.09], at: v, span: 0.45, count: 7, rate: [1.6, 2.2], gain: 0.12, shape: 'even' }),
    { clip: 'keyin', at: on, gain: 0.4, rate: 1.2 },
  ];
}

// 拿到钥匙：变金（一股往上收的光）→ 碎成金片（叮）→ 金片拖着光往天上冲（一串越来越高的小叮）→ 放晴（风铃、星光一闪一闪）→ 钥匙落下
function keyCues(set: RiiSfxId, t: number): Cue[] {
  const crack = t + GOLD.show + GOLD.sweep;
  const rise = crack + GOLD.crack;
  const sky = t + skyStart();
  const land = sky + SKY.clear * 0.6 + SKY.fall;
  const stars = (count: number, gain: number) =>
    sparks({ clip: 'kira', from: KIRA_TING, dur: [0.25, 0.4], at: sky + 0.5, span: SKY.fall - 0.6, count, rate: [1.5, 2.1], gain, shape: 'even', spread: 0.8 });
  if (set === 'bright')
    return [
      { clip: 'kira', at: crack, swell: 0.85, gain: 0.5 },
      { clip: 'chime', at: crack, swell: 0.6, gain: 0.25, hp: 1500 },
      { clip: 'kira', at: crack, gain: 0.6 },
      { clip: 'kira', at: crack + 0.02, gain: 0.3, rate: 1.5 },
      ...sparks({ clip: 'kira', from: KIRA_TING, dur: [0.1, 0.2], at: rise - 0.1, span: GOLD.rise + 0.1, count: 26, rate: [1.2, 2.6], gain: 0.15, shape: 'rise', spread: 0.8 }),
      ...sparks({ clip: 'chime', from: CHIME_TING, dur: [0.12, 0.22], at: rise, span: GOLD.rise, count: 10, rate: [1.1, 1.9], gain: 0.12, shape: 'rise', spread: 0.8, hp: 1500 }),
      { clip: 'chime', at: sky, align: 'start', gain: 0.5, lp: 13000 },
      ...stars(5, 0.13),
      { clip: 'keydrop', at: land, gain: 0.7 },
      { clip: 'kira', at: land + 0.02, align: 'start', from: 0.035, dur: 0.4, gain: 0.15, rate: 2 },
    ];
  return [
    { clip: 'kira', at: crack, swell: 0.75, gain: 0.42 },
    { clip: 'kira', at: crack, gain: 0.5 },
    { clip: 'keydrop', at: crack, align: 'start', from: 0, dur: 0.3, gain: 0.3, rate: 1.45 },
    ...sparks({ clip: 'chime', from: CHIME_TING, dur: [0.12, 0.22], at: rise - 0.05, span: GOLD.rise, count: 24, rate: [1.0, 2.0], gain: 0.16, shape: 'rise', spread: 0.8, hp: 1500 }),
    { clip: 'chime', at: sky, align: 'start', gain: 0.42, lp: 12000 },
    ...stars(3, 0.12),
    { clip: 'keydrop', at: land, gain: 0.8 },
  ];
}

// 没和成：锁链绷紧抖得哗啦响 → “锵”地崩断、碎片叮叮落开 → 一节节碎成细碎的光点 → 光点越来越稀、散掉
function breakCues(set: RiiSfxId, n: number, t: number): Cue[] {
  const shake = t + BREAK.show;
  const snap = shake + BREAK.crack;
  const tail = snap + BREAK.dissolve * 0.6;
  const fadeSpan = BREAK.dissolve * 0.4 + BREAK.crumble + BREAK.drift * 0.6;
  const dust = Math.min(26, 6 + 4 * Math.max(1, n));
  const rattle = (rate: [number, number], gain: number) =>
    sparks({ clip: 'tincane', from: RING, dur: [0.05, 0.08], at: shake, span: BREAK.crack - 0.03, count: 12, rate, gain, shape: 'grow', spread: 0.5, lp: 7000 });
  const shards = (rate: [number, number], gain: number): Cue[] =>
    KEY_TING.map((from, k) => ({ clip: 'keydrop', at: snap + [0, 0.05, 0.12][k], align: 'start', from, dur: 0.2, gain: gain * [1, 0.7, 0.5][k], rate, pan: [-0.5, 0.4, -0.2][k] }));
  if (set === 'bright')
    return [
      ...rattle([1.25, 1.45], 0.7),
      { clip: 'tincane', at: snap, dur: 0.12, gain: 0.4, rate: 1.6, lp: 9000 },
      { clip: 'kira', at: snap, gain: 0.45, rate: 0.8 },
      ...shards([1.5, 1.9], 0.22),
      ...sparks({ clip: 'chime', from: CHIME_TING, dur: [0.05, 0.1], at: snap + 0.04, span: BREAK.dissolve, count: dust, rate: [1.5, 2.4], gain: 0.08, shape: 'even', spread: 0.8, hp: 2000 }),
      ...sparks({ clip: 'kira', from: KIRA_TING, dur: [0.12, 0.2], at: tail, span: fadeSpan, count: 10, rate: [1.3, 1.9], gain: 0.13, shape: 'fade', spread: 0.8 }),
    ];
  return [
    ...rattle([1.0, 1.2], 0.9),
    { clip: 'tincane', at: snap, dur: 0.16, gain: 0.6, rate: 1.4, lp: 8000 },
    { clip: 'keyin', at: snap + 0.01, gain: 0.45, rate: 0.85 },
    ...shards([1.25, 1.7], 0.32),
    ...sparks({ clip: 'kira', from: KIRA_TING, dur: [0.09, 0.15], at: snap + 0.04, span: BREAK.dissolve, count: dust, rate: [1.6, 2.4], gain: 0.3, shape: 'even', spread: 0.8 }),
    ...sparks({ clip: 'chime', from: CHIME_TING, dur: [0.12, 0.2], at: tail, span: fadeSpan, count: 10, rate: [1.1, 1.6], gain: 0.24, shape: 'fade', spread: 0.8, hp: 1500 }),
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
  void schedule(a, now, [...(fresh ? volleyCues(set, n, true) : []), ...(kind === 'key' ? keyCues(set, t) : breakCues(set, n, t))]);
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
      : [...volleyCues(set, n, true), ...(scene === 'key' ? keyCues(set, 0.6) : breakCues(set, n, 0.6))];
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
