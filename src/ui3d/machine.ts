import * as THREE from 'three';
import { TILE_T } from './tableLayout';

// 全自动麻将机（牌桌风格「自动麻将机」）的机械动作，照真的全自动麻将桌（比如大洋 AMOS）做。
//
// 桌面上每家牌山底下是一块升降板：平时和桌布齐平、铺着一样的桌布，四周一道细缝。一局打完：
// 中间的仪表盘抬起来，桌上的牌滑到中间、从仪表盘底下的洞掉进机器里；四块升降板沉下去，露出底下的黑洞；仪表盘落回去。
// 机器在底下洗好、码好另一副牌（两副牌牌背颜色不一样，轮流用），升降板托着新的牌山升上来，到顶“咔”一下卡住，然后才掷骰子发牌。
// 第一局（还有发牌前选技能那一段：那时桌上的牌已经收走）升降板一开始就是沉下去的，开局直接升上来。
//
// 这里只管机器自己：洞、升降板、仪表盘抬多高、收牌时那些替身牌怎么走、什么时候该响哪一声。
// 牌山上的牌跟着升降板走，由 table3d.ts 照 plateY 摆；仪表盘也是 table3d.ts 照 lift 抬

// 牌山脚下那块地方（世界坐标，跟坐标轴对齐）：中心和两个方向的半宽
export interface MachineRect {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

// 该响的声音：open 仪表盘抬起来，sweep 牌哗啦啦掉进去，drop 升降板沉下去，close 仪表盘落回去，rise 升降板往上升（dur 秒），lock 升到顶卡住
export type MachineCue = 'open' | 'sweep' | 'drop' | 'close' | 'rise' | 'lock';

// 仪表盘抬起来多高：平放的牌（厚 0.78）正好从底下滑进去
export const MACHINE_LIFT = 0.95;
const LIFT_TIME = 0.22;
// 洞比牌山脚下那块最多大多少（桌角两家牌山挨得近时会小一点，见 build），升降板和洞边留多宽的缝
const HOLE_PAD = 0.1;
const SEAM = 0.03;
// 升降板沉多深：整墩两层牌都藏在桌面下面，再留一点
const DROP = TILE_T * 2 + 0.14;
const PLATE_T = 0.12;
const PIT_D = DROP + 0.5;
// 时间（秒）：旧牌开始滑、升降板什么时候沉、沉多久、升多久，升到顶以后过冲多少、多久回来
const DROP_AT = 0.36;
const DROP_TIME = 0.26;
const RISE_TIME = 0.85;
// 仪表盘落回去以后隔多久升降板开始升（一步做完再做下一步，像真的机器）
const RISE_GAP = 0.1;
// 升到顶撞上限位，往上一顶再落回来（“咔”的那一下）
const LOCK_UP = 0.03;
const LOCK_TIME = 0.09;
// 升到顶卡住以后停多久再掷骰子
const SETTLE = 0.15;

type Ease = (k: number) => number;
const easeOut: Ease = (k) => 1 - (1 - k) ** 3;
const easeIn: Ease = (k) => k * k * k;
const smooth: Ease = (k) => k * k * (3 - 2 * k);
// 电机：前后各 20% 加速、减速，中间匀速
const motor: Ease = (k) => {
  const a = 0.2;
  const v = 1 / (1 - a);
  if (k < a) return (0.5 * v * k * k) / a;
  if (k > 1 - a) return 1 - (0.5 * v * (1 - k) * (1 - k)) / a;
  return 0.5 * v * a + v * (k - a);
};

// 一个值随时间一段一段地变：每段从上一段结束的值变到 b
class Track {
  private segs: { t0: number; t1: number; a: number; b: number; ease: Ease }[] = [];
  constructor(private base: number) {}

  value(t: number): number {
    let v = this.base;
    for (const s of this.segs) {
      if (t < s.t0) break;
      if (t >= s.t1) {
        v = s.b;
        continue;
      }
      return s.a + (s.b - s.a) * s.ease((t - s.t0) / (s.t1 - s.t0));
    }
    return v;
  }

  // 接在已经排好的后面：t0 开始，dur 秒变到 b
  go(t0: number, dur: number, b: number, ease: Ease): void {
    this.segs.push({ t0, t1: t0 + dur, a: this.final, b, ease });
  }

  get final(): number {
    return this.segs.length ? this.segs[this.segs.length - 1].b : this.base;
  }

  get end(): number {
    return this.segs.length ? this.segs[this.segs.length - 1].t1 : -Infinity;
  }

  // 直接停在最后的样子
  finish(): void {
    this.base = this.final;
    this.segs = [];
  }

  prune(t: number): void {
    while (this.segs.length && this.segs[0].t1 <= t) this.base = this.segs.shift()!.b;
  }
}

// 收牌时替身牌：从原来的位置先平躺到桌面（牌河里的照样面朝上，立着的手牌往下一扣），再滑到中间仪表盘底下，最后往下掉进洞里
interface Ghost {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  fromScale: number;
  to: THREE.Vector3;
  flat: THREE.Quaternion;
  at: number;
  dur: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const FACE = new THREE.Vector3(0, 0, 1);

export class Machine {
  readonly group = new THREE.Group();
  private now = 0;
  // 升降板一开始和桌布齐平（牌局打到一半才建牌桌时牌山就在上面）；第一局开局先沉下去再升上来
  private plate = new Track(0);
  private liftT = new Track(0);
  private ghosts: Ghost[] = [];
  private cues: { at: number; cue: MachineCue; dur: number }[] = [];
  // 新牌山什么时候放到升降板上（升降板往下沉的时候是空的）
  private showAt = -Infinity;
  private rects: MachineRect[] = [];
  // 洞比牌山脚下那块大多少（build 里按桌角的缝算）
  private pad = HOLE_PAD;
  private plates: THREE.Group[] = [];
  private hole: THREE.Mesh | null = null;
  private pitMat = new THREE.MeshStandardMaterial({ color: '#0d0e0f', roughness: 0.95, side: THREE.BackSide, shadowSide: THREE.DoubleSide });
  private plateSide = new THREE.MeshStandardMaterial({ color: '#2a2c2f', roughness: 0.6, metalness: 0.4 });
  private holeMat = new THREE.MeshBasicMaterial({ color: '#050506' });

  // 按牌山的位置挖洞、放升降板（桌子尺寸变了重建）；consoleHalf、disc 是仪表盘的半宽和是不是圆盘（中间那个洞照它的形状）
  build(rects: MachineRect[], felt: THREE.Material, half: number, consoleHalf: number, disc: boolean): void {
    for (const o of [...this.group.children]) {
      if (this.ghosts.some((g) => g.obj === o)) continue;
      this.group.remove(o);
      o.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
    }
    this.rects = rects;
    this.plates = [];
    // 相邻两家的牌山在桌角只隔一道窄缝：四个洞各往外扩的量加起来要小于这道缝，洞才不会在桌角连到一起
    // （连上了桌布的三角化会出错，有的洞就挖不出来）
    let gap = Infinity;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        gap = Math.min(gap, Math.max(Math.abs(a.x - b.x) - a.hx - b.hx, Math.abs(a.z - b.z) - a.hz - b.hz));
      }
    }
    this.pad = THREE.MathUtils.clamp(gap * 0.45, SEAM + 0.01, HOLE_PAD);
    const pad = this.pad;
    for (const r of rects) {
      // 洞：一个没有顶的黑盒子（只画朝里的面）
      const pit = new THREE.Mesh(new THREE.BoxGeometry((r.hx + pad) * 2, PIT_D, (r.hz + pad) * 2), this.pitMat);
      pit.position.set(r.x, -PIT_D / 2, r.z);
      // 洞壁挡光：升上来的牌在洞里半明半暗
      pit.castShadow = true;
      pit.receiveShadow = true;
      this.group.add(pit);
      // 升降板：顶面铺桌布（贴图坐标照整张桌布算，齐平的时候和四周接得上），侧面是深灰的金属
      const plate = new THREE.Group();
      const w = r.hx + pad - SEAM;
      const d = r.hz + pad - SEAM;
      const top = new THREE.Mesh(feltPatch(r.x - w, r.z - d, r.x + w, r.z + d, half), felt);
      top.receiveShadow = true;
      const side = new THREE.Mesh(new THREE.BoxGeometry(w * 2, PLATE_T, d * 2), this.plateSide);
      side.position.set(r.x, -PLATE_T / 2 - 0.002, r.z);
      plate.add(top, side);
      this.group.add(plate);
      this.plates.push(plate);
    }
    // 中间仪表盘底下的洞（仪表盘抬起来才看得到）：比仪表盘小一圈，落回去以后整个盖住
    const hs = consoleHalf - 0.3;
    const holeGeo = disc ? new THREE.CircleGeometry(hs, 64) : new THREE.ShapeGeometry(roundRect(-hs, -hs, hs, hs, 0.4));
    this.hole = new THREE.Mesh(holeGeo, this.holeMat);
    this.hole.rotation.x = -Math.PI / 2;
    this.hole.position.y = 0.004;
    this.group.add(this.hole);
    this.apply(this.now);
  }

  // 挖了洞的桌布（贴图坐标和原来整块的一样）
  feltGeometry(half: number): THREE.BufferGeometry {
    const shape = roundRect(-half, -half, half, half, 0);
    for (const r of this.rects) {
      const w = r.hx + this.pad;
      const d = r.hz + this.pad;
      shape.holes.push(roundRect(r.x - w, -(r.z + d), r.x + w, -(r.z - d), 0));
    }
    return flatUV(new THREE.ShapeGeometry(shape), half);
  }

  // 收牌：仪表盘抬起来，替身牌滑进去，升降板沉下去。返回升降板沉到底的时刻（没有牌要收、升降板本来就在下面，就是现在）
  sweep(objs: THREE.Object3D[], now: number): number {
    this.finish();
    this.now = now;
    if (!objs.length) return this.plate.final < 0 ? now : this.drop(now);
    this.liftT.go(now, LIFT_TIME, MACHINE_LIFT, easeOut);
    this.cue(now, 'open', LIFT_TIME);
    let last = now;
    for (const obj of objs) {
      const from = obj.position.clone();
      // 往中间滑：终点在仪表盘底下（离中心 0.5 到 1.9），方向就是从中间看过去的方向
      const dir = from.clone().setY(0);
      if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
      dir.normalize();
      const to = dir.clone().multiplyScalar(0.5 + Math.random() * 1.4).setY(-TILE_T);
      // 躺平：转最小的角度让牌面朝上或朝下（本来面朝上的照样朝上，立着的、扣着的都扣下去），滑的时候顺带拧一点
      const face = FACE.clone().applyQuaternion(obj.quaternion);
      const tip = new THREE.Quaternion().setFromUnitVectors(face, face.y > 0.5 ? UP : UP.clone().negate());
      const twist = new THREE.Quaternion().setFromAxisAngle(UP, (Math.random() - 0.5) * 0.7);
      const flat = twist.multiply(tip).multiply(obj.quaternion);
      const dist = from.clone().setY(0).distanceTo(to.clone().setY(0));
      const at = now + 0.04 + Math.random() * 0.14;
      const dur = 0.34 + dist * 0.012 + Math.random() * 0.06;
      last = Math.max(last, at + dur);
      this.ghosts.push({ obj, from, fromQuat: obj.quaternion.clone(), fromScale: obj.scale.x, to, flat, at, dur });
      this.group.add(obj);
    }
    this.cue(now + 0.14, 'sweep', last - now - 0.14);
    // 牌都进去了，仪表盘落回去
    const lower = Math.max(last, now + LIFT_TIME + 0.1);
    this.liftT.go(lower, LIFT_TIME, 0, easeIn);
    this.cue(lower + LIFT_TIME, 'close', 0.2);
    return this.drop(now + DROP_AT);
  }

  // 升降板沉下去（已经在下面就不动），返回沉到底的时刻
  private drop(at: number): number {
    if (this.plate.final <= -DROP) return at;
    this.plate.go(at, DROP_TIME, -DROP, smooth);
    this.cue(at, 'drop', DROP_TIME);
    this.showAt = Infinity;
    return at + DROP_TIME;
  }

  // 升牌：升降板托着新码好的牌山升上来、到顶卡住。ready 是升降板沉到底的时刻（sweep 的返回值）；
  // 仪表盘抬着的话等它落回去再升。返回从 now 起多久以后可以掷骰子
  rise(now: number, ready: number): number {
    this.now = now;
    if (this.plate.final > -DROP) this.drop(now);
    const at = Math.max(now + 0.15, ready + 0.08, this.plate.end, this.liftT.end + RISE_GAP);
    this.showAt = at;
    this.plate.go(at, RISE_TIME, 0, motor);
    this.plate.go(at + RISE_TIME, LOCK_TIME * 0.35, LOCK_UP, easeOut);
    this.plate.go(at + RISE_TIME + LOCK_TIME * 0.35, LOCK_TIME * 0.65, 0, easeIn);
    this.cue(at, 'rise', RISE_TIME);
    this.cue(at + RISE_TIME, 'lock', 0.2);
    return at + RISE_TIME + LOCK_TIME + SETTLE - now;
  }

  // 新牌山还没放上升降板（沉下去的时候是空的）
  get hideNew(): boolean {
    return this.now < this.showAt;
  }

  // 升降板顶面现在的高度（0 是和桌布齐平），升的时候电机带着轻轻一抖
  get plateY(): number {
    const y = this.plate.value(this.now);
    const moving = this.now > this.showAt && this.now < this.showAt + RISE_TIME;
    return moving ? y + Math.sin(this.now * 2 * Math.PI * 24) * 0.004 : y;
  }

  get lift(): number {
    return this.liftT.value(this.now);
  }

  // 机器还在动（升降板、仪表盘、替身牌、还没响的声音）
  get busy(): boolean {
    return this.now < Math.max(this.plate.end, this.liftT.end) || this.ghosts.length > 0 || this.cues.length > 0;
  }

  // 世界坐标 (x, z) 在不在哪块升降板上
  onPlate(x: number, z: number): boolean {
    return this.rects.some((r) => Math.abs(x - r.x) <= r.hx + this.pad && Math.abs(z - r.z) <= r.hz + this.pad);
  }

  // 推进到 now，返回这一帧该响的声音
  update(now: number): { cue: MachineCue; dur: number }[] {
    this.now = now;
    this.plate.prune(now);
    this.liftT.prune(now);
    this.apply(now);
    const due = this.cues.filter((c) => now >= c.at);
    this.cues = this.cues.filter((c) => now < c.at);
    return due.map(({ cue, dur }) => ({ cue, dur }));
  }

  // 直接到最后的样子（快进、调试场景）：替身牌收掉，仪表盘落下，升降板停在排好的最后位置，不再响
  finish(): void {
    for (const g of this.ghosts) this.group.remove(g.obj);
    this.ghosts = [];
    this.plate.finish();
    this.liftT.finish();
    this.cues = [];
    if (this.showAt !== Infinity) this.showAt = -Infinity;
    this.apply(this.now);
  }

  private cue(at: number, cue: MachineCue, dur: number): void {
    this.cues.push({ at, cue, dur });
  }

  private apply(now: number): void {
    const y = this.plateY;
    for (const p of this.plates) p.position.y = y;
    if (this.hole) this.hole.visible = this.lift > 0.01;
    for (const g of [...this.ghosts]) {
      const k = (now - g.at) / g.dur;
      if (k >= 1) {
        this.group.remove(g.obj);
        this.ghosts.splice(this.ghosts.indexOf(g), 1);
        continue;
      }
      if (k <= 0) continue;
      const o = g.obj;
      // 前 30% 躺平落到桌面，同时开始往中间滑；最后 18% 从仪表盘底下的洞掉下去
      const lie = smooth(Math.min(1, k / 0.3));
      const e = smooth(Math.min(1, k / 0.85));
      const sink = Math.max(0, (k - 0.82) / 0.18);
      o.position.set(g.from.x + (g.to.x - g.from.x) * e, 0, g.from.z + (g.to.z - g.from.z) * e);
      o.position.y = g.from.y + (TILE_T / 2 - g.from.y) * lie - sink * sink * (TILE_T * 2);
      o.quaternion.copy(g.fromQuat).slerp(g.flat, lie);
      o.scale.setScalar(g.fromScale + (1 - g.fromScale) * lie);
    }
  }

  dispose(): void {
    this.finish();
    this.group.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
    for (const m of [this.pitMat, this.plateSide, this.holeMat]) m.dispose();
  }
}

// xy 平面上的圆角矩形（r 是 0 就是直角）
function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  if (r) s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  if (r) s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  if (r) s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  if (r) s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

// 平放在桌面上的一块（xy 平面转到水平：y 对应世界的 -z），贴图坐标照整张桌布（半宽 half）算
function flatUV(g: THREE.BufferGeometry, half: number): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (half * 2) + 0.5, p.getY(i) / (half * 2) + 0.5);
  g.rotateX(-Math.PI / 2);
  return g;
}

// 升降板顶面那一块桌布（世界坐标 x0..x1、z0..z1）
function feltPatch(x0: number, z0: number, x1: number, z1: number, half: number): THREE.BufferGeometry {
  return flatUV(new THREE.ShapeGeometry(roundRect(x0, -z1, x1, -z0, 0)), half);
}
