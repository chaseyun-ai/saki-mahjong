import { chooseAction } from '../ai/ai';
import type { AiStyle } from '../abilities/characters';
import type { Game, RoundResult } from '../engine/game';
import type { TileId } from '../engine/tiles';
import { cloneGame } from '../engine/clone';

export { cloneGame };

// 怜“看下一巡”（演算）：把牌局复制一份，她在复制品上打出一张牌、之后都不鸣牌，电脑照常往下打一巡，
// 一直到她下一次摸牌（或者这一局结束）。界面把复制品放到牌桌上演出来，退出时换回真的牌局。
// 牌局和电脑的随机数都是种子定好的，复制品里发生的就是真的会发生的事（只要她真的不鸣牌）。
// 只在复制品上动手，真正的牌局一点不碰。

export type SeenStep =
  | { kind: 'discard'; seat: number; tile: TileId; riichi: boolean }
  | { kind: 'call'; seat: number; call: string }
  | { kind: 'ability'; seat: number; text: string }
  // 她自己能荣和这张（复制品里假设她没和，接着往下看）
  | { kind: 'canRon'; tile: TileId; from: number }
  | { kind: 'draw'; tile: TileId }
  | { kind: 'end'; result: RoundResult };

export type CanRon = Extract<SeenStep, { kind: 'canRon' }>;

// 演算到哪了：复制品 c 从第 start 个事件起发生的事，按顺序；rons 是她能荣和却没和的那几次（插在那张牌打出之后）
export function readSteps(c: Game, start: number, seat: number, rons: CanRon[]): SeenStep[] {
  const left = [...rons];
  const seen: SeenStep[] = [];
  const events = c.events.slice(start);
  // 每家演算里打的第一张是牌河里的第几张：隐身的桃子打的牌她看不见，不写进经过
  const index = [0, 1, 2, 3].map((s) => c.players[s].discards.length - events.filter((e) => e.type === 'discard' && e.seat === s).length);
  for (const e of events) {
    if (e.type === 'discard') {
      if (c.discardHidden(e.seat, index[e.seat]++, seat)) continue;
      seen.push({ kind: 'discard', seat: e.seat, tile: e.tile, riichi: e.riichi });
      if (left[0]?.tile === e.tile && left[0].from === e.seat) seen.push(left.shift()!);
    } else if (e.type === 'call') seen.push({ kind: 'call', seat: e.seat, call: e.call });
    else if (e.type === 'ability') seen.push({ kind: 'ability', seat: e.seat, text: e.text });
    else if (e.type === 'draw' && e.seat === seat) {
      const t = c.players[seat].drawn;
      if (t !== null) seen.push({ kind: 'draw', tile: t });
    } else if (e.type === 'roundEnd') seen.push({ kind: 'end', result: e.result });
  }
  return seen;
}

// 演算一巡结束了没有：一局结束了，或者她已经打过牌、又轮到她
export function rehearsalOver(c: Game, start: number, seat: number): boolean {
  if (c.phase === 'roundEnd' || c.phase === 'gameEnd') return true;
  return c.phase === 'turn' && c.turn === seat && c.events.length > start;
}

// 她这次能荣和吗（演算里她一律不和，先记下来）
export function canRonNow(c: Game, seat: number): CanRon | null {
  if (c.phase !== 'calls' || !c.lastDiscard || !c.legalActions(seat).some((a) => a.type === 'ron')) return null;
  return { kind: 'canRon', tile: c.lastDiscard.tile, from: c.lastDiscard.seat };
}

// 不用界面，一口气演算完：她（seat）打出 tile 之后的一巡。ai 是四个座位电脑的打法（她自己那格不用）
export function foresee(g: Game, seat: number, tile: TileId, riichi: boolean, ai: AiStyle[]): SeenStep[] {
  const c = cloneGame(g);
  const start = c.events.length;
  const rons: CanRon[] = [];
  c.act(seat, { type: 'discard', tile, riichi });
  // 一巡最多也就几十步，防万一
  for (let guard = 0; guard < 60 && !rehearsalOver(c, start, seat); guard++) {
    if (c.phase === 'turn') {
      c.act(c.turn, chooseAction(c, c.turn, ai[c.turn]));
      continue;
    }
    // 别人打牌后：电脑先回应（和真的牌局一样的顺序），她自己一律不鸣
    for (const s of c.waitingSeats()) if (s !== seat) c.act(s, chooseAction(c, s, ai[s]));
    if (c.phase === 'calls' && c.waitingSeats().includes(seat)) {
      const r = canRonNow(c, seat);
      if (r) rons.push(r);
      c.act(seat, { type: 'pass' });
    }
  }
  return readSteps(c, start, seat, rons);
}
