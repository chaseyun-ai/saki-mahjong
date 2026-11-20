import { describe, expect, it } from 'vitest';
import { POND_LOOKS, type PondStyle, pondStyleOf } from '../src/ui/vary';
import { type PondItem, pondExtent, pondRows, pondSpots } from '../src/ui3d/pondLayout';
import { POND_COLS, POND_GAP, TILE_H, TILE_W, WALL_Z } from '../src/ui3d/tableLayout';

const STYLES: PondStyle[] = ['neat', 'natural', 'loose', 'messy'];
const POND_Z = 3.6;
const WALL_INNER = WALL_Z - TILE_H / 2;
// 2.5D 原版布局对家的牌山往中间收了 0.8，第三行跟前只剩一条缝
const WALL_INNER_TIGHT = WALL_INNER - 0.8;

// 一家打了 n 张，第 riichi 张是立直宣言牌（横放）
const pond = (n: number, riichi = -1, first = 0): PondItem[] => Array.from({ length: n }, (_, i) => ({ tile: (first + i * 7) % 136, side: i === riichi }));

// 牌的四个角（座位自己的坐标）
function corners(item: PondItem, spot: { x: number; z: number; yaw: number }): [number, number][] {
  const w = (item.side ? TILE_H : TILE_W) / 2;
  const h = (item.side ? TILE_W : TILE_H) / 2;
  const c = Math.cos(spot.yaw);
  const s = Math.sin(spot.yaw);
  return [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
  ].map(([x, z]) => [spot.x + x * c + z * s, spot.z - x * s + z * c]);
}

// 两个凸四边形有没有叠在一起（分离轴）
function overlap(a: [number, number][], b: [number, number][]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = poly[i];
      const [x1, z1] = poly[(i + 1) % 4];
      const nx = z1 - z0;
      const nz = x0 - x1;
      const dots = (p: [number, number][]) => p.map(([x, z]) => x * nx + z * nz);
      const da = dots(a);
      const db = dots(b);
      if (Math.max(...da) <= Math.min(...db) + 1e-9 || Math.max(...db) <= Math.min(...da) + 1e-9) return false;
    }
  }
  return true;
}

describe('牌河摆放', () => {
  it('整齐：照格子摆，一点不歪；自然：和原来一样只歪一点点', () => {
    const items = pond(18, 7);
    const rows = pondRows('neat', POND_Z, WALL_INNER);
    expect(rows).toEqual({ z0: POND_Z, pitch: TILE_H + POND_GAP });
    const neat = pondSpots(items, 'neat', 99, 1, rows);
    let x = -((POND_COLS * (TILE_W + POND_GAP)) / 2);
    neat.forEach((s, i) => {
      if (i % POND_COLS === 0) x = -((POND_COLS * (TILE_W + POND_GAP)) / 2);
      const w = items[i].side ? TILE_H : TILE_W;
      expect(s.x).toBeCloseTo(x + w / 2);
      expect(s.z).toBeCloseTo(POND_Z + Math.floor(i / POND_COLS) * (TILE_H + POND_GAP) + TILE_H / 2);
      expect(s.yaw).toBe(0);
      x += w + POND_GAP;
    });
    const natural = pondSpots(items, 'natural', 99, 1, pondRows('natural', POND_Z, WALL_INNER));
    natural.forEach((s, i) => {
      expect(Math.abs(s.x - neat[i].x)).toBeLessThanOrEqual(POND_LOOKS.natural.shiftX);
      expect(Math.abs(s.z - neat[i].z)).toBeLessThanOrEqual(POND_LOOKS.natural.shiftZ);
      expect(Math.abs(s.yaw)).toBeLessThanOrEqual(POND_LOOKS.natural.twist);
    });
  });

  it('同一局同一张牌每次算出来一样，换一局换个样子', () => {
    const items = pond(15, 4);
    const rows = pondRows('messy', POND_Z, WALL_INNER);
    expect(pondSpots(items, 'messy', 5, 2, rows)).toEqual(pondSpots(items, 'messy', 5, 2, rows));
    expect(pondSpots(items, 'messy', 5, 2, rows)).not.toEqual(pondSpots(items, 'messy', 6, 2, rows));
    // 后面再打牌，前面已经摆好的不挪窝
    const more = pondSpots(pond(16, 4), 'messy', 5, 2, rows);
    expect(more.slice(0, 15)).toEqual(pondSpots(items, 'messy', 5, 2, rows));
  });

  it('怎么歪都不压牌：任何两张不叠，每张都在自己那一行里', () => {
    for (const style of STYLES) {
      for (const wall of [WALL_INNER, WALL_INNER_TIGHT]) {
        const rows = pondRows(style, POND_Z, wall);
        for (let salt = 1; salt <= 60; salt++) {
          // 第三行可以超过六张；立直宣言牌在哪一张都试到
          const items = pond(22, salt % 20, salt);
          const spots = pondSpots(items, style, salt * 7919, salt % 4, rows);
          const boxes = spots.map((s, i) => corners(items[i], s));
          for (let i = 0; i < boxes.length; i++) {
            const row = Math.min(2, Math.floor(i / POND_COLS));
            const center = rows.z0 + row * rows.pitch + TILE_H / 2;
            for (const [, z] of boxes[i]) expect(Math.abs(z - center), `${style} salt=${salt} #${i}`).toBeLessThan(rows.pitch / 2);
            for (let k = i + 1; k < boxes.length; k++) expect(overlap(boxes[i], boxes[k]), `${style} salt=${salt} #${i}/#${k}`).toBe(false);
          }
        }
      }
    }
  });

  it('摆得松的行距大一点；跟前放不下就少加一点，第三行不压牌山，也不往中间挤太多', () => {
    for (const style of ['loose', 'messy'] as const) {
      const wide = pondRows(style, POND_Z, WALL_INNER);
      expect(wide.z0).toBe(POND_Z);
      expect(wide.pitch).toBeCloseTo(TILE_H + POND_GAP + POND_LOOKS[style].rowGap);
      const tight = pondRows(style, POND_Z, WALL_INNER_TIGHT);
      expect(tight.pitch).toBeGreaterThanOrEqual(TILE_H + POND_GAP);
      expect(tight.pitch).toBeLessThanOrEqual(wide.pitch);
      expect(POND_Z - tight.z0).toBeLessThanOrEqual(0.08 + 1e-9);
      // 第三行最外面（连牌歪出去的那一点）到不了牌山
      const outer = tight.z0 + 2 * tight.pitch + TILE_H / 2 + tight.pitch / 2;
      expect(outer).toBeLessThan(WALL_INNER_TIGHT);
    }
  });

  it('凌乱比随手歪得多，随手比自然歪得多', () => {
    const spread = (style: PondStyle) => {
      let sum = 0;
      for (let salt = 1; salt <= 40; salt++) for (const s of pondSpots(pond(18), style, salt, 0, pondRows(style, POND_Z, WALL_INNER))) sum += Math.abs(s.yaw);
      return sum;
    };
    expect(spread('neat')).toBe(0);
    expect(spread('natural')).toBeGreaterThan(0);
    expect(spread('loose')).toBeGreaterThan(spread('natural') * 1.5);
    expect(spread('messy')).toBeGreaterThan(spread('loose') * 1.3);
  });

  it('横放的牌占的地方算对了', () => {
    expect(pondExtent(false, 0)).toEqual({ hx: TILE_W / 2, hz: TILE_H / 2 });
    expect(pondExtent(true, 0)).toEqual({ hx: TILE_H / 2, hz: TILE_W / 2 });
    expect(pondExtent(false, 0.1).hx).toBeGreaterThan(TILE_W / 2);
  });

  it('看角色：和照着她的手风走，最多比平时齐一档或者乱一档；选了哪一种就是哪一种', () => {
    const order: PondStyle[] = ['neat', 'natural', 'loose', 'messy'];
    const seen = new Set<PondStyle>();
    for (let salt = 0; salt < 200; salt++) {
      const nodoka = pondStyleOf('nodoka', 'char', salt, 0);
      expect(order.indexOf(nodoka)).toBeLessThanOrEqual(1);
      const yuuki = pondStyleOf('yuuki', 'char', salt, 1);
      expect(order.indexOf(yuuki)).toBeGreaterThanOrEqual(2);
      seen.add(pondStyleOf('saki', undefined, salt, 2));
      expect(pondStyleOf('yuuki', 'neat', salt, 1)).toBe('neat');
    }
    expect([...seen].sort()).toEqual(['loose', 'natural', 'neat']);
  });
});
