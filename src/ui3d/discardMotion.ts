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

// 某一次出牌用的参数：在上面那些之外，还带着这一次才知道的量（styleParams 填）
export interface DiscardMotion extends DiscardParams {
  pushDist?: number; // 横推：横着放在落点右边多远再推过来（牌宽），不给是 PUSH_SIDE。远的推得久
  pushBrake?: boolean; // 横推·刹车：一把推出去，快到位了刹住（不撞前一张）
  pushHit?: boolean; // 横推：左边有前一张牌，推到头撞上去（越推越快，撞上就停）；没有就自己刹住
  flingFrom?: THREE.Vector3; // 回旋：牌放到桌上哪里开始滑（桌角，世界坐标），不给是落点右边、跟前的默认位置
  flingVia?: THREE.Vector3; // 回旋：弧线的控制点（二次贝塞尔，世界坐标），牌桌照着绕开牌山算好给进来；不给是默认的弧
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
//             hold 举高（举到半空停一下再砸下去）、push 横推（横着放在右边，往回带一点再猛地推过去，撞上前一张）、
//             brake 横推·刹车（横着放在右边两个牌宽的地方，右边微微翘起、左边贴着桌面，一把推出去，快到位了刹住，
//             放平了轻轻停在前一张旁边，不撞）
//   弃用的（设置里没有、随机也不抽，留着代码，要用的时候放回下面两张表就行）：
//             出牌的 snap 拍下、slide 滑推、spin 旋转、toss 轻抛、stand 立倒；立直的 top 陀螺、hold 举高、push 横推（猛推撞歪前一张）
//   角色自己的：fling 回旋（大星淡的双立直：牌面朝上放在她右手边的桌角，贴着桌面甩出去，像陀螺一样转着走一道圆弧滑到牌河第一格）。
//             不在设置里，也不随机抽，牌桌看是谁、是不是双立直、路上有没有牌山挡着来用
export type DiscardStyle = 'place' | 'snap' | 'slide' | 'spin' | 'toss' | 'stand' | 'turn' | 'top' | 'hold' | 'push' | 'brake' | 'fling';
// 设置里能选、随机会抽到的那些（角色自己的那一套不算）
export type CommonStyle = Exclude<DiscardStyle, 'fling'>;
export const NORMAL_STYLES: CommonStyle[] = ['place'];
export const RIICHI_STYLES: CommonStyle[] = ['place', 'turn', 'brake'];
// 横推的两种（猛推、刹车）：横着放在右边再推过来的那一套时刻、路线是共用的
export const isPush = (style: DiscardStyle | undefined): boolean => style === 'push' || style === 'brake';

// 落桌那一下多响：soft 轻轻放下，click 平常的一声，slap 重重拍下去
export type LandWeight = 'soft' | 'click' | 'slap';
// 落桌以后的动静：tap 牌又磕了一下桌子，slap 重的一下，scrape 贴着桌面滑，glint 举在半空闪一下，
// knock 横推的牌撞上前一张（前一张被撞歪一点），declare 立直宣言成立（放特效、拿立直棒）
export type CueKind = 'tap' | 'slap' | 'scrape' | 'glint' | 'knock' | 'declare';
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
// 横推：最少放在位置右边多远，放下停多久；先往回带多远（牌宽）、带多久，再猛地推过去：
// 推多久 = PUSH_BASE + 每个牌宽 PUSH_PER（远的推得久一点，但快得多）；越推越快的劲头（指数，越大起步越慢、到头越猛）
const PUSH_SIDE = 1.25;
const PUSH_BEAT = 0.1;
const PUSH_BACK = 0.2;
const PUSH_WIND = 0.13;
const PUSH_BASE = 0.14;
const PUSH_PER = 0.035;
const PUSH_POWER = 2.6;
// 左边没有牌可撞（一行的第一张）：推到这几成开始自己刹住
const PUSH_BRAKE = 0.72;
// 推多远照宣言牌落在一行里的第几格算：越靠左推得越远，第 1 格最远（PUSH_MAX 个牌宽：一行通常 6 张，
// 推过半行就显得太长了），到第 PUSH_NEAR_COL 格（0 起）往右都只推 PUSH_SIDE
const PUSH_MAX = 3;
const PUSH_NEAR_COL = 5;
// 横推·刹车：推多久 = BRAKE_BASE + 每个牌宽 BRAKE_PER（比猛推的久一点，后面一大半都在刹）；
// 前 BRAKE_RAMP 成的时间是起步（越来越快），之后一路刹到停；刹车的劲头（指数，越大起步越冲、后面拖得越长）
const BRAKE_BASE = 0.2;
const BRAKE_PER = 0.05;
const BRAKE_RAMP = 0.22;
const BRAKE_DRAG = 2.6;
// 刹车的那一种从哪儿推：不管落在第几格，都放在落点右边约两个牌宽的地方
export const BRAKE_DIST = 2;
// 放下时右边翘起多少（弧度，绕左边那条贴着桌面的棱）；推的时候跟着放平，推到位正好平了
const BRAKE_TILT = 0.21;
// 回旋（淡的双立直）：牌面朝上放到右手边的桌角，贴着桌面甩出去，转着滑一道弧线到落点。
// 贴着桌面滑多久；一共转几圈（整数圈：放下时就是横的，停下也是横的）；越滑越慢、越转越慢的劲头（指数）；
// 牌桌没给起点时，起点在落点右边多远、靠自己这边多远；弧线原本想走成多弯（见 flingBow）
export const FLING_SLIDE = 0.85;
export const FLING_TURNS = 4;
const FLING_DRAG = 2.3;
// 转得比滑得收得慢一点：四圈在 0.85 秒里转完，开头不至于快到一帧转过小半圈
const FLING_SPIN_DRAG = 1.7;
const FLING_SIDE = 12;
const FLING_NEAR = 8.5;
export const FLING_BOW = 0.7;
// 往哪边转：-1 是从上面看逆时针（右手从右往左前方甩出去带出来的转向）
const FLING_DIR = -1;
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
  // （推多久看推多远，见 specOf；这里写的是最短的那一种）
  push: { after: PUSH_BEAT + PUSH_WIND + PUSH_BASE, land: 'soft', declare: PUSH_BEAT + PUSH_WIND + PUSH_BASE, cues: [], grip: 1 + PUSH_BEAT + PUSH_WIND + PUSH_BASE, room: 0 },
  // （和横推一样的摆法，推多久见 specOf；落到位只是轻轻一声）
  brake: { after: PUSH_BEAT + PUSH_WIND + BRAKE_BASE, land: 'soft', declare: PUSH_BEAT + PUSH_WIND + BRAKE_BASE, cues: [], grip: 1 + PUSH_BEAT + PUSH_WIND + BRAKE_BASE, room: 0 },
  // （放到桌角算落桌；手跟着甩出去一小段才松开，牌滑到位宣言才成立）
  fling: { after: FLING_SLIDE, land: 'soft', declare: FLING_SLIDE, cues: [['scrape', 0], ['tap', FLING_SLIDE]], grip: 1.07, room: 0 },
};

// 横推猛推的那一段多久（秒）：照推多远算
const thrustTime = (p?: DiscardMotion): number => (p?.pushBrake ? BRAKE_BASE + BRAKE_PER * (p.pushDist ?? PUSH_SIDE) : PUSH_BASE + PUSH_PER * (p?.pushDist ?? PUSH_SIDE));
// 横推从放下停完算起，往回带、再推到位一共多久（秒）
const pushTime = (p?: DiscardMotion): number => PUSH_WIND + thrustTime(p);
// 2D 牌桌用：推多远（牌宽）时，往回带、再推到位一共多久（秒），其中往回带占多久
export const pushSeconds = (dist: number, brake = false): { wind: number; all: number } => ({ wind: PUSH_WIND, all: PUSH_WIND + thrustTime({ pushDist: dist, pushBrake: brake } as DiscardMotion) });
// 横推推到第几成（x 是放下停完以后过了多久）：0 是放下的地方，1 是落点；往回带的时候是负的。
// 撞得上前一张的越推越快、撞上就停；撞不上的（一行的第一张）推到 PUSH_BRAKE 成自己刹住。
// 刹车的那一种：起步很快冲到最快，之后一路刹到停，正好停在落点
export function pushProgress(p: DiscardMotion | undefined, x: number): number {
  const back = PUSH_BACK / (p?.pushDist ?? PUSH_SIDE);
  if (x <= 0) return 0;
  if (x < PUSH_WIND) return -back * smooth(x / PUSH_WIND);
  const s = clamp01((x - PUSH_WIND) / thrustTime(p));
  if (p?.pushBrake) return -back + (1 + back) * brakeCurve(s);
  let f = s ** PUSH_POWER;
  if (!p?.pushHit) {
    const c = PUSH_BRAKE;
    const top = 0.84;
    f = s < c ? top * (s / c) ** PUSH_POWER : top + (1 - top) * (1 - (1 - (s - c) / (1 - c)) ** 2);
  }
  return -back + (1 + back) * f;
}
// 刹车那一种推到第几成（s：推的这一段过了几成时间）：前 BRAKE_RAMP 成时间越来越快，之后越来越慢，
// 两段在接头的地方一样快，到头正好停住
export function brakeCurve(s: number): number {
  s = clamp01(s);
  const a = BRAKE_RAMP;
  const n = BRAKE_DRAG;
  const at = (n * a) / (2 * (1 - a) + n * a); // 起步那一段走了几成路
  return s < a ? at * (s / a) ** 2 : at + (1 - at) * (1 - (1 - (s - a) / (1 - a)) ** n);
}
// 这一次出牌照哪一套时刻走。横推的时刻跟着推多远变，别的样子是固定的
function specOf(style: DiscardStyle, p?: DiscardMotion): StyleSpec {
  const spec = STYLES[style];
  if (!isPush(style)) return spec;
  const q = style === 'brake' ? ({ ...p, pushBrake: true } as DiscardMotion) : p;
  const t = PUSH_BEAT + pushTime(q);
  // 猛推的到头是一声重的（撞上了是撞的那一声）；刹车的滑到停只有轻轻一下
  const end: [CueKind, number] = style === 'brake' ? ['tap', t] : [p?.pushHit ? 'knock' : 'slap', t];
  return { ...spec, after: t, declare: t, cues: [['scrape', PUSH_BEAT + PUSH_WIND], end], grip: 1 + t };
}

export const landWeight = (style: DiscardStyle = 'place'): LandWeight => STYLES[style].land;
export const afterTime = (style: DiscardStyle = 'place', p?: DiscardMotion): number => specOf(style, p).after;
export const declareDelay = (style: DiscardStyle = 'place', p?: DiscardMotion): number => specOf(style, p).declare;
export const roomNeeded = (style: DiscardStyle = 'place'): number => STYLES[style].room;
// 贴着桌面滑的那一声要响多久（秒）
export function scrapeTime(style: DiscardStyle = 'place', p?: DiscardMotion): number {
  return isPush(style) ? thrustTime(style === 'brake' ? ({ ...p, pushBrake: true } as DiscardMotion) : p) : style === 'top' ? 0.6 : style === 'fling' ? FLING_SLIDE * 0.8 : 0.2;
}
// 横推：宣言牌落在这一行从左数第 col 格（0 起）时，横着放在落点右边多远再推过来（牌宽）。刹车的那一种固定两个牌宽
export function pushDistFor(style: DiscardStyle, col: number): number {
  return style === 'brake' ? BRAKE_DIST : pushDistAt(col);
}
export function pushDistAt(col: number): number {
  return PUSH_SIDE + (PUSH_MAX - PUSH_SIDE) * clamp01((PUSH_NEAR_COL - col) / PUSH_NEAR_COL);
}

// 这种出牌的快慢和抬多高：在基准参数上调。flat 是 2.5D（没有人物，牌自己飞，基准抬得很低）
// pushHit：横推的这一张左边有没有前一张牌可撞
export function styleParams(base: DiscardParams, style: DiscardStyle = 'place', flat = false, pushDist?: number, pushHit = false): DiscardMotion {
  const p: DiscardMotion = { ...base };
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
  } else if (isPush(style)) {
    p.lift = base.lift * 0.6;
    p.carry = base.carry * 1.2;
    if (pushDist !== undefined) p.pushDist = pushDist;
    // 刹车的那一种自己停住，不撞前一张
    p.pushBrake = style === 'brake';
    p.pushHit = pushHit && style === 'push';
    p.settle = hand(PUSH_BEAT + pushTime(p) + 0.1);
  } else if (style === 'fling') {
    // 搬运是把牌带到右手边的桌角放下（不抬多高）；放下就甩出去，手顿一下再收
    p.lift = flat ? 0.6 : 1.4;
    p.carry = Math.max(base.carry * 1.25, 0.36);
    p.settle = flat ? 0 : Math.max(base.settle, 0.3);
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
export function totalTime(p: DiscardMotion, hold = 0, style: DiscardStyle = 'place'): number {
  return p.reach + p.carry + Math.max(p.settle + hold + p.back, afterTime(style, p));
}

// 出发、抓住、落桌、松手、收回的时刻
export function markers(p: DiscardMotion, hold = 0, style: DiscardStyle = 'place'): Marker[] {
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
export function dueMarkers(p: DiscardMotion, hold: number, fired: number, t: number, style: DiscardStyle = 'place'): Marker[] {
  const due: Marker[] = [];
  for (const m of markers(p, hold, style).slice(fired)) {
    // 时间是一帧帧累加出来的，差一点点浮点零头也算到了
    if (m.t > t + 1e-9) break;
    due.push(m);
  }
  return due;
}

// 落桌以后的动静各在什么时刻（从出发算起，按时间排好）。立直宣言成立（declare）每种样子都有一个
export function cues(p: DiscardMotion, style: DiscardStyle = 'place'): Cue[] {
  const land = p.reach + p.carry;
  const spec = specOf(style, p);
  const list: Cue[] = spec.cues.map(([kind, t]) => ({ kind, t: land + t }));
  // 举高：停在半空的时候闪一下
  if (style === 'hold') list.push({ kind: 'glint', t: p.reach + p.carry * HOLD_RISE });
  list.push({ kind: 'declare', t: land + spec.declare });
  return list.sort((a, b) => a.t - b.t);
}

export function dueCues(p: DiscardMotion, fired: number, t: number, style: DiscardStyle = 'place'): Cue[] {
  const due: Cue[] = [];
  for (const c of cues(p, style).slice(fired)) {
    if (c.t > t + 1e-9) break;
    due.push(c);
  }
  return due;
}

export function phaseAt(p: DiscardMotion, t: number, hold = 0, style: DiscardStyle = 'place'): DiscardPhase {
  if (t < p.reach) return 'reach';
  if (t < p.reach + p.carry) return 'carry';
  if (t < p.reach + p.carry + p.settle + hold) return 'settle';
  if (t <= totalTime(p, hold, style)) return 'back';
  return 'done';
}

// 手腕在接触点的后上方，手指正好捏住牌
function grip(p: DiscardMotion, path: DiscardPath, at: THREE.Vector3, raise: number): THREE.Vector3 {
  return at
    .clone()
    .addScaledVector(path.toward, path.scale * p.gripBack)
    .addScaledVector(UP, path.scale * p.gripUp + raise);
}

export function sampleDiscard(p: DiscardMotion, path: DiscardPath, t: number): DiscardPose {
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

// 回旋的牌从哪里开始滑（和落点一样贴着桌面）：牌桌给了就用给的，没给是落点右边、靠自己这边的默认位置
function flingStart(p: DiscardMotion, path: DiscardPath): THREE.Vector3 {
  const R = new THREE.Vector3().crossVectors(UP, path.toward);
  const at = p.flingFrom?.clone() ?? path.to.clone().addScaledVector(R, FLING_SIDE).addScaledVector(path.toward, FLING_NEAR);
  return at.setY(path.to.y);
}
// 回旋的弧线往哪边拱（控制点）：牌桌给了就用给的，没给是从起点先朝前、再拐向左的那一道
function flingVia(p: DiscardMotion, path: DiscardPath, start: THREE.Vector3): THREE.Vector3 {
  return (p.flingVia?.clone() ?? flingBow(start, path.to, path.toward, FLING_BOW)).setY(path.to.y);
}
// 从 from 到 to 的弧线弯成 bow 时的控制点。toward 是水平方向，从牌指向出牌的人。
// bow 0 是直线；1 是先笔直朝前、到了落点那一排再拐向左（控制点在起点的正前方、落点的正右方）；
// 负的反过来，先朝左再朝前。在 -1 到 1 之间弧线一路只往左、往前走，不会滑过头再折回来
export function flingBow(from: THREE.Vector3, to: THREE.Vector3, toward: THREE.Vector3, bow: number): THREE.Vector3 {
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const near = from.clone().sub(to).dot(toward);
  // 弯的那个角：往前拱的在落点正右方（和起点一样靠右），往左拱的在落点正跟前（和起点一样靠自己）
  const corner = bow >= 0 ? from.clone().addScaledVector(toward, -near) : to.clone().addScaledVector(toward, near);
  return mid.lerp(corner, Math.abs(bow));
}
// 弧线（二次贝塞尔）走到第 u 成在哪
export function flingCurve(from: THREE.Vector3, via: THREE.Vector3, to: THREE.Vector3, u: number): THREE.Vector3 {
  const a = (1 - u) * (1 - u);
  const b = 2 * u * (1 - u);
  return from.clone().multiplyScalar(a).addScaledVector(via, b).addScaledVector(to, u * u);
}

// 牌这一刻在哪：tc 是抓起来以后过了多久（搬运 + 落桌以后自己动的那一段）。end 是落点（落桌以后用已经放下的位置）
function tileAt(p: DiscardMotion, path: DiscardPath, style: DiscardStyle, tc: number, end: THREE.Vector3): TilePose {
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
  if (isPush(style)) {
    // 横推：横着放在位置右边，停一下，往回带一点，再猛地推过去（撞上前一张就停）
    const side = end.clone().addScaledVector(R, p.pushDist ?? PUSH_SIDE);
    if (!p.pushBrake) {
      if (ta <= 0) return { pos: arc(side, p.lift), quat: turn(toQ) };
      return { pos: side.lerp(end, pushProgress(p, ta - PUSH_BEAT)), quat: toQ.clone() };
    }
    // 刹车的：右边翘起一点，绕左边那条贴着桌面的棱转（横放的牌左右是牌长、上下是牌厚），推的时候放平
    const tilt = (a: number) => {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().crossVectors(R, UP), a);
      const v = R.clone().multiplyScalar(TILE_H / 2).addScaledVector(UP, TILE_T / 2);
      return { shift: v.clone().applyQuaternion(q).sub(v), q };
    };
    const full = tilt(BRAKE_TILT);
    if (ta <= 0) return { pos: arc(side.clone().add(full.shift), p.lift), quat: turn(full.q.clone().multiply(toQ)) };
    const f = pushProgress(p, ta - PUSH_BEAT);
    const t = tilt(BRAKE_TILT * (1 - clamp01(f)));
    return { pos: side.lerp(end, f).add(t.shift), quat: t.q.multiply(toQ) };
  }
  if (style === 'fling') {
    // 回旋：牌面朝上放到右手边的桌角，贴着桌面甩出去——像陀螺一样平着转，越转越慢，沿一道弧线滑到落点，正好转成横的停住
    const start = flingStart(p, path);
    if (ta <= 0) return { pos: arc(start, p.lift), quat: turn(toQ) };
    const tau = clamp01(ta / FLING_SLIDE);
    const e = FLING_DIR * FLING_TURNS * 2 * Math.PI * (1 - tau) ** FLING_SPIN_DRAG;
    const u = 1 - (1 - tau) ** FLING_DRAG;
    return { pos: flingCurve(start, flingVia(p, path, start), end, u), quat: yawQ(e).multiply(toQ) };
  }
  return { pos: arc(end, p.lift), quat: turn(toQ) };
}

// 手：捏着牌的时候跟着牌走，松手以后停在松手的地方，到该收手了再收回去
function sampleStyled(p: DiscardMotion, path: DiscardPath, t: number, style: DiscardStyle): DiscardPose {
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
  const spec = specOf(style, p);
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
