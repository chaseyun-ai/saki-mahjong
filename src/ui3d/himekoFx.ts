import * as THREE from 'three';

// 鹤田姬子拿到钥匙的那一局（3D、2.5D）：
// 1. 配牌：她的每一张牌不从牌山飞过来，而是裹着一团火、拖着长长的橙色火尾，像流星一样从正上方的天上竖着砸进手里
//    （东一张西一张错落着落，节奏见 ui/himekoBeat.ts）。每砸一张闪一下、迸一把火星，最后一张（重拍）流星最大、
//    桌面上推开一圈光。牌本身的位置由 table3d.ts 照同一条轨迹（meteorAt）摆。
// 2. 理完牌：一团火从她的右手边沿着手牌一路烧到左手边，火舌往上卷、火星往上飘，一盏橙色的点光跟着火头走，
//    把牌和桌面映成橙色。
// 火尾、流星的火和烧手牌的火都是一张四边形实例化很多份，形状、位置、亮暗全在着色器里按时间算（一次画完，不用每帧改顶点）。
// 手法参考 Humpalumps/ultra-elements（MIT）：火尾是“白芯 + 橙色光晕”沿轴向朝镜头展开的光带，
// 火是按出生时刻解析地算轨迹的粒子（温度从白热冷成暗红），见 THIRD_PARTY_NOTICES.md

export const HIMEKO_FX = {
  drop: 0.34, // 流星从天上落到手里要多久（秒）；位置照 1 - s² 走（越落越快）
  fade: 0.35, // 落地以后火尾收细、淡掉要多久
  fall: 24, // 流星从多高（竖着的轨迹）落下来
  sweep: 1.05, // 火头从右烧到左要多久
  burn: 1.1, // 火头过去以后火还烧多久
};

const BEAM_MAX = 32;
const FIRE_COUNT = 900;
const METEOR_MAX = 16;
// 每颗流星的粒子：1 团裹着牌的火球、10 条绕着牌的火舌、21 颗落地迸出的火星、其余是一路甩在后面的火
const METEOR_PER = 80;
const METEOR_WRAP = 10;
const METEOR_BURST = 21;
const ORANGE = new THREE.Color('#ff7a18');

const BEAM_VERT = /* glsl */ `
attribute vec3 aBase;
attribute vec3 aAxis;
attribute vec4 aShape; // 长度、宽度、落地时刻、种类（0 火尾，1 落地的闪光，2 桌面上推开的光圈，3 重拍的火尾：淡得慢）
uniform float uTime;
uniform float uDrop;
uniform float uFade;
varying vec2 vQ;
varying float vAlpha;
varying float vKind;
varying float vHead;
void main() {
  float len = aShape.x, width = aShape.y, at = aShape.z;
  float kind = aShape.w;
  vKind = kind > 2.5 ? 0.0 : kind;
  vQ = position.xy * 2.0;
  float age = uTime - at;
  vec3 p;
  if (kind < 0.5 || kind > 2.5) {
    // 火尾：头跟着牌从天上加速落下，落地以后亮一下、收细、淡掉（重拍的火尾停得久一些）
    float s = clamp((uTime - (at - uDrop)) / uDrop, 0.0, 1.0);
    float head = len * (1.0 - s * s);
    float f = clamp(age / (uFade * (kind > 2.5 ? 2.2 : 1.0)), 0.0, 1.0);
    float hit = age > 0.0 ? exp(-age * 9.0) : 0.0;
    vAlpha = (s <= 0.0 || f >= 1.0) ? 0.0 : (1.0 - f) * (1.0 - f) * (0.75 + 0.6 * hit);
    vHead = age < 0.0 ? 1.0 : exp(-age * 6.0);
    float w = width * (1.0 + 0.7 * hit) * (1.0 - 0.6 * f);
    float t = position.y + 0.5;
    w *= mix(1.0, 0.12, pow(t, 0.6)); // 火尾：头粗，往天上很快收细
    p = aBase + aAxis * mix(head, len, t);
    vec3 view = normalize(cameraPosition - p);
    vec3 side = normalize(cross(aAxis, view));
    p += side * position.x * w;
  } else if (kind < 1.5) {
    // 落地的闪光：一团朝着镜头的光，一下撑开再暗下去。往镜头那边挪一点，不被牌挡住
    vAlpha = (age < 0.0 || age > 0.6) ? 0.0 : exp(-age * 6.5);
    vHead = 0.0;
    float sz = width * (1.6 + age * 7.0);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    p = aBase + normalize(cameraPosition - aBase) * width * 0.8 + (right * position.x + up * position.y) * sz;
  } else {
    // 桌面上推开的一圈光：半径照爆炸波 t^0.4 撑开，越推越淡
    float k = age / 0.75;
    vAlpha = (k < 0.0 || k > 1.0) ? 0.0 : pow(1.0 - k, 1.5);
    vHead = 0.0;
    float r = width * (0.4 + 5.0 * pow(max(k, 0.0), 0.4));
    p = aBase + vec3(position.x, 0.0, -position.y) * 2.0 * r + vec3(0.0, 0.03, 0.0);
  }
  if (vAlpha <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vQ;
varying float vAlpha;
varying float vKind;
varying float vHead;
void main() {
  vec3 hot = vec3(1.0, 0.84, 0.52);
  if (vKind < 0.5) {
    float x = vQ.x;
    float along = vQ.y * 0.5 + 0.5; // 0 是光柱的下端（头），1 是天上
    float core = exp(-x * x * 18.0);
    float glow = exp(-x * x * 2.2);
    // 往天上渐渐淡掉；落下来时头最亮
    float sky = 1.0 - smoothstep(0.35, 1.0, along);
    float head = exp(-along * 14.0) * vHead;
    float a = (glow * 0.85 + core * 0.55) * (0.4 + 0.6 * sky) + head * glow * 1.3;
    vec3 c = uColor * glow * 1.2 + hot * (core * 0.7 + head * 0.6);
    gl_FragColor = vec4(c * a * vAlpha, 1.0);
  } else if (vKind > 1.5) {
    // 光圈：前沿锐利、里面拖一点柔光
    float d = length(vQ);
    float a = exp(-pow((d - 0.88) * 14.0, 2.0)) + 0.18 * smoothstep(0.88, 0.3, d) * step(d, 0.88);
    vec3 c = mix(uColor, hot, exp(-pow((d - 0.88) * 30.0, 2.0)));
    gl_FragColor = vec4(c * a * vAlpha, 1.0);
  } else {
    float r2 = dot(vQ, vQ);
    float a = exp(-r2 * 5.0) + 0.35 * exp(-pow(sqrt(r2) - 0.62, 2.0) * 90.0);
    vec3 c = mix(uColor, hot, exp(-r2 * 14.0));
    gl_FragColor = vec4(c * a * vAlpha, 1.0);
  }
}
`;

const FIRE_VERT = /* glsl */ `
attribute vec4 aSeed;  // 随机数
attribute vec2 aPart;  // 沿手牌的位置（0 右手边，1 左手边）、种类（0 火舌，1 火星）
uniform float uTime;   // 火从右边点着以后过了多久
uniform float uSweep;
uniform vec3 uFrom;    // 右手边那张牌的外沿（贴着牌底）
uniform vec3 uTo;      // 左手边
uniform vec3 uSide;    // 桌面上和这一排垂直的方向
uniform float uScale;  // 这一排牌放大了多少
varying vec2 vQ;
varying float vHeat;
varying float vAlpha;
varying float vSpark;
void main() {
  vQ = position.xy * 2.0;
  float u = aPart.x;
  float spark = aPart.y;
  vSpark = spark;
  float birth = u * uSweep + aSeed.x * 0.22 - 0.04;
  float life = spark > 0.5 ? 0.9 + aSeed.y * 0.8 : 0.55 + aSeed.y * 0.75;
  float age = uTime - birth;
  float k = age / life;
  if (k <= 0.0 || k >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
  vec3 dir = normalize(uTo - uFrom);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = mix(uFrom, uTo, u) + uSide * ((aSeed.z - 0.35) * 1.1 * uScale);
  float s;
  if (spark > 0.5) {
    // 火星：飞得高、往前（往左）飘，越飞越小
    p += up * uScale * (0.4 + (2.5 + aSeed.w * 3.0) * k - 1.2 * k * k);
    p += dir * uScale * k * (0.6 + aSeed.z);
    p += right * sin(age * 7.0 + aSeed.x * 40.0) * 0.15 * uScale * k;
    s = uScale * 0.1 * (1.0 - k);
    vHeat = 1.0 - k * 0.6;
    vAlpha = smoothstep(0.0, 0.05, k) * (1.0 - k);
  } else {
    // 火舌：从牌底窜起来，往上卷、被火头带着往左倒，越往上越冷、越淡
    p += up * uScale * (0.2 + (2.0 + aSeed.w * 2.8) * pow(k, 0.8));
    p += dir * uScale * k * (0.35 + 0.5 * aSeed.z);
    p += right * sin(age * 11.0 + aSeed.x * 30.0) * 0.12 * uScale * k;
    s = uScale * (0.7 + aSeed.w * 0.8) * (1.0 - 0.45 * k) * smoothstep(0.0, 0.1, k);
    vHeat = (1.0 - k) * (0.55 + 0.35 * aSeed.y);
    vAlpha = (1.0 - k) * 0.42;
  }
  // 火舌是竖长的一团（在画面上竖着拉长）
  p += right * position.x * s + camUp * position.y * s * (spark > 0.5 ? 1.0 : 1.6);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FIRE_FRAG = /* glsl */ `
varying vec2 vQ;
varying float vHeat;
varying float vAlpha;
varying float vSpark;
void main() {
  vec2 q = vQ;
  float a;
  if (vSpark > 0.5) a = exp(-dot(q, q) * 4.0);
  else {
    // 下面圆、上面尖的火舌
    q.x *= 1.0 + max(q.y, 0.0) * 1.2;
    a = smoothstep(1.0, 0.1, length(q));
  }
  float h = vHeat;
  vec3 c = mix(vec3(0.5, 0.05, 0.0), vec3(1.0, 0.36, 0.03), smoothstep(0.05, 0.4, h));
  c = mix(c, vec3(1.0, 0.72, 0.22), smoothstep(0.4, 0.72, h));
  c = mix(c, vec3(1.0, 0.96, 0.82), smoothstep(0.78, 1.0, h) * a);
  gl_FragColor = vec4(c * a * vAlpha, 1.0);
}
`;

const METEOR_VERT = /* glsl */ `
attribute vec3 aBase;  // 牌落在手里的位置（中心）
attribute vec3 aAxis;  // 从这里指向天上来的方向
attribute vec4 aMeta;  // 轨迹长、落地时刻、大小、种类（0 甩在后面的火，1 裹着牌的火球，2 落地迸的火星，3 绕着牌的火舌）
attribute vec4 aSeed;
uniform float uTime;
uniform float uDrop;
varying vec2 vQ;
varying float vHeat;
varying float vAlpha;
varying float vSpark;
vec3 headAt(float s) { return aBase + aAxis * aMeta.x * (1.0 - s * s); }
void main() {
  vQ = position.xy * 2.0;
  float at = aMeta.y, sc = aMeta.z, kind = aMeta.w;
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p;
  float size, k;
  vAlpha = 0.0;
  if (kind < 0.5) {
    // 一路甩在后面的火：在流星经过的地方生出来，往火尾方向拖、往上飘，很快冷掉
    float s = pow(aSeed.x, 0.7);
    float birth = at - uDrop + s * uDrop;
    float life = 0.18 + aSeed.y * 0.32;
    k = (uTime - birth) / life;
    p = headAt(s) + (aSeed.zwy - 0.5) * 0.8 * sc + aAxis * k * 0.9 * sc + up * k * 0.3 * sc;
    size = sc * (0.75 + aSeed.w * 0.7) * (1.0 - 0.55 * k) * smoothstep(0.0, 0.08, k);
    vHeat = (1.0 - k) * (0.75 + 0.25 * aSeed.z);
    vAlpha = (1.0 - k) * 0.6;
    vSpark = 0.0;
  } else if (kind < 1.5) {
    // 裹着牌的火球：跟着牌走，一闪一闪
    k = (uTime - (at - uDrop)) / uDrop;
    p = headAt(clamp(k, 0.0, 1.0)) + aAxis * 0.15 * sc;
    size = sc * (2.1 + 0.3 * sin(uTime * 40.0 + aSeed.x * 10.0));
    vHeat = 0.85;
    vAlpha = 0.42;
    vSpark = 1.0;
  } else if (kind > 2.5) {
    // 绕着牌的火舌：贴着牌一圈，往火尾那边卷，忽大忽小
    k = (uTime - (at - uDrop)) / uDrop;
    vec3 around = normalize(aSeed.xyz - 0.5);
    around -= aAxis * dot(around, aAxis);
    p = headAt(clamp(k, 0.0, 1.0)) + around * 0.7 * sc + aAxis * (0.05 + 0.5 * aSeed.w) * sc;
    float flick = 0.75 + 0.25 * sin(uTime * 43.0 + aSeed.w * 30.0);
    size = sc * (0.7 + 0.4 * aSeed.w) * flick;
    vHeat = 0.6 + 0.3 * flick;
    vAlpha = 0.6;
    vSpark = 0.0;
  } else {
    // 落地迸出的火星：往四周、往上溅，再被重力拉下来
    float life = 0.35 + aSeed.y * 0.45;
    k = (uTime - (at + aSeed.x * 0.05)) / life;
    float a = aSeed.z * 6.2831853;
    vec3 dir = normalize(vec3(cos(a), 0.5 + aSeed.w * 1.2, sin(a)));
    p = aBase + dir * sc * (0.4 + (1.5 + aSeed.w * 2.0) * sqrt(max(k, 0.0))) - up * k * k * 1.2 * sc;
    size = sc * (aSeed.x < 0.4 ? 0.55 : 0.16) * (1.0 - k);
    vHeat = 1.0 - k * 0.8;
    vAlpha = 1.0 - k;
    vSpark = aSeed.x < 0.4 ? 0.0 : 1.0;
  }
  if (k <= 0.0 || k >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
  p += right * position.x * size + camUp * position.y * size * (vSpark > 0.5 ? 1.0 : 1.5);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export interface DescentTile {
  pos: THREE.Vector3; // 牌落在手里的中心
  floor: number; // 桌面的高度（重拍的光圈贴着它）
  axis: THREE.Vector3; // 从手里指向流星来的方向（单位向量）
  at: number; // 流星砸到手里的时刻（和 update 用同一个时钟）
  accent: 0 | 2; // 0 普通，2 最后一张（重拍：流星最大、闪光最大、推开一圈光）
}

export class HimekoFx {
  readonly group = new THREE.Group();
  readonly light = new THREE.PointLight(ORANGE, 0, 9, 1.6);
  private beams: THREE.Mesh;
  private beamGeo: THREE.InstancedBufferGeometry;
  private beamMat: THREE.ShaderMaterial;
  private fire: THREE.Mesh;
  private fireMat: THREE.ShaderMaterial;
  private meteors: THREE.Mesh;
  private meteorGeo: THREE.InstancedBufferGeometry;
  private meteorMat: THREE.ShaderMaterial;
  private flights: DescentTile[] = [];
  private fireAt = -1;
  private beamEnd = -1;
  private scale = 1;

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    // 光柱
    this.beamGeo = new THREE.InstancedBufferGeometry();
    this.beamGeo.index = quad.index;
    this.beamGeo.setAttribute('position', quad.getAttribute('position'));
    this.beamGeo.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(BEAM_MAX * 3), 3));
    this.beamGeo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(new Float32Array(BEAM_MAX * 3), 3));
    this.beamGeo.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(BEAM_MAX * 4), 4));
    this.beamGeo.instanceCount = 0;
    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: { uTime: { value: 0 }, uDrop: { value: HIMEKO_FX.drop }, uFade: { value: HIMEKO_FX.fade }, uColor: { value: ORANGE.clone() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beams = new THREE.Mesh(this.beamGeo, this.beamMat);
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 20;
    this.beams.visible = false;

    // 火：每一份实例是一个粒子
    const fireGeo = new THREE.InstancedBufferGeometry();
    fireGeo.index = quad.index;
    fireGeo.setAttribute('position', quad.getAttribute('position'));
    const seed = new Float32Array(FIRE_COUNT * 4);
    const part = new Float32Array(FIRE_COUNT * 2);
    // 固定的伪随机数：每一次烧起来样子都一样（截图、测试好对照）
    let r = 0x2f6b9d13;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < FIRE_COUNT; i++) {
      for (let j = 0; j < 4; j++) seed[i * 4 + j] = rnd();
      part[i * 2] = rnd() * 1.06 - 0.03;
      part[i * 2 + 1] = i % 5 === 0 ? 1 : 0;
    }
    fireGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    fireGeo.setAttribute('aPart', new THREE.InstancedBufferAttribute(part, 2));
    fireGeo.instanceCount = FIRE_COUNT;
    this.fireMat = new THREE.ShaderMaterial({
      vertexShader: FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSweep: { value: HIMEKO_FX.sweep },
        uFrom: { value: new THREE.Vector3() },
        uTo: { value: new THREE.Vector3() },
        uSide: { value: new THREE.Vector3() },
        uScale: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.fire = new THREE.Mesh(fireGeo, this.fireMat);
    this.fire.frustumCulled = false;
    this.fire.renderOrder = 21;
    this.fire.visible = false;

    // 流星的火：每颗流星 METEOR_PER 个粒子，轨迹在着色器里照牌的轨迹算
    this.meteorGeo = new THREE.InstancedBufferGeometry();
    this.meteorGeo.index = quad.index;
    this.meteorGeo.setAttribute('position', quad.getAttribute('position'));
    const n = METEOR_MAX * METEOR_PER;
    this.meteorGeo.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    this.meteorGeo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    this.meteorGeo.setAttribute('aMeta', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
    const mSeed = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) mSeed[i] = rnd();
    this.meteorGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(mSeed, 4));
    this.meteorGeo.instanceCount = 0;
    this.meteorMat = new THREE.ShaderMaterial({
      vertexShader: METEOR_VERT,
      fragmentShader: FIRE_FRAG,
      uniforms: { uTime: { value: 0 }, uDrop: { value: HIMEKO_FX.drop } },
      transparent: true,
      depthWrite: false,
      // 火裹着牌：不让牌把火挡住
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.meteors = new THREE.Mesh(this.meteorGeo, this.meteorMat);
    this.meteors.frustumCulled = false;
    this.meteors.renderOrder = 22;
    this.meteors.visible = false;
    // 点光一直在场景里（平时亮度 0），不会中途让材质重新编译
    this.group.add(this.beams, this.fire, this.meteors, this.light);
  }

  // 配牌的流星（节奏见 ui/himekoBeat.ts）
  descend(tiles: DescentTile[], scale: number): void {
    if (!tiles.length) return;
    const base = this.beamGeo.getAttribute('aBase') as THREE.InstancedBufferAttribute;
    const axis = this.beamGeo.getAttribute('aAxis') as THREE.InstancedBufferAttribute;
    const shape = this.beamGeo.getAttribute('aShape') as THREE.InstancedBufferAttribute;
    let n = 0;
    const put = (p: THREE.Vector3, ax: THREE.Vector3, len: number, width: number, at: number, kind: number) => {
      if (n >= BEAM_MAX) return;
      base.setXYZ(n, p.x, p.y, p.z);
      axis.setXYZ(n, ax.x, ax.y, ax.z);
      shape.setXYZW(n, len, width, at, kind);
      n++;
    };
    const up = new THREE.Vector3(0, 1, 0);
    // 每颗流星一条火尾：最后一张（重拍）最粗、留得最久
    for (const t of tiles) put(t.pos, t.axis, HIMEKO_FX.fall, (t.accent ? 2.6 : 1.5) * scale, t.at, t.accent ? 3 : 0);
    // 每砸一张闪一下；重拍那一下闪光最大，桌面上再推开一圈光
    for (const t of tiles) put(t.pos, up, 0, (t.accent ? 2.2 : 0.7) * scale, t.at, 1);
    for (const t of tiles) if (t.accent === 2) put(t.pos.clone().setY(t.floor), up, 0, 1.6 * scale, t.at, 2);
    base.needsUpdate = axis.needsUpdate = shape.needsUpdate = true;
    this.beamGeo.instanceCount = n;
    this.beamEnd = Math.max(...tiles.map((t) => t.at)) + Math.max(HIMEKO_FX.fade * 2.2, 0.85) + 0.1;
    this.beams.visible = true;
    // 流星的火
    const mb = this.meteorGeo.getAttribute('aBase') as THREE.InstancedBufferAttribute;
    const ma = this.meteorGeo.getAttribute('aAxis') as THREE.InstancedBufferAttribute;
    const mm = this.meteorGeo.getAttribute('aMeta') as THREE.InstancedBufferAttribute;
    this.flights = tiles.slice(0, METEOR_MAX);
    let m = 0;
    for (const t of this.flights) {
      const sc = scale * (t.accent === 2 ? 1.6 : 1);
      for (let j = 0; j < METEOR_PER; j++, m++) {
        mb.setXYZ(m, t.pos.x, t.pos.y, t.pos.z);
        ma.setXYZ(m, t.axis.x, t.axis.y, t.axis.z);
        mm.setXYZW(m, HIMEKO_FX.fall, t.at, sc, j === 0 ? 1 : j <= METEOR_WRAP ? 3 : j <= METEOR_WRAP + METEOR_BURST ? 2 : 0);
      }
    }
    mb.needsUpdate = ma.needsUpdate = mm.needsUpdate = true;
    this.meteorGeo.instanceCount = m;
    this.meteors.visible = true;
  }

  // 第 s（0–1）段时流星（牌）在哪：和着色器里的 headAt 一样
  static meteorAt(t: Pick<DescentTile, 'pos' | 'axis'>, s: number): THREE.Vector3 {
    return t.pos.clone().addScaledVector(t.axis, HIMEKO_FX.fall * (1 - s * s));
  }

  // 火从 from（她的右手边）烧到 to（左手边）。from、to 贴着牌底，side 是桌面上和这一排垂直的方向
  burn(from: THREE.Vector3, to: THREE.Vector3, side: THREE.Vector3, scale: number, at: number): void {
    const u = this.fireMat.uniforms;
    (u.uFrom.value as THREE.Vector3).copy(from);
    (u.uTo.value as THREE.Vector3).copy(to);
    (u.uSide.value as THREE.Vector3).copy(side).normalize();
    u.uScale.value = scale;
    this.scale = scale;
    this.fireAt = at;
    this.fire.visible = true;
  }

  // 什么时候放完（busyMs 用）
  get endsAt(): number {
    return Math.max(this.beamEnd, this.fireAt >= 0 ? this.fireAt + HIMEKO_FX.sweep + HIMEKO_FX.burn : -1);
  }

  stop(): void {
    this.beams.visible = this.fire.visible = this.meteors.visible = false;
    this.beamGeo.instanceCount = 0;
    this.meteorGeo.instanceCount = 0;
    this.flights = [];
    this.fireAt = this.beamEnd = -1;
    this.light.intensity = 0;
  }

  update(now: number): void {
    this.beamMat.uniforms.uTime.value = now;
    this.meteorMat.uniforms.uTime.value = now;
    if (this.beams.visible && now > this.beamEnd) {
      this.beams.visible = this.meteors.visible = false;
      this.beamGeo.instanceCount = 0;
      this.meteorGeo.instanceCount = 0;
    }
    if (!this.fire.visible) {
      // 配牌时点光跟着正在落的那颗流星，把牌、桌面映成橙色
      let lit: DescentTile | null = null;
      for (const t of this.flights) if (now > t.at - HIMEKO_FX.drop && now < t.at + 0.25 && (!lit || t.at > lit.at)) lit = t;
      if (lit) {
        const s = THREE.MathUtils.clamp((now - (lit.at - HIMEKO_FX.drop)) / HIMEKO_FX.drop, 0, 1);
        this.light.position.copy(HimekoFx.meteorAt(lit, s));
        this.light.intensity = (lit.accent === 2 ? 40 : 18) * (now < lit.at ? 1 : 1 - (now - lit.at) / 0.25);
        this.light.distance = 10 * this.scale;
      } else this.light.intensity = 0;
      return;
    }
    const t = now - this.fireAt;
    this.fireMat.uniforms.uTime.value = t;
    // 点光跟着火头走：点着时亮起来，烧到头以后慢慢暗下去
    const u = this.fireMat.uniforms;
    const k = THREE.MathUtils.clamp(t / HIMEKO_FX.sweep, 0, 1);
    this.light.position.lerpVectors(u.uFrom.value, u.uTo.value, k).y += 0.9 * this.scale;
    const env = t < 0 ? 0 : Math.min(1, t / 0.15) * (t < HIMEKO_FX.sweep ? 1 : Math.max(0, 1 - (t - HIMEKO_FX.sweep) / HIMEKO_FX.burn));
    this.light.intensity = 26 * env * (0.85 + 0.15 * Math.sin(t * 37));
    this.light.distance = 9 * this.scale;
    if (t > HIMEKO_FX.sweep + HIMEKO_FX.burn) {
      this.fire.visible = false;
      this.fireAt = -1;
      this.light.intensity = 0;
    }
  }
}
