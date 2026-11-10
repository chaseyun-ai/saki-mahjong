import * as THREE from 'three';
import { TILE_H, TILE_T } from './tableLayout';
import { COCKED, FLICKED, OPEN, mixPose, thumbNail } from './slamHand';
import { Key, SlamMotion, V, basis, bezier, clamp01, easeIn, easeInOut, easeOut, smooth } from './slamMath';
import type { SlamPose, SlamView } from './tileSlam';

// 竹井久的自摸（照原作的摔牌）：宣言自摸以后，手伸过来按住摸到的那张（from，自摸时是手里立着的那张：指肚按着牌顶），
// 拿起来一路不停：在半空拱过去、落到桌上，落下去时牌背朝上、往自己这边仰 30 度，接着背朝上拖到手牌右边；
// 一下子翻过来（牌面朝上落在桌上）——手牌同时倒下亮出来（revealAt）；手握成拳、立起来（大拇指那边朝上），
// 牌面朝上、稍微往前倾着放在大拇指指甲盖上（大拇指尖压在食指底下），停一下亮牌；大拇指一弹，牌翻着跟头飞上去，升到最高时总是牌面朝上；
// 手张开从上面扣住，连手带牌砸到桌上，炸开。牌最后牌面朝上躺在手牌右边（就是倒牌以后和了牌躺的地方，倒牌时它不用再动）。
// 不带手的时候牌不托起来，翻过来以后就在桌上停一下再自己跳上去。
// from 哪里都行（牌山上的也行）：离得太远的（隔着桌子）手不伸过去，牌自己沿弧线飞过来落到桌上，手在落桌的地方接住接着拖。
//
// 从拿起来到拖到手牌右边是一条连起来的路线（拱过去的弧线接上横着拖的那一段），按路程匀着走，只在起步、到头时快慢变化，中间不停。
// 这里只算整段手和牌在哪（SlamMotion），手的模型、回调、影子都在 tileSlam.ts。
// 牌的朝向从最后躺着的样子（to.quat：牌面朝上、牌顶朝桌子中间）绕这一家的右手方向（side）转出来：
// 转 180° 是牌背朝上、牌顶朝自己；再转 30° 是牌背往自己这边仰 30 度（靠自己的那条边贴着桌面）。

export interface FlickTiming {
  reach: number; // 手伸到那张牌上（远的照距离拉长）
  take: number; // 指肚按住
  move: number; // 拿回来、落桌、拖到手牌右边（一口气，远的照路程拉长）
  flip: number; // 一下子翻过来（手牌同时倒下）
  perch: number; // 握拳，把牌托到大拇指指甲盖上（不带手时没有这一段）
  show: number; // 牌面朝上在指甲盖上停一下亮牌
  rise: number; // 大拇指一弹：翻一个跟头升到最高
  hang: number; // 停在最高处，手从上面扣住
  slam: number; // 连手带牌砸下去
  hold: number; // 手按着停一下
  leave: number; // 手撤走
}

export const FLICK_TIMING: FlickTiming = { reach: 0.22, take: 0.08, move: 0.46, flip: 0.15, perch: 0.26, show: 0.34, rise: 0.4, hang: 0.13, slam: 0.09, hold: 0.14, leave: 0.3 };

export interface FlickSpec {
  to: SlamPose; // 最后牌面朝上躺在桌上的样子
  side: THREE.Vector3; // 这一家的右手方向（世界坐标，水平）
  out: THREE.Vector3; // 这一家往外（朝她自己身体）的方向
  from?: SlamPose; // 要拿的那张现在在哪（自摸时是手里立着的那张；牌山上背朝上的也行）。不给就当在落点前面三张牌远的牌山上
  hand: boolean; // false：不带手，牌自己从原处冒出来、滑过来、翻、跳、砸
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
// 食指、中指指肚中间那一点（按着牌背）
const PAD = V(-0.53, 3.6, -0.85);
// 手掌扣着牌面朝上的牌时，牌中心在哪：手心底下，靠手指那边一点
const PALM_TILE = V(0, 0.55, -0.58);
// 手从右后方伸过来：手指朝前、往左偏 YAW（弧度），拖牌时往下扎 GRIP_PITCH。
// 指肚按在牌背靠右的地方，手整个在牌的右边，自己看的时候不挡着牌
const GRIP_PITCH = 0.55;
const YAW = -0.6;
// 翻过来松手以后手指扎得更低（指尖在牌靠自己那个右下角），从这里握拳把牌托起来
const FLICK_PITCH = 0.9;
// 牌放在大拇指指甲盖上时往前倾多少（靠桌子中间那条边低，弧度）
const PERCH_TILT = 0.3;
// 拳头立在桌上：手掌中心离桌面多高（手模型的牌宽：小指那边到手掌中心，再留一条缝）
const FIST_REST = 1.3;
// 弹之前拳头往下沉一点蓄劲（牌宽），弹的时候往上一顿
const COCK_DIP = 0.16;
const FLICK_KICK = 0.55;
// 手比通用那一套小一点（桌面上的动作，手太大会把牌整个盖住）
export const FLICK_HAND = 1.25;
// 弹上去多高、往自己这边飘多少（牌宽）；手在最高处的右边等着，往左一扣
const APEX = 14;
const APEX_OUT = 0;
// 别家（镜头从她对面、斜上方看过来）手等得高一点：不然手正好挡在牌和镜头中间
const WAIT_SIDE = 3.6;
const WAIT_UP = 0.5;
const WAIT_UP_FAR = 2.5;
// 拖牌时仰多少
const TILT = Math.PI / 6;

// 拖多远（牌宽）：牌山和手牌中间那条缝很窄（手牌那一排往前一点就是自己的牌山），往前拖会压到牌山上，
// 所以落在拖到的地方左边或者右边（牌是从哪边拿回来的就落在哪边）DRAG 张、往前 DRAG_IN 张，顺着那条缝横着拖过来
const DRAG = 2.6;
const DRAG_IN = 0.25;
// 手伸到那张牌上：离得是 REACH_REF 牌宽以内照 FLICK_TIMING，再远的照距离的平方根拉长，最多 REACH_MAX 倍
const REACH_REF = 12;
const REACH_MAX = 2.2;
// 拿回来那一口气：路程 MOVE_REF 牌宽以内照 FLICK_TIMING，再远的照路程的平方根拉长，最多 MOVE_MAX 倍
const MOVE_REF = 5;
const MOVE_MAX = 2;
// 离她（拖到的地方）这么多张牌宽以外的牌山（隔着桌子）：手不伸过去，牌自己飞过来落桌，手在落桌的地方接住
const FAR_WALL = 16;
// 拿回来那一口气：起步加速占多少、到头减速占多少（中间匀速）
const MOVE_ACCEL = 0.22;
const MOVE_DECEL = 0.38;

// 先加速、匀速、再减速（t、返回值都是 0 到 1）：中间不停
function cruise(t: number): number {
  const a = MOVE_ACCEL;
  const d = MOVE_DECEL;
  const v = 1 / (1 - a / 2 - d / 2);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < a) return (v * t * t) / (2 * a);
  if (t < 1 - d) return v * (a / 2 + (t - a));
  return 1 - (v * (1 - t) ** 2) / (2 * d);
}

// 按路程取点的折线：pts 是一路的点，at(u) 是走了全程 u（0 到 1）时在哪
class Path {
  readonly length: number;
  private readonly cum: number[];
  constructor(private readonly pts: THREE.Vector3[]) {
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }
  // 第 i 个点走到了全程的几分之几
  frac(i: number): number {
    return this.length > 0 ? this.cum[i] / this.length : 0;
  }
  at(u: number): THREE.Vector3 {
    const d = clamp01(u) * this.length;
    let i = 1;
    while (i < this.pts.length - 1 && this.cum[i] < d) i++;
    const seg = this.cum[i] - this.cum[i - 1];
    return this.pts[i - 1].clone().lerp(this.pts[i], seg > 0 ? (d - this.cum[i - 1]) / seg : 1);
  }
}

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
  private readonly fwd: THREE.Vector3;
  private readonly F: THREE.Vector3; // 最后躺着的牌中心
  private readonly Fq: THREE.Quaternion;
  private readonly P1: THREE.Vector3; // 拖到这里（仰着，靠自己那条边贴着桌面，正好在最后那张牌靠桌子中间那条边上）
  private readonly W: THREE.Vector3; // 半路上落到桌面开始拖的地方（P1 的左边或者右边）
  private readonly top: THREE.Vector3; // 要拿的那张一开始在哪（牌中心）
  private readonly topQ: THREE.Quaternion; // 它一开始的朝向
  private readonly topS: number; // 它一开始的大小
  private readonly far: boolean; // 隔着桌子的：牌自己飞过来，手在落桌的地方接住
  private readonly path: Path; // 拿起来 → 拱过去 → 落桌（W）→ 拖到 P1
  private readonly landU: number; // 落桌那一下走了全程的几分之几
  private readonly landK: number; // 落桌是第几秒
  private readonly A: THREE.Vector3; // 最高处
  private readonly P: THREE.Vector3; // 放在大拇指指甲盖上时牌中心在哪（不带手就是落点）
  private readonly tilt: number; // 那时候往前倾多少
  private readonly fistQ: THREE.Quaternion; // 拳头立着（大拇指那边朝上）、跟牌一样往前倾
  private readonly gripQ: THREE.Quaternion;
  private readonly flickQ: THREE.Quaternion;
  private readonly catchQ: THREE.Quaternion;
  private readonly enter: Key;
  private readonly dur: { reach: number; take: number; move: number; perch: number };
  // 每一段结束的时刻
  private readonly c: { reached: number; taken: number; moved: number; flipped: number; perched: number; shown: number; risen: number; hung: number; hit: number; held: number; gone: number };

  constructor(o: FlickSpec) {
    const t = (this.t = { ...FLICK_TIMING, ...o.timing });
    const s = (this.s = o.to.scale);
    this.hs = s * FLICK_HAND;
    this.hand = o.hand;
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
    const farDir = V(0, 1, 0).applyQuaternion(q210).negate();
    const back = V(0, 0, 1).applyQuaternion(q210).negate();
    this.P1 = edge.clone().addScaledVector(farDir, h).addScaledVector(back, th);
    // 要拿的那张：给了就是它现在的样子，不给就当在前面三张牌远、往左一点的牌山上
    const from = o.from ?? { pos: this.P1.clone().addScaledVector(fwd, 3.2 * s).addScaledVector(side, -1.2 * s).setY(TILE_T * 1.5 * s), quat: this.q(Math.PI), scale: s };
    this.top = from.pos.clone();
    this.topQ = from.quat.clone();
    this.topS = from.scale;
    // 落桌的地方：拖到的地方的左边或者右边（那张牌在哪边就落在哪边，正前方的、就在跟前的从右边，手是右手）
    const lateral = this.top.clone().sub(this.P1).dot(side) / s;
    this.W = this.P1.clone().addScaledVector(side, (lateral < -1 ? -1 : 1) * DRAG * s).addScaledVector(fwd, DRAG_IN * s);
    const flat = (v: THREE.Vector3) => v.clone().setY(0);
    const span = flat(this.top).distanceTo(flat(this.W));
    this.far = flat(this.top).distanceTo(flat(this.P1)) > FAR_WALL * s;
    // 一路的点：提起来、拱过去（越远拱得越高，不擦着牌河），顺着拖的方向斜着落到 W，接着拖到 P1
    const dragDir = flat(this.P1.clone().sub(this.W)).normalize();
    const c1 = this.top.clone().addScaledVector(up, 1.0 * s + 0.12 * span);
    const c2 = this.W.clone().addScaledVector(dragDir, -Math.min(0.45 * span, 2.4 * s)).addScaledVector(up, 0.5 * s + 0.07 * span);
    const pts: THREE.Vector3[] = [];
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const a = this.top.clone().lerp(c1, u);
      const b = c1.clone().lerp(c2, u);
      const cc = c2.clone().lerp(this.W, u);
      pts.push(a.lerp(b, u).lerp(b.clone().lerp(cc, u), u));
    }
    for (let i = 1; i <= 12; i++) pts.push(this.W.clone().lerp(this.P1, i / 12));
    this.path = new Path(pts);
    this.landU = this.path.frac(N);
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
    this.gripQ = basis(pitched(GRIP_PITCH), up);
    this.flickQ = basis(pitched(FLICK_PITCH), up);
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
    // 手从她身前（拖到的地方后面、右边一点）伸进来、撤回去
    const home = this.grip(this.P1, q210);
    this.enter = { pos: home.pos.clone().addScaledVector(out, 10 * s).addScaledVector(side, 3 * s).addScaledVector(up, 2 * s), quat: basis(pitched(0.2), up) };
    const stretch = (d: number, ref: number, max: number) => Math.min(max, Math.max(1, Math.sqrt(d / (ref * s))));
    // 隔着桌子的：不伸手、不按，牌一开始就飞
    this.dur = {
      reach: this.far ? 0 : t.reach * stretch(this.enter.pos.distanceTo(this.hold(this.top, this.topQ).pos), REACH_REF, REACH_MAX),
      take: this.far ? 0 : t.take,
      move: t.move * stretch(this.path.length, MOVE_REF, MOVE_MAX),
      perch: this.hand ? t.perch : 0,
    };
    let k = 0;
    const c = {
      reached: (k += this.dur.reach),
      taken: (k += this.dur.take),
      moved: (k += this.dur.move),
      flipped: (k += t.flip),
      perched: (k += this.dur.perch),
      shown: (k += t.show),
      risen: (k += t.rise),
      hung: (k += t.hang),
      hit: (k += t.slam),
      held: (k += t.hold),
      gone: (k += t.leave),
    };
    this.c = c;
    // 落桌是第几秒：cruise 反过来找
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (cruise(m) < this.landU) lo = m;
      else hi = m;
    }
    this.landK = c.taken + lo * this.dur.move;
    // 翻过来落到桌上“嗒”一声，手牌同时倒下
    this.pressAt = c.flipped;
    this.revealAt = c.moved;
    this.flickAt = c.shown;
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

  // 拿着牌走的时候指肚按在哪：牌背朝上（躺着、仰着）的按牌背（grip）；立着的（自摸时手里那张）按牌顶那条边，
  // 手在牌靠自己这边、上面，不穿过牌。从立着倒成背朝上的路上慢慢换过去
  private hold(pos: THREE.Vector3, tq: THREE.Quaternion): Key {
    const lying = this.grip(pos, tq);
    const back = V(0, 0, 1).applyQuaternion(tq).negate();
    const w = smooth(0.55, 0.85, back.dot(this.up));
    if (w >= 1) return lying;
    const top = V(0, 1, 0).applyQuaternion(tq);
    const contact = pos.clone().addScaledVector(top, (TILE_H / 2) * this.s).addScaledVector(this.side, 0.3 * this.s);
    const edge = contact.sub(PAD.clone().multiplyScalar(this.hs).applyQuaternion(this.gripQ));
    return { pos: edge.lerp(lying.pos, w), quat: lying.quat };
  }

  // 握着拳、牌放在大拇指指甲盖上：牌在 pos、朝向 tq 时手在哪（指甲盖贴着牌底正中间）
  private fist(pos: THREE.Vector3, tq: THREE.Quaternion): Key {
    const under = pos.clone().addScaledVector(V(0, 0, 1).applyQuaternion(tq), -(TILE_T / 2) * this.s);
    return { pos: under.sub(thumbNail(COCKED).at.multiplyScalar(this.hs).applyQuaternion(this.fistQ)), quat: this.fistQ.clone(), pose: COCKED };
  }

  // 托起来那一段走了多少（f 是这一段过了几分之几）：牌先在桌上停一下，手握上来才离桌
  private lift(f: number): number {
    return smooth(0.22, 1, f);
  }

  // 放在指甲盖上的牌：托起来 e（0 在桌上，1 托到位），再往下沉 dip（牌宽）
  private perched(e: number, dip = 0): SlamPose {
    const pos = this.F.clone().lerp(this.P, e).addScaledVector(this.up, -dip * this.s);
    return { pos, quat: this.q(-this.tilt * e), scale: this.s };
  }

  // 弹之前蓄劲往下沉多少（f 是亮牌那一段过了几分之几）
  private dip(f: number): number {
    return this.hand ? COCK_DIP * smooth(0.5, 1, f) : 0;
  }

  // 手心扣着牌面朝上的牌：牌在 pos 时手在哪
  private palm(pos: THREE.Vector3, quat = this.catchQ): Key {
    return { pos: pos.clone().sub(PALM_TILE.clone().multiplyScalar(this.hs).applyQuaternion(quat)), quat: quat.clone() };
  }

  // 拿回来那一口气里，走了全程 u 时牌的样子：落桌之前一边转成她这边的方向、仰成 30 度，一边从原来的大小变成桌上的大小
  private along(u: number): SlamPose {
    const f = clamp01(u / this.landU);
    const quat = this.topQ.clone().slerp(this.q(Math.PI), smooth(0, 0.55, f)).slerp(this.q(Math.PI + TILT), smooth(0.4, 0.95, f));
    return { pos: this.path.at(u), quat, scale: THREE.MathUtils.lerp(this.topS, this.s, smooth(0, 0.8, f)) };
  }

  // 牌在第 k 秒：位置、朝向、大小
  private tileAt(k: number): SlamPose {
    const { c, t, s, up } = this;
    if (k < c.taken) return { pos: this.top.clone(), quat: this.topQ.clone(), scale: this.topS };
    if (k < c.moved) return this.along(cruise((k - c.taken) / this.dur.move));
    if (k < c.flipped) {
      // 一下子翻过来：靠外那条边翻起来、越过头顶，牌面朝上落在落点
      const e = easeInOut(clamp01((k - c.moved) / t.flip));
      return { pos: this.flipPos(e), quat: this.q(Math.PI + TILT + (Math.PI - TILT) * e), scale: s };
    }
    // 握拳把牌托到大拇指指甲盖上：牌面朝上、稍微往前倾
    if (k < c.perched) return this.perched(this.lift(clamp01((k - c.flipped) / this.dur.perch)));
    // 托着停一下亮牌，最后往下沉一点蓄劲
    if (k < c.shown) return this.perched(1, this.dip(clamp01((k - c.perched) / t.show)));
    if (k < c.risen) {
      // 弹上去：靠自己那条边先翻起来，翻一整个跟头，升到最高时正好牌面朝上（越往上越慢）
      const f = clamp01((k - c.shown) / t.rise);
      const lift = 1 - (1 - f) ** 2;
      const from = this.perched(1, this.dip(1)).pos;
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

  // 翻过来那一下牌在哪（e 是翻了多少，0 到 1）
  private flipPos(e: number): THREE.Vector3 {
    const h = (TILE_H / 2) * this.s;
    return this.P1.clone().lerp(this.F, e).addScaledVector(this.up, 0.45 * h * Math.sin(Math.PI * e));
  }

  private handAt(k: number, tile: SlamPose): Key | null {
    if (!this.hand) return null;
    const { c, t, s, up, out } = this;
    const h = (TILE_H / 2) * s;
    if (this.far && k < this.landK) {
      // 隔着桌子的：手伸到落桌的地方，牌落下来正好接住
      const f = easeOut(clamp01(k / Math.max(this.landK, 1e-3)));
      const land = this.along(this.landU);
      const at = this.grip(land.pos, land.quat);
      const ctrl = this.enter.pos.clone().lerp(at.pos, 0.6).addScaledVector(up, 1.5 * s);
      return { pos: bezier(this.enter.pos, ctrl, at.pos, f), quat: this.enter.quat.clone().slerp(at.quat, smooth(0, 0.8, f)) };
    }
    if (k < c.reached) {
      // 伸到那张牌上：越远拱得越高
      const f = easeOut(clamp01(k / this.dur.reach));
      const at = this.hold(this.top, this.topQ);
      const ctrl = this.enter.pos.clone().lerp(at.pos, 0.6).addScaledVector(up, 1.5 * s + 0.05 * this.enter.pos.distanceTo(at.pos));
      return { pos: bezier(this.enter.pos, ctrl, at.pos, f), quat: this.enter.quat.clone().slerp(at.quat, smooth(0, 0.8, f)) };
    }
    if (k < c.taken) {
      // 指肚按下去（盲牌）
      const f = clamp01((k - c.reached) / this.dur.take);
      const at = this.hold(tile.pos, tile.quat);
      at.pos.addScaledVector(up, -0.08 * s * Math.sin(Math.PI * f));
      return at;
    }
    if (k < c.moved) return this.hold(tile.pos, tile.quat);
    // 翻过来松手以后：指尖在牌靠自己的那个右下角，贴着桌面
    const ready = (() => {
      const q = this.flickQ;
      const contact = this.F.clone().addScaledVector(out, h * 0.8).addScaledVector(this.side, 0.55 * s).setY(this.F.y + 0.05 * s);
      return { pos: contact.sub(PAD.clone().multiplyScalar(this.hs).applyQuaternion(q)), quat: q.clone() };
    })();
    if (k < c.flipped) {
      // 前一半指肚跟着牌背靠外那条边翻上去，后一半松开、退到牌靠自己那条边后面
      const f = clamp01((k - c.moved) / t.flip);
      const e = easeInOut(Math.min(f, 0.45));
      const follow = this.grip(this.flipPos(e), this.q(Math.PI + TILT + (Math.PI - TILT) * e));
      const w = smooth(0.4, 1, f);
      const pos = follow.pos.lerp(ready.pos, w).addScaledVector(up, 1.2 * s * Math.sin(Math.PI * w));
      return { pos, quat: follow.quat.slerp(ready.quat, w) };
    }
    if (k < c.perched) {
      // 握拳、立起来，把牌托到大拇指指甲盖上：手指先卷起来，手跟着牌一起抬到位
      const f = clamp01((k - c.flipped) / this.dur.perch);
      const e = this.lift(f);
      const tile0 = this.perched(e);
      const at = this.fist(tile0.pos, tile0.quat);
      const w = smooth(0, 0.85, f);
      const pos = ready.pos.clone().lerp(at.pos, w).addScaledVector(up, 0.5 * s * Math.sin(Math.PI * w));
      return { pos, quat: ready.quat.clone().slerp(at.quat, w), pose: mixPose(OPEN, COCKED, smooth(0, 0.7, f)) };
    }
    // 亮牌：牌在指甲盖上，拳头立着不动，最后跟着牌往下沉一点蓄劲
    if (k < c.shown) return this.fist(tile.pos, tile.quat);
    // 接牌的地方：在最高处的右边、高一点（牌升上去时手不挡着它）
    const side = this.side;
    const above = this.palm(this.A.clone().addScaledVector(up, this.waitUp * s).addScaledVector(side, this.waitSide * s));
    if (k < c.risen) {
      // 一弹：大拇指一下子挑直，拳头跟着往上一顿；停一下，再张开手升到最高处的上方，转成手心朝下
      const f = clamp01((k - c.shown) / t.rise);
      const cocked = this.perched(1, this.dip(1));
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
      return { pos: bezier(from.pos, ctrl, this.enter.pos, f ** 1.4), quat: from.quat.clone().slerp(this.enter.quat, easeInOut(f)) };
    }
    return null;
  }

  frame(k: number): { hand: Key | null; tile: SlamPose } {
    const tile = this.tileAt(k);
    return { hand: this.handAt(k, tile), tile };
  }
}
