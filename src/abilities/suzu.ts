import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { Kind, TileId, isHonor, kindOf, toCounts } from '../engine/tiles';
import { seatCost } from './costs';
import type { Ability } from './types';

// 上重漫（姬松）：爆发。
// 看不见的计数器：每一局开始时（同一局的连庄、X 本场不算），桌上每有一位 3 费以上的对手就加一。
// 计数器超过 9 时进入“爆发”，计数器清零。爆发一直持续到这一场结束：
// - 配牌偏向 6–9 的数牌（万、筒、索）：换掉几张别的牌，不让向听变差
// - 摸牌偏向 6–9 的数牌：下一张不是进张就常换成 6–9；是进张也可能换成 6–9 的进张
// 爆发中和一次以后倾向减弱（还在爆发），直到计数器再到 5（爆发过以后门槛降到 5）：恢复全力，计数器再清零。
// 计数器照常走，被封印的局也走（她只是那一局使不出来）。
export const SUZU = {
  strongCost: 3, // 几费以上算强敌
  trigger: 9, // 计数器超过这个数爆发
  retrigger: 5, // 爆发过以后，计数器到这个数就再触发（恢复全力）
  dealSwaps: 4, // 配牌最多换几张（全力）
  dealSwapsWeak: 2, // 和过一次以后
  draw: 0.45, // 摸牌换成 6–9 的概率（全力）
  drawWeak: 0.2,
};

// 6–9 的数牌
export const isHigh = (k: Kind): boolean => !isHonor(k) && k % 9 >= 5;

interface SuzuGameState {
  counter?: number;
  burst?: boolean;
  weak?: boolean; // 爆发中和过一次，倾向减弱
  bursts?: number[]; // 第几局爆发（或者恢复全力）
  slot?: number; // 上一局是哪一局（东一、东二……），连庄不算新的一局
  rounds?: number; // 看过几次 roundStart
  seen?: number; // g.events 里看到哪了
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as SuzuGameState;

// 桌上 3 费以上的对手有几个
export function suzuStrong(g: Game, seat: number): number {
  return [0, 1, 2, 3].filter((s) => s !== seat && seatCost(g, s) >= SUZU.strongCost).length;
}

// 新的一局开始：不是连庄就加上强敌数，超过 9 就爆发、清零；爆发过以后到 5 就恢复全力、清零
function startSlot(g: Game, seat: number, gs: SuzuGameState, slot: number, round: number): void {
  const fresh = gs.slot !== slot;
  gs.slot = slot;
  if (!fresh) return;
  gs.counter = (gs.counter ?? 0) + suzuStrong(g, seat);
  if (gs.burst ? gs.counter >= SUZU.retrigger : gs.counter > SUZU.trigger) {
    gs.counter = 0;
    gs.burst = true;
    gs.weak = false;
    (gs.bursts ??= []).push(round);
  }
}

// 把打完、开过的局算进去。发牌时这一局的 roundStart 还没出，先按现在的局算上（不记进缓存）
function sync(g: Game, seat: number): SuzuGameState {
  const gs = gameStateOf(g, seat);
  for (let i = gs.seen ?? 0; i < g.events.length; i++) {
    const e = g.events[i];
    if (e.type === 'roundStart') {
      gs.rounds = (gs.rounds ?? 0) + 1;
      startSlot(g, seat, gs, e.slot ?? -1, gs.rounds);
    } else if (e.type === 'roundEnd' && gs.burst && e.result.wins.some((w) => w.seat === seat)) gs.weak = true;
  }
  gs.seen = g.events.length;
  if ((gs.rounds ?? 0) < g.round) {
    const now = { ...gs, bursts: [...(gs.bursts ?? [])] };
    startSlot(g, seat, now, g.roundWind * 4 + g.roundNumber, g.round);
    return now;
  }
  return gs;
}

// 这一局的状态：'full' 全力爆发，'weak' 和过以后减弱，null 没爆发
export function suzuBurst(g: Game, seat: number): 'full' | 'weak' | null {
  const gs = sync(g, seat);
  return gs.burst ? (gs.weak ? 'weak' : 'full') : null;
}

// 计数器现在是几（看不见，测试用）
export function suzuCounter(g: Game, seat: number): number {
  return sync(g, seat).counter ?? 0;
}

// 这一局刚爆发（或者恢复全力）
const burstNow = (g: Game, seat: number): boolean => (sync(g, seat).bursts ?? []).includes(g.round);

export const suzuAbility: Ability = {
  id: 'suzu',
  name: '爆发',
  description: `被动。看不见的计数器：每一局（连庄不算）桌上每有一位 ${SUZU.strongCost} 费以上的对手加一，超过 ${SUZU.trigger} 进入爆发、计数器清零。爆发一直持续：配牌、摸牌偏向 6–9 的数牌；和一次以后倾向减弱，爆发过以后计数器到 ${SUZU.retrigger} 就恢复全力、再清零。`,

  // 配牌：把不是 6–9 的牌换成 6–9 的数牌，向听不变差
  beforeDeal(g, seat) {
    const state = suzuBurst(g, seat);
    if (!state) return;
    const max = state === 'full' ? SUZU.dealSwaps : SUZU.dealSwapsWeak;
    const w = g.wall;
    const mine = g.dealIndices(seat);
    let swaps = 0;
    for (const i of g.rng.shuffle([...mine])) {
      if (swaps >= max) break;
      const k = kindOf(w.live[i]);
      if (isHigh(k)) continue;
      const counts = toCounts(mine.map((j) => w.live[j]));
      const cur = shanten(counts, 0);
      counts[k]--;
      const ok = (t: TileId) => {
        if (!isHigh(kindOf(t))) return false;
        counts[kindOf(t)]++;
        const sh = shanten(counts, 0);
        counts[kindOf(t)]--;
        return sh <= cur;
      };
      if (w.bringToLive(i, ok, g.rng, (j) => j >= 52)) swaps++;
    }
  },

  onRoundStart(g, seat) {
    if (burstNow(g, seat)) g.emit({ type: 'ability', seat, ability: 'suzu', text: '爆发' });
  },

  // 摸牌：下一张不是进张就换成 6–9 的数牌（先挑进张）；是进张但不是 6–9，就换成 6–9 的进张
  beforeDraw(g, seat, rinshan) {
    const state = suzuBurst(g, seat);
    if (rinshan || !state) return;
    const w = g.wall;
    if (isHigh(kindOf(w.live[0]))) return;
    if (!g.rng.chance(state === 'full' ? SUZU.draw : SUZU.drawWeak)) return;
    const p = g.players[seat];
    const counts = toCounts(p.hand);
    const sh = shanten(counts, p.melds.length);
    const useful = (t: TileId) => {
      counts[kindOf(t)]++;
      const after = shanten(counts, p.melds.length);
      counts[kindOf(t)]--;
      return after < sh;
    };
    if (w.bringToLive(0, (t) => isHigh(kindOf(t)) && useful(t), g.rng)) return;
    if (!useful(w.live[0])) w.bringToLive(0, (t) => isHigh(kindOf(t)), g.rng);
  },

  skill(g, seat) {
    const state = suzuBurst(g, seat);
    const note = state === 'full' ? '爆发：配牌、摸牌偏向 6–9' : state === 'weak' ? '爆发（和过一次，倾向减弱）' : '还没爆发';
    return { label: '', note, enabled: false, active: !!state };
  },

  badge(g, seat) {
    const state = suzuBurst(g, seat);
    return state === 'full' ? '爆发' : state === 'weak' ? '爆发·弱' : null;
  },

  insight(g, seat) {
    const state = suzuBurst(g, seat);
    return [state === 'full' ? '爆发中：配牌、摸牌偏向 6–9 的数牌' : state === 'weak' ? '爆发中，和过一次，倾向减弱' : '还没爆发'];
  },
};
