import { CHARACTERS, baseAi, type AiStyle } from '../abilities/characters';
import { cloneGame } from '../engine/clone';
import type { Action, Game } from '../engine/game';
import type { TileId } from '../engine/tiles';
import { chooseAction } from './ai';

// 怜的“你下一张”：在复制的牌局上往下打，直到她下一次摸牌，看她摸到什么。
// - 复制品有自己的牌山、能力状态和随机数，正式的牌局一点不碰（同一局面算不算预测，后面打出来都一样）
// - 走完整的摸牌流程：控场的人定规矩、摸牌人的能力、对账，都和正式牌局一样，所以已经生效的控场都算在里面
// - 范围和原来一样：假设这一巡没人吃碰杠、没人和牌（别人轮到自己时也不自摸、不暗杠加杠，照摸切处理），
//   别人怎么打照电脑的打法。真有人鸣牌、开杠、和牌，路线就变了，界面按新局面重新算（ForecastCache）
// - 轮到她自己打牌时要先说打哪张（discard），因为打法会影响别人怎么打

export interface ForecastOpts {
  discard?: TileId;
  riichi?: boolean;
}

// 一家按谁的打法：名字对得上角色（界面用中文名，测试用 id），对不上就用普通打法
function styleOf(g: Game, seat: number): AiStyle {
  const name = g.players[seat].name;
  return CHARACTERS.find((c) => c.name === name || c.id === name)?.ai ?? baseAi;
}

// 演算里别人轮到自己时只打牌：不自摸、不杠、不流局（打掉刚摸的那张）
function onlyDiscard(g: Game, seat: number, a: Action): Action | undefined {
  if (a.type === 'discard') return a;
  const p = g.players[seat];
  const legal = g.legalActions(seat).filter((x) => x.type === 'discard' && !x.riichi);
  return legal.find((x) => x.type === 'discard' && x.tile === p.drawn) ?? legal[0];
}

let depth = 0;

// 她（seat）下一次摸到的牌；轮不到她摸（一局先结束了）是 null。轮到她打牌时不给 discard 也是 null
export function forecastNextDraw(g: Game, seat: number, opts: ForecastOpts = {}): TileId | null {
  // 演算里不再套演算
  if (depth > 0) return null;
  if (g.phase !== 'turn' && g.phase !== 'calls') return null;
  const mine = g.phase === 'turn' && g.turn === seat;
  if (mine && opts.discard === undefined) return null;
  // 不能打的牌（比如食替）没法演算
  if (mine && !g.legalActions(seat).some((a) => a.type === 'discard' && a.tile === opts.discard && !!a.riichi === !!opts.riichi)) return null;
  depth++;
  try {
    const c = cloneGame(g);
    const start = c.events.length;
    if (mine) c.act(seat, { type: 'discard', tile: opts.discard!, riichi: !!opts.riichi });
    for (let guard = 0; guard < 80; guard++) {
      if (c.phase !== 'turn' && c.phase !== 'calls') return null;
      if (c.phase === 'calls') {
        // 没人鸣牌、没人和牌
        for (const s of c.waitingSeats()) c.act(s, { type: 'pass' });
        continue;
      }
      if (c.turn === seat) {
        const drew = c.events.slice(start).some((e) => e.type === 'draw' && e.seat === seat);
        return drew ? c.players[seat].drawn : null;
      }
      const s = c.turn;
      // 一张牌都打不了（立直的花田煌摸到的牌打出去会放铳被击飞，只能自摸）：算不出来
      const act = onlyDiscard(c, s, chooseAction(c, s, styleOf(c, s)));
      if (!act) return null;
      c.act(s, act);
    }
    return null;
  } finally {
    depth--;
  }
}

// 界面用：同一局面（事件数、该谁、牌山剩几张）同一个问法只算一次；局面一变就重新算，旧的结果不会留下来
export class ForecastCache {
  private memo = new Map<string, TileId | null>();
  private at = '';

  static stateKey(g: Game): string {
    return `${g.events.length}|${g.phase}|${g.turn}|${g.wall.remaining}|${g.wall.rinshan.length}`;
  }

  get(g: Game, seat: number, opts: ForecastOpts = {}): TileId | null {
    const at = ForecastCache.stateKey(g);
    if (at !== this.at) {
      this.memo.clear();
      this.at = at;
    }
    const key = `${seat}|${opts.discard ?? ''}|${!!opts.riichi}`;
    if (!this.memo.has(key)) this.memo.set(key, forecastNextDraw(g, seat, opts));
    return this.memo.get(key)!;
  }

  // 现在缓存的是哪个局面算出来的
  get stateAt(): string {
    return this.at;
  }
}
