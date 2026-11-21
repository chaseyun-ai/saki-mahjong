import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DORA_FLIP_TIME, DORA_NUDGE, DORA_NUDGE_TIME, doraFlipPose } from '../src/ui3d/doraFlip';
import { TILE_H, TILE_T, TILE_W } from '../src/ui3d/tableLayout';
import { WHIRL_HEIGHT, WHIRL_TURNS, whirlPose } from '../src/ui3d/whirlFlip';

// 倒牌以后牌面朝上躺着，牌顶朝桌子中间（-z）；坐着的人在 +z 那边，右手边是 +x
const LIE = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const AXIS = new THREE.Vector3(1, 0, 0);
const TOWARD = new THREE.Vector3(0, 0, 1);
// 一排十张，落定以后的样子
const ROW = Array.from({ length: 10 }, (_, i) => ({ pos: new THREE.Vector3(-4.5 + i * 1.02, TILE_T / 2, 10.6), quat: LIE, scale: 1 }));
const CENTER = new THREE.Vector3(0.09, TILE_T / 2, 10.6);

// 牌最低的角离桌面多高
function clearance(p: { pos: THREE.Vector3; quat: THREE.Quaternion; scale?: number }, floor = 0): number {
  const s = p.scale ?? 1;
  const y = (v: THREE.Vector3) => Math.abs(v.applyQuaternion(p.quat).y);
  const half = (s / 2) * (TILE_W * y(new THREE.Vector3(1, 0, 0)) + TILE_H * y(new THREE.Vector3(0, 1, 0)) + TILE_T * y(new THREE.Vector3(0, 0, 1)));
  return p.pos.y - half - floor;
}

describe('大星淡的逆回旋（中了杠里的自摸，整排手牌在半空逆着翻滚）', () => {
  it('一开始整排立着悬在半空，落下去正好是倒牌以后的样子', () => {
    for (const to of ROW) {
      const a = whirlPose(to, CENTER, AXIS, 0);
      // 立着：牌顶朝上，牌面朝自己
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(a.quat).y).toBeCloseTo(1, 6);
      expect(new THREE.Vector3(0, 0, 1).applyQuaternion(a.quat).z).toBeCloseTo(1, 6);
      expect(a.pos.y).toBeCloseTo(CENTER.y + WHIRL_HEIGHT, 6);
      expect(a.pos.x).toBeCloseTo(to.pos.x, 9);
      const b = whirlPose(to, CENTER, AXIS, 1);
      expect(b.pos.distanceTo(to.pos)).toBeLessThan(1e-9);
      expect(b.quat.angleTo(to.quat)).toBeLessThan(1e-6);
    }
  });

  it('整排一起转：每张牌同一刻转得一样，排还是直的、间距不变', () => {
    for (let k = 0; k <= 1; k += 0.05) {
      const poses = ROW.map((to) => whirlPose(to, CENTER, AXIS, k));
      for (let i = 1; i < poses.length; i++) {
        expect(poses[i].quat.angleTo(poses[0].quat)).toBeLessThan(1e-6);
        const d = poses[i].pos.clone().sub(poses[i - 1].pos);
        expect(d.x).toBeCloseTo(1.02, 6);
        expect(Math.hypot(d.y, d.z)).toBeLessThan(1e-6);
      }
    }
  });

  it('逆着翻：牌顶先朝自己这边倒（平常倒牌是朝桌子中间），一共翻两圈又四分之三', () => {
    const to = ROW[3];
    // 牌顶的方向：平常倒牌一开始往 -z 去，逆着翻往 +z 去
    const top = (k: number) => new THREE.Vector3(0, 1, 0).applyQuaternion(whirlPose(to, CENTER, AXIS, k).quat);
    expect(top(0.01).z).toBeGreaterThan(0.05);
    let turned = 0;
    let prev = whirlPose(to, CENTER, AXIS, 0);
    for (let k = 0.001; k <= 1; k += 0.001) {
      const cur = whirlPose(to, CENTER, AXIS, k);
      turned += cur.quat.angleTo(prev.quat);
      // 只绕着这一排的方向翻，不往左右歪
      expect(Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(cur.quat).x)).toBeGreaterThan(0.999);
      prev = cur;
    }
    expect(turned).toBeCloseTo(2 * Math.PI * WHIRL_TURNS, 1);
    expect(WHIRL_TURNS % 1).toBeCloseTo(0.75);
  });

  it('翻的时候不钻到桌面下面，先往上飘一点再落下来', () => {
    let top = 0;
    for (let k = 0; k <= 1; k += 0.002) {
      const p = whirlPose(ROW[0], CENTER, AXIS, k);
      expect(clearance(p), `k=${k.toFixed(3)}`).toBeGreaterThan(-1e-6);
      top = Math.max(top, p.pos.y);
    }
    expect(top).toBeGreaterThan(CENTER.y + WHIRL_HEIGHT + 0.05);
  });
});

describe('翻宝牌指示牌', () => {
  // 牌山上层那张：翻开以后牌面朝上
  const to = { pos: new THREE.Vector3(3, TILE_T * 1.5, -9.45), quat: LIE };
  const faceUp = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, 1).applyQuaternion(q).y;

  it('一开始是扣着的，翻完正好牌面朝上躺在原位', () => {
    for (const dir of [1, -1] as const) {
      const a = doraFlipPose(to, TOWARD, 0, dir);
      expect(faceUp(a.quat)).toBeCloseTo(-1, 6);
      expect(a.pos.distanceTo(to.pos)).toBeLessThan(1e-9);
      const b = doraFlipPose(to, TOWARD, DORA_FLIP_TIME, dir);
      expect(b.quat.angleTo(to.quat)).toBeLessThan(1e-6);
      expect(b.pos.distanceTo(to.pos)).toBeLessThan(1e-9);
    }
  });

  it('先往前推一点（离翻牌的人远一点），停一下再翻', () => {
    const a = doraFlipPose(to, TOWARD, DORA_NUDGE_TIME, 1);
    expect(to.pos.z - a.pos.z).toBeCloseTo(DORA_NUDGE, 6);
    expect(faceUp(a.quat)).toBeCloseTo(-1, 6);
    // 不推的（淡拿到身前翻的里宝牌）原地翻
    expect(doraFlipPose(to, TOWARD, 0.01, -1, false).pos.z).toBeCloseTo(to.pos.z, 6);
  });

  it('不是左右翻：绕着牌宽那条边的方向翻，从下往上是靠自己这边的下沿先起来，从上往下是远的那头先起来', () => {
    for (const dir of [1, -1] as const) {
      const lead = dir === 1 ? DORA_FLIP_TIME - 0.32 : 0;
      for (let t = lead; t <= lead + 0.32; t += 0.004) {
        const p = doraFlipPose(to, TOWARD, t, dir, dir === 1);
        // 牌宽那条边一直是水平的、朝着左右
        expect(Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(p.quat).x), `t=${t}`).toBeGreaterThan(0.999999);
        // 不钻到底下那张牌里
        expect(clearance(p, TILE_T)).toBeGreaterThan(-1e-6);
      }
      // 刚开始翻：牌长的两头，哪一头抬起来了
      const early = doraFlipPose(to, TOWARD, lead + 0.1, dir, dir === 1);
      const ends = [1, -1].map((e) => new THREE.Vector3(0, (e * TILE_H) / 2, 0).applyQuaternion(early.quat).add(early.pos));
      const near = ends[0].z > ends[1].z ? ends[0] : ends[1];
      const far = ends[0].z > ends[1].z ? ends[1] : ends[0];
      if (dir === 1) expect(near.y).toBeGreaterThan(far.y + 0.05);
      else expect(far.y).toBeGreaterThan(near.y + 0.05);
    }
  });
});
