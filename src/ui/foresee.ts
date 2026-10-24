import { chooseAction } from '../ai/ai';
import type { AiStyle } from '../abilities/characters';
import type { Game, RoundResult } from '../engine/game';
import { TileId, isRed, kindOf } from '../engine/tiles';

// 怜“看下一巡”：把牌局复制一份，假设她打出某张牌、之后都不鸣牌，让电脑照常往下打一巡，
// 记下每家打了什么、有没有人鸣牌或和牌，一直到她下一次摸牌（或者这一局结束）。
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

export interface Vision {
  tile: TileId;
  steps: SeenStep[];
  dealIn: boolean; // 打这张会放铳
  called: boolean; // 打这张会被吃碰杠
  canRon: boolean; // 这一巡里她能荣和别人
  tsumo: boolean; // 下一张自己摸到就能自摸
}

// 深拷贝：Map、Set、数组、带类的对象（牌山、随机数）都复制，函数（能力）共用
function cloneDeep<T>(v: T, seen = new Map<unknown, unknown>()): T {
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return seen.get(v) as T;
  let out: unknown;
  if (Array.isArray(v)) {
    const a: unknown[] = [];
    seen.set(v, a);
    for (const x of v) a.push(cloneDeep(x, seen));
    out = a;
  } else if (v instanceof Map) {
    const m = new Map();
    seen.set(v, m);
    for (const [k, x] of v) m.set(cloneDeep(k, seen), cloneDeep(x, seen));
    out = m;
  } else if (v instanceof Set) {
    const s = new Set();
    seen.set(v, s);
    for (const x of v) s.add(cloneDeep(x, seen));
    out = s;
  } else {
    const o = Object.create(Object.getPrototypeOf(v)) as Record<string, unknown>;
    seen.set(v, o);
    for (const k of Object.keys(v)) o[k] = cloneDeep((v as Record<string, unknown>)[k], seen);
    out = o;
  }
  return out as T;
}

export function cloneGame(g: Game): Game {
  const c = cloneDeep(g);
  // 复制品不通知界面
  (c as unknown as { eventListeners: unknown[] }).eventListeners = [];
  return c;
}

// 她（seat）在自己的回合打出 tile 之后的一巡。ai 是四个座位电脑的打法（她自己那格不用）
export function foresee(g: Game, seat: number, tile: TileId, riichi: boolean, ai: AiStyle[]): Vision {
  const c = cloneGame(g);
  const start = c.events.length;
  // 她能荣和的时候（复制品里的事件不带这个，另外记）
  const rons: Extract<SeenStep, { kind: 'canRon' }>[] = [];
  const v: Vision = { tile, steps: [], dealIn: false, called: false, canRon: false, tsumo: false };
  c.act(seat, { type: 'discard', tile, riichi });
  // 一巡最多也就几十步，防万一
  for (let guard = 0; guard < 60; guard++) {
    if (c.phase === 'roundEnd' || c.phase === 'gameEnd') break;
    if (c.phase === 'turn' && c.turn === seat) break;
    if (c.phase === 'turn') {
      c.act(c.turn, chooseAction(c, c.turn, ai[c.turn]));
      continue;
    }
    // 别人打牌后：电脑先回应（和真的牌局一样的顺序），她自己一律不鸣
    for (const s of c.waitingSeats()) if (s !== seat) c.act(s, chooseAction(c, s, ai[s]));
    if (c.phase === 'calls' && c.waitingSeats().includes(seat)) {
      if (c.legalActions(seat).some((a) => a.type === 'ron') && c.lastDiscard) {
        rons.push({ kind: 'canRon', tile: c.lastDiscard.tile, from: c.lastDiscard.seat });
        v.canRon = true;
      }
      c.act(seat, { type: 'pass' });
    }
  }
  // 按发生顺序记下来；她的“能荣和”插在那张牌打出之后
  const seen: SeenStep[] = [];
  for (const e of c.events.slice(start)) {
    if (e.type === 'discard') {
      seen.push({ kind: 'discard', seat: e.seat, tile: e.tile, riichi: e.riichi });
      if (rons[0]?.tile === e.tile && rons[0].from === e.seat) seen.push(rons.shift()!);
    } else if (e.type === 'call') {
      seen.push({ kind: 'call', seat: e.seat, call: e.call });
      if (e.seat !== seat) v.called = true;
    } else if (e.type === 'ability') seen.push({ kind: 'ability', seat: e.seat, text: e.text });
    else if (e.type === 'draw' && e.seat === seat) {
      const t = c.players[seat].drawn;
      if (t !== null) seen.push({ kind: 'draw', tile: t });
    } else if (e.type === 'roundEnd') {
      seen.push({ kind: 'end', result: e.result });
      if (e.result.wins.some((w) => w.from === seat)) v.dealIn = true;
    }
  }
  v.steps = seen;
  if (c.phase === 'turn' && c.turn === seat) v.tsumo = c.legalActions(seat).some((a) => a.type === 'tsumo');
  return v;
}

// 手里每种能打的牌各看一遍（同一种牌打哪张结果都一样，赤五单算）
export function foreseeAll(g: Game, seat: number, tiles: TileId[], riichi: boolean, ai: AiStyle[]): Map<string, Vision> {
  const out = new Map<string, Vision>();
  for (const t of tiles) {
    const key = visionKey(t);
    if (!out.has(key)) out.set(key, foresee(g, seat, t, riichi, ai));
  }
  return out;
}

export const visionKey = (t: TileId): string => `${kindOf(t)}-${isRed(t)}`;
