import type { Meld } from '../engine/score';
import type { TileId } from '../engine/tiles';

// 副露怎么摆（从副露的主人自己看，从左到右），2D、3D 牌桌和结算画面共用：
// 叫来的那张横着放，上家的放最左，对家的放中间（明杠是左数第二张），下家的放最右；
// 其余自己的牌从小到大。加杠加上去的那张横着叠在原来横着的那张上面。暗杠两头扣着。

export interface MeldSlot {
  tile: TileId;
  sideways: boolean;
  hidden: boolean; // 暗杠扣着的两张
  stacked?: TileId; // 加杠叠在这张上面的牌
}

export function meldLayout(m: Meld, seat: number): MeldSlot[] {
  const byId = (a: TileId, b: TileId) => a - b;
  if (m.type === 'ankan') {
    return [...m.tiles].sort(byId).map((tile, i) => ({ tile, sideways: false, hidden: i === 0 || i === 3 }));
  }
  const called = m.calledTile;
  const added = m.type === 'kakan' ? m.tiles[3] : undefined;
  const own = m.tiles.filter((t) => t !== called && t !== added).sort(byId);
  const slots: MeldSlot[] = own.map((tile) => ({ tile, sideways: false, hidden: false }));
  if (called === undefined || m.from === undefined) return slots;
  // 来源相对自己：3 上家，2 对家，1 下家
  const rel = (m.from - seat + 4) % 4;
  const at = rel === 3 ? 0 : rel === 2 ? 1 : own.length;
  slots.splice(at, 0, { tile: called, sideways: true, hidden: false, ...(added !== undefined ? { stacked: added } : {}) });
  return slots;
}
