import { audio, bus } from './audioBus';

// 给牌局补的提示音和短乐句，全是 WebAudio 现合成的，不用音频文件，接在音效总线上。
//
// 乐句用的是拨弦的音色（像筝）：一个带泛音的波形，过一个越来越暗的低通，音量很快起来、慢慢落下去。
// 调子用五声音阶：赢的、开局的用明亮的（do re mi sol la），垫底的用阴的那种（都节音阶）。
//
// 每个函数都可以传一个出口和开始时间：游戏里不传（用游戏的出口，马上响）；离线渲染检查时传自己的。

type Ctx = BaseAudioContext;

const waves = new WeakMap<Ctx, PeriodicWave>();

// 拨弦的波形：在弦的五分之一处拨，第 5、10 个泛音没有，高次的弱下去
function pluckWave(a: Ctx): PeriodicWave {
  let w = waves.get(a);
  if (!w) {
    const n = 24;
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) imag[k] = Math.sin(k * Math.PI * 0.2) / k ** 1.15;
    w = a.createPeriodicWave(real, imag);
    waves.set(a, w);
  }
  return w;
}

// MIDI 音高换成频率（69 是 A4 = 440 Hz）
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// 一个拨弦音。dur 是余音多长（秒），vol 是音量
function pluck(a: Ctx, out: AudioNode, midi: number, at: number, dur: number, vol: number): void {
  const f = hz(midi);
  const osc = a.createOscillator();
  osc.setPeriodicWave(pluckWave(a));
  osc.frequency.value = f;
  // 拨下去那一下音高略高，马上回来
  osc.detune.setValueAtTime(14, at);
  osc.detune.setTargetAtTime(0, at, 0.03);
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(Math.min(12000, f * 9), at);
  lp.frequency.setTargetAtTime(Math.min(6000, f * 2.2), at, dur * 0.22);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
  g.gain.setTargetAtTime(0.0001, at + 0.004, dur * 0.28);
  osc.connect(lp).connect(g).connect(out);
  osc.start(at);
  osc.stop(at + dur * 1.6 + 0.05);
}

// 一小段噪声过滤波器：木头、竹签那种没有音高的声音
function tick(a: Ctx, out: AudioNode, at: number, freq: number, len: number, vol: number, type: BiquadFilterType = 'bandpass', q = 1.2): void {
  const n = Math.max(1, Math.floor(a.sampleRate * len));
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(out);
  src.start(at);
}

// 低低的一声鼓：音高往下掉的正弦
function thump(a: Ctx, out: AudioNode, at: number, from: number, to: number, dur: number, vol: number): void {
  const osc = a.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + dur * 0.6);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

// 乐句：[第几拍, MIDI 音高, 音量（不写是 1）]。beat 是一拍多少秒
type Note = [at: number, midi: number, vol?: number];

function phrase(a: Ctx, out: AudioNode, t0: number, beat: number, notes: Note[], vol: number, ring: number): void {
  for (const [at, midi, v = 1] of notes) pluck(a, out, midi, t0 + at * beat, ring, vol * v);
}

function target(a?: Ctx | null, at?: number): { a: Ctx; out: AudioNode; t: number } | null {
  const ctx = a ?? audio();
  if (!ctx) return null;
  return { a: ctx, out: bus('sfx', ctx), t: at ?? ctx.currentTime };
}

// 按钮点击：很轻的一下
export function playUiTick(a?: Ctx | null, at?: number): void {
  const x = target(a, at);
  if (!x) return;
  tick(x.a, x.out, x.t, 3200, 0.018, 0.22, 'bandpass', 2.5);
  thump(x.a, x.out, x.t, 1500, 1100, 0.035, 0.035);
}

// 自己摸牌：牌从牌山上拿起来，轻轻碰一下
export function playDraw(a?: Ctx | null, at?: number): void {
  const x = target(a, at);
  if (!x) return;
  tick(x.a, x.out, x.t, 1300, 0.03, 0.3, 'bandpass', 1.4);
  tick(x.a, x.out, x.t + 0.045, 2100, 0.02, 0.14, 'bandpass', 2);
}

// 轮到你决定：能吃、碰、杠、和，或者能立直、自摸的时候
export function playPrompt(a?: Ctx | null, at?: number): void {
  const x = target(a, at);
  if (!x) return;
  phrase(x.a, x.out, x.t, 0.09, [[0, 81], [1, 86, 0.9]], 0.13, 0.45);
}

// 自己听牌了：高高的两声，带一点余音
export function playTenpai(a?: Ctx | null, at?: number): void {
  const x = target(a, at);
  if (!x) return;
  phrase(x.a, x.out, x.t, 0.16, [[0, 88], [1, 93, 0.85], [1, 81, 0.5]], 0.1, 0.9);
}

// 流局：往下落的三个音，底下一声闷鼓
export function playDrawGame(a?: Ctx | null, at?: number): void {
  const x = target(a, at);
  if (!x) return;
  phrase(x.a, x.out, x.t, 0.3, [[0, 69], [1, 65, 0.9], [2, 62, 0.9], [2, 50, 0.7]], 0.16, 1.4);
  thump(x.a, x.out, x.t + 0.6, 90, 55, 0.7, 0.22);
}

// 点数滚动：点棒一根根数过去，最后「叮」一声落定。delay 秒后开始，滚 dur 秒（跟结算页的数字对上）
export function playTally(delay = 0.55, dur = 1.1, a?: Ctx | null, at?: number): void {
  const x = target(a, at);
  if (!x) return;
  const t0 = x.t + delay;
  // 先密后疏，跟数字滚动一样越来越慢
  const n = 20;
  for (let i = 0; i < n; i++) {
    const k = 1 - (1 - i / n) ** 2;
    tick(x.a, x.out, t0 + k * dur, 2600 + i * 60, 0.014, 0.1 + 0.05 * (i / n), 'bandpass', 3);
  }
  phrase(x.a, x.out, t0 + dur + 0.06, 0.07, [[0, 88], [1, 93]], 0.1, 0.6);
}

// 开局：一串往上的拨弦，停在高处，底下一声鼓
export function playGameStart(a?: Ctx | null, at?: number): void {
  const x = target(a, at);
  if (!x) return;
  thump(x.a, x.out, x.t, 110, 60, 0.6, 0.25);
  phrase(x.a, x.out, x.t + 0.05, 0.13, [[0, 60, 0.8], [1, 67, 0.8], [2, 72], [3, 74], [4, 79], [6, 84], [6, 76, 0.6]], 0.15, 1.5);
}

// 自己和牌：接在和牌的琶音后面，再往上一串，落在一个和弦上
export function playMyWin(a?: Ctx | null, at?: number): void {
  const x = target(a, at);
  if (!x) return;
  phrase(x.a, x.out, x.t, 0.075, [[0, 72], [1, 74], [2, 76], [3, 79], [4, 81], [5, 84], [7, 88], [7, 84, 0.7], [7, 79, 0.7], [7, 72, 0.6]], 0.13, 1.6);
}

// 终局的名次乐句：rank 0 是第一名，3 是垫底
export function playRank(rank: number, a?: Ctx | null, at?: number): void {
  const x = target(a, at);
  if (!x) return;
  if (rank <= 0) {
    // 第一名：两句往上，最后一个大和弦
    thump(x.a, x.out, x.t, 120, 60, 0.7, 0.25);
    phrase(x.a, x.out, x.t, 0.14, [[0, 67], [1, 69], [2, 72], [4, 74], [5, 76], [6, 79], [8, 84], [8, 79, 0.75], [8, 76, 0.7], [8, 72, 0.7], [8, 60, 0.6], [11, 88, 0.6], [12, 91, 0.5]], 0.15, 2.2);
    thump(x.a, x.out, x.t + 8 * 0.14, 100, 50, 0.9, 0.25);
  } else if (rank >= 3) {
    // 垫底：阴的音阶慢慢落下去
    phrase(x.a, x.out, x.t, 0.32, [[0, 69], [1, 65, 0.9], [2, 64, 0.9], [3, 58, 0.85], [4, 57, 0.9], [4, 45, 0.7]], 0.16, 1.8);
    thump(x.a, x.out, x.t + 4 * 0.32, 80, 45, 1, 0.22);
  } else {
    // 二、三名：平平地收住
    phrase(x.a, x.out, x.t, 0.18, [[0, 69], [1, 72], [2, 76, 0.9], [4, 74], [4, 67, 0.7], [4, 62, 0.6]], 0.15, 1.8);
  }
}
