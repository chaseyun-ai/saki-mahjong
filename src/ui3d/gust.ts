import * as THREE from 'three';
import type { Changeover, WallRect } from './changeover';
import { TILE_H } from './tableLayout';

// 草甸（牌桌风格「草甸」）的换局：一局打完，一阵风从桌子一边刮过来，风头扫过的牌被掀起来、翻着跟头往下风飞，
// 飞着飞着散成一把花瓣和草叶，被风带走；草面上跟着风头一道亮光（风压倒的草），空中几道风痕。
// 风过去以后，花瓣被一阵轻风送回来，落在牌山的位置上，新牌山一墩墩从半空像落叶一样晃着落下来（上风那头先落），都落好才掷骰子发牌。
//
// 这里只管风痕、草面上的亮光、花瓣、被吹走的替身牌，还有什么时候该响哪一声；
// 新牌山的牌落到哪、晃多少（wallPose）由 table3d.ts 照着摆，跟沙滩的 tide.ts 一样（changeover.ts）

// 该响的声音：gust 风刮过来（dur 秒），scatter 牌被吹散（花瓣、草叶哗的一下），breeze 轻风把花瓣送回来（dur 秒），land 最后一墩落好
export type GustCue = 'gust' | 'scatter' | 'breeze' | 'land';

// 风头扫过整张桌子要多久；风过去以后隔多久开始落新牌山；一墩从半空落下来要多久；每墩随机再晚一点（最多）
const T_GUST = 0.8;
const CALM = 0.2;
const FALL = 0.5;
const FALL_JITTER = 0.1;
// 落新牌山时，上风那头到下风那头前后差多久
const SPREAD = 0.75;
// 从多高落下来；落的时候左右晃多大、歪多少
const DROP = 2.2;
const SWAY = 0.32;
const TILT = 0.32;
// 被吹走的牌飞多久（散完）
const FLY = 0.85;
// 最后一墩落好以后停多久再掷骰子
const SETTLE = 0.15;

const MAX_PETALS = 1600;
const MAX_STREAKS = 16;
const STREAK_PTS = 12;

const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
const smooth = (k: number) => k * k * (3 - 2 * k);
const easeOut = (k: number) => 1 - (1 - k) ** 3;

const PETAL_VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
attribute float aSpin;
attribute float aFlip;
attribute vec3 aColor;
varying float vAlpha;
varying float vSpin;
varying float vFlip;
varying vec3 vColor;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / -mv.z;
  vAlpha = aAlpha;
  vSpin = aSpin;
  vFlip = aFlip;
  vColor = aColor;
}
`;
// 一片花瓣：转着的椭圆，翻过来时变窄（flip 是翻到哪了，0..1 是宽窄）
const PETAL_FRAG = /* glsl */ `
varying float vAlpha;
varying float vSpin;
varying float vFlip;
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float c = cos(vSpin), s = sin(vSpin);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  float w = 0.16 + 0.3 * vFlip;
  float r = (q.x * q.x) / (0.25) + (q.y * q.y) / (w * w);
  if (r > 1.0 || vAlpha < 0.01) discard;
  gl_FragColor = vec4(vColor * (0.82 + 0.18 * vFlip), vAlpha * smoothstep(1.0, 0.7, r));
}
`;

const SHEEN_VERT = /* glsl */ `
uniform vec2 uDir;
varying float vS;
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  vS = dot(position.xz, uDir);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
// 风压倒的草：风头前后一道亮光（草叶翻过来露出浅色的背面），后面拖一截淡的
const SHEEN_FRAG = /* glsl */ `
uniform float uFront;
uniform float uAmount;
uniform float uTime;
uniform vec2 uDir;
uniform vec3 uColor;
varying float vS;
varying vec2 vXZ;
void main() {
  float u = dot(vXZ, vec2(-uDir.y, uDir.x));
  float f = uFront + 0.5 * sin(u * 0.5 + uTime * 2.0) + 0.25 * sin(u * 1.3 - uTime * 3.0);
  float d = f - vS;
  float band = exp(-pow(d / 0.9, 2.0)) + 0.35 * smoothstep(0.0, 1.0, d) * exp(-d / 4.0);
  float a = band * uAmount * (0.75 + 0.25 * sin(u * 3.1 + vS * 0.7));
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a * 0.2);
}
`;

interface Petal {
  p: THREE.Vector3;
  v: THREE.Vector3;
  t0: number;
  t1: number;
  color: THREE.Color;
  size: number;
  spin: number;
  spinV: number;
  flip: number;
  flipV: number;
  // 送回来的花瓣：从 from 飘到 to（牌山上），到了就没了
  to: THREE.Vector3 | null;
  from: THREE.Vector3 | null;
}

interface Flyer {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  fromScale: number;
  axis: THREE.Vector3;
  spin: number;
  speed: number;
  lift: number;
  side: number;
  at: number;
  burst: number;
}

interface Streak {
  t0: number;
  life: number;
  y: number;
  u: number;
  len: number;
  curve: number;
  speed: number;
}

export class Gust implements Changeover<GustCue> {
  readonly group = new THREE.Group();
  private now = 0;
  private half = 14;
  private dir = new THREE.Vector2(1, 0);
  private t0 = -Infinity;
  private s0 = -16;
  private s1 = 16;
  private end = -Infinity;
  private flyers: Flyer[] = [];
  private petals: Petal[] = [];
  private streaks: Streak[] = [];
  private cues: { at: number; cue: GustCue; dur: number }[] = [];
  private rects: WallRect[] = [];
  private forming = false;
  private fallAt = 0;
  private formEnd = -Infinity;
  private sheen: THREE.Mesh;
  private sheenU: Record<string, THREE.IUniform>;
  private points: THREE.Points;
  private pos = new Float32Array(MAX_PETALS * 3);
  private alpha = new Float32Array(MAX_PETALS);
  private size = new Float32Array(MAX_PETALS);
  private spin = new Float32Array(MAX_PETALS);
  private flip = new Float32Array(MAX_PETALS);
  private color = new Float32Array(MAX_PETALS * 3);
  private lines: THREE.LineSegments;
  private linePos = new Float32Array(MAX_STREAKS * (STREAK_PTS - 1) * 2 * 3);
  private lineCol = new Float32Array(MAX_STREAKS * (STREAK_PTS - 1) * 2 * 4);
  private colors: THREE.Color[];
  // 落下来的牌歪的方向：绕着跟风向垂直的水平轴
  readonly tiltAxis = new THREE.Vector3(0, 0, 1);

  // petals：花瓣、草叶的几种颜色；sheen：风压倒的草那道亮光的颜色
  constructor(petals: string[], sheen: string) {
    this.colors = petals.map((c) => new THREE.Color(c).convertLinearToSRGB());
    this.sheenU = {
      uFront: { value: -100 },
      uAmount: { value: 0 },
      uTime: { value: 0 },
      uDir: { value: this.dir },
      uColor: { value: new THREE.Color(sheen).convertLinearToSRGB() },
    };
    this.sheen = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({ vertexShader: SHEEN_VERT, fragmentShader: SHEEN_FRAG, uniforms: this.sheenU, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.sheen.renderOrder = 1;
    this.sheen.frustumCulled = false;
    this.sheen.visible = false;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aFlip', new THREE.BufferAttribute(this.flip, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({ vertexShader: PETAL_VERT, fragmentShader: PETAL_FRAG, uniforms: { uScale: { value: 600 } }, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 4).setUsage(THREE.DynamicDrawUsage));
    lg.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 2;
    this.group.add(this.sheen, this.points, this.lines);
  }

  // 桌子尺寸变了重建草面上那道亮光（仪表盘不用管：风从它上面刮过去）
  build(half: number): void {
    this.half = half;
    this.sheen.geometry.dispose();
    this.sheen.geometry = new THREE.PlaneGeometry(half * 2, half * 2, 1, 1).rotateX(-Math.PI / 2).translate(0, 0.008, 0);
  }

  setScale(px: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = px;
  }

  private front(t: number): number {
    return this.s0 + (this.s1 - this.s0) * smooth(clamp01((t - this.t0) / T_GUST));
  }

  private s(x: number, z: number): number {
    return x * this.dir.x + z * this.dir.y;
  }

  // 风头什么时候扫到 (x, z)
  private hitTime(x: number, z: number): number {
    const s = this.s(x, z);
    let lo = this.t0;
    let hi = this.t0 + T_GUST;
    for (let i = 0; i < 16; i++) {
      const t = (lo + hi) / 2;
      if (this.front(t) >= s) hi = t;
      else lo = t;
    }
    return hi;
  }

  // 起一阵风：从画面左边或右边刮过来（随机），再斜一点。scatter：有牌被吹散（响一阵沙沙声）
  private blow(now: number, scatter: boolean): void {
    const a = (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.5;
    this.dir.set(Math.cos(a), Math.sin(a));
    this.tiltAxis.set(-this.dir.y, 0, this.dir.x);
    const reach = this.half * (Math.abs(this.dir.x) + Math.abs(this.dir.y));
    this.s0 = -reach - 1;
    this.s1 = reach + 1;
    this.t0 = now;
    this.end = now + T_GUST;
    this.streaks = [];
    for (let i = 0; i < MAX_STREAKS; i++) {
      this.streaks.push({
        t0: now + (i / MAX_STREAKS) * T_GUST * 0.85 + Math.random() * 0.08,
        life: 0.4 + Math.random() * 0.25,
        y: 0.6 + Math.random() * 2.2,
        u: (Math.random() * 2 - 1) * (this.half - 1),
        len: 2.5 + Math.random() * 2.5,
        curve: (Math.random() - 0.5) * 1.2,
        speed: 20 + Math.random() * 10,
      });
    }
    this.cue(now, 'gust', T_GUST + 0.3);
    if (scatter) this.cue(now + T_GUST * 0.25, 'scatter', 0.6);
  }

  // 收牌：一阵风把这些替身牌吹走（正在刮的话接着用这一阵）
  sweep(objs: THREE.Object3D[], now: number): void {
    this.now = now;
    if (now > this.end) this.blow(now, objs.length > 0);
    for (const obj of objs) {
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.flyers.push({
        obj,
        from: obj.position.clone(),
        fromQuat: obj.quaternion.clone(),
        fromScale: obj.scale.x,
        axis,
        spin: 7 + Math.random() * 8,
        speed: 9 + Math.random() * 6,
        lift: 1.6 + Math.random() * 2.2,
        side: (Math.random() - 0.5) * 2.5,
        at: this.hitTime(obj.position.x, obj.position.z) + Math.random() * 0.05,
        burst: 0,
      });
      this.group.add(obj);
    }
  }

  // 新牌山：风过去以后，花瓣被轻风送回来，一墩墩从半空晃着落到牌山上（上风那头先落）。返回从 now 起多久以后可以掷骰子
  rise(now: number, rects: WallRect[]): number {
    this.now = now;
    // 风已经过去了（发牌前选技能那一段收过牌，或者第一局桌上本来没牌）：再起一阵风，只是没牌可吹
    if (now > this.end + 0.4) this.blow(now, false);
    this.rects = rects;
    this.forming = true;
    this.fallAt = this.end + CALM;
    this.formEnd = this.fallAt + SPREAD + FALL_JITTER + FALL;
    // 花瓣：每一墩上方几片，从上风那边飘过来，落进牌山里
    for (const r of rects) {
      const n = Math.round(((r.hx * r.hz) / (TILE_H * 0.5)) * 3);
      const edge = this.half - 0.6;
      for (let i = 0; i < n && this.petals.length < MAX_PETALS; i++) {
        const to = new THREE.Vector3(r.x + (Math.random() * 2 - 1) * r.hx, 0.4 + Math.random() * 0.6, r.z + (Math.random() * 2 - 1) * r.hz);
        const at = this.landTime(to.x, to.z);
        const back = 1.5 + Math.random() * 2.5;
        // 从上风那边飘过来，起点也在桌面上方（不从桌子外面的黑地方冒出来）
        const fx = THREE.MathUtils.clamp(to.x - this.dir.x * back, -edge, edge);
        const fz = THREE.MathUtils.clamp(to.z - this.dir.y * back, -edge, edge);
        const from = new THREE.Vector3(fx, 1.6 + Math.random() * 2, fz);
        this.petals.push(this.petal(from, new THREE.Vector3(), at - 0.75, at + 0.05, Math.random() < 0.75 ? 0 : 1, to, from.clone()));
      }
    }
    this.cue(this.fallAt - 0.3, 'breeze', this.formEnd - this.fallAt + 0.3);
    this.cue(this.formEnd, 'land', 0.2);
    return this.formEnd + SETTLE - now;
  }

  // 这一墩什么时候开始落：上风那头先落，下风那头最后，每墩随机晚一点（同一墩上下两张一样）
  private landTime(x: number, z: number): number {
    const reach = this.half * (Math.abs(this.dir.x) + Math.abs(this.dir.y));
    const k = clamp01((this.s(x, z) + reach) / (2 * reach));
    const j = fract(Math.sin(Math.round(x * 4) * 12.9898 + Math.round(z * 4) * 78.233) * 43758.5453) * FALL_JITTER;
    return this.fallAt + k * SPREAD + j;
  }

  onWall(x: number, z: number): boolean {
    return this.rects.some((r) => Math.abs(x - r.x) <= r.hx + 0.05 && Math.abs(z - r.z) <= r.hz + 0.05);
  }

  // 牌山上 (x, z) 那一墩现在离摆好的位置差多少：out = (dx, dy, dz, 歪多少弧度)；还没开始落返回 false（先藏着）
  wallPose(x: number, z: number, out: THREE.Vector4): boolean {
    out.set(0, 0, 0, 0);
    if (!this.forming) return true;
    const at = this.landTime(x, z);
    if (this.now < at) return false;
    const k = clamp01((this.now - at) / FALL);
    const e = easeOut(k);
    const left = 1 - e;
    // 像落叶：左右来回晃（越落越小），歪着落、落到底摆正
    const sway = Math.sin(k * Math.PI * 2.2) * SWAY * left;
    out.set(-this.dir.y * sway, DROP * left, this.dir.x * sway, Math.sin(k * Math.PI * 2.2 + 0.6) * TILT * left);
    return true;
  }

  get busy(): boolean {
    return this.now < Math.max(this.end, this.forming ? this.formEnd + SETTLE : -Infinity) || this.flyers.length > 0 || this.petals.length > 0 || this.cues.length > 0;
  }

  update(now: number): { cue: GustCue; dur: number }[] {
    const dt = Math.min(0.05, Math.max(0, now - this.now));
    this.now = now;
    this.apply(dt);
    const due = this.cues.filter((c) => now >= c.at);
    this.cues = this.cues.filter((c) => now < c.at);
    return due.map(({ cue, dur }) => ({ cue, dur }));
  }

  finish(): void {
    for (const f of this.flyers) this.group.remove(f.obj);
    this.flyers = [];
    this.petals = [];
    this.streaks = [];
    this.cues = [];
    this.forming = false;
    this.end = -Infinity;
    this.formEnd = -Infinity;
    this.sheen.visible = false;
    this.points.geometry.setDrawRange(0, 0);
    this.lines.geometry.setDrawRange(0, 0);
  }

  private cue(at: number, cue: GustCue, dur: number): void {
    this.cues.push({ at, cue, dur });
  }

  // kind 0 花瓣（白、粉、黄），1 草叶（绿）
  private petal(p: THREE.Vector3, v: THREE.Vector3, t0: number, t1: number, kind: number, to: THREE.Vector3 | null = null, from: THREE.Vector3 | null = null): Petal {
    const flowers = this.colors.slice(0, -2);
    const leaves = this.colors.slice(-2);
    const pick = kind ? leaves : flowers;
    return {
      p,
      v,
      t0,
      t1,
      color: pick[Math.floor(Math.random() * pick.length)].clone(),
      size: kind ? 0.15 + Math.random() * 0.08 : 0.11 + Math.random() * 0.07,
      spin: Math.random() * Math.PI * 2,
      spinV: (Math.random() - 0.5) * 10,
      flip: Math.random() * Math.PI * 2,
      flipV: 4 + Math.random() * 8,
      to,
      from,
    };
  }

  private apply(dt: number): void {
    const now = this.now;
    // 草面上的亮光
    const on = now >= this.t0 && now < this.end + 0.5;
    this.sheen.visible = on;
    if (on) {
      this.sheenU.uFront.value = this.front(now);
      this.sheenU.uTime.value = now;
      this.sheenU.uAmount.value = clamp01((now - this.t0) / 0.1) * (1 - clamp01((now - this.end) / 0.5));
    }
    // 被吹走的牌：先被掀起来，翻着跟头往下风飞，越飞越快、越飞越小，一路撒花瓣
    const wind = new THREE.Vector3(this.dir.x, 0, this.dir.y);
    const side = new THREE.Vector3(-this.dir.y, 0, this.dir.x);
    for (const f of [...this.flyers]) {
      const tau = now - f.at;
      if (tau <= 0) continue;
      const k = tau / FLY;
      if (k >= 1) {
        this.group.remove(f.obj);
        this.flyers.splice(this.flyers.indexOf(f), 1);
        continue;
      }
      const o = f.obj;
      const along = f.speed * (tau * 0.35 + tau * tau * 0.9);
      o.position.copy(f.from).addScaledVector(wind, along).addScaledVector(side, f.side * tau);
      o.position.y = f.from.y + f.lift * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5);
      o.quaternion.copy(f.fromQuat).premultiply(new THREE.Quaternion().setFromAxisAngle(f.axis, f.spin * tau * (0.4 + k)));
      o.scale.setScalar(f.fromScale * (1 - smooth(clamp01((k - 0.25) / 0.75))));
      // 散成花瓣：两把，后面那把多一点
      while (f.burst < 2 && k > 0.12 + f.burst * 0.3) {
        f.burst++;
        for (let i = 0; i < 1 + f.burst * 2 && this.petals.length < MAX_PETALS; i++) {
          const p = o.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8));
          const v = wind.clone().multiplyScalar(f.speed * (0.45 + Math.random() * 0.4)).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2));
          this.petals.push(this.petal(p, v, now, now + 0.7 + Math.random() * 0.6, Math.random() < 0.7 ? 0 : 1));
        }
      }
    }
    // 花瓣
    let n = 0;
    for (const pt of [...this.petals]) {
      if (now >= pt.t1) {
        this.petals.splice(this.petals.indexOf(pt), 1);
        continue;
      }
      if (now < pt.t0) continue;
      let a: number;
      if (pt.to && pt.from) {
        // 送回来：沿着一条往下弯的弧线飘到牌山上，最后一下钻进去
        const k = clamp01((now - pt.t0) / (pt.t1 - pt.t0 - 0.05));
        const e = smooth(k);
        pt.p.lerpVectors(pt.from, pt.to, e);
        pt.p.addScaledVector(side, Math.sin(k * Math.PI * 2) * 0.25 * (1 - k));
        a = clamp01((now - pt.t0) / 0.12) * (1 - clamp01((k - 0.88) / 0.12));
      } else {
        // 吹散的：被风带着往下风飘，慢慢往下落（花瓣落得慢），贴着草面还被风推着走；飘出桌子就淡掉（不在桌外的黑地方乱闪）
        pt.v.x += (this.dir.x * 8 - pt.v.x) * Math.min(1, dt * 1.5);
        pt.v.z += (this.dir.y * 8 - pt.v.z) * Math.min(1, dt * 1.5);
        pt.v.y += (-0.45 - pt.v.y) * Math.min(1, dt * 2.5);
        pt.p.addScaledVector(pt.v, dt);
        if (pt.p.y < 0.02) {
          pt.p.y = 0.02;
          pt.v.y = 0;
        }
        const life = (now - pt.t0) / (pt.t1 - pt.t0);
        const out = Math.max(Math.abs(pt.p.x), Math.abs(pt.p.z)) - (this.half - 0.4);
        a = clamp01(life / 0.05) * (1 - smooth(clamp01((life - 0.55) / 0.45))) * (1 - smooth(clamp01(out / 1.2)));
      }
      pt.spin += pt.spinV * dt;
      pt.flip += pt.flipV * dt;
      if (n >= MAX_PETALS) continue;
      this.pos[n * 3] = pt.p.x;
      this.pos[n * 3 + 1] = pt.p.y;
      this.pos[n * 3 + 2] = pt.p.z;
      this.alpha[n] = a;
      this.size[n] = pt.size;
      this.spin[n] = pt.spin;
      this.flip[n] = Math.abs(Math.cos(pt.flip));
      this.color[n * 3] = pt.color.r;
      this.color[n * 3 + 1] = pt.color.g;
      this.color[n * 3 + 2] = pt.color.b;
      n++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    for (const name of ['position', 'aAlpha', 'aSize', 'aSpin', 'aFlip', 'aColor']) (geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    // 风痕：几道弯弯的白线，从上风往下风一闪而过（头亮尾淡）
    let m = 0;
    for (const st of this.streaks) {
      const k = (now - st.t0) / st.life;
      if (k <= 0 || k >= 1) continue;
      // 从风头那里起步，比风头跑得快
      const head = this.front(st.t0) - 1.5 + st.speed * (now - st.t0);
      const fade = Math.sin(k * Math.PI);
      for (let i = 0; i < STREAK_PTS - 1; i++) {
        for (const j of [i, i + 1]) {
          const q = j / (STREAK_PTS - 1);
          const s = head - st.len * (1 - q);
          const u = st.u + st.curve * Math.sin(q * Math.PI);
          const idx = m * 3;
          this.linePos[idx] = this.dir.x * s - this.dir.y * u;
          this.linePos[idx + 1] = st.y + 0.25 * Math.sin(q * Math.PI * 1.5 + st.u);
          this.linePos[idx + 2] = this.dir.y * s + this.dir.x * u;
          const c = m * 4;
          this.lineCol[c] = this.lineCol[c + 1] = this.lineCol[c + 2] = 1;
          this.lineCol[c + 3] = 0.55 * fade * q * q;
          m++;
        }
      }
    }
    const lg = this.lines.geometry;
    lg.setDrawRange(0, m);
    (lg.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (lg.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    if (this.forming && now > this.formEnd + SETTLE) this.forming = false;
  }

  dispose(): void {
    this.finish();
    this.sheen.geometry.dispose();
    (this.sheen.material as THREE.Material).dispose();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}
