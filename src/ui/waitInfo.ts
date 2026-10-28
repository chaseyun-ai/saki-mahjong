import type { Game } from '../engine/game';
import { WinResult, evaluateWin } from '../engine/score';
import { waitingKinds } from '../engine/shanten';
import { EAST, Kind, TileId, kindOf, toCounts } from '../engine/tiles';

// 待和提示：听哪几张、每张还剩几张、和了几番。
// 只是给玩家看的提示，能不能和还是规则那边说了算（和牌按钮照旧）。
// 番数不算里宝牌（还没翻）和海底、岭上、抢杠这种到时候才知道的役，真和了只会多不会少。

export interface WaitTile {
  kind: Kind;
  left: number; // 从这个座位看还剩几张（别人手里的看不见，算在剩的里面）
  ron: WinResult | null; // 别人打出来荣和（先不管振听）；null 是没役
  tsumo: WinResult | null; // 自己摸到；null 是没役
}

export interface WaitInfo {
  tiles: WaitTile[];
  furiten: boolean;
}

// 'ron' 能荣和，'tsumo' 只能自摸（门清没别的役，或者振听），'none' 怎么来都没役
export type WaitStatus = 'ron' | 'tsumo' | 'none';

export function waitStatus(w: WaitTile, furiten: boolean): WaitStatus {
  if (w.ron && !furiten) return 'ron';
  return w.tsumo ? 'tsumo' : 'none';
}

// 满贯以上写名字，不然写番数
export function hanLabel(r: WinResult): string {
  return r.limitName || `${r.han}番`;
}

// 现在听什么。discard：轮到自己时，假设打掉这张以后听什么；riichi：按立直算番
export function waitInfo(g: Game, seat: number, discard: TileId | null = null, riichi = false): WaitInfo {
  const p = g.players[seat];
  const hand = discard === null ? p.hand : p.hand.filter((t) => t !== discard);
  if ((hand.length + 3 * p.melds.length) % 3 !== 1) return { tiles: [], furiten: false };
  const kinds = waitingKinds(toCounts(hand), p.melds.length);
  const seen = seenCounts(g, seat);
  const discarded = new Set(p.discards.map((d) => kindOf(d.tile)));
  if (discard !== null) discarded.add(kindOf(discard));
  const dora = g.wall.visibleDoraIndicators().map(kindOf);
  const evaluate = (k: Kind, tsumo: boolean) => {
    // 拿这一种里不是赤宝牌的那张来算（kind × 4 + 1 一定不是赤五）
    const tile = k * 4 + 1;
    return evaluateWin({
      closed: [...hand, tile],
      melds: p.melds,
      winTile: tile,
      tsumo,
      seatWind: g.seatWind(seat),
      roundWind: EAST + g.roundWind,
      isDealer: seat === g.dealer,
      riichi: p.riichi || riichi,
      doubleRiichi: p.doubleRiichi,
      ippatsu: p.ippatsu,
      doraIndicators: dora,
    });
  };
  return {
    tiles: kinds.map((k) => ({ kind: k, left: Math.max(0, 4 - seen[k]), ron: evaluate(k, false), tsumo: evaluate(k, true) })),
    furiten: p.furitenTemp || p.furitenRiichi || kinds.some((k) => discarded.has(k)),
  };
}

// 这个座位看得见的牌：自己的手牌、四家牌河（隐身的桃子打的不算）（被叫走的算在副露里）、四家副露、翻开的宝牌指示牌
function seenCounts(g: Game, seat: number): number[] {
  const tiles: TileId[] = [...g.players[seat].hand, ...g.wall.visibleDoraIndicators()];
  for (const q of g.players) {
    for (const m of q.melds) tiles.push(...m.tiles);
    // 隐身的桃子打的牌看不见
    if (!g.stealthed(q.seat, seat)) for (const d of q.discards) if (!d.called) tiles.push(d.tile);
  }
  return toCounts(tiles);
}
