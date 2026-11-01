import type { Game } from '../engine/game';
import { TileId, kindOf, suitOf } from '../engine/tiles';
import { PRIORITY, type Ability } from './types';

// 石户霞（永水）：平时以防守为主。落后时请神上身，之后整场都回不到平时（没有人给她“净化”）。
// 请神在发牌前决定（和淡一样）：电脑的霞一落后就请神；玩家操作她时，落后时发牌前弹出来让玩家选。
// 桌上有会做染手的对手（宥、真子、爽）时，电脑的霞不请神：绝掉一门以后别人手里只剩两门，反而帮他们更快做成染手。
// 请神以后每局开局定一种花色：配牌时别人手里的这种花色被换走，之后别人也摸不到（绝一门），
// 她自己摸牌时容易摸到这种花色和字牌。岭上牌不受影响，所以咲的杠能绕过去。
export const KASUMI = {
  // 请神后自己摸牌时，摸到这种花色或字牌的概率
  drawChance: 0.5,
};

interface KasumiGameState {
  summoned?: boolean;
  want?: boolean; // 玩家发牌前选了请神
}
interface KasumiState {
  suit?: number; // 这一局绝掉的花色：0 万、1 筒、2 索
  first?: boolean; // 这一局刚请神
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as KasumiGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as KasumiState;

// 这一局绝掉的花色（没请神是 null）
export function kasumiSuit(g: Game, seat: number): number | null {
  return stateOf(g, seat).suit ?? null;
}

// 会做染手的对手：绝一门会让他们的手牌更快
export const KASUMI_DYERS = ['yu', 'mako', 'sawaya'];
export const kasumiDyers = (g: Game, seat: number) =>
  [0, 1, 2, 3].filter((s) => s !== seat && KASUMI_DYERS.includes(g.abilities[s]?.id ?? ''));

const isBehind = (g: Game, seat: number) => g.players.some((p) => p.seat !== seat && p.score > g.players[seat].score);

const inSuit = (suit: number) => (t: TileId) => kindOf(t) < 27 && suitOf(kindOf(t)) === suit;

export const kasumiAbility: Ability = {
  id: 'kasumi',
  name: '请神·绝一门',
  description: `落后时在发牌前请神上身（玩家操作时自己选），之后整场都不退。请神后每局定一种花色：别人的配牌里没有这种花色，摸牌也摸不到（岭上牌除外）；她自己摸牌有 ${KASUMI.drawChance * 100}% 的概率摸到这种花色或字牌。`,
  priority: PRIORITY.kasumi,
  // 涅莉押 3 点的局也绝得到：她的和牌别人挡不住，但那门花色她一样拿不到
  piercesShield: true,

  // 请神：选她配牌里最多的花色（按洗好的牌算，还没人动过），别人的配牌里不能有这种花色
  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    if (!gs.summoned && !(g.manual[seat] ? gs.want : isBehind(g, seat) && !kasumiDyers(g, seat).length)) return;
    const first = !gs.summoned;
    gs.summoned = true;
    const per = [0, 0, 0];
    for (const t of g.dealHand(seat)) {
      const k = kindOf(t);
      if (k < 27) per[suitOf(k)]++;
    }
    const suit = per.indexOf(Math.max(...per));
    const st = stateOf(g, seat);
    st.suit = suit;
    st.first = first;
    const pred = inSuit(suit);
    return [0, 1, 2, 3]
      .filter((s) => s !== seat)
      .map((s) => ({ seat, ability: 'kasumi', text: '绝一门', target: s, bad: (hand: TileId[]) => hand.filter(pred).length }));
  },

  // 别人配牌里的这种花色换到发完牌以后的牌山里。别人的规矩（比如淡的安全圈）不能变差；换不了的留着（无解降级）
  beforeDeal(g, seat) {
    const suit = stateOf(g, seat).suit;
    if (suit === undefined) return;
    const pred = inSuit(suit);
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      for (const i of g.dealIndices(s)) {
        if (!pred(g.wall.live[i])) continue;
        const swap = () => g.wall.bringToLive(i, (t) => !pred(t), g.rng, (j) => j >= 52);
        if (!swap()) g.dealFallback(seat, swap);
      }
    }
  },

  preDeal(g, seat) {
    const gs = gameStateOf(g, seat);
    if (gs.summoned) return [];
    const ok = isBehind(g, seat);
    const dyers = kasumiDyers(g, seat).map((s) => g.players[s].name);
    const note = !ok ? '落后时才能请神' : dyers.length ? `小心：${dyers.join('、')}会做染手，绝一门会帮她们` : undefined;
    return [{ id: 'summon', name: '请神', desc: '这一局起请神上身，整场都不退：每局绝一门，别人摸不到那门花色', enabled: ok, picked: false, note }];
  },

  setPreDeal(g, seat, picked) {
    gameStateOf(g, seat).want = picked.includes('summon');
  },

  skill(g, seat) {
    const gs = gameStateOf(g, seat);
    const suit = stateOf(g, seat).suit;
    return gs.summoned
      ? { label: '', note: suit === undefined ? '已请神' : `已请神，这一局绝${'万筒索'[suit]}子`, enabled: false, active: true }
      : { label: '', note: '落后时发牌前可以请神', enabled: false };
  },

  onRoundStart(g, seat) {
    const st = stateOf(g, seat);
    if (st.suit === undefined) return;
    if (st.first) g.emit({ type: 'ability', seat, ability: 'kasumi', text: '请神' });
    g.emit({ type: 'ability', seat, ability: 'kasumi', text: `绝一门·${'万筒索'[st.suit]}子` });
  },

  // 别人摸牌：不许摸到这种花色
  beforeAnyDraw(g, seat, drawer, rinshan) {
    const suit = stateOf(g, seat).suit;
    if (suit === undefined || drawer === seat || rinshan) return;
    return { seat, ability: 'kasumi', text: '绝一门', deny: inSuit(suit) };
  },

  insight(g, seat) {
    const suit = stateOf(g, seat).suit;
    if (!gameStateOf(g, seat).summoned) return ['还没请神（落后时会请）'];
    return [suit === undefined ? '已请神' : `已请神，这一局绝${'万筒索'[suit]}子，自己容易摸到${'万筒索'[suit]}子和字牌`];
  },

  badge(g, seat) {
    const suit = stateOf(g, seat).suit;
    return suit === undefined ? null : `绝${'万筒索'[suit]}`;
  },

  // 自己摸牌：容易摸到这种花色和字牌
  beforeDraw(g, seat, rinshan) {
    const suit = stateOf(g, seat).suit;
    if (suit === undefined || rinshan || !g.rng.chance(KASUMI.drawChance)) return;
    const pred = inSuit(suit);
    g.wall.bringToLive(0, (t) => pred(t) || kindOf(t) >= 27, g.rng);
  },
};
