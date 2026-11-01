import type { Game } from '../engine/game';
import { shanten, waitingKinds } from '../engine/shanten';
import { EAST, HAKU, TileId, doraFromIndicator, kindOf, suitOf, toCounts } from '../engine/tiles';
import { kuroSeat } from './doraControl';
import { isDoraTile, kuroLost } from './kuro';
import { teruWinValue } from './teru';
import { PRIORITY, type Ability, type PreDealOption } from './types';

// 涅莉·薇萨拉兹（临海女子）：分配运势的人。家里穷，打得亮眼才拉得到赞助，所以她要和就和大牌。
// - 运势：开场 10 点，每打满 4 局恢复 1 点（第 5、9、13……局开始时，连庄、流局重打的局也算一局）。
// - 分配运势（每一局发牌前）：这一局押几点，押了就扣掉，和没和都不退：
//   · 1 点：进张朝 3 番到满贯发展，第 15 巡左右（快流局时）和
//   · 2 点：朝跳满发展，第 12 巡左右和
//   · 3 点：朝三倍满发展，第 8 巡左右立直、一发自摸三倍满（立直、一发、自摸加里宝牌，里宝牌往她手里最多的牌上变）。照配牌定好一手三倍满：
//     宝牌能动就做混一色加宝牌刻子（宝牌指示牌指向它），玄在场宝牌动不了就做清一色（七对子也算），每巡来缺的那张；听牌了别人摸不走她要和的牌。而且这一局她的和牌别人挡不住（别人的能力管不到她：不许和、换走和了牌、封印都不算）
//   配牌照常发，不动（押 2、3 点时宝牌指示牌指向她配牌里最多的那种牌）。装装样子：到那一巡之前摸不到和了牌（摸牌按巡数慢慢变好，听牌了先来把牌做大的牌：
//   那门花色、宝牌、字牌对子），到了那一巡牌够大就来和了牌。押 2、3 点立直了里宝牌往她手里最多的牌上变，有宝牌暗刻就在那一巡来第四张开暗杠、岭上开花。押了几点只有她自己知道
// - 感知听牌：手里还有运势（押完这一局还剩 1 点以上）就看得出别人听没听牌（不知道听什么）。
// - 七姐妹：一场 7 次，不恢复。押了运势的局自动开着：每有一家听牌，用掉一次封住他，这一局他和不了（自摸、荣和都不行）。
//   押几点这一局最多封几家（3 点封三家）。照这样别人能力管不到的人封不住；次数用完了就不封了
// 电脑的涅莉：自己坐庄的局（连庄的不算）押 3 点；别人能力最强的局（优希的东场、尧深的收获局、爽最后两局）不押；
// 其余的局把运势平摊到剩下的局里（最后一局押光）。押了运势的局门清做大，到那一巡之前不和，牌不够大先不和
export const NELLY = {
  start: 10, // 开场的运势
  every: 4, // 每打满几局恢复 1 点
  maxBet: 3, // 一局最多押几点
  sisters: 7,
  // 押 1/2/3 点时这一局要做到多大（子家的点数，庄家按 1.5 倍）：3 番（30 符）、跳满、三倍满
  target: [0, 3900, 12000, 24000],
  // 和了牌先挑不超过这么大的（1 点到满贯为止、2 点就是跳满）
  cap: [0, 8000, 12000, Infinity],
  // 押 2、3 点：发牌前把宝牌指示牌换成指向她配牌里最多的那种牌（配牌本身不动）
  dora: [false, false, true, true],
  // 押 1/2/3 点时第几巡和（她摸第几张牌）：之前摸不到和了牌
  turn: [0, 15, 12, 8],
  // 到了那一巡牌还不够大，再等几巡就有什么和什么
  grace: 3,
  late: 8, // 牌山剩这么多以下就有什么和什么
  // 押 3 点做染手（配牌里最多的那门花色）
  flush: [false, false, false, true],
  // 三倍满：11 番，押 3 点最多做到 12 番（不冲累计役满）
  bigHan: 11,
  maxHan: 12,
};

const TIER_NAMES = ['', '3番–满贯', '跳满', '三倍满'];

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
  honors?: boolean; // 做染手：带字牌（混一色）还是不带（清一色）。undefined 是不做染手
  plan?: number[]; // 押 3 点：要做成的那手牌（14 张，按种类数）
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

// 这一局做染手：做哪门花色、带不带字牌（不做是 null）
export function nellyFlush(g: Game, seat: number): { suit: number; honors: boolean } | null {
  const st = stateOf(g, seat);
  return tierOf(g, seat) > 0 && st.suit !== undefined && st.honors !== undefined ? { suit: st.suit, honors: st.honors } : null;
}

const inFlush = (f: { suit: number; honors: boolean }) => (k: number) => (k >= 27 ? f.honors : suitOf(k) === f.suit);

// 只看染手那几种牌的向听
const flushShanten = (counts: number[], melds: number, f: { suit: number; honors: boolean }) => {
  const ok = inFlush(f);
  return shanten(counts.map((n, k) => (ok(k) ? n : 0)), melds);
};

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
  // 押几点这一局最多封几家
  for (let o = 0; o < 4 && gs.sisters! > 0 && st.blocked!.length < tierOf(g, seat); o++) {
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
// min：听的牌牌山里至少还有几张
const reshape = (g: Game, seat: number, min = 1) => {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const left = toCounts(g.wall.live.slice(1));
  return (t: TileId) => {
    counts[kindOf(t)]++;
    let ok = false;
    for (let d = 0; d < 34 && !ok; d++) {
      if (!counts[d] || d === kindOf(t)) continue;
      counts[d]--;
      if (shanten(counts, p.melds.length) === 0) ok = waitingKinds(counts, p.melds.length).reduce((n, k) => n + left[k], 0) >= min;
      counts[d]++;
    }
    counts[kindOf(t)]--;
    return ok;
  };
};

// 她这次摸的是第几张（第几巡）
export function nellyTurn(g: Game, seat: number): number {
  return g.players[seat].discards.length + 1;
}

// 13 张的手听的牌牌山里还有几张（她的运势知道）
export function nellyLiveWaits(g: Game, hand: TileId[], melds: number): number {
  const waits = waitingKinds(toCounts(hand), melds);
  return g.wall.live.filter((t) => waits.includes(kindOf(t))).length;
}

// 押了运势的局，这一巡之前不和（电脑）
export function nellyDue(g: Game, seat: number): number {
  return NELLY.turn[tierOf(g, seat)] ?? 0;
}

const isDora = (g: Game, t: TileId) => g.wall.visibleDoraIndicators().some((d) => doraFromIndicator(kindOf(d)) === kindOf(t));

// 立直了：翻开的每一张里宝牌指示牌换成指向她手里最多的那种牌
function setUra(g: Game, seat: number): void {
  const p = g.players[seat];
  // 暗杠的牌也算
  const counts = toCounts([...p.hand, ...p.melds.filter((m) => m.type === 'ankan').flatMap((m) => m.tiles)]);
  const dora = new Set(g.wall.visibleDoraIndicators().map((d) => doraFromIndicator(kindOf(d))));
  // 张数多的先；一样多挑宝牌（宝牌再加里宝牌）
  const kinds = Array.from({ length: 34 }, (_, k) => k).sort((a, b) => counts[b] - counts[a] || Number(dora.has(b)) - Number(dora.has(a)));
  const n = g.wall.visibleUraIndicators().length;
  // 每一张从张数最多的那种牌挑起，指示牌找不到就换下一种
  let from = 0;
  for (let i = 0; i < n; i++) {
    for (let j = Math.min(from, kinds.length - 1); j < kinds.length && counts[kinds[j]] > 0; j++) {
      const k = kinds[j];
      if (g.wall.bringToUra(i, (t) => doraFromIndicator(kindOf(t)) === k, g.rng)) {
        from = j + 1;
        break;
      }
    }
  }
}

// 押 3 点和牌：翻开的里宝牌一张一张定，加起来让总番数落在 11–12 番（里宝牌之外已经超过 12 番就一张都不中）
function fitUra(g: Game, seat: number, winTile?: TileId): void {
  const p = g.players[seat];
  const tile = winTile ?? p.drawn;
  if (tile === null || tile === undefined) return;
  const r = g.winResult(seat, tile, winTile === undefined);
  if (!r || r.yakuman > 0) return;
  const counts = toCounts([...p.hand, ...p.melds.flatMap((m) => m.tiles), ...(winTile !== undefined ? [winTile] : [])]);
  const lo = Math.max(0, NELLY.bigHan - (r.han - r.ura));
  const hi = NELLY.maxHan - (r.han - r.ura);
  const w = g.wall;
  let sum = 0;
  for (let i = 0; i < w.doraRevealed; i++) {
    // 还差多少：先挑正好补够的，补不够挑最多的，已经够了挑一张都不中的
    const room = Math.max(0, hi - sum);
    const want = Math.max(0, lo - sum);
    const kinds = Array.from({ length: 34 }, (_, k) => k)
      .filter((k) => counts[k] <= room)
      .sort((a, b) => Math.abs(Math.min(counts[a], room) - want) - Math.abs(Math.min(counts[b], room) - want) || counts[b] - counts[a]);
    for (const k of kinds) {
      if (w.bringToUra(i, (t) => doraFromIndicator(kindOf(t)) === k, g.rng)) {
        sum += counts[k];
        break;
      }
    }
  }
}

// 能拿来开暗杠做大的宝牌暗刻（立直了要杠了听的牌不变）
function kanKind(g: Game, seat: number): number | null {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const waits = waitingKinds(counts, p.melds.length).join();
  for (let k = 0; k < 34; k++) {
    if (counts[k] !== 3 || !isDora(g, k * 4)) continue;
    const after = counts.slice();
    after[k] = 0;
    if (shanten(after, p.melds.length + 1) !== 0) continue;
    if (p.riichi && waitingKinds(after, p.melds.length + 1).join() !== waits) continue;
    return k;
  }
  return null;
}

// 手牌换成 hand（13 张）摸 t 自摸的话有几番：lo 是不算里宝牌的（还没立直的算上立直、一发），hi 是里宝牌最多能加到的。
// 里宝牌在和牌时才定（claimUra），押 3 点会把它定到 11–12 番之间，所以只要 lo ≤ 12 ≤ … hi ≥ 11 就做得成三倍满。
// 役满算 13 番；和不了是 0
function projHan(g: Game, seat: number, hand: TileId[], t: TileId): { lo: number; hi: number } {
  const p = g.players[seat];
  const keep = p.hand;
  p.hand = [...hand, t];
  try {
    const r = g.winResult(seat, t, true);
    if (!r) return { lo: 0, hi: 0 };
    if (r.yakuman > 0) return { lo: 13, hi: 13 };
    const lo = r.han - r.ura + (p.riichi ? 0 : 2);
    return { lo, hi: lo + Math.max(r.ura, uraGain(g, seat, hand)) };
  } finally {
    p.hand = keep;
  }
}

// 做得成三倍满（11–12 番，里宝牌在中间调）
const fitsBig = (r: { lo: number; hi: number }) => r.lo <= NELLY.maxHan && r.hi >= NELLY.bigHan;

// 玄的能力还在（不是她自己）：和牌中不了里宝牌
const kuroBlocks = (g: Game, seat: number) => {
  const k = kuroSeat(g);
  return k !== null && k !== seat;
};

// 立直以后第一张里宝牌指示牌能换成指向几张她的牌（和 setUra 一样按 13 张加暗杠里张数多的挑，指示牌找得到才算）
function uraGain(g: Game, seat: number, hand: TileId[]): number {
  const w = g.wall;
  const counts = toCounts([...hand, ...g.players[seat].melds.filter((m) => m.type === 'ankan').flatMap((m) => m.tiles)]);
  // 玄的能力还在：别人中不了里宝牌
  if (!w.uraIndicators.length || w.locked.has(w.uraIndicators[0]) || kuroBlocks(g, seat)) return 0;
  const pool = [w.uraIndicators[0], ...w.uraIndicators.slice(1), ...w.live, ...w.rinshan].filter((t) => !w.locked.has(t));
  const ok = new Set(pool.map((t) => doraFromIndicator(kindOf(t))));
  let best = 0;
  for (let k = 0; k < 34; k++) if (ok.has(k)) best = Math.max(best, counts[k]);
  return best;
}

// 13 张的手：牌山里（没锁的）能自摸出三倍满的牌有几张，和自摸能到几番（只看牌山里还有的）
function bigScore(g: Game, seat: number, hand: TileId[]): { big: number; han: number } {
  const melds = g.players[seat].melds.length;
  const counts = toCounts(hand);
  if (shanten(counts, melds) !== 0) return { big: 0, han: -1 };
  const live = g.wall.live.filter((t) => reachable(g, seat, t));
  let big = 0;
  let han = 0;
  for (const k of waitingKinds(counts, melds)) {
    const tiles = live.filter((t) => kindOf(t) === k);
    if (!tiles.length) continue;
    const h = projHan(g, seat, hand, tiles[0]);
    // 超过 12 番的不要（不冲累计役满）
    if (h.lo <= NELLY.maxHan) han = Math.max(han, Math.min(h.hi, NELLY.maxHan));
    if (fitsBig(h)) big += tiles.length;
  }
  return { big, han };
}
// 两张以上才算够（立直以后到她摸之前别人还要摸三张）
const rank = (x: { big: number; han: number }) => (x.big >= 1 ? 100 + Math.min(x.big, 4) : x.han);

// 她摸得到的牌：没锁、这一次摸牌的规矩不挡（玄在的话宝牌摸不到，谁的能力都挡不住玄）
function reachable(g: Game, seat: number, t: TileId): boolean {
  const w = g.wall;
  if (w.locked.has(t) || w.deny?.(t)) return false;
  return ![0, 1, 2, 3].some((s) => s !== seat && g.abilities[s]?.id === 'kuro' && g.isAbsolute(s) && !kuroLost(g, s) && isDoraTile(g, t));
}

// 押 3 点：定一手三倍满（立直、一发、自摸再加里宝牌）的目标牌，和手里的牌重合得越多越好，缺的牌牌山里要有：
// - 清一色（6 番）加立直一发自摸（3 番），再靠七对子、一气通贯、三暗刻、断幺九、一盃口、宝牌、里宝牌凑到 11–12 番
// - 混一色（3 番）：宝牌能动的时候，要有宝牌刻子（宝牌、里宝牌各 3 番）
// 玄的能力还在时中不了里宝牌，只能靠役。超过 12 番的不要（不冲累计役满）
function planBig(g: Game, seat: number): number[] | null {
  const st = stateOf(g, seat);
  const flush = nellyFlush(g, seat);
  if (!flush) return null;
  const w = g.wall;
  const have = toCounts(g.players[seat].hand);
  const cap = have.slice();
  for (const t of w.live) if (reachable(g, seat, t)) cap[kindOf(t)]++;
  for (let k = 0; k < 34; k++) cap[k] = Math.min(4, cap[k]);
  const uraOk = new Set(
    [w.uraIndicators[0], ...w.uraIndicators.slice(1), ...w.live, ...w.rinshan].filter((t) => t !== undefined && !w.locked.has(t)).map((t) => doraFromIndicator(kindOf(t))),
  );
  if (!w.uraIndicators.length || w.locked.has(w.uraIndicators[0]) || kuroBlocks(g, seat)) uraOk.clear();
  const dora = new Set(w.visibleDoraIndicators().map((d) => doraFromIndicator(kindOf(d))));
  const base = flush.suit * 9;
  const F = [...Array.from({ length: 9 }, (_, i) => base + i), ...(flush.honors ? [27, 28, 29, 30, 31, 32, 33] : [])];
  const sets: number[][] = [];
  for (let i = 0; i < 7; i++) sets.push([base + i, base + i + 1, base + i + 2]);
  for (const k of F) sets.push([k, k, k]);
  const t = new Array<number>(34).fill(0);
  const prev = st.plan?.join();
  let best: number[] | null = null;
  let bestScore = -1;
  // 估这手牌立直一发自摸能有几番（lo，不算里宝牌）、里宝牌最多再加几番（ura），lo ≤ 12 且 lo + ura ≥ 11 才要。
  // 玄的能力还在时中不了里宝牌，只能靠役：清一色加七对子、一气通贯、三暗刻、断幺九、一盃口这些凑够 11 番
  const noUra = kuroBlocks(g, seat);
  const chosen: number[] = []; // 4 组面子挑了 sets 里的哪几组
  const valid = (pairs: boolean) => {
    const mixed = t.some((n, k) => n > 0 && k >= 27);
    let lo = (mixed ? 3 : 6) + 3; // 染手、立直一发自摸
    if (pairs) lo += 2;
    else {
      if ([0, 3, 6].every((i) => chosen.includes(i))) lo += 2; // 一气通贯
      if (chosen.some((i, j) => i < 7 && chosen.indexOf(i) !== j)) lo += 1; // 一盃口
      if (chosen.filter((i) => i >= 7).length >= 3) lo += 2; // 三暗刻（门清自摸）
      for (let k = 27; k < 34; k++) if (t[k] >= 3) lo += (k >= HAKU ? 1 : 0) + (k === g.seatWind(seat) ? 1 : 0) + (k === EAST + g.roundWind ? 1 : 0); // 役牌
    }
    if (!mixed && t[base] === 0 && t[base + 8] === 0) lo += 1; // 断幺九
    for (const k of dora) lo += t[k];
    let ura = 0;
    if (!noUra) for (const k of F) if (uraOk.has(k)) ura = Math.max(ura, t[k]);
    return lo <= NELLY.maxHan && lo + ura >= NELLY.bigHan;
  };
  const consider = (pairs: boolean) => {
    if (!valid(pairs)) return;
    let score = 0;
    for (const k of F) score += Math.min(have[k], t[k]);
    score *= 2;
    if (prev !== undefined && t.join() === prev) score += 1;
    if (score > bestScore) [best, bestScore] = [t.slice(), score];
  };
  const fits = (k: number) => t[k] <= cap[k];
  const pick = (from: number, left: number) => {
    if (left === 0) {
      for (const k of F) {
        t[k] += 2;
        if (fits(k)) consider(false);
        t[k] -= 2;
      }
      return;
    }
    for (let i = from; i < sets.length; i++) {
      for (const k of sets[i]) t[k]++;
      chosen.push(i);
      if (sets[i].every(fits)) pick(i, left - 1);
      chosen.pop();
      for (const k of sets[i]) t[k]--;
    }
  };
  pick(0, 4);
  // 七对子
  const pairKinds = F.filter((k) => cap[k] >= 2);
  const choose = (from: number, left: number) => {
    if (left === 0) return consider(true);
    for (let i = from; i <= pairKinds.length - left; i++) {
      t[pairKinds[i]] = 2;
      choose(i + 1, left - 1);
      t[pairKinds[i]] = 0;
    }
  };
  choose(0, 7);
  st.plan = best ?? undefined;
  return best;
}

// 押 3 点：14 张的手打哪张（听牌的打法里挑三倍满的牌最多、番最多的）；打哪张都听不了牌是 null
export function nellyBigDiscard(g: Game, seat: number): TileId | null {
  const p = g.players[seat];
  if (tierOf(g, seat) < 3 || p.riichi) return null;
  // 有目标牌：打多出来的牌（先打目标里没有的）
  const plan = planBig(g, seat);
  if (plan) {
    const have = toCounts(p.hand);
    const extra = p.hand.filter((x) => have[kindOf(x)] > plan[kindOf(x)]);
    if (extra.length) return extra.find((x) => plan[kindOf(x)] === 0) ?? extra[0];
  }
  // 清一色还没做好（别的花色的牌不止一张）就照常打（先打别的花色）
  const flush = nellyFlush(g, seat);
  if (flush && p.hand.filter((t) => !inFlush(flush)(kindOf(t))).length > 1) return null;
  let best: TileId | null = null;
  let score = -1;
  const seen = new Set<number>();
  for (const t of p.hand) {
    if (seen.has(kindOf(t))) continue;
    seen.add(kindOf(t));
    const s = rank(bigScore(g, seat, p.hand.filter((x) => x !== t)));
    if (s > score) [best, score] = [t, s];
  }
  return score >= 0 ? best : null;
}

// 押 3 点：13 张的手立直下去下一巡就能一发自摸三倍满
export function nellyBigReady(g: Game, seat: number, hand: TileId[]): boolean {
  return rank(bigScore(g, seat, hand)) >= 100;
}

// 押 3 点的摸牌：配牌照常发，每一巡来目标牌里缺的那张（没有目标牌就来那门花色的牌）；听牌了来把牌做到三倍满的牌（来了别的牌她打掉）；
// 够三倍满了前一巡立直，下一巡一发自摸。到那一巡之前不来和了牌；牌山快摸完了有什么和什么
function drawBig(g: Game, seat: number): void {
  const w = g.wall;
  const p = g.players[seat];
  const turn = nellyTurn(g, seat);
  const due = NELLY.turn[3];
  const value = drawValue(g, seat);
  const wins = (t: TileId) => value(t) > 0;
  const bestWin = () => {
    const best = Math.max(0, ...w.live.filter((t) => !w.locked.has(t)).map(value));
    return best > 0 && w.bringToLive(0, (t) => value(t) >= best, g.rng);
  };
  if (p.riichi) {
    setUra(g, seat);
    if (w.bringToLive(0, (t) => fitsBig(projHan(g, seat, p.hand, t)), g.rng)) return;
    if (turn >= due + NELLY.grace && bestWin()) return;
    if (wins(w.live[0])) w.bringToLive(0, (t) => !wins(t), g.rng);
    return;
  }
  if (w.remaining <= NELLY.late) {
    bestWin();
    return;
  }
  const flush = nellyFlush(g, seat);
  const ok = flush ? (t: TileId) => inFlush(flush)(kindOf(t)) : () => true;
  const safe = (t: TileId) => !wins(t);
  const counts = toCounts(p.hand);
  const melds = p.melds.length;
  // 有目标牌：缺几张就一巡来一张（缺的牌里先来牌山里剩得少的）；只差一张、够三倍满了就来一张她会打掉的牌，等立直
  const plan = planBig(g, seat);
  if (plan) {
    const need = (t: TileId) => plan[kindOf(t)] > counts[kindOf(t)];
    const missing = plan.reduce((n, c, k) => n + Math.max(0, c - counts[k]), 0);
    if (missing >= 2) {
      const left = toCounts(w.live.filter((t) => reachable(g, seat, t)));
      const scarce = Math.min(...p.hand.length ? plan.map((c, k) => (c > counts[k] ? left[k] : 99)) : [99]);
      if (w.bringToLive(0, (t) => need(t) && safe(t) && left[kindOf(t)] === scarce, g.rng) || w.bringToLive(0, (t) => need(t) && safe(t), g.rng)) return;
    } else if (rank(bigScore(g, seat, p.hand)) >= 100) {
      w.bringToLive(0, (t) => plan[kindOf(t)] === 0 && safe(t), g.rng) || w.bringToLive(0, (t) => !need(t) && safe(t), g.rng);
      return;
    }
  }
  if (flush && p.hand.some((t) => !ok(t))) {
    // 手里还有别的牌：一张一张来那门的牌（先来让清一色向听变少的，再来连得上的）
    const fs = flushShanten(counts, melds, flush);
    const lower = (t: TileId) => {
      counts[kindOf(t)]++;
      const after = flushShanten(counts, melds, flush);
      counts[kindOf(t)]--;
      return after < fs;
    };
    const near = (t: TileId) => {
      const k = kindOf(t);
      return counts[k] > 0 || [-2, -1, 1, 2].some((d) => k + d >= 0 && k + d < 27 && Math.floor((k + d) / 9) === Math.floor(k / 9) && counts[k + d] > 0);
    };
    // 先凑宝牌刻子（立直以后里宝牌也变成它）
    const doraSet = (t: TileId) => isDora(g, t) && counts[kindOf(t)] >= 1 && counts[kindOf(t)] < 3;
    w.bringToLive(0, (t) => ok(t) && safe(t) && doraSet(t), g.rng) ||
      w.bringToLive(0, (t) => ok(t) && safe(t) && lower(t), g.rng) || w.bringToLive(0, (t) => ok(t) && safe(t) && near(t), g.rng) || w.bringToLive(0, (t) => ok(t) && safe(t), g.rng);
    return;
  }
  const sh = shanten(counts, melds);
  if (sh > 0) {
    const good = useful(g, seat);
    w.bringToLive(0, (t) => good(t) && ok(t) && safe(t), g.rng) || w.bringToLive(0, (t) => good(t) && safe(t), g.rng) || w.bringToLive(0, (t) => ok(t) && safe(t), g.rng);
    return;
  }
  // 听牌了
  const now = rank(bigScore(g, seat, p.hand));
  if (now >= 100) {
    // 够三倍满了：来一张她会打掉的别的花色的牌，等立直
    w.bringToLive(0, (t) => !ok(t) && safe(t), g.rng) || w.bringToLive(0, safe, g.rng);
    return;
  }
  // 还不够大：挑一张摸进来、打掉一张以后最接近三倍满的牌
  let pick: number | null = null;
  let score = now;
  const kinds = new Set(w.live.filter((t) => reachable(g, seat, t) && safe(t)).map(kindOf));
  for (const k of kinds) {
    const t = w.live.find((x) => kindOf(x) === k && reachable(g, seat, x))!;
    const hand = [...p.hand, t];
    const tried = new Set<number>();
    for (const d of hand) {
      if (tried.has(kindOf(d))) continue;
      tried.add(kindOf(d));
      const s = rank(bigScore(g, seat, hand.filter((x) => x !== d)));
      if (s > score) [pick, score] = [k, s];
    }
  }
  if (pick !== null && w.bringToLive(0, (t) => kindOf(t) === pick, g.rng)) return;
  const good = useful(g, seat);
  w.bringToLive(0, (t) => ok(t) && safe(t) && !good(t), g.rng) || w.bringToLive(0, safe, g.rng);
}

const inSuit = (suit: number) => (t: TileId) => kindOf(t) < 27 && suitOf(kindOf(t)) === suit;

export const nellyAbility: Ability = {
  id: 'nelly',
  name: '运势·七姐妹',
  description: `开场 ${NELLY.start} 点运势，每打满 ${NELLY.every} 局恢复 1 点。每一局发牌前可以押运势（配牌照常发）：1 点进张朝 3 番到满贯发展，第 ${NELLY.turn[1]} 巡左右和；2 点朝跳满，第 ${NELLY.turn[2]} 巡左右和；3 点朝三倍满（混一色加宝牌刻子，玄在场做清一色），第 ${NELLY.turn[3]} 巡左右立直一发自摸，这一局她的和牌别人挡不住。手里还有运势就看得出别人听没听牌。七姐妹一场 ${NELLY.sisters} 次、不恢复：押了运势的局自动开着，每有一家听牌用掉一次封住他这一局和不了，押几点最多封几家。`,
  priority: PRIORITY.nelly,

  // 三倍满的局别人挡不住她（别人的能力管不到她）
  shielded(g, seat) {
    if (between(g)) return false;
    return tierOf(g, seat) >= 3;
  },

  dealRules(g, seat) {
    tierOf(g, seat);
  },

  // 配牌照常发，只记下她配牌里最多的花色（往这门做）。押 2、3 点时宝牌指示牌换成指向她配牌里最多的那种牌
  // （玄在的话宝牌是玄的，不换）
  beforeDeal(g, seat) {
    const v = tierOf(g, seat);
    if (v <= 0) return;
    const hand = g.dealHand(seat).map(kindOf);
    const per = [0, 0, 0];
    for (const k of hand) if (k < 27) per[suitOf(k)]++;
    const st = stateOf(g, seat);
    st.suit = per.indexOf(Math.max(...per));
    // 宝牌能动（没有玄这样的人在）就做混一色、宝牌指示牌指向手里那门花色或字牌里最多的；动不了就做清一色
    const free = ![0, 1, 2, 3].some((s) => s !== seat && g.isAbsolute(s));
    if (NELLY.flush[v]) st.honors = free;
    if (!NELLY.dora[v] || !free) return;
    const n = (k: number) => hand.filter((x) => x === k).length;
    // 张数多的先；一样多挑 5（有赤宝牌）
    const kinds = [...new Set(hand)].filter((k) => !NELLY.flush[v] || k >= 27 || suitOf(k) === st.suit).sort((a, b) => n(b) - n(a) || (b < 27 && b % 9 === 4 ? 1 : 0) - (a < 27 && a % 9 === 4 ? 1 : 0));
    for (const k of kinds.slice(0, 3)) if (g.wall.bringToDora(0, (t) => doraFromIndicator(kindOf(t)) === k, g.rng, (j) => j >= 52)) break;
  },

  onRoundStart(g, seat) {
    // 押了几点只有她自己知道：电脑的涅莉不报
    const v = tierOf(g, seat);
    if (!g.manual[seat] || v <= 0) return;
    g.emit({ type: 'ability', seat, ability: 'nelly', text: `运势·${TIER_NAMES[v]}` });
  },

  // 每次有人摸牌前看一眼：谁听牌了就用七姐妹封住
  beforeAnyDraw(g, seat, drawer, rinshan) {
    sweep(g, seat);
    // 押 3 点听着三倍满：别人摸不走她要和的牌
    if (drawer === seat || tierOf(g, seat) < 3) return;
    const p = g.players[seat];
    if (shanten(toCounts(p.hand), p.melds.length) !== 0) return;
    const waits = waitingKinds(toCounts(p.hand), p.melds.length);
    const w = g.wall;
    const next = rinshan ? w.rinshan[0] : w.live[0];
    if (next === undefined || !waits.includes(kindOf(next))) return;
    if (rinshan) w.bringToRinshan((t) => !waits.includes(kindOf(t)), g.rng);
    else w.bringToLive(0, (t) => !waits.includes(kindOf(t)), g.rng);
  },

  // 七姐妹封住的人这一局和不了（问到时也先看一眼：刚听牌的人马上就封）
  forbidsWin(g, seat, target) {
    if (!stateOf(g, seat).blocked!.includes(target)) sweep(g, seat);
    return stateOf(g, seat).blocked!.includes(target);
  },

  beforeDraw(g, seat, rinshan) {
    const v = tierOf(g, seat);
    if (v <= 0) return;
    const w = g.wall;
    const p = g.players[seat];
    if (rinshan) {
      // 到了那一巡开杠：岭上牌是最大的和了牌（岭上开花）
      if (p.riichi && NELLY.dora[v]) setUra(g, seat);
      if (nellyTurn(g, seat) < NELLY.turn[v] - 1 || shanten(toCounts(p.hand), p.melds.length) !== 0) return;
      const value = drawValue(g, seat);
      const best = Math.max(0, ...[...w.live, ...w.rinshan].filter((t) => !w.locked.has(t)).map(value));
      if (best > 0) w.bringToRinshan((t) => value(t) >= best, g.rng);
      return;
    }
    if (v >= 3) {
      drawBig(g, seat);
      return;
    }
    // 立直了（押 2 点）：里宝牌变成她手里最多的那种牌
    if (p.riichi && NELLY.dora[v]) setUra(g, seat);
    const good = useful(g, seat);
    const value = drawValue(g, seat);
    const suit = stateOf(g, seat).suit;
    const pred = suit === undefined ? () => true : inSuit(suit);
    const sh = shanten(toCounts(p.hand), p.melds.length);
    const turn = nellyTurn(g, seat);
    const due = NELLY.turn[v];
    const late = w.remaining <= NELLY.late;
    const wins = (t: TileId) => value(t) > 0;
    // 把牌做大的牌：那门花色、宝牌、手里有的字牌
    const held = toCounts(p.hand);
    const shapes = (t: TileId) => pred(t) || isDora(g, t) || (kindOf(t) >= 27 && held[kindOf(t)] > 0 && stateOf(g, seat).honors !== false);
    if (turn < due && !late) {
      // 还没到那一巡：不给和了牌。离听牌还远就按剩下的巡数来进张，听牌了来把牌做大的牌
      if (sh > 0) {
        const need = (sh + 0.5) / Math.max(1, due - turn);
        if (g.rng.chance(Math.min(1, need)) && (w.bringToLive(0, (t) => good(t) && isDora(g, t), g.rng) || w.bringToLive(0, (t) => good(t) && shapes(t), g.rng) || w.bringToLive(0, good, g.rng))) return;
        // 这一张不给进张：押 2、3 点就顺手来一张手里成对的宝牌（凑宝牌暗刻）
        // （有宝牌暗刻就来第四张，开暗杠：宝牌、里宝牌各四张）
        if (NELLY.dora[v] && !good(w.live[0]) && w.bringToLive(0, (t) => isDora(g, t) && held[kindOf(t)] >= 2 && !wins(t), g.rng)) return;
        if (wins(w.live[0])) w.bringToLive(0, (t) => !wins(t), g.rng);
        return;
      }
      // 听牌了：听的牌牌山里不到两张，先来一张能换成好听牌的牌（至少三张）
      if (!p.riichi && nellyLiveWaits(g, p.hand, p.melds.length) < 2) {
        const fix = reshape(g, seat, 3);
        if (w.bringToLive(0, (t) => fix(t) && !wins(t), g.rng)) return;
      }
      // 牌还不够大就来把牌做大的牌（够大了就不再做，免得做过头）
      const big = Math.max(0, ...w.live.filter((t) => !w.locked.has(t)).map(value)) >= nellyTarget(g, seat);
      const kan = NELLY.dora[v] ? kanKind(g, seat) : null;
      if (!p.riichi && kan !== null && !big && w.bringToLive(0, (t) => kindOf(t) === kan && !wins(t), g.rng)) return;
      if (!p.riichi && !big && (w.bringToLive(0, (t) => isDora(g, t) && held[kindOf(t)] >= 2 && !wins(t), g.rng) || w.bringToLive(0, (t) => shapes(t) && !wins(t) && !good(t), g.rng))) return;
      if (wins(w.live[0])) w.bringToLive(0, (t) => !wins(t), g.rng);
      return;
    }
    // 到了那一巡
    if (sh > 0) {
      w.bringToLive(0, (t) => good(t) && isDora(g, t), g.rng) || w.bringToLive(0, (t) => good(t) && shapes(t), g.rng) || w.bringToLive(0, good, g.rng);
      return;
    }
    const target = nellyTarget(g, seat);
    const cap = NELLY.cap[v] * (seat === g.dealer ? 1.5 : 1);
    if (w.bringToLive(0, (t) => value(t) >= target && value(t) <= cap, g.rng) || w.bringToLive(0, (t) => value(t) >= target, g.rng)) return;
    // 和了牌不够大、手里有宝牌的暗刻：来第四张开暗杠（宝牌、里宝牌各四张，岭上开花）。立直了要杠了不改听牌
    const kan = kanKind(g, seat);
    if (kan !== null && w.bringToLive(0, (t) => kindOf(t) === kan, g.rng)) return;
    // 牌还不够大：再等几巡，接着做大
    if (turn < due + NELLY.grace && !late && !p.riichi && w.bringToLive(0, (t) => shapes(t) && !wins(t) && !good(t), g.rng)) return;
    // 做不大了：来最大的和了牌；死听就来一张能换听的牌
    const best = Math.max(0, ...w.live.filter((t) => !w.locked.has(t)).map(value));
    if (best > 0 && w.bringToLive(0, (t) => value(t) >= best, g.rng)) return;
    if (p.riichi) return;
    const fix = reshape(g, seat);
    w.bringToLive(0, (t) => fix(t) && shapes(t), g.rng) || w.bringToLive(0, fix, g.rng);
  },

  // 发牌前押运势：不选就是不押
  preDeal(g, seat): PreDealOption[] {
    const pool = nellyPool(g, seat);
    const gs = gameStateOf(g, seat);
    return [1, 2, 3].map((n) => ({
      id: `luck${n}`,
      name: `押 ${n} 点 · ${TIER_NAMES[n]}`,
      desc:
        n === 3
          ? `进张朝三倍满发展（混一色加宝牌刻子，玄在场做清一色），第 ${NELLY.turn[3]} 巡左右立直一发自摸；和牌别人挡不住；七姐妹封三家`
          : `进张朝${TIER_NAMES[n]}发展，第 ${NELLY.turn[n]} 巡左右和；七姐妹封${n === 2 ? '两' : '一'}家`,
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
      (v > 0 ? `这一局押了 ${v} 点（${TIER_NAMES[v]}，第 ${NELLY.turn[v]} 巡左右和），七姐妹自动开着、最多封 ${v} 家` : '这一局没押运势，七姐妹不发动') +
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
  // 押 2、3 点立直和牌：里宝牌变成她手里最多的那种牌（摸牌时也先换好，算番用；和牌这一刻再定一次，见 doraControl）
  // 押 3 点：里宝牌定到正好三倍满（11–12 番），不多不少
  claimUra(g, seat, winTile) {
    const v = tierOf(g, seat);
    if (v >= 3) fitUra(g, seat, winTile);
    else if (NELLY.dora[v]) setUra(g, seat);
  },

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
