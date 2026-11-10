import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Game, GameEvent } from '../engine/game';
import { TILE_COUNT, TileId, WIND_CN, kindOf } from '../engine/tiles';
import { meldLayout } from '../ui/meldLayout';
import { FACE_TOTAL, FaceAtlas, faceIndex } from './faces';
import { sketchFaceSvg } from '../ui/sketchArt';
import { Avatar, modelProgress } from './avatar';
import { LOOKS, RestPose, applyLook } from './looks';
import { Dice } from './dice';
import { BOLT_LEADER, Effects } from './effects';
import { type SpotRow, WinSpots } from './winSpots';
import { STACKS as MIST_STACKS, WallMist } from './mist';
import { Gale } from './gale';
import { SEA, Water, wet, wetLike } from './water';
import { ChainFx, ChainFrame } from './chains';
import { riiLook } from '../ui/riiLook';
import { ChainEnd, outcomeTime } from '../ui/riiChainPlan';
import { faceSvg, glowGlyph } from '../ui/tileArt';
import { TileBeam } from './tileBeam';
import { WallSlot, dealIndex, drawSlot, wallSlots } from './wallLayout';
import { BASE_AVATAR_SCALE, CONSOLE_HALF, DEFAULT_LAYOUT, POND_COLS, TILE_H, TILE_T, TILE_W, TableDims, TableLayout, WALL_Z, clampLayout, tableDims } from './tableLayout';
import { TableMaterials, buildTableModel } from './tableModel';
import { DEFAULT_DISCARD, DiscardParams, DiscardPath, DiscardPose, MarkerName, RIICHI_DISCARD, SLIDE_DISCARD, SLIDE_RIICHI, dueMarkers, sampleDiscard, totalTime } from './discardMotion';
import { TableColors, tableColors } from '../ui/theme';
import { pondJitter, varyDiscard, vary } from '../ui/vary';
import { HIMEKO_FX, DescentTile, HimekoFx } from './himekoFx';
import { himekoKeySeat } from '../abilities/himeko';
import { BeatHit, beatFinal, beatHit, beatLength, beatSeed } from '../ui/himekoBeat';
import { SlamRun, SlamSpec, SlamStyle, TileSlam, slamHitOffset } from './tileSlam';
import { SlamFx } from './slamFx';
import { LilyFx, lilyGrand } from './lilyFx';

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
  // 下面几个只有改良布局用：lean 手牌比镜头俯角少仰多少度（0 是牌面和画面平行，大一点露出牌顶）；
  // face 每张牌转过来正对镜头的程度（0 不转、1 张张正对）；clip 手牌下沿出画面多少（牌高的几分之几）；
  // out 手牌往外（往镜头这边）挪多少；ortho 自己的手牌用没有透视的镜头单独画一层（雀魂那样，张张一模一样）
  lean?: number;
  face?: number;
  clip?: number;
  out?: number;
  ortho?: boolean;
}
export const DEFAULT_VIEW_25D: View25 = { pitch: 0.72, portraitPitch: 1.2, fov: 34, lookZ: 1.5, hand: 1.15, tilt: 15, fan: 0 };
// 改良布局（试做，参考雀魂）：镜头更俯视、视野窄一点，桌子不那么往后倒；自己的手牌大一点。
// 手牌往后仰的角度跟着镜头俯角（tilt 不用，看 lean）：lean 0 时每张牌面都和画面平行，
// 再每张转过来正对镜头（face），像雀魂那样张张正对着人，两头的牌不会因为透视往里歪、一排牌像一道弧
export const DEFAULT_VIEW_25D_V2: View25 = { pitch: 0.84, portraitPitch: 1.2, fov: 28, lookZ: 1.5, hand: 1.4, tilt: 48, fan: 0, lean: 8, face: 0, clip: 0.12, out: 0.9, ortho: true };
// 改良布局：自己手牌的几种画法（试做，给玩家挑）：网址后面加 ?hand=B 之类就换成那一种。
// A 每张转过来正对镜头；B 雀魂那样单独一层、没有透视；C 同 B 牌顶露得多；D 同 B 小一号、整张露出来；
// E 不转、牌面和画面平行；F 往后仰一点的真 3D
export const HAND_STYLES_V2: Record<string, Partial<View25>> = {
  A: { hand: 1.4, lean: 0, face: 1, clip: 0.12, out: 0.9, ortho: false },
  B: { hand: 1.4, lean: 8, face: 0, clip: 0.12, out: 0.9, ortho: true },
  C: { hand: 1.4, lean: 20, face: 0, clip: 0.12, out: 0.9, ortho: true },
  D: { hand: 1.2, lean: 10, face: 0, clip: -0.08, out: 0.6, ortho: true },
  E: { hand: 1.4, lean: 0, face: 0, clip: 0.12, out: 0.9, ortho: false },
  F: { hand: 1.3, lean: 14, face: 0, clip: 0.05, out: 0.9, ortho: false },
};
// 改良布局：自己的手牌往外（往镜头这边）挪多少，仰得多了牌顶不会碰到自己面前的牌山
const V2_HAND_OUT = 0.9;
// 改良布局：自己的手牌下沿可以出画面多少（牌高的几分之几），像雀魂那样手牌贴着画面底边
const V2_HAND_CLIP = 0.12;
// 改良布局：白水哩番缚时手牌扣下去，扣着的牌中心比原来的牌脚往里挪多少（半张牌高的几倍）；
// 投影比平常多往上浮多少（牌高的几倍），浮在扣着的那一排上面、不和它叠在一起
const V2_COVER_IN = 0.6;
const V2_GHOST_UP = 0.45;
const WALL_PITCH = TILE_W + 0.02;
// 2.5D 时别家的第一组副露至少能摆到这里（座位本地 x，牌山末端附近），镜头取景按这个算
const MELD_MIN_25D = 8 * (TILE_W + GAP) + 0.5;
// 2.5D 时上家、下家的手牌比别的座位多往外推多少（牌宽）
const SIDE_HAND_PUSH_25D = 0.7;
// 2.5D 时对家的手牌在牌山后面，镜头斜着看过去会被牌山挡住：对家那一边的牌山往中间收一点、手牌往后挪一点，
// 整排手牌就露出来了。牌山收进去以后右上角的缝变窄，右边（下家）的牌山整排往下挪一点，上下两个转角的缝一样宽
const TOP_WALL_IN_25D = 0.8;
const TOP_HAND_PUSH_25D = 0.8;
// 中央控制台的高度。2.5D 镜头从自己这边斜着看过去，控制台太高会把对家的立直棒挡住一半，所以 2.5D 矮一点
const CONSOLE_H = 0.5;
const CONSOLE_H_25D = 0.3;
// 2.5D 对家的立直棒再往牌河那边挪一点，离控制台远些（离牌河第一行还留着空）
const TOP_STICK_OUT_25D = 0.07;
const RIGHT_WALL_DOWN_25D = 0.2;
// 改良布局：牌河第三排别贴着牌山。上家、下家的牌山（连同手牌）往桌边挪 V2_SIDE_OUT；
// 对家的牌山只往中间收 V2_TOP_WALL_IN（原版收 0.8，第三排会压到牌山），手牌往后推 V2_TOP_HAND_PUSH，从牌山后面露出来
const V2_SIDE_OUT = 1.0;
const V2_TOP_WALL_IN = -0.6;
const V2_TOP_HAND_PUSH = 1.7;

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
// 改良布局：自己和牌（流局听牌）时照雀魂：宣言后 V2_STAND 秒，眼前那排大手牌换成桌上立着的一排（桌上牌的大小、手牌那条线），
// 自摸的那张悬在右边上方，过 V2_PLACE 秒落到隔开一点的地方立好，再停 V2_HOLD 秒，整排和别家一样往前倒。
// 荣和：点到的那张不进手牌，一直留在放铳的人的牌河里（闪电打在那张上），手牌立起来、停一下就倒
const V2_STAND = 0.75;
const V2_STAND_DRAW = 0.2;
const V2_PLACE = 0.3;
const V2_HOLD = 0.6;
// 倒牌前立着的那一排，牌底边离画面底边留多少（画面高度的几分之几）
const V2_STAND_MARGIN = 0.03;
const TOPPLE_STAGGER = 0.07;
// 平时的环境光、主光有多亮；和牌聚光灯亮起来时四周按 STAGE_DIM 暗下去一点，聚光灯本身最亮 STAGE_LIGHT
const HEMI_BASE = 1.1;
const KEY_BASE = 2.2;
const STAGE_DIM = 0.45;
const STAGE_LIGHT = 1000;
// 2.5D 照雀魂的节奏：“荣和/自摸”的切入放完，1.2 秒闪电打在和的那张牌上，1.4 秒倒牌，倒得也快一些。
// 闪电的先导要先摸下来一会儿，所以早 BOLT_LEADER 秒开始劈
const REVEAL_DELAY_25D = 1.4;
const BOLT_LEAD = 0.2 + BOLT_LEADER;
const TOPPLE_STAGGER_25D = 0.03;
// 初美鸣出来的东、北中间那张牌面上的紫色墨
const KIMON_INK = '#8a3cf2';
// 初美聚着风和牌：手牌倒完，和了牌举起来、停一下、往桌上砸（秒）。砸到桌面那一下从这张牌炸开
const SLAM_LIFT = 0.34;
const SLAM_HANG = 0.14;
const SLAM_DROP = 0.09;
const SLAM_TIME = SLAM_LIFT + SLAM_HANG + SLAM_DROP;
const SLAM_HOP = 0.32; // 砸下去以后桌上的牌跟着震一下
// 改良布局的自摸砸牌（照雀魂的节奏，tileSlam.ts）：手牌在桌上立起来的同时，一只手捏着自摸的那张从镜头跟前伸上来、举高，
// 往前扫下去扣在手牌右边隔开一点的地方，牌自己翻起来立住、亮一下光再炸开（别人自摸是伸过去拿起那张，扣回原处再翻起来）。
// 炸开以后停 V2_SLAM_HOLD 秒才倒牌（咲的岭上开花停 V2_LILY_HOLD 秒，让百合开完）
const V2_SLAM_HOLD = 0.75;
const V2_LILY_HOLD = 1.05;
// 天江衣的海底捞月砸下去：等水花落下、海水退干净再倒牌
const V2_SEA_HOLD = 0.95;
// 水面：透华的静水贴着桌布；衣的海最高涨到牌山顶上再高一点（牌山两层 = 2 个牌厚）
const STILL_LEVEL = 0.03;
const SEA_TOP = TILE_T * 2 + 0.07;
const SEA_RISE = 0.35; // 涨潮每秒最多涨多少
// 衣的海底捞月：月亮的倒影一亮、水面一圈圈收进去（WAIT），牌从海底直直浮上来破水而出（RISE），
// 停在半空、身上的水往下淌（HOLD），再飞进她手里（FLY）。秒
const SCOOP_WAIT = 0.35;
const SCOOP_RISE = 0.7;
const SCOOP_HOLD = 0.45;
const SCOOP_FLY = 0.3;
const SCOOP_TIME = SCOOP_WAIT + SCOOP_RISE + SCOOP_HOLD + SCOOP_FLY;
const MOON_GLOW = '#cfe4ff';
// 月亮的倒影离海底牌往桌子中间挪多少
const MOON_IN = 1.9;
// 海水涨满时四周暗下来多少（夜里的海，月亮更亮）
const SEA_NIGHT = 0.3;

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
// 改良布局：摸的牌飞到这一段（占整段的比例）就转好身、放大好，落进手里时已经是手牌的样子，不在手里原地转
const DRAW_TURN_V2 = 0.7;
// 摸牌路径关掉时：先在牌山上淡出（DRAW_FADE_OUT 秒），再在手里淡入（DRAW_FADE_IN 秒）
const DRAW_FADE_OUT = 0.12;
const DRAW_FADE_IN = 0.18;
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
// 改良布局：手牌已经放大、正对着人，摸到的牌在原位往上浮一点就够了，不另外放大、不往旁边飘
const AIR_POSE_V2: AirPose = { dx: 0, lift: 0.7, inward: 0, tilt: 0, yaw: 0, roll: 0, scale: 1 };

// 鸣牌、立直、和牌的特效颜色
const FX_GOLD = '#ffd36b';
// 初美的风聚起来时四周压成的颜色：带一点紫的夜空
const GALE_VOID = new THREE.Color('#07040e');
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
  extra: number; // 理牌往后推多久（姬子拿钥匙那一局，等她的光柱落完再理牌）
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
  // 改良布局的自己：什么时候在桌上立起来、自摸那张什么时候落好（不涉及自己时是 null）
  standAt: number | null;
  placeAt: number | null;
  snapped: boolean;
  // 到这些时刻重摆一次牌（立起来、落好、开始倒）
  syncs: number[];
  // 要砸的和了牌：不跟着手牌倒，at 时举起来往下砸（自摸是手里那张，荣和是从牌河拿过来）
  slams: Map<TileId, { seat: number; at: number; from: Placement | null; hit: boolean }>;
  // 砸下去那一下：桌上的牌从这里往外震一下
  hops: { at: number; x: THREE.Vector3 }[];
  spotsOn: boolean; // 聚光灯打开了没有
  // 改良布局的自摸砸牌：start 时手伸进来，hitAt 拍到桌上；lily 是咲的岭上开花（这一手的基本点），没有是 null
  // sea：天江衣从海里捞上来的海底牌，砸下去把海水打散。style：这个人砸牌用哪一套动作（looks.ts），
  // hisa（竹井久）从手里那张拿起来，最后牌面朝上躺在倒牌后和了牌的位置，砸下去以后就一直躺在那里；她翻过来亮牌那一下（revealAt）手牌一起倒
  tsumoSlam: { seat: number; tile: TileId; start: number; hitAt: number; revealAt?: number; started: boolean; lily: number | null; sea: boolean; style: SlamStyle } | null;
}

interface Flight {
  tile: TileId;
  t: number;
  start: THREE.Vector3;
  quat: THREE.Quaternion; // 起飞时的朝向、大小：转身、放大照飞行进度走，落下时正好到位
  scale: number;
  // 不飞：在牌山上渐渐消失，再在手里渐渐出现（摸牌路径关掉时）
  fade: boolean;
}

// 衣的海底捞月：从海里捞上来的那张牌
interface Scoop {
  tile: TileId;
  seat: number;
  t: number;
  from: Placement;
  broke: boolean; // 破水而出了没有
  drip: number; // 下一滴水什么时候滴
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
// 理牌时、白水哩番缚时手牌往前倒扣的样子
const COVER_TILT = new THREE.Euler(Math.PI / 2, 0, 0);
// 公开手牌：立着往后仰（再整个转半圈，牌面朝桌子中间）
const OPEN_HAND = new THREE.Euler(0.5, 0, 0);

interface Placement {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

// 桃子隐身淡掉时透明度分几档
const FADE_STEPS = 20;
// 桃子隐身：那张牌落桌以后停多久（秒），再花多久让牌河和手牌在原地淡掉（影子一起淡）
const VANISH_DELAY = 0.15;
// 淡掉的时候牌往这个颜色靠（苍白、带一点冷色）
const GHOST = new THREE.Color('#e6edf5');
const VANISH_TIME = 1;
// 宫永咲的王牌感知：牌山前面投影出来的牌比真牌小一点，平贴在桌面上（像投在桌布上的影子）
const PROJ_SCALE = 0.8;
const PROJ_Y = 0.012;

interface TileObj {
  group: THREE.Group;
  body: THREE.Mesh;
  back: THREE.Mesh;
  face: THREE.Mesh;
  shown: boolean;
  target: Placement | null;
}

export interface SyncView {
  me: number;
  clickable: Set<TileId>;
  colors: string[];
  ids: string[];
  marked?: Set<TileId>; // 上方加个小三角的手牌（打出去能听牌的）
  airDraw?: TileId | null; // 自己立直后摸到、和不了的那张：不进手牌，停在手牌上方的空中，接着直接打进牌河（摸牌路径关掉时没有）
  tintBacks?: Set<TileId>; // 美穗子睁眼：这些牌的牌背按花色上色（万红、筒蓝、索绿、字牌白）
  deadly?: Set<TileId>; // 龙华的无极天：自己手里打出去会放铳的牌，牌身染红
  ripple?: TileId | null; // 白望的迷途之家：应该打的那张牌，底下一圈圈白色水波纹
  akaBacks?: Set<TileId>; // 丰音的赤口：没公开的赤宝牌（别人手里、牌山里），牌背发金红光
  waveBacks?: Set<TileId>; // 淡的引力波：牌山里她的和了牌，牌背发紫光
  kanSeen?: Set<TileId>; // 宫永咲的王牌感知：牌山里她杠材的第四张，一直是透明的，牌山前面投影出牌面
  rinshanSeen?: Set<TileId>; // 鼠标移到岭上牌上时，岭上牌也这样
  gravity?: boolean; // 淡的巨引力源：黑色的引力圆罩住整个牌山
  handOrder?: TileId[]; // 自己手牌（不含刚摸的那张）从左到右的摆法；不给就照顺序排
  openHands?: boolean; // 公开手牌：别人的手牌摊开亮着
  drawPath?: 'on' | 'off' | 'self'; // 摸牌路径：on 都沿弧线飞，off 都是淡出淡入，self 只有自己飞
  slamHand?: boolean; // 改良布局的自摸砸牌带不带手（false：牌自己跳起来扣下去），不给就带手
  mist?: number; // 高鸭稳乃的深山：牌山上的雾有几级（0 没有）
  sketch?: boolean; // 爱丽丝的手绘板：牌、桌布换成手绘风格
  gale?: { seat: number; level: number } | null; // 薄墨初美的里鬼门：紫色的风聚得多浓（0–1），和牌时那张牌上紫光往上冲
  glowTiles?: Set<TileId>; // 初美鸣出来的东、北中间那张：字发紫光，牌上一道淡淡的紫色光柱
  stillWater?: boolean; // 透华的治水：桌布上铺一层平静的水面，打进牌河的牌荡开涟漪
  // 天江衣的海底：level 海水涨到哪（0 刚开始、1 淹没整个牌山），on 海底现在归她（被错开时潮水退下去），
  // moon 月相（MOON_PHASES 的下标），haitei 海底牌（月亮映在它上方的水面上）
  sea?: { seat: number; level: number; on: boolean; moon: number; haitei: TileId | null } | null;
  riiCover?: boolean; // 白水哩番缚选番数时：自己的手牌扣在桌上，原来的位置投影出牌面
  riiBind?: number | null; // 白水哩这一局缚了几番（只有她自己看得到）：几条锁链压住自己的手牌
}

export class Table3D {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  // 改良布局（ortho）：自己的手牌用这个没有透视的镜头单独画一层，朝向、位置跟着主镜头，
  // 大小按手牌那一排离镜头的距离定，手牌在画面上的位置和用主镜头画的一样，只是每张牌没有透视
  private orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private orthoDepth = 1; // 手牌那一排离镜头多远（沿视线）
  private atlas = new FaceAtlas();
  private tiles: TileObj[] = [];
  private backMat: THREE.Material | null = null;
  private tintMats: THREE.Material[] = [];
  private akaMat: THREE.Material | null = null;
  private waveMat: THREE.Material | null = null;
  // 宫永咲的王牌感知：鼠标在不在牌山上、牌山上有哪些牌、透出来的牌面材质
  private rinshanHover = false;
  private wallSlotOf = new Map<TileId, WallSlot>();
  private projections = new Map<TileId, THREE.Group>();
  private projFaceMat: THREE.MeshBasicMaterial | null = null;
  private projBackMat: THREE.MeshBasicMaterial | null = null;
  // 淡的巨引力源：桌面上的黑色引力圆（用到时才建）
  private gravityDisc: THREE.Mesh | null = null;
  private bodyMat: THREE.Material | null = null;
  private deadlyMat: THREE.Material | null = null;
  private faceGeoms: THREE.PlaneGeometry[] = [];
  private faceMat: THREE.MeshStandardMaterial | null = null;
  private fadeMats = new Map<THREE.Material, THREE.Material[]>();
  // 桃子：这一局已经隐身的座位；正在淡掉的座位（开始淡的时刻）
  private gone = new Set<number>();
  private vanish = new Map<number, { at: number }>();
  private shadowFades: THREE.MeshDepthMaterial[] = [];
  // 爱丽丝的手绘板：手绘的牌面、白色牌身、铅笔排线的牌背、白纸桌布、每张牌描一圈黑边（用到时才建）
  private sketch: {
    on: boolean;
    atlas: FaceAtlas;
    body: THREE.Material;
    back: THREE.Material;
    paper: THREE.Texture;
    edges: THREE.LineSegments[];
    normal: { body: THREE.Material; back: THREE.Material; felt: THREE.Texture | null; frame: THREE.Color; trim: THREE.Color; room: THREE.Color };
  } | null = null;
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
  private dice: Dice;
  private deal: DealState | null = null;
  // 鹤田姬子拿到钥匙的那一局：配牌时她的牌裹着火像流星一样一张接一张砸下来，理完牌火从右烧到左（himekoFx.ts）
  private himeko = new HimekoFx();
  // land：她每张牌什么时候被光柱砸进手里；pending：还没砸到的；open：大光柱开始落下的时刻
  private himekoDeal: { seat: number; land: Map<TileId, BeatHit>; pending: Set<TileId>; axes: Map<TileId, THREE.Vector3>; open: number; aimed: boolean; final: number; shook: boolean; fireAt: number; fired: boolean } | null = null;
  // 烧着往下砸的牌换上的材质（烧得发橙、自己发光）；用到时才建，换皮肤后下一次重建
  private burnMats: { body: THREE.MeshStandardMaterial; back: THREE.MeshStandardMaterial; face: THREE.MeshStandardMaterial } | null = null;
  private handAnims: HandAnim[] = [];
  // 这一局牌河摆放的随机微变化用哪一套（vary.ts 的 pondJitter）
  private pondSalt = 0;
  private flights: Flight[] = [];
  // 别人打出的牌还在半空时摸到的牌：先留在牌山原处，落桌后再飞进手里
  private heldDraw: { seat: number; tile: TileId; at: number; from: Placement } | null = null;
  private effects: Effects;
  // 自摸砸牌的手（tileSlam.ts）和光效（slamFx.ts）、咲的岭上开花的百合（lilyFx.ts）
  private slam = new TileSlam();
  private slamFx = new SlamFx();
  private lily = new LilyFx();
  // 砸牌、百合放到什么时候：这之前先别弹结算
  private fxHold = 0;
  private mist = new WallMist();
  private mistFor = -1; // 雾按哪个座位的视角摆的
  private mistTops: THREE.Vector3[][] = []; // 每一墩牌山顶上的位置
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
  // 砸牌（放音效用）：phase 'press' 是牌扣到桌上，'hit' 是牌立起来炸开；lily：咲的岭上开花这一手的基本点（不是就是 null）
  onSlam: ((seat: number, lily: number | null, phase: 'press' | 'hit') => void) | null = null;
  // 天江衣的海底牌砸进海里炸开的那一下（放水声用；扣进水里那一下照常是 onSlam 的 'press'）
  onSeaSlam: ((seat: number) => void) | null = null;
  // 每帧画之前调用（动画已经推进到这一帧），调试场景在这里更新辅助线和读数
  beforeRender: (() => void) | null = null;
  // 鼠标移到能打的牌上、或者移开（null）时通知外面，用来显示打这张以后听什么
  onHover: ((id: TileId | null) => void) | null = null;
  // 标记用的小三角，按需要的个数建，多出来的藏起来
  private marks: THREE.Mesh[] = [];
  // 迷途之家的水波纹：几圈白环贴着桌面往外扩（用到时才建）
  private ripples: THREE.Mesh[] = [];
  // 初美的里鬼门：绕着牌桌打转的紫色的风（用到时才建）
  private gale: Gale | null = null;
  private roomBase = new THREE.Color(); // 房间本来的颜色（手绘板会换）
  private roomDark = 0; // 初美的风让四周暗下来多少
  // 透华的治水、衣的海底：桌上的水（water.ts，用到时才建，换桌子尺寸时重建）
  private water: Water | null = null;
  // 衣的海底捞月：正从海里捞上来的牌；要砸的那张（自摸时砸下去）；砸下去以后这一局海水散掉
  private scoop: Scoop | null = null;
  private seaSlamTile: TileId | null = null;
  private seaDrained = false;
  // 捞上来的牌身上一层月光（用到时才建）
  private moonMats: { body: THREE.MeshStandardMaterial; back: THREE.MeshStandardMaterial } | null = null;
  // 白水哩的番缚：每个座位的锁链；选番数时手牌原来位置上的投影牌面
  private chains: (ChainFx | null)[] = [null, null, null, null];
  private ghosts = new Map<TileId, THREE.Group>();
  private ghostMats: { back: THREE.MeshBasicMaterial; face: THREE.MeshBasicMaterial } | null = null;
  // 投影什么时候开始浮起来（牌扣下去的同时）
  private ghostSince = -1;
  private ghostAt = new Map<TileId, Placement>();
  // 初美鸣出来的东、北中间那张牌上的紫光（牌 id → 贴在牌面上的发光字和光柱）
  private glows = new Map<TileId, THREE.Group>();
  private kimonFaceMat: THREE.MeshStandardMaterial | null = null;
  private overlayGroup: THREE.Group | null = null;
  private zoom = { t: -1, target: new THREE.Vector3() };
  private held = new Set<TileId>();
  private reveal: RevealState | null = null;
  // 每家手牌上一次的摆法；打牌时先按这个摆，牌落进牌河后再理牌
  private layouts: { hand: TileId[]; drawn: TileId | null }[] = [];
  // 每家手牌这一排上一次摆在哪：第一张的中心、每张隔多远、放大多少、离中心多远。倒牌时照着摆，牌原地倒下
  private handRows: { x0: number; step: number; hs: number; z: number }[] = [];
  // 每家手牌右边最远到哪（座位本地 x，有副露时是第一组副露左边一点）：改良布局里自己倒牌时照这个摆
  private handEdges: number[] = [];
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
  private hemi: THREE.HemisphereLight | null = null;
  // 和牌时照在和了那副牌上的舞台聚光灯：一直在场景里（中途加灯会让所有材质重新编译），平时是 0
  private stageLight: THREE.SpotLight | null = null;
  private spots: WinSpots | null = null;
  // 桌布、牌背、桌框的颜色跟着界面皮肤走，建牌桌时定下来
  private colors: TableColors = tableColors();

  constructor(
    private container: HTMLElement,
    private onTileClick: (id: TileId) => void,
    readonly style: TableStyle = '3d',
    // 2.5D 的改良布局（试做）：只在 style 是 25d 时有用
    readonly improved = false,
  ) {
    if (this.v2) this.view25 = { ...DEFAULT_VIEW_25D_V2 };
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

    this.dice = new Dice(this.consoleH);
    this.buildRoom();
    this.buildTiles();
    this.scene.add(this.dice.group);
    this.effects = new Effects(this.scene);
    this.scene.add(this.slam.group, this.slamFx.group, this.lily.group);
    this.scene.add(this.himeko.group);
    this.scene.add(this.mist.group);
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
    // 手机没有悬停：点一下牌山也算移上去
    el.addEventListener('pointerdown', this.onPointerMove);
    el.addEventListener('pointerleave', () => this.pointer.set(-9, -9));
    el.addEventListener('click', this.onClick);
    this.loop();
    // 调试用：?debug 时可以在控制台里拿到牌桌对象
    if (location.search.includes('debug')) (window as unknown as { table3d: Table3D }).table3d = this;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizer.disconnect();
    this.water?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.loadingEl?.remove();
  }

  // ---------- 场景 ----------

  private buildRoom(): void {
    this.roomBase.set(this.colors.room);
    this.scene.background = new THREE.Color(this.colors.room);
    this.scene.fog = new THREE.Fog(this.colors.room, 40, 80);

    this.hemi = new THREE.HemisphereLight('#dfefff', '#1b2a2c', HEMI_BASE);
    this.scene.add(this.hemi);
    this.stageLight = new THREE.SpotLight('#fff1d8', 0, 0, 0.5, 0.55, 2);
    this.scene.add(this.stageLight, this.stageLight.target);
    const key = new THREE.DirectionalLight('#fff4e0', KEY_BASE);
    key.position.set(-6, 22, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    this.scene.add(key);

    // 桌子：黑色亮面，桌框只比桌布高一点，内侧一圈金属包边；尺寸变了会整个重建（buildTable）
    const frameMat = wet(new THREE.MeshStandardMaterial({ color: this.colors.frame, roughness: 0.32, metalness: 0.25 }));
    const trimMat = wet(new THREE.MeshStandardMaterial({ color: this.colors.trim, roughness: 0.3, metalness: 0.8 }));
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
    this.feltMat = wet(new THREE.MeshStandardMaterial({ map: feltTexture(this.colors, this.v2 ? this.dim.tableHalf : 0), roughness: 0.95 }));
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
      wet(new THREE.MeshStandardMaterial({ color: '#0c0d0f', roughness: 0.25, metalness: 0.3 })),
      // 顶面的点数、局数是自己发光的屏幕，淹在水里也照样看得清（不泡水）
      new THREE.MeshStandardMaterial({ map: this.consoleTex, roughness: 0.2, emissive: '#ffffff', emissiveMap: this.consoleTex, emissiveIntensity: 0.35 }),
    ];
    const h = this.consoleH;
    const box = new THREE.Mesh(new RoundedBoxGeometry(CONSOLE_HALF * 2, h, CONSOLE_HALF * 2, 4, Math.min(0.25, h / 2)), consoleMats[0]);
    box.position.y = h / 2;
    box.receiveShadow = true;
    box.castShadow = true;
    this.scene.add(box);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(CONSOLE_HALF * 2 - 0.3, CONSOLE_HALF * 2 - 0.3), consoleMats[1]);
    top.rotation.x = -Math.PI / 2;
    top.position.y = h + 0.005;
    this.scene.add(top);
  }

  // 桌布、桌框、机身、地面，按现在的尺寸建；换尺寸时把旧的扔掉重建
  private buildTable(): void {
    if (this.tableGroup) {
      this.scene.remove(this.tableGroup);
      this.tableGroup.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const d = this.dim;
    // 桌子尺寸变了：水面按新尺寸重建（下一次 sync 再建）
    if (this.water) {
      this.scene.remove(this.water.group);
      this.water.dispose();
      this.water = null;
    }
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
    const bodyMat = wet(new THREE.MeshStandardMaterial({ color: '#f6f1e3', roughness: matte || 0.35 }));
    this.bodyMat = bodyMat;
    this.deadlyMat = wet(new THREE.MeshStandardMaterial({ color: '#f08a80', emissive: '#d23a2e', emissiveIntensity: 0.35, roughness: matte || 0.35 }));
    const backMat = wet(new THREE.MeshStandardMaterial({ color: this.colors.back, roughness: matte || 0.4 }));
    this.backMat = backMat;
    // 美穗子睁眼时的牌背：万红、筒蓝、索绿、字牌白，微微发光，隔着桌子也看得清
    this.tintMats = ['#e0453a', '#3a6df0', '#2fb25a', '#f4f4f0'].map(
      (c) => wet(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: matte || 0.4 })),
    );
    this.akaMat = wet(new THREE.MeshStandardMaterial({ color: '#ff5a2e', emissive: '#ff7a1e', emissiveIntensity: 0.7, roughness: matte || 0.4 }));
    this.waveMat = wet(new THREE.MeshStandardMaterial({ color: '#9b6bff', emissive: '#7c4dff', emissiveIntensity: 0.85, roughness: matte || 0.4 }));
    const faceMat = wet(new THREE.MeshStandardMaterial({ map: this.atlas.texture, transparent: true, roughness: matte || 0.35 }));
    this.faceMat = faceMat;
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
      this.tiles.push({ group, body, back, face, shown: false, target: null });
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
    this.vanish.clear();
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
    if (this.deal) until = Math.max(until, this.deal.start + this.deal.extra + DEAL_END);
    if (this.himekoDeal) until = Math.max(until, this.himekoDeal.fireAt, this.himeko.endsAt);
    // 别人打出的牌落到牌河之前先别响应
    for (const a of this.handAnims) if (a.kind === 'tile') until = Math.max(until, this.now - a.t + a.timing.reach + a.timing.carry);
    // 摸到的牌还没从牌山出发
    if (this.heldDraw) until = Math.max(until, this.heldDraw.at);
    // 衣的海底捞月：牌还没捞上来、飞进手里
    if (this.scoop) until = Math.max(until, this.now + SCOOP_TIME - this.scoop.t);
    if (this.reveal) until = Math.max(until, this.reveal.fxAt);
    until = Math.max(until, this.fxHold);
    // 白水哩的锁链在变金、崩断
    for (const c of this.chains) if (c && !c.locking) until = Math.max(until, this.now + c.remaining());
    for (const t of this.timers) until = Math.max(until, t.at + t.dur);
    return Math.max(0, (until - this.now) * 1000);
  }

  // 上一局的倒牌、哩的锁链、隐身淡掉的牌收掉：新的一局开始时，以及发牌前选技能时（这时桌上的牌已经收走，下一次 sync 全部藏起来）
  clearRound(): void {
    this.reveal = null;
    this.slam.clear();
    this.slamFx.clear();
    this.lily.clear();
    this.fxHold = 0;
    this.clearChains();
    this.gone.clear();
    this.vanish.clear();
  }

  // 牌局事件驱动骰子、发牌，以及角色的视线、表情和动作
  onEvent(e: GameEvent, g: Game): void {
    const all = this.characters;
    // 等着落桌的那张摸牌，有人出牌、鸣牌或者一局结束就不再等（能力消息不算）
    if (e.type !== 'ability') this.releaseDraw();
    if (e.type === 'roundStart') {
      this.startDeal(g);
      this.clearRound();
      this.scoop = null;
      this.seaSlamTile = null;
      this.seaDrained = false;
      // 牌河里每张牌歪多少换一套：同一张牌这一局一直歪成一样，下一局换个样子
      this.pondSalt = Math.floor(vary.next() * 2 ** 31);
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
      // 隐身的桃子打的牌：看不见，手里那张直接消失，没有动画、没有立直特效。
      // 刚隐身的那一张照常打出去（不放立直特效），落桌停半拍，整条牌河和手牌慢慢淡掉
      const vanishing = g.stealthed(e.seat, this.lastSync?.view.me ?? 0);
      if (vanishing && this.gone.has(e.seat)) return;
      const pond = this.seatPoint(e.seat, 0, 0, this.dim.pondZ + 1.5);
      // 立直宣言：牌拍下去的那一刻放特效（落桌标记），接着从抽屉里拿立直棒放到桌上（2.5D 是落桌后立直棒直接掉下来）
      const flat = this.style === '25d';
      // 随机微变化：每次出牌快慢、抬多高都差一点；2.5D 照雀魂调的节奏和立直宣言牌只变一半
      const base = e.riichi ? (flat ? SLIDE_RIICHI : RIICHI_DISCARD) : flat ? SLIDE_DISCARD : DEFAULT_DISCARD;
      const motion = varyDiscard(base, flat || e.riichi ? 0.5 : 1);
      if (vanishing) {
        this.gone.add(e.seat);
        this.vanish.set(e.seat, { at: this.now + motion.reach + motion.carry + VANISH_DELAY });
        this.playDiscard(e.seat, e.tile, motion, false);
        return;
      }
      this.playDiscard(e.seat, e.tile, motion, !!e.riichi);
      if (e.riichi) this.startStickAnim(e.seat, -(motion.reach + motion.carry + (flat ? STICK_DROP_DELAY : motion.settle)));
      for (const ch of all) {
        // 别人出牌时看一眼，反应有先后
        if (ch.seat !== e.seat) ch.avatar?.lookAtPoint(pond, 0.9 + Math.random() * 0.8);
        if (ch.seat === e.seat && e.riichi) ch.avatar?.setMood('angry', 1.6);
      }
    } else if (e.type === 'call') {
      // 隐身的桃子鸣牌：看不见也没动静
      if (g.stealthed(e.seat, this.lastSync?.view.me ?? 0)) return;
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
      // 衣摸到了海底牌：这一张不照常飞，从海里捞上来
      if (e.ability === 'koromo' && e.text === '海底自摸') this.startScoop(g, e.seat);
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
    // 改良布局：放在中央控制台顶上靠这一家的边上（雀魂那样）。放在牌河和控制台之间的话，自己的立直棒会被自己牌河第一排挡住
    if (this.v2) return this.toWorld(seat, me, 0, this.consoleH + 0.085, CONSOLE_HALF - 0.24, STANDING);
    const out = this.style === '25d' && (seat - me + 4) % 4 === 2 ? TOP_STICK_OUT_25D : 0;
    return this.toWorld(seat, me, 0, 0.09, this.dim.pondZ - 0.35 + out, STANDING);
  }

  // 2.5D 改良布局（试做）
  private get v2(): boolean {
    return this.style === '25d' && this.improved;
  }

  // 这一边（相对座位，0 是自己）的牌山离中心多远。2.5D 对家的牌山往中间收，好让后面的手牌露出来；改良布局上家、下家的往外挪
  private wallZ(rel: number): number {
    if (this.style !== '25d') return WALL_Z;
    if (rel === 2) return WALL_Z - (this.v2 ? V2_TOP_WALL_IN : TOP_WALL_IN_25D);
    if (rel % 2 === 1 && this.v2) return WALL_Z + V2_SIDE_OUT;
    return WALL_Z;
  }

  // 这一边（相对座位）的手牌比原来往桌边多推多少（2.5D：上家、下家、对家的手牌在牌山后面，推开一点才不被挡住）
  private handPush(rel: number): number {
    if (this.style !== '25d') return 0;
    if (rel % 2 === 1) return SIDE_HAND_PUSH_25D + (this.v2 ? V2_SIDE_OUT : 0);
    if (rel === 2) return this.v2 ? V2_TOP_HAND_PUSH : TOP_HAND_PUSH_25D;
    return 0;
  }

  // 自己的手牌离桌子中心多远（中线）：放大了往外让一点；改良布局再往外挪
  private myHandZ(hs: number): number {
    return this.dim.handZ + (hs - 1) * 1.2 + (this.v2 ? this.view25.out ?? V2_HAND_OUT : 0);
  }

  private get consoleH(): number {
    return this.style === '25d' ? CONSOLE_H_25D : CONSOLE_H;
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

  // 鸣牌、立直的特效：在这家前面的桌上放冲击波、迸一把火星，四周被照亮一下，角色举手示意
  private callFx(seat: number, kind: 'call' | 'kan' | 'riichi'): void {
    const color = kind === 'riichi' ? FX_RED : kind === 'kan' ? '#9fd8ff' : FX_GOLD;
    const at = this.seatPoint(seat, 0, 0.1, kind === 'riichi' ? this.dim.pondZ : this.dim.handZ - 2);
    this.effects.ring(at, color, kind === 'kan' ? 9 : 6);
    this.effects.ring(at, '#ffffff', kind === 'kan' ? 4.5 : 3.5, 0.4, 0.7);
    this.effects.flash(at.clone().setY(1.5), color, kind === 'riichi' ? 9 : 6, 0.5);
    if (kind !== 'call') this.effects.ring(at, color, 12, 1.1, 0.6);
    this.effects.burst(at.clone().setY(0.4), color, kind === 'call' ? 30 : 50, kind === 'call' ? 8 : 11, 0.7);
    this.effects.pulse(at.clone().setY(2.2), color, kind === 'call' ? 40 : 65, kind === 'call' ? 0.18 : 0.28);
    this.shake = Math.max(this.shake, kind === 'call' ? 0.25 : 0.45);
    // 立直时手要去拿立直棒，不举手
    if (kind !== 'riichi') this.raiseHand(seat);
  }

  // 举起右手亮一下（鸣牌、自摸）
  private raiseHand(seat: number): void {
    const av = this.characterAt(seat)?.avatar;
    if (av && seat !== this.lastSync?.view.me) {
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

  // 倒完牌：镜头往和牌的人那边推一点，自摸的人举手（荣和的人身体前倾）。
  // 和牌的光是倒牌时打开的聚光灯（startSpots），这里不再放别的；
  // 初美砸牌的和牌（slam）光已经从那张牌上炸过了，这里撒一把紫色的光点
  private winFx(seat: number, tsumo: boolean, color: string = FX_GOLD, slam: THREE.Vector3 | null = null): void {
    if (slam) {
      this.effects.sparkles(slam.clone().setY(0.6), color, 60, 4, 2);
      if (tsumo) this.callFx(seat, 'call');
      return;
    }
    if (seat !== this.lastSync?.view.me) this.zoom = { t: 0, target: this.seatPoint(seat, 0, 4, this.dim.seatZ - 2) };
    if (tsumo) this.raiseHand(seat);
  }

  // 手牌一倒，上方几盏聚光灯一盏接一盏打开，均匀照在和了的那副牌上；一直亮到这一局收掉（初美砸牌的不打）
  private startSpots(rv: RevealState): void {
    const g = this.lastSync?.g;
    if (!g) return;
    const rows: SpotRow[] = [];
    for (const w of rv.wins) {
      if (rv.slams.has(w.tile)) continue;
      const ids = [...g.players[w.seat].hand];
      if (!ids.includes(w.tile) && !this.fallsBack(w.seat)) ids.push(w.tile);
      const pts = ids.map((id) => this.tiles[id].target?.pos).filter((p): p is THREE.Vector3 => !!p);
      if (!pts.length) continue;
      const o = this.seatPoint(w.seat, 0, 0, 0);
      const side = this.seatPoint(w.seat, 1, 0, 0).sub(o).normalize();
      const inward = this.seatPoint(w.seat, 0, 0, -1).sub(o).normalize();
      const center = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
      const half = Math.max(...pts.map((p) => Math.abs(p.clone().sub(center).dot(side)))) + 0.7;
      rows.push({ center: center.setY(0), side, inward, half });
    }
    this.spots?.dispose();
    this.spots = null;
    if (!rows.length) return;
    this.spots = new WinSpots(rows);
    this.scene.add(this.spots.group);
  }

  // 聚光灯亮着时：真的灯照在第一副牌上，四周暗下去一点；关掉后慢慢回到平时
  private updateSpots(dt: number): void {
    const sp = this.spots;
    if (sp) {
      if (!this.reveal) sp.stop();
      sp.update(dt);
    }
    const lvl = sp?.level ?? 0;
    const night = 1 - SEA_NIGHT * (this.water?.night ?? 0);
    if (this.hemi) this.hemi.intensity = HEMI_BASE * (1 - STAGE_DIM * lvl) * night;
    if (this.keyLight) this.keyLight.intensity = KEY_BASE * (1 - STAGE_DIM * 1.15 * lvl) * night;
    const light = this.stageLight;
    if (light) {
      light.intensity = STAGE_LIGHT * lvl;
      const row = sp?.rows[0];
      if (row) {
        light.position.copy(row.center).addScaledVector(row.inward, 2).setY(12);
        light.target.position.copy(row.center);
        light.target.updateMatrixWorld();
        light.angle = Math.min(1.2, Math.atan((row.half * 1.15) / light.position.distanceTo(row.center)));
      }
    }
    if (sp?.done) {
      sp.dispose();
      this.spots = null;
    }
  }

  private startFlight(tile: TileId, seat: number): void {
    const obj = this.tiles[tile];
    if (!obj.shown) return;
    const path = this.lastSync?.view.drawPath ?? 'on';
    const fade = path === 'off' || (path === 'self' && seat !== this.lastSync?.view.me);
    this.flights = this.flights.filter((f) => f.tile !== tile);
    this.flights.push({ tile, t: 0, start: obj.group.position.clone(), quat: obj.group.quaternion.clone(), scale: obj.group.scale.x, fade });
    // 从淹在水里的牌山摸牌：牌出水的地方一小圈水花
    const p = obj.group.position;
    if (!fade && this.water?.under(p)) {
      this.water.drop(p.x, p.z, 0.035, 0.6);
      this.droplets(p.clone().setY(this.water.level), 8, 2.2, 0.5);
    }
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
        const own = wetLike(m.material as THREE.Material, (m.material as THREE.Material).clone());
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
      if (m.name === 'land') this.splashTile(a.tile, a.riichi ? 1.4 : 1);
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
    const shown = this.revealSeats(g);
    // 改良布局里自己要倒牌：先在桌上立起来、自摸那张落好，再倒（倒牌时刻往后推）
    const stand = [...shown.keys()].some((s) => this.fallsBack(s));
    const selfTsumo = r.wins.some((w) => w.from === null && this.fallsBack(w.seat));
    // 改良布局的自摸：一只手把那张牌砸在桌上（初美聚着风的另有一套：倒完再砸）。自己的是手牌立起来的同时带着牌伸进来，
    // 别人的是宣言后 V2_STAND 秒伸过去捏起来。咲的岭上开花（岭上牌自摸，役满时役里不写岭上开花，看这一张是不是岭上摸的）砸下去开百合
    const tw = this.v2 ? r.wins.find((w) => w.from === null && !this.galeWin(w.seat)) : undefined;
    const standAt = stand ? this.now + (r.wins.length ? V2_STAND : V2_STAND_DRAW) : null;
    let tsumoSlam: RevealState['tsumoSlam'] = null;
    if (tw) {
      const self = this.fallsBack(tw.seat);
      const start = self && standAt !== null ? standAt : this.now + V2_STAND;
      const hand = this.lastSync?.view.slamHand !== false;
      const rinshan = g.rinshanDraw || tw.result.yaku.some((y) => y.name === '岭上开花');
      const lily = this.lastSync?.view.ids[tw.seat] === 'saki' && rinshan ? tw.result.base : null;
      const style = this.slamStyle(tw.seat);
      tsumoSlam = { seat: tw.seat, tile: tw.tile, start, hitAt: start + slamHitOffset(self || !hand), started: false, lily, sea: tw.tile === this.seaSlamTile, style };
      // 竹井久那一套现在就排上（到 start 才动手）：从手里那张拿起来，节奏照远近定，这里才知道什么时候翻过来亮牌、什么时候砸下去
      if (style === 'hisa') this.startTsumoSlam(tsumoSlam, this.handSlot(g, tw.seat, tw.tile));
    }
    // 竹井久：翻过来亮牌那一下手牌一起倒（自己的先在桌上立起来），砸下去、停够了再放和牌特效
    const flickReveal = tsumoSlam?.revealAt ?? null;
    const placeAt = standAt !== null && selfTsumo && !tsumoSlam ? standAt + V2_PLACE : null;
    const slamDone = tsumoSlam ? tsumoSlam.hitAt + (tsumoSlam.lily !== null ? V2_LILY_HOLD : tsumoSlam.sea ? V2_SEA_HOLD : V2_SLAM_HOLD) : 0;
    const at =
      flickReveal ?? Math.max(this.now + (r.wins.length ? (flat ? REVEAL_DELAY_25D : REVEAL_DELAY) : 0.3), standAt !== null ? (placeAt ?? standAt) + V2_HOLD : 0, slamDone);
    const stagger = flat ? TOPPLE_STAGGER_25D : TOPPLE_STAGGER;
    let fxAt = flickReveal !== null ? slamDone : at;
    for (const [s, win] of shown) {
      const n = g.players[s].hand.length + (win !== null && !g.players[s].hand.includes(win) ? 1 : 0);
      const wave = (LOOKS[this.lastSync?.view.ids[s] ?? '']?.reveal ?? 'wave') === 'wave';
      fxAt = Math.max(fxAt, at + (wave ? (n - 1) * stagger : 0) + TOPPLE_TIME + 0.1);
    }
    // 初美聚着风和牌：手牌先倒，倒完那张和了牌举起来往桌上砸，砸到的时候才放特效
    const slams: RevealState['slams'] = new Map();
    for (const w of r.wins) {
      // 衣从海里捞上来的海底牌：自摸时也举起来砸下去（改良布局走上面那只手砸）
      const sea = w.from === null && w.tile === this.seaSlamTile && tsumoSlam?.tile !== w.tile;
      if (!this.galeWin(w.seat) && !sea) continue;
      const n = g.players[w.seat].hand.filter((t) => t !== w.tile).length;
      const wave = (LOOKS[this.lastSync?.view.ids[w.seat] ?? '']?.reveal ?? 'wave') === 'wave';
      const slamAt = at + (wave ? Math.max(0, n - 1) * stagger : 0) + TOPPLE_TIME + 0.12;
      slams.set(w.tile, { seat: w.seat, at: slamAt, from: null, hit: false });
      fxAt = Math.max(fxAt, slamAt + SLAM_TIME);
    }
    // 被荣和的立直不成立，还没拿出来的立直棒不拿了
    this.handAnims = this.handAnims.filter((a) => a.kind !== 'stick');
    for (const d of this.drawers) d.open = 0;
    this.reveal = {
      at,
      fxAt,
      fxDone: false,
      // 竹井久的倒牌在动作中间（砸下去自己炸开），不劈闪电（也不跟着闪电震屏）
      boltAt: flat && r.wins.length && flickReveal === null ? at - BOLT_LEAD : null,
      stagger,
      wins: r.wins.map((w) => ({ seat: w.seat, tsumo: w.from === null, tile: w.tile })),
      topple: new Map(),
      slams,
      hops: [],
      spotsOn: false,
      tsumoSlam,
      standAt,
      placeAt,
      snapped: false,
      syncs: standAt === null ? [] : placeAt !== null ? [standAt, placeAt, at] : [standAt, at],
    };
    for (const w of r.wins) {
      if (w.from === null) continue;
      const a = this.handAnims.find((x) => x.seat === w.from && x.kind === 'tile');
      // 要被拿去砸的牌，放铳的人的手在它被拿走前收回去
      const slam = slams.get(w.tile);
      if (a) a.hold = (slam ? slam.at : fxAt + 0.4) - this.now;
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
    this.deal = { start, dealer: g.dealer, sum: g.dice[0] + g.dice[1], order, extra: 0 };
    this.himeko.stop();
    this.himekoDeal = null;
    const hk = himekoKeySeat(g);
    if (hk !== null) {
      // 姬子的牌照常从牌山里拿走（往天上飞走），等别人发完，再错落着一张一张裹着火从天上竖着砸进手里（himekoBeat.ts）
      const p = g.players[hk];
      const open = start + DEAL_START + 16 * DEAL_BATCH + 0.2;
      if (p.drawn !== null) order.set(p.drawn, { d: 52, time: open - 0.2 });
      const mine = [...p.hand].sort((a, b) => (order.get(a)?.d ?? 99) - (order.get(b)?.d ?? 99));
      const n = mine.length;
      // mine 按发到的顺序排，也就是发牌时她手里从左到右的顺序
      const seed = beatSeed(g.seed, g.round);
      const land = new Map(mine.map((t, i) => [t, { ...beatHit(i, n, seed), at: open + beatHit(i, n, seed).at }] as [TileId, BeatHit]));
      this.deal.extra = Math.max(0, open + beatLength(n, seed) - (start + DEAL_SORT));
      const fireAt = start + this.deal.extra + DEAL_END + 0.15;
      this.himekoDeal = { seat: hk, land, pending: new Set(mine), axes: new Map(), open, aimed: false, final: open + beatFinal(n, seed), shook: false, fireAt, fired: false };
    }
    this.dice.roll(g.dice, DEAL_END + 0.6);
    for (const a of this.handAnims) this.emitMarkers(a, Infinity);
    this.handAnims = [];
    // 新的一局：所有牌从上方落下，重新码好牌山
    for (const t of this.tiles) t.shown = false;
  }

  sync(g: Game, view: SyncView): void {
    if (this.characters.length === 0 && this.style === '3d') this.buildCharacters(view);
    this.setSketch(!!view.sketch);
    this.lastSync = { g, view };
    this.clickable = view.clickable;
    const targets = new Map<TileId, Placement>();
    for (let s = 0; s < 4; s++) this.placeSeat(g, s, view.me, targets);
    this.placeReveal(g, view.me, targets);
    this.wallSlotOf = wallSlots(g);
    for (const [t, slot] of this.wallSlotOf) targets.set(t, this.wallPlacement(slot, view.me));
    // 王牌感知：杠材一直看得见，岭上牌要鼠标移上去
    const seen = new Set<TileId>([...(view.kanSeen ?? []), ...(this.rinshanHover ? view.rinshanSeen ?? [] : [])].filter((t) => this.wallSlotOf.has(t)));
    this.aimHimeko(g, targets);
    this.applyDeal(g, view.me, targets);
    this.placeRiichiSticks(g);
    for (let id = 0; id < TILE_COUNT; id++) {
      const t = this.tiles[id];
      const target = targets.get(id) ?? null;
      t.target = target;
      const moon = this.scoop?.tile === id ? this.moonGlow() : null;
      const back = moon ? moon.back : view.waveBacks?.has(id) ? this.waveMat : view.akaBacks?.has(id) ? this.akaMat : view.tintBacks?.has(id) ? this.tintMats[Math.min(3, Math.floor(kindOf(id) / 9))] : this.backMat;
      if (back && t.back.material !== back) t.back.material = back;
      const body = moon ? moon.body : view.deadly?.has(id) ? this.deadlyMat : this.bodyMat;
      if (body && t.body.material !== body) t.body.material = body;
      const faceMat = view.glowTiles?.has(id) ? this.kimonFace() : this.faceMat;
      if (faceMat && t.face.material !== faceMat) t.face.material = faceMat;
      if (t.body.customDepthMaterial) {
        t.body.customDepthMaterial = t.back.customDepthMaterial = undefined;
        t.body.renderOrder = t.back.renderOrder = t.face.renderOrder = 0;
      }
      if (seen.has(id)) this.glassTile(t);
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
    this.syncProjections(seen, view.me);
    this.syncGhosts();
    this.syncChains(g, view);
    this.showGravity(!!view.gravity);
    this.drawConsole(g, view);
    this.syncMist(g, view);
    this.syncGale(view);
    this.syncWater(view);
  }

  // ---------- 白水哩的番缚 ----------

  // 选番数时：手牌牌面朝下扣在桌上，上方浮着一排半透明的牌面。
  // 投影朝内：牌面朝着自己；朝外：牌面朝着桌子中间（从自己这边看是反的）。试看用，见 ui/riiLook.ts
  private syncGhosts(): void {
    for (const [id, gr] of this.ghosts) if (!this.ghostAt.has(id)) gr.visible = false;
    if (!this.ghostAt.size) {
      this.ghostSince = -1;
      return;
    }
    if (this.ghostSince < 0) this.ghostSince = this.now;
    const map = this.faceMat?.map ?? this.atlas.texture;
    this.ghostMats ??= {
      back: new THREE.MeshBasicMaterial({ color: '#8fa8ff', transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      face: new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    };
    if (this.ghostMats.face.map !== map) {
      this.ghostMats.face.map = map;
      this.ghostMats.face.needsUpdate = true;
    }
    for (const id of this.ghostAt.keys()) {
      let gr = this.ghosts.get(id);
      if (!gr) {
        gr = new THREE.Group();
        const back = new THREE.Mesh(new THREE.PlaneGeometry(TILE_W, TILE_H), this.ghostMats.back);
        const face = new THREE.Mesh(this.faceGeoms[faceIndex(id)], this.ghostMats.face);
        face.position.z = 0.004;
        back.renderOrder = 5;
        face.renderOrder = 6;
        gr.add(back, face);
        this.scene.add(gr);
        this.ghosts.set(id, gr);
      }
      gr.visible = true;
    }
    this.updateGhosts();
  }

  // 每一帧：牌往下扣的时候投影从牌的位置淡出来、往上浮到那一排的正上方
  private updateGhosts(): void {
    if (this.ghostSince < 0 || !this.ghostMats) return;
    const f = Math.min(1, Math.max(0, (this.now - this.ghostSince - 0.08) / 0.34));
    const e = 1 - (1 - f) ** 3;
    this.ghostMats.back.opacity = 0.55 * e;
    this.ghostMats.face.opacity = 0.92 * e;
    for (const [id, at] of this.ghostAt) {
      const gr = this.ghosts.get(id);
      if (!gr) continue;
      gr.position.copy(at.pos);
      gr.quaternion.copy(at.quat);
      // 浮在扣着的那一排的正上方，一张对一张
      gr.translateY(TILE_H * (0.35 + (0.67 + (this.v2 ? V2_GHOST_UP : 0)) * e) * at.scale);
      if (riiLook.proj === 'out') gr.rotateY(Math.PI);
      gr.scale.setScalar(at.scale);
    }
  }

  // 这个座位手牌那一排在画面上的位置（锁链画在这上面）
  private chainFrame(s: number, me: number, g: Game): ChainFrame {
    const row = this.handRows[s] ?? { x0: 0, step: TILE_W + GAP, hs: 1, z: this.dim.handZ };
    const p = g.players[s];
    const count = Math.max(1, Math.min(14, p.hand.length || 13 - 3 * p.melds.length));
    const cx = row.x0 + ((count - 1) * row.step) / 2;
    const y = (TILE_H / 2) * row.hs;
    // 照牌本身的朝向：自己的手牌往后仰，别人的立着；锁链绕着牌的上下、前后箍一圈
    const rot = s === me ? new THREE.Euler(this.handTilt, 0, 0) : STANDING;
    const at = this.toWorld(s, me, cx, y, row.z, rot);
    const center = at.pos;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(at.quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(at.quat);
    const toward = new THREE.Vector3(0, 0, 1).applyQuaternion(at.quat);
    // 牌面朝着看的人那一边
    if (toward.dot(this.rest.pos.clone().sub(center)) < 0) {
      toward.negate();
      right.negate();
    }
    return { center, right, up, toward, width: count * row.step, size: row.step };
  }

  private newChain(s: number, n: number, g: Game, me: number): ChainFx {
    this.chains[s]?.dispose();
    const fx = new ChainFx(n, this.chainFrame(s, me, g), (at, color, big) => {
      this.effects.flash(at, color, big ? 12 : 3.5, big ? 0.7 : 0.3);
      if (big) {
        // 锁死的那一下：大闪光、一圈冲击波、震屏
        this.effects.ring(at, color, 9, 0.8);
        this.shake = Math.max(this.shake, 0.8);
      }
    });
    this.scene.add(fx.group);
    this.chains[s] = fx;
    return fx;
  }

  // 自己是哩：缚了番就锁上（发牌动画、倒牌时不动）
  private syncChains(g: Game, view: SyncView): void {
    const me = view.me;
    const bind = view.riiBind ?? null;
    let cur = this.chains[me];
    // 换了锁链样子（试看）：照新样子重新锁一次
    if (cur && bind !== null && cur.look.id !== riiLook.chain && g.phase === 'turn') {
      cur.dispose();
      this.chains[me] = null;
      cur = null;
      const fx = this.newChain(me, bind, g, me);
      fx.lock();
      return;
    }
    if (bind !== null && !cur && g.phase === 'turn' && !this.deal) {
      const fx = this.newChain(me, bind, g, me);
      // 刚缚上：射过来锁上；接着打的半局（换视角、重画）就直接是锁好的样子
      if (g.players[me].discards.length === 0) fx.lock();
      else fx.settle();
    }
  }

  // 结算：哩拿到钥匙（锁链变金）/ 没和成、番数不够（锁链崩断）。别人的哩这时才现出锁链（缚没缚只有她自己知道）。
  // 返回再过多少秒锁链开始变金 / 崩断（天空放晴、钥匙落下由 app 照这个时间排在画面上）
  riiOutcome(seat: number, kind: ChainEnd, n: number, g: Game, me: number): number {
    let fx = this.chains[seat];
    // 自己的锁链锁好以后消散了：结算时重新射出来
    if (fx?.vanished) {
      fx.dispose();
      this.chains[seat] = fx = null;
    }
    const fresh = !fx;
    if (!fx) {
      fx = this.newChain(seat, n, g, me);
      fx.lock(true);
    }
    const delay = Math.max(fresh ? 0.6 : 0, this.busyMs() / 1000);
    const target = fx;
    this.later(delay, outcomeTime(kind), () => target === this.chains[seat] && target.finish(kind));
    return delay / Math.max(0.01, this.timeScale);
  }

  // 结算时这个座位的锁链要不要重新射出来（锁好以后消散了，或者是别人的哩、之前没画出来）
  riiFresh(seat: number): boolean {
    return !this.chains[seat] || !!this.chains[seat]?.vanished;
  }

  // 这个座位手牌中间在页面上的位置（钥匙落到这上面）
  handScreenPoint(seat: number, me: number, g: Game): { x: number; y: number; w: number } | null {
    const f = this.chainFrame(seat, me, g);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = f.center.clone().project(this.camera);
    const q = f.center.clone().addScaledVector(f.right, f.width / 2).project(this.camera);
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, w: Math.abs(q.x - p.x) * rect.width };
  }

  private timers: { at: number; dur: number; fn: () => void }[] = [];
  private later(sec: number, dur: number, fn: () => void): void {
    this.timers.push({ at: this.now + sec, dur, fn });
  }

  private updateChains(dt: number): void {
    const due = this.timers.filter((t) => this.now >= t.at);
    this.timers = this.timers.filter((t) => this.now < t.at);
    due.forEach((t) => t.fn());
    this.chains.forEach((c, s) => {
      if (!c) return;
      c.update(dt);
      if (c.finished) {
        c.dispose();
        this.chains[s] = null;
      }
    });
  }

  private clearChains(): void {
    this.chains.forEach((c) => c?.dispose());
    this.chains = [null, null, null, null];
    this.timers = [];
  }

  // 透华的治水：水面渐渐铺开，退出时渐渐散掉
  // 透华的治水：贴着桌布一层静水。衣的海底：海水照牌山剩多少往上涨，最后没过牌山；海底被错开时退下去；
  // 衣自摸把牌砸下去时海水被打散，一局结束（没砸）时慢慢退潮。两个人同桌就是同一片水
  private syncWater(view: SyncView): void {
    const sea = view.sea ?? null;
    const still = !!view.stillWater;
    if ((still || sea) && !this.water) {
      this.water = new Water(this.renderer, this.dim.tableHalf, FRAME_TOP);
      this.scene.add(this.water.group);
    }
    const w = this.water;
    if (!w) return;
    const ended = this.lastSync?.g.phase === 'roundEnd' || this.lastSync?.g.phase === 'gameEnd';
    // 一局结束：要砸的那张还没砸下去就先留着海水，不然慢慢退潮
    const rv = this.reveal;
    const id = this.seaSlamTile;
    const slamPending = id !== null && !!rv && (rv.tsumoSlam?.tile === id || rv.slams.get(id)?.hit === false);
    const ebb = ended && !(slamPending && !this.seaDrained);
    if (sea && !this.seaDrained && !ebb) {
      w.set(STILL_LEVEL + (SEA_TOP - STILL_LEVEL) * sea.level, 1, true);
      w.setRate(SEA_RISE);
    } else {
      w.set(STILL_LEVEL, still || sea ? 1 : 0, !!sea);
      if (!this.seaDrained) w.setRate(0.8);
    }
    // 月亮映在海底牌上方的水面上，海水涨上来才看得清
    const haitei = sea?.on && !this.scoop && !this.seaDrained && !ended ? sea.haitei : null;
    const at = haitei !== null && haitei !== undefined ? this.tiles[haitei].target?.pos : null;
    if (sea && at) {
      // 映在海底牌前面（往桌子中间一点）的水面上：底下是桌布，月亮看得清
      const c = at.clone().setY(0);
      const toward = c.clone().negate().normalize();
      const side = Math.abs(c.x) > Math.abs(c.z) ? new THREE.Vector3(Math.sign(-c.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(-c.z));
      const m = c.addScaledVector(side.lengthSq() ? side : toward, MOON_IN);
      w.setMoon({ x: m.x, z: m.z, phase: sea.moon / 8, amount: THREE.MathUtils.smoothstep(sea.level, 0.12, 0.55) });
    } else w.setMoon(null);
  }

  // 牌落进水里（打进牌河、砸下去）：按牌的样子压下去一块，荡开一圈圈涟漪
  private splashTile(id: TileId, strength = 1): void {
    const w = this.water;
    if (!w?.active) return;
    const t = this.tiles[id];
    const at = t.target ?? { pos: t.group.position, quat: t.group.quaternion };
    // 牌躺着时长边（牌的本地 y）朝哪
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(at.quat);
    w.splashTile(at.pos.x, at.pos.z, Math.atan2(axis.x, axis.z), strength);
  }

  // 一把水珠：往上、往外溅，落回水里（加法混合的亮点，像反着光的水滴）
  private droplets(at: THREE.Vector3, count: number, speed: number, up: number, life = 0.75): void {
    this.effects.sparks(at, '#8fcfff', {
      count,
      life: [life * 0.55, life],
      vel: (v) => {
        const a = Math.random() * Math.PI * 2;
        const r = speed * (0.3 + 0.7 * Math.random());
        v.set(Math.cos(a) * r, up * (0.5 + Math.random()), Math.sin(a) * r);
      },
      gravity: 20,
      drag: 0.6,
      size: [0.03, 0.07],
      stretch: 0.05,
      jitter: 0.35,
      hot: '#ffffff',
    });
  }

  // 捞上来的牌身上的月光（牌身、牌背换成会自己发光的一份）
  private moonGlow(): { body: THREE.MeshStandardMaterial; back: THREE.MeshStandardMaterial } {
    const matte = this.style === '25d' ? 0.62 : 0;
    this.moonMats ??= {
      body: wet(new THREE.MeshStandardMaterial({ color: '#f6f1e3', emissive: MOON_GLOW, emissiveIntensity: 0, roughness: matte || 0.35 })),
      back: wet(new THREE.MeshStandardMaterial({ color: this.colors.back, emissive: MOON_GLOW, emissiveIntensity: 0, roughness: matte || 0.4 })),
    };
    return this.moonMats;
  }

  // 衣摸到海底牌：这一张从海里捞上来（海底捞月）。摸牌时已经开始照常飞了，先停下来，放回牌山上的位置
  private startScoop(g: Game, seat: number): void {
    const tile = g.players[seat].drawn;
    const view = this.lastSync?.view;
    if (tile === null || !view?.sea || view.sea.seat !== seat || !this.water?.active) return;
    const obj = this.tiles[tile];
    const slot = this.wallSlotOf.get(tile);
    const from = slot ? this.wallPlacement(slot, view.me) : { pos: obj.group.position.clone(), quat: obj.group.quaternion.clone(), scale: obj.group.scale.x };
    this.flights = this.flights.filter((f) => f.tile !== tile);
    if (this.heldDraw?.tile === tile) this.heldDraw = null;
    obj.group.position.copy(from.pos);
    obj.group.quaternion.copy(from.quat);
    obj.group.scale.setScalar(from.scale);
    this.scoop = { tile, seat, t: 0, from, broke: false, drip: SCOOP_WAIT + SCOOP_RISE * 0.6 };
    this.seaSlamTile = tile;
    // 月亮的倒影亮一下，水面往这里收一下
    this.water.drop(from.pos.x, from.pos.z, -0.06, 1.2);
    this.effects.pulse(from.pos.clone().setY(3), MOON_GLOW, 30, 0.5);
    if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
  }

  private animateScoop(dt: number): void {
    const sc = this.scoop;
    if (!sc) return;
    sc.t += dt;
    const tile = this.tiles[sc.tile];
    const dest = tile.target;
    const glow = this.moonGlow();
    if (!dest || sc.t >= SCOOP_TIME) {
      this.scoop = null;
      glow.body.emissiveIntensity = glow.back.emissiveIntensity = 0;
      if (dest) {
        tile.group.position.copy(dest.pos);
        tile.group.quaternion.copy(dest.quat);
        tile.group.scale.setScalar(dest.scale);
      }
      if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
      return;
    }
    this.held.add(sc.tile);
    const g = tile.group;
    const from = sc.from;
    const level = this.water?.level ?? 0;
    const smooth = (x: number) => x * x * (3 - 2 * x);
    // 浮上来停在海底牌正上方（往桌子中间一点），离水面两个多牌高；海底在对面牌山时画面上会顶出上沿，再往中间挪
    const apex = from.pos.clone().lerp(new THREE.Vector3(0, from.pos.y, 0), 0.08);
    apex.y = Math.max(level, from.pos.y) + 2.3;
    const top = (TILE_H / 2) * Math.max(from.scale, dest.scale) * 1.15;
    for (let i = 0; i < 8 && apex.clone().setY(apex.y + top).project(this.camera).y > 0.82; i++) apex.lerp(new THREE.Vector3(0, apex.y, 0), 0.15);
    // 半路转过来：自己捞的牌面朝着自己（和进了手里一样），别人捞的照她手里的朝向（背对别家）
    const upright = dest.quat;
    let t = sc.t;
    let light = 0;
    if (t < SCOOP_WAIT) {
      // 海底牌在水里微微一颤，月光聚过来
      const k = t / SCOOP_WAIT;
      g.position.copy(from.pos).add(new THREE.Vector3(Math.sin(t * 60) * 0.02 * k, 0.05 * k, 0));
      g.quaternion.copy(from.quat);
      g.scale.setScalar(from.scale);
      light = 0.8 * k;
    } else if ((t -= SCOOP_WAIT) < SCOOP_RISE) {
      const k = t / SCOOP_RISE;
      const e = smooth(k);
      g.position.lerpVectors(from.pos, apex, e);
      g.quaternion.slerpQuaternions(from.quat, upright, smooth(Math.min(1, k * 1.2)));
      g.scale.setScalar(THREE.MathUtils.lerp(from.scale, Math.max(from.scale, dest.scale) * 1.15, e));
      light = 0.8 + 0.7 * e;
      // 破水而出：水面隆起一圈、水花往上溅、月亮的倒影碎掉
      if (!sc.broke && g.position.y - (TILE_H / 2) * g.scale.x > level) {
        sc.broke = true;
        const p = g.position.clone().setY(level);
        this.water?.drop(p.x, p.z, 0.16, 0.9);
        this.water?.setMoon(null);
        this.droplets(p, 40, 2.6, 7, 0.9);
        this.effects.flash(p.clone().setY(level + 0.8), MOON_GLOW, 5, 0.45);
        this.effects.ring(p.clone().setY(level), '#a8dcff', 3, 0.6, 0.7);
      }
    } else if ((t -= SCOOP_RISE) < SCOOP_HOLD) {
      // 停在半空，慢慢转正，身上的水往下淌，一滴滴落回海里
      const k = t / SCOOP_HOLD;
      g.position.copy(apex).add(new THREE.Vector3(0, Math.sin(k * Math.PI) * 0.12, 0));
      g.quaternion.copy(upright);
      g.scale.setScalar(Math.max(from.scale, dest.scale) * 1.15);
      light = 1.5 - 0.4 * k;
    } else {
      t -= SCOOP_HOLD;
      const k = Math.min(1, t / SCOOP_FLY);
      const e = k * k * (3 - 2 * k);
      g.position.lerpVectors(apex, dest.pos, e);
      g.position.y += Math.sin(k * Math.PI) * 0.6;
      g.quaternion.copy(upright).slerp(dest.quat, e);
      g.scale.setScalar(THREE.MathUtils.lerp(Math.max(from.scale, dest.scale) * 1.15, dest.scale, e));
      light = 1.1 * (1 - e);
    }
    glow.body.emissiveIntensity = light * 0.55;
    glow.back.emissiveIntensity = light * 0.75;
    // 出水以后身上的水一滴滴往下掉，落到水面上一个个小涟漪
    if (sc.broke && sc.t >= sc.drip && sc.t < SCOOP_TIME - SCOOP_FLY * 0.5) {
      sc.drip = sc.t + 0.07 + Math.random() * 0.06;
      const p = g.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, -(TILE_H / 2) * g.scale.x, (Math.random() - 0.5) * 0.3));
      this.effects.sparks(p, '#9fd6ff', { count: 2, life: [0.3, 0.45], vel: (v) => v.set((Math.random() - 0.5) * 0.4, -1, (Math.random() - 0.5) * 0.4), gravity: 24, drag: 0.2, size: [0.03, 0.05], stretch: 0.06, jitter: 0.05, hot: '#ffffff' });
      const fall = Math.sqrt(Math.max(0, 2 * (p.y - level) / 24));
      this.effects.later(fall, () => this.water?.drop(p.x, p.z, -0.02, 0.25));
    }
  }

  // 衣的海底牌扣进海里那一下：水面被按下去一块，溅起一小圈水珠，画面轻轻一震
  private seaPress(seat: number, at: THREE.Vector3, scale = 1): void {
    this.shake = Math.max(this.shake, 0.18);
    const w = this.water;
    if (w?.active) {
      w.drop(at.x, at.z, -0.14 * scale, 0.9 * scale);
      this.droplets(at.clone().setY(w.level), 18, 1.8 * scale, 3.2, 0.55);
    }
    this.onSlam?.(seat, null, 'press');
  }

  // 衣自摸，捞上来的海底牌砸到桌上：海水一下子被打散，一圈大浪荡出去，水花冠一样溅起来，水退成薄薄一层
  private seaSlam(at: THREE.Vector3, seat: number): void {
    this.seaDrained = true;
    this.onSeaSlam?.(seat);
    const w = this.water;
    if (w) {
      // 砸下去那一下把海水推开：半秒左右退干净
      w.setRate(0.22);
      w.set(STILL_LEVEL, 1, true);
      w.setMoon(null);
      w.drop(at.x, at.z, -0.5, 2.6);
    }
    const p = at.clone().setY(Math.max(0.2, (w?.level ?? 0) * 0.6));
    this.effects.sparks(p, '#9fd6ff', {
      count: 110,
      life: [0.5, 1.05],
      vel: (v) => {
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 5;
        v.set(Math.cos(a) * r, 6 + Math.random() * 7, Math.sin(a) * r);
      },
      gravity: 24,
      drag: 0.7,
      size: [0.04, 0.1],
      stretch: 0.06,
      jitter: 0.6,
      hot: '#ffffff',
    });
    this.effects.ring(at.clone().setY(0.05), '#a8dcff', 8, 0.9);
    this.effects.flash(at.clone().setY(0.8), '#e6f3ff', 7, 0.45);
    this.effects.pulse(at.clone().setY(2.5), MOON_GLOW, 70, 0.35);
    this.shake = Math.max(this.shake, 1);
  }

  // 初美的里鬼门：风的浓淡，和东北中间那张牌的紫光
  private syncGale(view: SyncView): void {
    const level = view.gale?.level ?? 0;
    if (level > 0 && !this.gale) {
      this.gale = new Gale(this.dim.tableHalf * 2.3, 4);
      this.scene.add(this.gale.group, this.gale.burstGroup);
    }
    this.gale?.setLevel(level);
    const want = view.glowTiles ?? new Set<TileId>();
    for (const [id, obj] of this.glows) {
      if (want.has(id)) continue;
      obj.removeFromParent();
      this.glows.delete(id);
    }
    for (const id of want) {
      if (this.glows.has(id)) continue;
      const obj = this.makeGlow(id);
      this.tiles[id].group.add(obj);
      this.glows.set(id, obj);
    }
  }

  // 初美鸣出来的东、北中间那张：牌面本身就是紫色的字（换一套东南西北是紫字的牌面，见 kimonFace），
  // 牌上一道从牌面直直往上的紫色光柱（牌躺着时就是朝天，见 tileBeam.ts）
  private makeGlow(_id: TileId): THREE.Group {
    const group = new THREE.Group();
    const beam = new TileBeam(TILE_W * 0.96, TILE_H * 0.96, TILE_T / 2);
    group.add(beam.group);
    group.userData.beam = beam;
    return group;
  }

  // 紫字的牌面：东南西北的字用紫色墨印（微微自己发光，星空里也看得清），别的牌照常。用到时才画
  private kimonFace(): THREE.MeshStandardMaterial {
    if (this.kimonFaceMat) return this.kimonFaceMat;
    const atlas = new FaceAtlas((kind, red) => (kind >= 27 && kind <= 30 ? glowGlyph(kind, KIMON_INK) : faceSvg(kind, red)));
    void atlas.draw();
    this.kimonFaceMat = wet(
      new THREE.MeshStandardMaterial({
        map: atlas.texture,
        transparent: true,
        roughness: this.faceMat?.roughness ?? 0.35,
        emissive: '#ffffff',
        emissiveMap: atlas.texture,
        emissiveIntensity: 0.35,
      }),
    );
    return this.kimonFaceMat;
  }

  // 紫光一明一暗；光柱只在牌躺着（牌面朝天）时有，牌立起来、倒下去的半路慢慢收放
  private updateGlows(): void {
    // 风把四周压暗时紫字自己亮一些，暗处也认得出是紫色
    if (this.kimonFaceMat) this.kimonFaceMat.emissiveIntensity = 0.35 + 0.75 * this.roomDark;
    for (const [id, g] of this.glows) {
      const up = new THREE.Vector3(0, 0, 1).applyQuaternion(this.tiles[id].group.quaternion).y;
      const pulse = 0.75 + 0.25 * Math.sin(this.now * 2.6 + id);
      (g.userData.beam as TileBeam).update(this.now, THREE.MathUtils.smoothstep(up, 0.75, 0.95) * pulse);
    }
  }

  // 这一家和牌时紫光往上冲（初美的里鬼门聚着风的局）
  private galeWin(seat: number): boolean {
    const gale = this.lastSync?.view.gale;
    return !!gale && gale.seat === seat && gale.level > 0;
  }

  // 初美和牌：风被甩散，那张和了牌上炸开一团白光，紫色的风像喷泉一样往上、往外张开；画面从那里白一下
  private galeBurst(at: THREE.Vector3): void {
    // 喷泉往桌子中间那边张开：不往镜头上糊，四家看起来都是冲着牌桌上空
    const lean = new THREE.Vector2(-at.x, -at.z);
    if (lean.length() > 0.5) lean.normalize().multiplyScalar(1.4);
    else lean.set(0, 0);
    this.gale?.burst(at, this.style === '25d' ? 0.7 : 0.6, lean);
    this.shake = Math.max(this.shake, 1);
    const p = at.clone().project(this.camera);
    const flash = document.createElement('div');
    flash.className = 'gale-flash3d';
    flash.style.setProperty('--x', `${(((p.x + 1) / 2) * 100).toFixed(1)}%`);
    flash.style.setProperty('--y', `${(((1 - p.y) / 2) * 100).toFixed(1)}%`);
    this.container.appendChild(flash);
    window.setTimeout(() => flash.remove(), 1400);
  }

  // 改良布局的自摸砸牌：手伸上来（自己的带着牌从镜头跟前，别人的伸过去拿起那张），举高、往前扫下去把牌扣在桌上，
  // 牌翻起来立在落点、亮一下光、炸开。竹井久那一套（hisa）从 from（手里那张）拿起来，到 ts.start 才动手
  private startTsumoSlam(ts: NonNullable<RevealState['tsumoSlam']>, from: Placement | null = null): void {
    ts.started = true;
    const tile = this.tiles[ts.tile];
    const hisa = ts.style === 'hisa';
    if (!this.lastSync || !tile.shown || (!hisa && !tile.target)) return;
    const self = this.fallsBack(ts.seat);
    const here = { pos: tile.group.position.clone(), quat: tile.group.quaternion.clone(), scale: tile.group.scale.x };
    // 竹井久最后牌面朝上躺在倒牌后和了牌的位置
    const to = hisa ? this.winLie(this.lastSync.g, ts.seat, this.lastSync.view.me, ts.tile).at : tile.target!;
    const run = this.slamTile(ts.tile, ts.seat, {
      to,
      from: hisa ? (from ?? here) : self ? undefined : here,
      near: self,
      hand: this.lastSync.view.slamHand !== false,
      style: ts.style,
      at: hisa ? Math.max(this.now, ts.start) : undefined,
      onPress: (at) => (ts.sea ? this.seaPress(ts.seat, at, to.scale) : this.slamPress(ts.seat, at, to.scale)),
      // 衣的海底牌：立起来时聚的是月光
      onCharge: (at, dur) => this.slamFx.charge(at, to.scale, dur, ts.sea ? MOON_GLOW : undefined),
      onHit: (at) => {
        if (!ts.sea) return this.slamImpact(ts.seat, ts.tile, at, ts.lily);
        // 衣的海底牌：不扬灰，炸开一阵蓝色的漩涡，把海水打散
        const floor = at.clone().setY(0.02);
        this.slamFx.swirl(floor, to.scale, 0.4, '#8fd0ff');
        this.seaSlam(at, ts.seat);
        this.reveal?.hops.push({ at: this.now, x: floor });
      },
    });
    ts.hitAt = run.hitAt;
    ts.revealAt = run.revealAt;
  }

  // 砸一张牌（可以给别的特效用，比如天江衣的海底捞月）：一只手把 id 这张牌举起来、往前扫下去扣在桌上，牌自己翻起来立在 to，炸开。
  // from 不给就是牌已经在手里、跟着手从画面外伸上来（自己自摸）；给了就是先伸过去在 from 拿起来。
  // near：手在镜头跟前举起来（第一人称，自己砸牌时用），不给就是 seat 是自己时为 true。
  // hand: false 不带手：牌从原处（from，不给就是落点）自己跳起来、翻身亮出牌背，再扣下去，后面一样翻起来炸开。
  // style: 'hisa' 竹井久那一套（slamFlick.ts）：to 是最后牌面朝上躺着的样子，from 是要拿的那张现在在哪（手先伸到那里拿起来）。
  // at：到这时候才动手（在那之前牌原样不动，算被拿着），不给就是马上。
  // 牌扣到桌上调 onPress，立好开始亮调 onCharge，炸开调 onHit（at 是牌底下的桌面点）；
  // 扣牌的小震动、聚光、冲击波和旋风要自己在回调里叫 slamPress / slamFx.charge / slamImpact。
  // 返回什么时候扣到桌上、什么时候炸开、什么时候手撤走（和 now 同一个时钟，秒）
  slamTile(
    id: TileId,
    seat: number,
    o: {
      to: Placement;
      from?: Placement;
      near?: boolean;
      hand?: boolean;
      style?: SlamStyle;
      at?: number;
      timing?: SlamSpec['timing'];
      onPress?: (at: THREE.Vector3) => void;
      onCharge?: (at: THREE.Vector3, dur: number) => void;
      onHit?: (at: THREE.Vector3) => void;
      onDone?: () => void;
    },
  ): SlamRun {
    const tile = this.tiles[id];
    tile.group.visible = true;
    const near = o.near ?? seat === (this.lastSync?.view.me ?? 0);
    const cam = this.camera;
    const camView = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, aspect: cam.aspect };
    const run = this.slam.start(
      {
        tile: tile.group,
        style: o.style,
        to: { pos: o.to.pos.clone(), quat: o.to.quat.clone(), scale: o.to.scale },
        from: o.from,
        side: this.seatPoint(seat, 1, 0, 0).normalize(),
        out: this.seatPoint(seat, 0, 0, 1).normalize(),
        view: near ? camView : undefined,
        cam: camView,
        arm: o.hand === false ? null : undefined,
        timing: o.timing,
        onPress: o.onPress,
        onCharge: o.onCharge,
        onHit: o.onHit,
        onDone: o.onDone,
      },
      this.now,
      o.at ?? this.now,
    );
    this.fxHold = Math.max(this.fxHold, run.doneAt);
    return run;
  }

  // 牌扣到桌上那一下：一点灰、画面轻轻一震
  slamPress(seat: number, at: THREE.Vector3, scale = 1): void {
    this.shake = Math.max(this.shake, 0.18);
    this.effects.sparks(at.clone().setY(0.02), '#e9e4da', {
      count: 10,
      life: [0.15, 0.3],
      vel: (v) => {
        const a = Math.random() * Math.PI * 2;
        const sp = (1.5 + Math.random() * 2) * scale;
        v.set(Math.cos(a) * sp, 0.3 + Math.random(), Math.sin(a) * sp);
      },
      gravity: 8,
      drag: 6,
      size: [0.025, 0.05],
      stretch: 0.02,
      jitter: 0.4 * scale,
    });
    this.onSlam?.(seat, null, 'press');
  }

  // 炸开那一下：一团白光、贴着桌面卷出去的白色旋风和冲击波，往上飘一把光点，画面一震，四周的牌跟着跳一下；
  // lily 是咲的岭上开花（这一手的基本点）：牌顶上开一朵百合，花瓣越大的手越多
  slamImpact(seat: number, id: TileId, at: THREE.Vector3, lily: number | null = null): void {
    const g = this.tiles[id].group;
    const s = g.scale.x;
    const big = lily !== null ? lilyGrand(lily) : 0;
    this.shake = Math.max(this.shake, lily !== null ? 0.75 : 0.55);
    const floor = at.clone().setY(0.02);
    const mid = g.position.clone();
    this.slamFx.swirl(floor, s, big);
    this.effects.ring(floor, '#ffffff', 3.2 * s, 0.45, 0.6);
    this.effects.flash(mid, '#f4fbff', 3.2 * s, 0.4, true);
    this.effects.sparks(floor, '#e9e4da', {
      count: 22,
      life: [0.22, 0.45],
      vel: (v) => {
        const a = Math.random() * Math.PI * 2;
        const sp = 3 + Math.random() * 4;
        v.set(Math.cos(a) * sp, 0.6 + Math.random() * 2, Math.sin(a) * sp);
      },
      gravity: 10,
      drag: 5,
      size: [0.03, 0.06],
      stretch: 0.03,
      jitter: 0.3,
    });
    this.effects.sparkles(mid, '#eef8ff', 26, 2.2 * s, 1.4);
    this.effects.pulse(floor.clone().setY(1.5), '#f2f8ff', 30, 0.12);
    this.reveal?.hops.push({ at: this.now, x: floor.clone() });
    this.onSlam?.(seat, lily, 'hit');
    if (lily === null) return;
    const top = g.position.clone().add(new THREE.Vector3(0, (TILE_H / 2) * s + 0.12, 0));
    // 花朝着镜头、偏上开
    const face = this.camera.position.clone().sub(top).normalize().add(new THREE.Vector3(0, 0.6, 0)).normalize();
    this.lily.bloom({ at: top, face, base: lily, scale: s, area: this.dim.tableHalf * 0.85, inward: this.seatPoint(seat, 0, 0, -1) });
    this.effects.flash(top, '#fffaf0', 3, 0.45);
    this.effects.pulse(top.clone().setY(2), '#fff4e4', 55, 0.25);
    // 结算等花开完、花瓣飘一会儿再弹（和得越大等得越久）
    this.fxHold = Math.max(this.fxHold, this.now + 2 + 1.6 * big);
  }

  // 砸牌：手牌倒完，和了牌从原地（荣和是牌河里那张）举到头顶、牌面朝自己一歪，停一下，再狠狠拍到倒好的手牌右边；
  // 拍到桌面那一下从这张牌炸开，桌上的牌从这里往外震一下
  private animateSlams(rv: RevealState): void {
    const easeOut = (x: number) => 1 - (1 - x) ** 3;
    for (const [id, e] of rv.slams) {
      const tile = this.tiles[id];
      const to = tile.target;
      if (!to || this.now < rv.at || e.hit) continue;
      this.held.add(id);
      if (this.now < e.at) continue;
      const g = tile.group;
      if (!e.from) {
        e.from = { pos: g.position.clone(), quat: g.quaternion.clone(), scale: g.scale.x };
        // 别人和牌：举牌的时候镜头就往那边推，看得清砸下去那一下
        if (e.seat !== this.lastSync?.view.me) this.zoom = { t: 0, target: this.seatPoint(e.seat, 0, 4, this.dim.seatZ - 2) };
      }
      const out = this.seatPoint(e.seat, 0, 0, 1).normalize();
      const side = this.seatPoint(e.seat, 1, 0, 0).normalize();
      // 举到手牌前上方一点，往桌子中间、往这一排中间各偏一点（自己这家举起来也不会冲出画面），砸的时候斜着落回去
      const apex = to.pos
        .clone()
        .addScaledVector(out, -0.5 * to.scale)
        .addScaledVector(side, -to.pos.dot(side) * 0.3)
        .add(new THREE.Vector3(0, 2.3 * to.scale, 0));
      const tilt = (a: number) => new THREE.Quaternion().setFromAxisAngle(side, a).multiply(to.quat);
      const k = this.now - e.at;
      if (k < SLAM_LIFT) {
        const f = easeOut(k / SLAM_LIFT);
        g.position.copy(e.from.pos).lerp(apex, f);
        g.position.y += Math.sin(Math.PI * f) * 0.6 * to.scale;
        g.quaternion.copy(e.from.quat).slerp(tilt(1.0), f);
        g.scale.setScalar(THREE.MathUtils.lerp(e.from.scale, to.scale * 1.3, f));
      } else if (k < SLAM_LIFT + SLAM_HANG) {
        // 停在最高处，再往后蓄一下力
        const f = (k - SLAM_LIFT) / SLAM_HANG;
        g.position.copy(apex).addScaledVector(out, 0.25 * f * to.scale);
        g.position.y += 0.15 * f * to.scale;
        g.quaternion.copy(tilt(1.0 + 0.3 * f));
        g.scale.setScalar(to.scale * 1.3);
      } else if (k < SLAM_TIME) {
        const f = ((k - SLAM_LIFT - SLAM_HANG) / SLAM_DROP) ** 2;
        const top = apex.clone().addScaledVector(out, 0.25 * to.scale).add(new THREE.Vector3(0, 0.15 * to.scale, 0));
        g.position.copy(top).lerp(to.pos, f);
        g.quaternion.copy(tilt(1.3)).slerp(to.quat, f);
        g.scale.setScalar(THREE.MathUtils.lerp(to.scale * 1.3, to.scale, f));
      } else {
        e.hit = true;
        g.position.copy(to.pos);
        g.quaternion.copy(to.quat);
        g.scale.setScalar(to.scale);
        if (id === this.seaSlamTile) this.seaSlam(to.pos.clone(), e.seat);
        else {
          this.galeBurst(to.pos.clone());
          this.effects.ring(to.pos.clone().setY(0.05), '#ffffff', 3.5, 0.45);
          this.effects.flash(to.pos.clone().setY(0.6), '#f6d8ff', 6, 0.35);
        }
        rv.hops.push({ at: this.now, x: to.pos.clone() });
      }
    }
    // 震一下：离砸的地方越近跳得越高、越早；牌山不动
    rv.hops = rv.hops.filter((h) => this.now < h.at + SLAM_HOP + 0.6);
    for (const h of rv.hops) {
      for (const [id, tile] of this.tiles.entries()) {
        const to = tile.target;
        if (!to || this.wallSlotOf.has(id) || rv.slams.has(id) || rv.topple.has(id) || id === rv.tsumoSlam?.tile) continue;
        const d = Math.hypot(to.pos.x - h.x.x, to.pos.z - h.x.z);
        const k = (this.now - h.at - d * 0.025) / SLAM_HOP;
        if (k < 0 || k > 1 || d > 22) continue;
        this.held.add(id);
        tile.group.position.copy(to.pos);
        tile.group.position.y += Math.sin(Math.PI * k) * 0.35 * Math.exp(-d / 6) * to.scale;
        tile.group.quaternion.copy(to.quat);
        tile.group.scale.setScalar(to.scale);
      }
    }
  }

  // 桃子隐身：那张牌落桌停半拍，她的牌河和手牌在原地慢慢淡掉，影子跟着一起淡（像别人的视线从她身上滑开）；淡完重新摆一次（就看不见了）
  private animateVanish(): void {
    if (!this.vanish.size || !this.lastSync) return;
    const g = this.lastSync.g;
    for (const [s, v] of this.vanish) {
      const k = Math.min(1, (this.now - v.at) / VANISH_TIME);
      if (k < 0) continue;
      if (k >= 1) {
        this.vanish.delete(s);
        this.sync(g, this.lastSync.view);
        continue;
      }
      const p = g.players[s];
      const tiles = [...p.hand, ...p.discards.filter((d) => !d.called).map((d) => d.tile), ...p.melds.flatMap((m) => m.tiles)];
      // 起头和收尾都慢，看不出从哪一刻开始、哪一刻没的
      const a = 1 - k * k * (3 - 2 * k);
      // 影子比牌淡得快一点：不然牌淡到一半，底下还压着一块深色，看着像牌变暗了而不是变淡了
      const shadow = this.shadowFade(a * a);
      for (const id of tiles) {
        const t = this.tiles[id];
        if (!t.target) continue;
        t.back.material = this.faded(this.backMat!, a);
        t.body.material = this.faded(this.bodyMat!, a);
        if (this.faceMat) t.face.material = this.faded(this.faceMat, a);
        t.body.customDepthMaterial = t.back.customDepthMaterial = shadow;
        // 先画牌身、再画牌背和牌面：半透明的牌身挡住里头的牌背，看着是一张淡掉的牌，不是一块透出里面的玻璃
        t.body.renderOrder = 1;
        t.back.renderOrder = 2;
        t.face.renderOrder = 3;
      }
    }
  }

  // 影子也要跟着淡：画影子时不管材质透明度，换成按透明度打散的点阵（alphaHash），影子就一点点稀掉。
  // three 画影子用的深度材质（RGBA 打包）不读 opacity，在点阵之前补上这一句
  private shadowFade(alpha: number): THREE.MeshDepthMaterial {
    const k = Math.max(1, Math.round(alpha * FADE_STEPS));
    let m = this.shadowFades[k];
    if (!m) {
      m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaHash: true, opacity: k / FADE_STEPS });
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <alphahash_fragment>', 'diffuseColor.a = opacity;\n#include <alphahash_fragment>');
      };
      m.customProgramCacheKey = () => 'momo-shadow-fade';
      this.shadowFades[k] = m;
    }
    return m;
  }

  // 半透明的同一种材质（桃子隐身淡掉）：透明度分 FADE_STEPS 档，每档复制一份缓存起来
  private faded(m: THREE.Material, alpha: number): THREE.Material {
    if (alpha >= 1) return m;
    const k = Math.max(1, Math.round(alpha * FADE_STEPS));
    let levels = this.fadeMats.get(m);
    if (!levels) this.fadeMats.set(m, (levels = []));
    let f = levels[k];
    if (!f) {
      f = wetLike(m, m.clone());
      f.transparent = true;
      f.opacity = k / FADE_STEPS;
      // 越淡越发白：幽灵是苍白地淡掉；不然金色牌背半透明盖在蓝桌布上会混成一块发暗的泥色
      if (f instanceof THREE.MeshStandardMaterial) {
        const pale = 1 - k / FADE_STEPS;
        f.color.lerp(GHOST, pale * 0.8);
        f.emissive.copy(GHOST).multiplyScalar(pale * 0.35);
      }
      levels[k] = f;
    }
    // 手绘板换的是牌面材质的贴图，复制品跟着换
    const src = m as THREE.MeshStandardMaterial;
    const dst = f as THREE.MeshStandardMaterial;
    if (dst.map !== src.map) {
      dst.map = src.map;
      dst.needsUpdate = true;
    }
    return f;
  }

  // 爱丽丝的手绘板：换成手绘的牌面、白色牌身、铅笔排线的牌背、白纸桌布，桌框变浅，每张牌描黑边
  private setSketch(on: boolean): void {
    if ((this.sketch?.on ?? false) === on) return;
    if (!this.sketch) {
      const atlas = new FaceAtlas(sketchFaceSvg);
      void atlas.draw();
      const matte = this.style === '25d' ? 0.62 : 0;
      const edgeGeom = new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE_W * 1.002, TILE_H * 1.002, TILE_T * 0.9));
      const edgeMat = new THREE.LineBasicMaterial({ color: '#26262c' });
      const edges = this.tiles.map((t) => {
        const e = new THREE.LineSegments(edgeGeom, edgeMat);
        e.position.z = TILE_T * 0.02;
        e.visible = false;
        t.group.add(e);
        return e;
      });
      const frame = this.tableMats!.frame as THREE.MeshStandardMaterial;
      const trim = this.tableMats!.trim as THREE.MeshStandardMaterial;
      this.sketch = {
        on: false,
        atlas,
        body: wet(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: matte || 0.6 })),
        back: wet(new THREE.MeshStandardMaterial({ color: '#ffffff', map: hatchTexture(), roughness: 0.8 })),
        paper: paperTexture(),
        edges,
        normal: {
          body: this.bodyMat!,
          back: this.backMat!,
          felt: (this.feltMat as THREE.MeshStandardMaterial).map,
          frame: frame.color.clone(),
          trim: trim.color.clone(),
          room: new THREE.Color(this.colors.room),
        },
      };
    }
    const sk = this.sketch;
    sk.on = on;
    this.faceMat!.map = on ? sk.atlas.texture : this.atlas.texture;
    this.faceMat!.needsUpdate = true;
    this.bodyMat = on ? sk.body : sk.normal.body;
    this.backMat = on ? sk.back : sk.normal.back;
    const felt = this.feltMat as THREE.MeshStandardMaterial;
    felt.map = on ? sk.paper : sk.normal.felt;
    felt.needsUpdate = true;
    (this.tableMats!.frame as THREE.MeshStandardMaterial).color.copy(on ? new THREE.Color('#e9e6dc') : sk.normal.frame);
    (this.tableMats!.trim as THREE.MeshStandardMaterial).color.copy(on ? new THREE.Color('#2a2a30') : sk.normal.trim);
    this.roomBase.copy(on ? new THREE.Color('#e4e1d8') : sk.normal.room);
    this.applyRoom();
    for (const e of sk.edges) e.visible = on;
  }

  // 画面四周压暗的一层（中间留出牌桌），散着一闪一闪的星点
  private galeVoidEl: HTMLDivElement | null = null;
  private galeVoid(): HTMLDivElement {
    if (this.galeVoidEl) return this.galeVoidEl;
    const el = document.createElement('div');
    el.className = 'gale-void';
    el.innerHTML = Array.from({ length: 70 }, () => {
      // 只撒在四周：中间那块椭圆是牌桌
      let x = 0;
      let y = 0;
      do {
        x = Math.random();
        y = Math.random();
      } while (((x - 0.5) / 0.42) ** 2 + ((y - 0.5) / 0.4) ** 2 < 1);
      const d = 1.5 + Math.random() * 3;
      return `<i style="left:${(x * 100).toFixed(1)}%;top:${(y * 100).toFixed(1)}%;--s:${(1 + Math.random() * 2).toFixed(1)}px;animation-duration:${d.toFixed(2)}s;animation-delay:${(-Math.random() * d).toFixed(2)}s"></i>`;
    }).join('');
    this.container.appendChild(el);
    this.galeVoidEl = el;
    return el;
  }

  // 房间的颜色：本来的颜色往星空的深紫黑里压（初美的风越浓压得越暗），地板跟着一起
  private applyRoom(): void {
    const c = this.roomBase.clone().lerp(GALE_VOID, this.roomDark);
    this.scene.background = c;
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.copy(c);
    (this.tableMats?.floor as THREE.MeshStandardMaterial | undefined)?.color.copy(c);
  }

  // 现在这一帧的画面（手绘板碎掉时拿来切成碎片）
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/jpeg', 0.85);
  }

  // 深山的雾：每一墩牌山顶上一团，只罩在还有牌的墩上
  private syncMist(g: Game, view: SyncView): void {
    if (this.mistFor !== view.me) {
      this.mistFor = view.me;
      this.mistTops = [0, 1, 2, 3].map((wall) =>
        Array.from({ length: MIST_STACKS }, (_, i) => this.wallPlacement({ wall, stack: i + 1, level: 0, faceUp: false }, view.me).pos.clone().setY(TILE_T * 2)),
      );
    }
    const level = view.mist ?? 0;
    this.mist.setLevel(level);
    const filled = [0, 1, 2, 3].map(() => new Array<boolean>(MIST_STACKS).fill(false));
    for (const slot of wallSlots(g).values()) filled[slot.wall][slot.stack - 1] = true;
    this.mist.setStacks(this.mistTops.map((row, w) => row.map((pos, i) => ({ pos, filled: filled[w][i] }))));
  }

  // 巨引力源：黑色的引力圆，和四边牌山的外沿相切，罩住每边中间的几墩（墩的中心在圆里的：引擎里是 awai.ts 的 sourceCovers，离正中 3 墩以内）。
  // 贴在桌面上，牌压在它上面
  private showGravity(on: boolean): void {
    if (!on) {
      if (this.gravityDisc) this.gravityDisc.visible = false;
      return;
    }
    if (!this.gravityDisc) {
      // 牌山的牌是平躺的，外沿离中心 WALL_Z + 牌高的一半
      const r = WALL_Z + TILE_H / 2;
      const mat = new THREE.MeshBasicMaterial({ map: gravityTexture(), transparent: true, depthWrite: false });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 96), mat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.012;
      // 改良布局的牌山不是正方形（左右往外挪、对家往后推）：圆拉成椭圆、挪一挪，照样和四边牌山的外沿相切
      if (this.v2) {
        const rx = this.wallZ(1) + TILE_H / 2;
        const rz = (this.wallZ(0) + this.wallZ(2)) / 2 + TILE_H / 2;
        disc.scale.set(rx / r, rz / r, 1);
        disc.position.z = (this.wallZ(0) - this.wallZ(2)) / 2;
      }
      disc.renderOrder = 1;
      this.scene.add(disc);
      this.gravityDisc = disc;
    }
    this.gravityDisc.visible = true;
  }

  // 改良布局：自己手牌里的一张牌绕画面的竖直方向转过来正对镜头，返回转好的朝向和放大倍数。
  // 镜头是透视的：两头的牌离镜头远、又是斜着看的，看得到朝里的侧面，一排牌像一道弧。
  // 转过来正对镜头就看不到侧面了；离得远的按距离放大一点，张张一样大（雀魂的手牌是单独一层，没有透视）
  private faceOn(s: number, me: number, x: number, y: number, z: number, rot: THREE.Euler): [THREE.Euler, number] {
    const at = this.toWorld(s, me, x, y, z, rot).pos;
    const fwd = this.rest.look.clone().sub(this.rest.pos).normalize();
    const right = fwd.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(fwd);
    const v = at.sub(this.rest.pos);
    const xc = v.dot(right);
    const yc = v.dot(up);
    const zc = v.dot(fwd);
    const k = this.view25.face ?? 1;
    return [new THREE.Euler(rot.x, -Math.atan2(xc, zc) * k, 0), 1 + (v.length() / Math.hypot(yc, zc) - 1) * k];
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

    // 隐身的桃子：手牌、牌河、副露都看不见；淡掉的那一会儿还摆着
    const vanishing = this.vanish.has(s);
    if (g.stealthed(s, me) && !vanishing) return;

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
    const dealing = !!deal && this.now < deal.start + deal.extra + DEAL_SORT;
    const tilting = !!deal && !dealing && this.now < deal.start + deal.extra + DEAL_SORT + SORT_TILT;
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
    if (!tilting && !this.reveal) this.handEdges[s] = edge;
    const handEdge = mine ? this.sameScreenX(s, me, edge, this.dim.meldZ, this.myHandZ(hs)) : edge;
    const shift = p.melds.length ? Math.max(0, width / 2 - handEdge) : 0;
    let x = -width / 2 - shift + TILE_W / 2;
    // 公开手牌：上家、下家的手牌像倒牌那样摊开；对家的摊开会被牌山挡住，改成转过来牌面朝桌子中间、往后仰
    const open = !mine && !tilting && !!this.lastSync?.view.openHands;
    const facing = open && (s - me + 4) % 4 === 2;
    // 2.5D 镜头高，对家立着的牌下半截被牌山挡住：改成平躺、牌面朝上、字冲我（3D 镜头低，躺下反而全被挡，还是立着往后仰）
    const lie = facing && this.style === '25d';
    const rot = tilting ? COVER_TILT : mine ? new THREE.Euler(this.handTilt, 0, 0) : lie ? FACE_UP : facing ? OPEN_HAND : open ? FACE_UP : STANDING;
    const y = tilting || (open && !facing) || lie ? (TILE_T / 2) * hs : (TILE_H / 2) * hs;
    // 2.5D 时上家、下家、对家的手牌在牌山后面，往桌边推一点（handPush）
    const side = this.handPush((s - me + 4) % 4);
    const hz = (mine ? this.myHandZ(hs) : this.dim.handZ + side + (hs - 1) * 1.2) + (tilting ? (TILE_H / 2) * hs : 0);
    // 倒牌开始后不再更新：和牌以后手牌张数可能变了，倒牌要照着和牌前那一刻的位置
    if (!tilting && !this.reveal) this.handRows[s] = { x0: x, step, hs, z: hz };
    // 2.5D 时自己的手牌两头往中间转一点
    const fan = mine && this.style === '25d' && !tilting ? this.view25.fan : 0;
    const cover = mine && !tilting && !!this.lastSync?.view.riiCover;
    if (mine) this.ghostAt.clear();
    const place = (t: TileId | null) => {
      const lift = mine && t !== null && t === this.hovered && this.clickable.has(t) ? 0.4 : 0;
      const yaw = (fan ? (-fan * (x + shift)) / (width / 2) : 0) + (facing ? Math.PI : 0);
      // 改良布局：自己的手牌每张转过来正对镜头
      const [r, k] = mine && this.v2 && !tilting && !this.view25.ortho ? this.faceOn(s, me, x, y, hz, rot) : [rot, 1];
      if (lift && t !== null) this.hoverRest = { id: t, at: this.toWorld(s, me, x, y, hz, r, yaw, hs * k) };
      if (t !== null && p.hand.includes(t)) {
        if (cover) {
          // 番缚：和配牌理牌那一下一样，整排牌往前一倒扣下去（只绕着横轴转，不翻面不打转），上方浮起一排投影牌面
          // （投影照平常手牌的样子摆，改良布局时也转过来正对镜头）。改良布局的手牌贴着画面底边，
          // 往前倒会掉出画面，改成扣在原地往里一点（扣着的那一排在原来牌脚的里面，投影浮在它上方）
          this.ghostAt.set(t, this.toWorld(s, me, x, y, hz, r, yaw, hs * k));
          const lie = this.v2 ? -(TILE_H / 2) * hs * V2_COVER_IN : (TILE_H / 2) * hs;
          out.set(t, this.toWorld(s, me, x, (TILE_T / 2) * hs, hz + lie, COVER_TILT, 0, hs));
        } else out.set(t, this.toWorld(s, me, x, y + lift, hz, r, yaw, hs * k));
      }
      x += step;
    };
    // 对家公开手牌转过来朝我：从我这边看也是从左往右按顺序排，摸到的牌在我的右手边（她的左手边）
    if (facing) {
      place(drawn);
      x += 0.5;
      [...hand].reverse().forEach(place);
      drawn = null;
    } else hand.forEach(place);
    if (drawn !== null) {
      x += 0.5;
      if (mine && drawn === this.lastSync?.view.airDraw && p.hand.includes(drawn)) {
        const a = this.v2 ? AIR_POSE_V2 : this.airPose;
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
      // 淡掉时那一张是立直宣言牌也竖着放：别人不该知道她立直了
      const side = d.riichi && !(vanishing && d === p.discards[p.discards.length - 1]);
      const w = side ? TILE_H : TILE_W;
      const z = this.dim.pondZ + row * (TILE_H + GAP) + TILE_H / 2;
      // 随机微变化：像真人随手放的，每张牌稍微转一点、偏一点（按牌算好的固定值，重画时不会抖）
      const j = pondJitter(this.pondSalt, d.tile);
      out.set(d.tile, this.toWorld(s, me, px + w / 2 + j.dx, lyingY, z + j.dz, FACE_UP, (side ? Math.PI / 2 : 0) + flip + j.yaw));
      px += w + GAP;
      col++;
    }
  }

  // 一局结束：和牌的人、流局时听牌的人把手牌摊开（倒牌），和的那张放在最右边
  private placeReveal(g: Game, me: number, out: Map<TileId, Placement>): void {
    const rv = this.reveal;
    if (!rv) return;
    for (const [s, win] of this.revealSeats(g)) {
      const wave = (LOOKS[this.lastSync?.view.ids[s] ?? '']?.reveal ?? 'wave') === 'wave';
      const tiles = g.players[s].hand.filter((t) => t !== win).sort((a, b) => a - b);
      // 照着站着时的位置摆，每张牌原地往下倒，不左右挪（自摸的那张本来就在最右边隔开一点的地方）。
      // 改良布局的自己：手牌是放大、挪到眼前的，先在桌面上手牌那条线立起来（桌上牌的大小），再照常往前倒（雀魂那样）
      const back = this.fallsBack(s);
      const row = back ? this.tableRow(s, tiles.length + 1) : this.handRows[s] ?? { x0: 0, step: TILE_W + GAP, hs: 1, z: this.dim.handZ };
      // 竹井久砸下去的那张：一开始砸就一直摆在倒牌后躺的地方（砸的时候手拿着它，砸完正好躺在这里，倒牌时不用动）
      const lying = win !== null && rv.tsumoSlam?.tile === win && rv.tsumoSlam.style === 'hisa' && rv.tsumoSlam.started;
      if (this.now < rv.at) {
        if (back && rv.standAt !== null && this.now >= rv.standAt) this.placeStanding(g, s, me, win, tiles, row, out);
        if (lying) out.set(win, this.winLie(g, s, me, win).at);
        continue;
      }
      let x = row.x0;
      const z = row.z + 0.3 * row.hs;
      const stagger = rv.stagger;
      // 对家倒牌照常往桌子中间倒（字冲她自己）。只有公开手牌时她的牌本来就转过来朝我，
      // 这时接着朝我摆：从我这边看从左往右排，和的那张在我的右手边，不在倒牌时掉头
      const facing = (s - me + 4) % 4 === 2 && !!this.lastSync?.view.openHands;
      const yaw = facing ? Math.PI : 0;
      const topple = (t: TileId, i: number) => {
        if (!rv.topple.has(t)) rv.topple.set(t, { at: rv.at + (wave ? i * stagger : 0), from: null });
      };
      const n = tiles.length;
      tiles.forEach((t, i) => {
        const tx = facing ? row.x0 + 0.5 + (n - i) * row.step : x;
        out.set(t, this.toWorld(s, me, tx, (TILE_T / 2) * row.hs, z, FACE_UP, yaw, row.hs));
        topple(t, i);
        x += row.step;
      });
      if (win === null) continue;
      const tsumo = g.players[s].hand.includes(win);
      const slam = rv.slams.has(win);
      // 自摸的那张跟着一起倒；荣和的那张等倒完再从牌河移过来（改良布局的自己荣和：留在牌河里，照雀魂）。要砸的那张由 animateReveal 搬过去
      if (tsumo || slam || (this.now >= rv.fxAt && !back)) out.set(win, this.winLie(g, s, me, win).at);
      if (tsumo && !slam && !lying) topple(win, tiles.length);
    }
  }

  // 倒牌以后和了牌躺在哪：照着站着时的位置倒，最右边隔开半张（对家公开手牌转过来朝我时在我的右手边、她那一排的 x0）。
  // x 是座位本地坐标里的横向位置
  private winLie(g: Game, s: number, me: number, win: TileId): { at: Placement; x: number } {
    const n = g.players[s].hand.filter((t) => t !== win).length;
    const row = this.fallsBack(s) ? this.tableRow(s, n + 1) : this.handRows[s] ?? { x0: 0, step: TILE_W + GAP, hs: 1, z: this.dim.handZ };
    const facing = (s - me + 4) % 4 === 2 && !!this.lastSync?.view.openHands;
    const x = facing ? row.x0 : row.x0 + n * row.step + 0.5;
    return { at: this.toWorld(s, me, x, (TILE_T / 2) * row.hs, row.z + 0.3 * row.hs, FACE_UP, facing ? Math.PI : 0, row.hs), x };
  }

  // 这个座位的人砸牌用哪一套动作（looks.ts 里没配的是通用的 press）
  private slamStyle(s: number): SlamStyle {
    return LOOKS[this.lastSync?.view.ids[s] ?? '']?.slam ?? 'press';
  }

  // 自摸的那张现在（竹井久伸手拿它的时候）在哪：改良布局的自己是桌上立着那一排右边隔开半张（placeStanding 摆的地方），别人就是现在的样子
  private handSlot(g: Game, s: number, win: TileId): Placement {
    const tile = this.tiles[win].group;
    if (!this.fallsBack(s) || !this.lastSync) return { pos: tile.position.clone(), quat: tile.quaternion.clone(), scale: tile.scale.x };
    const n = g.players[s].hand.filter((t) => t !== win).length;
    const row = this.tableRow(s, n + 1);
    return this.toWorld(s, this.lastSync.view.me, row.x0 + n * row.step + 0.5, TILE_H / 2, row.z, STANDING);
  }

  // 改良布局的自己：倒牌前先在桌上立着摆一排；自摸那张先悬在右边上方，到 placeAt 落下立好（初美要砸的那张不动）
  private placeStanding(g: Game, s: number, me: number, win: TileId | null, tiles: TileId[], row: { x0: number; step: number; z: number }, out: Map<TileId, Placement>): void {
    const rv = this.reveal!;
    let x = row.x0;
    for (const t of tiles) {
      out.set(t, this.toWorld(s, me, x, TILE_H / 2, row.z, STANDING));
      x += row.step;
    }
    if (win === null || !g.players[s].hand.includes(win) || rv.slams.has(win)) return;
    // 要砸的那张：目标就是落点（手捏着它从画面外伸进来，砸到这里）
    const placed = rv.tsumoSlam?.tile === win || (rv.placeAt !== null && this.now >= rv.placeAt);
    out.set(win, this.toWorld(s, me, x + 0.5, TILE_H / 2 + (placed ? 0 : TILE_H * 1.1), row.z, STANDING));
  }

  private wallPlacement(slot: WallSlot, me: number): Placement {
    const x = (STACKS_HALF - slot.stack) * WALL_PITCH;
    const y = slot.level === 0 ? TILE_T * 1.5 : TILE_T * 0.5;
    const rel = (slot.wall - me + 4) % 4;
    const flat = this.style === '25d';
    const out = this.toWorld(slot.wall, me, x, y, this.wallZ(rel), slot.faceUp ? FACE_UP : FACE_DOWN);
    // 往画面下方挪：自己坐在世界的 +z 那边
    if (flat && rel === 1) out.pos.z += RIGHT_WALL_DOWN_25D;
    return out;
  }

  // 姬子的配牌：第一次摆牌时记下她每张牌落在手里哪里；流星都从正上方竖着砸下来
  private aimHimeko(g: Game, hand: Map<TileId, Placement>): void {
    const hk = this.himekoDeal;
    if (!hk || hk.aimed || !this.deal) return;
    hk.aimed = true;
    // 流星在画面上竖着砸下来（2D 也是从画面正上方来）：沿着镜头的“上”方向落，这样不管牌在画面哪边，
    // 火尾在画面上都是竖直的（照世界的竖直方向落的话，透视会让画面两边的火尾歪成斜的）
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
    const list: DescentTile[] = [];
    let scale = 1;
    for (const t of g.players[hk.seat].hand) {
      const hit = hk.land.get(t);
      const dest = hand.get(t);
      if (!hit || !dest) continue;
      scale = dest.scale;
      const axis = up.clone();
      hk.axes.set(t, axis);
      list.push({ pos: dest.pos.clone(), floor: dest.pos.y - (TILE_H / 2) * dest.scale, axis, at: hit.at, accent: hit.accent });
    }
    this.himeko.descend(list, scale);
    if (this.faceMat) {
      if (this.burnMats) for (const m of Object.values(this.burnMats)) m.dispose();
      const glow = (m: THREE.MeshStandardMaterial, k: number) => {
        m.emissive.set('#ff6a12');
        m.emissiveIntensity = k;
        return wet(m);
      };
      this.burnMats = {
        body: glow(new THREE.MeshStandardMaterial({ color: '#ffd8a6', roughness: 0.5 }), 0.85),
        back: glow(new THREE.MeshStandardMaterial({ color: '#ff9a48', roughness: 0.5 }), 1),
        face: glow(this.faceMat.clone(), 0.3),
      };
    }
  }

  // 每帧：流星还在天上的牌照着轨迹摆（越落越快，竖着落、不打转），砸到手里那一下落定；最后一张砸下来画面一震；
  // 理完牌火从她右手边那张烧到左手边那张。要在 animateHands（会清空 held）之后、牌往目标靠拢之前调用
  private updateHimeko(): void {
    const hk = this.himekoDeal;
    this.himeko.update(this.now);
    if (!hk) return;
    for (const t of hk.pending) {
      const hit = hk.land.get(t);
      const axis = hk.axes.get(t);
      const obj = this.tiles[t];
      const dest = obj?.target;
      if (!hit || !axis || !dest) continue;
      const s = (this.now - (hit.at - HIMEKO_FX.drop)) / HIMEKO_FX.drop;
      if (s < 0) continue;
      obj.group.visible = true;
      obj.shown = true;
      if (s >= 1) {
        // 砸到了：落定，桌子跟着一顿
        hk.pending.delete(t);
        // 换回平常的材质（标红之类的特殊材质下一次 sync 会再换上）
        if (this.bodyMat && this.backMat && this.faceMat) [obj.body.material, obj.back.material, obj.face.material] = [this.bodyMat, this.backMat, this.faceMat];
        obj.group.position.copy(dest.pos);
        obj.group.quaternion.copy(dest.quat);
        obj.group.scale.setScalar(dest.scale);
        this.shake = Math.max(this.shake, hit.accent ? 0.5 : 0.2);
        continue;
      }
      this.held.add(t);
      if (this.burnMats) [obj.body.material, obj.back.material, obj.face.material] = [this.burnMats.body, this.burnMats.back, this.burnMats.face];
      obj.group.position.copy(HimekoFx.meteorAt({ pos: dest.pos, axis }, s));
      obj.group.quaternion.copy(dest.quat);
      obj.group.scale.setScalar(dest.scale * (1 + 0.25 * (1 - s)));
    }
    if (!hk.shook && this.now >= hk.final) {
      hk.shook = true;
      this.shake = Math.max(this.shake, 0.5);
    }
    if (hk.fired || this.now < hk.fireAt || !this.lastSync) return;
    hk.fired = true;
    const right = this.seatPoint(hk.seat, 1, 0, 0).normalize();
    const row = this.lastSync.g.players[hk.seat].hand.map((t) => this.tiles[t]?.target).filter((x): x is Placement => !!x);
    if (!row.length) return;
    row.sort((a, b) => b.pos.dot(right) - a.pos.dot(right));
    const sc = row[0].scale;
    const foot = (pl: Placement, out: number) => pl.pos.clone().addScaledVector(right, out * (TILE_W / 2) * sc).setY(pl.pos.y - (TILE_H / 2) * sc * 0.6);
    this.himeko.burn(foot(row[0], 1), foot(row[row.length - 1], -1), this.seatPoint(hk.seat, 0, 0, 1).normalize(), sc, this.now);
  }

  // 发牌动画：还没轮到发的牌先留在牌山里
  private applyDeal(g: Game, me: number, out: Map<TileId, Placement>): void {
    const deal = this.deal;
    if (!deal) return;
    const now = this.now;
    if (now > deal.start + deal.extra + DEAL_END) {
      this.deal = null;
      return;
    }
    // 庄家的第 14 张最后再摸
    const drawn = g.players[deal.dealer].drawn;
    if (drawn !== null && !deal.order.has(drawn)) {
      deal.order.set(drawn, { d: 52, time: deal.start + deal.extra + DEAL_END - 0.25 });
    }
    const hk = this.himekoDeal;
    for (const [t, o] of deal.order) {
      if (!out.has(t)) continue;
      if (now < o.time) out.set(t, this.wallPlacement(drawSlot(deal.dealer, deal.sum, o.d), me));
      else if (hk?.pending.has(t) && now < (hk.land.get(t)?.at ?? -Infinity) - HIMEKO_FX.drop) {
        // 姬子的牌：从牌山里往天上飞走，变成流星砸下来之前看不见
        if (now < o.time + 0.3) {
          const up = this.wallPlacement(drawSlot(deal.dealer, deal.sum, o.d), me);
          up.pos.y += 8;
          out.set(t, up);
        } else out.delete(t);
      }
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
      g.phase === 'predeal',
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
    // 中间的方屏里：局数、本场、余牌、宝牌指示牌、供托
    this.consoleCenter(c, g, view, M, num, title);

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
      if (g.seesRiichi(s, view.me) && !this.v2) drawStick(c, 0, 143, 160, 11);
      c.restore();
    }
    this.consoleTex.needsUpdate = true;
  }

  // 原版仪表盘中间：局数，下面一行本场、余牌，再下面宝牌指示牌和供托
  private consoleCenter(c: CanvasRenderingContext2D, g: Game, view: SyncView, M: number, num: (px: number) => string, title: (px: number) => string): void {
    const k = this.colors.console;
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
    // 发牌前选技能时牌山还没码，余牌写成一横
    c.fillText(`余 ${g.phase === 'predeal' ? '—' : g.wall.remaining}`, M + 12, M + 4);
    c.textAlign = 'center';
    c.fillStyle = k.line;
    c.fillRect(M - 1, M - 10, 2, 28);
    // 宝牌指示牌：翻开的画牌面，没翻的（还有发牌前牌山没码时）画牌背
    const w = 36;
    const h = 48;
    for (let i = 0; i < 5; i++) {
      const t = g.wall.doraIndicators[i];
      const open = i < g.wall.doraRevealed && t !== undefined;
      const x = M + (i - 2.5) * (w + 5) + 2.5;
      const y = M + 28;
      c.fillStyle = open ? '#f6f1e3' : this.colors.back;
      c.beginPath();
      c.roundRect(x, y, w, h, 5);
      c.fill();
      if (open) this.atlas.drawFace(c, faceIndex(t), x, y, w, h);
    }
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
    const myZ = this.myHandZ(v.hand);
    const myHalf = this.myHandHalf();
    const far = d.handZ + TILE_T + this.handPush(2);
    const farSide = d.handZ + TILE_T + Math.max(this.handPush(1), this.handPush(2));
    const side = WALL_Z + TILE_H;
    const pts = [
      // 对家的手牌（立着，算上牌的高度）
      new THREE.Vector3(-side, TILE_H, -far),
      new THREE.Vector3(side, TILE_H, -far),
      // 左右两家的手牌
      new THREE.Vector3(-farSide, TILE_H, -side),
      new THREE.Vector3(farSide, TILE_H, -side),
      new THREE.Vector3(-farSide, 0, side),
      new THREE.Vector3(farSide, 0, side),
      // 自己的手牌，下沿（改良布局让下沿出画面一点：取牌身上靠下的一条线）
      ...[-myHalf, myHalf].map((x) => {
        if (!this.v2) return new THREE.Vector3(x, 0, myZ + TILE_T);
        const t = pitch - THREE.MathUtils.degToRad(v.lean ?? 0);
        const up = TILE_H * v.hand * (v.clip ?? V2_HAND_CLIP);
        return new THREE.Vector3(x, up * Math.cos(t), myZ + TILE_T / 2 - up * Math.sin(t));
      }),
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
    this.handTilt = this.v2 ? -(pitch - THREE.MathUtils.degToRad(v.lean ?? 0)) : -THREE.MathUtils.degToRad(v.tilt);
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

  // 宫永咲的王牌感知：鼠标指着岭上牌（或者它们的投影）时，岭上牌也投影出来
  private checkWallHover(): void {
    const see = this.lastSync?.view.rinshanSeen;
    let on = false;
    if (see?.size) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const groups = [...see].flatMap((id) => [this.tiles[id].group, this.projections.get(id)]).filter((gr): gr is THREE.Group => !!gr?.visible);
      on = this.raycaster.intersectObjects(groups, true).length > 0;
    }
    if (on === this.rinshanHover) return;
    this.rinshanHover = on;
    if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
  }

  // 看得穿的牌变成玻璃：牌身、牌背淡成半透明
  private glassTile(t: TileObj): void {
    t.back.material = this.faded(this.glassBackMat(), 0.25);
    t.body.material = this.faded(this.bodyMat!, 0.3);
    t.body.renderOrder = 1;
    t.back.renderOrder = 2;
  }

  private glassBack: THREE.Material | null = null;
  private glassBackMat(): THREE.Material {
    this.glassBack ??= wet(new THREE.MeshStandardMaterial({ color: '#ffc4d4', emissive: '#ff8fb0', emissiveIntensity: 0.5, roughness: 0.3 }));
    return this.glassBack;
  }

  // 看得穿的牌：上层的牌变成玻璃，牌面透到牌顶上（朝向和那一家的牌一样）；
  // 下层的牌被上层挡着，在它那排牌山前面（往桌子中间）平放一张半透明的投影牌面
  private syncProjections(seen: Set<TileId>, me: number): void {
    for (const [id, gr] of this.projections) if (!seen.has(id)) gr.visible = false;
    for (const id of seen) {
      const slot = this.wallSlotOf.get(id);
      if (!slot) continue;
      const gr = this.projection(id);
      const at = this.projPlacement(slot, me);
      gr.position.copy(at.pos);
      gr.quaternion.copy(at.quat);
      gr.scale.setScalar(slot.level === 0 ? 1 : PROJ_SCALE);
      // 透到牌顶上的牌面不要投影的底板
      gr.children[0].visible = slot.level === 1;
      gr.visible = true;
    }
  }

  private projPlacement(slot: WallSlot, me: number): Placement {
    const x = (STACKS_HALF - slot.stack) * WALL_PITCH;
    const rel = (slot.wall - me + 4) % 4;
    const flat = this.style === '25d';
    const wallZ = this.wallZ(rel);
    // 左右两边（竖着的）牌山转角那一墩：前面正好是横着那排牌山转角墩的投影，所以投到旁边，转角的空地上
    const corner = (rel === 1 || rel === 3) && (slot.stack === 1 || slot.stack === STACKS_HALF * 2 - 1);
    // 上层：贴在牌顶上；下层：牌山前面一排
    const out =
      slot.level === 0
        ? this.toWorld(slot.wall, me, x, TILE_T * 2 + 0.006, wallZ, FACE_UP)
        : corner
          ? this.toWorld(slot.wall, me, x + Math.sign(x) * WALL_PITCH * 1.35, PROJ_Y, wallZ, FACE_UP)
          : this.toWorld(slot.wall, me, x, PROJ_Y, wallZ - TILE_H / 2 - 0.08 - (TILE_H * PROJ_SCALE) / 2, FACE_UP);
    if (flat && rel === 1) out.pos.z += RIGHT_WALL_DOWN_25D;
    return out;
  }

  private projection(id: TileId): THREE.Group {
    let gr = this.projections.get(id);
    if (gr) {
      this.syncProjMap();
      return gr;
    }
    this.projBackMat ??= wet(new THREE.MeshBasicMaterial({ color: '#ffe1ea', transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false }));
    this.projFaceMat ??= wet(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
    this.syncProjMap();
    gr = new THREE.Group();
    const back = new THREE.Mesh(new THREE.PlaneGeometry(TILE_W, TILE_H), this.projBackMat);
    const face = new THREE.Mesh(this.faceGeoms[faceIndex(id)], this.projFaceMat);
    face.position.z = 0.004;
    back.renderOrder = 5;
    face.renderOrder = 6;
    gr.add(back, face);
    this.scene.add(gr);
    this.projections.set(id, gr);
    return gr;
  }

  // 换了牌面皮肤，投影的牌面也跟着换
  private syncProjMap(): void {
    const map = this.faceMat?.map ?? this.atlas.texture;
    if (this.projFaceMat && this.projFaceMat.map !== map) {
      this.projFaceMat.map = map;
      this.projFaceMat.needsUpdate = true;
    }
  }

  private pick(): TileId | null {
    const flatHand = new Set(this.orthoHand());
    if (flatHand.size) {
      this.syncOrtho();
      this.raycaster.setFromCamera(this.pointer, this.orthoCam);
      const own = [...this.clickable].filter((id) => flatHand.has(id)).map((id) => this.tiles[id].group);
      let o: THREE.Object3D | null = this.raycaster.intersectObjects(own, true)[0]?.object ?? null;
      while (o && o.userData.tileId === undefined) o = o.parent;
      if (o) return o.userData.tileId as TileId;
    }
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
        if (!dest || f.t >= DRAW_FADE_OUT + DRAW_FADE_IN) {
          this.setTileOpacity(tile, 1);
          return false;
        }
        const out = f.t < DRAW_FADE_OUT;
        tile.group.position.copy(out ? f.start : dest.pos);
        if (!out) {
          tile.group.quaternion.copy(dest.quat);
          tile.group.scale.setScalar(dest.scale);
        }
        // 淡入先快后慢：一开始就显出大半，实体牌露出来的时间长一点
        const k = (f.t - DRAW_FADE_OUT) / DRAW_FADE_IN;
        this.setTileOpacity(tile, out ? 1 - f.t / DRAW_FADE_OUT : 1 - (1 - k) ** 3);
        this.held.add(f.tile);
        return true;
      }
      if (!dest) return false;
      if (f.t >= DRAW_FLIGHT) {
        // 落下：正好落在手牌的位置、朝向上（之前转身是每帧往目标逼近，落下时还差一点，落进手里以后还在原地转一下）
        tile.group.position.copy(dest.pos);
        tile.group.quaternion.copy(dest.quat);
        tile.group.scale.setScalar(dest.scale);
        return false;
      }
      const k = f.t / DRAW_FLIGHT;
      const e = k * k * (3 - 2 * k);
      tile.group.position.lerpVectors(f.start, dest.pos, e).setY(THREE.MathUtils.lerp(f.start.y, dest.pos.y, e) + Math.sin(k * Math.PI) * 2.2);
      const r = Math.min(1, k / (this.v2 ? DRAW_TURN_V2 : 1));
      const er = r * r * (3 - 2 * r);
      tile.group.quaternion.slerpQuaternions(f.quat, dest.quat, er);
      tile.group.scale.setScalar(THREE.MathUtils.lerp(f.scale, dest.scale, er));
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
    // 立起来、自摸那张落好、开始倒：到了就重摆一次
    if (rv.syncs.length && this.now >= rv.syncs[0]) {
      while (rv.syncs.length && this.now >= rv.syncs[0]) rv.syncs.shift();
      if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
      // 立起来那一下照雀魂是直接换：眼前的大手牌一下子变成桌上立着的一排（不从眼前滑过去）
      if (!rv.snapped && rv.standAt !== null && this.now >= rv.standAt && this.lastSync) {
        rv.snapped = true;
        for (const id of this.lastSync.g.players[this.lastSync.view.me].hand) {
          const t = this.tiles[id];
          if (!t.target) continue;
          t.group.position.copy(t.target.pos);
          t.group.quaternion.copy(t.target.quat);
          t.group.scale.setScalar(t.target.scale);
        }
      }
    }
    const ts = rv.tsumoSlam;
    if (ts && !ts.started && this.now >= ts.start) this.startTsumoSlam(ts);
    if (ts?.started && this.slam.holds(this.tiles[ts.tile].group)) this.held.add(ts.tile);
    if (rv.boltAt !== null && this.now >= rv.boltAt) {
      rv.boltAt = null;
      for (const w of rv.wins) {
        // 初美的和了牌不劈闪电：等手牌倒完自己砸下去。改良布局的自摸砸牌自己炸开了，也不劈
        if (rv.slams.has(w.tile)) continue;
        if (rv.tsumoSlam?.tile === w.tile) continue;
        const at = this.tiles[w.tile].group.position.clone();
        // 从画面上沿（靠中间一点）斜着劈下来：起点和那张牌一样远，牌在画面上方时闪电也不会大半截出了画面
        const p = at.clone().project(this.camera);
        const top = new THREE.Vector3(p.x * 0.3, 1.08, p.z).unproject(this.camera);
        this.effects.bolt(top, at, FX_GOLD, this.camera.position);
      }
      this.effects.later(BOLT_LEADER, () => (this.shake = Math.max(this.shake, 0.5)));
    }
    if (!rv.spotsOn && this.now >= rv.at && rv.wins.length) {
      rv.spotsOn = true;
      this.startSpots(rv);
    }
    if (!rv.fxDone && this.now >= rv.fxAt) {
      rv.fxDone = true;
      if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
      for (const w of rv.wins) {
        const slam = rv.slams.has(w.tile) ? this.tiles[w.tile].group.position.clone() : null;
        this.winFx(w.seat, w.tsumo, slam ? (w.tile === this.seaSlamTile ? MOON_GLOW : '#c870ff') : FX_GOLD, slam);
      }
    }
    this.animateSlams(rv);
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
    this.draw();
  };

  // 调试用：按固定步长快进动画再画一帧，截图测试不受渲染速度影响
  debugAdvance(seconds: number): void {
    for (let t = 0; t < seconds; t += 1 / 30) this.tick(1 / 30);
    this.beforeRender?.();
    this.draw();
  }

  // 画一帧。改良布局（ortho）时自己的手牌另外用没有透视的镜头画在最上面一层
  private draw(): void {
    // 平静的水面照出牌：先从水面下对称的地方画一张倒影
    this.water?.renderMirror(this.scene, this.camera);
    const moving = this.orthoMoving();
    const ids = this.orthoHand().filter((id) => !moving.includes(id));
    if (!ids.length && !moving.length) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const me = this.lastSync?.view.me ?? 0;
    const flying = moving.map((id) => this.tiles[id].group);
    const groups = [...ids.map((id) => this.tiles[id].group), ...flying];
    for (const g of groups) g.traverse((o) => o.layers.set(1));
    // 白水哩的锁链压在手牌上面：手牌那一层画完以后再用主镜头单独画一层（不然被手牌盖住，横着压过手牌的那条整条看不见）。
    // 自己是姬子时：理完牌烧过手牌的火和手牌画在同一层（前后照样互相遮挡），流星的火尾、闪光画在手牌上面
    const hk = this.himekoDeal?.seat === me;
    const withHand = hk ? this.himeko.withHand : [];
    const over = [...this.chains.filter((c): c is ChainFx => !!c && !c.vanished).map((c) => c.group), ...(hk ? this.himeko.overHand : [])];
    for (const o of withHand) o.layers.set(1);
    for (const g of over) g.traverse((o) => o.layers.set(2));
    this.scene.traverse((o) => {
      if (!(o as THREE.Light).isLight) return;
      o.layers.enable(1);
      o.layers.enable(2);
    });
    this.renderer.render(this.scene, this.camera);
    this.syncOrtho();
    const r = this.renderer;
    const auto = r.autoClear;
    r.autoClear = false;
    r.shadowMap.autoUpdate = false;
    r.clearDepth();
    // 背景是纯色时 three 每次画都会先清屏，第二层先把背景拿掉
    const bg = this.scene.background;
    this.scene.background = null;
    // 飞着的牌顺着视线挪到手牌那一排的远近、按远近缩小：没有透视的镜头下，在画面上的位置、大小和主镜头画的一样
    const cam = this.camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const saved = flying.map((g) => {
      const keep = { pos: g.position.clone(), scale: g.scale.x };
      const k = this.orthoDepth / Math.max(1, g.position.clone().sub(cam).dot(fwd));
      g.position.sub(cam).multiplyScalar(k).add(cam);
      g.scale.setScalar(keep.scale * k);
      return keep;
    });
    // 单独一层的自己手牌不泡水（浮在眼前，水涨上来也看得清）
    const sea = SEA.uSea.value.z;
    SEA.uSea.value.z = 0;
    r.render(this.scene, this.orthoCam);
    SEA.uSea.value.z = sea;
    flying.forEach((g, i) => {
      g.position.copy(saved[i].pos);
      g.scale.setScalar(saved[i].scale);
    });
    if (over.length) {
      r.clearDepth();
      const mask = this.camera.layers.mask;
      this.camera.layers.set(2);
      r.render(this.scene, this.camera);
      this.camera.layers.mask = mask;
    }
    this.scene.background = bg;
    r.autoClear = auto;
    r.shadowMap.autoUpdate = true;
    for (const g of groups) g.traverse((o) => o.layers.set(0));
    for (const g of over) g.traverse((o) => o.layers.set(0));
    for (const o of withHand) o.layers.set(0);
  }

  // 改良布局（ortho）：现在要单独画的自己的手牌：在手牌那一排上的（理牌时左右挪也算）；
  // 从牌山飞过来的、打出去正在飞的、配牌时还在牌山上的都不算，照常用主镜头画。
  // 倒牌时还没开始倒的留在这一层，开始倒的那一刻换回主镜头，从眼前倒回桌上
  private orthoHand(): TileId[] {
    const sync = this.lastSync;
    const row = sync && this.handRows[sync.view.me];
    if (!this.orthoOn() || !sync || !row) return [];
    const flying = new Set(this.flights.map((f) => f.tile));
    return sync.g.players[sync.view.me].hand.filter((id) => {
      const t = this.tiles[id];
      if (!t.group.visible || !t.target || flying.has(id)) return false;
      // 自己坐在 +z 那边，手牌那一排的 z 是 row.z：目标和现在的位置都在这一排上才算
      return Math.abs(t.target.pos.z - row.z) < 0.6 && Math.abs(t.group.position.z - row.z) < 0.6;
    });
  }

  private orthoOn(): boolean {
    if (!this.v2 || !this.view25.ortho || !this.lastSync || !this.handRows[this.lastSync.view.me]) return false;
    const rv = this.reveal;
    // 倒牌前在桌上立起来以后，自己的手牌都回到桌上（主镜头）画
    return !(rv && ((rv.standAt !== null && this.now >= rv.standAt) || this.now >= rv.at));
  }

  // 改良布局（ortho）：正往手里来的自己的牌：摸牌飞过来的（摸牌路径关掉时是在手里淡入的那一段）、
  // 姬子配牌从天上砸下来的。整段都画在手牌这一层（draw 里挪到手牌那一排的远近、按远近缩放，
  // 画面上的位置、大小和主镜头画的一样）。不然先用主镜头画、看得到侧面，到了手里那一下换成没有透视的样子，
  // 看起来像牌在手里转了一下
  private orthoMoving(): TileId[] {
    const sync = this.lastSync;
    if (!this.orthoOn() || !sync) return [];
    const me = sync.view.me;
    const hand = sync.g.players[me].hand;
    const out = this.flights.filter((f) => hand.includes(f.tile) && (!f.fade || f.t >= DRAW_FADE_OUT)).map((f) => f.tile);
    // 衣捞上来的海底牌：飞进手里那一段画在手牌这一层
    const sc = this.scoop;
    if (sc && sc.seat === me && sc.t >= SCOOP_TIME - SCOOP_FLY && hand.includes(sc.tile)) out.push(sc.tile);
    const hk = this.himekoDeal;
    if (hk?.seat === me) for (const t of hk.pending) if (this.tiles[t].group.visible && !out.includes(t)) out.push(t);
    return out;
  }

  // 新结算：这一家手牌（倒下的或者还立着的）在画面上的中心，相对牌桌容器的像素；没有牌时 null
  handScreenPos(seat: number): { x: number; y: number } | null {
    const g = this.lastSync?.g;
    if (!g) return null;
    const pts = g.players[seat].hand.map((id) => (this.tiles[id].target?.pos ?? this.tiles[id].group.position).clone());
    if (!pts.length) return null;
    const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
    const p = c.project(this.camera);
    return { x: ((p.x + 1) / 2) * this.container.clientWidth, y: ((1 - p.y) / 2) * this.container.clientHeight };
  }

  // 改良布局里自己倒牌前先回到桌上立起来（手牌平时放大、挪到眼前）
  private fallsBack(s: number): boolean {
    return this.v2 && s === (this.lastSync?.view.me ?? 0);
  }

  // 改良布局：自己倒在桌上的那一排：桌上牌的大小，站在桌面上手牌那条线（和别家一样），
  // 左右居中；有副露时右边不超过副露左边那条线。n 是要摆的张数（算上和的那张）
  private tableRow(s: number, n: number): { x0: number; step: number; hs: number; z: number } {
    const step = TILE_W + GAP;
    const width = n * step + 0.5;
    const edge = this.handEdges[s];
    const shift = this.lastSync?.g.players[s].melds.length && edge !== undefined ? Math.max(0, width / 2 - edge) : 0;
    return { x0: -width / 2 - shift + TILE_W / 2, step, hs: 1, z: this.standZ(s) };
  }

  // 改良布局：自己倒牌那一排站在哪（座位本地 z）。照雀魂：底边和眼前那排大手牌的底边对齐，看起来是同一排牌原地缩小，
  // 不往上跳——往桌边挪到牌底边落在画面底边上面一点（留画面高度的 V2_STAND_MARGIN），最远到桌框里面一点
  private standZ(s: number): number {
    const d = this.dim;
    const me = this.lastSync?.view.me ?? 0;
    if (s !== me) return d.handZ;
    const cam = this.camera.clone();
    cam.position.copy(this.rest.pos);
    cam.lookAt(this.rest.look);
    cam.updateMatrixWorld();
    const bottom = (z: number) => -this.toWorld(s, me, 0, 0, z + TILE_T / 2, STANDING).pos.project(cam).y;
    const goal = 1 - 2 * V2_STAND_MARGIN;
    let a = d.handZ;
    let b = d.tableHalf - TILE_T / 2 - 0.15;
    if (bottom(b) <= goal) return b;
    if (bottom(a) >= goal) return a;
    for (let i = 0; i < 24; i++) {
      const m = (a + b) / 2;
      if (bottom(m) < goal) a = m;
      else b = m;
    }
    return a;
  }

  private syncOrtho(): void {
    const cam = this.camera;
    const o = this.orthoCam;
    o.position.copy(cam.position);
    o.quaternion.copy(cam.quaternion);
    const me = this.lastSync?.view.me ?? 0;
    const row = this.handRows[me] ?? { x0: 0, step: TILE_W + GAP, hs: 1, z: this.dim.handZ };
    const center = this.toWorld(me, me, row.x0 + 6.5 * row.step, (TILE_H / 2) * row.hs, row.z, STANDING).pos;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const depth = center.sub(cam.position).dot(fwd);
    this.orthoDepth = depth;
    const half = depth * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    o.top = half;
    o.bottom = -half;
    o.left = -half * cam.aspect;
    o.right = half * cam.aspect;
    o.near = cam.near;
    o.far = cam.far;
    o.layers.set(1);
    o.updateProjectionMatrix();
    o.updateMatrixWorld();
  }

  private tick(dt: number): void {
    this.now += dt;
    this.checkWallHover();
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
    this.updateHimeko();
    this.animateVanish();
    // 到了倒牌的时间重新摆一次
    if (this.reveal && this.lastSync && this.reveal.topple.size === 0 && this.now >= this.reveal.at && !this.reveal.fxDone) {
      this.sync(this.lastSync.g, this.lastSync.view);
    }
    this.animateReveal();
    this.slam.update(this.now);
    this.slamFx.update(dt);
    this.lily.update(dt);
    this.effects.update(dt);
    this.updateSpots(dt);
    this.mist.update(dt);
    if (this.gale) {
      this.gale.update(dt, this.camera, this.renderer);
      // 风浓的时候四周暗下来（动画里牌桌四周是一片星空）
      if (Math.abs(this.gale.dark - this.roomDark) > 0.002) {
        this.roomDark = this.gale.dark;
        this.applyRoom();
      }
      const veil = this.gale.veil.toFixed(3);
      if (veil !== '0.000' || this.galeVoidEl) {
        const el = this.galeVoid();
        if (el.style.opacity !== veil) el.style.opacity = veil;
      }
    }
    if (this.water) {
      const key = this.keyLight;
      if (key) this.water.setKeyLight(key.position, key.color, key.intensity);
      this.water.update(dt, this.camera.position);
    }
    this.animateScoop(dt);
    this.updateChains(dt);
    this.updateGhosts();
    this.updateGlows();
    // 引力圆慢慢转、一胀一缩
    if (this.gravityDisc?.visible) {
      this.gravityDisc.rotation.z += dt * 0.25;
      this.gravityDisc.scale.setScalar(1 + 0.012 * Math.sin(this.now * 2.2));
    }
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
    this.updateRipple();
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
  private updateRipple(): void {
    const id = this.lastSync?.view.ripple ?? null;
    const on = id !== null && this.tiles[id].group.visible;
    if (on && this.ripples.length === 0) {
      // 用到时才建（建材质会用掉随机数，提前建会让桌布的花纹和以前不一样）
      const geo = new THREE.RingGeometry(0.82, 1, 48);
      for (let i = 0; i < RIPPLE_RINGS; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 2;
        this.scene.add(m);
        this.ripples.push(m);
      }
    }
    if (!on) {
      for (const m of this.ripples) m.visible = false;
      return;
    }
    const g = this.tiles[id].group;
    // 牌立着：中心往下半个牌高就是桌面
    const y = Math.max(0.006, g.position.y - (TILE_H / 2) * g.scale.x + 0.006);
    this.ripples.forEach((m, i) => {
      const k = (this.now / RIPPLE_PERIOD + i / RIPPLE_RINGS) % 1;
      m.visible = true;
      m.position.set(g.position.x, y, g.position.z);
      m.scale.setScalar(TILE_W * g.scale.x * (0.3 + 0.85 * k));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k) * Math.min(1, k * 6);
    });
  }

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

// 迷途之家的水波纹：几圈、多久扩一次（秒）
const RIPPLE_RINGS = 3;
const RIPPLE_PERIOD = 1.8;

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
    stickMat = wet(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }));
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

// 巨引力源的贴图：中间透一点能看清桌子，越往外越黑，边上一圈紫色的光；几道旋臂让它转起来看得出来
function gravityTexture(): THREE.CanvasTexture {
  const n = 512;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const h = n / 2;
  const grad = ctx.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, 'rgba(8, 4, 20, 0.18)');
  grad.addColorStop(0.55, 'rgba(6, 3, 16, 0.42)');
  grad.addColorStop(0.86, 'rgba(2, 1, 8, 0.72)');
  grad.addColorStop(0.95, 'rgba(120, 80, 255, 0.55)');
  grad.addColorStop(0.985, 'rgba(40, 20, 90, 0.35)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, n, n);
  // 旋臂
  ctx.globalCompositeOperation = 'source-atop';
  ctx.strokeStyle = 'rgba(150, 120, 255, 0.16)';
  ctx.lineWidth = 6;
  for (let arm = 0; arm < 4; arm++) {
    ctx.beginPath();
    for (let t = 0; t <= 1; t += 0.01) {
      const a = arm * (Math.PI / 2) + t * Math.PI * 1.6;
      const r = h * (0.12 + 0.82 * t);
      const x = h + Math.cos(a) * r;
      const y = h + Math.sin(a) * r;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 手绘板的桌布：白纸上淡淡的方格，一圈铅笔框，角上几笔涂鸦
function paperTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fbfaf5';
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.strokeStyle = 'rgba(120,150,200,0.22)';
  ctx.lineWidth = 1.5;
  for (let x = 0; x <= 1024; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 1024);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, x);
    ctx.lineTo(1024, x);
    ctx.stroke();
  }
  // 铅笔描的框：两圈，抖一点
  ctx.strokeStyle = 'rgba(40,40,48,0.75)';
  ctx.lineCap = 'round';
  for (const [inset, w] of [[150, 4], [162, 2]] as const) {
    ctx.lineWidth = w;
    const pts = [[inset, inset], [1024 - inset, inset], [1024 - inset, 1024 - inset], [inset, 1024 - inset]];
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % 4];
      ctx.beginPath();
      ctx.moveTo(x1 - (x2 - x1) * 0.02, y1 - (y2 - y1) * 0.02);
      ctx.quadraticCurveTo((x1 + x2) / 2 + (Math.random() - 0.5) * 8, (y1 + y2) / 2 + (Math.random() - 0.5) * 8, x2 + (x2 - x1) * 0.02, y2 + (y2 - y1) * 0.02);
      ctx.stroke();
    }
  }
  // 角上的小涂鸦：星星、螺旋
  ctx.strokeStyle = 'rgba(216,70,60,0.55)';
  ctx.lineWidth = 3;
  const star = (cx: number, cy: number, r: number) => {
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.stroke();
  };
  star(84, 84, 30);
  star(940, 940, 26);
  ctx.strokeStyle = 'rgba(47,111,204,0.5)';
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 6; a += 0.2) ctx.lineTo(940 + Math.cos(a) * a * 3.2, 84 + Math.sin(a) * a * 3.2);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 手绘板的牌背：白底上铅笔斜线排线
function hatchTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fdfdf8';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(60,60,80,0.45)';
  ctx.lineWidth = 3;
  for (let i = -128; i < 256; i += 18) {
    ctx.beginPath();
    ctx.moveTo(i, 128);
    ctx.lineTo(i + 128, 0);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// zones：改良布局时桌子的半宽，从控制台四角往桌角画四条细线，把桌面分成四家的地盘（雀魂那样）；0 是原版的一圈方框
function feltTexture(colors: TableColors, zones = 0): THREE.CanvasTexture {
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
  if (zones) {
    const px = 512 / zones;
    const a = (CONSOLE_HALF + 0.25) * px;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(512 + sx * a, 512 + sy * a);
      ctx.lineTo(512 + sx * 512, 512 + sy * 512);
      ctx.stroke();
    }
  } else {
    ctx.strokeRect(150, 150, 724, 724);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
