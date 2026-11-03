import { Rng } from '../engine/rng';
import type { DiscardParams } from '../ui3d/discardMotion';

// 随机微变化：同一个动作每次都差一点点（落桌声、电脑想多久、出牌动作的快慢、牌河里牌放得正不正），
// 像植物大战僵尸那样，几百次重复下来不会觉得是同一段录像在放。
// 只给“看起来、听起来”的东西用，牌山、能力用的还是牌局自己的 Rng：这里取多少次随机数都不影响牌局。
// 关掉（设置里的“微变化”、动作调试场景）时每个函数都原样返回基准值，和没加这个文件之前一模一样。

export class Vary {
  on = false;
  private rng = new Rng(1);
  private last = new Map<string, number>();

  // 开一局：种子跟着牌局的种子走，同一局重放时表现也一样
  reset(seed: number, on: boolean): void {
    this.on = on;
    this.rng = new Rng((seed ^ 0x7a11e5) >>> 0);
    this.last.clear();
  }

  next(): number {
    return this.rng.next();
  }

  // 钟形分布，落在 [-1, 1]：三个均匀数的平均，大多数时候靠近 0，偶尔偏到边上
  bell(): number {
    return (this.next() + this.next() + this.next()) / 1.5 - 1;
  }

  // 近似标准正态（十二个均匀数相加减 6），用来做对数正态的思考时间
  gauss(): number {
    let s = 0;
    for (let i = 0; i < 12; i++) s += this.next();
    return s - 6;
  }

  // 以 base 为中心上下浮动，最多 ±pct（0.1 就是 ±10%）
  jitter(base: number, pct: number): number {
    if (!this.on || base === 0) return base;
    return base * (1 + this.bell() * pct);
  }

  // 从 n 个变体里挑一个，不和这个 key 上一次挑的重复
  pick(key: string, n: number): number {
    if (!this.on || n <= 1) return 0;
    const prev = this.last.get(key);
    let i = Math.floor(this.next() * (prev === undefined ? n : n - 1));
    if (prev !== undefined && i >= prev) i++;
    this.last.set(key, i);
    return i;
  }

  // 电脑想多久：median 是原来的固定值（中位数）。pace 是角色的快慢，steady 时（立直后摸切）不会长考
  think(median: number, pace: Pace, steady = false): number {
    if (!this.on) return median;
    const k = Math.min(THINK_MAX, Math.max(THINK_MIN, Math.exp(this.gauss() * THINK_SIGMA * pace.spread)));
    const long = !steady && this.next() < LONG_THINK ? 1.5 + this.next() : 1;
    return median * pace.speed * k * long * THINK_NORM;
  }
}

export const vary = new Vary();

// 思考时间：对数正态，σ=0.22，夹在 0.7–1.5 倍；5% 的时候长考 1.5–2.5 倍
const THINK_SIGMA = 0.22;
const THINK_MIN = 0.7;
const THINK_MAX = 1.5;
const LONG_THINK = 0.05;
// 上面这些加起来平均比中位数长约 7%，乘回去，让平均节奏和原来的固定值一样
const THINK_NORM = 0.935;

// 角色打牌的快慢：speed 乘在思考时间上，spread 是每次差多少（和那样的数字派几乎每次都一样快）
export interface Pace {
  speed: number;
  spread: number;
}

const PACES: Record<string, Partial<Pace>> = {
  yuuki: { speed: 0.82, spread: 1.2 }, // 急性子，东场一路冲
  koromo: { speed: 0.85 }, // 夜里的衣不用想
  awai: { speed: 0.85 }, // 自信满满
  hiroe: { speed: 0.88, spread: 1.2 }, // 话多手快
  teru: { speed: 0.95, spread: 0.7 },
  hisa: { speed: 0.95 },
  nodoka: { speed: 1, spread: 0.5 }, // 数字派，每次都差不多
  momo: { speed: 1 },
  saki: { speed: 1.05 },
  mihoko: { speed: 1.05 },
  sumire: { speed: 1.05, spread: 0.7 },
  mako: { speed: 1.05 },
  toyone: { speed: 1.05 },
  kurumi: { speed: 0.95, spread: 0.8 }, // 不立直，摸了就打
  arata: { speed: 1.05, spread: 0.9 }, // 古风，稳稳地打
  kasumi: { speed: 1.1 },
  hatsumi: { speed: 0.95, spread: 1.1 }, // 小个子，风风火火
  haru: { speed: 0.9, spread: 0.85 }, // 一边吃黑糖一边打，快
  tomoe: { speed: 1.05 },
  kyouko: { speed: 1.1, spread: 1.2 }, // 凡人拼命算
  yu: { speed: 1.1 }, // 怕冷，慢吞吞的
  toki: { speed: 1.15 }, // 身体弱，一巡先见要看一眼
  komaki: { speed: 1.15, spread: 1.3 }, // 睡着的时候慢，神降了以后快
};

export function paceOf(id: string): Pace {
  return { speed: 1, spread: 1, ...PACES[id] };
}

// 同一个 key 永远得到同一个 [0, 1) 的数：牌河里每张牌歪多少要每次重画都一样，不能每帧重新抽
export function hash01(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h = Math.imul(h ^ (p | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return (h >>> 0) / 4294967296;
}

// 出牌动作：伸手、搬运、停顿、收手各自快慢 ±10%，抬牌高度、手拱多高 ±15%，前倾 ±10%。
// amount 是整体幅度：2.5D（照雀魂调的节奏）和立直宣言牌减半
export function varyDiscard(p: DiscardParams, amount = 1): DiscardParams {
  if (!vary.on) return p;
  const t = 0.1 * amount;
  const h = 0.15 * amount;
  return {
    ...p,
    reach: vary.jitter(p.reach, t),
    carry: vary.jitter(p.carry, t),
    settle: vary.jitter(p.settle, t),
    back: vary.jitter(p.back, t),
    lift: vary.jitter(p.lift, h),
    arcMax: vary.jitter(p.arcMax, h),
    leanMax: vary.jitter(p.leanMax, t),
  };
}

// 牌河里一张牌歪多少：转角（弧度）和左右、前后的偏移（世界单位，牌宽是 1）。
// 牌之间只有 0.04 的缝，转 1° 加上偏 0.006 两张最坏也不会碰上
export const POND_TWIST = (1 * Math.PI) / 180;
export const POND_SHIFT_X = 0.006;
export const POND_SHIFT_Z = 0.008;

export function pondJitter(salt: number, tile: number): { yaw: number; dx: number; dz: number } {
  if (!vary.on) return { yaw: 0, dx: 0, dz: 0 };
  // 三个均匀数平均成钟形，大多数牌只歪一点点
  const b = (k: number) => (hash01(salt, tile, k) + hash01(salt, tile, k + 7) + hash01(salt, tile, k + 13)) / 1.5 - 1;
  return { yaw: b(1) * POND_TWIST, dx: b(2) * POND_SHIFT_X, dz: b(3) * POND_SHIFT_Z };
}
