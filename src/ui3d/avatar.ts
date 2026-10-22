import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMHumanBoneName, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// 坐在牌桌边的 VRM 角色：坐姿、呼吸、眨眼、视线、表情、出牌时伸手。
// 模型面朝本地 -z（牌桌中心）。

export type Mood = 'happy' | 'sad' | 'angry' | 'surprised' | 'relaxed';

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

export class Avatar {
  readonly root = new THREE.Group();
  readonly lookTarget = new THREE.Object3D();
  private time = Math.random() * 10;
  private nextBlink = 2;
  private blink = 0;
  private mood: { name: Mood; until: number } | null = null;
  private moodWeights = new Map<Mood, number>();
  private reachT = -1;
  private base = new Map<VRMHumanBoneName, THREE.Quaternion>();
  // 站立时髋部离脚底的高度（模型自身单位），用来把角色放到椅子高度
  readonly hipHeight: number;

  private constructor(readonly vrm: VRM) {
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.combineSkeletons(vrm.scene);
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
      // Seed-san 背后的机械臂太大，会伸到牌桌上，先隐藏
      if (o.name === 'robo_arm') o.visible = false;
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    // VRM 1.0 模型面朝 +z，转过来朝向桌子中心
    vrm.scene.rotation.y = Math.PI;
    this.root.add(vrm.scene);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    this.sitDown();
    vrm.scene.updateMatrixWorld(true);
    const hips = this.bone('hips');
    this.hipHeight = hips ? hips.getWorldPosition(new THREE.Vector3()).y : 0.9;
  }

  static async load(url: string): Promise<Avatar> {
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM;
    return new Avatar(vrm);
  }

  private bone(name: VRMHumanBoneName): THREE.Object3D | null {
    return this.vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
  }

  private pose(name: VRMHumanBoneName, q: THREE.Quaternion): void {
    const b = this.bone(name);
    if (!b) return;
    b.quaternion.copy(q);
    this.base.set(name, q.clone());
  }

  // 坐姿：大腿向前、小腿向下，双手放在桌沿
  private sitDown(): void {
    const q = (x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ') =>
      new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));
    const armDown = (side: 1 | -1) =>
      new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.75)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -side * 1.15));
    this.pose('leftUpperLeg', q(-Math.PI / 2, 0, 0.08));
    this.pose('rightUpperLeg', q(-Math.PI / 2, 0, -0.08));
    this.pose('leftLowerLeg', q(Math.PI / 2, 0, 0));
    this.pose('rightLowerLeg', q(Math.PI / 2, 0, 0));
    this.pose('spine', q(0.12, 0, 0));
    this.pose('leftUpperArm', armDown(1));
    this.pose('rightUpperArm', armDown(-1));
    this.pose('leftLowerArm', q(0, -1.1, 0));
    this.pose('rightLowerArm', q(0, 1.1, 0));
  }

  // 视线看向世界坐标里的一点
  lookAtPoint(p: THREE.Vector3): void {
    this.lookTarget.position.copy(p);
  }

  setMood(name: Mood, seconds: number): void {
    this.mood = { name, until: this.time + seconds };
  }

  // 出牌时右手往前伸一下
  reach(): void {
    this.reachT = 0;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;

    // 呼吸：脊柱轻微起伏
    const spine = this.bone('spine');
    const spineBase = this.base.get('spine');
    if (spine && spineBase) {
      spine.quaternion
        .copy(spineBase)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.sin(t * 1.7) * 0.02));
    }
    const head = this.bone('head');
    if (head) head.rotation.z = Math.sin(t * 0.6) * 0.04;

    // 伸手
    const arm = this.bone('rightUpperArm');
    const armBase = this.base.get('rightUpperArm');
    if (arm && armBase) {
      let k = 0;
      if (this.reachT >= 0) {
        this.reachT += dt;
        k = Math.sin(Math.min(1, this.reachT / 0.6) * Math.PI);
        if (this.reachT > 0.6) this.reachT = -1;
      }
      arm.quaternion
        .copy(armBase)
        .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.7 * k));
    }

    // 眨眼
    if (t > this.nextBlink) {
      this.blink = 0.15;
      this.nextBlink = t + 2 + Math.random() * 3;
    }
    const em = this.vrm.expressionManager;
    if (em) {
      this.blink = Math.max(0, this.blink - dt);
      const moodActive = this.mood && t < this.mood.until ? this.mood.name : null;
      for (const m of ['happy', 'sad', 'angry', 'surprised', 'relaxed'] as Mood[]) {
        const cur = this.moodWeights.get(m) ?? 0;
        const goal = m === moodActive ? 1 : 0;
        const next = cur + (goal - cur) * Math.min(1, dt * 6);
        this.moodWeights.set(m, next);
        em.setValue(m, next);
      }
      // 笑的时候本来就眯眼，不再叠加眨眼
      em.setValue('blink', this.blink > 0 && moodActive !== 'happy' ? 1 : 0);
    }
    this.vrm.update(dt);
  }
}
