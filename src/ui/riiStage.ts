import type { Game, Stage } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, isRed, kindOf, toCounts } from '../engine/tiles';

// 「白水哩 · 姬子测试」的「立直就能自摸」：每一局她的配牌都是听牌的门清手
//   123m 456m 789p 99s 34s（两面听 2s、5s），
// 第一次摸到一张别人手里一张都没有的字牌（打出去立直，没人碰得了、和得了），立直以后下一张就摸到 2s。
// 番缚是第一次出牌时缚的，这一张打出去就立直，所以没人鸣牌时是两立直：两立直、一发、门前清自摸和、平和，一共 5 番
// （她立直之前有人鸣牌就只是立直，立直以后有人鸣牌就没有一发；宝牌、里宝牌另算）。
// 没人鸣牌、没有宝牌时缚 1–5 番拿到钥匙，缚 6、7 番番数不够。
// 她自摸之前（第一圈）别人摸不到和的牌，免得地和、一巡自摸把这一局抢走。
// 牌是在所有能力动完以后才摆的（Game 的 stage），别人的能力也挡不住。

// 配牌的 13 张（牌的种类）：1m2m3m 4m5m6m 7p8p9p 9s9s 3s4s
export const RIICHI_HAND = [0, 1, 2, 3, 4, 5, 15, 16, 17, 26, 26, 20, 21];
// 和的那一张：2s，没有了就 5s
export const RIICHI_WIN = [19, 22];

export const swap = (a: TileId[], i: number, b: TileId[], j: number) => ([a[i], b[j]] = [b[j], a[i]]);

// 牌山里找一张 k（不要赤牌、不要锁住的）：先找 live 里 ok 的位置（配牌以外的优先），
// 再找岭上牌、还没翻开的宝牌指示牌、里宝牌指示牌
export function spare(g: Game, k: number, ok: (j: number) => boolean): [TileId[], number] | null {
  const w = g.wall;
  const fit = (t: TileId) => kindOf(t) === k && !isRed(t) && !w.locked.has(t);
  const sources: [TileId[], (j: number) => boolean][] = [
    [w.live, (j) => j >= 52 && ok(j)],
    [w.live, ok],
    [w.rinshan, () => true],
    [w.doraIndicators, (j) => j >= w.doraRevealed],
    [w.uraIndicators, () => true],
  ];
  for (const [list, at] of sources) {
    const j = list.findIndex((t, j) => at(j) && fit(t));
    if (j >= 0) return [list, j];
  }
  return null;
}

// list 里 at 这些位置是她的牌：多出来的和牌山里缺的对换，换成 RIICHI_HAND（赤牌不要，免得多出一番）
function arrange(g: Game, list: TileId[], at: number[], ok: (j: number) => boolean): void {
  const want = [...RIICHI_HAND];
  const extra: number[] = [];
  for (const i of at) {
    const j = want.indexOf(kindOf(list[i]));
    if (j >= 0 && !isRed(list[i])) want.splice(j, 1);
    else extra.push(i);
  }
  for (const i of extra) {
    const k = want.shift();
    if (k === undefined) return;
    const from = spare(g, k, ok);
    if (from) swap(list, i, from[0], from[1]);
  }
}

// 配牌：她从 live 里拿的 13 个位置摆好
function stageDeal(g: Game, seat: number): void {
  const mine = new Set(g.dealIndices(seat));
  arrange(g, g.wall.live, [...mine], (j) => !mine.has(j));
}

// 下一张摸的牌（live[0]）换成 pick 挑中的那张
function bringToFront(g: Game, pick: (t: TileId) => boolean): boolean {
  const w = g.wall;
  if (w.live.length === 0 || pick(w.live[0])) return w.live.length > 0;
  const j = w.live.findIndex((t, i) => i > 0 && pick(t) && !w.locked.has(t));
  if (j < 0) return false;
  swap(w.live, 0, w.live, j);
  return true;
}

function stageDraw(g: Game, seat: number, rinshan: boolean, me: number): void {
  if (rinshan) return;
  const p = g.players[me];
  if (seat !== me) {
    // 她立直、自摸之前（第一圈），别人摸不到和的牌（不然地和、一巡里自摸就把这一局抢走了）
    if (p.discards.length > 1) return;
    const q = g.players[seat];
    const done = (t: TileId) => shanten(toCounts([...q.hand, t]), q.melds.length) < 0;
    if (g.wall.live.length && done(g.wall.live[0])) bringToFront(g, (t) => !done(t));
    return;
  }
  if (p.riichi) {
    // 立直以后：摸到和的那一张
    for (const k of RIICHI_WIN) if (bringToFront(g, (t) => kindOf(t) === k && !isRed(t))) return;
    return;
  }
  if (p.discards.length > 0) return;
  // 配牌以后还有能力换过她的手牌（afterDeal）：第一次摸牌前再摆回去（不动 live[0]，马上要摸的那张下面另外挑）
  arrange(g, p.hand, [...p.hand.keys()], (j) => j > 0);
  // 第一次摸牌：一张别人手里一张都没有的字牌（打出去立直），找不到就挑别人手里最少的
  const held = (k: number) => g.players.reduce((n, q, s) => n + (s === me ? 0 : q.hand.filter((t) => kindOf(t) === k).length), 0);
  const kinds = [27, 28, 29, 30, 31, 32, 33].filter((k) => g.wall.live.some((t) => kindOf(t) === k)).sort((a, b) => held(a) - held(b));
  if (kinds.length && bringToFront(g, (t) => kindOf(t) === kinds[0])) return;
  // 字牌都摸完了：至少别是和的那一张
  bringToFront(g, (t) => !RIICHI_WIN.includes(kindOf(t)));
}

// 自己坐 me，每一局都这样摆
export function riichiTsumoStage(me: number): Stage {
  return {
    deal: (g) => stageDeal(g, me),
    draw: (g, seat, rinshan) => stageDraw(g, seat, rinshan, me),
  };
}
