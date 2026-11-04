import type { Game } from '../engine/game';
import { evaluateWin } from '../engine/score';
import { shanten, waitingKinds } from '../engine/shanten';
import { EAST, KIND_COUNT, Kind, TileId, YAOCHU_KINDS, isRed, kindOf, toCounts } from '../engine/tiles';
import { isDoraTile, kuroLost } from './kuro';
import type { Ability } from './types';

// 爱丽丝（宫守）：手绘板。
// - 配完牌以后牌桌换成手绘板：照现在的牌山，假设谁都不鸣牌，她接下来一张张摸到的牌是定好的。
//   在这些牌里找出她最早能自摸的那副牌（同样早的挑点数大的），画在手牌上面。
//   牌山里凑不出来时，安排一下：换几张没公开的牌进她要摸的位置，凑一副 3 番以内的门清自摸。
// - 她要摸的那几张锁住，别人的能力换不走。照着画的打，没人鸣牌就自然走到自摸。
// - 有人鸣牌（吃、碰、明杠、加杠，她自己开杠也算）摸牌顺序就乱了，手绘板破碎、回到普通牌桌；
//   她把画上要的牌打出去、摸到的不是画上的牌（别人暗杠挪走了海底之类）也一样碎掉。
// - 每场比赛 3 支画笔，不恢复。手绘板碎了以后可以用一支画笔，照现在的手牌和牌山再画一次。
// - 被封印、被压住控牌山（淡的高维领域、巨引力源）、佛灭的局不出手绘板，画笔也用不了。
//   玄的能力还在时，画上不用别人摸不到的宝牌
export const AISLINN = {
  brushes: 3, // 每场几支画笔
  maxHan: 3, // 牌山凑不出来时安排的牌最多几番（不算立直）
  tries: 40, // 安排时试几次
  spread: 4, // 安排的牌在接下来几张里摊开：最多比要的张数多摸几张才自摸
  leaves: 4000, // 找和牌时最多看多少种拆法
  aiBrushDraws: 4, // 电脑的爱丽丝：重画出来的牌最多再摸这么多张就能自摸才用画笔（摸得越多，越容易又被鸣碎）
};

export interface SketchPlan {
  final: TileId[]; // 和了时门内的牌（不含副露），最后一张是自摸的那张
  win: TileId;
  draws: TileId[]; // 从画好那一刻起她要摸的牌（按顺序，到自摸的那张为止）
  needed: boolean[]; // draws 里哪几张是画上要的（锁住）
  step: number; // 已经摸了 draws 里的几张
  han: number;
  yakuman: number;
  yaku: string[];
  points: number; // 自摸一共收多少（不含本场）
  arranged: boolean; // 牌山凑不出来、安排出来的
}

interface RoundState {
  plan?: SketchPlan | null;
  broken?: boolean; // 手绘板碎了（这一局画过、现在是普通牌桌）
  locks?: TileId[];
}

interface GameState {
  brushes?: number;
}

const roundOf = (g: Game, seat: number) => g.abilityState[seat] as RoundState;
const gameOf = (g: Game, seat: number) => g.abilityGameState[seat] as GameState;

export function aislinnBrushes(g: Game, seat: number): number {
  return gameOf(g, seat).brushes ?? AISLINN.brushes;
}

// 现在画着的手绘板（碎了、没画是 null）
export function aislinnPlan(g: Game, seat: number): SketchPlan | null {
  if (g.abilities[seat]?.id !== 'aislinn') return null;
  const st = roundOf(g, seat);
  return !st.broken && st.plan ? st.plan : null;
}

// 牌桌是不是手绘板（这一局在打、画着）
export function aislinnSketch(g: Game, seat: number): boolean {
  return (g.phase === 'turn' || g.phase === 'calls') && aislinnPlan(g, seat) !== null;
}

// 手绘板碎了，还能不能用画笔再画一次
export function aislinnCanBrush(g: Game, seat: number): boolean {
  const st = roundOf(g, seat);
  if (g.phase !== 'turn' && g.phase !== 'calls') return false;
  if (!st.broken || aislinnBrushes(g, seat) <= 0 || !controls(g, seat)) return false;
  return futureSlots(g, seat, g.nextDrawer()).length > 0;
}

// 这一局她能不能动牌山
function controls(g: Game, seat: number): boolean {
  return !!g.active(seat) && !g.quelled(seat) && !g.fieldVoid();
}

// 玄的能力还在：别人摸不到宝牌，画上也不用
function kuroHolds(g: Game, seat: number): boolean {
  return [0, 1, 2, 3].some((s) => s !== seat && g.abilities[s]?.id === 'kuro' && !!g.active(s) && !kuroLost(g, s));
}

// 她接下来要摸的牌在 live 里的位置（假设没人鸣牌、开杠）。first：下一张 live[0] 谁摸
function futureSlots(g: Game, seat: number, first: number): number[] {
  const out: number[] = [];
  for (let k = (seat - first + 4) % 4; k < g.wall.live.length; k += 4) out.push(k);
  return out;
}

// ---------- 找和牌 ----------

// counts 里能挑出来的完整和牌（门内 14 - 3 × 副露张），按种数计
function finalsIn(counts: number[], melds: number, must: Kind, mustMin: number): number[][] {
  const out: number[][] = [];
  const seen = new Set<string>();
  const cur = new Array<number>(KIND_COUNT).fill(0);
  const c = counts.slice();
  let leaves = 0;
  const push = () => {
    if (cur[must] < mustMin) return;
    const key = cur.join('');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cur.slice());
  };
  const rec = (from: number, left: number) => {
    if (leaves > AISLINN.leaves) return;
    if (left === 0) {
      leaves++;
      push();
      return;
    }
    for (let k = from; k < KIND_COUNT; k++) {
      if (c[k] >= 3) {
        c[k] -= 3;
        cur[k] += 3;
        rec(k, left - 1);
        c[k] += 3;
        cur[k] -= 3;
      }
      if (k < 27 && k % 9 <= 6 && c[k] > 0 && c[k + 1] > 0 && c[k + 2] > 0) {
        for (const x of [k, k + 1, k + 2]) {
          c[x]--;
          cur[x]++;
        }
        rec(k, left - 1);
        for (const x of [k, k + 1, k + 2]) {
          c[x]++;
          cur[x]--;
        }
      }
    }
  };
  for (let h = 0; h < KIND_COUNT; h++) {
    if (c[h] < 2) continue;
    c[h] -= 2;
    cur[h] += 2;
    rec(0, 4 - melds);
    c[h] += 2;
    cur[h] -= 2;
  }
  if (melds === 0) {
    // 七对子
    const pairs = Array.from({ length: KIND_COUNT }, (_, k) => k).filter((k) => counts[k] >= 2);
    if (pairs.length >= 7 && pairs.includes(must) && mustMin <= 2) {
      const rest = pairs.filter((k) => k !== must);
      const pick = (start: number, chosen: Kind[]) => {
        if (leaves > AISLINN.leaves) return;
        if (chosen.length === 6) {
          leaves++;
          cur.fill(0);
          for (const k of [...chosen, must]) cur[k] = 2;
          push();
          return;
        }
        for (let i = start; i < rest.length; i++) pick(i + 1, [...chosen, rest[i]]);
      };
      pick(0, []);
    }
    // 国士无双
    if (YAOCHU_KINDS.every((k) => counts[k] >= 1)) {
      for (const h of YAOCHU_KINDS) {
        if (counts[h] < 2) continue;
        cur.fill(0);
        for (const k of YAOCHU_KINDS) cur[k] = 1;
        cur[h] = 2;
        push();
      }
    }
  }
  return out;
}

interface Scored {
  final: TileId[];
  han: number;
  yakuman: number;
  yaku: string[];
  points: number;
  needed: boolean[];
}

// 把这副牌（按种数）落到具体的牌上：自摸的那张一定用上，其余先用手里的，再用先摸到的
function score(g: Game, seat: number, want: number[], hand: TileId[], draws: TileId[], last: boolean): Scored | null {
  const p = g.players[seat];
  const left = want.slice();
  const win = draws[draws.length - 1];
  const final: TileId[] = [];
  const needed = draws.map(() => false);
  left[kindOf(win)]--;
  needed[draws.length - 1] = true;
  for (const t of hand) {
    if (left[kindOf(t)] > 0) {
      left[kindOf(t)]--;
      final.push(t);
    }
  }
  for (let i = 0; i < draws.length - 1; i++) {
    const t = draws[i];
    if (left[kindOf(t)] > 0) {
      left[kindOf(t)]--;
      final.push(t);
      needed[i] = true;
    }
  }
  if (left.some((n) => n !== 0)) return null;
  final.push(win);
  const r = evaluateWin({
    closed: final,
    melds: p.melds,
    kuitan: g.rules.kuitan,
    winTile: win,
    tsumo: true,
    seatWind: g.seatWind(seat),
    roundWind: EAST + g.roundWind,
    isDealer: seat === g.dealer,
    riichi: p.riichi,
    doubleRiichi: p.doubleRiichi,
    haitei: last,
    doraIndicators: g.wall.visibleDoraIndicators().map(kindOf),
  });
  if (!g.minHanOk(r) || !r) return null;
  const points = seat === g.dealer ? r.tsumoOtherPays * 3 : r.tsumoDealerPays + r.tsumoOtherPays * 2;
  return { final, han: r.han, yakuman: r.yakuman, yaku: r.yaku.map((y) => y.name), points, needed };
}

// 照现在的牌山，谁都不鸣牌的话她最早能自摸的那副牌（同样早的挑点数大的）。first：下一张 live[0] 谁摸
// cap：只要不超过这么多番的（安排出来的牌），找不到再不管番数
export function findSketch(g: Game, seat: number, first: number, cap?: number): SketchPlan | null {
  const found = searchSketch(g, seat, first, cap);
  return found ?? (cap === undefined ? null : searchSketch(g, seat, first));
}

function searchSketch(g: Game, seat: number, first: number, cap?: number): SketchPlan | null {
  const p = g.players[seat];
  const w = g.wall;
  const slots = futureSlots(g, seat, first);
  const melds = p.melds.length;
  const kuro = kuroHolds(g, seat);
  // 立直了：手牌不能变，只能等一张和了牌（自己的回合先摸切掉手里刚摸的那张）
  const fixed = p.riichi;
  const hand = fixed && p.drawn !== null ? p.hand.filter((t) => t !== p.drawn) : p.hand;
  const usable = (t: TileId) => !(kuro && isDoraTile(g, t));
  const counts = toCounts(hand);
  const draws: TileId[] = [];
  for (const [i, k] of slots.entries()) {
    const t = w.live[k];
    draws.push(t);
    if (!usable(t)) continue;
    const kind = kindOf(t);
    const before = fixed ? toCounts(hand) : counts.slice();
    const now = before.slice();
    now[kind]++;
    if (!fixed) counts[kind]++;
    if (shanten(now, melds) !== -1) continue;
    const last = k === w.live.length - 1;
    let best: Scored | null = null;
    for (const want of finalsIn(now, melds, kind, before[kind] + 1)) {
      const s = score(g, seat, want, hand, fixed ? [t] : draws.slice(0, i + 1), last);
      if (!s || (cap !== undefined && (s.yakuman > 0 || s.han > cap))) continue;
      if (!best || s.yakuman > best.yakuman || (s.yakuman === best.yakuman && (s.points > best.points || (s.points === best.points && s.han > best.han)))) best = s;
    }
    if (!best) continue;
    const needed = fixed ? [...draws.slice(0, i).map(() => false), true] : best.needed;
    return { final: best.final, win: t, draws: draws.slice(), needed, step: 0, han: best.han, yakuman: best.yakuman, yaku: best.yaku, points: best.points, arranged: false };
  }
  return null;
}

// ---------- 安排 ----------

// 牌山凑不出来：从手里的牌出发，一步步换牌让向听前进（每步打掉一张、要一张），凑一副 3 番以内的门清自摸，
// 再把要的牌换进她接下来要摸的位置。成功时返回已经换好、锁住的牌
function arrange(g: Game, seat: number, first: number): boolean {
  const w = g.wall;
  const slots = futureSlots(g, seat, first);
  if (!slots.length) return false;
  const kuro = kuroHolds(g, seat);
  const usable = (t: TileId) => !w.locked.has(t) && !(kuro && isDoraTile(g, t));
  for (let attempt = 0; attempt < AISLINN.tries; attempt++) {
    const plan = composeTarget(g, seat, usable);
    if (!plan) continue;
    const { adds } = plan;
    if (adds.length > slots.length) continue;
    const span = Math.min(slots.length, adds.length + g.rng.int(AISLINN.spread + 1));
    // 自摸的那张放在第 span 张，其余在前面随便摊开
    const before = g.rng.shuffle(Array.from({ length: span - 1 }, (_, i) => i)).slice(0, adds.length - 1).sort((a, b) => a - b);
    const order = g.rng.shuffle(adds.slice(0, -1));
    const placing: [number, Kind][] = [...before.map((i, n) => [i, order[n]] as [number, Kind]), [span - 1, adds[adds.length - 1]]];
    const snap = w.snapshot();
    const locks: TileId[] = [];
    let ok = true;
    for (const [i, kind] of placing) {
      const at = slots[i];
      if (!w.bringToLive(at, (t) => kindOf(t) === kind && usable(t) && !isRed(t), g.rng)) {
        ok = false;
        break;
      }
      w.locked.add(w.live[at], 'aislinn');
      locks.push(w.live[at]);
    }
    if (ok) {
      roundOf(g, seat).locks = locks;
      return true;
    }
    w.restore(snap);
  }
  return false;
}

// 从手牌出发凑一副和牌：adds 是要摸进来的牌种（最后一张是自摸的那张）
function composeTarget(g: Game, seat: number, usable: (t: TileId) => boolean): { adds: Kind[] } | null {
  const p = g.players[seat];
  const melds = p.melds.length;
  const free = new Array<number>(KIND_COUNT).fill(0);
  for (const t of g.wall.live) if (usable(t)) free[kindOf(t)]++;
  const counts = toCounts(p.hand);
  // 自己的回合（手里 14 张）：先打掉一张让向听最好的
  if (p.hand.length % 3 === 2) {
    const sh = (k: Kind) => {
      counts[k]--;
      const s = shanten(counts, melds);
      counts[k]++;
      return s;
    };
    const kinds = g.rng.shuffle([...new Set(p.hand.map(kindOf))]);
    const best = Math.min(...kinds.map(sh));
    counts[kinds.find((k) => sh(k) === best)!]--;
  }
  // 立直了不能换手牌：直接等一张和了牌
  const fixed = p.riichi;
  const adds: Kind[] = [];
  for (let stepN = 0; stepN < 10; stepN++) {
    const sh = shanten(counts, melds);
    if (sh === 0) {
      const waits = g.rng.shuffle(waitingKinds(counts, melds).filter((k) => free[k] > 0));
      let fallback: Kind | null = null;
      for (const k of waits) {
        const han = tsumoHan(g, seat, counts, k);
        if (han === null) continue;
        if (han <= AISLINN.maxHan + (p.riichi ? 1 : 0)) return { adds: [...adds, k] };
        fallback ??= k;
      }
      if (fallback !== null && fixed) return { adds: [fallback] };
      return null;
    }
    if (fixed) return null;
    const hand = [...new Set(Array.from({ length: KIND_COUNT }, (_, k) => k).filter((k) => counts[k] > 0))];
    const moves: [Kind, Kind][] = [];
    for (const r of hand) {
      counts[r]--;
      for (let a = 0; a < KIND_COUNT; a++) {
        if (a === r || free[a] <= 0 || counts[a] >= 4) continue;
        counts[a]++;
        if (shanten(counts, melds) < sh) moves.push([r, a]);
        counts[a]--;
      }
      counts[r]++;
    }
    if (!moves.length) return null;
    const [r, a] = moves[g.rng.int(moves.length)];
    counts[r]--;
    counts[a]++;
    free[a]--;
    adds.push(a);
  }
  return null;
}

// 这副听牌（counts 是门内 13 - 3 × 副露张）自摸 k 是几番，和不了是 null
function tsumoHan(g: Game, seat: number, counts: number[], k: Kind): number | null {
  const p = g.players[seat];
  const used = new Array<number>(KIND_COUNT).fill(0);
  const closed: TileId[] = [];
  const all = counts.slice();
  all[k]++;
  // 牌 id 随便取同种里不是赤五的几张（只为算番）
  for (let x = 0; x < KIND_COUNT; x++) for (let n = 0; n < all[x]; n++) closed.push(x * 4 + 1 + (used[x]++ % 3));
  const win = closed.find((t) => kindOf(t) === k)!;
  const r = evaluateWin({
    closed,
    melds: p.melds,
    kuitan: g.rules.kuitan,
    winTile: win,
    tsumo: true,
    seatWind: g.seatWind(seat),
    roundWind: EAST + g.roundWind,
    isDealer: seat === g.dealer,
    riichi: p.riichi,
    doraIndicators: g.wall.visibleDoraIndicators().map(kindOf),
  });
  const ok = g.minHanOk(r);
  // 手里的赤宝牌也算进去（上面算番时没用赤五）
  return ok ? (ok.yakuman ? 13 : ok.han + p.hand.filter(isRed).length) : null;
}

// ---------- 画、碎 ----------

function unlock(g: Game, seat: number): void {
  const st = roundOf(g, seat);
  for (const t of st.locks ?? []) g.wall.locked.delete(t, 'aislinn');
  st.locks = [];
}

// 画一次：先找牌山里自然的和牌，凑不出来就安排；画上要摸的牌锁住
function paint(g: Game, seat: number, first: number): SketchPlan | null {
  const st = roundOf(g, seat);
  unlock(g, seat);
  let plan = findSketch(g, seat, first);
  if (!plan && arrange(g, seat, first)) {
    plan = findSketch(g, seat, first, AISLINN.maxHan + (g.players[seat].riichi ? 1 : 0));
    if (plan) plan.arranged = true;
  }
  // 安排时临时锁的牌放开，只锁画上要的
  unlock(g, seat);
  if (!plan) return null;
  const slots = futureSlots(g, seat, first);
  const locks: TileId[] = [];
  plan.draws.forEach((t, i) => {
    if (plan!.needed[i] && g.wall.live[slots[i]] === t) {
      g.wall.locked.add(t, 'aislinn');
      locks.push(t);
    }
  });
  st.locks = locks;
  st.plan = plan;
  st.broken = false;
  return plan;
}

function shatter(g: Game, seat: number): void {
  const st = roundOf(g, seat);
  if (!st.plan || st.broken) return;
  st.broken = true;
  unlock(g, seat);
  g.emit({ type: 'ability', seat, ability: 'aislinn', text: '画板破碎' });
}

// 画上要的牌她还拿得到：手里的牌加上还没摸的画上的牌，盖得住整副牌
function stillReachable(g: Game, seat: number, plan: SketchPlan): boolean {
  const have = toCounts(g.players[seat].hand);
  for (let i = plan.step; i < plan.draws.length; i++) if (plan.needed[i]) have[kindOf(plan.draws[i])]++;
  const want = toCounts(plan.final);
  return want.every((n, k) => have[k] >= n);
}

// 用一支画笔再画一次（玩家按技能栏的画笔，电脑自己决定）
// maxDraws：电脑先试着画一下，画出来要摸的牌比这个多就当没画过（牌山、锁都恢复，不扣画笔、不报）
function useBrush(g: Game, seat: number, maxDraws?: number): boolean {
  if (!aislinnCanBrush(g, seat)) return false;
  const st = roundOf(g, seat);
  const before = maxDraws === undefined ? null : { snap: g.wall.snapshot(), plan: st.plan, locks: st.locks };
  const plan = paint(g, seat, g.nextDrawer());
  if (before && (!plan || aislinnDrawsLeft(plan) > maxDraws!)) {
    g.wall.restore(before.snap);
    Object.assign(st, { plan: before.plan, locks: before.locks, broken: true });
    return false;
  }
  if (!plan) {
    roundOf(g, seat).broken = true;
    g.emit({ type: 'ability', seat, ability: 'aislinn', text: '画不出来' });
    return false;
  }
  gameOf(g, seat).brushes = aislinnBrushes(g, seat) - 1;
  g.emit({ type: 'ability', seat, ability: 'aislinn', text: '重绘' });
  return true;
}

// 电脑的爱丽丝：手绘板碎了，重画出来的牌没几张就能自摸才用一支画笔（自己的回合打牌前）。
// 要摸得多的先不画：摸牌的巡数越多，越容易又被人鸣碎，爱鸣牌的对手面前白白折掉画笔
export function aislinnAiBrush(g: Game, seat: number): void {
  if (g.manual[seat] || g.abilities[seat]?.id !== 'aislinn') return;
  useBrush(g, seat, AISLINN.aiBrushDraws);
}

// 画上不要的牌（电脑的爱丽丝先打这些）
export function aislinnExtra(g: Game, seat: number, plan: SketchPlan): TileId[] {
  const want = toCounts(plan.final);
  const have = g.players[seat].hand;
  for (let i = plan.step; i < plan.draws.length; i++) if (plan.needed[i]) want[kindOf(plan.draws[i])]--;
  const out: TileId[] = [];
  for (const t of have) {
    if (want[kindOf(t)] > 0) want[kindOf(t)]--;
    else out.push(t);
  }
  return out;
}

// 画上还要再摸几张才自摸
export function aislinnDrawsLeft(plan: SketchPlan): number {
  return plan.draws.length - plan.step;
}

export const aislinnAbility: Ability = {
  id: 'aislinn',
  name: '手绘板',
  description: `配完牌以后牌桌变成手绘板：照现在的牌山，假设别人都不鸣牌，把她最早能自摸的那副牌画在手牌上面，画上要摸的牌锁住；牌山里凑不出来就安排一副 ${AISLINN.maxHan} 番以内的。照着打，没人鸣牌就自然走到自摸。有人鸣牌，手绘板破碎、回到普通牌桌。每场比赛 ${AISLINN.brushes} 支画笔（不恢复）：手绘板碎了以后用一支，照现在的手牌和牌山再画一次。`,

  // 配完牌（配牌后的技能选好以后）、庄家摸第一张之前画
  afterDeal(g, seat) {
    if (!controls(g, seat) || g.damped(seat)) return;
    paint(g, seat, g.dealer);
  },

  onRoundStart(g, seat) {
    if (aislinnPlan(g, seat)) g.emit({ type: 'ability', seat, ability: 'aislinn', text: '手绘板' });
  },

  // 摸到的不是画上的那张（别人暗杠挪走了牌山最后一张之类）：碎掉
  afterDraw(g, seat) {
    const plan = aislinnPlan(g, seat);
    if (!plan) return;
    const drawn = g.players[seat].drawn;
    if (g.rinshanDraw || (plan.needed[plan.step] && drawn !== plan.draws[plan.step])) {
      shatter(g, seat);
      return;
    }
    plan.step++;
  },

  // 把画上要的牌打出去了：碎掉
  afterDiscard(g, seat) {
    const plan = aislinnPlan(g, seat);
    if (plan && (plan.step >= plan.draws.length || !stillReachable(g, seat, plan))) shatter(g, seat);
  },

  // 有人鸣牌（别人暗杠不改摸牌顺序，不算）
  onCall(g, seat, caller, call) {
    if (caller !== seat && call === '暗杠') return;
    shatter(g, seat);
  },

  skill(g, seat) {
    const left = aislinnBrushes(g, seat);
    const plan = aislinnPlan(g, seat);
    const st = roundOf(g, seat);
    const ready = aislinnCanBrush(g, seat);
    const note = plan
      ? `手绘板：再摸 ${aislinnDrawsLeft(plan)} 张自摸`
      : st.broken
        ? ready
          ? '手绘板碎了：点一支画笔再画一次'
          : left <= 0
            ? '手绘板碎了，画笔用完了'
            : '手绘板碎了'
        : controls(g, seat)
          ? '这一局没画出来'
          : '这一局画不了';
    return { label: '画笔', note, enabled: ready, active: !!plan, brushes: { left, max: AISLINN.brushes, ready } };
  },

  pressSkill(g, seat) {
    useBrush(g, seat);
  },

  badge(g, seat) {
    return `画笔×${aislinnBrushes(g, seat)}`;
  },

  insight(g, seat) {
    const plan = aislinnPlan(g, seat);
    const lines = [`画笔还剩 ${aislinnBrushes(g, seat)} 支`];
    if (plan) lines.push(`手绘板：再摸 ${aislinnDrawsLeft(plan)} 张自摸，${plan.yakuman ? '役满' : `${plan.han} 番`}${plan.arranged ? '（安排出来的）' : ''}`);
    else if (roundOf(g, seat).broken) lines.push('手绘板碎了');
    return lines;
  },
};
