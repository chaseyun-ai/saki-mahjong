import type { Game } from '../engine/game';
import { waitingKinds } from '../engine/shanten';
import { TileId, kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 爱宕娟慧（姬松）：一筒。被动。
// 手里有一筒时，每次摸牌有 pull 的概率摸到一筒（牌山里还有的话）。
// 听牌以后一筒不是和了牌就不拉（摸进来也是废牌）；一筒是和了牌时照样拉，和了要成立
export const KINUE = {
  kind: 9, // 一筒
  pull: 0.25, // 手里有一筒时，每次摸牌换成一筒的概率
};

const isPin1 = (t: TileId) => kindOf(t) === KINUE.kind;

export const kinueHolds = (g: Game, seat: number): boolean => g.players[seat].hand.some(isPin1);

export const kinueAbility: Ability = {
  id: 'kinue',
  name: '一筒',
  description: `被动。手里有一筒时，每次摸牌有 ${KINUE.pull * 100}% 的概率摸到一筒。听牌以后只在一筒是和了牌时才起作用。`,

  beforeDraw(g, seat, rinshan) {
    const p = g.players[seat];
    if (!kinueHolds(g, seat)) return;
    const w = g.wall;
    const next = rinshan ? w.rinshan[0] : w.live[0];
    if (next === undefined || isPin1(next)) return;
    // 听牌了：一筒得是能和的牌
    if (p.hand.length % 3 === 1) {
      const waits = waitingKinds(toCounts(p.hand), p.melds.length);
      if (waits.length && !waits.includes(KINUE.kind)) return;
    }
    if (!g.rng.chance(KINUE.pull)) return;
    const ok = rinshan ? w.bringToRinshan(isPin1, g.rng) : w.bringToLive(0, isPin1, g.rng);
    if (ok) g.emit({ type: 'ability', seat, ability: 'kinue', text: '一筒' });
  },

  skill(g, seat) {
    const on = kinueHolds(g, seat);
    return { label: '', note: on ? `手里有一筒：摸到一筒的概率 +${KINUE.pull * 100}%` : '手里有一筒时更容易摸到一筒', enabled: false, active: on };
  },

  insight(g, seat) {
    return [kinueHolds(g, seat) ? '手里有一筒：更容易摸到一筒' : '手里没有一筒'];
  },
};
