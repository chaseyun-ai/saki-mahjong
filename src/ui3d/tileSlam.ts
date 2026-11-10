import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TILE_H, TILE_T } from './tableLayout';
import { FlickMotion } from './slamFlick';
import { HAND_SCALE, Key, SlamMotion, SlamStyle, V, basis, bezier, clamp01, easeInOut, easeOut, smooth } from './slamMath';

export type { SlamStyle } from './slamMath';

// 自摸砸牌。每个角色用哪一套动作（style）在 looks.ts 里配，不配就是通用的 press；竹井久配的是 hisa（slamFlick.ts）：
//   press（通用，照雀魂的节奏，画面和动作都是自己做的）：一只修长的手（手背朝着看的人）从这一家身前伸上来，食指、中指的指尖压着那张牌（牌背贴着指肚），举高停一下，
// 往前一扫，把牌扣在桌上（牌面朝下）；手撤走，牌自己翻起来立住，亮一下光，再“砰”地炸开。
// 自己自摸时手是从镜头跟前（画面左下）伸上来的，离镜头近，所以很大；扫下去的时候越来越远、越来越小。
//
// 这里只管手和牌怎么动：牌桌（table3d.ts）给出牌从哪拿、立在哪、这一家的朝向、镜头，
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

// 一下砸牌的节奏（秒）：reach 手伸过去拿牌（只有给了 from 才有）、rise 举起来（自己的是从画面外带着牌伸上来）、
// show 举在高处停一下、sweep 往前扫下去把牌扣在桌上、flat 牌扣着停一下、flip 翻起来立住、charge 立着亮光，然后炸开；
// leave 扣下去以后手撤出画面要多久（和 flat、flip 同时走）
export interface SlamTiming {
  reach: number;
  rise: number;
  show: number;
  sweep: number;
  flat: number;
  flip: number;
  charge: number;
  leave: number;
}

export const SLAM_TIMING: SlamTiming = { reach: 0.26, rise: 0.24, show: 0.12, sweep: 0.2, flat: 0.14, flip: 0.12, charge: 0.2, leave: 0.26 };

// 通用那一套（press）从开始到牌扣到桌上、到炸开各要多久（carried：牌一开始就在手里，没有 reach）。
// 竹井久那一套（hisa）照牌山远近定节奏，start 的时候才知道
export function slamPressOffset(carried: boolean, timing: Partial<SlamTiming> = {}): number {
  const t = { ...SLAM_TIMING, ...timing };
  return (carried ? 0 : t.reach) + t.rise + t.show + t.sweep;
}

export function slamHitOffset(carried: boolean, timing: Partial<SlamTiming> = {}): number {
  const t = { ...SLAM_TIMING, ...timing };
  return slamPressOffset(carried, t) + t.flat + t.flip + t.charge;
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
  to: SlamPose; // 最后的样子：press 是立在桌上，hisa 是牌面朝上躺在桌上
  from?: SlamPose; // 牌现在在哪：手先伸过去拿起来。不给（carried）就是牌一开始就在手里，跟着手从画面外伸上来。hisa 是牌山上摸的那张
  side: THREE.Vector3; // 砸牌那一家的右手方向（世界坐标，水平）
  out: THREE.Vector3; // 那一家往外（朝她自己身体）的方向（世界坐标，水平）
  view?: SlamView; // 给了就是第一人称：手在这个镜头跟前举起来（自己砸牌）
  cam?: SlamView; // 牌桌的镜头（不管是谁砸）：hisa 用它把弹到最高处的牌挪进画面
  timing?: Partial<SlamTiming>;
  arm?: Partial<ArmLook> | null; // null：不带手，牌从原处（from，不给就是落点）自己跳起来、转一圈亮出牌背，再扣下去
  onPress?: (at: THREE.Vector3) => void; // 牌扣到桌上那一刻（hisa 是翻过来落到桌上），at 是牌底下的桌面点
  onCharge?: (at: THREE.Vector3, dur: number) => void; // 开始亮光（press 是牌立好，hisa 是弹到最高处），at 是牌中心，dur 是亮多久就炸开
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

interface Active {
  kind: 'press';
  spec: SlamSpec;
  timing: SlamTiming;
  t0: number;
  arm: THREE.Group | null;
  s: number; // 手和牌的大小（牌落地时的 scale）
  enter: Key; // 手从哪伸进来
  grab: Key | null; // 伸过去拿牌的样子（给了 from 才有）
  raise: Key; // 举在高处
  press: Key; // 把牌扣在桌上
  leave: Key; // 撤到哪
  flat: SlamPose; // 牌扣在桌上（牌面朝下）
  hop: { from: SlamPose; apex: Key } | null; // 不带手：牌从哪跳起来、跳到哪
  pressed: boolean;
  charged: boolean;
  hit: boolean;
  shadows: THREE.Mesh[]; // 牌在半空时关掉影子（离桌面远，影子落在桌子中间很怪），扣到桌上再打开
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

// 牌在手里的位置（手里坐标，单位是牌宽）：食指、中指指肚底下，牌背贴着指肚，牌顶朝手腕，牌的下半截露在指尖外面
const TILE_IN_HAND = V(-0.6, 3.5, -1.12);
const TILE_IN_HAND_Q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI - 0.4);
// 自己砸牌时手举在镜头前多远（牌的 scale 倍，单位牌宽）、画面上哪里（-1..1，手掌中心）
const NEAR_DIST = 17;
const NEAR_X = -0.45;
const NEAR_Y = -0.55;
// 扣牌时手指往下压多少（弧度）：手差不多平着，指尖弯下去压住牌，从上往下看手指最长
const PRESS_PITCH = 0.08;

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
  private list: (Active | MotionActive)[] = [];

  // 开始砸一张牌，返回什么时候扣到桌上、什么时候炸开、什么时候做完。
  // at 给了（hisa）就是到那时才动手：在那之前牌原样不动（算这张牌被拿着，别处别挪它），手也不出来
  start(spec: SlamSpec, now: number, at = now): SlamRun {
    this.cancel(spec.tile);
    if (spec.style === 'hisa') {
      const motion = new FlickMotion({ to: spec.to, from: spec.from, side: spec.side, out: spec.out, cam: spec.cam, near: !!spec.view, hand: spec.arm !== null });
      const m: MotionActive = { kind: 'motion', spec, t0: at, arm: this.newArm(spec, motion.handScale), motion, pressed: false, charged: false, hit: false, shadows: this.shadowsOff(spec.tile) };
      this.list.push(m);
      this.poseMotion(m, now);
      return { pressAt: at + motion.pressAt, revealAt: at + (motion.revealAt ?? motion.pressAt), hitAt: at + motion.hitAt, doneAt: at + motion.doneAt };
    }
    const timing = { ...SLAM_TIMING, ...spec.timing };
    const s = spec.to.scale;
    const up = V(0, 1, 0);
    const { side, out } = spec;
    // 扣在桌上：牌面朝下、牌顶朝人，扣在立牌的地方（往桌子中间挪一点，手不会全出画面）；翻起来时跳一下立回去
    const flatQ = spec.to.quat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2));
    const flatPos = spec.to.pos.clone().addScaledVector(out, -0.3 * s).setY(spec.to.pos.y + (TILE_T / 2 - TILE_H / 2) * s);
    const flat: SlamPose = { pos: flatPos, quat: flatQ, scale: s };
    // 扣牌时手：手指朝前（离开自己）往下压、往右偏一点，手背朝上；牌在指尖底下
    const fwd = out.clone().negate();
    const pressF = fwd.clone().multiplyScalar(Math.cos(0.22)).addScaledVector(side, Math.sin(0.22)).multiplyScalar(Math.cos(PRESS_PITCH)).addScaledVector(up, -Math.sin(PRESS_PITCH));
    const pressQ = basis(pressF, up);
    const attach = (q: THREE.Quaternion) => TILE_IN_HAND.clone().multiplyScalar(s * HAND_SCALE).applyQuaternion(q);
    const press: Key = { pos: flatPos.clone().sub(attach(pressQ)).addScaledVector(up, 0.05 * s), quat: pressQ };
    let raise: Key;
    let enter: Key;
    let leave: Key;
    const v = spec.view;
    if (v) {
      // 第一人称：手在镜头跟前、画面左下举着，手背朝镜头，手指朝画面上方、往右斜一点
      const right = V(1, 0, 0).applyQuaternion(v.quat);
      const camUp = V(0, 1, 0).applyQuaternion(v.quat);
      const ahead = V(0, 0, -1).applyQuaternion(v.quat);
      const tan = Math.tan(THREE.MathUtils.degToRad(v.fov / 2));
      const at = (nx: number, ny: number, d: number) =>
        v.pos
          .clone()
          .addScaledVector(ahead, d)
          .addScaledVector(right, nx * d * tan * v.aspect)
          .addScaledVector(camUp, ny * d * tan);
      const d = NEAR_DIST * s;
      const q = basis(camUp.clone().addScaledVector(right, 0.2).addScaledVector(ahead, 0.3), ahead.clone().negate());
      raise = { pos: at(NEAR_X, NEAR_Y, d), quat: q };
      enter = { pos: at(NEAR_X - 0.1, NEAR_Y - 2.3, d * 0.9), quat: basis(camUp.clone().addScaledVector(ahead, 0.15), ahead.clone().negate()) };
      leave = { pos: at(0.45, -2.4, d * 0.8), quat: q.clone().slerp(pressQ, 0.4) };
    } else {
      // 别家：手在她身前举高，手背朝她自己，手指朝上、往桌子中间斜一点
      const q = basis(up.clone().addScaledVector(fwd, 0.3), out);
      raise = { pos: spec.to.pos.clone().addScaledVector(out, 2.4 * s).addScaledVector(up, 4.4 * s).addScaledVector(side, -0.4 * s), quat: q };
      enter = { pos: spec.to.pos.clone().addScaledVector(out, 8 * s).addScaledVector(up, 2.5 * s), quat: basis(up.clone().addScaledVector(fwd, 0.6), out) };
      leave = { pos: enter.pos.clone(), quat: enter.quat.clone() };
    }
    let grab: Key | null = null;
    const noHand = spec.arm === null;
    // 不带手：从原处跳到扣牌处的上方、往人那边一点，牌背朝上、往人那边仰（看得见牌背）
    const hop = noHand
      ? {
          from: spec.from ?? spec.to,
          apex: { pos: flatPos.clone().addScaledVector(up, 3.4 * s).addScaledVector(out, 0.8 * s), quat: new THREE.Quaternion().setFromAxisAngle(side, 0.6).multiply(flatQ) },
        }
      : null;
    if (spec.from && !noHand) {
      const gq = basis(fwd.clone().addScaledVector(up, -0.5), up);
      grab = { pos: spec.from.pos.clone().sub(attach(gq)).addScaledVector(up, 0.1 * s), quat: gq };
    }
    const arm = this.newArm(spec);
    const shadows = this.shadowsOff(spec.tile);
    const a: Active = { kind: 'press', spec, timing, t0: now, arm, s, enter, grab, raise, press, leave, flat, hop, pressed: false, charged: false, hit: false, shadows };
    this.list.push(a);
    this.pose(a, now);
    const carried = !spec.from || noHand;
    const pressAt = now + slamPressOffset(carried, timing);
    const hitAt = now + slamHitOffset(carried, timing);
    return { pressAt, hitAt, doneAt: noHand ? hitAt : Math.max(hitAt, pressAt + timing.leave) };
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
    for (const a of [...this.list]) {
      if (a.kind === 'motion') this.poseMotion(a, now);
      else this.pose(a, now);
    }
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
      spec.onCharge?.(m.chargePoint.clone(), m.chargeDur);
    }
    if (!a.hit && k >= m.hitAt) {
      a.hit = true;
      this.shadowsOn(a);
      this.setTile(a, spec.to.pos, spec.to.quat, spec.to.scale);
      spec.onHit?.(m.hitPoint.clone());
    }
    if (a.hit && k >= m.doneAt) this.finish(a, true);
  }

  private finish(a: Active | MotionActive, callback: boolean): void {
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

  private shadowsOn(a: Active | MotionActive): void {
    for (const m of a.shadows) m.castShadow = true;
    a.shadows = [];
  }

  private setTile(a: Active | MotionActive, pos: THREE.Vector3, quat: THREE.Quaternion, scale: number): void {
    const t = a.spec.tile;
    t.position.copy(pos);
    t.quaternion.copy(quat);
    t.scale.setScalar(scale);
  }

  // 牌跟着手：在手里坐标的 TILE_IN_HAND
  private attached(a: Active, hand: Key): SlamPose {
    return {
      pos: hand.pos.clone().add(TILE_IN_HAND.clone().multiplyScalar(a.s * HAND_SCALE).applyQuaternion(hand.quat)),
      quat: hand.quat.clone().multiply(TILE_IN_HAND_Q),
      scale: a.s,
    };
  }

  // 不带手：跳起来（一边转一圈一边仰成牌背朝上），在高处往后一仰蓄力，再扣下去
  private hopTile(a: Active, k: number, hop: NonNullable<Active['hop']>): void {
    const { spec, timing: t, s } = a;
    const up = V(0, 1, 0);
    const show = (f: number): Key => ({
      pos: hop.apex.pos.clone().addScaledVector(up, 0.25 * s * f),
      quat: new THREE.Quaternion().setFromAxisAngle(spec.side, 0.15 * f).multiply(hop.apex.quat),
    });
    if (k < t.rise) {
      const f = clamp01(k / t.rise);
      const e = easeOut(f);
      const q = new THREE.Quaternion().setFromAxisAngle(up, Math.PI * 2 * (1 - e)).multiply(hop.from.quat.clone().slerp(hop.apex.quat, e));
      const p = hop.from.pos.clone().lerp(hop.apex.pos, e).addScaledVector(up, Math.sin(Math.PI * f) * 0.6 * s);
      this.setTile(a, p, q, THREE.MathUtils.lerp(hop.from.scale, s, e));
    } else if (k < t.rise + t.show) {
      const c = show(easeOut(clamp01((k - t.rise) / t.show)));
      this.setTile(a, c.pos, c.quat, s);
    } else {
      const f = clamp01((k - t.rise - t.show) / t.sweep);
      const c = show(1);
      const ctrl = a.flat.pos.clone().addScaledVector(up, 1.6 * s).lerp(c.pos, 0.4);
      this.setTile(a, bezier(c.pos, ctrl, a.flat.pos, f * f), c.quat.clone().slerp(a.flat.quat, smooth(0, 0.9, f)), s);
    }
  }

  // 这一刻手在哪、牌在哪
  private pose(a: Active, now: number): void {
    const { spec, timing: t, s } = a;
    const up = V(0, 1, 0);
    const k = now - a.t0;
    const reach = a.grab ? t.reach : 0;
    const raised = reach + t.rise;
    const shown = raised + t.show;
    const pressT = shown + t.sweep;
    const flipT = pressT + t.flat;
    const stoodT = flipT + t.flip;
    const hitT = stoodT + t.charge;
    const goneT = a.hop ? pressT : pressT + t.leave;
    if (a.hop && k < pressT) {
      this.hopTile(a, k, a.hop);
      return;
    }
    // 手
    let hand: Key | null = null;
    // 举在高处、蓄一下力（手指往镜头那边仰一点、往上带一点）
    const cocked = (f: number): Key => {
      const lift = (spec.view ? V(0, 1, 0).applyQuaternion(spec.view.quat) : up).multiplyScalar(0.3 * s * f);
      return { pos: a.raise.pos.clone().add(lift), quat: a.raise.quat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.12 * f)) };
    };
    if (a.grab && k < reach) {
      const f = easeInOut(clamp01(k / reach));
      hand = { pos: a.enter.pos.clone().lerp(a.grab.pos, f).addScaledVector(up, Math.sin(Math.PI * f) * 1.2 * s), quat: a.enter.quat.clone().slerp(a.grab.quat, f) };
    } else if (k < raised) {
      const f = easeOut(clamp01((k - reach) / t.rise));
      const from = a.grab ?? a.enter;
      hand = { pos: from.pos.clone().lerp(a.raise.pos, f), quat: from.quat.clone().slerp(a.raise.quat, f) };
    } else if (k < shown) {
      hand = cocked(easeOut(clamp01((k - raised) / t.show)));
    } else if (k < pressT) {
      // 往前扫下去：先慢后快，从上面压下来
      const f = clamp01((k - shown) / t.sweep);
      const c = cocked(1);
      const ctrl = a.press.pos.clone().addScaledVector(up, 3.2 * s).lerp(c.pos, 0.3);
      hand = { pos: bezier(c.pos, ctrl, a.press.pos, f ** 1.6), quat: c.quat.clone().slerp(a.press.quat, smooth(0, 0.85, f)) };
    } else if (k < goneT) {
      // 撤手：先往上一提，再往回撤出画面
      const f = clamp01((k - pressT) / t.leave);
      const ctrl = a.press.pos.clone().addScaledVector(up, 2.6 * s);
      hand = { pos: bezier(a.press.pos, ctrl, a.leave.pos, f ** 1.4), quat: a.press.quat.clone().slerp(a.leave.quat, easeInOut(f)) };
    }
    if (a.arm) {
      a.arm.visible = hand !== null;
      if (hand) {
        a.arm.position.copy(hand.pos);
        a.arm.quaternion.copy(hand.quat);
      }
    }
    // 牌
    if (k < pressT) {
      if (a.grab && k < reach) {
        const fr = spec.from!;
        this.setTile(a, fr.pos, fr.quat, fr.scale);
      } else {
        const held = this.attached(a, hand!);
        let scale = s;
        if (a.grab && k < raised) {
          // 刚拿起来：从原来的样子转到指尖底下
          const fr = spec.from!;
          const w = smooth(0, 0.6, (k - reach) / t.rise);
          held.pos.lerpVectors(fr.pos, held.pos, w);
          held.quat.copy(fr.quat.clone().slerp(held.quat, w));
          scale = THREE.MathUtils.lerp(fr.scale, s, w);
        }
        if (k > shown) {
          // 快扣下去的时候牌转平
          const w = smooth(0.55, 1, (k - shown) / t.sweep);
          held.pos.lerp(a.flat.pos, w);
          held.quat.slerp(a.flat.quat, w);
        }
        this.setTile(a, held.pos, held.quat, scale);
      }
      return;
    }
    if (!a.pressed) {
      a.pressed = true;
      this.shadowsOn(a);
      spec.onPress?.(a.flat.pos.clone().addScaledVector(up, (-TILE_T / 2) * s));
    }
    if (k < flipT) {
      this.setTile(a, a.flat.pos, a.flat.quat, s);
    } else if (k < stoodT) {
      // 跳起来翻身立住：牌顶从朝人转到朝上，牌面转过来朝人
      const f = clamp01((k - flipT) / t.flip);
      const e = easeOut(f);
      const q = spec.to.quat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), (Math.PI / 2) * (1 - e)));
      this.setTile(a, a.flat.pos.clone().lerp(spec.to.pos, e).addScaledVector(up, Math.sin(Math.PI * f) * 0.6 * s), q, s);
    } else if (k < hitT) {
      this.setTile(a, spec.to.pos, spec.to.quat, s);
      if (!a.charged) {
        a.charged = true;
        spec.onCharge?.(spec.to.pos.clone(), t.charge);
      }
    } else if (!a.hit) {
      a.hit = true;
      if (!a.charged) {
        a.charged = true;
        spec.onCharge?.(spec.to.pos.clone(), 0);
      }
      this.setTile(a, spec.to.pos, spec.to.quat, s);
      spec.onHit?.(spec.to.pos.clone().addScaledVector(up, (-TILE_H / 2) * s));
    }
    if (a.hit && k >= goneT) this.finish(a, true);
  }
}
