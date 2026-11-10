import * as THREE from 'three';
import { TILE_H, TILE_T } from './tableLayout';
import { Key, SlamMotion, V, basis, bezier, clamp01, easeIn, easeInOut, easeOut, smooth } from './slamMath';
import type { SlamPose, SlamView } from './tileSlam';

// 竹井久的自摸（照原作的摔牌）：手伸到牌山上摸牌（指肚按着牌面盲牌），拿回来的半路上把牌背朝上、往自己这边仰 30 度，
// 一直这么背朝上拖到手牌右边；一下子翻过来（牌面朝上），手指一弹，牌翻着跟头飞上去，升到最高时总是牌面朝上；
// 手从上面扣住，连手带牌砸到桌上，炸开。牌最后牌面朝上躺在手牌右边（就是倒牌以后和了牌躺的地方，倒牌时它不用再动）。
// 「自摸一气呵成」：摸到就和的那一张不走摸牌路径，这一整段就是她的摸牌——from 是那张牌在牌山上的样子（哪一边的牌山都行），
// 手伸过去的、拿回来的时间照远近拉长一点；隔着桌子的牌山手不伸过去，牌自己飞到她手边，手在那里按住。
//
// 这里只算整段手和牌在哪（SlamMotion），手的模型、回调、影子都在 tileSlam.ts。
// 牌的朝向都从最后躺着的样子（to.quat：牌面朝上、牌顶朝桌子中间）绕这一家的右手方向（side）转出来：
// 转 180° 是牌背朝上、牌顶朝自己；再转 30° 是牌背往自己这边仰 30 度（靠自己的那条边贴着桌面）。

export interface FlickTiming {
  reach: number; // 手伸到牌山上（远的照距离拉长）
  take: number; // 指肚按住、拿起来
  carry: number; // 拿回来，半路上落到桌上、仰成 30 度（远的照距离拉长）
  drag: number; // 背朝上拖到手牌右边
  flip: number; // 一下子翻过来
  rise: number; // 弹上去：翻一个跟头升到最高
  hang: number; // 停在最高处，手从上面扣住
  slam: number; // 连手带牌砸下去
  hold: number; // 手按着停一下
  leave: number; // 手撤走
}

export const FLICK_TIMING: FlickTiming = { reach: 0.22, take: 0.07, carry: 0.17, drag: 0.28, flip: 0.13, rise: 0.32, hang: 0.13, slam: 0.08, hold: 0.14, leave: 0.3 };

export interface FlickSpec {
  to: SlamPose; // 最后牌面朝上躺在桌上的样子
  side: THREE.Vector3; // 这一家的右手方向（世界坐标，水平）
  out: THREE.Vector3; // 这一家往外（朝她自己身体）的方向
  from?: SlamPose; // 摸的那张现在在哪（牌山上，牌背朝上）。不给就当在落点前面三张牌远的牌山上
  hand: boolean; // false：不带手，牌自己从牌山上冒出来、滑过来、翻、跳、砸
  near?: boolean; // 自己砸牌（镜头就在她身后）
  cam?: SlamView; // 牌桌的镜头：最高处要在画面里（别家的牌在画面边上，往上弹会出画面，就往桌子中间挪、放低一点）
  timing?: Partial<FlickTiming>;
}

// 弹到最高处，画面上至少离落点多远（画面高度的一半算 1）
const MIN_RISE = 0.3;

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
// 往镜头这边挪、放低一点，挑挪得最少、画面上弹得看得出来的
function fitApex(F: THREE.Vector3, A: THREE.Vector3, cam: SlamView, s: number): THREE.Vector3 {
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
        const c0 = dx + dz + (1 - k) * 6;
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
// 食指、中指指肚中间那一点（按着牌背）
const PAD = V(-0.53, 3.6, -0.85);
// 手掌扣着牌面朝上的牌时，牌中心在哪：手心底下，靠手指那边一点
const PALM_TILE = V(0, 0.55, -0.58);
// 手从右后方伸过来：手指朝前、往左偏 YAW（弧度），拖牌时往下扎 GRIP_PITCH。
// 指肚按在牌背靠右的地方，手整个在牌的右边，自己看的时候不挡着牌
const GRIP_PITCH = 0.55;
const YAW = -0.6;
// 弹牌前手指扎得更低（指尖在牌靠自己那个右下角）
const FLICK_PITCH = 0.9;
// 手比通用那一套小一点（桌面上的动作，手太大会把牌整个盖住）
export const FLICK_HAND = 1.25;
// 弹上去多高、往自己这边飘多少（牌宽）；手在最高处的右边等着，往左一扣
const APEX = 10.5;
const APEX_OUT = 0;
// 别家（镜头从她对面、斜上方看过来）手等得高一点：不然手正好挡在牌和镜头中间
const WAIT_SIDE = 3.6;
const WAIT_UP = 0.5;
const WAIT_UP_FAR = 2.5;
// 拖牌时仰多少
const TILT = Math.PI / 6;

// 拖多远（牌宽）：牌山和手牌中间那条缝很窄（手牌那一排往前一点就是自己的牌山），往前拖会压到牌山上，
// 所以落在拖到的地方左边或者右边（牌是从哪边拿回来的就落在哪边）DRAG 张、往前 DRAG_IN 张，顺着那条缝横着拖过来
const DRAG = 2.4;
const DRAG_IN = 0.25;
// 手伸到牌山、拿回来，按远近拉长：离得是 REACH_REF / CARRY_REF 牌宽以内照 FLICK_TIMING，再远的照距离的平方根拉长，最多 REACH_MAX / CARRY_MAX 倍
const REACH_REF = 12;
const REACH_MAX = 2.2;
const CARRY_REF = 2.5;
const CARRY_MAX = 3;
// 离她（拖到的地方）这么多张牌宽以外的牌山（隔着桌子）：手不伸过去，牌自己飞到她手边 W 上方 PICK_UP 张高的地方，手在那里按住
const FAR_WALL = 16;
const PICK_UP = 0.9;

export class FlickMotion implements SlamMotion {
  readonly pressAt: number;
  readonly chargeAt: number;
  readonly chargeDur: number;
  readonly hitAt: number;
  readonly doneAt: number;
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
  private readonly fwd: THREE.Vector3;
  private readonly F: THREE.Vector3; // 最后躺着的牌中心
  private readonly Fq: THREE.Quaternion;
  private readonly P1: THREE.Vector3; // 拖到这里（仰着，靠自己那条边贴着桌面，正好在最后那张牌靠桌子中间那条边上）
  private readonly W: THREE.Vector3; // 半路上落到桌面开始拖的地方（P1 的左边或者右边）
  private readonly top: THREE.Vector3; // 手按住牌的地方：牌山上那张（牌中心）；隔着桌子的是她手边、W 上方
  private readonly topQ: THREE.Quaternion; // 那时牌的朝向（牌背朝上）
  private readonly topS: number; // 那时牌的大小
  private readonly fly: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number; dist: number } | null; // 隔着桌子的牌山上那张：自己飞到 top
  private readonly lift: THREE.Vector3; // 拿起来提到这里
  private readonly arc: THREE.Vector3; // 拿回来那一段弧线的控制点
  private readonly A: THREE.Vector3; // 最高处
  private readonly gripQ: THREE.Quaternion;
  private readonly flickQ: THREE.Quaternion;
  private readonly snapQ: THREE.Quaternion;
  private readonly catchQ: THREE.Quaternion;
  private readonly enter: Key;
  // 每一段多长、结束的时刻
  private readonly dur: { reach: number; carry: number };
  private readonly c: { reached: number; taken: number; carried: number; dragged: number; flipped: number; risen: number; hung: number; hit: number; held: number; gone: number };

  constructor(o: FlickSpec) {
    const t = (this.t = { ...FLICK_TIMING, ...o.timing });
    const s = (this.s = o.to.scale);
    this.hs = s * FLICK_HAND;
    this.hand = o.hand;
    const waitUp = o.near ? WAIT_UP : WAIT_UP_FAR;
    this.side = o.side.clone().normalize();
    this.out = o.out.clone().normalize();
    this.fwd = this.out.clone().negate();
    this.F = o.to.pos.clone();
    this.Fq = o.to.quat.clone();
    const { up, fwd, out, side } = this;
    const h = (TILE_H / 2) * s;
    const th = (TILE_T / 2) * s;
    // 最后那张牌靠桌子中间的那条边（桌面上）：拖过来时牌靠自己的那条边就停在这里，翻过来正好躺在落点
    const edge = this.F.clone().addScaledVector(fwd, h).setY(this.F.y - th);
    const q210 = this.q(Math.PI + TILT);
    const far = V(0, 1, 0).applyQuaternion(q210).negate();
    const back = V(0, 0, 1).applyQuaternion(q210).negate();
    this.P1 = edge.clone().addScaledVector(far, h).addScaledVector(back, th);
    // 牌山上那张：给了就是它现在的样子，不给就当在前面三张牌远、往左一点的牌山上
    const from = o.from ?? { pos: this.P1.clone().addScaledVector(fwd, 3.2 * s).addScaledVector(side, -1.2 * s).setY(TILE_T * 1.5 * s), quat: this.q(Math.PI), scale: s };
    // 半路落到桌面的地方：拖到的地方的左边或者右边（牌山上那张在哪边就落在哪边，正前方的从右边，手是右手）
    const lateral = from.pos.clone().sub(this.P1).dot(side) / s;
    this.W = this.P1.clone().addScaledVector(side, (lateral < -1 ? -1 : 1) * DRAG * s).addScaledVector(fwd, DRAG_IN * s);
    // 隔着桌子的牌山（离她 FAR_WALL 张以外）：手不伸过去，牌自己沿弧线飞到她手边（W 上方），手在那里按住
    const flat = (v: THREE.Vector3) => v.clone().setY(0);
    const dist = flat(from.pos).distanceTo(flat(this.P1));
    if (dist > FAR_WALL * s) {
      this.fly = { pos: from.pos.clone(), quat: from.quat.clone(), scale: from.scale, dist };
      this.top = this.W.clone().addScaledVector(up, PICK_UP * s);
      this.topQ = this.q(Math.PI);
      this.topS = s;
    } else {
      this.fly = null;
      this.top = from.pos.clone();
      this.topQ = from.quat.clone();
      this.topS = from.scale;
    }
    this.lift = this.top.clone().addScaledVector(up, 0.3 * s);
    // 远处的牌山：拿回来时在半空走一道弧，越远拱得越高（不擦着牌河过来）
    const span = this.lift.distanceTo(this.W);
    this.arc = this.lift.clone().lerp(this.W, 0.5).addScaledVector(up, 0.6 * s + 0.12 * span);
    const apex = this.F.clone().addScaledVector(up, APEX * s).addScaledVector(out, APEX_OUT * s);
    this.A = o.cam ? fitApex(this.F, apex, o.cam, s) : apex;
    // 手在最高处右边等着：出了画面（或者压着画面边上的头像框）就往牌这边靠、抬高一点
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
    this.gripQ = basis(pitched(GRIP_PITCH), up);
    this.flickQ = basis(pitched(FLICK_PITCH), up);
    this.snapQ = basis(pitched(0.15), up);
    this.catchQ = basis(pitched(0.04), up);
    // 手从她身前（拖到的地方后面、右边一点）伸进来、撤回去
    const home = this.grip(this.P1, q210);
    this.enter = { pos: home.pos.clone().addScaledVector(out, 10 * s).addScaledVector(side, 3 * s).addScaledVector(up, 2 * s), quat: basis(pitched(0.2), up) };
    const atWall = this.grip(this.top, this.topQ);
    const stretch = (d: number, ref: number, max: number) => Math.min(max, Math.max(1, Math.sqrt(d / (ref * s))));
    const reach = t.reach * stretch(this.enter.pos.distanceTo(atWall.pos), REACH_REF, REACH_MAX);
    this.dur = {
      // 牌自己飞过来的：飞得和平时摸牌差不多快，手先到、等着
      reach: this.fly ? Math.max(reach, THREE.MathUtils.clamp(0.2 + (0.012 * this.fly.dist) / s, 0.3, 0.55)) : reach,
      carry: t.carry * stretch(span, CARRY_REF, CARRY_MAX),
    };
    let k = 0;
    const c = {
      reached: (k += this.dur.reach),
      taken: (k += t.take),
      carried: (k += this.dur.carry),
      dragged: (k += t.drag),
      flipped: (k += t.flip),
      risen: (k += t.rise),
      hung: (k += t.hang),
      hit: (k += t.slam),
      held: (k += t.hold),
      gone: (k += t.leave),
    };
    this.c = c;
    this.pressAt = c.flipped;
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

  // 指肚按着牌背靠外那条边：牌在 pos、朝向 tq 时手在哪
  private grip(pos: THREE.Vector3, tq: THREE.Quaternion, quat = this.gripQ): Key {
    const h = (TILE_H / 2) * this.s;
    const th = (TILE_T / 2) * this.s;
    const back = V(0, 0, 1).applyQuaternion(tq).negate();
    const far = V(0, 1, 0).applyQuaternion(tq).negate();
    const contact = pos.clone().addScaledVector(back, th).addScaledVector(this.side, 0.3 * this.s).addScaledVector(far, 0.1 * h);
    return { pos: contact.sub(PAD.clone().multiplyScalar(this.hs).applyQuaternion(quat)), quat: quat.clone() };
  }

  // 手心扣着牌面朝上的牌：牌在 pos 时手在哪
  private palm(pos: THREE.Vector3, quat = this.catchQ): Key {
    return { pos: pos.clone().sub(PALM_TILE.clone().multiplyScalar(this.hs).applyQuaternion(quat)), quat: quat.clone() };
  }

  // 牌在第 k 秒：位置、朝向、大小
  private tileAt(k: number): SlamPose {
    const { c, t, s, up } = this;
    if (k < c.reached) {
      const fl = this.fly;
      if (!fl) return { pos: this.top.clone(), quat: this.topQ.clone(), scale: this.topS };
      // 隔着桌子的牌山：沿弧线飞过来，越远拱得越高，到了正好是背朝上、牌顶朝她
      const f = clamp01(k / this.dur.reach);
      const ctrl = fl.pos.clone().lerp(this.top, 0.5).addScaledVector(up, 1.5 * s + 0.12 * fl.dist);
      const e = easeInOut(f);
      return { pos: bezier(fl.pos, ctrl, this.top, e), quat: fl.quat.clone().slerp(this.topQ, smooth(0.1, 0.9, f)), scale: THREE.MathUtils.lerp(fl.scale, this.topS, e) };
    }
    if (k < c.taken) {
      // 指肚按住（盲牌），提起来
      const f = clamp01((k - c.reached) / t.take);
      return { pos: this.top.clone().lerp(this.lift, smooth(0, 1, f)), quat: this.topQ.clone(), scale: this.topS };
    }
    if (k < c.carried) {
      // 拿回来：在半空走一道弧落到半路的桌面上，一边转成她这边的方向，落下去的时候仰成 30 度
      const f = clamp01((k - c.taken) / this.dur.carry);
      const quat = this.topQ.clone().slerp(this.q(Math.PI), smooth(0, 0.6, f)).slerp(this.q(Math.PI + TILT), smooth(0.45, 1, f));
      return { pos: bezier(this.lift, this.arc, this.W, easeInOut(f)), quat, scale: THREE.MathUtils.lerp(this.topS, s, smooth(0, 0.8, f)) };
    }
    if (k < c.dragged) {
      // 背朝上拖过来
      const f = clamp01((k - c.carried) / t.drag);
      return { pos: this.W.clone().lerp(this.P1, easeInOut(f)), quat: this.q(Math.PI + TILT), scale: s };
    }
    if (k < c.flipped) {
      // 一下子翻过来：靠外那条边翻起来、越过头顶，牌面朝上落在落点
      const e = easeInOut(clamp01((k - c.dragged) / t.flip));
      return { pos: this.flipPos(e), quat: this.q(Math.PI + TILT + (Math.PI - TILT) * e), scale: s };
    }
    if (k < c.risen) {
      // 弹上去：靠自己那条边先翻起来，翻一整个跟头，升到最高时正好牌面朝上（越往上越慢）
      const f = clamp01((k - c.flipped) / t.rise);
      const lift = 1 - (1 - f) ** 2;
      const pos = this.F.clone().lerp(this.A, f).setY(THREE.MathUtils.lerp(this.F.y, this.A.y, lift));
      return { pos, quat: this.q(-Math.PI * 2 * f), scale: s };
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

  // 翻过来那一下牌在哪（e 是翻了多少，0 到 1）
  private flipPos(e: number): THREE.Vector3 {
    const h = (TILE_H / 2) * this.s;
    return this.P1.clone().lerp(this.F, e).addScaledVector(this.up, 0.45 * h * Math.sin(Math.PI * e));
  }

  private handAt(k: number, tile: SlamPose): Key | null {
    if (!this.hand) return null;
    const { c, t, s, up, out } = this;
    const h = (TILE_H / 2) * s;
    if (k < c.reached) {
      // 伸到牌山上：越远拱得越高
      const f = easeOut(clamp01(k / this.dur.reach));
      const at = this.grip(this.top, this.topQ);
      const ctrl = this.enter.pos.clone().lerp(at.pos, 0.6).addScaledVector(up, 1.5 * s + 0.05 * this.enter.pos.distanceTo(at.pos));
      return { pos: bezier(this.enter.pos, ctrl, at.pos, f), quat: this.enter.quat.clone().slerp(at.quat, smooth(0, 0.8, f)) };
    }
    if (k < c.taken) {
      // 指肚按下去（盲牌），再带着牌提起来
      const f = clamp01((k - c.reached) / t.take);
      const at = this.grip(tile.pos, tile.quat);
      at.pos.addScaledVector(up, -0.08 * s * Math.sin(Math.PI * Math.min(1, f * 2)));
      return at;
    }
    if (k < c.dragged) return this.grip(tile.pos, tile.quat);
    // 弹牌前：指尖在牌靠自己的那个右下角，贴着桌面
    const ready = (() => {
      const q = this.flickQ;
      const contact = this.F.clone().addScaledVector(out, h * 0.8).addScaledVector(this.side, 0.55 * s).setY(this.F.y + 0.05 * s);
      return { pos: contact.sub(PAD.clone().multiplyScalar(this.hs).applyQuaternion(q)), quat: q.clone() };
    })();
    if (k < c.flipped) {
      // 前一半指肚跟着牌背靠外那条边翻上去，后一半松开、退到牌靠自己那条边后面
      const f = clamp01((k - c.dragged) / t.flip);
      const e = easeInOut(Math.min(f, 0.45));
      const follow = this.grip(this.flipPos(e), this.q(Math.PI + TILT + (Math.PI - TILT) * e));
      const w = smooth(0.4, 1, f);
      const pos = follow.pos.lerp(ready.pos, w).addScaledVector(up, 1.2 * s * Math.sin(Math.PI * w));
      return { pos, quat: follow.quat.slerp(ready.quat, w) };
    }
    // 接牌的地方：在最高处的右边、高一点（牌升上去时手不挡着它）
    const side = this.side;
    const above = this.palm(this.A.clone().addScaledVector(up, this.waitUp * s).addScaledVector(side, this.waitSide * s));
    if (k < c.risen) {
      // 一弹：指尖往上一挑（手指甩上去），再升到最高处的上方，转成手心朝下
      const f = clamp01((k - c.flipped) / t.rise);
      const ctrl = ready.pos.clone().addScaledVector(up, 3.2 * s).addScaledVector(side, 1.5 * s);
      const pos = bezier(ready.pos, ctrl, above.pos, easeOut(f));
      const snap = smooth(0, 0.22, f);
      const quat = ready.quat.clone().slerp(this.snapQ, snap).slerp(above.quat, smooth(0.22, 0.85, f));
      return { pos, quat };
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
      return { pos: bezier(from.pos, ctrl, this.enter.pos, f ** 1.4), quat: from.quat.clone().slerp(this.enter.quat, easeInOut(f)) };
    }
    return null;
  }

  frame(k: number): { hand: Key | null; tile: SlamPose } {
    const tile = this.tileAt(k);
    return { hand: this.handAt(k, tile), tile };
  }
}
