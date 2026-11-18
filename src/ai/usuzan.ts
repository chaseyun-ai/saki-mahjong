import type { Game } from '../engine/game';

// 有珠山的三个普通人（本内成香、桧森誓子、岩馆摇杏）：没有能力，电脑照原作的性格打。
// - 成香（AiStyle.pushTenpai）：听牌就推，有人立直也不收
// - 誓子（AiStyle.formalTenpai）：牌山剩 formalWall 张以内还没听牌，一鸣就听牌的就鸣（没役也鸣），躲流局罚符
// - 摇杏（AiStyle.yakitori）：一场还没和过，进了南场就鸣牌求快和
export const USUZAN_AI = {
  formalWall: 12,
};

// 这一场她和过牌没有（看这一场的事件；一局里只重算一次）
const cache = new WeakMap<Game, { round: number; won: boolean[] }>();
export function wonThisGame(g: Game, seat: number): boolean {
  let c = cache.get(g);
  if (!c || c.round !== g.round) {
    const won = [false, false, false, false];
    for (const e of g.events) if (e.type === 'roundEnd') for (const w of e.result.wins) won[w.seat] = true;
    c = { round: g.round, won };
    cache.set(g, c);
  }
  return c.won[seat];
}
