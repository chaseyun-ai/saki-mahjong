import type { Game } from '../engine/game';

// 这一场（一个半庄）每家和了几局：原木的仪表盘上，谁和一局那家旁边多盖一个小朱印。
// 数这一场里每次结算和了的人，一炮多响各算一局。事件只往后加，记下数到第几条，下次接着数
const tally = new WeakMap<Game, { seen: number; wins: number[] }>();

export function winCounts(g: Game): number[] {
  let t = tally.get(g);
  if (!t || t.seen > g.events.length) {
    t = { seen: 0, wins: [0, 0, 0, 0] };
    tally.set(g, t);
  }
  for (; t.seen < g.events.length; t.seen++) {
    const e = g.events[t.seen];
    if (e.type === 'roundEnd') for (const w of e.result.wins) t.wins[w.seat]++;
  }
  return t.wins;
}

// 最近一次结算谁和了（还没结算过、流局都是空的）：2D 换局时那家新的小朱印“嗒”地盖下去
export function lastWinners(g: Game): number[] {
  for (let i = g.events.length - 1; i >= 0; i--) {
    const e = g.events[i];
    if (e.type === 'roundEnd') return e.result.wins.map((w) => w.seat);
  }
  return [];
}

// 最近一次结算每家点数加减了多少（还没结算过是 null）：2D 翻牌屏换局时点数从结算前翻到结算后
export function lastDeltas(g: Game): number[] | null {
  for (let i = g.events.length - 1; i >= 0; i--) {
    const e = g.events[i];
    if (e.type === 'roundEnd') return e.result.deltas;
  }
  return null;
}
