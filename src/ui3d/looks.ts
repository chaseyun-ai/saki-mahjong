import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// 每个角色用哪个底模，以及头发、眼睛要染成什么颜色。
// 底模是 VRoid 官方的 CC0 示例模型（见 README），颜色在加载后直接改贴图，不用另存模型。

export interface Look {
  model: string;
  hair: string;
  eyes: string;
  // 头发明暗对比，深色头发调低一些免得发灰
  hairContrast?: number;
  // 倒牌方式：wave 从左到右依次倒，slam 一起拍倒
  reveal?: 'wave' | 'slam';
  // 没事做时手放哪：edge 扶着桌沿，lap 放在腿上，crossed 抱胸
  pose?: RestPose;
  // 牌河和副露倒过来摆，方便对手看（松实玄、松实宥）
  upsideDown?: boolean;
  // 先占位、借别人的模型：头像、切入不用这个模型渲染的图，显示名字的最后一个字（素材页换了图的照样显示）
  borrowed?: boolean;
}

export type RestPose = 'edge' | 'lap' | 'crossed' | 'offscreen';

export const LOOKS: Record<string, Look> = {
  // 宫永咲：栗色短发、红褐色眼睛
  saki: { model: 'models/vroid-e.v2.glb', hair: '#8c4f36', eyes: '#a5492f', reveal: 'wave', pose: 'lap' },
  // 原村和：粉色长发、偏紫的粉色眼睛
  nodoka: { model: 'models/vroid-g.v2.glb', hair: '#f0a3bb', eyes: '#b86ea6', reveal: 'slam', pose: 'edge' },
  // 松实玄：黑色长发、红褐色眼睛
  kuro: { model: 'models/vroid-shino.v2.glb', hair: '#2b2326', eyes: '#8e3b2e', hairContrast: 0.5, reveal: 'slam', pose: 'edge', upsideDown: true },
  // 园城寺怜：深灰蓝短发、暗红色眼睛
  toki: { model: 'models/vroid-f.v2.glb', hair: '#353b4a', eyes: '#93333a', hairContrast: 0.6, reveal: 'wave', pose: 'crossed' },
  // 大星淡：金色长发、金色眼睛
  awai: { model: 'models/vroid-g.v2.glb', hair: '#f0cf72', eyes: '#c99a2e', reveal: 'slam', pose: 'lap' },
  // 石户霞：黑色长发、紫色眼睛
  kasumi: { model: 'models/vroid-shino.v2.glb', hair: '#2a2433', eyes: '#7a5c9e', hairContrast: 0.5, reveal: 'wave', pose: 'lap' },
  // 天江衣：金色头发、红色眼睛
  koromo: { model: 'models/vroid-f.v2.glb', hair: '#efd27a', eyes: '#b83a3a', reveal: 'wave', pose: 'lap' },
  // 爱宕洋榎：先占位，借咲的模型换成深棕色头发、棕色眼睛
  hiroe: { model: 'models/vroid-e.v2.glb', hair: '#4a2c22', eyes: '#7a4e2a', hairContrast: 0.6, reveal: 'slam', pose: 'edge', borrowed: true },
  // 宫永照：先占位，借怜的短发模型换成红棕色头发、暗红色眼睛
  // 福路美穗子：先占位，借和的长发模型换成浅栗色头发、蓝色眼睛
  mihoko: { model: 'models/vroid-g.v2.glb', hair: '#a8784a', eyes: '#3f6fb8', reveal: 'wave', pose: 'lap', borrowed: true },
  // 涅莉：先占位，借淡的长发模型换成淡金色头发、红色眼睛（眼里有火）
  nelly: { model: 'models/vroid-g.v2.glb', hair: '#e9dcb0', eyes: '#c0392b', reveal: 'slam', pose: 'crossed', borrowed: true },
  // 狮子原爽：先占位，借咲的短发模型换成深灰蓝色头发、灰蓝色眼睛
  sawaya: { model: 'models/vroid-e.v2.glb', hair: '#4a5068', eyes: '#5c7a8f', hairContrast: 0.6, reveal: 'wave', pose: 'edge', borrowed: true },
  teru: { model: 'models/vroid-f.v2.glb', hair: '#9a5a3c', eyes: '#8a3a2a', hairContrast: 0.7, reveal: 'slam', pose: 'edge', borrowed: true },
  // 片冈优希：先占位，借怜的短发模型换成浅棕色头发、棕色眼睛
  yuuki: { model: 'models/vroid-f.v2.glb', hair: '#c9925a', eyes: '#8a5a2a', reveal: 'slam', pose: 'edge', borrowed: true },
  // 松实宥：先占位，借玄的长发模型换成红棕色头发、红褐色眼睛；和玄一样牌河倒过来摆
  yu: { model: 'models/vroid-shino.v2.glb', hair: '#7a3a34', eyes: '#9a4a3a', hairContrast: 0.6, reveal: 'wave', pose: 'lap', upsideDown: true, borrowed: true },
  // 新子憧：先占位，借和的长发模型换成黑色头发、棕色眼睛
  ako: { model: 'models/vroid-g.v2.glb', hair: '#2e2628', eyes: '#7a5040', hairContrast: 0.5, reveal: 'slam', pose: 'edge', borrowed: true },
  // 亦野诚子：先占位，借咲的短发模型换成墨绿色头发、深绿色眼睛
  seiko: { model: 'models/vroid-e.v2.glb', hair: '#2f4a3e', eyes: '#3e6a50', hairContrast: 0.6, reveal: 'slam', pose: 'crossed', borrowed: true },
  // 染谷真子：先占位，借咲的短发模型换成墨绿色头发、棕色眼睛
  mako: { model: 'models/vroid-e.v2.glb', hair: '#3c5a48', eyes: '#7a5a3a', hairContrast: 0.6, reveal: 'wave', pose: 'crossed', borrowed: true },
  // 竹井久：先占位，借和的长发模型换成红棕色头发、灰绿色眼睛
  hisa: { model: 'models/vroid-g.v2.glb', hair: '#8a3a2e', eyes: '#5a7a6a', hairContrast: 0.6, reveal: 'slam', pose: 'edge', borrowed: true },
  // 末原恭子：先占位，借玄的长发模型换成黑色头发、深蓝色眼睛
  kyouko: { model: 'models/vroid-shino.v2.glb', hair: '#26242c', eyes: '#3a4a7a', hairContrast: 0.5, reveal: 'wave', pose: 'edge', borrowed: true },
  // 涉谷尧深：先占位，借怜的短发模型换成深棕色头发、深棕色眼睛
  takami: { model: 'models/vroid-f.v2.glb', hair: '#4a3328', eyes: '#5a3a2a', hairContrast: 0.6, reveal: 'wave', pose: 'lap', borrowed: true },
  // 二条泉：先占位，借咲的短发模型换成黑色头发、深棕色眼睛
  izumi: { model: 'models/vroid-e.v2.glb', hair: '#24222a', eyes: '#5a4030', hairContrast: 0.5, reveal: 'slam', pose: 'edge', borrowed: true },
  // 弘世堇：先占位，借玄的长发模型换成深蓝色头发、蓝灰色眼睛
  sumire: { model: 'models/vroid-shino.v2.glb', hair: '#2c3656', eyes: '#4a5a86', hairContrast: 0.5, reveal: 'wave', pose: 'crossed', borrowed: true },
  // 江口夕：先占位，借怜的短发模型换成红棕色头发、棕色眼睛
  sera: { model: 'models/vroid-f.v2.glb', hair: '#6e3424', eyes: '#7a4a2a', hairContrast: 0.6, reveal: 'slam', pose: 'edge', borrowed: true },
  // 清水谷龙华：先占位，借和的长发模型换成墨绿偏黑的头发、灰绿色眼睛
  ryuuka: { model: 'models/vroid-g.v2.glb', hair: '#26332c', eyes: '#56705e', hairContrast: 0.5, reveal: 'wave', pose: 'lap', borrowed: true },
  // 神代小莳：先占位，借霞的长发模型换成深棕色头发、紫色眼睛
  komaki: { model: 'models/vroid-shino.v2.glb', hair: '#3a2a2a', eyes: '#7a5a9a', hairContrast: 0.5, reveal: 'wave', pose: 'lap', borrowed: true },
  // 姊带丰音：先占位，借霞的长发模型换成黑色头发、深紫色眼睛
  toyone: { model: 'models/vroid-shino.v2.glb', hair: '#1e1c24', eyes: '#5a4a7a', hairContrast: 0.5, reveal: 'slam', pose: 'lap', borrowed: true },
  // 上重漫：先占位，借怜的短发模型换成深棕色头发、棕色眼睛
  suzu: { model: 'models/vroid-f.v2.glb', hair: '#4a2e22', eyes: '#8a5a32', hairContrast: 0.6, reveal: 'slam', pose: 'edge', borrowed: true },
};

// 牌桌上要用到的全部模型文件
export const MODEL_URLS = [...new Set(Object.values(LOOKS).map((l) => l.model))];

// 头像的五种表情：平常、开心、难过、吃惊、认真
export const FACES = ['neutral', 'happy', 'sad', 'surprised', 'serious'] as const;
export type Face = (typeof FACES)[number];

// 头像和切入立绘的默认图片（scripts/render-portraits.mjs 用模型渲染出来的，咲的换成了手绘）。
// 借模型占位的角色没有默认图，是空字符串：<img src=""> 会马上触发 onerror 被拿掉，露出名字的最后一个字
const hasArt = (id: string): boolean => !LOOKS[id]?.borrowed;
export const defaultPortraitUrl = (id: string, face: Face): string => (hasArt(id) ? `portraits/${id}-${face}.webp` : '');
export const cutinUrl = (id: string): string => (hasArt(id) ? `portraits/${id}-cutin.webp` : '');

// 有手绘的角色，立直、鸣牌、和牌的切入（和结算画面）换成手绘图：立直用“认真”，鸣牌和和牌用“和牌”。
// 手绘图是横图，wide 为 true；没有手绘的用上面模型渲染的竖图
const CUTIN_ART: Record<string, { riichi?: string; win?: string }> = {
  saki: { riichi: 'portraits/saki-cutin-riichi.webp', win: 'portraits/saki-cutin-win.webp' },
};
export function defaultCutinArt(id: string, kind: string): { url: string; wide: boolean } {
  const art = CUTIN_ART[id];
  const k = kind === 'result' ? 'win' : kind;
  const url = k === 'riichi' ? art?.riichi : k === 'call' || k === 'kan' || k === 'win' ? art?.win : undefined;
  return url ? { url, wide: true } : { url: cutinUrl(id), wide: false };
}

// 试玩页“素材”页面里换上的图（src/ui/skins.ts 读写），盖过上面的默认图。
// face 头像框平时的头像，blank 放铳和终局没拿第一时的“懵逼”，riichi 立直切入，call 鸣牌（吃碰杠）切入，
// win 和牌切入，ability 能力发动切入，result 结算画面，power 能力发动时的头像（怜演算时眼睛发光）；
// skill-<技能 id> 是单个技能发动时放的动画（只有 Character.skillArts 里列的技能有，比如爽的每朵云、每个神威）
export type SkinSlot = 'face' | 'blank' | 'power' | 'riichi' | 'call' | 'win' | 'ability' | 'result' | `skill-${string}`;
export interface SkinArt {
  url: string;
  w: number;
  h: number;
  video?: boolean; // 视频（MP4、WebM），不是图
}
let skins: Record<string, Partial<Record<SkinSlot, SkinArt>>> = {};
export function setSkins(next: typeof skins): void {
  skins = next;
}
export function skinOf(id: string, slot: SkinSlot): SkinArt | undefined {
  return skins[id]?.[slot];
}

export function portraitUrl(id: string, face: Face): string {
  const own = face === 'neutral' ? skinOf(id, 'face') : face === 'surprised' ? skinOf(id, 'blank') : undefined;
  return own?.url ?? defaultPortraitUrl(id, face);
}

// 能力发动时的头像：没换图就用“认真”的表情（头像框另外发光）
export const defaultPowerPortraitUrl = (id: string): string => defaultPortraitUrl(id, 'serious');
export function powerPortraitUrl(id: string): string {
  return skinOf(id, 'power')?.url ?? defaultPowerPortraitUrl(id);
}

// 单个技能的动画，没换就是 undefined（发动时照常放“能力发动切入”）
export function skillArt(id: string, skill: string): SkinArt | undefined {
  return skinOf(id, `skill-${skill}`);
}

// 切入图：kind 是切入的种类（riichi、call、kan、win、ability），结算画面用 result
export function cutinArt(id: string, kind: string): { url: string; wide: boolean } {
  // 鸣牌没单独换就用和牌的，结算没单独换也用和牌的
  const own =
    kind === 'riichi'
      ? skinOf(id, 'riichi')
      : kind === 'call' || kind === 'kan'
        ? (skinOf(id, 'call') ?? skinOf(id, 'win'))
        : kind === 'win'
          ? skinOf(id, 'win')
          : kind === 'ability'
            ? skinOf(id, 'ability')
            : kind === 'result'
              ? (skinOf(id, 'result') ?? skinOf(id, 'win'))
              : undefined;
  // 宽比高大一截的算横图，切入时画小一点、大字挪到旁边
  return own ? { url: own.url, wide: own.w > own.h * 1.1 } : defaultCutinArt(id, kind);
}

function hslToRgb(h: number, s: number, l: number, out: [number, number, number]): void {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  out[0] = Math.round(ch(h + 1 / 3) * 255);
  out[1] = Math.round(ch(h) * 255);
  out[2] = Math.round(ch(h - 1 / 3) * 255);
}

// 把贴图里的颜色换成目标色：保留原来的明暗纹理，色相和饱和度换成目标的
function colorize(src: CanvasImageSource & { width: number; height: number }, target: string, contrast: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(target).getHSL(hsl, THREE.SRGBColorSpace);
  // 先算原图不透明部分的平均亮度
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 32) continue;
    sum += (Math.max(d[i], d[i + 1], d[i + 2]) + Math.min(d[i], d[i + 1], d[i + 2])) / 510;
    n++;
  }
  const avg = n ? sum / n : 0.5;
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const l = (Math.max(d[i], d[i + 1], d[i + 2]) + Math.min(d[i], d[i + 1], d[i + 2])) / 510;
    hslToRgb(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + (l - avg) * contrast, 0, 1), rgb);
    d[i] = rgb[0];
    d[i + 1] = rgb[1];
    d[i + 2] = rgb[2];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const TEXTURE_SLOTS = ['map', 'shadeMultiplyTexture'] as const;

// 把名字匹配 pattern 的材质的贴图染色。同一张贴图只处理一次
function recolor(vrm: VRM, pattern: RegExp, target: string, contrast: number): void {
  const done = new Map<THREE.Texture, THREE.Texture>();
  vrm.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!pattern.test(m.name)) continue;
      const mat = m as unknown as Record<string, THREE.Texture | null | undefined>;
      for (const slot of TEXTURE_SLOTS) {
        const tex = mat[slot];
        if (!tex?.image) continue;
        let next = done.get(tex);
        if (!next) {
          const canvas = colorize(tex.image, target, contrast);
          next = new THREE.CanvasTexture(canvas);
          next.flipY = tex.flipY;
          next.colorSpace = tex.colorSpace;
          next.wrapS = tex.wrapS;
          next.wrapT = tex.wrapT;
          next.channel = tex.channel;
          done.set(tex, next);
        }
        mat[slot] = next;
      }
      m.needsUpdate = true;
    }
  });
}

export function applyLook(vrm: VRM, look: Look): void {
  recolor(vrm, /HAIR/i, look.hair, look.hairContrast ?? 0.8);
  recolor(vrm, /EyeIris/i, look.eyes, 0.9);
}
