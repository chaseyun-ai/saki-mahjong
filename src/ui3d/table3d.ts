import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Game, GameEvent } from '../engine/game';
import type { Meld } from '../engine/score';
import { TILE_COUNT, TileId, WIND_CN } from '../engine/tiles';
import { FACE_TOTAL, FaceAtlas, faceIndex } from './faces';
import { Avatar } from './avatar';
import { LOOKS, applyLook } from './looks';
import { Dice } from './dice';
import { Effects } from './effects';
import { WallSlot, dealIndex, drawSlot, wallSlots } from './wallLayout';
import { BASE_AVATAR_SCALE, CONSOLE_HALF, DEFAULT_LAYOUT, POND_COLS, TILE_H, TILE_T, TILE_W, TableDims, TableLayout, WALL_Z, tableDims } from './tableLayout';
import { DEFAULT_DISCARD, DiscardParams, DiscardPath, DiscardPose, MarkerName, RIICHI_DISCARD, dueMarkers, sampleDiscard, totalTime } from './discardMotion';

// 3D 牌桌。规则状态全部来自 Game，这里只负责把每张牌摆到该在的位置，并做平滑移动。
//
// 坐标：桌面是 y = 0 的平面，桌子中心在原点。自己坐在 +z 一侧朝 -z 看，
// 下家在 +x，对家在 -z，上家在 -x。每个座位用“本地坐标”摆牌：本地 +z 指向座位的人，+x 是他的右手边，
// 再绕 y 轴转 seat × 90° 得到世界坐标。

export { TILE_H, TILE_T, TILE_W };

const GAP = 0.04;
const MY_HAND_SCALE = 1.25;
const WALL_PITCH = TILE_W + 0.02;

// 全自动麻将机（参考大洋 AMOS）：桌框很低，手可以直接搭在上面；每个人右手边桌沿下有点棒抽屉。
// 手牌、牌河、桌边、座位这些尺寸可以调，见 tableLayout.ts
const FRAME_TOP = 0.2;
const DRAWER_X = 5;
const DRAWER_Y = -0.85;
const DRAWER_OPEN = 2.4;
const STICK_LEN = 3.6;

// 角色：VRoid 的 CC0 示例模型改色（见 looks.ts）。人物大小 100% 时放大 23 倍
export const AVATAR_SCALE = BASE_AVATAR_SCALE;

// 发牌：骰子落定后，每批 4 张（最后每人 1 张）依次发出，先按发到的顺序摆，
// 发完后手牌往后一倒再立起来，变成理好的顺序
const DEAL_START = 1.3;
const DEAL_BATCH = 0.14;
const DEAL_SORT = DEAL_START + 16 * DEAL_BATCH + 0.35;
const SORT_TILT = 0.28;
const DEAL_END = DEAL_SORT + SORT_TILT + 0.4;

// 倒牌：宣言后停一下，手牌依次（或一起）往前倒，倒完再放和牌特效
const REVEAL_DELAY = 0.7;
const TOPPLE_TIME = 0.24;
const TOPPLE_STAGGER = 0.07;

// 用手搬牌的动作：伸手、拿起来移过去、放下停一下、收手（秒）
interface HandTiming {
  reach: number;
  carry: number;
  settle: number;
  back: number;
  lift: number; // 移动时抬多高
}
// 出牌的节奏和手的姿势参数在 discardMotion.ts（DEFAULT_DISCARD、RIICHI_DISCARD）
// 立直棒：从抽屉里拿出来放到桌上
const STICK_TIMING: HandTiming = { reach: 0.5, carry: 0.6, settle: 0.25, back: 0.45, lift: 2.6 };
// 摸牌不用手，牌自己沿弧线从牌山飞进手里
const DRAW_FLIGHT = 0.38;

// 鸣牌、立直、和牌的特效颜色
const FX_GOLD = '#ffd36b';
const FX_RED = '#ff5a4f';
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

// 一局结束时的倒牌
interface RevealState {
  at: number; // 开始倒牌的时间
  fxAt: number; // 倒完、放和牌特效的时间
  fxDone: boolean;
  wins: { seat: number; tsumo: boolean }[];
  topple: Map<TileId, { at: number; from: Placement | null }>;
}

interface Flight {
  tile: TileId;
  t: number;
  start: THREE.Vector3;
}

// 手的动作：tile 搬一张牌，stick 从抽屉拿立直棒，gesture 只是举手示意
interface HandAnim {
  seat: number;
  kind: 'tile' | 'stick' | 'gesture';
  tile: TileId;
  t: number; // 小于 0 表示排在前一个动作后面，还没开始
  start: THREE.Vector3;
  timing: HandTiming;
  hold: number; // 放下后额外停多久（荣和时放铳的手停住）
  dest?: Placement; // 立直棒放到哪里
  startQuat?: THREE.Quaternion;
  motion?: DiscardParams; // 出牌动作的参数（kind 为 tile 时）
  fired?: number; // 已经报过几个动作标记
  riichi?: boolean; // 立直宣言牌，落桌时放立直特效
  landed?: THREE.Vector3; // 放下的位置，之后牌被拿走手也停在这里
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
  private flights: Flight[] = [];
  private effects: Effects;
  private riichiSticks: THREE.Mesh[] = [];
  // 立直棒：hidden 还在抽屉里，anim 正被手拿着，placed 已经放到桌上
  private stickState: ('hidden' | 'anim' | 'placed')[] = ['hidden', 'hidden', 'hidden', 'hidden'];
  private drawers: { group: THREE.Group; open: number }[] = [];
  private shake = 0;
  // 调试截图时手动摆镜头，不让动画覆盖
  debugCamera = false;
  // 出牌动作经过标记（出发、抓住、落桌、松手、收回）时通知外面，比如落桌时放声音。
  // 每张打出的牌每个标记都恰好报一次，动作被打断也会补报
  onMarker: ((seat: number, tile: TileId, name: MarkerName) => void) | null = null;
  // 每帧画之前调用（动画已经推进到这一帧），调试场景在这里更新辅助线和读数
  beforeRender: (() => void) | null = null;
  private overlayGroup: THREE.Group | null = null;
  private zoom = { t: -1, target: new THREE.Vector3() };
  private held = new Set<TileId>();
  private reveal: RevealState | null = null;
  // 每家手牌上一次的摆法；打牌时先按这个摆，牌落进牌河后再理牌
  private layouts: { hand: TileId[]; drawn: TileId | null }[] = [];
  private frozen = new Map<number, { hand: TileId[]; drawn: TileId | null; until: number }>();
  private consoleKey = '';
  private resizer = new ResizeObserver(() => this.resize());
  // 牌桌尺寸（可调的参数）和由它算出来的各处位置
  private tableLayout: TableLayout = { ...DEFAULT_LAYOUT };
  private dim: TableDims = tableDims(this.tableLayout);

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

    // 控制台贴图用 2048 像素，画的时候按 512 的坐标放大 4 倍
    this.consoleCanvas.width = 2048;
    this.consoleCanvas.height = 2048;
    this.consoleTex = new THREE.CanvasTexture(this.consoleCanvas);
    this.consoleTex.colorSpace = THREE.SRGBColorSpace;
    this.consoleTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.buildRoom();
    this.buildTiles();
    this.scene.add(this.dice.group);
    this.effects = new Effects(this.scene);
    this.buildRiichiSticks();
    void this.atlas.draw().then(() => {
      // 牌面画好后控制台上的宝牌也要重画
      this.consoleKey = '';
      if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
    });

    // 跟着容器大小走：窗口变了、旁边的面板变高变矮都要重新算画面比例
    this.resize();
    this.resizer.observe(container);
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
    this.resizer.disconnect();
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
      new THREE.PlaneGeometry(this.dim.tableHalf * 2, this.dim.tableHalf * 2),
      new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95 }),
    );
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    this.scene.add(felt);

    // 机身：黑色亮面，桌框只比桌布高一点，内侧一圈金属包边
    const frameMat = new THREE.MeshStandardMaterial({ color: '#1d2023', roughness: 0.32, metalness: 0.25 });
    const trimMat = new THREE.MeshStandardMaterial({ color: '#b9a477', roughness: 0.3, metalness: 0.8 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#141618', roughness: 0.5, metalness: 0.15 });
    const frameH = FRAME_TOP + 0.6;
    for (let s = 0; s < 4; s++) {
      const side = new THREE.Group();
      const rail = new THREE.Mesh(new RoundedBoxGeometry(this.dim.bodyHalf * 2, frameH, this.dim.frame, 3, 0.12), frameMat);
      rail.position.set(0, FRAME_TOP - frameH / 2, this.dim.tableHalf + this.dim.frame / 2);
      rail.castShadow = true;
      rail.receiveShadow = true;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(this.dim.tableHalf * 2, 0.05, 0.08), trimMat);
      trim.position.set(0, FRAME_TOP - 0.02, this.dim.tableHalf + 0.05);
      side.add(rail, trim);
      side.rotation.y = (s * Math.PI) / 2;
      this.scene.add(side);
    }
    const body = new THREE.Mesh(new RoundedBoxGeometry(this.dim.bodyHalf * 2 - 0.2, 2.6, this.dim.bodyHalf * 2 - 0.2, 3, 0.15), bodyMat);
    body.position.y = FRAME_TOP - frameH - 1.3 + 0.05;
    this.scene.add(body);

    // 点棒抽屉：按画面上的方位建，座位 rel 对应 drawers[rel]
    for (let rel = 0; rel < 4; rel++) {
      const holder = new THREE.Group();
      holder.rotation.y = (rel * Math.PI) / 2;
      const drawer = buildDrawer(frameMat, trimMat);
      drawer.position.set(DRAWER_X, DRAWER_Y, this.dim.bodyHalf - 0.1);
      holder.add(drawer);
      this.scene.add(holder);
      this.drawers.push({ group: drawer, open: 0 });
    }

    // 中央控制台：顶面画点数和局数
    const consoleMats = [
      new THREE.MeshStandardMaterial({ color: '#0c0d0f', roughness: 0.25, metalness: 0.3 }),
      new THREE.MeshStandardMaterial({ map: this.consoleTex, roughness: 0.2, emissive: '#ffffff', emissiveMap: this.consoleTex, emissiveIntensity: 0.35 }),
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
      const local = new THREE.Vector3(0, 0, this.dim.seatZ);
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
          av.root.scale.setScalar(this.dim.scale);
          av.root.position.y = this.dim.seatY - av.hipHeight * this.dim.scale;
          if (rel === 0) av.setFirstPerson(this.camera);
          // 桌面和桌沿换算到模型自身坐标；自己的手平时放在腿上，免得挡住手牌
          av.setRestPose(av.hipHeight - this.dim.seatY / this.dim.scale, (this.dim.tableHalf - this.dim.seatZ) / this.dim.scale, rel === 0 ? 'offscreen' : look.pose ?? 'edge');
          seatRoot.add(av.root);
          ch.avatar = av;
          av.home = this.seatPoint(s, 0, 0, this.dim.handZ);
          // 偶尔瞟一眼别家的脸或者桌子中间
          av.glances = [0, 1, 2, 3]
            .filter((o) => o !== s)
            .map((o) => this.seatPoint(o, 0, this.dim.seatY + 0.55 * this.dim.scale, this.dim.seatZ))
            .concat(new THREE.Vector3(0, 0, 0));
        })
        .catch((err) => console.warn('角色模型加载失败', url, err));
    }
  }

  private characterAt(seat: number): Character | undefined {
    return this.characters.find((c) => c.seat === seat);
  }

  // ---------- 动作调试场景用 ----------

  // 画面循环的时间倍速：1 正常，0 暂停
  timeScale = 1;

  // 现在的动画时间（秒）
  get time(): number {
    return this.now;
  }

  // 按固定步长往前推进动画（不画，画面循环会画），调试场景定位到某个时刻用。
  // 先走整步，零头最后补一步；同样的时长总是同样的步子，头发这些物理效果才每次一样
  advance(seconds: number, step = 1 / 60): void {
    const n = Math.floor(seconds / step + 1e-6);
    for (let i = 0; i < n; i++) this.tick(step);
    const rest = seconds - n * step;
    if (rest > 1e-6) this.tick(rest);
  }

  // 记下人物现在静止的样子，之后 snap 都回到这个样子
  captureIdle(): void {
    for (const c of this.characters) c.avatar?.captureIdle();
  }

  // 换人物或座位后重新请人入座
  rebuildCharacters(view: SyncView): void {
    this.buildCharacters(view);
  }

  // 这个人正在做的出牌动作：参数、路径、动作时间和这一刻的姿势；没在出牌就是 null
  discardInfo(seat: number): { params: DiscardParams; path: DiscardPath; t: number; pose: DiscardPose } | null {
    const a = this.handAnims.find((x) => x.seat === seat && x.kind === 'tile' && x.t >= 0);
    const path = a && this.discardPath(a);
    if (!a || !path) return null;
    return { params: a.motion!, path, t: a.t, pose: sampleDiscard(a.motion!, path, a.t) };
  }

  // 调试场景的辅助线放在这里（用到时才建，正式牌局里没有）
  get overlay(): THREE.Group {
    if (!this.overlayGroup) {
      this.overlayGroup = new THREE.Group();
      this.scene.add(this.overlayGroup);
    }
    return this.overlayGroup;
  }

  // 只看出牌的人：其他三个人藏起来，侧面看的时候不挡镜头
  setOthersVisible(seat: number, on: boolean): void {
    for (const c of this.characters) c.seatRoot.visible = on || c.seat === seat;
  }

  avatarAt(seat: number): Avatar | null {
    return this.characterAt(seat)?.avatar ?? null;
  }

  // 自己座位的人：第一人称时藏起头（正常打牌），第三人称时整个人都画出来（调试场景换机位时）
  setFirstPerson(on: boolean): void {
    this.avatarAt(this.lastSync?.view.me ?? 0)?.setFirstPerson(this.camera, on);
  }

  // 四个人的模型都加载好了
  charactersReady(): boolean {
    return this.characters.length === 4 && this.characters.every((c) => c.avatar);
  }

  // 立刻把所有牌放到位：停掉手上的动作、飞牌、发牌和理牌，人回到记下的静止样子
  snap(): void {
    this.handAnims = [];
    this.flights = [];
    this.frozen.clear();
    this.deal = null;
    this.held.clear();
    for (const c of this.characters) {
      if (!c.avatar) continue;
      c.avatar.reachWeight = 0;
      c.avatar.resetIdle();
    }
    // 理牌中途停下的话，按不再冻结的手牌重新摆一次
    if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
    for (const t of this.tiles) {
      if (!t.target) continue;
      t.group.position.copy(t.target.pos);
      t.group.quaternion.copy(t.target.quat);
      t.group.scale.setScalar(t.target.scale);
      t.group.visible = true;
      t.shown = true;
    }
  }

  // 本地坐标 → 世界坐标
  private seatPoint(seat: number, x: number, y: number, z: number): THREE.Vector3 {
    const me = this.lastSync?.view.me ?? 0;
    return new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seatAngle(seat, me));
  }

  // 发牌或骰子动画还要多久（毫秒），这段时间里电脑先不出牌
  busyMs(): number {
    let until = this.now;
    if (this.deal) until = Math.max(until, this.deal.start + DEAL_END);
    // 别人打出的牌落到牌河之前先别响应
    for (const a of this.handAnims) if (a.kind === 'tile') until = Math.max(until, this.now - a.t + a.timing.reach + a.timing.carry);
    if (this.reveal) until = Math.max(until, this.reveal.fxAt);
    return Math.max(0, (until - this.now) * 1000);
  }

  // 牌局事件驱动骰子、发牌，以及角色的视线、表情和动作
  onEvent(e: GameEvent, g: Game): void {
    const all = this.characters;
    if (e.type === 'roundStart') {
      this.startDeal(g);
      this.reveal = null;
    }
    if (e.type === 'draw') {
      // 发牌动画里庄家的第一张不用另外飞
      const drawn = g.players[e.seat].drawn;
      if (!this.deal && drawn !== null) this.startFlight(drawn);
      const ch = this.characterAt(e.seat);
      if (ch && drawn !== null) ch.avatar?.lookAtPoint(this.tiles[drawn].group.position.clone(), 0.8);
    } else if (e.type === 'discard') {
      const pond = this.seatPoint(e.seat, 0, 0, this.dim.pondZ + 1.5);
      // 立直宣言：牌拍下去的那一刻放特效（落桌标记），接着从抽屉里拿立直棒放到桌上
      this.playDiscard(e.seat, e.tile, e.riichi ? RIICHI_DISCARD : DEFAULT_DISCARD, !!e.riichi);
      if (e.riichi) this.startStickAnim(e.seat, -(RIICHI_DISCARD.reach + RIICHI_DISCARD.carry + RIICHI_DISCARD.settle));
      for (const ch of all) {
        // 别人出牌时看一眼，反应有先后
        if (ch.seat !== e.seat) ch.avatar?.lookAtPoint(pond, 0.9 + Math.random() * 0.8);
        if (ch.seat === e.seat && e.riichi) ch.avatar?.setMood('angry', 1.6);
      }
    } else if (e.type === 'call') {
      const who = this.seatPoint(e.seat, 0, 8, this.dim.seatZ);
      this.callFx(e.seat, e.call.includes('杠') ? 'kan' : 'call');
      for (const ch of all) {
        if (ch.seat === e.seat) ch.avatar?.setMood('happy', 1.2);
        else {
          ch.avatar?.lookAtPoint(who, 1.5);
          if (e.call.includes('杠')) ch.avatar?.setMood('surprised', 1);
        }
      }
    } else if (e.type === 'ability') {
      for (const ch of all) {
        if (ch.seat === e.seat) ch.avatar?.setMood('relaxed', 2);
        else ch.avatar?.setMood('surprised', 1.2);
      }
    } else if (e.type === 'roundEnd') {
      const r = e.result;
      this.startReveal(g);
      if (r.wins.length) {
        const who = this.seatPoint(r.wins[0].seat, 0, 8, this.dim.seatZ);
        for (const ch of all) if (!r.wins.some((w) => w.seat === ch.seat)) ch.avatar?.lookAtPoint(who, 3);
      }
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

  private buildRiichiSticks(): void {
    for (let s = 0; s < 4; s++) {
      const m = stickMesh();
      m.visible = false;
      this.scene.add(m);
      this.riichiSticks.push(m);
    }
  }

  // 立直棒放在牌河和控制台之间。怜的立直棒是竖着立在桌上的
  private stickPlacement(seat: number): Placement {
    const me = this.lastSync?.view.me ?? 0;
    if (this.lastSync?.view.ids[seat] === 'toki') {
      return this.toWorld(seat, me, 0, STICK_LEN / 2, this.dim.pondZ - 0.5, new THREE.Euler(0, 0, Math.PI / 2));
    }
    return this.toWorld(seat, me, 0, 0.09, this.dim.pondZ - 0.35, STANDING);
  }

  // 抽屉里那根立直棒的位置（抽屉拉开时）
  private drawerStick(seat: number): Placement {
    const me = this.lastSync?.view.me ?? 0;
    return this.toWorld(seat, me, DRAWER_X, DRAWER_Y - 0.2, this.dim.bodyHalf - 0.1 + DRAWER_OPEN - 1.1, STANDING);
  }

  private placeRiichiSticks(g: Game): void {
    for (let s = 0; s < 4; s++) {
      const stick = this.riichiSticks[s];
      const on = g.players[s].riichi && g.phase !== 'roundEnd';
      if (!on) {
        this.stickState[s] = 'hidden';
        stick.visible = false;
      } else if (this.stickState[s] === 'hidden') {
        // 没看到动画（比如中途换了视角）就直接放好
        this.finishStick(s);
      }
    }
  }

  private startStickAnim(seat: number, delay: number): void {
    const from = this.drawerStick(seat);
    this.stickState[seat] = 'anim';
    this.riichiSticks[seat].visible = false;
    this.handAnims.push({
      seat,
      kind: 'stick',
      tile: -1,
      t: delay,
      start: from.pos,
      startQuat: from.quat,
      dest: this.stickPlacement(seat),
      timing: STICK_TIMING,
      hold: 0,
    });
  }

  private finishStick(seat: number): void {
    const stick = this.riichiSticks[seat];
    const p = this.stickPlacement(seat);
    stick.position.copy(p.pos);
    stick.quaternion.copy(p.quat);
    stick.visible = true;
    this.stickState[seat] = 'placed';
  }

  // 鸣牌、立直的特效：在这家前面的桌上放冲击波，角色举手示意
  private callFx(seat: number, kind: 'call' | 'kan' | 'riichi'): void {
    const color = kind === 'riichi' ? FX_RED : kind === 'kan' ? '#9fd8ff' : FX_GOLD;
    const at = this.seatPoint(seat, 0, 0.1, kind === 'riichi' ? this.dim.pondZ : this.dim.handZ - 2);
    this.effects.ring(at, color, kind === 'kan' ? 9 : 6);
    this.effects.flash(at.clone().setY(1.5), color, kind === 'riichi' ? 10 : 7);
    if (kind !== 'call') this.effects.ring(at, color, 12, 1.1);
    if (kind === 'kan') this.effects.beam(at, color, 10, 1);
    this.shake = Math.max(this.shake, kind === 'call' ? 0.25 : 0.45);
    // 举起右手亮一下（立直时手要去拿立直棒，不举手）
    const av = this.characterAt(seat)?.avatar;
    if (av && kind !== 'riichi' && seat !== this.lastSync?.view.me) {
      this.cancelHandAnims(seat);
      this.handAnims.push({
        seat,
        kind: 'gesture',
        tile: -1,
        t: 0,
        start: this.seatPoint(seat, 1.5, 6, this.dim.handZ + 1),
        timing: { reach: 0.22, carry: 0, settle: 0.45, back: 0.35, lift: 0 },
        hold: 0,
      });
    }
  }

  // 和牌：金色光柱、闪光粒子，镜头往和牌的人那边推一点
  private winFx(seat: number, tsumo: boolean): void {
    const at = this.seatPoint(seat, 0, 0.1, this.dim.handZ - 2.5);
    this.effects.beam(at, FX_GOLD, 14, 2.2);
    this.effects.ring(at, FX_GOLD, 14, 1.2);
    this.effects.ring(at, '#ffffff', 8, 0.8);
    this.effects.sparkles(at, FX_GOLD, 70, 5, 2.2);
    this.effects.flash(at.clone().setY(3), '#fff2c4', 18, 0.6);
    this.shake = 0.6;
    if (seat !== this.lastSync?.view.me) this.zoom = { t: 0, target: this.seatPoint(seat, 0, 4, this.dim.seatZ - 2) };
    // 自摸的人举手，荣和的人身体前倾
    if (tsumo) this.callFx(seat, 'call');
  }

  private startFlight(tile: TileId): void {
    const obj = this.tiles[tile];
    if (!obj.shown) return;
    this.flights = this.flights.filter((f) => f.tile !== tile);
    this.flights.push({ tile, t: 0, start: obj.group.position.clone() });
  }

  // 出牌：手牌在牌落进牌河之前保持原样，出牌的人看着牌河，手把牌搬过去。
  // 牌局和动作调试场景都走这里；调用之后再 sync，牌的落点就是 sync 算出的牌河位置
  playDiscard(seat: number, tile: TileId, motion: DiscardParams, riichi = false): void {
    const prev = this.layouts[seat];
    if (prev) this.frozen.set(seat, { ...prev, until: this.now + motion.reach + motion.carry + 0.15 });
    this.startHandAnim(seat, tile, motion, riichi);
    this.characterAt(seat)?.avatar?.lookAtPoint(this.seatPoint(seat, 0, 0, this.dim.pondZ + 1.5), 1);
  }

  private startHandAnim(seat: number, tile: TileId, motion: DiscardParams, riichi = false): void {
    const obj = this.tiles[tile];
    // 同一个人上一个动作还没做完就直接结束它
    this.cancelHandAnims(seat);
    const a: HandAnim = {
      seat,
      kind: 'tile',
      tile,
      t: 0,
      start: obj.group.position.clone(),
      startQuat: obj.group.quaternion.clone(),
      timing: motion,
      motion,
      hold: 0,
      riichi,
    };
    // 牌还没摆出来就不演了，但落桌声音照样要响
    if (obj.shown) this.handAnims.push(a);
    else this.emitMarkers(a, Infinity);
  }

  // 报出出牌动作到时刻 t 为止经过的标记
  private emitMarkers(a: HandAnim, t: number): void {
    if (a.kind !== 'tile') return;
    const due = dueMarkers(a.motion!, a.hold, a.fired ?? 0, t);
    a.fired = (a.fired ?? 0) + due.length;
    for (const m of due) {
      if (m.name === 'land' && a.riichi) this.callFx(a.seat, 'riichi');
      this.onMarker?.(a.seat, a.tile, m.name);
    }
  }

  // 结束这个人手上的动作；还没放下的立直棒直接放好，没报完的标记补报
  private cancelHandAnims(seat: number): void {
    for (const a of this.handAnims) {
      if (a.seat !== seat) continue;
      if (a.kind === 'stick') this.finishStick(seat);
      this.emitMarkers(a, Infinity);
    }
    this.handAnims = this.handAnims.filter((a) => a.seat !== seat);
    for (const d of this.drawers) d.open = 0;
  }

  // 一局结束：和牌（或流局听牌）的人停一下再倒牌，倒完放特效；荣和时放铳的人手停在牌上
  private startReveal(g: Game): void {
    const r = g.roundResult;
    if (!r) return;
    const at = this.now + (r.wins.length ? REVEAL_DELAY : 0.3);
    let fxAt = at;
    const shown = this.revealSeats(g);
    for (const [s, win] of shown) {
      const n = g.players[s].hand.length + (win !== null && !g.players[s].hand.includes(win) ? 1 : 0);
      const wave = (LOOKS[this.lastSync?.view.ids[s] ?? '']?.reveal ?? 'wave') === 'wave';
      fxAt = Math.max(fxAt, at + (wave ? (n - 1) * TOPPLE_STAGGER : 0) + TOPPLE_TIME + 0.1);
    }
    // 被荣和的立直不成立，还没拿出来的立直棒不拿了
    this.handAnims = this.handAnims.filter((a) => a.kind !== 'stick');
    for (const d of this.drawers) d.open = 0;
    this.reveal = { at, fxAt, fxDone: false, wins: r.wins.map((w) => ({ seat: w.seat, tsumo: w.from === null })), topple: new Map() };
    for (const w of r.wins) {
      if (w.from === null) continue;
      const a = this.handAnims.find((x) => x.seat === w.from && x.kind === 'tile');
      if (a) a.hold = fxAt - this.now + 0.4;
    }
  }

  // 要倒牌的人，以及他们和的那张（流局听牌时是 null）
  private revealSeats(g: Game): Map<number, TileId | null> {
    const r = g.phase === 'roundEnd' ? g.roundResult : null;
    const shown = new Map<number, TileId | null>();
    if (!r) return shown;
    for (const w of r.wins) shown.set(w.seat, w.tile);
    if (r.kind === 'exhaustive') r.tenpai.forEach((t, s) => t && shown.set(s, null));
    return shown;
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
    for (const a of this.handAnims) this.emitMarkers(a, Infinity);
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
    this.placeReveal(g, view.me, targets);
    for (const [t, slot] of wallSlots(g)) targets.set(t, this.wallPlacement(slot, view.me));
    this.applyDeal(g, view.me, targets);
    this.placeRiichiSticks(g);

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
    // 松实姐妹的习惯：牌河和副露倒过来摆，让对手看到的是正的
    const flip = LOOKS[this.lastSync?.view.ids[s] ?? '']?.upsideDown ? Math.PI : 0;

    // 副露：从右边往左摆
    let mx = this.dim.tableHalf - 1.2;
    const meldWidth = (m: Meld) => m.tiles.length * (TILE_W + GAP) + (m.calledTile !== undefined ? TILE_H - TILE_W : 0);
    for (const m of p.melds) {
      const tiles = this.meldOrder(m);
      mx -= meldWidth(m);
      let x = mx;
      for (const [i, t] of tiles.entries()) {
        const sideways = t === m.calledTile;
        const hidden = m.type === 'ankan' && (i === 0 || i === 3);
        const w = sideways ? TILE_H : TILE_W;
        const z = sideways ? this.dim.meldZ + (TILE_H - TILE_W) / 2 : this.dim.meldZ;
        out.set(t, this.toWorld(s, me, x + w / 2, lyingY, z, hidden ? FACE_DOWN : FACE_UP, (sideways ? Math.PI / 2 : 0) + flip));
        x += w + GAP;
      }
      if (m.type === 'kakan') {
        // 加杠的那张叠放在横着的牌上方（靠桌子中心一侧）
        const added = m.tiles[3];
        const ci = tiles.indexOf(m.calledTile!);
        let cx = mx;
        for (let i = 0; i < ci; i++) cx += TILE_W + GAP;
        out.set(added, this.toWorld(s, me, cx + TILE_H / 2, lyingY, this.dim.meldZ + (TILE_H - TILE_W) / 2 - TILE_W - GAP, FACE_UP, Math.PI / 2 + flip));
      }
      mx -= 0.3;
    }

    // 手牌：自己的稍微后仰朝向镜头，别人的立着背对我们
    let drawn = p.drawn;
    let hand: (TileId | null)[] = p.hand.filter((t) => t !== drawn).sort((a, b) => a - b);
    // 刚打出去的牌还没落进牌河：其他牌原地不动，空位先留着
    const fz = this.frozen.get(s);
    if (fz && this.now < fz.until) {
      const has = new Set(p.hand);
      const listed = new Set([...fz.hand, fz.drawn]);
      hand = fz.hand.map((t) => (has.has(t) ? t : null)).concat(p.hand.filter((t) => !listed.has(t)));
      drawn = fz.drawn;
    } else {
      this.frozen.delete(s);
    }
    // 发牌时先按发到的顺序摆，理牌那一下所有牌往后倒，再按顺序立起来
    const deal = this.deal;
    const dealing = !!deal && this.now < deal.start + DEAL_SORT;
    const tilting = !!deal && !dealing && this.now < deal.start + DEAL_SORT + SORT_TILT;
    if (dealing || tilting) hand.sort((a, b) => (deal!.order.get(a!)?.d ?? 99) - (deal!.order.get(b!)?.d ?? 99));
    if (!this.frozen.has(s)) this.layouts[s] = { hand: hand as TileId[], drawn };
    const count = hand.length + (drawn !== null ? 1 : 0);
    // 自己的手牌放大一些，看得清也好点
    const hs = mine ? MY_HAND_SCALE : 1;
    const step = (TILE_W + GAP) * hs;
    const width = count * step + (drawn !== null ? 0.5 : 0);
    // 副露多了手牌往左让
    const shift = p.melds.length ? Math.max(0, width / 2 - (mx - 0.6)) : 0;
    let x = -width / 2 - shift + TILE_W / 2;
    const rot = tilting ? new THREE.Euler(Math.PI / 2, 0, 0) : mine ? new THREE.Euler(-0.32, 0, 0) : STANDING;
    const y = tilting ? (TILE_T / 2) * hs : (TILE_H / 2) * hs;
    const hz = this.dim.handZ + (hs - 1) * 1.2 + (tilting ? (TILE_H / 2) * hs : 0);
    const place = (t: TileId | null) => {
      const lift = mine && t !== null && t === this.hovered && this.clickable.has(t) ? 0.4 : 0;
      if (t !== null && p.hand.includes(t)) out.set(t, this.toWorld(s, me, x, y + lift, hz, rot, 0, hs));
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
    const pstep = TILE_W + GAP;
    let px = -((POND_COLS * pstep) / 2);
    for (const d of p.discards) {
      if (d.called) continue;
      if (col === POND_COLS && row < 2) {
        col = 0;
        row++;
        px = -((POND_COLS * pstep) / 2);
      }
      const w = d.riichi ? TILE_H : TILE_W;
      const z = this.dim.pondZ + row * (TILE_H + GAP) + TILE_H / 2;
      out.set(d.tile, this.toWorld(s, me, px + w / 2, lyingY, z, FACE_UP, (d.riichi ? Math.PI / 2 : 0) + flip));
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

  // 一局结束：和牌的人、流局时听牌的人把手牌摊开（倒牌），和的那张放在最右边
  private placeReveal(g: Game, me: number, out: Map<TileId, Placement>): void {
    const rv = this.reveal;
    if (!rv || this.now < rv.at) return;
    for (const [s, win] of this.revealSeats(g)) {
      const wave = (LOOKS[this.lastSync?.view.ids[s] ?? '']?.reveal ?? 'wave') === 'wave';
      const tiles = g.players[s].hand.filter((t) => t !== win).sort((a, b) => a - b);
      const step = TILE_W + GAP;
      const width = (tiles.length + (win !== null ? 1 : 0)) * step + (win !== null ? 0.5 : 0);
      let x = -width / 2 - (g.players[s].melds.length ? 3 : 0) + TILE_W / 2;
      const z = this.dim.handZ + 0.3;
      const topple = (t: TileId, i: number) => {
        if (!rv.topple.has(t)) rv.topple.set(t, { at: rv.at + (wave ? i * TOPPLE_STAGGER : 0), from: null });
      };
      tiles.forEach((t, i) => {
        out.set(t, this.toWorld(s, me, x, TILE_T / 2, z, FACE_UP));
        topple(t, i);
        x += step;
      });
      if (win === null) continue;
      const tsumo = g.players[s].hand.includes(win);
      // 自摸的那张跟着一起倒；荣和的那张等倒完再从牌河移过来
      if (tsumo || this.now >= rv.fxAt) out.set(win, this.toWorld(s, me, x + 0.5, TILE_T / 2, z, FACE_UP));
      if (tsumo) topple(win, tiles.length);
    }
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

  // 大洋麻将机风格：黑色玻璃面板，每家面前一排红色数码管显示点数，中间是局况和宝牌
  private drawConsole(g: Game, view: SyncView): void {
    // 发牌时每帧都会 sync，内容没变就不重画
    const key = JSON.stringify([
      g.roundLabel(),
      g.wall.remaining,
      g.riichiSticks,
      g.wall.doraRevealed,
      g.wall.doraIndicators,
      g.players.map((p) => [p.score, p.riichi]),
      g.phase === 'turn' ? g.turn : -1,
      view.me,
      view.colors,
    ]);
    if (key === this.consoleKey) return;
    this.consoleKey = key;
    const c = this.consoleCanvas.getContext('2d')!;
    const S = 512;
    c.setTransform(4, 0, 0, 4, 0, 0);
    c.imageSmoothingQuality = 'high';
    const bg = c.createLinearGradient(0, 0, S, S);
    bg.addColorStop(0, '#15181b');
    bg.addColorStop(0.5, '#07090a');
    bg.addColorStop(1, '#111417');
    c.fillStyle = bg;
    c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(200,180,130,0.35)';
    c.lineWidth = 3;
    c.strokeRect(8, 8, S - 16, S - 16);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // 中间的液晶小屏
    c.fillStyle = '#0d1a14';
    c.beginPath();
    c.roundRect(S / 2 - 132, S / 2 - 112, 264, 196, 14);
    c.fill();
    c.strokeStyle = 'rgba(120,255,190,0.18)';
    c.lineWidth = 2;
    c.stroke();
    c.shadowColor = 'rgba(255,190,80,0.8)';
    c.shadowBlur = 10;
    c.fillStyle = '#ffc861';
    c.font = "700 38px 'PingFang SC','Microsoft YaHei',sans-serif";
    c.fillText(g.roundLabel(), S / 2, S / 2 - 76);
    c.shadowColor = 'rgba(120,255,190,0.7)';
    c.fillStyle = '#9ff5c8';
    c.font = "500 24px 'PingFang SC','Microsoft YaHei',sans-serif";
    c.fillText(`余 ${g.wall.remaining}　立直棒 ×${g.riichiSticks}`, S / 2, S / 2 - 34);
    c.shadowBlur = 0;
    // 宝牌指示牌：翻开的画牌面，没翻的画牌背
    const w = 40;
    const h = 54;
    g.wall.doraIndicators.forEach((t, i) => {
      const x = S / 2 + (i - 2.5) * (w + 6) + 3;
      const y = S / 2 - 8;
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
      // 风位：亮着的是正在出牌的人
      c.fillStyle = active ? '#ffc861' : '#1c2125';
      c.beginPath();
      c.roundRect(-196, 148, 56, 56, 8);
      c.fill();
      c.fillStyle = active ? '#1a1206' : view.colors[s];
      c.font = "700 36px 'PingFang SC','Microsoft YaHei',sans-serif";
      c.fillText(WIND_CN[g.seatWind(s) - 27], -168, 177);
      // 点数：数码管
      c.fillStyle = '#120708';
      c.beginPath();
      c.roundRect(-126, 146, 300, 60, 8);
      c.fill();
      sevenSeg(c, String(p.score).padStart(6, ' '), 24, 176, 42, p.score < 0 ? '#5fd0ff' : '#ff4a2e');
      if (p.riichi) {
        c.fillStyle = '#f7f3ea';
        c.fillRect(-70, 122, 140, 12);
        c.fillStyle = '#c0392b';
        c.beginPath();
        c.arc(0, 128, 5, 0, Math.PI * 2);
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
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 竖屏时把视野拉宽，保证整张桌子都在画面里
    this.camera.fov = w / h < 1.2 ? 38 * Math.min(1.9, 1.2 / (w / h)) : 38;
    if (!this.debugCamera) {
      this.camera.position.set(0, 18, this.dim.tableHalf + 14.5);
      this.camera.lookAt(0, 0.5, -1.5);
    }
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

  // 摸牌：沿弧线从牌山飞到手里
  private animateFlights(dt: number): void {
    this.flights = this.flights.filter((f) => {
      f.t += dt;
      const tile = this.tiles[f.tile];
      const dest = tile.target;
      if (!dest || f.t >= DRAW_FLIGHT) return false;
      const k = f.t / DRAW_FLIGHT;
      const e = k * k * (3 - 2 * k);
      tile.group.position.lerpVectors(f.start, dest.pos, e).setY(THREE.MathUtils.lerp(f.start.y, dest.pos.y, e) + Math.sin(k * Math.PI) * 2.2);
      tile.group.quaternion.slerp(dest.quat, Math.min(1, dt * 10));
      tile.group.scale.setScalar(THREE.MathUtils.lerp(tile.group.scale.x, dest.scale, Math.min(1, dt * 10)));
      this.held.add(f.tile);
      return true;
    });
  }

  // 镜头：特效时轻微震动；有人和牌时往那边推近一点再回来
  private updateCamera(dt: number): void {
    if (this.debugCamera) return;
    const base = new THREE.Vector3(0, 18, 28.5);
    const look = new THREE.Vector3(0, 0.5, -1.5);
    if (this.zoom.t >= 0) {
      this.zoom.t += dt;
      const k = this.zoom.t < 0.5 ? this.zoom.t / 0.5 : this.zoom.t < 2.2 ? 1 : Math.max(0, 1 - (this.zoom.t - 2.2) / 0.8);
      const e = k * k * (3 - 2 * k);
      base.lerp(new THREE.Vector3(0, 15, 24), e * 0.6);
      look.lerp(this.zoom.target, e * 0.35);
      if (this.zoom.t > 3) this.zoom.t = -1;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.5);
      const a = this.shake * this.shake * 0.5;
      base.x += (Math.random() - 0.5) * a;
      base.y += (Math.random() - 0.5) * a;
    }
    this.camera.position.copy(base);
    this.camera.lookAt(look);
  }

  // 用手搬牌：伸手到那张牌，拿起来沿弧线移到目标，放下停一下，再收回手
  private animateHands(dt: number): void {
    this.held.clear();
    const up = new THREE.Vector3(0, 1, 0);
    const me = this.lastSync?.view.me ?? 0;
    const smooth = (x: number) => x * x * (3 - 2 * x);
    const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);
    for (const c of this.characters) if (c.avatar) c.avatar.tuning = DEFAULT_DISCARD;
    this.handAnims = this.handAnims.filter((a) => {
      a.t += dt;
      if (a.t < 0) return true;
      const av = this.characterAt(a.seat)?.avatar;
      if (a.kind === 'tile') return this.animateDiscard(a, av ?? null);
      const { reach, carry, back, lift } = a.timing;
      const settle = a.timing.settle + a.hold;
      // 下面是立直棒和举手示意；出牌在 animateDiscard
      const obj = a.kind === 'stick' ? this.riichiSticks[a.seat] : null;
      const destP = a.dest ?? null;
      if ((a.kind !== 'gesture' && !destP) || a.t > reach + carry + settle + back) {
        if (av) av.reachWeight = 0;
        if (a.kind === 'stick') {
          this.finishStick(a.seat);
          this.drawers[(a.seat - me + 4) % 4].open = 0;
        }
        return false;
      }
      const dest = a.landed ?? destP?.pos ?? a.start;
      // 手腕在东西的后上方，手指正好捏住
      const toward = new THREE.Vector3(0, 0, 1).applyAxisAngle(up, this.seatAngle(a.seat, me));
      const grip = (p: THREE.Vector3, raise: number) =>
        p.clone().addScaledVector(toward, this.dim.scale * 0.08).addScaledVector(up, this.dim.scale * 0.06 + raise);
      let wrist: THREE.Vector3;
      let weight: number;
      if (a.kind === 'gesture') {
        weight = a.t < reach ? easeOut(a.t / reach) : a.t < reach + settle ? 1 : 1 - smooth((a.t - reach - settle) / back);
        wrist = a.start.clone().addScaledVector(up, Math.sin(a.t * 14) * 0.15);
      } else if (a.t < reach) {
        // 伸手：先快后慢，最后一点点放慢对准
        const k = easeOut(a.t / reach);
        weight = k;
        wrist = grip(a.start, (1 - k) * 0.8);
      } else if (a.t < reach + carry) {
        const k = smooth((a.t - reach) / carry);
        weight = 1;
        const p = a.start.clone().lerp(dest, k).addScaledVector(up, Math.sin(k * Math.PI) * lift);
        wrist = grip(p, 0);
        if (a.kind === 'stick' && !obj!.visible) {
          obj!.visible = true;
          obj!.quaternion.copy(a.startQuat!);
        }
        obj!.position.copy(p);
        obj!.quaternion.slerp(destP!.quat, Math.min(1, dt * 12));
      } else if (a.t < reach + carry + settle) {
        weight = 1;
        a.landed ??= dest.clone();
        wrist = grip(a.landed, 0);
        if (a.kind === 'stick') {
          obj!.position.copy(a.landed);
          obj!.quaternion.copy(destP!.quat);
        }
      } else {
        const k = smooth((a.t - reach - carry - settle) / back);
        weight = 1 - k;
        wrist = grip(dest, k * 0.6);
      }
      // 抽屉：伸手时拉开，拿到立直棒后推回去
      if (a.kind === 'stick') {
        const open = a.t < reach ? easeOut(a.t / reach) : 1 - smooth(Math.min(1, (a.t - reach) / (carry * 0.8)));
        this.drawers[(a.seat - me + 4) % 4].open = open;
      }
      if (av) {
        av.reachTarget = wrist;
        av.reachWeight = weight;
      }
      return true;
    });
    for (const d of this.drawers) d.group.position.z = this.dim.bodyHalf - 0.1 + d.open * DRAWER_OPEN;
  }

  // 出牌的起点终点：牌从手里的位置到牌桌给它算好的落点
  private discardPath(a: HandAnim): DiscardPath | null {
    const target = this.tiles[a.tile].target;
    if (!target) return null;
    const me = this.lastSync?.view.me ?? 0;
    return {
      from: a.start,
      fromQuat: a.startQuat!,
      to: target.pos,
      toQuat: target.quat,
      landed: a.landed,
      toward: new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seatAngle(a.seat, me)),
      scale: this.dim.scale,
      hold: a.hold,
    };
  }

  // 出牌：手和牌的姿势全部由 discardMotion 按时间算出来
  private animateDiscard(a: HandAnim, av: Avatar | null): boolean {
    const p = a.motion!;
    const tile = this.tiles[a.tile];
    const path = this.discardPath(a);
    if (!path || a.t > totalTime(p, a.hold)) {
      this.emitMarkers(a, Infinity);
      if (av) av.reachWeight = 0;
      return false;
    }
    this.emitMarkers(a, a.t);
    const pose = sampleDiscard(p, path, a.t);
    // 放下那一刻记住位置，之后牌被拿走（比如荣和）手也停在原处
    if (pose.phase === 'settle') a.landed ??= path.to.clone();
    if (pose.holding) {
      tile.group.position.copy(pose.tilePos);
      tile.group.quaternion.copy(pose.tileQuat);
      this.held.add(a.tile);
    }
    if (av) {
      av.reachTarget = pose.wrist;
      av.reachWeight = pose.weight;
      av.tuning = p;
    }
    return true;
  }

  // 倒牌：每张牌绕着靠桌子中心那条底边往前倒，倒下去越来越快
  private animateReveal(): void {
    const rv = this.reveal;
    if (!rv) return;
    if (!rv.fxDone && this.now >= rv.fxAt) {
      rv.fxDone = true;
      if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
      for (const w of rv.wins) this.winFx(w.seat, w.tsumo);
    }
    const pivot = (p: Placement) => new THREE.Vector3(0, -TILE_H / 2, -TILE_T / 2).multiplyScalar(p.scale).applyQuaternion(p.quat);
    for (const [id, e] of rv.topple) {
      const tile = this.tiles[id];
      const to = tile.target;
      if (!to || this.now >= e.at + TOPPLE_TIME) {
        rv.topple.delete(id);
        continue;
      }
      this.held.add(id);
      if (this.now < e.at) continue;
      const g = tile.group;
      e.from ??= { pos: g.position.clone(), quat: g.quaternion.clone(), scale: g.scale.x };
      const k = (this.now - e.at) / TOPPLE_TIME;
      const f = k * k;
      const from = e.from;
      const scale = THREE.MathUtils.lerp(from.scale, to.scale, f);
      const quat = from.quat.clone().slerp(to.quat, f);
      const p = from.pos.clone().add(pivot(from)).lerp(to.pos.clone().add(pivot(to)), f);
      const off = new THREE.Vector3(0, -TILE_H / 2, -TILE_T / 2).multiplyScalar(scale).applyQuaternion(quat);
      g.position.copy(p.sub(off));
      g.quaternion.copy(quat);
      g.scale.setScalar(scale);
    }
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    this.tick(Math.min(this.clock.getDelta(), 0.05) * this.timeScale);
    this.beforeRender?.();
    this.renderer.render(this.scene, this.camera);
  };

  // 调试用：按固定步长快进动画再画一帧，截图测试不受渲染速度影响
  debugAdvance(seconds: number): void {
    for (let t = 0; t < seconds; t += 1 / 30) this.tick(1 / 30);
    this.beforeRender?.();
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
    // 发牌期间每帧重新摆一次，让牌按时间从牌山飞到手里；打出的牌落下后理牌
    const thawed = [...this.frozen.values()].some((f) => this.now >= f.until);
    if ((this.deal || thawed) && this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
    this.dice.update(dt);
    this.animateHands(dt);
    this.animateFlights(dt);
    // 到了倒牌的时间重新摆一次
    if (this.reveal && this.lastSync && this.reveal.topple.size === 0 && this.now >= this.reveal.at && !this.reveal.fxDone) {
      this.sync(this.lastSync.g, this.lastSync.view);
    }
    this.animateReveal();
    this.effects.update(dt);
    this.updateCamera(dt);
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

// 七段数码管：text 以 (cx, cy) 为中心，h 是字高；没亮的段也淡淡地画出来
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
};

function sevenSeg(c: CanvasRenderingContext2D, text: string, cx: number, cy: number, h: number, color: string): void {
  const w = h * 0.5;
  const th = h * 0.11;
  const pitch = w + h * 0.2;
  const x0 = cx - (text.length * pitch) / 2 + h * 0.1;
  const half = h / 2;
  const seg: Record<string, [number, number, number, number]> = {
    a: [th / 2, 0, w - th, th],
    g: [th / 2, half - th / 2, w - th, th],
    d: [th / 2, h - th, w - th, th],
    f: [0, th / 2, th, half - th],
    b: [w - th, th / 2, th, half - th],
    e: [0, half + th / 2, th, half - th],
    c: [w - th, half + th / 2, th, half - th],
  };
  [...text].forEach((ch, i) => {
    const on = SEGMENTS[ch] ?? '';
    const x = x0 + i * pitch;
    const y = cy - half;
    for (const [k, [sx, sy, sw, sh]] of Object.entries(seg)) {
      const lit = on.includes(k);
      c.fillStyle = lit ? color : 'rgba(255,80,60,0.07)';
      c.shadowColor = lit ? color : 'transparent';
      c.shadowBlur = lit ? 8 : 0;
      c.beginPath();
      c.roundRect(x + sx, y + sy, sw, sh, th / 2);
      c.fill();
    }
  });
  c.shadowBlur = 0;
}

let stickMat: THREE.MeshStandardMaterial | null = null;

// 千点立直棒：白色，中间一个红点
function stickMesh(): THREE.Mesh {
  if (!stickMat) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f7f3ea';
    ctx.fillRect(0, 0, 256, 32);
    ctx.fillStyle = '#c4212c';
    ctx.beginPath();
    ctx.arc(128, 16, 10, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    stickMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
  }
  const m = new THREE.Mesh(new RoundedBoxGeometry(STICK_LEN, 0.16, 0.36, 2, 0.07), stickMat);
  m.castShadow = true;
  return m;
}

// 点棒抽屉：前面板带把手，后面是装着点棒的托盘，拉出来才看得到
function buildDrawer(frameMat: THREE.Material, trimMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const front = new THREE.Mesh(new RoundedBoxGeometry(4.6, 0.9, 0.22, 2, 0.06), frameMat);
  front.position.z = 0.11;
  const handle = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.14, 0.16, 2, 0.05), trimMat);
  handle.position.set(0, 0.08, 0.28);
  g.add(front, handle);
  const trayMat = new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.7 });
  const depth = 2.6;
  const parts: [number, number, number, number, number, number][] = [
    [4.2, 0.08, depth, 0, -0.32, -depth / 2],
    [0.08, 0.45, depth, -2.06, -0.1, -depth / 2],
    [0.08, 0.45, depth, 2.06, -0.1, -depth / 2],
    [4.2, 0.45, 0.08, 0, -0.1, -depth],
  ];
  for (const [w, h, d, x, y, z] of parts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trayMat);
    m.position.set(x, y, z);
    g.add(m);
  }
  // 托盘里还剩的几根点棒
  for (let i = 0; i < 4; i++) {
    const st = stickMesh();
    st.castShadow = false;
    st.position.set(0, -0.2, -1.1 - i * 0.42);
    g.add(st);
  }
  return g;
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
