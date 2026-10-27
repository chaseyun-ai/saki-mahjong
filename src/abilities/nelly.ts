import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, kindOf, suitOf, toCounts } from '../engine/tiles';
import { PRIORITY, type Ability, type PreDealOption } from './types';

// 涅莉·薇萨拉兹（临海女子）：分配运势的人。家里穷，打得亮眼才拉得到赞助，所以她要和就和三倍满这种大牌。
// - 分配运势（开场）：给这一场的每一局（东风战东 1–4，团体赛东 1–南 4）各分一个运势值，加起来必须是 0。
//   流局重打的局沿用同一局的值；她在这一局和过一次，这一局的运势就用完了，连庄的局变成 0；南入以后多出来的局是 0。运势分三档：
//   · 负（蓄势）：她的进张有时被换走，电脑的涅莉这几局以防守为主
//   · +1 到 +3（顺流）：摸牌常换成进张，别人的进张偶尔被换走，可以用七姐妹
//   · +4 以上（宣言局）：这一局是她的。配牌偏向一种花色，摸牌几乎都是进张（先补成那门花色，牌够大再来和了牌），
//     别人的进张大多被换走，别人要自摸时七姐妹自动封住（不扣次数、不扣运势）。
//     宣言不公开：别人看不到她的运势，不知道她哪一局动手。照不受影响
// - 七姐妹：一场 7 次。别人要自摸时（下一张就是他的和了牌）用掉一次：那张和了牌被换走，这一局那家也和不了了（自摸、荣和都不行）。
//   顺流的局里用，每用一次这一局的运势减 1（七姐妹和摸牌变好是同一份运势）
// 电脑的涅莉：挑几局押上全部运势（8 局押 3 局，都是宣言局；4 局押 2 局），其余的局压到最低。
// 押哪几局看同桌：别人能力最强的局（优希的东场、尧深的收获局、爽最后两局）不去抢，自己坐庄的局优先。
// 负运势的局不做危险进攻：有人立直、副露逼近时不打危险牌、不立直。玩家操作时开场自己分，七姐妹用技能按钮开关（默认开着）
export const NELLY = {
  min: -3, // 一局最少
  max: 7, // 一局最多
  goodPer: 0.15, // 运势每 +1，摸牌换成进张的概率加多少
  goodMax: 0.75,
  denyPer: 0.03, // 运势每 +1，别人的进张被换走的概率加多少
  badPer: 0.1, // 运势每 -1，她的进张被换走的概率加多少
  sisters: 7,
  declare: 4, // 运势到这个数就是宣言局
  declDeal: 0.45, // 宣言局配牌里别的花色换成那门花色的概率（+4），每多 1 加 declDealPer
  declDealPer: 0.1,
  declGood: 0.7, // 宣言局摸牌换成有用的牌的概率
  declDeny: 0.3, // 宣言局别人进张被换走的概率（+4），每多 1 加 declDenyPer
  declDenyPer: 0.05,
  declMin: 12000, // 宣言局里电脑的涅莉的牌不到这么大（默听算）就先不和、不立直，接着往大里做
  declLate: 18, // 牌山剩这么多以下就有什么和什么
  badRisk: 4, // 负运势的局：要打的牌危险度到这个数（不是现物、筋、见了的字牌）就不打，弃和
};

interface NellyGameState {
  luck?: number[]; // 每一局（按东 1、东 2……排）的运势，开场分好
  plan?: number[]; // 玩家在发牌前界面分的
  sisters?: number; // 七姐妹还剩几次
  off?: boolean; // 玩家把七姐妹关了
  used?: number[]; // 每一局用掉的运势（七姐妹）
  spent?: boolean[]; // 她和过的局：这一局的运势用完了
  seen?: number; // g.events 里看到哪了
  cur?: number; // 看到的最后一个 roundStart 是第几局
}
interface NellyState {
  blocked?: number[]; // 这一局被七姐妹封住、和不了的人
  suit?: number; // 宣言局做的花色
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
export const nellySlots = (g: Game) => (g.fullHanchan ? 8 : 4);
const SLOT_NAMES = ['东1', '东2', '东3', '东4', '南1', '南2', '南3', '南4'];

// 第几局（东 1 是 0）
const slotOf = (g: Game) => g.roundWind * 4 + g.roundNumber;

// 别人能力最强的局（按局的序号，8 局或 4 局）：这几局别人也要和，涅莉不去抢
const HOT: Record<string, (slots: number) => number[]> = {
  yuuki: (n) => (n === 8 ? [0, 1, 2, 3, 7] : [0, 1, 2, 3]), // 东场；最后一局有塔可饼
  takami: (n) => [n - 1], // 收获的局
  sawaya: (n) => [n - 2, n - 1], // 最后两局把云和神威用掉
};

// 电脑的分法：挑 bet 局押上运势（8 局押 3 局、4 局押 2 局），其余的局都是最低（NELLY.min）。
// 挑法：自己坐庄的局 +2，别人能力最强的局每有一个人 -3，同分挑靠后的局。押的局里坐庄那局多给（庄家和了是 1.5 倍）。
// dealerRound 是她每圈第几局坐庄；contested 是别人能力最强的局（一个人一次）
export function nellyAiPlan(slots: number, dealerRound = slots / 4 - 1, contested: number[] = []): number[] {
  const bet = slots === 8 ? 3 : 2;
  const score = (i: number) => (i % 4 === dealerRound ? 2 : 0) - 3 * contested.filter((c) => c === i).length + i * 0.1;
  const picks = Array.from({ length: slots }, (_, i) => i)
    .sort((a, b) => score(b) - score(a))
    .slice(0, bet);
  const plan = new Array<number>(slots).fill(NELLY.min);
  let pot = -NELLY.min * (slots - bet);
  // 坐庄那局一定是宣言局，其余押的局尽量也是；从靠后的局往前分
  const dealerSlot = picks.filter((i) => i % 4 === dealerRound).sort((a, b) => b - a)[0];
  if (dealerSlot !== undefined) {
    plan[dealerSlot] = Math.min(NELLY.max, Math.max(NELLY.declare, pot - NELLY.declare * (bet - 1)));
    pot -= plan[dealerSlot];
  }
  const rest = picks.filter((i) => i !== dealerSlot).sort((a, b) => b - a);
  rest.forEach((i, n) => {
    plan[i] = Math.min(NELLY.max, Math.max(NELLY.declare, Math.floor(pot / (rest.length - n))), pot);
    pot -= plan[i];
  });
  return plan;
}

const aiPlan = (g: Game, seat: number) => {
  const n = nellySlots(g);
  const contested = [0, 1, 2, 3].filter((s) => s !== seat).flatMap((s) => HOT[g.abilities[s]?.id ?? '']?.(n) ?? []);
  return nellyAiPlan(n, g.dealerRound(seat), contested);
};

// 分法合不合规矩：不合给原因
export function nellyPlanError(plan: number[]): string | null {
  if (plan.some((v) => v < NELLY.min || v > NELLY.max)) return `每一局在 ${NELLY.min} 到 +${NELLY.max} 之间`;
  const sum = plan.reduce((a, b) => a + b, 0);
  return sum === 0 ? null : `加起来是 ${sum > 0 ? '+' : ''}${sum}，要正好是 0`;
}

// 她和过的局（看到哪算到哪）：和过一次，这一局的运势就用完了
function spentSlots(g: Game, seat: number): boolean[] {
  const gs = gameStateOf(g, seat);
  gs.spent ??= [];
  for (let i = gs.seen ?? 0; i < g.events.length; i++) {
    const e = g.events[i];
    if (e.type === 'roundStart' && e.slot !== undefined) gs.cur = e.slot;
    if (e.type === 'roundEnd' && gs.cur !== undefined && e.result.wins.some((w) => w.seat === seat)) gs.spent[gs.cur] = true;
  }
  gs.seen = g.events.length;
  return gs.spent;
}

// 这一局的运势（用过七姐妹的已经扣掉；和过一次就是 0）
export function nellyLuck(g: Game, seat: number): number {
  const gs = gameStateOf(g, seat);
  const i = slotOf(g);
  if (spentSlots(g, seat)[i]) return 0;
  return (gs.luck?.[i] ?? 0) - (gs.used![i] ?? 0);
}

export function nellySisters(g: Game, seat: number): number {
  return gameStateOf(g, seat).sisters!;
}

// 被七姐妹封住、这一局和不了的人
export function nellyBlocked(g: Game, seat: number): number[] {
  return stateOf(g, seat).blocked!;
}

// 这一局是不是宣言局
export function nellyDeclared(g: Game, seat: number): boolean {
  return nellyLuck(g, seat) >= NELLY.declare;
}

// 宣言局做的花色（不是宣言局是 null）
export function nellySuit(g: Game, seat: number): number | null {
  return nellyDeclared(g, seat) ? stateOf(g, seat).suit ?? null : null;
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

const inSuit = (suit: number) => (t: TileId) => kindOf(t) < 27 && suitOf(kindOf(t)) === suit;

export const nellyAbility: Ability = {
  id: 'nelly',
  name: '运势·七姐妹',
  description: `开场给这一场的每一局分运势（每局 ${NELLY.min} 到 +${NELLY.max}，加起来是 0）：负的局摸牌差；+1 到 +3 摸牌顺；+${NELLY.declare} 以上是宣言局，这一局是她的：配牌偏向一种花色、摸牌几乎都是进张、别人的进张大多被换走。她在一局里和过一次，这一局的运势就用完了（连庄的局是 0）。运势只有她自己知道。七姐妹一场 ${NELLY.sisters} 次：别人要自摸时封住他，这一局他和不了；顺流的局每用一次运势减 1，宣言局里自动发动、不扣次数。`,
  priority: PRIORITY.nelly,

  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    if (gs.luck) return;
    gs.luck = g.manual[seat] && gs.plan && !nellyPlanError(gs.plan) ? gs.plan : aiPlan(g, seat);
  },

  // 宣言局：选她配牌里最多的花色，别的花色的数牌换成这门花色；单张字牌也换掉（对子留着做混一色）
  beforeDeal(g, seat) {
    const v = nellyLuck(g, seat);
    const st = stateOf(g, seat);
    if (v < NELLY.declare) return;
    const per = [0, 0, 0];
    for (const t of g.dealHand(seat)) if (kindOf(t) < 27) per[suitOf(kindOf(t))]++;
    const suit = per.indexOf(Math.max(...per));
    st.suit = suit;
    const pred = inSuit(suit);
    const chance = Math.min(1, NELLY.declDeal + NELLY.declDealPer * (v - NELLY.declare));
    const hand = g.dealHand(seat).map(kindOf);
    for (const i of g.dealIndices(seat)) {
      const k = kindOf(g.wall.live[i]);
      if (pred(g.wall.live[i])) continue;
      if (k >= 27 && hand.filter((x) => x === k).length >= 2) continue;
      if (!g.rng.chance(chance)) continue;
      const swap = () => g.wall.bringToLive(i, pred, g.rng, (j) => j >= 52);
      if (!swap()) g.dealFallback(seat, swap);
    }
  },

  onRoundStart(g, seat) {
    const gs = gameStateOf(g, seat);
    if (slotOf(g) === 0 && g.honba === 0) g.emit({ type: 'ability', seat, ability: 'nelly', text: '分配运势' });
    // 运势只有她自己知道：电脑的涅莉不报
    const v = nellyLuck(g, seat);
    if (!g.manual[seat] || v <= 0 || !gs.luck) return;
    g.emit({ type: 'ability', seat, ability: 'nelly', text: v >= NELLY.declare ? '宣言' : `运势 ${fmt(v)}` });
  },

  // 别人摸牌：七姐妹（下一张就是他的和了牌时封住他）；运势为正时他的进张有时被换走（宣言局大多被换走）
  beforeAnyDraw(g, seat, drawer, rinshan) {
    if (drawer === seat) return;
    const gs = gameStateOf(g, seat);
    const st = stateOf(g, seat);
    const v = nellyLuck(g, seat);
    const declared = v >= NELLY.declare;
    const next = rinshan ? g.wall.rinshan[0] : g.wall.live[0];
    const can = declared || (gs.sisters! > 0 && !gs.off);
    const p = g.players[drawer];
    // 摸了 t 就和了（按现在的手牌算，摸进来以后再问也一样）
    const base = toCounts(p.hand);
    const melds = p.melds.length;
    const wins = (t: TileId) => {
      base[kindOf(t)]++;
      const done = shanten(base, melds) < 0;
      base[kindOf(t)]--;
      return done;
    };
    // 七姐妹：那张和了牌换走（他摸到的是别的牌），这一局他也和不了了。换不走就不发动。
    // 再定一条规矩，摸牌的人自己的能力也不能把和了牌换回来
    if (v > 0 && can && next !== undefined && g.binds(seat, drawer) && !st.blocked!.includes(drawer) && g.canWin(drawer) && wins(next)) {
      const w = g.wall;
      const swapped = rinshan ? w.bringToRinshan((t) => !wins(t), g.rng) : w.bringToLive(0, (t) => !wins(t), g.rng);
      if (swapped) {
        if (!declared) {
          gs.sisters!--;
          gs.used![slotOf(g)] = (gs.used![slotOf(g)] ?? 0) + 1;
        }
        st.blocked!.push(drawer);
        // 不写 target：七姐妹要放切入（写了 target 的是悄悄换牌）
        g.emit({ type: 'ability', seat, ability: 'nelly', text: '七姐妹' });
        return { seat, ability: 'nelly', text: '七姐妹', deny: wins };
      }
    }
    if (rinshan || v <= 0) return;
    const deny = declared ? NELLY.declDeny + NELLY.declDenyPer * (v - NELLY.declare) : NELLY.denyPer * v;
    if (!g.rng.chance(deny)) return;
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
    if (v >= NELLY.declare) {
      if (!g.rng.chance(NELLY.declGood)) return;
      const suit = stateOf(g, seat).suit;
      const pred = suit === undefined ? () => true : inSuit(suit);
      const p = g.players[seat];
      const sh = shanten(toCounts(p.hand), p.melds.length);
      // 听牌了但牌还不够大（手里还有别的花色）：先来那门花色的牌，把别的花色换掉；够大了再来和了牌
      const off = p.hand.some((t) => kindOf(t) < 27 && !pred(t));
      if (sh === 0 && off) w.bringToLive(0, (t) => pred(t) && !good(t), g.rng) || w.bringToLive(0, good, g.rng);
      else w.bringToLive(0, (t) => good(t) && (pred(t) || kindOf(t) >= 27), g.rng) || w.bringToLive(0, good, g.rng);
    } else if (v > 0) {
      if (g.rng.chance(Math.min(NELLY.goodMax, NELLY.goodPer * v)) && !good(w.live[0])) w.bringToLive(0, good, g.rng);
    } else if (v < 0 && good(w.live[0]) && g.rng.chance(NELLY.badPer * -v)) w.bringToLive(0, (t) => !good(t), g.rng);
  },

  // 开场分运势
  preDeal(g, seat): PreDealOption[] {
    const gs = gameStateOf(g, seat);
    if (gs.luck) return [];
    const plan = gs.plan ?? aiPlan(g, seat);
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
    const note =
      v >= NELLY.declare
        ? `宣言局（运势 ${fmt(v)}）：七姐妹自动发动、不扣次数；还剩 ${gs.sisters} 次`
        : `这一局运势 ${fmt(v)}；七姐妹还剩 ${gs.sisters} 次${v > 0 ? '' : '（运势为正的局才能用）'}`;
    return { label, note, enabled: gs.sisters! > 0, meter: { value: gs.sisters!, max: NELLY.sisters }, active: v > 0 };
  },

  pressSkill(g, seat) {
    const gs = gameStateOf(g, seat);
    gs.off = !gs.off;
  },

  // 运势只有她自己知道：电脑的涅莉不挂
  badge(g, seat) {
    if (!g.manual[seat]) return null;
    const v = nellyLuck(g, seat);
    return v >= NELLY.declare ? '宣言' : v ? `运${fmt(v)}` : null;
  },

  // 照魔镜看得到
  insight(g, seat) {
    const gs = gameStateOf(g, seat);
    const spent = spentSlots(g, seat);
    const plan = gs.luck ? gs.luck.map((v, i) => `${SLOT_NAMES[i]} ${spent[i] ? '用完' : fmt(v - (gs.used![i] ?? 0))}`).join('，') : '还没分';
    return [`运势：${plan}`, nellyDeclared(g, seat) ? '这一局是宣言局' : '', `七姐妹还剩 ${gs.sisters} 次`].filter(Boolean);
  },
};
