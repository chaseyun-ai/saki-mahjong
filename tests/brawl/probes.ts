import { CHARACTERS, Character } from '../../src/abilities/characters';
import { PRIORITY, type Ability } from '../../src/abilities/types';
import type { Game } from '../../src/engine/game';
import { shanten } from '../../src/engine/shanten';
import { TileId, isYaochu, kindOf, suitOf, toCounts } from '../../src/engine/tiles';

// 能力大乱斗用的“探针”：衣、霞、淡还没做出来时，先用这三个粗暴版本把新地基的每个时机都用上，
// 而且故意比原作更凶（概率开到很高），好让碰撞尽量多发生。真角色做好以后从这里换掉。

// 淡：配牌前把别人的配牌换成幺九字牌；整理好自己的暗刻，第四张放在牌山最后一个转角、锁住；动里宝牌
const awaiProbe: Ability = {
  id: 'probe-awai',
  name: '探针·淡',
  description: '',
  priority: PRIORITY.awai,
  beforeDeal(g, seat) {
    const st = g.abilityState[seat] as { dirty?: boolean };
    // 每局开始时能力状态一定是空的
    if (Object.keys(st).length) throw new Error('上一局的能力状态没清干净');
    st.dirty = true;
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      for (const i of g.dealIndices(s)) if (g.rng.chance(0.6)) g.wall.bringToLive(i, (t) => isYaochu(kindOf(t)), g.rng);
    }
  },
  onRoundStart(g, seat) {
    g.wall.bringToUra(0, (t) => g.players[seat].hand.some((h) => kindOf(h) === kindOf(t) + 1), g.rng);
    g.emit({ type: 'ability', seat, ability: 'probe-awai', text: '绝对安全圈' });
  },
  beforeAnyDraw(g, seat, drawer, rinshan) {
    const st = g.abilityState[seat] as { corner?: TileId };
    if (rinshan || drawer !== seat || st.corner !== undefined) return;
    const counts = toCounts(g.players[seat].hand);
    const kind = counts.findIndex((c) => c === 3);
    if (kind < 0) return;
    const k = g.cornerIndices().filter((i) => g.drawerOf(i) === seat).at(-1);
    if (k === undefined || k === 0) return;
    if (g.wall.bringToLive(k, (t) => kindOf(t) === kind, g.rng) && kindOf(g.wall.live[k]) === kind) {
      st.corner = g.wall.live[k];
      g.wall.locked.add(st.corner);
    }
  },
};

// 衣：别人一向听时不让他摸到进张；自己听牌时把海底换成和了牌、锁住
const koromoProbe: Ability = {
  id: 'probe-koromo',
  name: '探针·衣',
  description: '',
  priority: PRIORITY.koromo,
  beforeAnyDraw(g, seat, drawer) {
    const w = g.wall;
    const last = w.live.length - 1;
    const waits = g.waits(seat);
    if (waits.length && last > 4 && g.drawerOf(last) === seat && !w.locked.has(w.live[last])) {
      if (w.bringToLive(last, (t) => waits.includes(kindOf(t)), g.rng)) w.locked.add(w.live[last]);
    }
    if (drawer === seat) return;
    const p = g.players[drawer];
    const counts = toCounts(p.hand);
    if (shanten(counts, p.melds.length) !== 1 || !g.rng.chance(0.8)) return;
    return {
      seat,
      ability: 'probe-koromo',
      text: '一向听地狱',
      deny: (t) => {
        counts[kindOf(t)]++;
        const sh = shanten(counts, p.melds.length);
        counts[kindOf(t)]--;
        return sh < 1;
      },
    };
  },
};

// 霞：开局定一种花色，别人摸不到（岭上牌不管）
const kasumiProbe: Ability = {
  id: 'probe-kasumi',
  name: '探针·霞',
  description: '',
  priority: PRIORITY.kasumi,
  onRoundStart(g, seat) {
    const per = [0, 0, 0];
    for (const t of g.players[seat].hand) if (kindOf(t) < 27) per[suitOf(kindOf(t))]++;
    (g.abilityState[seat] as { suit?: number }).suit = per.indexOf(Math.max(...per));
  },
  beforeAnyDraw(g, seat, drawer, rinshan) {
    const suit = (g.abilityState[seat] as { suit?: number }).suit;
    if (rinshan || drawer === seat || suit === undefined) return;
    return { seat, ability: 'probe-kasumi', text: '绝一门', deny: (t) => kindOf(t) < 27 && suitOf(kindOf(t)) === suit };
  },
};

export const KASUMI_PROBE = kasumiProbe;

const base = CHARACTERS.find((c) => c.id === 'nodoka')!.ai;
const probe = (ability: Ability, color: string): Character => ({
  id: ability.id,
  name: ability.name,
  school: '测试',
  color,
  ability,
  ai: { ...base, mistakeRate: 0.08 },
});

// 大乱斗的角色池：现有角色 + 还没做出来的人的探针（做出来以后探针就不用了）
export function brawlPool(): Character[] {
  const pool = [...CHARACTERS];
  const has = (id: string) => pool.some((c) => c.id === id);
  if (!has('awai')) pool.push(probe(awaiProbe, '#e0c050'));
  if (!has('koromo')) pool.push(probe(koromoProbe, '#e07050'));
  if (!has('kasumi')) pool.push(probe(kasumiProbe, '#50a0a0'));
  return pool;
}

export function kasumiSuit(g: Game, seat: number): number | undefined {
  return (g.abilityState[seat] as { suit?: number }).suit;
}
