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
  flingBow,
  flingCurve,
  markers,
  BRAKE_DIST,
  pushDistAt,
  pushDistFor,
  sampleDiscard,
  styleParams,
  totalTime,
} from '../src/ui3d/discardMotion';
import { FLING_RADIUS, blockDistance, flingBlocked, planFling, tileBlock } from '../src/ui3d/flingPath';
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
  for (const col of [0, 2, 5]) CASES.push({ style: 'push', riichi: true, flat, p: styleParams(flat ? SLIDE_RIICHI : RIICHI_DISCARD, 'push', flat, pushDistAt(col), col > 0) });
  for (const col of [0, 2, 5]) CASES.push({ style: 'brake', riichi: true, flat, p: styleParams(flat ? SLIDE_RIICHI : RIICHI_DISCARD, 'brake', flat, pushDistFor('brake', col), col > 0) });
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
      // （淡的回旋不在这里：只有双立直用，那是她牌河里的头一张，左边、里面都还没有牌；路上碰不碰东西由 flingPath 管）
      if (!['slide', 'stand', 'turn', 'top', 'push', 'brake'].includes(c.style)) continue;
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

  it('横推：往回带一点再越推越快，落在一行里越靠左推得越远、越久；撞得上前一张的撞上就停', () => {
    // 一行通常六张：最远（第一格）也只推三张牌宽，越往右越短，第六格往右都一样
    expect(pushDistAt(0)).toBeCloseTo(3, 6);
    for (let col = 1; col <= 5; col++) expect(pushDistAt(col)).toBeLessThan(pushDistAt(col - 1));
    expect(pushDistAt(5)).toBeCloseTo(1.25, 6);
    expect(pushDistAt(8)).toBe(pushDistAt(5));
    // 放下的地方不超出这一行的右头太多：第一格推过来的那张，放下时右边还在六格以内
    expect(TILE_H / 2 + pushDistAt(0) + TILE_H / 2).toBeLessThanOrEqual(6 * (TILE_W + POND_GAP));
    let last = Infinity;
    for (const col of [0, 1, 3, 5]) {
      const hit = col > 0;
      const p = styleParams(SLIDE_RIICHI, 'push', true, pushDistAt(col), hit);
      const pa = path('push', true, { landed: TO.clone() });
      const land = p.reach + p.carry;
      const end = land + afterTime('push', p);
      const x = (t: number) => sampleDiscard(p, pa, t).tilePos.x - TO.x;
      // 落桌时在落点右边那么远，停一下不动
      expect(x(land + 1e-6)).toBeCloseTo(pushDistAt(col), 4);
      expect(x(land + 0.09)).toBeCloseTo(pushDistAt(col), 4);
      // 先往回带一点（往右），再推过去
      const dt = 1 / 480;
      let back = 0;
      let top = 0;
      let topAt = 0;
      const speeds: number[] = [];
      for (let t = land + 0.1; t + dt <= end + 1e-9; t += dt) {
        back = Math.max(back, x(t) - pushDistAt(col));
        const v = (x(t) - x(t + dt)) / dt;
        speeds.push(v);
        if (v > top) [top, topAt] = [v, t];
      }
      expect(back).toBeGreaterThan(0.1);
      expect(back).toBeLessThan(0.3);
      // 不是匀速：最快的时候比平均快得多
      const mean = (pushDistAt(col) + back) / (afterTime('push', p) - 0.1 - 0.13);
      expect(top).toBeGreaterThan(mean * 1.7);
      if (hit) {
        // 撞得上：越推越快，到头最快（撞上就停）
        expect(end - topAt).toBeLessThan(0.02);
        expect(cues(p, 'push').map((c) => c.kind)).toEqual(['scrape', 'knock', 'declare']);
      } else {
        // 一行的第一张没牌可撞：到头之前自己刹住
        expect(end - topAt).toBeGreaterThan(0.05);
        expect(speeds.at(-1)!).toBeLessThan(top * 0.2);
        expect(cues(p, 'push').map((c) => c.kind)).toEqual(['scrape', 'slap', 'declare']);
      }
      // 推到头正好在落点，不越过去
      expect(x(end)).toBeCloseTo(0, 6);
      for (let t = land; t <= end; t += dt) expect(x(t)).toBeGreaterThan(-1e-6);
      // 推得越远，摆好得越晚
      expect(declareDelay('push', p)).toBeLessThan(last);
      expect(declareDelay('push', p)).toBeLessThan(0.6);
      last = declareDelay('push', p) + 1e-9;
    }
  });

  it('横推：一样横着放在右边，起步时右边略微抬起、左边的边贴着桌面，从约两个牌宽处一把推出去，一路刹到停在落点放平', () => {
    // 牌左下那条边：横着的牌往右是一行的方向（这里是 +x）
    const R = new THREE.Vector3(1, 0, 0);
    const UP = new THREE.Vector3(0, 1, 0);
    const toEdge = R.clone().multiplyScalar(-TILE_H / 2).addScaledVector(UP, -TILE_T / 2);
    const tableY = TO.y - TILE_T / 2;
    for (const col of [0, 1, 3, 5]) {
      // 落在哪一格都从两个牌宽处起步；左边有没有前一张都一样，自己刹住，不撞
      expect(pushDistFor('brake', col)).toBe(BRAKE_DIST);
      expect(BRAKE_DIST).toBeCloseTo(2, 6);
      const p = styleParams(SLIDE_RIICHI, 'brake', true, pushDistFor('brake', col), col > 0);
      expect(p.pushHit).toBe(false);
      const pa = path('brake', true, { landed: TO.clone() });
      const land = p.reach + p.carry;
      const end = land + afterTime('brake', p);
      const pose = (t: number) => sampleDiscard(p, pa, t);
      // 牌转了多少（去掉横过来那一下），左下那条边在哪
      const tiltOf = (t: number) => pose(t).tileQuat.clone().multiply(pa.toQuat.clone().invert());
      const edge = (t: number) => {
        const s = pose(t);
        return s.tilePos.clone().add(toEdge.clone().applyQuaternion(tiltOf(t)));
      };
      const angle = (t: number) => 2 * Math.acos(Math.min(1, Math.abs(tiltOf(t).w)));
      const x = (t: number) => edge(t).x - (TO.x - TILE_H / 2);
      expect(x(land + 1e-6)).toBeCloseTo(BRAKE_DIST, 4);
      expect(x(land + 0.09)).toBeCloseTo(BRAKE_DIST, 4);
      // 起步略微倾斜：十度出头，右边抬起来（右下角比左下角高），左边的边在桌面上
      expect(angle(land + 0.05)).toBeGreaterThan(0.15);
      expect(angle(land + 0.05)).toBeLessThan(0.3);
      const rightBottom = pose(land + 0.05).tilePos.clone().add(R.clone().multiplyScalar(TILE_H / 2).addScaledVector(UP, -TILE_T / 2).applyQuaternion(tiltOf(land + 0.05)));
      expect(rightBottom.y - tableY).toBeGreaterThan(0.15);
      const dt = 1 / 480;
      for (let t = land; t <= end + 1e-9; t += dt) {
        expect(edge(t).y, `t=${(t - land).toFixed(3)}`).toBeCloseTo(tableY, 4);
        expect(clearance(pose(t).tilePos, pose(t).tileQuat)).toBeGreaterThan(-1e-4);
      }
      // 推完放平
      expect(angle(end)).toBeLessThan(1e-4);
      const go = land + 0.1 + 0.13; // 放下停完、往回带完，开始推
      let back = 0;
      let top = 0;
      let topAt = 0;
      let prevAngle = Infinity;
      const speeds: number[] = [];
      for (let t = land + 0.1; t + dt <= end + 1e-9; t += dt) {
        back = Math.max(back, x(t) - BRAKE_DIST);
        const v = (x(t) - x(t + dt)) / dt;
        if (t >= go) {
          speeds.push(v);
          // 一边推一边慢慢放平，不会又翘起来
          expect(angle(t)).toBeLessThanOrEqual(prevAngle + 1e-6);
          prevAngle = angle(t);
        }
        if (v > top) [top, topAt] = [v, t];
      }
      expect(back).toBeGreaterThan(0.1);
      expect(back).toBeLessThan(0.3);
      // 起步很快：推的这一段不到三成时间就到最快；之后一直在慢下来，到头几乎停住
      expect((topAt - go) / (end - go)).toBeLessThan(0.3);
      expect((topAt - go) / (end - go)).toBeGreaterThan(0.1);
      const peak = speeds.indexOf(Math.max(...speeds));
      for (let i = peak + 2; i < speeds.length; i++) expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1] + 1e-6);
      expect(speeds.at(-1)!).toBeLessThan(top * 0.05);
      // 刹车占了一大半：推到一半时间的时候已经走过大半的路，剩下的慢慢滑到
      expect(x((go + end) / 2)).toBeLessThan(BRAKE_DIST * 0.4);
      // 一路只往左，正好停在落点，不越过去
      for (const v of speeds) expect(v).toBeGreaterThan(-1e-6);
      expect(x(end)).toBeCloseTo(0, 6);
      expect(pose(end).tilePos.distanceTo(TO)).toBeLessThan(1e-6);
      for (let t = land; t <= end; t += dt) expect(x(t)).toBeGreaterThan(-1e-6);
      // 到头只有轻轻一下，没有撞
      expect(cues(p, 'brake').map((c) => c.kind)).toEqual(['scrape', 'tap', 'declare']);
      // 摆好还是在 0.6 秒以内
      expect(declareDelay('brake', p)).toBeLessThan(0.6);
    }
  });

  it('回旋（淡的双立直）：牌面朝上放到右手边的桌角，贴着桌面转着滑一道弧线到落点', () => {
    for (const flat of [false, true]) {
      const p = styleParams(flat ? SLIDE_RIICHI : RIICHI_DISCARD, 'fling', flat);
      const corner = new THREE.Vector3(12.9, TO.y, 12.9);
      p.flingFrom = corner.clone();
      p.flingVia = flingBow(corner, TO, new THREE.Vector3(0, 0, 1), 0.7);
      const pa = path('fling', true);
      const land = p.reach + p.carry;
      const end = land + afterTime('fling', p);
      const up = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, 1).applyQuaternion(q).y; // 牌面朝上是 1
      // 落桌：就在桌角，横着、牌面朝上
      const start = sampleDiscard(p, pa, land);
      expect(start.tilePos.distanceTo(corner)).toBeLessThan(1e-6);
      expect(start.tileQuat.angleTo(SIDE)).toBeLessThan(1e-6);
      pa.landed = TO.clone();
      let turned = 0;
      let prev = start;
      let step = Infinity;
      for (let t = land + 1 / 240; t <= end; t += 1 / 240) {
        const cur = sampleDiscard(p, pa, t);
        // 一路贴着桌面、牌面朝上
        expect(cur.tilePos.y, `t=${t.toFixed(3)}`).toBeCloseTo(TO.y, 9);
        expect(up(cur.tileQuat)).toBeGreaterThan(0.999999);
        // 一路往左前方去，越滑越慢
        expect(cur.tilePos.x).toBeLessThanOrEqual(prev.tilePos.x + 1e-6);
        expect(cur.tilePos.z).toBeLessThanOrEqual(prev.tilePos.z + 1e-6);
        const d = cur.tilePos.distanceTo(prev.tilePos);
        expect(d).toBeLessThanOrEqual(step + 1e-6);
        step = d;
        turned += cur.tileQuat.angleTo(prev.tileQuat);
        prev = cur;
      }
      // 途中转了四整圈，停下来正好是横的
      expect(turned).toBeCloseTo(2 * Math.PI * 4, 1);
      // 弧线：中间一点在起点到落点那条直线的右前方
      const mid = flingCurve(corner, p.flingVia, TO, 0.5);
      const k = (mid.z - TO.z) / (corner.z - TO.z);
      expect(mid.x).toBeGreaterThan(TO.x + k * (corner.x - TO.x) + 1);
      // 滑到位才算宣言
      expect(declareDelay('fling', p)).toBeCloseTo(afterTime('fling', p));
      const last = sampleDiscard(p, pa, end);
      expect(last.tilePos.distanceTo(TO)).toBeLessThan(1e-6);
      expect(last.tileQuat.angleTo(SIDE)).toBeLessThan(1e-6);
    }
    // 牌桌没给起点、弧线时有默认的：落点右边、靠自己这边
    const p = styleParams(SLIDE_RIICHI, 'fling', true);
    const at = sampleDiscard(p, path('fling', true), p.reach + p.carry).tilePos;
    expect(at.x - TO.x).toBeGreaterThan(8);
    expect(at.z - TO.z).toBeGreaterThan(6);
  });

  it('回旋的路线：挑一道碰不到牌山的弧，都挡住了就没有', () => {
    const from = new THREE.Vector3(12.9, TO.y, 12.9);
    const T = new THREE.Vector3(0, 0, 1);
    const lie = (x: number, z: number, yaw = 0) => tileBlock(new THREE.Vector3(x, TILE_T / 2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(FLAT));
    // 自己面前的牌山（沿 x 排，z = 9.45）、右手边那家的牌山（沿 z 排，x = 9.45）：各 17 墩
    const mine = (skip: (i: number) => boolean) => Array.from({ length: 17 }, (_, i) => i).filter((i) => !skip(i)).map((i) => lie((8 - i) * 1.02, 9.45));
    const right = (skip: (i: number) => boolean) => Array.from({ length: 17 }, (_, i) => i).filter((i) => !skip(i)).map((i) => lie(9.45, (8 - i) * 1.02, Math.PI / 2));
    // 躺着的牌占牌面那么大，立着的占牌底那么大
    expect(lie(0, 0)).toMatchObject({ hx: TILE_W / 2, hz: TILE_H / 2 });
    const stand = tileBlock(new THREE.Vector3(0, TILE_H / 2, 0), new THREE.Quaternion());
    expect([stand.hx, stand.hz]).toEqual([TILE_W / 2, TILE_T / 2]);
    expect(blockDistance(lie(0, 0), 0.4, 0.6)).toBe(0);
    expect(blockDistance(lie(0, 0), 1.5, 0)).toBeCloseTo(1);
    // 两边牌山都是满的：没有路
    expect(planFling(from, TO, T, [...mine(() => false), ...right(() => false)], 14)).toBeNull();
    // 桌上什么都没有：走原本想要的那一道弧
    const free = planFling(from, TO, T, [], 14)!;
    expect(free.distanceTo(flingBow(from, TO, T, 0.7).setY(TO.y))).toBeLessThan(1e-9);
    // 弯到头的那一道：先笔直朝前、再拐向左；直线：控制点就在正中间
    expect(flingBow(from, TO, T, 1).distanceTo(new THREE.Vector3(from.x, TO.y, TO.z))).toBeLessThan(1e-9);
    expect(flingBow(from, TO, T, 0).distanceTo(from.clone().add(TO).multiplyScalar(0.5))).toBeLessThan(1e-9);
    expect(flingBow(from, TO, T, -1).distanceTo(new THREE.Vector3(TO.x, TO.y, from.z))).toBeLessThan(1e-9);
    // 右手边那家的牌山靠自己这头摸掉了几墩，或者自己面前的牌山右头摸掉了几墩：从缺口过去，路上不碰牌
    for (const blocks of [
      [...mine(() => false), ...right((i) => i < 5)],
      [...mine((i) => i < 5), ...right(() => false)],
      [...mine(() => false), ...right((i) => i < 4)],
    ]) {
      const via = planFling(from, TO, T, blocks, 14);
      expect(via).not.toBeNull();
      expect(flingBlocked(from, via!, TO, blocks, 14)).toBe(false);
      for (let u = 0; u <= 1; u += 0.01) {
        const at = flingCurve(from, via!, TO, u);
        for (const b of blocks) expect(blockDistance(b, at.x, at.z)).toBeGreaterThanOrEqual(FLING_RADIUS);
      }
    }
    // 只缺一墩，转着的牌过不去
    expect(planFling(from, TO, T, [...mine(() => false), ...right((i) => i === 3)], 14)).toBeNull();
  });

  it('2.5D 平常的牌不拖沓：花样最长也在一秒以内，立直宣言两秒以内', () => {
    for (const c of CASES) {
      if (!c.flat) continue;
      expect(totalTime(c.p, 0, c.style), label(c)).toBeLessThan(c.riichi ? 2 : 1);
    }
  });
});
