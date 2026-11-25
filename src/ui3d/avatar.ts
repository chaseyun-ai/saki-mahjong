import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMHumanBoneName, VRMLoaderPlugin, type VRMSpringBoneJointSettings, VRMUtils } from '@pixiv/three-vrm';
import type { RestPose } from './looks';
import { DEFAULT_DISCARD } from './discardMotion';
import { forgetOthers, loadCached, saveCached } from './modelCache';

// 坐在牌桌边的 VRM 角色：坐姿、呼吸、眨眼、视线、表情，以及用右手去拿牌（两段骨骼 IK）。
// 模型面朝本地 -z（牌桌中心）。

export type Mood = 'happy' | 'sad' | 'angry' | 'surprised' | 'relaxed';

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

// 同一个模型文件只下载一次，每个座位各自解析一份。先找浏览器本地存的，没有再下载
const fileCache = new Map<string, Promise<ArrayBuffer>>();
// 每个文件下载了几成（0 到 1），不知道文件多大时下完之前一直是 0
const fileProgress = new Map<string, number>();

function fetchModel(url: string): Promise<ArrayBuffer> {
  let p = fileCache.get(url);
  if (!p) {
    fileProgress.set(url, 0);
    // 玩家自己导入的模型（blob: 网址）本来就在浏览器里，不用再存一份
    const local = url.startsWith('blob:');
    p = (async () => {
      const buf = (local ? null : await loadCached(url)) ?? (await download(url, !local));
      fileProgress.set(url, 1);
      return buf;
    })();
    // 下载失败的下次再试
    p.catch(() => fileCache.delete(url));
    fileCache.set(url, p);
  }
  return p;
}

// 发布页不能直接提供 .glb，那里的模型是 base64 文本（.glb.txt），自己解码
async function download(url: string, keep = true): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  // 压缩传输时 Content-Length 是压缩后的大小，和读到的字节数对不上，就不算进度了
  const total = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length')) || 0;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (total) fileProgress.set(url, Math.min(0.99, loaded / total));
    }
  } else {
    chunks.push(new Uint8Array(await res.arrayBuffer()));
  }
  let bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  if (url.endsWith('.txt')) {
    const raw = atob(new TextDecoder().decode(bytes).trim());
    bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  }
  if (keep) void saveCached(url, bytes.buffer);
  return bytes.buffer;
}

// 选人的时候就在后台开始下载，进牌桌时多半已经下好了；顺便删掉浏览器里存的旧版本模型
export function preloadModels(urls: string[]): void {
  for (const url of urls) fetchModel(url).catch(() => {});
  void forgetOthers(urls);
}

// 这几个模型一共下载了几成（0 到 1）
export function modelProgress(urls: string[]): number {
  if (urls.length === 0) return 1;
  return urls.reduce((sum, url) => sum + (fileProgress.get(url) ?? 0), 0) / urls.length;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const axisQ = (axis: THREE.Vector3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a);

// 伸手时的前倾：手臂最多伸到几成长（留一点弯，不绷得笔直）、伸手时至少俯多少（弧度）、
// 俯的时候背再跟着弓多少（占前倾的几成）、头往回抬多少（占前倾的几成，免得脸冲着桌面）
const REACH_K = 0.94;
const LEAN_MIN = 0.05;
const LEAN_CURL = 0.12;
const LEAN_HEAD_UP = 0.6;
// 长头发：硬度留几成、重力至少多少（VRM 弹簧骨骼的 stiffness、gravityPower；导出时硬度 0.4–0.9、重力 0–0.08）；
// 一束头发从发根到最后一节骨头不到 HAIR_SHORT 米算短的（不动），超过 HAIR_LONG 米算长的。
// 量过的：刘海 0.05–0.15，披肩发 0.15–0.21，过肩的长发、马尾 0.3 以上
const HAIR_STIFF = 0.3;
const HAIR_GRAVITY = 0.8;
const HAIR_SHORT = 0.16;
const HAIR_LONG = 0.28;

// 手心朝下要前臂拧多少：拧在前臂这根骨头上的只占这么多，其余的拧在手腕上。
// 整根前臂一起拧的话，肘关节的皮肤会拧成一道褶（真人的前臂也是肘不转、越靠手腕转得越多）
const FOREARM_TWIST = 0.35;
// 手型往想要的样子靠拢有多快（每秒）
const GRIP_RATE = 24;
// 肘部偏离肩腕连线的方向：往外侧、往下、往身后各占多少
const ELBOW_OUT = 0.45;
const ELBOW_DOWN = 0.8;
const ELBOW_BACK = 0.6;
// 手腕：左右最多摆多少、和前臂最多夹多大的角（弧度）；捏着牌时手放平一些（往下压的角度减掉这么多成），靠手指弯下去够牌
const WRIST_YAW = 0.6;
const WRIST_MAX = 1.15;
const PINCH_LEVEL = 0.5;
// 伸手的路线：过桌沿的那个点在桌框外沿靠身体这边多远（米）；伸出去几成时到那个点。
// 牌桌给的“伸出去几成”是先快后慢的，0.78 成大约是伸手时间的四成：四成时间抬手，六成时间往前伸、对准
const REACH_GAP = 0.06;
const REACH_SPLIT = 0.78;
// 抬手那一段的快慢：照“伸出去几成”的几次方走（牌桌给的是先快后慢，一上来就窜一大截；乘方以后是慢起步）
const LIFT_EASE = 2.2;
// 手从腿上抬到桌面以上的路上要收拢：抬手那一段走了几成时收好；手腕比桌面高出多少开始放开、放开完（占过桌沿那个高度的几成）
const TUCK_IN = 0.3;
const TUCK_OUT: [number, number] = [0.25, 0.85];
// 收拢时手立起来多少（弧度，手指朝上）
const TUCK_PITCH = 1.05;
// 肘在桌框上方时至少比桌面高多少（米）
const FRAME_CLEAR = 0.03;
// 捏牌用的是拇指和食指、中指，这个捏点在手掌中线的拇指一侧：手腕往小指那边让这么多（米），捏点才对着牌的正中
const PINCH_SIDE = 0.022;

// 手型：四根手指（食指到小指）每一节往手心弯多少（弧度：近节、中节、远节），
// 拇指往手心底下转多少、往食指那边收多少、后两节弯多少
interface HandShape {
  curl: [number, number, number][];
  thumbDown: number;
  thumbIn: number;
  thumbCurl: number;
}
// 张开（刚松手）、放松（平时，手搭在腿上）、捏着牌（拇指在牌朝自己的一面，食指中指在另一面；无名指小指收紧在手心里，
// 松松地垂着的话指尖比牌山顶还低，手斜着去拿边上的牌时会碰到牌山）。
// 拇指的三个数是量着求出来的：拇指差不多伸直，顺着牌朝自己的那一面贴下去，指尖在捏点下面三厘米、离牌的中线两厘米
// （牌按人物的比例有将近三厘米厚；两种格式的模型各求了一遍，差不到半厘米）。照着指尖对指尖去求的话拇指要往回勾，像爪子
const HAND_OPEN: HandShape = { curl: [[0.1, 0.12, 0.08], [0.1, 0.14, 0.08], [0.14, 0.18, 0.1], [0.2, 0.24, 0.12]], thumbDown: 0.2, thumbIn: -0.12, thumbCurl: 0.05 };
const HAND_RELAX: HandShape = { curl: [[0.28, 0.38, 0.22], [0.34, 0.45, 0.26], [0.42, 0.52, 0.3], [0.5, 0.6, 0.34]], thumbDown: 0.35, thumbIn: 0.12, thumbCurl: 0.18 };
// 收拢：松松地握着（手从腿上抬起来、穿过身体和桌沿之间那道缝的时候）
const HAND_TUCK: HandShape = { curl: [[1.05, 1.25, 0.7], [1.1, 1.3, 0.72], [1.15, 1.32, 0.74], [1.2, 1.35, 0.75]], thumbDown: 0.45, thumbIn: 0.5, thumbCurl: 0.35 };
const HAND_PINCH: HandShape = { curl: [[0.52, 0.7, 0.3], [0.56, 0.72, 0.32], [1.3, 1.4, 0.8], [1.35, 1.45, 0.8]], thumbDown: 0.55, thumbIn: 0.6, thumbCurl: 0.3 };
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'] as const;
const DOWN = new THREE.Vector3(0, -1, 0);

// 一只手的手指骨头，和它们各自往手心弯的转轴（骨头自己的坐标；按模型静止时手指的朝向算，左右手、VRM 0.x 和 1.0 都通用）
interface HandRig {
  fingers: { joints: THREE.Object3D[]; axis: THREE.Vector3 }[];
  thumb: { joints: THREE.Object3D[]; down: THREE.Vector3; inSign: number } | null;
}
// 手臂在规范骨架静止姿势（T 字）里的朝向（骨头自己的坐标）：上臂、前臂各指向哪，肘往前弯时绕哪根轴转
interface ArmRest {
  upper: THREE.Vector3;
  lower: THREE.Vector3;
  hinge: THREE.Vector3;
}

// 弹簧骨骼（头发、裙摆）每一节的运动状态。three-vrm 没有公开存取的接口，调试场景要原样存下来再放回去
interface SpringState {
  bone: THREE.Object3D;
  _currentTail: THREE.Vector3;
  _prevTail: THREE.Vector3;
}

export class Avatar {
  readonly root = new THREE.Group();
  readonly lookTarget = new THREE.Object3D();
  private time = Math.random() * 10;
  private nextBlink = 2;
  private blinkT = -1;
  // 视线：想看的点、眼睛实际看着的点（平滑移过去）、头转了多少
  private lookWant = new THREE.Vector3(0, 0, -10);
  private lookNow = new THREE.Vector3(0, 0, -10);
  private lookHoldUntil = 0;
  private headYaw = 0;
  private headPitch = 0;
  // 没事做时视线的落点：自己的手牌，偶尔瞟一眼别人
  home: THREE.Vector3 | null = null;
  glances: THREE.Vector3[] = [];
  private nextGlance = 3 + Math.random() * 4;
  private mood: { name: Mood; until: number } | null = null;
  private moodWeights = new Map<Mood, number>();
  private base = new Map<VRMHumanBoneName, THREE.Quaternion>();
  // VRM 0.x 模型本身朝 -z，所有姿势旋转要绕 y 轴翻转半圈再用
  private flip: THREE.Quaternion | null = null;
  // 右手要去的位置（世界坐标）和权重，0 是手放在休息的位置，1 是完全伸到目标
  reachTarget: THREE.Vector3 | null = null;
  reachWeight = 0;
  // 伸手时的弧线高度、前倾上限、手腕弯曲，出牌时由出牌参数决定
  tuning: { arcMax: number; leanMax: number; wristBend: number } = DEFAULT_DISCARD;
  // 双手休息的位置（模型自身坐标，右手 +x）：桌沿上，或者放在腿上
  private rest: { left: THREE.Vector3; right: THREE.Vector3 } | null = null;
  private restPose: RestPose = 'edge';
  // 桌面在哪（模型自身坐标）：高度、桌沿（桌布的边）、胳膊肘在桌布上方时至少比桌面高多少、桌框多宽
  private table: { y: number; edgeZ: number; clear: number; frame: number } | null = null;
  private fpReady = false;
  // 站立时髋部离脚底的高度（模型自身单位），用来把角色放到椅子高度
  readonly hipHeight: number;
  readonly stature: number;
  // 坐高：髋到头骨根部（模型自身单位）。入座时按它把高矮不一的模型缩放到一样高（tableLayout.ts 的 fitScale）
  readonly sitHeight: number;
  // 伸手够牌要用的身材：髋和右肩关节坐好时的位置（模型自身坐标）、肩到腕的手臂长度
  private hipRest = new THREE.Vector3(0, 0.9, 0);
  private shoulderRest: THREE.Vector3 | null = null;
  private armLength = 0.43;
  // 这一帧身体从髋部往前倾了多少（弧度），头要往回抬一些
  private leanNow = 0;
  // 手腕的目标比手指要捏的那个点靠后、靠上多少（世界坐标），牌桌每帧给；有了它手才能按自己实际的朝向把捏点对准（见 update）
  reachHold: THREE.Vector3 | null = null;
  // 右手这一帧要收拢几成（见 reachPath）
  private tuck = 0;
  // 右手的朝向比正前方还偏着多少没掰回来（弧度，解手臂时记下）
  private wristOff = 0;
  // 右手的手型：-1 张开，0 放松，1 捏着牌。牌桌按动作的进度每帧给（出牌见 discardMotion 的 gripAt），手指慢慢跟过去
  grip = 0;
  private gripNow = 0;
  private arms: Record<'left' | 'right', ArmRest | null> = { left: null, right: null };
  private hands: Record<'left' | 'right', HandRig | null> = { left: null, right: null };
  // 弹簧骨骼（头发、裙摆）每一节原来的硬度、重力、碰撞半径，和现在是按放大多少倍算的（见 fitSprings）
  private springBase: { settings: VRMSpringBoneJointSettings; stiffness: number; gravityPower: number; hitRadius: number }[] = [];
  private springScale = 1;
  // 动作调试场景每次重放的起点：头的朝向、视线，还有头发、衣服这些弹簧骨骼当时的状态
  private idle: {
    lookNow: THREE.Vector3;
    lookWant: THREE.Vector3;
    headYaw: number;
    headPitch: number;
    springs: { joint: SpringState; quat: THREE.Quaternion; cur: THREE.Vector3; prev: THREE.Vector3 }[];
  } | null = null;

  private constructor(readonly vrm: VRM) {
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.combineSkeletons(vrm.scene);
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    const vrm0 = vrm.meta?.metaVersion === '0';
    if (vrm0) this.flip = axisQ(Y, Math.PI);
    // VRM 1.0 模型面朝 +z，转过来朝向桌子中心；0.x 本来就朝 -z
    vrm.scene.rotation.y = vrm0 ? 0 : Math.PI;
    this.root.add(vrm.scene);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    this.sitDown();
    vrm.scene.updateMatrixWorld(true);
    const hips = this.bone('hips');
    this.hipHeight = hips ? hips.getWorldPosition(new THREE.Vector3()).y : 0.9;
    // 大约的身高：头骨根部的高度再加上脑袋（二次元的头大，按 14% 算）
    const head = this.bone('head');
    const headY = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.4;
    this.stature = headY * 1.14;
    this.sitHeight = Math.max(0.2, headY - this.hipHeight);
    // 这时候 root 还没放进场景（没有位移和缩放），骨骼的世界坐标就是模型自身坐标
    const at = (n: VRMHumanBoneName) => this.bone(n)?.getWorldPosition(new THREE.Vector3()) ?? null;
    const [sh, el, wr] = [at('rightUpperArm'), at('rightLowerArm'), at('rightHand')];
    if (hips) this.hipRest.copy(hips.getWorldPosition(new THREE.Vector3()));
    if (sh && el && wr) {
      this.shoulderRest = sh;
      this.armLength = sh.distanceTo(el) + el.distanceTo(wr);
    }
    for (const side of ['left', 'right'] as const) {
      this.arms[side] = this.armRig(side);
      this.hands[side] = this.handRig(side);
    }
    // 头发：VRoid 导出的发束几乎没有重力（多数是 0），全靠硬度撑着站立时相对头的形状。
    // 牌桌上人是低着头看牌、俯身出牌的，照那样长头发会整片翘在脑后。长的发束改成以下垂为主：硬度减到三成，重力加够。
    // 刘海、短发这些短的发束不动（改了会垂下来挡住脸），长短之间平滑过渡
    const isHair = (o: THREE.Object3D | null) => !!o && /hair/i.test(o.name);
    const lengths = new Map<THREE.Object3D, number>();
    const hairLength = (bone: THREE.Object3D): number => {
      let top = bone;
      while (isHair(top.parent)) top = top.parent!;
      let len = lengths.get(top);
      if (len === undefined) {
        const from = top.getWorldPosition(new THREE.Vector3());
        const p = new THREE.Vector3();
        len = 0;
        top.traverse((o) => (len = Math.max(len!, o.getWorldPosition(p).distanceTo(from))));
        lengths.set(top, len);
      }
      return len;
    };
    for (const j of vrm.springBoneManager?.joints ?? []) {
      const s = j.settings;
      const long = isHair(j.bone) ? THREE.MathUtils.smoothstep(hairLength(j.bone), HAIR_SHORT, HAIR_LONG) : 0;
      this.springBase.push({
        settings: s,
        stiffness: s.stiffness * THREE.MathUtils.lerp(1, HAIR_STIFF, long),
        gravityPower: Math.max(s.gravityPower, HAIR_GRAVITY * long),
        hitRadius: s.hitRadius,
      });
    }
  }

  // 弹簧骨骼的硬度、重力、碰撞半径在 three-vrm 里是世界单位的量，不跟着模型放大：牌桌上人物放大了二十多倍，
  // 骨头长了二十多倍，回弹和重力还是原来那么点，头发就又软又没分量，身子一动飘半天落不下来。
  // 按放大倍数乘回去，动起来和模型在 VRoid 里设计的一样
  private fitSprings(): void {
    const k = this.root.scale.x;
    if (k === this.springScale) return;
    this.springScale = k;
    for (const b of this.springBase) {
      b.settings.stiffness = b.stiffness * k;
      b.settings.gravityPower = b.gravityPower * k;
      b.settings.hitRadius = b.hitRadius * k;
    }
  }

  static async load(url: string): Promise<Avatar> {
    const buf = await fetchModel(url);
    const gltf = await loader.parseAsync(buf, '');
    return new Avatar(gltf.userData.vrm as VRM);
  }

  // 没事做时手放哪。tableY、edgeZ 是桌面高度和桌沿位置（模型自身坐标，-z 朝桌子）；
  // clear 是伸到桌布上方的胳膊肘至少比桌面高多少（要越过立着的手牌和牌山），frame 是桌框多宽（桌沿往外到桌框外沿）
  setRestPose(tableY: number, edgeZ: number, pose: RestPose, clear = 0, frame = 0): void {
    this.table = { y: tableY, edgeZ, clear, frame };
    this.restPose = pose;
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const hip = this.hipHeight;
    if (pose === 'offscreen') {
      // 自己：手在桌沿外侧，刚好在镜头外
      this.rest = { left: v(-0.17, tableY - 0.01, edgeZ + 0.15), right: v(0.17, tableY - 0.01, edgeZ + 0.15) };
    } else if (pose === 'lap') {
      // 双手搭在大腿上
      // 手腕靠近大腿根：再往前手指就伸到桌子底下去了，抬手的时候没有地方出来
      this.rest = { left: v(-0.12, hip + 0.08, -0.1), right: v(0.12, hip + 0.08, -0.1) };
    } else if (pose === 'crossed') {
      // 抱胸：两只手腕在胸前交叉，一前一后
      // 抱胸：前臂在胸前交叉，手腕搭到另一边的胳膊肘上
      this.rest = { left: v(0.15, hip + 0.3, -0.17), right: v(-0.15, hip + 0.33, -0.14) };
    } else {
      // 双手轻轻扶着桌沿
      this.rest = { left: v(-0.19, tableY + 0.015, edgeZ - 0.01), right: v(0.19, tableY + 0.015, edgeZ - 0.01) };
    }
  }

  // 动作调试场景用：记下现在静止的样子，之后每次重放都从这里开始
  captureIdle(): void {
    const joints = [...(this.vrm.springBoneManager?.joints ?? [])] as unknown as SpringState[];
    this.idle = {
      lookNow: this.lookNow.clone(),
      lookWant: this.lookWant.clone(),
      headYaw: this.headYaw,
      headPitch: this.headPitch,
      springs: joints.map((joint) => ({ joint, quat: joint.bone.quaternion.clone(), cur: joint._currentTail.clone(), prev: joint._prevTail.clone() })),
    };
  }

  // 回到记下的样子，呼吸、眨眼、瞟人的时机也从零算起，同一时刻的画面每次重放都一样
  resetIdle(): void {
    const s = this.idle;
    if (s) {
      this.lookNow.copy(s.lookNow);
      this.lookWant.copy(s.lookWant);
      this.headYaw = s.headYaw;
      this.headPitch = s.headPitch;
    }
    this.time = 0;
    this.nextBlink = 2.5;
    this.blinkT = -1;
    this.nextGlance = 8;
    this.lookHoldUntil = 0;
    this.mood = null;
    this.moodWeights.clear();
    if (!s) return;
    // 先不推进时间摆回休息姿势，再放回头发的状态，最后整体刷新一遍位置：
    // 物理第一步用到的骨骼位置就和上一次重放停在哪里无关了
    this.reachWeight = 0;
    this.update(0);
    for (const { joint, quat, cur, prev } of s.springs) {
      // 弹簧骨骼不自动更新局部矩阵，要手动算一次
      joint.bone.quaternion.copy(quat);
      joint.bone.updateMatrix();
      joint._currentTail.copy(cur);
      joint._prevTail.copy(prev);
    }
    // 逐个刷新（不用 updateMatrixWorld）：弹簧骨骼的碰撞体只在 updateWorldMatrix 里更新自己的位置
    this.root.updateMatrixWorld(true);
    this.vrm.scene.traverse((o) => o.updateWorldMatrix(false, false));
  }

  // 第一人称：藏起自己的头，不挡镜头；on 为 false 时换回第三人称，从外面看整个人
  setFirstPerson(camera: THREE.Camera, on = true): void {
    const fp = this.vrm.firstPerson;
    if (!fp) return;
    if (!this.fpReady) fp.setup();
    this.fpReady = true;
    camera.layers.set(0);
    camera.layers.enable(on ? fp.firstPersonOnlyLayer : fp.thirdPersonOnlyLayer);
  }

  // 右手 IK 这一帧实际要去的位置（休息位置和目标按权重混合、加上弧线之后）
  readonly rightGoal = new THREE.Vector3();

  // 右臂各关节现在的世界坐标：肩、肘、手腕、食指指尖
  rightArm(): { shoulder: THREE.Vector3; elbow: THREE.Vector3; wrist: THREE.Vector3; tip: THREE.Vector3 } {
    const at = (o: THREE.Object3D | null | undefined) => (o ? o.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3());
    const raw = (n: VRMHumanBoneName) => this.vrm.humanoid?.getRawBoneNode(n) ?? null;
    const wrist = at(raw('rightHand'));
    // 指尖：最后一节食指往外的端点；模型没有端点就按最后一节的方向延长
    const distal = raw('rightIndexDistal');
    let tip = wrist.clone();
    if (distal) {
      const end = distal.children.find((c) => !(c as THREE.Bone).isBone || c.children.length === 0);
      const d = at(distal);
      if (end) tip = at(end);
      else {
        const mid = at(raw('rightIndexIntermediate'));
        tip = d.clone().add(d.clone().sub(mid).multiplyScalar(0.8));
      }
    }
    return { shoulder: at(raw('rightUpperArm')), elbow: at(raw('rightLowerArm')), wrist, tip };
  }

  // 试用手模的时候把自己的右臂（连手）缩到肩膀上藏起来
  hideRightArm(on: boolean): void {
    this.vrm.humanoid?.getRawBoneNode('rightUpperArm')?.scale.setScalar(on ? 0.001 : 1);
  }

  private bone(name: VRMHumanBoneName): THREE.Object3D | null {
    return this.vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
  }

  private local(q: THREE.Quaternion): THREE.Quaternion {
    if (!this.flip) return q;
    return this.flip.clone().multiply(q).multiply(this.flip.clone().invert());
  }

  private pose(name: VRMHumanBoneName, q: THREE.Quaternion): void {
    const b = this.bone(name);
    if (!b) return;
    const lq = this.local(q);
    b.quaternion.copy(lq);
    this.base.set(name, lq.clone());
  }

  // 坐姿：大腿向前、小腿向下，双手放在桌沿
  private sitDown(): void {
    const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
    const armDown = (side: 1 | -1) => axisQ(X, -0.85).multiply(axisQ(Z, -side * 1.2));
    this.pose('leftUpperLeg', q(-Math.PI / 2, 0, 0.08));
    this.pose('rightUpperLeg', q(-Math.PI / 2, 0, -0.08));
    this.pose('leftLowerLeg', q(Math.PI / 2, 0, 0));
    this.pose('rightLowerLeg', q(Math.PI / 2, 0, 0));
    this.pose('spine', q(0.1, 0, 0));
    this.pose('leftUpperArm', armDown(1));
    this.pose('rightUpperArm', armDown(-1));
    this.pose('leftLowerArm', q(0, -1.25, 0));
    this.pose('rightLowerArm', q(0, 1.25, 0));
  }

  // 视线看向世界坐标里的一点
  // 视线看向世界坐标里的一点，hold 秒内不会自己移开
  lookAtPoint(p: THREE.Vector3, hold = 2): void {
    this.lookWant.copy(p);
    this.lookHoldUntil = this.time + hold;
  }

  // 世界坐标的点换算成以模型自身朝向为准的偏航、俯仰角（+z 朝前，按 VRM 1.0 的约定）
  private aimAngles(p: THREE.Vector3, from: THREE.Object3D): { yaw: number; pitch: number } {
    const origin = from.getWorldPosition(new THREE.Vector3());
    const d = this.root.worldToLocal(p.clone()).sub(this.root.worldToLocal(origin));
    // 本地 -z 是前方；换成模型的 +z 朝前
    const mx = -d.x;
    const mz = -d.z;
    return { yaw: Math.atan2(mx, mz), pitch: Math.atan2(-d.y, Math.hypot(mx, mz)) };
  }

  setMood(name: Mood, seconds: number): void {
    this.mood = { name, until: this.time + seconds };
  }

  // 让骨骼 bone 转动，使它的子骨骼 child 指向世界坐标 goal
  private aim(bone: THREE.Object3D, child: THREE.Object3D, goal: THREE.Vector3): void {
    const from = bone.getWorldPosition(new THREE.Vector3());
    const cur = child.getWorldPosition(new THREE.Vector3()).sub(from).normalize();
    const want = goal.clone().sub(from).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(cur, want);
    const world = delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(world));
    bone.updateMatrixWorld(true);
  }

  // 两段骨骼 IK：肩、肘、手腕，肘部朝下外侧
  private solveArm(side: 'left' | 'right', target: THREE.Vector3): void {
    const upper = this.bone(`${side}UpperArm`);
    const lower = this.bone(`${side}LowerArm`);
    const hand = this.bone(`${side}Hand`);
    if (!upper || !lower || !hand) return;
    this.root.updateMatrixWorld(true);
    const s = upper.getWorldPosition(new THREE.Vector3());
    const e = lower.getWorldPosition(new THREE.Vector3());
    const h = hand.getWorldPosition(new THREE.Vector3());
    const a = s.distanceTo(e);
    const b = e.distanceTo(h);
    const toT = target.clone().sub(s);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-4, (a + b) * 0.999);
    const dir = toT.normalize();
    // 肘部往哪边偏：往下、往身后收，再往外侧一点（外侧是从身体中线指向这只手的方向，身后是模型自己的 +z）。
    // 肘收在身侧靠后，前臂才是朝前伸的、手正对着要拿的牌；只往外撇的话前臂横着过去，手是斜搭在牌上的
    const out = s.clone().sub(this.root.getWorldPosition(new THREE.Vector3())).setY(0).normalize();
    const back = new THREE.Vector3(0, 0, 1).transformDirection(this.root.matrixWorld);
    const hint = out.multiplyScalar(a * ELBOW_OUT).add(new THREE.Vector3(0, -a * ELBOW_DOWN, 0)).addScaledVector(back, a * ELBOW_BACK);
    const perp = hint.sub(dir.clone().multiplyScalar(hint.dot(dir))).normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    this.liftElbow(perp, s, dir, cosA * a, sinA * a);
    const elbow = s.clone().addScaledVector(dir, cosA * a).addScaledVector(perp, sinA * a);
    const wrist = s.clone().addScaledVector(dir, d);
    const bend = side === 'right' ? THREE.MathUtils.lerp(this.tuning.wristBend * (1 - PINCH_LEVEL * Math.max(0, this.gripNow)), -TUCK_PITCH, this.tuck) : DEFAULT_DISCARD.wristBend;
    const rest = this.arms[side];
    if (!rest) {
      // 量不出手臂朝向的模型：只管指向，前臂整根拧到手心朝下，手腕往下弯一点
      this.aim(upper, lower, elbow);
      this.aim(lower, hand, wrist);
      const along = wrist.clone().sub(elbow).normalize();
      const flatten = (v: THREE.Vector3) => v.sub(along.clone().multiplyScalar(v.dot(along))).normalize();
      const palm = flatten(DOWN.clone().applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion())));
      const want = flatten(DOWN.clone());
      this.rotateWorld(lower, axisQ(along, Math.atan2(new THREE.Vector3().crossVectors(palm, want).dot(along), palm.dot(want))));
      this.rotateWorld(hand, axisQ(new THREE.Vector3().crossVectors(along, DOWN).normalize(), bend));
      if (side === 'right') this.wristOff = 0;
      return;
    }
    // 上臂、前臂的朝向整个定下来（不只是指向哪）：肘只绕它天生的那根轴弯，轴垂直于肩、肘、腕三点的平面。
    // 只管指向的话，骨头绕自己转了多少是碰巧的，肘会往别扭的方向折，上臂和前臂之间还带着一截拧劲
    const hinge = new THREE.Vector3().crossVectors(perp, dir).normalize();
    const axis = wrist.clone().sub(elbow).normalize();
    this.orient(upper, rest.upper, rest.hinge, elbow.clone().sub(s).normalize(), hinge);
    this.orient(lower, rest.lower, rest.hinge, axis, hinge);
    // 手：手指朝前臂在水平面里的那个方向（再往正前方掰回一点，是手腕左右能摆的余量），往下压一点；手心朝下。
    // 直接定手在世界里的朝向，不跟着前臂的俯仰走：前臂抬着、压着，手都是平着搭向桌面的，指尖落在哪才算得准
    const ahead = new THREE.Vector3(0, 0, -1).transformDirection(this.root.matrixWorld);
    const heading = axis.clone().setY(0);
    if (heading.lengthSq() < 1e-6) heading.copy(ahead);
    heading.normalize();
    const yaw = Math.atan2(new THREE.Vector3().crossVectors(heading, ahead).y, heading.dot(ahead));
    const turned = THREE.MathUtils.clamp(yaw, -WRIST_YAW, WRIST_YAW);
    heading.applyAxisAngle(Y, turned);
    if (side === 'right') this.wristOff = yaw - turned;
    const fingers = heading.multiplyScalar(Math.cos(bend)).addScaledVector(DOWN, Math.sin(bend));
    // 手腕弯不了太多：手和前臂的夹角超了就往前臂那边收
    const off = fingers.angleTo(axis);
    if (off > WRIST_MAX) fingers.lerp(axis, 1 - WRIST_MAX / off).normalize();
    const palmWant = DOWN.clone().addScaledVector(fingers, -DOWN.dot(fingers)).normalize();
    // 手心朝下要绕前臂拧的那一下：前臂只拧一小半，其余的在手腕上
    const flat = (v: THREE.Vector3) => v.sub(axis.clone().multiplyScalar(v.dot(axis))).normalize();
    const palm = flat(DOWN.clone().applyQuaternion(lower.getWorldQuaternion(new THREE.Quaternion())));
    const want = flat(palmWant.clone());
    const twist = Math.atan2(new THREE.Vector3().crossVectors(palm, want).dot(axis), palm.dot(want));
    this.rotateWorld(lower, axisQ(axis, twist * FOREARM_TWIST));
    this.orient(hand, rest.lower, DOWN, fingers, palmWant);
  }

  // 让骨头转到：它静止时指向 restDir 的那根轴指向 dir，静止时的 restHinge 那根轴指向 hinge（都是世界坐标的方向）
  private orient(bone: THREE.Object3D, restDir: THREE.Vector3, restHinge: THREE.Vector3, dir: THREE.Vector3, hinge: THREE.Vector3): void {
    const basis = (x: THREE.Vector3, h: THREE.Vector3) => {
      const y = h.clone().addScaledVector(x, -h.dot(x)).normalize();
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)));
    };
    const world = basis(dir, hinge).multiply(basis(restDir, restHinge).invert());
    const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(world));
    bone.updateMatrixWorld(true);
  }

  // 量这条手臂静止时的朝向。规范骨架里每根骨头静止时都没有旋转，子骨头的位置就是它在父骨头坐标里的方向
  private armRig(side: 'left' | 'right'): ArmRest | null {
    const lower = this.bone(`${side}LowerArm`);
    const hand = this.bone(`${side}Hand`);
    if (!lower || !hand || lower.position.lengthSq() < 1e-8 || hand.position.lengthSq() < 1e-8) return null;
    // 肘往前弯（前臂朝身体前方折）是绕竖直的轴转：右臂是 +y，左臂是 -y（VRM 0.x 脸朝 -z、1.0 脸朝 +z，算下来都一样）
    return { upper: lower.position.clone().normalize(), lower: hand.position.clone().normalize(), hinge: new THREE.Vector3(0, side === 'right' ? 1 : -1, 0) };
  }

  // 找这只手的手指骨头，量每根手指往手心弯的转轴（手心朝下，手指的方向叉乘“下”）
  private handRig(side: 'left' | 'right'): HandRig | null {
    const fingers: HandRig['fingers'] = [];
    for (const f of FINGERS) {
      const joints = (['Proximal', 'Intermediate', 'Distal'] as const).map((j) => this.bone(`${side}${f}${j}` as VRMHumanBoneName)).filter((b): b is THREE.Object3D => !!b);
      if (joints.length < 2 || joints[1].position.lengthSq() < 1e-10) return null;
      fingers.push({ joints, axis: new THREE.Vector3().crossVectors(joints[1].position.clone().normalize(), DOWN).normalize() });
    }
    const tj = (['Metacarpal', 'Proximal', 'Distal'] as const).map((j) => this.bone(`${side}Thumb${j}` as VRMHumanBoneName)).filter((b): b is THREE.Object3D => !!b);
    let thumb: HandRig['thumb'] = null;
    if (tj.length >= 2 && tj[1].position.lengthSq() > 1e-10) {
      const dir = tj[1].position.clone().normalize();
      const along = fingers[1].joints[1].position.clone().normalize();
      // 往食指那边收是绕竖直的轴转，往哪边转看拇指在手指的哪一侧
      thumb = { joints: tj, down: new THREE.Vector3().crossVectors(dir, DOWN).normalize(), inSign: Math.sign(new THREE.Vector3().crossVectors(dir, along).y) || 1 };
    }
    return { fingers, thumb };
  }

  // 摆手型：g 是 -1 张开、0 放松、1 捏着牌，中间的平滑过渡
  private poseHand(side: 'left' | 'right', g: number, tuck = 0): void {
    const rig = this.hands[side];
    if (!rig) return;
    const to = g < 0 ? HAND_OPEN : HAND_PINCH;
    const k = Math.min(1, Math.abs(g));
    // 先照 g 在放松和张开（或捏牌）之间取，再照 tuck 往收拢那边靠
    const mix = (pick: (h: HandShape) => number) => {
      const a = pick(HAND_RELAX);
      const v = a + (pick(to) - a) * k;
      return v + (pick(HAND_TUCK) - v) * tuck;
    };
    rig.fingers.forEach((f, i) => f.joints.forEach((b, j) => b.quaternion.setFromAxisAngle(f.axis, mix((h) => h.curl[i][j]))));
    const t = rig.thumb;
    if (!t) return;
    t.joints[0].quaternion.setFromAxisAngle(Y, t.inSign * mix((h) => h.thumbIn)).multiply(axisQ(t.down, mix((h) => h.thumbDown)));
    for (const b of t.joints.slice(1)) b.quaternion.setFromAxisAngle(t.down, mix((h) => h.thumbCurl));
  }

  // 手从休息的地方伸到目标走哪条路（w 是伸出去了几成；都是世界坐标）。
  // 腿上的手在桌子底下，直着伸向牌会从桌沿里穿过去。所以分两段：先贴着身体把手抬到桌面以上（在桌框外面、身体前面那道缝里往上走），
  // 再从桌沿上方往前伸，快到了才落到牌上。收手照原路回。两段在过桌沿那个点接顺
  private reachPath(rest: THREE.Vector3, target: THREE.Vector3, w: number): THREE.Vector3 {
    const t = this.table;
    if (!t) return rest.clone().lerp(target, w);
    const r = this.root.worldToLocal(rest.clone());
    const g = this.root.worldToLocal(target.clone());
    // 过桌沿的那个点（模型自身坐标，-z 朝桌子）：桌框外沿靠身体这边一点，比桌面高 arcMax，左右在休息位置和目标之间
    const via = new THREE.Vector3(THREE.MathUtils.lerp(r.x, g.x, 0.4), Math.max(t.y, r.y) + this.tuning.arcMax, Math.max(g.z + 0.02, t.edgeZ + t.frame + REACH_GAP));
    const d1 = via.distanceTo(r);
    const d2 = g.distanceTo(via);
    // 过那个点的时候是往前上方走的
    const across = new THREE.Vector3(g.x - via.x, 0, g.z - via.z).normalize().multiplyScalar(0.8).setY(0.35);
    const hermite = (p0: THREE.Vector3, m0: THREE.Vector3, p1: THREE.Vector3, m1: THREE.Vector3, u: number) => {
      const u2 = u * u;
      const u3 = u2 * u;
      return p0.clone().multiplyScalar(2 * u3 - 3 * u2 + 1).addScaledVector(m0, u3 - 2 * u2 + u).addScaledVector(p1, -2 * u3 + 3 * u2).addScaledVector(m1, u3 - u2);
    };
    let p: THREE.Vector3;
    if (w < REACH_SPLIT) {
      // 抬手：先往上、往身体这边收一点（从桌子底下退出来），到桌沿上方时转成往前。慢起步：头几帧手指要先收拢
      p = hermite(r, new THREE.Vector3(0, 0.9 * d1, 0.3 * d1), via, across.clone().multiplyScalar(d1), (w / REACH_SPLIT) ** LIFT_EASE);
    } else {
      // 往前伸：平着出去，最后从上面落到目标上
      const down = new THREE.Vector3(g.x - via.x, 0, g.z - via.z).normalize().multiplyScalar(0.35).setY(-0.8);
      p = hermite(via, across.clone().multiplyScalar(d2), g, down.multiplyScalar(d2), (w - REACH_SPLIT) / (1 - REACH_SPLIT));
    }
    // 抬手的那一段，手腕还没高过桌面的时候在身体和桌框之间那道缝里（一拃宽）：手指朝前伸着会戳进桌沿，要收拢、立起来。
    // 刚离开腿的头几帧收起来，快抬到过桌沿的那个高度时放开；往前伸的那一段不收（去抽屉里拿立直棒时手就在桌沿边上，要捏东西）
    const arc = via.y - t.y;
    this.tuck = w < REACH_SPLIT ? THREE.MathUtils.smoothstep(w / REACH_SPLIT, 0, TUCK_IN) * (1 - THREE.MathUtils.smoothstep(p.y - t.y, arc * TUCK_OUT[0], arc * TUCK_OUT[1])) : 0;
    return this.root.localToWorld(p);
  }

  // 胳膊伸到桌子上方时肘部别沉下去：桌布上方要越过立着的手牌和牌山，桌框上方别蹭着桌框；
  // 肘还在桌子外面（收在身侧）就不管，随它比桌面低。上身俯得低的时候，肘是往外撑起来，不是往下掉。
  // perp 是肘部偏离肩腕连线的方向（垂直于 dir，直接改它）；肩在 s，肘在连线上 along 处、偏出去 off 那么远（世界单位）
  private liftElbow(perp: THREE.Vector3, s: THREE.Vector3, dir: THREE.Vector3, along: number, off: number): void {
    const t = this.table;
    if (!t || t.clear <= 0 || off < 1e-5) return;
    const base = s.clone().addScaledVector(dir, along);
    // 照原来的方向肘会落在哪（模型自身坐标，-z 朝桌子）：过了桌框外沿才开始管，免得手一过桌沿肘突然一跳
    const z = this.root.worldToLocal(base.clone().addScaledVector(perp, off)).z;
    const over = THREE.MathUtils.smoothstep(t.edgeZ + t.frame + 0.03 - z, 0, 0.06);
    if (over <= 0) return;
    // 垂直于 dir 的“上”
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y);
    if (up.length() < 0.2) return;
    up.normalize();
    // 至少要多高：桌框上方留一点缝，进了桌布往里几厘米（手牌那一排）起要越过牌
    const clear = THREE.MathUtils.lerp(FRAME_CLEAR, t.clear, THREE.MathUtils.smoothstep(t.edgeZ - z, -0.02, 0.06));
    const floor = this.root.localToWorld(new THREE.Vector3(0, t.y + clear, z)).y;
    const now = perp.dot(up);
    const need = THREE.MathUtils.clamp((floor - base.y) / (off * up.y), -1, 1);
    if (need <= now) return;
    const sin = THREE.MathUtils.lerp(now, need, over);
    // 往外的那一半方向不变，只把上下的分量换掉
    const side = perp.clone().addScaledVector(up, -now);
    if (side.length() < 1e-4) side.crossVectors(dir, up);
    side.normalize();
    perp.copy(side.multiplyScalar(Math.sqrt(Math.max(0, 1 - sin * sin)))).addScaledVector(up, sin);
  }

  // 手要伸到 target（模型自身坐标，-z 朝桌子）时上身从髋部往前俯多少（弧度）：
  // 俯到肩离目标不超过手臂长度的 REACH_K 成为止（胳膊还留一点弯），本来就够得着是 0，俯到 max 还够不着就是 max
  private leanFor(target: THREE.Vector3, max: number): number {
    const sh = this.shoulderRest;
    if (!sh) return 0;
    const reach = this.armLength * REACH_K;
    const up = sh.y - this.hipRest.y;
    const fwd = this.hipRest.z - sh.z;
    // 肩绕髋部那条左右方向的轴转 a 之后离目标多远
    const gap = (a: number): number => {
      const y = this.hipRest.y + up * Math.cos(a) - fwd * Math.sin(a);
      const z = this.hipRest.z - (up * Math.sin(a) + fwd * Math.cos(a));
      return Math.hypot(target.x - sh.x, target.y - y, target.z - z);
    };
    if (gap(0) <= reach) return 0;
    if (gap(max) > reach) return max;
    let lo = 0;
    let hi = max;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (gap(mid) > reach) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  // 在世界坐标里给骨骼再加一个旋转
  private rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
    const world = q.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(world));
    bone.updateMatrixWorld(true);
  }

  private updateGaze(dt: number): void {
    const t = this.time;
    // 没人吸引注意时：大部分时间看自己的牌，偶尔瞟一眼别人
    if (t > this.lookHoldUntil && this.home) {
      if (t > this.nextGlance && this.glances.length) {
        this.lookWant.copy(this.glances[Math.floor(Math.random() * this.glances.length)]);
        this.lookHoldUntil = t + 0.8 + Math.random() * 0.9;
        this.nextGlance = t + 4 + Math.random() * 6;
      } else {
        this.lookWant.copy(this.home);
      }
    }
    this.lookNow.lerp(this.lookWant, 1 - Math.exp(-dt * 7));
    this.lookTarget.position.copy(this.lookNow);

    // 头跟着视线转一部分，转得比眼睛慢
    const head = this.bone('head');
    if (!head) return;
    const { yaw, pitch } = this.aimAngles(this.lookNow, head);
    const k = 1 - Math.exp(-dt * 3.5);
    this.headYaw += (THREE.MathUtils.clamp(yaw * 0.55, -0.7, 0.7) - this.headYaw) * k;
    this.headPitch += (THREE.MathUtils.clamp(pitch * 0.5, -0.25, 0.45) - this.headPitch) * k;
    const sway = Math.sin(t * 0.6) * 0.035;
    // 上身往前俯的时候头往回抬一些，脖子和头各抬一半
    const up = this.leanNow * LEAN_HEAD_UP * 0.5;
    const q = axisQ(Y, this.headYaw * 0.6).multiply(axisQ(X, this.headPitch * 0.6 - up)).multiply(axisQ(Z, sway));
    this.bone('neck')?.quaternion.copy(this.local(axisQ(Y, this.headYaw * 0.4).multiply(axisQ(X, this.headPitch * 0.4 - up))));
    head.quaternion.copy(this.local(q));
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.root.updateMatrixWorld(true);

    // 身体：呼吸、轻微晃动；伸手时往前倾，并往手的方向转一点。
    // 前倾是整个上身从髋部往前俯（大腿留在椅子上），俯多少看手要伸多远：刚好够得着就行，够得着的不多俯
    let lean = 0;
    let twist = 0;
    if (this.reachTarget && this.reachWeight > 0) {
      const local = this.root.worldToLocal(this.reachTarget.clone());
      lean = this.reachWeight * Math.max(LEAN_MIN, this.leanFor(local, this.tuning.leanMax));
      twist = this.reachWeight * THREE.MathUtils.clamp(Math.atan2(-local.x, -local.z) * 0.35, -0.3, 0.3);
    }
    this.leanNow = lean;
    const hips = this.bone('hips');
    if (hips) {
      hips.quaternion.copy(this.local(axisQ(X, lean)));
      const back = this.local(axisQ(X, -lean));
      for (const n of ['leftUpperLeg', 'rightUpperLeg'] as VRMHumanBoneName[]) {
        const leg = this.bone(n);
        const q = this.base.get(n);
        if (leg && q) leg.quaternion.copy(back).multiply(q);
      }
    }
    const breath = Math.sin(t * 1.6);
    const spine = this.bone('spine');
    const spineBase = this.base.get('spine');
    if (spine && spineBase) {
      // 背再跟着弓一点，不是直挺挺地俯下去
      const q = axisQ(X, breath * 0.012 + Math.sin(t * 0.37) * 0.015 + lean * LEAN_CURL)
        .multiply(axisQ(Y, twist * 0.6))
        .multiply(axisQ(Z, Math.sin(t * 0.23) * 0.02));
      spine.quaternion.copy(spineBase).multiply(this.local(q));
    }
    const chest = this.bone('chest');
    if (chest) chest.quaternion.copy(this.local(axisQ(X, breath * 0.015).multiply(axisQ(Y, twist * 0.4))));
    // 伸手时右肩微微抬起
    const shoulder = this.bone('rightShoulder');
    if (shoulder) shoulder.quaternion.copy(this.local(axisQ(Z, this.reachWeight * 0.12)));
    this.updateGaze(dt);

    // 手型：左手一直是放松的；右手照牌桌给的走，手没伸出去就是放松
    const gripWant = this.reachTarget && this.reachWeight > 0 ? this.grip : 0;
    this.gripNow += (gripWant - this.gripNow) * (dt > 0 ? 1 - Math.exp(-dt * GRIP_RATE) : 1);
    this.poseHand('left', 0);
    this.tuck = 0;

    // 双手：先回到坐姿，再用 IK 放到休息位置；右手按权重移向目标
    for (const n of ['leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm'] as VRMHumanBoneName[]) {
      const b = this.bone(n);
      const q = this.base.get(n);
      if (b && q) b.quaternion.copy(q);
    }
    this.bone('leftHand')?.quaternion.identity();
    this.bone('rightHand')?.quaternion.identity();
    if (this.rest) {
      this.root.updateMatrixWorld(true);
      const left = this.root.localToWorld(this.rest.left.clone());
      const right = this.root.localToWorld(this.rest.right.clone());
      // 手放着也不是完全不动：手指偶尔轻轻挪一下
      left.y += Math.max(0, Math.sin(t * 0.8 + 1)) * 0.003 * this.root.scale.x;
      if (this.reachTarget && this.reachWeight > 0) {
        right.copy(this.reachPath(right, this.reachTarget, this.reachWeight));
      }
      // 右手的手型要等路线算完（要不要收拢看手走到哪了），再解手臂
      this.poseHand('right', this.gripNow, this.tuck);
      this.solveArm('left', left);
      if (this.reachTarget && this.reachWeight > 0) {
        // 手腕的目标是照“手正对着前方”算的：捏点在手腕前下方 reachHold 那么远，再往拇指一侧偏一点（右手小指在模型自己的 +x 那边）。
        // 前臂其实是斜着伸过来的，手腕掰不回那么多；手的朝向偏了多少，手腕就绕着捏点转多少，捏点照样落在牌上
        const w = this.reachWeight;
        const hold = this.reachHold ? this.reachHold.clone().multiplyScalar(w) : new THREE.Vector3();
        const pinch = right.clone().sub(hold);
        hold.addScaledVector(new THREE.Vector3(1, 0, 0).transformDirection(this.root.matrixWorld), PINCH_SIDE * this.root.scale.x * w);
        // 手腕挪了，前臂的方向跟着变，手偏的角度也就变了：来回几次，转的角度和手实际偏的角度对上为止
        let turn = 0;
        for (let i = 0; i < 5; i++) {
          this.solveArm('right', right.copy(pinch).add(hold.clone().applyAxisAngle(Y, -turn)));
          if (Math.abs(this.wristOff - turn) < 0.01) break;
          turn += (this.wristOff - turn) * (i === 0 ? 1 : 0.6);
        }
      } else {
        this.solveArm('right', right);
      }
      this.rightGoal.copy(right);
      if (this.restPose === 'crossed') {
        // 抱胸时手掌往回收，抓住另一边的胳膊，而不是伸在外面
        const curl = 1.3;
        const lh = this.bone('leftHand');
        const rh = this.bone('rightHand');
        if (lh) this.rotateWorld(lh, axisQ(Y, -curl));
        if (rh) this.rotateWorld(rh, axisQ(Y, curl * (1 - this.reachWeight)));
      }
    } else {
      this.poseHand('right', this.gripNow);
    }

    this.updateFace(dt);
    this.fitSprings();
    this.vrm.update(dt);
  }

  private updateFace(dt: number): void {
    const t = this.time;
    const em = this.vrm.expressionManager;
    if (!em) return;
    // 眨眼：闭眼快、睁眼慢，偶尔连眨两下
    if (t > this.nextBlink) {
      this.blinkT = 0;
      this.nextBlink = t + (Math.random() < 0.15 ? 0.35 : 2.5 + Math.random() * 3.5);
    }
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      blink = this.blinkT < 0.06 ? this.blinkT / 0.06 : Math.max(0, 1 - (this.blinkT - 0.06) / 0.12);
      if (this.blinkT > 0.18) this.blinkT = -1;
    }
    const moodActive = this.mood && t < this.mood.until ? this.mood.name : null;
    for (const m of ['happy', 'sad', 'angry', 'surprised', 'relaxed'] as Mood[]) {
      const cur = this.moodWeights.get(m) ?? 0;
      const goal = m === moodActive ? 1 : 0;
      const next = cur + (goal - cur) * Math.min(1, dt * 6);
      this.moodWeights.set(m, next);
      // VRM 0.x 没有“吃惊”，用张嘴代替
      if (m === 'surprised' && !em.getExpression('surprised')) em.setValue('oh', next * 0.7);
      else em.setValue(m, next);
    }
    // 笑的时候本来就眯眼，不再叠加眨眼
    em.setValue('blink', moodActive === 'happy' ? 0 : blink);
  }
}
