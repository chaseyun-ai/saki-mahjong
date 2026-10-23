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
};

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
