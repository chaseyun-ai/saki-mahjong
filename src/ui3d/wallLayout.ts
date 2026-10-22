import type { Game } from '../engine/game';
import type { TileId } from '../engine/tiles';

// 牌山在桌上的物理位置。四家面前各 17 墩、每墩上下两张，共 68 墩。
//
// 开牌：从庄家起逆时针数骰子点数，落在谁面前就开谁的牌山，从他的右端数点数那么多墩处分开。
// 分开处左边是摸牌的起点，往顺时针方向（每家的左手边）一直摸下去；右边 7 墩是王牌。
// 王牌从分开处数：第 1、2 墩是岭上牌，第 3 墩起翻宝牌指示牌，下层是里宝牌。

export const STACKS_PER_WALL = 17;
const TOTAL_STACKS = 68;

export interface WallSlot {
  wall: number; // 这排牌山在谁面前
  stack: number; // 从这家的右端数第几墩，1..17
  level: 0 | 1; // 0 上层，1 下层
  faceUp: boolean;
}

// 从摸牌起点数第 p 墩（顺时针）
export function stackAt(dealer: number, diceSum: number, p: number): { wall: number; stack: number } {
  const owner = (dealer + diceSum - 1) % 4;
  const idx = diceSum + p;
  const wall = (((owner - Math.floor(idx / STACKS_PER_WALL)) % 4) + 4) % 4;
  return { wall, stack: (idx % STACKS_PER_WALL) + 1 };
}

// 第 d 张摸到的牌原来所在的位置（d 从 0 开始，包括配牌）
export function drawSlot(dealer: number, diceSum: number, d: number): WallSlot {
  return { ...stackAt(dealer, diceSum, Math.floor(d / 2)), level: (d % 2) as 0 | 1, faceUp: false };
}

// 王牌里从分开处数第 j 墩
function deadSlot(dealer: number, diceSum: number, j: number, level: 0 | 1, faceUp: boolean): WallSlot {
  return { ...stackAt(dealer, diceSum, TOTAL_STACKS - 1 - j), level, faceUp };
}

// 还在牌山里的每张牌现在的位置
export function wallSlots(g: Game): Map<TileId, WallSlot> {
  const w = g.wall;
  const sum = g.dice[0] + g.dice[1];
  const dealer = g.dealer;
  const out = new Map<TileId, WallSlot>();
  const frontDrawn = 122 - w.live.length - w.overflow.length;
  w.live.forEach((t, k) => out.set(t, drawSlot(dealer, sum, frontDrawn + k)));
  // 开杠后从海底补进王牌的牌，留在原来的位置
  w.overflow.forEach((t, i) => out.set(t, drawSlot(dealer, sum, 121 - i)));
  const rinshanDrawn = 4 - w.rinshan.length;
  w.rinshan.forEach((t, k) => {
    const r = rinshanDrawn + k;
    out.set(t, deadSlot(dealer, sum, Math.floor(r / 2), (r % 2) as 0 | 1, false));
  });
  w.doraIndicators.forEach((t, i) => out.set(t, deadSlot(dealer, sum, 2 + i, 0, i < w.doraRevealed)));
  w.uraIndicators.forEach((t, i) => out.set(t, deadSlot(dealer, sum, 2 + i, 1, false)));
  return out;
}

// 配牌：每人先拿 3 次 4 张，再各拿 1 张。返回手牌第 i 张是第几张摸出的牌，以及第几批发到
export function dealIndex(relToDealer: number, i: number): { d: number; batch: number } {
  if (i < 12) {
    const round = Math.floor(i / 4);
    return { d: round * 16 + relToDealer * 4 + (i % 4), batch: round * 4 + relToDealer };
  }
  return { d: 48 + relToDealer, batch: 12 + relToDealer };
}
