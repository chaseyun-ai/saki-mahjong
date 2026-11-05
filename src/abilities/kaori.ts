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
  tries: 30, // 挑几副牌型，挑到牌山里凑得齐的为止
};

export interface KaoriHand {
  name: string;
  kinds: Kind[]; // 13 张的牌种
}

const pick = <T>(g: Game, xs: readonly T[]): T => xs[g.rng.int(xs.length)];

// 随机一副役满听牌（13 张）
export function yakumanTemplate(g: Game): KaoriHand {
  const honors = [27, 28, 29, 30, 31, 32, 33];
  switch (g.rng.int(4)) {
    case 0: {
      // 国士无双：十二种幺九各一张，再一种成对，听剩下那一种
      const wait = pick(g, YAOCHU_KINDS);
      const rest = YAOCHU_KINDS.filter((k) => k !== wait);
      return { name: '国士无双', kinds: [...rest, pick(g, rest)] };
    }
    case 1: {
      // 四暗刻单骑：四个暗刻加一张
      const ks = g.rng.shuffle([...Array(34).keys()]).slice(0, 5);
      return { name: '四暗刻', kinds: [...ks.slice(0, 4).flatMap((k) => [k, k, k]), ks[4]] };
    }
    case 2: {
      // 大三元：三元牌三副刻子，再一个对子和一个两面搭子
      const suit = g.rng.int(3) * 9;
      const n = 1 + g.rng.int(6); // 二三 到 七八：两面
      const pair = pick(g, [...Array(27).keys()].filter((k) => k !== suit + n && k !== suit + n + 1));
      return { name: '大三元', kinds: [HAKU, HAKU, HAKU, HATSU, HATSU, HATSU, CHUN, CHUN, CHUN, suit + n, suit + n + 1, pair, pair] };
    }
    default: {
      // 字一色：三副字牌刻子、两个字牌对子（双碰）
      const ks = g.rng.shuffle([...honors]).slice(0, 5);
      return { name: '字一色', kinds: [...ks.slice(0, 3).flatMap((k) => [k, k, k]), ks[3], ks[3], ks[4], ks[4]] };
    }
  }
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

// 她的配牌和发完牌以后的牌山里（没锁住、不是宝牌）凑得齐 kinds 吗
function enough(g: Game, seat: number, kinds: Kind[]): boolean {
  const w = g.wall;
  const pool = [...g.dealIndices(seat).map((i) => w.live[i]), ...w.live.slice(52)].filter(usable(g));
  return kinds.every((k) => pool.filter((t) => kindOf(t) === k).length >= kinds.filter((x) => x === k).length);
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
    // 别人配牌里的牌换不过来，凑不齐的牌型换一副再试
    let t: KaoriHand | null = null;
    for (let n = 0; n < KAORI.tries && !t; n++) {
      const x = yakumanTemplate(g);
      if (enough(g, seat, x.kinds)) t = x;
    }
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
