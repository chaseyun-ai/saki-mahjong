import type { Game } from '../engine/game';
import { shanten, waitingKinds } from '../engine/shanten';
import { TileId, kindOf, suitOf, toCounts } from '../engine/tiles';
import { teruWinValue } from './teru';
import { PRIORITY, type Ability, type PreDealOption } from './types';

// 涅莉·薇萨拉兹（临海女子）：分配运势的人。家里穷，打得亮眼才拉得到赞助，所以她要和就和大牌。
// - 运势：开场 10 点，每打满 4 局恢复 1 点（第 5、9、13……局开始时，连庄、流局重打的局也算一局）。
// - 分配运势（每一局发牌前）：这一局押几点，押了就扣掉，和没和都不退：
//   · 1 点：配牌和进张朝满贯发展
//   · 2 点：朝倍满发展
//   · 3 点：朝三倍满发展，而且这一局她的和牌别人挡不住（别人的能力管不到她：不许和、换走和了牌、封印都不算）
//   做法：配牌偏向一种花色（档越高偏得越多），摸牌常换成那门花色的进张；听牌了但牌还不够大，就先来能把牌做大的牌，够大了再来和了牌。
//   押了几点只有她自己知道
// - 感知听牌：手里还有运势（押完这一局还剩 1 点以上）就看得出别人听没听牌（不知道听什么）。
// - 七姐妹：一场 7 次。押了运势的局自动开着：每有一家听牌，用掉一次封住他，这一局他和不了（自摸、荣和都不行）。
//   照这样别人能力管不到的人封不住；次数用完了就不封了
// 电脑的涅莉：自己坐庄的局（连庄的不算）押 3 点；别人能力最强的局（优希的东场、尧深的收获局、爽最后两局）不押；
// 其余的局把运势平摊到剩下的局里（最后一局押光）。押了运势的局门清做大，牌不够大先不和
export const NELLY = {
  start: 10, // 开场的运势
  every: 4, // 每打满几局恢复 1 点
  maxBet: 3, // 一局最多押几点
  sisters: 7,
  // 押 1/2/3 点时这一局要做到多大（子家的点数，庄家按 1.5 倍）：满贯、倍满、三倍满
  target: [0, 8000, 16000, 24000],
  deal: [0, 0.35, 0.55, 0.75], // 配牌里别的花色换成那门花色的概率
  good: [0, 0.55, 0.7, 0.85], // 摸牌换成有用的牌的概率
  late: 18, // 牌山剩这么多以下就有什么和什么（不再先做大）
};

const TIER_NAMES = ['', '满贯', '倍满', '三倍满'];

interface NellyGameState {
  spent?: number; // 一共押掉了几点
  pick?: number; // 玩家在发牌前界面押的
  sisters?: number; // 七姐妹还剩几次
  log?: number[]; // 每一局押了几点（照魔镜看得到）
}
interface NellyState {
  bet?: number; // 这一局押了几点
  blocked?: number[]; // 这一局被七姐妹封住、和不了的人
  suit?: number; // 这一局做的花色
}

const gameStateOf = (g: Game, seat: number) => {
  const gs = g.abilityGameState[seat] as NellyGameState;
  gs.sisters ??= NELLY.sisters;
  gs.spent ??= 0;
  gs.log ??= [];
  return gs;
};
const stateOf = (g: Game, seat: number) => {
  const st = g.abilityState[seat] as NellyState;
  st.blocked ??= [];
  return st;
};

// 第 round 局（从 1 数）开始时一共恢复了几点
const regen = (round: number) => Math.floor(Math.max(0, round - 1) / NELLY.every);

// 一局打完到下一局发牌之间（还没押）。电脑的局发牌时 phase 还是 roundEnd，要看这一局结算了没有
const between = (g: Game) => g.round === 0 || g.phase === 'predeal' || (g.phase === 'roundEnd' && g.roundResult !== null);

// 还剩几点运势。一局打完以后、发牌前（还没押）算的是马上要开的那一局能押的（算上这一局恢复的）
export function nellyPool(g: Game, seat: number): number {
  const round = between(g) ? g.round + 1 : g.round;
  if (!between(g)) tierOf(g, seat);
  return NELLY.start + regen(round) - gameStateOf(g, seat).spent!;
}

// 别人能力最强的局（第几局，东 1 是 0；8 局或 4 局）：这几局别人也要和，涅莉不去抢
const HOT: Record<string, (slots: number) => number[]> = {
  yuuki: (n) => (n === 8 ? [0, 1, 2, 3, 7] : [0, 1, 2, 3]), // 东场；最后一局有塔可饼
  takami: (n) => [n - 1], // 收获的局
  sawaya: (n) => [n - 2, n - 1], // 最后两局把云和神威用掉
};

// 电脑押几点。pool：能押的运势（算上剩下的局还会恢复的）；left：包括这一局还剩几局；dealer：这一局她坐庄（连庄的不算）；
// contested：这一局是别人能力最强的局
export function nellyAiBet(pool: number, left: number, dealer: boolean, contested: boolean): number {
  const cap = Math.min(NELLY.maxBet, pool);
  if (cap <= 0) return 0;
  if (left <= 1 || dealer) return cap;
  // 运势多到每一局都能押满，抢手的局也押
  if (contested && pool < NELLY.maxBet * left) return 0;
  return Math.min(cap, Math.max(1, Math.round(pool / left)));
}

const aiBet = (g: Game, seat: number) => {
  const slots = g.fullHanchan ? 8 : 4;
  const slot = g.roundWind * 4 + g.roundNumber;
  const left = Math.max(1, slots - slot);
  const contested = [0, 1, 2, 3].some((s) => s !== seat && (HOT[g.abilities[s]?.id ?? '']?.(slots) ?? []).includes(slot));
  const pool = nellyPoolBefore(g, seat);
  // 平摊时把后面还会恢复的算进去（东风战 4 局恢复不了；连庄会多出几局，按 1 局算）
  const plan = pool + Math.floor((left - 1) / NELLY.every);
  return Math.min(pool, nellyAiBet(plan, left + (g.honba > 0 ? 1 : 0), seat === g.dealer && g.honba === 0, contested));
};

// 这一局押之前有几点
const nellyPoolBefore = (g: Game, seat: number) => NELLY.start + regen(g.round) - gameStateOf(g, seat).spent!;

// 这一局押了几点：一局开始以后第一次问到时定下来、扣掉（谁先问都一样：别人定配牌规矩时就要知道她是不是三倍满的局）
function tierOf(g: Game, seat: number): number {
  const st = stateOf(g, seat);
  if (st.bet !== undefined) return st.bet;
  if (between(g)) return 0;
  const gs = gameStateOf(g, seat);
  const pool = nellyPoolBefore(g, seat);
  const want = g.manual[seat] ? gs.pick ?? 0 : aiBet(g, seat);
  // 玩家押的不够就不押（发牌前界面上押不了）
  const bet = want > pool ? (g.manual[seat] ? 0 : pool) : Math.max(0, Math.min(NELLY.maxBet, want));
  st.bet = bet;
  gs.spent! += bet;
  gs.log!.push(bet);
  return bet;
}

// 这一局押了几点（0 是没押）
export function nellyTier(g: Game, seat: number): number {
  return tierOf(g, seat);
}

// 这一局要做到多大（按她的点数算：庄家 1.5 倍）
export function nellyTarget(g: Game, seat: number): number {
  const t = NELLY.target[tierOf(g, seat)];
  return seat === g.dealer ? t * 1.5 : t;
}

export function nellySisters(g: Game, seat: number): number {
  return gameStateOf(g, seat).sisters!;
}

// 被七姐妹封住、这一局和不了的人
export function nellyBlocked(g: Game, seat: number): number[] {
  return stateOf(g, seat).blocked!;
}

// 这一局做的花色（没押是 null）
export function nellySuit(g: Game, seat: number): number | null {
  return tierOf(g, seat) > 0 ? stateOf(g, seat).suit ?? null : null;
}

// 还有运势：看得出别人听没听牌
export function nellySenses(g: Game, seat: number): boolean {
  return g.round >= 1 && nellyPool(g, seat) > 0;
}

// target 听牌了没有（涅莉感知到的，只看听没听）
export function nellySensesTenpai(g: Game, target: number): boolean {
  const p = g.players[target];
  return shanten(toCounts(p.hand), p.melds.length) <= 0;
}

// 七姐妹：押了运势的局，每有一家听牌用掉一次封住他
function sweep(g: Game, seat: number): void {
  if (tierOf(g, seat) <= 0) return;
  const gs = gameStateOf(g, seat);
  const st = stateOf(g, seat);
  for (let o = 0; o < 4 && gs.sisters! > 0; o++) {
    if (o === seat || st.blocked!.includes(o) || !g.binds(seat, o) || !nellySensesTenpai(g, o)) continue;
    gs.sisters!--;
    st.blocked!.push(o);
    // 不写 target：七姐妹要放切入（写了 target 的是悄悄换牌）
    g.emit({ type: 'ability', seat, ability: 'nelly', text: '七姐妹' });
  }
}

const useful = (g: Game, seat: number) => {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const sh = shanten(counts, p.melds.length);
  return (t: TileId) => {
    counts[kindOf(t)]++;
    const after = shanten(counts, p.melds.length);
    counts[kindOf(t)]--;
    return after < sh;
  };
};

// 摸到 t 自摸的话和多少（和不了是 0）
const drawValue = (g: Game, seat: number) => {
  const p = g.players[seat];
  const memo = new Map<number, number>();
  return (t: TileId) => {
    const k = kindOf(t);
    if (!memo.has(k)) {
      p.hand.push(t);
      try {
        const r = g.winResult(seat, t, true);
        memo.set(k, r ? teruWinValue(r, true, seat === g.dealer) : 0);
      } finally {
        p.hand.pop();
      }
    }
    return memo.get(k)!;
  };
};

// 听牌了、牌山里却一张和了牌都没有（死听）：摸了 t 以后打掉一张还能听牌、而且听的牌牌山里还有
const reshape = (g: Game, seat: number) => {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const live = new Set(g.wall.live.slice(1).map(kindOf));
  return (t: TileId) => {
    counts[kindOf(t)]++;
    let ok = false;
    for (let d = 0; d < 34 && !ok; d++) {
      if (!counts[d] || d === kindOf(t)) continue;
      counts[d]--;
      if (shanten(counts, p.melds.length) === 0) ok = waitingKinds(counts, p.melds.length).some((k) => live.has(k));
      counts[d]++;
    }
    counts[kindOf(t)]--;
    return ok;
  };
};

const inSuit = (suit: number) => (t: TileId) => kindOf(t) < 27 && suitOf(kindOf(t)) === suit;

export const nellyAbility: Ability = {
  id: 'nelly',
  name: '运势·七姐妹',
  description: `开场 ${NELLY.start} 点运势，每打满 ${NELLY.every} 局恢复 1 点。每一局发牌前可以押运势：1 点配牌和进张朝满贯发展，2 点朝倍满，3 点朝三倍满（这一局她的和牌别人挡不住）。手里还有运势就看得出别人听没听牌。七姐妹一场 ${NELLY.sisters} 次：押了运势的局自动开着，每有一家听牌用掉一次，封住他这一局和不了。`,
  priority: PRIORITY.nelly,

  // 三倍满的局别人挡不住她（别人的能力管不到她）
  shielded(g, seat) {
    if (between(g)) return false;
    return tierOf(g, seat) >= 3;
  },

  dealRules(g, seat) {
    tierOf(g, seat);
  },

  // 押了运势：选她配牌里最多的花色，别的花色的数牌换成这门花色；单张字牌也换掉（对子留着做混一色）
  beforeDeal(g, seat) {
    const v = tierOf(g, seat);
    const st = stateOf(g, seat);
    if (v <= 0) return;
    const per = [0, 0, 0];
    for (const t of g.dealHand(seat)) if (kindOf(t) < 27) per[suitOf(kindOf(t))]++;
    const suit = per.indexOf(Math.max(...per));
    st.suit = suit;
    const pred = inSuit(suit);
    const hand = g.dealHand(seat).map(kindOf);
    for (const i of g.dealIndices(seat)) {
      const k = kindOf(g.wall.live[i]);
      if (pred(g.wall.live[i])) continue;
      if (k >= 27 && hand.filter((x) => x === k).length >= 2) continue;
      if (!g.rng.chance(NELLY.deal[v])) continue;
      const swap = () => g.wall.bringToLive(i, pred, g.rng, (j) => j >= 52);
      if (!swap()) g.dealFallback(seat, swap);
    }
  },

  onRoundStart(g, seat) {
    // 押了几点只有她自己知道：电脑的涅莉不报
    const v = tierOf(g, seat);
    if (!g.manual[seat] || v <= 0) return;
    g.emit({ type: 'ability', seat, ability: 'nelly', text: `运势·${TIER_NAMES[v]}` });
  },

  // 每次有人摸牌前看一眼：谁听牌了就用七姐妹封住
  beforeAnyDraw(g, seat) {
    sweep(g, seat);
  },

  // 七姐妹封住的人这一局和不了（问到时也先看一眼：刚听牌的人马上就封）
  forbidsWin(g, seat, target) {
    if (!stateOf(g, seat).blocked!.includes(target)) sweep(g, seat);
    return stateOf(g, seat).blocked!.includes(target);
  },

  beforeDraw(g, seat, rinshan) {
    if (rinshan) return;
    const v = tierOf(g, seat);
    if (v <= 0 || !g.rng.chance(NELLY.good[v])) return;
    const w = g.wall;
    const good = useful(g, seat);
    const suit = stateOf(g, seat).suit;
    const pred = suit === undefined ? () => true : inSuit(suit);
    const p = g.players[seat];
    const sh = shanten(toCounts(p.hand), p.melds.length);
    if (sh > 0) {
      w.bringToLive(0, (t) => good(t) && (pred(t) || kindOf(t) >= 27), g.rng) || w.bringToLive(0, good, g.rng);
      return;
    }
    // 听牌了：和了牌够大就来和了牌
    const value = drawValue(g, seat);
    const target = nellyTarget(g, seat);
    if (w.bringToLive(0, (t) => value(t) >= target, g.rng)) return;
    // 牌还不够大：手牌还能动、牌山还多，就先来那门花色的牌，把别的花色换掉
    const off = p.hand.some((t) => kindOf(t) < 27 && !pred(t));
    if (off && !p.riichi && w.remaining > NELLY.late && w.bringToLive(0, (t) => pred(t) && !good(t), g.rng)) return;
    // 做不大了：来最大的和了牌；死听就来一张能换听的牌
    if (w.bringToLive(0, (t) => value(t) > 0, g.rng)) return;
    if (p.riichi) return;
    const fix = reshape(g, seat);
    w.bringToLive(0, (t) => fix(t) && (pred(t) || kindOf(t) >= 27), g.rng) || w.bringToLive(0, fix, g.rng);
  },

  // 发牌前押运势：不选就是不押
  preDeal(g, seat): PreDealOption[] {
    const pool = nellyPool(g, seat);
    const gs = gameStateOf(g, seat);
    return [1, 2, 3].map((n) => ({
      id: `luck${n}`,
      name: `押 ${n} 点 · ${TIER_NAMES[n]}`,
      desc: n === 3 ? '配牌和进张朝三倍满发展，这一局和牌别人挡不住' : `配牌和进张朝${TIER_NAMES[n]}发展`,
      cost: n,
      enabled: n <= pool,
      picked: gs.pick === n && n <= pool,
      note: n <= pool ? undefined : '运势不够',
      group: 'luck',
    }));
  },

  setPreDeal(g, seat, picked) {
    const id = picked.find((p) => p.startsWith('luck'));
    gameStateOf(g, seat).pick = id ? Number(id.slice(4)) : 0;
  },

  skill(g, seat) {
    const gs = gameStateOf(g, seat);
    const pool = nellyPool(g, seat);
    const v = between(g) ? 0 : tierOf(g, seat);
    const note =
      (v > 0 ? `这一局押了 ${v} 点（${TIER_NAMES[v]}），七姐妹自动开着` : '这一局没押运势，七姐妹不发动') +
      `；七姐妹还剩 ${gs.sisters} 次${pool > 0 ? '；看得出别人听没听牌' : ''}`;
    return { label: '运势', note, enabled: false, meter: { value: pool, max: Math.max(NELLY.start, pool), label: '运势' }, active: v > 0 };
  },

  // 押了几点只有她自己知道：电脑的涅莉不挂
  badge(g, seat) {
    if (!g.manual[seat] || between(g)) return null;
    const v = tierOf(g, seat);
    return v > 0 ? TIER_NAMES[v] : null;
  },

  // 照魔镜看得到
  insight(g, seat) {
    const gs = gameStateOf(g, seat);
    const v = between(g) ? 0 : tierOf(g, seat);
    return [
      `运势还剩 ${nellyPool(g, seat)} 点${gs.log!.length ? `（押过：${gs.log!.join('、')}）` : ''}`,
      v > 0 ? `这一局押了 ${v} 点，冲${TIER_NAMES[v]}` : '这一局没押',
      `七姐妹还剩 ${gs.sisters} 次`,
    ];
  },
};
