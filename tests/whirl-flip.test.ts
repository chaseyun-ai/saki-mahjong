import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_T, TILE_W } from '../src/ui3d/tableLayout';
import { WHIRL_STAGGER, WHIRL_TIME, WHIRL_TURNS, whirlPose, whirlSpan } from '../src/ui3d/whirlFlip';

// 手牌立着：牌面朝出牌的人（+z）；倒牌以后牌面朝上躺着，牌顶朝桌子中间（-z）
const STAND = new THREE.Quaternion();
const LIE = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const from = { pos: new THREE.Vector3(2, TILE_H / 2, 11), quat: STAND, scale: 1 };
const to = { pos: new THREE.Vector3(2, TILE_T / 2, 10.6), quat: LIE, scale: 1 };

// 牌最低的角离桌面多高
function clearance(p: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number }): number {
  const y = (v: THREE.Vector3) => Math.abs(v.applyQuaternion(p.quat).y);
  const half = (p.scale / 2) * (TILE_W * y(new THREE.Vector3(1, 0, 0)) + TILE_H * y(new THREE.Vector3(0, 1, 0)) + TILE_T * y(new THREE.Vector3(0, 0, 1)));
  return p.pos.y - half;
}

describe('大星淡的逆回旋（中了杠里的自摸，手牌逆着翻开）', () => {
  it('从立着的样子出发，落下去正好是倒牌以后的样子', () => {
    const a = whirlPose(from, to, 0);
    expect(a.pos.distanceTo(from.pos)).toBeLessThan(1e-9);
    expect(a.quat.angleTo(from.quat)).toBeLessThan(1e-6);
    const b = whirlPose(from, to, 1);
    expect(b.pos.distanceTo(to.pos)).toBeLessThan(1e-9);
    expect(b.quat.angleTo(to.quat)).toBeLessThan(1e-6);
  });

  it('逆着翻：牌顶先朝自己这边倒（平常倒牌是朝桌子中间），一共翻四分之三圈再加整圈', () => {
    // 牌顶的方向：平常倒牌一开始往 -z 去，逆着翻往 +z 去
    const top = (k: number) => new THREE.Vector3(0, 1, 0).applyQuaternion(whirlPose(from, to, k).quat);
    expect(top(0.03).z).toBeGreaterThan(0.05);
    let turned = 0;
    let prev = whirlPose(from, to, 0);
    for (let k = 0.002; k <= 1; k += 0.002) {
      const cur = whirlPose(from, to, k);
      turned += cur.quat.angleTo(prev.quat);
      // 只绕着这一排的方向翻，不往左右歪（旁边的牌挨着）
      expect(Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(cur.quat).x)).toBeGreaterThan(0.999);
      expect(Math.abs(cur.pos.x - from.pos.x)).toBeLessThan(1e-9);
      prev = cur;
    }
    expect(turned).toBeCloseTo(2 * Math.PI * (0.75 + WHIRL_TURNS), 1);
  });

  it('翻的时候不钻到桌面下面，中间是跳起来的', () => {
    let top = 0;
    for (let k = 0; k <= 1; k += 0.005) {
      const p = whirlPose(from, to, k);
      expect(clearance(p), `k=${k.toFixed(3)}`).toBeGreaterThan(-1e-6);
      top = Math.max(top, clearance(p));
    }
    expect(top).toBeGreaterThan(0.5);
  });

  it('自己放大的手牌也一样：大小跟着变到桌上牌的大小，照样不钻桌面', () => {
    const big = { pos: new THREE.Vector3(2, 1.2, 12), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0)), scale: 1.6 };
    expect(whirlPose(big, to, 0).scale).toBeCloseTo(1.6);
    expect(whirlPose(big, to, 1).scale).toBeCloseTo(1);
    for (let k = 0; k <= 1; k += 0.01) expect(clearance(whirlPose(big, to, k))).toBeGreaterThan(-1e-6);
    expect(whirlPose(big, to, 1).quat.angleTo(to.quat)).toBeLessThan(1e-6);
  });

  it('一排翻完要多久', () => {
    expect(whirlSpan(1)).toBeCloseTo(WHIRL_TIME);
    expect(whirlSpan(10)).toBeCloseTo(9 * WHIRL_STAGGER + WHIRL_TIME);
    expect(whirlSpan(13)).toBeLessThan(1.5);
  });
});
