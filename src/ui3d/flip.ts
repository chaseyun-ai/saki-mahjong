import * as THREE from 'three';
import type { Changeover, WallRect } from './changeover';
import { TILE_T, TILE_W } from './tableLayout';

// 翻转（牌桌风格「翻转」，原来叫翻牌屏）的换局：像车站的翻牌屏换一屏。
// 一局打完，桌上的牌从对面那一排起，一排排往自己这边翻下去，翻着翻着沉进桌面（像翻牌的叶片翻进槽里）；
// 桌面本身也是一块块翻板拼的：牌翻下去紧跟着，脚下那块桌面绕中线整块翻个面（远的那条边先翘起来、翻过来拍平，弹一下），
// 一波从对面翻到自己跟前，像整张翻牌屏换了一屏；
// 然后四家的牌山一墩墩从桌面里翻上来：每家都从自己左手那头翻到右手那头，像一行字一个个翻出来，都翻好才掷骰子发牌。
//
// 这里管旧牌（替身牌）怎么翻下去、桌面的翻板、什么时候该响哪一声；新牌山的每一墩什么时候翻上来、翻到哪（wallPose、wallAxis）
// 由 table3d.ts 照着摆（changeover.ts）

// 该响的声音：clatter 一排排翻下去（一阵哗啦啦的翻牌声，dur 秒），board 桌面的翻板一块块拍平（一块一下闷一点的“哐”，第一块到最后一块 dur 秒），
// riffle 牌山一墩墩翻到位（一墩一下“嗒”，第一墩到最后一墩 dur 秒），latch 都翻好了（咔哒一声）
export type FlipCue = 'clatter' | 'board' | 'riffle' | 'latch';

// 时间（秒）：从对面那排翻到自己这排要多久（桌面的翻板也是这个速度，一次只有三四排在翻，看得出是一波）；
// 同一排从左到右晚多少；每张再随机晚一点；一张翻下去要多久
const SWEEP = 0.85;
const ROW_SKEW = 0.12;
const JITTER = 0.04;
const FALL = 0.34;
// 旧牌翻完沉到桌面下多深
const SINK = 1.4;
// 旧牌开始翻以后多久，新牌山开始翻上来（自己跟前那圈牌山底下的翻板都拍平了，不然新牌山会从还在翻的板子里穿出来）；
// 同一家相邻两墩隔多久；一墩翻上来要多久；都翻好以后停多久再掷骰子
const RISE_AFTER = 1.4;
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
// 桌面的翻板：仪表盘外面每边切几块（仪表盘底下那四块不翻）；翻板多厚，翻板之间留多宽的缝；
// 比脚下的牌晚多久开始翻（牌差不多沉下去了才翻，翻板不会从牌里穿过去），一块翻一面要多久；拍平以后弹回来多少（弧度）
const CELLS_OUT = 4;
const PLATE_T = 0.07;
const PLATE_GAP = 0.035;
const PLATE_LAG = 0.26;
const PLATE_TIME = 0.32;
const PLATE_HIT = 0.8;
const PLATE_OVER = 0.22;
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

// 桌面的一块翻板：绕自己的中线（和一排牌平行）翻个面；翻的时候底下的槽露出来（slot，压暗的桌布）
interface Plate {
  mesh: THREE.Mesh;
  slot: THREE.Mesh;
  x: number;
  z: number;
  t0: number;
}

// 翻板翻一面的角度：像翻牌屏的叶片掉下来，越翻越快，拍到底（π）弹回来一点再落定
function plateAngle(k: number): number {
  if (k < PLATE_HIT) return Math.PI * (k / PLATE_HIT) ** 2;
  const u = (k - PLATE_HIT) / (1 - PLATE_HIT);
  return Math.PI - PLATE_OVER * Math.sin(Math.PI * u) * (1 - u) ** 0.6;
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
  // 桌面的翻板（有桌布材质才有）：平时整组藏着，换局时一块块翻
  private board = new THREE.Group();
  private plates: Plate[] = [];
  private boardEnd = -Infinity;
  private edgeMat: THREE.MeshStandardMaterial;
  // 翻板底下的槽：还是那张桌布，压暗成阴影里的样子（纯黑的话一排排翻起来像一道道黑条）
  private slotMat: THREE.MeshBasicMaterial;

  // felt：桌布的材质（翻板两面贴同一张桌布，翻完和原来的桌面接得上）；edge：翻板侧边的颜色（铝）
  constructor(
    private felt: THREE.Material | null = null,
    edge = '#dfe3e7',
  ) {
    this.edgeMat = new THREE.MeshStandardMaterial({ color: edge, roughness: 0.45, metalness: 0.35 });
    this.slotMat = new THREE.MeshBasicMaterial({ color: '#8a9099', map: (felt as THREE.MeshStandardMaterial | null)?.map ?? null });
    this.board.visible = false;
    this.group.add(this.board);
  }

  build(half: number, consoleHalf = 2.9): void {
    this.half = half;
    this.buildBoard(half, consoleHalf);
  }

  // 桌面切成翻板：仪表盘那一块的边线对齐（仪表盘底下的四块不要），外面每边 CELLS_OUT 块。
  // 每块是一块薄板，上下两面都贴桌布：上面照它平放时在桌上的位置贴，下面照翻过来以后的位置贴，所以翻完和翻之前一模一样
  private buildBoard(half: number, ch: number): void {
    for (const p of this.plates) {
      p.mesh.geometry.dispose();
      p.slot.geometry.dispose();
    }
    this.board.clear();
    this.plates = [];
    if (!this.felt || half <= ch) return;
    const s = (half - ch) / CELLS_OUT;
    const lines: number[] = [];
    for (let i = 0; i < CELLS_OUT; i++) lines.push(-half + i * s);
    lines.push(-ch, 0, ch);
    for (let i = 1; i <= CELLS_OUT; i++) lines.push(ch + i * s);
    const uv = (x: number, z: number): [number, number] => [(x + half) / (2 * half), (half - z) / (2 * half)];
    const mats = [this.edgeMat, this.edgeMat, this.felt, this.felt, this.edgeMat, this.edgeMat];
    for (let i = 0; i + 1 < lines.length; i++) {
      for (let j = 0; j + 1 < lines.length; j++) {
        const x = (lines[i] + lines[i + 1]) / 2;
        const z = (lines[j] + lines[j + 1]) / 2;
        // 仪表盘底下
        if (Math.abs(x) < ch && Math.abs(z) < ch) continue;
        const w = lines[i + 1] - lines[i];
        const d = lines[j + 1] - lines[j];
        const geo = new THREE.BoxGeometry(w - PLATE_GAP, PLATE_T, d - PLATE_GAP);
        // BoxGeometry 每面 4 个顶点，顺序是 +x、-x、+y、-y、+z、-z：+y（上面）照原位置贴，-y（下面）照绕 x 轴翻半圈以后的位置贴
        const pos = geo.getAttribute('position');
        const uvs = geo.getAttribute('uv');
        for (let v = 8; v < 16; v++) {
          const px = pos.getX(v);
          const pz = pos.getZ(v);
          const [u, w2] = v < 12 ? uv(x + px, z + pz) : uv(x + px, z - pz);
          uvs.setXY(v, u, w2);
        }
        const mesh = new THREE.Mesh(geo, mats);
        // 上面和桌面齐平（高出一丝，盖住底下的桌布），绕板子自己的中心翻
        mesh.position.set(x, -PLATE_T / 2 + 0.004, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.visible = false;
        const slotGeo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
        const sp = slotGeo.getAttribute('position');
        const su = slotGeo.getAttribute('uv');
        for (let v = 0; v < sp.count; v++) su.setXY(v, ...uv(x + sp.getX(v), z + sp.getZ(v)));
        const slot = new THREE.Mesh(slotGeo, this.slotMat);
        slot.position.set(x, 0.002, z);
        slot.visible = false;
        this.board.add(mesh, slot);
        this.plates.push({ mesh, slot, x, z, t0: Infinity });
      }
    }
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
    // 桌面的翻板跟在牌后面，一样从对面那排翻到自己这排
    if (this.plates.length) {
      let first = Infinity;
      let last = -Infinity;
      for (const p of this.plates) {
        p.t0 = now + clamp01((p.z + h) / (2 * h)) * SWEEP + clamp01((p.x + h) / (2 * h)) * ROW_SKEW + PLATE_LAG;
        first = Math.min(first, p.t0);
        last = Math.max(last, p.t0);
      }
      this.boardEnd = last + PLATE_TIME;
      this.board.visible = true;
      this.cue(first + PLATE_TIME * PLATE_HIT, 'board', last - first);
    }
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
    return (this.forming && this.now < this.formEnd + SETTLE) || this.pieces.length > 0 || this.cues.length > 0 || this.now < this.boardEnd;
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
    this.boardEnd = -Infinity;
    for (const p of this.plates) {
      p.t0 = Infinity;
      p.mesh.visible = p.slot.visible = false;
    }
    this.board.visible = false;
  }

  dispose(): void {
    this.finish();
    for (const p of this.plates) {
      p.mesh.geometry.dispose();
      p.slot.geometry.dispose();
    }
    this.plates = [];
    this.edgeMat.dispose();
    this.slotMat.dispose();
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
    // 桌面的翻板：轮到哪块，哪块绕中线翻个面，底下的槽露出来；翻完和桌面一模一样，藏起来
    if (!this.board.visible) return;
    for (const p of this.plates) {
      const k = (now - p.t0) / PLATE_TIME;
      const on = k > 0 && k < 1;
      p.mesh.visible = p.slot.visible = on;
      if (on) p.mesh.rotation.x = plateAngle(k);
    }
    if (now >= this.boardEnd) this.board.visible = false;
  }
}
