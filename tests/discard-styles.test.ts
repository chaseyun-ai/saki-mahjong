import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISCARD,
  DiscardParams,
  DiscardPath,
  DiscardStyle,
  NORMAL_STYLES,
  RIICHI_DISCARD,
  RIICHI_STYLES,
  SLIDE_DISCARD,
  SLIDE_RIICHI,
  afterTime,
  cues,
  declareDelay,
  dueCues,
  dueMarkers,
  markers,
  sampleDiscard,
  styleParams,
  totalTime,
} from '../src/ui3d/discardMotion';
import { TILE_H, TILE_T, TILE_W } from '../src/ui3d/tableLayout';

// 牌河里的牌面朝上躺着；立直宣言牌再横过来
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const SIDE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).multiply(FLAT);
const TO = new THREE.Vector3(-1.5, TILE_T / 2, 4.3);

const path = (style: DiscardStyle, sideways: boolean, extra: Partial<DiscardPath> = {}): DiscardPath => ({
  from: new THREE.Vector3(2, 0.85, 11.3),
  fromQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.32, 0, 0)),
  to: TO.clone(),
  toQuat: (sideways ? SIDE : FLAT).clone(),
  toward: new THREE.Vector3(0, 0, 1),
  scale: 23,
  style,
  ...extra,
});

// 每种样子在 3D（有手）和 2.5D（牌自己飞）各一套参数
const CASES: { style: DiscardStyle; riichi: boolean; flat: boolean; p: DiscardParams }[] = [];
for (const flat of [false, true]) {
  for (const style of NORMAL_STYLES) CASES.push({ style, riichi: false, flat, p: styleParams(flat ? SLIDE_DISCARD : DEFAULT_DISCARD, style, flat) });
  for (const style of RIICHI_STYLES) CASES.push({ style, riichi: true, flat, p: styleParams(flat ? SLIDE_RIICHI : RIICHI_DISCARD, style, flat) });
}
const label = (c: (typeof CASES)[number]) => `${c.riichi ? '立直' : '平常'} ${c.style} ${c.flat ? '2.5D' : '3D'}`;

// 牌最低的地方离桌面多高（桌面在落点下面半个牌厚）
function clearance(pos: THREE.Vector3, quat: THREE.Quaternion): number {
  const y = (v: THREE.Vector3) => Math.abs(v.applyQuaternion(quat).y);
  const half = (TILE_W * y(new THREE.Vector3(1, 0, 0)) + TILE_H * y(new THREE.Vector3(0, 1, 0)) + TILE_T * y(new THREE.Vector3(0, 0, 1))) / 2;
  return pos.y - half - (TO.y - TILE_T / 2);
}

// 牌在桌面上往左（这一行前一张那边）、往里（上一行那边）最远伸到哪
function reach(pos: THREE.Vector3, quat: THREE.Quaternion): { left: number; far: number } {
  const ext = (axis: THREE.Vector3) => {
    const d = (v: THREE.Vector3) => Math.abs(v.applyQuaternion(quat).dot(axis));
    return (TILE_W * d(new THREE.Vector3(1, 0, 0)) + TILE_H * d(new THREE.Vector3(0, 1, 0)) + TILE_T * d(new THREE.Vector3(0, 0, 1))) / 2;
  };
  return { left: pos.x - ext(new THREE.Vector3(1, 0, 0)), far: pos.z - ext(new THREE.Vector3(0, 0, 1)) };
}

describe('出牌的样子', () => {
  it('平放（place）和不写样子一模一样', () => {
    for (const p of [DEFAULT_DISCARD, RIICHI_DISCARD, SLIDE_DISCARD]) {
      expect(styleParams(p, 'place')).toEqual(p);
      expect(totalTime(p, 0, 'place')).toBe(totalTime(p));
      for (let t = 0; t <= totalTime(p); t += 0.037) {
        const a = sampleDiscard(p, path('place', false), t);
        const b = sampleDiscard(p, { ...path('place', false), style: undefined }, t);
        expect(a.tilePos.equals(b.tilePos)).toBe(true);
        expect(a.tileQuat.equals(b.tileQuat)).toBe(true);
        expect(a.wrist.equals(b.wrist)).toBe(true);
      }
    }
  });

  it('每种样子：从手里出发，最后停在牌河里摆正', () => {
    for (const c of CASES) {
      const pa = path(c.style, c.riichi);
      const start = sampleDiscard(c.p, pa, 0);
      expect(start.tilePos.distanceTo(pa.from), label(c)).toBeLessThan(1e-9);
      const stop = c.p.reach + c.p.carry + afterTime(c.style);
      const end = sampleDiscard(c.p, pa, stop + 1e-6);
      expect(end.tilePos.distanceTo(pa.to), label(c)).toBeLessThan(1e-6);
      expect(end.tileQuat.angleTo(pa.toQuat), label(c)).toBeLessThan(1e-6);
      expect(end.holding, label(c)).toBe(false);
      // 整个动作到牌停下才算完
      expect(totalTime(c.p, 0, c.style), label(c)).toBeGreaterThanOrEqual(stop - 1e-9);
      // 动作结束时手收回去了
      expect(sampleDiscard(c.p, pa, totalTime(c.p, 0, c.style)).weight, label(c)).toBeLessThan(c.flat ? 1.01 : 0.01);
    }
  });

  it('每种样子：牌和手腕连着走，没有跳变', () => {
    const step = 1 / 600;
    for (const c of CASES) {
      const pa = path(c.style, c.riichi);
      let prev = sampleDiscard(c.p, pa, 0);
      for (let t = step; t <= totalTime(c.p, 0, c.style) + 0.05; t += step) {
        // 落桌以后照着放下的位置算（牌桌是这么调的）
        if (t >= c.p.reach + c.p.carry) pa.landed = pa.to.clone();
        const cur = sampleDiscard(c.p, pa, t);
        expect(cur.tilePos.distanceTo(prev.tilePos), `${label(c)} t=${t.toFixed(3)}`).toBeLessThan(0.2);
        expect(cur.tileQuat.angleTo(prev.tileQuat), `${label(c)} t=${t.toFixed(3)}`).toBeLessThan(0.25);
        if (!c.flat) expect(cur.wrist.distanceTo(prev.wrist), `${label(c)} t=${t.toFixed(3)}`).toBeLessThan(0.2);
        expect(Number.isFinite(cur.wrist.x + cur.tilePos.x + cur.tileQuat.w), label(c)).toBe(true);
        prev = cur;
      }
    }
  });

  it('每种样子：牌不会钻到桌面下面', () => {
    for (const c of CASES) {
      const pa = path(c.style, c.riichi);
      for (let t = c.p.reach + 0.02; t <= totalTime(c.p, 0, c.style); t += 1 / 240) {
        const pose = sampleDiscard(c.p, pa, t);
        expect(clearance(pose.tilePos, pose.tileQuat), `${label(c)} t=${t.toFixed(3)}`).toBeGreaterThan(-0.02);
      }
    }
  });

  it('落桌以后贴着桌面动的：不越过左边的前一张，不压到里面的上一行', () => {
    // 落点左边紧挨着前一张牌，里面紧挨着上一行
    const sideways = (style: DiscardStyle) => RIICHI_STYLES.includes(style) && style !== 'place';
    for (const c of CASES) {
      if (!['slide', 'stand', 'turn', 'top', 'push'].includes(c.style)) continue;
      for (const spin of [1, -1]) {
        const pa = path(c.style, sideways(c.style), { spin, landed: TO.clone() });
        const rest = reach(pa.to, pa.toQuat);
        const land = c.p.reach + c.p.carry;
        for (let t = land; t <= land + afterTime(c.style) + 0.02; t += 1 / 480) {
          const pose = sampleDiscard(c.p, pa, t);
          const r = reach(pose.tilePos, pose.tileQuat);
          expect(r.left, `${label(c)} t=${(t - land).toFixed(3)}`).toBeGreaterThan(rest.left - 1e-6);
          // 这一行有一张牌长那么深，上一行在它外面
          expect(r.far, `${label(c)} t=${(t - land).toFixed(3)}`).toBeGreaterThan(TO.z - TILE_H / 2 - 1e-6);
        }
      }
    }
  });

  it('滑着放的：跟前地方窄就少滑一点，不会伸到给的宽度外面', () => {
    const p = styleParams(SLIDE_DISCARD, 'slide', true);
    const pa = path('slide', false, { room: 0.5 });
    for (let t = 0.05; t <= totalTime(p, 0, 'slide'); t += 1 / 240) {
      const pose = sampleDiscard(p, pa, t);
      if (pose.tilePos.y > TO.y + 0.02) continue; // 还在半空
      expect(pose.tilePos.z).toBeLessThanOrEqual(TO.z + 0.5 + 1e-6);
    }
  });

  it('落桌以后的动静按时间排好，立直宣言每种样子都正好报一次', () => {
    for (const c of CASES) {
      const list = cues(c.p, c.style);
      const land = c.p.reach + c.p.carry;
      for (let i = 1; i < list.length; i++) expect(list[i].t, label(c)).toBeGreaterThanOrEqual(list[i - 1].t);
      const declare = list.filter((x) => x.kind === 'declare');
      expect(declare.length, label(c)).toBe(1);
      expect(declare[0].t, label(c)).toBeCloseTo(land + declareDelay(c.style));
      expect(declare[0].t, label(c)).toBeLessThanOrEqual(totalTime(c.p, 0, c.style) + 1e-9);
      // 按帧推进，每个只报一次；中途打断时剩下的一次报完
      for (const dt of [1 / 30, 1 / 60, 0.4]) {
        const seen: string[] = [];
        let fired = 0;
        for (let t = 0; t <= totalTime(c.p, 0, c.style) + dt; t += dt) {
          const due = dueCues(c.p, fired, t, c.style);
          fired += due.length;
          seen.push(...due.map((x) => x.kind));
        }
        expect(seen, label(c)).toEqual(list.map((x) => x.kind));
      }
      const first = dueCues(c.p, 0, land - 0.01, c.style);
      expect(first.length + dueCues(c.p, first.length, Infinity, c.style).length, label(c)).toBe(list.length);
    }
  });

  it('标记还是那五个，落桌的时刻就是伸手加搬运', () => {
    for (const c of CASES) {
      const m = markers(c.p, 0, c.style);
      expect(m.map((x) => x.name)).toEqual(['depart', 'grab', 'land', 'release', 'done']);
      expect(m[2].t).toBeCloseTo(c.p.reach + c.p.carry);
      expect(m[4].t).toBeCloseTo(totalTime(c.p, 0, c.style));
      const seen: string[] = [];
      let fired = 0;
      for (let t = 0; t <= totalTime(c.p, 0, c.style) + 1 / 30; t += 1 / 30) {
        const due = dueMarkers(c.p, 0, fired, t, c.style);
        fired += due.length;
        seen.push(...due.map((x) => x.name));
      }
      expect(seen, label(c)).toEqual(['depart', 'grab', 'land', 'release', 'done']);
    }
  });

  it('2.5D 平常的牌不拖沓：花样最长也在一秒以内，立直宣言两秒以内', () => {
    for (const c of CASES) {
      if (!c.flat) continue;
      expect(totalTime(c.p, 0, c.style), label(c)).toBeLessThan(c.riichi ? 2 : 1);
    }
  });
});
