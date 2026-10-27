// 用 WebAudio 合成的简单音效，不需要音频文件
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// 打牌落桌的“啪”
export function playClick(): void {
  const a = audio();
  if (!a) return;
  const len = Math.floor(a.sampleRate * 0.05);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2200;
  const gain = a.createGain();
  gain.gain.value = 0.6;
  src.connect(filter).connect(gain).connect(a.destination);
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
