import type { Game } from '../engine/game';
import { doraFromIndicator, isRed, kindOf } from '../engine/tiles';
import { PRIORITY, type Ability } from './types';

// 松实玄：宝牌会聚集到她手里。一旦打出宝牌，这一整场（半庄）宝牌都不再来了：能力失效，摸牌也摸不到宝牌。
// 作者钦定最高（Ability.absolute）：她的能力还在的时候，别人的配牌里没有宝牌、摸牌也摸不到宝牌，
// 谁的能力都改不了，也封印不了她（照也一样）。别的能力想提高打点只能走别的路。
export const DRAW_CHANCE = 0.4;

interface KuroGameState {
  lost?: boolean; // 打出过宝牌，整场失效
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as KuroGameState;

// 能力还在不在（打出过宝牌以后整场都没了）
export function kuroLost(g: Game, seat: number): boolean {
  return !!gameStateOf(g, seat).lost;
}

export function isDoraTile(g: Game, t: number): boolean {
  if (isRed(t)) return true;
  const doraKinds = g.wall.visibleDoraIndicators().map((i) => doraFromIndicator(kindOf(i)));
  return doraKinds.includes(kindOf(t));
}

export const kuroAbility: Ability = {
  id: 'kuro',
  name: '宝牌聚集',
  description: `宝牌全是她的：别人的配牌里没有宝牌，也摸不到宝牌；她每次摸牌有 ${DRAW_CHANCE * 100}% 的概率摸到宝牌或赤宝牌。谁的能力都改不了、封印不了。打出宝牌后，这一整场能力失效，她再也摸不到宝牌。`,
  priority: PRIORITY.kuro,
  absolute: true,

  // 别人的配牌里不能有宝牌
  dealRules(g, seat) {
    if (kuroLost(g, seat)) return;
    return [0, 1, 2, 3]
      .filter((s) => s !== seat)
      .map((target) => ({ seat, ability: 'kuro', text: '宝牌只给玄', target, bad: (hand: number[]) => hand.filter((t) => isDoraTile(g, t)).length }));
  },

  // 别人配牌里的宝牌换到发完牌以后的牌山里（她最先动，一定换得过来）
  beforeDeal(g, seat) {
    if (kuroLost(g, seat)) return;
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      for (const i of g.dealIndices(s)) if (isDoraTile(g, g.wall.live[i])) g.wall.bringToLive(i, (t) => !isDoraTile(g, t), g.rng, (j) => j >= 52);
    }
  },

  // 别人摸牌（岭上牌也算）：不许摸到宝牌
  beforeAnyDraw(g, seat, drawer) {
    if (drawer === seat || kuroLost(g, seat)) return;
    return { seat, ability: 'kuro', text: '宝牌只给玄', deny: (t) => isDoraTile(g, t) };
  },

  beforeDraw(g, seat, rinshan) {
    if (rinshan) return;
    // 失效以后：下一张是宝牌就换走
    if (kuroLost(g, seat)) {
      if (isDoraTile(g, g.wall.live[0])) g.wall.bringToLive(0, (t) => !isDoraTile(g, t), g.rng);
      return;
    }
    if (!g.rng.chance(DRAW_CHANCE)) return;
    if (g.wall.bringToLive(0, (t) => isDoraTile(g, t), g.rng)) {
      g.emit({ type: 'ability', seat, ability: 'kuro', text: '宝牌聚集' });
    }
  },

  afterDiscard(g, seat, tile) {
    const gs = gameStateOf(g, seat);
    if (gs.lost || !isDoraTile(g, tile)) return;
    gs.lost = true;
    g.emit({ type: 'ability', seat, ability: 'kuro', text: '打出了宝牌，这一整场宝牌不再来' });
  },

  badge(g, seat) {
    return kuroLost(g, seat) ? '宝牌不再来' : null;
  },

  insight(g, seat) {
    return [kuroLost(g, seat) ? '打出过宝牌，这一整场宝牌不再来' : `宝牌还在聚集：每次摸牌 ${DRAW_CHANCE * 100}% 摸到宝牌，她不会打宝牌`];
  },
};
