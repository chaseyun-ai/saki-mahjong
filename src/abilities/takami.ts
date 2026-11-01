import type { Game } from '../engine/game';
import { Kind, TileId, kindLabel, kindOf } from '../engine/tiles';
import type { Ability } from './types';

// 涉谷尧深（白糸台）：收获时期（Harvest Time）。每局第一巡打出的牌被“种下”，到最后一局（南 4 局，东风战是东 4 局）全部回到她的配牌里。
// - 播种：每一局她打出的第一张牌记下来（整场都在，鸣牌、被封印的局打的不算）
// - 收获：最后一局（连庄也算）配牌里换进种下的牌：每种下一张，配牌里就有一张那种牌（同种最多 4 张，一共最多 HARVEST.max 张）。
//   种下的多是三元牌、字牌，常常做成役满
// 电脑的尧深：第一巡尽量打同一种三元牌（手里没有就打别的孤张字牌），收获的局留着种下的牌
export const HARVEST = {
  max: 13, // 一局最多收获几张
};

interface TakamiGameState {
  seeds?: Kind[]; // 种下的牌（按种下的顺序）
}
interface TakamiState {
  harvested?: number; // 这一局收获了几张
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as TakamiGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as TakamiState;

export function takamiSeeds(g: Game, seat: number): Kind[] {
  return gameStateOf(g, seat).seeds ?? [];
}

// 这一局是不是收获的局（南 4 局；东风战是东 4 局，南入的话南 4 局再收一次；连庄也算；种过牌）。发牌前看的是马上要开的那一局，这时 roundWind、roundNumber 已经是它的
export function takamiHarvest(g: Game, seat: number): boolean {
  const last = g.roundNumber === 3 && (g.format === 'east' || g.roundWind === 1);
  return last && takamiSeeds(g, seat).length > 0;
}

// 种下的牌按种类数：{白: 3, 中: 1}
function seedCounts(seeds: Kind[]): Map<Kind, number> {
  const m = new Map<Kind, number>();
  for (const k of seeds) m.set(k, Math.min(4, (m.get(k) ?? 0) + 1));
  return m;
}

const seedText = (seeds: Kind[]) =>
  [...seedCounts(seeds)].map(([k, n]) => `${kindLabel(k)}${n > 1 ? `×${n}` : ''}`).join(' ');

export const takamiAbility: Ability = {
  id: 'takami',
  name: '收获时期',
  // 平行宇宙：种下的牌全没了
  resetMarks(g, seat) {
    gameStateOf(g, seat).seeds = [];
  },
  description: `每局第一巡打出的牌被种下，到最后一局（南 4 局，东风战是东 4 局）种下的牌全部回到她的配牌里（每种下一张就带回一张，最多 ${HARVEST.max} 张）。种得越多收获越大，常常做成字牌役满。`,

  // 最后一局：配牌里换进种下的牌（从牌山里换，别人配牌里的也换得过来，别人的配牌规矩照守）
  beforeDeal(g, seat) {
    if (!takamiHarvest(g, seat)) return;
    const w = g.wall;
    const mine = g.dealIndices(seat);
    const want = seedCounts(takamiSeeds(g, seat));
    let n = 0;
    // 换出去的位置：不是种下的牌种、或者这种已经够数了
    const spare = () => {
      const have = new Map<Kind, number>();
      return mine.filter((i) => {
        const k = kindOf(w.live[i]);
        have.set(k, (have.get(k) ?? 0) + 1);
        return (have.get(k) ?? 0) > (want.get(k) ?? 0);
      });
    };
    // 种得多的先收（刻子先凑齐）
    for (const [k, count] of [...want].sort((x, y) => y[1] - x[1])) {
      let have = mine.filter((i) => kindOf(w.live[i]) === k).length;
      while (have < count && n < HARVEST.max) {
        const free = g.rng.shuffle(spare().filter((i) => kindOf(w.live[i]) !== k));
        if (!free.some((i) => w.bringToLive(i, (t: TileId) => kindOf(t) === k, g.rng, (j) => !mine.includes(j)))) break;
        have++;
        n++;
      }
    }
    stateOf(g, seat).harvested = n;
  },

  onRoundStart(g, seat) {
    const n = stateOf(g, seat).harvested ?? 0;
    if (n > 0) g.emit({ type: 'ability', seat, ability: 'takami', text: '收获时期' });
  },

  // 第一巡打出的牌种下（鸣牌以后打的不算第一巡）
  afterDiscard(g, seat, tile) {
    const p = g.players[seat];
    if (p.discards.length !== 1 || p.melds.length > 0) return;
    const gs = gameStateOf(g, seat);
    (gs.seeds ??= []).push(kindOf(tile));
  },

  skill(g, seat) {
    const seeds = takamiSeeds(g, seat);
    const harvest = takamiHarvest(g, seat);
    const note = !seeds.length ? '第一巡打出的牌会被种下' : harvest ? `收获中：${seedText(seeds)}` : `种下了 ${seedText(seeds)}，最后一局收获`;
    return { label: '', note, enabled: false, meter: { value: Math.min(seeds.length, HARVEST.max), max: HARVEST.max }, active: harvest };
  },

  badge(g, seat) {
    const n = takamiSeeds(g, seat).length;
    return takamiHarvest(g, seat) ? '收获' : n ? `种${n}` : null;
  },

  insight(g, seat) {
    const seeds = takamiSeeds(g, seat);
    return [seeds.length ? `种下了 ${seedText(seeds)}` : '还没种下牌', takamiHarvest(g, seat) ? '最后一局：种下的牌回到她的配牌里' : '最后一局收获'];
  },
};
