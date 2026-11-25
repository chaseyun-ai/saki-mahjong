import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shuffle } from '../src/ui3d/shuffle';
import { type WashArea, type Washed, keepIn, randomSpot, spread, wash } from '../src/ui3d/wash';

// 原木的手搓洗牌：牌摊在仪表盘外面的一圈，四家用手一把一把推着洗（wash.ts），不是整堆绕着仪表盘转圈
const AREA: WashArea = { inX: 3.65, inZ: 3.65, outX: 9.1, outZ: 9.1 };

// 随机数换成定死的一串，每次跑出来一样
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pile(n: number): Washed[] {
  const ps: Washed[] = [];
  for (let i = 0; i < n; i++) {
    const at = randomSpot(AREA);
    ps.push({ ex: at.x, ez: at.y, m: Math.random() * 0.9, pushes: [] });
  }
  spread(ps, AREA, 6);
  return ps;
}

const inArea = (x: number, z: number, a: WashArea) =>
  (Math.abs(x) >= a.inX - 1e-6 || Math.abs(z) >= a.inZ - 1e-6) && Math.abs(x) <= a.outX + 1e-6 && Math.abs(z) <= a.outZ + 1e-6;

describe('原木：手搓洗牌', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(20261123));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('压到仪表盘上的往外挤，出圈的拉回来', () => {
    expect(keepIn({ x: 1, y: 0.5 }, AREA)).toEqual({ x: 3.65, y: 0.5 });
    expect(keepIn({ x: -0.2, y: -2 }, AREA)).toEqual({ x: -0.2, y: -3.65 });
    expect(keepIn({ x: 12, y: -30 }, AREA)).toEqual({ x: 9.1, y: -9.1 });
    // 中间那块不是方的（2D 牌桌）：往出去近的那边挤
    expect(keepIn({ x: 4, y: 1 }, { inX: 5, inZ: 2, outX: 9, outZ: 9 })).toEqual({ x: 5, y: 1 });
    expect(keepIn({ x: 1, y: 1.5 }, { inX: 5, inZ: 2, outX: 9, outZ: 9 })).toEqual({ x: 1, y: 2 });
  });

  it('一副牌摊开洗完都还在仪表盘外面、牌山线里面，每张都被推过，叠在一起的不多', () => {
    const ps = pile(136);
    const from = ps.map((p) => [p.ex, p.ez]);
    wash(ps, AREA, 0.3, 1.7);
    for (const p of ps) expect(inArea(p.ex, p.ez, AREA)).toBe(true);
    expect(ps.every((p) => p.pushes.length > 0)).toBe(true);
    // 每一下都在洗的那一段里开始；加起来就是从摊开的地方到最后的地方
    ps.forEach((p, i) => {
      let [x, z] = from[i];
      for (const u of p.pushes) {
        expect(u.t).toBeGreaterThanOrEqual(0.3);
        expect(u.t).toBeLessThan(1.7);
        x += u.dx;
        z += u.dz;
      }
      expect(x).toBeCloseTo(p.ex, 4);
      expect(z).toBeCloseTo(p.ez, 4);
    });
    // 两张牌的中心挨到半张牌以内的（差不多整张叠着）没几对
    let stacked = 0;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (Math.hypot(ps[i].ex - ps[j].ex, ps[i].ez - ps[j].ez) < 0.5) stacked++;
    expect(stacked).toBeLessThan(8);
  });

  it('不是整堆绕着仪表盘转：顺时针走的和逆时针走的牌都不少，平均下来没转多少', () => {
    const ps = pile(136);
    const from = ps.map((p) => Math.atan2(p.ez, p.ex));
    wash(ps, AREA, 0.3, 1.7);
    const turned = ps.map((p, i) => {
      const d = Math.atan2(p.ez, p.ex) - from[i];
      return Math.atan2(Math.sin(d), Math.cos(d));
    });
    const cw = turned.filter((d) => d > 0).length;
    expect(cw).toBeGreaterThan(ps.length * 0.25);
    expect(cw).toBeLessThan(ps.length * 0.75);
    // 原来是每张都往一个方向转 1.4 到 2.3 弧度
    expect(Math.abs(turned.reduce((a, b) => a + b, 0) / ps.length)).toBeLessThan(0.35);
  });

  it('3D 牌桌：牌扣过来摊在仪表盘四周洗，四家码好牌山往前推，码完桌上不剩替身牌', () => {
    const f = new Shuffle();
    f.build(14, 2.9);
    const objs: THREE.Object3D[] = [];
    for (let i = 0; i < 136; i++) {
      const o = new THREE.Object3D();
      o.position.set((Math.random() - 0.5) * 24, 0.4, (Math.random() - 0.5) * 24);
      objs.push(o);
    }
    f.sweep(objs, 0);
    expect(f.group.children.length).toBe(136);
    const cues: string[] = [];
    const step = (t: number) => cues.push(...f.update(t).map((c) => c.cue));
    // 都推进牌堆以后（0.65 秒）：躺平扣着，在牌山线里面；被推着走的路上最多蹭到仪表盘的边
    for (let t = 0.65; t < 1.6; t += 0.05) {
      step(t);
      for (const o of objs) {
        const c = Math.max(Math.abs(o.position.x), Math.abs(o.position.z));
        expect(c).toBeGreaterThan(2.9);
        expect(c).toBeLessThan(9.45);
      }
    }
    const walls = [
      { x: 0, z: 9.45, hx: 8.5, hz: 0.68 },
      { x: 0, z: -9.45, hx: 8.5, hz: 0.68 },
      { x: 9.45, z: 0, hx: 0.68, hz: 8.5 },
      { x: -9.45, z: 0, hx: 0.68, hz: 8.5 },
    ];
    const lead = f.rise(1.6, walls);
    expect(lead).toBeGreaterThan(0.5);
    // 还没轮到的那一墩先藏着
    const out = new THREE.Vector4();
    expect([-8, -4, 0, 4, 8].some((x) => !f.wallPose(x, 9.45, out))).toBe(true);
    for (let t = 1.6; t < 1.6 + lead + 0.3; t += 1 / 30) step(t);
    expect(f.group.children.length).toBe(0);
    expect(f.busy).toBe(false);
    expect(f.wallPose(0, 9.45, out)).toBe(true);
    expect(out.toArray().every((v) => Math.abs(v) < 1e-6)).toBe(true);
    expect(cues).toEqual(expect.arrayContaining(['scoop', 'shuffle', 'build', 'push']));
  });
});
