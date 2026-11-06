import * as THREE from 'three';
import { BREAK, ChainLine, ChainOutcome, FADE, FAINT, GOLD, LOCK, QUICK_LOCK, chainPlan, clamp01, easeInOut, easeOut, goldTime, linkOffsets, lockTime } from '../ui/riiChainPlan';
import { KEY_ART, keyArt } from '../ui/keyArt';

// 白水哩的番缚（3D / 2.5D）：锁链压住手牌，结算时变金汇聚成钥匙，或者崩断碎落。
// 布局和时间见 ui/riiChainPlan.ts。
// 手法参考 ultra-elements（MIT）：一条锁链是一个 InstancedMesh，一节一个实例；
// 碎开时每节换成两个半环，按初速度、自转和重力解析地算位置（不积分，快进、截图都对得上）；
// 变金从压住手牌的地方往两头扫过去，扫到的那一节先白一下再定成金色。

// 锁链画在这个面上：手牌中间，right 是手牌那一排的方向，up 是画面上方，toward 朝镜头
export interface ChainFrame {
  center: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  toward: THREE.Vector3;
  width: number; // 手牌那一排有多宽
  size: number; // 一张牌多宽（锁链节的大小跟着它）
}

const STEEL = new THREE.Color('#8e97a6');
const GOLD_C = new THREE.Color('#ffc548');
const HOT = new THREE.Color('#fff4d0');
const CRACK = new THREE.Color('#f3f6ff');

interface Chain {
  line: ChainLine;
  mesh: THREE.InstancedMesh;
  halves: THREE.InstancedMesh;
  mat: THREE.MeshStandardMaterial;
  offsets: number[];
  dir: THREE.Vector3;
  side: THREE.Vector3; // 锁链所在平面里和它垂直的方向（绷一下时往这边抖）
  cross: THREE.Vector3; // 压住手牌的那一点
  start: number; // 锁上时这一条什么时候开始飞
  clanked: boolean;
  // 碎开：每节两个半环的初速度、转轴、转速
  shards?: { v: THREE.Vector3; axis: THREE.Vector3; spin: number }[];
}

type Stage = { kind: 'lock'; t0: number; quick: boolean } | { kind: ChainOutcome; t0: number; shown: number } | { kind: 'idle' };

export class ChainFx {
  readonly group = new THREE.Group();
  private chains: Chain[] = [];
  private len: number;
  private pitch: number;
  private now = 0;
  private stage: Stage = { kind: 'idle' };
  private lockedAt = 0; // 锁好（开始变淡）的时间
  private key: THREE.Mesh | null = null;
  private sparks: { pts: THREE.Points; v: Float32Array; life: number; t: number }[] = [];
  private flashed = false;
  private tag = '';
  private done = false;

  constructor(
    readonly n: number,
    private frame: ChainFrame,
    private onClank: (at: THREE.Vector3, color: THREE.ColorRepresentation, big: boolean) => void,
  ) {
    const s = frame.size;
    // 锁链长到画面外面（2.5D 自己的手牌在画面下沿，往下也要够长）
    this.len = frame.width * 0.62 + s * 9;
    const r = 0.17 * s;
    const tube = 0.05 * s;
    this.pitch = r * 2 * 1.42 - tube * 1.6;
    const linkGeo = new THREE.TorusGeometry(r, tube, 8, 18);
    linkGeo.scale(1.42, 1, 1);
    const halfGeo = new THREE.TorusGeometry(r, tube, 8, 10, Math.PI);
    halfGeo.scale(1.42, 1, 1);
    const offsets = linkOffsets(this.len, this.pitch);
    for (const line of chainPlan(n)) {
      const dir = frame.right.clone().multiplyScalar(Math.cos(line.angle)).addScaledVector(frame.up, Math.sin(line.angle));
      const side = new THREE.Vector3().crossVectors(frame.toward, dir).normalize();
      const cross = frame.center
        .clone()
        .addScaledVector(frame.right, line.x * frame.width)
        .addScaledVector(frame.toward, s * 1.1);
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.92, roughness: 0.3, transparent: true, opacity: 1, envMapIntensity: 1.3 });
      const mesh = new THREE.InstancedMesh(linkGeo, mat, offsets.length);
      const halves = new THREE.InstancedMesh(halfGeo, mat, offsets.length * 2);
      mesh.frustumCulled = halves.frustumCulled = false;
      mesh.renderOrder = halves.renderOrder = 7;
      halves.visible = false;
      for (let k = 0; k < offsets.length; k++) mesh.setColorAt(k, STEEL);
      for (let k = 0; k < offsets.length * 2; k++) halves.setColorAt(k, STEEL);
      this.group.add(mesh, halves);
      this.chains.push({ line, mesh, halves, mat, offsets, dir, side, cross, start: 0, clanked: false });
    }
  }

  // 锁上。quick：结算时才现出来的（别人的哩），一下子锁好，不放咔嚓
  lock(quick = false): void {
    this.stage = { kind: 'lock', t0: this.now, quick };
    const gap = quick ? QUICK_LOCK / Math.max(1, this.n) / 2 : LOCK.stagger;
    this.chains.forEach((c, i) => {
      c.start = i * gap;
      c.clanked = quick;
    });
    this.lockedAt = this.now + (quick ? QUICK_LOCK : lockTime(this.n) + LOCK.hold);
  }

  // 已经锁好了（比如换了视角、重开牌桌）：直接是淡淡的样子
  settle(): void {
    this.stage = { kind: 'lock', t0: this.now - 99, quick: true };
    this.chains.forEach((c) => (c.clanked = true));
    this.lockedAt = this.now - 99;
  }

  // 结算：变金成钥匙、崩断、淡掉
  finish(kind: ChainOutcome, tag = ''): void {
    if (this.stage.kind !== 'lock') return;
    this.tag = tag;
    this.stage = { kind, t0: this.now, shown: this.opacityNow() };
    this.flashed = false;
    if (kind === 'broken') this.prepareShards();
  }

  get locking(): boolean {
    return this.stage.kind === 'lock' && this.now < this.lockedAt;
  }

  // 这一段还要放多久（秒）
  remaining(): number {
    const st = this.stage;
    if (st.kind === 'lock') return Math.max(0, this.lockedAt - this.now);
    if (st.kind === 'idle') return 0;
    const total = st.kind === 'key' ? goldTime() : st.kind === 'broken' ? BREAK.show + BREAK.crack + BREAK.scatter : FADE;
    return Math.max(0, st.t0 + total - this.now);
  }

  get finished(): boolean {
    return this.done;
  }

  private opacityNow(): number {
    const st = this.stage;
    if (st.kind !== 'lock') return 1;
    const u = clamp01((this.now - this.lockedAt) / LOCK.dim);
    return 1 + (FAINT - 1) * easeInOut(u);
  }

  update(dt: number): void {
    this.now += dt;
    const st = this.stage;
    if (st.kind === 'idle' || this.done) return;
    if (st.kind === 'lock') this.updateLock(st.quick);
    else if (st.kind === 'key') this.updateKey(this.now - st.t0, st.shown);
    else if (st.kind === 'broken') this.updateBroken(this.now - st.t0, st.shown);
    else this.updateFade(this.now - st.t0);
    this.updateSparks(dt);
  }

  // ---------- 锁上 ----------

  private updateLock(quick: boolean): void {
    const t = this.now - (this.stage as { t0: number }).t0;
    const op = this.opacityNow();
    const fly = quick ? QUICK_LOCK / 2 : LOCK.fly;
    for (const c of this.chains) {
      const u = (t - c.start) / fly;
      const p = easeOut(u);
      // 链头走到哪了：从 from 那一头射过来
      const head = c.line.from * this.len * (1 - 2 * p);
      // 链头扫过压住的那一点：咔嚓
      if (!c.clanked && p >= 0.5) {
        c.clanked = true;
        this.onClank(c.cross, '#dfe8ff', false);
        this.burst(c.cross, '#e8eeff', 26, this.frame.size * 5, 0.5);
      }
      // 飞完绷一下：两头固定，中间抖，越抖越小
      const since = t - c.start - fly;
      const wob = since > 0 ? Math.exp(-since * 7) * Math.sin(since * 38) * this.frame.size * 0.22 : 0;
      c.mat.opacity = op;
      c.mat.depthWrite = op > 0.99;
      c.mat.emissive.set(0x000000);
      for (let k = 0; k < c.offsets.length; k++) {
        const s = c.offsets[k];
        const shown = u > 0 && (c.line.from === 1 ? s >= head : s <= head);
        const bend = wob * Math.cos((s / this.len) * Math.PI * 0.5);
        this.placeLink(c, k, s, shown ? 1 : 0, bend);
      }
      c.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private basis = new THREE.Matrix4();
  private sc = new THREE.Vector3();

  // 一节锁链：长轴顺着锁链，一节平躺、一节立着交替扣在一起
  private linkQuat(c: Chain, k: number, out: THREE.Quaternion): THREE.Quaternion {
    const x = c.dir;
    const z = k % 2 ? c.side : this.frame.toward;
    const y = this.v.crossVectors(z, x).normalize();
    this.basis.makeBasis(x, y, z);
    return out.setFromRotationMatrix(this.basis);
  }

  private placeLink(c: Chain, k: number, s: number, scale: number, bend = 0): void {
    const pos = c.cross.clone().addScaledVector(c.dir, s).addScaledVector(c.side, bend);
    this.linkQuat(c, k, this.q);
    this.m.compose(pos, this.q, this.sc.setScalar(scale));
    c.mesh.setMatrixAt(k, this.m);
  }

  // ---------- 钥匙 ----------

  private trails: THREE.LineSegments | null = null;
  private rays: THREE.Mesh | null = null;
  private stars: THREE.Sprite[] = [];

  private keyCenter(): THREE.Vector3 {
    return this.frame.center.clone().addScaledVector(this.frame.up, this.frame.size * 3).addScaledVector(this.frame.toward, this.frame.size * 2.4);
  }

  private keyLen(): number {
    return Math.min(this.frame.width * 0.62, this.frame.size * 9.5);
  }

  private keyQuat(): THREE.Quaternion {
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(this.frame.right, this.frame.up, this.frame.toward));
  }

  // 照原作的顺序：锁链变金 → 碎成一片片金色碎片（锁定完成）→ 碎片拖着光汇到一点 → 炸出放射的光和星光 → 钥匙亮出来
  private updateKey(t: number, shown: number): void {
    const { show, sweep, crack, gather, burst, hold, fade } = GOLD;
    const op = shown + (1 - shown) * easeOut(t / show);
    const ts = t - show;
    const tc = ts - sweep;
    const tg = tc - crack;
    const tb = tg - gather;
    const kc = this.keyCenter();
    const size = this.frame.size;
    const col = new THREE.Color();
    // 1. 变金：从压住手牌的地方往两头扫
    if (tc <= 0) {
      for (const c of this.chains) {
        c.mat.depthWrite = op > 0.99;
        c.mat.opacity = op;
        c.mat.emissive.set('#ff9a1f').multiplyScalar(0.6 * clamp01(ts / sweep));
        const front = easeInOut(ts / sweep) * (this.len + size * 2);
        for (let k = 0; k < c.offsets.length; k++) {
          const d = front - Math.abs(c.offsets[k]);
          col.copy(STEEL).lerp(GOLD_C, clamp01(d / (size * 1.6)));
          if (d > 0 && d < size * 2.4) col.lerp(HOT, 1 - d / (size * 2.4));
          c.mesh.setColorAt(k, col);
          this.placeLink(c, k, c.offsets[k], 1);
        }
        c.mesh.instanceMatrix.needsUpdate = true;
        if (c.mesh.instanceColor) c.mesh.instanceColor.needsUpdate = true;
      }
      return;
    }
    // 2. 碎成金色碎片：每节两个半环，慢慢往外飘、打着转
    if (!this.goldReady) this.prepareGoldShards();
    const drift = (sh: { v: THREE.Vector3 }, home: THREE.Vector3, x: number) => home.clone().addScaledVector(sh.v, (1 - Math.exp(-x * 3)) / 3);
    const total = this.chains.reduce((a, c) => a + c.offsets.length * 2, 0);
    if (tg > 0 && !this.trails) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 6), 3));
      const mat = new THREE.LineBasicMaterial({ color: '#ffb640', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      this.trails = new THREE.LineSegments(geo, mat);
      this.trails.frustumCulled = false;
      this.trails.renderOrder = 8;
      this.group.add(this.trails);
    }
    const tr = this.trails?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    let idx = 0;
    for (const c of this.chains) {
      c.mesh.visible = false;
      c.halves.visible = tb <= 0;
      c.mat.opacity = 1;
      c.mat.depthWrite = false;
      // 碎开那一下最亮，飘的时候一直发着金光，往一点飞时越来越白
      c.mat.emissive.set('#ff9a1f').multiplyScalar(0.7 + 0.8 * Math.exp(-tc * 6) + (tg > 0 ? 0.5 * clamp01(tg / gather) : 0));
      for (let k = 0; k < c.offsets.length * 2; k++, idx++) {
        const sh = c.shards![k];
        const s = c.offsets[k >> 1];
        const home = c.cross.clone().addScaledVector(c.dir, s);
        const spun = (x: number) => {
          this.linkQuat(c, k >> 1, this.q);
          if (k % 2) this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
          return this.q.premultiply(new THREE.Quaternion().setFromAxisAngle(sh.axis, sh.spin * x));
        };
        let pos: THREE.Vector3;
        let scale = 1;
        if (tg <= 0) pos = drift(sh, home, tc);
        else {
          // 3. 拖着光汇到一点：远的晚一点出发，越飞越快
          const from = drift(sh, home, crack);
          const at = (u: number) => {
            const lag = (Math.abs(s) / this.len) * 0.35;
            const x = clamp01((u - lag) / 0.65);
            return from.clone().lerp(kc, x * x * x);
          };
          const u = tg / gather;
          pos = at(u);
          const x = clamp01(u);
          scale = Math.max(0.001, 1 - 0.85 * x * x);
          if (tr) {
            const back = at(u - 0.22);
            tr.setXYZ(idx * 2, pos.x, pos.y, pos.z);
            tr.setXYZ(idx * 2 + 1, back.x, back.y, back.z);
          }
        }
        this.m.compose(pos, spun(Math.min(tc, crack + Math.max(0, tg))), this.sc.setScalar(scale));
        c.halves.setMatrixAt(k, this.m);
      }
      c.halves.instanceMatrix.needsUpdate = true;
    }
    if (tc < 1 / 30 && !this.cracked) {
      this.cracked = true;
      for (const c of this.chains) this.burst(c.cross, '#ffd36a', 30, size * 6, 0.7);
      this.onClank(this.frame.center, '#ffd77a', false);
    }
    if (tr && this.trails) {
      tr.needsUpdate = true;
      (this.trails.material as THREE.LineBasicMaterial).opacity = tg > 0 && tb <= 0 ? 0.9 : 0;
    }
    if (tb <= 0) return;
    // 4. 汇到一点炸开：白光、放射的光、星光；钥匙从光里出来
    if (!this.flashed) {
      this.flashed = true;
      this.onClank(kc, '#ffd77a', true);
      this.burst(kc, '#fff1c0', 70, size * 10, 1.1);
    }
    const tl = tb;
    const out = clamp01((tl - burst - hold) / fade);
    const rays = this.ensureRays();
    rays.visible = true;
    rays.position.copy(kc).addScaledVector(this.frame.toward, -size * 0.2);
    rays.quaternion.copy(this.keyQuat()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tl * 0.25));
    rays.scale.setScalar(this.keyLen() * 1.9 * easeOut(tl / 0.45));
    (rays.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - out) * (0.85 + 0.15 * Math.sin(tl * 3));
    this.updateStars(tl, kc, 1 - out);
    // 5. 钥匙：光炸开一会儿以后从斜着转正
    const tk = tl - burst * 0.5;
    if (tk > 0) {
      const key = this.ensureKey();
      const pop = backOut(tk / 0.45);
      key.visible = true;
      key.position.copy(kc).addScaledVector(this.frame.up, Math.sin(tk * 2.2) * size * 0.12 + out * size * 1.4);
      key.quaternion.copy(this.keyQuat()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (1 - easeOut(tk / 0.6)) * 0.9 + 0.12 + Math.sin(tk * 1.4) * 0.03));
      const L = this.keyLen() * pop * (1 + out * 0.12);
      key.scale.set(L, (L * KEY_ART.h) / KEY_ART.w, 1);
      (key.material as THREE.MeshBasicMaterial).opacity = 1 - out;
    }
    if (out >= 1) this.done = true;
  }

  private ensureKey(): THREE.Mesh {
    if (this.key) return this.key;
    const tex = new THREE.CanvasTexture(keyArt(this.n, this.tag || ''));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const key = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    key.renderOrder = 10;
    key.frustumCulled = false;
    this.key = key;
    this.group.add(key);
    return key;
  }

  private ensureRays(): THREE.Mesh {
    if (this.rays) return this.rays;
    const mat = new THREE.MeshBasicMaterial({ map: raysTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.rays = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.rays.renderOrder = 9;
    this.rays.frustumCulled = false;
    this.group.add(this.rays);
    return this.rays;
  }

  private updateStars(t: number, kc: THREE.Vector3, alpha: number): void {
    const L = this.keyLen();
    if (!this.stars.length) {
      const mat = new THREE.SpriteMaterial({ map: starTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      for (let i = 0; i < 14; i++) {
        const sp = new THREE.Sprite(mat.clone());
        sp.renderOrder = 11;
        const a = (i / 14) * Math.PI * 2 + i * 0.7;
        const r = 0.35 + ((i * 37) % 10) / 16;
        sp.userData = { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.55, ph: i * 1.3, sz: 0.06 + ((i * 13) % 5) * 0.018 };
        this.stars.push(sp);
        this.group.add(sp);
      }
    }
    for (const sp of this.stars) {
      const d = sp.userData as { x: number; y: number; ph: number; sz: number };
      sp.position.copy(kc).addScaledVector(this.frame.right, d.x * L).addScaledVector(this.frame.up, d.y * L).addScaledVector(this.frame.toward, this.frame.size * 0.3);
      const tw = Math.max(0, Math.sin(t * 4 + d.ph));
      sp.scale.setScalar(L * d.sz * (0.3 + tw) * easeOut(t / 0.4));
      sp.material.opacity = alpha * tw;
    }
  }

  // 变金以后碎成的金色碎片：每节两个半环，往四周慢慢飘开
  private goldReady = false;
  private cracked = false;
  private prepareGoldShards(): void {
    this.goldReady = true;
    let seed = 3;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const s = this.frame.size;
    for (const c of this.chains) {
      c.shards = [];
      for (let k = 0; k < c.offsets.length * 2; k++) {
        const v = c.side
          .clone()
          .multiplyScalar((rnd() - 0.5) * 4 * s)
          .addScaledVector(c.dir, (rnd() - 0.5) * 2 * s)
          .addScaledVector(this.frame.toward, (rnd() - 0.2) * 2 * s);
        c.shards.push({ v, axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spin: (rnd() * 2 - 1) * 5 });
      }
      for (let k = 0; k < c.halves.count; k++) c.halves.setColorAt(k, GOLD_C);
      if (c.halves.instanceColor) c.halves.instanceColor.needsUpdate = true;
    }
  }

  // ---------- 崩断 ----------

  private prepareShards(): void {
    let seed = 1;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const s = this.frame.size;
    for (const c of this.chains) {
      c.shards = [];
      for (let k = 0; k < c.offsets.length * 2; k++) {
        const off = c.offsets[k >> 1];
        // 从压住手牌那一点往两头崩开，再往镜头和四周乱飞
        const v = c.dir
          .clone()
          .multiplyScalar(Math.sign(off || 1) * (2 + rnd() * 5) * s)
          .addScaledVector(c.side, (rnd() - 0.5) * 7 * s)
          .addScaledVector(this.frame.toward, (rnd() * 4 - 0.6) * s)
          .addScaledVector(this.frame.up, (1 + rnd() * 3) * s);
        const axis = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
        c.shards.push({ v, axis, spin: (rnd() * 2 - 1) * 14 });
      }
    }
  }

  private updateBroken(t: number, shown: number): void {
    const { show, crack, scatter } = BREAK;
    const tc = t - show;
    const tf = tc - crack;
    const op = shown + (1 - shown) * easeOut(t / show);
    const s = this.frame.size;
    for (const c of this.chains) {
      if (tf <= 0) {
        // 绷紧发白，一抖一抖
        const k0 = clamp01(tc / crack);
        c.mat.opacity = op;
        c.mat.depthWrite = op > 0.99;
        c.mat.emissive.copy(CRACK).multiplyScalar(k0 * 0.8 * (0.6 + 0.4 * Math.sin(t * 90)));
        const jit = k0 * s * 0.07;
        for (let k = 0; k < c.offsets.length; k++) this.placeLink(c, k, c.offsets[k], 1, Math.sin(k * 2.3 + t * 70) * jit);
        c.mesh.instanceMatrix.needsUpdate = true;
        continue;
      }
      if (!c.halves.visible) {
        c.halves.visible = true;
        c.mesh.visible = false;
        this.onClank(c.cross, '#eef2ff', false);
        this.burst(c.cross, '#dfe6f5', 40, s * 8, 0.8);
      }
      const u = tf / scatter;
      c.mat.opacity = 1 - clamp01((u - 0.45) / 0.55);
      c.mat.depthWrite = false;
      c.mat.emissive.copy(CRACK).multiplyScalar(0.8 * Math.exp(-tf * 8));
      const grav = 9 * s;
      for (let k = 0; k < c.offsets.length * 2; k++) {
        const sh = c.shards![k];
        const home = c.cross.clone().addScaledVector(c.dir, c.offsets[k >> 1]);
        const pos = home.addScaledVector(sh.v, tf).addScaledVector(this.frame.up, -0.5 * grav * tf * tf);
        this.linkQuat(c, k >> 1, this.q);
        // 两个半环：一个朝上、一个转半圈朝下
        if (k % 2) this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
        this.q.premultiply(new THREE.Quaternion().setFromAxisAngle(sh.axis, sh.spin * tf));
        this.m.compose(pos, this.q, this.sc.setScalar(1));
        c.halves.setMatrixAt(k, this.m);
      }
      c.halves.instanceMatrix.needsUpdate = true;
    }
    if (tf > scatter) this.done = true;
  }

  private updateFade(t: number): void {
    const op = FAINT * (1 - clamp01(t / FADE));
    for (const c of this.chains) {
      c.mat.opacity = op;
      c.mat.depthWrite = false;
    }
    if (t > FADE) this.done = true;
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
    const mat = new THREE.PointsMaterial({ color, size: this.frame.size * 0.16, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
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

function backOut(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

// 钥匙后面放射的光：从中间往外一道道淡下去
let raysTex: THREE.CanvasTexture | null = null;
function raysTexture(): THREE.CanvasTexture {
  if (raysTex) return raysTex;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.translate(256, 256);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 256);
  glow.addColorStop(0, 'rgba(255,246,214,0.9)');
  glow.addColorStop(0.25, 'rgba(255,214,120,0.35)');
  glow.addColorStop(1, 'rgba(255,190,80,0)');
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + (i % 3) * 0.05;
    const w = 0.025 + (i % 4) * 0.012;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 256 * (0.7 + (i % 5) * 0.06), a - w, a + w);
    ctx.closePath();
    ctx.fillStyle = glow;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.arc(0, 0, 256, 0, Math.PI * 2);
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 180);
  core.addColorStop(0, 'rgba(255,240,200,0.55)');
  core.addColorStop(1, 'rgba(255,200,100,0)');
  ctx.fillStyle = core;
  ctx.fill();
  raysTex = new THREE.CanvasTexture(c);
  raysTex.colorSpace = THREE.SRGBColorSpace;
  return raysTex;
}

// 四角的星光
let starTex: THREE.CanvasTexture | null = null;
function starTexture(): THREE.CanvasTexture {
  if (starTex) return starTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.translate(64, 64);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-64, -64, 128, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  for (const r of [0, Math.PI / 2]) {
    ctx.save();
    ctx.rotate(r);
    ctx.beginPath();
    ctx.moveTo(-62, 0);
    ctx.quadraticCurveTo(0, -5, 62, 0);
    ctx.quadraticCurveTo(0, 5, -62, 0);
    ctx.fill();
    ctx.restore();
  }
  starTex = new THREE.CanvasTexture(c);
  return starTex;
}
