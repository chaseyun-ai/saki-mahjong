import * as THREE from 'three';
import { TILE_T } from './tableLayout';
import { Key, SlamMotion, V, basis, bezier, clamp01, easeInOut, easeOut, smooth } from './slamMath';
import type { SlamPose, SlamView } from './tileSlam';

// 通用的自摸拍牌（除了有招牌动作的人，大家都用这一套）：看清摸到的是什么，下意识牌面朝上往桌上一拍，让别人看到。
// 手的样子：食指、无名指夹住牌左右两边，中指指肚按在牌面上（牌面朝手心那边，牌顶朝指尖）；
// 手连着牌斜着举起来（手指往上翘，这时牌面朝着自己），停一下，往下一拍，牌面朝上落在手牌右边，手按一下再抬走。
// 自己拍牌时牌一开始就在手里，手带着牌从画面下面伸上来；别人的手先伸过去把她手里立着的那张夹起来。
// 不带手：牌自己从原处跳起来、斜着停一下，再拍下去。
// 手牌什么时候倒（order）：first 先倒再拍，lift 举牌的同时倒，slap 拍下去那一下跟着倒——这里只给出时刻（revealAt），倒牌在牌桌上做。
// 拍下去那一下（hitAt）放光、震屏、声音（牌桌在回调里放）。这里只算整段手和牌在哪（SlamMotion），手的模型、回调都在 tileSlam.ts。

export type SlapOrder = 'first' | 'lift' | 'slap';

export interface SlapTiming {
  reach: number; // 别人的：手伸到她手里那张上
  grab: number; // 夹住
  lift: number; // 斜着举起来（自己的：带着牌从画面下面伸上来）
  hang: number; // 举在高处停一下、往后蓄一点劲
  slap: number; // 拍下去
  hold: number; // 按着停一下
  leave: number; // 手抬走
}

export const SLAP_TIMING: SlapTiming = { reach: 0.3, grab: 0.07, lift: 0.38, hang: 0.12, slap: 0.1, hold: 0.16, leave: 0.32 };

export interface SlapSpec {
  to: SlamPose; // 最后牌面朝上躺在桌上的样子（牌顶朝桌子中间）
  side: THREE.Vector3; // 这一家的右手方向（世界坐标，水平）
  out: THREE.Vector3; // 这一家往外（朝她自己身体）的方向
  from?: SlamPose; // 要拿的那张现在在哪；不给就是牌一开始就在手里（自己拍牌），跟着手从画面外伸上来
  hand: boolean; // false：不带手
  near?: boolean; // 自己拍牌（镜头就在她身后）
  cam?: SlamView;
  order?: SlapOrder;
  timing?: Partial<SlapTiming>;
}

// 手比照着牌放大多少
export const SLAP_HAND = 1.15;
// 牌在手里（手里坐标，单位是手模型的牌宽）：中指指肚按着牌面、盖过半张牌多一点（食指、无名指在左右两边夹着），
// 牌顶那一小半露在指尖外面（从上面看得见牌）；牌面朝 +z（贴着中指指肚），牌顶朝指尖
export const TILE_AT = V(-0.27, 3.8, -0.5);
// 举起来时手指往上翘多少（弧度），蓄劲时再翘多少
const LIFT_PITCH = 0.6;
const COCK_PITCH = 0.2;
// 牌举多高、往桌子中间多少（牌宽）：手在牌后面（靠自己那边）四张牌远，往中间一点手和牌都在画面里
const LIFT_UP = 5;
const LIFT_IN = 1.2;
// 别家的牌在画面边上（下家、上家的手牌就在两边的头像框底下），举的时候多往桌子中间带一点，手和牌才进画面
const LIFT_IN_FAR = 3.2;
const LIFT_UP_FAR = 3.4;
// 别人的手夹她手里那张时手指往下扎多少（弧度）
const GRAB_PITCH = 0.5;

export class SlapMotion implements SlamMotion {
  readonly pressAt: number;
  readonly chargeAt: number;
  readonly chargeDur = 0;
  readonly hitAt: number;
  readonly doneAt: number;
  readonly revealAt: number;
  readonly pressPoint: THREE.Vector3;
  readonly chargePoint: THREE.Vector3;
  readonly hitPoint: THREE.Vector3;
  readonly handScale = SLAP_HAND;

  private readonly t: SlapTiming;
  private readonly s: number;
  private readonly hs: number;
  private readonly hand: boolean;
  private readonly to: SlamPose;
  private readonly from: SlamPose | null;
  private readonly up = V(0, 1, 0);
  private readonly out: THREE.Vector3;
  private readonly slapK: Key; // 拍在桌上的手
  private readonly raiseK: Key; // 举在高处的手
  private readonly cockK: Key; // 蓄好劲的手
  private readonly enterK: Key; // 手从哪伸进来、抬走到哪
  private readonly grabK: Key | null; // 夹住她手里那张的手
  private readonly c: { reached: number; grabbed: number; lifted: number; hung: number; hit: number; held: number; gone: number };

  constructor(o: SlapSpec) {
    const t = (this.t = { ...SLAP_TIMING, ...o.timing });
    const s = (this.s = o.to.scale);
    this.hs = s * SLAP_HAND;
    this.hand = o.hand;
    this.to = { pos: o.to.pos.clone(), quat: o.to.quat.clone(), scale: s };
    this.from = o.from ? { pos: o.from.pos.clone(), quat: o.from.quat.clone(), scale: o.from.scale } : null;
    this.out = o.out.clone().normalize();
    const { up, out } = this;
    // 牌顶朝哪（拍下去以后）：手指就朝这边
    const top = V(0, 1, 0).applyQuaternion(this.to.quat).setY(0).normalize();
    const pitched = (a: number) => basis(top.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a)), up.clone().multiplyScalar(Math.cos(a)).addScaledVector(top, -Math.sin(a)));
    this.slapK = this.holding(this.to.pos, this.to.quat);
    this.slapK.pos.addScaledVector(up, 0.02 * s);
    const lifted = this.to.pos.clone().addScaledVector(up, (o.near ? LIFT_UP : LIFT_UP_FAR) * s).addScaledVector(out, -(o.near ? LIFT_IN : LIFT_IN_FAR) * s);
    const rq = pitched(LIFT_PITCH);
    this.raiseK = { pos: lifted.clone().sub(this.attach(rq)), quat: rq };
    const cq = pitched(LIFT_PITCH + COCK_PITCH);
    this.cockK = { pos: lifted.clone().addScaledVector(up, 0.35 * s).addScaledVector(out, 0.3 * s).sub(this.attach(cq)), quat: cq };
    this.enterK = { pos: this.slapK.pos.clone().addScaledVector(out, 9 * s).addScaledVector(up, 1.5 * s).addScaledVector(o.side, 1.5 * s), quat: pitched(0.35) };
    this.grabK = null;
    if (this.from && this.hand) {
      const gq = pitched(-GRAB_PITCH);
      this.grabK = { pos: this.from.pos.clone().sub(this.attach(gq)).addScaledVector(up, 0.08 * s), quat: gq };
    }
    // 自己拍牌（牌一开始在手里）、不带手：不用伸手去夹
    const reach = this.grabK ? t.reach : 0;
    const grab = this.grabK ? t.grab : 0;
    let k = 0;
    this.c = {
      reached: (k += reach),
      grabbed: (k += grab),
      lifted: (k += t.lift),
      hung: (k += t.hang),
      hit: (k += t.slap),
      held: (k += t.hold),
      gone: (k += t.leave),
    };
    const c = this.c;
    const order = o.order ?? 'first';
    this.revealAt = order === 'slap' ? c.hit : order === 'lift' ? c.grabbed + t.lift * 0.5 : 0.05;
    this.pressAt = c.hit;
    this.chargeAt = c.hit;
    this.hitAt = c.hit;
    this.doneAt = this.hand ? c.gone : c.hit + 0.05;
    const floor = this.to.pos.clone().addScaledVector(up, (-TILE_T / 2) * s);
    this.pressPoint = floor.clone();
    this.hitPoint = floor.clone();
    this.chargePoint = this.to.pos.clone();
  }

  // 牌在手里的位置换到世界里（手的朝向是 q）
  private attach(q: THREE.Quaternion): THREE.Vector3 {
    return TILE_AT.clone().multiplyScalar(this.hs).applyQuaternion(q);
  }

  // 手拿着牌（牌在 pos、朝向 tq）时手在哪：牌面朝手背那边、牌顶朝指尖，手的朝向和牌一样
  private holding(pos: THREE.Vector3, tq: THREE.Quaternion): Key {
    return { pos: pos.clone().sub(this.attach(tq)), quat: tq.clone() };
  }

  // 牌跟着手
  private held(h: Key): SlamPose {
    return { pos: h.pos.clone().add(this.attach(h.quat)), quat: h.quat.clone(), scale: this.s };
  }

  private handAt(k: number): Key | null {
    const { c, t, s, up } = this;
    if (k < c.reached) {
      const f = easeInOut(clamp01(k / t.reach));
      const g = this.grabK!;
      return { pos: this.enterK.pos.clone().lerp(g.pos, f).addScaledVector(up, Math.sin(Math.PI * f) * 1.2 * s), quat: this.enterK.quat.clone().slerp(g.quat, f) };
    }
    if (k < c.grabbed) {
      // 夹住：手指往下一按
      const g = this.grabK!;
      return { pos: g.pos.clone().addScaledVector(up, -0.06 * s * Math.sin(Math.PI * clamp01((k - c.reached) / t.grab))), quat: g.quat.clone() };
    }
    if (k < c.lifted) {
      // 斜着举起来（自己的：从画面下面带着牌伸上来）
      const f = easeOut(clamp01((k - c.grabbed) / t.lift));
      const a = this.grabK ?? this.enterK;
      const ctrl = a.pos.clone().lerp(this.raiseK.pos, 0.5).addScaledVector(up, 0.8 * s);
      return { pos: bezier(a.pos, ctrl, this.raiseK.pos, f), quat: a.quat.clone().slerp(this.raiseK.quat, smooth(0, 0.9, f)) };
    }
    if (k < c.hung) {
      // 往后上方蓄一点劲
      const f = easeOut(clamp01((k - c.lifted) / t.hang));
      return { pos: this.raiseK.pos.clone().lerp(this.cockK.pos, f), quat: this.raiseK.quat.clone().slerp(this.cockK.quat, f) };
    }
    if (k < c.hit) {
      // 拍下去：越拍越快
      const f = clamp01((k - c.hung) / t.slap);
      const ctrl = this.slapK.pos.clone().addScaledVector(up, 2.2 * s).lerp(this.cockK.pos, 0.35);
      return { pos: bezier(this.cockK.pos, ctrl, this.slapK.pos, f * f), quat: this.cockK.quat.clone().slerp(this.slapK.quat, smooth(0, 0.8, f)) };
    }
    if (k < c.held) {
      // 按着，手掌往下一压
      const f = clamp01((k - c.hit) / t.hold);
      return { pos: this.slapK.pos.clone().addScaledVector(up, -0.04 * s * Math.sin(Math.PI * f)), quat: this.slapK.quat.clone() };
    }
    if (k < c.gone) {
      // 抬起来，往回撤出画面（牌留在桌上，牌面朝上）
      const f = clamp01((k - c.held) / t.leave);
      const ctrl = this.slapK.pos.clone().addScaledVector(up, 3 * s);
      return { pos: bezier(this.slapK.pos, ctrl, this.enterK.pos, f ** 1.4), quat: this.slapK.quat.clone().slerp(this.enterK.quat, easeInOut(f)) };
    }
    return null;
  }

  // 不带手：牌自己从原处跳到举起来的样子，停一下，拍下去
  private hopAt(k: number): SlamPose {
    const { c, t, s, up } = this;
    const from = this.from ?? this.to;
    const top = this.held(this.raiseK);
    const cock = this.held(this.cockK);
    if (k < c.lifted) {
      const f = clamp01(k / t.lift);
      const e = easeOut(f);
      return {
        pos: from.pos.clone().lerp(top.pos, e).addScaledVector(up, Math.sin(Math.PI * f) * 0.6 * s),
        quat: from.quat.clone().slerp(top.quat, smooth(0, 0.8, f)),
        scale: THREE.MathUtils.lerp(from.scale, s, e),
      };
    }
    if (k < c.hung) {
      const f = easeOut(clamp01((k - c.lifted) / t.hang));
      return { pos: top.pos.clone().lerp(cock.pos, f), quat: top.quat.clone().slerp(cock.quat, f), scale: s };
    }
    if (k < c.hit) {
      const f = clamp01((k - c.hung) / t.slap);
      return { pos: cock.pos.clone().lerp(this.to.pos, f * f), quat: cock.quat.clone().slerp(this.to.quat, smooth(0, 0.8, f)), scale: s };
    }
    return { ...this.to, pos: this.to.pos.clone(), quat: this.to.quat.clone() };
  }

  frame(k: number): { hand: Key | null; tile: SlamPose } {
    if (!this.hand) return { hand: null, tile: this.hopAt(k) };
    const hand = this.handAt(k);
    const { c } = this;
    let tile: SlamPose;
    if (k >= c.hit || !hand) tile = { pos: this.to.pos.clone(), quat: this.to.quat.clone(), scale: this.s };
    else if (this.from && k < c.grabbed) tile = { pos: this.from.pos.clone(), quat: this.from.quat.clone(), scale: this.from.scale };
    else {
      tile = this.held(hand);
      if (this.from) {
        // 刚夹起来：从她手里立着的样子转进指尖底下
        const w = smooth(0, 0.5, (k - c.grabbed) / this.t.lift);
        tile.pos.lerpVectors(this.from.pos, tile.pos, w);
        tile.quat.copy(this.from.quat.clone().slerp(tile.quat, w));
        tile.scale = THREE.MathUtils.lerp(this.from.scale, this.s, w);
      }
    }
    return { hand, tile };
  }
}
