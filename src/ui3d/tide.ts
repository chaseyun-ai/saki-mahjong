import * as THREE from 'three';
import type { Changeover, WallRect } from './changeover';
import { TILE_H, TILE_T } from './tableLayout';

// 沙滩（牌桌风格「沙滩」）的换局：牌是沙子捏的。一局打完，一个浪从对面涌过来，浪头扫过的牌塌成沙、被水冲散；
// 水漫过整张桌子，停一下，再退回去。退潮退过哪里，哪里的沙子就聚拢起来，新的牌山从沙里拱出来；最后一墩聚好才掷骰子发牌。
// 退过的地方是湿的深色沙，过一会儿才干。
//
// 这里只管水、冲散的沙粒、聚拢的沙粒、被冲倒的替身牌，还有什么时候该响哪一声；
// 新牌山的牌什么时候拱出来、拱到多高（wallPose）由 table3d.ts 照着摆，跟自动麻将机的升降板一样（changeover.ts）

// 该响的声音：surge 浪涌过来（dur 秒），crash 浪头砸在牌上，ebb 退潮（dur 秒），gather 沙子聚拢（dur 秒），settle 最后一墩聚好
export type TideCue = 'surge' | 'crash' | 'ebb' | 'gather' | 'settle';


// 时间（秒）：浪涌过来、漫着停一下、退回去
const T_IN = 0.85;
const HOLD = 0.14;
const T_OUT = 0.9;
// 一墩牌从沙里拱上来要多久；退潮退过以后隔多久开始拱；每墩随机再晚一点（最多）
const FORM = 0.3;
const FORM_AFTER = 0.05;
const FORM_JITTER = 0.08;
// 聚拢的沙粒提前多久开始往这一墩流
const GATHER_LEAD = 0.26;
// 最后一墩聚好以后停多久再掷骰子
const SETTLE = 0.15;
// 拱上来之前整墩藏在桌面下面多深（两层牌都藏住）
const SUNK = TILE_T * 2 + 0.12;
// 浪头扫过一张牌，这张牌塌掉要多久
const COLLAPSE = 0.3;
// 水面：水层多厚、浪头鼓起来多高
const LEVEL = 0.2;
const CREST = 0.36;

const MAX_GRAINS = 6000;

type Ease = (k: number) => number;
const easeOut: Ease = (k) => 1 - (1 - k) ** 2.2;
const easeIn: Ease = (k) => k ** 1.8;
const smooth: Ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k: number) => Math.min(1, Math.max(0, k));

// 浪头不是一条直线：沿着浪头方向（u）起伏，还慢慢地变。着色器里是同一个式子
function wobble(u: number, t: number): number {
  return 0.42 * Math.sin(u * 0.45 + t * 1.3) + 0.22 * Math.sin(u * 1.13 - t * 1.9 + 1.7) + 0.09 * Math.sin(u * 2.9 + t * 3.1);
}
const WOBBLE_GLSL = /* glsl */ `
float wobble(float u, float t) {
  return 0.42 * sin(u * 0.45 + t * 1.3) + 0.22 * sin(u * 1.13 - t * 1.9 + 1.7) + 0.09 * sin(u * 2.9 + t * 3.1);
}
`;

const SURF_VERT = /* glsl */ `
uniform float uFront;
uniform float uTime;
uniform float uLevel;
uniform float uCrest;
uniform vec2 uDir;
varying float vD;
varying float vS;
varying float vU;
varying vec2 vXZ;
${WOBBLE_GLSL}
void main() {
  vec3 p = position;
  vec2 xz = p.xz;
  float s = dot(xz, uDir);
  float u = dot(xz, vec2(-uDir.y, uDir.x));
  float d = uFront + wobble(u, uTime) - s;
  float h = 0.006;
  if (d > 0.0) {
    // 最前沿薄薄一层，往后是鼓起来的浪头，再往后是平的一层水；水面上细细的起伏
    float lip = smoothstep(0.0, 0.4, d);
    float crest = uCrest * exp(-pow((d - 0.6) / 0.55, 2.0));
    float ripple = 0.02 * sin(s * 1.7 - uTime * 4.0 + u * 0.6) + 0.015 * sin(u * 2.3 + uTime * 2.7);
    h = 0.02 + lip * (uLevel + crest + ripple);
  }
  p.y = h;
  vD = d;
  vS = s;
  vU = u;
  vXZ = xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const SURF_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAmount;
uniform float uWet;
uniform float uWetLine;
uniform float uWetT;
uniform float uLace;
uniform float uConsole;
uniform float uDisc;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uWetCol;
varying float vD;
varying float vS;
varying float vU;
varying vec2 vXZ;
${WOBBLE_GLSL}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.1 + 3.1) + 0.15 * noise(p * 4.3 + 7.7); }
void main() {
  // 仪表盘那一块是露在水面上的“礁石”：水不画进去，四周一圈白沫
  float cd = uDisc > 0.5 ? length(vXZ) - uConsole : max(abs(vXZ.x), abs(vXZ.y)) - uConsole;
  if (cd < 0.0) discard;
  if (vD <= 0.0) {
    // 水退过的地方：湿的深色沙，慢慢干；刚退过的那一线留一道碎碎的白沫
    float wet = uWet * step(vS, uWetLine + wobble(vU, uWetT));
    float lace = uLace * smoothstep(0.55, 0.0, -vD) * smoothstep(0.45, 0.7, fbm(vec2(vU * 1.8, vS * 2.5) + uTime * 0.7));
    float a = max(wet * 0.3, lace * 0.85);
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(uWetCol, uFoam, clamp(lace * 1.5, 0.0, 1.0)), a * uAmount);
    return;
  }
  float n = fbm(vec2(vU * 1.4, vS * 2.2 - uTime * 1.2));
  // 靠浪头的水浅（透得出底下的沙），往后越来越深
  vec3 col = mix(uShallow, uDeep, smoothstep(0.3, 6.0, vD));
  float alpha = mix(0.42, 0.78, smoothstep(0.0, 5.0, vD));
  // 白沫：浪头那一道（碎的）、后面顺着浪头方向拉长的几缕、仪表盘四周一圈
  float edge = smoothstep(1.2, 0.0, vD) * (0.5 + 0.7 * n);
  float streak = smoothstep(0.66, 0.82, fbm(vec2(vU * 0.32, vS * 1.5 - uTime * 0.8))) * 0.4 * smoothstep(0.6, 2.5, vD);
  float ring = smoothstep(0.5, 0.0, cd) * (0.45 + 0.55 * n);
  float foam = clamp(edge + streak + ring, 0.0, 1.0);
  col = mix(col, uFoam, foam);
  alpha = mix(alpha, 0.94, foam);
  gl_FragColor = vec4(col, alpha * uAmount);
}
`;

const GRAIN_VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / -mv.z;
  vAlpha = aAlpha;
  vColor = aColor;
}
`;
const GRAIN_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q);
  if (r > 0.5 || vAlpha < 0.01) discard;
  gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.3, r));
}
`;

// 一粒沙：冲散的（splash，有速度、会落地）还是往一墩牌聚拢的（gather，从 from 沿弧线走到 to）
interface Grain {
  kind: 'splash' | 'gather';
  p: THREE.Vector3;
  v: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t0: number;
  t1: number;
  color: THREE.Color;
  size: number;
}

// 被浪冲倒的替身牌：浪头到了先往前一歪，塌下去、陷进沙里
interface Fall {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  fromScale: number;
  tip: THREE.Quaternion;
  at: number;
  spilled: boolean;
}

export class Tide implements Changeover<TideCue> {
  readonly group = new THREE.Group();
  // 拱上来的牌不歪
  readonly tiltAxis = new THREE.Vector3(1, 0, 0);
  private now = 0;
  private half = 14;
  private console = 2.9;
  // 这一浪：从哪个方向来（沿 dir 往前推）、什么时候开始，浪头在 s 上从 s0 推到 s1 再退回 s0
  private dir = new THREE.Vector2(0, 1);
  private t0 = -Infinity;
  private s0 = -16;
  private s1 = 16;
  private end = -Infinity;
  private falls: Fall[] = [];
  private rects: WallRect[] = [];
  private grains: Grain[] = [];
  private cues: { at: number; cue: TideCue; dur: number }[] = [];
  // 新牌山：聚拢、拱上来的时间照它在 s 上的位置算；formed 之前 wallY 管它在哪
  private forming = false;
  private formEnd = -Infinity;
  private surf: THREE.Mesh;
  private surfU: Record<string, THREE.IUniform>;
  private points: THREE.Points;
  private pos = new Float32Array(MAX_GRAINS * 3);
  private alpha = new Float32Array(MAX_GRAINS);
  private size = new Float32Array(MAX_GRAINS);
  private color = new Float32Array(MAX_GRAINS * 3);
  private sand: THREE.Color[];

  // sand：沙子的几种颜色（牌身的浅沙、牌背的深沙）
  constructor(sand: string[]) {
    // 沙粒的颜色也直接按屏幕上的颜色给
    this.sand = sand.map((c) => new THREE.Color(c).convertLinearToSRGB());
    this.surfU = {
      uFront: { value: -100 },
      uTime: { value: 0 },
      uLevel: { value: LEVEL },
      uCrest: { value: CREST },
      uDir: { value: this.dir },
      uAmount: { value: 0 },
      uWet: { value: 0 },
      uWetLine: { value: -100 },
      uWetT: { value: 0 },
      uLace: { value: 0 },
      uConsole: { value: this.console },
      uDisc: { value: 0 },
      uShallow: { value: new THREE.Color('#74d2c8') },
      uDeep: { value: new THREE.Color('#1c8f97') },
      uFoam: { value: new THREE.Color('#f3fbfa') },
      uWetCol: { value: new THREE.Color('#6a5134') },
    };
    // 颜色直接按屏幕上的颜色给（不过色调映射，不换色彩空间）
    for (const k of ['uShallow', 'uDeep', 'uFoam', 'uWetCol']) (this.surfU[k].value as THREE.Color).convertLinearToSRGB();
    this.surf = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({ vertexShader: SURF_VERT, fragmentShader: SURF_FRAG, uniforms: this.surfU, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.surf.renderOrder = 1;
    this.surf.frustumCulled = false;
    this.surf.visible = false;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({ vertexShader: GRAIN_VERT, fragmentShader: GRAIN_FRAG, uniforms: { uScale: { value: 600 } }, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.group.add(this.surf, this.points);
  }

  // 桌子尺寸变了重建水面：half 桌布半宽，consoleHalf 仪表盘半宽，disc 仪表盘是不是圆的
  build(half: number, consoleHalf: number, disc: boolean): void {
    this.half = half;
    this.console = consoleHalf;
    this.surf.geometry.dispose();
    this.surf.geometry = new THREE.PlaneGeometry(half * 2, half * 2, 128, 128).rotateX(-Math.PI / 2);
    this.surfU.uConsole.value = consoleHalf;
    this.surfU.uDisc.value = disc ? 1 : 0;
  }

  // 镜头的像素比例（沙粒近大远小用）：画布高度 / (2 tan(fov/2))
  setScale(px: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = px;
  }

  // ---------- 浪头在哪 ----------

  private frontIn(t: number): number {
    return this.s0 + (this.s1 - this.s0) * easeOut(clamp01((t - this.t0) / T_IN));
  }

  private get outStart(): number {
    return this.t0 + T_IN + HOLD;
  }

  // 浪头（不算起伏）在 t 时刻的位置
  private front(t: number): number {
    if (t < this.outStart) return this.frontIn(t);
    return this.s1 - (this.s1 - this.s0) * easeIn(clamp01((t - this.outStart) / T_OUT));
  }

  private s(x: number, z: number): number {
    return x * this.dir.x + z * this.dir.y;
  }

  private u(x: number, z: number): number {
    return -x * this.dir.y + z * this.dir.x;
  }

  // 涌过来的浪头什么时候到 (x, z)
  private hitTime(x: number, z: number): number {
    const s = this.s(x, z);
    const u = this.u(x, z);
    let t = this.t0;
    // 浪头位置随时间单调往前：二分
    let lo = this.t0;
    let hi = this.t0 + T_IN;
    for (let i = 0; i < 18; i++) {
      t = (lo + hi) / 2;
      if (this.frontIn(t) + wobble(u, t) >= s) hi = t;
      else lo = t;
    }
    return hi;
  }

  // 退潮什么时候退过 (x, z)（这里露出来）
  private uncoverTime(x: number, z: number): number {
    const s = this.s(x, z);
    const u = this.u(x, z);
    let lo = this.outStart;
    let hi = this.outStart + T_OUT;
    for (let i = 0; i < 18; i++) {
      const t = (lo + hi) / 2;
      if (this.front(t) + wobble(u, t) <= s) hi = t;
      else lo = t;
    }
    return hi;
  }

  // ---------- 换局 ----------

  // 收牌：一个浪涌过来，把这些替身牌冲倒、冲散。正在涌的话接着用这一浪
  sweep(objs: THREE.Object3D[], now: number): void {
    this.now = now;
    if (now > this.end) this.wave(now);
    for (const obj of objs) {
      const at = this.hitTime(obj.position.x, obj.position.z) - 0.02;
      // 往浪推的方向倒：绕着跟浪头平行的水平轴转
      const axis = new THREE.Vector3(this.dir.y, 0, -this.dir.x);
      const tip = new THREE.Quaternion().setFromAxisAngle(axis, 0.5 + Math.random() * 0.5).multiply(obj.quaternion);
      this.falls.push({ obj, from: obj.position.clone(), fromQuat: obj.quaternion.clone(), fromScale: obj.scale.x, tip, at, spilled: false });
      this.group.add(obj);
    }
  }

  // 起一个浪：方向每次稍微斜一点
  private wave(now: number): void {
    const a = (Math.random() - 0.5) * 0.36;
    this.dir.set(Math.sin(a), Math.cos(a));
    const reach = this.half * (Math.abs(this.dir.x) + Math.abs(this.dir.y));
    this.s0 = -reach - 1.3;
    this.s1 = reach + 0.9;
    this.t0 = now;
    this.end = this.outStart + T_OUT;
    this.cue(now, 'surge', T_IN);
    this.cue(now + T_IN * 0.3, 'crash', 0.5);
    this.cue(this.outStart, 'ebb', T_OUT);
  }

  // 新牌山：退潮退过哪里，哪里的沙子聚拢、整墩从沙里拱上来。rects 是四家牌山脚下那块地方。
  // 返回从 now 起多久以后可以掷骰子
  rise(now: number, rects: WallRect[]): number {
    this.now = now;
    this.rects = rects;
    // 浪已经退完了（发牌前选技能那一段收过牌）：再起一个浪
    if (now > this.end - T_OUT * 0.5) this.wave(now);
    this.forming = true;
    let first = Infinity;
    let last = -Infinity;
    for (const r of rects) {
      // 沙粒：撒在这一墩外面一圈，往牌山脚下流
      const n = Math.round(((r.hx * r.hz) / (TILE_H * 0.5)) * 9);
      for (let i = 0; i < n && this.grains.length < MAX_GRAINS; i++) {
        const to = new THREE.Vector3(r.x + (Math.random() * 2 - 1) * r.hx, 0.03 + Math.random() * 0.25, r.z + (Math.random() * 2 - 1) * r.hz);
        const at = this.formTime(to.x, to.z);
        const ang = Math.random() * Math.PI * 2;
        const rad = 0.5 + Math.random() * 1.1;
        const from = new THREE.Vector3(to.x + Math.cos(ang) * rad, 0.015, to.z + Math.sin(ang) * rad);
        this.grains.push({ kind: 'gather', p: from.clone(), v: new THREE.Vector3(), from, to, t0: at - GATHER_LEAD, t1: at + 0.05, color: this.sandColor(0.7), size: 0.05 + Math.random() * 0.04 });
      }
      // 整片牌山最早、最晚哪一墩
      for (const [x, z] of [[r.x - r.hx, r.z - r.hz], [r.x + r.hx, r.z - r.hz], [r.x - r.hx, r.z + r.hz], [r.x + r.hx, r.z + r.hz]]) {
        const t = this.uncoverTime(x, z);
        first = Math.min(first, t);
        last = Math.max(last, t);
      }
    }
    const start = first + FORM_AFTER;
    this.formEnd = last + FORM_AFTER + FORM_JITTER + FORM;
    this.cue(start - GATHER_LEAD * 0.5, 'gather', this.formEnd - start + GATHER_LEAD * 0.5);
    this.cue(this.formEnd, 'settle', 0.2);
    return this.formEnd + SETTLE - now;
  }

  // 这一墩什么时候开始拱（照退潮退过的时刻，每墩随机晚一点，同一墩上下两张一样）
  private formTime(x: number, z: number): number {
    const j = fract(Math.sin(Math.round(x * 4) * 12.9898 + Math.round(z * 4) * 78.233) * 43758.5453) * FORM_JITTER;
    return this.uncoverTime(x, z) + FORM_AFTER + j;
  }

  // 世界坐标 (x, z) 在不在牌山脚下（发牌前要发到手里的牌这时也还码在牌山上，一起算）
  onWall(x: number, z: number): boolean {
    return this.rects.some((r) => Math.abs(x - r.x) <= r.hx + 0.05 && Math.abs(z - r.z) <= r.hz + 0.05);
  }

  // 牌山上 (x, z) 那一墩现在比摆好的位置低多少：out.y（还没拱出来返回 false：先藏着）
  wallPose(x: number, z: number, out: THREE.Vector4): boolean {
    out.set(0, 0, 0, 0);
    if (!this.forming) return true;
    const at = this.formTime(x, z);
    if (this.now < at) return false;
    const k = clamp01((this.now - at) / FORM);
    out.y = -SUNK * (1 - easeOut(k));
    return true;
  }

  get busy(): boolean {
    return this.now < Math.max(this.end, this.forming ? this.formEnd + SETTLE : -Infinity) || this.falls.length > 0 || this.grains.length > 0 || this.cues.length > 0;
  }

  // 推进到 now，返回这一帧该响的声音
  update(now: number): { cue: TideCue; dur: number }[] {
    const dt = Math.min(0.05, Math.max(0, now - this.now));
    this.now = now;
    this.apply(dt);
    const due = this.cues.filter((c) => now >= c.at);
    this.cues = this.cues.filter((c) => now < c.at);
    return due.map(({ cue, dur }) => ({ cue, dur }));
  }

  // 直接到最后的样子（快进、调试场景）：水退干净、替身牌和沙粒都收掉，新牌山都在上面
  finish(): void {
    for (const f of this.falls) this.group.remove(f.obj);
    this.falls = [];
    this.grains = [];
    this.cues = [];
    this.forming = false;
    this.end = -Infinity;
    this.formEnd = -Infinity;
    this.surf.visible = false;
    this.points.geometry.setDrawRange(0, 0);
  }

  private cue(at: number, cue: TideCue, dur: number): void {
    this.cues.push({ at, cue, dur });
  }

  private sandColor(dark: number): THREE.Color {
    const [a, b] = [this.sand[0], this.sand[this.sand.length - 1]];
    return a.clone().lerp(b, Math.random() < dark ? 0.55 + Math.random() * 0.45 : Math.random() * 0.4).multiplyScalar(0.94 + Math.random() * 0.1);
  }

  private apply(dt: number): void {
    const now = this.now;
    const t = now - this.t0;
    const live = now < this.end + 1.6;
    // 水面
    this.surf.visible = live && t >= 0;
    if (this.surf.visible) {
      const u = this.surfU;
      const out = now >= this.outStart;
      u.uFront.value = this.front(now);
      u.uTime.value = now;
      // 涌过来时浪头鼓着，到顶慢慢平，退的时候只剩薄薄一层
      const kin = clamp01(t / T_IN);
      u.uCrest.value = out ? 0 : CREST * (1 - kin * kin);
      u.uLevel.value = out ? LEVEL * (1 - 0.6 * clamp01((now - this.outStart) / T_OUT)) : LEVEL;
      u.uAmount.value = clamp01(t / 0.12);
      // 湿沙：退潮开始以后才有，退完再过一会儿干掉；沫子只在退的时候留一道
      u.uWetLine.value = this.s1;
      u.uWetT.value = this.outStart;
      u.uWet.value = out ? 1 - clamp01((now - this.end) / 1.6) : 0;
      u.uLace.value = out ? 1 - clamp01((now - this.end + 0.2) / 0.4) : 0;
    }
    // 被冲倒的替身牌
    for (const f of [...this.falls]) {
      const k = (now - f.at) / COLLAPSE;
      if (k <= 0) continue;
      if (!f.spilled) {
        f.spilled = true;
        this.spill(f.obj);
      }
      if (k >= 1) {
        this.group.remove(f.obj);
        this.falls.splice(this.falls.indexOf(f), 1);
        continue;
      }
      const e = smooth(k);
      const o = f.obj;
      o.quaternion.copy(f.fromQuat).slerp(f.tip, e);
      o.position.set(f.from.x + this.dir.x * 0.7 * e, f.from.y - (f.from.y + TILE_H * 0.6) * k * k, f.from.z + this.dir.y * 0.7 * e);
      o.scale.setScalar(f.fromScale * (1 - 0.25 * e));
    }
    // 沙粒
    let n = 0;
    const flow = this.flowAt(now);
    for (const g of [...this.grains]) {
      if (now >= g.t1) {
        this.grains.splice(this.grains.indexOf(g), 1);
        continue;
      }
      let a = 0;
      if (g.kind === 'splash') {
        if (now < g.t0) continue;
        // 被水裹着往前冲，落到沙上就慢慢停住；退潮时跟着往回带一点
        g.v.y -= 9 * dt;
        g.v.x += (flow.x * 2.2 - g.v.x) * Math.min(1, dt * 3);
        g.v.z += (flow.y * 2.2 - g.v.z) * Math.min(1, dt * 3);
        g.p.addScaledVector(g.v, dt);
        if (g.p.y < 0.015) {
          g.p.y = 0.015;
          g.v.multiplyScalar(0.5);
          g.v.y = 0;
        }
        const life = (now - g.t0) / (g.t1 - g.t0);
        a = clamp01(life / 0.05) * (1 - smooth(clamp01((life - 0.55) / 0.45)));
      } else {
        if (now < g.t0) continue;
        // 沿着贴地的弧线往牌山脚下流，越走越快，到了就钻进去
        const k = clamp01((now - g.t0) / (g.t1 - g.t0 - 0.05));
        const e = k * k;
        g.p.lerpVectors(g.from, g.to, e);
        g.p.y = g.from.y + (g.to.y - g.from.y) * e + Math.sin(k * Math.PI) * 0.12;
        a = clamp01((now - g.t0) / 0.08) * (1 - clamp01((k - 0.9) / 0.1));
      }
      if (n >= MAX_GRAINS) continue;
      this.pos[n * 3] = g.p.x;
      this.pos[n * 3 + 1] = g.p.y;
      this.pos[n * 3 + 2] = g.p.z;
      this.alpha[n] = a;
      this.size[n] = g.size;
      this.color[n * 3] = g.color.r;
      this.color[n * 3 + 1] = g.color.g;
      this.color[n * 3 + 2] = g.color.b;
      n++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    for (const name of ['position', 'aAlpha', 'aSize', 'aColor']) (geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    if (this.forming && now > this.formEnd + SETTLE) this.forming = false;
  }

  // 水流的方向和快慢（世界 xz，单位每秒）：涌的时候往前，退的时候往回
  private flowAt(t: number): THREE.Vector2 {
    const dt = 0.02;
    const v = (this.front(t + dt) - this.front(t - dt)) / (2 * dt);
    return this.dir.clone().multiplyScalar(THREE.MathUtils.clamp(v, -30, 30) * 0.18);
  }

  // 一张牌塌成沙：从牌的身上撒出一把沙粒，被浪往前带
  private spill(obj: THREE.Object3D): void {
    const now = this.now;
    for (let i = 0; i < 22 && this.grains.length < MAX_GRAINS; i++) {
      const p = obj.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.3) * 0.6, (Math.random() - 0.5) * 0.9));
      p.y = Math.max(0.02, p.y);
      const v = new THREE.Vector3(this.dir.x * (1.2 + Math.random() * 2), 0.6 + Math.random() * 1.6, this.dir.y * (1.2 + Math.random() * 2));
      v.x += (Math.random() - 0.5) * 1.4;
      v.z += (Math.random() - 0.5) * 1.4;
      const life = 1.1 + Math.random() * 0.9;
      this.grains.push({ kind: 'splash', p, v, from: p.clone(), to: p.clone(), t0: now, t1: Math.min(now + life, this.end + 0.3), color: this.sandColor(0.5), size: 0.05 + Math.random() * 0.05 });
    }
  }

  dispose(): void {
    this.finish();
    this.surf.geometry.dispose();
    (this.surf.material as THREE.Material).dispose();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}
