import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FlickMotion } from '../src/ui3d/slamFlick';
import { TILE_H } from '../src/ui3d/tableLayout';

// 竹井久那一套：从拿的那张现在的样子开始（自摸时是手里那张；动作本身哪里都能拿，牌山上的也行），砸下去时正好躺在落点
const side = new THREE.Vector3(1, 0, 0);
const out = new THREE.Vector3(0, 0, 1);
// 牌面朝上、牌顶朝桌子中间（-z）躺着
const faceUp = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const to = { pos: new THREE.Vector3(7, 0.39, 12.5), quat: faceUp, scale: 1 };
// 牌山上背朝上的牌
const faceDown = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
const wall = (x: number, z: number) => ({ pos: new THREE.Vector3(x, 1.17, z), quat: faceDown.clone(), scale: 1 });

describe('竹井久的摔牌', () => {
  it('一开始牌在牌山上原样不动，砸下去以后躺在落点', () => {
    const from = wall(5, 9.45);
    const m = new FlickMotion({ to, from, side, out, hand: true, near: true });
    const first = m.frame(0);
    expect(first.tile.pos.distanceTo(from.pos)).toBeLessThan(1e-6);
    expect(first.tile.quat.angleTo(from.quat)).toBeLessThan(1e-6);
    expect(first.hand).not.toBeNull();
    const end = m.frame(m.hitAt + 0.01);
    expect(end.tile.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
    expect(end.tile.quat.angleTo(to.quat)).toBeLessThan(1e-6);
    expect(m.pressAt).toBeLessThan(m.chargeAt);
    expect(m.chargeAt).toBeLessThan(m.hitAt);
    expect(m.hitAt).toBeLessThanOrEqual(m.doneAt);
    expect(m.frame(m.doneAt + 0.01).hand).toBeNull();
  });

  it('对面牌山上的牌伸手、拿回来都要久一点，但不会慢太多', () => {
    const near = new FlickMotion({ to, from: wall(5, 9.45), side, out, hand: true });
    const far = new FlickMotion({ to, from: wall(-3, -9.45), side, out, hand: true });
    expect(far.hitAt).toBeGreaterThan(near.hitAt);
    expect(far.hitAt).toBeLessThan(near.hitAt + 1);
  });

  it('隔着桌子的牌山：手不伸过去，牌自己飞到她手边', () => {
    const from = wall(-3, -9.45);
    const m = new FlickMotion({ to, from, side, out, hand: true });
    expect(m.frame(0).tile.pos.distanceTo(from.pos)).toBeLessThan(1e-6);
    for (let k = 0; k < m.doneAt; k += 0.02) {
      const h = m.frame(k).hand;
      if (h) expect(h.pos.clone().setY(0).distanceTo(to.pos.clone().setY(0))).toBeLessThan(14);
    }
  });

  it('拿回来以后顺着牌山和手牌中间那条缝横着拖，不往牌山那边压', () => {
    for (const from of [wall(5, 9.45), wall(-6, 9.45), wall(-3, -9.45), wall(10.45, 0)]) {
      const m = new FlickMotion({ to, from, side, out, hand: true });
      // 翻过来之前（拖牌那一段）牌离落点往桌子中间最多一张牌高多一点
      for (let k = m.revealAt - 0.15; k < m.revealAt; k += 0.01) {
        const p = m.frame(k).tile.pos;
        expect(to.pos.z - p.z).toBeLessThan(1.7);
      }
    }
  });

  it('从牌山到拖到手牌右边一路不停：中间没有停下来的时候', () => {
    for (const from of [wall(5, 9.45), wall(-6, 9.45), wall(-3, -9.45), wall(10.45, 0)]) {
      for (const hand of [true, false]) {
        const m = new FlickMotion({ to, from, side, out, hand });
        const dt = 0.005;
        // 牌开始动的时刻
        let k0 = 0;
        while (m.frame(k0 + dt).tile.pos.distanceTo(from.pos) < 1e-6) k0 += dt;
        const speeds: number[] = [];
        for (let k = k0; k < m.revealAt - dt; k += dt) speeds.push(m.frame(k + dt).tile.pos.distanceTo(m.frame(k).tile.pos) / dt);
        const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
        // 起步、到头可以慢，中间一直走着（不到平均一半就算停顿）
        const mid = speeds.slice(Math.floor(speeds.length * 0.2), Math.floor(speeds.length * 0.65));
        expect(Math.min(...mid)).toBeGreaterThan(mean * 0.5);
      }
    }
  });

  it('弹上去之前先翻过来，牌面朝上在落点停一下', () => {
    const m = new FlickMotion({ to, from: wall(5, 9.45), side, out, hand: true, near: true });
    expect(m.revealAt).toBeLessThan(m.pressAt);
    // 翻之前牌背朝上
    expect(m.frame(m.revealAt - 0.01).tile.quat.angleTo(to.quat)).toBeGreaterThan(Math.PI * 0.75);
    for (let k = m.pressAt + 0.001; k < m.pressAt + 0.25; k += 0.02) {
      const p = m.frame(k).tile;
      expect(p.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
      expect(p.quat.angleTo(to.quat)).toBeLessThan(1e-6);
    }
  });

  it('弹得够高：最高处比落点高十张牌宽以上', () => {
    const m = new FlickMotion({ to, from: wall(5, 9.45), side, out, hand: true, near: true });
    expect(m.chargePoint.y - to.pos.y).toBeGreaterThan(10);
  });

  it('自摸时从手里立着的那张拿起来：指肚按着牌顶，手在牌靠自己这边，不穿过牌', () => {
    // 手牌右边隔开半张立着的那张（牌面朝自己）
    const standing = { pos: new THREE.Vector3(7, TILE_H / 2, 11.2), quat: new THREE.Quaternion(), scale: 1 };
    const m = new FlickMotion({ to, from: standing, side, out, hand: true, near: true });
    expect(m.frame(0).tile.pos.distanceTo(standing.pos)).toBeLessThan(1e-6);
    // 刚按住的时候：手掌在牌靠自己那边、比牌顶高
    let k0 = 0;
    while (m.frame(k0 + 0.005).tile.pos.distanceTo(standing.pos) < 1e-6) k0 += 0.005;
    const h = m.frame(k0).hand!;
    expect(h.pos.clone().sub(standing.pos).dot(out)).toBeGreaterThan(0);
    expect(h.pos.y).toBeGreaterThan(TILE_H);
    // 照样拖过来、翻过来亮牌、砸下去躺在落点
    expect(m.frame(m.pressAt + 0.1).tile.quat.angleTo(to.quat)).toBeLessThan(1e-6);
    expect(m.frame(m.hitAt + 0.01).tile.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
  });

  it('不带手：没有手，牌照样从牌山上过来', () => {
    const from = wall(5, 9.45);
    const m = new FlickMotion({ to, from, side, out, hand: false });
    expect(m.frame(0).hand).toBeNull();
    expect(m.frame(0).tile.pos.distanceTo(from.pos)).toBeLessThan(1e-6);
    expect(m.doneAt).toBeCloseTo(m.hitAt + 0.05);
  });

  it('最高处在画面里，不压着两边的头像框', () => {
    const cam = new THREE.PerspectiveCamera(40, 1.6, 0.1, 1000);
    cam.position.set(0, 30, 26);
    cam.lookAt(0, 0, 2);
    cam.updateMatrixWorld();
    const view = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, aspect: cam.aspect };
    for (const x of [-7, 0, 7, 9]) {
      const m = new FlickMotion({ to: { ...to, pos: new THREE.Vector3(x, 0.39, 12.5) }, from: wall(x - 2, 9.45), side, out, hand: true, cam: view, near: true });
      const q = m.chargePoint.clone().project(cam);
      expect(Math.abs(q.x)).toBeLessThan(0.63);
      expect(q.y).toBeLessThan(0.87);
    }
  });
});
