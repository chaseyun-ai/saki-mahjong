import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMHumanBoneName, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// 坐在牌桌边的 VRM 角色：坐姿、呼吸、眨眼、视线、表情，以及用右手去拿牌（两段骨骼 IK）。
// 模型面朝本地 -z（牌桌中心）。

export type Mood = 'happy' | 'sad' | 'angry' | 'surprised' | 'relaxed';

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

// 同一个模型文件只下载一次，每个座位各自解析一份
const fileCache = new Map<string, Promise<ArrayBuffer>>();

// 发布页不能直接提供 .glb，那里的模型是 base64 文本（.glb.txt），自己解码
function fetchModel(url: string): Promise<ArrayBuffer> {
  let p = fileCache.get(url);
  if (!p) {
    p = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      if (!url.endsWith('.txt')) return res.arrayBuffer();
      const raw = atob((await res.text()).trim());
      const bin = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
      return bin.buffer;
    });
    fileCache.set(url, p);
  }
  return p;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const axisQ = (axis: THREE.Vector3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a);

export class Avatar {
  readonly root = new THREE.Group();
  readonly lookTarget = new THREE.Object3D();
  private time = Math.random() * 10;
  private nextBlink = 2;
  private blinkT = -1;
  // 视线：想看的点、眼睛实际看着的点（平滑移过去）、头转了多少
  private lookWant = new THREE.Vector3(0, 0, -10);
  private lookNow = new THREE.Vector3(0, 0, -10);
  private lookHoldUntil = 0;
  private headYaw = 0;
  private headPitch = 0;
  // 没事做时视线的落点：自己的手牌，偶尔瞟一眼别人
  home: THREE.Vector3 | null = null;
  glances: THREE.Vector3[] = [];
  private nextGlance = 3 + Math.random() * 4;
  private mood: { name: Mood; until: number } | null = null;
  private moodWeights = new Map<Mood, number>();
  private base = new Map<VRMHumanBoneName, THREE.Quaternion>();
  // VRM 0.x 模型本身朝 -z，所有姿势旋转要绕 y 轴翻转半圈再用
  private flip: THREE.Quaternion | null = null;
  // 右手要去的位置（世界坐标）和权重，0 是手放在休息的位置，1 是完全伸到目标
  reachTarget: THREE.Vector3 | null = null;
  reachWeight = 0;
  // 双手休息的位置（模型自身坐标，右手 +x）：桌沿上，或者放在腿上
  private rest: { left: THREE.Vector3; right: THREE.Vector3 } | null = null;
  // 站立时髋部离脚底的高度（模型自身单位），用来把角色放到椅子高度
  readonly hipHeight: number;

  private constructor(readonly vrm: VRM) {
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.combineSkeletons(vrm.scene);
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    const vrm0 = vrm.meta?.metaVersion === '0';
    if (vrm0) this.flip = axisQ(Y, Math.PI);
    // VRM 1.0 模型面朝 +z，转过来朝向桌子中心；0.x 本来就朝 -z
    vrm.scene.rotation.y = vrm0 ? 0 : Math.PI;
    this.root.add(vrm.scene);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    this.sitDown();
    vrm.scene.updateMatrixWorld(true);
    const hips = this.bone('hips');
    this.hipHeight = hips ? hips.getWorldPosition(new THREE.Vector3()).y : 0.9;
  }

  static async load(url: string): Promise<Avatar> {
    const buf = await fetchModel(url);
    const gltf = await loader.parseAsync(buf, '');
    return new Avatar(gltf.userData.vrm as VRM);
  }

  // tableY、edgeZ 是桌面高度和桌沿位置（模型自身坐标）；onLap 时手放在腿上
  setRestPose(tableY: number, edgeZ: number, onLap: boolean): void {
    if (onLap) {
      const y = this.hipHeight + 0.08;
      this.rest = { left: new THREE.Vector3(-0.13, y, -0.26), right: new THREE.Vector3(0.13, y, -0.26) };
    } else {
      const y = tableY + 0.03;
      this.rest = { left: new THREE.Vector3(-0.16, y, edgeZ - 0.07), right: new THREE.Vector3(0.16, y, edgeZ - 0.07) };
    }
  }

  // 第一人称：藏起自己的头，不挡镜头
  setFirstPerson(camera: THREE.Camera): void {
    const fp = this.vrm.firstPerson;
    if (!fp) return;
    fp.setup();
    camera.layers.enable(fp.firstPersonOnlyLayer);
    camera.layers.disable(fp.thirdPersonOnlyLayer);
  }

  private bone(name: VRMHumanBoneName): THREE.Object3D | null {
    return this.vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
  }

  private local(q: THREE.Quaternion): THREE.Quaternion {
    if (!this.flip) return q;
    return this.flip.clone().multiply(q).multiply(this.flip.clone().invert());
  }

  private pose(name: VRMHumanBoneName, q: THREE.Quaternion): void {
    const b = this.bone(name);
    if (!b) return;
    const lq = this.local(q);
    b.quaternion.copy(lq);
    this.base.set(name, lq.clone());
  }

  // 坐姿：大腿向前、小腿向下，双手放在桌沿
  private sitDown(): void {
    const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
    const armDown = (side: 1 | -1) => axisQ(X, -0.85).multiply(axisQ(Z, -side * 1.2));
    this.pose('leftUpperLeg', q(-Math.PI / 2, 0, 0.08));
    this.pose('rightUpperLeg', q(-Math.PI / 2, 0, -0.08));
    this.pose('leftLowerLeg', q(Math.PI / 2, 0, 0));
    this.pose('rightLowerLeg', q(Math.PI / 2, 0, 0));
    this.pose('spine', q(0.1, 0, 0));
    this.pose('leftUpperArm', armDown(1));
    this.pose('rightUpperArm', armDown(-1));
    this.pose('leftLowerArm', q(0, -1.25, 0));
    this.pose('rightLowerArm', q(0, 1.25, 0));
  }

  // 视线看向世界坐标里的一点
  // 视线看向世界坐标里的一点，hold 秒内不会自己移开
  lookAtPoint(p: THREE.Vector3, hold = 2): void {
    this.lookWant.copy(p);
    this.lookHoldUntil = this.time + hold;
  }

  // 世界坐标的点换算成以模型自身朝向为准的偏航、俯仰角（+z 朝前，按 VRM 1.0 的约定）
  private aimAngles(p: THREE.Vector3, from: THREE.Object3D): { yaw: number; pitch: number } {
    const origin = from.getWorldPosition(new THREE.Vector3());
    const d = this.root.worldToLocal(p.clone()).sub(this.root.worldToLocal(origin));
    // 本地 -z 是前方；换成模型的 +z 朝前
    const mx = -d.x;
    const mz = -d.z;
    return { yaw: Math.atan2(mx, mz), pitch: Math.atan2(-d.y, Math.hypot(mx, mz)) };
  }

  setMood(name: Mood, seconds: number): void {
    this.mood = { name, until: this.time + seconds };
  }

  // 让骨骼 bone 转动，使它的子骨骼 child 指向世界坐标 goal
  private aim(bone: THREE.Object3D, child: THREE.Object3D, goal: THREE.Vector3): void {
    const from = bone.getWorldPosition(new THREE.Vector3());
    const cur = child.getWorldPosition(new THREE.Vector3()).sub(from).normalize();
    const want = goal.clone().sub(from).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(cur, want);
    const world = delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(world));
    bone.updateMatrixWorld(true);
  }

  // 两段骨骼 IK：肩、肘、手腕，肘部朝下外侧
  private solveArm(side: 'left' | 'right', target: THREE.Vector3): void {
    const upper = this.bone(`${side}UpperArm`);
    const lower = this.bone(`${side}LowerArm`);
    const hand = this.bone(`${side}Hand`);
    if (!upper || !lower || !hand) return;
    this.root.updateMatrixWorld(true);
    const s = upper.getWorldPosition(new THREE.Vector3());
    const e = lower.getWorldPosition(new THREE.Vector3());
    const h = hand.getWorldPosition(new THREE.Vector3());
    const a = s.distanceTo(e);
    const b = e.distanceTo(h);
    const toT = target.clone().sub(s);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-4, (a + b) * 0.999);
    const dir = toT.normalize();
    // 用坐姿里肘部的方向当参考，再往下压一点，避免手臂翻转
    const hint = e.clone().sub(s).add(new THREE.Vector3(0, -a, 0));
    const perp = hint.sub(dir.clone().multiplyScalar(hint.dot(dir))).normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const elbow = s.clone().addScaledVector(dir, cosA * a).addScaledVector(perp, sinA * a);
    this.aim(upper, lower, elbow);
    this.aim(lower, hand, s.clone().addScaledVector(dir, d));
    // 前臂绕自身转，让手心朝下；手腕再往下弯一点，手指搭在桌上
    const handPos = hand.getWorldPosition(new THREE.Vector3());
    const axis = handPos.clone().sub(lower.getWorldPosition(new THREE.Vector3())).normalize();
    const flat = (v: THREE.Vector3) => v.sub(axis.clone().multiplyScalar(v.dot(axis))).normalize();
    const palm = flat(new THREE.Vector3(0, -1, 0).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion())));
    const down = flat(new THREE.Vector3(0, -1, 0));
    const twist = Math.atan2(new THREE.Vector3().crossVectors(palm, down).dot(axis), palm.dot(down));
    this.rotateWorld(lower, axisQ(axis, twist));
    const bendAxis = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, -1, 0)).normalize();
    this.rotateWorld(hand, axisQ(bendAxis, 0.35));
  }

  // 在世界坐标里给骨骼再加一个旋转
  private rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
    const world = q.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(world));
    bone.updateMatrixWorld(true);
  }

  private updateGaze(dt: number): void {
    const t = this.time;
    // 没人吸引注意时：大部分时间看自己的牌，偶尔瞟一眼别人
    if (t > this.lookHoldUntil && this.home) {
      if (t > this.nextGlance && this.glances.length) {
        this.lookWant.copy(this.glances[Math.floor(Math.random() * this.glances.length)]);
        this.lookHoldUntil = t + 0.8 + Math.random() * 0.9;
        this.nextGlance = t + 4 + Math.random() * 6;
      } else {
        this.lookWant.copy(this.home);
      }
    }
    this.lookNow.lerp(this.lookWant, 1 - Math.exp(-dt * 7));
    this.lookTarget.position.copy(this.lookNow);

    // 头跟着视线转一部分，转得比眼睛慢
    const head = this.bone('head');
    if (!head) return;
    const { yaw, pitch } = this.aimAngles(this.lookNow, head);
    const k = 1 - Math.exp(-dt * 3.5);
    this.headYaw += (THREE.MathUtils.clamp(yaw * 0.55, -0.7, 0.7) - this.headYaw) * k;
    this.headPitch += (THREE.MathUtils.clamp(pitch * 0.5, -0.25, 0.45) - this.headPitch) * k;
    const sway = Math.sin(t * 0.6) * 0.035;
    const q = axisQ(Y, this.headYaw * 0.6).multiply(axisQ(X, this.headPitch * 0.6)).multiply(axisQ(Z, sway));
    this.bone('neck')?.quaternion.copy(this.local(axisQ(Y, this.headYaw * 0.4).multiply(axisQ(X, this.headPitch * 0.4))));
    head.quaternion.copy(this.local(q));
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.root.updateMatrixWorld(true);

    // 身体：呼吸、轻微晃动；伸手时按距离前倾，并往手的方向转一点
    let lean = 0;
    let twist = 0;
    if (this.reachTarget && this.reachWeight > 0) {
      const local = this.root.worldToLocal(this.reachTarget.clone());
      const dist = Math.hypot(local.x, local.z);
      lean = this.reachWeight * THREE.MathUtils.clamp((dist - 0.3) * 1.4, 0.05, 0.5);
      twist = this.reachWeight * THREE.MathUtils.clamp(Math.atan2(-local.x, -local.z) * 0.35, -0.3, 0.3);
    }
    const breath = Math.sin(t * 1.6);
    const spine = this.bone('spine');
    const spineBase = this.base.get('spine');
    if (spine && spineBase) {
      const q = axisQ(X, breath * 0.012 + Math.sin(t * 0.37) * 0.015 + lean * 0.6)
        .multiply(axisQ(Y, twist * 0.6))
        .multiply(axisQ(Z, Math.sin(t * 0.23) * 0.02));
      spine.quaternion.copy(spineBase).multiply(this.local(q));
    }
    const chest = this.bone('chest');
    if (chest) chest.quaternion.copy(this.local(axisQ(X, breath * 0.015 + lean * 0.4).multiply(axisQ(Y, twist * 0.4))));
    // 伸手时右肩微微抬起
    const shoulder = this.bone('rightShoulder');
    if (shoulder) shoulder.quaternion.copy(this.local(axisQ(Z, this.reachWeight * 0.12)));
    this.updateGaze(dt);

    // 双手：先回到坐姿，再用 IK 放到休息位置；右手按权重移向目标
    for (const n of ['leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm'] as VRMHumanBoneName[]) {
      const b = this.bone(n);
      const q = this.base.get(n);
      if (b && q) b.quaternion.copy(q);
    }
    this.bone('leftHand')?.quaternion.identity();
    this.bone('rightHand')?.quaternion.identity();
    if (this.rest) {
      this.root.updateMatrixWorld(true);
      const left = this.root.localToWorld(this.rest.left.clone());
      const right = this.root.localToWorld(this.rest.right.clone());
      // 手放着也不是完全不动：手指偶尔轻轻挪一下
      left.y += Math.max(0, Math.sin(t * 0.8 + 1)) * 0.003 * this.root.scale.x;
      if (this.reachTarget && this.reachWeight > 0) right.lerp(this.reachTarget, this.reachWeight);
      this.solveArm('left', left);
      this.solveArm('right', right);
    }

    this.updateFace(dt);
    this.vrm.update(dt);
  }

  private updateFace(dt: number): void {
    const t = this.time;
    const em = this.vrm.expressionManager;
    if (!em) return;
    // 眨眼：闭眼快、睁眼慢，偶尔连眨两下
    if (t > this.nextBlink) {
      this.blinkT = 0;
      this.nextBlink = t + (Math.random() < 0.15 ? 0.35 : 2.5 + Math.random() * 3.5);
    }
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      blink = this.blinkT < 0.06 ? this.blinkT / 0.06 : Math.max(0, 1 - (this.blinkT - 0.06) / 0.12);
      if (this.blinkT > 0.18) this.blinkT = -1;
    }
    const moodActive = this.mood && t < this.mood.until ? this.mood.name : null;
    for (const m of ['happy', 'sad', 'angry', 'surprised', 'relaxed'] as Mood[]) {
      const cur = this.moodWeights.get(m) ?? 0;
      const goal = m === moodActive ? 1 : 0;
      const next = cur + (goal - cur) * Math.min(1, dt * 6);
      this.moodWeights.set(m, next);
      // VRM 0.x 没有“吃惊”，用张嘴代替
      if (m === 'surprised' && !em.getExpression('surprised')) em.setValue('oh', next * 0.7);
      else em.setValue(m, next);
    }
    // 笑的时候本来就眯眼，不再叠加眨眼
    em.setValue('blink', moodActive === 'happy' ? 0 : blink);
  }
}
