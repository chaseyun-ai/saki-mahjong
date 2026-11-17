import * as THREE from 'three';
import type { Changeover, WallRect } from './changeover';
import { TILE_W } from './tableLayout';

// 深夜（牌桌风格「深夜」）的换局：熄灯。一局打完，“啪嗒”一声灯灭了，屋里一片黑，只剩牌背上的夜光月牙和仪表盘还亮着一点：
// 黑里像表上的秒针扫过一圈，从 12 点（对面正中）起顺时针，扫到哪里哪里的旧牌被收走（月牙往中间一滑，没了）；
// 再扫一圈，扫到哪里哪里码上新牌山（一墩亮出一个月牙）。码好了日光灯“叮、叮”闪两下才亮稳，再掷骰子发牌。
// 发牌前要选技能的局（先收牌、过一阵才码牌山）：收完牌灯先亮回来，码牌山时再熄一次。
//
// 这里管灯多亮（lightAt：table3d.ts 照着调环境光、主光，牌背上的月牙照着亮）、旧牌怎么被收走、
// 新牌山每一墩什么时候码上（wallPose），和什么时候该响哪一声

// 该响的声音：off 拉灯（“啪嗒”），collect 黑里收牌（dur 秒），stack 码牌山（一墩一下轻轻的“嗒”，dur 秒），flicker 日光灯闪着亮起来（dur 秒）
export type LampCue = 'off' | 'collect' | 'stack' | 'flicker';

// 灯熄下去要多久；黑着的时候还剩多亮（一点点，看得出桌子的轮廓）
const OFF = 0.12;
export const DARK = 0.035;
// 熄灯以后多久开始收旧牌；收牌那一圈扫多久；一张牌滑走要多久、往中间滑多远（滑着缩小，滑完就没了）
const GATHER_FROM = 0.15;
const GATHER = 0.45;
const SLIDE = 0.22;
const SLIDE_D = 0.9;
// 熄灯以后多久开始码新牌山：收牌那一圈扫完；桌上本来没牌（第一局、发牌前已经收过）就早一点
const BUILD_FROM = 0.64;
const BUILD_EMPTY = 0.3;
// 码牌山那一圈扫多久；一墩从多高落下来、落多久
const BUILD = 0.6;
const DROP = 0.12;
const DROP_H = 0.32;
// 码好以后多久开灯；亮稳以后多久掷骰子
const ON_AFTER = 0.18;
const SETTLE = 0.15;
// 只收牌、不码牌山（发牌前选技能）：熄灯以后多久灯自己亮回来
const RELIGHT = 1.0;
const STACKS = 17;

// 桌上 (x, z) 在表盘上是几点：12 点是对面正中（-z，自己坐在 +z 那边），顺时针（从上往下看）转一圈是 0 到 1
export function clockAt(x: number, z: number): number {
  const a = Math.atan2(x, -z) / (Math.PI * 2);
  return a < 0 ? a + 1 : a;
}

// 日光灯启动：从开灯那一刻算起几秒、那一刻灯多亮，中间照直线连。闪两下才亮稳；
// 一秒里最多闪两下（不到三下，不刺眼），闪的那两下也不到全亮。2D 的熄灯（app.ts 的 lamp2d）照同一条
export const FLICK: [number, number][] = [
  [0, DARK],
  [0.015, 0.6],
  [0.06, 0.6],
  [0.08, 0.1],
  [0.2, 0.1],
  [0.215, 0.45],
  [0.245, 0.45],
  [0.265, 0.14],
  [0.33, 0.14],
  [0.4, 0.82],
  [0.52, 1],
];
export const FLICKER = FLICK[FLICK.length - 1][0];

// 开灯以后 t 秒灯多亮
export function flickAt(t: number): number {
  if (t <= 0) return FLICK[0][1];
  for (let i = 1; i < FLICK.length; i++) {
    const [t1, v1] = FLICK[i];
    if (t < t1) {
      const [t0, v0] = FLICK[i - 1];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return 1;
}

// 黑里被收走的一张旧牌：t0 开始往中间滑（dir），越滑越快，滑完就没了
interface Piece {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  scale: number;
  t0: number;
}

// 新牌山的一墩：at 码上（从 DROP_H 高落下来）
interface Stack {
  x: number;
  z: number;
  at: number;
}

// 一次熄灯：off 拉灯，from 拉灯时灯多亮（正闪着又熄的话不是 1），on 开灯（日光灯从这一刻起闪着亮起来）
interface Cycle {
  off: number;
  from: number;
  on: number;
}

export class Lamp implements Changeover<LampCue> {
  readonly group = new THREE.Group();
  // 码上的那一墩不歪
  readonly tiltAxis = new THREE.Vector3(1, 0, 0);
  private now = 0;
  private pieces: Piece[] = [];
  private rects: WallRect[] = [];
  private stacks: Stack[] = [];
  private formEnd = -Infinity;
  private cycle: Cycle | null = null;
  private cues: { at: number; cue: LampCue; dur: number }[] = [];

  build(): void {}

  setScale(): void {}

  // 灯现在多亮：1 是平时，黑着的时候 DARK
  lightAt(t: number): number {
    const c = this.cycle;
    if (!c || t < c.off) return 1;
    if (t < c.on) return c.from + (DARK - c.from) * Math.min(1, (t - c.off) / OFF);
    return flickAt(t - c.on);
  }

  // 灯熄着（拉了灯、还没开）
  private dark(t: number): boolean {
    return !!this.cycle && t >= this.cycle.off && t < this.cycle.on;
  }

  // 拉灯：从现在多亮熄下去。relight：过多久自己亮回来（码牌山时会推到码好以后）
  private switchOff(now: number, relight: number): void {
    this.cycle = { off: now, from: this.lightAt(now), on: now + relight };
    this.cue(now, 'off', 0.1);
    this.switchOn(now + relight);
  }

  // 开灯的时候改到 at（日光灯那一声跟着挪）
  private switchOn(at: number): void {
    if (!this.cycle) return;
    this.cycle.on = at;
    this.cues = this.cues.filter((c) => c.cue !== 'flicker');
    this.cue(at, 'flicker', FLICKER);
  }

  // 收牌：拉灯，黑里这些替身牌一张张被收走
  sweep(objs: THREE.Object3D[], now: number): void {
    this.now = now;
    if (!objs.length) return;
    if (!this.dark(now)) this.switchOff(now, RELIGHT);
    const from = Math.max(now, this.cycle!.off + GATHER_FROM);
    for (const obj of objs) {
      const p = obj.position.clone();
      const dir = new THREE.Vector3(-p.x, 0, -p.z);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      // 扫到这张的时候被收走（同一个地方的几张差一点点）
      const t0 = from + clockAt(p.x, p.z) * GATHER + Math.random() * 0.02;
      this.pieces.push({ obj, from: p, dir: dir.normalize(), scale: obj.scale.x, t0 });
      this.group.add(obj);
    }
    this.cue(from, 'collect', GATHER + SLIDE);
  }

  // 码新牌山：灯还亮着就先拉灯；黑里从 12 点起顺时针扫一圈，扫到哪一墩码上哪一墩，码好了开灯。返回从 now 起多久以后可以掷骰子
  rise(now: number, rects: WallRect[]): number {
    this.now = now;
    this.rects = rects;
    let start: number;
    if (this.dark(now)) start = Math.max(now + 0.05, this.cycle!.off + (this.pieces.length ? BUILD_FROM : BUILD_EMPTY));
    else {
      this.switchOff(now, BUILD_EMPTY);
      start = now + BUILD_EMPTY;
    }
    this.stacks = [];
    for (const r of rects) {
      const alongX = r.hx > r.hz;
      const halfLong = alongX ? r.hx : r.hz;
      const span = 2 * (halfLong - TILE_W / 2);
      const pitch = span / (STACKS - 1);
      for (let k = 0; k < STACKS; k++) {
        const along = -span / 2 + k * pitch;
        const x = alongX ? r.x + along : r.x;
        const z = alongX ? r.z : r.z + along;
        this.stacks.push({ x, z, at: start + clockAt(x, z) * BUILD });
      }
    }
    this.formEnd = start + BUILD + DROP;
    this.cue(start, 'stack', BUILD + DROP);
    const on = this.formEnd + ON_AFTER;
    this.switchOn(on);
    return on + FLICKER + SETTLE - now;
  }

  onWall(x: number, z: number): boolean {
    return this.rects.some((r) => Math.abs(x - r.x) <= r.hx + 0.05 && Math.abs(z - r.z) <= r.hz + 0.05);
  }

  private stackAt(x: number, z: number): Stack | null {
    let best: Stack | null = null;
    let bd = Infinity;
    for (const s of this.stacks) {
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return bd < 0.5 ? best : null;
  }

  // 牌山上 (x, z) 那一墩：还没码上返回 false（先藏着）；码上时从半空落下来，越落越快
  wallPose(x: number, z: number, out: THREE.Vector4): boolean {
    out.set(0, 0, 0, 0);
    const s = this.stackAt(x, z);
    if (!s) return true;
    const k = (this.now - s.at) / DROP;
    if (k < 0) return false;
    if (k < 1) out.y = DROP_H * (1 - k * k);
    return true;
  }

  // 还在演：牌山还没码好、旧牌还没收完、还有声音没响（日光灯那一声响了，灯自己闪着亮完，不用管）
  get busy(): boolean {
    return this.now < this.formEnd || this.pieces.length > 0 || this.cues.length > 0;
  }

  update(now: number): { cue: LampCue; dur: number }[] {
    this.now = now;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      const k = (now - p.t0) / SLIDE;
      if (k >= 1) {
        this.group.remove(p.obj);
        this.pieces.splice(i, 1);
        continue;
      }
      if (k <= 0) continue;
      const e = k * k;
      p.obj.position.copy(p.from).addScaledVector(p.dir, SLIDE_D * e);
      p.obj.scale.setScalar(p.scale * (1 - 0.85 * e));
    }
    const due = this.cues.filter((c) => now >= c.at);
    this.cues = this.cues.filter((c) => now < c.at);
    return due.map(({ cue, dur }) => ({ cue, dur }));
  }

  finish(): void {
    for (const p of this.pieces) this.group.remove(p.obj);
    this.pieces = [];
    this.stacks = [];
    this.cues = [];
    this.cycle = null;
    this.formEnd = -Infinity;
  }

  dispose(): void {
    this.finish();
  }

  private cue(at: number, cue: LampCue, dur: number): void {
    this.cues.push({ at, cue, dur });
  }
}
