// 用 WebAudio 合成的简单音效，不需要音频文件
import { vary } from './vary';

let ctx: AudioContext | null = null;

export function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

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
  out.connect(a.destination);
  src.start();
}

// 能力发动的提示音
export function playChime(): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  [880, 1320].forEach((f, i) => {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, now + i * 0.08);
    gain.gain.exponentialRampToValueAtTime(0.15, now + i * 0.08 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.5);
    osc.connect(gain).connect(a.destination);
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
  osc.connect(gain).connect(a.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

// 吃碰杠：短促有力的两声
export function playCall(): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  tone(a, 196, now, 0.25, 0.25, 'triangle');
  tone(a, 392, now + 0.06, 0.3, 0.18, 'square');
  playClick();
}

// 立直：低音加上扬的滑音
export function playRiichi(): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.35);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
  osc.connect(gain).connect(a.destination);
  osc.start(now);
  osc.stop(now + 0.65);
  tone(a, 110, now, 0.5, 0.3, 'triangle');
}

// 和牌：上行琶音
export function playWin(): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  [523, 659, 784, 1047, 1319].forEach((f, i) => tone(a, f, now + i * 0.07, 0.9, 0.14, 'triangle'));
  tone(a, 131, now, 1.2, 0.25, 'sine');
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
  osc.connect(gain).connect(a.destination);
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
  src.connect(filter).connect(g2).connect(a.destination);
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
  ws.connect(wf).connect(wg).connect(a.destination);
  ws.start(now);
  ws.stop(now + 0.62);
}

// 宫永咲的岭上开花：百合开出来的那一下，一串很轻的高音铃往上走，后面拖一阵风声（花瓣飘起来）。big 0–1：和得越大铃越多、风越长
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
  src.connect(filter).connect(gain).connect(a.destination);
  src.start(now);
  src.stop(now + dur + 0.05);
}
