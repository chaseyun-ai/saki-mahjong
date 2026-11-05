import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, kindOf, toCounts } from '../engine/tiles';
import { SHIZUNO, shizunoMistOver } from './shizuno';
import { PRIORITY, type Ability } from './types';

// 天江衣（龙门渊）：
// - 一向听地狱：别人一向听、两向听时，进张常常被换走（已经听牌的人不受影响，所以压不住淡的双立直）
// - 海底捞月：她听牌时，如果牌山最后一张不归她，把牌山末尾多出的一到三张挪进王牌区（和开杠补王牌一样），
//   让最后一张正好轮到她；最后一张轮到她时，换成她的和了牌并锁住。
//   有人鸣牌错开顺序以后，下一次摸牌时她会再挪回来（牌山剩得够才行），所以要在最后几张里错开才有用
//   （原作里咲就是这样破的）
// - 夜之支配：她自己一向听以上时，摸牌常常换成进张（别人被挡掉的进张流到她手里）
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
  nightChance: 0.6, // 她自己离听牌还差一步以上时，这一次摸牌换成进张的概率
  // 别家电脑（没经验的）每局会想到去鸣牌错开她海底的概率；KOROMO_READERS 里的人每局都会
  aiDisrupt: 0.3,
};

// 看得穿衣的海底、每局都会去错开的人：原作里和她交过手、有经验的
export const KOROMO_READERS = ['saki', 'hisa', 'mako', 'mihoko'];

interface KoromoGameState {
  moon?: number;
}
interface KoromoState {
  lucky?: boolean; // 这一局海底掷过了没有：true 发动，false 没发动
  shifted?: boolean; // 这一局已经把海底挪给自己过了（被错开以后还会再挪）
  disrupt?: Record<number, boolean>; // 别家电脑这一局想不想去错开她的海底（按座位，掷过才有）
  haitei?: TileId; // 安排好的海底牌（锁住）
  fogged?: boolean; // 稳乃的雾遮住了这一局的海底（掷过就是 true/false）
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as KoromoGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as KoromoState;

// 这一局海底捞月会不会发动（还没听牌、没掷过的算会）：电脑的衣用来决定立不立直
export function koromoHaiteiOn(g: Game, seat: number): boolean {
  return stateOf(g, seat).lucky !== false;
}

// 电脑 viewer 这一局会不会去鸣牌错开衣的海底：有经验的人一定会，别人每局掷一次
export function koromoDisruptor(g: Game, seat: number, viewer: number, readers: boolean): boolean {
  const st = stateOf(g, seat);
  st.disrupt ??= {};
  st.disrupt[viewer] ??= readers || g.rng.chance(KOROMO.aiDisrupt);
  return st.disrupt[viewer];
}

export function koromoMoon(g: Game, seat: number) {
  const m = gameStateOf(g, seat).moon;
  return m === undefined ? null : MOON_PHASES[m];
}

export const koromoAbility: Ability = {
  id: 'koromo',
  name: '海底捞月',
  description: `别人离听牌只差一两步时，摸到的进张常常被换走（一向听地狱，已经听牌的人不受影响）；她自己离听牌还差一步以上时，常常摸到进张（夜之支配）；她听牌时，牌山最后一张会挪到轮到她摸，那张就是和了牌，被人鸣牌错开了还会再挪回来，要在最后几张里错开才有用。每个半庄随机一个月相，满月时一定发动，新月只剩四分之一。`,
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
    // 她自己拆了听牌：安排好的海底牌放掉，听回来再重新安排
    if (!waits.length && g.players[seat].hand.length % 3 === 1 && st.haitei !== undefined) {
      w.locked.delete(st.haitei, 'koromo');
      st.haitei = undefined;
    }
    // 海底不归她：末尾多出的几张挪进王牌区，让最后一张轮到她（锁住的牌不挪；岭上摸牌时不动）
    if (waits.length && st.lucky && !rinshan && lastDrawer !== seat) {
      const k = (lastDrawer - seat + 4) % 4;
      const tail = w.live.slice(w.live.length - k);
      // 被错开以后再挪：她自己锁住的旧海底牌在要挪走的那几张里，先解锁（挪回来以后重新安排）
      if (st.haitei !== undefined && tail.includes(st.haitei) && last - k >= 4 && tail.every((t) => t === st.haitei || !w.locked.has(t))) {
        w.locked.delete(st.haitei, 'koromo');
        st.haitei = undefined;
      }
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
      // 稳乃的雾：第一次要安排海底时按雾的浓度掷一次，遮住了这一局海底就不归她
      if (st.lucky && !planned && st.fogged === undefined) {
        const L = shizunoMistOver(g, seat);
        st.fogged = L > 0 && g.rng.chance(Math.min(1, L * SHIZUNO.haiteiFog));
        if (st.fogged) st.lucky = false;
      }
      if (st.lucky && !planned) {
        if (st.haitei !== undefined && w.live[last] === st.haitei) w.locked.delete(st.haitei, 'koromo');
        st.haitei = undefined;
        if (!w.locked.has(w.live[last]) && w.bringToLive(last, (t) => waits.includes(kindOf(t)), g.rng)) {
          st.haitei = w.live[last];
          w.locked.add(st.haitei, 'koromo');
        }
      }
    }
    // 夜之支配：她自己一向听以上时，摸牌换成进张
    if (drawer === seat) {
      if (rinshan) return;
      const me = g.players[seat];
      const mine = toCounts(me.hand);
      const sh0 = shanten(mine, me.melds.length);
      if (sh0 < 1 || !g.rng.chance(KOROMO.nightChance * power)) return;
      return {
        seat,
        ability: 'koromo',
        text: '夜之支配',
        deny: (t) => {
          mine[kindOf(t)]++;
          const after = shanten(mine, me.melds.length);
          mine[kindOf(t)]--;
          return after >= sh0;
        },
      };
    }
    // 一向听地狱
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
    if (st.fogged && g.wall.remaining === 0 && !g.rinshanDraw) {
      const sz = [0, 1, 2, 3].find((s) => s !== seat && g.active(s)?.id === 'shizuno');
      if (sz !== undefined) g.emit({ type: 'ability', seat: sz, ability: 'shizuno', text: '雾遮住了海底', target: seat });
    }
    if (st.haitei !== undefined && p.drawn === st.haitei && g.wall.remaining === 0) {
      g.emit({ type: 'ability', seat, ability: 'koromo', text: '海底捞月' });
    }
  },

  insight(g, seat) {
    const moon = koromoMoon(g, seat);
    const st = stateOf(g, seat);
    const out = [moon ? `今晚是${moon.name}，能力是满月时的 ${Math.round(moon.power * 100)}%` : '月相还没出来'];
    out.push(st.lucky === undefined ? '这一局还没听牌' : st.lucky ? (st.shifted ? '这一局海底已经挪给了她' : '这一局听牌了，海底会是她的和了牌') : '这一局海底没发动');
    return out;
  },

  badge(g, seat) {
    const moon = koromoMoon(g, seat);
    return moon ? `${moon.icon} ${moon.name}` : null;
  },
};
