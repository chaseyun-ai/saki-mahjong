import { audio } from './sound';
import { BREAK, GOLD, LOCK, PADLOCK, QUICK_LOCK, SKY, chainPlan, skyStart, vanishTime } from './riiChainPlan';

// 白水哩番缚的声音，全用 WebAudio 合成（时间和 riiChainPlan.ts 的画面对齐）：
// 锁链一条条“嗖”地射过来、“哐”地压上手牌、链子哗啦一抖；大锁砸下来“咚 咔哒”锁死；锁链消散沙沙地散掉，
// 锁飞到头像上“叮”一下。结算：拿到钥匙——变金时一串上扬的亮音、碎成金片哗地冲上天、天空放晴一片暖和弦、
// 钥匙落下一声钟；没和成——锁链绷紧嘎吱抖、“啪”地崩断、一节节沙沙消散；番数不够——轻轻往下一沉。

let bus: { ctx: AudioContext; in: GainNode } | null = null;
let noiseBuf: AudioBuffer | null = null;

// 番缚的声音先过一个压限，七条锁链叠在一起也不炸
function out(a: AudioContext): AudioNode {
  if (bus?.ctx !== a) {
    const comp = a.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    const g = a.createGain();
    g.gain.value = 0.9;
    g.connect(comp).connect(a.destination);
    bus = { ctx: a, in: g };
  }
  return bus.in;
}

function noise(a: AudioContext): AudioBuffer {
  if (noiseBuf?.sampleRate !== a.sampleRate) {
    const len = a.sampleRate;
    noiseBuf = a.createBuffer(1, len, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

// 左右声道（-1 左到 1 右），pan1 给了就从 pan0 滑到 pan1
function panned(a: AudioContext, node: AudioNode, at: number, dur: number, pan0 = 0, pan1?: number): AudioNode {
  if (!pan0 && pan1 === undefined) return node;
  const p = a.createStereoPanner?.();
  if (!p) return node;
  p.pan.setValueAtTime(clampPan(pan0), at);
  if (pan1 !== undefined) p.pan.linearRampToValueAtTime(clampPan(pan1), at + dur);
  return node.connect(p);
}

const clampPan = (v: number) => Math.max(-1, Math.min(1, v));

interface Hiss {
  type?: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  vol: number;
  attack?: number;
  pan0?: number;
  pan1?: number;
}

// 一团滤过的噪声（风声、沙沙声、碎裂的那一下）
function hiss(a: AudioContext, at: number, dur: number, o: Hiss): void {
  const src = a.createBufferSource();
  src.buffer = noise(a);
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.f0, at);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, at + dur);
  const g = a.createGain();
  const atk = Math.min(dur * 0.9, o.attack ?? 0.004);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(o.vol, at + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  panned(a, src.connect(f).connect(g), at, dur, o.pan0, o.pan1).connect(out(a));
  src.start(at, Math.random() * 0.5);
  src.stop(at + dur + 0.05);
}

// 金属 / 钟：几个不成整数倍的分音一起响，高的衰减得快
function ping(a: AudioContext, at: number, freqs: number[], decay: number, vol: number, pan = 0): void {
  freqs.forEach((f, i) => {
    const osc = a.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = a.createGain();
    const d = decay / (1 + i * 0.45);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol / (1 + i * 0.6), at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + d);
    panned(a, osc.connect(g), at, d, pan).connect(out(a));
    osc.start(at);
    osc.stop(at + d + 0.02);
  });
}

// 往下沉的一声闷响（freq 从 f0 滑到 f1）
function thud(a: AudioContext, at: number, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine'): void {
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, at);
  osc.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(out(a));
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

// 一个小链环碰一下：清脆的“叮”
function clink(a: AudioContext, at: number, vol: number, pan = 0): void {
  const b = 2600 + Math.random() * 1900;
  ping(a, at, [b, b * 1.52], 0.05 + Math.random() * 0.03, vol, pan);
}

// 一串链环哗啦哗啦（from 到 to 秒之间随机 count 下，越来越轻）
function rattle(a: AudioContext, from: number, to: number, count: number, vol: number, pan = 0): void {
  for (let i = 0; i < count; i++) {
    const u = (i + Math.random() * 0.8) / count;
    clink(a, from + (to - from) * u, vol * (1 - u * 0.6), pan + (Math.random() - 0.5) * 0.3);
  }
}

// 锁链压上手牌：“哐”——金属的嗡、一下脆响、一下闷沉，再哗啦一抖
function clank(a: AudioContext, at: number, vol: number, pan: number, pitch = 1): void {
  const b = 820 * pitch * (0.94 + Math.random() * 0.12);
  ping(a, at, [b, b * 1.47, b * 2.09, b * 2.76, b * 3.9], 0.34, 0.16 * vol, pan);
  hiss(a, at, 0.05, { f0: 2400, q: 0.7, vol: 0.45 * vol, pan0: pan });
  thud(a, at, 130, 55, 0.17, 0.32 * vol);
  rattle(a, at + 0.02, at + 0.13, 4, 0.06 * vol, pan);
}

// 一条锁链射过来：“嗖”从画面外那一头扫到另一头，一路链环哗啦
function shoot(a: AudioContext, at: number, fly: number, angle: number, x: number, vol: number, pitch: number): void {
  const from = Math.cos(angle) * 0.8;
  const contact = 1 - Math.cbrt(0.5); // 锁链头走到手牌：easeOut(u) = 一半
  hiss(a, at, fly + 0.05, { f0: 700, f1: 2600, q: 1.1, vol: 0.2 * vol, attack: fly * contact, pan0: from, pan1: -from * 0.6 });
  clank(a, at + fly * contact, vol, x * 0.7, pitch);
  rattle(a, at + fly * (contact + 0.15), at + fly, 4, 0.05 * vol, -from * 0.4);
  // 整条拉直绷住：再碰一下
  clink(a, at + fly, 0.07 * vol, x * 0.6);
}

// 一排锁链射过来（quick：结算时才现出来的，一下子缠好）
function volley(a: AudioContext, at: number, n: number, quick: boolean): void {
  const gap = quick ? QUICK_LOCK / Math.max(1, n) / 3 : LOCK.stagger;
  const fly = quick ? QUICK_LOCK * 0.7 : LOCK.fly;
  chainPlan(n).forEach((line, i) => shoot(a, at + i * gap, fly, line.angle, line.x, quick ? 0.8 : 1, 1 - i * 0.035));
}

// 番缚锁上：锁链一条条射过来（大锁砸下来的那一下是 playLockSlam，跟着大锁的动画响），锁链消散，锁飞到头像上
export function playRiiLock(n: number): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.01;
  volley(a, t, n, false);
  // 锁链消散：沙沙地散掉，几点细碎的亮音
  const v = t + vanishTime(n);
  hiss(a, v, 0.55, { type: 'highpass', f0: 7000, f1: 2600, vol: 0.05, attack: 0.12 });
  for (let i = 0; i < 6; i++) ping(a, v + Math.random() * 0.4, [2200 + Math.random() * 2200], 0.25, 0.025);
  // 锁挂到头像上：“叮”
  const on = t + vanishTime(n) + PADLOCK.fly;
  ping(a, on, [1900, 2850, 4100], 0.4, 0.07);
  clink(a, on + 0.02, 0.05);
}

// 大锁砸下来锁死：一声沉的金属撞击（低频一沉 + 金属的嗡 + 锁扣“咔哒”两下）。delay 秒后响
export function playLockSlam(delay = 0): void {
  const a = audio();
  if (!a) return;
  const at = a.currentTime + Math.max(0, delay);
  thud(a, at, 95, 42, 0.5, 0.55);
  ping(a, at, [523, 784, 1121, 1609], 0.9, 0.08);
  hiss(a, at, 0.08, { f0: 1500, q: 1.2, vol: 0.8 });
  // 锁扣合上：咔、哒
  ping(a, at + 0.005, [3100, 4650], 0.05, 0.12);
  ping(a, at + 0.05, [2500, 3800], 0.045, 0.09);
  rattle(a, at + 0.03, at + 0.2, 5, 0.06);
}

// 结算。delay 秒后锁链开始变金 / 崩断；fresh：锁链先重新射过来（锁好以后消散了，或者是别人的哩）
export function playRiiOutcome(kind: 'key' | 'broken' | 'fade', n: number, delay: number, fresh: boolean): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime + 0.01;
  if (fresh && kind !== 'fade') volley(a, now, n, true);
  const t = now + Math.max(0, delay);
  if (kind === 'key') keySound(a, t);
  else if (kind === 'broken') breakSound(a, t);
  else {
    // 番数不够：轻轻往下一沉，淡掉
    thud(a, t, 494, 247, 0.8, 0.05);
    hiss(a, t, 0.8, { type: 'lowpass', f0: 1400, f1: 300, vol: 0.05, attack: 0.2 });
  }
}

// 拿到钥匙
function keySound(a: AudioContext, t: number): void {
  // 变金：从压住手牌的地方往两头扫开——一串上扬的亮音，细细的沙沙
  [1047, 1319, 1568, 2093].forEach((f, i) => ping(a, t + GOLD.show * 0.5 + i * 0.13, [f, f * 2, f * 3], 0.7, 0.05));
  hiss(a, t + GOLD.show * 0.5, GOLD.sweep + 0.3, { f0: 3000, f1: 8000, q: 2, vol: 0.045, attack: GOLD.sweep });
  // 碎成金色碎片：一阵脆亮的碎响，一声低沉
  const crack = t + GOLD.show + GOLD.sweep;
  hiss(a, crack, 0.14, { type: 'highpass', f0: 3000, vol: 0.28 });
  thud(a, crack, 120, 60, 0.6, 0.22);
  for (let i = 0; i < 14; i++) {
    const f = 2500 + Math.random() * 4000;
    ping(a, crack + Math.random() * 0.28, [f, f * 1.6], 0.12 + Math.random() * 0.1, 0.05 * (1 - i / 20));
  }
  // 冲上天
  hiss(a, crack + GOLD.crack, GOLD.rise, { f0: 600, f1: 5000, q: 0.8, vol: 0.12, attack: GOLD.rise * 0.4 });
  // 天空放晴：一片暖的大和弦慢慢起来，高处一闪一闪
  const sky = t + skyStart();
  [262, 330, 392, 523].forEach((f) => pad(a, sky, f, 2.8, 0.035));
  const stars = [2093, 2349, 2637, 3136, 3520];
  for (let i = 0; i < 10; i++) ping(a, sky + 0.2 + i * 0.2 + Math.random() * 0.1, [stars[Math.floor(Math.random() * stars.length)]], 0.5, 0.022);
  // 钥匙落到手牌上方停住：一声钟，钥匙轻轻晃一下
  const land = sky + SKY.clear * 0.6 + SKY.fall;
  ping(a, land, [1319 * 0.5, 1319, 1319 * 1.19, 1319 * 1.5, 1319 * 2, 1319 * 2.5], 2.2, 0.09);
  clink(a, land + 0.05, 0.05);
  clink(a, land + 0.16, 0.035);
}

// 慢慢起来、慢慢下去的一个音（三角波，柔一点）
function pad(a: AudioContext, at: number, f: number, dur: number, vol: number): void {
  const osc = a.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = f;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.5);
  g.gain.setValueAtTime(vol, at + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(out(a));
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

// 没和成
function breakSound(a: AudioContext, t: number): void {
  // 绷紧发白、抖一下：低低的嘎吱，链环抖得哗啦响，越来越急
  const groan = a.createOscillator();
  groan.type = 'sawtooth';
  groan.frequency.setValueAtTime(70, t);
  groan.frequency.linearRampToValueAtTime(96, t + BREAK.show);
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.08, t + BREAK.show * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + BREAK.show + 0.04);
  groan.connect(lp).connect(g).connect(out(a));
  groan.start(t);
  groan.stop(t + BREAK.show + 0.08);
  for (let i = 0; i < 10; i++) clink(a, t + BREAK.show * (i / 10) ** 0.7, 0.03 + i * 0.006, (Math.random() - 0.5) * 0.8);
  // 崩断：“啪”一下脆响，金属的嗡（不和谐），一声闷
  const snap = t + BREAK.show;
  hiss(a, snap, 0.05, { type: 'highpass', f0: 800, vol: 0.6 });
  ping(a, snap, [1500, 2230, 3170, 4400], 0.42, 0.14);
  thud(a, snap, 140, 50, 0.22, 0.35);
  // 一节节消散：一阵细碎的沙沙，越来越稀
  const fizz = snap + BREAK.crack;
  hiss(a, fizz, BREAK.dissolve, { type: 'highpass', f0: 4000, vol: 0.04, attack: 0.05 });
  for (let i = 0; i < 40; i++) {
    const u = Math.random() ** 1.6;
    ping(a, fizz + u * BREAK.dissolve, [3000 + Math.random() * 4000], 0.03, 0.025 * (1 - u * 0.7), (Math.random() - 0.5) * 1.2);
  }
  // 剩下的化成光冲上天
  hiss(a, fizz + BREAK.dissolve * 0.8, BREAK.rise, { f0: 900, f1: 4000, q: 0.9, vol: 0.06, attack: BREAK.rise * 0.4 });
}
