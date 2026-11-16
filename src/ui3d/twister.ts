import * as THREE from 'three';

// 宫永照的旋风自摸（3D、2.5D 牌桌），照用户给的雀魂龙卷风录像的节奏：
//   和了牌拍到桌上以后牌面朝上、平躺着在原地打转（转牌在牌桌上做，见 table3d.ts 的 twist）；
//   转了一会儿（TWISTER.erupt），牌底一闪，一股龙卷风拔地而起：下细上粗，一圈圈白色的风带绕着转
//   （朝着镜头这一面白、侧过去发灰带紫，背面——漏斗里面——透出淡紫），外面缠着细细的风丝往上爬，顶上几道大圈，
//   里面一柱紫光；风里卷着少许沙土和几块碎石；紫白色的电弧在风上爬、从风顶往天上劈，偶尔劈到桌上；
//   卷了一秒多，风带往外散开、淡成一片紫光，碎石被甩出去落在桌上，残电再闪几下；
//   风没了，牌还在原地转，慢慢停下来、停回原来的方向。
// 连和越多（size 0–1）风越高越粗、碎石和电弧越多。
// 风带、风丝、沙土的位置全在顶点着色器里按时间算（每条只存几个随机数）；风丝朝着镜头展开、细到不足 1.5 个像素时变暗不变细，
// 照 Humpalumps/ultra-elements（MIT）的 Ribbons.js（和初美的旋风 gale.ts 一样）；碎石甩出去以后按初速度、重力解析地算。
// 电弧、起风那一闪由牌桌放（onErupt、onArc、onBreak 回调：Effects 的 bolt、arc、flash、ring），这里只定时间和位置。
// CPU 上的漏斗（axisAt、radiusAt）和着色器里的（FUNNEL）是同一套式子，电弧、碎石才贴得在风上。

// 时间（秒，从牌拍到桌上那一下算）
export const TWISTER = {
  stand: 0.12, // 牌开始打转（别家的牌这以后被风卷过去）
  erupt: 0.3, // 牌立着转了这么久，风拔地而起
  grow: 0.22, // 风从地上长到顶
  hold: 1.12, // 风从起来到开始散
  fade: 0.26, // 散掉
  after: 0.62, // 风没了，牌还在转
  settle: 0.24, // 牌停下来、躺回去
};
export const TWISTER_TIME = TWISTER.erupt + TWISTER.hold + TWISTER.fade + TWISTER.after + TWISTER.settle;

// 连和到第几次时风多大（0–1）：第 2 次起卷，第 6 次起最大
export function twisterSize(streak: number): number {
  return Math.max(0, Math.min(1, (streak - 1) / 5));
}

export interface TwisterOpts {
  floor: THREE.Vector3; // 牌底下的桌面点：风从这里起
  scale: number; // 牌的大小（牌宽）
  size: number; // 0–1：连和越多风越大
  lean: THREE.Vector3; // 风顶往哪边歪（水平的单位向量，一般朝桌子中间）
  area: number; // 牌桌半宽：碎石落在桌上，出了桌子就掉下去
  height?: number; // 风多高（世界单位），不给就按 size、scale 算（twisterShape）
  leanAmt?: number; // 风顶往 lean 那边歪多少（世界单位）
}

// 风本来多高、风顶本来往桌子中间歪多少（牌桌照镜头再压矮、多歪一点，风顶才留在画面里）
export function twisterShape(size: number, scale: number): { height: number; leanAmt: number } {
  return { height: (11 + 4.5 * size) * scale, leanAmt: (1.0 + 0.6 * size) * scale };
}

// 电弧：crawl 在风上爬，sky 从风顶往天上劈，ground 从风上劈到桌上，residual 风散以后牌四周的残电
export type ArcKind = 'crawl' | 'sky' | 'ground' | 'residual';

const MAX_BANDS = 34;
const BAND_SEG = 28;
const MAX_WISPS = 90;
const WISP_SEG = 18;
const MAX_HALOS = 6;
const HALO_SEG = 56;
const CORE_SEG = 24;
const MAX_SAND = 220;
const MAX_ROCKS = 18;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const NOISE = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), f); }
`;

// 漏斗：h 是高度的几成（0 桌面、1 风顶）。轴往 uLean 那边歪（越高越歪），上半截跟着时间晃；半径下细上粗
const FUNNEL = /* glsl */ `
uniform float uTime;
uniform float uH;
uniform float uR0;
uniform float uR1;
uniform float uWob;
uniform vec3 uBase;
uniform vec3 uLean;
vec3 axisAt(float h, float t) {
  float w = pow(max(h, 0.0), 1.5) * uWob;
  return uBase + vec3(0.0, h * uH, 0.0) + uLean * h * h + vec3(sin(t * 2.1 + h * 2.0 + 1.3) * w, 0.0, cos(t * 1.7 + h * 2.6) * w);
}
float radiusAt(float h) { return uR0 + (uR1 - uR0) * pow(clamp(h, 0.0, 1.2), 1.5); }
`;

// 朝镜头展开的条带（同 gale.ts）：线细到不足 1.5 个像素时不再变细而是变暗
const STRIP = /* glsl */ `
uniform float uResY;
vec3 expand(vec3 P, vec3 P2, float halfW, float side, out float aa) {
  vec3 T = normalize(P2 - P + vec3(1e-5, 0.0, 0.0));
  vec3 V = cameraPosition - P;
  vec3 S = normalize(cross(T, V));
  float viewZ = max(-(viewMatrix * vec4(P, 1.0)).z, 0.1);
  float px = 2.0 * halfW * 0.5 * uResY * projectionMatrix[1][1] / viewZ;
  float c = max(px, 1.5);
  aa = px / c;
  return P + S * side * halfW * c / max(px, 1e-5);
}
`;

// 风带：绕着轴的一截宽带子，横向朝着镜头展开（镜头从上往下看也看得到整条带子的宽度，像雀魂的卡通风带），
// 绕着轴转、顺着走向往上爬一点；两头收成笔锋。朝镜头的这一面（vFace > 0）、背面按漏斗面的朝向分
const BAND_VERT = /* glsl */ `
attribute vec2 aUS; // u：0..1 顺着带子；side：-1..1 横着
attribute vec4 iA; // h0, span, theta0, omega
attribute vec4 iB; // width, rise, seed, bright
uniform float uGrow;
uniform float uFade;
varying vec2 vUS;
varying float vFace;
varying float vA;
varying float vSeed;
${FUNNEL}
void main() {
  float u = aUS.x;
  float h = iA.x + iB.y * u;
  float fade = uFade;
  float th = iA.z + iA.w * uTime * (1.0 + 0.5 * fade) + u * iA.y;
  vec3 radial = vec3(cos(th), 0.0, sin(th));
  float r = radiusAt(h) * (1.0 + 0.07 * sin(u * 5.0 + iB.z * 6.2831853 + uTime * 4.0)) * (1.0 + 0.9 * fade * fade);
  float taper = pow(max(sin(3.14159265 * u), 0.0), 0.5);
  vec3 C = axisAt(h, uTime) + radial * r;
  // 走向（绕轴的切线，带一点往上爬），横向 = 走向 × 朝镜头的方向
  vec3 T = normalize(vec3(-sin(th), 0.0, cos(th)) * iA.y * r + vec3(0.0, iB.y * uH, 0.0) + vec3(1e-5, 0.0, 0.0));
  vec3 S = normalize(cross(T, cameraPosition - C));
  if (S.y < 0.0) S = -S;
  vec3 P = C + S * aUS.y * 0.5 * iB.x * taper;
  P.y += fade * fade * uH * 0.25 * h;
  vFace = dot(radial, normalize(cameraPosition - P));
  float grown = 1.0 - smoothstep(uGrow - 0.08, uGrow + 0.01, h);
  vA = grown * (1.0 - fade) * iB.w;
  vUS = aUS;
  vSeed = iB.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;

// 正面（uPass 1，正常混合）：越正对镜头越白，侧过去发灰带一点紫，上沿一道亮边；
// 背面（uPass 0，加法）：漏斗里面透出来的淡紫。电闪的时候（uFlash）都亮一下
const BAND_FRAG = /* glsl */ `
uniform float uPass;
uniform float uFlash;
varying vec2 vUS;
varying float vFace;
varying float vA;
varying float vSeed;
${NOISE}
void main() {
  float face = vFace;
  if (uPass > 0.5) {
    if (face < 0.0) discard;
  } else if (face >= 0.0) discard;
  float s = abs(vUS.y);
  float edge = 1.0 - smoothstep(0.45, 1.0, s);
  float along = smoothstep(0.0, 0.1, vUS.x) * (1.0 - smoothstep(0.72, 1.0, vUS.x));
  // 笔刷：顺着带子的细丝，偶尔断开一小截
  float streak = 0.8 + 0.2 * n1(vUS.x * 38.0 + vUS.y * 2.0 + vSeed * 91.0);
  float gap = smoothstep(0.08, 0.2, n1(vUS.x * 4.0 + vSeed * 37.0));
  float a = edge * along * gap * vA;
  if (a < 0.003) discard;
  if (uPass > 0.5) {
    float lit = smoothstep(-0.05, 0.6, face);
    vec3 c = mix(vec3(0.74, 0.74, 0.9), vec3(1.0), lit) * streak;
    c += vec3(0.18) * smoothstep(0.2, 0.9, vUS.y) * lit;
    c = mix(c, vec3(0.9, 0.84, 1.0), clamp(uFlash, 0.0, 1.0) * 0.6);
    gl_FragColor = vec4(c, a * (0.72 + 0.25 * lit));
  } else {
    // 背面（漏斗里面）：同样是白的风带，暗一点、带一点紫，叠得淡一些（中间的紫光从风带缝里透出来）
    vec3 c = mix(vec3(0.62, 0.58, 0.86), vec3(0.85, 0.8, 1.0), clamp(uFlash, 0.0, 1.0)) * (0.85 + 0.15 * streak);
    gl_FragColor = vec4(c, a * 0.5);
  }
}
`;

// 风丝：漏斗外面一圈细细的螺旋，从下往上爬，爬到顶散掉
const WISP_VERT = /* glsl */ `
attribute vec2 aUS;
attribute vec4 iA; // seed, phase, theta0, omega
attribute vec4 iB; // rMul, span, width, climb（每秒爬几成）
attribute vec3 iCol;
uniform float uGrow;
uniform float uFade;
varying float vSide;
varying float vU;
varying float vAlpha;
varying vec3 vCol;
${FUNNEL}
${STRIP}
vec3 at(float u, float life) {
  float h = life * 1.12 - u * iB.y * 0.1;
  float th = iA.z + iA.w * uTime - u * iB.y;
  float r = radiusAt(clamp(h, 0.0, 1.1)) * iB.x * (1.0 + 1.3 * uFade);
  vec3 P = axisAt(clamp(h, 0.0, 1.1), uTime) + vec3(cos(th), 0.0, sin(th)) * r;
  P.y += uFade * uH * 0.2 * h;
  return P;
}
void main() {
  float u = aUS.x;
  float life = fract(iA.y + uTime * iB.w);
  vec3 P = at(u, life);
  vec3 P2 = at(u + 0.03, life);
  float taper = pow(sin(3.14159265 * clamp(u, 0.0, 1.0)), 0.55) * (1.0 - 0.4 * u);
  float aa;
  vec3 pos = expand(P, P2, iB.z * taper, aUS.y, aa);
  float lifeA = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.85, 1.0, life));
  float grown = 1.0 - smoothstep(uGrow - 0.05, uGrow + 0.05, life * 1.1);
  vAlpha = lifeA * aa * grown * (1.0 - uFade);
  vSide = aUS.y;
  vU = u;
  vCol = iCol;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

// 风顶的大圈：一圈斜着的细环，一张一缩、一隐一现；环上缺一截
const HALO_VERT = /* glsl */ `
attribute vec2 aUS;
attribute vec4 iA; // h, rMul, theta0, omega
attribute vec4 iB; // width, period, phase, tilt
attribute vec3 iCol;
uniform float uGrow;
uniform float uFade;
varying float vSide;
varying float vU;
varying float vAlpha;
varying vec3 vCol;
${FUNNEL}
${STRIP}
vec3 at(float u, float cyc) {
  float th = iA.z + iA.w * uTime + u * 6.2831853;
  float rr = radiusAt(iA.x) * iA.y * (0.8 + 0.4 * cyc) * (1.0 + 1.2 * uFade);
  vec3 c = axisAt(iA.x, uTime);
  return c + vec3(cos(th) * rr, sin(th) * rr * iB.w, sin(th) * rr);
}
void main() {
  float u = aUS.x;
  float cyc = fract(uTime / iB.y + iB.z);
  vec3 P = at(u, cyc);
  vec3 P2 = at(u + 0.02, cyc);
  float aa;
  vec3 pos = expand(P, P2, iB.x, aUS.y, aa);
  float gap = smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.7, 0.85, u));
  vAlpha = sin(3.14159265 * cyc) * gap * aa * smoothstep(0.85, 1.0, uGrow) * (1.0 - uFade);
  vSide = aUS.y;
  vU = 0.3;
  vCol = iCol;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

// 风丝、大圈的横截面：中心一道白芯，外面一层颜色（同 gale.ts）
const STRIP_FRAG = /* glsl */ `
uniform float uBright;
uniform float uFlash;
varying float vSide;
varying float vU;
varying float vAlpha;
varying vec3 vCol;
void main() {
  float s2 = vSide * vSide;
  float core = exp(-s2 * 18.0);
  float halo = max(0.0, 1.0 - s2) * exp(-s2 * 2.0);
  float along = mix(1.2, 0.4, vU);
  vec3 col = vCol * halo * 0.9 + vec3(1.0, 0.95, 1.0) * core * 0.6;
  gl_FragColor = vec4(col * along * vAlpha * uBright * (1.0 + 0.8 * uFlash), 1.0);
}
`;

// 风里的一柱紫光：顺着轴的一条朝镜头的宽带，宽度跟着漏斗，下面更亮、芯里发白
const CORE_VERT = /* glsl */ `
attribute vec2 aUS; // u：0 桌面 1 风顶；side -1..1
uniform float uGrow;
varying vec2 vUS;
${FUNNEL}
void main() {
  float h = aUS.x * max(uGrow, 0.001);
  vec3 C = axisAt(h, uTime);
  vec3 C2 = axisAt(h + 0.02, uTime);
  vec3 T = normalize(C2 - C + vec3(0.0, 1e-4, 0.0));
  vec3 S = normalize(cross(T, cameraPosition - C));
  vec3 P = C + S * aUS.y * radiusAt(h) * 0.95;
  vUS = vec2(aUS.x, aUS.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;
const CORE_FRAG = /* glsl */ `
uniform float uA;
uniform float uFlash;
varying vec2 vUS;
void main() {
  float y = vUS.x;
  float x = vUS.y;
  float body = exp(-x * x * 2.4) * smoothstep(0.0, 0.06, y) * (1.0 - smoothstep(0.8, 1.0, y));
  float core = exp(-x * x * 14.0) * (1.0 - 0.7 * y) * smoothstep(0.0, 0.04, y);
  vec3 c = vec3(0.4, 0.24, 0.95) * body * 0.75 + vec3(0.92, 0.86, 1.0) * core * 0.55;
  gl_FragColor = vec4(c * uA * (1.0 + 1.6 * uFlash), 1.0);
}
`;

// 沙土：一粒粒绕着下半截转、往上卷；风散的时候往外飞、淡掉
const SAND_VERT = /* glsl */ `
attribute vec4 aP; // phase, rMul, theta0, omega
attribute vec4 aQ; // size（牌宽）, climb, top, seed
uniform float uGrow;
uniform float uFade;
uniform float uScale;
varying float vA;
varying float vSeed;
${FUNNEL}
uniform float uResY;
void main() {
  float life = fract(aP.x + uTime * aQ.y);
  float h = life * aQ.z;
  float th = aP.z + aP.w * uTime;
  vec3 radial = vec3(cos(th), 0.0, sin(th));
  float r = radiusAt(h) * aP.y + uFade * uScale * 3.5 * (0.6 + aQ.w);
  vec3 P = axisAt(h, uTime) + radial * r;
  P.y += uFade * uScale * (1.5 * aQ.w - 0.4);
  vec4 mv = viewMatrix * vec4(P, 1.0);
  gl_Position = projectionMatrix * mv;
  float viewZ = max(-mv.z, 0.1);
  gl_PointSize = max(1.5, aQ.x * uScale * uResY * projectionMatrix[1][1] / viewZ * 0.5);
  float grown = 1.0 - smoothstep(uGrow - 0.05, uGrow + 0.05, h);
  vA = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.75, 1.0, life)) * grown * (1.0 - uFade);
  vSeed = aQ.w;
}
`;
const SAND_FRAG = /* glsl */ `
varying float vA;
varying float vSeed;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  vec3 c = mix(vec3(0.55, 0.47, 0.38), vec3(0.85, 0.77, 0.64), vSeed);
  gl_FragColor = vec4(c, vA * (1.0 - d * 0.6) * 0.8);
}
`;

// 一条条带的底板：(seg+1)×2 个顶点，aUS = (u, side)
function stripBase(seg: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const us: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    us.push(i / seg, -1, i / seg, 1);
    if (i > 0) {
      const v = i * 2;
      idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
    }
  }
  g.setAttribute('aUS', new THREE.Float32BufferAttribute(us, 2));
  // three 要一个 position 才肯画（值不用，位置在着色器里算）
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array((seg + 1) * 2 * 3).fill(0), 3));
  g.setIndex(idx);
  return g;
}

function setInst(g: THREE.InstancedBufferGeometry, name: string, data: number[], size: number): void {
  g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(data), size));
}

let dustTex: THREE.Texture | null = null;
// 地上卷起的一圈灰：几条螺旋的灰痕，从里往外越来越宽
function dustTexture(): THREE.Texture {
  if (dustTex) return dustTex;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d')!;
  x.lineCap = 'round';
  const R = N / 2;
  let seed = 41;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let a = 0; a < 6; a++) {
    const a0 = (a / 6) * Math.PI * 2 + rnd() * 0.5;
    for (let j = 0; j < 3; j++) {
      const off = (rnd() - 0.5) * 0.3;
      const sweep = 1.8 + rnd() * 1.4;
      const r0 = 0.15 + rnd() * 0.15;
      const r1 = 0.75 + rnd() * 0.22;
      let px = 0;
      let py = 0;
      for (let k = 0; k <= 50; k++) {
        const u = k / 50;
        const th = a0 + off + u * sweep;
        const r = R * (r0 + (r1 - r0) * u);
        const qx = R + Math.cos(th) * r;
        const qy = R + Math.sin(th) * r;
        if (k > 0) {
          const env = Math.sin(Math.PI * u) ** 0.8;
          x.strokeStyle = `rgba(214,198,176,${(0.55 * env).toFixed(3)})`;
          x.lineWidth = (2 + rnd() * 3) * (0.5 + u) * env;
          x.beginPath();
          x.moveTo(px, py);
          x.lineTo(qx, qy);
          x.stroke();
        }
        px = qx;
        py = qy;
      }
    }
  }
  dustTex = new THREE.CanvasTexture(c);
  dustTex.colorSpace = THREE.SRGBColorSpace;
  return dustTex;
}

interface Rock {
  a0: number; // 绕轴的起始角
  w: number; // 绕得多快（弧度/秒）
  hT: number; // 卷到多高（几成）
  rMul: number; // 离轴多远（漏斗半径的几倍）
  size: number; // 多大（牌宽）
  axis: THREE.Vector3; // 自己转的轴
  spin: number; // 自己转得多快
  flingAt: number; // 什么时候被甩出去（起风以后几秒）
  shape: THREE.Vector3; // 扁一点、长一点
  p?: THREE.Vector3; // 甩出去那一刻在哪、速度多少
  v?: THREE.Vector3;
  landAt?: number; // 落到桌上的时刻
  rest?: THREE.Vector3; // 落在哪
}

export class Twister {
  readonly group = new THREE.Group();
  // 起风那一下（牌底一闪）：base 是桌面上风的起点，top 是风顶
  onErupt: ((base: THREE.Vector3, top: THREE.Vector3, size: number) => void) | null = null;
  // 放一道电弧（牌桌接到 Effects.arc 上）
  onArc: ((a: THREE.Vector3, b: THREE.Vector3, kind: ArcKind) => void) | null = null;
  // 风散开那一下：mid 是风的半腰
  onBreak: ((mid: THREE.Vector3, size: number) => void) | null = null;

  private u = {
    uTime: { value: 0 },
    uH: { value: 9 },
    uR0: { value: 0.35 },
    uR1: { value: 3 },
    uWob: { value: 0.4 },
    uBase: { value: new THREE.Vector3() },
    uLean: { value: new THREE.Vector3() },
    uGrow: { value: 0 },
    uFade: { value: 0 },
    uFlash: { value: 0 },
    uResY: { value: 800 },
  };
  private bandGeo: THREE.InstancedBufferGeometry;
  private wispGeo: THREE.InstancedBufferGeometry;
  private haloGeo: THREE.InstancedBufferGeometry;
  private sandGeo: THREE.BufferGeometry;
  private coreMat: THREE.ShaderMaterial;
  private sandMat: THREE.ShaderMaterial;
  private dust: THREE.Mesh;
  private dustMat: THREE.MeshBasicMaterial;
  private glowMat: THREE.SpriteMaterial;
  private glow: THREE.Sprite;
  private rockMesh: THREE.InstancedMesh;
  private rocks: Rock[] = [];
  private mats: THREE.Material[] = [];
  private o: TwisterOpts | null = null;
  private t = -1; // 从牌拍下去那一下算
  private erupted = false;
  private broke = false;
  private nextArc = 0;
  private flash = 0;
  private H = 9;
  private R0 = 0.35;
  private R1 = 3;
  private wob = 0.4;
  private lean = new THREE.Vector3();
  private cam = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v3 = new THREE.Vector3();

  constructor() {
    const additive = (u: Record<string, THREE.IUniform>, vert: string, frag: string) => {
      const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.mats.push(m);
      return m;
    };
    // 风带：两遍，先画背面（加法），再画正面（正常混合）；从下往上排，镜头从上往下看时上面的风带盖住下面的
    this.bandGeo = stripBase(BAND_SEG);
    const back = new THREE.ShaderMaterial({ uniforms: { ...this.u, uPass: { value: 0 } }, vertexShader: BAND_VERT, fragmentShader: BAND_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mats.push(back);
    const front = new THREE.ShaderMaterial({ uniforms: { ...this.u, uPass: { value: 1 } }, vertexShader: BAND_VERT, fragmentShader: BAND_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mats.push(front);
    const backMesh = new THREE.Mesh(this.bandGeo, back);
    const frontMesh = new THREE.Mesh(this.bandGeo, front);
    backMesh.renderOrder = 7;
    frontMesh.renderOrder = 8;
    this.wispGeo = stripBase(WISP_SEG);
    const wisps = new THREE.Mesh(this.wispGeo, additive({ ...this.u, uBright: { value: 0.8 } }, WISP_VERT, STRIP_FRAG));
    wisps.renderOrder = 9;
    this.haloGeo = stripBase(HALO_SEG);
    const halos = new THREE.Mesh(this.haloGeo, additive({ ...this.u, uBright: { value: 1.2 } }, HALO_VERT, STRIP_FRAG));
    halos.renderOrder = 9;
    const coreGeo = stripBase(CORE_SEG);
    coreGeo.instanceCount = 1;
    this.coreMat = additive({ ...this.u, uA: { value: 0 } }, CORE_VERT, CORE_FRAG);
    const core = new THREE.Mesh(coreGeo, this.coreMat);
    core.renderOrder = 7.5;
    // 沙土
    this.sandGeo = new THREE.BufferGeometry();
    const sp: number[] = [];
    const sq: number[] = [];
    for (let i = 0; i < MAX_SAND; i++) {
      sp.push(Math.random(), rand(0.9, 1.9), Math.random() * Math.PI * 2, rand(6, 11));
      sq.push(rand(0.05, 0.11), rand(0.5, 1.1), rand(0.25, 0.6), Math.random());
    }
    this.sandGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(MAX_SAND * 3).fill(0), 3));
    this.sandGeo.setAttribute('aP', new THREE.Float32BufferAttribute(sp, 4));
    this.sandGeo.setAttribute('aQ', new THREE.Float32BufferAttribute(sq, 4));
    this.sandMat = new THREE.ShaderMaterial({ uniforms: { ...this.u, uScale: { value: 1 } }, vertexShader: SAND_VERT, fragmentShader: SAND_FRAG, transparent: true, depthWrite: false });
    this.mats.push(this.sandMat);
    const sand = new THREE.Points(this.sandGeo, this.sandMat);
    sand.renderOrder = 7;
    // 地上卷起的灰
    this.dustMat = new THREE.MeshBasicMaterial({ map: dustTexture(), transparent: true, depthWrite: false, opacity: 0 });
    this.mats.push(this.dustMat);
    this.dust = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.dustMat);
    this.dust.rotation.x = -Math.PI / 2;
    this.dust.renderOrder = 5;
    // 风脚一团光
    this.glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#d9c8ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
    this.mats.push(this.glowMat);
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.renderOrder = 6;
    // 碎石
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0, flatShading: true });
    this.mats.push(rockMat);
    this.rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, MAX_ROCKS);
    this.rockMesh.count = 0;
    const tint = new THREE.Color();
    for (let i = 0; i < MAX_ROCKS; i++) this.rockMesh.setColorAt(i, tint.setHSL(0.07 + Math.random() * 0.05, 0.14 + Math.random() * 0.12, 0.34 + Math.random() * 0.18));
    for (const o of [backMesh, frontMesh, wisps, halos, core, sand, this.dust, this.glow, this.rockMesh]) o.frustumCulled = false;
    this.group.add(this.dust, core, backMesh, sand, frontMesh, wisps, halos, this.glow, this.rockMesh);
    this.group.visible = false;
  }

  get busy(): boolean {
    return this.t >= 0;
  }

  // 牌拍到桌上那一下叫：TWISTER.erupt 秒以后起风
  play(o: TwisterOpts): void {
    this.o = { ...o, floor: o.floor.clone(), lean: o.lean.clone() };
    const s = o.scale;
    const z = o.size;
    this.t = 0;
    this.erupted = false;
    this.broke = false;
    this.flash = 0;
    const shape = twisterShape(z, s);
    this.H = o.height ?? shape.height;
    this.R0 = (0.32 + 0.08 * z) * s;
    this.R1 = (2.4 + 1.1 * z) * s;
    this.wob = (0.35 + 0.2 * z) * s;
    this.lean.copy(o.lean).setY(0).normalize().multiplyScalar(o.leanAmt ?? shape.leanAmt);
    const u = this.u;
    u.uH.value = this.H;
    u.uR0.value = this.R0;
    u.uR1.value = this.R1;
    u.uWob.value = this.wob;
    u.uBase.value.copy(o.floor);
    u.uLean.value.copy(this.lean);
    u.uGrow.value = 0;
    u.uFade.value = 0;
    u.uTime.value = 0;
    this.sandMat.uniforms.uScale.value = s;
    this.buildBands(z, s);
    this.buildWisps(z, s);
    this.buildHalos(z, s);
    this.sandGeo.setDrawRange(0, Math.round(MAX_SAND * (0.45 + 0.55 * z)));
    this.dust.position.copy(o.floor).setY(o.floor.y + 0.03);
    this.glow.position.copy(o.floor).setY(o.floor.y + 0.4 * s);
    this.buildRocks(z, s);
    this.group.visible = false;
  }

  clear(): void {
    this.t = -1;
    this.o = null;
    this.group.visible = false;
  }

  // 风带：从下往上一条条排（画的时候按这个顺序）
  private buildBands(z: number, s: number): void {
    const n = Math.min(MAX_BANDS, Math.round(24 + 10 * z));
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < n; i++) {
      const h0 = 0.03 + ((i + 0.5 + rand(-0.3, 0.3)) / n) * 0.95;
      a.push(h0, rand(1.35, 1.9) * Math.PI, Math.random() * Math.PI * 2, rand(9, 12.5) * (1.3 - 0.6 * h0));
      b.push((0.38 + 0.6 * h0) * s * rand(0.8, 1.2) * (0.85 + 0.3 * z), rand(0.015, 0.05), Math.random(), rand(0.85, 1));
    }
    setInst(this.bandGeo, 'iA', a, 4);
    setInst(this.bandGeo, 'iB', b, 4);
    this.bandGeo.instanceCount = n;
  }

  // 风丝：白的、淡紫的，绕在漏斗外面往上爬
  private buildWisps(z: number, s: number): void {
    const n = Math.round(Math.min(MAX_WISPS, 30 + 40 * z));
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];
    const col = new THREE.Color();
    const pal = ['#ffffff', '#f1eaff', '#d9c6ff', '#c3a8ff', '#ffffff'];
    for (let i = 0; i < n; i++) {
      a.push(Math.random(), Math.random(), Math.random() * Math.PI * 2, rand(8, 13));
      b.push(rand(1.05, 1.5), rand(0.9, 2.2), rand(0.025, 0.07) * s, rand(0.6, 1.3));
      col.set(pal[i % pal.length]);
      c.push(col.r, col.g, col.b);
    }
    setInst(this.wispGeo, 'iA', a, 4);
    setInst(this.wispGeo, 'iB', b, 4);
    setInst(this.wispGeo, 'iCol', c, 3);
    this.wispGeo.instanceCount = n;
  }

  // 风顶的大圈
  private buildHalos(z: number, s: number): void {
    const n = Math.min(MAX_HALOS, Math.round(3 + 3 * z));
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      a.push(rand(0.8, 1.04), rand(1.15, 1.5), Math.random() * Math.PI * 2, rand(5, 8) * (Math.random() < 0.5 ? 1 : 1.2));
      b.push(rand(0.035, 0.07) * s, rand(0.5, 0.85), Math.random(), rand(-0.14, 0.14));
      col.set(i % 2 ? '#e4d6ff' : '#ffffff');
      c.push(col.r, col.g, col.b);
    }
    setInst(this.haloGeo, 'iA', a, 4);
    setInst(this.haloGeo, 'iB', b, 4);
    setInst(this.haloGeo, 'iCol', c, 3);
    this.haloGeo.instanceCount = n;
  }

  // 碎石：一开始有几块被起风那一下直接崩出去，其余卷在风里转，风散时甩出去（也有中途甩出去的）
  private buildRocks(z: number, s: number): void {
    const n = Math.min(MAX_ROCKS, Math.round(7 + 9 * z));
    this.rocks = [];
    for (let i = 0; i < n; i++) {
      const kicked = i < 3;
      const early = !kicked && Math.random() < 0.3;
      this.rocks.push({
        a0: Math.random() * Math.PI * 2,
        w: rand(6, 9.5),
        hT: rand(0.12, 0.7),
        rMul: rand(1.05, 1.4),
        size: rand(0.12, 0.28) * s * (0.85 + 0.3 * z),
        axis: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
        spin: rand(6, 14),
        flingAt: kicked ? 0 : early ? rand(0.35, TWISTER.hold - 0.2) : TWISTER.hold + rand(-0.08, 0.12),
        shape: new THREE.Vector3(rand(0.8, 1.25), rand(0.55, 0.85), rand(0.75, 1.1)),
      });
    }
    this.rockMesh.count = n;
  }

  // CPU 上的漏斗（和着色器里的 FUNNEL 一样）
  axisAt(h: number, t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const f = this.o!.floor;
    const w = Math.pow(Math.max(h, 0), 1.5) * this.wob;
    return out.set(f.x + this.lean.x * h * h + Math.sin(t * 2.1 + h * 2.0 + 1.3) * w, f.y + h * this.H, f.z + this.lean.z * h * h + Math.cos(t * 1.7 + h * 2.6) * w);
  }

  radiusAt(h: number): number {
    return this.R0 + (this.R1 - this.R0) * Math.pow(Math.min(Math.max(h, 0), 1.2), 1.5);
  }

  // 漏斗面上的一点（th 是绕轴的角，和着色器一样 (cos, 0, sin)）
  private surface(h: number, th: number, t: number, mul = 1): THREE.Vector3 {
    const r = this.radiusAt(h) * mul;
    return this.axisAt(h, t).add(new THREE.Vector3(Math.cos(th) * r, 0, Math.sin(th) * r));
  }

  update(dt: number, camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
    if (this.t < 0 || !this.o) return;
    this.t += dt;
    const T = TWISTER;
    const tt = this.t - T.erupt;
    const o = this.o;
    const s = o.scale;
    camera.getWorldPosition(this.cam);
    this.u.uResY.value = renderer.domElement.height || 800;
    if (tt < 0) return;
    if (!this.erupted) {
      this.erupted = true;
      this.group.visible = true;
      this.flash = 1;
      this.onErupt?.(o.floor.clone(), this.axisAt(1, 0), o.size);
    }
    const end = T.hold + T.fade;
    if (!this.broke && tt >= T.hold) {
      this.broke = true;
      this.flash = Math.max(this.flash, 0.8);
      this.onBreak?.(this.axisAt(0.5, tt), o.size);
    }
    // 长高：一下子冲上去，冲过头一点再回来
    const g = Math.min(1, tt / T.grow);
    const grow = tt < T.grow ? 1 - Math.pow(1 - g, 3) : 1;
    const fade = smooth(0, 1, (tt - T.hold) / T.fade);
    const u = this.u;
    u.uTime.value = tt;
    u.uGrow.value = grow * 1.04;
    u.uFade.value = fade;
    this.flash *= Math.exp(-dt * 9);
    u.uFlash.value = this.flash;
    const linger = 1 - smooth(0, 1, (tt - T.hold) / (T.fade + 0.4));
    this.coreMat.uniforms.uA.value = Math.min(1, tt / 0.12) * (0.35 * linger + 0.65 * (1 - fade)) * (0.85 + 0.15 * Math.sin(tt * 23));
    // 地上的灰：起风时一下子铺开，转着，风散时淡掉
    const dr = (this.R0 * 5 + 1.6 * s) * (0.6 + 0.4 * Math.min(1, tt / 0.25)) * (1 + 0.5 * fade);
    this.dust.scale.set(dr * 2, dr * 2, 1);
    this.dust.rotation.z = -tt * 7;
    this.dustMat.opacity = Math.min(1, tt / 0.1) * (1 - fade) * 0.85;
    // 风脚的光：起风那一下最亮，之后一跳一跳
    const after = 1 - smooth(0, 1, (tt - end) / (T.after * 0.9));
    this.glowMat.opacity = Math.min(1, tt / 0.05) * (0.25 * after + 0.75 * (1 - fade)) * (0.45 + 0.25 * Math.sin(tt * 31)) + this.flash * 0.4;
    this.glow.scale.setScalar((2.2 + 1.2 * this.flash) * s);
    this.updateRocks(tt, s);
    // 电弧
    if (tt < end + T.after * 0.75) {
      this.nextArc -= dt;
      while (this.nextArc <= 0) {
        this.arc(tt);
        const dense = tt < end ? 0.05 + 0.05 * (1 - o.size) : 0.12;
        this.nextArc += dense * rand(0.7, 1.4);
      }
    }
    // 风散完、残电放完、碎石落定：收掉
    const rocksDone = this.rocks.every((r) => r.landAt !== undefined && tt > r.landAt + 0.9);
    if ((tt > end + T.after && rocksDone) || tt > end + T.after + 3) {
      this.t = -1;
      this.group.visible = false;
    }
  }

  // 放一道电弧：风还在时多是在风上爬、往天上劈，偶尔劈到桌上；风散以后是牌四周的残电
  private arc(tt: number): void {
    const o = this.o!;
    const s = o.scale;
    if (!this.onArc) return;
    // 朝镜头那一面的角（风带的 (cos, 0, sin)）：电弧多在看得见的这一面
    const toCam = Math.atan2(this.cam.z - o.floor.z, this.cam.x - o.floor.x);
    const face = () => toCam + rand(-1.3, 1.3);
    const end = TWISTER.hold + TWISTER.fade;
    if (tt >= end) {
      const a = o.floor.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(0.9 * s)).setY(o.floor.y + rand(0.9, 2.6) * s);
      const b = o.floor.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize().multiplyScalar(rand(0.8, 1.8) * s)).setY(o.floor.y + 0.05);
      this.onArc(a, b, 'residual');
      this.flash = Math.max(this.flash, 0.25);
      return;
    }
    const k = Math.random();
    if (k < 0.5 || tt < 0.08) {
      const h1 = rand(0.3, 0.95);
      const th1 = face();
      const h2 = Math.min(1.05, Math.max(0.15, h1 + rand(-0.28, 0.12)));
      const th2 = th1 + rand(0.5, 1.3) * (Math.random() < 0.5 ? -1 : 1);
      this.onArc(this.surface(h1, th1, tt, 1.08), this.surface(h2, th2, tt, 1.08), 'crawl');
      this.flash = Math.max(this.flash, 0.35);
    } else if (k < 0.82) {
      const th = face();
      const a = this.surface(rand(0.9, 1.02), th, tt, 1.02);
      const out = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
      const b = a.clone().addScaledVector(out, rand(1, 2.6) * s).add(new THREE.Vector3(rand(-0.6, 0.6) * s, rand(1.4, 3.4) * s, rand(-0.6, 0.6) * s));
      this.onArc(a, b, 'sky');
      this.flash = Math.max(this.flash, 0.45);
    } else {
      const th = face();
      const a = this.surface(rand(0.45, 0.8), th, tt, 1.05);
      const b = o.floor.clone().add(new THREE.Vector3(Math.cos(th + rand(-0.5, 0.5)), 0, Math.sin(th + rand(-0.5, 0.5))).multiplyScalar((this.R0 + rand(2.2, 4.2)) * s));
      b.y = o.floor.y + 0.04;
      // 劈到桌外就劈在桌边上
      const lim = o.area - 0.4;
      b.x = Math.max(-lim, Math.min(lim, b.x));
      b.z = Math.max(-lim, Math.min(lim, b.z));
      this.onArc(a, b, 'ground');
      this.flash = Math.max(this.flash, 0.7);
    }
  }

  private updateRocks(tt: number, s: number): void {
    const o = this.o!;
    const grav = 32 * s;
    const lim = o.area - 0.3;
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      let pos: THREE.Vector3;
      let scale = r.size;
      if (tt < r.flingAt) {
        // 卷在风里：往上卷到 hT，绕着轴转
        const h = 0.03 + r.hT * (1 - Math.exp(-tt * 2.4));
        const th = r.a0 + r.w * tt;
        pos = this.surface(h, th, tt, r.rMul);
        scale *= Math.min(1, tt / 0.12);
      } else {
        if (!r.p || !r.v) {
          // 甩出去：顺着转的方向切出去，再往外、往上一把
          const h = r.flingAt === 0 ? 0.02 : 0.03 + r.hT * (1 - Math.exp(-r.flingAt * 2.4));
          const th = r.a0 + r.w * r.flingAt;
          r.p = r.flingAt === 0 ? o.floor.clone().setY(o.floor.y + 0.15 * s) : this.surface(h, th, r.flingAt, r.rMul);
          const radial = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
          const tangent = new THREE.Vector3(-Math.sin(th), 0, Math.cos(th));
          const rr = this.radiusAt(h) * r.rMul;
          r.v = tangent
            .multiplyScalar(r.w * rr * 0.55)
            .addScaledVector(radial, rand(3, 6) * s)
            .add(new THREE.Vector3(0, rand(2.5, 6) * s, 0));
        }
        const k = tt - r.flingAt;
        if (r.landAt === undefined) {
          pos = r.p.clone().addScaledVector(r.v, k);
          pos.y -= 0.5 * grav * k * k;
          const inside = Math.abs(pos.x) < lim && Math.abs(pos.z) < lim;
          // 落到桌面上：停住（出了桌子就接着往下掉）
          if (inside && pos.y <= o.floor.y + r.size * 0.6 && k > 0.05) {
            r.landAt = tt;
            r.rest = pos.clone().setY(o.floor.y + r.size * 0.55);
            pos = r.rest.clone();
          } else if (!inside && pos.y < o.floor.y - 6 * s) {
            r.landAt = tt;
            r.rest = pos.clone();
          }
        } else {
          pos = r.rest!.clone();
          // 落定以后停一会儿，缩小不见
          scale *= 1 - smooth(0.45, 0.9, tt - r.landAt);
        }
      }
      const spin = r.landAt !== undefined ? r.spin * r.landAt : r.spin * tt;
      this.q.setFromAxisAngle(r.axis, spin);
      this.v3.copy(r.shape).multiplyScalar(Math.max(scale, 1e-4));
      this.m4.compose(pos, this.q, this.v3);
      this.rockMesh.setMatrixAt(i, this.m4);
    }
    this.rockMesh.instanceMatrix.needsUpdate = true;
  }
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
