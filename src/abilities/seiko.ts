import type { Game } from '../engine/game';
import { waitingKinds } from '../engine/shanten';
import { TileId, kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 亦野诚子（白糸台）：钓鱼。鸣牌像钓鱼，鸣满三次就把和了牌「钓上来」。
// - 上钓：她的碰、吃、明杠一次就是钓到一条鱼。配牌里对子多一些
// - 三鸣必和：鸣满 SEIKO.fish 次并且听牌以后，接下来两次摸牌之内必定自摸（第四条鱼）。
//   第一次摸牌有一半的概率就来，第二次一定来（和了要有役：没役的和了牌不算）
// - 别人的解法：在她第三鸣之前先和、不打她能碰的牌、或者鸣牌把她的摸牌跳过
// 电脑的诚子：能碰就碰（对子多时奔对对和），先保证有役。别的电脑看到她鸣了两次就小心打
export const SEIKO = {
  fish: 3, // 鸣几次开始必和
  pairs: 0.8, // 配牌里单张补成对子的概率（一手最多补 pairMax 张）
  pairMax: 3,
  first: 0.5, // 听牌后第一次摸牌就来的概率
};

interface SeikoState {
  waited?: number; // 鸣满三次、听牌以后摸了几次没来
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as SeikoState;

// 钓到几条鱼了
export const seikoFish = (g: Game, seat: number) => g.players[seat].melds.filter((m) => m.type !== 'ankan').length;

export const seikoAbility: Ability = {
  id: 'seiko',
  name: '钓鱼',
  description: `碰、吃一次就是钓到一条鱼；配牌对子多一些。鸣满 ${SEIKO.fish} 次并且听牌以后，接下来两次摸牌之内必定自摸（和了要有役）。`,

  // 配牌：单张补成对子（换掉另一张单张）
  beforeDeal(g, seat) {
    const w = g.wall;
    const mine = g.dealIndices(seat);
    let done = 0;
    for (const i of g.rng.shuffle([...mine])) {
      if (done >= SEIKO.pairMax) break;
      const kinds = mine.map((x) => kindOf(w.live[x]));
      const k = kindOf(w.live[i]);
      if (kinds.filter((x) => x === k).length !== 1 || !g.rng.chance(SEIKO.pairs)) continue;
      // 和 k 凑对：把另一张孤立的单张换成 k
      const other = mine.find((x) => x !== i && kinds.filter((y) => y === kindOf(w.live[x])).length === 1 && kindOf(w.live[x]) !== k);
      if (other !== undefined && w.bringToLive(other, (t) => kindOf(t) === k, g.rng, (j) => j >= 52)) done++;
    }
  },

  beforeDraw(g, seat, rinshan) {
    const st = stateOf(g, seat);
    const p = g.players[seat];
    if (seikoFish(g, seat) < SEIKO.fish || !g.canWin(seat)) return;
    const waits = waitingKinds(toCounts(p.hand), p.melds.length);
    if (!waits.length) return;
    // 有役的和了牌：先放进手里试一下
    const wins = (t: TileId) => {
      if (!waits.includes(kindOf(t))) return false;
      p.hand.push(t);
      const ok = !!g.winResult(seat, t, true);
      p.hand.pop();
      return ok;
    };
    const n = st.waited ?? 0;
    st.waited = n + 1;
    if (n === 0 && !g.rng.chance(SEIKO.first)) return;
    const w = g.wall;
    const ok = rinshan ? wins(w.rinshan[0]) || w.bringToRinshan(wins, g.rng) : wins(w.live[0]) || w.bringToLive(0, wins, g.rng);
    if (ok) g.emit({ type: 'ability', seat, ability: 'seiko', text: '第四条鱼' });
  },

  onRoundStart(g, seat) {
    stateOf(g, seat).waited = 0;
  },

  skill(g, seat) {
    const n = seikoFish(g, seat);
    return { label: '', note: n >= SEIKO.fish ? '鱼钓满了：听牌以后两次摸牌之内自摸' : `钓到 ${n} 条鱼，满 ${SEIKO.fish} 条必和`, enabled: false, meter: { value: Math.min(n, SEIKO.fish), max: SEIKO.fish }, active: n >= SEIKO.fish };
  },

  badge(g, seat) {
    const n = seikoFish(g, seat);
    return n ? `鱼${Math.min(n, SEIKO.fish)}` : null;
  },

  insight(g, seat) {
    return [`钓到 ${seikoFish(g, seat)} 条鱼，满 ${SEIKO.fish} 条并且听牌以后两次摸牌之内自摸`];
  },
};
