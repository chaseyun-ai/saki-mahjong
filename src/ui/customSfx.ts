import { audio, bus } from './audioBus';

// 素材导入换上的提示音（落桌、鸣牌、立直、和牌、能力发动）：换了就放换上的那一段，没换的照旧合成（sound.ts）。
// 两层：mine 玩家自己导入的盖过 project 项目里 public/custom 的（src/assets/layers.ts 推过来）。
// 换上的时候就开始解码；还没解码好的那一下照旧放合成的。

export type SfxName = 'click' | 'call' | 'riichi' | 'win' | 'chime';

const layers: { mine: Partial<Record<SfxName, string>>; project: Partial<Record<SfxName, string>> } = { mine: {}, project: {} };
const decoded = new Map<string, AudioBuffer | null>();
const loading = new Set<string>();

// 解码用离线的 AudioContext：不用等玩家点过页面，一打开就能解好（解出来的声音放到哪个 AudioContext 都行）
function decoder(): BaseAudioContext | null {
  try {
    return new OfflineAudioContext(1, 1, 48000);
  } catch {
    return audio();
  }
}

function load(url: string): void {
  if (decoded.has(url) || loading.has(url)) return;
  const a = decoder();
  if (!a) return;
  loading.add(url);
  void fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => a.decodeAudioData(b))
    .then(
      (buf) => decoded.set(url, buf),
      () => decoded.set(url, null),
    )
    .finally(() => loading.delete(url));
}

export function setCustomSfx(layer: 'mine' | 'project', next: Partial<Record<SfxName, string>>): void {
  layers[layer] = next;
  for (const url of Object.values(next)) if (url) load(url);
}

// 放换上的那一段。放了返回 true（调用的地方就不再合成）；没换、还没解码好、解码不了返回 false
export function playCustomSfx(name: SfxName, opts: { pan?: number; vol?: number } = {}): boolean {
  const url = layers.mine[name] ?? layers.project[name];
  if (!url) return false;
  const buf = decoded.get(url);
  if (!buf) {
    load(url);
    return false;
  }
  const a = audio();
  if (!a) return false;
  const src = a.createBufferSource();
  src.buffer = buf;
  const gain = a.createGain();
  gain.gain.value = opts.vol ?? 1;
  let out: AudioNode = src.connect(gain);
  if (opts.pan) {
    const panner = a.createStereoPanner?.();
    if (panner) {
      panner.pan.value = opts.pan;
      out = out.connect(panner);
    }
  }
  out.connect(bus('sfx', a));
  src.start();
  return true;
}
