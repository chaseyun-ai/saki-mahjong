import type { AiStyle } from '../abilities/characters';
import type { Game } from '../engine/game';

// 团体赛前四个位置，南 4 局庄家和了以后（Game.mayStop），电脑庄家要不要宣布到此结束。
// 桌上四家各带着自己队伍的全部点数，庄家的点数就是他这一队的点数：
// - 庄家这一队现在单独第一：收手，把领先带给下一个位置；
// - 不是第一（包括和别人同分）：连庄接着追；
// - 宫永照（连和）：连和接得上就一直和下去，不收手。
// 玩家托管时自己的座位也照这个
export function dealerStops(g: Game, seat: number, style: AiStyle): boolean {
  if (style.streak) return false;
  const mine = g.players[seat].score;
  return g.players.every((p, s) => s === seat || p.score < mine);
}
