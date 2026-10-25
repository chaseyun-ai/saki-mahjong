import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, kindOf, toCounts } from '../engine/tiles';
import { PRIORITY, type Ability, type PreDealOption } from './types';

// 涅莉·薇萨拉兹（临海女子）：分配运势的人。
// - 分配运势（开场）：给这一场的每一局（东风战东 1–4，团体赛东 1–南 4）各分一个运势值，加起来必须是 0。
//   连庄、流局重打的局沿用同一局的值；南入以后多出来的局是 0。
//   运势为正：摸牌常换成进张，越大越常，别人的进张也偶尔被换走；运势为负：她的进张有时被换走，电脑的涅莉这几局以防守为主
// - 七姐妹：一场 7 次。别人要自摸时（下一张就是他的和了牌）用掉一次，这一局那家就和不了了（自摸、荣和都不行）。
//   只能在她运势为正的局里用，每用一次这一局的运势减 1（七姐妹和摸牌变好是同一份运势）。照不受影响
// 电脑的涅莉：前面的局负、最后几局正；七姐妹在运势为正时见到就用。玩家操作时开场自己分，七姐妹用技能按钮开关（默认开着）
export const NELLY = {
  min: -3, // 一局最少
  max: 6, // 一局最多
  goodPer: 0.15, // 运势每 +1，摸牌换成进张的概率加多少
  goodMax: 0.75,
  denyPer: 0.03, // 运势每 +1，别人的进张被换走的概率加多少
  badPer: 0.06, // 运势每 -1，她的进张被换走的概率加多少
  sisters: 7,
};

interface NellyGameState {
  luck?: number[]; // 每一局（按东 1、东 2……排）的运势，开场分好
  plan?: number[]; // 玩家在发牌前界面分的
  sisters?: number; // 七姐妹还剩几次
  off?: boolean; // 玩家把七姐妹关了
  used?: number[]; // 每一局用掉的运势（七姐妹）
}
interface NellyState {
  blocked?: number[]; // 这一局被七姐妹封住、和不了的人
}

const gameStateOf = (g: Game, seat: number) => {
  const gs = g.abilityGameState[seat] as NellyGameState;
  gs.sisters ??= NELLY.sisters;
  gs.used ??= [];
  return gs;
};
const stateOf = (g: Game, seat: number) => {
  const st = g.abilityState[seat] as NellyState;
  st.blocked ??= [];
  return st;
};

// 这一场有几局可以分（东风战 4 局，团体赛 8 局）
export const nellySlots = (g: Game) => (g.format === 'team' ? 8 : 4);
const SLOT_NAMES = ['东1', '东2', '东3', '东4', '南1', '南2', '南3', '南4'];

// 第几局（东 1 是 0）
const slotOf = (g: Game) => g.roundWind * 4 + g.roundNumber;

// 电脑的分法：前面的局都是 -1，攒下来的分给最后几局（东风战最后一局，团体赛南 3、南 4）
export function nellyAiPlan(slots: number): number[] {
  const late = Math.max(1, slots / 4);
  const plan = new Array<number>(slots).fill(-1);
  const pool = slots - late;
  for (let i = 0; i < late; i++) plan[slots - late + i] = Math.floor(pool / late) + (i < pool % late ? 1 : 0);
  return plan;
}

// 分法合不合规矩：不合给原因
export function nellyPlanError(plan: number[]): string | null {
  if (plan.some((v) => v < NELLY.min || v > NELLY.max)) return `每一局在 ${NELLY.min} 到 +${NELLY.max} 之间`;
  const sum = plan.reduce((a, b) => a + b, 0);
  return sum === 0 ? null : `加起来是 ${sum > 0 ? '+' : ''}${sum}，要正好是 0`;
}

// 这一局的运势（用过七姐妹的已经扣掉）
export function nellyLuck(g: Game, seat: number): number {
  const gs = gameStateOf(g, seat);
  const i = slotOf(g);
  return (gs.luck?.[i] ?? 0) - (gs.used![i] ?? 0);
}

export function nellySisters(g: Game, seat: number): number {
  return gameStateOf(g, seat).sisters!;
}

// 被七姐妹封住、这一局和不了的人
export function nellyBlocked(g: Game, seat: number): number[] {
  return stateOf(g, seat).blocked!;
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

const fmt = (v: number) => (v > 0 ? `+${v}` : `${v}`);

export const nellyAbility: Ability = {
  id: 'nelly',
  name: '运势·七姐妹',
  description: `开场给这一场的每一局分运势（每局 ${NELLY.min} 到 +${NELLY.max}，加起来是 0）：运势正的局摸牌顺，负的局摸牌差。七姐妹一场 ${NELLY.sisters} 次：运势为正的局里，别人要自摸时封住他，这一局他和不了；每用一次这一局运势减 1。`,
  priority: PRIORITY.nelly,

  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    if (gs.luck) return;
    gs.luck = g.manual[seat] && gs.plan && !nellyPlanError(gs.plan) ? gs.plan : nellyAiPlan(nellySlots(g));
  },

  onRoundStart(g, seat) {
    const gs = gameStateOf(g, seat);
    if (slotOf(g) === 0 && g.honba === 0) g.emit({ type: 'ability', seat, ability: 'nelly', text: '分配运势' });
    const v = nellyLuck(g, seat);
    if (v > 0 && gs.luck) g.emit({ type: 'ability', seat, ability: 'nelly', text: `运势 ${fmt(v)}` });
  },

  // 别人摸牌：七姐妹（下一张就是他的和了牌时封住他）；运势为正时他的进张偶尔被换走
  beforeAnyDraw(g, seat, drawer, rinshan) {
    if (drawer === seat) return;
    const gs = gameStateOf(g, seat);
    const st = stateOf(g, seat);
    const v = nellyLuck(g, seat);
    const next = rinshan ? g.wall.rinshan[0] : g.wall.live[0];
    if (v > 0 && gs.sisters! > 0 && !gs.off && next !== undefined && g.binds(seat, drawer) && !st.blocked!.includes(drawer) && g.canWin(drawer)) {
      const p = g.players[drawer];
      const counts = toCounts(p.hand);
      counts[kindOf(next)]++;
      if (shanten(counts, p.melds.length) < 0) {
        gs.sisters!--;
        gs.used![slotOf(g)] = (gs.used![slotOf(g)] ?? 0) + 1;
        st.blocked!.push(drawer);
        g.emit({ type: 'ability', seat, ability: 'nelly', text: '七姐妹' });
      }
    }
    if (rinshan || v <= 0 || !g.rng.chance(NELLY.denyPer * v)) return;
    return { seat, ability: 'nelly', text: '运势', deny: useful(g, drawer) };
  },

  // 七姐妹封住的人这一局和不了
  forbidsWin(g, seat, target) {
    return nellyBlocked(g, seat).includes(target);
  },

  beforeDraw(g, seat, rinshan) {
    if (rinshan) return;
    const v = nellyLuck(g, seat);
    const w = g.wall;
    const good = useful(g, seat);
    if (v > 0) {
      if (g.rng.chance(Math.min(NELLY.goodMax, NELLY.goodPer * v)) && !good(w.live[0])) w.bringToLive(0, good, g.rng);
    } else if (v < 0 && good(w.live[0]) && g.rng.chance(NELLY.badPer * -v)) w.bringToLive(0, (t) => !good(t), g.rng);
  },

  // 开场分运势
  preDeal(g, seat): PreDealOption[] {
    const gs = gameStateOf(g, seat);
    if (gs.luck) return [];
    const plan = gs.plan ?? nellyAiPlan(nellySlots(g));
    return plan.map((v, i) => ({
      id: `luck${i}`,
      name: SLOT_NAMES[i],
      desc: '',
      enabled: true,
      picked: false,
      stepper: { value: v, min: NELLY.min, max: NELLY.max },
    }));
  },

  preDealCheck(_g, _seat, values) {
    return nellyPlanError(Object.keys(values).sort().map((k) => values[k]));
  },

  setPreDeal(g, seat, _picked, values) {
    if (!values) return;
    const plan = Object.keys(values)
      .filter((k) => k.startsWith('luck'))
      .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
      .map((k) => values[k]);
    gameStateOf(g, seat).plan = plan;
  },

  skill(g, seat) {
    const gs = gameStateOf(g, seat);
    const v = nellyLuck(g, seat);
    const label = gs.off ? '七姐妹：关' : '七姐妹：开';
    const note = `这一局运势 ${fmt(v)}；七姐妹还剩 ${gs.sisters} 次${v > 0 ? '' : '（运势为正的局才能用）'}`;
    return { label, note, enabled: gs.sisters! > 0, meter: { value: gs.sisters!, max: NELLY.sisters }, active: v > 0 };
  },

  pressSkill(g, seat) {
    const gs = gameStateOf(g, seat);
    gs.off = !gs.off;
  },

  badge(g, seat) {
    const v = nellyLuck(g, seat);
    return v ? `运${fmt(v)}` : null;
  },

  insight(g, seat) {
    const gs = gameStateOf(g, seat);
    const plan = gs.luck ? gs.luck.map((v, i) => `${SLOT_NAMES[i]} ${fmt(v - (gs.used![i] ?? 0))}`).join('，') : '还没分';
    return [`运势：${plan}`, `七姐妹还剩 ${gs.sisters} 次`];
  },
};
