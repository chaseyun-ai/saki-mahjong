import type { Discard } from './game';

// 牌河里横放的那一张（立直的标记）：平时是立直宣言牌；宣言牌被吃、碰、杠走了，
// 就换成她之后打出、还留在牌河里的第一张（下一巡的牌横过来）。没立直，或者还没有接替的牌，是 -1
export function riichiSideIndex(discards: readonly Discard[]): number {
  const at = discards.findIndex((d) => d.riichi);
  if (at < 0) return -1;
  for (let i = at; i < discards.length; i++) if (!discards[i].called) return i;
  return -1;
}
