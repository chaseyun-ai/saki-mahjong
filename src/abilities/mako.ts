import type { Game } from '../engine/game';
import { Kind, TileId, kindOf } from '../engine/tiles';
import { TenpaiRead, readTenpai } from './hiroe';
import type { Ability } from './types';

// 染谷真子（清澄）：牌谱记忆。家里开雀庄，看过的牌局数不清，局面一眼就认得出来。
// - 见过的局面：没有能力（或者能力这一局不起作用）的人，她读得出听牌没有、听什么、多大，打牌几乎不失误
// - 没见过的局面：有能力的人打出来的局面她没见过，读不出来（原作里她对衣、美穗子这类就很吃力）
// - 喜好染手：配牌偏向一门花色加字牌（换掉几张别的花色），摸牌偶尔把别的花色换成这门或字牌，常做混一色
// 玩家操作她时：和洋榎一样，认得出的人听牌了头像旁边亮灯，指着会放铳给他们的牌时她会提醒你（见 src/ui/app.ts）
// 电脑的真子：照读出来的听牌防守；留着染手的那门花色和字牌，做染手时能鸣；有役、默听够大就不立直

export const MAKO = {
  dealSwaps: 3, // 配牌最多换几张别的花色
  draw: 0.2, // 摸牌是别的花色时换成这门或字牌的概率
};

interface MakoState {
  suit?: number; // 这一局做的那门花色（0 万 1 筒 2 索）
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as MakoState;

// 这一局做染手的那门花色（还没定是 null）
export function makoSuit(g: Game, seat: number): number | null {
  return stateOf(g, seat).suit ?? null;
}

// 这张牌在不在染手里：这门花色或字牌
const inSuit = (suit: number) => (t: TileId) => kindOf(t) >= 27 || Math.floor(kindOf(t) / 9) === suit;

// 这一家的局面她认不认得：没有能力，或者能力这一局不起作用（被封印）
export function makoKnows(g: Game, target: number): boolean {
  return !g.active(target);
}

// 她读得出来的听牌（认得出的人里）
export function makoReads(g: Game, seat: number): TenpaiRead[] {
  return [0, 1, 2, 3].filter((s) => s !== seat && makoKnows(g, s)).flatMap((s) => readTenpai(g, s) ?? []);
}

// 打出去会被认得出的人荣和的牌种
export function makoDanger(g: Game, seat: number): Set<Kind> {
  return new Set(makoReads(g, seat).flatMap((r) => r.ron));
}

export const makoAbility: Ability = {
  id: 'mako',
  name: '牌谱记忆',
  description: `靠看过的无数牌局：没有能力的人打出来的局面她都见过，读得出他们听牌没有、听什么、多大（头像旁边亮灯），打牌几乎不失误；有能力的人的局面没见过，读不出来。喜好染手：配牌偏向一门花色加字牌，摸牌有 ${MAKO.draw * 100}% 把别的花色换成这门或字牌，常做混一色。`,

  // 配牌：挑手里最多的那门花色，换掉几张别的花色（从发完牌以后的牌山里换）
  beforeDeal(g, seat) {
    const w = g.wall;
    const mine = g.dealIndices(seat);
    const n = [0, 1, 2].map((s) => mine.filter((i) => kindOf(w.live[i]) < 27 && Math.floor(kindOf(w.live[i]) / 9) === s).length);
    const suit = n.indexOf(Math.max(...n));
    stateOf(g, seat).suit = suit;
    const ok = inSuit(suit);
    let done = 0;
    for (const i of g.rng.shuffle(mine.filter((i) => !ok(w.live[i])))) {
      if (done >= MAKO.dealSwaps) break;
      if (w.bringToLive(i, ok, g.rng, (j) => j >= 52)) done++;
    }
  },

  beforeDraw(g, seat, rinshan) {
    const suit = makoSuit(g, seat);
    if (rinshan || suit === null) return;
    const ok = inSuit(suit);
    if (!ok(g.wall.live[0]) && g.rng.chance(MAKO.draw)) g.wall.bringToLive(0, ok, g.rng);
  },

  badge(g, seat) {
    const known = [0, 1, 2, 3].filter((s) => s !== seat && makoKnows(g, s)).length;
    return known === 0 ? '没见过' : null;
  },

  skill(g, seat) {
    const known = [0, 1, 2, 3].filter((s) => s !== seat && makoKnows(g, s)).map((s) => g.players[s].name);
    const suit = makoSuit(g, seat);
    const dye = suit === null ? '' : `；染手做${['万子', '筒子', '索子'][suit]}`;
    return { label: '', note: (known.length ? `见过的局面：读得出 ${known.join('、')}` : '这一桌都是没见过的局面，读不出来') + dye, enabled: false, active: known.length > 0 };
  },

  insight(g, seat) {
    const known = [0, 1, 2, 3].filter((s) => s !== seat && makoKnows(g, s)).length;
    const suit = makoSuit(g, seat);
    return [suit === null ? '喜好染手' : `这一局染手做${['万子', '筒子', '索子'][suit]}`, `读牌：没有能力的人（现在 ${known} 家）听什么、多大她都看得出，不打他们和得了的牌`, '有能力的人的局面没见过，读不出来'];
  },
};
