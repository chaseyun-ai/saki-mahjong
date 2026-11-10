import * as THREE from 'three';
import type { HandPose } from './slamHand';

// 自摸砸牌几套动作（tileSlam.ts 的通用一套、slamFlick.ts 竹井久的一套……）共用的小工具和接口。

// 自摸砸牌的动作：press 通用的一套（照雀魂，扣下去再翻起来炸开），hisa 竹井久的（握拳把牌放在大拇指指甲盖上亮牌、弹上天、扣住砸下去）
export type SlamStyle = 'press' | 'hisa';

// 手比照着牌放大多少（手的模型是按牌宽量的；放大一点，扣牌时离镜头远也看得清）
export const HAND_SCALE = 1.5;

export interface Key {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  pose?: HandPose; // 手型（slamHand.ts），不给是张开的手
}

// 一套“自己算好整段”的砸牌动作：开始以后第 k 秒手在哪（null 是看不见）、牌在哪，
// 以及什么时候扣到桌上（press）、开始亮（charge，亮多久）、炸开（hit）、整段做完（done）。时间都是从开始算的秒数
export interface SlamMotion {
  readonly pressAt: number;
  readonly chargeAt: number;
  readonly chargeDur: number;
  readonly hitAt: number;
  readonly doneAt: number;
  readonly revealAt?: number; // 手牌该倒下亮出来的时刻（不给就照扣到桌上那一下）
  readonly pressPoint: THREE.Vector3; // 扣到桌上那一下，牌底下的桌面点
  readonly chargePoint: THREE.Vector3; // 开始亮光的地方
  readonly hitPoint: THREE.Vector3; // 炸开那一下，牌底下的桌面点
  readonly handScale?: number; // 手比照着牌放大多少，不给是 HAND_SCALE
  frame(k: number): { hand: Key | null; tile: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number } };
}

export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const easeIn = (x: number) => x * x * x;
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// 手的朝向：手指朝 f，手背朝 d（d 会被扳成和 f 垂直）
export function basis(f: THREE.Vector3, d: THREE.Vector3): THREE.Quaternion {
  const y = f.clone().normalize();
  const z = d.clone().addScaledVector(y, -d.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export function bezier(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, u: number): THREE.Vector3 {
  const a = p0.clone().lerp(p1, u);
  const b = p1.clone().lerp(p2, u);
  return a.lerp(b, u);
}
