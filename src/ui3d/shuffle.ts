import * as THREE from 'three';
import type { Changeover, WallRect } from './changeover';
import { TILE_T, TILE_W, WALL_Z } from './tableLayout';
import { type WashArea, type Washed, keepIn, randomSpot, spread, wash } from './wash';

// 原木（牌桌风格「原木」）的换局：手搓洗牌。自动麻将机是机器洗牌，原木就是家里木桌上手洗：
// 一局打完，桌上的牌全扣过来往中间一推，摊成乱糟糟的一桌；四家八只手一把一把地推（怎么推在 wash.ts）：
// 这一把往中间推，下一把往回带、往旁边抹，手边的一片牌跟着手走，撞得东倒西歪、转了向，有的还骑到别的牌上。
// 不是整堆绕着仪表盘转圈。洗几把以后四家各自从跟前的牌里两张两张拿出来，
// 在自己跟前码成一排两层的牌山，码好往前一推，推到位才掷骰子发牌。第一局桌上没牌，就是把一副牌倒在桌上再洗。
//
// 这里只管牌堆里那些替身牌（扣过来、洗、被拿走）和什么时候该响哪一声；
// 新牌山的每一墩从牌堆哪里拿出来、码在哪、什么时候往前推（wallPose）由 table3d.ts 照着摆（changeover.ts）

// 该响的声音：pour 一副牌倒在桌上，scoop 牌扣过来推到中间，shuffle 搓牌（哗啦哗啦，dur 秒），build 码牌山（一墩一墩，dur 秒），push 牌山往前一推
export type ShuffleCue = 'pour' | 'scoop' | 'shuffle' | 'build' | 'push';

// 时间（秒）：一张牌扣过来推进牌堆要多久（每张随机再晚一点）；第一局一副牌倒下来要多久
const GATHER = 0.42;
const GATHER_JITTER = 0.12;
const POUR = 0.5;
// 收牌以后多久开始洗、多久开始码牌山；牌堆放了一阵（发牌前选技能）再开局时，先再洗多久
const SWIRL_FROM = 0.3;
const BUILD_AT = 1.6;
const RESWIRL = 0.6;
// 同一家相邻两墩隔多久拿出来；四家各自晚一点开始；一墩从牌堆滑到跟前要多久
const STEP = 0.042;
const WALL_JITTER = 0.1;
const SLIDE = 0.2;
// 码完一家隔多久往前推、推多久；最后一家推到位以后停多久再掷骰子
const PUSH_AFTER = 0.08;
const PUSH = 0.2;
const SETTLE = 0.1;
// 码在跟前比最后的位置往外多少（往前推的那一截）
const PUSH_D = 0.6;
// 每家牌山几墩
const STACKS = 17;

// 扣着躺平的牌（牌面朝下）：和牌山上的一样，再绕竖轴转 yaw
const FACE_DOWN = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.PI));
const UP = new THREE.Vector3(0, 1, 0);

const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
const smooth = (k: number) => k * k * (3 - 2 * k);
const easeOut = (k: number) => 1 - (1 - k) ** 2.4;

// 牌堆里的一张替身牌：先从原来的样子扣过来推到牌堆里（第一局是从半空倒下来），落在 (x, z)、朝 yaw，
// 然后被手一把一把推着走（Washed 的 pushes、ex、ez、m，见 wash.ts）
interface Piece extends Washed {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  fromScale: number;
  t0: number;
  dur: number;
  fresh: boolean;
  x: number;
  z: number;
  yaw: number;
  y: number;
}

// 新牌山的一墩：哪一家（w）、第几墩（k）、最后码到哪（x、z），往外是哪个方向；
// 什么时候从牌堆里拿出来（at），拿出来时在哪、歪多少（from、yaw，拿的时候才定），什么时候往前推（push）
interface Stack {
  x: number;
  z: number;
  // 这一家的牌山是不是沿 x 摆的（上下两家）：牌横过来躺着，长边朝 z
  alongX: boolean;
  out: THREE.Vector2;
  at: number;
  push: number;
  from: THREE.Vector2 | null;
  yaw: number;
}

export class Shuffle implements Changeover<ShuffleCue> {
  readonly group = new THREE.Group();
  // 拿出来的那一墩是歪着的（绕竖轴），滑到跟前时摆正
  readonly tiltAxis = new THREE.Vector3(0, 1, 0);
  private now = 0;
  private half = 14;
  // 牌摊在哪：仪表盘外面、一直摊到码牌山的那条线（洗的时候桌上还没有牌山）的一圈方形的地方
  // （离桌子中心横竖最远的那个方向上，至少 cIn、至多 cOut）
  private cIn = 3.7;
  private cOut = 9.1;
  private pieces: Piece[] = [];
  // 最近一次洗牌从什么时候洗到什么时候（每一把怎么推在洗之前就排好，记在每张牌的 pushes 里，跳着看也对）
  private washed: { s: number; e: number } | null = null;
  private rects: WallRect[] = [];
  private stacks: Stack[] = [];
  private forming = false;
  private formEnd = -Infinity;
  private cues: { at: number; cue: ShuffleCue; dur: number }[] = [];
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();

  // 桌子尺寸变了：牌摊的地方照仪表盘和牌山算（牌山的位置等 rise 给了再细算）
  build(half: number, consoleHalf: number): void {
    this.half = half;
    this.cIn = consoleHalf + 0.75;
    this.cOut = Math.max(this.cIn + 1.5, WALL_Z - 0.35);
  }

  private get area(): WashArea {
    return { inX: this.cIn, inZ: this.cIn, outX: this.cOut, outZ: this.cOut };
  }

  // 排一段洗牌（s 到 e）
  private wash(s: number, e: number): void {
    this.washed = { s, e };
    wash(this.pieces, this.area, s, e);
  }

  setScale(): void {}

  // 第一局桌上没牌：要 table3d.ts 另外给一副扣着的牌（倒在桌上搓）
  wantsTiles(): boolean {
    return this.pieces.length === 0;
  }

  // 收牌：这些替身牌扣过来推进牌堆，搓起来。userData.fresh 的是第一局倒在桌上的那副牌（从半空落下来）
  sweep(objs: THREE.Object3D[], now: number): void {
    this.now = now;
    if (!objs.length) return;
    const fresh = objs.some((o) => o.userData.fresh);
    const area = this.area;
    const added: Piece[] = [];
    objs.forEach((obj, i) => {
      // 落在哪：摊开的那一圈里随便一处和它原来的地方（收进圈里）之间，各家的牌大致还在各家跟前，又不是原样一排
      const spot = randomSpot(area);
      if (!obj.userData.fresh) {
        spot.x = (spot.x + obj.position.x) / 2 + (Math.random() - 0.5) * 2;
        spot.y = (spot.y + obj.position.z) / 2 + (Math.random() - 0.5) * 2;
      }
      keepIn(spot, area);
      const p: Piece = {
        obj,
        from: obj.position.clone(),
        fromQuat: obj.quaternion.clone(),
        fromScale: obj.scale.x,
        t0: now + Math.random() * (fresh ? 0.15 : GATHER_JITTER),
        dur: fresh ? POUR * (0.8 + Math.random() * 0.25) : GATHER * (0.85 + Math.random() * 0.3),
        fresh: !!obj.userData.fresh,
        x: spot.x,
        z: spot.y,
        yaw: Math.random() * Math.PI * 2,
        // 牌堆不是平的：一张张高低差一点（叠在一起的地方不闪）
        y: TILE_T / 2 + (i % 7) * 0.012,
        pushes: [],
        ex: spot.x,
        ez: spot.y,
        m: Math.random() * 0.9,
      };
      added.push(p);
      this.pieces.push(p);
      this.group.add(obj);
    });
    // 落下来不叠成一堆：互相让开
    spread(this.pieces, area, 6);
    for (const p of added) {
      p.x = p.ex;
      p.z = p.ez;
      if (p.fresh) {
        // 从半空随便什么姿势落下来
        p.from.set(p.x * 0.85, 2 + Math.random() * 1.6, p.z * 0.85);
        p.fromQuat.setFromEuler(new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3));
      }
    }
    this.wash(now + SWIRL_FROM, now + BUILD_AT + 0.1);
    if (fresh) this.cue(now, 'pour', POUR + 0.15);
    else this.cue(now, 'scoop', GATHER + GATHER_JITTER);
    this.cue(now + SWIRL_FROM, 'shuffle', BUILD_AT - SWIRL_FROM + 0.4);
  }

  // 码新牌山：四家各自从牌堆里两张两张拿出来码在跟前，码好往前推。返回从 now 起多久以后可以掷骰子
  rise(now: number, rects: WallRect[]): number {
    this.now = now;
    this.rects = rects;
    // 牌一直摊到码牌山的那条线
    const line = Math.min(...rects.map((r) => (r.hx > r.hz ? Math.abs(r.z) : Math.abs(r.x))));
    if (Number.isFinite(line)) this.cOut = Math.max(this.cIn + 1.5, line - 0.35);
    // 这一次收牌洗到什么时候：洗完已经放了一阵（发牌前选技能那一段收过牌），开局先再洗几把
    const last = this.washed;
    let start: number;
    if (last && now < last.s + BUILD_AT - SWIRL_FROM + 0.05) start = Math.max(now, last.s - SWIRL_FROM + BUILD_AT);
    else {
      start = now + RESWIRL;
      if (this.pieces.length) {
        this.wash(now, start + 0.1);
        this.cue(now, 'shuffle', RESWIRL + 0.4);
      }
    }
    this.stacks = [];
    let firstPush = Infinity;
    let lastPush = -Infinity;
    for (const r of rects) {
      const alongX = r.hx > r.hz;
      const halfLong = alongX ? r.hx : r.hz;
      const span = 2 * (halfLong - TILE_W / 2);
      const pitch = span / (STACKS - 1);
      // 往外（码在跟前的方向）：桌子外圈留得下才往外码
      const out = alongX ? new THREE.Vector2(0, Math.sign(r.z) || 1) : new THREE.Vector2(Math.sign(r.x) || 1, 0);
      const outer = (alongX ? Math.abs(r.z) + r.hz : Math.abs(r.x) + r.hx) + 0.25;
      out.multiplyScalar(Math.max(0, Math.min(PUSH_D, this.half - outer)));
      // 从哪头码起随机；四家各自晚一点开始
      const dir = Math.random() < 0.5 ? 1 : -1;
      const begin = start + Math.random() * WALL_JITTER;
      const push = begin + (STACKS - 1) * STEP + SLIDE + PUSH_AFTER;
      firstPush = Math.min(firstPush, push);
      lastPush = Math.max(lastPush, push);
      for (let k = 0; k < STACKS; k++) {
        const along = -span / 2 + k * pitch;
        const idx = dir > 0 ? k : STACKS - 1 - k;
        this.stacks.push({
          x: alongX ? r.x + along : r.x,
          z: alongX ? r.z : r.z + along,
          alongX,
          out,
          at: begin + idx * STEP,
          push,
          from: null,
          yaw: 0,
        });
      }
    }
    this.forming = true;
    this.formEnd = lastPush + PUSH;
    this.cue(start, 'build', (STACKS - 1) * STEP + SLIDE + WALL_JITTER);
    this.cue(firstPush, 'push', lastPush - firstPush + PUSH);
    return this.formEnd + SETTLE - now;
  }

  onWall(x: number, z: number): boolean {
    return this.rects.some((r) => Math.abs(x - r.x) <= r.hx + 0.05 && Math.abs(z - r.z) <= r.hz + 0.05);
  }

  // 离 (x, z) 最近的那一墩（同一墩上下两张一样）
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

  // 牌山上 (x, z) 那一墩：还没从牌堆里拿出来返回 false（先藏着）；拿出来以后滑到跟前（歪着的慢慢摆正），到时候往前推到位
  wallPose(x: number, z: number, out: THREE.Vector4): boolean {
    out.set(0, 0, 0, 0);
    if (!this.forming) return true;
    const s = this.stackAt(x, z);
    if (!s) return true;
    const now = this.now;
    if (now < s.at || !s.from) return false;
    // 码在跟前的位置（最后的位置往外 out），从牌堆滑过去
    const k = easeOut(clamp01((now - s.at) / SLIDE));
    let px = s.x + s.out.x + (s.from.x - s.x - s.out.x) * (1 - k);
    let pz = s.z + s.out.y + (s.from.y - s.z - s.out.y) * (1 - k);
    // 往前推：整排一起推到位
    const p = smooth(clamp01((now - s.push) / PUSH));
    px -= s.out.x * p;
    pz -= s.out.y * p;
    out.set(px - s.x, 0, pz - s.z, s.yaw * (1 - k));
    return true;
  }

  get busy(): boolean {
    return (this.forming && this.now < this.formEnd + SETTLE) || this.pieces.length > 0 || this.cues.length > 0;
  }

  update(now: number): { cue: ShuffleCue; dur: number }[] {
    this.now = now;
    this.apply();
    const due = this.cues.filter((c) => now >= c.at);
    this.cues = this.cues.filter((c) => now < c.at);
    return due.map(({ cue, dur }) => ({ cue, dur }));
  }

  finish(): void {
    for (const p of this.pieces) this.group.remove(p.obj);
    this.pieces = [];
    this.washed = null;
    this.stacks = [];
    this.cues = [];
    this.forming = false;
    this.formEnd = -Infinity;
  }

  dispose(): void {
    this.finish();
  }

  private cue(at: number, cue: ShuffleCue, dur: number): void {
    this.cues.push({ at, cue, dur });
  }

  // 一张牌 t 时在牌堆里该在哪、朝哪：落下的地方，加上到这时候为止被推的每一下（刚推出去快，滑一下停住）
  private pilePose(p: Piece, t: number, pos: THREE.Vector3): number {
    let x = p.x;
    let z = p.z;
    let y = p.y;
    let yaw = p.yaw;
    for (const u of p.pushes) {
      const k = (t - u.t) / u.dur;
      if (k <= 0) continue;
      const e = k >= 1 ? 1 : easeOut(k);
      x += u.dx * e;
      z += u.dz * e;
      yaw += u.dyaw * e;
      if (k < 1) y += u.hop * TILE_T * 0.75 * Math.sin(Math.PI * k);
    }
    pos.set(x, y, z);
    return yaw;
  }

  private apply(): void {
    const now = this.now;
    // 该从牌堆里拿牌的那几墩：拿跟前（这一墩往桌子中间收一点的地方）最近的两张（牌堆里那两张就没了），从那里滑出来
    if (this.forming) {
      for (const s of this.stacks) {
        if (s.from || now < s.at) continue;
        const lim = this.cOut - 0.3;
        const pick = new THREE.Vector2(Math.min(lim, Math.max(-lim, s.x)), Math.min(lim, Math.max(-lim, s.z)));
        const got: Piece[] = [];
        const S = s.at;
        for (let n = 0; n < 2; n++) {
          let best = -1;
          let bd = Infinity;
          this.pieces.forEach((p, i) => {
            if (got.includes(p) || s.at < p.t0 + p.dur) return;
            this.pilePose(p, S, this.tmpV);
            const d = (this.tmpV.x - pick.x) ** 2 + (this.tmpV.z - pick.y) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          });
          if (best >= 0) got.push(this.pieces[best]);
        }
        if (got.length) {
          s.from = new THREE.Vector2();
          let yaw = 0;
          for (const p of got) {
            yaw = this.pilePose(p, S, this.tmpV);
            s.from.x += this.tmpV.x / got.length;
            s.from.y += this.tmpV.z / got.length;
            this.group.remove(p.obj);
            this.pieces.splice(this.pieces.indexOf(p), 1);
          }
          // 牌山上的牌朝外（绕竖轴转多少都一样是扣着的）：歪的角度折到正负 90 度以内
          let d = yaw - (s.alongX ? 0 : Math.PI / 2);
          d = ((((d + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2;
          s.yaw = d;
        } else s.from = pick;
      }
      // 都码完了牌堆里还剩的（牌山上原来有几张没看见）：缩掉
      if (now > this.formEnd) {
        for (const p of this.pieces) this.group.remove(p.obj);
        this.pieces = [];
      }
      if (now > this.formEnd + SETTLE) this.forming = false;
    }
    const pos = this.tmpV;
    for (const p of this.pieces) {
      const o = p.obj;
      const yaw = this.pilePose(p, now, pos);
      const down = this.tmpQ.setFromAxisAngle(UP, yaw).multiply(FACE_DOWN);
      const k = clamp01((now - p.t0) / p.dur);
      if (k >= 1) {
        o.position.copy(pos);
        o.quaternion.copy(down);
        o.scale.setScalar(1);
        continue;
      }
      if (p.fresh) {
        // 倒下来：越落越快，落地时躺平
        const e = k * k;
        o.position.lerpVectors(p.from, pos, e);
        o.quaternion.copy(p.fromQuat).slerp(down, smooth(k));
      } else {
        // 扣过来推进去：先抬一点翻个身，再滑进牌堆
        const e = smooth(k);
        o.position.lerpVectors(p.from, pos, e);
        o.position.y += Math.sin(Math.PI * k) * 0.55;
        o.quaternion.copy(p.fromQuat).slerp(down, smooth(clamp01(k * 1.4)));
      }
      o.scale.setScalar(p.fromScale + (1 - p.fromScale) * smooth(k));
    }
  }
}
