import * as THREE from 'three';
import { MARK_H, MARK_W, grainTexture16, pixelBackMark, pixelCanvas } from '../pixel/blocks';
import type { TileLook } from '../ui/theme';
import { TILE_H, TILE_W } from './tableLayout';

// 牌桌风格自己的牌（theme.ts 的 tile）：沙滩的牌是沙子捏的（牌身一粒粒的浅沙、牌背湿一点的深沙，正中压一个贝壳印），
// 草甸的牌是花瓣捏的（牌身花瓣白、细细的一丝丝纹路，牌背是一片叶子的绿、正中压一道道叶脉），
// 原木的牌是老式竹背牌（牌身光面的骨白，牌背一层竹子，顺着牌长一丝丝竹纤维）；
// 翻牌屏的牌背是一块翻牌（中间一道缝、上半亮下半暗），深夜的牌背正中一弯夜光月牙（熄了灯会发光）。牌面上的字和图案照旧，只换牌身、牌背。
// 2D 牌桌的同一套样子在 tableStyles.css 里（贝壳、叶子是同样的路径，写成 SVG）

// ---------- 细纹理：贴在牌身、牌背上，和底色相乘 ----------

const grains = new Map<string, THREE.CanvasTexture>();

type Grain = NonNullable<TileLook['grain'] | TileLook['backGrain']>;

// 一张 64 见方的小图，一张牌正好铺一遍（手牌上一个像素大约就是一粒）：底子接近白（乘上去几乎不变色）。
// sand 撒满亮点、暗点，偶尔一粒深的；fiber 是顺着牌竖向的一丝丝细纹（花瓣上的纹路），有亮有暗、都很淡；
// bamboo 是顺着牌长一整条一整条的竹纤维（细的暗线、亮线，深浅一段段变一点），夹着几点短短的维管束
export function grainTexture(kind: Grain = 'sand'): THREE.CanvasTexture {
  const hit = grains.get(kind);
  if (hit) return hit;
  if (kind === 'block') {
    // 像素牌桌：16×16 一格格的颗粒，一张牌宽正好 16 格，放大不插值
    const t = new THREE.CanvasTexture(pixelCanvas(grainTexture16(), 16, 16));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    grains.set(kind, t);
    return t;
  }
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  // 固定种子：每次建出来一样
  let a = kind === 'sand' ? 0x2545f491 : kind === 'fiber' ? 0x7f4a7c15 : 0x3c6ef372;
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  if (kind === 'sand') {
    ctx.fillStyle = 'rgb(244,240,234)';
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 1500; i++) {
      // 沙粒是暖色的：亮的偏奶白，暗的偏赭石
      const v = rnd();
      ctx.fillStyle = v < 0.45 ? 'rgb(255,253,248)' : v < 0.93 ? 'rgb(214,196,170)' : 'rgb(170,146,116)';
      ctx.fillRect(Math.floor(rnd() * 64), Math.floor(rnd() * 64), 1, 1);
    }
  } else if (kind === 'bamboo') {
    ctx.fillStyle = 'rgb(246,242,234)';
    ctx.fillRect(0, 0, 64, 64);
    // 一条条竖线贯通上下（上下接得上），每条深浅沿着走一段段变一点
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(rnd() * 64);
      const dark = rnd() < 0.62;
      const base = dark ? 0.1 + rnd() * 0.12 : 0.18 + rnd() * 0.2;
      for (let y = 0; y < 64; y += 4) {
        const k = base * (0.7 + 0.6 * rnd());
        ctx.fillStyle = dark ? `rgba(120,84,40,${k.toFixed(3)})` : `rgba(255,252,240,${k.toFixed(3)})`;
        ctx.fillRect(x, y, 1, 4);
      }
    }
    // 维管束：短短的深色小点，竖着拉长
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(rnd() * 64);
      const y = Math.floor(rnd() * 64);
      ctx.fillStyle = `rgba(110,74,34,${(0.12 + rnd() * 0.16).toFixed(3)})`;
      ctx.fillRect(x, y, 1, 2 + Math.floor(rnd() * 4));
    }
  } else {
    ctx.fillStyle = 'rgb(246,246,242)';
    ctx.fillRect(0, 0, 64, 64);
    // 一丝丝的纹：竖着走、稍微弯一点，长短不一；上下接得上（铺满整张牌不会断）
    for (let i = 0; i < 70; i++) {
      const x0 = rnd() * 64;
      const y0 = rnd() * 64;
      const len = 10 + rnd() * 30;
      const bend = (rnd() - 0.5) * 3;
      const v = rnd();
      ctx.fillStyle = v < 0.5 ? 'rgb(255,255,253)' : 'rgb(226,229,216)';
      for (let k = 0; k < len; k++) {
        const x = Math.floor(x0 + bend * Math.sin((k / len) * Math.PI)) & 63;
        const y = Math.floor(y0 + k) & 63;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.anisotropy = 4;
  grains.set(kind, t);
  return t;
}

// ---------- 牌背上压的花样 ----------

// 贝壳（扇贝）：铰合部在下面，往上张开九道扇形的棱，上沿一个个小圆弧，底下两只小耳朵。坐标在 100×100 里
export function shellPaths(): { body: string; grooves: string; ears: string } {
  const cx = 50;
  const cy = 80;
  const R = 46;
  const N = 9;
  const a0 = -66;
  const a1 = 66;
  const pt = (deg: number, r: number) => {
    const t = (deg * Math.PI) / 180;
    return `${(cx + Math.sin(t) * r).toFixed(1)} ${(cy - Math.cos(t) * r).toFixed(1)}`;
  };
  let body = `M${cx} ${cy} L${pt(a0, R)}`;
  let grooves = '';
  for (let i = 0; i < N; i++) {
    const a = a0 + ((a1 - a0) * i) / N;
    const b = a0 + ((a1 - a0) * (i + 1)) / N;
    body += ` Q${pt((a + b) / 2, R + 8)} ${pt(b, R)}`;
    if (i > 0) grooves += `M${pt(a, 9)} L${pt(a, R - 1)} `;
  }
  body += ' Z';
  const ears = `M${cx - 15} ${cy - 2} L${cx + 15} ${cy - 2} L${cx + 10} ${cy + 10} L${cx - 10} ${cy + 10} Z`;
  return { body, grooves: grooves.trim(), ears };
}

// 叶子：一片尖叶，叶柄在下面，中间一道主脉（rib）、两边各几道侧脉（grooves）。坐标在 100×100 里
export function leafPaths(): { body: string; grooves: string; rib: string; ears: string } {
  const body = 'M50 92 C30 74 22 46 50 8 C78 46 70 74 50 92 Z';
  let grooves = '';
  for (const [y, dx] of [[30, 11], [43, 16], [56, 17], [69, 15], [80, 10]]) grooves += `M50 ${y + 9} Q${50 - dx * 0.45} ${y + 4} ${50 - dx} ${y} M50 ${y + 9} Q${50 + dx * 0.45} ${y + 4} ${50 + dx} ${y} `;
  return { body, grooves: grooves.trim(), rib: 'M50 97 L50 14', ears: '' };
}

// 牌背上那片叶子歪多少（弧度，2D 的 SVG 也照这个转）
export const LEAF_TILT = -0.26;

const marks = new Map<string, THREE.CanvasTexture>();

// 月牙：外圆在牌背正中（半径是牌宽的 MOON_R），挖掉的那个圆往右偏多少、往上偏多少、半径多大（都按外圆半径算）。
// 2D 的牌背（tableStyles.css）、2D 熄灯时发光的月牙（app.ts）照同一个形状画
export const MOON_R = 0.27;
export const MOON_CUT: [number, number, number] = [0.36, 0.2, 0.9];
function moonCircle(w: number, h: number): [number, number, number] {
  return [w / 2, h / 2, w * MOON_R];
}

// 牌背那一面的贴图（宽高比和牌一样）：红色通道是亮还是暗（0 压暗、1 提亮），透明度是压得多深（提亮最多到 1.6 倍，压暗最多到 0.7 倍）。
// 贝壳：壳面提亮一点（干一点的沙），棱是压下去的暗线。
// 叶子：一大片叶子斜躺在牌背上（几乎和牌一样长），叶子外面的牌背压深一点，叶面稍亮，叶脉是亮的（真的叶子叶脉颜色浅），叶边一道暗线。
// 翻牌的缝：横过牌背正中一道暗缝，缝下面紧贴一道亮线（下半块的上沿），上半块稍亮、下半块稍暗；缝两头各一颗小轴。
// 月牙：一个圆挖掉偏右上的一个大一点的圆，剩下左下一弯，提亮；绿色通道标出发光的地方（tileSurface 的 glow，只有月牙用）
function markTexture(kind: NonNullable<TileLook['mark']>): THREE.CanvasTexture {
  const hit = marks.get(kind);
  if (hit) return hit;
  if (kind === 'pixel') {
    // 像素牌桌：一颗菱形宝石，一格格画的（pixel/blocks.ts），贴上去不插值
    const t = new THREE.CanvasTexture(pixelCanvas(pixelBackMark(), MARK_W, MARK_H));
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    marks.set(kind, t);
    return t;
  }
  const W = 200;
  const H = Math.round((W * TILE_H) / TILE_W);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (kind === 'moon') {
    const [cx, cy, R] = moonCircle(W, H);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx + R * MOON_CUT[0], cy - R * MOON_CUT[1], R * MOON_CUT[2], 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  } else if (kind === 'seam') {
    const mid = H / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(0, 0, W, mid);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, mid, W, H - mid);
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fillRect(0, mid - 3, W, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, mid + 3, W, 3);
    for (const x of [W * 0.07, W * 0.93]) {
      ctx.beginPath();
      ctx.arc(x, mid, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - 1.5, mid - 1.5, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fill();
    }
  } else if (kind === 'shell') {
    const p = shellPaths();
    const size = W * 0.6;
    ctx.translate(W / 2 - size / 2, H / 2 - size / 2);
    ctx.scale(size / 100, size / 100);
    const body = new Path2D(p.body);
    const ears = new Path2D(p.ears);
    ctx.fillStyle = 'rgba(255,255,255,0.23)';
    ctx.fill(body);
    ctx.fill(ears);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 2.6;
    ctx.stroke(new Path2D(p.grooves));
    ctx.lineWidth = 2.2;
    ctx.stroke(body);
    ctx.stroke(ears);
  } else {
    const p = leafPaths();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(0, 0, W, H);
    const size = H * 0.92;
    ctx.translate(W / 2, H / 2);
    ctx.rotate(LEAF_TILT);
    ctx.translate(-size / 2, -size / 2);
    ctx.scale(size / 100, size / 100);
    const body = new Path2D(p.body);
    // 叶子那块先挖掉外面压深的那层，再稍微提亮
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fill(body);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill(body);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2.4;
    ctx.stroke(new Path2D(p.grooves));
    ctx.lineWidth = 3.4;
    ctx.stroke(new Path2D(p.rib));
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.8;
    ctx.stroke(body);
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  marks.set(kind, t);
  return t;
}

// 牌身、牌背的材质上加颗粒和花样（在材质第一次编译之前调用；接在原来的 onBeforeCompile，也就是泡水的那个后面）：
// 纹理照物体坐标贴（一张牌宽正好一遍，侧面按侧面的方向贴，不会拉长）；smoothFace 时牌面那一面（朝 +z）颗粒淡很多，牌上的字干净。
// mark 只画在牌背朝外那一面（朝 -z），四周的边不画。
// glow：花样发光（深夜的夜光月牙），给的是发光的颜色乘亮度，table3d.ts 每帧照灯多亮改（灯越暗越亮）
export function tileSurface(
  m: THREE.MeshStandardMaterial,
  opts: { grain?: Grain; smoothFace?: boolean; mark?: TileLook['mark']; glow?: { value: THREE.Color } },
): void {
  const grain = opts.grain ? grainTexture(opts.grain) : null;
  const mark = opts.mark ? markTexture(opts.mark) : null;
  const glow = mark ? opts.glow : undefined;
  if (!grain && !mark) return;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uGrain = { value: grain };
    sh.uniforms.uMark = { value: mark };
    if (glow) sh.uniforms.uMarkGlow = glow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTileP;\nvarying vec3 vTileN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTileP = position;\nvTileN = normal;');
    let frag = '';
    if (grain) {
      frag += `
{
  vec3 an = abs(vTileN);
  vec2 guv = an.z > 0.7 ? vTileP.xy : an.x > 0.7 ? vTileP.zy : vTileP.xz;
  vec3 gr = texture2D(uGrain, guv / ${TILE_W.toFixed(3)}).rgb;
  float gk = ${opts.smoothFace ? '(vTileN.z > 0.7 ? 0.3 : 1.0)' : '1.0'};
  diffuseColor.rgb *= mix(vec3(1.0), gr, gk);
}`;
    }
    if (mark) {
      frag += `
if (vTileN.z < -0.7) {
  vec4 mk = texture2D(uMark, vec2(vTileP.x / ${TILE_W.toFixed(3)} + 0.5, vTileP.y / ${TILE_H.toFixed(3)} + 0.5));
  diffuseColor.rgb *= mix(1.0, 0.7 + mk.r * 0.9, mk.a);${glow ? '\n  totalEmissiveRadiance += uMarkGlow * mk.g * mk.a;' : ''}
}`;
    }
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${grain ? 'uniform sampler2D uGrain;' : ''}\n${mark ? 'uniform sampler2D uMark;' : ''}\n${glow ? 'uniform vec3 uMarkGlow;' : ''}\nvarying vec3 vTileP;\nvarying vec3 vTileN;`,
      )
      .replace('#include <map_fragment>', `#include <map_fragment>\n${frag}`);
  };
  m.customProgramCacheKey = () => `tile-surface-${opts.grain ?? ''}-${!!opts.smoothFace}-${opts.mark ?? ''}-${!!glow}`;
}
