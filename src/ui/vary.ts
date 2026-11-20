import { Rng } from '../engine/rng';
import { type DiscardParams, type DiscardStyle, NORMAL_STYLES, RIICHI_STYLES, roomNeeded } from '../ui3d/discardMotion';

// 随机微变化：同一个动作每次都差一点点（落桌声、电脑想多久、出牌动作的快慢、牌河里牌放得正不正），
// 像植物大战僵尸那样，几百次重复下来不会觉得是同一段录像在放。
// 只给“看起来、听起来”的东西用，牌山、能力用的还是牌局自己的 Rng：这里取多少次随机数都不影响牌局。
// 关掉（设置里的“微变化”、动作调试场景）时每个函数都原样返回基准值，和没加这个文件之前一模一样。
// 出牌的样子、牌河摆得齐不齐另有自己的设置（见下面的手风），不跟这个开关走。

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
  toka: { speed: 0.95, spread: 0.6 }, // 数字派，治水以后更是一样快
  jun: { speed: 0.9, spread: 1.1 },
  tomoki: { speed: 0.9, spread: 0.5 }, // 网络麻将出身，手快、每次都差不多
  hajime: { speed: 1 },
  kana: { speed: 0.85, spread: 1.3 }, // 猫一样风风火火
  miharu: { speed: 1.05 },
  seika: { speed: 1 },
  sumiyo: { speed: 1.05, spread: 0.8 },
  mutsuki: { speed: 1.05 },
  kaori: { speed: 1.3, spread: 1.4 }, // 新手，要想好久
  satomi: { speed: 0.9, spread: 1.2 }, // 大大咧咧
  yumi: { speed: 1, spread: 0.6 }, // 冷静
  hiroko: { speed: 1.1, spread: 0.8 }, // 边打边翻资料
  satoha: { speed: 0.92, spread: 0.6 }, // 不犹豫，每一手都一样稳
  myeonghwa: { speed: 1.05, spread: 0.9 }, // 不紧不慢
  megan: { speed: 0.95, spread: 0.8 }, // 出手快
  naruka: { speed: 1.1, spread: 1.1 }, // 学了不到一年，有点怯
  chikako: { speed: 1.1, spread: 0.9 }, // 认真，每一手都想一下
  yuan: { speed: 0.95, spread: 1.1 },
  yukiko: { speed: 1, spread: 0.5 }, // 数字派，每次都差不多
  mieko: { speed: 1.05 },
  hitomi: { speed: 0.95 },
  yuuko: { speed: 1 },
  kinue: { speed: 0.95, spread: 0.9 },
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

// ---------- 出牌的样子、牌河摆得齐不齐：每个人有自己的手风 ----------

// 视觉设置里的三项。varied / char 是照各人的手风随机；其余是所有人都固定用那一种
export type DiscardFx = 'varied' | 'place' | 'snap' | 'slide' | 'spin' | 'toss' | 'stand';
export type RiichiFx = 'varied' | 'place' | 'turn' | 'top' | 'hold' | 'push';
export type PondFx = 'char' | PondStyle;
// 牌河摆得多齐：neat 一丝不苟，natural 随手放的（原来的样子），loose 松松垮垮，messy 东倒西歪
export type PondStyle = 'neat' | 'natural' | 'loose' | 'messy';

// 手风：平常出牌各种样子的比重、立直宣言牌各种样子的比重、牌河摆得多齐
interface Habit {
  discard: Partial<Record<DiscardStyle, number>>;
  riichi: Partial<Record<DiscardStyle, number>>;
  pond: PondStyle;
}

const HABITS = {
  // 没特别写的人：大多平放，偶尔换个花样
  plain: {
    discard: { place: 52, slide: 16, snap: 12, spin: 8, stand: 8, toss: 4 },
    riichi: { place: 32, turn: 24, push: 16, hold: 16, top: 12 },
    pond: 'natural',
  },
  // 端正：规规矩矩平放，牌河一丝不苟
  neat: {
    discard: { place: 78, slide: 14, stand: 8 },
    riichi: { turn: 46, place: 30, push: 24 },
    pond: 'neat',
  },
  // 文静：轻拿轻放，推过去的多
  gentle: {
    discard: { place: 60, slide: 28, stand: 12 },
    riichi: { turn: 42, push: 34, place: 24 },
    pond: 'natural',
  },
  // 豪快：拍的、抛的多，牌河东倒西歪
  rough: {
    discard: { place: 36, snap: 26, toss: 16, slide: 12, spin: 10 },
    riichi: { place: 40, hold: 30, top: 18, push: 12 },
    pond: 'messy',
  },
  // 爱耍帅：转牌、立倒这些花样多
  showy: {
    discard: { place: 40, spin: 22, snap: 14, stand: 12, slide: 8, toss: 4 },
    riichi: { top: 34, hold: 30, place: 22, turn: 14 },
    pond: 'loose',
  },
  // 懒散：能推就不抬手，牌河松松垮垮
  lazy: {
    discard: { slide: 46, place: 44, toss: 10 },
    riichi: { push: 44, turn: 36, place: 20 },
    pond: 'loose',
  },
} satisfies Record<string, Habit>;

const HABIT_OF: Record<string, keyof typeof HABITS> = {
  nodoka: 'neat', // 数字派，摆得像网络麻将
  toka: 'neat',
  tomoki: 'neat',
  hiroko: 'neat',
  sumire: 'neat',
  yumi: 'neat',
  teru: 'neat',
  mihoko: 'neat',
  satoha: 'neat',
  kasumi: 'neat',
  tomoe: 'neat',
  ryuuka: 'neat',
  arata: 'neat',
  kyouko: 'neat',
  huiyu: 'neat',
  yukiko: 'neat',
  chikako: 'neat', // 认真，每一手都想一下
  sae: 'neat',
  rii: 'neat',
  saki: 'gentle',
  kuro: 'gentle',
  yu: 'gentle',
  toki: 'gentle',
  miharu: 'gentle',
  momo: 'gentle',
  komaki: 'gentle',
  takami: 'gentle',
  himeko: 'gentle',
  naruka: 'gentle',
  aislinn: 'gentle',
  yuuki: 'rough', // 东场一路冲
  kana: 'rough',
  satomi: 'rough',
  hiroe: 'rough',
  sera: 'rough',
  jun: 'rough',
  seiko: 'rough',
  izumi: 'rough',
  nelly: 'rough',
  shizuno: 'rough',
  suzu: 'rough', // 爆发型
  hisa: 'showy', // 恶听还要摔牌的人
  awai: 'showy',
  koromo: 'showy',
  hatsumi: 'showy',
  megan: 'showy',
  toyone: 'showy',
  sawaya: 'showy',
  myeonghwa: 'showy',
  hajime: 'showy', // 变戏法的手
  shiromi: 'lazy', // 好麻烦
  haru: 'lazy', // 一边吃黑糖一边打
  kaori: 'lazy', // 新手，摆不齐
  kurumi: 'lazy',
};

const habitOf = (id: string): Habit => HABITS[HABIT_OF[id] ?? 'plain'];

// 按比重抽一个；r 是 [0, 1) 的随机数
function weighted(weights: Partial<Record<DiscardStyle, number>>, allowed: DiscardStyle[], r: number): DiscardStyle {
  const list = allowed.filter((k) => (weights[k] ?? 0) > 0);
  const sum = list.reduce((n, k) => n + weights[k]!, 0);
  let x = r * sum;
  for (const k of list) {
    x -= weights[k]!;
    if (x < 0) return k;
  }
  return 'place';
}

// 这一张怎么打出去。fx 是设置里选的（不给、选了多样就照这个人的手风抽）；room 是落点靠她这一侧空着多宽，
// 放不下的样子（滑的、立着放的要占跟前的地方）不用；flipped 是牌河倒过来摆的人（立倒会倒向前一行，不用）。
// 只看是谁、是不是立直宣言牌，不看手牌：从怎么出牌看不出她听没听
export function pickDiscardStyle(id: string, riichi: boolean, fx: DiscardFx | RiichiFx | undefined, room = Infinity, flipped = false): DiscardStyle {
  const all = riichi ? RIICHI_STYLES : NORMAL_STYLES;
  const fits = (k: DiscardStyle) => roomNeeded(k) <= room && !(flipped && k === 'stand');
  if (fx && fx !== 'varied') return all.includes(fx) && fits(fx) ? fx : 'place';
  const habit = habitOf(id);
  return weighted(riichi ? habit.riichi : habit.discard, all.filter(fits), vary.next());
}

// 这个人这一局牌河摆得多齐：照设置；设置是「看角色」时照她的手风，偶尔比平时齐一点或者乱一点
export function pondStyleOf(id: string, fx: PondFx | undefined, salt: number, seat: number): PondStyle {
  if (fx && fx !== 'char') return fx;
  const order: PondStyle[] = ['neat', 'natural', 'loose', 'messy'];
  const base = order.indexOf(habitOf(id).pond);
  const r = hash01(salt, seat, 91);
  const step = r < 0.18 ? -1 : r > 0.82 ? 1 : 0;
  return order[Math.min(order.length - 1, Math.max(0, base + step))];
}

// 牌河里一张牌歪多少：转角（弧度）和左右、前后的偏移（世界单位，牌宽是 1）。
// natural 是原来的样子：牌之间只有 0.04 的缝，转 1° 加上偏 0.006 两张最坏也不会碰上。
// loose、messy 歪得多，行和行之间要多留一点（rowGap），整行还会斜一点（slope：每往右一张往前后偏多少）、
// 左右错开一点（rowShift）；牌桌摆的时候一张张挨着往右排，不会压到前一张
export interface PondLook {
  twist: number;
  shiftX: number;
  shiftZ: number;
  rowGap: number;
  slope: number;
  rowShift: number;
}

const DEG = Math.PI / 180;
export const POND_LOOKS: Record<PondStyle, PondLook> = {
  neat: { twist: 0, shiftX: 0, shiftZ: 0, rowGap: 0, slope: 0, rowShift: 0 },
  natural: { twist: 1 * DEG, shiftX: 0.006, shiftZ: 0.008, rowGap: 0, slope: 0, rowShift: 0 },
  loose: { twist: 3 * DEG, shiftX: 0.02, shiftZ: 0.03, rowGap: 0.07, slope: 0.004, rowShift: 0.04 },
  messy: { twist: 5.5 * DEG, shiftX: 0.035, shiftZ: 0.05, rowGap: 0.11, slope: 0.008, rowShift: 0.08 },
};
export const POND_TWIST = POND_LOOKS.natural.twist;
export const POND_SHIFT_X = POND_LOOKS.natural.shiftX;
export const POND_SHIFT_Z = POND_LOOKS.natural.shiftZ;

export function pondJitter(salt: number, tile: number, style: PondStyle = 'natural'): { yaw: number; dx: number; dz: number } {
  const look = POND_LOOKS[style];
  if (!look.twist) return { yaw: 0, dx: 0, dz: 0 };
  // 三个均匀数平均成钟形，大多数牌只歪一点点
  const b = (k: number) => (hash01(salt, tile, k) + hash01(salt, tile, k + 7) + hash01(salt, tile, k + 13)) / 1.5 - 1;
  return { yaw: b(1) * look.twist, dx: b(2) * look.shiftX, dz: b(3) * look.shiftZ };
}

// 一整行的偏移：这一行左右错开多少、每往右一张往前后偏多少（按座位和第几行算好的固定值）
export function pondRowDrift(salt: number, seat: number, row: number, style: PondStyle): { shift: number; slope: number } {
  const look = POND_LOOKS[style];
  if (!look.rowShift && !look.slope) return { shift: 0, slope: 0 };
  return { shift: (hash01(salt, seat, row, 31) * 2 - 1) * look.rowShift, slope: (hash01(salt, seat, row, 47) * 2 - 1) * look.slope };
}
