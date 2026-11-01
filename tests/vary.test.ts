import { describe, expect, it } from 'vitest';
import { DEFAULT_DISCARD } from '../src/ui3d/discardMotion';
import { POND_SHIFT_X, POND_TWIST, Vary, paceOf, pondJitter, vary, varyDiscard } from '../src/ui/vary';
import { TILE_H } from '../src/ui3d/tableLayout';

// table3d.ts 里牌河牌之间的缝
const POND_GAP = 0.04;

describe('随机微变化', () => {
  it('关掉时原样返回基准值', () => {
    const v = new Vary();
    v.reset(1, false);
    expect(v.jitter(550, 0.1)).toBe(550);
    expect(v.think(550, paceOf('yuuki'))).toBe(550);
    expect(v.pick('click', 3)).toBe(0);
    vary.reset(1, false);
    expect(varyDiscard(DEFAULT_DISCARD)).toBe(DEFAULT_DISCARD);
    expect(pondJitter(5, 17)).toEqual({ yaw: 0, dx: 0, dz: 0 });
  });

  it('同一个种子得到同一串变化', () => {
    const a = new Vary();
    const b = new Vary();
    a.reset(42, true);
    b.reset(42, true);
    for (let i = 0; i < 20; i++) expect(a.think(620, paceOf(''))).toBe(b.think(620, paceOf('')));
  });

  it('浮动不超过给的幅度，平均还在原值附近', () => {
    const v = new Vary();
    v.reset(7, true);
    let sum = 0;
    for (let i = 0; i < 5000; i++) {
      const x = v.jitter(100, 0.1);
      expect(x).toBeGreaterThanOrEqual(90);
      expect(x).toBeLessThanOrEqual(110);
      sum += x;
    }
    expect(Math.abs(sum / 5000 - 100)).toBeLessThan(0.5);
  });

  it('电脑思考时间平均和原来的固定值一样，夹在范围里', () => {
    const v = new Vary();
    v.reset(3, true);
    const pace = paceOf('');
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const t = v.think(1000, pace);
      expect(t).toBeGreaterThanOrEqual(1000 * 0.7 * 0.93);
      expect(t).toBeLessThanOrEqual(1000 * 1.5 * 2.5);
      sum += t;
    }
    expect(Math.abs(sum / n - 1000)).toBeLessThan(15);
    // 立直后摸切不会长考
    for (let i = 0; i < 2000; i++) expect(v.think(1000, pace, true)).toBeLessThanOrEqual(1500);
  });

  it('角色快慢：优希比怜快', () => {
    expect(paceOf('yuuki').speed).toBeLessThan(paceOf('toki').speed);
    expect(paceOf('不存在的角色')).toEqual({ speed: 1, spread: 1 });
  });

  it('变体不连着两次一样', () => {
    const v = new Vary();
    v.reset(9, true);
    let prev = -1;
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const k = v.pick('click', 3);
      expect(k).not.toBe(prev);
      seen.add(k);
      prev = k;
    }
    expect(seen.size).toBe(3);
  });

  it('牌河：同一张牌每次歪得一样，相邻两张最坏也碰不上', () => {
    vary.reset(11, true);
    expect(pondJitter(5, 17)).toEqual(pondJitter(5, 17));
    expect(pondJitter(5, 17)).not.toEqual(pondJitter(6, 17));
    for (let t = 0; t < 136; t++) {
      const j = pondJitter(123, t);
      expect(Math.abs(j.yaw)).toBeLessThanOrEqual(POND_TWIST);
      expect(Math.abs(j.dx)).toBeLessThanOrEqual(POND_SHIFT_X);
    }
    // 两张牌朝相反方向转到头、又朝对方偏到头：转角让牌角伸出半个牌长 × 角度
    const worst = 2 * ((TILE_H / 2) * Math.sin(POND_TWIST) + POND_SHIFT_X);
    expect(worst).toBeLessThan(POND_GAP);
    vary.reset(0, false);
  });
});
