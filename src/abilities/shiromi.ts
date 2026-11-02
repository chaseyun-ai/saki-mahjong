import type { Game } from '../engine/game';
import { evaluateWin } from '../engine/score';
import { shanten } from '../engine/shanten';
import { EAST, KIND_COUNT, Kind, TileId, isRed, kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 小濑川白望（宫守）：迷途之家（マヨヒガ）。不动牌山，只给信息。
// 每次要打牌时（摸牌后、鸣牌后）有 chance 的概率发动：照着牌山此刻的样子，
// 假设这一局没人鸣牌、开杠，算出她接下来摸到的牌（live[3]、live[7]……），
// 找出靠这些牌最早能自摸和出的最终牌型（同样早的挑点数最高的），
// 再看现在手里哪张牌用不上，就是“应该打的牌”——玩家操作时牌底下泛起白色水波纹，电脑的白望直接打它。
// 这一局怎么摸都和不了的时候不出水波纹。
// 发不发动不用 g.rng：按种子和这一回合算一个固定的数，看不看、什么时候看都不会改变牌局（怜的演算、能力记录器照旧逐字一致）
export const SHIROMI = {
  chance: 0.3,
  // 每种最终牌型最多比较这么多种拆法
  maxHands: 120,
};

export interface MayoigaPlan {
  // 应该打的牌
  tile: TileId;
  // 第几次摸牌自摸（1 是下一次）
  draws: number;
  // 最终和出的牌（门内，包含和了牌）和那张和了牌
  hand: TileId[];
  winTile: TileId;
  // 自摸一共收多少点（不算本场、里宝牌）
  value: number;
}

interface ShiromiState {
  key?: string;
  plan?: MayoigaPlan | null;
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as ShiromiState;

// 这一回合的标识：同一局、牌山剩的张数、打过几张、鸣过几次都一样就是同一次出牌
function turnKey(g: Game, seat: number): string {
  const p = g.players[seat];
  return `${g.roundWind}-${g.roundNumber}-${g.honba}-${g.wall.remaining}-${p.discards.length}-${p.melds.length}`;
}

// 种子和这一回合混出来的 0–1 之间的数（不碰 g.rng）
function roll(seed: number, key: string): number {
  let h = (seed ^ 0x5bd1e995) >>> 0;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 现在是她要打牌的时候
function choosing(g: Game, seat: number): boolean {
  const p = g.players[seat];
  return g.phase === 'turn' && g.turn === seat && !p.riichi && (p.hand.length + 3 * p.melds.length) % 3 === 2;
}

// pool（每种牌有几张）里凑得出 sets 个面子加一个雀头、而且用到 win 这种牌的拆法，每种拆法给出用到的每种牌几张
export function completeHands(pool: readonly number[], sets: number, win: Kind, limit = SHIROMI.maxHands): number[][] {
  const out: number[][] = [];
  const used = new Array<number>(KIND_COUNT).fill(0);
  const rec = (i: number, setsLeft: number, pairLeft: number) => {
    if (out.length >= limit) return;
    if (i > win && used[win] === 0) return;
    if (setsLeft === 0 && pairLeft === 0) {
      if (used[win] > 0) out.push(used.slice());
      return;
    }
    if (i >= KIND_COUNT) return;
    const seqOk = i < 27 && i % 9 <= 6;
    for (let pair = 0; pair <= pairLeft; pair++) {
      for (let trip = 0; trip <= 1 && trip <= setsLeft; trip++) {
        for (let seq = 0; seq + trip <= setsLeft && (seq === 0 || seqOk); seq++) {
          const need = 2 * pair + 3 * trip + seq;
          if (used[i] + need > pool[i]) break;
          if (seq && (used[i + 1] + seq > pool[i + 1] || used[i + 2] + seq > pool[i + 2])) break;
          used[i] += need;
          if (seq) {
            used[i + 1] += seq;
            used[i + 2] += seq;
          }
          rec(i + 1, setsLeft - trip - seq, pairLeft - pair);
          used[i] -= need;
          if (seq) {
            used[i + 1] -= seq;
            used[i + 2] -= seq;
          }
        }
      }
    }
  };
  rec(0, sets, 1);
  return out;
}

// 门清时的七对子：pool 里挑 7 种对子（包括 win），只挑一种（最多 limit 种挑法）
function chiitoiHands(pool: readonly number[], win: Kind, limit = SHIROMI.maxHands): number[][] {
  const pairs = pool.map((n, k) => (n >= 2 && k !== win ? k : -1)).filter((k) => k >= 0);
  if (pool[win] < 2 || pairs.length < 6) return [];
  const out: number[][] = [];
  const pick = (start: number, chosen: number[]) => {
    if (out.length >= limit) return;
    if (chosen.length === 6) {
      const c = new Array<number>(KIND_COUNT).fill(0);
      for (const k of [...chosen, win]) c[k] = 2;
      out.push(c);
      return;
    }
    for (let i = start; i < pairs.length; i++) pick(i + 1, [...chosen, pairs[i]]);
  };
  pick(0, []);
  return out;
}

// 按牌山此刻的样子算：她接下来最早能自摸的最终牌型，和现在应该打的牌
export function mayoigaPlan(g: Game, seat: number): MayoigaPlan | null {
  const p = g.players[seat];
  const live = g.wall.live;
  const sets = 4 - p.melds.length;
  const closedMenzen = p.melds.every((m) => m.type === 'ankan');
  // 她以后摸到的牌：下家、对家、上家各摸一张以后轮到她
  const draws: TileId[] = [];
  for (let i = 3; i < live.length; i += 4) draws.push(live[i]);
  const hand = p.hand.slice();
  const pool = toCounts(hand);
  for (let m = 0; m < draws.length; m++) {
    const winTile = draws[m];
    const win = kindOf(winTile);
    const total = pool.slice();
    total[win]++;
    const shapes = completeHands(total, sets, win);
    if (closedMenzen && sets === 4) shapes.push(...chiitoiHands(total, win));
    let best: Scored | null = null;
    for (const shape of shapes) {
      const plan = scoreShape(g, seat, shape, hand, draws.slice(0, m), winTile, 3 + 4 * m === live.length - 1);
      if (plan && (!best || plan.value > best.value)) best = plan;
    }
    if (best) return { tile: pickSpare(g, seat, best.spare), draws: m + 1, hand: best.hand, winTile, value: best.value };
    pool[win]++;
  }
  return null;
}

interface Scored {
  hand: TileId[];
  value: number;
  spare: TileId[];
}

// 照最终牌型挑具体的牌、算点数、找出现在用不上的牌
function scoreShape(g: Game, seat: number, shape: number[], hand: TileId[], before: TileId[], winTile: TileId, haitei: boolean): Scored | null {
  const p = g.players[seat];
  const need = shape.slice();
  need[kindOf(winTile)]--;
  // 以后摸到的牌先用上，手里的牌留得越少，现在能打的越多
  const fromDraws: TileId[] = [];
  for (const t of before) {
    if (need[kindOf(t)] > 0) {
      need[kindOf(t)]--;
      fromDraws.push(t);
    }
  }
  // 手里留下的：同一种里先留赤宝牌
  const keep: TileId[] = [];
  const spare: TileId[] = [];
  const sorted = hand.slice().sort((a, b) => Number(isRed(b)) - Number(isRed(a)));
  for (const t of sorted) {
    if (need[kindOf(t)] > 0) {
      need[kindOf(t)]--;
      keep.push(t);
    } else spare.push(t);
  }
  if (need.some((n) => n > 0) || spare.length === 0) return null;
  const closed = [...keep, ...fromDraws, winTile];
  const r = g.minHanOk(
    evaluateWin({
      closed,
      melds: p.melds,
      kuitan: g.rules.kuitan,
      winTile,
      tsumo: true,
      seatWind: g.seatWind(seat),
      roundWind: EAST + g.roundWind,
      isDealer: seat === g.dealer,
      haitei,
      doraIndicators: g.wall.visibleDoraIndicators().map(kindOf),
    }),
  );
  if (!r) return null;
  const value = seat === g.dealer ? r.tsumoOtherPays * 3 : r.tsumoDealerPays + r.tsumoOtherPays * 2;
  return { hand: closed, value, spare };
}

// 用不上的牌里挑一张：打得出去的；先打刚摸的那张，再挑打了以后向听最少的
function pickSpare(g: Game, seat: number, spare: TileId[]): TileId {
  const p = g.players[seat];
  const legal = new Set(g.legalActions(seat).flatMap((a) => (a.type === 'discard' ? [a.tile] : [])));
  const ok = spare.filter((t) => legal.has(t));
  const list = ok.length ? ok : spare;
  const counts = toCounts(p.hand);
  const after = (t: TileId) => {
    counts[kindOf(t)]--;
    const s = shanten(counts, p.melds.length);
    counts[kindOf(t)]++;
    return s;
  };
  return list.slice().sort((a, b) => after(a) - after(b) || Number(b === p.drawn) - Number(a === p.drawn) || Number(isRed(a)) - Number(isRed(b)))[0];
}

// 这一次出牌迷途之家有没有发动、算出来什么（没发动、和不了都是 null）。同一回合只算一次
export function shiromiPlan(g: Game, seat: number): MayoigaPlan | null {
  if (g.active(seat)?.id !== 'shiromi' || !choosing(g, seat)) return null;
  const st = stateOf(g, seat);
  const key = turnKey(g, seat);
  if (st.key !== key) {
    st.key = key;
    st.plan = roll(g.seed + seat * 7919, key) < SHIROMI.chance ? mayoigaPlan(g, seat) : null;
  }
  const plan = st.plan ?? null;
  // 手里已经没有这张了（刚打出去）就不算
  return plan && g.players[seat].hand.includes(plan.tile) ? plan : null;
}

// 应该打的那张牌（牌底下的白色水波纹）
export function shiromiRipple(g: Game, seat: number): TileId | null {
  return shiromiPlan(g, seat)?.tile ?? null;
}

export const shiromiAbility: Ability = {
  id: 'shiromi',
  name: '迷途之家',
  description: `每次要打牌时有 ${SHIROMI.chance * 100}% 的概率发动：照牌山此刻的样子，算出这一局她靠自摸最早能和出的最终牌型，应该打的那张牌底下泛起白色水波纹。不动牌山；有人鸣牌、开杠，或者别人的能力换了牌，算好的路就会变。`,

  skill(g, seat) {
    const plan = shiromiPlan(g, seat);
    return {
      label: '',
      note: plan ? `迷途之家：照现在的牌山，第 ${plan.draws} 次摸牌能自摸（${plan.value} 点），打水波纹那张` : `被动：每次要打牌时 ${SHIROMI.chance * 100}% 的概率看出该打哪张`,
      enabled: false,
      active: !!plan,
    };
  },

  badge(g, seat) {
    return shiromiPlan(g, seat) ? '迷途' : null;
  },

  insight(g, seat) {
    const plan = shiromiPlan(g, seat);
    return [plan ? `迷途之家发动：照现在的牌山第 ${plan.draws} 次摸牌自摸` : '迷途之家：每次打牌前三成概率看出这一局自摸的路'];
  },
};
