import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISCARD,
  DiscardPath,
  RIICHI_DISCARD,
  markers,
  phaseAt,
  sampleDiscard,
  totalTime,
} from '../src/ui3d/discardMotion';

const path = (): DiscardPath => ({
  from: new THREE.Vector3(2, 0.85, 11.3),
  fromQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.32, 0, 0)),
  to: new THREE.Vector3(-1.5, 0.39, 4.3),
  toQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
  toward: new THREE.Vector3(0, 0, 1),
  scale: 23,
});

describe('出牌动作', () => {
  it('标记按顺序排列，时刻由参数算出', () => {
    const p = DEFAULT_DISCARD;
    const m = markers(p);
    expect(m.map((x) => x.name)).toEqual(['depart', 'grab', 'land', 'release', 'done']);
    expect(m.map((x) => x.t)).toEqual([0, 0.3, 0.3 + 0.34, 0.3 + 0.34 + 0.22, totalTime(p)]);
    for (let i = 1; i < m.length; i++) expect(m[i].t).toBeGreaterThanOrEqual(m[i - 1].t);
    // 放铳时手停住：松手和收回往后推，落桌不变
    const held = markers(p, 1.5);
    expect(held[2].t).toBe(m[2].t);
    expect(held[3].t).toBeCloseTo(m[3].t + 1.5);
  });

  it('出发前牌在手里，落桌后在牌河里', () => {
    for (const p of [DEFAULT_DISCARD, RIICHI_DISCARD]) {
      const start = sampleDiscard(p, path(), 0);
      expect(start.tilePos.distanceTo(path().from)).toBeLessThan(1e-9);
      expect(start.weight).toBe(0);
      const land = markers(p).find((x) => x.name === 'land')!.t;
      const after = sampleDiscard(p, path(), land + 1e-6);
      expect(after.tilePos.distanceTo(path().to)).toBeLessThan(1e-9);
      expect(after.holding).toBe(false);
      const end = sampleDiscard(p, path(), totalTime(p));
      expect(end.weight).toBeCloseTo(0);
      expect(phaseAt(p, totalTime(p) + 0.01)).toBe('done');
    }
  });

  it('牌和手腕的位置随时间连续变化，没有跳变', () => {
    const p = DEFAULT_DISCARD;
    const step = 1 / 600;
    let prev = sampleDiscard(p, path(), 0);
    for (let t = step; t <= totalTime(p); t += step) {
      const cur = sampleDiscard(p, path(), t);
      // 搬运最快的时候一帧（1/600 秒）也走不了 0.2 个牌宽
      expect(cur.tilePos.distanceTo(prev.tilePos)).toBeLessThan(0.2);
      expect(cur.wrist.distanceTo(prev.wrist)).toBeLessThan(0.2);
      expect(Math.abs(cur.weight - prev.weight)).toBeLessThan(0.05);
      prev = cur;
    }
  });

  it('搬运途中牌抬起来，最高点接近 lift', () => {
    const p = DEFAULT_DISCARD;
    let top = -Infinity;
    for (let t = p.reach; t < p.reach + p.carry; t += 0.005) top = Math.max(top, sampleDiscard(p, path(), t).tilePos.y);
    const base = Math.max(path().from.y, path().to.y);
    expect(top).toBeGreaterThan(base + p.lift * 0.8);
    expect(top).toBeLessThan(base + p.lift + 0.01);
  });

  it('同样的参数和时间得到同样的姿势', () => {
    const a = sampleDiscard(DEFAULT_DISCARD, path(), 0.47);
    const b = sampleDiscard(DEFAULT_DISCARD, path(), 0.47);
    expect(a.wrist.equals(b.wrist)).toBe(true);
    expect(a.tileQuat.equals(b.tileQuat)).toBe(true);
  });
});
