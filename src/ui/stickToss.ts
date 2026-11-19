import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TILE_H, TILE_T, TILE_W } from '../ui3d/tableLayout';
import { faceSvg } from './tileArt';
import type { Kind } from '../engine/tiles';

// 扔立直棒的过场（transition.ts 的 stick 用它画画面）：
// 贴着桌面的低机位，桌布上一摊牌河（最后一张横着，是立直宣言牌），后面一道牌山。
// 一根立直棒从画面右边贴着桌面飞进来，前头磕在桌布上，整根弹起来竖着，
// 翻过头往牌河那边倒，飞起来翻半圈，拍在牌河前面，弹一下躺平。之后（transition.ts 里）整个画面泛白，换页。
//
// 参考的动画到「翻过头飞起来」就停了（棒子悬在半空，后面只有泛白），落地这一段是补的：
// 照着前面的速度接一个抛物线，转到正好平着落地，再弹一下。
//
// 画在一块看不见的 WebGL 画布上，每一帧由 transition.ts 拷到过场的 2D 画布上。

// 立直棒的长、宽、厚（和牌桌里的一样：长 3.6 张牌宽）
const STICK_LEN = 3.6;
const STICK_W = 0.36;
const STICK_T = 0.16;
const HALF = STICK_LEN / 2;

// 时间点（秒）
export const STICK_TIMES = {
  hit: 0.3, // 前头磕到桌布
  stand: 0.5, // 竖起来，蹬离桌面
  land: 0.94, // 平着拍到桌上
  settle: 1.26, // 弹完躺平
};

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));
const easeOut = (u: number) => 1 - (1 - u) ** 2;

interface Pose {
  // 棒子中心
  x: number;
  y: number;
  z: number;
  // 朝向：yaw 绕竖轴（0 = 朝 +x），pitch 抬起来的角（0 平放，π/2 竖着，π 翻过来平放），spin 绕自己的长轴滚
  yaw: number;
  pitch: number;
  spin: number;
}

// 前头（左端）沿 dir 反方向，棒子的方向向量
function dirOf(yaw: number, pitch: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.sin(yaw));
}

// 几个关键位置
const P_HIT = new THREE.Vector3(2.75, 0, 1.15); // 前头磕桌的点（之后当支点）
const YAW_A0 = 0.42;
const YAW_A1 = 0.16;
const YAW_B1 = 0.08;
const PITCH_B1 = 1.47; // 竖到 84°
const YAW_LAND = -0.36; // 落地时斜着：从屏幕左上到右下（大致横着，右头离镜头近一点）
const LAND = new THREE.Vector3(-0.2, STICK_T / 2, 2.05);

// t 秒时棒子在哪、什么姿势
export function stickPose(t: number): Pose {
  const T = STICK_TIMES;
  if (t < T.hit) {
    // 贴着桌面飞进来：前头从画面外往磕桌点去，略往下沉，边飞边滚
    const u = t / T.hit;
    const yaw = lerp(YAW_A0, YAW_A1, u);
    const pitch = lerp(-0.1, 0.06, u);
    const lead = new THREE.Vector3(lerp(10.5, P_HIT.x, u), lerp(0.75, 0, u ** 1.4), lerp(0.4, P_HIT.z, u));
    const c = lead.addScaledVector(dirOf(yaw, pitch), HALF);
    return { x: c.x, y: Math.max(c.y, STICK_T / 2), z: c.z, yaw, pitch, spin: lerp(-2.2, 0, u) };
  }
  if (t < T.stand) {
    // 前头顶在桌上当支点，后头往上翻，越翻越慢
    const u = easeOut((t - T.hit) / (T.stand - T.hit));
    const yaw = lerp(YAW_A1, YAW_B1, u);
    const pitch = lerp(0.06, PITCH_B1, u);
    const c = P_HIT.clone().addScaledVector(dirOf(yaw, pitch), HALF);
    return { x: c.x, y: c.y, z: c.z, yaw, pitch, spin: 0 };
  }
  const c0 = P_HIT.clone().addScaledVector(dirOf(YAW_B1, PITCH_B1), HALF);
  if (t < T.land) {
    // 蹬离桌面：中心走一道抛物线，翻过头、转半圈，正好平着落下来
    const u = (t - T.stand) / (T.land - T.stand);
    const yaw = lerp(YAW_B1, YAW_LAND, u * u * (3 - 2 * u));
    // 翻的速度接着竖起来时的速度，后面稍快一点（倒下去）
    const pitch = lerp(PITCH_B1, Math.PI, u ** 1.15);
    const peak = 1.05;
    let y = lerp(c0.y, LAND.y, u) + peak * 4 * u * (1 - u);
    // 两头都不能插进桌布
    const reach = HALF * Math.abs(Math.sin(pitch)) + (STICK_T / 2) * Math.abs(Math.cos(pitch));
    y = Math.max(y, reach);
    return { x: lerp(c0.x, LAND.x, u), y, z: lerp(c0.z, LAND.z, u), yaw, pitch, spin: lerp(0, 0.35, u) };
  }
  // 拍到桌上：弹起来一点、往前滑一点，左右晃两下躺平
  const s = t - T.land;
  const d = T.settle - T.land;
  const u = clamp01(s / d);
  const hop1 = s < 0.17 ? 0.2 * Math.sin((Math.PI * s) / 0.17) : 0;
  const hop2 = s >= 0.17 && s < 0.27 ? 0.05 * Math.sin((Math.PI * (s - 0.17)) / 0.1) : 0;
  const rock = 0.13 * Math.exp(-s * 9) * Math.sin(s * 34);
  const slide = easeOut(u) * 0.32;
  const pitch = Math.PI + rock;
  const reach = HALF * Math.abs(Math.sin(pitch)) + (STICK_T / 2) * Math.abs(Math.cos(pitch));
  return {
    x: LAND.x - slide * 0.8,
    y: Math.max(LAND.y + hop1 + hop2, reach),
    z: LAND.z - slide * 0.35,
    yaw: YAW_LAND - easeOut(u) * 0.07,
    pitch,
    spin: 0.35 * (1 - easeOut(u)),
  };
}

// 立直棒的贴图：白棒子，中间一颗红点（一千点棒），两头一点阴影
function stickTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  // 长宽比和棒子一样（10:1），红点才是圆的
  c.width = 640;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(1, '#ece8de');
  g.fillStyle = grd;
  g.fillRect(0, 0, 640, 64);
  g.fillStyle = '#c4212c';
  g.beginPath();
  g.arc(320, 32, 15, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.arc(315, 27, 5, 0, TAU);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 桌布：深绿、有一点绒毛的颗粒，远处暗一点
function feltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#17704f';
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 18;
    img.data[i] += n * 0.5;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.7;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  t.anisotropy = 8;
  return t;
}

// 牌河：两排，第二排最后一张横着（立直宣言牌）。种类用引擎的编号（0–8 万、9–17 筒、18–26 索、27– 字）
const RIVER: Kind[][] = [
  [27, 8, 13, 30, 0, 22],
  [33, 4, 19, 16],
];

export class StickToss {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 100);
  private stick: THREE.Mesh;
  private disposables: { dispose(): void }[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    // 拷到过场画布上要在同一帧里拷：不用 preserveDrawingBuffer
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color('#0d3a29');

    // 光：顶上偏右后方一盏主灯（影子落到左前方），再一层天光
    this.scene.add(new THREE.HemisphereLight('#fff6e6', '#1e3b2c', 1.15));
    const key = new THREE.DirectionalLight('#fff3df', 2.3);
    key.position.set(5, 11, -5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -9;
    sc.right = 9;
    sc.top = 9;
    sc.bottom = -9;
    sc.near = 1;
    sc.far = 30;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    this.scene.add(key);

    const felt = feltTexture();
    const feltMat = new THREE.MeshStandardMaterial({ map: felt, roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), feltMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // 桌布上一道黑线（区域线），斜着穿过画面
    const lineMat = new THREE.MeshBasicMaterial({ color: '#0b2a1d' });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(26, 0.06), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.002, 3.3);
    this.scene.add(line);
    this.disposables.push(felt, feltMat, floor.geometry, lineMat, line.geometry);

    this.buildTiles();

    const tex = stickTexture();
    const side = new THREE.MeshStandardMaterial({ color: '#f4f1e8', roughness: 0.35 });
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32 });
    const geo = new RoundedBoxGeometry(STICK_LEN, STICK_T, STICK_W, 3, 0.07);
    this.stick = new THREE.Mesh(geo, [side, side, top, top, side, side]);
    this.stick.castShadow = true;
    this.stick.receiveShadow = true;
    this.scene.add(this.stick);
    this.disposables.push(tex, side, top, geo);
  }

  // 牌：牌身象牙白、牌背橙色；牌面用游戏里的牌面图（SVG 转成贴图，读好了再刷新）
  private buildTiles(): void {
    const bodyGeo = new RoundedBoxGeometry(TILE_W, TILE_T * 0.62, TILE_H, 4, 0.11);
    const backGeo = new RoundedBoxGeometry(TILE_W, TILE_T * 0.42, TILE_H, 4, 0.11);
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#f7f1e1', roughness: 0.36 });
    const backMat = new THREE.MeshStandardMaterial({ color: '#e2a03a', roughness: 0.34 });
    const faceGeo = new THREE.PlaneGeometry(TILE_W * 0.86, TILE_H * 0.88);
    this.disposables.push(bodyGeo, backGeo, bodyMat, backMat, faceGeo);
    // 一张牌：faceUp 时牌面朝上（y+），否则扣着
    const tile = (kind: Kind | null, faceUp: boolean): THREE.Group => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      const back = new THREE.Mesh(backGeo, backMat);
      body.position.y = faceUp ? TILE_T * 0.19 : -TILE_T * 0.19;
      back.position.y = faceUp ? -TILE_T * 0.25 : TILE_T * 0.25;
      for (const m of [body, back]) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      g.add(body, back);
      if (kind !== null && faceUp) {
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = 224;
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        const img = new Image();
        img.onload = () => {
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
          tex.needsUpdate = true;
        };
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(faceSvg(kind, false).replace('width="100%" height="100%"', 'width="160" height="224"'))}`;
        const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4 });
        const face = new THREE.Mesh(faceGeo, mat);
        face.rotation.x = -Math.PI / 2;
        face.position.y = TILE_T / 2 + 0.004;
        g.add(face);
        this.disposables.push(tex, mat);
      }
      g.position.y = TILE_T / 2;
      return g;
    };
    // 牌河：牌底朝镜头（+z）。两排，第二排在后面
    const gap = 0.04;
    const x0 = -4.4;
    RIVER.forEach((row, r) => {
      let x = x0;
      row.forEach((k, i) => {
        const last = r === 1 && i === row.length - 1;
        const t = tile(k, true);
        if (last) {
          t.rotation.y = Math.PI / 2;
          x += (TILE_H - TILE_W) / 2;
        }
        t.position.x = x + TILE_W / 2;
        t.position.z = -r * (TILE_H + gap) + (last ? 0.12 : 0);
        // 摆得不那么整齐，像真的打出来的
        t.rotation.y += Math.sin(r * 7 + i * 3.1) * 0.03;
        x += (last ? TILE_H : TILE_W) + gap;
        this.scene.add(t);
      });
    });
    // 后面一道牌山：两层扣着
    for (let i = 0; i < 14; i++) {
      for (let l = 0; l < 2; l++) {
        const t = tile(null, false);
        t.position.set(-7.5 + i * (TILE_W + 0.02), TILE_T / 2 + l * TILE_T, -5.4);
        this.scene.add(t);
      }
    }
  }

  // 画 t 秒时的一帧（w×h 设备像素）
  render(t: number, w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
    }
    // 镜头：低机位、从右前方看过去，整段慢慢往前推一点；落地那一下抖一下
    const push = clamp01(t / 1.6);
    const shake = t > STICK_TIMES.land ? Math.exp(-(t - STICK_TIMES.land) * 14) * 0.05 * Math.sin((t - STICK_TIMES.land) * 70) : 0;
    // 竖屏：镜头退远一点，横着的东西都放得下
    const narrow = clamp01((1.2 - w / h) / 0.8);
    // 竖屏：看的地方挪到棒子起跳和落地中间，镜头往后退、视角放大，横着飞的那一段才放得下
    this.camera.fov = lerp(34, 50, narrow);
    const look = new THREE.Vector3(lerp(-0.9, 1.0, narrow), lerp(0.3, 1.3, narrow), lerp(0.1, 0.9, narrow));
    const eye = new THREE.Vector3(lerp(4.9, 4.5, push), lerp(2.45, 2.3, push), lerp(6.9, 6.4, push));
    eye.sub(new THREE.Vector3(-0.9, 0.3, 0.1)).multiplyScalar(1 + narrow * 0.3).add(look);
    this.camera.position.set(eye.x, eye.y + shake, eye.z);
    this.camera.lookAt(look);
    this.camera.updateProjectionMatrix();

    const p = stickPose(t);
    this.stick.position.set(p.x, p.y, p.z);
    // 长轴是本地 x：先绕长轴滚，再抬起来（绕本地 z），再转朝向（绕竖轴）
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.pitch))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), p.spin));
    this.stick.quaternion.copy(q);
    this.renderer.render(this.scene, this.camera);
  }

  // 棒子落地的位置在画面上的哪里（0–1），泛白从这里开始
  landingOnScreen(): { x: number; y: number } {
    const v = new THREE.Vector3(LAND.x, LAND.y, LAND.z).project(this.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
