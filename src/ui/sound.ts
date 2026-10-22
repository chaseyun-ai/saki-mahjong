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
