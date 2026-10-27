import { Game } from '../engine/game';
import { TileId } from '../engine/tiles';

// 动作调试场景的牌面：用固定种子发一局牌，再摆成"某家准备出牌"的样子。
// 牌局本身不往下走，这里只是把牌挪到该在的位置，不涉及任何规则判断。

export const LAB_SEED = 20261023;

export interface LabSetup {
  seat: number; // 出牌的人坐在哪（绝对座位，0 是镜头这边）
  handSlot: number; // 打手牌里从左数第几张（0 开始，理好牌的顺序）；HAND_SLOTS 表示打刚摸到的牌
  pondSlot: number; // 落到牌河第几张（0 开始，六张一行）
  sideways: boolean; // 横放（立直宣言牌）
}

export const HAND_SLOTS = 13;
export const POND_SLOTS = 18;

export interface LabScene {
  game: Game;
  tile: TileId; // 要打出去的那张
}

// 出牌前的样子：出牌的人 13 张加一张刚摸的牌，其他人 13 张；
// 每家牌河里已经有 pondSlot 张（牌从牌山前面拿，牌山跟着变短）
export function composeScene(names: string[], s: LabSetup): LabScene {
  const game = new Game({ seed: LAB_SEED, players: names.map((name) => ({ name })) });
  const wall = game.wall.live;
  // 庄家开局多拿的那张放回牌山
  for (const p of game.players) {
    if (p.drawn === null) continue;
    p.hand = p.hand.filter((t) => t !== p.drawn);
    wall.unshift(p.drawn);
    p.drawn = null;
  }
  const me = game.players[s.seat];
  const drawn = wall.shift()!;
  me.hand.push(drawn);
  me.drawn = drawn;
  for (let k = 0; k < s.pondSlot; k++) {
    for (let i = 0; i < 4; i++) {
      const p = game.players[(s.seat + i) % 4];
      const t = wall.shift();
      if (t === undefined) break;
      p.discards.push({ tile: t, riichi: false, tsumogiri: false, called: false });
    }
  }
  game.turn = s.seat;
  const sorted = me.hand.filter((t) => t !== drawn).sort((a, b) => a - b);
  const tile = s.handSlot >= HAND_SLOTS ? drawn : sorted[Math.min(s.handSlot, sorted.length - 1)];
  return { game, tile };
}

// 把那张牌从手里拿走放进牌河（摸到的牌并进手牌）
export function applyDiscard(scene: LabScene, s: LabSetup): void {
  const p = scene.game.players[s.seat];
  const tsumogiri = scene.tile === p.drawn;
  p.hand = p.hand.filter((t) => t !== scene.tile);
  p.drawn = null;
  p.discards.push({ tile: scene.tile, riichi: s.sideways, tsumogiri, called: false });
}
