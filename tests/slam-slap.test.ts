import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SlapMotion } from '../src/ui3d/slamSlap';
import { TILE_H } from '../src/ui3d/tableLayout';

// 通用的自摸拍牌：夹着牌斜着举起来，牌面朝上拍在落点
const side = new THREE.Vector3(1, 0, 0);
const out = new THREE.Vector3(0, 0, 1);
// 牌面朝上、牌顶朝桌子中间（-z）躺着，稍微歪一点
const faceUp = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0.1, 0, 'YXZ'));
const to = { pos: new THREE.Vector3(7, 0.39, 12.5), quat: faceUp, scale: 1 };
// 她手里立着的那张（牌面朝她）
const standing = { pos: new THREE.Vector3(6.8, TILE_H / 2, 12), quat: new THREE.Quaternion(), scale: 1 };

describe('通用的自摸拍牌', () => {
  it('自己拍：牌一开始就在手里，拍下去正好牌面朝上躺在落点，手抬走', () => {
    const m = new SlapMotion({ to, side, out, hand: true, near: true });
    const end = m.frame(m.hitAt + 0.01);
    expect(end.tile.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
    expect(end.tile.quat.angleTo(to.quat)).toBeLessThan(1e-6);
    // 拍下去之前一点点：牌已经快贴到落点、差不多平了
    const before = m.frame(m.hitAt - 0.005);
    expect(before.tile.pos.distanceTo(to.pos)).toBeLessThan(0.6);
    expect(m.frame(m.doneAt + 0.01).hand).toBeNull();
    expect(m.frame(m.hitAt + 0.05).hand).not.toBeNull();
  });

  it('举起来时牌斜着、比落点高，手腕不钻到桌子底下', () => {
    const m = new SlapMotion({ to, side, out, hand: true, from: standing });
    for (let k = 0; k < m.doneAt; k += 0.02) {
      const f = m.frame(k);
      if (f.hand) expect(f.hand.pos.y).toBeGreaterThan(0.3);
    }
    const top = m.frame(m.hitAt - 0.12).tile;
    expect(top.pos.y).toBeGreaterThan(to.pos.y + 2);
    const tilt = top.quat.angleTo(to.quat);
    expect(tilt).toBeGreaterThan(0.4);
    expect(tilt).toBeLessThan(1.4);
  });

  it('别人拍：先伸手过去，牌在她手里原样不动，夹起来以后才跟着手走', () => {
    const m = new SlapMotion({ to, side, out, hand: true, from: standing });
    expect(m.frame(0).tile.pos.distanceTo(standing.pos)).toBeLessThan(1e-6);
    expect(m.frame(0.2).tile.pos.distanceTo(standing.pos)).toBeLessThan(1e-6);
    expect(m.frame(m.hitAt + 0.01).tile.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
  });

  it('手牌什么时候倒：先倒在一开始，边举边倒在拿起来时，拍了再倒就是拍下去那一下', () => {
    const first = new SlapMotion({ to, side, out, hand: true, from: standing, order: 'first' });
    const lift = new SlapMotion({ to, side, out, hand: true, from: standing, order: 'lift' });
    const slap = new SlapMotion({ to, side, out, hand: true, from: standing, order: 'slap' });
    expect(first.revealAt).toBeLessThan(0.1);
    expect(lift.revealAt).toBeGreaterThan(first.revealAt);
    expect(lift.revealAt).toBeLessThan(lift.hitAt - 0.3);
    expect(slap.revealAt).toBeCloseTo(slap.hitAt);
    // 拍下去就是落桌、炸开那一下，没有聚光
    expect(first.pressAt).toBeCloseTo(first.hitAt);
    expect(first.chargeDur).toBe(0);
  });

  it('不带手：牌自己从原处跳起来拍下去', () => {
    const m = new SlapMotion({ to, side, out, hand: false, from: standing });
    expect(m.frame(0).hand).toBeNull();
    expect(m.frame(0).tile.pos.distanceTo(standing.pos)).toBeLessThan(1e-6);
    expect(m.frame(m.hitAt + 0.01).tile.quat.angleTo(to.quat)).toBeLessThan(1e-6);
    expect(m.doneAt).toBeCloseTo(m.hitAt + 0.05);
  });
});
