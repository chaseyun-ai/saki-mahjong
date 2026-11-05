import type { Game } from '../engine/game';
import { waitingKinds } from '../engine/shanten';
import { CHUN, HAKU, HATSU, Kind, TileId, YAOCHU_KINDS, kindOf, toCounts } from '../engine/tiles';
import { isDoraTile } from './kuro';
import type { Ability } from './types';

// 妹尾佳织（鹤贺）：新手运。完全的新手，平时偶尔看漏。
// 每局发牌前有 1% 的概率，配牌直接是役满的听牌（国士无双、四暗刻单骑、大三元、字一色里随机一种），
// 和出来一定是役满。凑这副牌只从发完牌以后的牌山里换，别人对她配牌的规矩不能变差（换不出来就没有）。
// 电脑的佳织拿到役满听牌后只摸切、不鸣牌，能和就和
export const KAORI = {
  chance: 0.01, // 每局配牌是役满听牌的概率
};

export interface KaoriHand {
  name: string;
  kinds: Kind[]; // 13 张的牌种
}

const pick = <T>(g: Game, xs: readonly T[]): T => xs[g.rng.int(xs.length)];

// 同一门花色里离得近（差 2 以内）的两种牌：刻子挨着会拆出顺子，听的牌就不一定是役满了（111 222 333 4 荣 1 是 11 123 123 234）
const near = (a: Kind, b: Kind) => a < 27 && b < 27 && Math.floor(a / 9) === Math.floor(b / 9) && Math.abs(a - b) <= 2;

// 随机挑 n 种牌，每种至少 need[i] 张能用，两两不挨着。挑不出来是 null
function spread(g: Game, avail: number[], need: number[], from: Kind[]): Kind[] | null {
  for (let tries = 0; tries < 20; tries++) {
    const out: Kind[] = [];
    for (const n of need) {
      const ok = from.filter((k) => avail[k] >= n && !out.includes(k) && !out.some((o) => near(o, k)));
      if (!ok.length) break;
      out.push(pick(g, ok));
    }
    if (out.length === need.length) return out;
  }
  return null;
}

// 随机一副役满听牌（13 张），听哪张和出来都是役满。avail：她的配牌和发完牌以后的牌山里每种牌能用几张，
// 只挑凑得齐的牌型（别人配牌里的牌换不过来）。都凑不齐是 null
export function yakumanTemplate(g: Game, avail: number[]): KaoriHand | null {
  const all = [...Array(34).keys()];
  const honors = all.filter((k) => k >= 27);
  const shapes: (() => KaoriHand | null)[] = [
    () => {
      // 国士无双：十二种幺九各一张，再一种成对，听剩下那一种
      const wait = pick(g, YAOCHU_KINDS);
      const rest = YAOCHU_KINDS.filter((k) => k !== wait);
      const pairs = rest.filter((k) => avail[k] >= 2);
      if (rest.some((k) => avail[k] < 1) || !pairs.length) return null;
      return { name: '国士无双', kinds: [...rest, pick(g, pairs)] };
    },
    () => {
      // 四暗刻单骑：四个暗刻加一张
      const ks = spread(g, avail, [3, 3, 3, 3, 1], all);
      return ks && { name: '四暗刻', kinds: [...ks.slice(0, 4).flatMap((k) => [k, k, k]), ks[4]] };
    },
    () => {
      // 大三元：三元牌三副刻子，再一个对子和一个两面搭子
      if ([HAKU, HATSU, CHUN].some((k) => avail[k] < 3)) return null;
      const runs = all.filter((k) => k < 27 && k % 9 >= 1 && k % 9 <= 6 && avail[k] >= 1 && avail[k + 1] >= 1);
      if (!runs.length) return null;
      const n = pick(g, runs);
      const pairs = all.filter((k) => k < 27 && avail[k] >= 2 && !near(k, n) && !near(k, n + 1));
      if (!pairs.length) return null;
      const pair = pick(g, pairs);
      return { name: '大三元', kinds: [HAKU, HAKU, HAKU, HATSU, HATSU, HATSU, CHUN, CHUN, CHUN, n, n + 1, pair, pair] };
    },
    () => {
      // 字一色：三副字牌刻子、两个字牌对子（双碰）
      const ks = spread(g, avail, [3, 3, 3, 2, 2], honors);
      return ks && { name: '字一色', kinds: [...ks.slice(0, 3).flatMap((k) => [k, k, k]), ks[3], ks[3], ks[4], ks[4]] };
    },
  ];
  for (const shape of g.rng.shuffle(shapes)) {
    const t = shape();
    if (t) return t;
  }
  return null;
}

interface KaoriState {
  hand?: string; // 这一局拿到的役满（凑成了才有）
}
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as KaoriState;

// 这一局拿到了役满听牌：役满的名字，没有是 null
export function kaoriYakuman(g: Game, seat: number): string | null {
  return stateOf(g, seat).hand ?? null;
}

const usable = (g: Game) => (t: TileId) => !isDoraTile(g, t) && !g.wall.locked.has(t);

// 她的配牌和发完牌以后的牌山里（没锁住、不是宝牌）每种牌有几张
function availOf(g: Game, seat: number): number[] {
  const w = g.wall;
  return toCounts([...g.dealIndices(seat).map((i) => w.live[i]), ...w.live.slice(52)].filter(usable(g)));
}

function enough(g: Game, seat: number, kinds: Kind[]): boolean {
  const avail = availOf(g, seat);
  return kinds.every((k) => avail[k] >= kinds.filter((x) => x === k).length);
}

// 把她的配牌换成 kinds。先看牌山里够不够，再一张张换；中途换不动就算了（返回 false）
export function dealHand(g: Game, seat: number, kinds: Kind[]): boolean {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  const ok = usable(g);
  if (!enough(g, seat, kinds)) return false;
  const left = kinds.slice();
  const free: number[] = [];
  for (const i of mine) {
    const j = left.indexOf(kindOf(w.live[i]));
    if (j >= 0 && ok(w.live[i])) left.splice(j, 1);
    else free.push(i);
  }
  for (const i of free) {
    const k = left.shift()!;
    if (!w.bringToLive(i, (t) => kindOf(t) === k && ok(t), g.rng, (j) => j >= 52)) return false;
  }
  return true;
}

export const kaoriAbility: Ability = {
  id: 'kaori',
  name: '新手运',
  description: `完全的新手。每局有 ${KAORI.chance * 100}% 的概率配牌直接是役满的听牌（国士无双、四暗刻单骑、大三元、字一色），和出来一定是役满。`,

  beforeDeal(g, seat) {
    if (!g.rng.chance(KAORI.chance)) return;
    const t = yakumanTemplate(g, availOf(g, seat));
    if (!t || !dealHand(g, seat, t.kinds)) return;
    // 真的是听牌才算（别人的规矩挡住、换了一半的不算）
    const hand = g.dealIndices(seat).map((i) => g.wall.live[i]);
    if (waitingKinds(toCounts(hand), 0).length) stateOf(g, seat).hand = t.name;
  },

  onRoundStart(g, seat) {
    const name = kaoriYakuman(g, seat);
    if (name) g.emit({ type: 'ability', seat, ability: 'kaori', text: '新手运' });
  },

  skill(g, seat) {
    const name = kaoriYakuman(g, seat);
    return { label: '', note: name ? `新手运：配牌是${name}的听牌` : `每局 ${KAORI.chance * 100}% 的概率配牌是役满听牌`, enabled: false, active: !!name };
  },

  insight(g, seat) {
    const name = kaoriYakuman(g, seat);
    return [name ? `这一局配牌是${name}的听牌` : '这一局是普通的配牌'];
  },
};
