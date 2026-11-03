import type { Game } from '../engine/game';
import { shanten, waitingKinds } from '../engine/shanten';
import { TileId, kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 鹭森灼（阿知贺）：保龄球。被动。
// 原作里她打保龄球，听牌也像保龄球的残瓶：Greek Church 留下的是 4–6–7–8–10 或 4–6–7–9–10 号瓶，
// 麻将没有十饼，所以她听的是四、六、七、八（九）饼。
// - 保龄球听牌：听的牌全是四、六、七、八、九饼里的（五饼、一到三饼、别的花色都不算），每次摸牌有很大的概率摸到和了牌（和了要成立）
// - 希腊教堂：保龄球听牌里同时听四饼和六到九饼（残瓶分在两边），概率更高
// - 围绕筒子：配牌偏向筒子；还没听牌时摸牌有时换成有用的筒子，一向听时优先换成能听成保龄球型的牌
// 立直不立直都起作用。电脑的灼留筒子、听牌时挑保龄球型的听法。
// 赤土晴绘的炎上精神：憧憬晴绘，牌风带着上一代的古风（船久保浩子说是“旧时代”），这里只是性格，不另算能力
export const ARATA = {
  bowl: 0.4, // 保龄球听牌时，每次摸牌把和了牌换上来的概率
  church: 0.55, // 希腊教堂（同时听四饼和六到九饼）时的概率
  lean: 0.15, // 没听牌时，摸牌换成有用的筒子的概率
  deal: 0.2, // 配牌里不是筒子的牌换成筒子的概率
};

const PIN = 9; // 一饼的牌种
const PIN_END = 17; // 九饼
const FOUR = 12; // 四饼
// 保龄球的残瓶：四、六、七、八、九饼
export const BOWLING_KINDS = new Set<number>([12, 14, 15, 16, 17]);

export const isPin = (k: number) => k >= PIN && k <= PIN_END;

export type BowlingShape = 'bowl' | 'church';

// 听这些牌算不算保龄球型：全是残瓶里的牌；四饼和六到九饼都听是希腊教堂
export function bowlingShape(waits: readonly number[]): BowlingShape | null {
  if (waits.length === 0 || !waits.every((w) => BOWLING_KINDS.has(w))) return null;
  return waits.includes(FOUR) && waits.some((w) => w > FOUR) ? 'church' : 'bowl';
}

// 这手 13 张（按牌种计数）听成什么样
export function bowlingOf(counts: readonly number[], meldCount: number): BowlingShape | null {
  return bowlingShape(waitingKinds(counts, meldCount));
}

// 现在（13 张时）是不是保龄球听牌
export function arataShape(g: Game, seat: number): BowlingShape | null {
  const p = g.players[seat];
  if (p.hand.length % 3 !== 1) return null;
  return bowlingOf(toCounts(p.hand), p.melds.length);
}

const SHAPE_NAME: Record<BowlingShape, string> = { bowl: '保龄球', church: '希腊教堂' };

// 一向听时：摸进哪些牌种能打一张听成保龄球型
function bowlingDraws(counts: number[], meldCount: number): Set<number> {
  const out = new Set<number>();
  for (let k = 0; k < counts.length; k++) {
    if (counts[k] >= 4) continue;
    counts[k]++;
    for (let d = 0; d < counts.length && !out.has(k); d++) {
      if (!counts[d]) continue;
      counts[d]--;
      if (bowlingOf(counts, meldCount)) out.add(k);
      counts[d]++;
    }
    counts[k]--;
  }
  return out;
}

export const arataAbility: Ability = {
  id: 'arata',
  name: '保龄球',
  description: `被动。听的牌全是四、六、七、八、九饼里的（保龄球的残瓶，Greek Church）时，每次摸牌有 ${Math.round(ARATA.bowl * 100)}% 的概率摸到和了牌；同时听四饼和六到九饼（希腊教堂）提高到 ${Math.round(ARATA.church * 100)}%（和了要成立，立直也算）。配牌偏向筒子，没听牌时摸牌常换成有用的筒子。`,

  // 她配牌里不是筒子的牌有时换成筒子（换不了就算了，不压别人的规矩）
  beforeDeal(g, seat) {
    const w = g.wall;
    const later = (j: number) => j >= 52;
    const pin = (t: TileId) => isPin(kindOf(t));
    for (const i of g.dealIndices(seat)) if (!pin(w.live[i]) && g.rng.chance(ARATA.deal)) w.bringToLive(i, pin, g.rng, later);
  },

  beforeDraw(g, seat, rinshan) {
    const p = g.players[seat];
    const shape = arataShape(g, seat);
    const w = g.wall;
    if (shape) {
      if (!g.canWin(seat)) return;
      const waits = waitingKinds(toCounts(p.hand), p.melds.length);
      // 有役的和了牌：先放进手里试一下
      const wins = (t: TileId) => {
        if (!waits.includes(kindOf(t))) return false;
        p.hand.push(t);
        const ok = !!g.winResult(seat, t, true);
        p.hand.pop();
        return ok;
      };
      const next = rinshan ? w.rinshan[0] : w.live[0];
      if (next === undefined || wins(next) || !g.rng.chance(shape === 'church' ? ARATA.church : ARATA.bowl)) return;
      // 牌山里没有了就从王牌里找（岭上牌、还没翻的里宝牌指示牌），也不能越过别人对这次摸牌定的规矩
      const ok = (rinshan ? w.bringToRinshan(wins, g.rng) : w.bringToLive(0, wins, g.rng)) || w.bringFromDead(rinshan, (t) => wins(t) && !w.deny?.(t), g.rng);
      if (ok) g.emit({ type: 'ability', seat, ability: 'arata', text: SHAPE_NAME[shape] });
      return;
    }
    // 还没听牌：围绕筒子
    if (rinshan || p.hand.length % 3 !== 1 || !g.rng.chance(ARATA.lean)) return;
    const counts = toCounts(p.hand);
    const sh = shanten(counts, p.melds.length);
    if (sh < 1) return;
    const better = new Set<number>();
    for (let k = PIN; k <= PIN_END; k++) {
      if (counts[k] >= 4) continue;
      counts[k]++;
      if (shanten(counts, p.melds.length) < sh) better.add(k);
      counts[k]--;
    }
    const bowl = sh === 1 ? bowlingDraws(counts, p.melds.length) : new Set<number>();
    (bowl.size > 0 && w.bringToLive(0, (t) => bowl.has(kindOf(t)), g.rng)) || (better.size > 0 && w.bringToLive(0, (t) => better.has(kindOf(t)), g.rng));
  },

  skill(g, seat) {
    const shape = arataShape(g, seat);
    const note = shape ? `${SHAPE_NAME[shape]}听牌：自摸率大幅上升` : '听四、六、七、八、九饼时自摸率大幅上升';
    return { label: '', note, enabled: false, active: !!shape };
  },

  insight(g, seat) {
    const shape = arataShape(g, seat);
    return [shape ? `${SHAPE_NAME[shape]}听牌：自摸率大幅上升` : '还没听成保龄球型（四、六、七、八、九饼）'];
  },
};
