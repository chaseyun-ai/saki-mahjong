import * as THREE from 'three';
import { TILE_H, TILE_T } from './tableLayout';
import { Key, SlamMotion, V, basis, bezier, clamp01, easeInOut, easeOut, smooth } from './slamMath';
import { SLAP_HAND, TILE_AT } from './slamSlap';
import type { SlamPose } from './tileSlam';

// 边缘切（现实里的“桌切”，很常见的自摸动作，通用的另一套）：手牌倒下之前，食指、无名指夹住牌的两边、中指指肚按着牌面，
// 把和了牌牌面朝上放在桌上，比手牌那条线靠桌子中间（前面没东西挡着就放远一点）；手带着牌贴着桌面往自己这边划，越划越快，
// 牌靠自己的那条边猛磕在边上（hitAt：放光、震屏、声音；边是桌框内沿，自己的桌框横屏时在画面外，就磕在画面底边上——table3d.ts 算），
// 手顺势往后上方甩开，
// 牌被弹回来、跳两下，牌面朝上停在手牌右边（restAt）；磕完手牌跟着倒下（revealAt）。
// 自己的牌一开始就在手里，手带着牌从画面下面伸进来；别人的手先伸过去把她手里立着的那张夹起来。
// 不带手：牌自己跳到桌上、滑过去磕在边上、弹回来。
// 手的样子和通用拍牌一样（slamSlap.ts：牌在指尖底下，牌顶朝指尖）。这里只算整段手和牌在哪（SlamMotion）。

export interface EdgeTiming {
  reach: number; // 别人的：手伸到她手里那张上
  grab: number; // 夹住
  enter: number; // 带着牌过来，牌面朝上放到桌上（自己的：从画面下面伸进来）
  set: number; // 按着停一下
  pull: number; // 往自己这边划，越划越快（划得远就照 PULL_MORE 加长）
  rebound: number; // 磕了以后牌弹回来、跳两下停住
  leave: number; // 手往后上方甩开、撤走
}

export const EDGE_TIMING: EdgeTiming = { reach: 0.3, grab: 0.07, enter: 0.36, set: 0.24, pull: 0.2, rebound: 0.48, leave: 0.4 };

export interface EdgeSpec {
  to: SlamPose; // 最后牌面朝上躺在桌上的样子（牌顶朝桌子中间）
  side: THREE.Vector3; // 这一家的右手方向（世界坐标，水平）
  out: THREE.Vector3; // 这一家往外（朝她自己身体）的方向
  rim: number; // 落点（牌中心）到磕的那条边有多远（顺着 out，世界单位）
  ahead?: number; // 一开始放在比落点靠桌子中间多少的地方（牌宽），不给是 AHEAD
  from?: SlamPose; // 要拿的那张现在在哪；不给就是牌一开始就在手里（自己自摸），跟着手从画面外伸进来
  hand: boolean; // false：不带手
  timing?: Partial<EdgeTiming>;
}

// 一开始放在比落点靠桌子中间多少的地方（牌宽）；前面没东西挡着时最多放这么远（table3d.ts 看着牌山、别人的牌定）
export const AHEAD = 1.5;
export const AHEAD_MAX = 3.2;
// 划得比 PULL_NEAR（牌宽）远时，每多一张牌宽多花多少秒，最多多花多少
const PULL_NEAR = 1.6;
const PULL_MORE = 0.045;
const PULL_MORE_MAX = 0.12;
// 别人的手夹她手里那张时手指往下扎多少（弧度）
const GRAB_PITCH = 0.5;
// 弹回来：第一下跳多高、第二下跳多高（牌宽），第一下占多少时间、第二下到什么时候落定
const HOP = 0.8;
const HOP2 = 0.16;
const HOP_SPLIT = 0.6;
const HOP_END = 0.88;
// 弹起来时靠自己那条边翘多少（弧度），第二下反着晃一点
const KICK = 0.5;
const KICK2 = 0.1;
// 磕上去以后牌顶着那条边停多久才弹开（秒；不停的话一帧都看不到牌挨着边）
const CONTACT = 0.035;
// 磕完手牌隔多久倒
const REVEAL_AFTER = 0.12;

export class EdgeMotion implements SlamMotion {
  readonly pressAt: number;
  readonly chargeAt: number;
  readonly chargeDur = 0;
  readonly hitAt: number;
  readonly restAt: number;
  readonly doneAt: number;
  readonly revealAt: number;
  readonly pullAt: number; // 开始往回划的时刻
  readonly pressPoint: THREE.Vector3;
  readonly chargePoint: THREE.Vector3;
  readonly hitPoint: THREE.Vector3;
  readonly handScale = SLAP_HAND;

  private readonly t: EdgeTiming;
  private readonly s: number;
  private readonly hs: number;
  private readonly hand: boolean;
  private readonly to: SlamPose;
  private readonly from: SlamPose | null;
  private readonly up = V(0, 1, 0);
  private readonly side: THREE.Vector3;
  private readonly S: THREE.Vector3; // 一开始放在桌上的地方（牌中心）
  private readonly R: THREE.Vector3; // 磕到边上时牌中心在哪
  private readonly enterK: Key; // 手从哪伸进来
  private readonly exitK: Key; // 磕完手甩到哪
  private readonly grabK: Key | null; // 夹住她手里那张的手
  private readonly c: { reached: number; grabbed: number; placed: number; set: number; hit: number; rested: number; gone: number };

  constructor(o: EdgeSpec) {
    const t = (this.t = { ...EDGE_TIMING, ...o.timing });
    const s = (this.s = o.to.scale);
    this.hs = s * SLAP_HAND;
    this.hand = o.hand;
    this.to = { pos: o.to.pos.clone(), quat: o.to.quat.clone(), scale: s };
    this.from = o.from ? { pos: o.from.pos.clone(), quat: o.from.quat.clone(), scale: o.from.scale } : null;
    this.side = o.side.clone().normalize();
    const out = o.out.clone().normalize();
    const { up } = this;
    const half = (TILE_H / 2) * s;
    const th = (TILE_T / 2) * s;
    // 磕到边上：牌靠自己的那条边顶着那条边（落点离它不到半张牌时就在落点磕）
    const back = Math.max(0, o.rim - half - 0.02 * s);
    this.S = this.to.pos.clone().addScaledVector(out, -(o.ahead ?? AHEAD) * s);
    this.R = this.to.pos.clone().addScaledVector(out, back);
    // 手指朝牌顶那边（桌子中间），翘 a 弧度
    const top = V(0, 1, 0).applyQuaternion(this.to.quat).setY(0).normalize();
    const pitched = (a: number) => basis(top.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a)), up.clone().multiplyScalar(Math.cos(a)).addScaledVector(top, -Math.sin(a)));
    const set = this.holding(this.S);
    this.enterK = { pos: set.pos.clone().addScaledVector(out, 9 * s).addScaledVector(up, 2.5 * s).addScaledVector(this.side, 1 * s), quat: pitched(0.35) };
    const hit = this.holding(this.R);
    this.exitK = { pos: hit.pos.clone().addScaledVector(out, 8 * s).addScaledVector(up, 4.5 * s).addScaledVector(this.side, 1.5 * s), quat: pitched(0.7) };
    this.grabK = null;
    if (this.from && this.hand) {
      const gq = pitched(-GRAB_PITCH);
      this.grabK = { pos: this.from.pos.clone().sub(this.attach(gq)).addScaledVector(up, 0.08 * s), quat: gq };
    }
    // 自己的（牌一开始在手里）、不带手：不用伸手去夹
    t.pull += Math.min(PULL_MORE_MAX, PULL_MORE * Math.max(0, this.S.distanceTo(this.R) / s - PULL_NEAR));
    const reach = this.grabK ? t.reach : 0;
    const grab = this.grabK ? t.grab : 0;
    let k = 0;
    const c = (this.c = {
      reached: (k += reach),
      grabbed: (k += grab),
      placed: (k += t.enter),
      set: (k += t.set),
      hit: (k += t.pull),
      rested: k + t.rebound,
      gone: k + t.leave,
    });
    // 放到桌上“嗒”一声；磕的那一下炸开，手牌跟着倒
    this.pressAt = c.placed;
    this.pullAt = c.set;
    this.chargeAt = c.hit;
    this.hitAt = c.hit;
    this.restAt = c.rested;
    this.revealAt = c.hit + REVEAL_AFTER;
    this.doneAt = (this.hand ? Math.max(c.rested, c.gone) : c.rested) + 0.02;
    this.pressPoint = this.S.clone().addScaledVector(up, -th);
    // 磕的地方：牌靠自己那条边底下的桌面
    this.hitPoint = this.R.clone().addScaledVector(out, half).addScaledVector(up, -th);
    this.chargePoint = this.R.clone();
  }

  // 牌在手里的位置换到世界里（手的朝向是 q）
  private attach(q: THREE.Quaternion): THREE.Vector3 {
    return TILE_AT.clone().multiplyScalar(this.hs).applyQuaternion(q);
  }

  // 手按着躺在 pos 的牌时手在哪：牌面朝手背那边、牌顶朝指尖，手的朝向和牌一样
  private holding(pos: THREE.Vector3): Key {
    return { pos: pos.clone().sub(this.attach(this.to.quat)), quat: this.to.quat.clone() };
  }

  // 牌跟着手
  private held(h: Key): SlamPose {
    return { pos: h.pos.clone().add(this.attach(h.quat)), quat: h.quat.clone(), scale: this.s };
  }

  // 贴着桌面躺着的牌
  private lying(pos: THREE.Vector3): SlamPose {
    return { pos, quat: this.to.quat.clone(), scale: this.s };
  }

  // 往回划了多少（f 是这一段过了几分之几）：越划越快
  private pulled(f: number): THREE.Vector3 {
    return this.S.clone().lerp(this.R, clamp01(f) ** 2.2);
  }

  // 弹回来（u 是这一段过了几分之几）：第一下跳得高、靠自己那条边翘起来，第二下小跳，落定在落点
  private bounced(u: number): SlamPose {
    const { s, up } = this;
    if (u >= 1) return this.lying(this.to.pos.clone());
    // 先顶着边停一瞬
    const c = CONTACT / this.t.rebound;
    if (u <= c) return this.lying(this.R.clone());
    u = (u - c) / (1 - c);
    const pos = this.R.clone().lerp(this.to.pos, 1 - (1 - Math.min(1, u / HOP_END)) ** 2);
    let lift = 0;
    let tip = 0;
    if (u < HOP_SPLIT) {
      const a = Math.sin(Math.PI * (u / HOP_SPLIT));
      lift = HOP * a;
      tip = -KICK * a;
    } else if (u < HOP_END) {
      const a = Math.sin(Math.PI * ((u - HOP_SPLIT) / (HOP_END - HOP_SPLIT)));
      lift = HOP2 * a;
      tip = KICK2 * a;
    }
    pos.addScaledVector(up, lift * s);
    return { pos, quat: new THREE.Quaternion().setFromAxisAngle(this.side, tip).multiply(this.to.quat), scale: s };
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
    const set = this.holding(this.S);
    if (k < c.placed) {
      // 带着牌过来，从上面放到桌上（自己的：从画面下面伸进来）
      const f = easeOut(clamp01((k - c.grabbed) / t.enter));
      const a = this.grabK ?? this.enterK;
      const ctrl = a.pos.clone().lerp(set.pos, 0.6).addScaledVector(up, 2.2 * s);
      return { pos: bezier(a.pos, ctrl, set.pos, f), quat: a.quat.clone().slerp(set.quat, smooth(0, 0.85, f)) };
    }
    if (k < c.set) {
      // 按着停一下：往下一压，最后往前送一点蓄劲
      const f = clamp01((k - c.placed) / t.set);
      return { pos: set.pos.clone().addScaledVector(up, -0.04 * s * Math.sin(Math.PI * Math.min(1, f * 2))), quat: set.quat };
    }
    if (k < c.hit) return this.holding(this.pulled((k - c.set) / t.pull));
    if (k < c.gone) {
      // 磕完顺势往后上方甩开，撤出画面
      const f = clamp01((k - c.hit) / t.leave);
      const hit = this.holding(this.R);
      const ctrl = hit.pos.clone().lerp(this.exitK.pos, 0.35).addScaledVector(up, 2.5 * s);
      return { pos: bezier(hit.pos, ctrl, this.exitK.pos, easeOut(f)), quat: hit.quat.clone().slerp(this.exitK.quat, smooth(0, 0.6, f)) };
    }
    return null;
  }

  // 不带手：牌自己从原处跳到桌上
  private hopAt(k: number): SlamPose {
    const from = this.from ?? this.lying(this.S.clone());
    const f = clamp01(k / this.t.enter);
    const e = easeOut(f);
    return {
      pos: from.pos.clone().lerp(this.S, e).addScaledVector(this.up, Math.sin(Math.PI * f) * 0.7 * this.s),
      quat: from.quat.clone().slerp(this.to.quat, smooth(0, 0.8, f)),
      scale: THREE.MathUtils.lerp(from.scale, this.s, e),
    };
  }

  frame(k: number): { hand: Key | null; tile: SlamPose } {
    const { c, t } = this;
    const hand = this.hand ? this.handAt(k) : null;
    let tile: SlamPose;
    if (k >= c.hit) tile = this.bounced((k - c.hit) / t.rebound);
    else if (k >= c.set) tile = this.lying(this.pulled((k - c.set) / t.pull));
    else if (k >= c.placed) tile = this.lying(this.S.clone());
    else if (!this.hand) tile = this.hopAt(k);
    else if (this.from && k < c.grabbed) tile = { pos: this.from.pos.clone(), quat: this.from.quat.clone(), scale: this.from.scale };
    else {
      tile = this.held(hand!);
      if (this.from) {
        // 刚夹起来：从她手里立着的样子转进指尖底下
        const w = smooth(0, 0.5, (k - c.grabbed) / t.enter);
        tile.pos.lerpVectors(this.from.pos, tile.pos, w);
        tile.quat.copy(this.from.quat.clone().slerp(tile.quat, w));
        tile.scale = THREE.MathUtils.lerp(this.from.scale, this.s, w);
      }
    }
    return { hand, tile };
  }
}
