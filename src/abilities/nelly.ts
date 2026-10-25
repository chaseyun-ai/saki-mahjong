import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, kindOf, toCounts } from '../engine/tiles';
import { isDoraTile } from './kuro';
import { PRIORITY, type Ability } from './types';

// 涅莉·薇萨拉兹（临海女子）：看得见牌局的流势。
// - 蓄浪（平时）：她的摸牌略差，电脑的涅莉以防守为主。这一局她没和牌，波涨一格；放铳再涨一格（吃的苦都是蓄力）
// - 乘浪（发牌前选）：花掉全部的波，接下来几局（每两格一局）她的摸牌大幅变好、宝牌优先，别人的进张有时被换走
// - 读流势：发牌前的界面写着这一局谁的配牌势头最好
// 电脑的涅莉：前面蓄浪，波快满了或者到了最后一局再乘浪，在最后几局连续大和
export const NELLY = {
  waveMax: 6,
  minRide: 2, // 至少几格才能乘浪
  storeBad: 0.2, // 蓄浪时，摸到进张被换走的概率
  rideGood: 0.5, // 乘浪时，摸牌换成进张的概率
  rideDeny: 0.2, // 乘浪时，别人的进张被换走的概率
  aiRideAt: 4, // 电脑的涅莉攒到几格就乘浪
};

interface NellyGameState {
  wave?: number;
  ride?: number; // 乘浪还剩几局（包括这一局）
  seen?: number; // g.events 里看到哪了
  want?: boolean; // 玩家这一局选了乘浪
}
interface NellyState {
  riding?: boolean; // 这一局在乘浪
  first?: boolean; // 这一局刚开始乘浪
  flow?: number; // 读流势：这一局配牌势头最好的座位
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as NellyGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as NellyState;

export function nellyWave(g: Game, seat: number): number {
  return gameStateOf(g, seat).wave ?? 0;
}

// 这一局在不在乘浪
export function nellyRiding(g: Game, seat: number): boolean {
  return !!stateOf(g, seat).riding;
}

// 乘浪能持续几局
export const rideRounds = (wave: number) => Math.ceil(wave / 2);

// 上一局的结算：没和牌涨一格，放铳再涨一格；乘浪的局数用掉一局。
// 发牌前界面和配牌都会来算，同一局只算一次
function settle(g: Game, seat: number): void {
  const gs = gameStateOf(g, seat);
  const from = gs.seen ?? 0;
  gs.seen = g.events.length;
  for (let i = g.events.length - 1; i >= from; i--) {
    const e = g.events[i];
    if (e.type !== 'roundEnd') continue;
    if (gs.ride) gs.ride--;
    else {
      const won = e.result.wins.some((w) => w.seat === seat);
      const dealtIn = e.result.wins.some((w) => w.from === seat);
      gs.wave = Math.min(NELLY.waveMax, (gs.wave ?? 0) + (won ? 0 : 1) + (dealtIn ? 1 : 0));
    }
    return;
  }
}

// 读流势：这一局谁的配牌最好（按洗好的牌、没人动过时的向听算；配牌前调用）
export function nellyFlow(g: Game): number {
  let best = 0;
  let bestSh = 99;
  for (let s = 0; s < 4; s++) {
    const sh = shanten(toCounts(g.dealHand(s)), 0);
    if (sh < bestSh) {
      best = s;
      bestSh = sh;
    }
  }
  return best;
}

// 电脑的涅莉要不要乘浪
function aiRide(g: Game, wave: number): boolean {
  if (wave >= NELLY.aiRideAt) return true;
  // 最后一局（东风战的东 4 局以后）有波就乘
  return wave >= NELLY.minRide && (g.roundWind > 0 || g.roundNumber === 3);
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

export const nellyAbility: Ability = {
  id: 'nelly',
  name: '流势',
  description: `看得见牌局的流势。平时蓄浪：摸牌略差，没和牌的局波涨一格，放铳再涨一格（最多 ${NELLY.waveMax} 格）。发牌前可以乘浪：花掉全部的波，之后几局（每两格一局）摸牌大幅变好、宝牌优先，别人的进张有时被换走。`,
  priority: PRIORITY.nelly,

  dealRules(g, seat) {
    settle(g, seat);
    const gs = gameStateOf(g, seat);
    const st = stateOf(g, seat);
    st.flow = nellyFlow(g);
    const wave = gs.wave ?? 0;
    if (!gs.ride && wave >= NELLY.minRide && (g.manual[seat] ? gs.want : aiRide(g, wave))) {
      gs.ride = rideRounds(wave);
      gs.wave = 0;
      st.first = true;
    }
    gs.want = false;
    st.riding = !!gs.ride;
  },

  onRoundStart(g, seat) {
    if (stateOf(g, seat).first) g.emit({ type: 'ability', seat, ability: 'nelly', text: '乘浪' });
  },

  // 乘浪：别人的进张有时被换走
  beforeAnyDraw(g, seat, drawer, rinshan) {
    if (drawer === seat || rinshan || !nellyRiding(g, seat) || !g.rng.chance(NELLY.rideDeny)) return;
    return { seat, ability: 'nelly', text: '流势', deny: useful(g, drawer) };
  },

  beforeDraw(g, seat, rinshan) {
    if (rinshan) return;
    const w = g.wall;
    const good = useful(g, seat);
    if (nellyRiding(g, seat)) {
      if (!g.rng.chance(NELLY.rideGood)) return;
      if (good(w.live[0]) && isDoraTile(g, w.live[0])) return;
      if (!w.bringToLive(0, (t) => good(t) && isDoraTile(g, t), g.rng) && !good(w.live[0])) w.bringToLive(0, good, g.rng);
      return;
    }
    // 蓄浪：进张有时被换走
    if (good(w.live[0]) && g.rng.chance(NELLY.storeBad)) w.bringToLive(0, (t) => !good(t), g.rng);
  },

  preDeal(g, seat) {
    settle(g, seat);
    const gs = gameStateOf(g, seat);
    if (gs.ride) return [];
    const wave = gs.wave ?? 0;
    const ok = wave >= NELLY.minRide;
    return [
      {
        id: 'ride',
        name: '乘浪',
        desc: `现在波 ${wave} 格，乘浪可以持续 ${rideRounds(wave)} 局：摸牌大幅变好、宝牌优先，别人的进张有时被换走`,
        enabled: ok,
        picked: false,
        note: ok ? undefined : `波不到 ${NELLY.minRide} 格`,
      },
    ];
  },

  setPreDeal(g, seat, picked) {
    gameStateOf(g, seat).want = picked.includes('ride');
  },

  skill(g, seat) {
    const gs = gameStateOf(g, seat);
    const flow = stateOf(g, seat).flow;
    const read = flow === undefined ? '' : `；这一局势头最好的是${flow === seat ? '自己' : g.players[flow].name}`;
    const note = (nellyRiding(g, seat) ? `乘浪中，还剩 ${gs.ride} 局` : '蓄浪中：没和牌的局波涨一格') + read;
    return { label: '', note, enabled: false, meter: { value: nellyWave(g, seat), max: NELLY.waveMax }, active: nellyRiding(g, seat) };
  },

  badge(g, seat) {
    if (nellyRiding(g, seat)) return '乘浪';
    const wave = nellyWave(g, seat);
    return wave ? `波${wave}` : null;
  },

  insight(g, seat) {
    const gs = gameStateOf(g, seat);
    return [nellyRiding(g, seat) ? `乘浪中，还剩 ${gs.ride} 局：摸牌很顺，别人的进张有时被换走` : `蓄浪中，波 ${nellyWave(g, seat)}/${NELLY.waveMax} 格`];
  },
};
