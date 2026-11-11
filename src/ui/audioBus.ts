// 音量总线：音乐、音效、语音各走一条，汇到总音量再出声。声音设置面板（soundPanel.ts）改的就是这里的数。
//
//   音效  ──> sfx ───────────┐
//   语音  ──> voice ─────────┼─> master ──> 扬声器
//   音乐  ──> music ─> duck ─┘
//
// duck 是「演出时压低音乐」：能力演出、和牌、语音响的时候把音乐压下去，放完升回来（duckMusic）。
// 设置单独记在浏览器里（saki-audio-settings），跟对局设置分开存：对局设置的「恢复默认」不动它。

export type BusKind = 'music' | 'sfx' | 'voice';

export interface AudioSettings {
  // 四条滑杆，0 到 1（面板上显示成 0 到 100）
  master: number;
  music: number;
  sfx: number;
  voice: number;
  // 一键静音：滑杆的位置留着，再点一下回到原来的音量
  mute: boolean;
  // 演出时压低音乐
  duck: boolean;
  // 语音放哪些：on 全部，calls 只放喊牌（立直、吃碰杠、和），off 不放。含义和面板上那一行由语音那边管
  voiceMode: 'on' | 'calls' | 'off';
}

export const DEFAULT_AUDIO: AudioSettings = { master: 0.8, music: 0.5, sfx: 1, voice: 1, mute: false, duck: true, voiceMode: 'on' };

const KEY = 'saki-audio-settings';
const VOLUMES = ['master', 'music', 'sfx', 'voice'] as const;
const VOICE_MODES = ['on', 'calls', 'off'];

function load(): AudioSettings {
  const out = { ...DEFAULT_AUDIO };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Record<keyof AudioSettings, unknown>> | null;
    if (saved && typeof saved === 'object') {
      for (const k of VOLUMES) if (typeof saved[k] === 'number' && Number.isFinite(saved[k])) out[k] = clamp01(saved[k] as number);
      if (typeof saved.mute === 'boolean') out.mute = saved.mute;
      if (typeof saved.duck === 'boolean') out.duck = saved.duck;
      if (VOICE_MODES.includes(saved.voiceMode as string)) out.voiceMode = saved.voiceMode as AudioSettings['voiceMode'];
    }
  } catch {
    // 无痕模式之类读不到：用默认的
  }
  return out;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// 现在的设置。只读着用，要改走 setAudioSetting（它会存下来、马上改音量、通知面板）
export const audioSettings: Readonly<AudioSettings> = load();

const listeners = new Set<() => void>();

export function setAudioSetting<K extends keyof AudioSettings>(key: K, value: AudioSettings[K]): void {
  const s = audioSettings as AudioSettings;
  const v = (VOLUMES as readonly string[]).includes(key) ? (clamp01(Number(value) || 0) as AudioSettings[K]) : value;
  if (s[key] === v) return;
  s[key] = v;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 存不了就只管这一次
  }
  apply(0.03);
  for (const f of [...listeners]) f();
}

// 设置变了就叫一声；返回的函数用来取消
export function onAudioSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// 滑杆位置换成增益：平方一下，滑杆拉到一半听起来才像一半（0.5 → 约 -12 dB）
export const volumeGain = (v: number) => clamp01(v) ** 2;

// ---------- 声音出口 ----------

let ctx: AudioContext | null = null;
let listening = false;

const hidden = () => typeof document !== 'undefined' && document.hidden;

// 页面切到后台：整个声音出口停住，回来接着放（音乐停在原处）
function watchVisibility(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => {});
    else void ctx.resume().catch(() => {});
  });
}

// 放声音用的出口。浏览器不让出声（还没点过页面、没有声卡）或者页面在后台时是 null，这一声就不放了：
// 后台时出口停着，这时候排上去的声音会攒到回来那一刻一起响
export function audio(): AudioContext | null {
  if (hidden()) return null;
  return liveAudio();
}

// 同上，但页面在后台时也给（音乐要在后台记着自己放到哪了）。只在已经有出口、或者 create 时才新建
export function liveAudio(create = true): AudioContext | null {
  try {
    if (!ctx) {
      if (!create) return null;
      ctx = new AudioContext();
      watchVisibility();
    }
    if (ctx.state === 'suspended' && !hidden()) void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

interface Buses {
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  voice: GainNode;
  duck: GainNode;
}

let buses: Buses | null = null;

function build(a: AudioContext): Buses {
  const master = a.createGain();
  const music = a.createGain();
  const sfx = a.createGain();
  const voice = a.createGain();
  const duck = a.createGain();
  music.connect(duck).connect(master);
  sfx.connect(master);
  voice.connect(master);
  master.connect(a.destination);
  return { master, music, sfx, voice, duck };
}

// 这一类声音该接到哪。a 是放声音用的出口：游戏里就是 audio() 给的那个；
// 离线渲染（测试、导出试听）用的别的出口没有总线，直接接它自己的终点，音量设置不管它。
// 不给 a 时用游戏的出口，这时候出不了声就是 null
export function bus(kind: BusKind, a: BaseAudioContext): AudioNode;
export function bus(kind: BusKind): AudioNode | null;
export function bus(kind: BusKind, a?: BaseAudioContext): AudioNode | null {
  const live = a ?? liveAudio();
  if (!live) return null;
  if (live !== ctx) return live.destination;
  if (!buses) {
    buses = build(ctx);
    apply(0);
  }
  return buses[kind];
}

// ---------- 压低音乐 ----------

// 压到多少（增益）、多快压下去、多快升回来（秒，指数趋近的时间常数）
const DUCK_GAIN = 0.3;
const DUCK_DOWN = 0.08;
const DUCK_UP = 0.5;

let ducks = 0;

// 把音乐压低，返回松开的函数（多叫几次没关系）。给了秒数就到点自己松开。
// 几处同时压着只压一次，全松开了才升回来；设置里关了「演出时压低音乐」就不压
export function duckMusic(seconds?: number): () => void {
  let held = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  ducks++;
  applyDuck(DUCK_DOWN);
  const release = () => {
    if (!held) return;
    held = false;
    if (timer !== null) clearTimeout(timer);
    ducks--;
    applyDuck(DUCK_UP);
  };
  if (seconds !== undefined) timer = setTimeout(release, Math.max(0, seconds) * 1000);
  return release;
}

// 现在是不是压着（测试、面板用）
export const musicDucked = () => ducks > 0 && audioSettings.duck;

function ramp(p: AudioParam, v: number, tc: number): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (tc <= 0) {
    p.cancelScheduledValues(now);
    p.value = v;
    return;
  }
  p.cancelScheduledValues(now);
  p.setTargetAtTime(v, now, tc);
}

function applyDuck(tc: number): void {
  if (buses) ramp(buses.duck.gain, musicDucked() ? DUCK_GAIN : 1, tc);
}

function apply(tc: number): void {
  if (!buses) return;
  const s = audioSettings;
  ramp(buses.master.gain, s.mute ? 0 : volumeGain(s.master), tc);
  ramp(buses.music.gain, volumeGain(s.music), tc);
  ramp(buses.sfx.gain, volumeGain(s.sfx), tc);
  ramp(buses.voice.gain, volumeGain(s.voice), tc);
  applyDuck(tc);
}
