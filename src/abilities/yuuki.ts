import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, kindOf, toCounts } from '../engine/tiles';
import type { Ability, PreDealOption } from './types';

// 片冈优希（清澄）：东风之神。东场开局速度飞快，尤其坐庄时；一到南场就没劲了，靠塔可饼补充能量。
// - 开局必定坐庄（她是起家）
// - 东场：配牌少一两向听，摸牌常换成进张；坐庄的局更强（配牌大多一向听，第一巡有机会双立直），别人对她配牌、摸牌的影响减半（Ability.resist）。
//   东风战（个人赛）整场都在东场，所以加成小一点
// - 南场：能力消失，有用的牌偶尔被换走
// - 塔可饼：一场一次，南场发牌前吃一个，这一局恢复东场的状态。电脑留到坐庄或落后时，最后一局一定吃
// 电脑的优希：东场全力进攻、不轻易弃和，南场以防守为主
export const YUUKI = {
  dealSwaps: 1, // 东场配牌最多换几张（团体赛）
  dealSwapsEast: 1, // 东风战
  dealerTarget: 1, // 坐庄时配牌换到几向听
  dealerSwaps: 2, // 坐庄时最多换几张
  good: 0.2, // 东场摸牌换成进张的概率（团体赛）
  goodEast: 0.1, // 东风战
  dealerGood: 0.3, // 坐庄时
  southBad: 0.12, // 南场有用的牌被换走的概率
  dealerResist: 0.5, // 东场坐庄时挡得住别人影响的比例
  tacoBehind: 8000, // 电脑落后多少吃塔可饼
};

interface YuukiGameState {
  tacoUsed?: boolean;
  tacoWant?: boolean; // 玩家这一局选了
}
interface YuukiState {
  taco?: boolean; // 这一局吃了塔可饼
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as YuukiGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as YuukiState;

// 这一局东风之神在不在：东场，或者南场吃了塔可饼
export function yuukiActive(g: Game, seat: number): boolean {
  return g.roundWind === 0 || !!stateOf(g, seat).taco;
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

// 电脑吃不吃塔可饼：南场坐庄、落后很多，或者最后一局
function aiTaco(g: Game, seat: number): boolean {
  const me = g.players[seat].score;
  const top = Math.max(...g.players.filter((p) => p.seat !== seat).map((p) => p.score));
  return seat === g.dealer || top - me >= YUUKI.tacoBehind || g.isLastRounds(1);
}

export const yuukiAbility: Ability = {
  id: 'yuuki',
  name: '东风之神',
  description: `开局必定坐庄。东场配牌少一两向听、摸牌常是进张，坐庄的局更强（配牌大多一向听，有机会双立直），别人对她配牌、摸牌的影响减半；南场没劲，有用的牌偶尔被换走。塔可饼一场一次：南场发牌前吃一个，这一局恢复东场的状态。`,
  firstDealer: true,

  // 东场坐庄：东风之神，别人对她配牌、摸牌的影响减半
  resist(g, seat) {
    return g.roundWind === 0 && seat === g.dealer ? YUUKI.dealerResist : 0;
  },

  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    const st = stateOf(g, seat);
    if (g.roundWind === 0 || gs.tacoUsed) return;
    if (g.manual[seat] ? gs.tacoWant : aiTaco(g, seat)) {
      gs.tacoUsed = true;
      gs.tacoWant = false;
      st.taco = true;
    }
  },

  // 东场：配牌换掉一两张没用的，换成能少一向听的牌（坐庄时换到一向听为止）
  beforeDeal(g, seat) {
    if (!yuukiActive(g, seat)) return;
    const dealer = seat === g.dealer;
    const max = dealer ? YUUKI.dealerSwaps : g.fullHanchan ? YUUKI.dealSwaps : YUUKI.dealSwapsEast;
    const w = g.wall;
    const mine = g.dealIndices(seat);
    for (let n = 0; n < max; n++) {
      const counts = toCounts(mine.map((i) => w.live[i]));
      const cur = shanten(counts, 0);
      if (dealer ? cur <= YUUKI.dealerTarget : n >= max) break;
      let done = false;
      for (const i of g.rng.shuffle([...mine])) {
        const k = kindOf(w.live[i]);
        counts[k]--;
        const better = (t: TileId) => {
          counts[kindOf(t)]++;
          const sh = shanten(counts, 0);
          counts[kindOf(t)]--;
          return sh < cur;
        };
        done = w.bringToLive(i, better, g.rng, (j) => j >= 52);
        counts[k]++;
        if (done) break;
      }
      if (!done) break;
    }
  },

  onRoundStart(g, seat) {
    if (stateOf(g, seat).taco) g.emit({ type: 'ability', seat, ability: 'yuuki', text: '塔可饼' });
    else if (g.roundWind === 0 && g.roundNumber === 0 && g.honba === 0) g.emit({ type: 'ability', seat, ability: 'yuuki', text: '东风之神' });
  },

  beforeDraw(g, seat, rinshan) {
    if (rinshan) return;
    const w = g.wall;
    const good = useful(g, seat);
    if (yuukiActive(g, seat)) {
      const chance = seat === g.dealer ? YUUKI.dealerGood : g.fullHanchan ? YUUKI.good : YUUKI.goodEast;
      if (!good(w.live[0]) && g.rng.chance(chance)) w.bringToLive(0, good, g.rng);
    } else if (good(w.live[0]) && g.rng.chance(YUUKI.southBad)) w.bringToLive(0, (t) => !good(t), g.rng);
  },

  // 发牌前（这时 roundWind 已经是要开始的那一局）：南场、塔可饼还没吃
  preDeal(g, seat): PreDealOption[] {
    if (gameStateOf(g, seat).tacoUsed || g.roundWind === 0) return [];
    return [{ id: 'taco', name: '塔可饼', desc: '这一局恢复东场的状态（一场一次）', enabled: true, picked: false, note: '一场一次' }];
  },

  setPreDeal(g, seat, picked) {
    gameStateOf(g, seat).tacoWant = picked.includes('taco');
  },

  skill(g, seat) {
    const gs = gameStateOf(g, seat);
    const on = yuukiActive(g, seat);
    const note = stateOf(g, seat).taco ? '吃了塔可饼，这一局恢复东场的状态' : on ? '东场：东风之神' : gs.tacoUsed ? '南场没劲，塔可饼吃过了' : '南场没劲，发牌前可以吃塔可饼';
    return { label: '', note, enabled: false, active: on };
  },

  badge(g, seat) {
    return stateOf(g, seat).taco ? '塔可饼' : g.roundWind === 0 ? '东风' : null;
  },

  insight(g, seat) {
    const gs = gameStateOf(g, seat);
    return [yuukiActive(g, seat) ? '这一局东风之神在' : '南场没劲', gs.tacoUsed ? '塔可饼吃过了' : '塔可饼还没吃'];
  },
};
