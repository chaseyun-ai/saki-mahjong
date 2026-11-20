import * as THREE from 'three';
import { TILE_H, TILE_T, TILE_W } from './tableLayout';

// 大星淡中了杠里的自摸（逆回旋）：手牌不照常往前倒，一张张跳起来、逆着翻开。只算一张牌的姿势，不碰牌桌

// 一张翻多久（秒）、相邻两张隔多久；在翻开的那四分之三圈之外再多翻几整圈；跳多高（牌宽）
export const WHIRL_TIME = 0.62;
export const WHIRL_STAGGER = 0.045;
export const WHIRL_TURNS = 1;
export const WHIRL_HOP = 1.5;

export interface FlipPose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

// n 张手牌从第一张起翻到最后一张落定要多久
export function whirlSpan(n: number): number {
  return Math.max(0, n - 1) * WHIRL_STAGGER + WHIRL_TIME;
}

// 一张牌翻到第 k 成（0–1）的样子。from 是立着的样子，to 是倒牌以后牌面朝上躺着的样子。
// 平常倒牌是牌顶往桌子中间倒四分之一圈；这里绕同一根轴反过来翻（牌顶朝自己这边），多翻 WHIRL_TURNS 整圈，落下去正好是 to
export function whirlPose(from: FlipPose, to: FlipPose, k: number): FlipPose {
  k = Math.min(1, Math.max(0, k));
  const diff = to.quat.clone().multiply(from.quat.clone().invert());
  if (diff.w < 0) diff.set(-diff.x, -diff.y, -diff.z, -diff.w);
  const angle = 2 * Math.acos(Math.min(1, diff.w));
  const axis = new THREE.Vector3(diff.x, diff.y, diff.z);
  if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
  axis.normalize();
  // 起跳快、落下慢一点
  const r = 1 - (1 - k) ** 1.8;
  const quat = new THREE.Quaternion().setFromAxisAngle(axis, (angle - 2 * Math.PI * (1 + WHIRL_TURNS)) * r).multiply(from.quat);
  const scale = THREE.MathUtils.lerp(from.scale, to.scale, k);
  const pos = from.pos.clone().lerp(to.pos, THREE.MathUtils.smoothstep(k, 0, 1));
  pos.y += Math.sin(Math.PI * k) * WHIRL_HOP * scale;
  // 翻的时候牌角不钻到桌面下面：最低的角垫到桌面上
  const m = new THREE.Matrix4().makeRotationFromQuaternion(quat).elements;
  const half = (scale / 2) * (TILE_W * Math.abs(m[1]) + TILE_H * Math.abs(m[5]) + TILE_T * Math.abs(m[9]));
  pos.y = Math.max(pos.y, to.pos.y - (TILE_T / 2) * to.scale + half);
  return { pos, quat, scale };
}
