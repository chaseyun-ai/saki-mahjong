import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { TileId } from '../engine/tiles';
import { FaceAtlas, faceIndex } from './faces';
import { TILE_H, TILE_T, TILE_W } from './tableLayout';

// 大星淡连招自摸的特写（试做）：牌桌上逆回旋的同时，画面一角切进来一个漫画式的三角窗，
// 里面是她的手凑近了看的样子——指尖搭在手牌的牌顶上，往回一勾一甩，整排牌逆着翻起来。
// 自己一套小场景、小画布，叠在牌桌上面，不碰牌桌（2D、2.5D、3D 都能用）。
//
// 手模：public/models/hand-awai.glb（scripts/make-hand.py 从她的人物模型里抠出来的右手，带 17 根骨头，细分过）。
// 坐标：手臂沿 +X 伸出去，手背朝 +Y，拇指朝 -Z，手腕在原点，单位是米。
// 场景：一排手牌沿 X 摆着，牌面朝 +Z（她坐在 +Z 那边），单位是牌宽。

// 时间线（秒）：窗口切进来 → 手搭着牌顶（蓄力）→ 一甩 → 牌翻着飞起来（慢镜头）→ 窗口收走
export const CUTIN = {
  open: 0.14,
  // 手往下按一下蓄力到什么时候，什么时候甩出去，甩多久
  press: 0.2,
  snap: 0.3,
  snapTime: 0.09,
  // 甩出去以后这么久开始收窗口，收多久
  hold: 0.78,
  close: 0.16,
  // 牌一共逆着翻几圈（窗口关上时还在空中）；翻起来多高（牌宽）
  turns: 1.6,
  rise: 2.3,
  // 手模放大多少：1 米是多少个牌宽（真牌宽 19 毫米是 52.6，手小一点显得秀气）
  handScale: 44,
};
export const CUTIN_TIME = CUTIN.snap + CUTIN.hold + CUTIN.close;

const FINGERS = ['Index', 'Middle', 'Ring', 'Little'] as const;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};
const outQuint = (x: number) => 1 - (1 - clamp01(x)) ** 5;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

let gradient: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  gradient = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 214, 214, 214, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

// 描边：同一个形状沿法线往外鼓一点、只画背面
function outlineMat(color: THREE.ColorRepresentation, width: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (s) => {
    s.uniforms.uLine = { value: width };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uLine;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uLine;');
  };
  return m;
}

// ---------- 手模 ----------

export interface HandRig {
  root: THREE.Group; // 手腕在它的原点
  bones: Record<string, THREE.Bone>;
}

let handSource: Promise<THREE.Group> | null = null;
let atlas: FaceAtlas | null = null;
let atlasReady: Promise<void> | null = null;

export const HAND_URL = 'models/hand-awai.glb';

// 发布页不能直接提供 .glb，那里的模型是 base64 文本（.glb.txt，和人物模型一样，见 avatar.ts），自己解码
export async function loadHand(url: string): Promise<THREE.Group> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  let buf = await res.arrayBuffer();
  if (url.endsWith('.txt')) {
    const raw = atob(new TextDecoder().decode(buf).trim());
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    buf = bytes.buffer;
  }
  return (await new GLTFLoader().parseAsync(buf, '')).scene;
}

// 先把手模、牌面贴图备好（有淡的对局一开始就调），特写切进来时不用等
export function preloadAwaiCutIn(): Promise<unknown> {
  handSource ??= loadHand(HAND_URL);
  if (!atlas) {
    atlas = new FaceAtlas();
    atlasReady = atlas.draw();
  }
  return Promise.all([handSource, atlasReady]).catch(() => null);
}

export function buildHand(src: THREE.Group, scale: number = CUTIN.handScale): HandRig {
  const root = new THREE.Group();
  const bones: Record<string, THREE.Bone> = {};
  // 同一份模型只用在一个特写里（特写一次只有一个），直接拿来用
  src.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
  });
  const meshes: THREE.SkinnedMesh[] = [];
  src.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !o.userData.outline) meshes.push(o as THREE.SkinnedMesh);
  });
  for (const m of meshes) {
    if (m.userData.toon) continue;
    m.userData.toon = true;
    const old = m.material as THREE.MeshStandardMaterial;
    const sleeve = old.name === 'sleeve';
    // 袖子是单层的布：两面都画
    m.material = new THREE.MeshToonMaterial({ map: old.map, gradientMap: toonGradient(), color: sleeve ? '#ffffff' : '#fff4ee', side: sleeve ? THREE.DoubleSide : THREE.FrontSide });
    m.frustumCulled = false;
    const line = new THREE.SkinnedMesh(m.geometry, outlineMat(sleeve ? '#3b4a78' : '#8a4a44', 0.00075));
    line.userData.outline = true;
    line.frustumCulled = false;
    line.bind(m.skeleton, m.bindMatrix);
    m.parent!.add(line);
  }
  src.scale.setScalar(scale);
  root.add(src);
  return { root, bones };
}

// 手型：四指三节各弯多少（弧度，往手心）、张开多少；大拇指往手心收多少、弯多少；手腕往上翘多少
export interface HandPose {
  curl: [number, number, number];
  // 各指比上面多弯多少（食指到小指）
  each: [number, number, number, number];
  spread: number;
  thumbIn: number;
  thumbCurl: number;
  wrist: number;
}

export const mixPose = (a: HandPose, b: HandPose, k: number): HandPose => ({
  curl: [lerp(a.curl[0], b.curl[0], k), lerp(a.curl[1], b.curl[1], k), lerp(a.curl[2], b.curl[2], k)],
  each: [lerp(a.each[0], b.each[0], k), lerp(a.each[1], b.each[1], k), lerp(a.each[2], b.each[2], k), lerp(a.each[3], b.each[3], k)],
  spread: lerp(a.spread, b.spread, k),
  thumbIn: lerp(a.thumbIn, b.thumbIn, k),
  thumbCurl: lerp(a.thumbCurl, b.thumbCurl, k),
  wrist: lerp(a.wrist, b.wrist, k),
});

// 搭着：指尖松松地搭在牌顶上
export const REST: HandPose = { curl: [0.35, 0.5, 0.3], each: [0, -0.04, 0.04, 0.16], spread: 0.05, thumbIn: 0.35, thumbCurl: 0.25, wrist: 0.12 };
// 蓄力：指尖勾住牌顶那条棱，手腕压下去
export const HOOK: HandPose = { curl: [0.5, 0.95, 0.6], each: [0, -0.03, 0.05, 0.2], spread: 0, thumbIn: 0.55, thumbCurl: 0.45, wrist: -0.1 };
// 甩出去：手指一下弹直张开，手腕往上翘
const FLICK: HandPose = { curl: [-0.22, 0.05, 0.02], each: [0.02, 0, 0.03, 0.1], spread: 0.3, thumbIn: -0.25, thumbCurl: 0.05, wrist: 0.38 };
// 收势：松下来
export const EASE: HandPose = { curl: [0.1, 0.25, 0.18], each: [0, 0.02, 0.06, 0.16], spread: 0.16, thumbIn: 0.05, thumbCurl: 0.15, wrist: 0.25 };

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
// 大拇指往手心弯的轴（它斜着朝 +X、-Z 伸出去）
const THUMB_AXIS = new THREE.Vector3(-1, 0, -1).normalize();

export function poseHand(rig: HandRig, p: HandPose): void {
  const b = rig.bones;
  b.Hand.quaternion.setFromAxisAngle(Z, p.wrist);
  FINGERS.forEach((f, i) => {
    // 张开：绕手背的法线转，食指往拇指那边、小指往外
    const fan = p.spread * [1, 0.25, -0.45, -1][i];
    const q = new THREE.Quaternion().setFromAxisAngle(Y, fan);
    b[`${f}1`].quaternion.copy(q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, -(p.curl[0] + p.each[i]))));
    b[`${f}2`].quaternion.setFromAxisAngle(Z, -(p.curl[1] + p.each[i]));
    b[`${f}3`].quaternion.setFromAxisAngle(Z, -(p.curl[2] + p.each[i] * 0.6));
  });
  b.Thumb1.quaternion.setFromAxisAngle(Y, -p.thumbIn).multiply(new THREE.Quaternion().setFromAxisAngle(THUMB_AXIS, p.thumbCurl * 0.5));
  b.Thumb2.quaternion.setFromAxisAngle(THUMB_AXIS, p.thumbCurl);
  b.Thumb3.quaternion.setFromAxisAngle(THUMB_AXIS, p.thumbCurl * 0.8);
}

// ---------- 牌 ----------

interface CutTile {
  group: THREE.Group;
  x: number;
}

function buildTiles(scene: THREE.Scene, ids: TileId[], back: THREE.ColorRepresentation): { row: THREE.Group; tiles: CutTile[]; dispose: () => void } {
  const row = new THREE.Group();
  const bodyGeom = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_T * 0.62, 3, 0.12);
  const backGeom = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_T * 0.42, 3, 0.12);
  const hull = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_T, 3, 0.12);
  const bodyMat = new THREE.MeshToonMaterial({ color: '#fbf6e9', gradientMap: toonGradient() });
  const backMat = new THREE.MeshToonMaterial({ color: back, gradientMap: toonGradient() });
  const faceMat = new THREE.MeshBasicMaterial({ map: atlas!.texture, transparent: true });
  const lineMat = outlineMat('#1b1b26', 0.035);
  const faces: THREE.BufferGeometry[] = [];
  const tiles: CutTile[] = [];
  const n = ids.length;
  ids.forEach((id, i) => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.z = TILE_T * 0.19;
    const bk = new THREE.Mesh(backGeom, backMat);
    bk.position.z = -TILE_T * 0.25;
    const fg = atlas!.faceGeometry(faceIndex(id), TILE_W * 0.9, TILE_H * 0.9);
    faces.push(fg);
    const face = new THREE.Mesh(fg, faceMat);
    face.position.z = TILE_T / 2 + 0.002;
    group.add(body, bk, face, new THREE.Mesh(hull, lineMat));
    // 她的右手边（+X）是手牌的右头：牌面朝她（+Z）看，从左到右是 -X 到 +X
    const x = (i - (n - 1) / 2) * TILE_W;
    group.position.set(x, 0, 0);
    row.add(group);
    tiles.push({ group, x });
  });
  scene.add(row);
  return {
    row,
    tiles,
    dispose: () => {
      for (const g of [bodyGeom, backGeom, hull, ...faces]) g.dispose();
      for (const m of [bodyMat, backMat, faceMat, lineMat]) m.dispose();
    },
  };
}

// ---------- 三角窗 ----------

type Pt = [number, number];

// 窗口的三个角（占牌桌宽高的几成）。corner：贴着哪个角切进来
export type CutInCorner = 'tl' | 'tr' | 'bl' | 'br';
function triangle(corner: CutInCorner, w: number, h: number): Pt[] {
  // 左上角的样子：一条边贴着上沿斜下来，尖角朝右下
  const base: Pt[] = [
    [0.015, 0.03],
    [0.6, 0.085],
    [0.2, 0.86],
  ];
  return base.map(([x, y]) => [(corner === 'tr' || corner === 'br' ? 1 - x : x) * w, (corner === 'bl' || corner === 'br' ? 1 - y : y) * h] as Pt);
}

// 三角形往里缩 d（三条边各往里平移 d）：绕内心缩小
function inset(t: Pt[], d: number): Pt[] {
  const len = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const a = len(t[1], t[2]);
  const b = len(t[0], t[2]);
  const c = len(t[0], t[1]);
  const p = a + b + c;
  const ix = (a * t[0][0] + b * t[1][0] + c * t[2][0]) / p;
  const iy = (a * t[0][1] + b * t[1][1] + c * t[2][1]) / p;
  const area = Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2;
  const r = (2 * area) / p;
  if (!(r > 0)) return t.map((q) => [q[0], q[1]] as Pt);
  const k = Math.max(0, (r - d) / r);
  return t.map(([x, y]) => [ix + (x - ix) * k, iy + (y - iy) * k] as Pt);
}

export interface CutInOptions {
  // 她门内的手牌（不算和了牌），从她自己看从左到右
  tiles: TileId[];
  // 窗口贴着哪个角（躲开她在牌桌上的位置）
  corner?: CutInCorner;
  // 牌背的颜色（跟牌桌的一样）
  back?: THREE.ColorRepresentation;
  onDone?: () => void;
  // 调动作用：窗口铺满，镜头放在 cam、看着 look
  debug?: { cam?: [number, number, number]; look?: [number, number, number] };
}

export class AwaiCutIn {
  private el: HTMLDivElement;
  private win: HTMLDivElement;
  private flash: HTMLDivElement;
  private lines: HTMLDivElement;
  private edge: SVGSVGElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  // 画布是三角形的外接矩形，镜头的正中对着三角形的内心（见 resize），所以视角按两倍高的画面算
  private camera = new THREE.PerspectiveCamera(76, 1, 0.1, 200);
  private center: Pt = [0, 0];
  private rig: HandRig | null = null;
  private row: ReturnType<typeof buildTiles> | null = null;
  private ghosts: THREE.Group[] = [];
  private raf = 0;
  private timer = 0;
  private t0 = 0;
  private done = false;
  private box = { x: 0, y: 0, w: 1, h: 1 };
  private tri: Pt[] = [];
  private size = { w: 0, h: 0 };

  constructor(private host: HTMLElement, private opts: CutInOptions) {
    this.el = document.createElement('div');
    this.el.className = 'tricut';
    this.el.innerHTML =
      '<div class="tricut-win"><div class="tricut-bg"></div><div class="tricut-lines"></div><canvas></canvas><div class="tricut-flash"></div></div>' +
      '<svg class="tricut-edge" xmlns="http://www.w3.org/2000/svg"><polygon class="tricut-ink"/><polygon class="tricut-rim"/></svg>';
    this.win = this.el.querySelector('.tricut-win')!;
    this.flash = this.el.querySelector('.tricut-flash')!;
    this.lines = this.el.querySelector('.tricut-lines')!;
    this.edge = this.el.querySelector('svg')!;
    this.canvas = this.el.querySelector('canvas')!;
    // 开演之前不露面（先在后台搭好场景、编译好着色器）
    this.el.style.visibility = 'hidden';
    host.appendChild(this.el);
    this.layout();
  }

  // 手模、牌面备好了才搭场景（没备好就等；加载失败就不演）
  async ready(): Promise<boolean> {
    await preloadAwaiCutIn();
    const src = await handSource!.catch(() => null);
    if (!src || this.done) return false;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    } catch {
      return false;
    }
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.rig = buildHand(src);
    this.scene.add(this.rig.root);
    this.row = buildTiles(this.scene, this.opts.tiles, this.opts.back ?? '#2f78a8');
    // 残影：整排牌的两份半透明的影子，跟在后面
    for (let i = 0; i < 2; i++) {
      const g = this.row.row.clone(true);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = (m.material as THREE.Material).clone();
        mat.transparent = true;
        mat.opacity = 0;
        mat.depthWrite = false;
        m.material = mat;
      });
      this.scene.add(g);
      this.ghosts.push(g);
    }
    this.scene.add(new THREE.AmbientLight('#ffffff', 1.5));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(4, 9, 6);
    this.scene.add(key);
    this.resize();
    // 先悄悄画一帧甩出去以后的样子（残影也在）：着色器在这里编译好，开演的第一帧不卡，蓄力那一下不会被吞掉
    this.pose(CUTIN.snap + 0.05);
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  // 窗口的位置、大小照牌桌现在的大小算
  private layout(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.size = { w, h };
    this.tri = this.opts.debug
      ? [
          [-w, -h],
          [3 * w, -h],
          [-w, 3 * h],
        ]
      : triangle(this.opts.corner ?? 'tl', w, h);
    const xs = this.tri.map((p) => p[0]);
    const ys = this.tri.map((p) => p[1]);
    this.box = this.opts.debug ? { x: 0, y: 0, w, h } : { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    this.edge.setAttribute('viewBox', `0 0 ${w} ${h}`);
    Object.assign(this.canvas.style, { left: `${this.box.x}px`, top: `${this.box.y}px`, width: `${this.box.w}px`, height: `${this.box.h}px` });
    // 集中线、闪光的中心：三角形的内心附近
    const c = this.opts.debug ? ([w / 2, h / 2] as Pt) : inset(this.tri, 1e9)[0];
    this.center = c;
    this.el.style.setProperty('--cx', `${c[0]}px`);
    this.el.style.setProperty('--cy', `${c[1]}px`);
  }

  private resize(): void {
    this.renderer?.setSize(this.box.w, this.box.h, false);
    // 整幅画面是画布的两倍大，画布只画其中一块：内心落在整幅画面的正中
    const { x, y, w, h } = this.box;
    this.camera.aspect = w / h;
    this.camera.setViewOffset(2 * w, 2 * h, w - (this.center[0] - x), h - (this.center[1] - y), w, h);
    this.camera.updateProjectionMatrix();
  }

  // 第 t 秒的样子（从窗口开始切进来算）
  frame(t: number): void {
    this.el.style.visibility = '';
    if (this.host.clientWidth !== this.size.w || this.host.clientHeight !== this.size.h) {
      this.layout();
      this.resize();
    }
    const C = CUTIN;
    const end = C.snap + C.hold;
    // 窗口：从贴着角的那个顶点张开；收的时候往尖角那头缩走
    const openK = outQuint(t / C.open);
    const closeK = smooth((t - end) / C.close);
    const from = closeK > 0 ? this.tri[2] : this.tri[0];
    const k = closeK > 0 ? 1 - closeK : openK;
    const cur = this.tri.map(([x, y]) => [from[0] + (x - from[0]) * k, from[1] + (y - from[1]) * k] as Pt);
    const pts = (p: Pt[]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const border = Math.max(4, this.size.h * 0.011);
    this.win.style.clipPath = `polygon(${inset(cur, border * 0.5)
      .map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`)
      .join(', ')})`;
    const ink = this.edge.querySelector('.tricut-ink')!;
    const rim = this.edge.querySelector('.tricut-rim')!;
    ink.setAttribute('points', pts(cur));
    ink.setAttribute('stroke-width', `${border}`);
    rim.setAttribute('points', pts(inset(cur, border * 0.85)));
    rim.setAttribute('stroke-width', `${border * 0.3}`);
    this.el.style.opacity = t >= end + C.close ? '0' : '1';
    // 甩出去那一下闪一下白，集中线转着
    const since = t - C.snap;
    this.flash.style.opacity = since < 0 ? '0' : `${Math.max(0, 0.85 * (1 - since / 0.16))}`;
    this.lines.style.transform = `rotate(${(t * 40).toFixed(1)}deg) scale(${(1 + Math.max(0, since) * 0.25).toFixed(3)})`;
    this.lines.style.opacity = `${0.35 + 0.65 * smooth(since / 0.1)}`;
    if (this.renderer && this.rig && this.row) {
      this.pose(t);
      this.renderer.render(this.scene, this.camera);
    }
  }

  // 整排牌翻到多少（弧度，负的：牌顶朝她那边翻过去）、离桌多高。u 是甩出去以后过了多久（秒）
  private flight(u: number): { a: number; y: number } {
    if (u <= 0) return { a: 0, y: 0 };
    const C = CUTIN;
    // 慢镜头：一开始快，越来越慢，窗口关上时还在空中
    const k = 1 - (1 - clamp01(u / (C.hold + C.close))) ** 2.4;
    return { a: -2 * Math.PI * C.turns * k, y: C.rise * (1 - (1 - k) ** 2) };
  }

  private pose(t: number): void {
    const C = CUTIN;
    const rig = this.rig!;
    const row = this.row!;
    const n = row.tiles.length;
    const u = t - C.snap;
    // 牌：立在桌上（牌面朝 +Z），甩出去以后绕着排的方向（过牌的中心）逆着翻、往上飞
    const place = (g: THREE.Group, f: { a: number; y: number }) => {
      g.position.set(0, TILE_H / 2 + f.y, 0);
      g.rotation.set(-f.a, 0, 0);
    };
    const now = this.flight(u);
    place(row.row, now);
    // 蓄力时被手指压得往她那边歪一点
    const pressK = smooth((t - C.press * 0.3) / (C.press * 0.7)) * (u < 0 ? 1 : 0);
    row.row.rotation.x += pressK * 0.07;
    this.ghosts.forEach((g, i) => {
      const lag = this.flight(u - 0.028 * (i + 1));
      place(g, lag);
      const speed = clamp01(Math.abs(now.a - lag.a) / 0.9);
      const op = u > 0 ? speed * (0.34 - i * 0.12) : 0;
      g.visible = op > 0.01;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.Material).opacity = op;
      });
    });
    // 手：搭着 → 勾住压下去 → 甩 → 收势
    const snapK = outQuint(u / C.snapTime);
    const easeK = smooth((u - C.snapTime) / 0.45);
    const hookK = smooth(t / C.press);
    let hp = mixPose(REST, HOOK, hookK);
    if (u > 0) hp = mixPose(mixPose(HOOK, FLICK, snapK), EASE, easeK);
    poseHand(rig, hp);
    // 手搭在她右手边那几张牌上：手腕在牌后面（+Z，她那边）上方，手指朝前（-Z）斜着往下，指尖搭过牌顶
    const hx = (n - 1) / 2 - 1.4;
    const top = TILE_H;
    const rest = new THREE.Vector3(hx, top + 2.9, 4.15);
    const hook = new THREE.Vector3(hx, top + 2.68, 3.9);
    const flick = new THREE.Vector3(hx + 0.3, top + 4.3, 5.6);
    const away = new THREE.Vector3(hx + 0.7, top + 5.2, 6.8);
    const at = rest.clone().lerp(hook, hookK);
    if (u > 0) at.lerp(flick, snapK).lerp(away, easeK);
    rig.root.position.copy(at);
    // 朝向：先把手臂（+X）转到朝前（-Z），再整只手往下俯；甩的时候手腕带着往上扬
    const pitch = lerp(lerp(-0.25, -0.3, hookK), 0.05, u > 0 ? snapK : 0);
    rig.root.quaternion.setFromEuler(new THREE.Euler(pitch, Math.PI / 2 - 0.16, 0, 'XYZ'));
    // 镜头：在牌桌对面（对手那边）、贴着桌面，看她搭在牌背上面的指尖；整排牌往远处收。甩出去以后跟着牌往上抬
    const lift = smooth(u / 0.45);
    this.camera.position.set(hx + 4.6 - lift * 0.6, 2.2 + lift * 0.6, -9.4 - lift * 1.0);
    this.camera.up.set(-0.12, 1, 0).normalize();
    this.camera.lookAt(hx - 0.3, top + 1.15 + now.y * 0.7, 0);
    if (this.opts.debug?.cam) {
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(...this.opts.debug.cam);
      this.camera.lookAt(...(this.opts.debug.look ?? [0, 1, 0]));
    }
  }

  // delay 毫秒以后开演（场景已经搭好了，等的是牌桌上那一下）
  play(delay = 0): void {
    if (delay > 0) {
      this.timer = window.setTimeout(() => this.play(), delay);
      return;
    }
    this.t0 = performance.now();
    const tick = () => {
      if (this.done) return;
      const t = (performance.now() - this.t0) / 1000;
      this.frame(t);
      if (t >= CUTIN_TIME) {
        this.dispose();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.row?.dispose();
    for (const g of this.ghosts) {
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.Material).dispose();
      });
    }
    // 手模留着下次用：从这个场景里摘出来，骨头摆回原样
    if (this.rig) {
      const src = this.rig.root.children[0];
      this.rig.root.remove(src);
      for (const b of Object.values(this.rig.bones)) b.quaternion.identity();
    }
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.el.remove();
    this.opts.onDone?.();
  }
}

// 演一遍特写：现在就搭场景，delay 毫秒以后开演（备好得晚就备好了马上演），演完自己收掉。
// 返回的函数可以提前收掉（换局、离开牌桌）
export function playAwaiCutIn(host: HTMLElement, opts: CutInOptions, delay = 0): () => void {
  const c = new AwaiCutIn(host, opts);
  const at = performance.now() + delay;
  void c.ready().then((ok) => (ok ? c.play(at - performance.now()) : c.dispose()));
  return () => c.dispose();
}
