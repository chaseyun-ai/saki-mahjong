import * as THREE from 'three';
import { TILE_T } from './tableLayout';
import { COCKED, FLICKED, OPEN, mixPose, thumbNail } from './slamHand';
import { Key, SlamMotion, V, basis, bezier, clamp01, easeIn, easeInOut, easeOut, smooth } from './slamMath';
import type { SlamPose, SlamView } from './tileSlam';

// 竹井久的自摸（照原作的摔牌）：宣言自摸以后，握着拳的手（拳头立着，大拇指那边朝上、指尖压在食指底下）伸进来，
// 摸到的那张牌面朝上、稍微往前倾着放在大拇指指甲盖上，停在手牌右边亮牌——手牌同时倒下亮出来（revealAt）；
// 大拇指一弹，牌翻着跟头飞上去，升到最高时总是牌面朝上；手张开从上面扣住，连手带牌砸到桌上，炸开。
// 牌最后牌面朝上躺在手牌右边（就是倒牌以后和了牌躺的地方，倒牌时它不用再动）。
// 牌一开始就在指甲盖上跟着手进来；给了 from（别家：她手里立着的那张）就是手伸进来的路上牌从那里飘到指甲盖上。
// 不带手的时候牌从原处（from，不给就是落点）自己翻到落点、牌面朝上停一下，再跳上去砸下来。
//
// 这里只算整段手和牌在哪（SlamMotion），手的模型和手型在 slamHand.ts，回调、影子在 tileSlam.ts。
// 牌的朝向从最后躺着的样子（to.quat：牌面朝上、牌顶朝桌子中间）绕这一家的右手方向（side）转出来：
// 往负的方向转是靠桌子中间那条边低下去（往前倾），弹上去时接着往这边翻一整个跟头。

export interface FlickTiming {
  enter: number; // 握着拳托着牌伸进来（不带手：牌自己翻到落点）
  show: number; // 牌面朝上在指甲盖上停一下亮牌（手牌同时倒下）
  rise: number; // 大拇指一弹：翻一个跟头升到最高
  hang: number; // 停在最高处，手从上面扣住
  slam: number; // 连手带牌砸下去
  hold: number; // 手按着停一下
  leave: number; // 手撤走
}

export const FLICK_TIMING: FlickTiming = { enter: 0.3, show: 0.5, rise: 0.4, hang: 0.13, slam: 0.09, hold: 0.14, leave: 0.3 };

export interface FlickSpec {
  to: SlamPose; // 最后牌面朝上躺在桌上的样子
  side: THREE.Vector3; // 这一家的右手方向（世界坐标，水平）
  out: THREE.Vector3; // 这一家往外（朝她自己身体）的方向
  from?: SlamPose; // 那张牌现在在哪（她手里立着的那张）。不给就是牌一开始就在指甲盖上（自己自摸：跟着手从画面外进来）
  hand: boolean; // false：不带手，牌自己从原处翻到落点、跳、砸
  near?: boolean; // 自己砸牌（镜头就在她身后）
  cam?: SlamView; // 牌桌的镜头：最高处要在画面里（别家的牌在画面边上，往上弹会出画面，就往桌子中间挪、放低一点）
  timing?: Partial<FlickTiming>;
}

// 弹到最高处，画面上至少离落点多远（画面高度的一半算 1）
const MIN_RISE = 0.3;
// 最高处挪进画面时，放低一成算横着挪几张牌宽（自己的 / 别家的）
const LOWER_NEAR = 1.4;
const LOWER_FAR = 0.6;

// 牌桌镜头：世界坐标的点投到画面上（x、y 是 -1 到 1，z < 1 在镜头前面）
function projector(cam: SlamView): (v: THREE.Vector3) => THREE.Vector3 {
  const c = new THREE.PerspectiveCamera(cam.fov, cam.aspect, 0.1, 1000);
  c.position.copy(cam.pos);
  c.quaternion.copy(cam.quat);
  c.updateMatrixWorld();
  return (v) => v.clone().project(c);
}

// 最高处挪进画面：原样在画面里（离左右边、上下边都还有一段，不压着两边的头像框）、画面上离落点也够远就不动；
// 不然（落点在画面边上，往上弹会出画面；对家的牌在画面最上面，往上弹在画面上几乎不动）往画面中间横着挪、
// 往镜头这边挪、放低一点，挑挪得最少、画面上弹得看得出来的。lower：放低算挪了多少（自己砸牌时放低最显眼，算得重，宁可横着多挪一点）
function fitApex(F: THREE.Vector3, A: THREE.Vector3, cam: SlamView, s: number, lower: number): THREE.Vector3 {
  const ndc = projector(cam);
  const inside = (q: THREE.Vector3) => q.z < 1 && Math.abs(q.x) < 0.62 && q.y < 0.84 && q.y > -0.88;
  const f = ndc(F);
  // 画面上离落点不到 MIN_RISE 的，越近越算挪得多
  const short = (q: THREE.Vector3) => Math.max(0, MIN_RISE - Math.hypot((q.x - f.x) * cam.aspect, q.y - f.y)) * 20;
  const a = ndc(A);
  if (inside(a) && short(a) === 0) return A;
  const right = V(1, 0, 0).applyQuaternion(cam.quat).setY(0).normalize();
  const near = V(0, 0, 1).applyQuaternion(cam.quat).setY(0).normalize();
  const sx = a.x > 0 ? -1 : 1;
  const sz = a.y > 0 ? 1 : -1;
  const rise = A.y - F.y;
  let best: THREE.Vector3 | null = null;
  let cost = Infinity;
  for (let dx = 0; dx <= 10; dx++) {
    for (let dz = 0; dz <= 10; dz++) {
      for (const k of [1, 0.85, 0.7, 0.55, 0.45]) {
        const c0 = dx + dz + (1 - k) * 10 * lower;
        if (c0 >= cost) continue;
        const v = A.clone().addScaledVector(right, sx * dx * s).addScaledVector(near, sz * dz * s).setY(F.y + rise * k);
        const q = ndc(v);
        const c = c0 + short(q);
        if (!inside(q) || c >= cost) continue;
        cost = c;
        best = v;
      }
    }
  }
  return best ?? A.clone().setY(F.y + rise * 0.45);
}

// 手里坐标（手掌中心原点，+y 手指，+z 手背，单位是手模型的牌宽，乘 HAND_SCALE 才是世界里的牌宽）：
// 手掌扣着牌面朝上的牌时，牌中心在哪：手心底下，靠手指那边一点
const PALM_TILE = V(0, 0.55, -0.58);
// 手从右后方伸过来：手指朝前、往左偏 YAW（弧度）
const YAW = -0.6;
// 手比通用那一套小一点（桌面上的动作，手太大会把牌整个盖住）
export const FLICK_HAND = 1.25;
// 牌放在大拇指指甲盖上时往前倾多少（靠桌子中间那条边低，弧度）
const PERCH_TILT = 0.3;
// 拳头立在桌上：手掌中心离桌面多高（手模型的牌宽：小指那边到手掌中心，再留一条缝）
const FIST_REST = 1.36;
// 拳头从哪伸进来：比停的地方往她身上退多少、往右多少、高多少（牌宽）
const ENTER_OUT = 9;
const ENTER_SIDE = 2.5;
const ENTER_UP = 0.6;
// 弹之前拳头往下沉一点蓄劲（牌宽），弹的时候往上一顿
const COCK_DIP = 0.16;
const FLICK_KICK = 0.55;
// 弹上去多高、往自己这边飘多少（牌宽）；手在最高处的右边等着，往左一扣
const APEX = 14;
const APEX_OUT = 0;
// 别家（镜头从她对面、斜上方看过来）手等得高一点：不然手正好挡在牌和镜头中间
const WAIT_SIDE = 3.6;
const WAIT_UP = 0.5;
const WAIT_UP_FAR = 2.5;
// 不带手：牌自己翻到落点时拱多高（牌宽）
const HOP = 1.2;

export class FlickMotion implements SlamMotion {
  readonly pressAt: number;
  readonly chargeAt: number;
  readonly chargeDur: number;
  readonly hitAt: number;
  readonly doneAt: number;
  readonly revealAt: number;
  readonly flickAt: number; // 大拇指弹出去的时刻
  readonly pressPoint: THREE.Vector3;
  readonly chargePoint: THREE.Vector3;
  readonly hitPoint: THREE.Vector3;
  readonly handScale = FLICK_HAND;

  private readonly t: FlickTiming;
  private readonly s: number;
  private readonly hs: number; // 手的大小
  private readonly hand: boolean;
  private readonly waitUp: number;
  private readonly waitSide: number;
  private readonly side: THREE.Vector3;
  private readonly up = V(0, 1, 0);
  private readonly out: THREE.Vector3;
  private readonly F: THREE.Vector3; // 最后躺着的牌中心
  private readonly Fq: THREE.Quaternion;
  private readonly from: SlamPose | null; // 那张牌一开始在哪（没有就是一开始就在指甲盖上 / 落点）
  private readonly A: THREE.Vector3; // 最高处
  private readonly P: THREE.Vector3; // 放在大拇指指甲盖上时牌中心在哪（不带手就是落点）
  private readonly tilt: number; // 那时候往前倾多少
  private readonly fistQ: THREE.Quaternion; // 拳头立着（大拇指那边朝上）、跟牌一样往前倾
  private readonly catchQ: THREE.Quaternion;
  private readonly start: THREE.Vector3; // 拳头从这里伸进来（比停的地方差多少）
  private readonly exit: Key; // 拍完手往这里撤
  // 每一段结束的时刻
  private readonly c: { entered: number; shown: number; risen: number; hung: number; hit: number; held: number; gone: number };

  constructor(o: FlickSpec) {
    const t = (this.t = { ...FLICK_TIMING, ...o.timing });
    const s = (this.s = o.to.scale);
    this.hs = s * FLICK_HAND;
    this.hand = o.hand;
    this.side = o.side.clone().normalize();
    this.out = o.out.clone().normalize();
    this.F = o.to.pos.clone();
    this.Fq = o.to.quat.clone();
    this.from = o.from ? { pos: o.from.pos.clone(), quat: o.from.quat.clone(), scale: o.from.scale } : null;
    const { up, out, side } = this;
    const fwd = out.clone().negate();
    const th = (TILE_T / 2) * s;
    const apex = this.F.clone().addScaledVector(up, APEX * s).addScaledVector(out, APEX_OUT * s);
    this.A = o.cam ? fitApex(this.F, apex, o.cam, s, o.near ? LOWER_NEAR : LOWER_FAR) : apex;
    // 手在最高处右边等着：出了画面（或者压着画面边上的头像框）就往牌这边靠、抬高一点
    const waitUp = o.near ? WAIT_UP : WAIT_UP_FAR;
    let wait = { side: WAIT_SIDE, up: waitUp };
    if (o.cam) {
      const ndc = projector(o.cam);
      const fits = (w: { side: number; up: number }) => {
        const q = ndc(this.A.clone().addScaledVector(up, w.up * s).addScaledVector(side, (w.side + 1.2) * s));
        return q.z < 1 && Math.abs(q.x) < 0.72 && q.y < 0.9;
      };
      const tries = [WAIT_SIDE, 2.8, 2.1].flatMap((sd) => [0, 0.8, 1.6].map((u) => ({ side: sd, up: waitUp + u })));
      wait = tries.find(fits) ?? tries[tries.length - 1];
    }
    this.waitSide = wait.side;
    this.waitUp = wait.up;
    const yawed = fwd.clone().multiplyScalar(Math.cos(YAW)).addScaledVector(side, Math.sin(YAW));
    const pitched = (p: number) => yawed.clone().multiplyScalar(Math.cos(p)).addScaledVector(up, -Math.sin(p));
    this.catchQ = basis(pitched(0.04), up);
    // 拳头立着：手指那头朝前（照样往左偏），大拇指那边朝上，再跟牌一样往前倾
    this.tilt = this.hand ? PERCH_TILT : 0;
    const lean = new THREE.Quaternion().setFromAxisAngle(side, -this.tilt);
    this.fistQ = lean.clone().multiply(basis(yawed, up.clone().negate().cross(yawed)));
    // 牌放在指甲盖上的地方：就在落点正上方，高度是拳头立在桌上时指甲盖的高度
    this.P = this.F.clone();
    if (this.hand) {
      const nailUp = thumbNail(COCKED).at.multiplyScalar(this.hs).applyQuaternion(this.fistQ).y;
      this.P.y = this.F.y - th + FIST_REST * this.hs + nailUp + th * V(0, 0, 1).applyQuaternion(this.q(-this.tilt)).y;
    }
    // 拳头从她身前（右后方）伸进来；拍完手往那边撤
    this.start = out.clone().multiplyScalar(ENTER_OUT * s).addScaledVector(side, ENTER_SIDE * s).addScaledVector(up, ENTER_UP * s);
    this.exit = { pos: this.palm(this.F).pos.addScaledVector(out, 10 * s).addScaledVector(side, 3 * s).addScaledVector(up, 3 * s), quat: basis(pitched(0.2), up) };
    let k = 0;
    const c = {
      entered: (k += t.enter),
      shown: (k += t.show),
      risen: (k += t.rise),
      hung: (k += t.hang),
      hit: (k += t.slam),
      held: (k += t.hold),
      gone: (k += t.leave),
    };
    this.c = c;
    // 拳头停稳（不带手：牌翻到落点）那一下手牌倒下；大拇指弹出去“嗒”一声
    this.revealAt = c.entered;
    this.flickAt = c.shown;
    this.pressAt = c.shown;
    // 升到最高那一下亮一下（手扣上去之前就亮完）
    this.chargeAt = c.risen - 0.08;
    this.chargeDur = 0.07;
    this.hitAt = c.hit;
    this.doneAt = this.hand ? c.gone : c.hit + 0.05;
    const floor = this.F.clone().setY(this.F.y - th);
    this.pressPoint = floor.clone();
    this.hitPoint = floor.clone();
    this.chargePoint = this.A.clone();
  }

  // 最后躺着的样子绕右手方向转 theta
  private q(theta: number): THREE.Quaternion {
    return new THREE.Quaternion().setFromAxisAngle(this.side, theta).multiply(this.Fq);
  }

  // 握着拳、牌放在大拇指指甲盖上：牌在 pos、朝向 tq 时手在哪（指甲盖贴着牌底正中间）
  private fist(pos: THREE.Vector3, tq: THREE.Quaternion): Key {
    const under = pos.clone().addScaledVector(V(0, 0, 1).applyQuaternion(tq), -(TILE_T / 2) * this.s);
    return { pos: under.sub(thumbNail(COCKED).at.multiplyScalar(this.hs).applyQuaternion(this.fistQ)), quat: this.fistQ.clone(), pose: COCKED };
  }

  // 放在指甲盖上的牌：离停的地方还差 off（伸进来的路上），再往下沉 dip（牌宽）
  private perched(off = 0, dip = 0): SlamPose {
    const pos = this.P.clone().addScaledVector(this.start, off).addScaledVector(this.up, -dip * this.s);
    return { pos, quat: this.q(-this.tilt), scale: this.s };
  }

  // 伸进来还差多少（1 刚开始，0 到位）：越到头越慢
  private away(k: number): number {
    return 1 - easeOut(clamp01(k / this.t.enter));
  }

  // 弹之前蓄劲往下沉多少（f 是亮牌那一段过了几分之几）
  private dip(f: number): number {
    return this.hand ? COCK_DIP * smooth(0.6, 1, f) : 0;
  }

  // 手心扣着牌面朝上的牌：牌在 pos 时手在哪
  private palm(pos: THREE.Vector3, quat = this.catchQ): Key {
    return { pos: pos.clone().sub(PALM_TILE.clone().multiplyScalar(this.hs).applyQuaternion(quat)), quat: quat.clone() };
  }

  // 牌在第 k 秒：位置、朝向、大小
  private tileAt(k: number): SlamPose {
    const { c, t, s, up } = this;
    if (k < c.entered) {
      const f = clamp01(k / t.enter);
      // 带着手：牌在指甲盖上跟着拳头进来；给了 from 就是前半段从那里飘到指甲盖上
      const ride = this.perched(this.hand ? this.away(k) : 0);
      if (!this.from) return ride;
      const w = this.hand ? smooth(0, 0.55, f) : easeInOut(f);
      const pos = this.from.pos.clone().lerp(ride.pos, w);
      // 不带手：自己拱一下翻到落点
      if (!this.hand) pos.addScaledVector(up, HOP * s * Math.sin(Math.PI * w));
      return { pos, quat: this.from.quat.clone().slerp(ride.quat, w), scale: THREE.MathUtils.lerp(this.from.scale, s, w) };
    }
    // 托着停一下亮牌，最后往下沉一点蓄劲
    if (k < c.shown) return this.perched(0, this.dip(clamp01((k - c.entered) / t.show)));
    if (k < c.risen) {
      // 弹上去：靠自己那条边先翻起来，翻一整个跟头，升到最高时正好牌面朝上（越往上越慢）
      const f = clamp01((k - c.shown) / t.rise);
      const lift = 1 - (1 - f) ** 2;
      const from = this.perched(0, this.dip(1)).pos;
      const pos = from.clone().lerp(this.A, f).setY(THREE.MathUtils.lerp(from.y, this.A.y, lift));
      return { pos, quat: this.q(-this.tilt - (Math.PI * 2 - this.tilt) * f), scale: s };
    }
    if (k < c.hung) {
      const f = clamp01((k - c.risen) / t.hang);
      return { pos: this.A.clone().addScaledVector(up, 0.14 * s * easeOut(f)), quat: this.q(0), scale: s };
    }
    if (k < c.hit) {
      const f = clamp01((k - c.hung) / t.slam);
      return { pos: this.A.clone().addScaledVector(up, 0.14 * s).lerp(this.F, easeIn(f) * 0.6 + f * 0.4), quat: this.q(0), scale: s };
    }
    return { pos: this.F.clone(), quat: this.q(0), scale: s };
  }

  private handAt(k: number, tile: SlamPose): Key | null {
    if (!this.hand) return null;
    const { c, t, s, up, side } = this;
    // 伸进来：握着拳、立着，一路都是这个样子（牌在指甲盖上）
    if (k < c.entered) {
      const ride = this.perched(this.away(k));
      return this.fist(ride.pos, ride.quat);
    }
    // 亮牌：牌在指甲盖上，拳头立着不动，最后跟着牌往下沉一点蓄劲
    if (k < c.shown) return this.fist(tile.pos, tile.quat);
    // 接牌的地方：在最高处的右边、高一点（牌升上去时手不挡着它）
    const above = this.palm(this.A.clone().addScaledVector(up, this.waitUp * s).addScaledVector(side, this.waitSide * s));
    if (k < c.risen) {
      // 一弹：大拇指一下子挑直，拳头跟着往上一顿；停一下，再张开手升到最高处的上方，转成手心朝下
      const f = clamp01((k - c.shown) / t.rise);
      const cocked = this.perched(0, this.dip(1));
      const start = this.fist(cocked.pos, cocked.quat);
      const kicked = start.pos.clone().addScaledVector(up, FLICK_KICK * s * easeOut(clamp01(f / 0.16)));
      const ctrl = kicked.clone().addScaledVector(up, 3.2 * s).addScaledVector(side, 1.5 * s);
      const go = smooth(0.3, 1, f);
      const pos = bezier(kicked, ctrl, above.pos, go);
      const quat = start.quat.clone().slerp(above.quat, smooth(0.3, 0.9, f));
      const snap = easeOut(clamp01(f / 0.12));
      return { pos, quat, pose: mixPose(mixPose(COCKED, FLICKED, snap), OPEN, smooth(0.32, 0.75, f)) };
    }
    if (k < c.hung) {
      // 扣住：从右边、上面盖到牌上
      const f = smooth(0, 1, clamp01((k - c.risen) / t.hang));
      return this.palm(tile.pos.clone().addScaledVector(up, this.waitUp * s * (1 - f) + 0.5 * s * Math.sin(Math.PI * f)).addScaledVector(side, this.waitSide * s * (1 - f)));
    }
    if (k < c.held) {
      // 砸下去，按着停一下
      const at = this.palm(tile.pos);
      if (k >= c.hit) at.pos.addScaledVector(up, -0.03 * s * Math.sin(Math.PI * clamp01((k - c.hit) / t.hold)));
      return at;
    }
    if (k < c.gone) {
      // 提起来，往回撤出画面
      const f = clamp01((k - c.held) / t.leave);
      const from = this.palm(this.F);
      const ctrl = from.pos.clone().addScaledVector(up, 3.5 * s);
      return { pos: bezier(from.pos, ctrl, this.exit.pos, f ** 1.4), quat: from.quat.clone().slerp(this.exit.quat, easeInOut(f)) };
    }
    return null;
  }

  frame(k: number): { hand: Key | null; tile: SlamPose } {
    const tile = this.tileAt(k);
    return { hand: this.handAt(k, tile), tile };
  }
}
