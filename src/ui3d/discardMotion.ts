import * as THREE from 'three';
import { TILE_H, TILE_T, TILE_W } from './tableLayout';

// 出牌动作：给定参数和时间 t，算出这一刻手腕该在哪、伸手权重多少、牌在哪。
// 不保存任何状态，同样的参数和时间永远得到同样的姿势，所以牌桌和动作调试场景共用它，
// 暂停、慢放、拖时间轴都只是换一个 t。

export interface DiscardParams {
  reach: number; // 伸手到牌（秒）
  carry: number; // 拿着牌移到牌河（秒）
  settle: number; // 放下后停一下（秒）
  back: number; // 收手（秒）
  lift: number; // 搬运途中牌最多抬多高（世界单位，牌宽是 1）
  gripBack: number; // 手腕在接触点靠自己一侧多远（米，按人物比例换算）
  gripUp: number; // 手腕在接触点上方多高（米）
  arcMax: number; // 手离开休息位置时最多往上拱多高（米）
  leanMax: number; // 伸手时身体最多前倾多少（弧度）
  wristBend: number; // 伸出去的手腕往下弯多少（弧度）
}

export const DEFAULT_DISCARD: DiscardParams = {
  reach: 0.3,
  carry: 0.34,
  settle: 0.22,
  back: 0.4,
  lift: 2.2,
  gripBack: 0.08,
  gripUp: 0.06,
  arcMax: 0.1,
  leanMax: 0.62,
  wristBend: 0.35,
};

// 立直宣言牌：抬得更高，拍下去更快，停得更久
export const RIICHI_DISCARD: DiscardParams = { ...DEFAULT_DISCARD, reach: 0.28, carry: 0.26, settle: 0.3, lift: 3.4 };

// 2.5D 没有人物：牌直接从手里滑进牌河，不伸手也不收手，0.35 秒落桌（雀魂从点下去到落桌的节奏）
export const SLIDE_DISCARD: DiscardParams = { ...DEFAULT_DISCARD, reach: 0, carry: 0.35, settle: 0, back: 0, lift: 0.8 };
// 2.5D 的立直宣言牌：抬高一点再拍下去
export const SLIDE_RIICHI: DiscardParams = { ...SLIDE_DISCARD, lift: 2 };

// 出牌的样子：牌怎么从手里走到牌河里。place 是原来的那一种（平放；立直宣言牌是抬高重拍），其余是另做的几种。
// 快慢、抬多高还是看参数（styleParams 按样子调一遍），样子只管路线怎么走、落桌以后牌自己还动不动。
//   平常的牌：snap 拍（抬高了直着拍下去）、slide 滑（放在跟前往前一推）、spin 旋（手指一搓，牌在半空平着转一圈）、
//             toss 抛（半路松手，牌翻个跟头落下去弹两下）、stand 立倒（立着放下，往前一推倒成牌面朝上）
//   立直宣言牌：turn 转横（先竖着放下，按着转成横的）、top 陀螺（落在旁边像陀螺一样转，慢下来滑进位置）、
//             hold 举高（举到半空停一下再砸下去）、push 横推（横着放在右边，一把推过去靠上前一张）
export type DiscardStyle = 'place' | 'snap' | 'slide' | 'spin' | 'toss' | 'stand' | 'turn' | 'top' | 'hold' | 'push';
export const NORMAL_STYLES: DiscardStyle[] = ['place', 'snap', 'slide', 'spin', 'toss', 'stand'];
export const RIICHI_STYLES: DiscardStyle[] = ['place', 'turn', 'top', 'hold', 'push'];

// 落桌那一下多响：soft 轻轻放下，click 平常的一声，slap 重重拍下去
export type LandWeight = 'soft' | 'click' | 'slap';
// 落桌以后的动静：tap 牌又磕了一下桌子，slap 重的一下，scrape 贴着桌面滑，glint 举在半空闪一下，declare 立直宣言成立（放特效、拿立直棒）
export type CueKind = 'tap' | 'slap' | 'scrape' | 'glint' | 'declare';
export interface Cue {
  kind: CueKind;
  t: number;
}

interface StyleSpec {
  after: number; // 落桌以后牌自己还要动多久（秒）
  land: LandWeight;
  declare: number; // 立直宣言牌：落桌后多久算摆好（宣言成立）
  cues: [CueKind, number][]; // 落桌后多久有什么动静
  grip: number; // 手捏着牌到什么时候：小于 1 是搬运途中就松手（占搬运的几成），1 是落桌，大于 1 是落桌后再按 (grip - 1) 秒
  room: number; // 落点靠出牌的人这一侧至少要空出多宽（牌宽），不够就不能用这种
}

// 立倒：立着停多久、倒下去多久
const STAND_BEAT = 0.08;
const STAND_FALL = 0.22;
// 转横：放下停多久、转多久
const TURN_BEAT = 0.08;
const TURN_TIME = 0.22;
// 陀螺：落在位置右边多远、靠自己这边多远，转几圈、转多久
const TOP_SIDE = 1.62;
const TOP_NEAR = 0.2;
const TOP_TURNS = 2.25;
const TOP_TIME = 0.95;
// 横推：放在位置右边多远，停多久、推多久
const PUSH_SIDE = 1.25;
const PUSH_BEAT = 0.1;
const PUSH_TIME = 0.16;
// 滑：最多从跟前多远滑过去、滑多久
const SLIDE_DIST = 1.2;
const SLIDE_TIME = 0.2;
// 抛：落桌以后弹两下
const TOSS_HOP1 = 0.2;
const TOSS_HOP2 = 0.13;

const STYLES: Record<DiscardStyle, StyleSpec> = {
  place: { after: 0, land: 'click', declare: 0, cues: [], grip: 1, room: 0 },
  snap: { after: 0, land: 'slap', declare: 0, cues: [], grip: 1, room: 0 },
  slide: { after: SLIDE_TIME, land: 'soft', declare: 0, cues: [['scrape', 0]], grip: 1 + SLIDE_TIME, room: 0.5 },
  spin: { after: 0, land: 'click', declare: 0, cues: [], grip: 0.4, room: 0 },
  toss: { after: TOSS_HOP1 + TOSS_HOP2, land: 'click', declare: 0, cues: [['tap', TOSS_HOP1], ['tap', TOSS_HOP1 + TOSS_HOP2]], grip: 0.45, room: 0 },
  stand: { after: STAND_BEAT + STAND_FALL, land: 'soft', declare: 0, cues: [['tap', STAND_BEAT + STAND_FALL]], grip: 1 + STAND_BEAT, room: 0.85 },
  // （转到一半时牌角会伸到这一行外面一点，跟前要留点地方）
  turn: { after: TURN_BEAT + TURN_TIME, land: 'click', declare: TURN_BEAT + TURN_TIME, cues: [['scrape', TURN_BEAT]], grip: 1 + TURN_BEAT + TURN_TIME, room: 0.35 },
  top: { after: TOP_TIME, land: 'click', declare: 0, cues: [['scrape', 0], ['tap', TOP_TIME]], grip: 1, room: 0.5 },
  hold: { after: 0, land: 'slap', declare: 0, cues: [], grip: 1, room: 0 },
  push: { after: PUSH_BEAT + PUSH_TIME, land: 'soft', declare: PUSH_BEAT + PUSH_TIME, cues: [['scrape', PUSH_BEAT], ['slap', PUSH_BEAT + PUSH_TIME]], grip: 1 + PUSH_BEAT + PUSH_TIME, room: 0 },
};

export const landWeight = (style: DiscardStyle = 'place'): LandWeight => STYLES[style].land;
export const afterTime = (style: DiscardStyle = 'place'): number => STYLES[style].after;
export const declareDelay = (style: DiscardStyle = 'place'): number => STYLES[style].declare;
export const roomNeeded = (style: DiscardStyle = 'place'): number => STYLES[style].room;

// 这种出牌的快慢和抬多高：在基准参数上调。flat 是 2.5D（没有人物，牌自己飞，基准抬得很低）
export function styleParams(base: DiscardParams, style: DiscardStyle = 'place', flat = false): DiscardParams {
  const p = { ...base };
  const hand = (min: number) => (flat ? 0 : Math.max(p.settle, min)); // 手要按到牌不动了再收
  if (style === 'snap') {
    p.lift = Math.max(base.lift * 1.45, 1.9);
    p.carry = base.carry * 0.95;
    p.settle = flat ? 0 : base.settle + 0.08;
  } else if (style === 'slide') {
    p.lift = base.lift * 0.75;
    p.settle = hand(SLIDE_TIME + 0.05);
  } else if (style === 'spin') {
    p.lift = Math.max(base.lift * 1.25, 1.5);
    p.carry = base.carry * 1.2;
  } else if (style === 'toss') {
    p.lift = Math.max(base.lift * 1.3, 1.7);
    p.carry = base.carry * 1.12;
  } else if (style === 'stand') {
    p.lift = base.lift * 0.7;
    p.settle = hand(STAND_BEAT + 0.06);
  } else if (style === 'turn') {
    // 宣言牌先像平常的牌一样放下：不抬那么高，也不那么急
    p.lift = base.lift * 0.6;
    p.carry = base.carry * 1.25;
    p.settle = hand(TURN_BEAT + TURN_TIME + 0.1);
  } else if (style === 'top') {
    p.lift = base.lift * 0.65;
    p.carry = base.carry * 1.15;
  } else if (style === 'hold') {
    p.lift = Math.max(base.lift * 1.25, 3.2);
    p.carry = flat ? base.carry * 2.1 : base.carry * 2.9;
    p.settle = flat ? 0 : base.settle + 0.05;
  } else if (style === 'push') {
    p.lift = base.lift * 0.6;
    p.carry = base.carry * 1.2;
    p.settle = hand(PUSH_BEAT + PUSH_TIME + 0.1);
  }
  return p;
}

// 搬运途中牌转向牌河朝向的速度（每秒）
const TURN_RATE = 15.33;
// 伸手开始时手腕比接触点多抬多高、收手结束时抬多高（世界单位）
const REACH_RAISE = 0.8;
const BACK_RAISE = 0.6;

export type MarkerName = 'depart' | 'grab' | 'land' | 'release' | 'done';
export type DiscardPhase = 'reach' | 'carry' | 'settle' | 'back' | 'done';

export interface Marker {
  name: MarkerName;
  t: number;
}

// 一次出牌的起点终点。to 是牌河里的落点；landed 是已经放下的位置（之后牌被拿走手也停在这里）
export interface DiscardPath {
  from: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  to: THREE.Vector3;
  toQuat: THREE.Quaternion;
  landed?: THREE.Vector3;
  toward: THREE.Vector3; // 水平方向，从牌指向出牌的人
  scale: number; // 人物放大倍数，米换算成世界单位
  hold?: number; // 放下后额外停多久（荣和时放铳的手停住）
  style?: DiscardStyle; // 出牌的样子，不给是 place
  room?: number; // 落点靠出牌的人这一侧空着多宽（牌宽）；滑着放的要用，不给当作够宽
  spin?: number; // 这一次往哪边转：1 或 -1，不给是 1
}

export interface DiscardPose {
  phase: DiscardPhase;
  weight: number; // 0 手在休息位置，1 完全伸到手腕目标
  wrist: THREE.Vector3; // 手腕目标
  contact: THREE.Vector3; // 手指捏住牌的点（牌的中心）
  holding: boolean; // 牌是否跟着手走；false 时牌交给牌桌自己归位
  tilePos: THREE.Vector3;
  tileQuat: THREE.Quaternion;
}

const UP = new THREE.Vector3(0, 1, 0);
const smooth = (x: number) => x * x * (3 - 2 * x);
const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);

// 落桌以后牌自己还在动的（陀螺要转将近一秒），整个动作到牌停下才算完；2.5D 没有收手，也是等牌停
export function totalTime(p: DiscardParams, hold = 0, style: DiscardStyle = 'place'): number {
  return p.reach + p.carry + Math.max(p.settle + hold + p.back, afterTime(style));
}

// 出发、抓住、落桌、松手、收回的时刻
export function markers(p: DiscardParams, hold = 0, style: DiscardStyle = 'place'): Marker[] {
  return [
    { name: 'depart', t: 0 },
    { name: 'grab', t: p.reach },
    { name: 'land', t: p.reach + p.carry },
    { name: 'release', t: p.reach + p.carry + p.settle + hold },
    { name: 'done', t: totalTime(p, hold, style) },
  ];
}

// 已经报过 fired 个标记，到时刻 t 为止又经过了哪些（按顺序）。
// 一帧跨过好几个标记时全部按顺序报出来；t 传 Infinity 就是把剩下的全报完（动作被打断时用）
export function dueMarkers(p: DiscardParams, hold: number, fired: number, t: number, style: DiscardStyle = 'place'): Marker[] {
  const due: Marker[] = [];
  for (const m of markers(p, hold, style).slice(fired)) {
    // 时间是一帧帧累加出来的，差一点点浮点零头也算到了
    if (m.t > t + 1e-9) break;
    due.push(m);
  }
  return due;
}

// 落桌以后的动静各在什么时刻（从出发算起，按时间排好）。立直宣言成立（declare）每种样子都有一个
export function cues(p: DiscardParams, style: DiscardStyle = 'place'): Cue[] {
  const land = p.reach + p.carry;
  const spec = STYLES[style];
  const list: Cue[] = spec.cues.map(([kind, t]) => ({ kind, t: land + t }));
  // 举高：停在半空的时候闪一下
  if (style === 'hold') list.push({ kind: 'glint', t: p.reach + p.carry * HOLD_RISE });
  list.push({ kind: 'declare', t: land + spec.declare });
  return list.sort((a, b) => a.t - b.t);
}

export function dueCues(p: DiscardParams, fired: number, t: number, style: DiscardStyle = 'place'): Cue[] {
  const due: Cue[] = [];
  for (const c of cues(p, style).slice(fired)) {
    if (c.t > t + 1e-9) break;
    due.push(c);
  }
  return due;
}

export function phaseAt(p: DiscardParams, t: number, hold = 0, style: DiscardStyle = 'place'): DiscardPhase {
  if (t < p.reach) return 'reach';
  if (t < p.reach + p.carry) return 'carry';
  if (t < p.reach + p.carry + p.settle + hold) return 'settle';
  if (t <= totalTime(p, hold, style)) return 'back';
  return 'done';
}

// 手腕在接触点的后上方，手指正好捏住牌
function grip(p: DiscardParams, path: DiscardPath, at: THREE.Vector3, raise: number): THREE.Vector3 {
  return at
    .clone()
    .addScaledVector(path.toward, path.scale * p.gripBack)
    .addScaledVector(UP, path.scale * p.gripUp + raise);
}

export function sampleDiscard(p: DiscardParams, path: DiscardPath, t: number): DiscardPose {
  const hold = path.hold ?? 0;
  const style = path.style ?? 'place';
  if (style !== 'place') return sampleStyled(p, path, t, style);
  const phase = phaseAt(p, t, hold);
  const landed = path.landed ?? path.to;
  if (phase === 'reach') {
    // 伸手：先快后慢，最后一点点放慢对准
    const k = easeOut(Math.max(0, t) / p.reach);
    return {
      phase,
      weight: k,
      wrist: grip(p, path, path.from, (1 - k) * REACH_RAISE),
      contact: path.from.clone(),
      holding: true,
      tilePos: path.from.clone(),
      tileQuat: path.fromQuat.clone(),
    };
  }
  if (phase === 'carry') {
    // 拿起来沿弧线移过去，同时转成牌河里的朝向
    const tc = t - p.reach;
    const k = smooth(tc / p.carry);
    const pos = path.from.clone().lerp(path.to, k).addScaledVector(UP, Math.sin(k * Math.PI) * p.lift);
    const quat = path.fromQuat.clone().slerp(path.toQuat, 1 - Math.exp(-TURN_RATE * tc));
    return { phase, weight: 1, wrist: grip(p, path, pos, 0), contact: pos.clone(), holding: true, tilePos: pos, tileQuat: quat };
  }
  if (phase === 'settle') {
    return {
      phase,
      weight: 1,
      wrist: grip(p, path, landed, 0),
      contact: landed.clone(),
      holding: false,
      tilePos: landed.clone(),
      tileQuat: path.toQuat.clone(),
    };
  }
  // 没有收手（2.5D，back 是 0）时直接算收完了
  const k = phase === 'done' || p.back <= 0 ? 1 : smooth((t - p.reach - p.carry - p.settle - hold) / p.back);
  return {
    phase,
    weight: 1 - k,
    wrist: grip(p, path, landed, k * BACK_RAISE),
    contact: landed.clone(),
    holding: false,
    tilePos: landed.clone(),
    tileQuat: path.toQuat.clone(),
  };
}

// ---------- 另外几种出牌的样子 ----------

// 举高：搬运的前几成往上举，中间停在半空，最后一段砸下去
const HOLD_RISE = 0.42;
const HOLD_HANG = 0.8;

// 半路松手以后手停多久再收回去
const FOLLOW = 0.14;

const X = new THREE.Vector3(1, 0, 0);
const yawQ = (a: number) => new THREE.Quaternion().setFromAxisAngle(UP, a);
const easeOutBack = (x: number) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

interface TilePose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

// 横放的牌比摆正的时候多转了 e（弧度）：沿着这一行占多宽、跨行占多宽（各一半）
const halfAlong = (e: number) => (TILE_H * Math.abs(Math.cos(e)) + TILE_W * Math.abs(Math.sin(e))) / 2;
const halfAcross = (e: number) => (TILE_W * Math.abs(Math.cos(e)) + TILE_H * Math.abs(Math.sin(e))) / 2;

// 牌这一刻在哪：tc 是抓起来以后过了多久（搬运 + 落桌以后自己动的那一段）。end 是落点（落桌以后用已经放下的位置）
function tileAt(p: DiscardParams, path: DiscardPath, style: DiscardStyle, tc: number, end: THREE.Vector3): TilePose {
  const T = path.toward;
  const R = new THREE.Vector3().crossVectors(UP, T);
  const dir = path.spin ?? 1;
  const toQ = path.toQuat;
  const k = clamp01(tc / p.carry);
  const ta = tc - p.carry;
  // 搬运途中转向落桌姿势：和原来一样先快后慢，但落桌那一刻正好转完（后面还要接着动，不能差一点点）
  const turn = (q: THREE.Quaternion) => path.fromQuat.clone().slerp(q, (1 - Math.exp(-TURN_RATE * Math.min(tc, p.carry))) / (1 - Math.exp(-TURN_RATE * p.carry)));
  const arc = (to: THREE.Vector3, lift: number) => path.from.clone().lerp(to, smooth(k)).addScaledVector(UP, Math.sin(k * Math.PI) * lift);

  if (style === 'snap') {
    // 拍：先往前送到落点上方，再直着拍下去，越落越快
    const c = 0.55;
    const h = 1 - (1 - k) ** 2.2;
    const up = k < c ? smooth(k / c) : 1 - ((k - c) / (1 - c)) ** 2;
    return { pos: path.from.clone().lerp(end, h).addScaledVector(UP, up * p.lift), quat: turn(toQ) };
  }
  if (style === 'slide') {
    // 滑：放在落点跟前（靠自己这边、稍微偏右，右边是空的，左边有前一张），贴着桌面往前一推
    const d = Math.min(SLIDE_DIST, path.room ?? SLIDE_DIST);
    const near = end.clone().addScaledVector(T, d).addScaledVector(R, 0.12);
    if (ta <= 0) return { pos: arc(near, p.lift), quat: turn(toQ) };
    return { pos: near.lerp(end, easeOut(clamp01(ta / SLIDE_TIME))), quat: toQ.clone() };
  }
  if (style === 'spin') {
    // 旋：出手时手指一搓，牌平着转一整圈，越转越慢，落桌时正好转正
    return { pos: arc(end, p.lift), quat: yawQ(dir * 2 * Math.PI * (1 - easeOut(k))).multiply(turn(toQ)) };
  }
  if (style === 'toss') {
    // 抛：半路松手，牌翻一个跟头落下去，弹两下
    if (ta <= 0) {
      const pos = path.from.clone().lerp(end, k).addScaledVector(UP, 4 * k * (1 - k) * p.lift);
      const flip = new THREE.Quaternion().setFromAxisAngle(R, -2 * Math.PI * smooth(clamp01((k - 0.1) / 0.9)));
      return { pos, quat: flip.multiply(turn(toQ)) };
    }
    const [u, h, w] = ta < TOSS_HOP1 ? [ta / TOSS_HOP1, 0.34, 1] : [clamp01((ta - TOSS_HOP1) / TOSS_HOP2), 0.11, 0.4];
    const hop = 4 * u * (1 - u);
    // 弹起来的时候牌歪一下、稍微转一点，落回去摆正
    const tilt = new THREE.Quaternion().setFromAxisAngle(R, -0.22 * w * hop);
    return { pos: end.clone().addScaledVector(UP, h * hop), quat: yawQ(0.05 * dir * w * hop).multiply(tilt).multiply(toQ) };
  }
  if (style === 'stand') {
    // 立倒：牌立着放在落点靠自己那条边上，手指往前一推，绕着底边倒下去成牌面朝上
    const edge = new THREE.Vector3(0, -TILE_H / 2, -TILE_T / 2);
    const pivot = end.clone().add(edge.clone().applyQuaternion(toQ));
    const lean = (a: number) => toQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, a));
    const at = (q: THREE.Quaternion) => pivot.clone().sub(edge.clone().applyQuaternion(q));
    const up = lean(Math.PI / 2);
    if (ta <= 0) return { pos: arc(at(up), p.lift), quat: turn(up) };
    const u = clamp01((ta - STAND_BEAT) / STAND_FALL);
    const q = lean((Math.PI / 2) * (1 - u * u));
    return { pos: at(q), quat: q };
  }
  if (style === 'turn' || style === 'top') {
    // 这两种落桌以后牌贴着桌面转：多转的角度是 e 时，牌的左边不能越过前一张、里边不能压到上一行，
    // 所以转的时候中心跟着让开，转正了正好回到落点
    const spot = (e: number, dx = -Infinity, dz = 0) =>
      end
        .clone()
        .addScaledVector(R, Math.max(dx, halfAlong(e) - TILE_H / 2))
        .addScaledVector(T, Math.max(dz, halfAcross(e) - TILE_H / 2, 0));
    if (style === 'turn') {
      // 转横：先像平常的牌一样竖着放下，停一下，按着转成横的
      const e0 = -Math.PI / 2;
      if (ta <= 0) return { pos: arc(spot(e0), p.lift), quat: turn(yawQ(e0).multiply(toQ)) };
      const e = e0 * (1 - easeOutBack(clamp01((ta - TURN_BEAT) / TURN_TIME)));
      return { pos: spot(e), quat: yawQ(e).multiply(toQ) };
    }
    // 陀螺：落在位置右边空着的地方转起来，越转越慢，一边转一边滑向自己的位置
    const total = dir * TOP_TURNS * 2 * Math.PI;
    const side = spot(total, TOP_SIDE, TOP_NEAR);
    if (ta <= 0) return { pos: arc(side, p.lift), quat: turn(yawQ(total).multiply(toQ)) };
    const u = clamp01(ta / TOP_TIME);
    const e = total * (1 - u) ** 2.6;
    const glide = 1 - smooth(u) ** 1.4;
    return { pos: spot(e, TOP_SIDE * glide, TOP_NEAR * glide), quat: yawQ(e).multiply(toQ) };
  }
  if (style === 'hold') {
    // 举高：举到落点上方停一下（牌面朝自己这边仰着），再砸下去
    const apex = end.clone().addScaledVector(UP, p.lift).addScaledVector(T, 0.35);
    const hang = toQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.55));
    if (k < HOLD_RISE) {
      const u = easeOut(k / HOLD_RISE);
      return { pos: path.from.clone().lerp(apex, u), quat: path.fromQuat.clone().slerp(hang, u) };
    }
    if (k < HOLD_HANG) {
      const u = (k - HOLD_RISE) / (HOLD_HANG - HOLD_RISE);
      return { pos: apex.addScaledVector(UP, 0.16 * Math.sin(u * Math.PI)), quat: hang };
    }
    const u = (k - HOLD_HANG) / (1 - HOLD_HANG);
    return { pos: apex.lerp(end, u * u * u), quat: hang.slerp(toQ, clamp01(u * 1.5)) };
  }
  if (style === 'push') {
    // 横推：横着放在位置右边，停一下，一把推过去靠上前一张
    const side = end.clone().addScaledVector(R, PUSH_SIDE);
    if (ta <= 0) return { pos: arc(side, p.lift), quat: turn(toQ) };
    const u = clamp01((ta - PUSH_BEAT) / PUSH_TIME);
    return { pos: side.lerp(end, u ** 2.4), quat: toQ.clone() };
  }
  return { pos: arc(end, p.lift), quat: turn(toQ) };
}

// 手：捏着牌的时候跟着牌走，松手以后停在松手的地方，到该收手了再收回去
function sampleStyled(p: DiscardParams, path: DiscardPath, t: number, style: DiscardStyle): DiscardPose {
  const hold = path.hold ?? 0;
  const phase = phaseAt(p, t, hold, style);
  if (phase === 'reach') {
    const k = easeOut(Math.max(0, t) / p.reach);
    return {
      phase,
      weight: k,
      wrist: grip(p, path, path.from, (1 - k) * REACH_RAISE),
      contact: path.from.clone(),
      holding: true,
      tilePos: path.from.clone(),
      tileQuat: path.fromQuat.clone(),
    };
  }
  const spec = STYLES[style];
  const tc = t - p.reach;
  // 落桌以后照着已经放下的位置算（之后落点变了，比如被人鸣走，这里不跟着跳）
  const end = tc >= p.carry ? (path.landed ?? path.to) : path.to;
  const moving = tc < p.carry + spec.after;
  const tile = moving ? tileAt(p, path, style, tc, end) : { pos: end.clone(), quat: path.toQuat.clone() };
  // 松手的时刻（从抓起来算）
  const letGo = spec.grip <= 1 ? spec.grip * p.carry : p.carry + (spec.grip - 1);
  const held = tc <= letGo ? tile : tileAt(p, path, style, letGo, letGo >= p.carry ? end : path.to);
  const rest = held.pos;
  // 半路松手的（抛、旋）：手送出去顿一下就收，不用等牌落桌
  const backAt = (spec.grip < 1 ? Math.min(letGo + FOLLOW, p.carry + p.settle) : p.carry + p.settle) + hold;
  const k = tc <= backAt ? 0 : phase === 'done' || p.back <= 0 ? 1 : smooth(clamp01((tc - backAt) / p.back));
  return {
    phase,
    weight: 1 - k,
    wrist: grip(p, path, rest, k * BACK_RAISE),
    contact: rest.clone(),
    holding: moving,
    tilePos: tile.pos,
    tileQuat: tile.quat,
  };
}
