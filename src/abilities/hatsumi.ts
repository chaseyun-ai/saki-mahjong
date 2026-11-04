import type { Game } from '../engine/game';
import { shanten, waitingKinds } from '../engine/shanten';
import { EAST, NORTH, SOUTH, TileId, WEST, kindOf, toCounts } from '../engine/tiles';
import { PRIORITY, type Ability } from './types';

// 薄墨初美（永水）：里鬼门。东北（鬼门）方向的东风、北风是她的。
// 只在坐北家的局起作用（不坐北家时鸣出东北也没有里鬼门、不发光）
// - 坐北家的局：西风、南风留给她：别人的配牌里没有，她凑齐西南以前别人也摸不到（岭上牌除外）
// - 坐北家的局：配牌里必定有两张东风、两张北风；有一点概率其中一种是三张（暗刻），之后摸到第四张开杠
// - 东风、北风都鸣出来（碰、明杠、暗杠都算）以后：接下来摸牌必定摸到剩下的西风、南风，凑成一刻一对，
//   之后进张也顺，最后一般做成小四喜
// 特效：东北都鸣出来以后，紫色的风在牌桌上聚集，离听牌越近越多，听牌时最多；和牌时那张牌上无数紫光往上冲；
// 鸣出来的东、北中间那张牌的字发紫光。电脑的初美碰风牌、留风牌、风牌能杠就杠
export const HATSUMI = {
  dealEach: 2, // 坐北家时配牌里东风、北风各至少几张
  triplet: 0.2, // 配牌里东或北是三张的概率
  kanDraw: 0.35, // 有暗刻的局，每次摸牌把第四张换上来的概率
  kanWithin: 10, // 第四张最晚第几次摸牌之前来（之后不再管）
  speed: 0.45, // 西南凑齐以后、没听牌时，摸牌换成有用的牌的概率
  win: 0.4, // 听牌以后，摸牌换成和了牌的概率
};

interface HatsumiState {
  north?: boolean; // 这一局坐北家，配牌已经安排好
  kan?: number; // 配牌是三张的那种风（等第四张）
  draws?: number; // 这一局摸了几次
  gale?: boolean; // 东北都鸣出来了（已经发过“里鬼门”）
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as HatsumiState;

// 鸣出来的风（碰、杠、暗杠）
const meldedKinds = (g: Game, seat: number) => new Set(g.players[seat].melds.filter((m) => m.type !== 'chi').map((m) => kindOf(m.tiles[0])));

const isNorthSeat = (g: Game, seat: number) => g.seatWind(seat) === NORTH;

// 坐北家、东风北风都鸣出来了（里鬼门只在北家的局起作用：不坐北家时鸣出东北也不算）
export function hatsumiOpen(g: Game, seat: number): boolean {
  if (!isNorthSeat(g, seat)) return false;
  const k = meldedKinds(g, seat);
  return k.has(EAST) && k.has(NORTH);
}

// 西风、南风各有几张（鸣出来的算三张）：一种凑一刻，另一种凑一对。
// 挑哪种凑刻：牌山（含没翻开的王牌）里剩的够凑的那种，都够就挑手里多的
function westSouth(g: Game, seat: number): { big: number; small: number; have: Record<number, number> } {
  const k = meldedKinds(g, seat);
  const hand = g.players[seat].hand;
  const w = g.wall;
  const have: Record<number, number> = {};
  const avail: Record<number, number> = {};
  for (const x of [WEST, SOUTH]) {
    have[x] = k.has(x) ? 3 : hand.filter((t) => kindOf(t) === x).length;
    avail[x] = have[x] + (k.has(x) ? 0 : [...w.live, ...w.rinshan, ...w.uraIndicators].filter((t) => kindOf(t) === x).length);
  }
  const fits = (big: number, small: number) => avail[big] >= 3 && avail[small] >= 2;
  const pref = have[SOUTH] > have[WEST] ? SOUTH : WEST;
  const other = pref === WEST ? SOUTH : WEST;
  const big = fits(pref, other) || !fits(other, pref) ? pref : other;
  return { big, small: big === WEST ? SOUTH : WEST, have };
}

// 西南还差的那张：凑刻的那种先凑到三张，另一种凑到两张；凑齐了是 null
function windNeed(g: Game, seat: number): number | null {
  const { big, small, have } = westSouth(g, seat);
  if (have[big] < 3) return big;
  if (have[small] < 2) return small;
  return null;
}

// 这一次摸牌先找哪种风：还差的那种，没有了（在别人手里）就找另一种（之后可以碰别人打出来的）
function windOrder(g: Game, seat: number): number[] {
  const need = windNeed(g, seat);
  if (need === null) return [];
  const other = need === WEST ? SOUTH : WEST;
  const k = meldedKinds(g, seat);
  return k.has(other) || g.players[seat].hand.filter((t) => kindOf(t) === other).length >= 3 ? [need] : [need, other];
}

// 风聚得多浓（0–1）：东北没鸣出来是 0；之后照小四喜的进度，西南凑得越齐越浓，听牌时最浓（1）
export function hatsumiGale(g: Game, seat: number): number {
  if (!g.active(seat) || !hatsumiOpen(g, seat)) return 0;
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  // 摸了牌（14 张）时按打掉一张以后最好的算
  let sh = shanten(counts, p.melds.length);
  if (p.hand.length % 3 === 2) {
    sh = Infinity;
    for (let k = 0; k < counts.length; k++) {
      if (!counts[k]) continue;
      counts[k]--;
      sh = Math.min(sh, shanten(counts, p.melds.length));
      counts[k]++;
    }
  }
  if (sh <= 0) return 1;
  const { big, small, have } = westSouth(g, seat);
  const winds = Math.min(3, have[big]) + Math.min(2, have[small]);
  return Math.min(0.85, 0.2 + 0.11 * winds + (sh === 1 ? 0.1 : 0));
}

// 坐北家的局里，西风、南风还要留给她（别人的配牌里没有，也摸不到）：东北鸣出来、西南凑齐以前都留着；
// 凑齐以后放开。返回现在要留的风（空的是不留）
export function hatsumiHoard(g: Game, seat: number): number[] {
  if (!isNorthSeat(g, seat)) return [];
  if (!hatsumiOpen(g, seat)) return [WEST, SOUTH];
  return windNeed(g, seat) === null ? [] : [WEST, SOUTH].filter((k) => !meldedKinds(g, seat).has(k));
}

// 发紫光的牌：初美鸣出来的东、北，每一副中间那张（摆法照 meldLayout，这里给出那一副的牌，界面挑中间的）
export function hatsumiGlowMelds(g: Game, seat: number): number[] {
  if (!g.active(seat) || !isNorthSeat(g, seat)) return [];
  return g.players[seat].melds.map((m, i) => ({ m, i })).filter(({ m }) => m.type !== 'chi' && (kindOf(m.tiles[0]) === EAST || kindOf(m.tiles[0]) === NORTH)).map(({ i }) => i);
}

export const hatsumiAbility: Ability = {
  id: 'hatsumi',
  name: '里鬼门',
  description: `只在坐北家的局起作用。西风、南风留给她：别人的配牌里没有，西南凑齐以前别人也摸不到。配牌必定有 ${HATSUMI.dealEach} 张东风、${HATSUMI.dealEach} 张北风，有 ${Math.round(HATSUMI.triplet * 100)}% 的概率其中一种是暗刻，之后摸到第四张开杠。东风、北风都鸣出来以后，接下来必定摸到剩下的西风、南风（凑一刻一对），之后进张也顺，一般做成小四喜。`,

  priority: PRIORITY.hatsumi,

  // 坐北家：配牌里东、北各至少两张（别人调整配牌不许把它弄坏）；别人的配牌里没有西风、南风（留给她）
  dealRules(g, seat) {
    const st = stateOf(g, seat);
    st.north = false;
    st.kan = undefined;
    st.draws = 0;
    st.gale = false;
    if (!isNorthSeat(g, seat)) return;
    st.north = true;
    const missing = (hand: TileId[]) => [EAST, NORTH].reduce((n, k) => n + Math.max(0, HATSUMI.dealEach - hand.filter((t) => kindOf(t) === k).length), 0);
    const ws = (hand: TileId[]) => hand.filter((t) => kindOf(t) === WEST || kindOf(t) === SOUTH).length;
    return [
      { seat, ability: 'hatsumi', text: '里鬼门', target: seat, bad: missing },
      ...[0, 1, 2, 3].filter((s) => s !== seat).map((s) => ({ seat, ability: 'hatsumi', text: '鬼门·西南', target: s, bad: ws })),
    ];
  },

  beforeDeal(g, seat) {
    const st = stateOf(g, seat);
    if (!st.north) return;
    const w = g.wall;
    const mine = g.dealIndices(seat);
    const want: Record<number, number> = { [EAST]: HATSUMI.dealEach, [NORTH]: HATSUMI.dealEach };
    if (g.rng.chance(HATSUMI.triplet)) {
      const k = g.rng.chance(0.5) ? EAST : NORTH;
      want[k] = HATSUMI.dealEach + 1;
      st.kan = k;
    }
    // 先从没发的牌里换，不够再从别人的配牌里换（Wall.guard 管着别人的规矩）
    const later = (j: number) => j >= 52;
    const notMine = (j: number) => !mine.includes(j);
    for (const k of [EAST, NORTH]) {
      for (;;) {
        const hand = mine.map((i) => w.live[i]);
        if (hand.filter((t) => kindOf(t) === k).length >= want[k]) break;
        // 换掉一张不是东北的牌（字牌留着，先换数牌）
        const slot = mine.find((i) => kindOf(w.live[i]) < 27) ?? mine.find((i) => kindOf(w.live[i]) !== EAST && kindOf(w.live[i]) !== NORTH);
        if (slot === undefined) break;
        const is = (t: TileId) => kindOf(t) === k;
        if (!w.bringToLive(slot, is, g.rng, later) && !w.bringToLive(slot, is, g.rng, notMine)) break;
      }
    }
    // 暗刻没凑成就不等第四张
    if (st.kan !== undefined && mine.filter((i) => kindOf(w.live[i]) === st.kan).length < 3) st.kan = undefined;
    // 别人配牌里的西风、南风换到发完牌以后的牌山里（换不了的留着，无解降级）
    const isWS = (t: TileId) => kindOf(t) === WEST || kindOf(t) === SOUTH;
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      for (const i of g.dealIndices(s)) {
        if (!isWS(w.live[i])) continue;
        const swap = () => w.bringToLive(i, (t) => !isWS(t), g.rng, later);
        if (!swap()) g.dealFallback(seat, swap);
      }
    }
  },

  // 坐北家的局：西南凑齐以前，别人摸不到西风、南风（岭上牌除外）
  beforeAnyDraw(g, seat, drawer, rinshan) {
    if (drawer === seat || rinshan) return;
    const keep = hatsumiHoard(g, seat);
    if (!keep.length) return;
    return { seat, ability: 'hatsumi', text: '鬼门·西南', deny: (t: TileId) => keep.includes(kindOf(t)) };
  },

  onRoundStart(g, seat) {
    if (stateOf(g, seat).north) g.emit({ type: 'ability', seat, ability: 'hatsumi', text: '鬼门' });
  },

  onCall(g, seat, caller) {
    const st = stateOf(g, seat);
    if (caller !== seat || st.gale || !hatsumiOpen(g, seat)) return;
    st.gale = true;
    g.emit({ type: 'ability', seat, ability: 'hatsumi', text: '里鬼门' });
  },

  beforeDraw(g, seat, rinshan) {
    const st = stateOf(g, seat);
    const p = g.players[seat];
    const w = g.wall;
    const draws = (st.draws = (st.draws ?? 0) + 1);
    const bring = (pred: (t: TileId) => boolean) =>
      rinshan ? pred(w.rinshan[0]) || w.bringToRinshan(pred, g.rng) : pred(w.live[0]) || w.bringToLive(0, pred, g.rng);
    // 配牌是暗刻的那种风：摸到第四张开杠
    if (st.kan !== undefined && !hatsumiOpen(g, seat)) {
      const k = st.kan;
      if (p.melds.some((m) => kindOf(m.tiles[0]) === k) || p.hand.filter((t) => kindOf(t) === k).length < 3 || draws > HATSUMI.kanWithin) st.kan = undefined;
      else if (g.rng.chance(HATSUMI.kanDraw) && bring((t) => kindOf(t) === k)) {
        st.kan = undefined;
        g.emit({ type: 'ability', seat, ability: 'hatsumi', text: '鬼门·杠' });
      }
      return;
    }
    if (!hatsumiOpen(g, seat) || p.hand.length % 3 !== 1) return;
    // 西风、南风：必定摸到（牌山里没有就从王牌里找）
    const order = windOrder(g, seat);
    if (order.length) {
      for (const need of order) {
        const is = (t: TileId) => kindOf(t) === need;
        if (bring(is) || w.bringFromDead(rinshan, (t) => is(t) && !w.deny?.(t), g.rng)) {
          g.emit({ type: 'ability', seat, ability: 'hatsumi', text: need === WEST ? '西风' : '南风' });
          return;
        }
      }
      return;
    }
    // 凑齐以后：听牌了容易摸到和了牌，没听牌时进张顺
    const counts = toCounts(p.hand);
    const sh = shanten(counts, p.melds.length);
    if (sh === 0) {
      if (!g.canWin(seat) || !g.rng.chance(HATSUMI.win)) return;
      const waits = waitingKinds(counts, p.melds.length);
      const wins = (t: TileId) => {
        if (!waits.includes(kindOf(t))) return false;
        p.hand.push(t);
        const ok = !!g.winResult(seat, t, true);
        p.hand.pop();
        return ok;
      };
      bring(wins);
      return;
    }
    if (rinshan || !g.rng.chance(HATSUMI.speed)) return;
    const better = new Set<number>();
    for (let k = 0; k < counts.length; k++) {
      if (counts[k] >= 4) continue;
      counts[k]++;
      if (shanten(counts, p.melds.length) < sh) better.add(k);
      counts[k]--;
    }
    if (better.size) w.bringToLive(0, (t) => better.has(kindOf(t)), g.rng);
  },

  skill(g, seat) {
    const open = hatsumiOpen(g, seat);
    const need = open ? windNeed(g, seat) : null;
    const note = open ? (need !== null ? `里鬼门：接下来摸到${need === WEST ? '西' : '南'}风` : '里鬼门：西南凑齐，奔小四喜') : isNorthSeat(g, seat) ? '坐北家：碰出东、北以后西南风会来' : '坐北家的局才有鬼门';
    return { label: '', note, enabled: false, active: open, meter: open ? { value: Math.round(hatsumiGale(g, seat) * 10), max: 10, label: '风' } : undefined };
  },

  // 东北都鸣出来以后，2.5D 头像框换成能力发动头像
  powered(g, seat) {
    return hatsumiOpen(g, seat);
  },

  badge(g, seat) {
    return hatsumiOpen(g, seat) ? '里鬼门' : stateOf(g, seat).north ? '鬼门' : null;
  },

  insight(g, seat) {
    if (hatsumiOpen(g, seat)) return ['东北都鸣出来了：接下来摸到西风、南风，奔小四喜'];
    return [stateOf(g, seat).north ? '坐北家：配牌有东、北各两张，碰出来以后西南风会来' : '不坐北家，这一局没有鬼门'];
  },
};
