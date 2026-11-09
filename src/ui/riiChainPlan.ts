import type { Game, RoundResult } from '../engine/game';
import { riiBind } from '../abilities/rii';

// 白水哩的番缚特效（3D / 2.5D 在 ui3d/chains.ts，2D 在 ui/chains2d.ts，天空放晴、钥匙落下在 ui/skyKey.ts），
// 这里是共用的布局和时间。锁链的样子（几种可以挑）在 ui/riiLook.ts。
// 缚几番就有几条锁链从四面八方射过来，一条条横七竖八地压在手牌上，两头都伸到画面外；
// 这一局和出的番数够了：锁链变金，碎成金色碎片冲上天，天空放晴，钥匙缓缓落下来；
// 没和成、和了但番数不够：锁链绷紧发白，一节节碎成粒子散掉。

// 一条锁链：压在手牌的哪里（x：手牌宽度的比例，0 是正中），从哪个方向射过来（和水平线的夹角），
// 离牌面多远（z：牌厚度的比例，几条错开一点不打架）
export interface ChainLine {
  x: number;
  angle: number;
  z: number;
}

// 七条锁链。缚 n 番用前 n 条：先压中间，再两边，越来越密
const LINES: ChainLine[] = [
  { x: 0.02, angle: deg(68), z: 0.9 },
  { x: -0.3, angle: deg(-132), z: 1.05 },
  { x: 0.31, angle: deg(-48), z: 1.2 },
  { x: -0.12, angle: deg(164), z: 1.35 },
  { x: 0.42, angle: deg(104), z: 1.5 },
  { x: -0.43, angle: deg(-82), z: 1.65 },
  { x: 0.16, angle: deg(18), z: 1.8 },
];

function deg(d: number): number {
  return (d * Math.PI) / 180;
}

export function chainPlan(n: number): ChainLine[] {
  return LINES.slice(0, Math.max(0, Math.min(LINES.length, Math.round(n))));
}

// 锁链的一节：在手牌的局部坐标里（x 顺着手牌那一排往右，y 往上，z 朝着看的人），切线方向，在锁链上走了多远（s）
export interface LinkSpot {
  p: [number, number, number];
  t: [number, number, number];
  s: number;
}

export interface ChainDims {
  width: number; // 手牌那一排多宽
  depth: number; // 牌多厚
  far: number; // 锁链两头伸出去多远（伸到画面外）
  pitch: number; // 两节之间多远
}

// 一条锁链：从画面外笔直射过来，压过手牌，另一头伸到画面外。contactS：压在手牌上的那一节走了多远
export function chainLinks(line: ChainLine, d: ChainDims): { links: LinkSpot[]; length: number; contactS: number } {
  const cx = line.x * d.width;
  const z = d.depth * line.z;
  const dx = Math.cos(line.angle);
  const dy = Math.sin(line.angle);
  const length = d.far * 2;
  const t: [number, number, number] = [-dx, -dy, 0];
  const links: LinkSpot[] = [];
  for (let s = 0; s <= length + 1e-6; s += d.pitch) {
    const k = d.far - s;
    links.push({ p: [cx + dx * k, dy * k, z], t, s });
  }
  return { links, length, contactS: d.far };
}

// 锁上：一条接一条飞快地射过来（间隔 stagger 秒，每条 fly 秒），压住时绷一下（tense 秒）；
// 最后一条压上去时一把大锁砸下来锁死（PADLOCK），停 hold 秒，锁链消散（dim 秒），大锁飞到头像上
export const LOCK = { stagger: 0.07, fly: 0.26, tense: 0.3, hold: 0.55, dim: 0.3 };
// 锁好以后锁链消失（不挡牌），结算时再射出来
export const FAINT = 0;
// 大锁：最后一条锁链压上去前一点开始砸下来（drop 秒），砸下去那一下锁扣合上；锁链消散时飞到头像上（fly 秒）
export const PADLOCK = { lead: 0.06, drop: 0.16, fly: 0.5 };
// 最后一条锁链压上手牌的时候
export const landTime = (n: number) => (Math.max(1, n) - 1) * LOCK.stagger + LOCK.fly;
// 锁链开始消散、大锁飞走的时候
export const vanishTime = (n: number) => lockTime(n) + LOCK.hold;
// 钥匙：变金（从压住手牌的地方往两头扫开）→ 碎成碎片 → 冲上天 → 天空放晴、钥匙缓缓落下（ui/skyKey.ts）
export const GOLD = { show: 0.3, sweep: 0.6, crack: 0.3, rise: 0.8 };
export const SKY = { clear: 0.7, fall: 1.7, hold: 1.1, fade: 0.6 };
// 天空放晴从碎片快冲出画面的时候开始
export const skyStart = () => GOLD.show + GOLD.sweep + GOLD.crack + GOLD.rise * 0.7;
export const skyTime = () => SKY.clear + SKY.fall + SKY.hold + SKY.fade;
export const goldTime = () => skyStart() + skyTime();
// 崩断：先绷紧发白、抖一下，然后一节节碎成细细的粒子散掉（dissolve 秒内随机轮到每一节，
// 每一节 crumble 秒里边缩小边碎开），粒子慢慢飘开、淡掉（drift 秒），不往天上冲
export const BREAK = { show: 0.3, crack: 0.3, dissolve: 1.1, crumble: 0.22, drift: 1.2 };

// 别人的哩番缚没人看得见（只有她自己），所以结算时才现出锁链：快一点锁上
export const QUICK_LOCK = 0.5;

export function lockTime(n: number): number {
  return (Math.max(1, n) - 1) * LOCK.stagger + LOCK.fly + LOCK.tense;
}

// 结算的结果：key 拿到钥匙，broken 没和成（破碎的钥匙），short 和了但番数不够（什么也没有）
export type ChainOutcome = 'key' | 'broken' | 'short';
// 画面上只分两种：番数够了锁链变金冲上天；没和成、番数不够都是锁链崩断、碎成粒子散掉
export type ChainEnd = 'key' | 'broken';
export const chainEnd = (kind: ChainOutcome): ChainEnd => (kind === 'key' ? 'key' : 'broken');

export function outcomeTime(kind: ChainOutcome): number {
  if (chainEnd(kind) === 'key') return goldTime();
  return BREAK.show + BREAK.crack + BREAK.dissolve + BREAK.crumble + BREAK.drift;
}

// 这一局结束时每个番缚了的哩是哪种结果（和 rii.ts 的 onRoundEnd 一样的判法）
export function chainOutcomes(g: Game, result: RoundResult): { seat: number; bind: number; kind: ChainOutcome }[] {
  const out: { seat: number; bind: number; kind: ChainOutcome }[] = [];
  for (let s = 0; s < 4; s++) {
    if (g.abilities[s]?.id !== 'rii') continue;
    const bind = riiBind(g, s);
    if (bind === null) continue;
    const win = result.wins.find((w) => w.seat === s);
    out.push({ seat: s, bind, kind: !win ? 'broken' : win.result.han >= bind ? 'key' : 'short' });
  }
  return out;
}

// 每一节锁链崩断时什么时候碎开（0..1，乘上 BREAK.dissolve）。同一节每次一样
export function dissolveAt(chain: number, k: number): number {
  const x = Math.sin((chain * 131 + k) * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// 0..1 的缓动
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeIn = (t: number) => Math.pow(clamp01(t), 3);
export const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
