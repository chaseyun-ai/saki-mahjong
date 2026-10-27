import type { Game } from '../engine/game';
import type { TileId } from '../engine/tiles';
import type { Ability } from './types';

// 园城寺怜：一巡先见。平时只看自己下一次摸到的牌；玩家操作她时可以花体力“看下一巡”，
// 看到这一巡每家打什么、谁鸣牌谁和牌（见 src/ui/foresee.ts）。
// 下一张不是直接读牌山，而是在复制的牌局上演算出来的（src/ai/forecast.ts）：走完整的摸牌流程，
// 已经生效的控场（安全圈、绝一门、海底……）都算在里面，前提是这一巡没人鸣牌、和牌、开杠。
// 她不锁牌：别人的能力照常生效。afterDraw 只记下这一巡接下来的四张，给能力痕迹标注“改写了她看到的一巡”。
export const FORESIGHT_TILES = 4;

interface TokiState {
  seen?: TileId[];
}

// 她上一次摸牌时，这一巡接下来的几张（只是记号，不挡任何人）
export function tokiSeen(g: Game, seat: number): TileId[] {
  return (g.abilityState[seat] as TokiState).seen ?? [];
}

export const tokiAbility: Ability = {
  id: 'toki',
  name: '一巡先见',
  description: '平时能看到自己下一次摸到的牌（别人的能力已经算在里面；有人鸣牌、开杠时会变）；花体力“看下一巡”时，能看到这一巡每家会打什么、有没有人鸣牌或和牌。',
  foresight: { title: '一巡先见' },

  insight() {
    return ['看得见自己下一次摸什么；电脑的怜只在看到一发自摸时才立直'];
  },

  afterDraw(g, seat) {
    (g.abilityState[seat] as TokiState).seen = g.wall.live.slice(0, FORESIGHT_TILES);
  },
};
