import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISCARD,
  DiscardMotion,
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
  pushDistAt,
  sampleDiscard,
  styleParams,
  totalTime,
} from '../src/ui3d/discardMotion';
import { POND_GAP, TILE_H, TILE_T, TILE_W } from '../src/ui3d/tableLayout';

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
const CASES: { style: DiscardStyle; riichi: boolean; flat: boolean; p: DiscardMotion }[] = [];
for (const flat of [false, true]) {
  for (const style of NORMAL_STYLES) CASES.push({ style, riichi: false, flat, p: styleParams(flat ? SLIDE_DISCARD : DEFAULT_DISCARD, style, flat) });
  for (const style of RIICHI_STYLES) CASES.push({ style, riichi: true, flat, p: styleParams(flat ? SLIDE_RIICHI : RIICHI_DISCARD, style, flat) });
  // 横推：落在一行里靠左的格子推得远
  for (const col of [0, 2, 5]) CASES.push({ style: 'push', riichi: true, flat, p: styleParams(flat ? SLIDE_RIICHI : RIICHI_DISCARD, 'push', flat, pushDistAt(col)) });
  // 大星淡的双立直
  CASES.push({ style: 'fling', riichi: true, flat, p: styleParams(flat ? SLIDE_RIICHI : RIICHI_DISCARD, 'fling', flat) });
}
const label = (c: (typeof CASES)[number]) => `${c.riichi ? '立直' : '平常'} ${c.style}${c.p.pushDist ? ` 推 ${c.p.pushDist.toFixed(2)}` : ''} ${c.flat ? '2.5D' : '3D'}`;

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

const c2riichi = (style: DiscardStyle) => style === 'fling' || (RIICHI_STYLES as DiscardStyle[]).includes(style);

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
      const stop = c.p.reach + c.p.carry + afterTime(c.style, c.p);
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
    const sideways = (style: DiscardStyle) => c2riichi(style) && style !== 'place';
    for (const c of CASES) {
      if (!['slide', 'stand', 'turn', 'top', 'push', 'fling'].includes(c.style)) continue;
      for (const spin of [1, -1]) {
        const pa = path(c.style, sideways(c.style), { spin, landed: TO.clone() });
        const rest = reach(pa.to, pa.toQuat);
        const land = c.p.reach + c.p.carry;
        for (let t = land; t <= land + afterTime(c.style, c.p) + 0.02; t += 1 / 480) {
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
      expect(declare[0].t, label(c)).toBeCloseTo(land + declareDelay(c.style, c.p));
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

  it('横推：匀速推过去，落在一行里越靠左推得越远、越久', () => {
    expect(pushDistAt(5)).toBe(pushDistAt(4));
    expect(pushDistAt(0)).toBeGreaterThan(pushDistAt(2));
    expect(pushDistAt(2)).toBeGreaterThan(pushDistAt(4));
    // 放下的地方不超出这一行的右头太多：第一格推过来的那张，放下时右边还在六格以内
    expect(TILE_H / 2 + pushDistAt(0) + TILE_H / 2).toBeLessThanOrEqual(6 * (TILE_W + POND_GAP));
    let speed = 0;
    for (const col of [0, 1, 3, 5]) {
      const p = styleParams(SLIDE_RIICHI, 'push', true, pushDistAt(col));
      const pa = path('push', true, { landed: TO.clone() });
      const land = p.reach + p.carry;
      // 落桌时在落点右边那么远
      expect(sampleDiscard(p, pa, land + 1e-6).tilePos.x - TO.x).toBeCloseTo(pushDistAt(col), 4);
      // 推的那一段每一小步走得一样远
      const steps: number[] = [];
      const dt = 1 / 240;
      const from = land + 0.1 + dt;
      const to = land + afterTime('push', p) - dt;
      for (let t = from; t + dt <= to; t += dt) steps.push(sampleDiscard(p, pa, t).tilePos.x - sampleDiscard(p, pa, t + dt).tilePos.x);
      expect(steps.length).toBeGreaterThan(5);
      for (const d of steps) expect(d).toBeCloseTo(steps[0], 6);
      // 远近都是同一个速度
      if (speed) expect(steps[0] / dt).toBeCloseTo(speed, 4);
      speed = steps[0] / dt;
      // 推得越远，摆好得越晚
      expect(declareDelay('push', p)).toBeCloseTo(0.1 + pushDistAt(col) / speed, 4);
    }
  });

  it('回旋（淡的双立直）：从右手边跟前甩出去，牌面一直朝上，转着走一道弧线，从右边滑进落点', () => {
    for (const flat of [false, true]) {
      const p = styleParams(flat ? SLIDE_RIICHI : RIICHI_DISCARD, 'fling', flat);
      const pa = path('fling', true);
      const grab = p.reach;
      const land = p.reach + p.carry;
      const up = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, 1).applyQuaternion(q).y; // 牌面朝上是 1
      // 带到右手边跟前：在落点右边、靠自己这边
      const wind = sampleDiscard(p, pa, grab + p.carry * 0.3);
      expect(wind.tilePos.x - TO.x).toBeGreaterThan(3);
      expect(wind.tilePos.z - TO.z).toBeGreaterThan(3);
      expect(up(wind.tileQuat)).toBeGreaterThan(0.999);
      let turned = 0;
      let prev = wind;
      let maxX = -Infinity;
      for (let t = grab + p.carry * 0.3 + 1 / 240; t <= land + afterTime('fling', p); t += 1 / 240) {
        if (t >= land) pa.landed = TO.clone();
        const cur = sampleDiscard(p, pa, t);
        // 出手以后牌面一直朝上
        expect(up(cur.tileQuat), `t=${t.toFixed(3)}`).toBeGreaterThan(0.999);
        // 一路往左前方去：不往回走（落桌以后让牌角的那一点点不算）
        if (t < land) {
          expect(cur.tilePos.x).toBeLessThanOrEqual(prev.tilePos.x + 1e-6);
          expect(cur.tilePos.z).toBeLessThanOrEqual(prev.tilePos.z + 1e-6);
        }
        // 弧线：往右前方鼓出去（在起点到落点那条直线的右前方）
        maxX = Math.max(maxX, cur.tilePos.x);
        turned += cur.tileQuat.angleTo(prev.tileQuat);
        prev = cur;
      }
      // 途中转了好几圈
      expect(turned).toBeGreaterThan(2 * Math.PI * 2.5);
      // 弧线上的中间一点比直线靠右、靠前
      const mid = sampleDiscard(p, { ...pa, landed: undefined }, grab + p.carry * 0.65);
      const k = (mid.tilePos.z - TO.z) / (wind.tilePos.z - TO.z);
      expect(mid.tilePos.x).toBeGreaterThan(TO.x + k * (wind.tilePos.x - TO.x) + 0.5);
      // 飞过牌山的那一段够高（牌山两层高 2 个牌厚）
      for (let t = grab + p.carry * 0.3; t < land; t += 1 / 240) {
        const pose = sampleDiscard(p, { ...pa, landed: undefined }, t);
        if (pose.tilePos.z > 8.5) expect(pose.tilePos.y - TILE_T / 2).toBeGreaterThan(2 * TILE_T + 0.3);
      }
      // 落桌时在落点右边，之后往左滑进去
      expect(sampleDiscard(p, pa, land + 1e-6).tilePos.x).toBeGreaterThan(TO.x + 1);
    }
  });

  it('2.5D 平常的牌不拖沓：花样最长也在一秒以内，立直宣言两秒以内', () => {
    for (const c of CASES) {
      if (!c.flat) continue;
      expect(totalTime(c.p, 0, c.style), label(c)).toBeLessThan(c.riichi ? 2 : 1);
    }
  });
});
