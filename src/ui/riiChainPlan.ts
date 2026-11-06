import type { Game, RoundResult } from '../engine/game';
import { riiBind } from '../abilities/rii';

// 白水哩的番缚特效（3D / 2.5D 在 ui3d/chains.ts，2D 在 ui/chains2d.ts），两边共用这里的布局和时间。
// 缚几番就有几条锁链从四面八方射过来，横七竖八地压住手牌；
// 这一局和出的番数够了：锁链从压住手牌的地方开始变成金色，一节节飞到手牌上方汇聚成一把钥匙；
// 没和成：锁链崩断，碎成一节节半环四散落下；和了但番数不够：锁链悄悄淡掉。

// 一条锁链：在手牌上压住的位置（x：手牌宽度的比例，0 是正中），和水平线的夹角，从哪一头射过来
export interface ChainLine {
  x: number;
  angle: number;
  from: 1 | -1;
}

// 七条锁链的位置。缚 n 番用前 n 条：前几条先把手牌中间和两边压住，后面的越来越密
const LINES: ChainLine[] = [
  { x: 0.02, angle: deg(68), from: 1 },
  { x: -0.3, angle: deg(-48), from: -1 },
  { x: 0.31, angle: deg(42), from: 1 },
  { x: -0.12, angle: deg(16), from: -1 },
  { x: 0.42, angle: deg(-76), from: -1 },
  { x: -0.43, angle: deg(82), from: 1 },
  { x: 0.16, angle: deg(-22), from: 1 },
];

function deg(d: number): number {
  return (d * Math.PI) / 180;
}

export function chainPlan(n: number): ChainLine[] {
  return LINES.slice(0, Math.max(0, Math.min(LINES.length, Math.round(n))));
}

// 锁上：一条接一条射过来（间隔 STAGGER 秒，每条飞 FLY 秒），压住时绷一下（TENSE 秒）
export const LOCK = { stagger: 0.16, fly: 0.34, tense: 0.45, hold: 0.55, dim: 0.5 };
// 锁好以后一直留着，淡成这么透（不挡牌面）
export const FAINT = 0.28;
// 钥匙（照原作的顺序）：锁链变金（从压住的地方往两头扫）→ 碎成一片片金色碎片（锁定完成）→
// 碎片拖着光汇到一点 → 炸出放射的光和星光 → 钥匙亮出来停一会儿 → 淡掉
export const GOLD = { show: 0.3, sweep: 0.7, crack: 0.65, gather: 0.75, burst: 0.5, hold: 1.8, fade: 0.5 };
export const goldTime = () => GOLD.show + GOLD.sweep + GOLD.crack + GOLD.gather + GOLD.burst + GOLD.hold + GOLD.fade;
// 崩断：先绷紧发白、抖一下，再碎开落下
export const BREAK = { show: 0.35, crack: 0.32, scatter: 1.35 };
export const FADE = 0.8;

// 别人的哩番缚没人看得见（只有她自己），所以结算时才现出锁链：快一点锁上
export const QUICK_LOCK = 0.45;

export function lockTime(n: number): number {
  return (Math.max(1, n) - 1) * LOCK.stagger + LOCK.fly + LOCK.tense;
}

export type ChainOutcome = 'key' | 'broken' | 'fade';

export function outcomeTime(kind: ChainOutcome): number {
  if (kind === 'key') return goldTime();
  if (kind === 'broken') return BREAK.show + BREAK.crack + BREAK.scatter;
  return FADE;
}

// 这一局结束时每个番缚了的哩是哪种结果（和 rii.ts 的 onRoundEnd 一样的判法）
export function chainOutcomes(g: Game, result: RoundResult): { seat: number; bind: number; kind: ChainOutcome }[] {
  const out: { seat: number; bind: number; kind: ChainOutcome }[] = [];
  for (let s = 0; s < 4; s++) {
    if (g.abilities[s]?.id !== 'rii') continue;
    const bind = riiBind(g, s);
    if (bind === null) continue;
    const win = result.wins.find((w) => w.seat === s);
    out.push({ seat: s, bind, kind: !win ? 'broken' : win.result.han >= bind ? 'key' : 'fade' });
  }
  return out;
}

// 锁链一节一节的位置：从一头 -len 到另一头 len，间隔 pitch
export function linkOffsets(len: number, pitch: number): number[] {
  const n = Math.max(2, Math.ceil((2 * len) / pitch));
  return Array.from({ length: n + 1 }, (_, i) => -len + (i * 2 * len) / n);
}

// 0..1 的缓动
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
