import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Game, GameEvent } from '../engine/game';
import { TILE_COUNT, TileId, WIND_CN, kindOf } from '../engine/tiles';
import { meldLayout } from '../ui/meldLayout';
import { FACE_TOTAL, FaceAtlas, faceIndex } from './faces';
import { Avatar, modelProgress } from './avatar';
import { LOOKS, RestPose, applyLook } from './looks';
import { Dice } from './dice';
import { Effects } from './effects';
import { WallSlot, dealIndex, drawSlot, wallSlots } from './wallLayout';
import { BASE_AVATAR_SCALE, CONSOLE_HALF, DEFAULT_LAYOUT, POND_COLS, TILE_H, TILE_T, TILE_W, TableDims, TableLayout, WALL_Z, clampLayout, tableDims } from './tableLayout';
import { TableMaterials, buildTableModel } from './tableModel';
import { DEFAULT_DISCARD, DiscardParams, DiscardPath, DiscardPose, MarkerName, RIICHI_DISCARD, SLIDE_DISCARD, SLIDE_RIICHI, dueMarkers, sampleDiscard, totalTime } from './discardMotion';
import { TableColors, tableColors } from '../ui/theme';

// 3D 牌桌。规则状态全部来自 Game，这里只负责把每张牌摆到该在的位置，并做平滑移动。
//
// 坐标：桌面是 y = 0 的平面，桌子中心在原点。自己坐在 +z 一侧朝 -z 看，
// 下家在 +x，对家在 -z，上家在 -x。每个座位用“本地坐标”摆牌：本地 +z 指向座位的人，+x 是他的右手边，
// 再绕 y 轴转 seat × 90° 得到世界坐标。

export { TILE_H, TILE_T, TILE_W };

const GAP = 0.04;
const MY_HAND_SCALE = 1.25;

// 牌桌的两种样子：3d 有坐着的人物；25d 不请人物，镜头从高处往下看，牌桌占满画面（像雀魂）
export type TableStyle = '3d' | '25d';
// 2.5D 的镜头：俯角 pitch（弧度，0 是平视）、视野 fov（度），看向桌子中心偏自己这边 lookZ。
// 离多远按画面比例算，见 fitCamera。竖屏时画面窄而高，镜头再往上抬到 portraitPitch，桌子在竖直方向能铺开一点。
// hand：自己的手牌放大多少；tilt：手牌往后仰多少度，0 是直立；
// fan：两头的牌往中间转多少（弧度），中间的牌不转，越往两头转得越多
export interface View25 {
  pitch: number;
  portraitPitch: number;
  fov: number;
  lookZ: number;
  hand: number;
  tilt: number;
  fan: number;
}
export const DEFAULT_VIEW_25D: View25 = { pitch: 0.72, portraitPitch: 1.2, fov: 34, lookZ: 1.5, hand: 1.15, tilt: 15, fan: 0 };
const WALL_PITCH = TILE_W + 0.02;
// 2.5D 时别家的第一组副露至少能摆到这里（座位本地 x，牌山末端附近），镜头取景按这个算
const MELD_MIN_25D = 8 * (TILE_W + GAP) + 0.5;
// 2.5D 时上家、下家的手牌比别的座位多往外推多少（牌宽）
const SIDE_HAND_PUSH_25D = 0.7;
// 2.5D 时对家的手牌在牌山后面，镜头斜着看过去会被牌山挡住：对家那一边的牌山往中间收一点、手牌往后挪一点，
// 整排手牌就露出来了。牌山收进去以后右上角的缝变窄，右边（下家）的牌山整排往下挪一点，上下两个转角的缝一样宽
const TOP_WALL_IN_25D = 0.8;
const TOP_HAND_PUSH_25D = 0.8;
const RIGHT_WALL_DOWN_25D = 0.2;

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
// 发完后手牌往后一倒再立起来，变成理好的顺序。开局到第一张牌落桌约 3.5 秒（雀魂约 2.3 秒）
const DEAL_START = 0.8;
const DEAL_BATCH = 0.07;
const DEAL_SORT = DEAL_START + 16 * DEAL_BATCH + 0.2;
const SORT_TILT = 0.24;
const DEAL_END = DEAL_SORT + SORT_TILT + 0.15;

// 倒牌：宣言后停一下，手牌依次（或一起）往前倒，倒完再放和牌特效
const REVEAL_DELAY = 0.7;
const TOPPLE_TIME = 0.24;
const TOPPLE_STAGGER = 0.07;
// 2.5D 照雀魂的节奏：“荣和/自摸”的切入放完，1.2 秒闪电打在和的那张牌上，1.4 秒倒牌，倒得也快一些
const REVEAL_DELAY_25D = 1.4;
const BOLT_LEAD = 0.2;
const TOPPLE_STAGGER_25D = 0.03;

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
// 2.5D 没有人物：宣言牌落桌后停一下，立直棒从上方直接掉到桌上
const STICK_DROP: HandTiming = { reach: 0, carry: 0.25, settle: 0, back: 0, lift: 0 };
const STICK_DROP_DELAY = 0.25;
const STICK_DROP_HEIGHT = 3;
// 摸牌不用手，牌自己沿弧线从牌山飞进手里
const DRAW_FLIGHT = 0.25;
// 摸牌路径关掉时：前一半在牌山上淡出，后一半在手里淡入
const DRAW_FADE = 0.36;
// 上一张打出的牌落桌后，隔这么久下一家才摸牌（雀魂约 0.15 秒）
const DRAW_GAP = 0.1;
// 立直后摸切：摸到的牌停在空中的样子，像右手把牌拿起来看一眼。
// dx 往右挪、lift 抬多高、inward 往桌子中间挪（负数往镜头这边），都按手牌大小放大；
// tilt 比手牌多仰多少、yaw 往左转、roll 歪多少（弧度），scale 再放大多少
export interface AirPose {
  dx: number;
  lift: number;
  inward: number;
  tilt: number;
  yaw: number;
  roll: number;
  scale: number;
}
const AIR_POSE: AirPose = { dx: 0.2, lift: 2.4, inward: 0.4, tilt: -0.9, yaw: 0.15, roll: -0.1, scale: 1.2 };

// 鸣牌、立直、和牌的特效颜色
const FX_GOLD = '#ffd36b';
const FX_RED = '#ff5a4f';
interface Character {
  seat: number;
  seatRoot: THREE.Group;
  avatar: Avatar | null;
  pose: RestPose; // 手平时放哪
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
  boltAt: number | null; // 闪电打在和的那张牌上的时间（3D 不放闪电），放过了就是 null
  stagger: number; // 一张张往下倒，相邻两张隔多久
  wins: { seat: number; tsumo: boolean; tile: TileId }[];
  topple: Map<TileId, { at: number; from: Placement | null }>;
}

interface Flight {
  tile: TileId;
  t: number;
  start: THREE.Vector3;
  // 不飞：在牌山上渐渐消失，再在手里渐渐出现（摸牌路径关掉时）
  fade: boolean;
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
  startScale?: number; // 出牌时牌在手里放大多少，搬运途中缩回牌河的大小
  drop?: boolean; // 2.5D 的立直棒：不开抽屉，从上方掉下来
}

const STACKS_HALF = 9;

const STANDING = new THREE.Euler(0, 0, 0);
const FACE_UP = new THREE.Euler(-Math.PI / 2, 0, 0);
const FACE_DOWN = new THREE.Euler(Math.PI / 2, 0, Math.PI);
// 公开手牌：立着往后仰（再整个转半圈，牌面朝桌子中间）
const OPEN_HAND = new THREE.Euler(0.5, 0, 0);

interface Placement {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

interface TileObj {
  group: THREE.Group;
  body: THREE.Mesh;
  back: THREE.Mesh;
  shown: boolean;
  target: Placement | null;
}

export interface SyncView {
  me: number;
  clickable: Set<TileId>;
  colors: string[];
  ids: string[];
  marked?: Set<TileId>; // 上方加个小三角的手牌（打出去能听牌的）
  airDraw?: TileId | null; // 自己立直后摸到、和不了的那张：不进手牌，停在手牌上方的空中，接着直接打进牌河
  tintBacks?: Set<TileId>; // 美穗子睁眼：这些牌的牌背按花色上色（万红、筒蓝、索绿、字牌白）
  deadly?: Set<TileId>; // 龙华的无极天：自己手里打出去会放铳的牌，牌身染红
  akaBacks?: Set<TileId>; // 丰音的赤口：没公开的赤宝牌（别人手里、牌山里），牌背发金红光
  handOrder?: TileId[]; // 自己手牌（不含刚摸的那张）从左到右的摆法；不给就照顺序排
  openHands?: boolean; // 公开手牌：别人的手牌摊开亮着
  drawPath?: 'on' | 'off' | 'self'; // 摸牌路径：on 都沿弧线飞，off 都是淡出淡入，self 只有自己飞
}

export class Table3D {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  private atlas = new FaceAtlas();
  private tiles: TileObj[] = [];
  private backMat: THREE.Material | null = null;
  private tintMats: THREE.Material[] = [];
  private akaMat: THREE.Material | null = null;
  private bodyMat: THREE.Material | null = null;
  private deadlyMat: THREE.Material | null = null;
  private faceGeoms: THREE.PlaneGeometry[] = [];
  private consoleCanvas = document.createElement('canvas');
  private consoleTex: THREE.CanvasTexture;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-9, -9);
  private hovered: TileId | null = null;
  // 副露的间距：组与组之间多留多少、手牌和副露之间至少留多少（调试面板和截图比较方案时会改）
  meldSpacing = { group: 0.1, hand: 0.25 };
  // 抬起来的那张牌原本的位置：鼠标还在这里就算还指着它（不然指着牌下沿时，牌一抬就指不到、一落又指到，来回抽搐）
  private hoverRest: { id: TileId; at: Placement } | null = null;
  // 鼠标移上移下的那两张牌，这一小会儿抬起、放下要快（雀魂一帧就到位）
  private hoverSnap: { ids: TileId[]; until: number } = { ids: [], until: 0 };
  private clickable = new Set<TileId>();
  private lastSync: { g: Game; view: SyncView } | null = null;
  private clock = new THREE.Clock();
  // 动画用的时间（秒），每帧最多走 0.05 秒，卡顿时动画放慢而不是跳过
  private now = 0;
  private frame = 0;
  private characters: Character[] = [];
  private characterGen = 0;
  // 角色模型还没到齐时，画面上方显示下载进度；有模型加载失败就不再显示（占位人偶先顶着）
  private modelUrls: string[] = [];
  private modelFailed = false;
  private loadingEl: HTMLDivElement | null = null;
  private dice = new Dice(0.5);
  private deal: DealState | null = null;
  private handAnims: HandAnim[] = [];
  private flights: Flight[] = [];
  // 别人打出的牌还在半空时摸到的牌：先留在牌山原处，落桌后再飞进手里
  private heldDraw: { seat: number; tile: TileId; at: number; from: Placement } | null = null;
  private effects: Effects;
  private riichiSticks: THREE.Mesh[] = [];
  // 立直棒：hidden 还在抽屉里，anim 正被手拿着，placed 已经放到桌上
  private stickState: ('hidden' | 'anim' | 'placed')[] = ['hidden', 'hidden', 'hidden', 'hidden'];
  private drawers: { group: THREE.Group; open: number }[] = [];
  private shake = 0;
  // 调试截图时手动摆镜头，不让动画覆盖
  debugCamera = false;
  // 2.5D 镜头平时的位置（按画面比例算好），和自己手牌往后仰的角度
  private rest = { pos: new THREE.Vector3(0, 18, 28.5), look: new THREE.Vector3(0, 0.5, -1.5) };
  private handTilt = -0.32;
  // 2.5D：画面上不能让副露压住的地方（头像框、能力说明），由外面给出，相对页面的矩形
  keepOut: (() => DOMRect[]) | null = null;
  // 2.5D：每家（按相对座位，0 是自己）第一组副露最远能摆到哪，画面大小变了重新算
  private meldLimit: number[] | null = null;
  private view25: View25 = { ...DEFAULT_VIEW_25D };
  // 出牌动作经过标记（出发、抓住、落桌、松手、收回）时通知外面，比如落桌时放声音。
  // 每张打出的牌每个标记都恰好报一次，动作被打断也会补报
  onMarker: ((seat: number, tile: TileId, name: MarkerName) => void) | null = null;
  // 每帧画之前调用（动画已经推进到这一帧），调试场景在这里更新辅助线和读数
  beforeRender: (() => void) | null = null;
  // 鼠标移到能打的牌上、或者移开（null）时通知外面，用来显示打这张以后听什么
  onHover: ((id: TileId | null) => void) | null = null;
  // 标记用的小三角，按需要的个数建，多出来的藏起来
  private marks: THREE.Mesh[] = [];
  private overlayGroup: THREE.Group | null = null;
  private zoom = { t: -1, target: new THREE.Vector3() };
  private held = new Set<TileId>();
  private reveal: RevealState | null = null;
  // 每家手牌上一次的摆法；打牌时先按这个摆，牌落进牌河后再理牌
  private layouts: { hand: TileId[]; drawn: TileId | null }[] = [];
  // 每家手牌这一排上一次摆在哪：第一张的中心、每张隔多远、放大多少、离中心多远。倒牌时照着摆，牌原地倒下
  private handRows: { x0: number; step: number; hs: number; z: number }[] = [];
  private frozen = new Map<number, { hand: TileId[]; drawn: TileId | null; until: number }>();
  private consoleKey = '';
  private resizer = new ResizeObserver(() => this.resize());
  // 牌桌尺寸（可调的参数）和由它算出来的各处位置
  private tableLayout: TableLayout = { ...DEFAULT_LAYOUT };
  // 立直摸切那张牌在空中的样子（调试时可以改）
  airPose: AirPose = { ...AIR_POSE };
  private dim: TableDims = tableDims(this.tableLayout);
  private tableGroup: THREE.Group | null = null;
  private tableMats: TableMaterials | null = null;
  private feltMat: THREE.Material | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  // 桌布、牌背、桌框的颜色跟着界面皮肤走，建牌桌时定下来
  private colors: TableColors = tableColors();

  constructor(
    private container: HTMLElement,
    private onTileClick: (id: TileId) => void,
    readonly style: TableStyle = '3d',
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
    // 牌面画好、仪表盘用的字体下载好以后，仪表盘重画一次
    const redrawConsole = () => {
      this.consoleKey = '';
      if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
    };
    void this.atlas.draw().then(redrawConsole);
    const fonts = ["700 1em 'Barlow Condensed'", "900 1em 'Noto Sans SC'", this.colors.console.title];
    void Promise.all(fonts.map((f) => document.fonts?.load(f, '东南西北一二三四局本场余0123456789,'))).then(redrawConsole, () => {});

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
    this.loadingEl?.remove();
  }

  // ---------- 场景 ----------

  private buildRoom(): void {
    this.scene.background = new THREE.Color(this.colors.room);
    this.scene.fog = new THREE.Fog(this.colors.room, 40, 80);

    this.scene.add(new THREE.HemisphereLight('#dfefff', '#1b2a2c', 1.1));
    const key = new THREE.DirectionalLight('#fff4e0', 2.2);
    key.position.set(-6, 22, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    this.scene.add(key);

    // 桌子：黑色亮面，桌框只比桌布高一点，内侧一圈金属包边；尺寸变了会整个重建（buildTable）
    const frameMat = new THREE.MeshStandardMaterial({ color: this.colors.frame, roughness: 0.32, metalness: 0.25 });
    const trimMat = new THREE.MeshStandardMaterial({ color: this.colors.trim, roughness: 0.3, metalness: 0.8 });
    this.tableMats = {
      frame: frameMat,
      trim: trimMat,
      body: new THREE.MeshStandardMaterial({ color: '#1e2227', roughness: 0.36, metalness: 0.1 }),
      floor: new THREE.MeshStandardMaterial({ color: this.colors.room, roughness: 1 }),
    };
    // 机身在桌框下面的阴影里，只靠灯光几乎全黑；给它一点房间的反光，弧面才看得出来
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    for (const [m, k] of [[this.tableMats.body, 0.5], [frameMat, 0.35]] as const) {
      (m as THREE.MeshStandardMaterial).envMap = room;
      (m as THREE.MeshStandardMaterial).envMapIntensity = k;
    }
    this.feltMat = new THREE.MeshStandardMaterial({ map: feltTexture(this.colors), roughness: 0.95 });
    this.keyLight = key;
    this.buildTable();

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

  // 桌布、桌框、机身、地面，按现在的尺寸建；换尺寸时把旧的扔掉重建
  private buildTable(): void {
    if (this.tableGroup) {
      this.scene.remove(this.tableGroup);
      this.tableGroup.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const d = this.dim;
    const group = buildTableModel(d, FRAME_TOP, this.tableMats!);
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(d.tableHalf * 2, d.tableHalf * 2), this.feltMat!);
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    group.add(felt);
    this.tableGroup = group;
    this.scene.add(group);
    // 影子要盖住整张桌子
    const sc = this.keyLight!.shadow.camera;
    const half = Math.max(16, d.bodyHalf + 1);
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.updateProjectionMatrix();
  }

  private buildTiles(): void {
    for (let i = 0; i < FACE_TOTAL; i++) this.faceGeoms.push(this.atlas.faceGeometry(i, TILE_W * 0.9, TILE_H * 0.9));
    const bodyGeom = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_T * 0.62, 3, 0.12);
    const backGeom = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_T * 0.42, 3, 0.12);
    // 2.5D 时自己的手牌几乎正对镜头，灯又在镜头这边，亮面会把牌面照白一片，所以磨砂一点
    const matte = this.style === '25d' ? 0.62 : 0;
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#f6f1e3', roughness: matte || 0.35 });
    this.bodyMat = bodyMat;
    this.deadlyMat = new THREE.MeshStandardMaterial({ color: '#f08a80', emissive: '#d23a2e', emissiveIntensity: 0.35, roughness: matte || 0.35 });
    const backMat = new THREE.MeshStandardMaterial({ color: this.colors.back, roughness: matte || 0.4 });
    this.backMat = backMat;
    // 美穗子睁眼时的牌背：万红、筒蓝、索绿、字牌白，微微发光，隔着桌子也看得清
    this.tintMats = ['#e0453a', '#3a6df0', '#2fb25a', '#f4f4f0'].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: matte || 0.4 }),
    );
    this.akaMat = new THREE.MeshStandardMaterial({ color: '#ff5a2e', emissive: '#ff7a1e', emissiveIntensity: 0.7, roughness: matte || 0.4 });
    const faceMat = new THREE.MeshStandardMaterial({ map: this.atlas.texture, transparent: true, roughness: matte || 0.35 });
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
      this.tiles.push({ group, body, back, shown: false, target: null });
    }
  }

  private buildCharacters(view: SyncView): void {
    const { colors, me } = view;
    for (const c of this.characters) this.scene.remove(c.seatRoot);
    this.characters = [];
    this.modelUrls = [];
    this.modelFailed = false;
    const gen = ++this.characterGen;
    for (let s = 0; s < 4; s++) {
      const rel = (s - me + 4) % 4;
      const look = LOOKS[view.ids[s]] ?? LOOKS.saki;
      const seatRoot = new THREE.Group();
      // 模型加载完之前先放一个简单的占位人物（自己的座位不放，免得挡住手牌）
      const holder = rel === 0 ? null : placeholder(colors[s]);
      if (holder) seatRoot.add(holder);
      this.scene.add(seatRoot);
      // 自己的手平时放在腿上，免得挡住手牌
      const ch: Character = { seat: s, seatRoot, avatar: null, pose: rel === 0 ? 'offscreen' : look.pose ?? 'edge' };
      this.characters.push(ch);
      this.seatCharacter(ch, me);
      const url = look.model;
      this.modelUrls.push(url);
      Avatar.load(url)
        .then((av) => {
          if (gen !== this.characterGen) return;
          applyLook(av.vrm, look);
          if (holder) seatRoot.remove(holder);
          ch.avatar = av;
          this.seatCharacter(ch, me);
          if (rel === 0) av.setFirstPerson(this.camera);
          seatRoot.add(av.root);
        })
        .catch((err) => {
          if (gen === this.characterGen) this.modelFailed = true;
          console.warn('角色模型加载失败', url, err);
        });
    }
  }

  // 按现在的牌桌尺寸让人入座：椅子的位置、人物大小、坐多高、手放在哪、平时看哪里
  private seatCharacter(ch: Character, me: number): void {
    const d = this.dim;
    const s = ch.seat;
    ch.seatRoot.position.set(0, 0, d.seatZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seatAngle(s, me));
    ch.seatRoot.rotation.y = this.seatAngle(s, me);
    const av = ch.avatar;
    if (!av) return;
    av.root.scale.setScalar(d.scale);
    av.root.position.y = d.seatY - av.hipHeight * d.scale;
    // 桌面和桌沿换算到模型自身坐标
    av.setRestPose(av.hipHeight - d.seatY / d.scale, (d.tableHalf - d.seatZ) / d.scale, ch.pose);
    av.home = this.seatPoint(s, 0, 0, d.handZ);
    // 偶尔瞟一眼别家的脸或者桌子中间
    av.glances = [0, 1, 2, 3]
      .filter((o) => o !== s)
      .map((o) => this.seatPoint(o, 0, d.seatY + 0.55 * d.scale, d.seatZ))
      .concat(new THREE.Vector3(0, 0, 0));
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
    if (this.style === '25d') return true;
    return this.characters.length === 4 && this.characters.every((c) => c.avatar);
  }

  // 立刻把所有牌放到位：停掉手上的动作、飞牌、发牌和理牌，人回到记下的静止样子
  snap(): void {
    this.handAnims = [];
    for (const f of this.flights) if (f.fade) this.setTileOpacity(this.tiles[f.tile], 1);
    this.flights = [];
    this.heldDraw = null;
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

  // 怜的演算退出：牌桌直接摆回现在的牌局（不播动画），演算里的倒牌、拉开的抽屉都收掉。先 sync 真的牌局再调
  restore(): void {
    this.reveal = null;
    for (const d of this.drawers) d.open = 0;
    this.snap();
  }

  // 现在的牌桌尺寸
  get layout(): TableLayout {
    return { ...this.tableLayout };
  }

  get dims(): TableDims {
    return this.dim;
  }

  // 换牌桌尺寸：桌子重建，人重新入座，牌和立直棒按新的位置摆。动作调试场景用，之后再 snap 一次
  setLayout(l: TableLayout): void {
    this.tableLayout = clampLayout(l);
    this.dim = tableDims(this.tableLayout);
    this.buildTable();
    const me = this.lastSync?.view.me ?? 0;
    for (const c of this.characters) this.seatCharacter(c, me);
    this.resize();
    if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
    for (let s = 0; s < 4; s++) if (this.stickState[s] === 'placed') this.finishStick(s);
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
    // 摸到的牌还没从牌山出发
    if (this.heldDraw) until = Math.max(until, this.heldDraw.at);
    if (this.reveal) until = Math.max(until, this.reveal.fxAt);
    return Math.max(0, (until - this.now) * 1000);
  }

  // 牌局事件驱动骰子、发牌，以及角色的视线、表情和动作
  onEvent(e: GameEvent, g: Game): void {
    const all = this.characters;
    // 等着落桌的那张摸牌，有人出牌、鸣牌或者一局结束就不再等（能力消息不算）
    if (e.type !== 'ability') this.releaseDraw();
    if (e.type === 'roundStart') {
      this.startDeal(g);
      this.reveal = null;
    }
    if (e.type === 'draw') {
      // 发牌动画里庄家的第一张不用另外飞。上家打的牌还在半空就先等它落桌
      const drawn = g.players[e.seat].drawn;
      const wait = this.drawWait(e.seat);
      const obj = drawn !== null ? this.tiles[drawn] : null;
      if (!this.deal && drawn !== null && obj) {
        if (wait > 0 && obj.shown) {
          const from = { pos: obj.group.position.clone(), quat: obj.group.quaternion.clone(), scale: obj.group.scale.x };
          this.heldDraw = { seat: e.seat, tile: drawn, at: this.now + wait, from };
        } else this.startFlight(drawn, e.seat);
      }
      const ch = this.characterAt(e.seat);
      if (ch && drawn !== null) ch.avatar?.lookAtPoint(this.tiles[drawn].group.position.clone(), 0.8);
    } else if (e.type === 'discard') {
      // 隐身的桃子打的牌：看不见，手里那张直接消失，没有动画、没有立直特效
      if (g.stealthed(e.seat, this.lastSync?.view.me ?? 0)) return;
      const pond = this.seatPoint(e.seat, 0, 0, this.dim.pondZ + 1.5);
      // 立直宣言：牌拍下去的那一刻放特效（落桌标记），接着从抽屉里拿立直棒放到桌上（2.5D 是落桌后立直棒直接掉下来）
      const flat = this.style === '25d';
      const motion = e.riichi ? (flat ? SLIDE_RIICHI : RIICHI_DISCARD) : flat ? SLIDE_DISCARD : DEFAULT_DISCARD;
      this.playDiscard(e.seat, e.tile, motion, !!e.riichi);
      if (e.riichi) this.startStickAnim(e.seat, -(motion.reach + motion.carry + (flat ? STICK_DROP_DELAY : motion.settle)));
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
      // 立直宣言了但别人还在决定要不要鸣这张牌时，立直还没成立，也算在立直：正在拿的立直棒不能被收回去
      // 隐身以后的立直看不见
      const on = g.seesRiichi(s, this.lastSync?.view.me ?? 0) && g.phase !== 'roundEnd';
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
    const dest = this.stickPlacement(seat);
    const drop = this.style === '25d';
    const from = drop ? { pos: dest.pos.clone().setY(dest.pos.y + STICK_DROP_HEIGHT), quat: dest.quat } : this.drawerStick(seat);
    this.stickState[seat] = 'anim';
    this.riichiSticks[seat].visible = false;
    this.handAnims.push({
      seat,
      kind: 'stick',
      tile: -1,
      t: delay,
      start: from.pos,
      startQuat: from.quat,
      dest,
      timing: drop ? STICK_DROP : STICK_TIMING,
      hold: 0,
      drop,
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

  private startFlight(tile: TileId, seat: number): void {
    const obj = this.tiles[tile];
    if (!obj.shown) return;
    const path = this.lastSync?.view.drawPath ?? 'on';
    const fade = path === 'off' || (path === 'self' && seat !== this.lastSync?.view.me);
    this.flights = this.flights.filter((f) => f.tile !== tile);
    this.flights.push({ tile, t: 0, start: obj.group.position.clone(), fade });
  }

  // 摸牌淡出淡入：牌的材质是大家共用的，淡的时候这张牌换成自己的半透明复制品，淡完换回去
  private setTileOpacity(tile: TileObj, opacity: number): void {
    for (const m of tile.group.children as THREE.Mesh[]) {
      const base = (m.userData.base as THREE.Material | undefined) ?? (m.material as THREE.Material);
      if (opacity >= 1) {
        if (m.userData.base) m.material = base;
        (m.userData.fadeMat as THREE.Material | undefined)?.dispose();
        m.userData.base = m.userData.fadeMat = undefined;
        continue;
      }
      // 换过一次以后 sync 可能又把共用的材质放回来（立直、标红换了材质也一样），以现在的为准重新复制
      if (m.material !== m.userData.fadeMat) {
        (m.userData.fadeMat as THREE.Material | undefined)?.dispose();
        const own = (m.material as THREE.Material).clone();
        own.transparent = true;
        m.userData.base = m.material;
        m.userData.fadeMat = own;
        m.material = own;
      }
      (m.material as THREE.Material).opacity = opacity;
    }
  }

  // 这家的摸牌还要等多久才能飞（秒）：别家打出的牌落桌之后再隔 DRAW_GAP。
  // 刚落桌不到 DRAW_GAP 的也要等够，不然人鸣牌按“过”正赶上落桌时，两下看着还是同时的
  private drawWait(seat: number): number {
    let left = 0;
    for (const a of this.handAnims) {
      if (a.kind === 'tile' && a.seat !== seat) left = Math.max(left, a.timing.reach + a.timing.carry + DRAW_GAP - a.t);
    }
    return left;
  }

  // 让等着的那张摸牌从牌山出发
  private releaseDraw(): void {
    const h = this.heldDraw;
    if (!h) return;
    this.heldDraw = null;
    if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
    this.startFlight(h.tile, h.seat);
  }

  // 出牌：手牌在牌落进牌河之前保持原样，出牌的人看着牌河，手把牌搬过去。
  // 牌局和动作调试场景都走这里；调用之后再 sync，牌的落点就是 sync 算出的牌河位置
  playDiscard(seat: number, tile: TileId, motion: DiscardParams, riichi = false): void {
    const prev = this.layouts[seat];
    // 空位留到落桌：2.5D 落桌那一刻就合拢（雀魂空位停约 0.35 秒），3D 再多等一下
    const close = this.style === '25d' ? 0 : 0.15;
    if (prev) this.frozen.set(seat, { ...prev, until: this.now + motion.reach + motion.carry + close });
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
      startScale: obj.group.scale.x,
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
    const flat = this.style === '25d';
    const at = this.now + (r.wins.length ? (flat ? REVEAL_DELAY_25D : REVEAL_DELAY) : 0.3);
    const stagger = flat ? TOPPLE_STAGGER_25D : TOPPLE_STAGGER;
    let fxAt = at;
    const shown = this.revealSeats(g);
    for (const [s, win] of shown) {
      const n = g.players[s].hand.length + (win !== null && !g.players[s].hand.includes(win) ? 1 : 0);
      const wave = (LOOKS[this.lastSync?.view.ids[s] ?? '']?.reveal ?? 'wave') === 'wave';
      fxAt = Math.max(fxAt, at + (wave ? (n - 1) * stagger : 0) + TOPPLE_TIME + 0.1);
    }
    // 被荣和的立直不成立，还没拿出来的立直棒不拿了
    this.handAnims = this.handAnims.filter((a) => a.kind !== 'stick');
    for (const d of this.drawers) d.open = 0;
    this.reveal = {
      at,
      fxAt,
      fxDone: false,
      boltAt: flat && r.wins.length ? at - BOLT_LEAD : null,
      stagger,
      wins: r.wins.map((w) => ({ seat: w.seat, tsumo: w.from === null, tile: w.tile })),
      topple: new Map(),
    };
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
    if (this.characters.length === 0 && this.style === '3d') this.buildCharacters(view);
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
      const mat = view.akaBacks?.has(id) ? this.akaMat : view.tintBacks?.has(id) ? this.tintMats[Math.min(3, Math.floor(kindOf(id) / 9))] : this.backMat;
      if (mat && t.back.material !== mat) t.back.material = mat;
      const body = view.deadly?.has(id) ? this.deadlyMat : this.bodyMat;
      if (body && t.body.material !== body) t.body.material = body;
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

  // 座位本地坐标里 z0 那一排的 x0，在 z1 那一排上画面横向位置相同的 x（按镜头的默认位置算）
  private sameScreenX(seat: number, me: number, x0: number, z0: number, z1: number): number {
    const cam = this.camera.clone();
    cam.position.copy(this.rest.pos);
    cam.lookAt(this.rest.look);
    cam.updateMatrixWorld();
    const sx = (x: number, z: number) => this.toWorld(seat, me, x, 0, z, STANDING).pos.project(cam).x;
    const a = sx(0, z1);
    const b = sx(1, z1) - a;
    return Math.abs(b) < 1e-6 ? x0 : (sx(x0, z0) - a) / b;
  }

  private placeSeat(g: Game, s: number, me: number, out: Map<TileId, Placement>): void {
    const p = g.players[s];
    const mine = s === me;
    const lyingY = TILE_T / 2;
    // 松实姐妹的习惯：牌河和副露倒过来摆，让对手看到的是正的
    const flip = LOOKS[this.lastSync?.view.ids[s] ?? '']?.upsideDown ? Math.PI : 0;

    // 副露：一组一组从右边往左摆，每组里的顺序见 meldLayout（横着的那张按来源放左、中、右）
    let mx = this.meldStart(s, me);
    for (const m of p.melds) {
      const slots = meldLayout(m, s);
      mx -= slots.reduce((sum, sl) => sum + (sl.sideways ? TILE_H : TILE_W) + GAP, 0);
      let x = mx;
      for (const sl of slots) {
        const w = sl.sideways ? TILE_H : TILE_W;
        // 横着的牌往外挪，外沿和竖着的牌对齐
        const z = sl.sideways ? this.dim.meldZ + (TILE_H - TILE_W) / 2 : this.dim.meldZ;
        out.set(sl.tile, this.toWorld(s, me, x + w / 2, lyingY, z, sl.hidden ? FACE_DOWN : FACE_UP, (sl.sideways ? Math.PI / 2 : 0) + flip));
        // 加杠的那张叠放在横着的牌上方（靠桌子中心一侧）
        if (sl.stacked !== undefined) {
          out.set(sl.stacked, this.toWorld(s, me, x + w / 2, lyingY, z - TILE_W - GAP, FACE_UP, Math.PI / 2 + flip));
        }
        x += w + GAP;
      }
      mx -= this.meldSpacing.group;
    }

    // 隐身的桃子：手牌和牌河都看不见（副露照旧摆着）
    if (g.stealthed(s, me)) return;

    // 手牌：自己的稍微后仰朝向镜头，别人的立着背对我们
    let drawn = p.drawn;
    const order = mine ? this.lastSync?.view.handOrder : undefined;
    let hand: (TileId | null)[] = order ? order.filter((t) => p.hand.includes(t) && t !== drawn) : p.hand.filter((t) => t !== drawn).sort((a, b) => a - b);
    // 摸到的牌还在等上家的牌落桌：留在牌山原处，手牌先不给它留位置
    const hd = this.heldDraw;
    if (hd && hd.seat === s && hd.tile === drawn) {
      out.set(hd.tile, hd.from);
      drawn = null;
    }
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
    // 自己的手牌放大一些，看得清也好点
    const hs = mine ? (this.style === '25d' ? this.view25.hand : MY_HAND_SCALE) : 1;
    const step = (TILE_W + GAP) * hs;
    // 宽度总按“手牌 + 摸到的那张”算，不管现在手里有没有摸到的牌：
    // 这样摸牌、打牌时这一排不左右挪，打掉摸到的牌其他牌也原地不动（和雀魂一样）
    const width = (13 - 3 * p.melds.length + 1) * step + 0.5;
    // 副露多了手牌往左让，和副露之间留一点缝。自己的手牌离镜头近、看起来更往外，
    // 按画面上对齐：手牌右沿在画面上正好落在第一组副露左边一点
    const edge = mx - this.meldSpacing.hand;
    const handEdge = mine ? this.sameScreenX(s, me, edge, this.dim.meldZ, this.dim.handZ + (hs - 1) * 1.2) : edge;
    const shift = p.melds.length ? Math.max(0, width / 2 - handEdge) : 0;
    let x = -width / 2 - shift + TILE_W / 2;
    // 公开手牌：上家、下家的手牌像倒牌那样摊开；对家的摊开会被牌山挡住，改成转过来牌面朝桌子中间、往后仰
    const open = !mine && !tilting && !!this.lastSync?.view.openHands;
    const facing = open && (s - me + 4) % 4 === 2;
    const rot = tilting ? new THREE.Euler(Math.PI / 2, 0, 0) : mine ? new THREE.Euler(this.handTilt, 0, 0) : facing ? OPEN_HAND : open ? FACE_UP : STANDING;
    const y = tilting || (open && !facing) ? (TILE_T / 2) * hs : (TILE_H / 2) * hs;
    // 2.5D 时上家、下家的手牌斜着看过去离牌山很近，往桌边推一点
    const top = this.style === '25d' && (s - me + 4) % 4 === 2;
    const side = this.style === '25d' && (s - me + 4) % 2 === 1 ? SIDE_HAND_PUSH_25D : top ? TOP_HAND_PUSH_25D : 0;
    const hz = this.dim.handZ + side + (hs - 1) * 1.2 + (tilting ? (TILE_H / 2) * hs : 0);
    // 倒牌开始后不再更新：和牌以后手牌张数可能变了，倒牌要照着和牌前那一刻的位置
    if (!tilting && !this.reveal) this.handRows[s] = { x0: x, step, hs, z: hz };
    // 2.5D 时自己的手牌两头往中间转一点
    const fan = mine && this.style === '25d' && !tilting ? this.view25.fan : 0;
    const place = (t: TileId | null) => {
      const lift = mine && t !== null && t === this.hovered && this.clickable.has(t) ? 0.4 : 0;
      const yaw = (fan ? (-fan * (x + shift)) / (width / 2) : 0) + (facing ? Math.PI : 0);
      if (lift && t !== null) this.hoverRest = { id: t, at: this.toWorld(s, me, x, y, hz, rot, yaw, hs) };
      if (t !== null && p.hand.includes(t)) out.set(t, this.toWorld(s, me, x, y + lift, hz, rot, yaw, hs));
      x += step;
    };
    hand.forEach(place);
    if (drawn !== null) {
      x += 0.5;
      if (mine && drawn === this.lastSync?.view.airDraw && p.hand.includes(drawn)) {
        const a = this.airPose;
        const yaw = (fan ? (-fan * (x + shift)) / (width / 2) : 0) + a.yaw;
        const tilt = new THREE.Euler(rot.x + a.tilt, 0, a.roll);
        out.set(drawn, this.toWorld(s, me, x + a.dx * hs, y + a.lift * hs, hz - a.inward * hs, tilt, yaw, hs * a.scale));
      } else place(drawn);
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

  // 一局结束：和牌的人、流局时听牌的人把手牌摊开（倒牌），和的那张放在最右边
  private placeReveal(g: Game, me: number, out: Map<TileId, Placement>): void {
    const rv = this.reveal;
    if (!rv || this.now < rv.at) return;
    for (const [s, win] of this.revealSeats(g)) {
      const wave = (LOOKS[this.lastSync?.view.ids[s] ?? '']?.reveal ?? 'wave') === 'wave';
      const tiles = g.players[s].hand.filter((t) => t !== win).sort((a, b) => a - b);
      // 照着站着时的位置摆，每张牌原地往下倒，不左右挪（自摸的那张本来就在最右边隔开一点的地方）
      const row = this.handRows[s] ?? { x0: 0, step: TILE_W + GAP, hs: 1, z: this.dim.handZ };
      let x = row.x0;
      const z = row.z + 0.3 * row.hs;
      const topple = (t: TileId, i: number) => {
        if (!rv.topple.has(t)) rv.topple.set(t, { at: rv.at + (wave ? i * rv.stagger : 0), from: null });
      };
      tiles.forEach((t, i) => {
        out.set(t, this.toWorld(s, me, x, (TILE_T / 2) * row.hs, z, FACE_UP, 0, row.hs));
        topple(t, i);
        x += row.step;
      });
      if (win === null) continue;
      const tsumo = g.players[s].hand.includes(win);
      // 自摸的那张跟着一起倒；荣和的那张等倒完再从牌河移过来
      if (tsumo || this.now >= rv.fxAt) out.set(win, this.toWorld(s, me, x + 0.5, (TILE_T / 2) * row.hs, z, FACE_UP, 0, row.hs));
      if (tsumo) topple(win, tiles.length);
    }
  }

  private wallPlacement(slot: WallSlot, me: number): Placement {
    const x = (STACKS_HALF - slot.stack) * WALL_PITCH;
    const y = slot.level === 0 ? TILE_T * 1.5 : TILE_T * 0.5;
    const rel = (slot.wall - me + 4) % 4;
    const flat = this.style === '25d';
    const out = this.toWorld(slot.wall, me, x, y, WALL_Z - (flat && rel === 2 ? TOP_WALL_IN_25D : 0), slot.faceUp ? FACE_UP : FACE_DOWN);
    // 往画面下方挪：自己坐在世界的 +z 那边
    if (flat && rel === 1) out.pos.z += RIGHT_WALL_DOWN_25D;
    return out;
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

  // 仪表盘：中间一块方屏写局数、本场、余牌、宝牌和供托；四边各家的风位和点数朝着自己，轮到谁谁那边亮一条。
  // 颜色和局数的字体跟皮肤走（theme.ts 的 console）
  private drawConsole(g: Game, view: SyncView): void {
    // 发牌时每帧都会 sync，内容没变就不重画
    const key = JSON.stringify([
      g.roundWind,
      g.roundNumber,
      g.honba,
      g.wall.remaining,
      g.shownSticks(view.me),
      g.wall.doraRevealed,
      g.wall.doraIndicators,
      g.players.map((_, s) => [g.shownScore(s, view.me), g.seesRiichi(s, view.me), g.seatWind(s)]),
      g.phase === 'turn' ? g.turn : -1,
      view.me,
      view.colors,
    ]);
    if (key === this.consoleKey) return;
    this.consoleKey = key;
    const k = this.colors.console;
    const c = this.consoleCanvas.getContext('2d')!;
    const S = 512;
    const M = S / 2;
    const num = (px: number) => `700 ${px}px 'Barlow Condensed','Arial Narrow',sans-serif`;
    const title = (px: number) => k.title.replace('1em', `${px}px`);
    c.setTransform(4, 0, 0, 4, 0, 0);
    c.imageSmoothingQuality = 'high';
    const bg = c.createRadialGradient(M, M, 40, M, M, M * 1.4);
    bg.addColorStop(0, k.bg[0]);
    bg.addColorStop(1, k.bg[1]);
    c.fillStyle = bg;
    c.fillRect(0, 0, S, S);
    c.strokeStyle = k.line;
    c.globalAlpha = 0.5;
    c.lineWidth = 2;
    c.strokeRect(10, 10, S - 20, S - 20);
    c.globalAlpha = 1;
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    // 中间的方屏
    const P = 124;
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.roundRect(M - P, M - P, P * 2, P * 2, 18);
    c.fill();
    c.strokeStyle = k.line;
    c.lineWidth = 2.5;
    c.stroke();
    // 方屏四角的小折线
    c.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      c.save();
      c.translate(M, M);
      c.rotate((i * Math.PI) / 2);
      c.beginPath();
      c.moveTo(-P - 8, -P + 22);
      c.lineTo(-P - 8, -P - 8);
      c.lineTo(-P + 22, -P - 8);
      c.stroke();
      c.restore();
    }
    // 局数：东一局
    c.fillStyle = k.accent;
    c.shadowColor = k.accent;
    c.shadowBlur = 12;
    c.font = title(80);
    c.fillText(`${WIND_CN[g.roundWind]}${'一二三四'[g.roundNumber]}局`, M, M - 56);
    c.shadowBlur = 0;
    // 本场、余牌
    c.font = num(30);
    c.fillStyle = k.dim;
    c.textAlign = 'right';
    c.fillText(`${g.honba} 本场`, M - 12, M + 4);
    c.textAlign = 'left';
    c.fillText(`余 ${g.wall.remaining}`, M + 12, M + 4);
    c.textAlign = 'center';
    c.fillStyle = k.line;
    c.fillRect(M - 1, M - 10, 2, 28);
    // 宝牌指示牌：翻开的画牌面，没翻的画牌背
    const w = 36;
    const h = 48;
    g.wall.doraIndicators.forEach((t, i) => {
      const x = M + (i - 2.5) * (w + 5) + 2.5;
      const y = M + 28;
      c.fillStyle = i < g.wall.doraRevealed ? '#f6f1e3' : this.colors.back;
      c.beginPath();
      c.roundRect(x, y, w, h, 5);
      c.fill();
      if (i < g.wall.doraRevealed) this.atlas.drawFace(c, faceIndex(t), x, y, w, h);
    });
    // 供托：场上有几根立直棒
    const sticks = g.shownSticks(view.me);
    if (sticks) {
      drawStick(c, M - 24, M + 102, 64, 9);
      c.font = num(28);
      c.fillStyle = k.ink;
      c.textAlign = 'left';
      c.fillText(`×${sticks}`, M + 16, M + 102);
      c.textAlign = 'center';
    }

    // 四边：风位、点数，各朝各的人
    for (let s = 0; s < 4; s++) {
      const rel = (s - view.me + 4) % 4;
      c.save();
      c.translate(M, M);
      c.rotate((-rel * Math.PI) / 2);
      const active = g.phase === 'turn' && g.turn === s;
      // 轮到谁，谁那边亮一条
      if (active) {
        c.fillStyle = k.accent;
        c.shadowColor = k.accent;
        c.shadowBlur = 16;
        c.beginPath();
        c.roundRect(-140, 229, 280, 7, 3.5);
        c.fill();
        c.shadowBlur = 0;
      }
      // 风位：圆圈用角色的颜色，轮到他时填满
      c.beginPath();
      c.arc(-116, 190, 28, 0, Math.PI * 2);
      c.fillStyle = active ? k.accent : 'rgba(0,0,0,0.4)';
      c.fill();
      c.strokeStyle = view.colors[s];
      c.lineWidth = 4;
      c.stroke();
      c.fillStyle = active ? k.bg[1] : k.ink;
      c.font = "900 34px 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";
      c.fillText(WIND_CN[g.seatWind(s) - 27], -116, 192);
      // 点数
      c.font = num(66);
      const score = g.shownScore(s, view.me);
      c.fillStyle = score < 0 ? '#ff6b6b' : active ? k.accent : k.ink;
      c.textAlign = 'left';
      c.fillText(score.toLocaleString('en-US'), -78, 192);
      c.textAlign = 'center';
      if (g.seesRiichi(s, view.me)) drawStick(c, 0, 143, 160, 11);
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
    if (this.style === '25d') {
      this.fitCamera();
      return;
    }
    // 竖屏时把视野拉宽，保证整张桌子都在画面里
    this.camera.fov = w / h < 1.2 ? 38 * Math.min(1.9, 1.2 / (w / h)) : 38;
    if (!this.debugCamera) {
      // 镜头跟着自己的手牌走，手牌挪远挪近都还在画面里同一个地方附近
      this.camera.position.set(0, 18, this.dim.handZ + 17.5);
      this.camera.lookAt(0, 0.5, -1.5);
    }
    this.camera.updateProjectionMatrix();
  };

  // 2.5D：俯角固定，镜头往后退到四家的手牌和牌山都在画面里为止（竖屏时自然就退得远）。
  // 再上下挪一挪，让上下留的边一样多。自己的手牌跟着仰到正对镜头
  private fitCamera(): void {
    const d = this.dim;
    const cam = this.camera;
    const v = this.view25;
    cam.fov = v.fov;
    cam.updateProjectionMatrix();
    const pitch = cam.aspect < 1 ? v.portraitPitch : v.pitch;
    const dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    const myZ = d.handZ + (v.hand - 1) * 1.2;
    const myHalf = this.myHandHalf();
    const far = d.handZ + TILE_T + TOP_HAND_PUSH_25D;
    const side = WALL_Z + TILE_H;
    const pts = [
      // 对家的手牌（立着，算上牌的高度）
      new THREE.Vector3(-side, TILE_H, -far),
      new THREE.Vector3(side, TILE_H, -far),
      // 左右两家的手牌
      new THREE.Vector3(-far, TILE_H, -side),
      new THREE.Vector3(far, TILE_H, -side),
      new THREE.Vector3(-far, 0, side),
      new THREE.Vector3(far, 0, side),
      // 自己的手牌，下沿
      new THREE.Vector3(-myHalf, 0, myZ + TILE_T),
      new THREE.Vector3(myHalf, 0, myZ + TILE_T),
      // 自己的副露（摆在手牌右边，横着的牌伸得最远）
      new THREE.Vector3(myHalf, 0, d.meldZ + TILE_H),
      // 别家的副露：左右两家的在桌子两侧靠前靠后，对家的在上面
      new THREE.Vector3(-(d.meldZ + TILE_H), 0, MELD_MIN_25D),
      new THREE.Vector3(d.meldZ + TILE_H, 0, -MELD_MIN_25D),
      new THREE.Vector3(-MELD_MIN_25D, 0, -(d.meldZ + TILE_H)),
    ];
    const look = new THREE.Vector3(0, 0, v.lookZ);
    // 镜头离 look 多远时所有点都在画面里（两边各留一点边）
    const fits = (dist: number): { ok: boolean; mid: number } => {
      cam.position.copy(look).addScaledVector(dir, dist);
      cam.lookAt(look);
      cam.updateMatrixWorld();
      let lo = Infinity;
      let hi = -Infinity;
      let ok = true;
      for (const p of pts) {
        const v = p.clone().project(cam);
        if (Math.abs(v.x) > 0.97) ok = false;
        lo = Math.min(lo, v.y);
        hi = Math.max(hi, v.y);
      }
      return { ok: ok && hi - lo < 1.96, mid: (lo + hi) / 2 };
    };
    const nearest = (): number => {
      let a = 5;
      let b = 300;
      while (b - a > 0.05) {
        const m = (a + b) / 2;
        if (fits(m).ok) b = m;
        else a = m;
      }
      return b;
    };
    // 画面上下居中：中点偏上就把看的地方往远处挪，偏下往近处挪，挪完重新算距离
    for (let i = 0; i < 4; i++) {
      const dist = nearest();
      look.z -= (fits(dist).mid * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / Math.sin(pitch);
    }
    const dist = nearest();
    this.rest = { pos: look.clone().addScaledVector(dir, dist), look };
    this.meldLimit = null;
    // 雾跟着镜头距离走：竖屏时镜头退得很远，雾还按原来的距离的话整张桌子都被雾盖住
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = dist + 8;
      this.scene.fog.far = dist + 48;
    }
    this.handTilt = -THREE.MathUtils.degToRad(v.tilt);
    if (this.debugCamera) return;
    cam.position.copy(this.rest.pos);
    cam.lookAt(this.rest.look);
  }

  // 2.5D 时自己的手牌（14 张加摸到的那张）占的半宽，镜头保证这么宽都在画面里
  private myHandHalf(): number {
    return 7.5 * (TILE_W + GAP) * this.view25.hand + 0.5;
  }

  // 第一组副露从哪里往左摆（座位本地坐标）。3D 从桌角摆起；2.5D 桌角可能在画面外，
  // 从桌角往里找，摆在画面里能放下的最外侧
  private meldStart(seat: number, me: number): number {
    if (this.style !== '25d') return this.dim.tableHalf - 1.2;
    return this.meldLimits()[(seat - me + 4) % 4];
  }

  // 每家第一组副露最远摆到哪：这组副露（往里约 3.5 宽，前后两条边）都在画面里，又不压着头像框和能力说明。
  // 自己的至少摆在手牌右边，别家的至少摆到牌山末端附近
  private meldLimits(): number[] {
    if (this.meldLimit) return this.meldLimit;
    const d = this.dim;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const box = this.container.getBoundingClientRect();
    const rects = this.keepOut?.() ?? [];
    const pad = 8;
    const cam = this.camera.clone();
    cam.position.copy(this.rest.pos);
    cam.lookAt(this.rest.look);
    cam.updateMatrixWorld();
    const up = new THREE.Vector3(0, 1, 0);
    const clear = (rel: number, x: number, z: number): boolean => {
      const v = new THREE.Vector3(x, 0, z).applyAxisAngle(up, (rel * Math.PI) / 2).project(cam);
      if (Math.abs(v.x) > 0.96 || Math.abs(v.y) > 0.96) return false;
      const px = box.left + ((v.x + 1) / 2) * w;
      const py = box.top + ((1 - v.y) / 2) * h;
      return !rects.some((r) => px > r.left - pad && px < r.right + pad && py > r.top - pad && py < r.bottom + pad);
    };
    const ok = (rel: number, x: number) =>
      [0, 1.75, 3.5].every((dx) => clear(rel, x - dx, d.meldZ - TILE_H / 2) && clear(rel, x - dx, d.meldZ + TILE_H / 2));
    const limits = [0, 1, 2, 3].map((rel) => {
      let a = rel === 0 ? this.myHandHalf() : MELD_MIN_25D;
      let b = d.tableHalf - 1.2;
      if (ok(rel, b)) return b;
      for (let i = 0; i < 24; i++) {
        const m = (a + b) / 2;
        if (ok(rel, m)) a = m;
        else b = m;
      }
      return a;
    });
    // 头像框还没画出来时先不记住，等画出来再算一次
    if (!this.keepOut || rects.length) this.meldLimit = limits;
    return limits;
  }

  // 换 2.5D 的镜头参数（调试用）：重新算镜头，手牌按新的大小和角度重摆
  setView25(v: Partial<View25>): void {
    this.view25 = { ...this.view25, ...v };
    this.resize();
    if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
  }

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
    if (o) return o.userData.tileId as TileId;
    return this.stillOnHovered() ? this.hovered : null;
  }

  // 什么都没指到时：鼠标还落在抬起的那张牌原本的位置上，就继续算指着它
  private stillOnHovered(): boolean {
    const rest = this.hoverRest;
    if (this.hovered === null || rest?.id !== this.hovered || !this.clickable.has(rest.id)) return false;
    const g = this.tiles[rest.id].group;
    const saved = { pos: g.position.clone(), quat: g.quaternion.clone(), scale: g.scale.clone() };
    g.position.copy(rest.at.pos);
    g.quaternion.copy(rest.at.quat);
    g.scale.setScalar(rest.at.scale);
    g.updateMatrixWorld(true);
    const hit = this.raycaster.intersectObject(g, true).length > 0;
    g.position.copy(saved.pos);
    g.quaternion.copy(saved.quat);
    g.scale.copy(saved.scale);
    g.updateMatrixWorld(true);
    return hit;
  }

  // 摸牌：沿弧线从牌山飞到手里
  private animateFlights(dt: number): void {
    this.flights = this.flights.filter((f) => {
      f.t += dt;
      const tile = this.tiles[f.tile];
      const dest = tile.target;
      if (f.fade) {
        if (!dest || f.t >= DRAW_FADE) {
          this.setTileOpacity(tile, 1);
          return false;
        }
        const k = f.t / DRAW_FADE;
        const at = k < 0.5 ? f.start : dest.pos;
        tile.group.position.copy(at);
        if (k >= 0.5) {
          tile.group.quaternion.copy(dest.quat);
          tile.group.scale.setScalar(dest.scale);
        }
        this.setTileOpacity(tile, Math.abs(1 - 2 * k));
        this.held.add(f.tile);
        return true;
      }
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
    const base = this.style === '25d' ? this.rest.pos.clone() : new THREE.Vector3(0, 18, 28.5);
    const look = this.style === '25d' ? this.rest.look.clone() : new THREE.Vector3(0, 0.5, -1.5);
    if (this.zoom.t >= 0) {
      this.zoom.t += dt;
      const k = this.zoom.t < 0.5 ? this.zoom.t / 0.5 : this.zoom.t < 2.2 ? 1 : Math.max(0, 1 - (this.zoom.t - 2.2) / 0.8);
      const e = k * k * (3 - 2 * k);
      base.lerp(this.style === '25d' ? base.clone().lerp(look, 0.16) : new THREE.Vector3(0, 15, 24), e * 0.6);
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
        // 2.5D 的立直棒是掉下来的，越落越快
        const u = (a.t - reach) / carry;
        const k = a.drop ? u * u : smooth(u);
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
      if (a.kind === 'stick' && !a.drop) {
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
      // 自己的手牌是放大的，搬过去的路上缩回牌河里的大小
      if (a.startScale !== undefined) {
        const k = Math.min(1, Math.max(0, (a.t - p.reach) / p.carry));
        tile.group.scale.setScalar(THREE.MathUtils.lerp(a.startScale, tile.target?.scale ?? 1, k));
      }
      this.held.add(a.tile);
    }
    if (av) {
      av.reachTarget = pose.wrist;
      av.reachWeight = pose.weight;
      av.tuning = p;
    }
    return true;
  }

  // 倒牌：每张牌绕着靠桌子中心那条底边往前倒，倒下去越来越快。2.5D 倒牌前先有闪电打在和的那张牌上
  // （荣和是牌河里放铳的那张，自摸是手里摸到的那张）
  private animateReveal(): void {
    const rv = this.reveal;
    if (!rv) return;
    if (rv.boltAt !== null && this.now >= rv.boltAt) {
      rv.boltAt = null;
      for (const w of rv.wins) {
        const at = this.tiles[w.tile].group.position.clone();
        // 从画面上沿（靠中间一点）斜着劈下来：起点和那张牌一样远，牌在画面上方时闪电也不会大半截出了画面
        const p = at.clone().project(this.camera);
        const top = new THREE.Vector3(p.x * 0.3, 1.08, p.z).unproject(this.camera);
        this.effects.bolt(top, at, FX_GOLD, this.camera.position);
      }
      this.shake = 0.5;
    }
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
      this.hoverSnap = { ids: [this.hovered, hover].filter((x): x is TileId => x !== null), until: this.now + 0.12 };
      this.hovered = hover;
      this.renderer.domElement.style.cursor = hover !== null ? 'pointer' : 'default';
      if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
      this.onHover?.(hover);
    }
    // 发牌期间每帧重新摆一次，让牌按时间从牌山飞到手里；打出的牌落下后理牌
    if (this.heldDraw && this.now >= this.heldDraw.at) this.releaseDraw();
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
    const slow = 1 - Math.exp(-dt * 16);
    const fast = 1 - Math.exp(-dt * 60);
    const snap = this.now < this.hoverSnap.until ? this.hoverSnap.ids : [];
    for (const [id, t] of this.tiles.entries()) {
      if (!t.target || this.held.has(id)) continue;
      const k = snap.includes(id) ? fast : slow;
      t.group.position.lerp(t.target.pos, k);
      t.group.quaternion.slerp(t.target.quat, k);
      const sc = t.group.scale.x + (t.target.scale - t.group.scale.x) * k;
      t.group.scale.setScalar(sc);
    }
    this.updateMarks();
    for (const c of this.characters) c.avatar?.update(dt);
    this.updateLoading();
  }

  private updateLoading(): void {
    if (this.characters.length === 0 || this.charactersReady() || this.modelFailed) {
      this.loadingEl?.remove();
      this.loadingEl = null;
      return;
    }
    if (!this.loadingEl) {
      this.loadingEl = document.createElement('div');
      this.loadingEl.className = 'model-loading';
      this.container.appendChild(this.loadingEl);
    }
    const text = `角色加载中 ${Math.floor(modelProgress(this.modelUrls) * 100)}%`;
    if (this.loadingEl.textContent !== text) this.loadingEl.textContent = text;
  }

  // 标记的牌上方各放一个朝下的小三角，跟着牌走（鼠标移上去牌抬起来，三角也跟着抬），总是正对镜头
  private updateMarks(): void {
    const ids = [...(this.lastSync?.view.marked ?? [])].filter((id) => this.tiles[id].group.visible);
    while (this.marks.length < ids.length) {
      // 用到时才建（建材质会用掉随机数，提前建会让桌布的花纹和以前不一样）
      const m = this.marks[0]?.clone() ?? new THREE.Mesh(markGeometry(), new THREE.MeshBasicMaterial({ color: '#f0c35a', depthTest: false, toneMapped: false }));
      m.renderOrder = 10;
      this.scene.add(m);
      this.marks.push(m);
    }
    this.marks.forEach((m, i) => {
      const id = ids.at(i);
      m.visible = id !== undefined;
      if (id === undefined) return;
      const g = this.tiles[id].group;
      m.position.copy(g.position);
      m.position.y += (TILE_H / 2) * g.scale.x + 0.3;
      m.quaternion.copy(this.camera.quaternion);
    });
  }

}

// 朝下的小三角，尖在原点
function markGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.27, 0.36);
  shape.lineTo(-0.27, 0.36);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

// 仪表盘上画的千点棒：白色，中间一个红点
function drawStick(c: CanvasRenderingContext2D, cx: number, cy: number, len: number, th: number): void {
  c.fillStyle = '#f7f3ea';
  c.beginPath();
  c.roundRect(cx - len / 2, cy - th / 2, len, th, th / 2);
  c.fill();
  c.fillStyle = '#c4212c';
  c.beginPath();
  c.arc(cx, cy, th * 0.38, 0, Math.PI * 2);
  c.fill();
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

function feltTexture(colors: TableColors): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(512, 512, 60, 512, 512, 720);
  grad.addColorStop(0, colors.felt[0]);
  grad.addColorStop(0.6, colors.felt[1]);
  grad.addColorStop(1, colors.felt[2]);
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
  ctx.strokeStyle = colors.feltLine;
  ctx.lineWidth = 3;
  ctx.strokeRect(150, 150, 724, 724);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
