import * as THREE from 'three';
import { FlickMotion } from './slamFlick';
import { ArmLook, OPEN, buildArm, disposeArm, poseArm } from './slamHand';
import { HAND_SCALE, SlamMotion, SlamStyle } from './slamMath';
import { SlapMotion, SlapOrder } from './slamSlap';

export type { SlamStyle } from './slamMath';
export { DEFAULT_ARM, buildArm } from './slamHand';
export type { ArmLook } from './slamHand';

// 自摸拍牌。每个角色用哪一套动作（style）在 looks.ts 里配，不配就是通用的 press（slamSlap.ts：夹着牌斜着举起来，牌面朝上拍在桌上）；
// 竹井久配的是 hisa（slamFlick.ts）。两套都是“自己算好整段”的动作（SlamMotion），这里照着摆手和牌、到点回调。
//
// 牌桌（table3d.ts）给出牌从哪拿、落在哪、这一家的朝向、镜头，
// 扣到桌上 onPress、开始亮 onCharge、炸开 onHit 各回调一次；冲击波、旋风、震屏、音效、角色特效（咲的百合、衣的水……）都在回调里放。
// 一次可以砸好几张（不同的人），每张一只手。手的模型和手型（张开、握拳……）在 slamHand.ts。
//
// 坐标：手的“手里坐标”原点在手掌中心，+y 是手指方向，+z 是手背那面，右手，大拇指在 -x。
// 牌的“手里坐标”是立着放的牌（牌面朝 +z，牌顶 +y）。

export interface SlamPose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

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
        poseArm(a.arm, fr.hand.pose ?? OPEN);
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
