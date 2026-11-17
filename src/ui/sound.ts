// 用 WebAudio 合成的简单音效，不需要音频文件。全部接在音效总线上（audioBus.ts），音量归声音设置里的「音效」管
import { audio, bus } from './audioBus';
import { vary } from './vary';

export { audio };

// 落桌声的几种音色：freq 带通中心（Hz），q 带宽，vol 音量，len 长度（秒），decay 衰减快慢（越大越脆）。
// 第一种是原来那一声；微变化开着时三种轮换（不连着两次同一种），每次再在频率、音量、长度上浮动一点
const CLICKS = [
  { freq: 2200, q: 1, vol: 0.6, len: 0.05, decay: 4 }, // 原来的“啪”
  { freq: 1750, q: 0.8, vol: 0.68, len: 0.058, decay: 3.2 }, // 拍得重一点，闷一点
  { freq: 2700, q: 1.6, vol: 0.5, len: 0.042, decay: 5 }, // 轻放，牌角碰桌的“咔”
];

// 打牌落桌的“啪”。pan 是左右声道（-1 左到 1 右，下家在右、上家在左）；varied 为 true 时随机微变化
export function playClick(opts: { pan?: number; varied?: boolean } = {}): void {
  const a = audio();
  if (!a) return;
  const on = !!opts.varied && vary.on;
  const c = CLICKS[on ? vary.pick('click', CLICKS.length) : 0];
  const freq = on ? c.freq * (1 + vary.bell() * 0.12) : c.freq;
  // ±1.5 dB
  const vol = on ? c.vol * 10 ** ((vary.bell() * 1.5) / 20) : c.vol;
  const len = Math.floor(a.sampleRate * (on ? vary.jitter(c.len, 0.15) : c.len));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** c.decay;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = c.q;
  const gain = a.createGain();
  gain.gain.value = vol;
  let out: AudioNode = src.connect(filter).connect(gain);
  if (on && opts.pan) {
    const panner = a.createStereoPanner?.();
    if (panner) {
      panner.pan.value = opts.pan;
      out = out.connect(panner);
    }
  }
  out.connect(bus('sfx', a));
  src.start();
}

// 能力发动的提示音。vol：角色同时说了台词时压低一点（下面吃碰杠、立直、和牌的也一样）
export function playChime(vol = 1): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  [880, 1320].forEach((f, i) => {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, now + i * 0.08);
    gain.gain.exponentialRampToValueAtTime(0.15 * vol, now + i * 0.08 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.5);
    osc.connect(gain).connect(bus('sfx', a));
    osc.start(now + i * 0.08);
    osc.stop(now + i * 0.08 + 0.55);
  });
}

function tone(a: AudioContext, f: number, start: number, dur: number, vol: number, type: OscillatorType): void {
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = f;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(bus('sfx', a));
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

// 吃碰杠：短促有力的两声
export function playCall(vol = 1): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  tone(a, 196, now, 0.25, 0.25 * vol, 'triangle');
  tone(a, 392, now + 0.06, 0.3, 0.18 * vol, 'square');
  playClick();
}

// 立直：低音加上扬的滑音
export function playRiichi(vol = 1): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.35);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12 * vol, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
  osc.connect(gain).connect(bus('sfx', a));
  osc.start(now);
  osc.stop(now + 0.65);
  tone(a, 110, now, 0.5, 0.3 * vol, 'triangle');
}

// 和牌：上行琶音
export function playWin(vol = 1): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  [523, 659, 784, 1047, 1319].forEach((f, i) => tone(a, f, now + i * 0.07, 0.9, 0.14 * vol, 'triangle'));
  tone(a, 131, now, 1.2, 0.25 * vol, 'sine');
}

// 智叶的居合：出鞘的“铮”。一段往上扫的金属摩擦声，接两个不成倍数的高频泛音，像刀身在震
export function playIaiDraw(): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  const len = Math.floor(a.sampleRate * 0.22);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len) ** 0.6;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 5;
  filter.frequency.setValueAtTime(2400, now);
  filter.frequency.exponentialRampToValueAtTime(9000, now + 0.2);
  const gain = a.createGain();
  gain.gain.value = 0.5;
  src.connect(filter).connect(gain).connect(bus('sfx', a));
  src.start(now);
  [3140, 4710, 6280].forEach((f, i) => {
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = 'sine';
    osc.frequency.value = f * (1 + i * 0.013);
    g.gain.setValueAtTime(0.0001, now + 0.12);
    g.gain.exponentialRampToValueAtTime(0.09 / (i + 1), now + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.15 + 0.9 / (i + 1));
    osc.connect(g).connect(bus('sfx', a));
    osc.start(now + 0.12);
    osc.stop(now + 1.2);
  });
}

// 智叶的居合：拇指把刀镡推开鞘口的一声轻响（很轻，一局里可能响好几回）
export function playIaiPush(): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  const len = Math.floor(a.sampleRate * 0.02);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2900;
  filter.Q.value = 3;
  const gain = a.createGain();
  gain.gain.value = 0.3;
  src.connect(filter).connect(gain).connect(bus('sfx', a));
  src.start(now);
  tone(a, 4200, now + 0.01, 0.16, 0.035, 'sine');
}

// 智叶的居合：收刀的“咔”。刀镡碰到鞘口的一声短促的木头响
export function playIaiSheath(): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  const len = Math.floor(a.sampleRate * 0.035);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 5;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1300;
  filter.Q.value = 2.5;
  const gain = a.createGain();
  gain.gain.value = 0.7;
  src.connect(filter).connect(gain).connect(bus('sfx', a));
  src.start(now);
  tone(a, 240, now, 0.09, 0.22, 'triangle');
}

// 自摸砸牌：牌翻起来炸开的“砰”。一记往下沉的闷响（桌子被震了一下），一声更重、更闷的“啪”，后面卷一阵风
export function playSlam(): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(46, now + 0.2);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.6, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
  osc.connect(gain).connect(bus('sfx', a));
  osc.start(now);
  osc.stop(now + 0.35);
  const len = Math.floor(a.sampleRate * 0.1);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1400;
  filter.Q.value = 0.7;
  const g2 = a.createGain();
  g2.gain.value = 0.9;
  src.connect(filter).connect(g2).connect(bus('sfx', a));
  src.start(now);
  // 旋风：滤过的噪声，频率先往上卷再落下来
  const wl = Math.floor(a.sampleRate * 0.6);
  const wb = a.createBuffer(1, wl, a.sampleRate);
  const wd = wb.getChannelData(0);
  for (let i = 0; i < wl; i++) wd[i] = Math.random() * 2 - 1;
  const ws = a.createBufferSource();
  ws.buffer = wb;
  const wf = a.createBiquadFilter();
  wf.type = 'bandpass';
  wf.Q.value = 1.4;
  wf.frequency.setValueAtTime(500, now);
  wf.frequency.exponentialRampToValueAtTime(2600, now + 0.18);
  wf.frequency.exponentialRampToValueAtTime(700, now + 0.6);
  const wg = a.createGain();
  wg.gain.setValueAtTime(0.0001, now);
  wg.gain.exponentialRampToValueAtTime(0.22, now + 0.06);
  wg.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
  ws.connect(wf).connect(wg).connect(bus('sfx', a));
  ws.start(now);
  ws.stop(now + 0.62);
}

// 宫永照的旋风自摸：一阵卷起来的风声（滤过的噪声，频率先往上卷再落下来），size 0–1，连和越多越响、越长
export function playWhirl(size = 0): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  const dur = 1.3 + 0.6 * size;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  for (const [f0, f1, f2, q, vol] of [
    [320, 1900 + 700 * size, 520, 1.3, 0.2 + 0.12 * size],
    [140, 620, 180, 0.8, 0.14 + 0.1 * size],
  ]) {
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, now);
    filter.frequency.exponentialRampToValueAtTime(f1, now + dur * 0.35);
    filter.frequency.exponentialRampToValueAtTime(f2, now + dur);
    const gain = a.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol, now + dur * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filter).connect(gain).connect(bus('sfx', a));
    src.start(now);
    src.stop(now + dur + 0.02);
  }
}

// 电弧“噼啪”一声：高频的噪声一截一截地断开（像电火花），底下垫一下低沉的“嗡”。vol 0–1
export function playCrackle(vol = 1): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  const dur = 0.22;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  // 一截一截：每 6–20 毫秒换一次开关，开着的时候是噪声，越往后开得越少
  let on = true;
  let next = 0;
  for (let i = 0; i < len; i++) {
    if (i >= next) {
      on = Math.random() < 0.75 - (0.5 * i) / len;
      next = i + Math.floor(a.sampleRate * (0.006 + Math.random() * 0.014));
    }
    data[i] = on ? (Math.random() * 2 - 1) * (1 - i / len) : 0;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const hp = a.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2200;
  const g = a.createGain();
  g.gain.value = 0.32 * vol;
  src.connect(hp).connect(g).connect(bus('sfx', a));
  src.start(now);
  const osc = a.createOscillator();
  const og = a.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(110, now);
  osc.frequency.exponentialRampToValueAtTime(55, now + 0.18);
  og.gain.setValueAtTime(0.0001, now);
  og.gain.exponentialRampToValueAtTime(0.09 * vol, now + 0.01);
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  osc.connect(lp).connect(og).connect(bus('sfx', a));
  osc.start(now);
  osc.stop(now + 0.22);
}

// 天江衣的海底捞月砸进海里：一记闷响，“哗”地一下水被拍开（滤过的噪声，高频很快收掉），后面一串零零落落的水珠落回水面
export function playSplash(): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(38, now + 0.25);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.5, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
  osc.connect(gain).connect(bus('sfx', a));
  osc.start(now);
  osc.stop(now + 0.42);
  // 水被拍开：噪声从亮到暗、慢慢收掉
  const dur = 0.9;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(5200, now);
  filter.frequency.exponentialRampToValueAtTime(500, now + dur);
  filter.Q.value = 0.6;
  const g2 = a.createGain();
  g2.gain.setValueAtTime(0.0001, now);
  g2.gain.exponentialRampToValueAtTime(0.55, now + 0.015);
  g2.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(filter).connect(g2).connect(bus('sfx', a));
  src.start(now);
  // 水珠落回来：一个个往上滑的短音
  for (let i = 0; i < 9; i++) {
    const at = now + 0.25 + Math.random() * 0.7;
    const f = 900 + Math.random() * 1600;
    const o = a.createOscillator();
    const gd = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, at);
    o.frequency.exponentialRampToValueAtTime(f * 1.8, at + 0.06);
    gd.gain.setValueAtTime(0.0001, at);
    gd.gain.exponentialRampToValueAtTime(0.05 * (1 - i / 12), at + 0.004);
    gd.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    o.connect(gd).connect(bus('sfx', a));
    o.start(at);
    o.stop(at + 0.1);
  }
}

// 宫永咲的岭上开花：牌砸下去、旋风卷出去的那一下，一串很轻的高音铃往上走，后面拖一阵风声（花瓣、星光飘起来）。big 0–1：和得越大铃越多、风越长
export function playLily(big = 0): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime + 0.02;
  const notes = [1568, 1976, 2349, 2637, 3136, 3520, 3951].slice(0, 4 + Math.round(big * 3));
  notes.forEach((f, i) => tone(a, f, now + i * 0.065, 1.4, 0.045, 'sine'));
  tone(a, 784, now, 1.6, 0.06, 'sine');
  // 风：滤过的噪声慢慢起来再落下去
  const dur = 1.2 + big * 1.4;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(900, now);
  filter.frequency.linearRampToValueAtTime(2400, now + dur);
  filter.Q.value = 0.9;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.07 + big * 0.05, now + 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(filter).connect(gain).connect(bus('sfx', a));
  src.start(now);
  src.stop(now + dur + 0.05);
}

// ---------- 全自动麻将机（牌桌风格「自动麻将机」，machine.ts） ----------

// 一截滤过的噪声：kind 带通/低通，从 f0 滑到 f1，at 起响 dur 秒，音量 vol（起音很快、慢慢收掉）
function noiseHit(a: AudioContext, at: number, dur: number, vol: number, kind: BiquadFilterType, f0: number, f1 = f0, q = 1): void {
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = kind;
  filter.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(f1, at + dur);
  filter.Q.value = q;
  const gain = a.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(bus('sfx', a));
  src.start(at);
}

// 电机的嗡嗡声：锯齿波加高一个八度的方波，压在低通里，频率从 f0 滑到 f1；前后各淡入淡出一点。
// 上面再叠一串很轻的齿轮“咔咔”声（gears 是每秒几下，0 不要）
function motorHum(a: AudioContext, at: number, dur: number, vol: number, f0: number, f1: number, gears: number): void {
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  lp.Q.value = 0.7;
  const gain = a.createGain();
  const fade = Math.min(0.12, dur / 3);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(vol, at + fade);
  gain.gain.setValueAtTime(vol, at + dur - fade);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  lp.connect(gain).connect(bus('sfx', a));
  for (const [type, mul, v] of [['sawtooth', 1, 1], ['square', 2, 0.35]] as const) {
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0 * mul, at);
    osc.frequency.linearRampToValueAtTime(f1 * mul, at + dur * 0.6);
    g.gain.value = v;
    osc.connect(g).connect(lp);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }
  for (let t = at + 0.05; gears && t < at + dur - 0.05; t += 1 / gears) noiseHit(a, t, 0.012, vol * 0.5, 'bandpass', 2600, 2600, 2);
}

// ---------- 沙滩（牌桌风格「沙滩」，tide.ts）：浪打过来、退潮、沙子聚拢 ----------

// 一段长长的海浪声：白噪声过带通，中心频率从 f0 滑到 f1；音量从很小涨到 vol（peak 秒时最大）再收掉
function surf(a: AudioContext, at: number, dur: number, vol: number, f0: number, f1: number, peak: number, q = 0.7): void {
  const len = Math.max(1, Math.floor(a.sampleRate * (dur + 0.05)));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  // 带一点起伏的噪声：浪里一团团的水声
  let lfo = 0;
  for (let i = 0; i < len; i++) {
    lfo += (Math.random() - 0.5) * 0.02;
    lfo *= 0.999;
    data[i] = (Math.random() * 2 - 1) * (0.75 + Math.min(0.25, Math.abs(lfo) * 4));
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(f0, at);
  filter.frequency.exponentialRampToValueAtTime(f1, at + Math.max(0.05, peak));
  filter.Q.value = q;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(vol, at + Math.max(0.05, peak));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(gain).connect(bus('sfx', a));
  src.start(at);
  src.stop(at + dur + 0.05);
}

// 沙滩的几声：surge 浪从远处涌过来（越来越响的水声，dur 秒），crash 浪头拍下来（哗的一声），
// ebb 退潮（沙沙的回水声，里面一串细碎的气泡破裂声，dur 秒），gather 沙子聚拢（轻轻的沙沙声，dur 秒），settle 最后一墩聚好（很轻的一声闷响）
export function playTide(cue: 'surge' | 'crash' | 'ebb' | 'gather' | 'settle', dur = 0.5): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  if (cue === 'surge') {
    surf(a, now, dur + 0.5, 0.22, 380, 1300, dur * 0.85);
    surf(a, now + 0.05, dur + 0.3, 0.1, 120, 260, dur * 0.8, 0.5);
  } else if (cue === 'crash') {
    noiseHit(a, now, 0.6, 0.28, 'bandpass', 2600, 900, 0.6);
    noiseHit(a, now, 0.35, 0.22, 'lowpass', 380, 140, 0.7);
  } else if (cue === 'ebb') {
    surf(a, now, dur + 0.4, 0.13, 2600, 4800, 0.12, 0.8);
    for (let i = 0; i < 26; i++) noiseHit(a, now + Math.random() * dur, 0.012 + Math.random() * 0.01, 0.05 + Math.random() * 0.07, 'bandpass', 3000 + Math.random() * 4000, undefined, 3);
  } else if (cue === 'gather') {
    surf(a, now, Math.max(0.3, dur), 0.06, 5200, 6800, Math.max(0.1, dur * 0.5), 1.2);
    for (let i = 0; i < 18; i++) noiseHit(a, now + Math.random() * dur, 0.02, 0.04 + Math.random() * 0.04, 'bandpass', 4200 + Math.random() * 2500, undefined, 2);
  } else {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(bus('sfx', a));
    osc.start(now);
    osc.stop(now + 0.2);
    noiseHit(a, now, 0.08, 0.08, 'bandpass', 3800, 2200, 1);
  }
}

// ---------- 草甸（牌桌风格「草甸」，gust.ts）：一阵风刮过来把牌吹成花瓣，轻风再把花瓣送回来 ----------

// 草甸的几声：gust 一阵风刮过来（呼的一声，越来越响再过去，里面一丝细细的风哨，dur 秒），scatter 牌被吹散（花瓣、草叶沙沙一阵），
// breeze 轻风把花瓣送回来（很轻的风声加几下沙沙，dur 秒），land 最后一墩落好（很轻的一声“噗”）
export function playGust(cue: 'gust' | 'scatter' | 'breeze' | 'land', dur = 0.5): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  if (cue === 'gust') {
    surf(a, now, dur + 0.35, 0.2, 260, 1250, dur * 0.5, 0.8);
    surf(a, now + 0.05, dur + 0.2, 0.09, 90, 220, dur * 0.45, 0.6);
    surf(a, now + dur * 0.15, dur * 0.8, 0.025, 1900, 2700, dur * 0.4, 9);
  } else if (cue === 'scatter') {
    for (let i = 0; i < 34; i++) {
      const t = Math.random() * dur;
      noiseHit(a, now + t, 0.02 + Math.random() * 0.03, (0.05 + Math.random() * 0.07) * (1 - (t / dur) * 0.6), 'bandpass', 2600 + Math.random() * 4200, undefined, 1.6);
    }
  } else if (cue === 'breeze') {
    surf(a, now, dur + 0.4, 0.07, 420, 900, dur * 0.5, 0.6);
    for (let i = 0; i < 14; i++) noiseHit(a, now + Math.random() * dur, 0.025, 0.03 + Math.random() * 0.035, 'bandpass', 3200 + Math.random() * 3000, undefined, 1.8);
  } else {
    noiseHit(a, now, 0.12, 0.1, 'lowpass', 520, 180, 0.7);
    noiseHit(a, now, 0.05, 0.04, 'bandpass', 3600, 2400, 1.2);
  }
}

// ---------- 原木（牌桌风格「原木」，shuffle.ts）：手搓洗牌 ----------

// 牌碰牌、牌碰木头的一声“嗒”：一小截很窄的带通噪声，叠一点同音高、一下就没的正弦（骨头牌那种脆的音头）
function clack(a: AudioContext, at: number, vol: number, f: number): void {
  noiseHit(a, at, 0.022 + Math.random() * 0.014, vol, 'bandpass', f, f * 0.92, 3.2);
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f * 1.04, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(vol * 0.35, at + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.02);
  osc.connect(gain).connect(bus('sfx', a));
  osc.start(at);
  osc.stop(at + 0.025);
}

// 原木的几声：pour 一副牌倒在木桌上（一大把“哗啦”，先密后疏，底下一记闷响），scoop 牌扣过来推到中间（一阵碰撞加推牌的摩擦声），
// shuffle 搓牌（哗啦哗啦一阵一阵的，dur 秒），build 码牌山（一墩一墩轻轻的“嗒”，dur 秒），push 牌山往前一推（木头上一记短短的摩擦，推到位“咚”一下）
export function playShuffle(cue: 'pour' | 'scoop' | 'shuffle' | 'build' | 'push', dur = 0.5): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  if (cue === 'pour') {
    for (let i = 0; i < 70; i++) {
      const t = dur * Math.random() ** 1.8;
      clack(a, now + t, (0.07 + Math.random() * 0.09) * (1 - (t / dur) * 0.6), 1500 + Math.random() * 2200);
    }
    noiseHit(a, now + 0.03, 0.3, 0.16, 'lowpass', 300, 120, 0.7);
  } else if (cue === 'scoop') {
    for (let i = 0; i < 30; i++) clack(a, now + Math.random() * dur, 0.05 + Math.random() * 0.07, 1400 + Math.random() * 2000);
    surf(a, now, dur + 0.15, 0.06, 300, 700, dur * 0.4, 0.8);
  } else if (cue === 'shuffle') {
    // 手掌按着牌一圈一圈地搓：一阵密一阵疏（大约一秒三下），一直有一层低低的摩擦声
    const n = Math.round(dur * 75);
    for (let i = 0; i < n; i++) {
      const t = Math.random() * dur;
      const stroke = 0.55 + 0.45 * Math.sin(t * Math.PI * 2 * 3.1);
      const fade = Math.min(1, t / 0.12, (dur - t) / 0.25);
      if (Math.random() > 0.35 + 0.65 * stroke) continue;
      clack(a, now + t, (0.035 + Math.random() * 0.06) * Math.max(0.2, fade), 1300 + Math.random() * 2600);
    }
    surf(a, now, dur + 0.1, 0.05, 260, 520, dur * 0.3, 0.7);
  } else if (cue === 'build') {
    // 四家一起码：一串轻轻的“嗒”，节奏有点乱
    for (let t = 0; t < dur; t += 0.024 + Math.random() * 0.03) clack(a, now + t, 0.04 + Math.random() * 0.04, 1900 + Math.random() * 900);
  } else {
    noiseHit(a, now, Math.max(0.12, dur), 0.1, 'bandpass', 420, 900, 0.9);
    const end = now + Math.max(0.12, dur) - 0.02;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, end);
    osc.frequency.exponentialRampToValueAtTime(70, end + 0.12);
    gain.gain.setValueAtTime(0.0001, end);
    gain.gain.exponentialRampToValueAtTime(0.2, end + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, end + 0.16);
    osc.connect(gain).connect(bus('sfx', a));
    osc.start(end);
    osc.stop(end + 0.18);
    for (let i = 0; i < 5; i++) clack(a, end + Math.random() * 0.03, 0.05 + Math.random() * 0.04, 2000 + Math.random() * 800);
  }
}

// 原木：和了一局，仪表盘上盖一个小朱印。印章按在木头上“嗒”的一记：一下往下沉的闷响，一点压下去的摩擦，一声很短的木头脆响。
// at：过几秒再响（2D 换局时印要先落一会儿）
export function playStamp(at = 0): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime + at;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(230, now);
  osc.frequency.exponentialRampToValueAtTime(85, now + 0.09);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.34, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  osc.connect(gain).connect(bus('sfx', a));
  osc.start(now);
  osc.stop(now + 0.16);
  noiseHit(a, now, 0.06, 0.2, 'lowpass', 1500, 420, 0.8);
  clack(a, now + 0.002, 0.08, 1650);
}

// 换局的声音（table3d.ts 的 onShift）：沙滩那几声给 playTide，草甸那几声给 playGust，原木那几声给 playShuffle
export function playShift(cue: 'surge' | 'crash' | 'ebb' | 'gather' | 'settle' | 'gust' | 'scatter' | 'breeze' | 'land' | 'pour' | 'scoop' | 'shuffle' | 'build' | 'push', dur = 0.5): void {
  if (cue === 'gust' || cue === 'scatter' || cue === 'breeze' || cue === 'land') playGust(cue, dur);
  else if (cue === 'pour' || cue === 'scoop' || cue === 'shuffle' || cue === 'build' || cue === 'push') playShuffle(cue, dur);
  else playTide(cue, dur);
}

// 全自动麻将机的几声：open 仪表盘抬起来（伺服电机短短一声加一下卡扣），sweep 牌哗啦啦掉进机器（一串高低不一的“嗒”，底下一阵闷响），
// drop 升降板往下沉（往下走的嗡嗡声），close 仪表盘落回去（一记闷响），rise 升降板往上升（电机嗡嗡声加齿轮声，dur 秒），lock 升到顶卡住（“咔哒”）
export function playMachine(cue: 'open' | 'sweep' | 'drop' | 'close' | 'rise' | 'lock', dur = 0.3): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  if (cue === 'open') {
    motorHum(a, now, Math.max(0.15, dur), 0.07, 150, 220, 0);
    noiseHit(a, now + dur, 0.03, 0.35, 'bandpass', 1900, 1900, 1.4);
  } else if (cue === 'sweep') {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const at = now + Math.random() * dur * (i < n * 0.7 ? 0.7 : 1);
      noiseHit(a, at, 0.03 + Math.random() * 0.02, 0.18 + Math.random() * 0.22, 'bandpass', 1800 + Math.random() * 1600, undefined, 1.2);
    }
    noiseHit(a, now, dur + 0.2, 0.12, 'lowpass', 420, 160, 0.7);
  } else if (cue === 'drop') {
    motorHum(a, now, Math.max(0.15, dur), 0.06, 105, 78, 0);
  } else if (cue === 'close') {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(gain).connect(bus('sfx', a));
    osc.start(now);
    osc.stop(now + 0.22);
    noiseHit(a, now, 0.05, 0.25, 'lowpass', 900);
  } else if (cue === 'rise') {
    motorHum(a, now, Math.max(0.2, dur), 0.09, 72, 92, 22);
  } else {
    noiseHit(a, now, 0.045, 0.5, 'bandpass', 1500, 900, 1);
    noiseHit(a, now + 0.035, 0.03, 0.25, 'bandpass', 2400, 2400, 1.5);
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain).connect(bus('sfx', a));
    osc.start(now);
    osc.stop(now + 0.18);
  }
}
