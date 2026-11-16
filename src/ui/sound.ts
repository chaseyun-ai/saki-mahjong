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
