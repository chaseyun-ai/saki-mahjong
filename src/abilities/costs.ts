import type { Game } from '../engine/game';

// 每个角色的费用（characters.ts 填进来；能力直接 import 角色表会循环引用）
let costs: Record<string, number> = {};
export function setCosts(table: Record<string, number>): void {
  costs = table;
}

// 坐在 seat 的人的费用（没有能力的人按 0 算）
export const seatCost = (g: Game, seat: number): number => costs[g.abilities[seat]?.id ?? ''] ?? 0;
