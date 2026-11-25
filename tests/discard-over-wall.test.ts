import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DISCARD, DiscardPath, DiscardStyle, RIICHI_DISCARD, sampleDiscard, styleParams, totalTime } from '../src/ui3d/discardMotion';
import { TILE_H, TILE_T, TILE_W, WALL_Z } from '../src/ui3d/tableLayout';

// 3D 有人拿着牌出牌：手牌和牌河之间隔着自己面前的牌山，牌要竖着提起来、从牌山上面越过去，过了牌山再放平
const WALL_TOP = 2 * TILE_T;
const WALL_IN = WALL_Z - TILE_H / 2;
const WALL_OUT = WALL_Z + TILE_H / 2;
const toward = new THREE.Vector3(0, 0, 1);
const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

function path(pondZ: number, style: DiscardStyle = 'place', wall = true): DiscardPath {
  return {
    from: new THREE.Vector3(2, TILE_H / 2, 11),
    fromQuat: new THREE.Quaternion(),
    to: new THREE.Vector3(-1.5, TILE_T / 2, pondZ),
    toQuat: flat.clone(),
    toward,
    scale: 27.6,
    style,
    // 和牌桌给的一样
    wall: wall ? { near: WALL_Z - TILE_H - 0.1, far: WALL_Z + TILE_H / 2 + TILE_T / 2 + 0.15, top: WALL_TOP } : undefined,
  };
}

// 牌的八个角
function corners(pos: THREE.Vector3, quat: THREE.Quaternion): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(new THREE.Vector3((x * TILE_W) / 2, (y * TILE_H) / 2, (z * TILE_T) / 2).applyQuaternion(quat).add(pos));
  return out;
}

const CASES: { name: string; p: typeof DEFAULT_DISCARD; style: DiscardStyle }[] = [
  { name: '平放', p: DEFAULT_DISCARD, style: 'place' },
  { name: '立直重拍', p: RIICHI_DISCARD, style: 'place' },
  { name: '立直转横', p: styleParams(RIICHI_DISCARD, 'turn'), style: 'turn' },
  { name: '立直横推', p: styleParams(RIICHI_DISCARD, 'brake'), style: 'brake' },
];
// 牌河最里一行、最靠牌山的一行
const PONDS = [4.3, 7.1];

describe('出牌越过牌山', () => {
  it('牌不碰牌山：在牌山上方时，牌底比牌山顶高', () => {
    for (const c of CASES) {
      for (const z of PONDS) {
        const pa = path(z, c.style);
        let crossed = false;
        for (let t = c.p.reach; t <= c.p.reach + c.p.carry; t += 1 / 240) {
          const pose = sampleDiscard(c.p, pa, t);
          const cs = corners(pose.tilePos, pose.tileQuat);
          if (!cs.some((v) => v.z > WALL_IN && v.z < WALL_OUT)) continue;
          crossed = true;
          expect(Math.min(...cs.map((v) => v.y)), `${c.name} 牌河 ${z} t=${t.toFixed(3)}`).toBeGreaterThan(WALL_TOP + 0.1);
        }
        expect(crossed, c.name).toBe(true);
      }
    }
  });

  it('牌是竖着提起来的：到牌山跟前还立着，过了牌山才放平，落桌时正好摆好', () => {
    for (const c of CASES) {
      const pa = path(PONDS[0], c.style);
      for (let t = c.p.reach; t <= c.p.reach + c.p.carry; t += 1 / 240) {
        const pose = sampleDiscard(c.p, pa, t);
        // 牌的中心还没到牌山靠自己的这一面：一点没转
        if (pose.tilePos.z > WALL_OUT) expect(pose.tileQuat.angleTo(pa.fromQuat), `${c.name} t=${t.toFixed(3)}`).toBeLessThan(1e-6);
        // 过了牌山中线才开始转
        if (pose.tilePos.z > WALL_Z) expect(pose.tileQuat.angleTo(pa.fromQuat), `${c.name} t=${t.toFixed(3)}`).toBeLessThan(0.05);
      }
      // 搬完时已经是落桌的姿势（转横是先竖着落下再按着转，横推落在旁边：都不看位置，只看平放的那种）
      if (c.style === 'place') {
        const end = sampleDiscard(c.p, pa, c.p.reach + c.p.carry - 1e-6);
        expect(end.tilePos.distanceTo(pa.to)).toBeLessThan(1e-3);
        expect(end.tileQuat.angleTo(pa.toQuat)).toBeLessThan(1e-3);
      }
    }
  });

  it('牌和手腕连着走，没有跳变；手一直捏在牌上', () => {
    const step = 1 / 600;
    for (const c of CASES) {
      const pa = path(PONDS[1], c.style);
      let prev = sampleDiscard(c.p, pa, 0);
      for (let t = step; t <= totalTime(c.p, 0, c.style); t += step) {
        if (t >= c.p.reach + c.p.carry) pa.landed = pa.to.clone();
        const cur = sampleDiscard(c.p, pa, t);
        expect(cur.tilePos.distanceTo(prev.tilePos), `${c.name} t=${t.toFixed(3)}`).toBeLessThan(0.2);
        expect(cur.wrist.distanceTo(prev.wrist), `${c.name} t=${t.toFixed(3)}`).toBeLessThan(0.2);
        expect(cur.tileQuat.angleTo(prev.tileQuat), `${c.name} t=${t.toFixed(3)}`).toBeLessThan(0.25);
        // 捏点在牌身上（立着时在上半截，放平了在中间），不会离开牌
        if (cur.holding && t > c.p.reach && t < c.p.reach + c.p.carry) expect(cur.contact.distanceTo(cur.tilePos), `${c.name} t=${t.toFixed(3)}`).toBeLessThan(TILE_H / 2);
        prev = cur;
      }
    }
  });

  it('没给牌山（2.5D，牌自己飞）：还是原来那条低弧线', () => {
    const p = DEFAULT_DISCARD;
    const pa = path(PONDS[0], 'place', false);
    let top = 0;
    for (let t = p.reach; t <= p.reach + p.carry; t += 1 / 240) top = Math.max(top, sampleDiscard(p, pa, t).tilePos.y);
    expect(top).toBeLessThan(TILE_H / 2 + p.lift + 0.01);
    const mid = sampleDiscard(p, pa, p.reach + p.carry / 2);
    expect(mid.tilePos.z).toBeCloseTo((pa.from.z + pa.to.z) / 2, 6);
  });
});
