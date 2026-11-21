import * as THREE from 'three';
import { TILE_H, TILE_T } from './tableLayout';

// 翻宝牌指示牌：现实里是把要翻的那张往前推一点，手指按住牌背靠自己这边的下沿，从下往上翻过去（不是左右翻）。
// 淡把宝牌那一摞拿到身前翻里宝牌是反过来的：从上往下翻。只算一张牌的姿势，不碰牌桌

// 往前推多远（牌宽）、推多久（秒）；停一下；翻多久
export const DORA_NUDGE = 0.2;
export const DORA_NUDGE_TIME = 0.13;
export const DORA_BEAT = 0.05;
export const DORA_TURN_TIME = 0.32;
export const DORA_FLIP_TIME = DORA_NUDGE_TIME + DORA_BEAT + DORA_TURN_TIME;

const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);

// 翻到 t 秒时的样子。to 是翻开以后牌面朝上躺着的位置、朝向；toward 是水平方向，从牌指向翻它的人（牌山是谁面前的就是谁）。
// dir 1：靠自己这边的下沿先起来、往前翻过去（从下往上翻）；-1：远的那一头先起来、朝自己翻过来（从上往下翻）。
// nudge：先往前推一点再翻（翻的时候退回原位）。牌背上下是一样的，所以翻之前那张扣着的牌朝哪头都行，这里照翻开以后的朝向倒推
export function doraFlipPose(to: { pos: THREE.Vector3; quat: THREE.Quaternion }, toward: THREE.Vector3, t: number, dir: 1 | -1 = 1, nudge = true, scale = 1): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  const lead = nudge ? DORA_NUDGE_TIME + DORA_BEAT : 0;
  const push = nudge ? DORA_NUDGE * scale * (t < lead ? 1 - (1 - clamp01(t / DORA_NUDGE_TIME)) ** 2 : 1) : 0;
  const k = clamp01((t - lead) / DORA_TURN_TIME);
  // 起得慢、翻过去快，最后轻轻放平
  const e = smooth(k) ** 1.15;
  const right = new THREE.Vector3().crossVectors(UP, toward);
  const a = dir * Math.PI * (1 - e);
  const quat = new THREE.Quaternion().setFromAxisAngle(right, a).multiply(to.quat);
  const pos = to.pos.clone().addScaledVector(toward, -dir * push * (1 - e));
  // 一头压在底下那张牌上转：竖起来的时候中心高出半张牌长
  pos.y += (scale / 2) * (TILE_H * Math.abs(Math.sin(a)) + TILE_T * Math.abs(Math.cos(a)) - TILE_T);
  return { pos, quat };
}
