import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, kindOf, toCounts } from '../engine/tiles';
import { PRIORITY, type Ability } from './types';

// 天江衣（龙门渊）：
// - 一向听地狱：别人一向听、两向听时，进张常常被换走（已经听牌的人不受影响，所以压不住淡的双立直）
// - 海底捞月：她听牌时，如果牌山最后一张不归她，把牌山末尾多出的一到三张挪进王牌区（和开杠补王牌一样），
//   让最后一张正好轮到她（每局一次）；最后一张轮到她时，换成她的和了牌并锁住。
//   之后有人鸣牌错开顺序、有人开杠把最后一张挪进王牌区，海底就换人摸了（原作里咲就是这样破的）
// - 月相：每个半庄随机一个月相，越接近满月越强
export const MOON_PHASES = [
  { name: '新月', icon: '🌑', power: 0.25 },
  { name: '娥眉月', icon: '🌒', power: 0.4 },
  { name: '上弦月', icon: '🌓', power: 0.55 },
  { name: '盈凸月', icon: '🌔', power: 0.75 },
  { name: '满月', icon: '🌕', power: 1 },
  { name: '亏凸月', icon: '🌖', power: 0.75 },
  { name: '下弦月', icon: '🌗', power: 0.55 },
  { name: '残月', icon: '🌘', power: 0.4 },
];

// 满月时的概率，别的月相按 power 打折
export const KOROMO = {
  hellChance: 1, // 别人离听牌不远时，这一次摸牌的进张被挡住的概率
  hellDepth: 2, // 几向听以内会被挡（2：一向听、两向听摸到进张都会被换走）
  haiteiChance: 1, // 这一局听牌后，海底安排成和了牌的概率
};

interface KoromoGameState {
  moon?: number;
}
interface KoromoState {
  lucky?: boolean; // 这一局海底掷过了没有：true 发动，false 没发动
  shifted?: boolean; // 这一局已经把海底挪给自己过了
  haitei?: TileId; // 安排好的海底牌（锁住）
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as KoromoGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as KoromoState;

// 这一局还能不能把海底挪给自己（电脑的衣用来决定立不立直）
export function koromoCanShift(g: Game, seat: number): boolean {
  const st = stateOf(g, seat);
  return !st.shifted && st.lucky !== false;
}

export function koromoMoon(g: Game, seat: number) {
  const m = gameStateOf(g, seat).moon;
  return m === undefined ? null : MOON_PHASES[m];
}

export const koromoAbility: Ability = {
  id: 'koromo',
  name: '海底捞月',
  description: `别人离听牌只差一两步时，摸到的进张常常被换走（一向听地狱，已经听牌的人不受影响）；她听牌时，牌山最后一张会挪到轮到她摸（每局一次，之后有人鸣牌、开杠还是会错开），那张就是和了牌。每个半庄随机一个月相，满月时一定发动，新月只剩四分之一。`,
  priority: PRIORITY.koromo,

  beforeDeal(g, seat) {
    const gs = gameStateOf(g, seat);
    if (gs.moon === undefined) gs.moon = g.rng.int(MOON_PHASES.length);
  },

  onRoundStart(g, seat) {
    // 第一局开局时告诉大家今晚的月亮
    if (g.roundWind === 0 && g.roundNumber === 0 && g.honba === 0) {
      const moon = koromoMoon(g, seat)!;
      g.emit({ type: 'ability', seat, ability: 'koromo', text: moon.name });
    }
  },

  beforeAnyDraw(g, seat, drawer, rinshan) {
    const power = koromoMoon(g, seat)?.power ?? 1;
    const w = g.wall;
    const st = stateOf(g, seat);
    // 海底：最后一张会轮到谁摸（假设之后没人鸣牌、没人开杠）
    const last = w.live.length - 1;
    const lastDrawer = (drawer + (rinshan ? 1 : 0) + last) % 4;
    const waits = g.players[seat].hand.length % 3 === 1 ? g.waits(seat) : [];
    if (waits.length && last >= 0) st.lucky ??= g.rng.chance(KOROMO.haiteiChance * power);
    // 海底不归她：末尾多出的几张挪进王牌区，让最后一张轮到她（锁住的牌不挪；岭上摸牌时不动）
    if (waits.length && st.lucky && !st.shifted && !rinshan && lastDrawer !== seat) {
      const k = (lastDrawer - seat + 4) % 4;
      const tail = w.live.slice(w.live.length - k);
      if (last - k >= 4 && tail.every((t) => !w.locked.has(t))) {
        w.overflow.push(...w.live.splice(w.live.length - k, k).reverse());
        st.shifted = true;
        g.emit({ type: 'ability', seat, ability: 'koromo', text: '海底挪移' });
      }
    }
    if (waits.length && w.live.length - 1 >= 0 && (drawer + (rinshan ? 1 : 0) + w.live.length - 1) % 4 === seat) {
      const last = w.live.length - 1;
      // 听的牌变了（换了听、吃碰过）就重新安排
      const planned = st.haitei !== undefined && w.live[last] === st.haitei && waits.includes(kindOf(st.haitei));
      if (st.lucky && !planned) {
        if (st.haitei !== undefined && w.live[last] === st.haitei) w.locked.delete(st.haitei, 'koromo');
        st.haitei = undefined;
        if (!w.locked.has(w.live[last]) && w.bringToLive(last, (t) => waits.includes(kindOf(t)), g.rng)) {
          st.haitei = w.live[last];
          w.locked.add(st.haitei, 'koromo');
        }
      }
    }
    // 一向听地狱
    if (drawer === seat) return;
    const p = g.players[drawer];
    const counts = toCounts(p.hand);
    const sh = shanten(counts, p.melds.length);
    if (sh < 1 || sh > KOROMO.hellDepth || !g.rng.chance(KOROMO.hellChance * power)) return;
    return {
      seat,
      ability: 'koromo',
      text: '一向听地狱',
      deny: (t) => {
        counts[kindOf(t)]++;
        const after = shanten(counts, p.melds.length);
        counts[kindOf(t)]--;
        return after < sh;
      },
    };
  },

  afterDraw(g, seat) {
    const st = stateOf(g, seat);
    const p = g.players[seat];
    if (st.haitei !== undefined && p.drawn === st.haitei && g.wall.remaining === 0) {
      g.emit({ type: 'ability', seat, ability: 'koromo', text: '海底捞月' });
    }
  },

  badge(g, seat) {
    const moon = koromoMoon(g, seat);
    return moon ? `${moon.icon} ${moon.name}` : null;
  },
};
