import type { Game } from '../engine/game';
import type { TileId } from '../engine/tiles';

// 能力插件：挂在规则引擎的固定时机上。
// 规则：只能交换没公开的牌（通过 Wall 的方法），或者只给出信息，永远不凭空造牌。
//
// 谁说了算（不看座位）：
// 1. 被锁住的牌（怜看到的、能力预定的）谁都不能动。
// 2. 控场的能力按 priority 从小到大先动，后动的不能违反先动的定下的规矩（DrawRule）。
// 3. 摸牌的人自己的能力（beforeDraw）最后动，只能在前面的人留下的牌里挑。
//
// 配牌（每局开头）分两步：
// 1. dealRules：所有人先把对配牌的规矩定下来（DealRule），这一步不动牌。
// 2. beforeDeal：按 priority 依次调整牌山。任何一次换牌都不能让别人的任何一条规矩变差，所以能兼容的规矩会一起满足。
//    调整不下去时可以降级（g.dealFallback）：只顾比自己先动的人的规矩。
//    全部调整完，配牌的 52 张统一锁定，然后发牌。

export const PRIORITY = {
  awai: 10,
  koromo: 20,
  kasumi: 30,
  nelly: 40,
  self: 100,
};

// 控场能力对“这一次摸牌”定的规矩：deny 为真的牌不能被这个人摸到
export interface DrawRule {
  seat: number; // 定规矩的人
  ability: string;
  text: string;
  deny: (t: TileId) => boolean;
}

// 控场能力对某一家配牌定的规矩。bad 是这手配牌离规矩还差多少，0 是满足
export interface DealRule {
  seat: number; // 定规矩的人
  ability: string;
  text: string;
  target: number; // 管哪一家的配牌
  bad: (hand: TileId[]) => number;
}

export interface Ability {
  id: string;
  name: string;
  description: string;
  // 越小越先动，没写算 PRIORITY.self
  priority?: number;
  // 配牌之前：牌山已经洗好、骰子掷完，live 的前 52 张还没发（g.dealIndices 给出每家会拿到哪几张）
  // 第一步：定配牌的规矩，不动牌
  dealRules?(g: Game, seat: number): DealRule[] | void;
  // 第二步：调整牌山。g.dealRules 里别人的规矩全都生效：换牌不能让任何一条变差（Wall.guard 把关）
  beforeDeal?(g: Game, seat: number): void;
  onRoundStart?(g: Game, seat: number): void;
  // 任何人摸牌之前（包括自己）。可以整理牌山，也可以给这次摸牌定规矩
  beforeAnyDraw?(g: Game, seat: number, drawer: number, rinshan: boolean): DrawRule | null | void;
  beforeDraw?(g: Game, seat: number, rinshan: boolean): void;
  afterDraw?(g: Game, seat: number): void;
  afterDiscard?(g: Game, seat: number, tile: TileId): void;
  // 头像框上的小标签（比如衣的月相、霞绝掉的花色），没有就是 null
  badge?(g: Game, seat: number): string | null;
  // 能看到自己下一次摸到的牌（怜）。看到的是哪张由 src/ai/forecast.ts 在复制的牌局上演算
  foresight?: { title: string };
  // 发牌前可以选的技能：玩家操作时，发牌前弹出来让玩家选（选好调 setPreDeal）；电脑在 dealRules 里自己决定
  preDeal?(g: Game, seat: number): PreDealOption[];
  setPreDeal?(g: Game, seat: number, picked: string[]): void;
  // 这一刻能不能和牌（照的照魔镜那一局和不了）。没写算能
  canWin?(g: Game, seat: number): boolean;
  // 别人看得穿的这家能力状态（照的照魔镜），一行一条；没写就只显示能力名
  insight?(g: Game, seat: number): string[];
  // 玩家操作这个角色时的技能按钮（g.manual[seat] 为真时由玩家决定，否则能力自己按电脑的规矩决定）
  skill?(g: Game, seat: number): SkillButton | null;
  pressSkill?(g: Game, seat: number): void;
}

export interface PreDealOption {
  id: string;
  name: string;
  desc: string;
  cost?: number;
  enabled: boolean;
  // 默认勾上（比如上一局选过的）
  picked: boolean;
  note?: string;
}

export interface SkillButton {
  label: string;
  note: string;
  enabled: boolean;
  // 能量条（没有就不画）
  meter?: { value: number; max: number };
  // 开启中（按钮高亮）
  active?: boolean;
}
