import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { V } from './slamMath';

// 自摸拍牌的那只手：模型和手型。手是卡通渲染：三阶明暗加一圈细描边，皮肤、指甲、袖子的颜色可以换；手不投影子。
// 手指、大拇指每一节都是单独的一块，照手型（HandPose）摆：张开的手（OPEN，夹牌、扣牌、拍牌都是它）、
// 握拳把大拇指压在食指底下（COCKED，竹井久弹牌前牌就放在大拇指指甲盖上）、握着拳大拇指弹起来（FLICKED）。
// 两个手型之间可以按比例混（mixPose），手就慢慢握起来、张开。
//
// 坐标：手的“手里坐标”原点在手掌中心，+y 是手指方向，+z 是手背那面，右手，大拇指在 -x。单位是手模型的牌宽。

// 手的颜色：皮肤、指甲、描边；袖子、袖口不给（null）就是光着的手臂
export interface ArmLook {
  skin: THREE.ColorRepresentation;
  nail: THREE.ColorRepresentation;
  line: THREE.ColorRepresentation;
  sleeve: THREE.ColorRepresentation | null;
  cuff: THREE.ColorRepresentation | null;
}

export const DEFAULT_ARM: ArmLook = { skin: '#f4c3b6', nail: '#ffe9e4', line: '#c5847c', sleeve: null, cuff: null };

// 手型：四根手指（食指到小指）三个关节各往手心弯多少（弧度）、各往大拇指那边张开多少，
// 大拇指三节各朝哪（手里坐标的方向）、指甲朝哪
export interface HandPose {
  curl: [number, number, number][];
  spread: number[];
  thumb: THREE.Vector3[];
  nail: THREE.Vector3;
}

const dir = (x: number, y: number, z: number) => V(x, y, z).normalize();

// 张开的手：食指、中指的指肚压着牌，弯得多一点；大拇指往上、往手心那边弯
export const OPEN: HandPose = {
  curl: [
    [0.12, 0.2, 0.18],
    [0.12, 0.2, 0.18],
    [0.1, 0.14, 0.12],
    [0.1, 0.14, 0.12],
  ],
  spread: [0.1, 0.02, -0.07, -0.18],
  thumb: [dir(-0.62, 0.52, -0.3), dir(-0.3, 0.68, -0.22), dir(-0.1, 0.6, -0.14)],
  nail: dir(-0.55, 0, 0.83),
};

// 握拳：四根手指卷进手心；食指卷得松一点，留出地方压住大拇指尖
const FIST_CURL: [number, number, number][] = [
  [1.36, 1.62, 1.05],
  [1.5, 1.72, 1.1],
  [1.52, 1.74, 1.1],
  [1.54, 1.76, 1.1],
];
const FIST_SPREAD = [0.02, 0, -0.02, -0.06];

// 弹牌前：握着拳，大拇指横在拳头顶上（拳头立着，大拇指那边朝上）、指尖压在食指底下，指甲盖朝上，牌就放在上面
export const COCKED: HandPose = {
  curl: FIST_CURL,
  spread: FIST_SPREAD,
  thumb: [dir(-0.52, 0.62, -0.3), dir(-0.16, 0.74, -0.62), dir(0.1, 0.62, -0.74)],
  nail: dir(-1, 0.1, -0.05),
};

// 弹出去：还握着拳，大拇指一下子挑直（斜着朝上、往前）
export const FLICKED: HandPose = {
  curl: FIST_CURL,
  spread: FIST_SPREAD,
  thumb: [dir(-0.72, 0.62, -0.24), dir(-0.8, 0.58, -0.16), dir(-0.84, 0.52, -0.1)],
  nail: dir(-0.5, -0.85, 0.15),
};

// 两个手型按比例混：t 是 0 就是 a，1 就是 b
export function mixPose(a: HandPose, b: HandPose, t: number): HandPose {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    curl: a.curl.map((c, i) => [mix(c[0], b.curl[i][0]), mix(c[1], b.curl[i][1]), mix(c[2], b.curl[i][2])] as [number, number, number]),
    spread: a.spread.map((s, i) => mix(s, b.spread[i])),
    thumb: a.thumb.map((d, i) => d.clone().lerp(b.thumb[i], t).normalize()),
    nail: a.nail.clone().lerp(b.nail, t).normalize(),
  };
}

// 手指：根部在哪、多长、多粗（食指到小指）；三节各占多长、各比根部细多少
const FINGERS: { base: THREE.Vector3; len: number; r: number }[] = [
  { base: V(-0.8, 1.2, 0.02), len: 2.45, r: 0.25 },
  { base: V(-0.27, 1.32, 0.04), len: 2.72, r: 0.26 },
  { base: V(0.27, 1.24, 0.02), len: 2.52, r: 0.24 },
  { base: V(0.75, 1.06, -0.02), len: 1.98, r: 0.21 },
];
const SEGS = [0.46, 0.3, 0.24];
const TAPER = [1, 0.93, 0.86];
// 大拇指：从手掌靠下那边伸出去，三节各多长、多粗
const THUMB_BASE = V(-0.82, -0.6, -0.12);
const THUMB_LEN = [V(-0.62, 0.52, -0.3).length(), V(-0.3, 0.68, -0.22).length(), V(-0.1, 0.6, -0.14).length()];
const THUMB_R = [0.36, 0.29, 0.26];

// 大拇指指甲盖正中间（指甲面上）在手里坐标的哪里、指甲朝哪：牌放在指甲盖上时牌底就贴着这一点
export function thumbNail(pose: HandPose): { at: THREE.Vector3; up: THREE.Vector3 } {
  const p = THUMB_BASE.clone();
  for (let i = 0; i < 2; i++) p.addScaledVector(pose.thumb[i], THUMB_LEN[i]);
  const d = pose.thumb[2];
  const up = pose.nail.clone().addScaledVector(d, -pose.nail.dot(d)).normalize();
  return { at: p.addScaledVector(d, THUMB_LEN[2] * 0.62).addScaledVector(up, THUMB_R[2] * 1.06), up };
}

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

// 一节手指（皮肤、描边两块，同一个胶囊）和它多粗；最后一节带指甲
interface Joint {
  meshes: THREE.Mesh[];
  len: number;
  r: number;
  nail?: THREE.Mesh;
}

interface Rig {
  fingers: Joint[][];
  thumb: Joint[];
}

const UP = V(0, 1, 0);

// 一节手指：长 len、粗 r 的胶囊（两头圆的），摆在哪由 place 定
function joint(parts: ArmParts, mats: THREE.Material[], len: number, r: number, parent: THREE.Object3D): Joint {
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 6, 14);
  parts.geos.push(geo);
  const meshes = mats.map((mat) => new THREE.Mesh(geo, mat));
  for (const m of meshes) parent.add(m);
  return { meshes, len, r };
}

// 指甲：贴在最后一节手背那面的扁椭球
function addNail(parts: ArmParts, mat: THREE.Material, j: Joint, parent: THREE.Object3D): void {
  const geo = new THREE.SphereGeometry(1, 12, 8);
  parts.geos.push(geo);
  j.nail = new THREE.Mesh(geo, mat);
  j.nail.scale.set(j.r * 0.72, j.len * 0.5 + j.r * 0.25, j.r * 0.28);
  parent.add(j.nail);
}

// 把一节摆成从 a 朝 d 伸出去；back 是手背那面朝哪（指甲贴在那面）。返回这一节的另一头
function place(j: Joint, a: THREE.Vector3, d: THREE.Vector3, back: THREE.Vector3): THREE.Vector3 {
  const b = a.clone().addScaledVector(d, j.len);
  for (const m of j.meshes) {
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, d);
  }
  if (j.nail) {
    const n = back.clone().addScaledVector(d, -back.dot(d)).normalize();
    j.nail.position.copy(a).lerp(b, 0.62).addScaledVector(n, j.r * 0.78);
    j.nail.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(d, n), d, n));
  }
  return b;
}

// 一节锥形的筒（手腕、前臂、袖子）：a 那头半径 ra，b 那头半径 rb
function tube(parts: ArmParts, mat: THREE.Material, line: THREE.Material | null, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, parent: THREE.Object3D, open = false): void {
  const geo = new THREE.CylinderGeometry(rb, ra, a.distanceTo(b), 20, 1, open);
  parts.geos.push(geo);
  const meshes = [new THREE.Mesh(geo, mat), ...(line ? [new THREE.Mesh(geo, line)] : [])];
  for (const m of meshes) {
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    parent.add(m);
  }
}

// 右手，手背朝 +z、手指朝 +y，原点在手掌中心，单位是牌宽。一开始是张开的手（OPEN）
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
  // 四根手指、大拇指：每根三节，最后一节带指甲
  const rig: Rig = { fingers: [], thumb: [] };
  for (const f of FINGERS) {
    const joints = SEGS.map((seg, i) => joint(parts, [skin, line], f.len * seg, f.r * TAPER[i], g));
    addNail(parts, nailMat, joints[2], g);
    rig.fingers.push(joints);
  }
  rig.thumb = THUMB_LEN.map((len, i) => joint(parts, [skin, line], len, THUMB_R[i], g));
  addNail(parts, nailMat, rig.thumb[2], g);
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
  g.userData.rig = rig;
  poseArm(g, OPEN);
  return g;
}

// 把手摆成这个手型（同一个手型不重摆）
export function poseArm(g: THREE.Group, pose: HandPose): void {
  const rig = g.userData.rig as Rig | undefined;
  if (!rig || g.userData.pose === pose) return;
  g.userData.pose = pose;
  rig.fingers.forEach((joints, f) => {
    let p = FINGERS[f].base.clone();
    let bend = 0;
    joints.forEach((j, i) => {
      bend += pose.curl[f][i];
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-bend, 0, pose.spread[f], 'ZXY'));
      p = place(j, p, V(0, 1, 0).applyQuaternion(q), V(0, 0, 1).applyQuaternion(q));
    });
  });
  let p = THUMB_BASE.clone();
  rig.thumb.forEach((j, i) => {
    p = place(j, p, pose.thumb[i], pose.nail);
  });
}

export function disposeArm(g: THREE.Group): void {
  const parts = g.userData.parts as ArmParts | undefined;
  if (!parts) return;
  for (const m of parts.mats) m.dispose();
  for (const geo of parts.geos) geo.dispose();
}
