import type { Game } from '../engine/game';
import { evaluateWin } from '../engine/score';
import { waitingKinds } from '../engine/shanten';
import { EAST, Kind, isRed, kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 爱宕洋榎（姬松）：读牌。没有控场，牌山一张都不动。
// 她看得出谁听牌了、听哪几张、大概有多大：
// - 玩家操作她时：指着会放铳的牌冒气泡；听牌的人头像旁边亮一盏灯，牌越大越亮（见 src/ui/app.ts）
// - 电脑的洋榎：照读出来的听牌防守，不打别人和得了的牌；自己听牌时挑引っ掛け的听法；有役、默听够大就不立直

export interface TenpaiRead {
  seat: number;
  // 这几种牌打出去他能荣和（振听、没役的不算）
  ron: Kind[];
  // 估计能和多大：几种和了牌里最大的那个（荣和、自摸取大的，不算里宝）
  value: number;
}

// 一家的听牌（手里 13 张时才读得出来；刚摸牌、还没打的那一刻按摸牌前的 13 张读）
export function readTenpai(g: Game, seat: number): TenpaiRead | null {
  // 这一局和不了牌的（照的照魔镜）不算听牌
  if (!g.canWin(seat)) return null;
  const p = g.players[seat];
  let hand = p.hand;
  if ((hand.length + 3 * p.melds.length) % 3 === 2) {
    if (p.drawn === null) return null;
    hand = hand.filter((t) => t !== p.drawn);
  }
  const waits = waitingKinds(toCounts(hand), p.melds.length);
  if (!waits.length) return null;
  const furiten = p.furitenTemp || p.furitenRiichi || p.discards.some((d) => waits.includes(kindOf(d.tile)));
  const ron: Kind[] = [];
  let value = 0;
  for (const k of waits) {
    // 用一张不在他手里的普通牌当和了牌
    const tile = [0, 1, 2, 3].map((i) => k * 4 + i).find((t) => !hand.includes(t) && !isRed(t)) ?? k * 4 + 1;
    const ctx = {
      closed: [...hand, tile],
      melds: p.melds,
      winTile: tile,
      seatWind: g.seatWind(seat),
      roundWind: EAST + g.roundWind,
      isDealer: seat === g.dealer,
      riichi: p.riichi,
      doubleRiichi: p.doubleRiichi,
      ippatsu: false,
      doraIndicators: g.wall.visibleDoraIndicators().map(kindOf),
    };
    const r = evaluateWin({ ...ctx, tsumo: false });
    if (r && r.ron > 0 && !furiten) ron.push(k);
    const t = evaluateWin({ ...ctx, tsumo: true });
    const tsumo = t ? (seat === g.dealer ? t.tsumoOtherPays * 3 : t.tsumoDealerPays + t.tsumoOtherPays * 2) : 0;
    value = Math.max(value, r?.ron ?? 0, tsumo);
  }
  return value > 0 ? { seat, ron, value } : null;
}

// 除了 seat 自己，听牌的人
export function readOthers(g: Game, seat: number): TenpaiRead[] {
  return [0, 1, 2, 3].filter((s) => s !== seat).flatMap((s) => readTenpai(g, s) ?? []);
}

// 打出去会被谁荣和的牌种
export function dangerKinds(g: Game, seat: number): Set<Kind> {
  return new Set(readOthers(g, seat).flatMap((r) => r.ron));
}

// 灯泡亮度 1–5：一千多点、两三千、五千左右、满贯、跳满以上
export function bulbLevel(value: number): number {
  return value < 2600 ? 1 : value < 5200 ? 2 : value < 8000 ? 3 : value < 12000 ? 4 : 5;
}

export const hiroeAbility: Ability = {
  id: 'hiroe',
  name: '读牌',
  description: '不动牌山，只读牌：看得出谁听牌了、牌有多大（听牌的人头像旁边亮灯，牌越大越亮），指着会放铳的牌时她会提醒你。',

  insight() {
    return ['不动牌山，只读牌：看得出谁听牌、听什么、多大，不会打别人和得了的牌'];
  },
};
