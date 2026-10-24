// 头像和切入立绘的摄影棚：在浏览器里加载角色模型，摆好表情和姿势，拍成透明背景的图。
// 由 scripts/render-portraits.mjs 通过 Vite 打开，游戏里不用。
import * as THREE from 'three';
import { Avatar } from '../src/ui3d/avatar';
import { FACES, Face, LOOKS, applyLook } from '../src/ui3d/looks';

// 每种表情用模型自带的哪几个表情、各用多少
const FACE_MIX: Record<Face, Record<string, number>> = {
  neutral: {},
  happy: { happy: 1 },
  sad: { sad: 0.85 },
  surprised: { surprised: 1 },
  serious: { angry: 0.75 },
};

// 切入立绘：右手抬到哪（模型自身坐标，单位米，+x 是角色的右手边，-z 是前方；y 从髋部算起）、用什么表情
interface CutinPose {
  hand: [number, number, number];
  face: Face;
  extra?: Record<string, number>;
}
const CUTIN: Record<string, CutinPose> = {
  saki: { hand: [0.22, 0.36, -0.3], face: 'happy' },
  nodoka: { hand: [-0.02, 0.28, -0.18], face: 'serious' },
  kuro: { hand: [0.2, 0.42, -0.36], face: 'happy' },
  toki: { hand: [0.17, 0.55, -0.12], face: 'neutral', extra: { relaxed: 0.5 } },
  awai: { hand: [0.24, 0.4, -0.32], face: 'happy' },
  kasumi: { hand: [0.12, 0.3, -0.2], face: 'neutral', extra: { relaxed: 0.6 } },
  koromo: { hand: [0.2, 0.5, -0.3], face: 'happy' },
  hiroe: { hand: [0.22, 0.36, -0.3], face: 'happy' },
};

const BUST = 256;
const CUTIN_W = 480;
const CUTIN_H = 640;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(1);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#f4f8ff', '#3a4446', 1.4));
const key = new THREE.DirectionalLight('#fff4e0', 2.4);
key.position.set(-1.2, 2.2, -2);
scene.add(key);
// 背后打一道轮廓光，头发边缘亮一点，贴到深色头像框上也分得开
const rim = new THREE.DirectionalLight('#ffffff', 1.6);
rim.position.set(1.5, 1.8, 2);
scene.add(rim);

function setFace(av: Avatar, mix: Record<string, number>): void {
  const em = av.vrm.expressionManager;
  if (!em) return;
  for (const n of ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'oh', 'blink']) if (em.getExpression(n)) em.setValue(n, 0);
  for (const [n, w] of Object.entries(mix)) {
    // VRM 0.x 没有“吃惊”，和牌桌上一样用张嘴代替
    if (n === 'surprised' && !em.getExpression('surprised')) em.setValue('oh', w * 0.7);
    else if (em.getExpression(n)) em.setValue(n, w);
  }
  em.update();
}

// 让人看着镜头，头发、衣服的弹簧骨骼晃完停稳
function settle(av: Avatar, eye: THREE.Vector3): void {
  av.home = null;
  av.lookAtPoint(eye, 1e6);
  for (let i = 0; i < 120; i++) av.update(1 / 30);
}

function shoot(camera: THREE.PerspectiveCamera, w: number, h: number): string {
  // 先按两倍大小画，再缩小，边缘更平滑
  renderer.setSize(w * 2, h * 2, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(renderer.domElement, 0, 0, w, h);
  return out.toDataURL('image/webp', 0.9);
}

// 切入立绘的镜头：从左前方稍微往上拍，框住头顶、腰和两只手（手指留出余量），手伸得再远也拍得进来
function frame(cam: THREE.PerspectiveCamera, av: Avatar, head: THREE.Vector3): void {
  const at = (n: 'hips' | 'leftHand' | 'rightHand') => av.vrm.humanoid!.getNormalizedBoneNode(n)!.getWorldPosition(new THREE.Vector3());
  const top = head.clone().add(new THREE.Vector3(0, 0.22, 0));
  const waist = at('hips').add(new THREE.Vector3(0, 0.04, 0));
  const hands = [at('leftHand'), at('rightHand')];
  const dir = new THREE.Vector3(-0.3, -0.06, -1).normalize();
  const look = top.clone().add(waist).multiplyScalar(0.5);
  let dist = 2;
  for (let i = 0; i < 40; i++) {
    cam.position.copy(look).addScaledVector(dir, dist);
    cam.lookAt(look);
    cam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const pts = [top, waist];
    for (const h of hands) for (const d of [right, up]) pts.push(h.clone().addScaledVector(d, 0.1), h.clone().addScaledVector(d, -0.1));
    const ndc = pts.map((p) => p.clone().project(cam));
    const [x0, x1] = [Math.min(...ndc.map((p) => p.x)), Math.max(...ndc.map((p) => p.x))];
    const [y0, y1] = [Math.min(...ndc.map((p) => p.y)), Math.max(...ndc.map((p) => p.y))];
    // 画面中心挪到这些点的正中间，再按超出（或空出）多少拉远拉近，四边各留 5%
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    look.addScaledVector(right, ((x0 + x1) / 2) * halfH * cam.aspect).addScaledVector(up, ((y0 + y1) / 2) * halfH);
    dist *= Math.max((x1 - x0) / 2, (y1 - y0) / 2) / 0.9;
  }
}

// 给一个角色拍 5 张头像和 1 张切入立绘，返回 文件名 → webp 的 data URL
export async function renderCharacter(id: string): Promise<Record<string, string>> {
  const look = LOOKS[id];
  const av = await Avatar.load(look.model);
  applyLook(av.vrm, look);
  scene.add(av.root);
  const out: Record<string, string> = {};
  const head = av.vrm.humanoid!.getNormalizedBoneNode('head')!;
  const headAt = () => head.getWorldPosition(new THREE.Vector3());

  // 头像：胸像，稍微侧一点的正脸，看着镜头
  av.setRestPose(0, 0, 'lap');
  const bust = new THREE.PerspectiveCamera(20, 1, 0.05, 20);
  settle(av, headAt().add(new THREE.Vector3(0.25, 0, -1.2)));
  const h = headAt();
  bust.position.copy(h).add(new THREE.Vector3(0.24, 0.04, -1.3));
  bust.lookAt(h.clone().add(new THREE.Vector3(0, -0.01, 0)));
  for (const face of FACES) {
    setFace(av, FACE_MIX[face]);
    out[`${id}-${face}.webp`] = shoot(bust, BUST, BUST);
  }

  // 切入立绘：站着的半身像（头顶到腰），抬手，镜头稍微从下往上拍
  const pose = CUTIN[id];
  for (const n of ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg'] as const) {
    av.vrm.humanoid!.getNormalizedBoneNode(n)?.quaternion.identity();
  }
  // 没抬的那只手叉在腰边（借用扶桌沿的姿势，把“桌沿”放到腰的高度）；抱胸的角色还是抱胸
  if (look.pose === 'crossed') av.setRestPose(0, 0, 'crossed');
  else av.setRestPose(av.hipHeight + 0.12, -0.12, 'edge');
  av.reachTarget = av.root.localToWorld(new THREE.Vector3(pose.hand[0], av.hipHeight + pose.hand[1], pose.hand[2]));
  av.reachWeight = 1;
  const cut = new THREE.PerspectiveCamera(26, CUTIN_W / CUTIN_H, 0.05, 20);
  settle(av, headAt().add(new THREE.Vector3(-0.3, 0, -1.6)));
  frame(cut, av, headAt());
  setFace(av, { ...FACE_MIX[pose.face], ...pose.extra });
  out[`${id}-cutin.webp`] = shoot(cut, CUTIN_W, CUTIN_H);

  scene.remove(av.root);
  return out;
}
