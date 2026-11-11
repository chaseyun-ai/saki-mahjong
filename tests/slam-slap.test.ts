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

  it('下家、上家（镜头从侧面看）：举得直、整张牌在画面里，最后一段垂直拍下去；自己和对家照旧', () => {
    // 真牌局的镜头（2.5D 横屏）
    const cam = new THREE.PerspectiveCamera(28, 1.6, 0.1, 1000);
    cam.position.set(0, 30.73, 29.4);
    cam.quaternion.set(-0.4078, 0, 0, 0.9131).normalize();
    cam.updateMatrixWorld();
    const view = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, aspect: cam.aspect };
    const up = new THREE.Vector3(0, 1, 0);
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const seat = (rot: number, at: THREE.Vector3, cv: typeof view | undefined) => {
      const R = new THREE.Quaternion().setFromAxisAngle(up, rot);
      const sd = new THREE.Vector3(1, 0, 0).applyQuaternion(R);
      const ot = new THREE.Vector3(0, 0, 1).applyQuaternion(R);
      const lie = { pos: at, quat: R.clone().multiply(flat), scale: 1 };
      const from = { pos: at.clone().addScaledVector(sd, -0.4).setY(TILE_H / 2), quat: R.clone(), scale: 1 };
      return { m: new SlapMotion({ to: lie, from, side: sd, out: ot, hand: true, cam: cv }), ot, lie };
    };
    // 下家（落点在画面右上角）、上家（左下角）
    for (const [rot, at] of [
      [Math.PI / 2, new THREE.Vector3(12.83, 0.39, -7.1)],
      [-Math.PI / 2, new THREE.Vector3(-13.01, 0.39, 7.4)],
    ] as const) {
      const { m, ot, lie } = seat(rot, at, view);
      const old = seat(rot, at, undefined).m;
      // 往桌子中间带出去多远、离落点多高（牌宽）
      const inward = (p: THREE.Vector3) => -p.clone().sub(at).dot(ot);
      // 蓄好劲（拍之前）：比落点高两张牌以上，往桌子中间不超过两张牌宽（原来是三张），整张牌在画面里
      const top = m.frame(m.hitAt - 0.1 - 1e-3).tile.pos;
      expect(top.y - at.y).toBeGreaterThan(2.4);
      expect(inward(top)).toBeLessThan(2);
      expect(inward(old.frame(old.hitAt - 0.1 - 1e-3).tile.pos)).toBeGreaterThan(2.8);
      for (let k = 0; k <= m.hitAt; k += 0.02) {
        const q = m.frame(k).tile.pos.clone().project(cam);
        expect(q.y).toBeLessThan(0.86);
        expect(Math.abs(q.x)).toBeLessThan(0.9);
      }
      // 拍下去：一路往下，离桌面一张牌高以内时已经在落点正上方、差不多放平了
      let last = top.y;
      for (let k = m.hitAt - 0.1; k < m.hitAt; k += 0.005) {
        const fr = m.frame(k);
        expect(fr.tile.pos.y).toBeLessThanOrEqual(last + 1e-6);
        last = fr.tile.pos.y;
        if (fr.tile.pos.y - at.y < 1) {
          expect(inward(fr.tile.pos)).toBeLessThan(0.15);
          expect(fr.tile.quat.angleTo(lie.quat)).toBeLessThan(0.12);
        }
      }
      // 原来是斜着划回来的：离桌面一张牌高时还在落点往里半张牌多的地方
      let slant = 0;
      for (let k = old.hitAt - 0.1; k < old.hitAt; k += 0.005) {
        const p = old.frame(k).tile.pos;
        if (p.y - at.y < 1) slant = Math.max(slant, inward(p));
      }
      expect(slant).toBeGreaterThan(0.5);
      const end = m.frame(m.hitAt + 0.01);
      expect(end.tile.pos.distanceTo(at)).toBeLessThan(1e-6);
      expect(end.tile.quat.angleTo(lie.quat)).toBeLessThan(1e-6);
      expect(m.hitAt).toBeCloseTo(old.hitAt, 6);
    }
    // 对家（顺着镜头看，看不出斜）：给不给镜头都一样
    const far = new THREE.Vector3(-7.32, 0.39, -12.88);
    const a = seat(Math.PI, far, view).m;
    const b = seat(Math.PI, far, undefined).m;
    for (let k = 0; k <= a.doneAt; k += 0.03) expect(a.frame(k).tile.pos.distanceTo(b.frame(k).tile.pos)).toBeLessThan(1e-9);
  });
});
