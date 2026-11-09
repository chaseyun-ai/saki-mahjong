import * as THREE from 'three';
import { BREAK, ChainEnd, FAINT, GOLD, LOCK, LinkSpot, PADLOCK, QUICK_LOCK, chainLinks, chainPlan, clamp01, dissolveAt, easeInOut, easeOut, lockTime, outcomeTime } from '../ui/riiChainPlan';
import { ChainLook, chainLook } from '../ui/riiLook';

// 白水哩的番缚（3D / 2.5D）：锁链从四面八方射过来压住手牌；结算时变金碎成碎片冲上天（天空放晴、钥匙落下在
// ui/skyKey.ts，画在整个画面上），或者一节节像粒子一样消散、剩下的化成光冲上天。布局和时间见 ui/riiChainPlan.ts。
// 手法参考 ultra-elements（MIT）：一条锁链一个 InstancedMesh，一节一个实例；碎片、尘埃的位置按初速度、
// 时间解析地算（不积分，快进、截图都对得上）。

// 锁链画在这个面上：手牌中间，right 是手牌那一排的方向，up 是画面上方，toward 朝镜头
export interface ChainFrame {
  center: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  toward: THREE.Vector3;
  width: number; // 手牌那一排有多宽
  size: number; // 一张牌多宽（锁链节的大小跟着它）
}

const GOLD_C = new THREE.Color('#ffc548');
const HOT = new THREE.Color('#fff4d0');
const PALE = new THREE.Color('#e9f1ff');
const UP_WORLD = new THREE.Vector3(0, 1, 0);

interface Link {
  p: THREE.Vector3; // 世界坐标
  t: THREE.Vector3; // 切线
  n: THREE.Vector3; // 平躺那一节的法线
  s: number;
  // 结算时往天上冲的方向和快慢、打转
  up: THREE.Vector3;
  spin: THREE.Vector3;
  drift: THREE.Vector3;
}

interface Chain {
  links: Link[];
  length: number;
  contactS: number; // 压在手牌上的那一节
  mesh: THREE.InstancedMesh;
  halves: THREE.InstancedMesh;
  mat: THREE.MeshStandardMaterial;
  start: number;
  clanks: number;
}

type Stage = { kind: 'lock'; t0: number; quick: boolean } | { kind: ChainEnd; t0: number; shown: number } | { kind: 'idle' };

export class ChainFx {
  readonly group = new THREE.Group();
  private chains: Chain[] = [];
  private now = 0;
  private stage: Stage = { kind: 'idle' };
  private lockedAt = 0;
  private sparks: { pts: THREE.Points; v: Float32Array; life: number; t: number }[] = [];
  private dust: { pts: THREE.Points; born: Float32Array; vel: Float32Array; origin: Float32Array; used: number } | null = null;
  private trails: THREE.LineSegments | null = null;
  private done = false;

  constructor(
    readonly n: number,
    private frame: ChainFrame,
    private onClank: (at: THREE.Vector3, color: THREE.ColorRepresentation, big: boolean) => void,
    readonly look: ChainLook = chainLook(),
  ) {
    const s = frame.size;
    // 链环的大小、粗细、长短照挑的样子（ui/riiLook.ts）
    const r = 0.26 * s * look.size;
    const tube = r * look.thick;
    const pitch = r * 2 * look.stretch - tube * 2.2;
    const linkGeo = look.square ? squareLink(r * look.stretch, r, tube, false) : new THREE.TorusGeometry(r, tube, 12, 28).scale(look.stretch, 1, 1);
    const halfGeo = look.square ? squareLink(r * look.stretch, r, tube, true) : new THREE.TorusGeometry(r, tube, 10, 14, Math.PI).scale(look.stretch, 1, 1);
    const iron = new THREE.Color(look.color);
    const ironDark = new THREE.Color(look.dark);
    this.iron = iron;
    const dims = { width: frame.width, depth: s * 0.8, far: frame.width * 0.75 + s * 14, pitch };
    let seed = 11;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    chainPlan(n).forEach((line) => {
      const built = chainLinks(line, dims);
      const links = built.links.map((l: LinkSpot) => {
        const p = this.world(l.p);
        const t = this.dir(l.t);
        const n = frame.toward.clone().addScaledVector(t, -t.dot(frame.toward)).normalize();
        // 冲上天：往画面上方，带一点往镜头、往两边散
        const up = frame.up
          .clone()
          .multiplyScalar(0.9)
          .addScaledVector(UP_WORLD, 0.45)
          .addScaledVector(frame.right, (rnd() - 0.5) * 0.9)
          .addScaledVector(frame.toward, (rnd() - 0.3) * 0.5)
          .normalize()
          .multiplyScalar(0.75 + rnd() * 0.5);
        const spin = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar((rnd() * 2 - 1) * 9);
        const drift = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(s * 1.2);
        return { p, t, n, s: l.s, up, spin, drift };
      });
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: look.metal, roughness: look.rough, transparent: true, opacity: 1, envMapIntensity: 1.7 });
      const mesh = new THREE.InstancedMesh(linkGeo, mat, links.length);
      const halves = new THREE.InstancedMesh(halfGeo, mat, links.length * 2);
      mesh.frustumCulled = halves.frustumCulled = false;
      mesh.renderOrder = halves.renderOrder = 7;
      halves.visible = false;
      // 每一节铁色深浅差一点，不像一个模子出来的
      links.forEach((_, k) => mesh.setColorAt(k, iron.clone().lerp(ironDark, rnd() * 0.7)));
      for (let k = 0; k < links.length * 2; k++) halves.setColorAt(k, iron);
      this.group.add(mesh, halves);
      this.chains.push({ links, length: built.length, contactS: built.contactS, mesh, halves, mat, start: 0, clanks: 0 });
    });
  }

  private iron: THREE.Color;

  // 自己发光的锁链（光之锁链）平时的光
  private baseGlow(mat: THREE.MeshStandardMaterial, k = 1): void {
    mat.emissive.set(this.look.glowColor).multiplyScalar(this.look.glow * k);
  }

  private world(p: [number, number, number]): THREE.Vector3 {
    const f = this.frame;
    return f.center.clone().addScaledVector(f.right, p[0]).addScaledVector(f.up, p[1]).addScaledVector(f.toward, p[2]);
  }

  private dir(t: [number, number, number]): THREE.Vector3 {
    const f = this.frame;
    return new THREE.Vector3().addScaledVector(f.right, t[0]).addScaledVector(f.up, t[1]).addScaledVector(f.toward, t[2]).normalize();
  }

  // 锁上。quick：结算时才现出来的（别人的哩），一下子缠好
  lock(quick = false): void {
    this.stage = { kind: 'lock', t0: this.now, quick };
    const gap = quick ? QUICK_LOCK / Math.max(1, this.n) / 3 : LOCK.stagger;
    this.chains.forEach((c, i) => {
      c.start = i * gap;
      c.clanks = quick ? 2 : 0;
    });
    this.lockedAt = this.now + (quick ? QUICK_LOCK : lockTime(this.n) + LOCK.hold);
  }

  // 已经锁好了（换了视角、重画）：直接是淡淡箍着的样子
  settle(): void {
    this.stage = { kind: 'lock', t0: this.now - 99, quick: true };
    this.chains.forEach((c) => (c.clanks = 2));
    this.lockedAt = this.now - 99;
  }

  finish(kind: ChainEnd): void {
    if (this.stage.kind !== 'lock') return;
    this.stage = { kind, t0: this.now, shown: this.opacityNow() };
  }

  get locking(): boolean {
    return this.stage.kind === 'lock' && this.now < this.lockedAt;
  }

  remaining(): number {
    const st = this.stage;
    if (st.kind === 'lock') return Math.max(0, this.lockedAt - this.now);
    if (st.kind === 'idle') return 0;
    return Math.max(0, st.t0 + outcomeTime(st.kind) - this.now);
  }

  get finished(): boolean {
    return this.done;
  }

  private opacityNow(): number {
    if (this.stage.kind !== 'lock') return 1;
    return 1 + (FAINT - 1) * easeInOut((this.now - this.lockedAt) / LOCK.dim);
  }

  update(dt: number): void {
    this.now += dt;
    const st = this.stage;
    if (st.kind === 'idle' || this.done) return;
    if (st.kind === 'lock') this.updateLock(st.quick);
    else if (st.kind === 'key') this.updateKey(this.now - st.t0, st.shown);
    else this.updateBroken(this.now - st.t0, st.shown);
    this.updateSparks(dt);
    this.updateDust();
  }

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private basis = new THREE.Matrix4();
  private sc = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  // 一节锁链：长轴顺着锁链，一节平躺、一节立着交替扣在一起
  private linkQuat(l: Link, k: number, out: THREE.Quaternion): THREE.Quaternion {
    const z = k % 2 ? this.tmp.crossVectors(l.t, l.n).normalize() : l.n;
    const y = new THREE.Vector3().crossVectors(z, l.t).normalize();
    this.basis.makeBasis(l.t, y, z);
    return out.setFromRotationMatrix(this.basis);
  }

  private put(c: Chain, k: number, pos: THREE.Vector3, scale: number): void {
    this.linkQuat(c.links[k], k, this.q);
    this.m.compose(pos, this.q, this.sc.setScalar(scale));
    c.mesh.setMatrixAt(k, this.m);
  }

  // ---------- 锁上：一条条射过来压住手牌，压住时绷一下 ----------

  private contactAt(c: Chain): THREE.Vector3 {
    const k = Math.round((c.contactS / c.length) * (c.links.length - 1));
    return c.links[Math.max(0, Math.min(c.links.length - 1, k))]?.p ?? this.frame.center;
  }

  private updateLock(quick: boolean): void {
    const t = this.now - (this.stage as { t0: number }).t0;
    const op = this.opacityNow();
    const fly = quick ? QUICK_LOCK * 0.7 : LOCK.fly;
    const s = this.frame.size;
    // 大锁砸下去锁死：砸一下（大闪光、震屏）
    if (!quick && !this.slammed && this.chains.length && this.chains.every((c) => t - c.start >= fly + PADLOCK.drop - PADLOCK.lead)) {
      // 和大锁砸下去（ui/riiPadlock.ts）同一刻
      this.slammed = true;
      this.onClank(this.frame.center, '#fff4dc', true);
      this.burst(this.frame.center, '#fff2cf', 40, s * 9, 0.6);
    }
    for (const c of this.chains) {
      const u = (t - c.start) / fly;
      const head = easeOut(u) * c.length;
      if (c.clanks === 0 && head >= c.contactS) {
        c.clanks = 1;
        const at = this.contactAt(c);
        this.onClank(at, '#dfe8ff', false);
        this.burst(at, '#e8eeff', 18, s * 4, 0.45);
      }
      if (c.clanks === 1 && u >= 1) {
        c.clanks = 2;
        this.onClank(this.contactAt(c), '#e8eeff', false);
      }
      // 压住时绷一下：整条往牌上一沉再弹回来，越靠近手牌沉得越多
      const since = t - c.start - fly;
      const press = since > 0 ? Math.exp(-since * 7) * Math.sin(since * 26) * s * 0.12 : 0;
      c.mat.opacity = op;
      c.mat.depthWrite = op > 0.99;
      this.baseGlow(c.mat);
      for (let k = 0; k < c.links.length; k++) {
        const l = c.links[k];
        const shown = u > 0 && l.s <= head;
        const near = Math.exp(-Math.abs(l.s - c.contactS) / (this.frame.width * 0.4));
        const pos = press ? this.tmp2.copy(l.p).addScaledVector(this.frame.toward, -press * near) : l.p;
        this.put(c, k, pos, shown ? 1 : 0);
      }
      c.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private tmp2 = new THREE.Vector3();
  private slammed = false;

  // 锁好以后锁链已经消散了（结算时要重新射出来）
  get vanished(): boolean {
    return this.stage.kind === 'lock' && this.opacityNow() < 0.02;
  }

  // ---------- 钥匙：变金 → 碎成金色碎片 → 冲上天（天空放晴、钥匙落下在 skyKey.ts）----------

  private updateKey(t: number, shown: number): void {
    const { show, sweep, crack, rise } = GOLD;
    const op = shown + (1 - shown) * easeOut(t / show);
    const ts = t - show;
    const tc = ts - sweep;
    const tr = tc - crack;
    const size = this.frame.size;
    const col = new THREE.Color();
    if (tc <= 0) {
      for (const c of this.chains) {
        c.mat.opacity = op;
        c.mat.depthWrite = op > 0.99;
        c.mat.emissive.set('#ff9a1f').multiplyScalar(0.55 * clamp01(ts / sweep));
        // 从压住手牌的那一点顺着锁链往两头扫过去
        const front = easeInOut(ts / sweep) * (Math.max(c.contactS, c.length - c.contactS) * 0.6 + size * 2);
        for (let k = 0; k < c.links.length; k++) {
          const l = c.links[k];
          const d = front - Math.abs(l.s - c.contactS);
          col.copy(this.iron).lerp(GOLD_C, clamp01(d / (size * 1.2)));
          if (d > 0 && d < size * 2) col.lerp(HOT, 1 - d / (size * 2));
          c.mesh.setColorAt(k, col);
          this.put(c, k, l.p, 1);
        }
        c.mesh.instanceMatrix.needsUpdate = true;
        if (c.mesh.instanceColor) c.mesh.instanceColor.needsUpdate = true;
      }
      return;
    }
    // 碎开：每节两片半环，先往四周弹开一点、发着金光，接着越来越快冲上天，拖着光
    this.rise(tc, crack, rise, size, GOLD_C, '#ffb640', (c) => c.links.map(() => true));
    if (tr > rise) this.done = true;
  }

  // 碎片冲上天（钥匙和崩断共用）：who 决定哪几节参加
  private rise(tc: number, crack: number, rise: number, size: number, color: THREE.Color, trail: string, who: (c: Chain) => boolean[]): void {
    const tr = tc - crack;
    if (!this.trails) {
      const total = this.chains.reduce((a, c) => a + c.links.length * 2, 0);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 6), 3));
      const mat = new THREE.LineBasicMaterial({ color: trail, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 });
      this.trails = new THREE.LineSegments(geo, mat);
      this.trails.frustumCulled = false;
      this.trails.renderOrder = 8;
      this.group.add(this.trails);
      for (const c of this.chains) {
        for (let k = 0; k < c.halves.count; k++) c.halves.setColorAt(k, color);
        if (c.halves.instanceColor) c.halves.instanceColor.needsUpdate = true;
        this.burst(this.contactAt(c), '#ffe7a8', 22, size * 5, 0.6);
      }
      this.onClank(this.frame.center, color, false);
    }
    const tra = this.trails.geometry.getAttribute('position') as THREE.BufferAttribute;
    const far = size * 42;
    const at = (l: Link, x: number, side: number, out: THREE.Vector3) => {
      // 先弹开（drift），再加速往上冲
      out.copy(l.p).addScaledVector(l.drift, (1 - Math.exp(-x * 7)) * (side ? 1 : -0.6));
      const y = clamp01((x - crack) / rise);
      return out.addScaledVector(l.up, far * y * y);
    };
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let idx = 0;
    for (const c of this.chains) {
      const on = who(c);
      c.mesh.visible = false;
      c.halves.visible = true;
      c.mat.opacity = 1 - clamp01((tr / rise - 0.85) / 0.15);
      c.mat.depthWrite = false;
      c.mat.emissive.copy(color).multiplyScalar(0.9 + 1.2 * Math.exp(-tc * 6) + 0.6 * clamp01(tr / rise));
      for (let k = 0; k < c.links.length * 2; k++, idx++) {
        const l = c.links[k >> 1];
        if (!on[k >> 1]) {
          this.m.makeScale(0, 0, 0);
          c.halves.setMatrixAt(k, this.m);
          tra.setXYZ(idx * 2, 0, 0, 0);
          tra.setXYZ(idx * 2 + 1, 0, 0, 0);
          continue;
        }
        at(l, tc, k % 2, a);
        this.linkQuat(l, k >> 1, this.q);
        if (k % 2) this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
        const sp = l.spin.length();
        if (sp > 0) this.q.premultiply(new THREE.Quaternion().setFromAxisAngle(this.tmp.copy(l.spin).divideScalar(sp), sp * tc * 0.3));
        this.m.compose(a, this.q, this.sc.setScalar(1 - 0.4 * clamp01(tr / rise)));
        c.halves.setMatrixAt(k, this.m);
        at(l, Math.max(0, tc - 0.09), k % 2, b);
        tra.setXYZ(idx * 2, a.x, a.y, a.z);
        tra.setXYZ(idx * 2 + 1, b.x, b.y, b.z);
      }
      c.halves.instanceMatrix.needsUpdate = true;
    }
    tra.needsUpdate = true;
    (this.trails.material as THREE.LineBasicMaterial).opacity = tr > 0 ? 0.85 * (1 - clamp01((tr / rise - 0.6) / 0.4)) : 0;
  }

  // ---------- 崩断：绷紧发白，然后一节节碎成细细的粒子，慢慢飘开、淡掉 ----------

  private updateBroken(t: number, shown: number): void {
    const { show, crack, dissolve, crumble, drift } = BREAK;
    const op = shown + (1 - shown) * easeOut(t / show);
    const tc = t - show;
    const td = tc - crack;
    const s = this.frame.size;
    if (td > 0 && !this.dust) this.makeDust();
    const k0 = clamp01(tc / crack);
    this.chains.forEach((c, ci) => {
      c.mat.opacity = op;
      c.mat.depthWrite = op > 0.99 && td <= 0;
      c.mat.emissive.copy(PALE).multiplyScalar(k0 * 0.5 * (0.7 + 0.3 * Math.sin(t * 80)) + (td > 0 ? 0.4 : 0));
      for (let k = 0; k < c.links.length; k++) {
        const l = c.links[k];
        const jit = (1 - clamp01(td / 0.3)) * k0 * s * 0.05;
        const pos = l.p.clone().addScaledVector(l.n, Math.sin(k * 2.3 + t * 70) * jit);
        // 轮到这一节：边缩小边碎成粒子（一开始、一半各撒一次）
        const when = dissolveAt(ci, k) * dissolve;
        const u = td > when ? clamp01((td - when) / crumble) : 0;
        const id = `${ci}-${k}`;
        if (u > 0 && !this.dusted.has(id)) {
          this.dusted.add(id);
          this.spawnDust(l.p, 10);
        }
        if (u >= 0.5 && !this.dusted.has(`${id}b`)) {
          this.dusted.add(`${id}b`);
          this.spawnDust(l.p, 7);
        }
        this.put(c, k, pos, u >= 1 ? 0 : 1 - 0.7 * u);
      }
      c.mesh.instanceMatrix.needsUpdate = true;
    });
    if (td > dissolve + crumble + drift) this.done = true;
  }

  private dusted = new Set<string>();

  private makeDust(): void {
    const total = this.chains.reduce((a, c) => a + c.links.length, 0) * 17;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(total * 3);
    const alpha = new Float32Array(total);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: this.frame.size * 0.24 }, uColor: { value: new THREE.Color('#dfe7f5') } },
      vertexShader: `
        attribute float alpha;
        varying float vA;
        uniform float uSize;
        void main() {
          vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * 900.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        uniform vec3 uColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 9;
    this.group.add(pts);
    this.dust = { pts, born: new Float32Array(total).fill(-1), vel: new Float32Array(total * 3), origin: new Float32Array(total * 3), used: 0 };
  }

  // 一节碎成的粒子：向四面慢慢飘开，稍微往上浮
  private spawnDust(at: THREE.Vector3, count: number): void {
    const d = this.dust;
    if (!d) return;
    const s = this.frame.size;
    for (let i = 0; i < count && d.used < d.born.length; i++, d.used++) {
      const j = d.used;
      d.born[j] = this.now;
      d.origin.set([at.x + (Math.random() - 0.5) * s * 0.45, at.y + (Math.random() - 0.5) * s * 0.45, at.z + (Math.random() - 0.5) * s * 0.45], j * 3);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(0.3 + Math.random() * 0.9)
        .addScaledVector(this.frame.up, 0.2 + Math.random() * 0.35)
        .multiplyScalar(s * 0.8);
      d.vel.set([v.x, v.y, v.z], j * 3);
    }
  }

  private updateDust(): void {
    const d = this.dust;
    if (!d) return;
    const pos = d.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const al = d.pts.geometry.getAttribute('alpha') as THREE.BufferAttribute;
    for (let j = 0; j < d.used; j++) {
      const age = this.now - d.born[j];
      // 每一颗活得不一样久，一闪一闪地淡掉
      const life = 0.6 + ((j * 0.618) % 1) * 0.6;
      const x = (1 - Math.exp(-age * 1.8)) / 1.8;
      pos.setXYZ(j, d.origin[j * 3] + d.vel[j * 3] * x, d.origin[j * 3 + 1] + d.vel[j * 3 + 1] * x, d.origin[j * 3 + 2] + d.vel[j * 3 + 2] * x);
      const tw = 0.65 + 0.35 * Math.sin(age * 18 + j);
      al.setX(j, age < 0 ? 0 : (1 - clamp01(age / life) ** 2) * Math.min(1, age * 20) * tw);
    }
    pos.needsUpdate = true;
    al.needsUpdate = true;
  }

  // ---------- 火星 ----------

  private burst(at: THREE.Vector3, color: THREE.ColorRepresentation, count: number, speed: number, life: number): void {
    const pos = new Float32Array(count * 3);
    const v = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos.set([at.x, at.y, at.z], i * 3);
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      v.set([d.x, d.y, d.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size: this.frame.size * 0.14, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 9;
    pts.frustumCulled = false;
    this.group.add(pts);
    this.sparks.push({ pts, v, life, t: 0 });
  }

  private updateSparks(dt: number): void {
    for (const sp of this.sparks) {
      sp.t += dt;
      const a = sp.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const drag = Math.exp(-dt * 4);
      for (let i = 0; i < sp.v.length; i++) {
        sp.v[i] *= drag;
        (a.array as Float32Array)[i] += sp.v[i] * dt;
      }
      a.needsUpdate = true;
      (sp.pts.material as THREE.PointsMaterial).opacity = 1 - clamp01(sp.t / sp.life) ** 2;
    }
    for (const sp of this.sparks.filter((s) => s.t >= s.life)) {
      this.group.remove(sp.pts);
      sp.pts.geometry.dispose();
      (sp.pts.material as THREE.Material).dispose();
    }
    this.sparks = this.sparks.filter((s) => s.t < s.life);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}

// 方形的链环：一圈圆角方框（w、h 是半宽、半高，长轴顺着 x）。half：只要上面那一半（碎开的半片）
function squareLink(w: number, h: number, tube: number, half: boolean): THREE.BufferGeometry {
  const c = Math.min(w, h) * 0.42; // 圆角
  const pts: THREE.Vector3[] = [];
  // 从右边正中开始逆时针走一圈：右边 → 右上角 → 上边 → 左上角 → 左边 → ...
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector3(cx + Math.cos(a) * c, cy + Math.sin(a) * c, 0));
    }
  };
  pts.push(new THREE.Vector3(w, 0, 0));
  corner(w - c, h - c, 0);
  corner(-w + c, h - c, Math.PI / 2);
  pts.push(new THREE.Vector3(-w, 0, 0));
  if (!half) {
    corner(-w + c, -h + c, Math.PI);
    corner(w - c, -h + c, Math.PI * 1.5);
  }
  const path = new THREE.CurvePath<THREE.Vector3>();
  const all = half ? pts : [...pts, pts[0]];
  for (let i = 0; i < all.length - 1; i++) path.add(new THREE.LineCurve3(all[i], all[i + 1]));
  return new THREE.TubeGeometry(path, half ? 48 : 96, tube, 8, !half);
}
