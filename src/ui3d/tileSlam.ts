import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FlickMotion } from './slamFlick';
import { HAND_SCALE, SlamMotion, SlamStyle, V } from './slamMath';
import { SlapMotion, SlapOrder } from './slamSlap';

export type { SlamStyle } from './slamMath';

// 自摸拍牌。每个角色用哪一套动作（style）在 looks.ts 里配，不配就是通用的 press（slamSlap.ts：夹着牌斜着举起来，牌面朝上拍在桌上）；
// 竹井久配的是 hisa（slamFlick.ts）。两套都是“自己算好整段”的动作（SlamMotion），这里照着摆手和牌、到点回调。
//
// 牌桌（table3d.ts）给出牌从哪拿、落在哪、这一家的朝向、镜头，
// 扣到桌上 onPress、开始亮 onCharge、炸开 onHit 各回调一次；冲击波、旋风、震屏、音效、角色特效（咲的百合、衣的水……）都在回调里放。
// 一次可以砸好几张（不同的人），每张一只手。手是卡通渲染：三阶明暗加一圈细描边，皮肤、指甲、袖子的颜色可以换；手不投影子。
//
// 坐标：手的“手里坐标”原点在手掌中心，+y 是手指方向，+z 是手背那面，右手，大拇指在 -x。
// 牌的“手里坐标”是立着放的牌（牌面朝 +z，牌顶 +y）。

export interface SlamPose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

// 手的颜色：皮肤、指甲、描边；袖子、袖口不给（null）就是光着的手臂
export interface ArmLook {
  skin: THREE.ColorRepresentation;
  nail: THREE.ColorRepresentation;
  line: THREE.ColorRepresentation;
  sleeve: THREE.ColorRepresentation | null;
  cuff: THREE.ColorRepresentation | null;
}

export const DEFAULT_ARM: ArmLook = { skin: '#f4c3b6', nail: '#ffe9e4', line: '#c5847c', sleeve: null, cuff: null };

// 镜头（自己砸牌时手从镜头跟前伸上来）
export interface SlamView {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  fov: number; // 竖直视野（度）
  aspect: number;
}

export interface SlamSpec {
  tile: THREE.Object3D; // 要砸的那张牌（牌的整组）
  style?: SlamStyle; // 哪一套动作，不给是 press
  to: SlamPose; // 最后牌面朝上躺在桌上的样子
  from?: SlamPose; // 牌现在在哪：手先伸过去拿起来。不给就是牌一开始就在手里，跟着手从画面外伸上来（press 自己拍牌时）
  order?: SlapOrder; // press：手牌什么时候倒（先倒、举牌时倒、拍下去时倒），不给是先倒
  side: THREE.Vector3; // 砸牌那一家的右手方向（世界坐标，水平）
  out: THREE.Vector3; // 那一家往外（朝她自己身体）的方向（世界坐标，水平）
  view?: SlamView; // 给了就是自己砸牌（镜头在她身后）
  cam?: SlamView; // 牌桌的镜头（不管是谁砸）：hisa 用它把弹到最高处的牌挪进画面
  arm?: Partial<ArmLook> | null; // null：不带手，牌从原处（from，不给就是落点）自己跳起来再拍下去
  onPress?: (at: THREE.Vector3) => void; // 牌落到桌上那一刻（press 就是拍下去那一下，hisa 是翻过来落到桌上），at 是牌底下的桌面点
  onCharge?: (at: THREE.Vector3, dur: number) => void; // 开始亮光（hisa 弹到最高处；press 没有），at 是牌中心，dur 是亮多久就炸开
  onHit?: (at: THREE.Vector3) => void; // 炸开那一刻，at 是牌底下的桌面点
  onDone?: () => void; // 炸完、手也撤走以后
}

// start 返回这一下什么时候扣到桌上、什么时候炸开、什么时候整段做完（和 now 同一个时钟）
export interface SlamRun {
  pressAt: number;
  revealAt?: number; // 这一套里手牌该倒下的时刻（不给就照 pressAt）
  hitAt: number;
  doneAt: number;
}

// 自己算好整段的动作（SlamMotion，比如竹井久的 FlickMotion）
interface MotionActive {
  kind: 'motion';
  spec: SlamSpec;
  t0: number;
  arm: THREE.Group | null;
  motion: SlamMotion;
  pressed: boolean;
  charged: boolean;
  hit: boolean;
  shadows: THREE.Mesh[]; // 一直关到砸下去
}

// ---------- 手的模型 ----------

let gradient: THREE.DataTexture | null = null;
// 三阶明暗（卡通渲染），暗部不太暗：皮肤看着软
function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([176, 176, 176, 255, 222, 222, 222, 255, 255, 255, 255, 255]);
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
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
}

// 一节手指：从 a 到 b，两头圆的（胶囊）
function capsule(parts: ArmParts, mat: THREE.Material, line: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number, parent: THREE.Object3D): void {
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, a.distanceTo(b)), 6, 14);
  parts.geos.push(geo);
  for (const mat0 of [mat, line]) {
    const m = new THREE.Mesh(geo, mat0);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    parent.add(m);
  }
}

// 一节锥形的筒（手腕、前臂、袖子）：a 那头半径 ra，b 那头半径 rb
function tube(parts: ArmParts, mat: THREE.Material, line: THREE.Material | null, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, parent: THREE.Object3D, open = false): void {
  const geo = new THREE.CylinderGeometry(rb, ra, a.distanceTo(b), 20, 1, open);
  parts.geos.push(geo);
  const meshes = [new THREE.Mesh(geo, mat), ...(line ? [new THREE.Mesh(geo, line)] : [])];
  for (const m of meshes) {
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    parent.add(m);
  }
}

// 指甲：贴在最后一节手背那面的扁椭球
function nail(parts: ArmParts, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, back: THREE.Vector3, r: number, parent: THREE.Object3D): void {
  const geo = new THREE.SphereGeometry(1, 12, 8);
  parts.geos.push(geo);
  const m = new THREE.Mesh(geo, mat);
  const dir = b.clone().sub(a).normalize();
  const n = back.clone().addScaledVector(dir, -back.dot(dir)).normalize();
  m.position.copy(a).lerp(b, 0.62).addScaledVector(n, r * 0.78);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(dir, n), dir, n));
  m.scale.set(r * 0.72, a.distanceTo(b) * 0.5 + r * 0.25, r * 0.28);
  parent.add(m);
}

// 一根手指：根部 base，长 len，粗 r；spread 往大拇指那边张开多少，curl 三个关节各往手心弯多少（弧度）
function finger(parts: ArmParts, skin: THREE.Material, line: THREE.Material, nailMat: THREE.Material, base: THREE.Vector3, len: number, r: number, spread: number, curl: [number, number, number], parent: THREE.Object3D): void {
  const segs = [0.46, 0.3, 0.24];
  let p = base.clone();
  let bend = 0;
  for (let i = 0; i < 3; i++) {
    bend += curl[i];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-bend, 0, spread, 'ZXY'));
    const dir = V(0, 1, 0).applyQuaternion(q);
    const next = p.clone().addScaledVector(dir, len * segs[i]);
    const ri = r * [1, 0.93, 0.86][i];
    capsule(parts, skin, line, p, next, ri, parent);
    if (i === 2) nail(parts, nailMat, p, next, V(0, 0, 1).applyQuaternion(q), ri, parent);
    p = next;
  }
}

// 右手，手背朝 +z、手指朝 +y，原点在手掌中心，单位是牌宽
export function buildArm(look: Partial<ArmLook> = {}): THREE.Group {
  const lk = { ...DEFAULT_ARM, ...look };
  const parts: ArmParts = { mats: [], geos: [] };
  const toon = (c: THREE.ColorRepresentation) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient() });
  const skin = toon(lk.skin);
  const nailMat = toon(lk.nail);
  const line = outlineMat(lk.line, 0.03);
  parts.mats.push(skin, nailMat, line);
  const g = new THREE.Group();
  // 手掌：扁的圆角块，往手腕那头收窄，手背拱一点
  const palmGeo = new RoundedBoxGeometry(2.3, 2.7, 0.62, 4, 0.3);
  const pos = palmGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = (y + 1.35) / 2.7;
    pos.setX(i, x * (0.8 + 0.2 * t));
    if (z > 0) pos.setZ(i, z + 0.1 * Math.max(0, 1 - (x / 1.15) ** 2));
  }
  palmGeo.computeVertexNormals();
  parts.geos.push(palmGeo);
  for (const mat of [skin, line]) {
    g.add(new THREE.Mesh(palmGeo, mat));
  }
  // 四根手指：食指（靠大拇指）到小指；食指、中指的指肚压着牌，弯得多一点
  finger(parts, skin, line, nailMat, V(-0.8, 1.2, 0.02), 2.45, 0.25, 0.1, [0.12, 0.2, 0.18], g);
  finger(parts, skin, line, nailMat, V(-0.27, 1.32, 0.04), 2.72, 0.26, 0.02, [0.12, 0.2, 0.18], g);
  finger(parts, skin, line, nailMat, V(0.27, 1.24, 0.02), 2.52, 0.24, -0.07, [0.1, 0.14, 0.12], g);
  finger(parts, skin, line, nailMat, V(0.75, 1.06, -0.02), 1.98, 0.21, -0.18, [0.1, 0.14, 0.12], g);
  // 大拇指：从手掌靠下那边伸出去，往上、往手心那边弯
  const t0 = V(-0.82, -0.6, -0.12);
  const t1 = t0.clone().add(V(-0.62, 0.52, -0.3));
  const t2 = t1.clone().add(V(-0.3, 0.68, -0.22));
  const t3 = t2.clone().add(V(-0.1, 0.6, -0.14));
  capsule(parts, skin, line, t0, t1, 0.36, g);
  capsule(parts, skin, line, t1, t2, 0.29, g);
  capsule(parts, skin, line, t2, t3, 0.26, g);
  nail(parts, nailMat, t2, t3, V(-0.55, 0, 0.83), 0.26, g);
  // 手腕、前臂：往手指的反方向伸出去，往手背那边带一点（扁一点：宽比厚多）
  const fore = new THREE.Group();
  fore.scale.set(1.25, 1, 0.82);
  g.add(fore);
  tube(parts, skin, line, V(0.04, -1.0, 0), V(0.06, -3.2, 0.12), 0.56, 0.6, fore);
  tube(parts, skin, line, V(0.06, -3.1, 0.12), V(0.12, -11, 0.7), 0.6, 0.86, fore);
  if (lk.sleeve !== null) {
    const sleeve = toon(lk.sleeve);
    parts.mats.push(sleeve);
    if (lk.cuff !== null) {
      const cuff = toon(lk.cuff);
      parts.mats.push(cuff);
      tube(parts, cuff, line, V(0.08, -5.2, 0.32), V(0.09, -5.8, 0.36), 0.95, 0.98, fore, true);
    }
    tube(parts, sleeve, line, V(0.09, -5.7, 0.35), V(0.15, -14, 0.9), 1.02, 1.3, fore, true);
  }
  g.userData.parts = parts;
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
  private list: MotionActive[] = [];

  // 开始砸一张牌，返回什么时候扣到桌上、什么时候炸开、什么时候做完。
  // at 给了就是到那时才动手：在那之前牌原样不动（算这张牌被拿着，别处别挪它），手也不出来
  start(spec: SlamSpec, now: number, at = now): SlamRun {
    this.cancel(spec.tile);
    const hand = spec.arm !== null;
    const motion: SlamMotion =
      spec.style === 'hisa'
        ? new FlickMotion({ to: spec.to, from: spec.from, side: spec.side, out: spec.out, cam: spec.cam, near: !!spec.view, hand })
        : new SlapMotion({ to: spec.to, from: spec.from, side: spec.side, out: spec.out, cam: spec.cam, near: !!spec.view, hand, order: spec.order });
    const m: MotionActive = { kind: 'motion', spec, t0: at, arm: this.newArm(spec, motion.handScale), motion, pressed: false, charged: false, hit: false, shadows: this.shadowsOff(spec.tile) };
    this.list.push(m);
    this.poseMotion(m, now);
    return { pressAt: at + motion.pressAt, revealAt: at + (motion.revealAt ?? motion.pressAt), hitAt: at + motion.hitAt, doneAt: at + motion.doneAt };
  }

  // 这一下的手（不带手是 null）：大小照着牌落地时的大小，先藏着
  private newArm(spec: SlamSpec, scale = HAND_SCALE): THREE.Group | null {
    if (spec.arm === null) return null;
    const arm = buildArm(spec.arm ?? {});
    arm.scale.setScalar(spec.to.scale * scale);
    arm.visible = false;
    this.group.add(arm);
    return arm;
  }

  // 牌在半空时关掉影子，记下关了哪些
  private shadowsOff(tile: THREE.Object3D): THREE.Mesh[] {
    const shadows: THREE.Mesh[] = [];
    tile.traverse((o) => {
      if (o instanceof THREE.Mesh && o.castShadow) {
        o.castShadow = false;
        shadows.push(o);
      }
    });
    return shadows;
  }

  // 这张牌正在被砸（还没炸开）
  holds(tile: THREE.Object3D): boolean {
    return this.list.some((a) => a.spec.tile === tile && !a.hit);
  }

  get busy(): boolean {
    return this.list.length > 0;
  }

  // 收掉这张牌的砸牌（没炸开的直接放到落点，不回调）
  cancel(tile: THREE.Object3D): void {
    for (const a of this.list.filter((x) => x.spec.tile === tile)) this.finish(a, false);
  }

  clear(): void {
    for (const a of [...this.list]) this.finish(a, false);
  }

  update(now: number): void {
    for (const a of [...this.list]) this.poseMotion(a, now);
  }

  // 自己算好整段的动作：照 motion 摆手和牌，到点回调
  private poseMotion(a: MotionActive, now: number): void {
    const { spec, motion: m } = a;
    const k = now - a.t0;
    if (k < 0) {
      if (a.arm) a.arm.visible = false;
      return;
    }
    const fr = m.frame(k);
    if (a.arm) {
      a.arm.visible = fr.hand !== null;
      if (fr.hand) {
        a.arm.position.copy(fr.hand.pos);
        a.arm.quaternion.copy(fr.hand.quat);
      }
    }
    if (!a.hit) this.setTile(a, fr.tile.pos, fr.tile.quat, fr.tile.scale);
    if (!a.pressed && k >= m.pressAt) {
      a.pressed = true;
      spec.onPress?.(m.pressPoint.clone());
    }
    if (!a.charged && k >= m.chargeAt) {
      a.charged = true;
      // 没有聚光的（press）不叫
      if (m.chargeDur > 0) spec.onCharge?.(m.chargePoint.clone(), m.chargeDur);
    }
    if (!a.hit && k >= m.hitAt) {
      a.hit = true;
      this.shadowsOn(a);
      this.setTile(a, spec.to.pos, spec.to.quat, spec.to.scale);
      spec.onHit?.(m.hitPoint.clone());
    }
    if (a.hit && k >= m.doneAt) this.finish(a, true);
  }

  private finish(a: MotionActive, callback: boolean): void {
    this.list = this.list.filter((x) => x !== a);
    this.shadowsOn(a);
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

  private shadowsOn(a: MotionActive): void {
    for (const m of a.shadows) m.castShadow = true;
    a.shadows = [];
  }

  private setTile(a: MotionActive, pos: THREE.Vector3, quat: THREE.Quaternion, scale: number): void {
    const t = a.spec.tile;
    t.position.copy(pos);
    t.quaternion.copy(quat);
    t.scale.setScalar(scale);
  }
}
