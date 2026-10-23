import * as THREE from 'three';

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

export function totalTime(p: DiscardParams, hold = 0): number {
  return p.reach + p.carry + p.settle + hold + p.back;
}

// 出发、抓住、落桌、松手、收回的时刻
export function markers(p: DiscardParams, hold = 0): Marker[] {
  return [
    { name: 'depart', t: 0 },
    { name: 'grab', t: p.reach },
    { name: 'land', t: p.reach + p.carry },
    { name: 'release', t: p.reach + p.carry + p.settle + hold },
    { name: 'done', t: totalTime(p, hold) },
  ];
}

// 已经报过 fired 个标记，到时刻 t 为止又经过了哪些（按顺序）。
// 一帧跨过好几个标记时全部按顺序报出来；t 传 Infinity 就是把剩下的全报完（动作被打断时用）
export function dueMarkers(p: DiscardParams, hold: number, fired: number, t: number): Marker[] {
  const due: Marker[] = [];
  for (const m of markers(p, hold).slice(fired)) {
    // 时间是一帧帧累加出来的，差一点点浮点零头也算到了
    if (m.t > t + 1e-9) break;
    due.push(m);
  }
  return due;
}

export function phaseAt(p: DiscardParams, t: number, hold = 0): DiscardPhase {
  if (t < p.reach) return 'reach';
  if (t < p.reach + p.carry) return 'carry';
  if (t < p.reach + p.carry + p.settle + hold) return 'settle';
  if (t <= totalTime(p, hold)) return 'back';
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
  const k = phase === 'done' ? 1 : smooth((t - p.reach - p.carry - p.settle - hold) / p.back);
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
