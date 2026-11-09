import type { Game, RoundResult } from '../engine/game';
import { shanten, standardShanten } from '../engine/shanten';
import { Kind, TileId, kindOf, toCounts } from '../engine/tiles';
import { usefulKinds } from './jun';
import type { Ability } from './types';

// 龙门渊透华：常态是比普通人好一点的数字派，配牌、进张比没有能力的人顺 5%。
// 场上四家的点数加起来变动超过 10 万点（一家加、一家减只算一次）以后，下一局起进入“治水”，一直到终局：
// - 牌局平静如水：只靠换牌让吃碰杠几乎不出现，鸣牌按钮照常（真有能鸣的牌照样能鸣）
//   1. 配牌：别人的配牌里对子压到 calmPairs 个以内（碰的机会少）
//   2. 摸牌：别人只摸得到打出去谁也鸣不了的死牌（别人手里成对的、下家能吃的都不来；自己摸了能暗杠、加杠的也不来；
//      手里已经有一个对子的，再成对的也不来）。听牌的人的和了牌不算在里面，由下面的自摸减半管
//   3. 透华自己摸的牌也是死牌（有效进张照样来），电脑的透华治水时自己也不鸣
//   换牌时进不进张照原来那张：本来是有效进张就换成别的有效进张，本来是废牌就换成别的废牌，手牌快慢和平常一样
// - 别人听牌时自摸的概率减半（本来摸得到和了牌的，按 tsumoCut 换成废牌）
// - 常态的 5% 照样有
// 都是控场的规矩：照这样别人动不了的人、佛灭的那一局、天使和挡掉的一半照常不受影响
export const TOKA = {
  luck: 0.05, // 常态：配牌、进张比没有能力的人顺多少
  dealTries: 4, // 配牌最多换几张（每张按 luck 的概率换）
  // 四家点数变动加起来超过这么多进入治水。一家加一家减只算一次时半庄整场变动中位数只有 6.9 万，
  // 300 半庄只有约 2% 进得了治水（5 万的话是 65%）。原作里透华的治水本来就难得一见；
  // 想直接玩治水的，对局设置里选“开局就治水”（PlayerConfig.startForm）
  threshold: 100000,
  // 治水：别人本来摸得到和了牌的，按这个概率换成废牌。治水时别人摸不走有用的牌，牌山里剩的和了牌比平常多，
  // 砍一半的话自摸率和常态差不多；砍 85% 算下来没有能力的人听牌时自摸率 4.5% → 2.5%，大约减半
  tsumoCut: 0.85,
  calmPairs: 1, // 治水：别人的配牌最多留几个对子
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
// 只看一般形的向听：七对子的向听也算的话，凑对子的牌也算“降向听”，配牌会偏成七对子
function luckyDeal(g: Game, seat: number, p: number): void {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  for (let n = 0; n < TOKA.dealTries; n++) {
    if (!g.rng.chance(p)) continue;
    const counts = toCounts(mine.map((j) => w.live[j]));
    const cur = standardShanten(counts, 0);
    if (cur <= 0) break;
    const spare = g.rng.shuffle([...mine]).filter((i) => {
      const k = kindOf(w.live[i]);
      counts[k]--;
      const ok = standardShanten(counts, 0) === cur;
      counts[k]++;
      return ok;
    });
    for (const i of spare) {
      const k = kindOf(w.live[i]);
      counts[k]--;
      const better = (t: TileId) => {
        counts[kindOf(t)]++;
        const sh = standardShanten(counts, 0);
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

// 一手牌里有几个对子（刻子也算一个）
function pairsIn(hand: TileId[]): number {
  return toCounts(hand).filter((n) => n >= 2).length;
}

// 把 target 配牌里多出来的对子拆掉：对子里的一张换成发完牌以后牌山里、她手里没有的牌。
// 换牌由 Wall.guard 把关，别人对这家配牌的规矩不会变差
function breakPairs(g: Game, target: number): void {
  const w = g.wall;
  const idx = g.dealIndices(target);
  for (let n = 0; n < 8; n++) {
    const counts = toCounts(idx.map((i) => w.live[i]));
    if (counts.filter((c) => c >= 2).length <= TOKA.calmPairs) return;
    const extra = g.rng.shuffle(idx.filter((i) => counts[kindOf(w.live[i])] >= 2));
    if (!extra.some((i) => w.bringToLive(i, (t) => counts[kindOf(t)] === 0, g.rng, (j) => j >= 52))) return;
  }
}

// 摸了会让牌局起波澜的牌种（drawer 摸了以后打出去会被人鸣）：别人手里成对的（碰、明杠），下家手里有搭子的（吃）；
// drawer 自己摸了能暗杠、加杠的。立直的人不鸣。
// calm：drawer 手里已经有 calmPairs 个对子时，再成对的牌也不来（对子多了以后打出去的牌容易被碰）
function liveKinds(g: Game, drawer: number, rinshan: boolean, calm: boolean): Set<Kind> {
  const out = new Set<Kind>();
  if (rinshan) return out;
  for (let o = 0; o < 4; o++) {
    const p = g.players[o];
    const c = toCounts(p.hand);
    if (o === drawer) {
      c.forEach((n, k) => n >= 3 && out.add(k));
      for (const m of p.melds) if (m.type === 'pon') out.add(kindOf(m.tiles[0]));
      if (calm && c.filter((n) => n >= 2).length >= TOKA.calmPairs) c.forEach((n, k) => n === 1 && out.add(k));
      continue;
    }
    if (p.riichi) continue;
    c.forEach((n, k) => n >= 2 && out.add(k));
    if (o !== (drawer + 1) % 4) continue;
    for (let k = 0; k < 27; k++) {
      const n = k % 9;
      if ((n >= 2 && c[k - 2] && c[k - 1]) || (n >= 1 && n <= 7 && c[k - 1] && c[k + 1]) || (n <= 6 && c[k + 1] && c[k + 2])) out.add(k);
    }
  }
  return out;
}

export const tokaAbility: Ability = {
  id: 'toka',
  name: '治水',
  description: `常态下配牌、进张比没有能力的人顺 ${TOKA.luck * 100}%。场上四家点数加起来变动超过 ${TOKA.threshold / 10000} 万点（一家加一家减只算一次）以后，下一局起进入治水直到终局：牌局平静如水，别人只摸得到谁也鸣不了的牌、配牌里对子很少，吃碰杠几乎不会出现；别人自摸的概率减半。`,

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

  // 治水：别人的配牌对子不超过 calmPairs 个
  dealRules(g, seat) {
    if (!tokaChisuiOn(g, seat)) return;
    return [0, 1, 2, 3]
      .filter((o) => o !== seat)
      .map((o) => ({ seat, ability: 'toka', text: '静水', target: o, bad: (hand: TileId[]) => Math.max(0, pairsIn(hand) - TOKA.calmPairs) }));
  },

  beforeDeal(g, seat) {
    luckyDeal(g, seat, TOKA.luck);
    if (!tokaChisuiOn(g, seat)) return;
    for (let o = 0; o < 4; o++) if (o !== seat) breakPairs(g, o);
  },

  onRoundStart(g, seat) {
    if (!tokaChisuiOn(g, seat)) return;
    // 进入治水的那一局放一次
    if (g.events.some((e) => e.type === 'ability' && e.seat === seat && e.text === CHISUI)) return;
    g.emit({ type: 'ability', seat, ability: 'toka', text: CHISUI });
  },

  // 治水：别人只摸得到死牌；听着牌的话有一半的概率摸不到和了牌。
  // 换牌时进不进张照原来那张：原来是有效进张（听牌时是和了牌）就换成别的有效进张，原来不是就换成别的废牌。
  // 不这样的话，能摸的牌种一少，有效进张反而摸得更多（别人和得更快）
  beforeAnyDraw(g, seat, drawer, rinshan) {
    if (drawer === seat || !tokaChisuiOn(g, seat)) return;
    const top = rinshan ? g.wall.rinshan[0] : g.wall.live[0];
    if (top === undefined) return;
    const waits = new Set(g.waits(drawer));
    const useful = waits.size ? waits : usefulKinds(g, drawer);
    let want = useful.has(kindOf(top));
    // 自摸减半：本来摸得到和了牌的，一半换成废牌
    if (want && waits.size && g.rng.chance(TOKA.tsumoCut)) want = false;
    const live = liveKinds(g, drawer, rinshan, true);
    for (const k of waits) live.delete(k);
    const deny = (t: TileId) => useful.has(kindOf(t)) !== want || live.has(kindOf(t));
    if (!deny(top)) return;
    return { seat, ability: 'toka', text: '静水', deny };
  },

  // 自己摸牌：按概率换成有效进张（听牌时就是和了牌）。
  // 治水时她自己摸的牌也是死牌：打出去谁也鸣不了（有效进张照样来）
  beforeDraw(g, seat, rinshan) {
    const pl = g.players[seat];
    const counts = toCounts(pl.hand);
    const sh = shanten(counts, pl.melds.length);
    const useful = (t: TileId) => {
      counts[kindOf(t)]++;
      const after = shanten(counts, pl.melds.length);
      counts[kindOf(t)]--;
      return after < sh;
    };
    if (g.rng.chance(TOKA.luck)) {
      if (rinshan) g.wall.bringToRinshan(useful, g.rng);
      else g.wall.bringToLive(0, useful, g.rng);
    }
    if (rinshan || !tokaChisui(g, seat)) return;
    // 进不进张照原来那张，免得能摸的牌种一少、有效进张反而来得多
    const top = g.wall.live[0];
    if (top === undefined || useful(top)) return;
    const live = liveKinds(g, seat, false, false);
    if (live.has(kindOf(top))) g.wall.bringToLive(0, (t) => !useful(t) && !live.has(kindOf(t)), g.rng);
  },

  skill(g, seat) {
    const moved = tokaMoved(g, seat);
    if (tokaChisuiOn(g, seat)) return { label: '', note: '治水：牌局平静如水，别人自摸减半', enabled: false, active: true };
    const left = Math.max(0, TOKA.threshold - moved);
    const note = stateOf(g, seat).at !== undefined ? '下一局起治水' : `点数变动 ${(moved / 10000).toFixed(1)} 万，再 ${(left / 10000).toFixed(1)} 万进入治水`;
    return { label: '', note, enabled: false, meter: { value: Math.min(moved, TOKA.threshold), max: TOKA.threshold } };
  },

  badge(g, seat) {
    return tokaChisuiOn(g, seat) ? '治水' : null;
  },

  insight(g, seat) {
    if (tokaChisuiOn(g, seat)) return ['治水：牌局平静如水，别人只摸得到谁也鸣不了的牌，吃碰杠几乎不会出现', '别人自摸的概率减半'];
    return [`常态：配牌、进张顺 ${TOKA.luck * 100}%`, `点数变动 ${(tokaMoved(g, seat) / 10000).toFixed(1)} 万 / ${TOKA.threshold / 10000} 万`];
  },
};
