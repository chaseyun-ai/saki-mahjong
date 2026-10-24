import type { Game } from '../engine/game';
import type { TileId } from '../engine/tiles';

// 能力插件：挂在规则引擎的固定时机上。
// 规则：只能交换没公开的牌（通过 Wall 的方法），或者只给出信息，永远不凭空造牌。
//
// 谁说了算（不看座位）：
// 1. 被锁住的牌（怜看到的、能力预定的）谁都不能动。
// 2. 控场的能力按 priority 从小到大先动，后动的不能违反先动的定下的规矩（DrawRule）。
// 3. 摸牌的人自己的能力（beforeDraw）最后动，只能在前面的人留下的牌里挑。

export const PRIORITY = {
  awai: 10,
  koromo: 20,
  kasumi: 30,
  self: 100,
};

// 控场能力对“这一次摸牌”定的规矩：deny 为真的牌不能被这个人摸到
export interface DrawRule {
  seat: number; // 定规矩的人
  ability: string;
  text: string;
  deny: (t: TileId) => boolean;
}

export interface Ability {
  id: string;
  name: string;
  description: string;
  // 越小越先动，没写算 PRIORITY.self
  priority?: number;
  // 配牌之前：牌山已经洗好、骰子掷完，live 的前 52 张还没发（g.dealIndices 给出每家会拿到哪几张）
  beforeDeal?(g: Game, seat: number): void;
  onRoundStart?(g: Game, seat: number): void;
  // 任何人摸牌之前（包括自己）。可以整理牌山，也可以给这次摸牌定规矩
  beforeAnyDraw?(g: Game, seat: number, drawer: number, rinshan: boolean): DrawRule | null | void;
  beforeDraw?(g: Game, seat: number, rinshan: boolean): void;
  afterDraw?(g: Game, seat: number): void;
  afterDiscard?(g: Game, seat: number, tile: TileId): void;
  // 头像框上的小标签（比如衣的月相、霞绝掉的花色），没有就是 null
  badge?(g: Game, seat: number): string | null;
  // 给界面显示的额外信息（比如先见到的牌）
  foresight?(g: Game, seat: number): Foresight | null;
}

export interface Foresight {
  title: string;
  // 依次是谁会摸到哪张牌（假设没人鸣牌）
  draws: { seat: number; tile: TileId }[];
}
