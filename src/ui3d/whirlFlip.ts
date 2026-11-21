import * as THREE from 'three';
import { TILE_H, TILE_T } from './tableLayout';

// 大星淡中了杠里的自摸（逆回旋）：一整排手牌提到半空（提的动作不演，直接接上），像一根棍子一样整排逆着翻滚，
// 落下来正好牌面朝上摊在桌上。只算一张牌的姿势，不碰牌桌

// 翻滚多久（秒）；一共逆着翻几圈（带四分之三圈：开头是立着的，落下去是牌面朝上躺着的）；一开始悬在多高（牌宽）；先再往上飘多少
export const WHIRL_TIME = 1.1;
export const WHIRL_TURNS = 2.75;
export const WHIRL_HEIGHT = 3.3;
export const WHIRL_RISE = 1.1;

export interface FlipPose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

// 这一刻整排牌绕着排的方向多转了多少（弧度）：0 是落定的样子，负的是还没翻到。
// 平常倒牌是牌顶往桌子中间倒，这里反过来（牌顶朝自己这边翻过去）；开头翻得快，落下去的时候慢下来
export function whirlAngle(k: number): number {
  k = Math.min(1, Math.max(0, k));
  return -2 * Math.PI * WHIRL_TURNS * (1 - k) ** 1.7;
}

// 一张牌翻到第 k 成（0–1）的样子。to 是落定以后牌面朝上躺着的样子；center 是整排牌落定以后的中心，
// axis 是排的方向（坐着的人的右手边，单位向量）：整排绕着过中心的这根轴转，中心先往上飘一点再落到桌上
export function whirlPose(to: FlipPose, center: THREE.Vector3, axis: THREE.Vector3, k: number): FlipPose {
  k = Math.min(1, Math.max(0, k));
  const a = whirlAngle(k);
  const q = new THREE.Quaternion().setFromAxisAngle(axis, a);
  const s = to.scale;
  // 中心多高：一条抛物线，开头在 WHIRL_HEIGHT，落定时回到桌上
  const h = (WHIRL_HEIGHT + WHIRL_RISE * k - (WHIRL_HEIGHT + WHIRL_RISE) * k * k) * s;
  // 翻的时候牌的下沿不钻到桌面下面：转到竖着的时候中心至少要有半张牌高
  const half = (s / 2) * (TILE_H * Math.abs(Math.sin(a)) + TILE_T * Math.abs(Math.cos(a)));
  const mid = center.clone();
  mid.y = Math.max(center.y + h, center.y - (TILE_T / 2) * s + half);
  return { pos: to.pos.clone().sub(center).applyQuaternion(q).add(mid), quat: q.multiply(to.quat), scale: s };
}
