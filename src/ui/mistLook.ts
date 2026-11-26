import { SHIZUNO } from '../abilities/shizuno';
import { STACKS_PER_WALL, stackOrder } from '../engine/wall';

// 高鸭稳乃的深山：牌山上的雾长什么样（2D、2.5D、俯视、3D 共用，只算数，不画）。
//
// 雾从牌山最深处起：王牌那 7 墩（宝牌、里宝牌、岭上牌都在这里）是山的最里面，紧挨着的是海底牌，
// 再往前是越来越早摸到的牌。深山标记每多一个，雾就顺着牌山往前多漫一截、也浓一点：
//   6 个（刚起雾）：罩住王牌和最后 10 张牌    ……每多 1 个往前多罩 10 张（5 墩）……
//   12 个：配牌以后桌上剩下的牌山全在雾里，连发牌前的整座牌山都罩住
// 规则上的雾还是照 shizuno.ts 的级数算（6 个 1 级，之后每 2 个 1 级），这里只管画面。

export const WALL_STACKS = STACKS_PER_WALL * 4; // 68 墩
export const DEAD_STACKS = 7; // 王牌 7 墩
const PLAY_STACKS = 35; // 配牌以后还能摸的 70 张牌占 35 墩
const FULL_AT = SHIZUNO.doraAt + SHIZUNO.mistStep * (SHIZUNO.mistMax - 1); // 12 个：雾最大
const STEPS = FULL_AT - SHIZUNO.doraAt + 1; // 从刚起雾到最大分几步（7 步）

export interface MistLook {
  marks: number; // 深山标记（最多算到 12）
  reach: number; // 从最深处（紧挨分开处的那墩王牌）往前，雾罩住几墩；罩满是 68
  density: number; // 多浓，0–1
}

// 深山有 marks 个标记时雾的样子；还没起雾是 null
export function mistLook(marks: number): MistLook | null {
  if (marks < SHIZUNO.doraAt) return null;
  const m = Math.min(FULL_AT, Math.floor(marks));
  const step = m - SHIZUNO.doraAt + 1; // 1..7
  const reach = step >= STEPS ? WALL_STACKS : DEAD_STACKS + Math.round((PLAY_STACKS * step) / STEPS);
  return { marks: m, reach, density: 0.4 + (0.6 * (step - 1)) / (STEPS - 1) };
}

// 一墩牌山离最深处多远：0 是紧挨分开处的那墩王牌，6 是王牌的最后一墩，7 是海底那一墩，67 是最先摸的那一墩
export function stackDepth(dealer: number, diceSum: number, wall: number, stack: number): number {
  return WALL_STACKS - 1 - stackOrder(dealer, diceSum, wall, stack);
}

// 这一墩在不在雾里（1 完全在，0 不在）：雾的前沿软着过渡 edge 墩
export function mistCover(look: MistLook | null, depth: number, edge = 3): number {
  if (!look) return 0;
  if (look.reach >= WALL_STACKS) return 1;
  const k = (look.reach - depth) / edge;
  return k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
}

// 雾的颜色：深色桌布上是白里带一点青灰的云；浅色桌布（白瓷、漫画、沙滩、草甸）上白雾看不出来，暗的地方压成灰蓝
export interface MistTone {
  pale: boolean; // 桌布是浅色的
  light: [number, number, number]; // 浓的地方（0–255）
  shade: [number, number, number]; // 薄的、背光的地方
}
const TONE_DARK: MistTone = { pale: false, light: [248, 251, 253], shade: [185, 200, 214] };
const TONE_PALE: MistTone = { pale: true, light: [226, 233, 240], shade: [108, 130, 154] };

// 桌布颜色（#rrggbb）上该用哪一种
export function mistTone(felt: string): MistTone {
  const v = parseInt(felt.replace('#', ''), 16);
  if (!Number.isFinite(v)) return TONE_DARK;
  const luma = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return luma > 0.55 ? TONE_PALE : TONE_DARK;
}
