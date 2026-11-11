import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FLICK_HAND, FlickMotion } from '../src/ui3d/slamFlick';
import { COCKED, OPEN, thumbNail } from '../src/ui3d/slamHand';
import { TILE_H, TILE_T } from '../src/ui3d/tableLayout';

// 竹井久那一套：握着拳把牌放在大拇指指甲盖上伸进来亮牌，大拇指一弹，手扣住砸下去，砸下去时正好躺在落点
const side = new THREE.Vector3(1, 0, 0);
const out = new THREE.Vector3(0, 0, 1);
// 牌面朝上、牌顶朝桌子中间（-z）躺着
const faceUp = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const to = { pos: new THREE.Vector3(7, 0.39, 12.5), quat: faceUp, scale: 1 };
// 她手里立着的那张（手牌右边隔开半张，牌面朝自己）
const standing = { pos: new THREE.Vector3(7, TILE_H / 2, 11.2), quat: new THREE.Quaternion(), scale: 1 };
const up = new THREE.Vector3(0, 1, 0);
// 手在第 k 秒时大拇指指甲盖正中间在哪
const nailAt = (m: FlickMotion, k: number) => {
  const h = m.frame(k).hand!;
  return thumbNail(h.pose ?? OPEN).at.multiplyScalar(FLICK_HAND).applyQuaternion(h.quat).add(h.pos);
};

describe('竹井久的摔牌', () => {
  it('自己自摸：牌一开始就在指甲盖上跟着拳头进来，砸下去以后躺在落点，手撤走', () => {
    const m = new FlickMotion({ to, side, out, hand: true, near: true });
    // 一开始拳头在她身前（比落点靠外），牌已经在指甲盖上
    const first = m.frame(0);
    expect(first.hand!.pose).toBe(COCKED);
    expect(first.tile.pos.clone().sub(to.pos).dot(out)).toBeGreaterThan(5);
    for (let k = 0; k < m.flickAt; k += 0.02) {
      const fr = m.frame(k);
      const face = new THREE.Vector3(0, 0, 1).applyQuaternion(fr.tile.quat);
      expect(nailAt(m, k).distanceTo(fr.tile.pos.clone().addScaledVector(face, -TILE_T / 2))).toBeLessThan(1e-6);
    }
    const end = m.frame(m.hitAt + 0.01);
    expect(end.tile.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
    expect(end.tile.quat.angleTo(to.quat)).toBeLessThan(1e-6);
    expect(m.revealAt).toBeLessThan(m.flickAt);
    expect(m.flickAt).toBeLessThan(m.chargeAt);
    expect(m.chargeAt).toBeLessThan(m.hitAt);
    expect(m.hitAt).toBeLessThanOrEqual(m.doneAt);
    expect(m.frame(m.doneAt + 0.01).hand).toBeNull();
  });

  it('握拳把牌放在大拇指指甲盖上：牌面朝上、稍微往前倾，停一下再弹', () => {
    const m = new FlickMotion({ to, side, out, hand: true, near: true });
    // 拳头停稳到快弹之前：牌停在指甲盖上不动
    const rest = m.frame(m.revealAt + 0.01);
    expect(m.frame(m.flickAt - 0.22).tile.pos.distanceTo(rest.tile.pos)).toBeLessThan(1e-6);
    expect(m.flickAt - m.revealAt).toBeGreaterThan(0.3);
    // 就在落点正上方，比桌上的手牌高
    expect(rest.tile.pos.clone().setY(0).distanceTo(to.pos.clone().setY(0))).toBeLessThan(1e-6);
    expect(rest.tile.pos.y - to.pos.y).toBeGreaterThan(1.5);
    // 牌面朝上，靠桌子中间那条边低一点（往前倾 10 到 25 度）
    const face = new THREE.Vector3(0, 0, 1).applyQuaternion(rest.tile.quat);
    const top = new THREE.Vector3(0, 1, 0).applyQuaternion(rest.tile.quat);
    expect(face.dot(up)).toBeGreaterThan(0.9);
    const tilt = Math.asin(-top.dot(up));
    expect(tilt).toBeGreaterThan((10 * Math.PI) / 180);
    expect(tilt).toBeLessThan((25 * Math.PI) / 180);
    // 手握着拳，指甲朝上贴着牌底
    const hand = rest.hand!;
    expect(hand.pose).toBe(COCKED);
    expect(thumbNail(COCKED).up.applyQuaternion(hand.quat).dot(face)).toBeGreaterThan(0.95);
    // 拳头立在桌面上，不钻到桌子底下：小指那边（手里坐标 +x）离手掌中心最远 1.2
    for (let k = 0; k < m.flickAt; k += 0.02) expect(m.frame(k).hand!.pos.y - 1.2 * FLICK_HAND).toBeGreaterThan(to.pos.y - TILE_T / 2);
  });

  it('大拇指一弹牌才离手：弹之前之后牌不跳，弹完手张开去接', () => {
    const m = new FlickMotion({ to, side, out, hand: true, near: true });
    const before = m.frame(m.flickAt - 0.001).tile;
    const after = m.frame(m.flickAt + 0.001).tile;
    expect(after.pos.distanceTo(before.pos)).toBeLessThan(0.1);
    expect(after.quat.angleTo(before.quat)).toBeLessThan(0.1);
    // 弹出去那一下大拇指挑起来：指甲盖比弹之前高
    expect(nailAt(m, m.flickAt + 0.06).y - nailAt(m, m.flickAt - 0.001).y).toBeGreaterThan(0.8);
    // 牌一直在大拇指上面，不穿过手
    for (let k = m.flickAt; k < m.flickAt + 0.1; k += 0.005) expect(m.frame(k).tile.pos.y).toBeGreaterThan(nailAt(m, k).y - 0.05);
    // 扣住的时候手已经张开了
    expect(m.frame(m.chargeAt + 0.1).hand!.pose ?? OPEN).toBe(OPEN);
    expect(m.frame(m.hitAt + 0.01).hand!.pose ?? OPEN).toBe(OPEN);
  });

  it('弹得够高：最高处比落点高十张牌宽以上，升到最高时牌面朝上', () => {
    const m = new FlickMotion({ to, side, out, hand: true, near: true });
    expect(m.chargePoint.y - to.pos.y).toBeGreaterThan(10);
    expect(m.frame(m.chargeAt + 0.09).tile.quat.angleTo(to.quat)).toBeLessThan(1e-6);
  });

  it('别家自摸：牌一开始在她手里原样不动，手伸进来的路上飘到指甲盖上', () => {
    const m = new FlickMotion({ to, from: standing, side, out, hand: true });
    const first = m.frame(0).tile;
    expect(first.pos.distanceTo(standing.pos)).toBeLessThan(1e-6);
    expect(first.quat.angleTo(standing.quat)).toBeLessThan(1e-6);
    // 拳头停稳的时候牌已经在指甲盖上了
    const rest = m.frame(m.revealAt - 0.05);
    const face = new THREE.Vector3(0, 0, 1).applyQuaternion(rest.tile.quat);
    expect(nailAt(m, m.revealAt - 0.05).distanceTo(rest.tile.pos.clone().addScaledVector(face, -TILE_T / 2))).toBeLessThan(1e-6);
    expect(m.frame(m.hitAt + 0.01).tile.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
  });

  it('不带手：没有手，牌从原处自己翻到落点，牌面朝上停一下再跳', () => {
    const m = new FlickMotion({ to, from: standing, side, out, hand: false });
    expect(m.frame(0).hand).toBeNull();
    expect(m.frame(0).tile.pos.distanceTo(standing.pos)).toBeLessThan(1e-6);
    for (let k = m.revealAt + 0.001; k < m.flickAt - 0.01; k += 0.02) {
      const p = m.frame(k).tile;
      expect(p.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
      expect(p.quat.angleTo(to.quat)).toBeLessThan(1e-6);
    }
    expect(m.frame(m.hitAt + 0.01).tile.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
    expect(m.doneAt).toBeCloseTo(m.hitAt + 0.05);
  });

  it('最高处在画面里，不压着两边的头像框', () => {
    const cam = new THREE.PerspectiveCamera(40, 1.6, 0.1, 1000);
    cam.position.set(0, 30, 26);
    cam.lookAt(0, 0, 2);
    cam.updateMatrixWorld();
    const view = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, aspect: cam.aspect };
    for (const x of [-7, 0, 7, 9]) {
      const m = new FlickMotion({ to: { ...to, pos: new THREE.Vector3(x, 0.39, 12.5) }, side, out, hand: true, cam: view, near: true });
      const q = m.chargePoint.clone().project(cam);
      expect(Math.abs(q.x)).toBeLessThan(0.63);
      expect(q.y).toBeLessThan(0.87);
    }
  });

  it('别家：拳头伸到画面里亮牌，牌从那里弹起来，一路都在画面里，最后砸回落点', () => {
    // 真牌局的镜头（2.5D 横屏）
    const cam = new THREE.PerspectiveCamera(28, 1.6, 0.1, 1000);
    cam.position.set(0, 30.73, 29.4);
    cam.quaternion.set(-0.4078, 0, 0, 0.9131).normalize();
    cam.updateMatrixWorld();
    const view = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, aspect: cam.aspect };
    // 下家、对家、上家：落点在她手牌右边（画面边上）
    const seats = [
      { rot: Math.PI / 2, at: new THREE.Vector3(12.6, 0.39, -7.2) },
      { rot: Math.PI, at: new THREE.Vector3(-7.2, 0.39, -13.2) },
      { rot: -Math.PI / 2, at: new THREE.Vector3(-12.6, 0.39, 7.2) },
    ];
    for (const seat of seats) {
      const R = new THREE.Quaternion().setFromAxisAngle(up, seat.rot);
      const sd = new THREE.Vector3(1, 0, 0).applyQuaternion(R);
      const ot = new THREE.Vector3(0, 0, 1).applyQuaternion(R);
      const lie = { pos: seat.at, quat: R.clone().multiply(faceUp), scale: 1 };
      const m = new FlickMotion({ to: lie, side: sd, out: ot, hand: true, cam: view, near: false });
      // 亮牌：牌在画面里，离左右两边的头像框、上边都有一段
      const show = m.frame(m.revealAt + 0.01).tile.pos.clone();
      const p = show.clone().project(cam);
      expect(Math.abs(p.x)).toBeLessThan(0.57);
      expect(p.y).toBeLessThan(0.59);
      // 没挪到落点正上方以外太远的地方去凑数：确实离开了落点（落点本身在画面边上）
      expect(show.clone().setY(0).distanceTo(seat.at.clone().setY(0))).toBeGreaterThan(2);
      // 弹上去：画面上一直在画面里，最高处比亮牌的地方高
      for (let k = m.flickAt; k <= m.chargeAt + 0.08; k += 0.02) {
        const q = m.frame(k).tile.pos.clone().project(cam);
        expect(Math.abs(q.x)).toBeLessThan(0.63);
        expect(q.y).toBeLessThan(0.9);
        expect(q.y).toBeGreaterThan(p.y - 0.02);
      }
      expect(m.chargePoint.clone().project(cam).y).toBeGreaterThan(p.y + 0.15);
      // 砸回手牌旁边的落点
      const end = m.frame(m.hitAt + 0.01);
      expect(end.tile.pos.distanceTo(seat.at)).toBeLessThan(1e-6);
      expect(end.tile.quat.angleTo(lie.quat)).toBeLessThan(1e-6);
    }
  });

  it('别家：伸出去的地方底下摆着牌，拳头就悬在牌上面', () => {
    const cam = new THREE.PerspectiveCamera(28, 1.6, 0.1, 1000);
    cam.position.set(0, 30.73, 29.4);
    cam.quaternion.set(-0.4078, 0, 0, 0.9131).normalize();
    cam.updateMatrixWorld();
    const view = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, aspect: cam.aspect };
    const R = new THREE.Quaternion().setFromAxisAngle(up, -Math.PI / 2);
    const spec = { to: { pos: new THREE.Vector3(-12.6, 0.39, 7.2), quat: R.clone().multiply(faceUp), scale: 1 }, side: new THREE.Vector3(1, 0, 0).applyQuaternion(R), out: new THREE.Vector3(0, 0, 1).applyQuaternion(R), hand: true, cam: view, near: false };
    const clear = new FlickMotion(spec).frame(0.5).tile.pos;
    const stacked = new FlickMotion({ ...spec, over: () => 1.56 }).frame(0.5).tile.pos;
    expect(stacked.y - clear.y).toBeGreaterThan(1.56);
    expect(stacked.y - clear.y).toBeLessThan(2.2);
  });
});
