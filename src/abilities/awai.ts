import type { Game } from '../engine/game';
import { Rng } from '../engine/rng';
import { shanten, waitingKinds } from '../engine/shanten';
import { KIND_COUNT, Kind, TileId, doraFromIndicator, kindOf, toCounts } from '../engine/tiles';
import { isCornerDraw } from '../engine/wall';
import { PRIORITY, type Ability } from './types';

// 大星淡（白糸台）：
// - 能量：整场 AWAI.energyMax 点，不回复。技能开着的每一局开局扣 AWAI.onCost 点；开着时主动关掉扣 AWAI.offCost 点。
//   玩家操作她时由玩家开关（下一局起生效）；电脑一般不在领先时开，开了不主动关。能量不够这一局时自动关掉。
// 技能开着的那一局：
// - 绝对安全圈：配牌前把另外三家的配牌压到 AWAI.safeShanten 向听以上；没人鸣牌的话，前 AWAI.safeTurns 巡他们摸的牌也帮不上忙
// - 双立直（其中 AWAI.cornerKanChance 的局）：她自己的配牌直接听牌，手里留一个暗刻
// - 转角暗杠：暗刻的第四张放在牌山最后一个转角前、轮到她摸的位置（锁住，谁都动不了）。
//   暗杠以后杠里指示牌指向这张，四张都是里宝牌；下一次摸牌就是和了牌。
// 破法：有人鸣牌，摸牌顺序错开，那张第四张就轮不到她；被别人的能力挡住和了牌，也和不了。
// 强度参数（测试和平衡脚本会临时改它们）
export const AWAI = {
  energyMax: 100,
  onCost: 20,
  offCost: 30,
  // 电脑的淡领先时也开技能的概率
  aiLeadChance: 0.1,
  safeShanten: 5,
  safeTurns: 4,
  // 技能开着的那一局，有多大概率配到双立直的牌、准备转角暗杠
  cornerKanChance: 1,
};

interface AwaiGameState {
  energy?: number;
  on?: boolean; // 技能开着（下一局开局扣能量、展开）
}

interface AwaiState {
  circle?: boolean; // 这一局展开了绝对安全圈
  kanKind?: Kind; // 暗刻是哪种牌
  corner?: TileId; // 放在转角的第四张
  kanned?: boolean; // 已经暗杠了
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as AwaiState;
const gameStateOf = (g: Game, seat: number) => {
  const gs = g.abilityGameState[seat] as AwaiGameState;
  gs.energy ??= AWAI.energyMax;
  return gs;
};

// 现在的能量和开关（界面用）
export function awaiEnergy(g: Game, seat: number): { energy: number; on: boolean } {
  const gs = gameStateOf(g, seat);
  return { energy: gs.energy!, on: !!gs.on };
}

// 转角暗杠还有没有戏：第四张还在牌山里、还没杠（电脑的淡这时不荣和、不拆暗刻）
export function awaiWaitingForCorner(g: Game, seat: number): Kind | null {
  const st = stateOf(g, seat);
  if (st.kanKind === undefined || st.kanned || st.corner === undefined) return null;
  return g.wall.live.includes(st.corner) ? st.kanKind : null;
}

// 随机配一手听牌：一个暗刻 + 两个顺子 + 一个对子 + 一个两面搭子。暗杠以后听的牌不能变
// accept：别人对她配牌的规矩也得满足（比如霞绝掉的花色）
function planHand(avail: number[], rng: Rng, accept: (kinds: Kind[]) => boolean): { kinds: Kind[]; kan: Kind } | null {
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
    if (!accept(kinds)) continue;
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

// 把 kinds 摆到她的配牌位置上：已经是要的牌种就不动，缺的先从发完牌以后的牌山里拿
function placeHand(g: Game, mine: number[], kinds: Kind[]): boolean {
  const w = g.wall;
  const need = new Array<number>(KIND_COUNT).fill(0);
  for (const k of kinds) need[k]++;
  const todo: number[] = [];
  for (const i of mine) {
    const k = kindOf(w.live[i]);
    if (need[k] > 0) need[k]--;
    else todo.push(i);
  }
  const mineSet = new Set(mine);
  for (const i of todo) {
    const wanted = (t: TileId) => need[kindOf(t)] > 0;
    if (!w.bringToLive(i, wanted, g.rng, (j) => j >= 52) && !w.bringToLive(i, wanted, g.rng, (j) => !mineSet.has(j))) return false;
    need[kindOf(w.live[i])]--;
  }
  return true;
}

// 把一家的配牌压到 safeShanten 向听以上。做到了返回 true
function worsen(g: Game, idx: number[]): boolean {
  const w = g.wall;
  for (let guard = 0; guard < 80; guard++) {
    const counts = toCounts(idx.map((i) => w.live[i]));
    const sh = shanten(counts);
    if (sh >= AWAI.safeShanten) return true;
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
    if (!order.some((i) => w.bringToLive(i, swap(i, sh), g.rng, (j) => j >= 52))) return false;
  }
  return shanten(toCounts(idx.map((i) => w.live[i]))) >= AWAI.safeShanten;
}

export const awaiAbility: Ability = {
  id: 'awai',
  name: '绝对安全圈',
  description: `能量 ${AWAI.energyMax} 点，不回复。技能开着的每一局开局扣 ${AWAI.onCost} 点，开着时主动关掉扣 ${AWAI.offCost} 点。开着的那一局展开绝对安全圈：另外三家的配牌至少 ${AWAI.safeShanten} 向听，没人鸣牌的话前 ${AWAI.safeTurns} 巡也摸不到有用的牌；${AWAI.cornerKanChance >= 1 ? '' : `其中 ${AWAI.cornerKanChance * 100}% 的局`}她自己配牌就听牌、可以双立直，手里的暗刻在牌山最后一个转角前开暗杠，杠里四张都是里宝牌，下一张就是和了牌。`,
  priority: PRIORITY.awai,

  // 技能开着就扣能量、展开安全圈：另外三家的配牌至少 safeShanten 向听
  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    if (!g.manual[seat] && !gs.on && gs.energy! >= AWAI.onCost) {
      // 电脑：落后或者平分就开；领先时一般不开
      const me = g.players[seat].score;
      const leading = g.players.every((p) => p.seat === seat || p.score < me);
      if (!leading || g.rng.chance(AWAI.aiLeadChance)) gs.on = true;
    }
    if (gs.on && gs.energy! < AWAI.onCost) gs.on = false;
    if (!gs.on) return;
    gs.energy! -= AWAI.onCost;
    stateOf(g, seat).circle = true;
    return [0, 1, 2, 3]
      .filter((s) => s !== seat)
      .map((s) => ({ seat, ability: 'awai', text: '绝对安全圈', target: s, bad: (hand: TileId[]) => Math.max(0, AWAI.safeShanten - shanten(toCounts(hand))) }));
  },

  skill(g, seat) {
    const { energy, on } = awaiEnergy(g, seat);
    const meter = { value: energy, max: AWAI.energyMax };
    if (on) {
      const ok = energy >= AWAI.offCost;
      return { label: '关掉安全圈', note: ok ? `能量 -${AWAI.offCost}，下一局起不再展开` : '能量不够关掉', enabled: ok, meter, active: true };
    }
    const ok = energy >= AWAI.onCost;
    return { label: '开启安全圈', note: ok ? `下一局起每局开局 -${AWAI.onCost}` : '能量不够', enabled: ok, meter };
  },

  pressSkill(g, seat) {
    const gs = gameStateOf(g, seat);
    if (gs.on) {
      if (gs.energy! < AWAI.offCost) return;
      gs.energy! -= AWAI.offCost;
      gs.on = false;
    } else if (gs.energy! >= AWAI.onCost) gs.on = true;
  },

  beforeDeal(g, seat) {
    const w = g.wall;
    const st = stateOf(g, seat);
    if (!st.circle) return;
    const mine = g.dealIndices(seat);
    const mineSet = new Set(mine);
    // 双立直的配牌：先找一手满足别人规矩的（规矩只看牌种，所以拿每种牌里的一张代表来算）
    let plan: { kinds: Kind[]; kan: Kind } | null = null;
    if (g.rng.chance(AWAI.cornerKanChance)) {
      const avail = toCounts(w.live);
      const others = g.dealRules.filter((r) => r.target === seat && r.seat !== seat);
      plan = planHand(avail, g.rng, (kinds) => others.every((r) => r.bad(kinds.map((k) => k * 4 + 1)) === 0));
      // 无解时降级：不顾比她后动的人的规矩，换牌也一样
      if (!plan) plan = planHand(avail, g.rng, () => true);
    }
    if (plan) {
      const placed = placeHand(g, mine, plan.kinds) || g.dealFallback(seat, () => placeHand(g, mine, plan!.kinds));
      if (placed) {
        st.kanKind = plan.kan;
        const want = [...plan.kinds].sort((a, b) => a - b).join();
        g.addDealRule({ seat, ability: 'awai', text: '双立直配牌', target: seat, bad: (hand) => ([...hand].map(kindOf).sort((a, b) => a - b).join() === want ? 0 : 1) });
        // 第四张放在转角前她摸的位置，锁住
        const slot = cornerSlot(g, seat);
        const kan = plan.kan;
        const isKan = (t: TileId) => kindOf(t) === kan;
        if (slot !== null && (w.bringToLive(slot, isKan, g.rng, (j) => j >= 52) || w.bringToLive(slot, isKan, g.rng, (j) => !mineSet.has(j)))) {
          st.corner = w.live[slot];
          w.locked.add(st.corner, 'awai');
        }
        // 杠里要用的指示牌先藏在后面的里宝牌里：开局时牌山里一定还有，等到转角时可能早被摸光了
        const indicator = (t: TileId) => doraFromIndicator(kindOf(t)) === kan;
        w.bringToUra(1, indicator, g.rng, (j) => j >= 52);
        w.bringToUra(2, indicator, g.rng, (j) => j >= 52);
      }
    }
    // 别人的配牌：把有用的牌换成没用的，换到发完牌以后的牌山里。别人的规矩（比如霞绝掉的花色）不能变差；
    // 这样打不到 safeShanten 时降级，不顾比她后动的人的规矩
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      const idx = g.dealIndices(s);
      if (!worsen(g, idx)) g.dealFallback(seat, () => worsen(g, idx));
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
