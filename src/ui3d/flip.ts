import * as THREE from 'three';
import type { Changeover, WallRect } from './changeover';
import { TILE_T, TILE_W } from './tableLayout';

// 翻牌屏（牌桌风格「翻牌屏」）的换局：像车站的翻牌屏换一屏。
// 一局打完，桌上的牌从对面那一排起，一排排往自己这边翻下去，翻着翻着沉进桌面（像翻牌的叶片翻进槽里）；
// 然后四家的牌山一墩墩从桌面里翻上来：每家都从自己左手那头翻到右手那头，像一行字一个个翻出来，都翻好才掷骰子发牌。
//
// 这里管旧牌（替身牌）怎么翻下去、什么时候该响哪一声；新牌山的每一墩什么时候翻上来、翻到哪（wallPose、wallAxis）
// 由 table3d.ts 照着摆（changeover.ts）

// 该响的声音：clatter 一排排翻下去（一阵哗啦啦的翻牌声，dur 秒），riffle 牌山一墩墩翻到位（一墩一下“嗒”，第一墩到最后一墩 dur 秒），latch 都翻好了（咔哒一声）
export type FlipCue = 'clatter' | 'riffle' | 'latch';

// 时间（秒）：从对面那排翻到自己这排要多久；同一排从左到右晚多少；每张再随机晚一点；一张翻下去要多久
const SWEEP = 0.55;
const ROW_SKEW = 0.12;
const JITTER = 0.04;
const FALL = 0.34;
// 旧牌翻完沉到桌面下多深
const SINK = 1.4;
// 旧牌开始翻以后多久，新牌山开始翻上来（自己跟前那排旧牌差不多翻完了）；同一家相邻两墩隔多久；一墩翻上来要多久；
// 都翻好以后停多久再掷骰子
const RISE_AFTER = 0.75;
const STEP = 0.05;
const UP = 0.34;
const SETTLE = 0.15;
// 新牌山的一墩翻上来之前藏在桌面下多深（倒扣着整墩都在桌面下）；冒出来用 UP 的几成
const RISE_SINK = 1.7;
const EMERGE = 0.42;
// 冒出来以后从什么时候开始翻（UP 的几成），什么时候翻到底拍到挡片上（越翻越快，像翻牌屏的叶片掉下来）；
// 拍上去翻过头多少（弧度）再弹回来
const TURN_FROM = 0.16;
const HIT = 0.78;
const OVER = 0.16;
// 每家牌山几墩
const STACKS = 17;
// 一墩（两层）的中心有多高：翻的时候绕这一墩的中心转
const MID = TILE_T;

const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
const easeOut = (k: number) => 1 - (1 - k) ** 2;

// 一张旧牌：从原来的样子绕横轴（和一排牌平行）往自己这边翻下去，边翻边往下沉
interface Piece {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  axis: THREE.Vector3;
  t0: number;
}

// 新牌山的一墩：在哪（x、z），绕哪根轴翻（沿着这一家牌山的水平轴，翻的时候顶上先朝外），什么时候开始翻
interface Stack {
  x: number;
  z: number;
  axis: THREE.Vector3;
  at: number;
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const X_BACK = new THREE.Vector3(-1, 0, 0);
const FACE = new THREE.Vector3(0, 0, 1);

export class Flip implements Changeover<FlipCue> {
  readonly group = new THREE.Group();
  // 每一墩各有各的轴（wallAxis），这根用不上
  readonly tiltAxis = new THREE.Vector3(1, 0, 0);
  // 牌山翻上来的时候牌面会朝上、朝镜头：演着的时候牌山上的牌不露牌面（底下那张翻上来是一块空白的牌身）
  readonly hideFaces = true;
  private now = 0;
  private half = 14;
  private pieces: Piece[] = [];
  private sweptAt = -Infinity;
  private rects: WallRect[] = [];
  private stacks: Stack[] = [];
  private forming = false;
  private formEnd = -Infinity;
  private cues: { at: number; cue: FlipCue; dur: number }[] = [];
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();

  build(half: number): void {
    this.half = half;
  }

  setScale(): void {}

  // 收牌：这些替身牌从对面那排起一排排往自己这边翻下去，沉进桌面
  sweep(objs: THREE.Object3D[], now: number): void {
    this.now = now;
    if (!objs.length) return;
    this.sweptAt = now;
    const h = Math.max(1, this.half);
    const n = this.tmpV;
    for (const obj of objs) {
      const row = clamp01((obj.position.z + h) / (2 * h));
      const col = clamp01((obj.position.x + h) / (2 * h));
      // 牌面朝对面立着的牌（对家的手牌）往自己这边翻，牌面会翻到朝上：这种往对面翻
      n.copy(FACE).applyQuaternion(obj.quaternion);
      // 扣着的牌（牌山、暗杠）往自己这边翻到后来牌面朝上：牌面藏起来（table3d.ts 给替身牌的牌面那层标了 face），翻起来是空白的牌身
      if (n.y < -0.5) obj.traverse((o) => (o.visible = o.userData.face ? false : o.visible));
      this.pieces.push({
        obj,
        from: obj.position.clone(),
        fromQuat: obj.quaternion.clone(),
        axis: n.z < -0.3 ? X_BACK : X_AXIS,
        t0: now + row * SWEEP + col * ROW_SKEW + Math.random() * JITTER,
      });
      this.group.add(obj);
    }
    this.cue(now, 'clatter', SWEEP + ROW_SKEW + FALL);
  }

  // 新牌山：四家一起，各从自己左手那头一墩墩翻上来。返回从 now 起多久以后可以掷骰子
  rise(now: number, rects: WallRect[]): number {
    this.now = now;
    this.rects = rects;
    // 刚收过牌：等旧牌差不多翻完再开始；发牌前选技能那一段早就收完了、第一局桌上没牌：马上开始
    const start = Math.max(now + 0.15, this.sweptAt + RISE_AFTER);
    this.stacks = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (const r of rects) {
      const alongX = r.hx > r.hz;
      const halfLong = alongX ? r.hx : r.hz;
      const span = 2 * (halfLong - TILE_W / 2);
      const pitch = span / (STACKS - 1);
      // 朝外（这一家坐的那边）：翻上来的时候顶上先朝外，再立起来
      const out = alongX ? new THREE.Vector3(0, 0, Math.sign(r.z) || 1) : new THREE.Vector3(Math.sign(r.x) || 1, 0, 0);
      const axis = new THREE.Vector3().crossVectors(up, out).normalize();
      // 这一家左手那头先翻：坐在那边、朝桌子中间看，左手是 up × 朝向（朝向是 -out）
      const left = new THREE.Vector3().crossVectors(up, out.clone().negate());
      for (let k = 0; k < STACKS; k++) {
        const along = -span / 2 + k * pitch;
        const x = alongX ? r.x + along : r.x;
        const z = alongX ? r.z : r.z + along;
        // 离左手那头多远（0 是最左那墩）
        const idx = Math.round((span / 2 - along * (alongX ? left.x : left.z)) / pitch);
        this.stacks.push({ x, z, axis, at: start + idx * STEP });
      }
    }
    this.forming = true;
    this.formEnd = start + (STACKS - 1) * STEP + UP;
    // 一墩拍到挡片上那一下“嗒”：第一墩到最后一墩
    this.cue(start + UP * HIT, 'riffle', (STACKS - 1) * STEP);
    this.cue(this.formEnd - UP * (1 - HIT) + 0.03, 'latch', 0.2);
    return this.formEnd + SETTLE - now;
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

  wallAxis(x: number, z: number): THREE.Vector3 {
    return this.stackAt(x, z)?.axis ?? this.tiltAxis;
  }

  // 牌山上 (x, z) 那一墩：还没开始翻返回 false（藏在桌面下）；翻的时候绕这一墩的中心转，中心从桌面下升上来
  wallPose(x: number, z: number, out: THREE.Vector4): boolean {
    out.set(0, 0, 0, 0);
    if (!this.forming) return true;
    const s = this.stackAt(x, z);
    if (!s) return true;
    const k = (this.now - s.at) / UP;
    if (k < 0) return false;
    if (k >= 1) return true;
    // 倒扣着（π，空白的牌身朝上）从桌面下冒上来，冒得差不多了开始翻，越翻越快，拍到底（0）翻过头一点再弹回来
    let ang: number;
    if (k < HIT) ang = Math.PI * (1 - clamp01((k - TURN_FROM) / (HIT - TURN_FROM)) ** 2);
    else {
      const u = (k - HIT) / (1 - HIT);
      ang = -OVER * Math.sin(Math.PI * u) * (1 - u) ** 0.6;
    }
    const yc = MID - RISE_SINK * (1 - easeOut(clamp01(k / EMERGE))) ** 2;
    const v = this.tmpV.set(0, MID, 0).applyQuaternion(this.tmpQ.setFromAxisAngle(s.axis, ang));
    out.set(-v.x, yc - v.y, -v.z, ang);
    return true;
  }

  get busy(): boolean {
    return (this.forming && this.now < this.formEnd + SETTLE) || this.pieces.length > 0 || this.cues.length > 0;
  }

  update(now: number): { cue: FlipCue; dur: number }[] {
    this.now = now;
    this.apply();
    if (this.forming && now > this.formEnd + SETTLE) this.forming = false;
    const due = this.cues.filter((c) => now >= c.at);
    this.cues = this.cues.filter((c) => now < c.at);
    return due.map(({ cue, dur }) => ({ cue, dur }));
  }

  finish(): void {
    for (const p of this.pieces) this.group.remove(p.obj);
    this.pieces = [];
    this.stacks = [];
    this.cues = [];
    this.forming = false;
    this.formEnd = -Infinity;
  }

  dispose(): void {
    this.finish();
  }

  private cue(at: number, cue: FlipCue, dur: number): void {
    this.cues.push({ at, cue, dur });
  }

  // 旧牌：到了自己那一排就绕横轴翻下去（远的那条边先翘起来），越翻越快、越沉越深，翻完整个沉到桌面下就拿掉
  private apply(): void {
    const now = this.now;
    this.pieces = this.pieces.filter((p) => {
      const k = (now - p.t0) / FALL;
      if (k >= 1) {
        this.group.remove(p.obj);
        return false;
      }
      const e = clamp01(k);
      p.obj.quaternion.copy(p.fromQuat).premultiply(this.tmpQ.setFromAxisAngle(p.axis, Math.PI * e * e));
      p.obj.position.copy(p.from);
      p.obj.position.y -= SINK * e * e * e;
      return true;
    });
  }
}
