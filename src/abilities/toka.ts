import type { Game, RoundResult } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 龙门渊透华：常态是比普通人好一点的数字派，配牌、进张比没有能力的人顺 5%。
// 场上四家的点数加起来变动超过 10 万点（一家加、一家减只算一次）以后，下一局起进入“治水”，一直到终局：
// - 牌局平静如水：谁也吃、碰、杠不了（明杠、暗杠、加杠都不行；她自己也不鸣）。
//   别人的能力动不了的人（照）、佛灭的那一局照常能鸣（Game.callsFrozen）
// - 别人每次摸牌，听着牌的话有一半的概率摸不到和了牌（自摸概率减半）
// - 常态的 5% 照样有
//
// 怎么让牌桌几乎没有吃碰杠（研究过两种做法，见 PR 说明）：
// 只靠换牌（别人只摸得到打出去谁也鸣不了的死牌）模拟下来鸣牌只少 35%（每局 1.57 → 1.02 次），
// 因为能鸣的牌大多来自配牌。所以治水直接把鸣牌这条路封住，和桃子隐身时别人鸣不了她的牌是同一类规矩。
export const TOKA = {
  luck: 0.05, // 常态：配牌、进张比没有能力的人顺多少
  dealTries: 4, // 配牌最多换几张（每张按 luck 的概率换）
  // 四家点数变动加起来超过这么多进入治水。一家加一家减只算一次时半庄整场变动中位数只有 6.9 万，
  // 300 半庄只有约 2% 进得了治水（5 万的话是 65%）。原作里透华的治水本来就难得一见；
  // 想直接玩治水的，对局设置里选“开局就治水”（PlayerConfig.startForm）
  threshold: 100000,
  tsumoCut: 0.5, // 治水：别人摸到和了牌的概率砍掉多少
};

interface TokaGameState {
  moved?: number; // 到现在为止四家点数变动了多少（一家加一家减只算一次）
  at?: number; // 超过门槛的是第几局（Game.round）：下一局起是治水
  since?: number; // 被淡的平行宇宙清空时是第几局：那一局不算
  dropped?: boolean; // 开局就治水的透华被平行宇宙打回常态（之后照点数变动重新数）
}

const stateOf = (g: Game, seat: number) => g.abilityGameState[seat] as TokaGameState;

// 马上要开的这一局（发牌前）或者现在这一局
const roundNow = (g: Game) => (g.phase === 'predeal' ? g.round + 1 : g.round);

// 到现在为止四家点数变动了多少
export function tokaMoved(g: Game, seat: number): number {
  return stateOf(g, seat).moved ?? 0;
}

// 这一局是不是治水（不看封印：封印由 Game.active 管）
export function tokaChisuiOn(g: Game, seat: number): boolean {
  // 对局设置里选了“开局就治水”
  if (g.startForm[seat] && !stateOf(g, seat).dropped) return true;
  const at = stateOf(g, seat).at;
  return at !== undefined && roundNow(g) > at;
}

// 这一局起作用的治水
export function tokaChisui(g: Game, seat: number): boolean {
  return g.active(seat)?.id === 'toka' && tokaChisuiOn(g, seat);
}

// 一局里四家点数变了多少：立直棒交出去算减，收回来算加；加的和减的取大的（一家加一家减只算一次）
export function roundMovement(g: Game, result: RoundResult): number {
  let up = 0;
  let down = 0;
  result.deltas.forEach((d, s) => {
    const change = d - (g.players[s].riichi ? 1000 : 0);
    if (change > 0) up += change;
    else down -= change;
  });
  return Math.max(up, down);
}

// 配牌顺：按概率把没用的牌换成让向听前进的牌（从发完牌以后的牌山里拿）
function luckyDeal(g: Game, seat: number, p: number): void {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  for (let n = 0; n < TOKA.dealTries; n++) {
    if (!g.rng.chance(p)) continue;
    const counts = toCounts(mine.map((j) => w.live[j]));
    const cur = shanten(counts, 0);
    if (cur <= 0) break;
    const spare = g.rng.shuffle([...mine]).filter((i) => {
      const k = kindOf(w.live[i]);
      counts[k]--;
      const ok = shanten(counts, 0) === cur;
      counts[k]++;
      return ok;
    });
    for (const i of spare) {
      const k = kindOf(w.live[i]);
      counts[k]--;
      const better = (t: TileId) => {
        counts[kindOf(t)]++;
        const sh = shanten(counts, 0);
        counts[kindOf(t)]--;
        return sh < cur;
      };
      const done = w.bringToLive(i, better, g.rng, (j) => j >= 52);
      counts[k]++;
      if (done) break;
    }
  }
}

const CHISUI = '治水';

export const tokaAbility: Ability = {
  id: 'toka',
  name: '治水',
  description: `常态下配牌、进张比没有能力的人顺 ${TOKA.luck * 100}%。场上四家点数加起来变动超过 ${TOKA.threshold / 10000} 万点（一家加一家减只算一次）以后，下一局起进入治水直到终局：牌局平静如水，谁也吃、碰、杠不了；别人自摸的概率减半。`,

  // 平行宇宙：变动从零数起，治水退回常态，这一局也不算
  resetMarks(g, seat) {
    const st = stateOf(g, seat);
    st.moved = 0;
    st.at = undefined;
    st.since = g.round;
    st.dropped = true;
  },

  // 每局结束累计点数变动（被封印也照样数）
  onRoundEnd(g, seat, result) {
    const st = stateOf(g, seat);
    if (st.since === g.round) return;
    st.moved = (st.moved ?? 0) + roundMovement(g, result);
    if (st.at === undefined && st.moved > TOKA.threshold) st.at = g.round;
  },

  form(g, seat) {
    return tokaChisuiOn(g, seat) ? 'chisui' : null;
  },

  freezesCalls(g, seat) {
    return tokaChisuiOn(g, seat);
  },

  beforeDeal(g, seat) {
    luckyDeal(g, seat, TOKA.luck);
  },

  onRoundStart(g, seat) {
    if (!tokaChisuiOn(g, seat)) return;
    // 进入治水的那一局放一次
    if (g.events.some((e) => e.type === 'ability' && e.seat === seat && e.text === CHISUI)) return;
    g.emit({ type: 'ability', seat, ability: 'toka', text: CHISUI });
  },

  // 治水：别人听着牌，有一半的概率摸不到和了牌
  beforeAnyDraw(g, seat, drawer) {
    if (drawer === seat || !tokaChisuiOn(g, seat)) return;
    const waits = g.waits(drawer);
    if (!waits.length || !g.rng.chance(TOKA.tsumoCut)) return;
    return { seat, ability: 'toka', text: '静水', deny: (t) => waits.includes(kindOf(t)) };
  },

  // 自己摸牌：按概率换成有效进张（听牌时就是和了牌）
  beforeDraw(g, seat, rinshan) {
    if (!g.rng.chance(TOKA.luck)) return;
    const pl = g.players[seat];
    const counts = toCounts(pl.hand);
    const sh = shanten(counts, pl.melds.length);
    const useful = (t: TileId) => {
      counts[kindOf(t)]++;
      const after = shanten(counts, pl.melds.length);
      counts[kindOf(t)]--;
      return after < sh;
    };
    if (rinshan) g.wall.bringToRinshan(useful, g.rng);
    else g.wall.bringToLive(0, useful, g.rng);
  },

  skill(g, seat) {
    const moved = tokaMoved(g, seat);
    if (tokaChisuiOn(g, seat)) return { label: '', note: '治水：谁也鸣不了牌，别人自摸减半', enabled: false, active: true };
    const left = Math.max(0, TOKA.threshold - moved);
    const note = stateOf(g, seat).at !== undefined ? '下一局起治水' : `点数变动 ${(moved / 10000).toFixed(1)} 万，再 ${(left / 10000).toFixed(1)} 万进入治水`;
    return { label: '', note, enabled: false, meter: { value: Math.min(moved, TOKA.threshold), max: TOKA.threshold } };
  },

  badge(g, seat) {
    return tokaChisuiOn(g, seat) ? '治水' : null;
  },

  insight(g, seat) {
    if (tokaChisuiOn(g, seat)) return ['治水：牌局平静如水，谁也吃、碰、杠不了', '别人自摸的概率减半'];
    return [`常态：配牌、进张顺 ${TOKA.luck * 100}%`, `点数变动 ${(tokaMoved(g, seat) / 10000).toFixed(1)} 万 / ${TOKA.threshold / 10000} 万`];
  },
};
