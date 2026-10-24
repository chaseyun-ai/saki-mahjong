import { describe, expect, it } from 'vitest';
import {
  CONSOLE_HALF,
  DEFAULT_LAYOUT,
  LAYOUT_KEYS,
  LAYOUT_LIMITS,
  POND_COLS,
  POND_GAP,
  POND_ROWS,
  TILE_H,
  TILE_T,
  TILE_W,
  TableLayout,
  WALL_Z,
  clampLayout,
  tableDims,
} from '../src/ui3d/tableLayout';

// 每个参数取最小、默认、最大，所有组合都试一遍
function combos(): TableLayout[] {
  let out: TableLayout[] = [{ ...DEFAULT_LAYOUT }];
  for (const k of LAYOUT_KEYS) {
    const [lo, hi] = LAYOUT_LIMITS[k];
    out = out.flatMap((l) => [lo, DEFAULT_LAYOUT[k], hi].map((v) => ({ ...l, [k]: v })));
  }
  return out;
}

describe('牌桌尺寸', () => {
  it('默认参数就是原来写死的位置', () => {
    expect(tableDims(DEFAULT_LAYOUT)).toEqual({
      scale: 23,
      handZ: 11,
      meldZ: 11.6,
      pondZ: 3.6,
      tableHalf: 14,
      frame: 1.4,
      bodyHalf: 15.4,
      seatZ: 20.9,
      seatY: -5.52,
    });
  });

  it('默认值落在可调范围里', () => {
    for (const k of LAYOUT_KEYS) {
      const [lo, hi] = LAYOUT_LIMITS[k];
      expect(DEFAULT_LAYOUT[k]).toBeGreaterThanOrEqual(lo);
      expect(DEFAULT_LAYOUT[k]).toBeLessThanOrEqual(hi);
    }
  });

  it('范围里怎么调，牌都不会撞到牌山、控制台、别家的牌河，也不会伸出桌框', () => {
    const list = combos();
    expect(list.length).toBe(3 ** LAYOUT_KEYS.length);
    for (const l of list) {
      const d = tableDims(l);
      // 手牌（自己的放大 1.25 倍，往外挪 0.3）不碰牌山
      expect(d.handZ - TILE_T / 2).toBeGreaterThan(WALL_Z + TILE_H / 2);
      expect(d.handZ + 0.3 - (TILE_T * 1.25) / 2).toBeGreaterThan(WALL_Z + TILE_H / 2);
      // 牌河三行都在牌山里面
      expect(d.pondZ + POND_ROWS * (TILE_H + POND_GAP)).toBeLessThan(WALL_Z - TILE_H / 2);
      // 牌河前面的立直棒不压控制台
      expect(d.pondZ - 0.5).toBeGreaterThan(CONSOLE_HALF);
      // 一行里有一张立直横放时，四家牌河的角也不撞
      const half = ((POND_COLS - 1) * (TILE_W + POND_GAP) + TILE_H + POND_GAP) / 2;
      expect(d.pondZ).toBeGreaterThan(half);
      // 倒牌、副露横放的牌不伸出桌框
      expect(d.handZ + 0.3 + TILE_H / 2).toBeLessThanOrEqual(d.tableHalf);
      expect(d.meldZ + (TILE_H - TILE_W) / 2 + TILE_H / 2).toBeLessThanOrEqual(d.tableHalf);
      // 人坐在桌子外面
      expect(d.seatZ).toBeGreaterThan(d.bodyHalf);
      expect(d.seatY).toBeLessThan(0);
    }
  });

  it('超出范围的值被拉回范围里', () => {
    const l = clampLayout({ ...DEFAULT_LAYOUT, size: 9, wallToPond: -1, seatGap: 0.2 });
    expect(l.size).toBe(LAYOUT_LIMITS.size[1]);
    expect(l.wallToPond).toBe(LAYOUT_LIMITS.wallToPond[0]);
    expect(l.seatGap).toBe(0.2);
  });
});
