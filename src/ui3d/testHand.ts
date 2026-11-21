import * as THREE from 'three';
import { TILE_H, TILE_T, TILE_W } from './tableLayout';
import { EASE, HAND_URL, HOOK, HandPose, HandRig, REST, buildHand, loadHand, mixPose, poseHand } from './awaiCutIn';

// 试用：出牌的时候用淡的特写那只手模（public/models/hand-awai.glb）搬牌，看看效果。
// 不改出牌动作本身：手跟着 discardMotion 算出来的「手指捏住牌的点」走，中指指尖按在牌顶上；
// 伸手的时候从出牌的人跟前右手边滑进来，放下以后自己缩回去。3D 用它的时候人物的手臂就不伸了，免得两只手。
//
// 手模的坐标：手臂沿 +X，手背朝 +Y，拇指朝 -Z，手腕在原点，单位是米。

// 一米多少个牌宽（一张牌约 2.6 厘米宽，真手大约是 38）。2.5D 没有人物，取 34；3D 跟人物一样大（人物放大倍数）
export const TEST_HAND_SCALE = 34;
// 手指往下俯多少、往左偏多少（弧度）：手腕抬起来，前臂从右后方伸过来
const PITCH = 0.27;
const YAW = 0.26;
// 袖子：从手腕后面多远开始、多长、多粗（米）
const SLEEVE_FROM = -0.045;
const SLEEVE_LEN = 0.6;
const SLEEVE_R = 0.036;
// 收手要多久（秒）
const RETRACT = 0.35;
// 捏着牌的手型：介于搭着和勾住之间
const PINCH: HandPose = mixPose(REST, HOOK, 0.55);

export interface HandDrive {
  contact: THREE.Vector3; // 手指捏住牌的点（牌的中心）
  tileQuat: THREE.Quaternion; // 牌现在的朝向，用来算牌顶有多高
  forward: THREE.Vector3; // 出牌的人往桌子中间的方向（水平）
  home: THREE.Vector3; // 手牌那张牌原来的位置，手从它后面右手边伸过来
  weight: number; // 0 手在休息位置，1 伸到牌上
  holding: boolean; // 手指正捏着牌
  // 3D 里有人物：手臂从她的右肩伸过来，这时候把她自己的右臂藏起来
  arm?: { shoulder: THREE.Vector3; hide: (on: boolean) => void };
}

const UP = new THREE.Vector3(0, 1, 0);
const smooth = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

export class TestHand {
  readonly group = new THREE.Group();
  private rig: HandRig | null = null;
  private loading: Promise<void> | null = null;
  private drive: HandDrive | null = null;
  private driven = false;
  private weight = 0;
  private grip = 0;
  // 上一次在牌上的位置、朝向（收手时从这里缩回去）
  private at = new THREE.Vector3();
  private rest = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private tip = new THREE.Vector3(0.023, -0.007, 0);
  private sleeve: THREE.Group | null = null;
  // 3D：人物自己的右臂这时候藏起来（手模从她肩膀伸出来）
  private arm: HandDrive['arm'] | null = null;

  constructor(private scale = TEST_HAND_SCALE) {
    this.group.visible = false;
  }

  load(): Promise<void> {
    this.loading ??= loadHand(HAND_URL)
      .then((src) => {
        // 淡的大袖口从牌桌上方看会挡住一大片，还露出切口：换成一截细的袖子，一直伸到画面外面
        const sleeves = new Set<THREE.BufferGeometry>();
        src.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && (m.material as THREE.Material).name === 'sleeve') sleeves.add(m.geometry);
        });
        this.rig = buildHand(src, this.scale);
        let gradient: THREE.Texture | null = null;
        src.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          if (sleeves.has(m.geometry)) m.visible = false;
          else if (!o.userData.outline) {
            o.castShadow = true;
            gradient ??= (m.material as THREE.MeshToonMaterial).gradientMap ?? null;
          }
        });
        // 一个单位长：从手腕这头（x = 0）往后伸到 x = -1，用的时候沿 X 拉长
        const geo = new THREE.CylinderGeometry(SLEEVE_R, SLEEVE_R * 1.25, 1, 20, 1, true);
        geo.rotateZ(Math.PI / 2);
        geo.translate(-0.5, 0.002, 0);
        const sleeve = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: gradient, side: THREE.DoubleSide }));
        sleeve.castShadow = true;
        const line = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#3b4a78', side: THREE.BackSide }));
        this.sleeve = new THREE.Group();
        this.sleeve.add(sleeve, line);
        line.scale.set(1, 1.08, 1.08);
        this.sleeve.position.x = SLEEVE_FROM;
        this.sleeve.scale.x = SLEEVE_LEN;
        src.add(this.sleeve);
        this.group.add(this.rig.root);
      })
      .catch(() => {});
    return this.loading;
  }

  get ready(): boolean {
    return !!this.rig;
  }

  // 这一帧出牌动作算出来的手（每帧调；没调就是这一张出完了，手自己缩回去）
  follow(d: HandDrive): void {
    this.drive = d;
    this.driven = true;
    if (d.arm && this.arm !== d.arm) {
      this.arm?.hide(false);
      this.arm = d.arm;
    }
  }

  // 一下子收起来（换场景、重播的时候）
  hide(): void {
    this.drive = null;
    this.driven = false;
    this.weight = 0;
    this.grip = 0;
    this.group.visible = false;
    this.arm?.hide(false);
    this.arm = null;
  }

  update(dt: number): void {
    const rig = this.rig;
    if (!rig) return;
    const d = this.drive;
    if (this.driven && d) {
      // 伸手的时候跟着动作的快慢，到了牌上就一直按着；动作自己开始收手了（或者 2.5D 一放下就算收完），改由这里慢慢缩回去
      if (d.weight >= this.weight || d.weight > 0.999) this.weight = d.weight;
      else this.weight = Math.max(0, this.weight - dt / RETRACT);
      const want = d.holding && d.weight > 0.75 ? 1 : 0;
      this.grip += Math.sign(want - this.grip) * Math.min(Math.abs(want - this.grip), dt / 0.09);
      this.place(d);
    } else {
      this.weight = Math.max(0, this.weight - dt / RETRACT);
      this.grip = Math.max(0, this.grip - dt / 0.09);
    }
    this.driven = false;
    this.group.visible = this.weight > 0.005;
    this.arm?.hide(this.group.visible);
    if (!this.group.visible) return;
    poseHand(rig, mixPose(EASE, PINCH, this.grip));
    // 从跟前滑进来：手指先离开桌面抬起来一点再落到牌上
    const k = smooth(this.weight);
    rig.root.quaternion.copy(this.quat);
    rig.root.position.copy(this.rest).lerp(this.at, k).addScaledVector(UP, Math.sin(k * Math.PI) * 0.035 * this.scale);
    // 有人物的时候袖子一直伸到她肩膀（收手的路上跟着变短）
    if (this.sleeve) {
      const sh = this.arm?.shoulder;
      this.sleeve.scale.x = sh ? Math.max(0.02, rig.root.position.distanceTo(sh) / this.scale + SLEEVE_FROM) : SLEEVE_LEN;
    }
  }

  // 摆手：先按朝向摆好，再整只平移，让中指指尖正好按在牌顶上
  private place(d: HandDrive): void {
    const rig = this.rig!;
    const fwd = d.forward.clone().setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, UP);
    // 牌顶：牌的中心往上半个「牌在竖直方向上的厚度」
    const m = new THREE.Matrix4().makeRotationFromQuaternion(d.tileQuat).elements;
    const half = (Math.abs(m[1]) * TILE_W + Math.abs(m[5]) * TILE_H + Math.abs(m[9]) * TILE_T) / 2;
    const top = d.contact.clone().addScaledVector(UP, half + 0.04);
    poseHand(rig, mixPose(EASE, PINCH, this.grip));
    const origin = this.group.getWorldPosition(new THREE.Vector3());
    // 摆好朝向，再整只平移，让中指指尖正好按在牌顶上
    const fit = () => {
      rig.root.position.set(0, 0, 0);
      rig.root.quaternion.copy(this.quat);
      rig.root.updateMatrixWorld(true);
      const tip = rig.bones.Middle3.localToWorld(this.tip.clone()).sub(origin);
      this.at.copy(top).sub(tip);
    };
    const sh = d.arm?.shoulder;
    if (sh) {
      // 有人物：前臂顺着肩膀到手腕的方向，手背大致朝上（手腕在哪又跟朝向有关，来回算两遍）
      let wrist = top.clone();
      for (let i = 0; i < 3; i++) {
        const x = wrist.clone().sub(sh).normalize();
        const y = UP.clone().addScaledVector(x, -UP.dot(x)).normalize();
        const z = new THREE.Vector3().crossVectors(x, y);
        this.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
        fit();
        wrist = this.at.clone();
      }
      // 休息的位置：缩回她跟前、桌沿下面
      this.rest
        .copy(d.home)
        .addScaledVector(fwd, -0.06 * this.scale)
        .addScaledVector(UP, -0.12 * this.scale);
      return;
    }
    // 没有人物（2.5D）：手的 X 朝前、Y 朝上、Z 朝右，再往左偏一点、手指往下俯
    this.quat
      .setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, UP, right))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), YAW))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -PITCH));
    fit();
    // 休息的位置：手牌后面（靠自己那边）、偏右，低一点
    this.rest
      .copy(d.home)
      .addScaledVector(fwd, -0.15 * this.scale)
      .addScaledVector(right, 0.075 * this.scale)
      .add(this.at.clone().sub(top).multiplyScalar(0.6));
  }
}
