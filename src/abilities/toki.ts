import type { Game } from '../engine/game';
import type { TileId } from '../engine/tiles';
import type { Ability } from './types';

// 园城寺怜：一巡先见。平时只看自己下一次摸到的牌；玩家操作她时可以“看下一巡”（不花体力，同一回合看第二次的话下一局不能用），
// 看到这一巡每家打什么、谁鸣牌谁和牌（见 src/ui/foresee.ts）。
// 下一张不是直接读牌山，而是在复制的牌局上演算出来的（src/ai/forecast.ts）：走完整的摸牌流程，
// 已经生效的控场（安全圈、绝一门、海底……）都算在里面，前提是这一巡没人鸣牌、和牌、开杠。
// 她不锁牌：别人的能力照常生效。afterDraw 只记下这一巡接下来的四张，给能力痕迹标注“改写了她看到的一巡”。
// 电脑的怜（src/ai/ai.ts）照原作用一巡先见：看得到这一巡谁会荣和她打的牌，不打那些牌，别的牌照样打，不为防守弃和；
// 立直只在看到这一巡里一发和得了（一发自摸，或者有人打出她的和了牌）时才立。玩家操作的怜托管时不替玩家读铳牌（“看下一巡”要玩家自己点）。
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
  description: '平时能看到自己下一次摸到的牌（别人的能力已经算在里面；有人鸣牌、开杠时会变）；“看下一巡”时，能看到这一巡每家会打什么、有没有人鸣牌或和牌（同一回合看第二次的话，下一局不能用）。',
  foresight: { title: '一巡先见' },

  insight() {
    return ['看得见自己下一次摸什么；电脑的怜看得到这一巡谁会荣和她，不打铳牌，只在看到一发（自摸或荣和）时才立直'];
  },

  afterDraw(g, seat) {
    (g.abilityState[seat] as TokiState).seen = g.wall.live.slice(0, FORESIGHT_TILES);
  },
};
