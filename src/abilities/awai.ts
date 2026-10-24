import type { Game } from '../engine/game';
import { Rng } from '../engine/rng';
import { shanten, waitingKinds } from '../engine/shanten';
import { KIND_COUNT, Kind, TileId, doraFromIndicator, kindOf, toCounts } from '../engine/tiles';
import { isCornerDraw } from '../engine/wall';
import { PRIORITY, type Ability } from './types';

// 大星淡（白糸台）：
// - 绝对安全圈：配牌前把另外三家的配牌压到 AWAI.safeShanten 向听以上；没人鸣牌的话，前 AWAI.safeTurns 巡他们摸的牌也帮不上忙
// - 双立直：她自己的配牌直接听牌，手里留一个暗刻
// - 转角暗杠：暗刻的第四张放在牌山最后一个转角前、轮到她摸的位置（锁住，谁都动不了）。
//   暗杠以后杠里指示牌指向这张，四张都是里宝牌；下一次摸牌就是和了牌。
// 破法：有人鸣牌，摸牌顺序错开，那张第四张就轮不到她；被别人的能力挡住和了牌，也和不了。
// 强度参数（测试和平衡脚本会临时改它们）
export const AWAI = {
  // 每局有多大概率展开绝对安全圈
  circleChance: 0.4,
  safeShanten: 5,
  safeTurns: 4,
  // 展开安全圈的那一局，有多大概率配到双立直的牌、准备转角暗杠
  cornerKanChance: 0.2,
};

interface AwaiState {
  circle?: boolean; // 这一局展开了绝对安全圈
  kanKind?: Kind; // 暗刻是哪种牌
  corner?: TileId; // 放在转角的第四张
  kanned?: boolean; // 已经暗杠了
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as AwaiState;

// 转角暗杠还有没有戏：第四张还在牌山里、还没杠（电脑的淡这时不荣和、不拆暗刻）
export function awaiWaitingForCorner(g: Game, seat: number): Kind | null {
  const st = stateOf(g, seat);
  if (st.kanKind === undefined || st.kanned || st.corner === undefined) return null;
  return g.wall.live.includes(st.corner) ? st.kanKind : null;
}

// 随机配一手听牌：一个暗刻 + 两个顺子 + 一个对子 + 一个两面搭子。暗杠以后听的牌不能变
function planHand(avail: number[], rng: Rng): { kinds: Kind[]; kan: Kind } | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    const need = new Array<number>(KIND_COUNT).fill(0);
    const kan = rng.int(KIND_COUNT);
    need[kan] = 4; // 第四张也得在牌山里
    const seq = () => {
      const k = rng.int(3) * 9 + rng.int(7);
      need[k]++;
      need[k + 1]++;
      need[k + 2]++;
    };
    seq();
    seq();
    need[rng.int(KIND_COUNT)] += 2;
    const r = rng.int(3) * 9 + 1 + rng.int(6);
    need[r]++;
    need[r + 1]++;
    if (need.some((n, k) => n > avail[k] || n > 4)) continue;
    const hand = need.slice();
    hand[kan] = 3;
    const waits = waitingKinds(hand, 0);
    if (waits.length === 0 || waits.includes(kan)) continue;
    const afterKan = hand.slice();
    afterKan[kan] = 0;
    if (waitingKinds(afterKan, 1).join() !== waits.join()) continue;
    const kinds: Kind[] = [];
    hand.forEach((n, k) => {
      for (let i = 0; i < n; i++) kinds.push(k);
    });
    return { kinds, kan };
  }
  return null;
}

// 最后一个转角前、轮到她摸的位置（live 的下标，配牌前算）。要在她立直之后，杠完还得再摸一次
function cornerSlot(g: Game, seat: number): number | null {
  const sum = g.dice[0] + g.dice[1];
  const rel = (seat - g.dealer + 4) % 4;
  for (let d = 121; d >= 52; d--) {
    if (!isCornerDraw(g.dealer, sum, d)) continue;
    for (let h = d; h > d - 4; h--) {
      if ((h - 52) % 4 !== rel) continue;
      if (h >= 52 + 4 * 3 && h + 5 <= 121) return h;
    }
  }
  return null;
}

export const awaiAbility: Ability = {
  id: 'awai',
  name: '绝对安全圈',
  description: `每局有 ${AWAI.circleChance * 100}% 展开绝对安全圈：另外三家的配牌至少 ${AWAI.safeShanten} 向听，没人鸣牌的话前 ${AWAI.safeTurns} 巡也摸不到有用的牌。展开时有 ${AWAI.cornerKanChance * 100}% 配牌就听牌、可以双立直，手里的暗刻在牌山最后一个转角前开暗杠，杠里四张都是里宝牌，下一张就是和了牌。`,
  priority: PRIORITY.awai,

  beforeDeal(g, seat) {
    const w = g.wall;
    const st = stateOf(g, seat);
    const avail = toCounts(w.live);
    if (!g.rng.chance(AWAI.circleChance)) return;
    st.circle = true;
    const plan = g.rng.chance(AWAI.cornerKanChance) ? planHand(avail, g.rng) : null;
    const slot = cornerSlot(g, seat);
    const mine = new Set(g.dealIndices(seat));
    if (plan) {
      // 把配好的牌一张张换到她的配牌位置上
      const ids: TileId[] = [];
      for (const k of plan.kinds) ids.push(w.live.find((t) => kindOf(t) === k && !ids.includes(t))!);
      g.dealIndices(seat).forEach((i, n) => w.bringToLive(i, (t) => t === ids[n], g.rng));
      st.kanKind = plan.kan;
      const fourth = w.live.find((t, i) => kindOf(t) === plan.kan && !mine.has(i));
      if (slot !== null && fourth !== undefined && w.bringToLive(slot, (t) => t === fourth, g.rng)) {
        st.corner = fourth;
        w.locked.add(fourth);
      }
      // 杠里要用的指示牌先藏在后面的里宝牌里：开局时牌山里一定还有，等到转角时可能早被摸光了
      const indicator = (t: TileId) => doraFromIndicator(kindOf(t)) === plan.kan;
      w.bringToUra(1, indicator, g.rng, (j) => j >= 52);
      w.bringToUra(2, indicator, g.rng, (j) => j >= 52);
    }
    // 别人的配牌：把有用的牌换成没用的，换到发完牌以后的牌山里
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      const idx = g.dealIndices(s);
      for (let guard = 0; guard < 80; guard++) {
        const counts = toCounts(idx.map((i) => w.live[i]));
        const sh = shanten(counts);
        if (sh >= AWAI.safeShanten) break;
        // 换一张：能让向听变差最好；哪张都换不差（几个搭子互相顶替）时，先横着换一张，打散手牌再说
        const swap = (i: number, need: number) => {
          const old = kindOf(w.live[i]);
          return (t: TileId) => {
            if (kindOf(t) === old) return false;
            counts[old]--;
            counts[kindOf(t)]++;
            const ok = shanten(counts) >= need;
            counts[kindOf(t)]--;
            counts[old]++;
            return ok;
          };
        };
        const order = g.rng.shuffle(idx.slice());
        if (order.some((i) => w.bringToLive(i, swap(i, sh + 1), g.rng, (j) => j >= 52))) continue;
        if (!order.some((i) => w.bringToLive(i, swap(i, sh), g.rng, (j) => j >= 52))) break;
      }
    }
  },

  onRoundStart(g, seat) {
    if (stateOf(g, seat).circle) g.emit({ type: 'ability', seat, ability: 'awai', text: '绝对安全圈' });
  },

  // 前几巡：别人摸到能减少向听的牌就换走
  beforeAnyDraw(g, seat, drawer) {
    if (!stateOf(g, seat).circle || drawer === seat || !g.noCallsYet) return;
    if (g.players[drawer].discards.length >= AWAI.safeTurns) return;
    const p = g.players[drawer];
    const counts = toCounts(p.hand);
    const sh = shanten(counts, p.melds.length);
    return {
      seat,
      ability: 'awai',
      text: '绝对安全圈',
      deny: (t) => {
        counts[kindOf(t)]++;
        const better = shanten(counts, p.melds.length) < sh;
        counts[kindOf(t)]--;
        return better;
      },
    };
  },

  beforeDraw(g, seat, rinshan) {
    const st = stateOf(g, seat);
    if (rinshan || st.kanKind === undefined) return;
    const waits = g.waits(seat);
    if (waits.length === 0) return;
    if (st.kanned) {
      // 杠完下一张就是和了牌
      if (g.wall.bringToLive(0, (t) => waits.includes(kindOf(t)), g.rng)) {
        st.kanKind = undefined;
        g.emit({ type: 'ability', seat, ability: 'awai', text: '杠里' });
      }
      return;
    }
    // 转角之前不提前和
    if (awaiWaitingForCorner(g, seat) !== null) g.wall.bringToLive(0, (t) => !waits.includes(kindOf(t)), g.rng);
  },

  afterDraw(g, seat) {
    const st = stateOf(g, seat);
    if (!g.rinshanDraw || st.kanned || st.kanKind === undefined) return;
    const m = g.players[seat].melds.at(-1);
    if (m?.type !== 'ankan' || kindOf(m.tiles[0]) !== st.kanKind) return;
    st.kanned = true;
    // 杠以后翻的那张宝牌下面的里宝牌，指向她杠的牌
    const kan = st.kanKind;
    g.wall.bringToUra(g.wall.doraRevealed - 1, (t) => doraFromIndicator(kindOf(t)) === kan, g.rng);
  },
};
