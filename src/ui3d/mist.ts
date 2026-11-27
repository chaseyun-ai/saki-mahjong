import * as THREE from 'three';
import { fogNoise } from '../ui/fogNoise';
import { MistLook, MistTone, WALL_STACKS, mistTone, stackDepth } from '../ui/mistLook';

// 高鸭稳乃的深山：牌山上的雾（吉野山里贴着山脊往外漫的云海）。
//
// 雾从牌山最深处（王牌那头）起，顺着牌山往前漫：深山标记越多，罩住的牌山越长、雾也越浓越高（ui/mistLook.ts）。
// 最深处最厚：先是缠在牌山上的一层，浓了以后山顶再堆起一层，往桌子中间、桌边各漫出去一些；越靠前沿越薄，
// 前沿自己一进一退地呼吸，像雾舌头在往前探。每一局牌山摆好以后，雾都从最深处重新漫出来。
// 只罩在真的摆好了的墩上：新牌山还没升上来、牌还在飞的时候不起雾；一墩摸空了，它上面的雾慢慢散掉。
// 翻开的宝牌指示牌上雾让开一些，看得清是哪张。
//
// 画法：一团团朝着镜头的雾（所有雾团合成一次绘制），纹路查一张事先算好的噪声贴图（ui/fogNoise.ts），
// 噪声按世界坐标取，所以叠在一起的雾团纹路是连着的，看上去是一整片雾在流，不是一个个圆片。
// 没轮到的雾团在顶点着色器里直接收成一个点，不占填充；桌上没有稳乃时什么都不建。

export const STACKS = 17; // 每排牌山几墩
const WALLS = 4;

// 一种雾团：每几墩放一团、离桌面多高、往桌子中间偏多少（负的是往桌边）、多大、
// 多浓才出现（rank，0 是有雾就有）、多不透明、雾浓了往上抬多少、
// 比深度时往镜头这边让多少（near）：雾团是朝着镜头的一个面，缠在牌山上的会被牌切掉靠镜头的半边，
// 让它算得近一点，牌就整张罩在雾里；让得不多，更靠前的手牌照样挡得住它
interface PuffKind {
  every: number;
  y: [number, number];
  side: [number, number];
  r: [number, number];
  rank: [number, number];
  alpha: number;
  lift: number;
  near: number;
}
const KINDS: PuffKind[] = [
  { every: 1, y: [1.5, 1.85], side: [-0.2, 0.2], r: [1.15, 1.45], rank: [0, 0], alpha: 0.5, lift: 0.15, near: 0.8 }, // 缠在牌山上
  { every: 2, y: [2.0, 2.4], side: [-0.3, 0.3], r: [1.35, 1.75], rank: [0.3, 0.85], alpha: 0.28, lift: 0.5, near: 0.8 }, // 山顶堆起来的
  { every: 3, y: [0.8, 1.05], side: [0.55, 1.0], r: [1.25, 1.65], rank: [0.45, 0.95], alpha: 0.18, lift: 0.1, near: 0 }, // 往桌子中间漫一点
  { every: 3, y: [0.8, 1.05], side: [-1.0, -0.55], r: [1.25, 1.65], rank: [0.45, 0.95], alpha: 0.18, lift: 0.1, near: 0 }, // 往桌边漫一点
];

const NOISE_SIZE = 128;
const FULL_PAD = 8; // 罩满时前沿再往前推这么多墩，最前面那几墩也是实的
const OPEN_FILL = 0.25; // 翻开的指示牌那一墩留几成雾
const NEAR_OPEN_FILL = 0.8; // 它两边的墩

const VERT = /* glsl */ `
attribute vec4 aCenter; // 位置，和比深度时往镜头这边让多少
attribute vec4 aShape; // 多大、离最深处几墩、多浓才出现、随机数
attribute vec4 aLook; // 多不透明、往前（牌山浅的那头）的方向 xz、雾浓了往上抬多少
attribute float aFill; // 这一墩上现在有几成雾（牌山摆好了没有）
uniform float uTime;
uniform float uReach;
uniform float uDensity;
uniform float uFade;
varying vec2 vUv;
varying vec3 vWorld;
varying vec4 vInfo; // 不透明度、随机数、纹路往哪流

void main() {
  float seed = aShape.w;
  // 前沿：每团雾自己慢慢地一进一退
  float wob = sin(uTime * 0.31 + seed * 41.0) * 1.3 + sin(uTime * 0.17 + seed * 17.0) * 0.9;
  float inside = uReach - aShape.y;
  float front = smoothstep(-1.5, 3.5, inside + wob);
  // 离前沿越远（越深）越厚
  float deep = smoothstep(0.0, 9.0, inside);
  // 王牌那一段是雾的源头：刚起雾时这里也已经是一团浓雾
  float source = 1.0 - smoothstep(3.0, 10.0, aShape.y);
  float shows = smoothstep(aShape.z - 0.12, aShape.z + 0.06, uDensity * (0.5 + 0.5 * deep) + 0.2 * source);
  float alpha = aLook.x * front * shows * aFill * uFade * (0.8 + 0.2 * uDensity) * (1.0 + 0.35 * source);
  vUv = position.xy;
  vInfo = vec4(alpha, seed, aLook.yz * 0.028);
  if (alpha < 0.003) {
    // 没轮到的雾团收成裁剪范围外的一个点，一个像素也不画
    vWorld = vec3(0.0);
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float size = aShape.x * (0.86 + 0.24 * uDensity) * (0.55 + 0.45 * front) * (0.82 + 0.18 * deep) * (1.0 + 0.06 * source);
  float t = uTime * 0.23 + seed * 31.0;
  vec3 c = aCenter.xyz;
  c.xz += aLook.yz * sin(t) * 0.35 + vec2(-aLook.z, aLook.y) * sin(t * 0.71 + 1.3) * 0.18;
  c.y += aLook.w * (uDensity - 0.4) + sin(t * 0.53 + 2.1) * 0.08;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = (modelMatrix * vec4(c, 1.0)).xyz + (right * position.x + up * position.y) * size;
  vWorld = world;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  if (aCenter.w > 0.0) {
    vec4 near = projectionMatrix * vec4(mv.xy, mv.z + aCenter.w, 1.0);
    gl_Position.z = (near.z / near.w) * gl_Position.w;
  }
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uDensity;
uniform float uFloor;
uniform vec3 uLight;
uniform vec3 uShade;
varying vec2 vUv;
varying vec3 vWorld;
varying vec4 vInfo;

void main() {
  float d = dot(vUv, vUv);
  if (d >= 1.0) discard;
  float fall = 1.0 - d;
  // 纹路按世界坐标取（叠着的雾团纹路连成一片），顺着牌山往前慢慢流
  // （雾团是斜着朝镜头的：高度从纵向里减掉，纹路才不会顺着镜头的方向被拉成一道道的）
  vec2 p = vec2(vWorld.x, vWorld.z - vWorld.y) * 0.095 - vInfo.zw * uTime;
  float n1 = texture2D(uNoise, p).r;
  float n2 = texture2D(uNoise, p * 2.6 + vec2(vInfo.y * 3.7, -uTime * 0.013)).g;
  // 噪声拉开对比：一缕一缕的，有浓有淡
  float wisp = smoothstep(0.28, 0.72, n1 * 0.6 + n2 * 0.4);
  // 雾团中间实、往外软着淡出去，边上被噪声啃得不圆；雾越浓啃得越少
  float bell = fall * fall;
  float cut = mix(0.34, 0.16, uDensity);
  float a = smoothstep(cut, cut + 0.5, bell * (0.72 + 1.0 * wisp));
  // 贴到桌面的地方淡出去，不留一条切出来的硬边
  a *= vInfo.x * (0.55 + 0.45 * wisp) * smoothstep(uFloor, uFloor + 0.45, vWorld.y);
  if (a < 0.004) discard;
  // 浓的地方、朝上的一面发白，薄的边上带一点山里的青灰（浅色桌布上也看得出来）
  vec3 col = mix(uShade, uLight, clamp(0.15 + 0.85 * wisp + 0.15 * vUv.y, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// 噪声贴图：红、绿两个通道各放一张不一样的噪声
let noiseTex: THREE.DataTexture | null = null;
function noiseTexture(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const a = fogNoise(NOISE_SIZE, 7);
  const b = fogNoise(NOISE_SIZE, 23, 8, 3);
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4);
  for (let i = 0; i < a.length; i++) {
    data[i * 4] = Math.round(a[i] * 255);
    data[i * 4 + 1] = Math.round(b[i] * 255);
    data[i * 4 + 3] = 255;
  }
  noiseTex = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = noiseTex.minFilter = THREE.LinearFilter;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

// 固定的伪随机数（0–1）：每团雾的大小、位置、快慢每次都一样
function rand(a: number, b: number, c: number): number {
  const x = Math.sin(a * 91.7 + b * 12.9898 + c * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
const pick = (range: [number, number], k: number): number => range[0] + (range[1] - range[0]) * k;

// 一墩牌山现在的样子（WallMist.setFilled 用）
export const STACK_EMPTY = 0; // 没摆好，或者摸空了
export const STACK_FILLED = 1; // 摆好了
export const STACK_OPEN = 2; // 摆好了，上面有翻开的牌（宝牌指示牌）

const rgb = (c: [number, number, number], into = new THREE.Color()): THREE.Color => into.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

export class WallMist {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null = null;
  private fill: THREE.InstancedBufferAttribute | null = null;
  private puffStack: Uint8Array = new Uint8Array(0); // 每团雾挂在哪一墩上
  private look: MistLook | null = null;
  private reach = 0; // 雾现在漫到第几墩（往 look.reach 走）
  private density = 0;
  private fade = 0; // 整片雾的淡入淡出
  private mask = new Float32Array(WALL_STACKS); // 每一墩上现在有几成雾
  private want = new Float32Array(WALL_STACKS); // 该有几成
  private sent = new Float32Array(WALL_STACKS).fill(-1); // 上一次传给显卡的
  private tops: THREE.Vector3[][] = []; // 每一墩牌山顶上的位置
  private placed = ''; // 雾团按哪一套牌山位置、哪个分开处摆的
  private hand = -1; // 第几局
  private dealer = 0;
  private diceSum = 2;
  private t = 0;
  private tone: MistTone = mistTone('#000000');

  constructor() {
    this.group.visible = false;
  }

  // 雾的样子（null 是没有雾）
  setLook(look: MistLook | null): void {
    this.look = look;
  }

  // 雾的颜色跟桌布走（浅色桌布上用灰一点的）
  setTone(tone: MistTone): void {
    if (tone === this.tone) return;
    this.tone = tone;
    const u = this.mesh?.material.uniforms;
    if (!u) return;
    rgb(tone.light, u.uLight.value as THREE.Color);
    rgb(tone.shade, u.uShade.value as THREE.Color);
  }

  // 有没有雾（没有就不用每帧去看牌山摆好了没有）
  wanted(): boolean {
    return this.look !== null || this.fade > 0;
  }

  // 四排牌山每一墩顶上的位置（tops[wall][stack]，stack 0 是这排的第 1 墩）、这一局从哪里分开、第几局。
  // 换了局，雾从最深处重新漫出来
  setWall(tops: THREE.Vector3[][], dealer: number, diceSum: number, hand: number): void {
    this.tops = tops;
    this.dealer = dealer;
    this.diceSum = diceSum;
    if (hand !== this.hand) {
      this.hand = hand;
      this.reach = 0;
      this.mask.fill(0);
    }
    if (this.mesh) this.place();
  }

  // 每一墩牌山现在的样子（按 wall * 17 + stack 排，STACK_EMPTY / STACK_FILLED / STACK_OPEN）
  setFilled(state: Uint8Array): void {
    const want = this.want;
    for (let i = 0; i < WALL_STACKS; i++) want[i] = state[i] === STACK_EMPTY ? 0 : state[i] === STACK_OPEN ? OPEN_FILL : 1;
    // 翻开的牌两边也让开一点
    for (let i = 0; i < WALL_STACKS; i++) {
      if (state[i] !== STACK_OPEN) continue;
      const at = i % STACKS;
      if (at > 0 && state[i - 1] === STACK_FILLED) want[i - 1] = Math.min(want[i - 1], NEAR_OPEN_FILL);
      if (at < STACKS - 1 && state[i + 1] === STACK_FILLED) want[i + 1] = Math.min(want[i + 1], NEAR_OPEN_FILL);
    }
  }

  // 第一次起雾才建：一张噪声贴图、一个四边形，雾团都是它的分身
  private build(): void {
    const count = WALLS * KINDS.reduce((n, k) => n + Math.ceil(STACKS / k.every), 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
    geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
    geo.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
    this.fill = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.fill.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFill', this.fill);
    geo.instanceCount = count;
    this.puffStack = new Uint8Array(count);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uNoise: { value: noiseTexture() },
        uTime: { value: 0 },
        uReach: { value: 0 },
        uDensity: { value: 0 },
        uFade: { value: 0 },
        uFloor: { value: 0 },
        uLight: { value: rgb(this.tone.light) },
        uShade: { value: rgb(this.tone.shade) },
      },
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 5;
    // 雾团的位置在着色器里算，包围盒不准，不按它裁
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.placed = '';
    this.sent.fill(-1);
    this.place();
  }

  // 把雾团摆到牌山上：位置、离最深处几墩。牌山挪了（换视角）、分开处变了（换局）才重摆
  private place(): void {
    const mesh = this.mesh;
    const tops = this.tops;
    if (!mesh || tops.length !== WALLS) return;
    const key = `${this.dealer},${this.diceSum};` + tops.map((row) => `${row[0].toArray().map((v) => v.toFixed(2))}|${row[STACKS - 1].toArray().map((v) => v.toFixed(2))}`).join(';');
    if (key === this.placed) return;
    this.placed = key;
    const center = mesh.geometry.getAttribute('aCenter') as THREE.InstancedBufferAttribute;
    const shape = mesh.geometry.getAttribute('aShape') as THREE.InstancedBufferAttribute;
    const look = mesh.geometry.getAttribute('aLook') as THREE.InstancedBufferAttribute;
    const fwd = new THREE.Vector3();
    const side = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const at = new THREE.Vector3();
    let n = 0;
    for (let w = 0; w < WALLS; w++) {
      const row = tops[w];
      // 往前：牌山浅的那头（墩数小的那头先摸）；往里：朝桌子中间
      fwd.copy(row[0]).sub(row[STACKS - 1]).setY(0).normalize();
      mid.copy(row[0]).add(row[STACKS - 1]).multiplyScalar(0.5).setY(0);
      side.set(-fwd.z, 0, fwd.x);
      if (side.dot(mid) > 0) side.negate();
      KINDS.forEach((kind, k) => {
        for (let i = 0; i < STACKS; i += kind.every) {
          at.copy(row[i]).addScaledVector(side, pick(kind.side, rand(w, i, k * 7 + 1))).addScaledVector(fwd, (rand(w, i, k * 7 + 2) - 0.5) * 0.6);
          center.setXYZW(n, at.x, pick(kind.y, rand(w, i, k * 7 + 3)), at.z, kind.near);
          shape.setXYZW(n, pick(kind.r, rand(w, i, k * 7 + 4)), stackDepth(this.dealer, this.diceSum, w, i + 1), pick(kind.rank, rand(w, i, k * 7 + 5)), rand(w, i, k * 7 + 6));
          look.setXYZW(n, kind.alpha, fwd.x, fwd.z, kind.lift);
          this.puffStack[n] = w * STACKS + i;
          n++;
        }
      });
    }
    center.needsUpdate = true;
    shape.needsUpdate = true;
    look.needsUpdate = true;
  }

  update(dt: number): void {
    const look = this.look;
    if (!look && this.fade <= 0) return;
    if (look && !this.mesh) this.build();
    this.t += dt;
    // 整片雾淡入、淡出（一秒左右）
    this.fade = look ? Math.min(1, this.fade + dt * 1.1) : Math.max(0, this.fade - dt * 1.5);
    if (look) {
      // 前沿顺着牌山往前漫：离得远走得快，快到了慢下来
      const goal = look.reach >= WALL_STACKS ? WALL_STACKS + FULL_PAD : look.reach;
      const gap = goal - this.reach;
      this.reach += Math.sign(gap) * Math.min(Math.abs(gap), dt * Math.max(4, Math.abs(gap) * 1.1));
      this.density += (look.density - this.density) * (1 - Math.exp(-dt * 1.5));
    }
    // 一墩一墩地起、散：摆好的墩雾慢慢起来（旁边已经有雾的起得快，像从旁边流过来），摸空的散得快一点
    const mask = this.mask;
    let any = false;
    let dirty = false;
    for (let i = 0; i < WALL_STACKS; i++) {
      const want = this.want[i];
      if (want !== mask[i]) {
        const at = i % STACKS;
        const near = Math.max(at > 0 ? mask[i - 1] : 0, at < STACKS - 1 ? mask[i + 1] : 0);
        const rate = want > mask[i] ? 0.3 + 0.5 * rand(i, 3, 5) + 1.6 * near : 1.4;
        mask[i] += Math.sign(want - mask[i]) * Math.min(Math.abs(want - mask[i]), dt * rate);
      }
      if (mask[i] > 0.002) any = true;
      if (Math.abs(mask[i] - this.sent[i]) > 0.004) dirty = true;
    }
    const mesh = this.mesh;
    this.group.visible = !!mesh && this.fade > 0.003 && any;
    // 散干净了：下次起雾又从最深处漫出来
    if (!look && this.fade <= 0) this.reach = 0;
    if (!mesh || !this.group.visible) return;
    if (dirty && this.fill) {
      this.sent.set(mask);
      const arr = this.fill.array as Float32Array;
      for (let n = 0; n < arr.length; n++) arr[n] = mask[this.puffStack[n]];
      this.fill.needsUpdate = true;
    }
    const u = mesh.material.uniforms;
    u.uTime.value = this.t;
    u.uReach.value = this.reach;
    u.uDensity.value = this.density;
    u.uFade.value = this.fade;
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
    this.mesh?.material.dispose();
    this.mesh?.removeFromParent();
    this.mesh = null;
    this.fill = null;
  }
}
