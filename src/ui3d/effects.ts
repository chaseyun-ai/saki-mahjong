import * as THREE from 'three';

// 牌桌上的通用特效：冲击波、火花、闪光、闪电，外加一盏跟着特效亮一下的灯（桌面、牌、人都被照到）。
// 手法参考 Humpalumps/ultra-elements（MIT）：
//   冲击波照 Shockwaves.js：半径按爆炸波 r0 + (r1 - r0) x^0.4 走，前沿锐利、后面拖一道柔和的尾迹，越扩越暗
//   火花照 Particles.js 的 glow 粒子：每颗按自己的速度拉成一道流光，头亮尾淡，刚迸出来白热、慢慢变成本色；
//     阻力加重力的轨迹直接在顶点着色器里按时间算，细到不足 1.5 个像素时变暗不变细
//   闪电照 Bolts.js：分形折线（Reed & Wyvill 1994，一层噪声就是一层中点位移，两头钉住），
//     先导一步步摸下来、回击一下打亮、复击时主干不变只换分叉，最后余辉冷却、断成一串珠子；芯里一根游动的白丝
// （和牌原来的光柱撤掉了，换成 winSpots.ts 的聚光灯）
// 代码是照这些思路为牌桌重写的。都是加法混合，播完自己移除

interface Effect {
  obj: THREE.Object3D;
  t: number;
  duration: number;
  update: (k: number) => void;
}

interface Pulse {
  pos: THREE.Vector3;
  color: THREE.Color;
  peak: number;
  tau: number;
  t: number;
}

// 闪电先导摸下来要多久：调用的人要早这么久叫 bolt，打中的时刻才对得上
export const BOLT_LEADER = 0.16;

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- 闪电的分形折线 ----------

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
// 整数格点上的分段线性噪声，-1..1
function lnoise(x: number, salt: number): number {
  const i = Math.floor(x);
  const a = hash(i + salt * 57.31);
  const b = hash(i + 1 + salt * 57.31);
  return (a + (b - a) * (x - i)) * 2 - 1;
}
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
function perp(t: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3().crossVectors(t, Math.abs(t.y) < 0.99 ? UP : RIGHT).normalize();
}
// A 到 B 的一条闪电上 t（0..1）处的点：几层噪声叠起来，每层频率翻倍、幅度乘 gain；
// 包络 sqrt(sin(πt)) 把两头钉住，freeEnd 时只钉起点（分叉的梢可以乱跑）
function boltPath(A: THREE.Vector3, B: THREE.Vector3, t: number, seed: number, jag: number, freq: number, oct: number, freeEnd = 0, gain = 0.6): THREE.Vector3 {
  const d = B.clone().sub(A);
  const L = d.length();
  d.divideScalar(Math.max(L, 1e-6));
  const u = perp(d);
  const v = new THREE.Vector3().crossVectors(d, u);
  let n1 = 0;
  let n2 = 0;
  let amp = 1;
  let f = freq;
  for (let k = 0; k < oct; k++) {
    const s = seed + k * 17.13;
    n1 += amp * lnoise(t * f, s);
    n2 += amp * lnoise(t * f, s + 5.71);
    amp *= gain;
    f *= 2;
  }
  const env = Math.sqrt(Math.max(Math.sin(Math.PI * t * (1 - 0.5 * freeEnd)), 0));
  return A.clone()
    .lerp(B, t)
    .addScaledVector(u, n1 * L * jag * env)
    .addScaledVector(v, n2 * L * jag * env);
}
// 从母枝的方向偏开 25°~50°，方位随机
function deviate(T: THREE.Vector3, h: number): THREE.Vector3 {
  const th = THREE.MathUtils.degToRad(25 + 25 * hash(h + 1));
  const ph = Math.PI * 2 * hash(h + 2);
  const u = perp(T);
  const v = new THREE.Vector3().crossVectors(T, u);
  return T.clone()
    .multiplyScalar(Math.cos(th))
    .addScaledVector(u, Math.sin(th) * Math.cos(ph))
    .addScaledVector(v, Math.sin(th) * Math.sin(ph));
}

interface Strand {
  pts: THREE.Vector3[];
  t0: number; // 先导走到这根的起点时，在主干上走到了哪（0..1）
  tScale: number; // 这根的长度占主干的多少：先导在每根上走得一样快
  inten: number;
  width: number;
  branch: boolean;
}

// 一整道闪电（主干 + 分叉）铺成一组朝镜头的光带：位置是中线，aSide 是半宽方向，
// uv = (先导到这里的时刻, 横向 -1..1)，aMisc = (亮度, 沿这根走了几米, 是不是分叉)
function boltGeometry(strands: Strand[], eye: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [];
  const side: number[] = [];
  const uv: number[] = [];
  const misc: number[] = [];
  const index: number[] = [];
  for (const s of strands) {
    const n = s.pts.length - 1;
    const base = pos.length / 3;
    let metres = 0;
    for (let i = 0; i <= n; i++) {
      const p = s.pts[i];
      if (i > 0) metres += p.distanceTo(s.pts[i - 1]);
      // 用前后各两段的方向定光带的朝向，折线再碎光带也不会拧麻花
      const along = s.pts[Math.min(i + 2, n)].clone().sub(s.pts[Math.max(i - 2, 0)]);
      const u = i / n;
      const w = s.width * (s.branch ? 1 - 0.6 * u : 1);
      const sd = along.cross(eye.clone().sub(p)).normalize().multiplyScalar(w);
      const t = s.t0 + u * s.tScale;
      const inten = s.inten * (s.branch ? 1 - 0.7 * u : 1);
      for (const y of [-1, 1]) {
        pos.push(p.x, p.y, p.z);
        side.push(sd.x, sd.y, sd.z);
        uv.push(t, y);
        misc.push(inten, metres, s.branch ? 1 : 0);
      }
      if (i > 0) {
        const k = base + i * 2;
        index.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aMisc', new THREE.Float32BufferAttribute(misc, 3));
  geo.setIndex(index);
  return geo;
}

const BOLT_VERT = /* glsl */ `
attribute vec3 aSide;
attribute vec3 aMisc;
uniform float uWidth;
varying vec2 vUv;
varying vec3 vMisc;
void main() {
  vUv = uv;
  vMisc = aMisc;
  vec3 p = position + aSide * uv.y * uWidth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

// 先导没走到的地方不画、梢上更亮；余辉时按沿途的噪声断成一颗颗珠子
const BOLT_COMMON = /* glsl */ `
uniform float uReveal;
uniform float uIntensity;
uniform float uBranch;
uniform float uResidual;
uniform float uLen;
uniform float uSeed;
uniform vec3 uCore;
uniform vec3 uEdge;
varying vec2 vUv;
varying vec3 vMisc;
float h1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float ln(float x, float s) { float i = floor(x); return mix(h1(i + s * 57.31), h1(i + 1.0 + s * 57.31), x - i) * 2.0 - 1.0; }
float strength() {
  float t = vUv.x;
  if (t > uReveal + 1e-4) return -1.0;
  float I = uIntensity * vMisc.x * mix(1.0, uBranch, vMisc.z);
  if (uReveal < 1.0) I *= 1.0 + 3.0 * exp(-(uReveal - t) * uLen / 0.6);
  if (uResidual > 0.0) {
    float s = vMisc.y;
    float b = 0.5 + 0.35 * ln(s * 1.3, uSeed) + 0.15 * ln(s * 4.1, uSeed + 7.0);
    I *= smoothstep(uResidual * 1.15 - 0.3, uResidual * 1.15 + 0.05, b);
  }
  return I;
}
`;

// 芯：一根游动的白热细丝，裹在柔和的光身里，外面一层饱和的颜色
const BOLT_CORE_FRAG = /* glsl */ `
${BOLT_COMMON}
void main() {
  float I = strength();
  if (I <= 0.0) discard;
  float y = vUv.y, r2 = y * y, env = 1.0 - r2, s = vMisc.y;
  float o = y - 0.3 * sin(s * 9.0 + 2.1 * sin(s * 3.7));
  float body = exp(-r2 * 5.0);
  vec3 c = (uCore * (0.62 * exp(-o * o * 26.0) + 0.38 * body) + uEdge * 2.0 * (1.0 - body)) * env * env * I;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

// 外面的光晕：贴着芯的一圈加上宽的一片，到边上都是 0
const BOLT_GLOW_FRAG = /* glsl */ `
${BOLT_COMMON}
void main() {
  float I = strength();
  if (I <= 0.0) discard;
  float v2 = vUv.y * vUv.y;
  float g = 0.55 * (exp(-v2 * 3.0) - 0.0498) + 0.45 * exp(-v2 * 18.0);
  // 两头不留平的截口
  float ends = smoothstep(0.0, 0.04, vUv.x) * smoothstep(0.0, 0.03, uReveal - vUv.x + 0.03);
  gl_FragColor = vec4(uEdge * max(g, 0.0) * I * ends, 1.0);
  #include <colorspace_fragment>
}
`;

// ---------- 冲击波 ----------

const RING_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 前沿锐利、后面拖一道柔和的尾迹；一圈上亮度有点起伏，最亮的地方透出白芯
const RING_FRAG = /* glsl */ `
uniform float uR;
uniform float uTh;
uniform float uE;
uniform float uWhite;
uniform float uSeed;
uniform vec3 uColor;
varying vec2 vP;
void main() {
  float d = length(vP);
  float x = (d - uR) / (0.5 * uTh);
  float prof = exp(-x * x * (x > 0.0 ? 6.0 : 0.8));
  if (prof < 1e-3) discard;
  float a = atan(vP.y, vP.x);
  float brk = 0.82 + 0.18 * sin(a * 7.0 + uSeed) * sin(a * 13.0 - uSeed * 1.7);
  float p2 = prof * prof;
  vec3 c = (uColor * prof * brk + vec3(uWhite) * p2 * p2) * uE;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

// ---------- 火花 ----------

// 每颗火花：起点 aP0、初速 aVel、aLook = (寿命秒, 粗细, 种子, -)。阻力 k、重力 g 下的位置有解析解：
//   p(t) = p0 + (g/k) t + (v0 - g/k)(1 - e^{-kt}) / k
// 头在 p(t)，尾在 p(t - stretch)，在相机空间里铺成一个胶囊形的四边形
const SPARK_VERT = /* glsl */ `
attribute vec3 aP0;
attribute vec3 aVel;
attribute vec4 aLook;
uniform float uT;
uniform float uDrag;
uniform float uGrav;
uniform float uStretch;
uniform float uResY;
uniform vec3 uOrigin;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec2 vUv;
varying vec3 vCol;
varying float vSoft;
vec3 at(float t) {
  vec3 gk = vec3(0.0, -uGrav, 0.0) / uDrag;
  return uOrigin + aP0 + gk * t + (aVel - gk) * (1.0 - exp(-uDrag * t)) / uDrag;
}
void main() {
  vUv = vec2(0.0);
  vCol = vec3(0.0);
  vSoft = 0.0;
  float t = uT, x = t / aLook.x;
  if (x >= 1.0 || t <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 hv = (viewMatrix * vec4(at(t), 1.0)).xyz;
  vec3 tv = (viewMatrix * vec4(at(max(t - uStretch, 0.0)), 1.0)).xyz;
  float vz = max(-hv.z, 0.05);
  float pxW = 2.0 * vz / (projectionMatrix[1][1] * uResY);
  float size = aLook.y * (1.0 - 0.5 * x);
  float w = max(size, 1.5 * pxW);
  float aa = size / w;
  vec2 axis = tv.xy - hv.xy;
  float len = length(axis);
  vec2 dir = len > 1e-4 ? axis / len : vec2(1.0, 0.0);
  vec2 pp = vec2(-dir.y, dir.x);
  vec2 off = dir * (position.x < 0.0 ? -w : len + w) + pp * position.y * w;
  gl_Position = projectionMatrix * vec4(hv + vec3(off, 0.0), 1.0);
  vUv = vec2(position.x < 0.0 ? -1.0 : 1.0, position.y);
  vSoft = len / (len + 2.0 * w);
  float hot = 1.0 - smoothstep(0.0, 0.35, x);
  float fade = (1.0 - x) * (1.0 - x) * smoothstep(0.0, 0.03, t);
  float flick = 0.8 + 0.2 * sin(aLook.z * 97.0 + t * 23.0);
  // 拉得越长，同样的光摊得越开
  vCol = mix(uColor, uHot, hot) * (1.0 + 1.5 * hot) * fade * flick * aa * sqrt(2.0 * w / (len + 2.0 * w));
}
`;

const SPARK_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vSoft;
void main() {
  float x = vUv.x * 0.5 + 0.5;
  float ends = 1.0 - vSoft;
  float dx = x < ends * 0.5 ? (ends * 0.5 - x) / max(ends * 0.5, 1e-3) : x > 1.0 - ends * 0.5 ? (x - 1.0 + ends * 0.5) / max(ends * 0.5, 1e-3) : 0.0;
  float d2 = dx * dx + vUv.y * vUv.y;
  gl_FragColor = vec4(vCol * exp(-d2 * 4.0) * mix(1.0, 0.3, x), 1.0);
  #include <colorspace_fragment>
}
`;

export interface SparkOpts {
  count: number;
  life: [number, number]; // 秒
  vel: (v: THREE.Vector3, i: number) => void; // 填每颗的初速（米/秒）
  gravity?: number;
  drag?: number;
  size?: [number, number];
  stretch?: number; // 尾巴拖多少秒的路
  jitter?: number; // 起点散开多大
  hot?: THREE.ColorRepresentation;
}

const glowMat = (frag: string, uniforms: Record<string, THREE.IUniform>, vert: string) =>
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

const col = (c: THREE.ColorRepresentation) => new THREE.Color(c);

export class Effects {
  private list: Effect[] = [];
  private timers: { t: number; fn: () => void }[] = [];
  private pulses: Pulse[] = [];
  private glow = glowTexture();
  // 特效亮起来时照亮四周的灯：一直在场景里（中途加灯会让所有材质重新编译），平时是 0
  private light = new THREE.PointLight('#ffffff', 0, 0, 2);

  constructor(private scene: THREE.Scene) {
    this.scene.add(this.light);
  }

  private add(obj: THREE.Object3D, duration: number, update: (k: number) => void): void {
    obj.frustumCulled = false;
    this.scene.add(obj);
    this.list.push({ obj, t: 0, duration, update });
    update(0);
  }

  // 过一会儿再放
  later(delay: number, fn: () => void): void {
    if (delay <= 0) fn();
    else this.timers.push({ t: delay, fn });
  }

  // 四周被这团光照亮一下：一下子亮起来，按 tau 秒指数暗下去（几团光同时在，灯跟着最亮的那团）
  pulse(at: THREE.Vector3, color: THREE.ColorRepresentation, peak: number, tau = 0.25): void {
    this.pulses.push({ pos: at.clone(), color: col(color), peak, tau, t: 0 });
  }

  // 贴着桌面向外推的冲击波：半径按爆炸波曲线，一开始冲得快、越往外越慢，前沿锐利、后面拖着尾迹，越扩越暗
  ring(at: THREE.Vector3, color: THREE.ColorRepresentation, radius = 6, duration = 0.7, intensity = 1): void {
    const th0 = Math.max(0.5, radius * 0.12);
    const u = {
      uR: { value: 0 },
      uTh: { value: th0 },
      uE: { value: 0 },
      uWhite: { value: 0.7 },
      uSeed: { value: Math.random() * 10 },
      uColor: { value: col(color) },
    };
    const size = (radius + th0 * 1.5) * 2;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), glowMat(RING_FRAG, u, RING_VERT));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at).setY(at.y + 0.05);
    const r0 = radius * 0.04;
    this.add(mesh, duration, (k) => {
      u.uR.value = r0 + (radius - r0) * Math.pow(k, 0.4);
      u.uTh.value = th0 * (0.5 + 0.5 * k);
      u.uE.value = intensity * Math.pow(1 - k, 2.2) * Math.min(1, k / 0.04);
    });
  }

  // 一把火花：每颗按速度拉成一道流光，刚迸出来白热、慢慢变成本色，受阻力和重力
  sparks(at: THREE.Vector3, color: THREE.ColorRepresentation, o: SparkOpts): void {
    const n = o.count;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const p0 = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const look = new Float32Array(n * 4);
    const v = new THREE.Vector3();
    const [s0, s1] = o.size ?? [0.05, 0.1];
    let maxLife = 0;
    for (let i = 0; i < n; i++) {
      o.vel(v, i);
      vel.set([v.x, v.y, v.z], i * 3);
      const j = o.jitter ?? 0.3;
      p0.set([rand(-j, j), rand(0, j * 0.5), rand(-j, j)], i * 3);
      const life = rand(o.life[0], o.life[1]);
      maxLife = Math.max(maxLife, life);
      look.set([life, rand(s0, s1), Math.random(), 0], i * 4);
    }
    geo.setAttribute('aP0', new THREE.InstancedBufferAttribute(p0, 3));
    geo.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3));
    geo.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 4));
    geo.instanceCount = n;
    const u = {
      uT: { value: 0 },
      uDrag: { value: Math.max(o.drag ?? 1, 0.01) },
      uGrav: { value: o.gravity ?? 6 },
      uStretch: { value: o.stretch ?? 0.05 },
      uResY: { value: window.innerHeight * Math.min(window.devicePixelRatio || 1, 2) },
      uOrigin: { value: at.clone() },
      uColor: { value: col(color) },
      uHot: { value: col(o.hot ?? '#fffaf0') },
    };
    const mesh = new THREE.Mesh(geo, glowMat(SPARK_FRAG, u, SPARK_VERT));
    this.add(mesh, maxLife, (k) => (u.uT.value = k * maxLife));
  }

  // 往上飘散的一把光点（和牌、初美砸牌时撒的那种）：往上冲、往外散，慢慢落一点
  sparkles(at: THREE.Vector3, color: THREE.ColorRepresentation, count = 40, spread = 4, duration = 1.6): void {
    this.sparks(at, color, {
      count,
      life: [duration * 0.5, duration],
      vel: (v) => {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * spread * 1.4;
        v.set(Math.cos(a) * r, rand(4, 11), Math.sin(a) * r);
      },
      gravity: 4,
      drag: 1.3,
      size: [0.05, 0.11],
      stretch: 0.07,
      jitter: 0.6,
    });
  }

  // 一下子迸开的火星：往上半边四面八方飞，阻力大、落得快
  burst(at: THREE.Vector3, color: THREE.ColorRepresentation, count = 60, speed = 12, duration = 0.9): void {
    this.sparks(at, color, {
      count,
      life: [duration * 0.45, duration],
      vel: (v) => {
        v.set(rand(-1, 1), rand(0.15, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.35, 1));
      },
      gravity: 14,
      drag: 3,
      size: [0.04, 0.08],
      stretch: 0.045,
      jitter: 0.15,
    });
  }

  // 一闪：一下子亮到顶，前一小段很快暗下去、后面拖一点余光；streak 再加一道横着的光痕
  flash(at: THREE.Vector3, color: THREE.ColorRepresentation, size = 8, duration = 0.45, streak = false): void {
    const mat = new THREE.SpriteMaterial({ map: this.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at);
    const group = new THREE.Group();
    group.add(sprite);
    let line: THREE.Sprite | null = null;
    let lineMat: THREE.SpriteMaterial | null = null;
    if (streak) {
      lineMat = mat.clone();
      line = new THREE.Sprite(lineMat);
      line.position.copy(at);
      group.add(line);
    }
    this.add(group, duration, (k) => {
      const env = (0.7 * Math.exp(-k * 7) + 0.3 * Math.exp(-k * 2.5)) * (1 - k);
      sprite.scale.setScalar(size * (0.55 + 0.45 * (1 - Math.exp(-k * 8))) * (1 + 0.25 * k));
      mat.opacity = env;
      if (line && lineMat) {
        line.scale.set(size * 3.4 * (0.7 + 0.3 * k), size * 0.1, 1);
        lineMat.opacity = Math.exp(-k * 6) * (1 - k);
      }
    });
  }

  // 从天上 top 劈到 at 的闪电。先导先一步一步摸下来（暗、梢上亮），摸到地的那一下回击把整条打亮，
  // 再复击两下：主干还是那条、分叉换了，一下比一下弱；最后余辉从白冷成暖色，断成一串珠子散掉。
  // 回击那一下打中的地方炸开光、冲击波和火星，四周亮一下；复击时再亮两下（一共不超过三下闪）。eye 是镜头位置
  bolt(top: THREE.Vector3, at: THREE.Vector3, color: THREE.ColorRepresentation, eye: THREE.Vector3, duration = 0.95): void {
    const L = top.distanceTo(at);
    const seed = Math.floor(Math.random() * 1000);
    const jag = 0.075;
    const main: Strand = {
      pts: Array.from({ length: 97 }, (_, i) => boltPath(top, at, i / 96, seed, jag, 2, 6)),
      t0: 0,
      tScale: 1,
      inten: 1,
      width: 0.15,
      branch: false,
    };
    const strands = (bseed: number, nb: number): Strand[] => {
      const out = [main];
      for (let b = 0; b < nb; b++) {
        const h = bseed + b * 13.7;
        const tb = 0.08 + 0.62 * hash(h);
        const sA = boltPath(top, at, tb, seed, jag, 2, 6);
        const T = boltPath(top, at, tb + 0.05, seed, jag, 2, 6).sub(sA).normalize();
        const len = (0.15 + 0.25 * hash(h + 3)) * L;
        const sB = sA.clone().addScaledVector(deviate(T, h), len);
        const pts = Array.from({ length: 21 }, (_, i) => boltPath(sA, sB, i / 20, h * 7.1, jag * 1.3, 2, 4, 1));
        out.push({ pts, t0: tb, tScale: len / L, inten: 0.55, width: 0.09, branch: true });
        if (hash(h + 9) < 0.5) {
          const ts = 0.15 + 0.5 * hash(h + 11);
          const q0 = pts[Math.round(ts * 20)];
          const Tq = pts[Math.min(20, Math.round(ts * 20) + 2)].clone().sub(q0).normalize();
          const len2 = (0.3 + 0.3 * hash(h + 12)) * len;
          const q1 = q0.clone().addScaledVector(deviate(Tq, h + 21), len2);
          const sub = Array.from({ length: 11 }, (_, i) => boltPath(q0, q1, i / 10, h * 3.3, jag * 1.4, 1.5, 3, 1));
          out.push({ pts: sub, t0: tb + (ts * len) / L, tScale: len2 / L, inten: 0.35, width: 0.06, branch: true });
        }
      }
      return out;
    };
    const base = col(color);
    const white = col('#fffaf0');
    const ember = col('#ff6a3d');
    const shared = {
      uReveal: { value: 0 },
      uIntensity: { value: 0 },
      uBranch: { value: 1 },
      uResidual: { value: 0 },
      uLen: { value: L },
      uSeed: { value: seed },
      uCore: { value: white.clone() },
      uEdge: { value: base.clone() },
    };
    const coreU = { ...shared, uWidth: { value: 1 } };
    const glowU = { ...shared, uWidth: { value: 7 } };
    let geo = boltGeometry(strands(seed * 3.1, 7), eye);
    const core = new THREE.Mesh(geo, glowMat(BOLT_CORE_FRAG, coreU, BOLT_VERT));
    const glow = new THREE.Mesh(geo, glowMat(BOLT_GLOW_FRAG, glowU, BOLT_VERT));
    const group = new THREE.Group();
    group.add(glow, core);
    // 先导的每一步长短不一，像在一顿一顿地往下探
    const STEPS = 9;
    const rev: number[] = [];
    let acc = 0;
    for (let i = 0; i < STEPS; i++) rev.push((acc += 0.35 + 1.3 * Math.random()));
    for (let i = 0; i < STEPS; i++) rev[i] = (rev[i] / acc) * 0.92;
    rev[STEPS - 1] = 0.92;
    const at0 = BOLT_LEADER;
    const strikes = [at0, at0 + 0.13 + 0.04 * Math.random(), at0 + 0.25 + 0.04 * Math.random()];
    const peaks = [1, 0.6, 0.42];
    let struck = 0;
    const leader = base.clone().multiplyScalar(0.55).lerp(col('#b9a6ff'), 0.35);
    this.add(group, duration, (k) => {
      const s = k * duration;
      if (s < at0) {
        const x = (s / at0) * STEPS;
        const i = Math.min(STEPS - 1, Math.floor(x));
        const pulse = Math.exp(-(x - i) * 2.2);
        shared.uReveal.value = rev[i];
        shared.uIntensity.value = 0.22 + 0.55 * pulse;
        shared.uBranch.value = 0.8;
        shared.uEdge.value.copy(leader);
        shared.uCore.value.copy(white).multiplyScalar(0.7);
        glowU.uWidth.value = 4;
        return;
      }
      while (struck < strikes.length && s >= strikes[struck]) {
        // 复击：主干不变，分叉换一套
        if (struck > 0) {
          const next = boltGeometry(strands(seed * 3.1 + struck * 101, 4 - struck), eye);
          geo.dispose();
          geo = next;
          core.geometry = glow.geometry = geo;
        }
        this.strike(at, base, struck);
        struck++;
      }
      const i = struck - 1;
      const since = s - strikes[i];
      const last = struck === strikes.length;
      const env = 0.75 * Math.exp(-since / 0.035) + 0.25 * Math.exp(-since / 0.12);
      const glowing = 0.4 * Math.exp(-since / (last ? 0.45 : 0.25));
      const cool = last ? THREE.MathUtils.clamp((since - 0.05) / 0.35, 0, 1) : 0;
      shared.uReveal.value = 1;
      shared.uIntensity.value = peaks[i] * env * 1.25 + glowing;
      shared.uBranch.value = i === 0 ? 0.25 + 0.75 * Math.exp(-since / 0.09) : 0.15 + 0.6 * Math.exp(-since / 0.05);
      shared.uResidual.value = last ? THREE.MathUtils.clamp((since - 0.08) / (duration - strikes[i] - 0.08), 0, 1) : 0;
      shared.uCore.value.copy(white).lerp(base, cool * 0.7);
      shared.uEdge.value.copy(base).lerp(ember, cool * 0.8);
      glowU.uWidth.value = 4.5 + (i === 0 ? 4 : 2.5) * env;
    });
  }

  // 回击、复击打中地面的那一下
  private strike(at: THREE.Vector3, color: THREE.Color, n: number): void {
    const up = at.clone().setY(at.y + 1);
    if (n === 0) {
      // 打中的光不要太大，那张牌还看得见
      this.flash(up, '#ffffff', 4, 0.3);
      this.flash(up, color, 8, 0.6, true);
      this.ring(at, color, 7, 0.7);
      this.ring(at, '#ffffff', 4, 0.45, 0.8);
      this.burst(at, color, 70, 13, 0.9);
      this.pulse(up.clone().setY(at.y + 2.5), color, 90, 0.12);
    } else {
      this.flash(up, color, n === 1 ? 6 : 5, 0.35);
      this.pulse(up.clone().setY(at.y + 2.5), color, n === 1 ? 50 : 35, 0.08);
    }
  }

  update(dt: number): void {
    // 放着的特效可能在这一帧里又叫出新的特效、新的定时（闪电打中地面、光柱落地），新加的留到下一帧再走
    const timers = this.timers;
    this.timers = [];
    for (const t of timers) {
      t.t -= dt;
      if (t.t > 0) this.timers.push(t);
      else t.fn();
    }
    const n = this.list.length;
    const done = new Set<Effect>();
    for (let i = 0; i < n; i++) {
      const e = this.list[i];
      e.t += dt;
      const k = Math.min(1, e.t / e.duration);
      e.update(k);
      if (k < 1) continue;
      done.add(e);
      this.scene.remove(e.obj);
      const geos = new Set<THREE.BufferGeometry>();
      e.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) geos.add(m.geometry);
        (m.material as THREE.Material | undefined)?.dispose();
      });
      for (const g of geos) g.dispose();
    }
    if (done.size) this.list = this.list.filter((e) => !done.has(e));
    // 灯跟着最亮的那团光
    let best: Pulse | null = null;
    let bestI = 0;
    this.pulses = this.pulses.filter((p) => {
      p.t += dt;
      const i = p.peak * Math.exp(-p.t / p.tau);
      if (i > bestI) {
        best = p;
        bestI = i;
      }
      return i > p.peak * 0.01;
    });
    const b = best as Pulse | null;
    this.light.intensity = bestI;
    if (b) {
      this.light.position.copy(b.pos);
      this.light.color.copy(b.color);
    }
  }
}
