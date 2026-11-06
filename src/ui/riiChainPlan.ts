import type { Game, RoundResult } from '../engine/game';
import { riiBind } from '../abilities/rii';

// 白水哩的番缚特效（3D / 2.5D 在 ui3d/chains.ts，2D 在 ui/chains2d.ts，天空放晴、钥匙落下在 ui/skyKey.ts），
// 这里是共用的布局和时间。
// 缚几番就有几条锁链从四面八方射过来，一条条缠在手牌上箍一圈；
// 这一局和出的番数够了：锁链变金，碎成金色碎片冲上天，天空放晴，钥匙缓缓落下来；
// 没和成：锁链一节节像粒子一样消散，剩下的化成光冲上天；和了但番数不够：锁链悄悄淡掉。

// 一条锁链：箍在手牌的哪里（x：手牌宽度的比例，0 是正中），从哪个方向射过来（和水平线的夹角），箍的那一圈斜多少
export interface ChainLine {
  x: number;
  angle: number;
  tilt: number;
}

// 七条锁链。缚 n 番用前 n 条：先箍中间，再两边，越来越密
const LINES: ChainLine[] = [
  { x: 0.0, angle: deg(70), tilt: deg(-14) },
  { x: -0.3, angle: deg(-130), tilt: deg(16) },
  { x: 0.3, angle: deg(-50), tilt: deg(-18) },
  { x: -0.15, angle: deg(150), tilt: deg(10) },
  { x: 0.42, angle: deg(25), tilt: deg(20) },
  { x: -0.43, angle: deg(110), tilt: deg(-12) },
  { x: 0.15, angle: deg(-95), tilt: deg(12) },
];

function deg(d: number): number {
  return (d * Math.PI) / 180;
}

export function chainPlan(n: number): ChainLine[] {
  return LINES.slice(0, Math.max(0, Math.min(LINES.length, Math.round(n))));
}

// 锁链的一节：在手牌的局部坐标里（x 顺着手牌那一排往右，y 往上，z 朝着看的人），切线方向，
// 在锁链上走了多远（s），是不是箍在手牌上的那一圈
export interface LinkSpot {
  p: [number, number, number];
  t: [number, number, number];
  s: number;
  loop: boolean;
}

export interface ChainDims {
  width: number; // 手牌那一排多宽
  height: number; // 牌多高
  depth: number; // 牌多厚
  far: number; // 锁链从多远射过来
  pitch: number; // 两节之间多远
}

// 一条锁链：从画面外笔直射到手牌边上，再贴着手牌箍一圈多一点
export function chainLinks(line: ChainLine, d: ChainDims): { links: LinkSpot[]; length: number; loopStart: number } {
  const cx = line.x * d.width;
  const a = d.height * 0.62;
  const b = d.depth * 0.9;
  const st = Math.sin(line.tilt);
  const ct = Math.cos(line.tilt);
  const loop = (phi: number): [number, number, number] => [cx + a * Math.cos(phi) * st, a * Math.cos(phi) * ct, b * Math.sin(phi)];
  // 从上面射过来的从顶上那一点缠起，从下面来的从底下那一点
  const phi0 = Math.sin(line.angle) >= 0 ? 0 : Math.PI;
  const entry = loop(phi0);
  const far: [number, number, number] = [entry[0] + Math.cos(line.angle) * d.far, entry[1] + Math.sin(line.angle) * d.far, d.depth * 1.5];
  // 先密密地取点，再按弧长每 pitch 放一节
  const pts: [number, number, number][] = [];
  const isLoop: boolean[] = [];
  const NS = 60;
  for (let i = 0; i < NS; i++) {
    const k = i / NS;
    pts.push([far[0] + (entry[0] - far[0]) * k, far[1] + (entry[1] - far[1]) * k, far[2] + (entry[2] - far[2]) * k]);
    isLoop.push(false);
  }
  const turns = 1.12;
  const NL = 160;
  for (let i = 0; i <= NL; i++) {
    pts.push(loop(phi0 + (i / NL) * Math.PI * 2 * turns * (phi0 === 0 ? 1 : -1)));
    isLoop.push(true);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));
  const length = cum[cum.length - 1];
  const links: LinkSpot[] = [];
  let loopStart = -1;
  let j = 0;
  for (let s = 0; s <= length; s += d.pitch) {
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const u = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    const p: [number, number, number] = [0, 1, 2].map((q) => pts[j][q] + (pts[j + 1][q] - pts[j][q]) * u) as [number, number, number];
    const t = norm([0, 1, 2].map((q) => pts[j + 1][q] - pts[j][q]) as [number, number, number]);
    const lp = isLoop[j + 1];
    if (lp && loopStart < 0) loopStart = links.length;
    links.push({ p, t, s, loop: lp });
  }
  return { links, length, loopStart: Math.max(0, loopStart) };
}

function dist(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function norm(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// 锁上：一条接一条射过来缠上（间隔 stagger 秒，每条 fly 秒），射过来的那一截收进去（retract），绷一下
export const LOCK = { stagger: 0.16, fly: 0.55, retract: 0.3, tense: 0.35, hold: 0.45, dim: 0.5 };
// 锁好以后一直箍着，淡成这么透（看得清牌面）
export const FAINT = 0.42;
// 钥匙：变金（从箍住的地方扫开）→ 碎成碎片 → 冲上天 → 天空放晴、钥匙缓缓落下（ui/skyKey.ts）
export const GOLD = { show: 0.3, sweep: 0.6, crack: 0.3, rise: 0.8 };
export const SKY = { clear: 0.7, fall: 1.7, hold: 1.1, fade: 0.6 };
// 天空放晴从碎片快冲出画面的时候开始
export const skyStart = () => GOLD.show + GOLD.sweep + GOLD.crack + GOLD.rise * 0.7;
export const skyTime = () => SKY.clear + SKY.fall + SKY.hold + SKY.fade;
export const goldTime = () => skyStart() + skyTime();
// 崩断：先绷紧发白、抖一下，一节节像粒子一样消散（dissolve 秒内随机），剩下的化成光冲上天
export const BREAK = { show: 0.3, crack: 0.3, dissolve: 0.75, rise: 0.75, keep: 0.4 };
export const FADE = 0.8;

// 别人的哩番缚没人看得见（只有她自己），所以结算时才现出锁链：快一点锁上
export const QUICK_LOCK = 0.5;

export function lockTime(n: number): number {
  return (Math.max(1, n) - 1) * LOCK.stagger + LOCK.fly + LOCK.retract + LOCK.tense;
}

export type ChainOutcome = 'key' | 'broken' | 'fade';

export function outcomeTime(kind: ChainOutcome): number {
  if (kind === 'key') return goldTime();
  if (kind === 'broken') return BREAK.show + BREAK.crack + BREAK.dissolve + BREAK.rise;
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

// 每一节锁链崩断时什么时候消散（0..1，比 keep 大的不消散、化成光冲上天）。同一节每次一样
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
