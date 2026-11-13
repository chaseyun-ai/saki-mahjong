import * as THREE from 'three';

// 宫永咲的岭上开花：岭上牌砸到桌上的那一下，
// 1. 牌上炸开一团白光，几道细细的光芒；
// 2. 一阵白色的旋风贴着桌面从牌底下卷出去（一道道毛笔扫出来似的风痕，边转边往外扩，先是厚厚一团、越扩越稀，最后剩几道细弧淡掉）；
// 3. 牌上留一团薄荷绿的光，慢慢暗下去；
// 4. 几片半透明的花瓣被风卷起来，打着转飘过牌桌；
// 5. 一颗颗四角的星光在牌四周和半张牌桌上空一闪一闪，慢慢飘散。
// 和得越大，风卷得越远、花瓣和星光越多（看基本点）。全是程序画的（着色器、canvas），没有贴图素材。
// 摸岭上牌那一下（sprout、trail）：岭上那张牌上先亮一下、冒一小把星光，牌飞进手里的一路上拖着星光。

// 基本点 → 花瓣片数：1 番 30 符 6 片、满贯 11 片、倍满 14 片、役满 20 片，两倍役满封顶 29 片
export function lilyCount(base: number): number {
  const b = Math.min(Math.max(base, 0), 16000);
  return Math.round(5 + 15 * (b / 8000) ** 0.7);
}

// 0（小和）到 1（两倍役满）：风卷多远、光多亮、留多久（音效也跟着）
export function lilyGrand(base: number): number {
  const b = Math.min(Math.max(base, 240), 16000);
  return Math.log(b / 240) / Math.log(16000 / 240);
}

// 基本点 → 星光颗数：小和 60 颗、满贯 160 颗上下、役满 230 颗，两倍役满封顶 260 颗
export function lilyStars(base: number): number {
  return Math.round(60 + 200 * lilyGrand(base));
}

export interface LilyOpts {
  at: THREE.Vector3; // 光在哪亮（牌上）
  floor: THREE.Vector3; // 旋风从桌面上哪卷出去（牌底下）
  base: number; // 这一手的基本点（WinResult.base）
  scale?: number; // 牌的大小
  area?: number; // 牌桌半宽：星光、旋风不出这个范围太多
  inward?: THREE.Vector3; // 往牌桌中间的方向（水平）：花瓣、星光偏往这边
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const MAX_PETALS = 96;
const MAX_STARS = 1200;
const VORTEX_TIME = 1.5;
const MINT = '#7dffc4';

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

// 旋风：一张贴着桌面的方片，在极坐标里画一条绕了好几圈的对数螺线带，带里是一道道顺着螺线拉长的风痕。
// 前沿（front）一开始冲得快、越来越慢；风痕一开始密得连成一片，往后阈值抬高、只剩几道细弧；中间慢慢空出来
const VORTEX_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const VORTEX_FRAG = /* glsl */ `
precision highp float;
uniform float uT;
uniform float uDur;
uniform float uSeed;
uniform float uDir;
uniform float uOpacity;
uniform vec3 uTint;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float front = 0.07 + 0.93 * (1.0 - exp(-3.3 * uT));
  // 转过的角度：一开始转得猛，慢下来以后还在悠悠地转
  float ang = atan(p.y, p.x) * uDir - (3.6 * (1.0 - exp(-1.8 * uT)) + 0.7 * uT);
  // 三条旋臂的对数螺线：s 每过一整数是一条风带，w 是带里的横向位置，a 是顺着风带的角度（跨圈连续）
  float s = 1.7 * log(r / front + 0.002) - 3.0 * ang / 6.2831853;
  float n = floor(s);
  float w = s - n;
  float a = ang + 6.2831853 * n / 3.0;
  float k = 0.6 * vnoise(vec2(w * 3.2 + uSeed + n * 1.7, a * 0.9 + uSeed * 3.1)) + 0.4 * vnoise(vec2(w * 7.5 + 7.3, a * 2.1 - uSeed));
  float thin = smoothstep(0.1, 0.95, uT);
  float thr = mix(0.2, 0.55, thin);
  float streak = smoothstep(thr, thr + mix(0.3, 0.16, thin), k) * smoothstep(0.0, 0.2, w) * smoothstep(1.0, 0.8, w);
  // 笔锋：风痕里一丝丝的细毛，脊上再提亮一道
  streak *= 0.72 + 0.28 * vnoise(vec2(w * 34.0 + n * 9.1, a * 1.4));
  streak += 0.45 * smoothstep(thr + 0.22, thr + 0.4, k);
  float outer = 1.0 - smoothstep(front * 0.7, front, r);
  float hollow = front * 0.5 * smoothstep(0.15, 1.0, uT) + 0.001;
  float inner = smoothstep(hollow * 0.45, hollow, r);
  float core = (1.0 - smoothstep(0.0, front * 0.85, r)) * (1.0 - smoothstep(0.05, 0.32, uT));
  float rim = 0.5 + 0.5 * smoothstep(front * 0.25, front * 0.85, r);
  float fade = smoothstep(0.0, 0.04, uT) * (1.0 - smoothstep(uDur * 0.5, uDur, uT));
  float alpha = clamp(streak * rim * inner + core * 0.9, 0.0, 1.0) * outer * fade * uOpacity;
  // 靠里的一圈染上薄荷绿
  float green = (1.0 - smoothstep(front * 0.1, front * 0.75, r)) * smoothstep(0.08, 0.35, uT);
  gl_FragColor = vec4(mix(vec3(1.0), uTint, green * 0.75), alpha);
}`;

// 星光：一批点，位置、闪烁全在顶点着色器里按时间算（CPU 只在冒出来的时候写一次）
const STAR_VERT = /* glsl */ `
uniform float uNow;
uniform float uViewH;
attribute vec3 aVel;
attribute vec2 aTime; // 什么时候冒出来、亮多久
attribute vec3 aMisc; // 大小、相位、有多绿
varying float vA;
varying float vGreen;
void main() {
  float age = uNow - aTime.x;
  float k = age / aTime.y;
  if (age < 0.0 || k > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  // 冒出来的劲很快被空气拖住，之后慢慢往上飘
  vec3 pos = position + aVel * (1.0 - exp(-2.0 * age)) / 2.0 + vec3(0.0, 0.15 * age, 0.0);
  float tw = 0.5 + 0.5 * sin(age * (5.0 + 7.0 * fract(aMisc.y * 7.31)) + aMisc.y * 6.2831853);
  vA = smoothstep(0.0, 0.1, k) * (1.0 - smoothstep(0.55, 1.0, k)) * (0.35 + 0.65 * tw);
  vGreen = aMisc.z;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float persp = projectionMatrix[2][3] < -0.5 ? 1.0 / max(0.1, -mv.z) : 1.0;
  gl_PointSize = aMisc.x * 1.9 * (0.65 + 0.35 * tw) * projectionMatrix[1][1] * uViewH * 0.5 * persp;
}`;
const STAR_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uTint;
varying float vA;
varying float vGreen;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  vec2 q = abs(p);
  // 四角星：|x|^½ + |y|^½ < 1
  float star = clamp(1.0 - (sqrt(q.x) + sqrt(q.y)), 0.0, 1.0);
  float body = smoothstep(0.0, 0.22, star);
  float halo = exp(-dot(p, p) * 6.0) * 0.45;
  vec3 col = mix(uTint, vec3(1.0), smoothstep(0.12, 0.5, star) * (1.0 - 0.45 * vGreen));
  gl_FragColor = vec4(col, (body + halo) * vA);
}`;

// 花瓣的形状：沿 +y 长、x 方向宽，根部窄、四成处最宽、尖头；横截面中间凹，尖上往背面卷一点
function petalGeometry(len: number, wid: number, curl: number, groove: number): THREE.BufferGeometry {
  const nu = 10;
  const nv = 4;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const w = wid * Math.sin(Math.PI * u ** 0.72) ** 0.85;
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1;
      pos.push(v * w, (u - 0.5) * len, -groove * v * v * w + curl * u ** 2.2 * len);
      uv.push(j / nv, u);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j;
      const b = a + nv + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// 花瓣：半透明，中间白、边上和两头是薄荷绿，像透着光
function petalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(120,235,170,0.85)');
  g.addColorStop(0.35, 'rgba(225,255,236,0.8)');
  g.addColorStop(0.7, 'rgba(200,255,225,0.7)');
  g.addColorStop(1, 'rgba(130,240,185,0.55)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 128);
  // 两边再绿一点、透一点
  const e = x.createLinearGradient(0, 0, 64, 0);
  e.addColorStop(0, 'rgba(90,225,150,0.55)');
  e.addColorStop(0.3, 'rgba(90,225,150,0)');
  e.addColorStop(0.7, 'rgba(90,225,150,0)');
  e.addColorStop(1, 'rgba(90,225,150,0.55)');
  x.fillStyle = e;
  x.fillRect(0, 0, 64, 128);
  // 中肋：一道亮线
  const rib = x.createLinearGradient(0, 128, 0, 10);
  rib.addColorStop(0, 'rgba(255,255,255,0.9)');
  rib.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = rib;
  x.fillRect(30, 10, 4, 118);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// 光芒：从中间往外的十几道细线，长短粗细不一
function rayTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.translate(128, 128);
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.25;
    const len = 60 + 66 * Math.abs(Math.sin(i * 78.233));
    const g = x.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.save();
    x.rotate(a);
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(0, -1.6 - (i % 3) * 0.7);
    x.lineTo(len, 0);
    x.lineTo(0, 1.6 + (i % 3) * 0.7);
    x.fill();
    x.restore();
  }
  return new THREE.CanvasTexture(c);
}

interface Petal {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  axis: THREE.Vector3; // 自转轴
  spin: number;
  phase: number;
  sway: number;
  size: number;
  born: number;
  life: number;
  swirl: number; // 被旋风带着绕圈的劲
  tint: THREE.Color;
}

interface Vortex {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  dur: number;
}

// 一团光：kind 'flash' 一闪就没，'rays' 光芒往外一冲，'mint' 留着慢慢暗
interface Glow {
  sprite: THREE.Sprite;
  born: number;
  dur: number;
  size: number;
  peak: number;
  kind: 'flash' | 'rays' | 'mint';
}

const TINTS = ['#ffffff', '#e6fff0', '#c8ffe0', '#f4fff8'].map((c) => new THREE.Color(c));

export class LilyFx {
  readonly group = new THREE.Group();
  private now = 0;
  private end = 0;
  private vortices: Vortex[] = [];
  private glows: Glow[] = [];
  private petals: Petal[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private petalMat: THREE.MeshBasicMaterial | null = null;
  private petalGeo: THREE.BufferGeometry | null = null;
  private petalTex: THREE.CanvasTexture | null = null;
  private glowTex: THREE.CanvasTexture | null = null;
  private rayTex: THREE.CanvasTexture | null = null;
  private plane: THREE.PlaneGeometry | null = null;
  private stars: THREE.Points | null = null;
  private starMat: THREE.ShaderMaterial | null = null;
  private starAt = 0; // 下一颗星光写到哪一格（写满了从头覆盖最老的）
  private starDirty = false;
  // 还没放出去的：[时刻, 放什么]
  private queue: { at: number; fn: () => void }[] = [];
  private dummy = new THREE.Object3D();
  private center = new THREE.Vector3();
  private dir = 1; // 旋风往哪边转
  // 跟着一张牌飞的星光（摸岭上牌）：到 until 为止每隔一小会儿在牌现在的位置撒一颗
  private trails: { get: () => THREE.Vector3 | null; until: number; next: number; petal: number; scale: number }[] = [];

  // 还要多久才放完（秒）
  get remaining(): number {
    return Math.max(0, this.end - this.now);
  }

  private ensure(): void {
    if (this.mesh) return;
    this.petalTex = petalTexture();
    this.glowTex = glowTexture();
    this.rayTex = rayTexture();
    this.plane = new THREE.PlaneGeometry(2, 2);
    this.plane.rotateX(-Math.PI / 2);
    this.petalGeo = petalGeometry(1, 0.3, 0.22, 0.4);
    this.petalMat = new THREE.MeshBasicMaterial({ map: this.petalTex, side: THREE.DoubleSide, transparent: true, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(this.petalGeo, this.petalMat, MAX_PETALS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, TINTS[0]);
    this.group.add(this.mesh);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_STARS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(MAX_STARS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTime', new THREE.BufferAttribute(new Float32Array(MAX_STARS * 2).fill(-1e6), 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aMisc', new THREE.BufferAttribute(new Float32Array(MAX_STARS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uNow: { value: 0 }, uViewH: { value: 720 }, uTint: { value: new THREE.Color(MINT) } },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 12;
    const size = new THREE.Vector2();
    this.stars.onBeforeRender = (renderer) => {
      this.starMat!.uniforms.uViewH.value = renderer.getDrawingBufferSize(size).y;
    };
    this.group.add(this.stars);
  }

  // 岭上牌砸到桌上：白光、旋风、薄荷绿的光、花瓣、星光
  bloom(o: LilyOpts): void {
    this.ensure();
    const s = o.scale ?? 1;
    const u = Math.max(1, s * 0.8); // 牌放大了（改良布局自己的手牌），特效跟着大一点，但不照着全放大
    const grand = lilyGrand(o.base);
    const inward = o.inward?.clone().setY(0).normalize() ?? new THREE.Vector3();
    const area = o.area ?? 14;
    const reach = Math.min((9 + 6 * grand) * u, area * 1.3);
    const at = o.at.clone();
    const floor = o.floor.clone();
    this.center.copy(floor);
    this.dir = Math.random() < 0.5 ? 1 : -1;
    const t0 = this.now;
    this.end = Math.max(this.end, t0 + 2.6 + 0.9 * grand);

    this.glow(at, 'flash', (4.2 + 2.2 * grand) * u, 0.42, 1, '#ffffff');
    this.glow(at, 'rays', (6.5 + 3 * grand) * u, 0.36, 0.9, '#f2fff8');
    this.glow(at, 'mint', (5.2 + 2.4 * grand) * u, 2.2 + 0.9 * grand, 1, MINT);
    this.glow(at, 'mint', (2.4 + 0.8 * grand) * u, 1.8 + 0.8 * grand, 0.9, '#d8fff0');
    this.vortex(floor, reach, VORTEX_TIME + 0.25 * grand, 1, Math.random() * 40);
    // 里面再叠一层小一点、晚一点的，风痕有前有后
    this.queue.push({ at: t0 + 0.09, fn: () => this.vortex(floor, reach * 0.62, VORTEX_TIME * 0.85, 0.7, Math.random() * 40) });

    // 花瓣：被风从牌边卷起来，一片片陆续起飞；有两三片大的飘得高、往牌桌中间去
    const petals = lilyCount(o.base);
    for (let i = 0; i < petals; i++) {
      const big = i < 2 + Math.round(2 * grand);
      this.queue.push({ at: t0 + 0.06 + (i / petals) * 0.5 + rand(0, 0.08), fn: () => this.whirl(floor, inward, u, grand, big) });
    }

    // 星光：一半绕着牌往上冒（一直闪到最后），一半跟着风撒到半张牌桌上空
    const stars = lilyStars(o.base);
    const near = Math.round(stars * 0.45);
    for (let i = 0; i < near; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(0.2, 2.4) ** 1.2 * u;
      const p = new THREE.Vector3(at.x + Math.cos(a) * r, rand(0.1, 2.6) * u, at.z + Math.sin(a) * r).addScaledVector(inward, rand(0, 1.2) * u);
      const v = new THREE.Vector3(Math.cos(a) * rand(0.3, 2.2), rand(0.4, 3.2), Math.sin(a) * rand(0.3, 2.2)).multiplyScalar(u);
      this.star(p, v, t0 + 0.1 + rand(0, 1) ** 1.4 * (1.3 + 0.7 * grand), rand(0.6, 1.3), rand(0.2, 0.42) * u, rand(0.3, 1));
    }
    const a0 = Math.atan2(inward.z, inward.x);
    for (let i = near; i < stars; i++) {
      // 偏往牌桌里面那半边撒
      const a = a0 + rand(-1, 1) * Math.PI * (Math.random() < 0.8 ? 0.6 : 1);
      const d = Math.sqrt(rand(0.03, 1)) * reach * 1.05;
      const p = new THREE.Vector3(floor.x + Math.cos(a) * d, rand(0.3, 3.6) * u, floor.z + Math.sin(a) * d);
      p.x = THREE.MathUtils.clamp(p.x, -area * 1.15, area * 1.15);
      p.z = THREE.MathUtils.clamp(p.z, -area * 1.15, area * 1.15);
      // 顺着风转的方向带一点
      const v = new THREE.Vector3(-Math.sin(a) * this.dir, 0, Math.cos(a) * this.dir).multiplyScalar(rand(0.2, 1)).add(new THREE.Vector3(rand(-0.3, 0.3), rand(0, 0.5), rand(-0.3, 0.3)));
      this.star(p, v, t0 + 0.16 + (d / reach) * 0.4 + rand(0, 0.9 + 0.5 * grand), rand(0.8, 1.7), rand(0.2, 0.46) * u, rand(0, 0.8));
    }
  }

  // 摸岭上牌那一下：岭上那张牌上亮一团薄荷绿的光，冒一小把星光、两三片花瓣
  sprout(at: THREE.Vector3, scale = 1): void {
    this.ensure();
    const u = Math.max(1, scale * 0.8);
    this.center.copy(at);
    this.end = Math.max(this.end, this.now + 1.6);
    this.glow(at, 'flash', 2.6 * u, 0.35, 0.85, '#ffffff');
    this.glow(at, 'mint', 2.4 * u, 1.3, 0.7, MINT);
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2);
      const p = at.clone().add(new THREE.Vector3(Math.cos(a) * rand(0.1, 0.8), rand(0, 0.6), Math.sin(a) * rand(0.1, 0.8)).multiplyScalar(u));
      const v = new THREE.Vector3(Math.cos(a) * rand(0.4, 2), rand(0.8, 3), Math.sin(a) * rand(0.4, 2)).multiplyScalar(u);
      this.star(p, v, this.now + rand(0, 0.35), rand(0.6, 1.2), rand(0.2, 0.38) * u, rand(0.2, 1));
    }
    for (let i = 0; i < 3; i++) this.puff(at, u);
  }

  // 星光跟着一张牌飞 seconds 秒（get 给牌现在的位置，牌没了给 null）
  trail(get: () => THREE.Vector3 | null, seconds: number, scale = 1): void {
    this.ensure();
    this.end = Math.max(this.end, this.now + seconds + 1);
    this.trails.push({ get, until: this.now + seconds, next: this.now, petal: this.now + 0.1, scale: Math.max(1, scale * 0.8) });
  }

  clear(): void {
    this.petals = [];
    this.queue = [];
    this.trails = [];
    this.end = this.now;
    for (const v of this.vortices) this.dropVortex(v);
    this.vortices = [];
    for (const g of this.glows) this.dropGlow(g);
    this.glows = [];
    if (this.mesh) this.mesh.count = 0;
    if (this.stars) {
      const t = this.stars.geometry.getAttribute('aTime') as THREE.BufferAttribute;
      (t.array as Float32Array).fill(-1e6);
      t.needsUpdate = true;
    }
  }

  dispose(): void {
    this.clear();
    this.petalGeo?.dispose();
    this.petalMat?.dispose();
    this.petalTex?.dispose();
    this.glowTex?.dispose();
    this.rayTex?.dispose();
    this.plane?.dispose();
    this.starMat?.dispose();
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    if (this.stars) {
      this.group.remove(this.stars);
      this.stars.geometry.dispose();
    }
    this.mesh = null;
    this.stars = null;
  }

  // ---------- 光、旋风 ----------

  private glow(at: THREE.Vector3, kind: Glow['kind'], size: number, dur: number, peak: number, color: string): void {
    const mat = new THREE.SpriteMaterial({ map: kind === 'rays' ? this.rayTex! : this.glowTex!, color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0, toneMapped: false });
    if (kind === 'rays') mat.rotation = rand(0, Math.PI * 2);
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at);
    sprite.renderOrder = 11;
    this.group.add(sprite);
    this.glows.push({ sprite, born: this.now, dur, size, peak, kind });
  }

  private dropGlow(g: Glow): void {
    this.group.remove(g.sprite);
    g.sprite.material.dispose();
  }

  private vortex(at: THREE.Vector3, radius: number, dur: number, opacity: number, seed: number): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uDur: { value: dur }, uSeed: { value: seed }, uDir: { value: this.dir }, uOpacity: { value: opacity }, uTint: { value: new THREE.Color(MINT) } },
      vertexShader: VORTEX_VERT,
      fragmentShader: VORTEX_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.plane!, mat);
    mesh.position.set(at.x, 0.04, at.z);
    mesh.scale.set(radius, 1, radius);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.vortices.push({ mesh, mat, born: this.now, dur });
  }

  private dropVortex(v: Vortex): void {
    this.group.remove(v.mesh);
    v.mat.dispose();
  }

  // ---------- 星光 ----------

  private star(pos: THREE.Vector3, vel: THREE.Vector3, born: number, life: number, size: number, green: number): void {
    const g = this.stars!.geometry;
    const i = this.starAt;
    this.starAt = (i + 1) % MAX_STARS;
    (g.getAttribute('position') as THREE.BufferAttribute).setXYZ(i, pos.x, pos.y, pos.z);
    (g.getAttribute('aVel') as THREE.BufferAttribute).setXYZ(i, vel.x, vel.y, vel.z);
    (g.getAttribute('aTime') as THREE.BufferAttribute).setXY(i, born, life);
    (g.getAttribute('aMisc') as THREE.BufferAttribute).setXYZ(i, size, Math.random(), green);
    this.starDirty = true;
    this.end = Math.max(this.end, born + life);
  }

  // ---------- 花瓣 ----------

  private spawn(pos: THREE.Vector3, vel: THREE.Vector3, size: number, swirl: number, life: number): void {
    if (this.petals.length >= MAX_PETALS) return;
    this.petals.push({
      pos,
      vel,
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28))),
      axis: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
      spin: rand(2.5, 6.5) * (Math.random() < 0.5 ? -1 : 1),
      phase: rand(0, 6.28),
      sway: rand(0.3, 0.9),
      size,
      born: this.now,
      life,
      swirl,
      tint: TINTS[Math.floor(Math.random() * TINTS.length)],
    });
    this.end = Math.max(this.end, this.now + life);
  }

  // 被旋风卷起来的一片：从牌边贴着桌面起飞，顺着风转的方向甩出去、往上扬；big 是飘得高、飞得远的大片
  private whirl(floor: THREE.Vector3, inward: THREE.Vector3, u: number, grand: number, big: boolean): void {
    const a = rand(0, Math.PI * 2);
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const tan = new THREE.Vector3(-out.z * this.dir, 0, out.x * this.dir);
    const pos = floor.clone().addScaledVector(out, rand(0.4, 1.4) * u).setY(rand(0.15, 0.6) * u);
    const vel = tan.multiplyScalar(rand(3, 6.5) * u).addScaledVector(out, rand(1.5, 4) * u);
    vel.y = rand(2.2, 4.6) * u;
    if (big) {
      vel.addScaledVector(inward, rand(4, 7 + 4 * grand) * u);
      vel.y += rand(1.5, 3) * u;
    }
    this.spawn(pos, vel, (big ? rand(0.75, 1.05) : rand(0.4, 0.66)) * u, rand(0.5, 1.2), big ? rand(2, 2.8) : rand(1.3, 2.2));
  }

  // 一片花瓣轻轻往上飘（摸岭上牌那一下、牌飞的一路上）
  private puff(at: THREE.Vector3, u: number): void {
    const a = rand(0, Math.PI * 2);
    const vel = new THREE.Vector3(Math.cos(a) * rand(0.5, 1.8), rand(1.5, 3.2), Math.sin(a) * rand(0.5, 1.8)).multiplyScalar(u);
    this.spawn(at.clone().add(new THREE.Vector3(rand(-0.2, 0.2), rand(0, 0.3), rand(-0.2, 0.2)).multiplyScalar(u)), vel, rand(0.36, 0.55) * u, 0.2, rand(1.1, 1.7));
  }

  update(dt: number): void {
    this.now += dt;
    if (this.queue.length) {
      const due = this.queue.filter((q) => q.at <= this.now);
      this.queue = this.queue.filter((q) => q.at > this.now);
      for (const q of due) q.fn();
    }
    if (this.trails.length) {
      this.trails = this.trails.filter((t) => this.now < t.until);
      for (const t of this.trails) {
        const at = t.get();
        if (!at) continue;
        while (t.next <= this.now) {
          t.next += 0.016;
          const v = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1.4), rand(-1, 1)).multiplyScalar(t.scale);
          this.star(at.clone().add(new THREE.Vector3(rand(-0.35, 0.35), rand(-0.2, 0.3), rand(-0.35, 0.35)).multiplyScalar(t.scale)), v, this.now, rand(0.45, 0.95), rand(0.18, 0.36) * t.scale, rand(0.2, 1));
        }
        if (t.petal <= this.now) {
          t.petal = this.now + 0.14;
          this.puff(at, t.scale * 0.85);
        }
      }
    }

    this.vortices = this.vortices.filter((v) => {
      const k = this.now - v.born;
      if (k >= v.dur) {
        this.dropVortex(v);
        return false;
      }
      v.mat.uniforms.uT.value = k;
      return true;
    });

    this.glows = this.glows.filter((g) => {
      const k = (this.now - g.born) / g.dur;
      if (k >= 1) {
        this.dropGlow(g);
        return false;
      }
      const m = g.sprite.material;
      if (g.kind === 'mint') {
        // 很快亮起来，轻轻喘着气，后一半慢慢暗掉
        const t = this.now - g.born;
        m.opacity = g.peak * Math.min(1, t / 0.14) * (1 - Math.max(0, (k - 0.45) / 0.55) ** 1.5) * (0.88 + 0.12 * Math.sin(t * 7));
        g.sprite.scale.setScalar(g.size * (0.8 + 0.2 * Math.min(1, t / 0.3) + 0.04 * Math.sin(t * 5)));
      } else {
        const grow = 1 - (1 - Math.min(1, k / 0.35)) ** 3;
        m.opacity = g.peak * Math.min(1, k / 0.12) * (1 - Math.max(0, (k - 0.3) / 0.7)) ** 1.6;
        g.sprite.scale.setScalar(g.size * (g.kind === 'rays' ? 0.25 + 0.75 * grow : 0.45 + 0.55 * grow));
      }
      return true;
    });

    if (this.starMat) this.starMat.uniforms.uNow.value = this.now;
    if (this.starDirty && this.stars) {
      this.starDirty = false;
      const g = this.stars.geometry;
      for (const name of ['position', 'aVel', 'aTime', 'aMisc']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }

    if (!this.mesh) return;
    const live: Petal[] = [];
    const tmpQ = new THREE.Quaternion();
    let n = 0;
    for (const p of this.petals) {
      const age = this.now - p.born;
      if (age > p.life) continue;
      live.push(p);
      // 花瓣很轻：重力小、空气阻力大，被风带着绕圈、左右晃、自己翻着转
      p.vel.y -= 1.5 * dt;
      p.vel.multiplyScalar(Math.exp(-1.7 * dt));
      const rx = p.pos.x - this.center.x;
      const rz = p.pos.z - this.center.z;
      const sw = (p.swirl * this.dir * Math.exp(-age * 1.2)) / (Math.hypot(rx, rz) + 0.8);
      p.vel.x += -rz * sw * dt * 7;
      p.vel.z += rx * sw * dt * 7;
      const sway = Math.sin(age * 3.4 + p.phase) * p.sway;
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x += Math.cos(p.phase) * sway * dt;
      p.pos.z += Math.sin(p.phase) * sway * dt;
      if (p.pos.y < 0.08) {
        p.pos.y = 0.08;
        p.vel.y = Math.abs(p.vel.y) * 0.3;
      }
      tmpQ.setFromAxisAngle(p.axis, p.spin * dt);
      p.quat.premultiply(tmpQ);
      // 冒出来的时候长大，最后四成的时间慢慢缩没
      const fade = Math.min(1, (p.life - age) / (p.life * 0.4));
      const grow = Math.min(1, age / 0.14);
      this.dummy.position.copy(p.pos);
      this.dummy.quaternion.copy(p.quat);
      this.dummy.scale.setScalar(Math.max(0.001, p.size * fade ** 0.7 * grow));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      this.mesh.setColorAt(n, p.tint);
      n++;
    }
    this.petals = live;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
