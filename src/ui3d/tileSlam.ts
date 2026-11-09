import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TILE_H, TILE_T } from './tableLayout';

// 自摸砸牌（参考雀魂的手感，画面和动作都是自己做的）：一只手从这一家身后伸进画面，捏着那张牌的上半截举起来、牌面亮给镜头看，
// 往后上方带一点蓄力，再狠狠把牌竖着拍在桌上，停一下，手收回去，牌留在桌上立着。
//
// 这里只管手和牌怎么动：牌桌（table3d.ts）给出牌从哪拿、砸到哪、这一家的朝向，砸到桌面那一下回调 onHit，
// 冲击波、震屏、桌上的牌跳一下、音效、角色特效（咲的百合、衣的水花……）都在 onHit 里放。
// 一次可以砸好几张（不同的人），每张一只手。手是卡通渲染：三阶明暗加一圈描边，袖子、袖口、皮肤的颜色可以换。
//
// 坐标：牌的“手里坐标”是竖着放的牌（牌面朝 +z，也就是朝着坐着的人），手从上面捏住牌顶，
// 手背朝上，四根手指扣在牌背（-z），大拇指压在牌面（+z）上，前臂往 +z（人那边）、往上伸。

export interface SlamPose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

// 一下砸牌的节奏（秒）：reach 手伸到牌上捏住（carried 时是带着牌从画面外伸进来、直接到举高的地方）、
// lift 举起来、hang 在最高处往后蓄力、drop 拍下去、hold 按在桌上停一下、back 手收回画面外
export interface SlamTiming {
  reach: number;
  lift: number;
  hang: number;
  drop: number;
  hold: number;
  back: number;
}

export const SLAM_TIMING: SlamTiming = { reach: 0.3, lift: 0.2, hang: 0.12, drop: 0.08, hold: 0.16, back: 0.32 };

// 手臂的颜色：袖子、袖口那一圈、皮肤
export interface ArmLook {
  sleeve: THREE.ColorRepresentation;
  cuff: THREE.ColorRepresentation;
  skin: THREE.ColorRepresentation;
  line: THREE.ColorRepresentation; // 描边
}

export const DEFAULT_ARM: ArmLook = { sleeve: '#eef1f7', cuff: '#2b3a66', skin: '#f1c0a4', line: '#5b3934' };

export interface SlamSpec {
  tile: THREE.Object3D; // 要砸的那张牌（牌的整组）
  to: SlamPose; // 砸下去以后牌的样子（竖着立在桌上）
  from?: SlamPose; // 牌现在在哪：手先伸过去捏住再举起来。不给（carried）就是牌一开始就在手里，跟着手从画面外伸进来
  side: THREE.Vector3; // 砸牌那一家的右手方向（世界坐标，水平）
  out: THREE.Vector3; // 那一家往外（朝她自己身体）的方向（世界坐标，水平）
  lift?: number; // 举多高（牌宽，按牌的大小放大），默认 3.2
  timing?: Partial<SlamTiming>;
  arm?: Partial<ArmLook> | null; // null：不画手，只有牌自己飞起来砸下去
  onHit?: (at: THREE.Vector3) => void; // 砸到桌面那一刻，at 是牌底下的桌面点
  onDone?: () => void; // 手收回去以后
}

// start 返回这一下什么时候砸到、什么时候整段做完（和 now 同一个时钟）
export interface SlamRun {
  hitAt: number;
  doneAt: number;
}

interface Active {
  spec: SlamSpec;
  timing: SlamTiming;
  t0: number;
  arm: THREE.Group | null;
  hit: boolean;
  done: boolean;
  // 手捏住的点（牌顶往下一点）在手里坐标里相对牌中心的位置
  enter: THREE.Vector3; // 手从哪伸进来（世界）
  apex: THREE.Vector3; // 举到最高的地方（捏住的点，世界）
  grabFrom: THREE.Vector3 | null; // 伸过去捏住的地方（捏住的点，世界）
  grabTo: THREE.Vector3; // 砸下去以后捏住的点（世界）
}

// 捏住的点：牌中心往上 GRIP_Y 个牌高
const GRIP_Y = 0.3;
// 手的大小（牌宽的几倍，1 是按下面量好的尺寸）
const HAND_SCALE = 1.3;
// 举着的时候牌面往镜头那边仰多少（弧度，负的是牌顶往桌子中间倒）
const SHOW = -0.8;
// 牌仰起来的时候手腕弯回来多少（1 是前臂一点不跟着转）
const WRIST_BEND = 0.8;

const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// ---------- 手臂的模型 ----------

let gradient: THREE.DataTexture | null = null;
// 三阶明暗（卡通渲染）：暗部、中间、亮部
function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

// 描边：同一个形状沿法线往外鼓一点、只画背面
function outlineMat(color: THREE.ColorRepresentation, width: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (s) => {
    s.uniforms.uLine = { value: width };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uLine;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uLine;');
  };
  return m;
}

interface ArmParts {
  group: THREE.Group;
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
}

// 一节圆柱形的手指 / 手臂：从 a 到 b，两头圆的（胶囊）
function capsule(parts: ArmParts, mat: THREE.Material, line: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number, parent: THREE.Object3D): void {
  const len = a.distanceTo(b);
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 6, 12);
  parts.geos.push(geo);
  const mesh = new THREE.Mesh(geo, mat);
  const edge = new THREE.Mesh(geo, line);
  for (const m of [mesh, edge]) {
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    parent.add(m);
  }
  mesh.castShadow = true;
}

// 一节锥形的筒（前臂、袖子）：底下 a 半径 ra，上面 b 半径 rb
function tube(parts: ArmParts, mat: THREE.Material, line: THREE.Material | null, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, parent: THREE.Object3D, open = false): void {
  const geo = new THREE.CylinderGeometry(rb, ra, a.distanceTo(b), 18, 1, open);
  parts.geos.push(geo);
  const meshes = [new THREE.Mesh(geo, mat), ...(line ? [new THREE.Mesh(geo, line)] : [])];
  for (const m of meshes) {
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    parent.add(m);
  }
  meshes[0].castShadow = true;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// 右手，捏着牌顶。原点是捏住的点（牌中心往上 GRIP_Y 个牌高），单位是牌宽
export function buildArm(look: Partial<ArmLook> = {}): THREE.Group {
  const lk = { ...DEFAULT_ARM, ...look };
  const parts: ArmParts = { group: new THREE.Group(), mats: [], geos: [] };
  const toon = (c: THREE.ColorRepresentation) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient() });
  const skin = toon(lk.skin);
  const sleeve = toon(lk.sleeve);
  const cuff = toon(lk.cuff);
  const line = outlineMat(lk.line, 0.035);
  const lineThin = outlineMat(lk.line, 0.025);
  parts.mats.push(skin, sleeve, cuff, line, lineThin);
  const g = parts.group;
  // 牌顶在 y = TILE_H * (0.5 - GRIP_Y)，牌背 z = -TILE_T / 2，牌面 z = +TILE_T / 2
  const top = TILE_H * (0.5 - GRIP_Y);
  const back = -TILE_T / 2;
  const front = TILE_T / 2;
  // 手掌：手背朝上，压在牌顶上方，往人那边（+z）多出一截接手腕
  const palmGeo = new RoundedBoxGeometry(1.75, 0.62, 1.55, 3, 0.26);
  parts.geos.push(palmGeo);
  const palm = new THREE.Mesh(palmGeo, skin);
  const palmEdge = new THREE.Mesh(palmGeo, line);
  for (const m of [palm, palmEdge]) {
    m.position.set(0.08, top + 0.42, 0.28);
    m.rotation.x = 0.18;
    g.add(m);
  }
  palm.castShadow = true;
  // 四根手指从手掌靠牌背那一边伸出去，翻过牌顶、扣在牌背上：食指在左（靠大拇指）、小指在右
  const fingers: [number, number, number][] = [
    [-0.56, 1, 1],
    [-0.18, 1.08, 1],
    [0.2, 1.02, 0.96],
    [0.55, 0.86, 0.88],
  ];
  for (const [x, len, thick] of fingers) {
    const r = 0.19 * thick;
    const k0 = V(x, top + 0.34, back - 0.02);
    const k1 = k0.clone().add(V(0, -0.08, -0.32 * len));
    const k2 = k1.clone().add(V(0, -0.42 * len, -0.04));
    const k3 = k2.clone().add(V(0, -0.3 * len, 0.16));
    capsule(parts, skin, lineThin, k0, k1, r, g);
    capsule(parts, skin, lineThin, k1, k2, r * 0.94, g);
    capsule(parts, skin, lineThin, k2, k3, r * 0.88, g);
  }
  // 大拇指：从手掌左前方（靠人那边）弯下来，指肚压在牌面左上角
  const t0 = V(-0.78, top + 0.32, 0.62);
  const t1 = V(-0.62, top - 0.02, front + 0.32);
  const t2 = V(-0.42, top - 0.24, front + 0.17);
  capsule(parts, skin, line, t0, t1, 0.21, g);
  capsule(parts, skin, lineThin, t1, t2, 0.18, g);
  // 手腕、前臂：往人那边、往上伸。袖口一圈深色，再往后是袖子。前臂单独一组，绕手腕转（牌仰起来亮给镜头时手腕弯，前臂还是从人那边伸过来）
  const fore = new THREE.Group();
  fore.position.set(0.12, top + 0.46, 1.0);
  g.add(fore);
  const dir = V(0.12, 0.62, 1).normalize();
  const at = (d: number) => dir.clone().multiplyScalar(d);
  tube(parts, skin, line, at(0), at(2.2), 0.4, 0.5, fore);
  tube(parts, cuff, line, at(2.05), at(2.5), 0.62, 0.64, fore, true);
  tube(parts, sleeve, line, at(2.45), at(9), 0.66, 0.8, fore, true);
  g.userData.parts = parts;
  g.userData.fore = fore;
  return g;
}

function disposeArm(g: THREE.Group): void {
  const parts = g.userData.parts as ArmParts | undefined;
  if (!parts) return;
  for (const m of parts.mats) m.dispose();
  for (const geo of parts.geos) geo.dispose();
}

// ---------- 砸牌 ----------

export class TileSlam {
  readonly group = new THREE.Group();
  private list: Active[] = [];

  // 开始砸一张牌，返回什么时候砸到、什么时候做完
  start(spec: SlamSpec, now: number): SlamRun {
    this.cancel(spec.tile);
    const timing = { ...SLAM_TIMING, ...spec.timing };
    const s = spec.to.scale;
    const up = new THREE.Vector3(0, 1, 0);
    const grip = (p: SlamPose) => p.pos.clone().add(new THREE.Vector3(0, TILE_H * GRIP_Y * p.scale, 0).applyQuaternion(p.quat));
    const grabTo = grip(spec.to);
    // 举到牌落点的上方、往人那边一点（手从人那边伸过来）
    const apex = grabTo.clone().addScaledVector(up, (spec.lift ?? 3.2) * s).addScaledVector(spec.out, 0.9 * s);
    // 画面外：往人那边、往右、往上
    const enter = grabTo.clone().addScaledVector(spec.out, 9 * s).addScaledVector(spec.side, 2.5 * s).addScaledVector(up, 5.5 * s);
    let arm: THREE.Group | null = null;
    if (spec.arm !== null) {
      arm = buildArm(spec.arm ?? {});
      arm.scale.setScalar(s * HAND_SCALE);
      arm.visible = false;
      this.group.add(arm);
    }
    const a: Active = { spec, timing, t0: now, arm, hit: false, done: false, enter, apex, grabFrom: spec.from ? grip(spec.from) : null, grabTo };
    this.list.push(a);
    const hitAt = now + this.hitOffset(a);
    this.pose(a, now);
    return { hitAt, doneAt: hitAt + timing.hold + timing.back };
  }

  // 这张牌正在被砸（手里拿着或者刚砸完、手还没收回）
  holds(tile: THREE.Object3D): boolean {
    return this.list.some((a) => a.spec.tile === tile && !a.hit);
  }

  get busy(): boolean {
    return this.list.length > 0;
  }

  // 收掉这张牌的砸牌（没砸到的直接放到落点，不回调）
  cancel(tile: THREE.Object3D): void {
    for (const a of this.list.filter((x) => x.spec.tile === tile)) this.finish(a, false);
  }

  clear(): void {
    for (const a of [...this.list]) this.finish(a, false);
  }

  update(now: number): void {
    for (const a of [...this.list]) this.pose(a, now);
  }

  private hitOffset(a: Active): number {
    const t = a.timing;
    return (a.grabFrom ? t.reach + t.lift : t.reach) + t.hang + t.drop;
  }

  private finish(a: Active, callback: boolean): void {
    this.list = this.list.filter((x) => x !== a);
    const { tile, to } = a.spec;
    if (!a.hit) {
      tile.position.copy(to.pos);
      tile.quaternion.copy(to.quat);
      tile.scale.setScalar(to.scale);
    }
    if (a.arm) {
      this.group.remove(a.arm);
      disposeArm(a.arm);
    }
    if (callback) a.spec.onDone?.();
  }

  // 这一刻手捏住的点在哪、手转成什么样（相对落地时的样子，绕这一家的右手方向转：正数是牌顶往人那边倒，
// 负数是牌顶往桌子中间倒、牌面朝上——举着的时候亮给镜头看摸到了什么）
  private pose(a: Active, now: number): void {
    const { spec, timing: t } = a;
    const k = now - a.t0;
    const s = spec.to.scale;
    const hitT = this.hitOffset(a);
    const up = new THREE.Vector3(0, 1, 0);
    let grip: THREE.Vector3;
    let tilt = 0;
    let holding = true; // 牌还在手里
    let quatFrom: THREE.Quaternion | null = null; // 还在原处捏住、还没转到落地的朝向
    let quatK = 1;
    let scale = s;
    const cocked = a.apex.clone().addScaledVector(spec.out, 0.35 * s).addScaledVector(up, 0.25 * s);
    if (a.grabFrom && k < t.reach) {
      // 手伸过去，牌还在原处
      const f = easeInOut(clamp01(k / t.reach));
      const hand = a.enter.clone().lerp(a.grabFrom, f);
      hand.y += Math.sin(Math.PI * f) * 1.2 * s;
      this.place(a, hand, tilt * (1 - f), spec.from!.quat, 0);
      if (a.arm) a.arm.visible = true;
      a.spec.tile.position.copy(spec.from!.pos);
      a.spec.tile.quaternion.copy(spec.from!.quat);
      a.spec.tile.scale.setScalar(spec.from!.scale);
      return;
    }
    const lift0 = a.grabFrom ? t.reach : 0;
    const liftT = a.grabFrom ? t.lift : t.reach;
    if (k < lift0 + liftT) {
      // 举起来（carried：带着牌从画面外伸进来，直接到最高处）
      const f = easeOut(clamp01((k - lift0) / liftT));
      const from = a.grabFrom ?? a.enter;
      grip = from.clone().lerp(a.apex, f);
      grip.y += Math.sin(Math.PI * f) * 0.5 * s;
      tilt = SHOW * f;
      if (a.grabFrom) {
        quatFrom = spec.from!.quat;
        quatK = f;
        scale = THREE.MathUtils.lerp(spec.from!.scale, s, f);
      }
    } else if (k < lift0 + liftT + t.hang) {
      // 最高处亮一下牌，再往后上方带一点：蓄力
      const f = easeOut(clamp01((k - lift0 - liftT) / t.hang));
      grip = a.apex.clone().lerp(cocked, f);
      tilt = SHOW + 0.15 * f;
    } else if (k < hitT) {
      // 拍下去：越来越快，牌立起来，正好竖着落地
      const f = clamp01((k - lift0 - liftT - t.hang) / t.drop) ** 2;
      grip = cocked.clone().lerp(a.grabTo, f);
      tilt = (SHOW + 0.15) * (1 - f) ** 1.5;
    } else {
      if (!a.hit) {
        a.hit = true;
        spec.tile.position.copy(spec.to.pos);
        spec.tile.quaternion.copy(spec.to.quat);
        spec.tile.scale.setScalar(s);
        spec.onHit?.(spec.to.pos.clone().addScaledVector(up, -(TILE_H / 2) * s));
      }
      holding = false;
      const h = k - hitT;
      if (h < t.hold) {
        // 按住：手往下压一点再弹回来
        const f = h / t.hold;
        grip = a.grabTo.clone().addScaledVector(up, -0.06 * s * Math.sin(Math.PI * f));
      } else if (h < t.hold + t.back) {
        // 松手往回收：先往上抬、再往人那边退出画面
        const f = easeInOut(clamp01((h - t.hold) / t.back));
        grip = a.grabTo.clone().lerp(a.enter, f);
        grip.addScaledVector(up, Math.sin(Math.PI * Math.min(1, f * 1.4)) * 1.2 * s);
        tilt = -0.25 * f;
      } else {
        this.finish(a, true);
        return;
      }
    }
    const q = this.place(a, grip, tilt, quatFrom, quatK);
    if (a.arm) a.arm.visible = true;
    if (!holding) return;
    // 牌跟着手：捏住的点往下 GRIP_Y 个牌高是牌中心
    spec.tile.quaternion.copy(q);
    spec.tile.scale.setScalar(scale);
    spec.tile.position.copy(grip).add(new THREE.Vector3(0, -TILE_H * GRIP_Y * scale, 0).applyQuaternion(q));
  }

  // 把手摆到 grip，朝向是落地时牌的朝向再绕右手方向转 tilt；quatFrom 不是 null 时从它转过来（k 是转了多少）
  private place(a: Active, grip: THREE.Vector3, tilt: number, quatFrom: THREE.Quaternion | null, k: number): THREE.Quaternion {
    const { spec } = a;
    const q = new THREE.Quaternion().setFromAxisAngle(spec.side, tilt).multiply(spec.to.quat);
    if (quatFrom) q.copy(quatFrom.clone().slerp(q, k));
    if (a.arm) {
      a.arm.position.copy(grip);
      a.arm.quaternion.copy(q);
      // 手腕弯回来大半：前臂差不多还是落地时的方向
      const fore = a.arm.userData.fore as THREE.Object3D | undefined;
      if (fore) fore.rotation.x = -tilt * WRIST_BEND;
    }
    return q;
  }
}

