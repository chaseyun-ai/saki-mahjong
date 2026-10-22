import type { Game } from '../engine/game';
import type { TileId } from '../engine/tiles';

// 能力插件：挂在规则引擎的固定时机上。
// 规则：只能交换没公开的牌（通过 Wall 的方法），或者只给出信息，永远不凭空造牌。

export interface Ability {
  id: string;
  name: string;
  description: string;
  onRoundStart?(g: Game, seat: number): void;
  beforeDraw?(g: Game, seat: number, rinshan: boolean): void;
  afterDraw?(g: Game, seat: number): void;
  afterDiscard?(g: Game, seat: number, tile: TileId): void;
  // 给界面显示的额外信息（比如先见到的牌）
  foresight?(g: Game, seat: number): Foresight | null;
}

export interface Foresight {
  title: string;
  // 依次是谁会摸到哪张牌（假设没人鸣牌）
  draws: { seat: number; tile: TileId }[];
}
