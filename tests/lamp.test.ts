import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DARK, FLICK, FLICKER, Lamp, clockAt, flickAt } from '../src/ui3d/lamp';
import { clockAngles } from '../src/ui3d/consoleLooks';

// 深夜的熄灯换局（lamp.ts）：熄灯、黑里扫一圈收牌、再扫一圈码牌山、日光灯闪两下亮起来
const rects = [
  { x: 0, z: 9, hx: 8.5, hz: 0.68 },
  { x: 9, z: 0, hx: 0.68, hz: 8.5 },
  { x: 0, z: -9, hx: 8.5, hz: 0.68 },
  { x: -9, z: 0, hx: 0.68, hz: 8.5 },
];

const tile = (x: number, z: number) => {
  const o = new THREE.Object3D();
  o.position.set(x, 0.4, z);
  return o;
};

describe('深夜的熄灯换局', () => {
  it('表盘上的几点：12 点在对面正中，顺时针', () => {
    expect(clockAt(0, -5)).toBeCloseTo(0);
    expect(clockAt(5, 0)).toBeCloseTo(0.25);
    expect(clockAt(0, 5)).toBeCloseTo(0.5);
    expect(clockAt(-5, 0)).toBeCloseTo(0.75);
  });

  it('日光灯闪两下才亮稳：一秒里亮暗来回不到三下，闪的时候不到全亮', () => {
    expect(flickAt(0)).toBeCloseTo(DARK);
    expect(flickAt(FLICKER)).toBe(1);
    // 亮暗来回一次（亮上去再暗下来）算闪一下
    let flashes = 0;
    let rising = false;
    let prev = flickAt(0);
    for (let t = 0.005; t <= FLICKER; t += 0.005) {
      const v = flickAt(t);
      if (v > prev + 1e-6) rising = true;
      else if (v < prev - 1e-6 && rising) {
        flashes++;
        rising = false;
      }
      prev = v;
    }
    expect(flashes).toBe(2);
    expect(Math.max(...FLICK.slice(0, -2).map(([, v]) => v))).toBeLessThan(0.7);
  });

  it('收牌、码牌山都在黑里：熄了灯才动，码好才开灯，开灯以后才掷骰子', () => {
    const lamp = new Lamp();
    const objs = [tile(0, -7), tile(7, 0), tile(0, 7), tile(-7, 0)];
    const t0 = 10;
    lamp.sweep(objs, t0);
    const lead = lamp.rise(t0, rects);
    expect(lamp.lightAt(t0)).toBe(1);
    expect(lamp.lightAt(t0 + 0.15)).toBeCloseTo(DARK);
    // 码牌山的时候一直黑着；开灯那一刻（日光灯那一声）在码好以后
    const cues: [string, number][] = [];
    for (let t = t0; t <= t0 + lead + 0.01; t += 0.01) for (const c of lamp.update(t)) cues.push([c.cue, t - t0]);
    expect(cues.map(([c]) => c)).toEqual(['off', 'collect', 'stack', 'flicker']);
    const on = cues[3][1];
    const v = new THREE.Vector4();
    for (const r of rects) expect(lamp.wallPose(r.x, r.z, v)).toBe(true);
    expect(lamp.lightAt(t0 + on - 0.02)).toBeCloseTo(DARK);
    expect(lamp.lightAt(t0 + lead)).toBe(1);
    expect(lead).toBeGreaterThan(on + FLICKER - 0.01);
    // 旧牌都收走了
    expect(lamp.group.children.length).toBe(0);
    expect(lamp.busy).toBe(false);
  });

  it('扫一圈：12 点那墩先码上，3 点、6 点、9 点依次', () => {
    const lamp = new Lamp();
    lamp.update(0);
    lamp.rise(0, rects);
    const v = new THREE.Vector4();
    const when = (x: number, z: number) => {
      for (let t = 0; t < 3; t += 0.005) {
        lamp.update(t);
        if (lamp.wallPose(x, z, v)) return t;
      }
      return Infinity;
    };
    const order = [when(0, -9), when(9, 0), when(0, 9), when(-9, 0)];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('发牌前选技能：收完牌灯先亮回来，码牌山时再熄一次', () => {
    const lamp = new Lamp();
    lamp.sweep([tile(0, 7)], 0);
    for (let t = 0; t < 3; t += 0.01) lamp.update(t);
    expect(lamp.lightAt(3)).toBe(1);
    const lead = lamp.rise(3, rects);
    expect(lamp.lightAt(3.2)).toBeCloseTo(DARK);
    expect(lamp.lightAt(3 + lead)).toBe(1);
  });

  it('表盘的针：3 点 15 分时针在 3 点再过一点，分针正指 3 点', () => {
    const { hour, minute } = clockAngles(15, 15);
    expect(minute).toBeCloseTo(Math.PI / 2);
    expect(hour).toBeCloseTo(Math.PI / 2 + (Math.PI / 6) * 0.25);
    expect(clockAngles(0, 0).hour).toBe(0);
  });
});
