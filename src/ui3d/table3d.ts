import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Game, GameEvent } from '../engine/game';
import type { Meld } from '../engine/score';
import { TILE_COUNT, TileId, WIND_CN } from '../engine/tiles';
import { FACE_TOTAL, FaceAtlas, faceIndex } from './faces';
import { Avatar } from './avatar';
import { LOOKS, applyLook } from './looks';
import { Dice } from './dice';
import { WallSlot, dealIndex, drawSlot, wallSlots } from './wallLayout';

// 3D 牌桌。规则状态全部来自 Game，这里只负责把每张牌摆到该在的位置，并做平滑移动。
//
// 坐标：桌面是 y = 0 的平面，桌子中心在原点。自己坐在 +z 一侧朝 -z 看，
// 下家在 +x，对家在 -z，上家在 -x。每个座位用“本地坐标”摆牌：本地 +z 指向座位的人，+x 是他的右手边，
// 再绕 y 轴转 seat × 90° 得到世界坐标。

export const TILE_W = 1;
export const TILE_H = 1.36;
export const TILE_T = 0.78;
const GAP = 0.04;

const HAND_Z = 11;
const POND_Z = 3.6;
const POND_COLS = 6;
const MELD_Z = 11.6;
const MY_HAND_SCALE = 1.25;
const WALL_Z = 9.45;
const WALL_PITCH = TILE_W + 0.02;
const TABLE_HALF = 14;
const CONSOLE_HALF = 2.9;

// 角色：VRoid 的 CC0 示例模型改色（见 looks.ts）。牌宽约 2.6 厘米，按这个比例人放大约 20 倍
const AVATAR_SCALE = 20;
const SEAT_Y = -0.3 * AVATAR_SCALE;
const SEAT_Z = TABLE_HALF + 0.2 * AVATAR_SCALE;

// 发牌：骰子落定后，每批 4 张（最后每人 1 张）依次发出
const DEAL_START = 1.3;
const DEAL_BATCH = 0.14;
const DEAL_END = DEAL_START + 16 * DEAL_BATCH + 0.35;

// 用手搬牌的动作：伸手、拿起来移过去、放下停一下、收手（秒）
interface HandTiming {
  reach: number;
  carry: number;
  settle: number;
  back: number;
  lift: number; // 移动时抬多高
}
const DISCARD_TIMING: HandTiming = { reach: 0.3, carry: 0.34, settle: 0.1, back: 0.4, lift: 1.4 };
const DRAW_TIMING: HandTiming = { reach: 0.26, carry: 0.3, settle: 0.04, back: 0.32, lift: 0.9 };

interface Character {
  seat: number;
  seatRoot: THREE.Group;
  avatar: Avatar | null;
}

interface DealState {
  start: number;
  dealer: number;
  sum: number;
  order: Map<TileId, { d: number; time: number }>;
}

interface HandAnim {
  seat: number;
  tile: TileId;
  t: number;
  start: THREE.Vector3;
  timing: HandTiming;
}

const STACKS_HALF = 9;

const STANDING = new THREE.Euler(0, 0, 0);
const FACE_UP = new THREE.Euler(-Math.PI / 2, 0, 0);
const FACE_DOWN = new THREE.Euler(Math.PI / 2, 0, Math.PI);

interface Placement {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

interface TileObj {
  group: THREE.Group;
  shown: boolean;
  target: Placement | null;
}

export interface SyncView {
  me: number;
  clickable: Set<TileId>;
  colors: string[];
  ids: string[];
}

export class Table3D {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  private atlas = new FaceAtlas();
  private tiles: TileObj[] = [];
  private faceGeoms: THREE.PlaneGeometry[] = [];
  private consoleCanvas = document.createElement('canvas');
  private consoleTex: THREE.CanvasTexture;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-9, -9);
  private hovered: TileId | null = null;
  private clickable = new Set<TileId>();
  private lastSync: { g: Game; view: SyncView } | null = null;
  private clock = new THREE.Clock();
  // 动画用的时间（秒），每帧最多走 0.05 秒，卡顿时动画放慢而不是跳过
  private now = 0;
  private frame = 0;
  private characters: Character[] = [];
  private characterGen = 0;
  private dice = new Dice(0.5);
  private deal: DealState | null = null;
  private handAnims: HandAnim[] = [];
  private held = new Set<TileId>();

  constructor(
    private container: HTMLElement,
    private onTileClick: (id: TileId) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.consoleCanvas.width = 512;
    this.consoleCanvas.height = 512;
    this.consoleTex = new THREE.CanvasTexture(this.consoleCanvas);
    this.consoleTex.colorSpace = THREE.SRGBColorSpace;

    this.buildRoom();
    this.buildTiles();
    this.scene.add(this.dice.group);
    void this.atlas.draw();

    this.resize();
    window.addEventListener('resize', this.resize);
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', () => this.pointer.set(-9, -9));
    el.addEventListener('click', this.onClick);
    this.loop();
    // 调试用：?debug 时可以在控制台里拿到牌桌对象
    if (location.search.includes('debug')) (window as unknown as { table3d: Table3D }).table3d = this;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- 场景 ----------

  private buildRoom(): void {
    this.scene.background = new THREE.Color('#0d2024');
    this.scene.fog = new THREE.Fog('#0d2024', 40, 80);

    this.scene.add(new THREE.HemisphereLight('#dfefff', '#1b2a2c', 1.1));
    const key = new THREE.DirectionalLight('#fff4e0', 2.2);
    key.position.set(-6, 22, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -16;
    sc.right = 16;
    sc.top = 16;
    sc.bottom = -16;
    key.shadow.bias = -0.0005;
    this.scene.add(key);

    // 桌布
    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(TABLE_HALF * 2, TABLE_HALF * 2),
      new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95 }),
    );
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    this.scene.add(felt);

    // 木框
    const wood = new THREE.MeshStandardMaterial({ color: '#6b3f22', roughness: 0.55, metalness: 0.05 });
    for (let s = 0; s < 4; s++) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(TABLE_HALF * 2 + 2, 0.9, 1), wood);
      rail.position.set(0, 0.25, TABLE_HALF + 0.5);
      rail.castShadow = true;
      rail.receiveShadow = true;
      const holder = new THREE.Group();
      holder.add(rail);
      holder.rotation.y = (s * Math.PI) / 2;
      this.scene.add(holder);
    }

    // 桌裙
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE_HALF * 2 + 1.6, 2.4, TABLE_HALF * 2 + 1.6),
      new THREE.MeshStandardMaterial({ color: '#3d2414', roughness: 0.7 }),
    );
    apron.position.y = -1.4;
    this.scene.add(apron);

    // 中央控制台：顶面画点数和局数
    const consoleMats = [
      new THREE.MeshStandardMaterial({ color: '#10292e', roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ map: this.consoleTex, roughness: 0.35 }),
    ];
    const box = new THREE.Mesh(new RoundedBoxGeometry(CONSOLE_HALF * 2, 0.5, CONSOLE_HALF * 2, 4, 0.25), consoleMats[0]);
    box.position.y = 0.25;
    box.receiveShadow = true;
    box.castShadow = true;
    this.scene.add(box);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(CONSOLE_HALF * 2 - 0.3, CONSOLE_HALF * 2 - 0.3), consoleMats[1]);
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.505;
    this.scene.add(top);
  }

  private buildTiles(): void {
    for (let i = 0; i < FACE_TOTAL; i++) this.faceGeoms.push(this.atlas.faceGeometry(i, TILE_W * 0.9, TILE_H * 0.9));
    const bodyGeom = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_T * 0.62, 3, 0.12);
    const backGeom = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_T * 0.42, 3, 0.12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#f6f1e3', roughness: 0.35 });
    const backMat = new THREE.MeshStandardMaterial({ color: '#2f78a8', roughness: 0.4 });
    const faceMat = new THREE.MeshStandardMaterial({ map: this.atlas.texture, transparent: true, roughness: 0.35 });
    for (let id = 0; id < TILE_COUNT; id++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.position.z = TILE_T * 0.19;
      const back = new THREE.Mesh(backGeom, backMat);
      back.position.z = -TILE_T * 0.25;
      const face = new THREE.Mesh(this.faceGeoms[faceIndex(id)], faceMat);
      face.position.z = TILE_T / 2 + 0.002;
      for (const m of [body, back]) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      group.add(body, back, face);
      group.userData.tileId = id;
      group.visible = false;
      this.scene.add(group);
      this.tiles.push({ group, shown: false, target: null });
    }
  }

  private buildCharacters(view: SyncView): void {
    const { colors, me } = view;
    for (const c of this.characters) this.scene.remove(c.seatRoot);
    this.characters = [];
    const gen = ++this.characterGen;
    for (let s = 0; s < 4; s++) {
      const rel = (s - me + 4) % 4;
      const seatRoot = new THREE.Group();
      const local = new THREE.Vector3(0, 0, SEAT_Z);
      seatRoot.position.copy(local.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seatAngle(s, me)));
      seatRoot.rotation.y = this.seatAngle(s, me);
      // 模型加载完之前先放一个简单的占位人物（自己的座位不放，免得挡住手牌）
      const holder = rel === 0 ? null : placeholder(colors[s]);
      if (holder) seatRoot.add(holder);
      this.scene.add(seatRoot);
      const ch: Character = { seat: s, seatRoot, avatar: null };
      this.characters.push(ch);
      const look = LOOKS[view.ids[s]] ?? LOOKS.saki;
      const url = look.model;
      Avatar.load(url)
        .then((av) => {
          if (gen !== this.characterGen) return;
          applyLook(av.vrm, look);
          if (holder) seatRoot.remove(holder);
          av.root.scale.setScalar(AVATAR_SCALE);
          av.root.position.y = SEAT_Y - av.hipHeight * AVATAR_SCALE;
          if (rel === 0) av.setFirstPerson(this.camera);
          // 桌面和桌沿换算到模型自身坐标；自己的手平时放在腿上，免得挡住手牌
          av.setRestPose(av.hipHeight - SEAT_Y / AVATAR_SCALE, (TABLE_HALF - SEAT_Z) / AVATAR_SCALE, rel === 0);
          seatRoot.add(av.root);
          ch.avatar = av;
          av.home = this.seatPoint(s, 0, 0, HAND_Z);
          // 偶尔瞟一眼别家的脸或者桌子中间
          av.glances = [0, 1, 2, 3]
            .filter((o) => o !== s)
            .map((o) => this.seatPoint(o, 0, SEAT_Y + 0.55 * AVATAR_SCALE, SEAT_Z))
            .concat(new THREE.Vector3(0, 0, 0));
        })
        .catch((err) => console.warn('角色模型加载失败', url, err));
    }
  }

  private characterAt(seat: number): Character | undefined {
    return this.characters.find((c) => c.seat === seat);
  }

  // 本地坐标 → 世界坐标
  private seatPoint(seat: number, x: number, y: number, z: number): THREE.Vector3 {
    const me = this.lastSync?.view.me ?? 0;
    return new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seatAngle(seat, me));
  }

  // 发牌或骰子动画还要多久（毫秒），这段时间里电脑先不出牌
  busyMs(): number {
    if (!this.deal) return 0;
    return Math.max(0, (this.deal.start + DEAL_END - this.now) * 1000);
  }

  // 牌局事件驱动骰子、发牌，以及角色的视线、表情和动作
  onEvent(e: GameEvent, g: Game): void {
    const all = this.characters;
    if (e.type === 'roundStart') this.startDeal(g);
    if (e.type === 'draw') {
      // 发牌动画里庄家的第一张不用另外伸手
      const drawn = g.players[e.seat].drawn;
      if (!this.deal && drawn !== null) this.startHandAnim(e.seat, drawn, DRAW_TIMING);
      const ch = this.characterAt(e.seat);
      if (ch && drawn !== null) ch.avatar?.lookAtPoint(this.tiles[drawn].group.position.clone(), 0.8);
    } else if (e.type === 'discard') {
      const pond = this.seatPoint(e.seat, 0, 0, POND_Z + 1.5);
      this.startHandAnim(e.seat, e.tile, DISCARD_TIMING);
      for (const ch of all) {
        // 别人出牌时看一眼，反应有先后
        ch.avatar?.lookAtPoint(pond, ch.seat === e.seat ? 1 : 0.9 + Math.random() * 0.8);
        if (ch.seat === e.seat && e.riichi) ch.avatar?.setMood('angry', 1.6);
      }
    } else if (e.type === 'call') {
      const who = this.seatPoint(e.seat, 0, 8, SEAT_Z);
      for (const ch of all) {
        if (ch.seat === e.seat) ch.avatar?.setMood('happy', 1.2);
        else ch.avatar?.lookAtPoint(who, 1.5);
      }
    } else if (e.type === 'ability') {
      for (const ch of all) {
        if (ch.seat === e.seat) ch.avatar?.setMood('relaxed', 2);
        else ch.avatar?.setMood('surprised', 1.2);
      }
    } else if (e.type === 'roundEnd') {
      const r = e.result;
      for (const ch of all) {
        if (r.wins.some((w) => w.seat === ch.seat)) ch.avatar?.setMood('happy', 3);
        else if (r.wins.some((w) => w.from === ch.seat)) ch.avatar?.setMood('sad', 3);
        else if (r.deltas[ch.seat] < 0) ch.avatar?.setMood('sad', 2);
      }
    } else if (e.type === 'roundStart') {
      // 掷骰子时大家看桌子中间
      for (const ch of all) ch.avatar?.lookAtPoint(new THREE.Vector3(0, 0.5, 0), DEAL_START);
    }
  }

  private startHandAnim(seat: number, tile: TileId, timing: HandTiming): void {
    const obj = this.tiles[tile];
    if (!obj.shown) return;
    // 同一个人上一个动作还没做完就直接结束它
    this.handAnims = this.handAnims.filter((a) => a.seat !== seat);
    this.handAnims.push({ seat, tile, t: 0, start: obj.group.position.clone(), timing });
  }

  // ---------- 摆牌 ----------

  // 座位在画面上的转角：自己永远在下方
  private seatAngle(seat: number, me: number): number {
    return (((seat - me + 4) % 4) * Math.PI) / 2;
  }

  private startDeal(g: Game): void {
    const start = this.now;
    const order = new Map<TileId, { d: number; time: number }>();
    for (let s = 0; s < 4; s++) {
      const rel = (s - g.dealer + 4) % 4;
      const drawn = g.players[s].drawn;
      g.players[s].hand.forEach((t, i) => {
        if (t === drawn) return;
        const { d, batch } = dealIndex(rel, i);
        order.set(t, { d, time: start + DEAL_START + batch * DEAL_BATCH });
      });
    }
    this.deal = { start, dealer: g.dealer, sum: g.dice[0] + g.dice[1], order };
    this.dice.roll(g.dice, DEAL_END + 0.6);
    this.handAnims = [];
    // 新的一局：所有牌从上方落下，重新码好牌山
    for (const t of this.tiles) t.shown = false;
  }

  sync(g: Game, view: SyncView): void {
    if (this.characters.length === 0) this.buildCharacters(view);
    this.lastSync = { g, view };
    this.clickable = view.clickable;
    const targets = new Map<TileId, Placement>();
    for (let s = 0; s < 4; s++) this.placeSeat(g, s, view.me, targets);
    for (const [t, slot] of wallSlots(g)) targets.set(t, this.wallPlacement(slot, view.me));
    this.applyDeal(g, view.me, targets);

    for (let id = 0; id < TILE_COUNT; id++) {
      const t = this.tiles[id];
      const target = targets.get(id) ?? null;
      t.target = target;
      if (!target) {
        t.group.visible = false;
        t.shown = false;
        continue;
      }
      if (!t.shown) {
        // 第一次出现：从上方落下
        t.group.position.copy(target.pos).add(new THREE.Vector3(0, 2.5, 0));
        t.group.quaternion.copy(target.quat);
        t.group.scale.setScalar(target.scale);
        t.group.visible = true;
        t.shown = true;
      }
    }
    this.drawConsole(g, view);
  }

  private toWorld(seat: number, me: number, x: number, y: number, z: number, rot: THREE.Euler, extraY = 0, scale = 1): Placement {
    const angle = this.seatAngle(seat, me);
    const axis = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3(x, y, z).applyAxisAngle(axis, angle);
    const quat = new THREE.Quaternion()
      .setFromAxisAngle(axis, angle + extraY)
      .multiply(new THREE.Quaternion().setFromEuler(rot));
    return { pos, quat, scale };
  }

  private placeSeat(g: Game, s: number, me: number, out: Map<TileId, Placement>): void {
    const p = g.players[s];
    const mine = s === me;
    const lyingY = TILE_T / 2;

    // 副露：从右边往左摆
    let mx = TABLE_HALF - 1.2;
    const meldWidth = (m: Meld) => m.tiles.length * (TILE_W + GAP) + (m.calledTile !== undefined ? TILE_H - TILE_W : 0);
    for (const m of p.melds) {
      const tiles = this.meldOrder(m);
      mx -= meldWidth(m);
      let x = mx;
      for (const [i, t] of tiles.entries()) {
        const sideways = t === m.calledTile;
        const hidden = m.type === 'ankan' && (i === 0 || i === 3);
        const w = sideways ? TILE_H : TILE_W;
        const z = sideways ? MELD_Z + (TILE_H - TILE_W) / 2 : MELD_Z;
        out.set(t, this.toWorld(s, me, x + w / 2, lyingY, z, hidden ? FACE_DOWN : FACE_UP, sideways ? Math.PI / 2 : 0));
        x += w + GAP;
      }
      if (m.type === 'kakan') {
        // 加杠的那张叠放在横着的牌上方（靠桌子中心一侧）
        const added = m.tiles[3];
        const ci = tiles.indexOf(m.calledTile!);
        let cx = mx;
        for (let i = 0; i < ci; i++) cx += TILE_W + GAP;
        out.set(added, this.toWorld(s, me, cx + TILE_H / 2, lyingY, MELD_Z + (TILE_H - TILE_W) / 2 - TILE_W - GAP, FACE_UP, Math.PI / 2));
      }
      mx -= 0.3;
    }

    // 手牌：自己的稍微后仰朝向镜头，别人的立着背对我们
    const drawn = p.drawn;
    const hand = p.hand.filter((t) => t !== drawn).sort((a, b) => a - b);
    const count = hand.length + (drawn !== null ? 1 : 0);
    // 自己的手牌放大一些，看得清也好点
    const hs = mine ? MY_HAND_SCALE : 1;
    const step = (TILE_W + GAP) * hs;
    const width = count * step + (drawn !== null ? 0.5 : 0);
    // 副露多了手牌往左让
    const shift = p.melds.length ? Math.max(0, width / 2 - (mx - 0.6)) : 0;
    let x = -width / 2 - shift + TILE_W / 2;
    const rot = mine ? new THREE.Euler(-0.32, 0, 0) : STANDING;
    const y = (TILE_H / 2) * hs;
    const place = (t: TileId) => {
      const lift = mine && t === this.hovered && this.clickable.has(t) ? 0.4 : 0;
      out.set(t, this.toWorld(s, me, x, y + lift, HAND_Z + (hs - 1) * 1.2, rot, 0, hs));
      x += step;
    };
    hand.forEach(place);
    if (drawn !== null) {
      x += 0.5;
      place(drawn);
    }

    // 牌河：六张一行，立直牌横放
    let col = 0;
    let row = 0;
    let px = -((POND_COLS * step) / 2);
    for (const d of p.discards) {
      if (d.called) continue;
      if (col === POND_COLS && row < 2) {
        col = 0;
        row++;
        px = -((POND_COLS * step) / 2);
      }
      const w = d.riichi ? TILE_H : TILE_W;
      const z = POND_Z + row * (TILE_H + GAP) + TILE_H / 2;
      out.set(d.tile, this.toWorld(s, me, px + w / 2, lyingY, z, FACE_UP, d.riichi ? Math.PI / 2 : 0));
      px += w + GAP;
      col++;
    }
  }

  // 副露里被叫的那张按来源放在对应位置：上家的放左边，对家中间，下家右边
  private meldOrder(m: Meld): TileId[] {
    if (m.calledTile === undefined || m.from === undefined) return m.tiles.slice(0, m.type === 'kakan' ? 3 : 4);
    const own = m.tiles.filter((t) => t !== m.calledTile).slice(0, m.type === 'kakan' ? 2 : 3);
    return [m.calledTile, ...own];
  }

  private wallPlacement(slot: WallSlot, me: number): Placement {
    const x = (STACKS_HALF - slot.stack) * WALL_PITCH;
    const y = slot.level === 0 ? TILE_T * 1.5 : TILE_T * 0.5;
    return this.toWorld(slot.wall, me, x, y, WALL_Z, slot.faceUp ? FACE_UP : FACE_DOWN);
  }

  // 发牌动画：还没轮到发的牌先留在牌山里
  private applyDeal(g: Game, me: number, out: Map<TileId, Placement>): void {
    const deal = this.deal;
    if (!deal) return;
    const now = this.now;
    if (now > deal.start + DEAL_END) {
      this.deal = null;
      return;
    }
    // 庄家的第 14 张最后再摸
    const drawn = g.players[deal.dealer].drawn;
    if (drawn !== null && !deal.order.has(drawn)) {
      deal.order.set(drawn, { d: 52, time: deal.start + DEAL_END - 0.25 });
    }
    for (const [t, o] of deal.order) {
      if (now < o.time && out.has(t)) out.set(t, this.wallPlacement(drawSlot(deal.dealer, deal.sum, o.d), me));
    }
  }

  // ---------- 中央控制台 ----------

  private drawConsole(g: Game, view: SyncView): void {
    const c = this.consoleCanvas.getContext('2d')!;
    const S = 512;
    c.fillStyle = '#0d2428';
    c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.lineWidth = 4;
    c.strokeRect(10, 10, S - 20, S - 20);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#f0c35a';
    c.font = "700 40px 'PingFang SC','Microsoft YaHei',sans-serif";
    c.fillText(g.roundLabel(), S / 2, S / 2 - 70);
    c.fillStyle = '#a9c3c4';
    c.font = "500 28px 'PingFang SC','Microsoft YaHei',sans-serif";
    c.fillText(`余 ${g.wall.remaining}　立直棒 ×${g.riichiSticks}`, S / 2, S / 2 - 22);
    // 宝牌指示牌：翻开的画牌面，没翻的画牌背
    const w = 40;
    const h = 54;
    g.wall.doraIndicators.forEach((t, i) => {
      const x = S / 2 + (i - 2.5) * (w + 6) + 3;
      const y = S / 2 + 6;
      c.fillStyle = i < g.wall.doraRevealed ? '#f6f1e3' : '#2f78a8';
      c.beginPath();
      c.roundRect(x, y, w, h, 6);
      c.fill();
      if (i < g.wall.doraRevealed) this.atlas.drawFace(c, faceIndex(t), x, y, w, h);
    });
    for (let s = 0; s < 4; s++) {
      const rel = (s - view.me + 4) % 4;
      c.save();
      c.translate(S / 2, S / 2);
      c.rotate((-rel * Math.PI) / 2);
      const p = g.players[s];
      const active = g.phase === 'turn' && g.turn === s;
      if (active) {
        c.fillStyle = 'rgba(240,195,90,0.18)';
        c.fillRect(-150, 160, 300, 70);
      }
      c.fillStyle = view.colors[s];
      c.font = "700 34px 'PingFang SC','Microsoft YaHei',sans-serif";
      c.fillText(WIND_CN[g.seatWind(s) - 27], -90, 196);
      c.fillStyle = active ? '#f0c35a' : '#f2efe6';
      c.font = "600 36px 'PingFang SC','Microsoft YaHei',sans-serif";
      c.fillText(String(p.score), 20, 196);
      if (p.riichi) {
        c.fillStyle = '#fff';
        c.fillRect(-60, 136, 120, 12);
        c.fillStyle = '#c0392b';
        c.beginPath();
        c.arc(0, 142, 5, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }
    this.consoleTex.needsUpdate = true;
  }

  // ---------- 交互和动画 ----------

  private resize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 竖屏时把视野拉宽，保证整张桌子都在画面里
    this.camera.fov = w / h < 1.2 ? 38 * Math.min(1.9, 1.2 / (w / h)) : 38;
    this.camera.position.set(0, 18, 28.5);
    this.camera.lookAt(0, 0.5, -1.5);
    this.camera.updateProjectionMatrix();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };

  private onClick = (e: MouseEvent): void => {
    this.onPointerMove(e as PointerEvent);
    const id = this.pick();
    if (id !== null && this.clickable.has(id)) this.onTileClick(id);
  };

  private pick(): TileId | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const cands = [...this.clickable].map((id) => this.tiles[id].group);
    const hit = this.raycaster.intersectObjects(cands, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && o.userData.tileId === undefined) o = o.parent;
    return o ? (o.userData.tileId as TileId) : null;
  }

  // 用手搬牌：伸手到那张牌，拿起来沿弧线移到目标，放下停一下，再收回手
  private animateHands(dt: number): void {
    this.held.clear();
    const up = new THREE.Vector3(0, 1, 0);
    const me = this.lastSync?.view.me ?? 0;
    const smooth = (x: number) => x * x * (3 - 2 * x);
    const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);
    this.handAnims = this.handAnims.filter((a) => {
      a.t += dt;
      const { reach, carry, settle, back, lift } = a.timing;
      const av = this.characterAt(a.seat)?.avatar;
      const tile = this.tiles[a.tile];
      const dest = tile.target?.pos;
      if (!dest || a.t > reach + carry + settle + back) {
        if (av) av.reachWeight = 0;
        return false;
      }
      // 手腕在牌的后上方，手指正好捏住牌
      const toward = new THREE.Vector3(0, 0, 1).applyAxisAngle(up, this.seatAngle(a.seat, me));
      const grip = (p: THREE.Vector3, raise: number) => p.clone().addScaledVector(toward, 1.6).addScaledVector(up, 1.2 + raise);
      let wrist: THREE.Vector3;
      let weight: number;
      if (a.t < reach) {
        // 伸手：先快后慢，最后一点点放慢对准
        const k = easeOut(a.t / reach);
        weight = k;
        wrist = grip(a.start, (1 - k) * 0.8);
        tile.group.position.copy(a.start);
        this.held.add(a.tile);
      } else if (a.t < reach + carry) {
        const k = smooth((a.t - reach) / carry);
        weight = 1;
        const p = a.start.clone().lerp(dest, k).addScaledVector(up, Math.sin(k * Math.PI) * lift);
        wrist = grip(p, 0);
        tile.group.position.copy(p);
        if (tile.target) tile.group.quaternion.slerp(tile.target.quat, Math.min(1, dt * 12));
        this.held.add(a.tile);
      } else if (a.t < reach + carry + settle) {
        weight = 1;
        wrist = grip(dest, 0);
      } else {
        const k = smooth((a.t - reach - carry - settle) / back);
        weight = 1 - k;
        wrist = grip(dest, k * 0.6);
      }
      if (av) {
        av.reachTarget = wrist;
        av.reachWeight = weight;
      }
      return true;
    });
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    this.tick(Math.min(this.clock.getDelta(), 0.05));
    this.renderer.render(this.scene, this.camera);
  };

  // 调试用：按固定步长快进动画再画一帧，截图测试不受渲染速度影响
  debugAdvance(seconds: number): void {
    for (let t = 0; t < seconds; t += 1 / 30) this.tick(1 / 30);
    this.renderer.render(this.scene, this.camera);
  }

  private tick(dt: number): void {
    this.now += dt;
    const hover = this.pick();
    if (hover !== this.hovered) {
      this.hovered = hover;
      this.renderer.domElement.style.cursor = hover !== null ? 'pointer' : 'default';
      if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
    }
    // 发牌期间每帧重新摆一次，让牌按时间从牌山飞到手里
    if (this.deal && this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
    this.dice.update(dt);
    this.animateHands(dt);
    const k = 1 - Math.exp(-dt * 16);
    for (const [id, t] of this.tiles.entries()) {
      if (!t.target || this.held.has(id)) continue;
      t.group.position.lerp(t.target.pos, k);
      t.group.quaternion.slerp(t.target.quat, k);
      const sc = t.group.scale.x + (t.target.scale - t.group.scale.x) * k;
      t.group.scale.setScalar(sc);
    }
    for (const c of this.characters) c.avatar?.update(dt);
  }

}

function placeholder(color: string): THREE.Group {
  const c = new THREE.Color(color);
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 2.2, 6, 16), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
  body.position.y = 2.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 16), new THREE.MeshStandardMaterial({ color: '#f3d9c6', roughness: 0.7 }));
  head.position.y = 5.3;
  body.castShadow = head.castShadow = true;
  g.add(body, head);
  return g;
}

function feltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(512, 512, 60, 512, 512, 720);
  grad.addColorStop(0, '#2c7079');
  grad.addColorStop(0.6, '#1e525a');
  grad.addColorStop(1, '#12363c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);
  // 细微的布纹噪点
  const img = ctx.getImageData(0, 0, 1024, 1024);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(240,195,90,0.25)';
  ctx.lineWidth = 3;
  ctx.strokeRect(150, 150, 724, 724);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
