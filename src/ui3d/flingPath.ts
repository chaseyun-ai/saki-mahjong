import * as THREE from 'three';
import { FLING_BOW, flingBow, flingCurve } from './discardMotion';
import { TILE_H, TILE_T, TILE_W } from './tableLayout';

// 回旋（大星淡的双立直）贴着桌面滑过去走哪一道弧：桌上躺着、立着的牌（牌山、手牌、别家的牌河）都是挡路的，
// 这里挑一道碰不到它们的弧；一道都没有（牌山把路堵死了）就是 null，牌桌改用平常的立直放法。
// 只算路线，不碰牌桌

// 桌上的一块挡路的东西：中心、一条边的方向（单位向量）、沿这条边和垂直于它各占多宽（各一半）
export interface Block {
  x: number;
  z: number;
  ax: number;
  az: number;
  hx: number;
  hz: number;
}

// 转着滑的牌占多大地方（半径）：牌角到中心的距离，稍微收一点（擦着边过去看不出来）
export const FLING_RADIUS = Math.hypot(TILE_W, TILE_H) / 2 - 0.04;
// 弧弯成什么样（flingBow）：先试原本想要的那一道，再往两边一点点试
const BOWS = [FLING_BOW, 0.6, 0.8, 0.5, 0.9, 0.4, 1, 0.3, 0.2, 0.1, 0, -0.1, -0.2, -0.3];
// 沿着弧每隔多远查一次（牌宽）
const STEP = 0.25;

// 一张牌（位置、朝向、大小）在桌面上占的那一块：躺着的是牌面那么大，立着的是牌底那么大
export function tileBlock(pos: THREE.Vector3, quat: THREE.Quaternion, scale = 1): Block {
  const half = [TILE_W / 2, TILE_H / 2, TILE_T / 2];
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((v) => v.applyQuaternion(quat));
  // 最竖的那根轴不算，剩下两根就是桌面上的两条边
  let up = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(axes[i].y) > Math.abs(axes[up].y)) up = i;
  const [i, j] = [0, 1, 2].filter((k) => k !== up);
  const a = new THREE.Vector2(axes[i].x, axes[i].z);
  if (a.lengthSq() < 1e-8) a.set(1, 0);
  a.normalize();
  return { x: pos.x, z: pos.z, ax: a.x, az: a.y, hx: half[i] * scale, hz: half[j] * scale };
}

// 点到这一块的距离（在里面是 0）
export function blockDistance(b: Block, x: number, z: number): number {
  const dx = x - b.x;
  const dz = z - b.z;
  const u = Math.max(0, Math.abs(dx * b.ax + dz * b.az) - b.hx);
  const v = Math.max(0, Math.abs(-dx * b.az + dz * b.ax) - b.hz);
  return Math.hypot(u, v);
}

// 从 from 沿控制点 via 的弧滑到 to，路上会不会碰到什么。half：桌布半宽，滑出桌子也算碰到（给了才查）
export function flingBlocked(from: THREE.Vector3, via: THREE.Vector3, to: THREE.Vector3, blocks: Block[], half?: number): boolean {
  const n = Math.max(8, Math.ceil((from.distanceTo(via) + via.distanceTo(to)) / STEP));
  for (let i = 0; i <= n; i++) {
    const p = flingCurve(from, via, to, i / n);
    if (half !== undefined && i > 0 && Math.max(Math.abs(p.x), Math.abs(p.z)) > half - FLING_RADIUS) return true;
    for (const b of blocks) if (blockDistance(b, p.x, p.z) < FLING_RADIUS) return true;
  }
  return false;
}

// 挑一道碰不到东西的弧：返回控制点；都被挡住是 null。toward 是水平方向，从牌指向出牌的人
export function planFling(from: THREE.Vector3, to: THREE.Vector3, toward: THREE.Vector3, blocks: Block[], half?: number): THREE.Vector3 | null {
  for (const bow of BOWS) {
    const via = flingBow(from, to, toward, bow).setY(to.y);
    if (!flingBlocked(from, via, to, blocks, half)) return via;
  }
  return null;
}
